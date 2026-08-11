import { describe, it, expect } from 'vitest'
import { buildRun, summarizeRun, type AutomapRun } from '@/lib/automapFixture'
import type { GeneratedMapping } from '@/lib/autoMap'
import type { Transaction } from '@/types/transaction'

// The summary is the screen in text form, so every check here is one of the
// defects that reached Ori before a test did. If the summary can see them, a
// saved run can be replayed and the fix verified without him running anything.

const txn = (desc: string, amount: number, category: string, date = '2026-06-05'): Transaction => ({
  desc, amount, originalAmount: null, category, source: 'אשראי', notes: '',
  date, installment: null, isStandingOrder: false, isRefund: false,
})

const emptyMapping: GeneratedMapping = {
  creditScore: 0, creditCards: [], bankAccounts: [],
  income: [], fixed: [], sub: [], ins: [], variable: [], annual: [],
  debts: [], installments: [], savings: [],
  businessIncome: [], businessExpenses: [], assessment: '',
}

const run = (over: Partial<AutomapRun> = {}): AutomapRun => buildRun({
  months: 3,
  txns: [txn('שופרסל', 900, 'מזון לבית'), txn('הראל בריאות', 123, 'ביטוח')],
  bankRows: [
    { desc: 'משכורת', amount: 42000, date: '2026-06-01', dir: 'in' },
    { desc: 'ארנונה', amount: 1860, date: '2026-06-02', dir: 'out' },
  ],
  fileNames: ['credit.xlsx'], attachedByQ: {}, txnOverrides: {}, docNames: [],
  intakeForm: {}, intakeRows: {}, contextText: '', annualItems: [],
  result: {
    ...emptyMapping,
    // Two rows on purpose: one income row beside real deposits IS the
    // collapsed-income defect, so a fixture with one is not a healthy fixture.
    income:   [
      { name: 'משכורת', amount: 10000, category: 'הכנסות' },
      { name: 'קצבה',   amount: 4000,  category: 'הכנסות' },
    ],
    fixed:    [{ name: 'ארנונה', amount: 620, category: 'ארנונה' }],
    variable: [{ name: 'מזון לבית', amount: 300, category: 'מזון לבית' }],
    ins:      [{ name: 'ביטוח בריאות הראל', amount: 41, category: 'ביטוח' }],
  },
  ...over,
})

const findings = (r: AutomapRun) => summarizeRun(r).findings.map(f => f.text)

// 🔴 Found on Ori's real run, 2026-08-11. The summariser counted a ₪8,799 card
// settlement as an expense while the same ₪8,799 was already itemised in the
// credit report. That turned a ₪4,105 monthly surplus into a ₪3,127 deficit and
// reported "₪5,333 of expenses are missing" when nothing was missing — the page
// itself had it right the whole time. A summary that lies about the screen is
// worse than no summary.
describe('the card settlement is not counted twice', () => {
  const withSettlement = run({
    bankRows: [
      { desc: 'משכורת', amount: 42000, date: '2026-06-01', dir: 'in' },
      { desc: 'ארנונה', amount: 1860, date: '2026-06-02', dir: 'out' },
      { desc: 'תשלום כרטיס אשראי', amount: 9000, date: '2026-06-03', dir: 'out' },
    ],
  })

  it('excludes it from the reconciliation, as the page does', () => {
    const { lines } = summarizeRun(withSettlement)
    const line = lines.find(l => l.startsWith('הצלבה'))!
    // 42000 in, 1860 out, 1023 of card charges — the ₪9,000 settlement IS
    // those charges arriving at the bank, and must not be subtracted again.
    expect(line).toContain('₪13,039')
  })

  it('still counts it when there is no credit detail behind it', () => {
    const noCredit = run({ txns: [], bankRows: withSettlement.bankRows })
    expect(summarizeRun(noCredit).lines.find(l => l.startsWith('הצלבה'))).toContain('₪10,380')
  })
})

describe('summarizeRun — the picture of the screen', () => {
  it('describes the run without inventing problems', () => {
    const { lines, findings } = summarizeRun(run())
    expect(lines.join('\n')).toContain('3 חודשים')
    expect(lines.join('\n')).toContain('הכנסות: 2 שורות')
    expect(findings.filter(f => f.severity === 'gap')).toEqual([])
  })

  it('works on a run that was saved before generating', () => {
    const { lines } = summarizeRun(run({ result: null }))
    expect(lines.join('\n')).toContain('אין תוצאה שמורה')
  })
})

// Each of these is a defect that shipped and was caught by Ori, not by a test.
describe('summarizeRun — the defects that reached the advisor first', () => {
  it('sees a row that cannot be opened, because the model left the category blank', () => {
    const r = run({
      result: { ...run().result!, ins: [{ name: 'סך ביטוחים (הראל + מכבי)', amount: 1380 }] },
    })
    // One unlabelled row DOES represent its whole section, so it can be opened.
    expect(findings(r)).not.toContain('ביטוחים: 1 שורות בלי פירוט שנפתח')

    // Beside another row it can claim nothing, and that is the blind one.
    const two = run({
      result: {
        ...run().result!,
        ins: [
          { name: 'ביטוח בריאות הראל', amount: 41, category: 'ביטוח' },
          { name: 'פוליסה שלא נמצאה בדוחות', amount: 200 },
        ],
      },
    })
    expect(findings(two).some(t => t.includes('בלי פירוט שנפתח'))).toBe(true)
  })

  it('sees income collapsed into one row while deposits exist', () => {
    const r = run({
      result: { ...run().result!, income: [{ name: 'הכנסות', amount: 14000, category: 'הכנסות' }] },
    })
    expect(findings(r)).toContain('ההכנסות שורה אחת — הפירוט לפי משלם נעלם')
  })

  it('sees a row the model named but never priced', () => {
    const r = run({
      result: { ...run().result!, ins: [
        { name: 'ביטוח בריאות הראל', amount: 41, category: 'ביטוח' },
        { name: 'ביטוח בריאות מכבי', amount: 0, category: 'ביטוח' },
      ] },
    })
    expect(findings(r)).toContain('ביטוחים: יש שורה בלי סכום')
  })

  it('sees the same annual expense under two names', () => {
    const r = run({
      result: { ...run().result!, annual: [
        { name: 'אלוף הספות (חופשה/בילוי)', annualAmount: 3700 },
        { name: 'העברה/אלוף הספות', annualAmount: 3700 },
      ] },
    })
    expect(findings(r).some(t => t.includes('שנתיות כפולות'))).toBe(true)
  })

  it('sees the same charge parsed twice from overlapping sheets', () => {
    const dup = [
      txn('עמית כלים', 130, 'שונות', '2026-07-20'),
      txn('עמית כלים', 130, 'שונות', '2026-07-20'),
      txn('פרחי רונית', 100, 'שונות', '2026-07-28'),
      txn('פרחי רונית', 100, 'שונות', '2026-07-28'),
      txn('יאוארדי', 86, 'שונות', '2026-07-17'),
      txn('יאוארדי', 86, 'שונות', '2026-07-17'),
    ]
    expect(findings(run({ txns: dup })).some(t => t.includes('חיובים כפולים'))).toBe(true)
  })

  it('sees a loan with a payment and no schedule behind it', () => {
    const r = run({
      result: { ...run().result!, debts: [{
        name: 'משכנתה', monthlyPayment: 4500,
        originalBalance: 0, remainingBalance: 0, interestRate: 0, remainingMonths: 0,
      }] },
    })
    expect(findings(r)).toContain('הלוואה עם החזר ובלי יתרה — לוח סילוקין לא צורף')
  })

  it('sees a salary counted twice, once from the payslip and once from the deposit', () => {
    const r = run({
      attachedByQ: { payslips: ['tlush.pdf'] },
      result: { ...run().result!, income: [
        { name: 'משכורת (תלוש)', amount: 14000, category: 'הכנסות' },
        { name: 'משכורת (בנק)',  amount: 14000, category: 'הכנסות' },
      ] },
    })
    expect(findings(r).some(t => t.includes('גבוהות'))).toBe(true)
  })

  it('reports the reconciliation verdict, which is the first thing read', () => {
    const { lines } = summarizeRun(run())
    expect(lines.join('\n')).toContain('הצלבה:')
  })

  // A correction has to change what the summary sees, or the replay is looking
  // at a different screen from the one the advisor is.
  it('applies the advisor corrections exactly as the screen does', () => {
    const r = run({
      txns: [txn('קניה/( כאל) מגדל/טלפון ני', 1000, 'ביטוח')],
      txnOverrides: { 'קניה/( כאל) מגדל/טלפון ני': 'השקעות' },
    })
    const { lines } = summarizeRun(r)
    expect(lines.join('\n')).toContain('ביטוחים: 1 שורות')   // the row is still there…
    // …but its charge moved out, so the row can no longer be opened onto it.
    expect(findings(r).some(t => t.includes('בלי פירוט שנפתח'))).toBe(true)
  })
})
