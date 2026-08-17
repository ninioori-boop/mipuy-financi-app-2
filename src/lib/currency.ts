/**
 * Foreign-currency detection for captured charges.
 *
 * Until now every captured charge was assumed to be shekels: the amount was
 * pulled out of the notification text as a bare number and the symbol thrown
 * away, so a £45 charge abroad landed as ₪45 (and an Android notification with
 * no ₪ at all was dropped entirely by the app-side parser). This module is the
 * single place that decides WHICH currency a text is talking about; the ILS
 * conversion itself lives in fxRates.ts.
 *
 * Kept dependency-free and pure so it can be unit-tested, and so the identical
 * precedence rules can be mirrored in the Android parser (TransactionParser.kt).
 */

export type CurrencyCode = 'ILS' | 'USD' | 'GBP' | 'EUR'

/** ILS first — see the precedence note on extractMoney(). */
export const SUPPORTED_CURRENCIES: CurrencyCode[] = ['ILS', 'USD', 'GBP', 'EUR']

export const CURRENCY_SYMBOL: Record<CurrencyCode, string> = {
  ILS: '₪',
  USD: '$',
  GBP: '£',
  EUR: '€',
}

/**
 * How each currency can appear next to a number, in the notification texts we
 * actually see: the symbol, the ISO code, and the Hebrew word (Israeli banking
 * apps write "דולר"/"פאונד" in prose). Longer alternatives come first so
 * "שקלים" is not consumed as "שקל" + leftovers.
 *
 * Latin codes carry a word boundary so "USD" cannot match inside a merchant
 * name; Hebrew words deliberately do NOT — in JS (as in Java) \b is defined on
 * ASCII \w, so it never fires between two Hebrew letters and would only break
 * the match.
 */
const CURRENCY_TOKENS: Record<CurrencyCode, string> = {
  ILS: '₪|ש["”״]?ח|\\bILS\\b|\\bNIS\\b|שקלים|שקל',
  USD: '\\$|\\bUSD\\b|דולרים|דולר',
  GBP: '£|\\bGBP\\b|ליש["”״]?ט|שטרלינג|פאונד',
  EUR: '€|\\bEUR\\b|יורו|אירו',
}

/**
 * A stricter token set, for scanning the WHOLE text (see mentionedCurrency)
 * where no digit anchors the match.
 *
 * The permissive set above is only safe because a number must sit next to it.
 * Scanning free text with it would fire on ordinary Hebrew: "שח" matches inside
 * "שחר", "יורו" inside "יורונט", "שקל" inside "משקל". A false hit is expensive
 * in both directions — it either suppresses a real foreign charge, or (worse)
 * multiplies a domestic one by ~4. So Hebrew words are fenced with letter
 * lookarounds, and bare "שח" with no quote mark is not accepted at all.
 *
 * \b is useless for the Hebrew fences (it is defined on ASCII \w and never
 * fires between two Hebrew letters), hence the explicit \p{L} lookarounds —
 * which is also why these patterns need the `u` flag.
 */

// A Hebrew currency word may carry a one-letter preposition glued to its front
// — "בדולר", "לפאונד", "מיורו" all name the currency. Anything longer in front
// means a different word, and the trailing fence stays strict either way, which
// is what keeps "אירוע" out of EUR and "יורונט" out of anything.
const HE_START = '(?:(?<!\\p{L})|(?<=[^\\p{L}][בלמהוכש]))'
const HE_END   = '(?!\\p{L})'
const he = (alts: string) => `${HE_START}(?:${alts})${HE_END}`

const MENTION_TOKENS: Record<CurrencyCode, string> = {
  ILS: `₪|\\bILS\\b|\\bNIS\\b|${he('ש["”״]ח|שקלים|שקל')}`,
  USD: `\\$|\\bUSD\\b|${he('דולרים|דולר')}`,
  GBP: `£|\\bGBP\\b|${he('פאונד|שטרלינג|ליש["”״]ט')}`,
  EUR: `€|\\bEUR\\b|${he('יורו|אירו')}`,
}

// he-IL writes 1,234.56 — comma groups thousands, period is the decimal.
const NUMBER = '[0-9][0-9,]*(?:\\.[0-9]+)?'

/** Symbol before the number ("£45.00", "₪55.21 with Hever") or after it ("45.00 £"). */
function patternsFor(currency: CurrencyCode): RegExp[] {
  const tok = CURRENCY_TOKENS[currency]
  return [
    new RegExp(`(?:${tok})\\s*(${NUMBER})`, 'i'),
    new RegExp(`(${NUMBER})\\s*(?:${tok})`, 'i'),
  ]
}

function toNumber(raw: string): number {
  return parseFloat(raw.replace(/,/g, ''))
}

/**
 * Maps whatever the client sent in a `currency` field to a code we support.
 * Accepts an ISO code, a symbol, or the Hebrew word — the Android app sends a
 * plain ISO code, but being liberal here costs nothing and lets a hand-built
 * iOS Shortcut pass "£" straight through.
 *
 * Returns null for anything unrecognized, which callers treat as "no currency
 * stated" (= ILS), never as an error: an unknown code must not cost the user a
 * captured charge.
 */
export function normalizeCurrency(v: unknown): CurrencyCode | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null
  const upper = s.toUpperCase()
  if ((SUPPORTED_CURRENCIES as string[]).includes(upper)) return upper as CurrencyCode
  for (const cur of SUPPORTED_CURRENCIES) {
    if (new RegExp(`^(?:${CURRENCY_TOKENS[cur]})$`, 'i').test(s)) return cur
  }
  return null
}

/** Which currency a free-text notification is denominated in, or null if none is stated. */
export function detectCurrency(text: string): CurrencyCode | null {
  for (const cur of SUPPORTED_CURRENCIES) {
    if (patternsFor(cur).some(re => re.test(text))) return cur
  }
  return null
}

/**
 * Last-resort currency signal: a foreign currency NAMED anywhere in the text,
 * not necessarily next to the number.
 *
 * This exists because of a real captured charge — a payment in pounds was
 * recorded as shekels. Israeli payment apps write the amount as "עסקה בסך
 * 45.00 ..." and the number carries no symbol at all, so an adjacency-based
 * check finds nothing and the charge silently defaults to ILS.
 *
 * Deliberately conservative, because guessing wrong here multiplies someone's
 * expense by ~4: it fires ONLY when the text mentions exactly one foreign
 * currency and no shekel token at all. Anything ambiguous returns null and the
 * caller keeps ILS.
 */
export function mentionedCurrency(text: string): CurrencyCode | null {
  const mentions = SUPPORTED_CURRENCIES.filter(
    cur => new RegExp(MENTION_TOKENS[cur], 'iu').test(text),
  )
  if (mentions.length !== 1) return null
  return mentions[0] === 'ILS' ? null : mentions[0]
}

/**
 * Pulls the amount AND its currency out of a raw transaction text.
 *
 * Precedence is deliberate:
 *   1. ILS-anchored. A Wallet notification for a foreign charge sometimes shows
 *      BOTH the original and the card's own converted figure ("£45.00 (₪212.50)").
 *      The card's number beats any rate we could look up, so prefer it. This
 *      also makes the change a no-op for every shekel capture that works today.
 *   2. Foreign-anchored — the server converts it (see fxRates.ts).
 *   3. Bare number, assumed ILS — a Hebrew notification with no symbol at all is
 *      a shekel charge. Among the bare numbers, one written with agorot wins:
 *      see pickBareAmount.
 */
export function extractMoney(
  raw: string,
): { amount: number; currency: CurrencyCode; matched: string; index: number } | null {
  for (const currency of SUPPORTED_CURRENCIES) {
    for (const re of patternsFor(currency)) {
      const m = raw.match(re)
      if (!m) continue
      const amount = toNumber(m[1])
      // `matched` spans the number AND its symbol, so a caller building a
      // merchant name from the remainder removes both. `index` says WHERE, so
      // the caller cuts that span and not an identical-looking one earlier in
      // the string — see merchantFromRaw.
      if (Number.isFinite(amount) && amount > 0) {
        return { amount, currency, matched: m[0], index: m.index ?? raw.indexOf(m[0]) }
      }
    }
  }
  const bare = pickBareAmount(raw)
  if (!bare) return null
  // No symbol touches the number — but the sentence may still name the
  // currency ("עסקה בסך 45.00" + "פאונד" elsewhere). See mentionedCurrency().
  return {
    amount: toNumber(bare.text),
    currency: mentionedCurrency(raw) ?? 'ILS',
    matched: bare.text,
    index: bare.index,
  }
}

/**
 * Which bare number in a raw capture is the money.
 *
 * 🔴 A real ₪19.00 charge was recorded as ₪119 on 2026-08-17. The merchant was
 * "Ilans Terminal 1" and the shortcut on that phone put the name BEFORE the
 * amount, so the text arrived as "Ilans Terminal 119.00" — the name's trailing
 * digit fused with the amount. Taking simply the first number also turned
 * "AM:PM 24 45.90" into 24 and "סניף 7 32.50" into 7: any merchant whose name
 * contains a digit corrupted the amount, silently, and overstating spending is
 * the worst direction for that to fail in.
 *
 * A Wallet amount always carries agorot, and a digit inside a business name
 * almost never does. So: prefer the first number written with exactly two
 * decimals; only if there is none fall back to the first number, which is the
 * pre-2026-08-17 behaviour and still correct for the official shortcut (it puts
 * the amount first).
 *
 * ⚠️ Two candidates are refused outright, both found by review before this
 * shipped:
 *   - A number that continues into another dotted group. "17.08.26" matches as
 *     "17.08", so a capture carrying a date ("19 חנות 17.08.26") would have read
 *     as ₪17.08 instead of ₪19. That is a WORSE failure than the ₪119 this fix
 *     was written for: 119 looks obviously wrong, 17.08 looks like a real charge
 *     and nobody double-checks it.
 *   - A candidate that is not a usable amount (0, or unparseable). Without this
 *     the function would commit to it and extractMoney would refuse the whole
 *     capture, where the old code went on to record the next number.
 *
 * What this cannot fix: "Ilans Terminal 119.00", where the digits genuinely
 * merged into one token. No parser recovers that — the shortcut has to put the
 * amount first, which the shipped one does.
 */
function pickBareAmount(raw: string): { text: string; index: number } | null {
  const all = [...raw.matchAll(new RegExp(NUMBER, 'g'))]
    .map(m => ({ text: m[0], index: m.index ?? 0 }))
    .filter(c => toNumber(c.text) > 0)
  if (!all.length) return null

  const isMoneyShaped = (c: { text: string; index: number }) =>
    /\.[0-9]{2}$/.test(c.text)
    // Not the head of a dotted date or time: "17.08" inside "17.08.26".
    && !/^\.[0-9]/.test(raw.slice(c.index + c.text.length))

  return all.find(isMoneyShaped) ?? all[0]
}

/** "£45" / "₪212" — no decimals, matching how the app renders money everywhere else. */
export function formatMoney(amount: number, currency: CurrencyCode): string {
  return CURRENCY_SYMBOL[currency] + Math.round(amount).toLocaleString('he-IL')
}

/**
 * Same, for a currency code read back from storage — where the type system
 * guarantees nothing. An unrecognized code is rendered rather than dropped, so
 * a charge captured by a newer client than this one still reads correctly.
 */
export function formatMoneyLoose(amount: number, code: string): string {
  const cur = normalizeCurrency(code)
  return cur ? formatMoney(amount, cur) : `${Math.round(amount).toLocaleString('he-IL')} ${code}`
}
