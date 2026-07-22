import { NextRequest, NextResponse } from 'next/server'
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { getAdminDb } from '@/lib/firebaseAdmin'
import { sendPushToUser } from '@/lib/webPush'
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

  if (typeof merchant !== 'string' || !merchant.trim() || merchant.length > MAX_MERCHANT) {
    return NextResponse.json({ error: 'bad merchant' }, { status: 400 })
  }
  // The iOS Shortcut's transaction "Amount" arrives as a CURRENCY-FORMATTED
  // STRING ("₪32.83", "32.83 ₪", "$32.83") — parseFloat("₪32.83") is NaN — so
  // pull the first money-looking number out of it. (Comma = thousands sep in
  // he-IL; period = decimal.) Plain numbers still pass straight through.
  let amt = parseAmountLoose(amount)
  // iOS renders the transaction's Amount/Merchant with invisible bidi control
  // marks (RLM/LRM etc.) around the ₪ — they break the currency-anchored
  // regexes below and pollute the merchant name for categorization.
  let cleanMerchant = stripInvisible(merchant).trim()

  // Echo/loop guard: a miswired iOS Shortcut can call ITSELF and feed our own
  // notification text back as the "merchant" ("נרשם: נרשם: … קוטלג ל…"),
  // creating an infinite capture loop that only died on MAX_MERCHANT (seen in
  // the field: one ₪44 tap → a recursive notification flood + junk expense
  // rows). A merchant that carries our notify signature is never a real
  // business — reject it, which also kills the loop on its first round trip
  // (no notify in the response → the shortcut's dictionary step stops the run).
  if (/^נרשם:|קוטלג ל/.test(cleanMerchant)) {
    console.log('[transaction] ECHO_REJECTED')
    return NextResponse.json({ error: 'echo' }, { status: 400 })
  }

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
  // Bit/Paybox person-to-person transfers carry the RECIPIENT'S NAME, not a
  // business — substring lookups and the AI both mis-guess on person names
  // (e.g. "אורן" → a restaurant / a barber). So a transfer ALWAYS lands in
  // "ביט ללא מעקב" (bypassing learned/DB/AI entirely); only an explicit
  // category from the app's manual entry overrides. Re-categorizing a specific
  // transfer is done per-entry in the expenses tab.
  const isTransfer = typeof source === 'string' && /ביט|פייבוקס|paybox|\bbit\b/i.test(source)

  // Duplicate-fire guard: iOS Wallet automations can fire several times for
  // ONE physical payment (transaction updates / re-triggers — seen in the
  // field: one ₪14 tap → a burst of identical POSTs). Same merchant+amount
  // arriving again within the window = the same payment; skip the inbox write
  // and the push, but answer normally so the shortcut doesn't error.
  const DEDUP_WINDOW_MS = 180_000
  const inboxRef = db.collection('transactionInbox').doc(uid)
  const roundedAmt = Math.round(amt * 100) / 100
  // Manual entries (explicit category from the app) are deliberate — a human
  // adding the same amount twice on purpose must not be swallowed.
  if (typeof catOverride !== 'string') try {
    const parent = await inboxRef.get()
    const last = parent.exists
      ? (parent.data()?.last as { m?: string; a?: number; at?: number; cat?: string } | undefined)
      : undefined
    if (
      last &&
      last.m === cleanMerchant &&
      last.a === roundedAmt &&
      typeof last.at === 'number' &&
      Date.now() - last.at < DEDUP_WINDOW_MS
    ) {
      console.log(`[transaction] DUPLICATE_SKIPPED uid=${uid}`)
      const category = typeof last.cat === 'string' ? last.cat : 'שונות'
      const notify = await buildNotify(db, uid, category, amt, cleanMerchant, dateStr.slice(0, 7))
      return NextResponse.json({ ok: true, duplicate: true, category, notify })
    }
  } catch { /* guard is best-effort — never blocks a capture */ }

  let category: string
  if (typeof catOverride === 'string' && ALL_CATEGORIES.includes(catOverride)) {
    category = catOverride
  } else if (isTransfer) {
    category = 'ביט ללא מעקב'
  } else {
    const learnedDB = await loadSharedLearned(db)
    category = categorize(cleanMerchant, learnedDB)
    if (category === 'שונות') {
      const ai = await aiCategorizeOne(cleanMerchant)
      if (ai) category = ai
    }
  }

  await inboxRef.collection('items').add({
    merchant:  cleanMerchant,
    amount:    roundedAmt,
    date:      dateStr,
    category,
    ref:       refStr,
    createdAt: FieldValue.serverTimestamp(),
  })
  // Fingerprint for the duplicate-fire guard above (best-effort).
  await inboxRef
    .set({ last: { m: cleanMerchant, a: roundedAmt, at: Date.now(), cat: category } }, { merge: true })
    .catch(() => { /* guard metadata only */ })

  // uid + bucket only — no merchant/amount detail logged.
  console.log(`[transaction] uid=${uid} cat=${category}`)

  // Budget-aware confirmation for the phone app to show as a LOCAL notification
  // (no FCM). Best-effort — ingest already succeeded; never fails the request.
  // NOTE: `category` must stay the FIRST "category" key in the JSON — old APKs
  // extract it by scanning for the first occurrence.
  const notify = await buildNotify(db, uid, category, amt, cleanMerchant, dateStr.slice(0, 7))

  // Branded Web-Push to the user's installed apps (iOS PWA / browsers) — the
  // app-name-and-icon notification. Best-effort like notify itself: never
  // fails the request; inert until the VAPID keys are configured.
  await sendPushToUser(db, uid, {
    title: notify.title,
    body: notify.body,
    url: '/app/expenses',
    // Identical captures replace each other on screen instead of stacking.
    tag: refStr ?? `${cleanMerchant}|${roundedAmt}|${dateStr}`,
  })

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
): Promise<{ title: string; body: string; text: string; warn: boolean }> {
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
  // `text` = title + body in ONE field, for the iOS Shortcut: a single
  // "Get Dictionary Value notify.text" auto-wires into Show Notification with
  // zero manual variable picking (two identical "ערך המילון" chips proved
  // impossible to wire correctly by hand). Android keeps using title/body.
  return { title, body, text: `${title}\n${body}`, warn }
}

/**
 * Extracts amount + merchant from a raw transaction text (Apple Pay via the
 * shared iOS Shortcut). Currency-anchored patterns first (₪/$/€/ש"ח, before or
 * after the number), then a bare first-number as last resort. The remainder of
 * the string, cleaned of separators, becomes the merchant.
 */
// Strips invisible bidi/zero-width control chars iOS embeds in transaction
// text (U+200B–U+200F, U+202A–U+202E, U+2066–U+2069, BOM).
function stripInvisible(s: string): string {
  return s.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
}

/**
 * Parses an amount that may be a plain number OR a currency-formatted string
 * from the iOS Shortcut ("₪32.83", "32.83 ₪", "$1,234.56"). Returns NaN if no
 * number is found. Commas are treated as thousands separators (he-IL uses a
 * period for the decimal).
 */
function parseAmountLoose(v: unknown): number {
  if (typeof v === 'number') return v
  const m = String(v ?? '').match(/[0-9][0-9,]*(?:\.[0-9]+)?/)
  return m ? parseFloat(m[0].replace(/,/g, '')) : NaN
}

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
