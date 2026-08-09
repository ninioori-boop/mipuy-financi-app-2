import { describe, it, expect } from 'vitest'
import { parseGeneratedMapping, emptyGeneratedMapping, AUTOMAP_SYSTEM_PROMPT } from '@/lib/autoMap'

// A real run on 2026-08-07 against a self-employed client reported ₪81,234 of
// "monthly income" — mostly customer receipts and cheque deposits — and made
// VAT + income tax + the accountant ₪9,464 of a ₪10,589 fixed-expense total.
// That describes the business, not the family. The two are now separated.

describe('business sections', () => {
  it('parses business rows into their own arrays', () => {
    const r = parseGeneratedMapping(JSON.stringify({
      income: [{ name: 'משכורת', amount: 12000 }],
      businessIncome: [{ name: 'הפקדות שיקים', amount: 40000, confidence: 'high' }],
      businessExpenses: [{ name: 'מע"מ', amount: 5462 }, { name: 'מס הכנסה', amount: 3098 }],
    }))
    expect(r.income).toHaveLength(1)
    expect(r.businessIncome.map(x => x.name)).toEqual(['הפקדות שיקים'])
    expect(r.businessExpenses.map(x => x.name)).toEqual(['מע"מ', 'מס הכנסה'])
  })

  // The whole point: business money must not inflate the household's numbers.
  it('keeps business money out of the household sections', () => {
    const r = parseGeneratedMapping(JSON.stringify({
      income: [{ name: 'משכורת', amount: 12000 }],
      fixed:  [{ name: 'ארנונה', amount: 620 }],
      businessIncome:   [{ name: 'תקבולים מלקוחות', amount: 69000 }],
      businessExpenses: [{ name: 'מע"מ', amount: 5462 }],
    }))
    expect(r.income.reduce((s, x) => s + x.amount, 0)).toBe(12000)   // not 81,000
    expect(r.fixed.reduce((s, x) => s + x.amount, 0)).toBe(620)      // not 6,082
  })

  it('defaults to empty for a draft saved before the sections existed', () => {
    const r = parseGeneratedMapping(JSON.stringify({ income: [{ name: 'משכורת', amount: 12000 }] }))
    expect(r.businessIncome).toEqual([])
    expect(r.businessExpenses).toEqual([])
  })

  it('survives a non-array in either field', () => {
    const r = parseGeneratedMapping(JSON.stringify({
      businessIncome: 'לא מערך', businessExpenses: { a: 1 },
    }))
    expect(r.businessIncome).toEqual([])
    expect(r.businessExpenses).toEqual([])
  })

  it('emptyGeneratedMapping carries both, so a fresh result is complete', () => {
    const e = emptyGeneratedMapping()
    expect(e.businessIncome).toEqual([])
    expect(e.businessExpenses).toEqual([])
  })
})

describe('the prompt states the separation rules', () => {
  it('names both sections so the model has somewhere to put them', () => {
    expect(AUTOMAP_SYSTEM_PROMPT).toContain('businessIncome')
    expect(AUTOMAP_SYSTEM_PROMPT).toContain('businessExpenses')
  })

  it('says VAT is not a household expense — the single biggest distortion', () => {
    expect(AUTOMAP_SYSTEM_PROMPT).toContain('מע"מ אינו הוצאה בכלל')
  })

  it('tells it to default to the household with low confidence when unsure', () => {
    // Anything ambiguous should reach the advisor through the review queue
    // rather than being silently filed as business.
    expect(AUTOMAP_SYSTEM_PROMPT).toContain('confidence "low"')
  })
})
