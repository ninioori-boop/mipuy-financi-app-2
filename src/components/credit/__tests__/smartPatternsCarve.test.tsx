import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'

/**
 * The carve-out money test (2026-08-05 audit, findings H1+H2 of the sweep):
 * sending a merchant from "ניתוח חכם" to mapping must PRESERVE the client's
 * total expenses — the row added to the target section must equal the amount
 * subtracted from the source category row. Before the fix the add-side used
 * the per-charge average (total/count) while the subtract-side used the true
 * monthly contribution (total/varMonths), so any merchant that doesn't charge
 * exactly once a month silently skewed the total. Standing orders were worse:
 * each appearance was a count:1 item with no period total, so a הו"ק in a
 * 3-month statement subtracted a third of one charge while adding a full one.
 */

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), dismiss: vi.fn(),
  }),
}))

import { SmartPatterns } from '@/components/credit/SmartPatterns'
import { useMappingStore } from '@/stores/mappingStore'
import type { Transaction } from '@/types/transaction'

const tx = (over: Partial<Transaction>): Transaction => ({
  desc: '', amount: 0, originalAmount: null, category: 'שונות', source: 'test.xlsx',
  notes: '', date: '2026-03-05', installment: null, isStandingOrder: false,
  isRefund: false, id: Math.random().toString(36).slice(2),
  ...over,
})

const sumOf = (rows: { amount: number }[]) => rows.reduce((s, r) => s + r.amount, 0)

describe('SmartPatterns — carve-out preserves the expense total', () => {
  beforeEach(() => {
    useMappingStore.setState({
      income: [], fixed: [], variable: [], sub: [], ins: [], annual: [],
      varMonths: 3,
    })
  })
  afterEach(() => cleanup())

  // A gym charging TWICE a month: 6×₪50 over a 3-month statement. Its true
  // monthly cost is ₪100 — and that is what the aggregated "מנויים" row holds
  // after import (300/3). The carved row must say 100, not the per-charge 50.
  it('a twice-a-month merchant carves out at its true monthly cost', () => {
    useMappingStore.setState({
      sub: [{ id: 'cat', name: 'מנויים', amount: 100, fromCredit: true }],
    })
    const txs = ['03', '03', '04', '04', '05', '05'].map((mm, i) =>
      tx({ desc: 'הולמס פלייס', amount: 50, category: 'מנויים', date: `2026-${mm}-${i % 2 ? 15 : 1}` }))

    render(<SmartPatterns transactions={txs} />)
    fireEvent.click(screen.getByText('מנויים מזוהים'))
    fireEvent.click(screen.getByTitle('שלח למנויים במיפוי'))

    const sub = useMappingStore.getState().sub
    expect(sub.find(r => r.name === 'הולמס פלייס')?.amount,
      'the carved row must hold the merchant\'s true monthly cost').toBe(100)
    expect(sub.find(r => r.name === 'מנויים'),
      'the aggregated category row must be fully consumed').toBeUndefined()
    expect(sumOf(sub), 'total expenses must not change').toBe(100)
  })

  // A ₪150 standing order in a 3-month statement (3 appearances). Grouped, its
  // period total is 450 → monthly 150. Before the fix it was three count:1
  // items: carving one added 150/month but subtracted only 150/3=50 — the
  // client's expenses inflated by ₪100/month with nothing visible on screen.
  it('a standing order in a multi-month statement carves out month-for-month', () => {
    useMappingStore.setState({
      fixed: [{ id: 'cat', name: 'חשמל', amount: 150, fromCredit: true }],
    })
    const txs = ['03', '04', '05'].map(mm =>
      tx({ desc: 'חברת חשמל הוק', amount: 150, category: 'חשמל', date: `2026-${mm}-02`, isStandingOrder: true }))

    render(<SmartPatterns transactions={txs} />)
    fireEvent.click(screen.getByText('הוראות קבע'))
    expect(screen.getAllByText('חברת חשמל הוק').length,
      'the same הו"ק must appear once, not once per month').toBe(1)
    fireEvent.click(screen.getByTitle('שלח לקבועות במיפוי'))

    const fixed = useMappingStore.getState().fixed
    expect(fixed.find(r => r.name === 'חברת חשמל הוק')?.amount,
      'the carved row must hold the monthly charge').toBe(150)
    expect(fixed.find(r => r.name === 'חשמל'),
      'the aggregated category row must be fully consumed').toBeUndefined()
    expect(sumOf(fixed), 'total expenses must not change').toBe(150)
  })
})
