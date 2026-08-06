// Split out of categorize.ts: this function has zero dependency on BUSINESS_DB,
// but living in the same module as it meant every caller who only needed string
// normalization (creditStore/mappingStore/monthlyStore — global stores mounted
// on every route) pulled in the full ~193KB BUSINESS_DB as a bundling side effect.
export function normalizeForLookup(desc: string): string {
  if (!desc) return ''
  let s = desc.toLowerCase().trim()

  // Fold Hebrew punctuation to ASCII and drop cantillation/niqqud FIRST, so
  // every rule below (and every DB key comparison) sees one canonical form:
  //  • gershayim ״ (U+05F4) → "   — בע״מ and ת״א arrive in both spellings
  //  • geresh ׳ (U+05F3) → '
  //  • maqaf ־ / paseq / sof-pasuq are PUNCTUATION between words → space
  //    (deleting them would glue "ביט־כהן" into "ביטכהן", which slips
  //    past the payment-rail detector)
  //  • the remaining niqqud/cantillation marks → removed; a merchant name
  //    that arrives with vowel marks ("שׁוּפֶּרְסָל") failed every lookup.
  s = s.replace(/[״]/g, '"').replace(/[׳]/g, "'").replace(/[\u05BE\u05C0\u05C3]/g, ' ').replace(/[\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4-\u05C7]/g, '')

  // Strip legal entity suffixes
  s = s.replace(/\s+בע["'.]?מ\.?/g, '')
  s = s.replace(/\s+ב\.מ\./g, '')
  s = s.replace(/\s+בעמ\b/g, '')
  s = s.replace(/\s+בע\s+מ\b/g, '')
  s = s.replace(/\s+\bltd\.?\b/gi, '')
  s = s.replace(/\s+\bllc\.?\b/gi, '')
  s = s.replace(/\s+\binc\.?\b/gi, '')

  // NO city stripping (removed 2026-08-06). It looked helpful but only hurt:
  // matching is by SUBSTRING, so the key "ארומה" already matches
  // "ארומה תל אביב" without any stripping — while stripping "ירושלים" out of
  // "מאפיית ירושלים" (the city IS the brand) produced the learned key
  // "מאפיית", a 6-char wildcard that hijacked every bakery for every account.
  // Keys learned from here on keep the full merchant text.

  // Strip branch indicators and trailing codes
  s = s.replace(/\s*[-–]\s*סניף\s*[א-׺\w]*/g, '')
  s = s.replace(/\s*סניף\s+\d+/g, '')
  s = s.replace(/\s*[-–]\s*branch\s*\w*/gi, '')
  s = s.replace(/\s*[-–]\s*\d+\s*$/g, '')

  return s.replace(/\s{2,}/g, ' ').trim()
}
