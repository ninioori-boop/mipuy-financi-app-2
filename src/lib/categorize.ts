import { BUSINESS_DB } from './businessDB'
import { normalizeForLookup } from './normalizeForLookup'
import { railDefaultCategory } from './learnedSharing'

// Re-exported for callers that already need categorize() too (no extra bundle
// cost there). Callers who need ONLY normalizeForLookup should import it from
// './normalizeForLookup' directly — that's what actually keeps BUSINESS_DB out
// of their bundle; importing this file at all pulls BUSINESS_DB in regardless
// of which named export is used.
export { normalizeForLookup }

function searchDB(entries: [string, string][], query: string): string | null {
  for (const [key, cat] of entries) {
    if (query.includes(key.toLowerCase())) return cat
  }
  return null
}

export function categorize(
  desc: string,
  learnedDB: Record<string, string> = {},
): string {
  if (!desc) return 'שונות'
  const lower = desc.toLowerCase().trim()
  const normalized = normalizeForLookup(desc)

  // Sort by key length descending (longer keys = more specific match)
  const sortByLength = (entries: [string, string][]) =>
    entries.sort((a, b) => b[0].length - a[0].length)

  // 1. Check learnedDB first (user corrections + AI auto-learning)
  const learnedEntries = sortByLength(Object.entries(learnedDB))
  let result = searchDB(learnedEntries, lower)
  if (!result && normalized !== lower) result = searchDB(learnedEntries, normalized)
  if (result) return result

  // 2. Check built-in BUSINESS_DB
  const builtinEntries = sortByLength(Object.entries(BUSINESS_DB))
  result = searchDB(builtinEntries, lower)
  if (!result && normalized !== lower) result = searchDB(builtinEntries, normalized)
  if (result) return result

  // 3. Payment-rail fallback: Hebrew rail variants BUSINESS_DB has no key for
  // ("תשלום בביט", "פייבוקס") must still land on their untracked default —
  // otherwise they fall to שונות and hit the paid AI on EVERY upload, because
  // rail results are deliberately never learned. Placed last so specific
  // matches (e.g. "ביט שומרה" → ביטוח) keep winning.
  const rail = railDefaultCategory(normalized)
  if (rail) return rail

  return 'שונות'
}
