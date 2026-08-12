import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'

/**
 * The panel that shows the two flows the mapping kept missing.
 *
 * Why this is rendered and not just unit-tested: the whole point of the panel
 * is that a block the model reads and nobody can check fails silently. On the
 * real run the model was ALREADY told savings transfers are not expenses, and
 * it still returned six savings rows at monthlyContribution 0 — the failure was
 * invisible for as long as nothing put the number on screen. A test that only
 * exercises detectSavingsDeposits would have passed throughout.
 *
 * 🔴 The two numbers must never be presented in the same unit as each other by
 * accident: a recurring deposit is a RATE (per month) and a lump sum is a TOTAL.
 * Both assertions below check the unit, not only the digits.
 */

import FlowsPanel from '@/components/automap/FlowsPanel'
import { detectSavingsDeposits, classifyDeposits } from '@/lib/automapFlows'

const out = (desc: string, amount: number, category: string, date: string) =>
  ({ desc, amount, category, date, isRefund: false })

const THREE_MONTHS = [
  out('קסם אקטיב', 3000, 'השקעות', '2026-05-05'),
  out('קסם אקטיב', 3000, 'השקעות', '2026-06-05'),
  out('קסם אקטיב', 3000, 'השקעות', '2026-07-05'),
  out('קרן כספית', 50000, 'חסכונות', '2026-06-05'),
]

const DEPOSITS = [
  { name: 'מדינת ישראל משכורת', sum: 36000, count: 3, months: 3 },
  { name: 'ביטוח לאומי מילואים', sum: 39600, count: 3, months: 3 },
]

const empty = { deposits: [], monthlyRecurring: 0, oneOffTotal: 0 }
const noSplit = { explained: [], unexplained: [], oneOff: [], unexplainedMonthly: 0 }

describe('FlowsPanel', () => {
  afterEach(() => cleanup())

  it('renders nothing at all when there is nothing to report', () => {
    const { container } = render(
      <FlowsPanel savings={empty} deposits={noSplit} hasDeclared={false} months={3} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('leads with the money, before anything is expanded', () => {
    render(
      <FlowsPanel
        savings={detectSavingsDeposits(THREE_MONTHS, 3)}
        deposits={classifyDeposits(DEPOSITS, [{ name: 'בעל', monthly: 12000 }], 3)}
        hasDeclared months={3}
      />,
    )
    const header = screen.getByRole('button')
    expect(header.textContent).toContain('₪3,000')    // recurring savings
    expect(header.textContent).toContain('₪13,200')   // undeclared income
  })

  it('states a recurring deposit as a monthly rate and a lump sum as a total', () => {
    render(
      <FlowsPanel savings={detectSavingsDeposits(THREE_MONTHS, 3)} deposits={noSplit}
                  hasDeclared={false} months={3} />,
    )
    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText('₪3,000 לחודש')).toBeTruthy()
    // 🔴 The lump sum must NOT carry "לחודש" — dividing it by the window would
    // invent ₪16,667/month of saving that never happened.
    expect(screen.getByText('₪50,000')).toBeTruthy()
    expect(screen.queryByText('₪50,000 לחודש')).toBeNull()
  })

  it('separates the declared salary from the income nobody declared', () => {
    render(
      <FlowsPanel
        savings={empty}
        deposits={classifyDeposits(DEPOSITS, [{ name: 'בעל', monthly: 12000 }], 3)}
        hasDeclared months={3}
      />,
    )
    fireEvent.click(screen.getByRole('button'))

    const body = document.body.textContent ?? ''
    expect(body).toContain('מדינת ישראל משכורת')
    expect(body).toContain('ביטוח לאומי מילואים')
    // The sentence that stops the model, and the advisor, from swapping one for
    // the other rather than adding it.
    expect(body).toContain('זה נוסף להכנסה, לא במקומה')
  })

  // With no declared income there is nothing to split against, and showing an
  // "undeclared" list against an empty questionnaire would flag every salary.
  it('keeps the deposit split out of it when nothing was declared', () => {
    render(
      <FlowsPanel savings={detectSavingsDeposits(THREE_MONTHS, 3)} deposits={noSplit}
                  hasDeclared={false} months={3} />,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(document.body.textContent).not.toContain('הפקדות מול ההכנסה שנמסרה בשאלון')
  })
})
