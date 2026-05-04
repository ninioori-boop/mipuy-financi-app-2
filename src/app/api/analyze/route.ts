import { NextRequest, NextResponse } from 'next/server'
import { verifyFirebaseToken } from '@/lib/verifyFirebaseToken'

// Per-user rate limit: 20 analyses per hour
const userLimitMap = new Map<string, { count: number; start: number }>()
const USER_LIMIT  = 20
const WINDOW_MS   = 3_600_000 // 1 hour

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
      { error: 'הגעת למגבלת הניתוחים לשעה זו (20) — נסה שוב מאוחר יותר' },
      { status: 429 },
    )
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY לא מוגדר' }, { status: 500 })
  }

  const { system, message } = await req.json()
  if (!message) {
    return NextResponse.json({ error: 'חסר message' }, { status: 400 })
  }

  const msgLen = ((system as string) ?? '').length + (message as string).length
  if (msgLen > 60_000) {
    return NextResponse.json({ error: 'הבקשה גדולה מדי' }, { status: 400 })
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
      system:     system ?? undefined,
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
