import { NextRequest, NextResponse } from 'next/server'
import { verifyFirebaseToken } from '@/lib/verifyFirebaseToken'
import { verifyAppCheckToken } from '@/lib/verifyAppCheckToken'
import { checkRateLimit } from '@/lib/rateLimit'
import { checkAiBudget } from '@/lib/aiBudget'
import { hasLabAccess } from '@/lib/labAccess'

// firebase-admin (via the shared rate limiter) needs the Node runtime, not Edge.
export const runtime = 'nodejs'

// Client-facing safety net for credit-card statements the deterministic parser
// can't read. Per-user daily cap (advisors process many clients).
const USER_LIMIT  = 60
const WINDOW_MS   = 86_400_000 // 24 hours

const MAX_CONTENT_LEN = 4_000_000

const SYSTEM_PROMPT = `אתה קורא דוח כרטיס אשראי ישראלי. הוא יכול להגיע כקובץ (PDF/תמונה) או כטבלת נתונים בטקסט (שורות עם עמודות מופרדות ב‑| ). חלץ את כל העסקאות.

לכל עסקה החזר:
- date: תאריך בפורמט YYYY-MM-DD אם ניתן (אחרת מחרוזת ריקה).
- desc: שם בית העסק.
- amount: סכום החיוב בש"ח כמספר חיובי (ללא ₪, ללא פסיקים). אם יש גם "סכום עסקה" וגם "סכום חיוב בש"ח" — קח את סכום החיוב בש"ח.
- isRefund: true אם זו עסקת זיכוי / החזר (סכום שלילי / "זיכוי").

כללים:
- דוחות איסרכרט/מאקס מכילים לעיתים שני מקטעים ("בארץ" ו"בחו"ל") — כלול עסקאות משניהם.
- התעלם משורות סיכום, כותרות, כותרות עמודות, ומספרי אסמכתא.
- אל תמציא עסקאות; חלץ רק מה שמופיע בדוח.

החזר JSON תקין בלבד, ללא טקסט נוסף:
{"transactions":[{"date":"2026-06-14","desc":"שופרסל","amount":250,"isRefund":false}]}`

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

  if (process.env.APP_CHECK_ENFORCE === 'true') {
    try {
      await verifyAppCheckToken(req.headers.get('x-firebase-appcheck') ?? '')
    } catch {
      return NextResponse.json({ error: 'בקשה לא מאומתת (App Check)' }, { status: 401 })
    }
  }

  if (!isAdvisor) {
    const rl = await checkRateLimit({ key: `credit-statement:${uid}`, limit: USER_LIMIT, windowMs: WINDOW_MS })
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'הגעת למגבלת קריאת הדוחות היומית (60) — נסה שוב מחר' },
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
  const { content } = body as Record<string, unknown>
  if (!Array.isArray(content) || content.length === 0) {
    return NextResponse.json({ error: 'חסר קובץ' }, { status: 400 })
  }
  const size = JSON.stringify(content).length
  if (size > MAX_CONTENT_LEN) {
    return NextResponse.json({ error: 'הקובץ גדול מדי — נסה קובץ קטן יותר' }, { status: 400 })
  }

  console.log(`[credit-statement] uid=${uid} contentBytes=${size} blocks=${content.length}`)

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
