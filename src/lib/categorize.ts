import { BUSINESS_DB } from './businessDB'

export function normalizeForLookup(desc: string): string {
  if (!desc) return ''
  let s = desc.toLowerCase().trim()

  // Strip legal entity suffixes
  s = s.replace(/\s+בע["״'.]?מ\.?/g, '')
  s = s.replace(/\s+ב\.מ\./g, '')
  s = s.replace(/\s+בעמ\b/g, '')
  s = s.replace(/\s+בע\s+מ\b/g, '')
  s = s.replace(/\s+\bltd\.?\b/gi, '')
  s = s.replace(/\s+\bllc\.?\b/gi, '')
  s = s.replace(/\s+\binc\.?\b/gi, '')

  // Strip Israeli city names
  const cities = [
    'ראשון לציון', 'ראשל"צ', 'פתח תקווה', 'פ"ת', 'רמת השרון',
    'תל אביב', 'ת"א', 'רמת גן', 'ר"ג', 'באר שבע', 'ב"ש', 'נתניה', 'חיפה',
    'ירושלים', 'אשדוד', 'אשקלון', 'רחובות', 'הרצליה', 'כפר סבא', 'רעננה',
    'הוד השרון', 'רמלה', 'לוד', 'נהריה', 'עכו', 'טבריה', 'אילת', 'מודיעין',
    'בית שמש', 'קריית גת', 'חולון', 'בת ים', 'גבעתיים', 'נס ציונה',
    'קרית שמונה', 'זכרון יעקב', 'כפר יונה',
  ]
  for (const city of cities) {
    const re = new RegExp('[\\s\\-–]*' + city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\-–]*', 'g')
    s = s.replace(re, ' ')
  }

  // Strip branch indicators and trailing codes
  s = s.replace(/\s*[-–]\s*סניף\s*[א-׺\w]*/g, '')
  s = s.replace(/\s*סניף\s+\d+/g, '')
  s = s.replace(/\s*[-–]\s*branch\s*\w*/gi, '')
  s = s.replace(/\s*[-–]\s*\d+\s*$/g, '')

  return s.replace(/\s{2,}/g, ' ').trim()
}

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

  return 'שונות'
}
