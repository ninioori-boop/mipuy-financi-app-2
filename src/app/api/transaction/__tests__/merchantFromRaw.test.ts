import { describe, it, expect, vi } from 'vitest'
import { extractMoney } from '@/lib/currency'

/**
 * Splitting one raw capture string into an amount and a business name.
 *
 * This had NO test until 2026-08-17, and the gap was load-bearing: the two
 * assertions in currency.test.ts re-implemented the strip inline as
 * `raw.replace(m.matched, '')` instead of calling this function, so they could
 * not have caught the defect below even in principle.
 *
 * 🔴 The defect. merchantFromRaw used to cut the amount out with
 * String.replace(matched), which removes the FIRST textual occurrence — not
 * necessarily the span extractMoney actually chose. That was safe only while the
 * amount was always the first number in the string. Preferring the
 * agorot-shaped number (the ₪19 → ₪119 fix) removed that guarantee, and a
 * mangled merchant is not cosmetic: it misroutes the category, poisons the
 * dedup fingerprint, and can travel into shared/aiSuggestions, which is other
 * households.
 */

// The route module pulls in the whole admin/AI/push stack at import time.
vi.mock('@/lib/firebaseAdmin', () => ({ getAdminDb: () => null, getAdminAuth: () => null }))
vi.mock('@/lib/aiCategorize',  () => ({ aiCategorizeOne: async () => null }))
vi.mock('@/lib/webPush',       () => ({ sendPushToUser: async () => {} }))
vi.mock('@/lib/aiBudget',      () => ({ checkAiBudget: async () => ({ stopped: false }) }))
vi.mock('@/lib/aiQuota',       () => ({ checkAiQuota: async () => ({ allowed: false }) }))

import { merchantFromRaw } from '@/app/api/transaction/route'

/** Exactly what the route does: extract, then strip what was extracted. */
const split = (raw: string) => {
  const ext = extractMoney(raw)!
  return { amount: ext.amount, merchant: merchantFromRaw(raw, ext.matched, ext.index) }
}

describe('merchantFromRaw — the amount out, the business name left', () => {
  it('handles the shipped shortcut order, amount first', () => {
    expect(split('19.00 Ilans Terminal 1')).toEqual({ amount: 19, merchant: 'Ilans Terminal 1' })
    expect(split('45.90 AM:PM 24')).toEqual({ amount: 45.9, merchant: 'AM:PM 24' })
  })

  it('handles a hand-built shortcut with the name first', () => {
    expect(split('Ilans Terminal 1 19.00')).toEqual({ amount: 19, merchant: 'Ilans Terminal 1' })
    expect(split('AM:PM 24 45.90')).toEqual({ amount: 45.9, merchant: 'AM:PM 24' })
    expect(split('סניף 7 32.50')).toEqual({ amount: 32.5, merchant: 'סניף 7' })
  })

  it('strips the currency symbol along with the number', () => {
    expect(split('£45.00 Tesco')).toEqual({ amount: 45, merchant: 'Tesco' })
  })

  // 🔴 The regression guard. `replace` would cut the head of "12.345" here and
  // leave the merchant as "5 חנות 12.34".
  it('cuts the span that was chosen, not an identical-looking earlier one', () => {
    expect(split('12.345 חנות 12.34')).toEqual({ amount: 12.34, merchant: '12.345 חנות' })
    expect(split('245.905 דלק 5.90')).toEqual({ amount: 5.9, merchant: '245.905 דלק' })
  })

  it('never returns an empty name', () => {
    expect(split('45.90')).toEqual({ amount: 45.9, merchant: 'Apple Pay' })
  })
})
