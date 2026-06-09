import { NextRequest, NextResponse } from 'next/server'
import { verifyFirebaseToken } from '@/lib/verifyFirebaseToken'
import { ALL_CATEGORIES } from '@/lib/constants'

// Per-user rate limit: 50 categorize calls per hour
const userLimitMap = new Map<string, { count: number; start: number }>()
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
  '- אם לא בטוח — השתמש ב"שונות"\n' +
  '- אל תמציא קטגוריות חדשות\n\n' +
  'החזר אך ורק את הקטגוריות, באותו סדר בדיוק של העסקאות שקיבלת (קטגוריה אחת לכל שורה).\n' +
  'פורמט תגובה — JSON בלבד ללא טקסט נוסף, מערך מחרוזות לפי הסדר:\n' +
  '{"categories":["קטגוריה1","קטגוריה2"]}'

// Legit batches (80 transactions) are ~5–8KB. Generous headroom, but blocks an
// abuser from sending oversized payloads to run up token cost (was 60K).
const MAX_MESSAGE_LEN = 24_000

function isUserLimited(uid: string): boolean {
  const now   = Date.now()
  const entry = userLimitMap.get(uid) ?? { count: 0, start: now }
  if (now - entry.start > WINDOW_MS) {
    userLimitMap.set(uid, { count: 1, start: now })
    return false
  }
  if (entry.count >= USER_LIMIT) return true
  entry.count++
  userLimitMap.set(uid, entry)
  return false
}

export async function POST(req: NextRequest) {
  // Verify Firebase auth token
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'נדרשת התחברות' }, { status: 401 })
  }
  let uid: string
  try {
    const result = await verifyFirebaseToken(auth.slice(7))
    uid = result.uid
  } catch {
    return NextResponse.json({ error: 'פג תוקף הסשן — התחבר מחדש' }, { status: 401 })
  }

  if (isUserLimited(uid)) {
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
