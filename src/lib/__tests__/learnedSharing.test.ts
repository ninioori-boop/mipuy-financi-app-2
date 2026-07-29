import { describe, it, expect } from 'vitest'
import { shareableLearnedEntry, isPaymentRailKey, railDefaultCategory } from '@/lib/learnedSharing'

// The Bit incident (2026-07-29): payment rails and wildcard-short keys must
// never reach shared/learnedDB, where they redefine merchants for EVERY account.
describe('shareableLearnedEntry', () => {
  it('blocks payment rails as whole words, in both scripts', () => {
    expect(shareableLearnedEntry('bit', 'מזון לבית')).toBe(false)
    expect(shareableLearnedEntry('העברה ב bit בנה"פ', 'שכר דירה')).toBe(false)
    expect(shareableLearnedEntry('העברה ב ביט', 'מתנות')).toBe(false)
    expect(shareableLearnedEntry('paypal *innerdragon', 'תחביבים')).toBe(false)
    expect(shareableLearnedEntry('פייבוקס תשלום', 'חינוך וקייטנות')).toBe(false)
    expect(shareableLearnedEntry('משיכת מזומן בנק', 'שונות')).toBe(false)
  })

  it('blocks Hebrew clitic-prefixed and construct forms (grill finding: agglutination)', () => {
    expect(shareableLearnedEntry('תשלום בביט', 'שכר דירה')).toBe(false)
    expect(shareableLearnedEntry('העברת כסף בביט', 'מתנות')).toBe(false)
    expect(shareableLearnedEntry('בפייבוקס קבוצה', 'חינוך וקייטנות')).toBe(false)
    expect(shareableLearnedEntry('"ביט" תשלום', 'שונות')).toBe(false)
    expect(shareableLearnedEntry('משיכת כספים סניף', 'שונות')).toBe(false)
  })

  it('does NOT block merchants that merely contain a rail substring', () => {
    // ביטוח contains ביט — insurance corrections are exactly what the shared
    // pool exists for; whole-word matching must let them through.
    expect(shareableLearnedEntry('ביטוח הראל בריאות', 'ביטוח')).toBe(true)
    expect(shareableLearnedEntry('bitwarden premium', 'מנויים')).toBe(true)
    expect(shareableLearnedEntry('יינות ביתן סניף 12', 'מזון לבית')).toBe(true)
  })

  it('blocks personal "untracked" categories regardless of key', () => {
    expect(shareableLearnedEntry('חנות כלשהי ארוכה מספיק', 'ביט ללא מעקב')).toBe(false)
    expect(shareableLearnedEntry('חנות כלשהי ארוכה מספיק', 'מזומן ללא מעקב')).toBe(false)
  })

  it('blocks wildcard-short keys (substring matching makes them dangerous)', () => {
    expect(shareableLearnedEntry('play', 'אוכל בחוץ ובילויים')).toBe(false)
    expect(shareableLearnedEntry('זארה', 'ביגוד והנעלה')).toBe(false)
    expect(shareableLearnedEntry('', 'שונות')).toBe(false)
  })

  it('shares ordinary merchant corrections', () => {
    expect(shareableLearnedEntry('שופרסל דיל רמת גן', 'מזון לבית')).toBe(true)
    expect(shareableLearnedEntry('wolt tel aviv', 'אוכל בחוץ ובילויים')).toBe(true)
  })
})

// The NARROW matcher behind one-time edits / read-filtering / the categorize
// fallback. A false positive here costs real user behavior, so the grill's
// counter-examples are pinned as tests.
describe('isPaymentRailKey (narrow)', () => {
  it('recognizes real rail descriptors', () => {
    expect(isPaymentRailKey('bit')).toBe(true)
    expect(isPaymentRailKey('העברה ב bit בנה"פ')).toBe(true)
    expect(isPaymentRailKey('תשלום בביט')).toBe(true)
    expect(isPaymentRailKey('פייבוקס')).toBe(true)
    expect(isPaymentRailKey('משיכת מזומנים')).toBe(true)
    expect(isPaymentRailKey('"ביט" תשלום')).toBe(true)   // wrapped quotes count
  })

  it('does NOT flag look-alikes (grill counter-examples)', () => {
    expect(isPaymentRailKey('מוסך שביט')).toBe(false)      // שביט = surname; ש not peeled
    expect(isPaymentRailKey('דפוס שביט')).toBe(false)
    expect(isPaymentRailKey("מגדל ביט' רכב")).toBe(false)  // ביט' = ביטוח abbreviation
    expect(isPaymentRailKey('ביטוח הראל')).toBe(false)
    expect(isPaymentRailKey('ביטול עסקה')).toBe(false)     // whole-word, not substring
    expect(isPaymentRailKey('bitwarden premium')).toBe(false)
  })
})

describe('railDefaultCategory', () => {
  it('maps rails to their untracked default', () => {
    expect(railDefaultCategory('תשלום בביט')).toBe('ביט ללא מעקב')
    expect(railDefaultCategory('פייבוקס')).toBe('ביט ללא מעקב')
    expect(railDefaultCategory('הפקדת מזומן')).toBe('מזומן ללא מעקב')
    expect(railDefaultCategory('דפוס שביט')).toBe(null)
    expect(railDefaultCategory('שופרסל דיל')).toBe(null)
  })
})
