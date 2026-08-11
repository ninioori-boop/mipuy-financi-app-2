import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rateLimit'
import { checkAiBudget } from '@/lib/aiBudget'
import { checkAiQuota, aiQuotaMessage } from '@/lib/aiQuota'
import { verifyFirebaseToken } from '@/lib/verifyFirebaseToken'
import { verifyAppCheckToken, appCheckEnforced } from '@/lib/verifyAppCheckToken'
import { isAccountDeleted } from '@/lib/deletionTombstone'
import { isInvited, NOT_INVITED_MESSAGE } from '@/lib/requireInvited'

// firebase-admin (rate limit + quota) needs the Node runtime.
export const runtime = 'nodejs'

// Client-facing (every user / advisor can upload a bank statement). Per-user
// daily cap to bound AI cost/abuse — a real statement is one call, but an
// advisor may process many clients in a day.
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

  // An ID token outlives account deletion by up to an hour — the same check
  // the save/transaction/learn routes already make. Denied BEFORE any AI
  // spend, and before the deleted uid can re-create a rate-limit counter.
  if (await isAccountDeleted(uid)) {
    return NextResponse.json({ error: 'account deleted' }, { status: 410 })
  }

  // Invite-only, enforced HERE because the AI routes are the one authenticated
  // surface firestore.rules does not cover, and the only one that spends money
  // per call. gateSignup was meant to stop an uninvited account from ever
  // existing; it has never run once (see src/lib/requireInvited.ts).
  if (!(await isInvited(uid, email))) {
    return NextResponse.json({ error: NOT_INVITED_MESSAGE }, { status: 403 })
  }

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
  const rl = await checkRateLimit({ key: 'bank-statement:' + uid, limit: USER_LIMIT, windowMs: WINDOW_MS })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'הגעת למגבלת קריאת הדוחות היומית (60), נסה שוב מחר' },
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

  // Per-practice ceiling + usage accounting, consumed only once the call is
  // actually going out: a user rejected by their own limit must never eat
  // into the firm shared budget (one loop would lock out the whole firm).
  const quota = await checkAiQuota({ uid, email, route: 'bank-statement' })
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
