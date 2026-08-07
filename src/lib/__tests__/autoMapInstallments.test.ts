import { describe, it, expect } from 'vitest'
import {
  buildInstallments, buildStandingOrders, formatInstallments, formatStandingOrders,
  isInstallment, buildCategoryBreakdown,
} from '@/lib/autoMap'

type T = {
  desc: string; amount: number; originalAmount: number | null; category: string
  isRefund: boolean; isStandingOrder: boolean
  installment: { current: number; total: number } | null
}
const tx = (p: Partial<T> & { desc: string; amount: number }): T => ({
  originalAmount: null, category: 'שונות', isRefund: false, isStandingOrder: false,
  installment: null, ...p,
})

describe('isInstallment', () => {
  it('is true only for a real multi-leg plan', () => {
    expect(isInstallment({ installment: { current: 3, total: 12 } })).toBe(true)
    expect(isInstallment({ installment: { current: 1, total: 1 } })).toBe(false)  // a single payment is not a plan
    expect(isInstallment({ installment: null })).toBe(false)
  })
})

describe('buildInstallments', () => {
  it('reads the plan out of the parsed legs, biggest payment first', () => {
    const lines = buildInstallments([
      tx({ desc: 'איקאה', amount: 450, originalAmount: 5400, installment: { current: 2, total: 12 } }),
      tx({ desc: 'איקאה', amount: 450, originalAmount: 5400, installment: { current: 3, total: 12 } }),
      tx({ desc: 'זאפ', amount: 120, installment: { current: 1, total: 6 } }),
    ])
    expect(lines).toEqual([
      { name: 'איקאה', monthlyPayment: 450, paidCount: 3, totalCount: 12, totalAmount: 5400 },
      { name: 'זאפ',   monthlyPayment: 120, paidCount: 1, totalCount: 6,  totalAmount: 0 },
    ])
  })

  it('takes the HIGHEST leg seen — that is what the client has actually paid', () => {
    const lines = buildInstallments([
      tx({ desc: 'איקאה', amount: 450, installment: { current: 7, total: 12 } }),
      tx({ desc: 'איקאה', amount: 450, installment: { current: 5, total: 12 } }),
    ])
    expect(lines[0].paidCount).toBe(7)
  })

  it('ignores refunds and ordinary charges', () => {
    expect(buildInstallments([
      tx({ desc: 'שופרסל', amount: 300 }),
      tx({ desc: 'איקאה', amount: 450, isRefund: true, installment: { current: 2, total: 12 } }),
    ])).toEqual([])
  })
})

describe('buildStandingOrders', () => {
  it('lists each standing-order merchant once', () => {
    expect(buildStandingOrders([
      tx({ desc: 'חברת חשמל', amount: 300, isStandingOrder: true }),
      tx({ desc: 'חברת חשמל', amount: 310, isStandingOrder: true }),
      tx({ desc: 'שופרסל', amount: 200 }),
    ])).toEqual(['חברת חשמל'])
  })

  it('does not list a refund', () => {
    expect(buildStandingOrders([
      tx({ desc: 'פלאפון', amount: 90, isStandingOrder: true, isRefund: true }),
    ])).toEqual([])
  })
})

// The rule the whole round rests on: a transaction that moves to its own block
// must not still be inside the expense breakdown.
describe('no double counting', () => {
  const txns = [
    tx({ desc: 'שופרסל', amount: 300, category: 'מזון לבית' }),
    tx({ desc: 'איקאה', amount: 450, category: 'ריהוט וציוד לבית', installment: { current: 2, total: 12 } }),
  ]

  it('an installment charge is NOT in the expense breakdown', () => {
    const expenseTxns = txns.filter(t => !isInstallment(t))
    const rows = buildCategoryBreakdown(expenseTxns)
    expect(rows.map(r => r.category)).toEqual(['מזון לבית'])
    expect(rows.some(r => r.merchants.some(m => m.name === 'איקאה'))).toBe(false)
  })

  it('but it IS in the installments block', () => {
    expect(buildInstallments(txns).map(l => l.name)).toEqual(['איקאה'])
  })
})

describe('formatting', () => {
  it('tells the model the installments were already removed', () => {
    const out = formatInstallments(buildInstallments([
      tx({ desc: 'איקאה', amount: 450, originalAmount: 5400, installment: { current: 3, total: 12 } }),
    ]))
    expect(out[0]).toContain('כבר הוסרו')
    expect(out[1]).toContain('3 מתוך 12')
    expect(out[1]).toContain('5400')
  })

  it('omits the full purchase price when the file did not carry it', () => {
    const out = formatInstallments(buildInstallments([
      tx({ desc: 'זאפ', amount: 120, installment: { current: 1, total: 6 } }),
    ]))
    expect(out[1]).not.toContain('סכום עסקה מלא')
  })

  it('renders nothing for empty inputs', () => {
    expect(formatInstallments([])).toEqual([])
    expect(formatStandingOrders([])).toEqual([])
  })

  it('marks standing orders as a fixed-vs-variable hint, not a removal', () => {
    const out = formatStandingOrders(['חברת חשמל'])
    expect(out[0]).toContain('הוראת קבע')
    expect(out[0]).not.toContain('הוסרו')
  })
})
