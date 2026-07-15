import { NextRequest, NextResponse } from 'next/server'
import { verifyFirebaseToken } from '@/lib/verifyFirebaseToken'
import { verifyAppCheckToken } from '@/lib/verifyAppCheckToken'
import { AUTOMAP_SYSTEM_PROMPT } from '@/lib/autoMap'
import { checkRateLimit } from '@/lib/rateLimit'
import { checkAiBudget } from '@/lib/aiBudget'
import { hasLabAccess } from '@/lib/labAccess'

// firebase-admin (via the shared rate limiter) needs the Node runtime, not Edge.
export const runtime = 'nodejs'

// Per-user rate limit: 20 auto-mapping generations per day (heavy call).
const USER_LIMIT  = 20
const WINDOW_MS   = 86_400_000 // 24 hours

// The client's data summary can be large (transaction lines + free text).
const MAX_MESSAGE_LEN = 40_000
// Multimodal payload (text + base64 images/PDFs). Kept just under Vercel's
// hard ~4.5MB serverless request-body limit (going higher gets the request
// rejected by the platform before it reaches us); the client also adaptively
// compresses images and caps the total at 4.3MB, leaving headroom for the
// JSON envelope + text block.
const MAX_CONTENT_LEN = 4_400_000

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'נדרשת התחברות' }, { status: 401 })
  }
  let uid: string
  let isAdvisor = false
  try {
    const result = await verifyFirebaseToken(auth.slice(7))
    uid = result.uid
    isAdvisor = hasLabAccess(result.email)
  } catch {
    return NextResponse.json({ error: 'פג תוקף הסשן — התחבר מחדש' }, { status: 401 })
  }

  // App Check (gated) — no-op until APP_CHECK_ENFORCE=true.
  if (process.env.APP_CHECK_ENFORCE === 'true') {
    try {
      await verifyAppCheckToken(req.headers.get('x-firebase-appcheck') ?? '')
    } catch {
      return NextResponse.json({ error: 'בקשה לא מאומתת (App Check)' }, { status: 401 })
    }
  }

  if (!isAdvisor) {
    const rl = await checkRateLimit({ key: `automap:${uid}`, limit: USER_LIMIT, windowMs: WINDOW_MS })
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'הגעת למגבלת המיפויים האוטומטיים היומית (20) — נסה שוב מחר' },
        { status: 429 },
      )
    }
  }

  if ((await checkAiBudget({ exempt: isAdvisor })).stopped) {
    return NextResponse.json(
      { error: 'השירות עמוס כרגע — נסה שוב מאוחר יותר' },
      { status: 503 },
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

  const data = await res.json()
  const text = (data as { content?: { text?: string }[] }).content?.[0]?.text ?? ''
  return NextResponse.json({ text })
}
