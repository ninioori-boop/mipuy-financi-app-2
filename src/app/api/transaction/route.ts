import { NextRequest, NextResponse } from 'next/server'
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { getAdminDb } from '@/lib/firebaseAdmin'
import { verifyDeviceToken } from '@/lib/deviceToken'
import { categorize } from '@/lib/categorize'
import { aiCategorizeOne } from '@/lib/aiCategorize'
import { ALL_CATEGORIES } from '@/lib/constants'

// firebase-admin needs the Node runtime (not Edge).
export const runtime = 'nodejs'

const MAX_MERCHANT = 200
const MAX_AMOUNT   = 1_000_000

// Receives a single externally-pushed transaction (from an iOS Shortcut / Android
// automation), auto-categorizes it, and drops it into the user's private inbox
// (transactionInbox/{uid}/items) via the admin SDK. The client drains the inbox
// into the expense log. Auth is the per-user HMAC device token — NOT a browser
// session — so a phone automation can call it without a logged-in webview.
//
// 503 until both TRANSACTION_SECRET and FIREBASE_SERVICE_ACCOUNT are set, so this
// route is inert (and harmless) until the backend is explicitly enabled.
export async function POST(req: NextRequest) {
  const secret = process.env.TRANSACTION_SECRET
  const db = getAdminDb()
  if (!secret || !db) {
    return NextResponse.json({ error: 'service not configured' }, { status: 503 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'bad request body' }, { status: 400 })
  }
  const { token, merchant, amount, date, ref, category: catOverride, source } = body as Record<string, unknown>

  const uid = typeof token === 'string' ? verifyDeviceToken(token, secret) : null
  if (!uid) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // TEMP DIAGNOSTIC — scoped to ONE test account only (Ori's household / Rotem),
  // so NO real client's transaction is ever captured. Confirms the iOS amount
  // fix on that one phone. Remove entirely once verified.
  const DEBUG_UID = 'LgHUoVC2hMWF6awgQJVeVOQIwqR2'
  if (uid === DEBUG_UID) {
    try {
      await db.collection('debug').doc('lastTx').set({
        uid,
        merchantType:  typeof merchant,
        merchantValue: (typeof merchant === 'string' ? merchant : String(merchant)).slice(0, 400),
        amountType:    typeof amount,
        amountValue:   (amount ?? null) as unknown,
        bodyKeys:      body && typeof body === 'object' ? Object.keys(body) : [],
        at:            FieldValue.serverTimestamp(),
      })
    } catch { /* best-effort */ }
  }

  if (typeof merchant !== 'string' || !merchant.trim() || merchant.length > MAX_MERCHANT) {
    return NextResponse.json({ error: 'bad merchant' }, { status: 400 })
  }
  let amt = typeof amount === 'number' ? amount : parseFloat(String(amount))
  let cleanMerchant = merchant.trim()

  // iPhone Shortcut fallback: a hand-built shared Shortcut can't extract the
  // Merchant/Amount properties from the Apple Pay transaction (the editor
  // offers no "transaction" type), so it sends the WHOLE transaction as text
  // in `merchant` with no amount. Pull the first money-looking number out and
  // treat the rest as the merchant name.
  if (!Number.isFinite(amt) || amt <= 0) {
    const ext = extractFromRaw(cleanMerchant)
    if (ext) {
      amt = ext.amount
      cleanMerchant = ext.merchant
    }
  }

  if (!Number.isFinite(amt) || amt <= 0 || amt > MAX_AMOUNT) {
    return NextResponse.json({ error: 'bad amount' }, { status: 400 })
  }
  const dateStr = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date
    : new Date().toISOString().slice(0, 10)
  const refStr = typeof ref === 'string' ? ref.slice(0, 64) : null
  // Explicit category (manual entry from the app) wins. Otherwise: learned
  // corrections (shared — same DB the credit/import/expenses tabs teach) →
  // BUSINESS_DB → AI fallback.
  // Bit/Paybox person-to-person transfers have no real business name, so the
  // AI just mis-guesses (e.g. a person's name → "ביטוח לאומי"). Detect them from
  // the capture source and default UNKNOWN ones to "ביט ללא מעקב" — identifiable,
  // and easy to re-categorize (the app surfaces it in the one-tap review strip).
  const isTransfer = typeof source === 'string' && /ביט|פייבוקס|paybox|\bbit\b/i.test(source)

  let category: string
  if (typeof catOverride === 'string' && ALL_CATEGORIES.includes(catOverride)) {
    category = catOverride
  } else {
    const learnedDB = await loadSharedLearned(db)
    category = categorize(cleanMerchant, learnedDB)   // learned corrections still win
    if (category === 'שונות') {
      if (isTransfer) {
        category = 'ביט ללא מעקב'   // don't let the AI guess a person's name
      } else {
        const ai = await aiCategorizeOne(cleanMerchant)
        if (ai) category = ai
      }
    }
  }

  await db
    .collection('transactionInbox').doc(uid)
    .collection('items').add({
      merchant:  cleanMerchant,
      amount:    Math.round(amt * 100) / 100,
      date:      dateStr,
      category,
      ref:       refStr,
      createdAt: FieldValue.serverTimestamp(),
    })

  // uid + bucket only — no merchant/amount detail logged.
  console.log(`[transaction] uid=${uid} cat=${category}`)

  // Budget-aware confirmation for the phone app to show as a LOCAL notification
  // (no FCM). Best-effort — ingest already succeeded; never fails the request.
  // NOTE: `category` must stay the FIRST "category" key in the JSON — old APKs
  // extract it by scanning for the first occurrence.
  const notify = await buildNotify(db, uid, category, amt, cleanMerchant, dateStr.slice(0, 7))

  return NextResponse.json({ ok: true, category, notify })
}

/**
 * Builds the notification text: "recorded ✓" + where the category's monthly
 * budget now stands, read from the user's saved snapshot (users/{uid}.data —
 * expenseLog entries + categoryBudgets). The snapshot may lag a charge or two
 * still in the inbox; close enough for a heads-up. warn=true → the app posts
 * it on the high-importance channel (heads-up) instead of the silent one.
 */
async function buildNotify(
  db: Firestore, uid: string, category: string, amount: number, merchant: string, ym: string,
): Promise<{ title: string; body: string; warn: boolean }> {
  const nis = (n: number) => '₪' + Math.round(n).toLocaleString('he-IL')
  const title = `נרשם: ${merchant} · ${nis(amount)}`
  // Categories that beg for a human to pick the right one → invite a tap.
  const NEEDS_REVIEW = new Set(['שונות', 'ביט ללא מעקב', 'מזומן ללא מעקב'])
  let body = NEEDS_REVIEW.has(category)
    ? `קוטלג ל${category} — הקש לעדכון הקטגוריה`
    : `קוטלג ל${category} ✓`
  let warn = false
  try {
    const snap = await db.collection('users').doc(uid).get()
    const data = snap.exists ? snap.data()?.data : null
    if (data && typeof data === 'object') {
      const d = data as { categoryBudgets?: { budgets?: Record<string, unknown> }; expenseLog?: { entries?: unknown[] } }
      const rawBudget = d.categoryBudgets?.budgets?.[category]
      const budget    = typeof rawBudget === 'number' && rawBudget > 0 ? rawBudget : 0
      const entries   = Array.isArray(d.expenseLog?.entries) ? d.expenseLog.entries : []
      if (budget > 0) {
        const spent = entries.reduce((s: number, e) => {
          const en = e as { category?: unknown; date?: unknown; amount?: unknown }
          return en && en.category === category
            && typeof en.date === 'string' && en.date.slice(0, 7) === ym
            && typeof en.amount === 'number'
            ? s + en.amount : s
        }, 0) + amount
        const pct = Math.round((spent / budget) * 100)
        if (pct >= 100)     { body = `⚠️ חריגה מתקציב ${category}: ${nis(spent)} מתוך ${nis(budget)}`; warn = true }
        else if (pct >= 80) { body = `לתשומת ליבך: ${pct}% מתקציב ${category} (${nis(spent)} מתוך ${nis(budget)})`; warn = true }
        else                { body = `${category}: נוצלו ${pct}% מהתקציב החודשי · נשארו ${nis(budget - spent)}` }
      }
    }
  } catch { /* best-effort — the default text is fine */ }
  return { title, body, warn }
}

/**
 * Extracts amount + merchant from a raw transaction text (Apple Pay via the
 * shared iOS Shortcut). Currency-anchored patterns first (₪/$/€/ש"ח, before or
 * after the number), then a bare first-number as last resort. The remainder of
 * the string, cleaned of separators, becomes the merchant.
 */
function extractFromRaw(raw: string): { merchant: string; amount: number } | null {
  const m =
    raw.match(/(?:₪|\$|€)\s*([0-9][0-9,]*(?:\.[0-9]+)?)/)
    ?? raw.match(/([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:₪|ש["”״]?ח|\$|€|ILS|NIS)/i)
    ?? raw.match(/([0-9][0-9,]*(?:\.[0-9]+)?)/)
  if (!m) return null
  const amount = parseFloat(m[1].replace(/,/g, ''))
  if (!Number.isFinite(amount) || amount <= 0) return null
  const merchant = raw
    .replace(m[0], ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—·,.:;]+|[\s\-–—·,.:;]+$/g, '')
    .trim()
    .slice(0, 200)
  return { merchant: merchant || 'Apple Pay', amount }
}

// Reads the shared merchant→category corrections (admin SDK) so a fix made once
// in the expenses/credit/import tabs auto-applies to future ingested charges.
async function loadSharedLearned(db: Firestore): Promise<Record<string, string>> {
  try {
    const snap = await db.collection('shared').doc('learnedDB').get()
    const data = snap.exists ? snap.data() : null
    return data && typeof data.db === 'object' && data.db
      ? (data.db as Record<string, string>)
      : {}
  } catch {
    return {}
  }
}
