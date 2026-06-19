import { NextRequest, NextResponse } from 'next/server'
import { verifyFirebaseToken } from '@/lib/verifyFirebaseToken'
import { verifyAppCheckToken } from '@/lib/verifyAppCheckToken'

// Client-facing (every user / advisor can upload a bank statement). Per-user
// daily cap to bound AI cost/abuse — a real statement is one call, but an
// advisor may process many clients in a day.
const userLimitMap = new Map<string, { count: number; start: number }>()
const USER_LIMIT  = 60
const WINDOW_MS   = 86_400_000 // 24 hours

// Multimodal payload (base64 PDF/image, or Excel rows as text) kept under the
// serverless body limit.
const MAX_CONTENT_LEN = 4_000_000

const SYSTEM_PROMPT = `אתה קורא דוח חשבון עו"ש (בנק) ישראלי. הוא יכול להגיע כקובץ (PDF/תמונה) או כטבלת נתונים בטקסט (שורות עם עמודות מופרדות ב‑|). חלץ את כל התנועות.

לכל תנועה החזר:
- date: תאריך בפורמט YYYY-MM-DD אם ניתן (אחרת מחרוזת ריקה).
- desc: שם בית העסק / המוטב / תיאור התנועה.
- amount: הסכום של התנועה כמספר חיובי (ללא ₪, ללא פסיקים, ללא סימן).
- dir: "out" לכסף שיצא (חיוב/חובה/תשלום/משיכה), או "in" לכסף שנכנס (זיכוי/זכות/הפקדה/העברה נכנסת/משכורת).

כללים חשובים:
- אם יש עמודת סכום אחת עם **סימן**: מינוס (-) = out, חיובי = in. החזר את הסכום בערך מוחלט (חיובי).
- אם יש עמודות נפרדות "חובה" ו"זכות": חובה=out, זכות=in.
- **התעלם מעמודת היתרה הרצה** (running balance) — היא לא תנועה. בפורמט הפועלים: עמודה אחת היא הסכום עם סימן, עמודה אחרת היא היתרה אחריו (תמיד חיובית וגדלה/קטנה בהדרגה) — אל תיקח אותה.
- התעלם ממספרי אסמכתא/רצף, מסיכומים, מכותרות, ומשורות כותרת עמודות.
- אל תמציא תנועות; חלץ רק מה שמופיע בדוח.

החזר JSON תקין בלבד, ללא טקסט נוסף:
{"transactions":[{"date":"2026-06-14","desc":"שופרסל","amount":250,"dir":"out"}]}`

function isUserLimited(uid: string): boolean {
  const now   = Date.now()
  const entry = userLimitMap.get(uid) ?? { count: 0, start: now }
  if (now - entry.start > WINDOW_MS) { entry.count = 0; entry.start = now }
  entry.count++
  userLimitMap.set(uid, entry)
  return entry.count > USER_LIMIT
}

export async function POST(req: NextRequest) {
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

  if (process.env.APP_CHECK_ENFORCE === 'true') {
    try {
      await verifyAppCheckToken(req.headers.get('x-firebase-appcheck') ?? '')
    } catch {
      return NextResponse.json({ error: 'בקשה לא מאומתת (App Check)' }, { status: 401 })
    }
  }

  if (isUserLimited(uid)) {
    return NextResponse.json(
      { error: 'הגעת למגבלת קריאת הדוחות היומית (15) — נסה שוב מחר' },
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
  const { content } = body as Record<string, unknown>
  if (!Array.isArray(content) || content.length === 0) {
    return NextResponse.json({ error: 'חסר קובץ' }, { status: 400 })
  }
  const size = JSON.stringify(content).length
  if (size > MAX_CONTENT_LEN) {
    return NextResponse.json({ error: 'הקובץ גדול מדי — נסה קובץ קטן יותר' }, { status: 400 })
  }

  console.log(`[bank-statement] uid=${uid} contentBytes=${size} blocks=${content.length}`)

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 16000,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: 'user', content }],
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
