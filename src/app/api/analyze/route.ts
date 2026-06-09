import { NextRequest, NextResponse } from 'next/server'
import { verifyFirebaseToken } from '@/lib/verifyFirebaseToken'

// Per-user rate limit: 2 analyses per day
const userLimitMap = new Map<string, { count: number; start: number }>()
const USER_LIMIT  = 2
const WINDOW_MS   = 86_400_000 // 24 hours

// Server-owned system prompt. The client no longer controls it — this blocks an
// authenticated user from injecting an arbitrary system prompt and repurposing the
// API key as a general-purpose Claude. Copied verbatim from what AiAnalysis used to
// send, so the analysis output is unchanged.
const SYSTEM_PROMPT = `אתה יועץ פיננסי מומחה לשוק הישראלי. קבל סיכום של הוצאות חודש/חודשים מכרטיסי אשראי וספק ניתוח פיננסי מקצועי ומפורט.

הניתוח שלך יכלול:
1. **תמונה כוללת** — סיכום הכנסות/הוצאות, תזרים משוער
2. **דגלים אדומים** — קטגוריות חריגות, הוצאות חוזרות גבוהות, דפוסים מדאיגים
3. **נקודות חוזקה** — דפוסים פיננסיים חיוביים
4. **המלצות** — 3-5 צעדים מעשיים לשיפור
5. **שאלות להמשך** — שאלות שהיועץ צריך לשאול את הלקוח

כתוב בעברית, בסגנון מקצועי אך נגיש. השתמש ב-markdown (כותרות, רשימות, עיצוב).`

// Analysis summaries are a few KB. Generous headroom, blocks oversized abuse payloads (was 60K).
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
      { error: 'הגעת למגבלת הניתוחים היומית (2) — נסה שוב מחר' },
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

  // Lightweight abuse-visibility log (uid + size only, no financial content).
  console.log(`[analyze] uid=${uid} msgLen=${message.length}`)

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
