import { describe, it, expect } from 'vitest'
import { reconcile, mappingSurplus, type ReconcileInput } from '@/lib/automapReconcile'
import type { GeneratedMapping } from '@/lib/autoMap'

const empty: GeneratedMapping = {
  creditScore: 0, creditCards: [], bankAccounts: [],
  income: [], fixed: [], sub: [], ins: [], variable: [], annual: [],
  debts: [], installments: [], savings: [],
  businessIncome: [], businessExpenses: [], assessment: '',
}

/** A household earning 20,000 and spending 17,000 — surplus 3,000/month. */
const mapping = (over: Partial<GeneratedMapping> = {}): GeneratedMapping => ({
  ...empty,
  income:   [{ name: 'משכורת', amount: 20000 }],
  fixed:    [{ name: 'שכר דירה', amount: 6000 }],
  variable: [{ name: 'מזון', amount: 4000 }],
  debts:    [{ name: 'הלוואה', originalBalance: 0, remainingBalance: 0, interestRate: 0, remainingMonths: 0, monthlyPayment: 2000 }],
  savings:  [{ name: 'קרן', monthlyContribution: 5000, accumulated: 0, feeBalance: 0, feeDeposit: 0 }],
  ...over,
})

/** Three months in which the account matched that exactly: +3,000/month. */
const flows = (over: Partial<ReconcileInput> = {}): ReconcileInput => ({
  bankIn: 60000, bankOut: 39000, cardCharges: 12000, months: 3, ...over,
})

describe('mappingSurplus', () => {
  it('is income minus every outflow the mapping names', () => {
    expect(mappingSurplus(mapping())).toBe(3000)
  })

  it('spreads an annual expense over twelve months rather than one', () => {
    const withAnnual = mapping({ annual: [{ name: 'ביטוח רכב', annualAmount: 12000 }] })
    expect(mappingSurplus(withAnnual)).toBe(2000)
  })

  it('counts business money on both sides — it moves through the same account', () => {
    const biz = mapping({
      businessIncome:   [{ name: 'תקבולים', amount: 30000 }],
      businessExpenses: [{ name: 'מע"מ', amount: 26000 }],
    })
    expect(mappingSurplus(biz)).toBe(7000)
  })

  it('is zero for a mapping with nothing in it', () => {
    expect(mappingSurplus(empty)).toBe(0)
  })
})

describe('reconcile — the mapping against the account', () => {
  it('passes when the two agree', () => {
    const r = reconcile(mapping(), flows())
    expect(r.verdict).toBe('ok')
    expect(Math.round(r.actualPerMonth)).toBe(3000)
    expect(Math.round(r.mappingPerMonth)).toBe(3000)
  })

  it('tolerates a small gap as timing noise rather than crying wolf', () => {
    // ₪300/month on a ₪20,000 income: under both the flat floor and the share.
    const r = reconcile(mapping(), flows({ bankOut: 39900 }))
    expect(r.verdict).toBe('ok')
  })

  // The common failure: a whole card or account was never uploaded, so the
  // mapping shows a surplus the client does not actually have.
  it('names missing expenses when the mapping is more optimistic than the account', () => {
    const r = reconcile(mapping(), flows({ bankOut: 48000 }))
    expect(r.verdict).toBe('expenses-missing')
    expect(Math.round(r.gapPerMonth)).toBe(3000)
    expect(r.title).toContain('3,000')
  })

  it('names the other direction when the mapping spends more than the account did', () => {
    const r = reconcile(mapping(), flows({ bankIn: 78000 }))
    expect(r.verdict).toBe('income-missing')
    expect(r.gapPerMonth).toBeLessThan(0)
  })

  // 2026-08-07: a bank file went through the credit parser and a ₪14,000 salary
  // was recorded as an expense. It moves both sides at once, so the gap is
  // double the error and impossible to miss.
  it('catches a salary counted as an expense', () => {
    const wrong = mapping({
      income:   [],
      variable: [{ name: 'מזון', amount: 4000 }, { name: 'העברה', amount: 20000 }],
    })
    const r = reconcile(wrong, flows())
    expect(r.verdict).toBe('income-missing')
    expect(Math.round(Math.abs(r.gapPerMonth))).toBe(40000)
  })

  it('divides by the window, not by one month', () => {
    const oneMonth = reconcile(mapping(), flows({ bankIn: 20000, bankOut: 13000, cardCharges: 4000, months: 1 }))
    expect(Math.round(oneMonth.actualPerMonth)).toBe(3000)
    expect(oneMonth.verdict).toBe('ok')
  })

  it('treats months of 0 as 1 instead of dividing by zero', () => {
    const r = reconcile(mapping(), flows({ bankIn: 20000, bankOut: 13000, cardCharges: 4000, months: 0 }))
    expect(Number.isFinite(r.actualPerMonth)).toBe(true)
    expect(Math.round(r.actualPerMonth)).toBe(3000)
  })

  // Without a statement there is nothing to check against, and saying so names
  // the single upload that makes the whole mapping verifiable.
  it('says it cannot run rather than passing silently, with no bank data', () => {
    const r = reconcile(mapping(), flows({ bankIn: 0, bankOut: 0, cardCharges: 12000 }))
    expect(r.verdict).toBe('no-bank-data')
    expect(r.gapPerMonth).toBe(0)
  })

  // With no income the share is undefined, so only the flat floor can fire.
  // An empty mapping against an account that lost ₪30,000 must not pass.
  it('still flags a large gap when income is zero and the share is undefined', () => {
    const r = reconcile(empty, flows({ bankIn: 0, bankOut: 30000, cardCharges: 0 }))
    expect(r.verdict).toBe('expenses-missing')
    expect(r.gapShare).toBe(0)
    expect(Math.round(r.gapPerMonth)).toBe(10000)
  })

  it('flags a gap that is small in shekels but large against a small income', () => {
    const small = mapping({ income: [{ name: 'קצבה', amount: 4000 }], fixed: [], variable: [], debts: [], savings: [] })
    // ₪350/month gap: under the ₪400 floor, but 8.75% of a ₪4,000 income.
    const r = reconcile(small, { bankIn: 12000, bankOut: 900, cardCharges: 0, months: 3 })
    expect(r.verdict).toBe('expenses-missing')
  })
})
