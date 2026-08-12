import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'

/**
 * The פירוט, and its controls.
 *
 * Every defect in this lab reached Ori first, and every one of them lived in
 * the seam between logic that was already tested and a screen nobody rendered:
 * a row with no drill-down, controls that overlapped, a button that existed in
 * the credit tab and not here. A pure test cannot see any of it.
 *
 * So these assert the seam: that a control is present, that clicking it calls
 * the handler with what the handler expects, and that the footer's two units
 * (window total vs monthly average) stay apart. That last one is the quiet
 * killer — both numbers look right alone.
 */

import { TxnDetailTable } from '@/components/automap/TxnDetailTable'
import RecurringPanel from '@/components/automap/RecurringPanel'
import type { Transaction } from '@/types/transaction'

const tx = (over: Partial<Transaction>): Transaction => ({
  desc: '', amount: 0, originalAmount: null, category: 'שונות', source: 'test.xlsx',
  notes: '', date: '2026-07-05', installment: null, isStandingOrder: false,
  isRefund: false, ...over,
})

describe('TxnDetailTable — the controls Ori asked for', () => {
  afterEach(() => cleanup())

  const rows = [
    tx({ desc: 'דרייב קפה', amount: 90, category: 'ביגוד והנעלה' }),
    tx({ desc: 'שופרסל דיל', amount: 310, category: 'מזון לבית' }),
  ]

  it('offers every control the credit tab has', () => {
    render(
      <TxnDetailTable txns={rows} months={3} onRecategorize={vi.fn()}
                      onDescChange={vi.fn()} onAmountChange={vi.fn()} onDelete={vi.fn()} />,
    )
    for (const title of ['חיפוש באינטרנט', 'ערוך תיאור', 'ערוך סכום', 'שנה קטגוריה', 'מחק עסקה']) {
      expect(screen.getAllByTitle(title).length).toBe(rows.length)
    }
  })

  // A handler that is not passed must not leave a dead button on screen.
  it('hides a control whose handler was not supplied', () => {
    render(<TxnDetailTable txns={rows} months={3} onRecategorize={vi.fn()} />)
    expect(screen.queryAllByTitle('מחק עסקה')).toHaveLength(0)
    expect(screen.queryAllByTitle('ערוך סכום')).toHaveLength(0)
    expect(screen.getAllByTitle('שנה קטגוריה')).toHaveLength(rows.length)
  })

  it('hands the delete handler the charge that was clicked, not the first row', () => {
    const onDelete = vi.fn()
    render(<TxnDetailTable txns={rows} months={3} onRecategorize={vi.fn()} onDelete={onDelete} />)
    // Rows are sorted by amount, so the ₪310 charge is first on screen.
    fireEvent.click(screen.getAllByTitle('מחק עסקה')[1])
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ desc: 'דרייב קפה' }))
  })

  it('commits an edited amount, and drops one that is not a number', () => {
    const onAmountChange = vi.fn()
    render(<TxnDetailTable txns={rows} months={3} onRecategorize={vi.fn()} onAmountChange={onAmountChange} />)

    fireEvent.click(screen.getAllByTitle('ערוך סכום')[0])
    const input = document.querySelector('input[type="number"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '250' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onAmountChange).toHaveBeenCalledWith(expect.objectContaining({ desc: 'שופרסל דיל' }), 250)

    onAmountChange.mockClear()
    fireEvent.click(screen.getAllByTitle('ערוך סכום')[0])
    const again = document.querySelector('input[type="number"]') as HTMLInputElement
    fireEvent.change(again, { target: { value: '' } })
    fireEvent.keyDown(again, { key: 'Enter' })
    expect(onAmountChange).not.toHaveBeenCalled()
  })

  it('leaves the row alone when the edit is escaped', () => {
    const onDescChange = vi.fn()
    render(<TxnDetailTable txns={rows} months={3} onRecategorize={vi.fn()} onDescChange={onDescChange} />)
    fireEvent.click(screen.getAllByTitle('ערוך תיאור')[0])
    const input = document.querySelector('input:not([type="number"])') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'משהו אחר' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onDescChange).not.toHaveBeenCalled()
  })

  // 🔴 The transactions sum to the WINDOW; the row above the table is monthly.
  // Printing one as the other is the error nobody catches, because each number
  // is correct in its own unit.
  it('keeps the window total and the monthly average apart in the footer', () => {
    render(<TxnDetailTable txns={rows} months={3} onRecategorize={vi.fn()} />)
    const foot = document.querySelector('tfoot')!.textContent ?? ''
    expect(foot).toContain('₪400')      // the window total: 90 + 310
    expect(foot).toContain('₪133')      // and its monthly share
    expect(foot).toContain('3 חודשים')
  })

  it('filters on the search box, and says so when nothing matches', () => {
    render(<TxnDetailTable txns={rows} months={3} onRecategorize={vi.fn()} />)
    const search = screen.getByPlaceholderText('חיפוש בפירוט...')
    fireEvent.change(search, { target: { value: 'דרייב' } })
    expect(screen.queryByText('שופרסל דיל')).toBeNull()
    fireEvent.change(search, { target: { value: 'לא קיים' } })
    expect(screen.getByText('אין תוצאות')).toBeTruthy()
  })
})

describe('RecurringPanel — subscriptions, and what only looks like one', () => {
  afterEach(() => cleanup())

  const monthly = (desc: string, amount: number, category: string) =>
    ['2026-05-04', '2026-06-04', '2026-07-04'].map(date => tx({ desc, amount, category, date }))

  const txns = [
    ...monthly('ספוטיפיי', 24, 'מנויים'),        // already filed as one
    ...monthly('מספרה של רמי', 100, 'שונות'),    // repeats, filed elsewhere
  ]

  it('separates what is filed as a subscription from what merely looks like one', () => {
    render(<RecurringPanel txns={txns} months={3} onMove={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /הוצאות שחוזרות כל חודש/ }))

    expect(screen.getByText('חשודים כמנויים, ויושבים במקום אחר')).toBeTruthy()
    expect(screen.getByText('כבר מסווגים כמנויים')).toBeTruthy()
    // Only the suspect gets a button — there is no decision left on the other.
    expect(screen.getAllByText('העבר למנויים')).toHaveLength(1)
  })

  it('moves the suspect on the same path the פירוט uses', () => {
    const onMove = vi.fn()
    render(<RecurringPanel txns={txns} months={3} onMove={onMove} />)
    fireEvent.click(screen.getByRole('button', { name: /הוצאות שחוזרות כל חודש/ }))
    fireEvent.click(screen.getByText('העבר למנויים'))

    // A representative charge, carrying the category it is LEAVING — without
    // that, nothing gets debited from the row it came out of.
    expect(onMove).toHaveBeenCalledWith(
      expect.objectContaining({ desc: 'מספרה של רמי', category: 'שונות' }), 'מנויים',
    )
  })

  it('says out loud what it does not look at', () => {
    render(<RecurringPanel txns={txns} months={3} onMove={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /הוצאות שחוזרות כל חודש/ }))
    const note = document.body.textContent ?? ''
    expect(note).toContain('העברות לחיסכון והשקעות')
    expect(note).toContain('ביט')
  })

  it('renders nothing when nothing repeats', () => {
    const { container } = render(
      <RecurringPanel txns={[tx({ desc: 'חד פעמי', amount: 50 })]} months={3} onMove={vi.fn()} />,
    )
    expect(container.firstChild).toBeNull()
  })
})
