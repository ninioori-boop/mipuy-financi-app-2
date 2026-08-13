import { isAccountDeleted, DELETED_ACCOUNT_RESPONSE } from '@/lib/deletionTombstone'
import { NextRequest, NextResponse, after } from 'next/server'
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { getAdminDb } from '@/lib/firebaseAdmin'
import { sendPushToUser } from '@/lib/webPush'
import { verifyDeviceToken } from '@/lib/deviceToken'
import { isDeviceTokenRevoked } from '@/lib/deviceTokenRevocation'
import { categorize } from '@/lib/categorize'
import { isPaymentRailKey } from '@/lib/learnedSharing'
import { aiCategorizeOne } from '@/lib/aiCategorize'
import { logAiSuggestion } from '@/lib/aiSuggestions'
import { checkAiBudget } from '@/lib/aiBudget'
import { checkAiQuota } from '@/lib/aiQuota'
import { ALL_CATEGORIES } from '@/lib/constants'
import {
  normalizeCurrency, detectCurrency, extractMoney, formatMoney, type CurrencyCode,
} from '@/lib/currency'
import { getIlsRate, toIls, type Foreign } from '@/lib/fxRates'

// firebase-admin needs the Node runtime (not Edge).
export const runtime = 'nodejs'

const MAX_MERCHANT = 200
const MAX_AMOUNT   = 1_000_000

type NotifyPayload = { title: string; body: string; text: string; warn: boolean }

/** Same shape buildNotify() returns, so the Shortcut's `notify.text` step works. */
function notifyOf(title: string, body: string): NotifyPayload {
  return { title, body, text: `${title}\n${body}`, warn: true }
}

// A refusal the CLIENT can read, plus a breadcrumb WE can read.
//
// Every rejection used to return `{ error }` and nothing else. The iOS Shortcut
// reads `notify.text`, so a missing key crashed the run with an untranslated
// "no value was found for dictionary key notify" — identical for a dead token,
// an empty merchant and a bad amount. Diagnosing therefore required the
// client's phone in hand (three rounds of screenshots on a client's device,
// 2026-07-30, and still inconclusive). Returning notify on failures turns the
// next ordinary payment into a sentence the client can simply read out, and the
// `transactionErrors` breadcrumb lets us diagnose with no phone at all.
//
// The SUCCESS path is untouched — an install that works today (Android, or an
// iPhone whose shortcut is wired correctly) sees a byte-identical response.
//
// Deliberately NOT used by the echo guard: that reply must stay notify-less,
// because the missing key is exactly what stops a self-calling shortcut from
// looping (see the echo comment in POST).
// The breadcrumb is written ONLY for a caller whose token verified, keyed by uid
// (one document per user, overwritten) — never `add()`. This route is public and
// has no rate limiting, so an `add()` on the unauthenticated 401 path would let
// anyone mint unbounded Firestore documents for free. The 401 case still reports
// itself through the notification text and the (ephemeral, free) server log.
//
// `after()` runs the write AFTER the response is sent: Firestore's default retry
// budget is 10 minutes, and awaiting it would hang exactly during the outage or
// throttle when this route must stay fast.
function refuse(
  db: Firestore | null,
  status: number,
  reason: string,
  notify: NotifyPayload,
  uid: string | null,
  diag: Record<string, unknown> = {},
): NextResponse {
  if (db && uid) {
    after(async () => {
      try {
        await db.collection('transactionErrors').doc(uid).set({
          reason,
          at: FieldValue.serverTimestamp(),
          ...diag,
        })
      } catch {
        // Diagnostics must never affect the response.
      }
    })
  }
  return NextResponse.json({ error: reason, notify }, { status })
}

// Our own notification text, coming back as a "merchant".
//
// A miswired shortcut can call ITSELF, feeding our reply back in as the purchase
// (the field incident: one ₪44 tap → ~6 notifications). The loop used to die
// because a rejection carried no `notify` and the Shortcut's dictionary step
// crashed. Now that rejections DO carry notify, that brake is gone, so the text
// must be recognized explicitly — including the "לא נרשם:" failure titles, which
// the original `^נרשם:` guard does not match.
const OUR_OWN_TEXT = /^(לא )?נרשם:|^כבר נרשם|קוטלג ל/

// A capture whose entire "merchant" is a card issuer's own name is never a
// purchase — it is the issuer's app talking about itself. Observed live
// 2026-08-07: two clients who had bought nothing got expenses of ₪1,037.80 and
// ₪10 with merchant "Max", almost certainly a statement-total or limit notice
// the listener read as a charge. BUSINESS_DB maps "max" to עמלות בנק ואשראי
// (correct for a real card fee), so they landed silently as fee expenses and
// skewed the budget and safe-to-spend of people who had spent nothing.
//
// ⚠️ EXACT match after normalization, never a substring. "מקס ברנר" (restaurant)
// and "מקס סטוק" (homeware) are real merchants in BUSINESS_DB, and a genuine
// ₪50 capture on 2026-07-29 read "Ampi Max Rishin Ltd". A `includes('max')`
// rule would silently swallow all three. The tests pin exactly that.
const ISSUER_NAMES = new Set([
  'max', 'מקס',
  'visa', 'ויזה',
  'isracard', 'ישראכרט',
  'cal', 'כאל', 'ויזה כאל',
  'leumicard', 'לאומי קארד',
  'amex', 'american express', 'אמריקן אקספרס',
  'diners', 'דיינרס',
])

/** True when the merchant string is nothing but a card issuer's name. */
export function isIssuerOnlyMerchant(merchant: string): boolean {
  const s = merchant
    .toLowerCase()
    .replace(/["'׳״.,()\-_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return ISSUER_NAMES.has(s)
}

// What the caller's token LOOKS like — never the signature itself. `uidPart` is
// logged only when it decodes to something shaped like a Firebase uid, so a
// client who pastes the wrong clipboard content (a password, another credential)
// into the token box does not get it echoed into our logs. `sigLen` is 43 for an
// intact HMAC, so a truncated or half-pasted token is visible at a glance.
function tokenShape(token: unknown): Record<string, unknown> {
  if (typeof token !== 'string') return { tokenParts: 0 }
  const parts = token.trim().split('.')
  let uidPart = '(unparseable)'
  try {
    const decoded = Buffer.from(parts[0], 'base64url').toString()
    if (/^[A-Za-z0-9]{20,40}$/.test(decoded)) uidPart = decoded
  } catch {
    // keep '(unparseable)'
  }
  return {
    tokenParts: parts.length,
    claimedUid: uidPart,
    tokenSigLen: parts[parts.length - 1].length,
  }
}

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
    return NextResponse.json({
      error: 'service not configured',
      notify: notifyOf('לא נרשם: השירות אינו זמין כרגע', 'אפשר לרשום את הקנייה ידנית באפליקציה.'),
    }, { status: 503 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    // No breadcrumb: reachable without any credential.
    return refuse(db, 400, 'bad request body', notifyOf(
      'לא נרשם: הבקשה הגיעה בלי תוכן',
      'צריך להתקין מחדש את הקיצור מהעמוד app.orimipuy.com/connect.',
    ), null)
  }
  const { token, merchant, amount, date, ref, category: catOverride, source, currency } = body as Record<string, unknown>

  // Loop-breaker FIRST, before auth: a self-calling shortcut whose token is also
  // dead would otherwise bounce off the 401 (which now carries notify) forever,
  // never reaching the guard further down. No notify in this reply, on purpose.
  if (typeof merchant === 'string' && OUR_OWN_TEXT.test(stripInvisible(merchant).trim())) {
    console.log('[transaction] ECHO_REJECTED')
    return NextResponse.json({ error: 'echo' }, { status: 400 })
  }

  const verified = typeof token === 'string' ? verifyDeviceToken(token, secret) : null
  if (!verified) {
    // No breadcrumb: this branch is reachable without any credential.
    console.log('[transaction] UNAUTHORIZED', JSON.stringify(tokenShape(token)))
    return refuse(db, 401, 'unauthorized', notifyOf(
      'לא נרשם: החיבור לחשבון אינו תקף',
      'צריך להעתיק קוד חיבור חדש מהעמוד app.orimipuy.com/connect ולהדביק אותו בקיצור.',
    ), null)
  }
  const { uid, version } = verified

  // Revoked by the advisor (typically a lost/stolen phone). The HMAC is valid,
  // so this is a deliberate cut-off rather than a broken paste — say so, and
  // point at the fix, exactly like the other refusals on this route.
  if (await isDeviceTokenRevoked(uid, version)) {
    return refuse(db, 401, 'token revoked', notifyOf(
      'לא נרשם: החיבור בוטל',
      'החיבור של המכשיר הזה בוטל. צריך להעתיק קוד חיבור חדש מהעמוד app.orimipuy.com/connect.',
    ), null)
  }

  // The device token is a stateless HMAC with no expiry, so a deleted account's
  // phone would keep pushing charges forever — creating inbox documents that no
  // one can ever read or delete (there is no auth user left to match the rule).
  if (await isAccountDeleted(uid)) {
    // No breadcrumb: writing one would re-create documents carrying a deleted
    // account's uid on every tap — the exact residue the tombstone exists to
    // prevent (see lib/deletionTombstone.ts).
    return refuse(db, DELETED_ACCOUNT_RESPONSE.status, DELETED_ACCOUNT_RESPONSE.body.error, notifyOf(
      'לא נרשם: החשבון נמחק',
      'אפשר למחוק את הקיצור והאוטומציה מהמכשיר.',
    ), null)
  }

  if (typeof merchant !== 'string' || !merchant.trim() || merchant.length > MAX_MERCHANT) {
    // Wording note: a MANUAL run of the shortcut always lands here (no live
    // transaction behind it), and that run is a mandatory setup step — so this
    // text must not order a correct install to go "fix" a healthy automation.
    return refuse(db, 400, 'bad merchant', notifyOf(
      'לא נרשם: לא התקבלו פרטי הקנייה',
      'בהרצה ידנית לבדיקה זה תקין. אם זה קרה בתשלום אמיתי, צריך לתקן את פעולת המלל באוטומציית הארנק.',
    ), uid, {
      merchantType: typeof merchant,
      merchantLen: typeof merchant === 'string' ? merchant.length : 0,
    })
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

  // Reject the issuer's own notifications before anything is recorded — see
  // ISSUER_NAMES. Refusing (rather than dropping) keeps the client informed and
  // matches every other rejection here: nothing vanishes silently.
  if (isIssuerOnlyMerchant(cleanMerchant)) {
    return refuse(db, 400, 'issuer notification', notifyOf(
      'לא נרשם: זו הודעה מחברת האשראי, לא קנייה',
      'הודעות על חיוב חודשי, מסגרת או מצב חשבון אינן קנייה בבית עסק ולכן אינן נרשמות. אם באמת קנית עכשיו — אפשר לרשום ידנית באפליקציה.',
    ), uid, { merchantLen: cleanMerchant.length })
  }

  // Which currency this charge is denominated in.
  //
  // Charges made abroad used to be recorded at face value — a £45 purchase
  // landed as ₪45, because every parser threw the symbol away and kept the
  // digits. An explicit `currency` field (sent by the Android tracker from
  // 3.16, and by anything else that wants to be unambiguous) always wins;
  // failing that we read it off the text, since a currency-formatted iOS
  // amount ("£45.00") carries it inline. No currency stated anywhere = ILS,
  // which is exactly the behaviour every existing client already gets.
  const statedCurrency = normalizeCurrency(currency)
  let curr: CurrencyCode = statedCurrency
    ?? (typeof amount === 'string' ? detectCurrency(stripInvisible(amount)) : null)
    ?? 'ILS'

  // Echo/loop guard: a miswired iOS Shortcut can call ITSELF and feed our own
  // notification text back as the "merchant" ("נרשם: נרשם: … קוטלג ל…"),
  // creating an infinite capture loop that only died on MAX_MERCHANT (seen in
  // the field: one ₪44 tap → a recursive notification flood + junk expense
  // rows). A merchant that carries our notify signature is never a real
  // business — reject it, which also kills the loop on its first round trip
  // (no notify in the response → the shortcut's dictionary step stops the run).
  // (The echo check itself now runs BEFORE authentication — see OUR_OWN_TEXT
  // near the top of the file — so a looping shortcut with a dead token dies on
  // its first round trip too. Kept here only as the record of why it exists.)

  // iPhone Shortcut fallback: a hand-built shared Shortcut can't extract the
  // Merchant/Amount properties from the Apple Pay transaction (the editor
  // offers no "transaction" type), so it sends the WHOLE transaction as text
  // in `merchant` with no amount. Pull the first money-looking number out and
  // treat the rest as the merchant name.
  if (!Number.isFinite(amt) || amt <= 0) {
    const ext = extractMoney(cleanMerchant)
    if (ext) {
      amt = ext.amount
      // An explicit field still outranks whatever the free text looks like.
      if (!statedCurrency) curr = ext.currency
      cleanMerchant = merchantFromRaw(cleanMerchant, ext.matched)
    }
  }

  if (!Number.isFinite(amt) || amt <= 0) {
    return refuse(db, 400, 'bad amount', notifyOf(
      'לא נרשם: לא זוהה סכום בקנייה',
      'הקנייה הגיעה בלי סכום קריא. אפשר לרשום אותה ידנית באפליקציה.',
    ), uid, { merchantLen: cleanMerchant.length })
  }

  // Foreign charge → shekels. Budgets, category totals and the monthly tabs are
  // all ILS-only, so the conversion happens once, here, and the original is
  // stored beside it — for display, and for reconciling against the card
  // statement later (the issuer's own rate differs and adds a fee, so this is
  // always an estimate and the UI says so with "~").
  //
  // A charge we cannot price is NOT dropped: we keep the number as-is rather
  // than lose the capture. Under-reporting one charge beats silently missing it.
  let foreignAmount:   number | null = null
  let foreignCurrency: Foreign | null = null
  let fxRate:          number | null = null
  if (curr !== 'ILS') {
    const { rate } = await getIlsRate(db, curr)
    const ils = toIls(amt, rate)
    if (ils !== null) {
      foreignAmount   = Math.round(amt * 100) / 100
      foreignCurrency = curr
      fxRate          = rate
      amt             = ils
    }
  }

  if (amt > MAX_AMOUNT) {
    return refuse(db, 400, 'bad amount', notifyOf(
      'לא נרשם: לא זוהה סכום בקנייה',
      'הקנייה הגיעה בלי סכום קריא. אפשר לרשום אותה ידנית באפליקציה.',
    ), uid, { merchantLen: cleanMerchant.length })
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
      // An honest notify for the swallowed write: the FIRST capture was
      // recorded, this one was NOT. buildNotify's "נרשם" title here would
      // confirm an action that never happened — and when the burst is really
      // two identical genuine payments (two bus tickets, a bill split into
      // two equal transfers), the user must know to add the second by hand.
      const nis = '₪' + Math.round(amt).toLocaleString('he-IL')
      const title = `כבר נרשם לפני רגע: ${cleanMerchant} · ${nis}`
      const body = 'זיהינו חיוב כפול מהארנק, ולכן לא נרשם שוב. אם היו באמת שתי קניות זהות, אפשר להוסיף את השנייה ידנית באפליקציה.'
      // text = title+body in ONE field — the iOS Shortcut shows ONLY
      // notify.text, and the "add the second one by hand" instruction is the
      // whole point of this notify.
      const notify = { title, body, text: `${title}\n${body}`, warn: false }
      return NextResponse.json({ ok: true, duplicate: true, category, notify })
    }
  } catch { /* guard is best-effort — never blocks a capture */ }

  let category: string
  let aiResolved: string | null = null   // set only when the AI actually named a merchant
  if (typeof catOverride === 'string' && ALL_CATEGORIES.includes(catOverride)) {
    category = catOverride
  } else if (isTransfer) {
    category = 'ביט ללא מעקב'
  } else {
    const learnedDB = await loadSharedLearned(db)
    category = categorize(cleanMerchant, learnedDB)
    if (category === 'שונות') {
      // This is an AI call too, on a route authenticated by a never-expiring
      // device token — a miswired automation loop (which has happened here
      // before) could otherwise run unmetered. Blocked = keep 'שונות'; the
      // charge is still captured, because that is this route's contract.
      const budget = await checkAiBudget()
      const quota = budget.stopped
        ? { allowed: false }
        : await checkAiQuota({ uid, route: 'categorize-one' })
      if (quota.allowed) {
        const ai = await aiCategorizeOne(cleanMerchant)
        if (ai) {
          category = ai
          // Queue for the review funnel — but log it AFTER the capture below,
          // never before: this is telemetry, and the charge must land even if
          // the suggestion write is slow.
          aiResolved = ai
        }
      } else {
        console.log(`[transaction] ai categorize skipped (quota) uid=${uid}`)
      }
    }
  }

  await inboxRef.collection('items').add({
    merchant:  cleanMerchant,
    amount:    roundedAmt,
    date:      dateStr,
    category,
    ref:       refStr,
    createdAt: FieldValue.serverTimestamp(),
    // Foreign charge: keep what was actually paid, so the expenses tab can show
    // "₪212 (£45)" and a later reconciliation against the card statement has the
    // original to match on. Omitted entirely for shekel charges, so the common
    // case writes exactly the same document it always has.
    ...(foreignCurrency ? { foreignAmount, foreignCurrency, fxRate } : {}),
    // Which rail carried the money. `isTransfer` is already decided above (it
    // picks the category); this only REMEMBERS it. The month needs it later,
    // because a Bit transfer reaches the credit report as one opaque "ביט" line
    // while the client is encouraged to re-file the capture under the real
    // category it belongs to — and once the category is changed, nothing else in
    // the data still says this money travelled through Bit. Same conditional
    // spread as the foreign fields above: never an explicit undefined.
    ...(isTransfer ? { rail: 'bit' } : {}),
  })
  // Fingerprint for the duplicate-fire guard above (best-effort).
  await inboxRef
    .set({ last: { m: cleanMerchant, a: roundedAmt, at: Date.now(), cat: category } }, { merge: true })
    .catch(() => { /* guard metadata only */ })

  // Review funnel: a merchant BUSINESS_DB didn't know, whose AI answer is worth
  // reviewing and possibly promoting. Runs in after() for the same reason the
  // error breadcrumbs do — it is telemetry, and Firestore's retry budget is 10
  // minutes, so awaiting it would slow the capture exactly during the outage or
  // throttle when this route must stay fast. (after() also keeps Vercel from
  // freezing it, which a bare fire-and-forget would risk.)
  if (aiResolved) {
    const resolved = aiResolved
    after(() => logAiSuggestion(db, cleanMerchant, resolved))
  }

  // uid + bucket only — no merchant/amount detail logged.
  console.log(`[transaction] uid=${uid} cat=${category}`)

  // Budget-aware confirmation for the phone app to show as a LOCAL notification
  // (no FCM). Best-effort — ingest already succeeded; never fails the request.
  // NOTE: `category` must stay the FIRST "category" key in the JSON — old APKs
  // extract it by scanning for the first occurrence.
  const notify = await buildNotify(db, uid, category, amt, cleanMerchant, dateStr.slice(0, 7),
    foreignCurrency ? { amount: foreignAmount!, currency: foreignCurrency } : null)

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
  foreign?: { amount: number; currency: Foreign } | null,
): Promise<{ title: string; body: string; text: string; warn: boolean }> {
  const nis = (n: number) => '₪' + Math.round(n).toLocaleString('he-IL')
  // A charge made abroad shows both figures, with "~" on the shekel one: the
  // card issuer converts at its own rate and adds a fee, so our number will not
  // match the statement to the agora and must not pretend to.
  const title = foreign
    ? `נרשם: ${merchant} · ~${nis(amount)} (${formatMoney(foreign.amount, foreign.currency)})`
    : `נרשם: ${merchant} · ${nis(amount)}`
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

/**
 * The merchant name left over once the money has been removed from a raw
 * transaction text. The shared iOS Shortcut cannot read the Apple Pay
 * transaction's Merchant/Amount properties separately, so it sends the WHOLE
 * transaction as one string in `merchant`; extractMoney() takes the amount out
 * and this turns the remainder into a business name.
 *
 * `matched` is the span extractMoney() consumed — the number together with its
 * currency symbol — so "£45.00 Tesco" leaves "Tesco", not "£ Tesco".
 */
function merchantFromRaw(raw: string, matched: string): string {
  const merchant = raw
    .replace(matched, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—·,.:;]+|[\s\-–—·,.:;]+$/g, '')
    .trim()
    .slice(0, MAX_MERCHANT)
  return merchant || 'Apple Pay'
}

// Reads the shared merchant→category corrections (admin SDK) so a fix made once
// in the expenses/credit/import tabs auto-applies to future ingested charges.
// Payment-rail keys are dropped at READ time, mirroring creditStore's
// mergedLearnedDB: a rail carries a different payee on every charge, so a rail
// entry that ever slipped into the pool (the 2026-07 Bit incident) must not
// categorize ingested charges — this was the one read path that didn't filter.
async function loadSharedLearned(db: Firestore): Promise<Record<string, string>> {
  try {
    const snap = await db.collection('shared').doc('learnedDB').get()
    const data = snap.exists ? snap.data() : null
    const raw = data && typeof data.db === 'object' && data.db
      ? (data.db as Record<string, string>)
      : {}
    const clean: Record<string, string> = {}
    for (const [key, cat] of Object.entries(raw)) {
      if (!isPaymentRailKey(key)) clean[key] = cat
    }
    return clean
  } catch {
    return {}
  }
}
