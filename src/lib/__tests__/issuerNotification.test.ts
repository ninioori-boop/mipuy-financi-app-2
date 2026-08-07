import { describe, it, expect } from 'vitest'
import { isIssuerOnlyMerchant } from '@/app/api/transaction/route'
import { BUSINESS_DB } from '@/lib/businessDB'

// Live incident 2026-08-07: two clients who had bought nothing got expenses of
// ₪1,037.80 and ₪10 with merchant "Max" — the issuer's own app notifying about
// a statement, read by the listener as a purchase. BUSINESS_DB maps "max" to
// עמלות בנק ואשראי (right for a real card fee), so they landed as fee expenses
// and skewed the budget and safe-to-spend of people who had spent nothing.

describe('isIssuerOnlyMerchant — rejects the issuer talking about itself', () => {
  it.each([
    'Max', 'max', 'MAX', 'מקס', ' Max ',
    'Visa', 'ויזה', 'ישראכרט', 'כאל', 'לאומי קארד', 'American Express', 'amex',
  ])('rejects %s', m => {
    expect(isIssuerOnlyMerchant(m)).toBe(true)
  })

  it('ignores punctuation and doubled spaces the listener may add', () => {
    expect(isIssuerOnlyMerchant('"מקס"')).toBe(true)
    expect(isIssuerOnlyMerchant('American  Express')).toBe(true)
  })
})

// This is the half that matters. A substring rule would have been simpler and
// would have silently swallowed every one of these.
describe('isIssuerOnlyMerchant — never touches a real merchant', () => {
  it.each([
    'מקס ברנר',              // restaurant chain, in BUSINESS_DB
    'מקס סטוק',              // homeware chain, in BUSINESS_DB
    'Ampi Max Rishin Ltd',   // a genuine ₪50 capture, 2026-07-29
    'יפה מקסימוב',           // in BUSINESS_DB
    'המקסיקני',              // in BUSINESS_DB
    'מקס בייבי',             // in BUSINESS_DB
    'Maxim',
    'Visa Center',
    'כאלה וכאלה',
  ])('keeps %s', m => {
    expect(isIssuerOnlyMerchant(m)).toBe(false)
  })

  // The strongest form of the same guarantee: sweep the whole merchant
  // database. Anything already known as a real business must survive capture.
  it('rejects nothing that BUSINESS_DB knows as a real business', () => {
    const swallowed = Object.keys(BUSINESS_DB).filter(name =>
      isIssuerOnlyMerchant(name) && BUSINESS_DB[name] !== 'עמלות בנק ואשראי')
    expect(
      swallowed,
      `these real merchants would stop being captured: ${swallowed.join(', ')}`,
    ).toEqual([])
  })
})
