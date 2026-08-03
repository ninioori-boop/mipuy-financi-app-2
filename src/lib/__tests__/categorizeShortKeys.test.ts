import { describe, it, expect } from 'vitest'
import { categorize } from '@/lib/categorize'

// BUSINESS_DB is matched by SUBSTRING inclusion, which turns a very short key
// into a wildcard over everyone's statements. The worst offender was the 2-char
// key "בר" → אוכל בחוץ ובילויים: it matches inside העברה / העברת / חברה / חברת,
// so every Hebrew-worded transfer in every client's statement was filed as
// dining out — and because those rows ARE payment rails, the user's correction
// applies to that one row only and is never learned, so the same wrong category
// came back on every upload, forever.
//
// The rule these tests lock in: a key of 4 characters or fewer must match only
// as a WHOLE WORD. Longer keys keep their substring behavior (that is what lets
// "שופרסל דיל" match "שופרסל").
describe('categorize — short keys match whole words only', () => {
  it('"בר" no longer swallows Hebrew transfer and company words', () => {
    expect(categorize('העברה בנקאית')).not.toBe('אוכל בחוץ ובילויים')
    expect(categorize('העברת משכורת')).not.toBe('אוכל בחוץ ובילויים')
    expect(categorize('חברה לניהול נכסים')).not.toBe('אוכל בחוץ ובילויים')
    expect(categorize('חברת חשמל')).not.toBe('אוכל בחוץ ובילויים')
  })

  it('Latin short keys no longer swallow longer English words', () => {
    expect(categorize('BITCOIN EXCHANGE')).not.toBe('ביט ללא מעקב')
    expect(categorize('ORBIT TECHNOLOGIES LTD')).not.toBe('ביט ללא מעקב')
    expect(categorize('ATMOSPHERE BAR')).not.toBe('מזומן ללא מעקב')
    expect(categorize('FACEBOOK ADS')).not.toBe('כלי בית')
    expect(categorize('APPLE MACBOOK')).not.toBe('תספורת וקוסמטיקה')
    expect(categorize('COSTA COFFEE')).not.toBe('ביגוד והנעלה')
  })

  it('short Hebrew keys no longer swallow longer Hebrew words', () => {
    expect(categorize('ספרי לימוד')).not.toBe('תספורת וקוסמטיקה')   // was via "ספר"
    expect(categorize('תשלום בטלפון')).not.toBe('ביטוח לאומי')       // was via "בטל"
  })

  // The other half of the contract: the short keys still do their job when the
  // descriptor really is that merchant. Deleting them was the alternative fix
  // and it would have cost these matches.
  it('short keys still match when they stand as their own word', () => {
    expect(categorize('תחנת פז')).toBe('דלק וחניה')
    expect(categorize('בר תל אביב')).toBe('אוכל בחוץ ובילויים')
    expect(categorize('חברת גז')).toBe('הוצאות בית')
  })

  it('a longer key still beats a short one', () => {
    // "פזגז" (household gas) must not be read as the fuel station "פז".
    expect(categorize('פזגז')).toBe('הוצאות בית')
  })
})
