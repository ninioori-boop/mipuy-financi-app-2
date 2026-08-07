import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rateLimit'
import { checkAiBudget } from '@/lib/aiBudget'
import { checkAiQuota, aiQuotaMessage } from '@/lib/aiQuota'
import { verifyFirebaseToken } from '@/lib/verifyFirebaseToken'
import { getAdminDb } from '@/lib/firebaseAdmin'
import { hasLabAccess } from '@/lib/labAccess'
import { verifyAppCheckToken, appCheckEnforced } from '@/lib/verifyAppCheckToken'
import { AUTOMAP_SYSTEM_PROMPT } from '@/lib/autoMap'

// firebase-admin (rate limit + quota) needs the Node runtime.
export const runtime = 'nodejs'

// Per-user daily rate limit. This is the most expensive call in the product —
// Sonnet with up to 16K output and up to ~4MB of decoded PDF/image input — and
// it draws on the SAME daily AI counter as categorization for every client. At
// one flat limit of 20, opening this tool to ~40 clients would allow 800
// generations/day against a 500/day ceiling: a handful of curious clients could
// take categorization down for everyone.
//
// The tier is resolved server-side because until now the advisor gate was
// CLIENT-SIDE ONLY — any authenticated user could POST here directly and spend
// 20 generations a day on a page they cannot even open.
const ADVISOR_LIMIT = 20
const CLIENT_LIMIT  = 3
const WINDOW_MS     = 86_400_000 // 24 hours

/**
 * Advisor or not. Mirrors the client's useLabAccess: the bootstrap email list,
 * or a real advisors/{uid} document.
 *
 * Fails OPEN to 'advisor' on a read error, deliberately: a transient Firestore
 * blip must not silently cut a working advisor down to three generations a day
 * mid-session. The cost of being wrong is one extra tier for one user; the cost
 * of the opposite is an advisor blocked with no explanation.
 */
async function resolveTier(uid: string, email: string | null): Promise<'advisor' | 'client'> {
  if (hasLabAccess(email)) return 'advisor'
  const db = getAdminDb()
  if (!db) return 'client'
  try {
    const snap = await db.collection('advisors').doc(uid).get()
    return snap.exists ? 'advisor' : 'client'
  } catch {
    return 'advisor'
  }
}

// The client's data summary can be large (transaction lines + free text).
const MAX_MESSAGE_LEN = 40_000
// Multimodal payload (text + base64 images/PDFs). Kept under the serverless
// request-body limit; the client also downscales images and caps total size.
const MAX_CONTENT_LEN = 4_000_000


export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'נדרשת התחברות' }, { status: 401 })
  }
  let uid: string
  let email: string | null = null
  try {
    const result = await verifyFirebaseToken(auth.slice(7))
    uid = result.uid
    email = result.email ?? null
  } catch {
    return NextResponse.json({ error: 'פג תוקף הסשן — התחבר מחדש' }, { status: 401 })
  }

  // App Check (gated) — no-op until APP_CHECK_ENFORCE=true.
  if (appCheckEnforced()) {
    try {
      await verifyAppCheckToken(req.headers.get('x-firebase-appcheck') ?? '')
    } catch {
      return NextResponse.json({ error: 'בקשה לא מאומתת (App Check)' }, { status: 401 })
    }
  }

  // Global panic switch / deployment-wide daily ceiling.
  const budget = await checkAiBudget()
  if (budget.stopped) {
    return NextResponse.json({ error: 'השירות עמוס כרגע, נסה שוב מאוחר יותר' }, { status: 503 })
  }
  // Per-user limit — Firestore-backed so it survives cold starts and
  // cannot be bypassed by spreading requests across serverless instances.
  const tier  = await resolveTier(uid, email)
  const limit = tier === 'advisor' ? ADVISOR_LIMIT : CLIENT_LIMIT
  const rl = await checkRateLimit({ key: 'automap:' + uid, limit, windowMs: WINDOW_MS })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `הגעת למגבלת המיפויים האוטומטיים היומית (${limit}) — נסה שוב מחר` },
      { status: 429 },
    )
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY לא מוגדר' }, { status: 500 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'גוף הבקשה לא תקין' }, { status: 400 })
  }
  // `system` from the client is intentionally ignored — the prompt is server-owned.
  // Accept EITHER a plain `message` string OR a multimodal `content` array
  // (text + base64 image/PDF blocks). The array shape is passed through to
  // Anthropic as-is so Claude can read uploaded documents directly.
  const { message, content } = body as Record<string, unknown>
  let userContent: unknown
  if (Array.isArray(content) && content.length > 0) {
    const size = JSON.stringify(content).length
    if (size > MAX_CONTENT_LEN) {
      return NextResponse.json({ error: 'הקבצים גדולים מדי — הקטן/הסר חלק והעלה שוב' }, { status: 400 })
    }
    userContent = content
    console.log(`[automap] uid=${uid} contentBytes=${size} blocks=${content.length}`)
  } else if (typeof message === 'string' && message.trim()) {
    if (message.length > MAX_MESSAGE_LEN) {
      return NextResponse.json({ error: 'הבקשה גדולה מדי' }, { status: 400 })
    }
    userContent = message
    console.log(`[automap] uid=${uid} msgLen=${message.length}`)
  } else {
    return NextResponse.json({ error: 'חסר תוכן (טקסט או קבצים)' }, { status: 400 })
  }

  // Per-practice ceiling + usage accounting, consumed only once the call is
  // actually going out: a user rejected by their own limit must never eat
  // into the firm shared budget (one loop would lock out the whole firm).
  const quota = await checkAiQuota({ uid, email, route: 'automap' })
  if (!quota.allowed) {
    return NextResponse.json({ error: aiQuotaMessage(quota.reason) }, { status: 429 })
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-6',
      // Bumped from 8000: confidence + source meta on every row grew responses
      // ~40%. A 30-50 row mapping with the meta fields would hit the old cap
      // and get truncated mid-JSON, producing the "לא התקבל JSON תקין" error
      // on the client. Sonnet 4.6 supports up to 64K output; 16000 gives
      // comfortable headroom for the biggest realistic mappings.
      max_tokens: 16000,
      system:     AUTOMAP_SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: userContent }],
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    return NextResponse.json(
      { error: (err as { error?: { message?: string } }).error?.message ?? `שגיאת API ${res.status}` },
      { status: res.status },
    )
  }

  const data = await res.json() as {
    content?: { text?: string }[]
    stop_reason?: string
    usage?: { input_tokens?: number; output_tokens?: number }
  }
  const text = data.content?.[0]?.text ?? ''

  // stop_reason is the difference between "the model wrote prose instead of
  // JSON" and "the mapping was cut off at the token ceiling" — two failures
  // that look identical on the client and need opposite fixes. Passing it
  // through costs nothing and turns a guess into a diagnosis.
  console.log(`[automap] uid=${uid} tier=${tier} stop=${data.stop_reason} out=${data.usage?.output_tokens}`)
  return NextResponse.json({ text, stopReason: data.stop_reason ?? null })
}
