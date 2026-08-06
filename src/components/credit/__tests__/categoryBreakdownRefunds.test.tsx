import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'

/**
 * Refunds NET their category (Ori, 2026-08-06). The live complaint this locks:
 * a ₪1,350 bus trip was charged AND fully refunded in the same statement —
 * the refund appeared in the "החזרים / זיכויים" panel, but the category total
 * still counted the full ₪1,350 as spending. Detection without netting is
 * worse than nothing: the coach sees the refund listed and assumes the totals
 * account for it.
 */

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), dismiss: vi.fn(),
  }),
}))

import { CategoryBreakdown } from '@/components/credit/CategoryBreakdown'
import type { Transaction } from '@/types/transaction'

const tx = (over: Partial<Transaction>): Transaction => ({
  desc: '', amount: 0, originalAmount: null, category: 'שונות', source: 'test.xlsx',
  notes: '', date: '2026-07-26', installment: null, isStandingOrder: false,
  isRefund: false, id: Math.random().toString(36).slice(2),
  ...over,
})

const noop = () => {}

describe('CategoryBreakdown — refunds net their category', () => {
  afterEach(() => cleanup())

  it('a fully-refunded charge contributes zero to its category total', () => {
    render(
      <CategoryBreakdown
        transactions={[
          tx({ desc: 'אוטובוס בכרם', amount: 1350, category: 'חופשה וטיול' }),
          tx({ desc: 'אוטובוס בכרם', amount: 1350, category: 'חופשה וטיול', isRefund: true }),
          tx({ desc: 'צימר בגולן', amount: 42, category: 'חופשה וטיול' }),
        ]}
        onCategoryChange={noop} onDescChange={noop} onAmountChange={noop} onDelete={noop}
      />,
    )
    // The category header total must be the NET (1350 − 1350 + 42), not 1392.
    expect(screen.getByText('₪42')).toBeTruthy()
    expect(screen.queryByText('₪1,392')).toBeNull()
  })

  it('the refund row is visible inside the category, marked as a credit', () => {
    render(
      <CategoryBreakdown
        transactions={[
          tx({ desc: 'דמי כרטיס', amount: 20, category: 'עמלות בנק ואשראי' }),
          tx({ desc: 'דמי כרטיס', amount: 20, category: 'עמלות בנק ואשראי', isRefund: true }),
        ]}
        onCategoryChange={noop} onDescChange={noop} onAmountChange={noop} onDelete={noop}
      />,
    )
    fireEvent.click(screen.getByText('עמלות בנק ואשראי'))
    // Both rows are shown: the charge as ₪20, the refund as +₪20 (green).
    expect(screen.getByText('+₪20')).toBeTruthy()
    // And the category total nets to zero.
    expect(screen.getAllByText('₪0').length).toBeGreaterThan(0)
  })
})
