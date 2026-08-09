import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rateLimit'
import { checkAiBudget } from '@/lib/aiBudget'
import { checkAiQuota, aiQuotaMessage } from '@/lib/aiQuota'
import { verifyFirebaseToken } from '@/lib/verifyFirebaseToken'
import { ALL_CATEGORIES } from '@/lib/constants'
import { verifyAppCheckToken, appCheckEnforced } from '@/lib/verifyAppCheckToken'
import { isAccountDeleted } from '@/lib/deletionTombstone'

// firebase-admin (rate limit + quota) needs the Node runtime.
export const runtime = 'nodejs'

// Per-user rate limit: 50 categorize calls per hour
const USER_LIMIT  = 50
const WINDOW_MS   = 3_600_000 // 1 hour

// Server-owned system prompt. The client no longer controls it — this blocks an
// authenticated user from injecting an arbitrary system prompt and repurposing the
// API key as a general-purpose Claude. Built from the same ALL_CATEGORIES source the
// credit/import pages used, so categorization behavior is byte-for-byte unchanged.
const SYSTEM_PROMPT =
  'אתה מומחה לניתוח הוצאות פיננסיות בישראל.\n' +
  'קבל רשימת עסקאות מכרטיס אשראי ישראלי וסווג כל עסקה לקטגוריה אחת.\n\n' +
  'קטגוריות אפשריות בלבד:\n' + ALL_CATEGORIES.join(', ') + '\n\n' +
  'כללים:\n' +
  '- בע"מ / ltd / llc — התעלם מסיומות משפטיות\n' +
  '- שם עיר בסוף — חלק ממיקום, לא מהשם\n' +
  '- אם יש בשם מותג/רשת מוכר — גם אחרי קידומת של חברת סליקה (למשל "MESHULAM*שופרסל") — זהה אותו וסווג לפיו.\n' +
  '- אם אין שם עסק מזוהה, אלא רק קוד/מספר/שם חברת סליקה (MESHULAM, MPS, TRANZILA, CARDCOM וכו\') — סווג "שונות". אל תנחש!\n' +
  '- דיוק חשוב מכיסוי: עדיף "שונות" על ניחוש שגוי. סווג רק כשאתה באמת מזהה את העסק.\n' +
  '- אל תמציא קטגוריות חדשות\n\n' +
  'החזר אך ורק את הקטגוריות, באותו סדר בדיוק של העסקאות שקיבלת (קטגוריה אחת לכל שורה).\n' +
  'פורמט תגובה — JSON בלבד ללא טקסט נוסף, מערך מחרוזות לפי הסדר:\n' +
  '{"categories":["קטגוריה1","קטגוריה2"]}'

// Legit batches (80 transactions) are ~5–8KB. Generous headroom, but blocks an
// abuser from sending oversized payloads to run up token cost (was 60K).
const MAX_MESSAGE_LEN = 24_000


export async function POST(req: NextRequest) {
  // Verify Firebase auth token
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

  // An ID token outlives account deletion by up to an hour — the same check
  // the save/transaction/learn routes already make. Denied BEFORE any AI
  // spend, and before the deleted uid can re-create a rate-limit counter.
  if (await isAccountDeleted(uid)) {
    return NextResponse.json({ error: 'account deleted' }, { status: 410 })
  }

  // App Check (gated): ensures the request comes from the real app, not a script.
  // No-op until APP_CHECK_ENFORCE=true (flip on only after reCAPTCHA is registered
  // and the App Check console shows real traffic is verified).
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
  const rl = await checkRateLimit({ key: 'categorize:' + uid, limit: USER_LIMIT, windowMs: WINDOW_MS })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'הגעת למגבלת הסיווגים לשעה זו — נסה שוב מאוחר יותר' },
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
  const { message } = body as Record<string, unknown>
  if (typeof message !== 'string' || !message.trim()) {
    return NextResponse.json({ error: 'חסר message' }, { status: 400 })
  }
  if (message.length > MAX_MESSAGE_LEN) {
    return NextResponse.json({ error: 'הבקשה גדולה מדי' }, { status: 400 })
  }

  // Lightweight abuse-visibility log (uid + size only, no transaction content).
  console.log(`[categorize] uid=${uid} msgLen=${message.length}`)

  // Per-practice ceiling + usage accounting, consumed only once the call is
  // actually going out: a user rejected by their own limit must never eat
  // into the firm shared budget (one loop would lock out the whole firm).
  const quota = await checkAiQuota({ uid, email, route: 'categorize' })
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
      max_tokens: 4096,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: message }],
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
