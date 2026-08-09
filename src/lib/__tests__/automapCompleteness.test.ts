import { describe, it, expect } from 'vitest'
import { buildCompletenessReport, missingMonths, type CompletenessInput } from '@/lib/automapCompleteness'

const tx = (amount: number, category: string, date = '2026-06-05') =>
  ({ amount, category, isRefund: false, date })

// A report that fires on everything stops being read, so the default fixture is
// a HEALTHY client: every check below must stay silent unless its own condition
// is met. Each test perturbs exactly one thing.
const base = (over: Partial<CompletenessInput> = {}): CompletenessInput => ({
  expenseTxns: [
    tx(2000, 'מזון לבית', '2026-04-05'),
    tx(2000, 'מזון לבית', '2026-05-05'),
    tx(2000, 'מזון לבית', '2026-06-05'),
  ],
  incomeRows:   [{ amount: 14000 }],
  docs:         [],
  contextText:  '',
  reportMonths: 3,
  detectedMonths: 3,
  annualItems:  [{ key: 'ins_car', name: 'ביטוח רכב', annualAmount: 3600, category: 'ביטוח', source: 'checklist' }],
  installments: [],
  settlements:  [],
  ...over,
})

const keys = (i: Partial<CompletenessInput> = {}) => buildCompletenessReport(base(i)).map(x => x.key)

describe('missingMonths', () => {
  it('finds a hole between the first and last month', () => {
    expect(missingMonths([{ date: '2026-04-01' }, { date: '2026-06-01' }])).toEqual(['2026-05'])
  })

  it('spans a year boundary', () => {
    expect(missingMonths([{ date: '2025-11-01' }, { date: '2026-02-01' }]))
      .toEqual(['2025-12', '2026-01'])
  })

  it('is empty for a contiguous run', () => {
    expect(missingMonths([{ date: '2026-04-01' }, { date: '2026-05-01' }, { date: '2026-06-01' }])).toEqual([])
  })

  it('is empty when there is nothing to compare', () => {
    expect(missingMonths([])).toEqual([])
    expect(missingMonths([{ date: '2026-04-01' }])).toEqual([])
    expect(missingMonths([{ date: 'not-a-date' }])).toEqual([])
  })
})

describe('buildCompletenessReport — silence when there is nothing to say', () => {
  it('says nothing at all before anything is uploaded', () => {
    expect(buildCompletenessReport(base({
      expenseTxns: [], incomeRows: [], docs: [],
    }))).toEqual([])
  })

  it('says nothing about a healthy 3-month upload', () => {
    expect(keys()).toEqual([])
  })
})

describe('buildCompletenessReport — each check fires only on its own condition', () => {
  it('flags a month with no transactions between months that have them', () => {
    const report = buildCompletenessReport(base({
      expenseTxns: [tx(2000, 'מזון לבית', '2026-04-05'), tx(2000, 'מזון לבית', '2026-06-05')],
    }))
    expect(report.find(i => i.key === 'month-gap')?.detail).toContain('2026-05')
  })

  it('flags a window too short to contain seasonal spending', () => {
    expect(keys({ detectedMonths: 1, reportMonths: 1 })).toContain('short-window')
    expect(keys({ detectedMonths: 3 })).not.toContain('short-window')
  })

  it('flags missing income only when no source of any kind exists', () => {
    expect(keys({ incomeRows: [] })).toContain('no-income')
    expect(keys({ incomeRows: [], docs: [{ name: 'תלוש.pdf' }] })).not.toContain('no-income')
    expect(keys({ incomeRows: [], contextText: 'משכורת 14,000 נטו' })).not.toContain('no-income')
  })

  it('flags a loan repayment with no balance or rate anywhere', () => {
    const withLoan = { expenseTxns: [...base().expenseTxns, tx(2400, 'החזר הלוואות')] }
    expect(keys(withLoan)).toContain('debt-no-detail')
    expect(keys({ ...withLoan, contextText: 'הלוואה 80,000 יתרה' })).not.toContain('debt-no-detail')
    expect(keys({ ...withLoan, docs: [{ name: 'דוח הלוואות.pdf' }] })).not.toContain('debt-no-detail')
  })

  it('does not flag a debt that is only a rounding-sized amount', () => {
    expect(keys({ expenseTxns: [...base().expenseTxns, tx(50, 'החזר הלוואות')] }))
      .not.toContain('debt-no-detail')
  })

  it('flags savings deposits with no accumulated balance', () => {
    const withSavings = { expenseTxns: [...base().expenseTxns, tx(1500, 'חסכונות')] }
    expect(keys(withSavings)).toContain('savings-no-detail')
    expect(keys({ ...withSavings, contextText: 'פנסיה צבירה 210,000' })).not.toContain('savings-no-detail')
  })

  it('flags cash and Bit that moved without a trace', () => {
    expect(keys({ expenseTxns: [...base().expenseTxns, tx(4200, 'מזומן ללא מעקב')] }))
      .toContain('untracked-cash')
    expect(keys({ expenseTxns: [...base().expenseTxns, tx(3000, 'ביט ללא מעקב')] }))
      .toContain('untracked-cash')
  })

  it('flags missing annual expenses only while the window is too short to hold them', () => {
    expect(keys({ annualItems: [] })).toContain('no-annual')
    expect(keys({ annualItems: [], detectedMonths: 12 })).not.toContain('no-annual')
  })

  it('reports what was moved out of the monthly picture as info, not a gap', () => {
    const report = buildCompletenessReport(base({
      installments: [{}, {}], settlements: [{}],
    }))
    const moved = report.find(i => i.key === 'moved-out')!
    expect(moved.severity).toBe('info')
    expect(moved.detail).toContain('2 עסקאות בתשלומים')
    expect(moved.detail).toContain('1 תשלומי ריכוז אשראי')
  })

  it('counts a confirmed one-off among what was moved out', () => {
    const report = buildCompletenessReport(base({
      annualItems: [
        { key: 'a', name: 'הראל', annualAmount: 3600, category: 'ביטוח', source: 'detected' },
      ],
    }))
    expect(report.find(i => i.key === 'moved-out')?.detail).toContain('1 חיובים שסומנו כשנתיים')
  })

  // The questionnaire turns an unknown into a follow-up: the advisor can go
  // back and ask. But a client who was never SENT one has not skipped it, and
  // conflating the two would fire this on every single run.
  it('says nothing about the questionnaire when there is none', () => {
    expect(keys({ intakeAnswers: null })).not.toContain('intake-blank')
    expect(keys()).not.toContain('intake-blank')
  })

  it('names the questions the client left blank', () => {
    const report = buildCompletenessReport(base({ intakeAnswers: { bankAccounts: 'יהב' } }))
    const item = report.find(i => i.key === 'intake-blank')!
    expect(item.detail).toContain('יתרות העו"ש')
    expect(item.detail).toContain('מסגרות האשראי')
    expect(item.detail).not.toContain('באילו בנקים')   // that one was answered
  })

  it('stays quiet once the client answered them', () => {
    expect(keys({
      intakeAnswers: { bankAccounts: 'יהב', oshBalance: '12,000', creditLimits: '30,000' },
    })).not.toContain('intake-blank')
  })

  it('flags a confirmed loan with no schedule attached', () => {
    const withLoan = { bankAccounts: 'א', oshBalance: 'ב', creditLimits: 'ג', hasLoans: 'כן' }
    expect(keys({ intakeAnswers: withLoan })).toContain('loans-no-schedule')
    // A document was attached — we cannot tell which, so we stop asking.
    expect(keys({ intakeAnswers: withLoan, docs: [{ name: 'סילוקין.pdf' }] }))
      .not.toContain('loans-no-schedule')
    // And no loans means no question.
    expect(keys({ intakeAnswers: { ...withLoan, hasLoans: 'לא' } })).not.toContain('loans-no-schedule')
  })

  it('nets refunds when judging whether an amount is material', () => {
    const report = buildCompletenessReport(base({
      expenseTxns: [
        ...base().expenseTxns,
        { amount: 4000, category: 'מזומן ללא מעקב', isRefund: false, date: '2026-06-05' },
        { amount: 3950, category: 'מזומן ללא מעקב', isRefund: true,  date: '2026-06-06' },
      ],
    }))
    expect(report.map(i => i.key)).not.toContain('untracked-cash')   // ₪50 net, not ₪4,000
  })
})
