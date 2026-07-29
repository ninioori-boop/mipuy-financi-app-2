// Split out of categorize.ts: this function has zero dependency on BUSINESS_DB,
// but living in the same module as it meant every caller who only needed string
// normalization (creditStore/mappingStore/monthlyStore — global stores mounted
// on every route) pulled in the full ~193KB BUSINESS_DB as a bundling side effect.
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
