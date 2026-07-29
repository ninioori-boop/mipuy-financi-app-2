/**
 * Which learned merchant→category corrections may enter the SHARED pool.
 *
 * Background (2026-07-29, the Bit incident): every manual correction used to be
 * written straight to shared/learnedDB, where it applies to EVERY account and
 * outranks the curated BUSINESS_DB. That let one client's "bit → אוכל בחוץ"
 * define Bit for everyone — but Bit/PayBox/PayPal are payment RAILS, not
 * merchants: each person pays someone different through them, so no global
 * mapping can be right. Worse, a 4-char shared key like "play" (matching is by
 * substring inclusion) hijacked Google Play / PlayStation for every client.
 *
 * A blocked entry still saves to the account's own learnedDB — the user's
 * correction always works for them; it just doesn't get to redefine anyone else.
 */

/**
 * TRUE payment rails: the descriptor names the pipe, never the payee. A Bit
 * transfer can be rent, lunch or a hobby — even within ONE account — so a
 * category correction on these must be one-time (that row only) and never
 * learned, not even locally. (Ori's call, 2026-07-29: "גם לאדם עצמו — ביט
 * לאוכל וביט לתחביב".) PayPal is deliberately NOT here: its descriptors carry
 * the actual merchant ("paypal *spotify"), so per-descriptor learning is fine.
 */
const RAIL_WORDS = new Set([
  'bit', 'ביט',
  'paybox', 'פייבוקס',
  'מזומן', 'מזומנים', 'cash', 'כספומט', 'atm',
])

/** Which "untracked" default a rail resolves to when nothing else matched. */
const RAIL_CATEGORY: Record<string, string> = {
  bit: 'ביט ללא מעקב', 'ביט': 'ביט ללא מעקב',
  paybox: 'ביט ללא מעקב', 'פייבוקס': 'ביט ללא מעקב',
  'מזומן': 'מזומן ללא מעקב', 'מזומנים': 'מזומן ללא מעקב',
  cash: 'מזומן ללא מעקב', 'כספומט': 'מזומן ללא מעקב', atm: 'מזומן ללא מעקב',
}

/**
 * Superset for the SHARED pool: rails plus transfer verbs and PayPal, matched
 * as WHOLE WORDS of the normalized key. Whole-word (not substring) so 'ביט'
 * blocks "העברה ב ביט" but not "ביטוח הראל" — insurance merchants are exactly
 * the kind of correction the shared pool SHOULD keep receiving.
 */
const NEVER_SHARE_WORDS = new Set([
  ...RAIL_WORDS,
  'paypal', 'פייפאל',
  'העברה', 'העברת',   // construct form: "העברת כסף בביט"
  'transfer',
  'משיכה', 'משיכת',
])

/** Hebrew clitic prefixes that glue onto the next word: בביט, לביט, ומביט… */
const HEBREW_PREFIXES = new Set(['ב', 'ל', 'מ', 'ו', 'ה', 'כ', 'ש'])

/**
 * Categories that are personal bookkeeping statements ("I don't track this"),
 * not facts about a merchant. Sharing them would teach everyone that some
 * merchant is untracked — meaningless outside the account that said it.
 */
const NEVER_SHARE_CATEGORIES = new Set(['ביט ללא מעקב', 'מזומן ללא מעקב'])

/**
 * Categorize() matches by substring inclusion, so a very short shared key is a
 * wildcard over everyone's statements ("play" matched Google Play, PlayStation,
 * Replay…). Short keys stay account-local, where the blast radius is one user.
 */
const MIN_SHARED_KEY_LENGTH = 5

/**
 * Split a normalized key into words. Quote marks are stripped from within words
 * (a bank rendering `"ביט"` must still expose the token ביט), and each word also
 * yields its de-prefixed forms — Hebrew glues ב/ל/מ/ו… onto the next word, so
 * "תשלום בביט" contains the rail word one clitic away, not as a bare token.
 */
function wordForms(key: string): string[] {
  const out: string[] = []
  for (const raw of key.split(/[^a-z0-9א-ת'"׳״]+/i)) {
    let w = raw.replace(/['"׳״]/g, '')
    if (!w) continue
    out.push(w)
    // Peel up to two leading clitics: בביט → ביט, ובביט → בביט → ביט.
    for (let i = 0; i < 2 && w.length > 2 && HEBREW_PREFIXES.has(w[0]); i++) {
      w = w.slice(1)
      out.push(w)
    }
  }
  return out
}

/**
 * NARROW word-form extraction for rail detection. Deliberately stricter than
 * the sharing matcher above, because a false positive here costs real user
 * behavior (edits stop bulk-applying, learned fixes are ignored), not just a
 * skipped share:
 *  - clitic peel is only ב/ל/מ/ו — NOT ש (שביט is a common Israeli surname,
 *    ש+ביט essentially never appears in merchant text) and NOT ה/כ.
 *  - a word with a trailing geresh and no opening quote is a Hebrew
 *    ABBREVIATION (ביט׳ = ביטוח), never the rail; wrapped quotes ("ביט") are
 *    stripped and the inner word counts.
 */
const RAIL_PREFIXES = new Set(['ב', 'ל', 'מ', 'ו'])
function railWordForms(key: string): string[] {
  const out: string[] = []
  for (const raw of key.split(/[^a-z0-9א-ת'"׳״]+/i)) {
    if (!raw) continue
    if (/['׳]$/.test(raw) && !/^['"׳״]/.test(raw)) continue // ביט׳ = abbreviation
    let w = raw.replace(/['"׳״]/g, '')
    if (!w) continue
    out.push(w)
    for (let i = 0; i < 2 && w.length > 2 && RAIL_PREFIXES.has(w[0]); i++) {
      w = w.slice(1)
      out.push(w)
    }
  }
  return out
}

/**
 * Is this normalized descriptor a payment rail ("BIT", "העברה בביט",
 * "משיכת מזומן")? Rails get one-time category edits: the change applies to the
 * single row being edited, nothing is learned (locally or shared), and any
 * rail entry already sitting in a learned dict is ignored at read time so the
 * curated ביט/מזומן ללא מעקב defaults always win.
 */
export function isPaymentRailKey(key: string): boolean {
  const k = (key || '').trim().toLowerCase()
  return railWordForms(k).some(w => RAIL_WORDS.has(w))
}

/**
 * The rail's "untracked" default, or null when the key is not a rail. Used by
 * categorize() as the fallback when NOTHING matched — without it, Hebrew rail
 * variants missing from BUSINESS_DB ("תשלום בביט", "פייבוקס") would fall to
 * שונות and get re-sent to the paid AI on every upload, forever, since rail
 * results are deliberately never remembered.
 */
export function railDefaultCategory(key: string): string | null {
  const k = (key || '').trim().toLowerCase()
  for (const w of railWordForms(k)) {
    const cat = RAIL_CATEGORY[w]
    if (cat) return cat
  }
  return null
}

/**
 * May this correction be written to shared/learnedDB?
 * Both write paths (creditStore.learn in the browser, /api/learn from the
 * Android tracker) must consult this — a guard on only one is no guard.
 */
export function shareableLearnedEntry(key: string, category: string): boolean {
  const k = (key || '').trim().toLowerCase()
  if (k.length < MIN_SHARED_KEY_LENGTH) return false
  if (NEVER_SHARE_CATEGORIES.has(category)) return false
  if (wordForms(k).some(w => NEVER_SHARE_WORDS.has(w))) return false
  return true
}
