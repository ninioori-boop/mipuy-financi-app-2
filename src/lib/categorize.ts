import { BUSINESS_DB } from './businessDB'
import { normalizeForLookup } from './normalizeForLookup'
import { railDefaultCategory } from './learnedSharing'

// Re-exported for callers that already need categorize() too (no extra bundle
// cost there). Callers who need ONLY normalizeForLookup should import it from
// './normalizeForLookup' directly — that's what actually keeps BUSINESS_DB out
// of their bundle; importing this file at all pulls BUSINESS_DB in regardless
// of which named export is used.
export { normalizeForLookup }

// Keys this short match only as a WHOLE WORD. Matching is by substring
// inclusion, which makes a very short key a wildcard over every statement: the
// 2-char key "בר" sat inside העברה / העברת / חברה / חברת, so every Hebrew-worded
// transfer was filed as dining out — and since those rows are payment rails, the
// user's correction applied to one row and was never learned, so it came back on
// every upload. "bit"/"atm" did the same to ORBIT / BITCOIN / ATMOSPHERE.
// Deleting the short keys was the alternative, but it would have cost the real
// matches (פז, גז, יס, דן…); a word boundary keeps those and drops the wildcard.
const SHORT_KEY_MAX = 4

// What counts as "inside a word" for boundary purposes: any letter (Hebrew or
// Latin) or digit. Spaces, punctuation, quotes and string edges are boundaries.
// Note Hebrew has no case and no separate word-char class in JS regex, so \b is
// unusable here — it treats every Hebrew letter as a non-word character.
const WORDISH = /[\p{L}\p{N}]/u

function keyMatches(query: string, key: string): boolean {
  if (key.length > SHORT_KEY_MAX) return query.includes(key)
  // Short key: accept only occurrences flanked by non-word characters.
  let from = 0
  while (from <= query.length) {
    const i = query.indexOf(key, from)
    if (i === -1) return false
    const before = i > 0 ? query[i - 1] : ''
    const after = query[i + key.length] ?? ''
    if ((!before || !WORDISH.test(before)) && (!after || !WORDISH.test(after))) return true
    from = i + 1
  }
  return false
}

function searchDB(entries: [string, string][], query: string): string | null {
  return searchBest(entries, query)?.cat ?? null
}

/**
 * The longest matching key in a length-sorted list, with the key it matched on.
 * The key length is what lets two lists be compared for specificity instead of
 * one source simply outranking the other.
 */
function searchBest(entries: [string, string][], query: string): { key: string; cat: string } | null {
  for (const [key, cat] of entries) {
    if (keyMatches(query, key.toLowerCase())) return { key, cat }
  }
  return null
}

/** Best match across both spellings of the description. */
function bestOf(
  entries: [string, string][], lower: string, normalized: string,
): { key: string; cat: string } | null {
  const a = searchBest(entries, lower)
  const b = normalized !== lower ? searchBest(entries, normalized) : null
  if (!a) return b
  if (!b) return a
  return b.key.length > a.key.length ? b : a
}

// Sort by key length descending (longer keys = more specific match).
const sortByLength = (entries: [string, string][]) =>
  entries.sort((a, b) => b[0].length - a[0].length)

// Hoisted: BUSINESS_DB is a module constant, so entries+sort are computed once
// at import instead of on every categorize() call. A 300-row statement was
// re-sorting 4,000+ entries 300 times. Pure optimization — `sort` is stable, so
// the resolution order is identical.
const BUILTIN_ENTRIES = sortByLength(Object.entries(BUSINESS_DB))

// Exact-match index (lowercased key → category), for the precedence tiers.
const BUILTIN_EXACT = new Map(Object.entries(BUSINESS_DB).map(([k, c]) => [k.toLowerCase(), c]))

export function categorize(
  desc: string,
  learnedDB: Record<string, string> = {},
): string {
  if (!desc) return 'שונות'
  const lower = desc.toLowerCase().trim()
  const normalized = normalizeForLookup(desc)

  // Precedence: EXACT beats substring, and within each specificity tier a
  // learned correction beats the built-in DB. Before the exact tiers existed,
  // any learned SUBSTRING key outranked a curated exact entry — one client's
  // over-broad key (promoted to the shared pool) could hijack a merchant the
  // built-in DB names precisely, for every account at once.

  // 1. Exact learned — a correction for THIS merchant text always wins.
  // typeof guard: direct indexing walks the prototype chain, and a merchant
  // literally named "constructor" would come back as a function.
  const learnedExact = learnedDB[lower] ?? learnedDB[normalized]
  if (typeof learnedExact === 'string') return learnedExact

  // 2. Exact built-in.
  const builtinExact = BUILTIN_EXACT.get(lower) ?? BUILTIN_EXACT.get(normalized)
  if (builtinExact) return builtinExact

  // 3. Substring — the LONGEST matching key wins, whichever list it came from;
  //    a learned key wins only a tie.
  //
  // 🔴 Learned used to outrank the built-in DB outright inside this tier, so a
  // 4-character learned key beat a 10-character curated one. Real case: a
  // learned "מגדל" → ביטוח hijacked the curated "מגדל/טלפון" → השקעות, and
  // every securities purchase through the investment house was filed as an
  // insurance premium — through three deploys that fixed exactly that key.
  // This is the same defect the exact tiers above were added for in 2026-08-06
  // ("one client's over-broad key hijacks a precisely-named merchant"); that
  // round fixed exact-vs-substring and left specificity inside the substring
  // tier untouched. Correction power is intact: a learned key at least as
  // specific as the built-in one still wins.
  const learnedHit = bestOf(sortByLength(Object.entries(learnedDB)), lower, normalized)
  const builtinHit = bestOf(BUILTIN_ENTRIES, lower, normalized)
  if (learnedHit && builtinHit) {
    return builtinHit.key.length > learnedHit.key.length ? builtinHit.cat : learnedHit.cat
  }
  if (learnedHit) return learnedHit.cat
  if (builtinHit) return builtinHit.cat

  // 5. Payment-rail fallback: Hebrew rail variants BUSINESS_DB has no key for
  // ("תשלום בביט", "פייבוקס") must still land on their untracked default —
  // otherwise they fall to שונות and hit the paid AI on EVERY upload, because
  // rail results are deliberately never learned. Placed last so specific
  // matches (e.g. "ביט שומרה" → ביטוח) keep winning.
  const rail = railDefaultCategory(normalized)
  if (rail) return rail

  return 'שונות'
}
