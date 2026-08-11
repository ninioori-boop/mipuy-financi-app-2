/**
 * Catches the email-domain typos that create an account nobody can ever verify.
 *
 * Born from a real client (2026-08-11) who registered `...@gmail.con`. The
 * address is syntactically valid, so the browser's type="email", Firebase Auth
 * and our own form all accepted it — and the verification mail went to a domain
 * that cannot exist. She sat on the verify screen for 90 minutes pressing
 * "send again", because that screen can say "not verified yet" but never
 * "this address is unreachable".
 *
 * Deliberately NARROW: an exact known-typo table plus top-level domains that do
 * not exist at all. No fuzzy edit-distance matching — it would eventually
 * second-guess somebody's real address, and blocking a legitimate sign-up is a
 * worse failure than the typo it prevents. Every entry here is a string that
 * cannot receive mail.
 */

/** Whole domains that are always a mistake, mapped to what was meant. */
const DOMAIN_FIX: Record<string, string> = {
  'gmail.co': 'gmail.com',
  'gmail.cm': 'gmail.com',
  'gmial.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gmaill.com': 'gmail.com',
  'gnail.com': 'gmail.com',
  'gmail.copm': 'gmail.com',
  'hotmial.com': 'hotmail.com',
  'hotmai.com': 'hotmail.com',
  'hotmail.co': 'hotmail.com',
  'yahoo.co': 'yahoo.com',
  'yahho.com': 'yahoo.com',
  'outlok.com': 'outlook.com',
  'icloud.co': 'icloud.com',
}

/**
 * Top-level domains that do not exist, mapped to the one next to them on the
 * keyboard. `.co` is NOT here — it is a real TLD, and `walla.co.il` is a real
 * Israeli address; only the exact table above may touch those.
 */
const DEAD_TLD: Record<string, string> = {
  con: 'com',
  cmo: 'com',
  ocm: 'com',
  comm: 'com',
  vom: 'com',
  xom: 'com',
  cim: 'com',
}

/**
 * The corrected address, or null when nothing is obviously wrong.
 * Null means "no opinion", never "verified good".
 */
export function suggestEmailFix(email: string): string | null {
  const addr = email.trim().toLowerCase()
  const at = addr.lastIndexOf('@')
  if (at < 1 || at === addr.length - 1) return null

  const local = addr.slice(0, at)
  const domain = addr.slice(at + 1)
  if (local.includes('@')) return null

  const exact = DOMAIN_FIX[domain]
  if (exact) return `${local}@${exact}`

  const dot = domain.lastIndexOf('.')
  if (dot > 0) {
    const fixedTld = DEAD_TLD[domain.slice(dot + 1)]
    if (fixedTld) return `${local}@${domain.slice(0, dot)}.${fixedTld}`
  }

  return null
}
