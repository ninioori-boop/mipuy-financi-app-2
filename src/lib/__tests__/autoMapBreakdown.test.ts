import { describe, it, expect } from 'vitest'
import {
  buildCategoryBreakdown, formatCategoryBreakdown, detectMonthSpan, validateMapping,
  sectionOfCategory, groupByName, formatIncomeBreakdown, moveLoansToDebts, fillLoanBalances,
  applyTxnRecategorization,
  adjustCategoryAmount,
  consolidateByCategory, ensureAnnualItems, findAnnualDuplicates, dedupeAnnual, dropEmptyRows,
  type GeneratedMapping,
} from '@/lib/autoMap'

type T = { desc: string; amount: number; category: string; isRefund: boolean }
const tx = (desc: string, amount: number, category: string, isRefund = false): T =>
  ({ desc, amount, category, isRefund })

describe('buildCategoryBreakdown', () => {
  it('groups merchants inside each category and sorts both by spend', () => {
    const rows = buildCategoryBreakdown([
      tx('שופרסל דיל', 300, 'מזון לבית'),
      tx('שופרסל דיל', 200, 'מזון לבית'),
      tx('רמי לוי', 400, 'מזון לבית'),
      tx('פז', 250, 'תחבורה'),
    ])

    expect(rows.map(r => r.category)).toEqual(['מזון לבית', 'תחבורה'])
    const food = rows[0]
    expect(food.sum).toBe(900)
    expect(food.count).toBe(3)
    expect(food.merchants).toEqual([
      { key: 'שופרסל דיל', name: 'שופרסל דיל', sum: 500, count: 2 },
      { key: 'רמי לוי',    name: 'רמי לוי',    sum: 400, count: 1 },
    ])
  })

  // `key` is the normalized identity other code points back at (confirming a
  // one-off charge as annual, for one). It must NOT be the raw display name.
  it('carries a normalized key alongside the raw display name', () => {
    const rows = buildCategoryBreakdown([tx('הראל ביטוח בע"מ', 3600, 'ביטוח')])
    expect(rows[0].merchants[0]).toEqual({
      key: 'הראל ביטוח', name: 'הראל ביטוח בע"מ', sum: 3600, count: 1,
    })
  })

  it('nets refunds into the merchant and the category, and never counts them', () => {
    const rows = buildCategoryBreakdown([
      tx('זארה', 500, 'ביגוד'),
      tx('זארה', 200, 'ביגוד', true),
    ])
    expect(rows[0]).toMatchObject({ sum: 300, count: 1 })
    expect(rows[0].merchants).toEqual([{ key: 'זארה', name: 'זארה', sum: 300, count: 1 }])
  })

  it('keeps the category total equal to the sum of its parts', () => {
    const rows = buildCategoryBreakdown([
      ...Array.from({ length: 40 }, (_, i) => tx(`חנות ${i}`, 100 + i, 'שונות')),
      tx('החזר', 90, 'שונות', true),
    ])
    const r = rows[0]
    const parts = r.merchants.reduce((s, m) => s + m.sum, 0) + (r.other?.sum ?? 0)
    expect(parts).toBe(r.sum)
    const counts = r.merchants.reduce((s, m) => s + m.count, 0) + (r.other?.count ?? 0)
    expect(counts).toBe(r.count)
  })

  it('folds the long tail past the cap into one "other" line', () => {
    const rows = buildCategoryBreakdown(
      Array.from({ length: 20 }, (_, i) => tx(`ספק ${i}`, 1000 - i, 'שונות')),
    )
    expect(rows[0].merchants).toHaveLength(15)
    expect(rows[0].other).toEqual({ merchants: 5, sum: 4915, count: 5 })
  })

  it('steps the cap down so a huge file cannot blow the message-size limit', () => {
    // 30 categories × 40 merchants each: at cap 15 that is 450 lines, over budget.
    // Names avoid a trailing "-<number>", which normalizeForLookup strips as a
    // branch code (it would collapse every merchant here into one).
    const txns: T[] = []
    for (let c = 0; c < 30; c++) {
      for (let m = 0; m < 40; m++) txns.push(tx(`ספק ${c} סוג ${m}`, 100, `קטגוריה ${c}`))
    }
    const rows = buildCategoryBreakdown(txns)
    const lines = rows.reduce((s, r) => s + r.merchants.length, 0)
    expect(lines).toBeLessThanOrEqual(250)
    expect(rows.every(r => r.other !== null)).toBe(true)
  })

  it('groups spellings that normalize to the same merchant', () => {
    const rows = buildCategoryBreakdown([
      tx('ארומה בע"מ', 30, 'בתי קפה'),
      tx('ארומה בעמ',  20, 'בתי קפה'),
    ])
    expect(rows[0].merchants).toHaveLength(1)
    expect(rows[0].merchants[0].sum).toBe(50)
  })

  // 'סניף 5' and '- 12' are what normalizeForLookup actually reduces to ''.
  // (An earlier version of this test used '...', which normalizes to itself and
  // therefore never exercised the fallback at all.)
  it.each(['סניף 5', '- 12'])('keeps a transaction whose desc normalizes to empty: %s', desc => {
    const rows = buildCategoryBreakdown([tx(desc, 80, 'שונות')])
    expect(rows[0].sum).toBe(80)
    expect(rows[0].merchants).toEqual([{ key: desc, name: desc, sum: 80, count: 1 }])
  })

  it('drops an unattributable row from the total too, so the parts always add up', () => {
    // A blank desc cannot be named. It must not sit in the header claiming an
    // amount no printed line accounts for — the prompt tells the model the
    // parts equal the total.
    const rows = buildCategoryBreakdown([tx('שופרסל', 500, 'מזון לבית'), tx('   ', 300, 'מזון לבית')])
    expect(rows[0].sum).toBe(500)
    expect(rows[0].merchants.reduce((s, m) => s + m.sum, 0)).toBe(rows[0].sum)
  })

  it('details only the categories it was asked to', () => {
    const rows = buildCategoryBreakdown(
      [tx('שופרסל', 500, 'מזון לבית'), tx('חברת חשמל', 400, 'חשמל')],
      new Set(['מזון לבית']),
    )
    const food = rows.find(r => r.category === 'מזון לבית')!
    const power = rows.find(r => r.category === 'חשמל')!
    expect(food.merchants).toHaveLength(1)
    expect(power.merchants).toHaveLength(0)
    expect(power.sum).toBe(400)      // still counted, just not broken down
  })

  it('handles a refund with no matching charge in the period', () => {
    const rows = buildCategoryBreakdown([
      tx('כלי בית', 200, 'ריהוט וציוד לבית'),
      tx('איקאה', 4500, 'ריהוט וציוד לבית', true),
    ])
    expect(rows[0].sum).toBe(-4300)
    const ikea = rows[0].merchants.find(m => m.name === 'איקאה')!
    expect(ikea).toEqual({ key: 'איקאה', name: 'איקאה', sum: -4500, count: 0 })
  })

  it('returns nothing for no transactions', () => {
    expect(buildCategoryBreakdown([])).toEqual([])
  })
})

describe('formatCategoryBreakdown', () => {
  it('renders the category line followed by its merchants', () => {
    const lines = formatCategoryBreakdown(buildCategoryBreakdown([
      tx('שופרסל', 300, 'מזון לבית'),
      tx('רמי לוי', 100, 'מזון לבית'),
    ]))
    expect(lines).toEqual([
      '(כל הסכומים כאן הם ממוצע חודשי — כבר חולקו ב‑1 ואחרי קיזוז זיכויים. אל תחלק שוב.)',
      '[משתנות] מזון לבית: 400 ש"ח לחודש (2 עסקאות ב‑1 חודשים)',
      '  - שופרסל: 300 לחודש (1)',
      '  - רמי לוי: 100 לחודש (1)',
    ])
  })

  it('truncates a very long merchant name so the block stays bounded', () => {
    const lines = formatCategoryBreakdown(buildCategoryBreakdown([
      tx('ח'.repeat(120), 50, 'שונות'),
    ]))
    const merchantLine = lines.find(l => l.startsWith('  - '))!
    expect(merchantLine.length).toBeLessThan(70)
    expect(merchantLine).toContain('…')
  })

  it('keeps the whole block far under the route message limit', () => {
    const txns: T[] = []
    for (let c = 0; c < 30; c++) {
      for (let m = 0; m < 40; m++) {
        txns.push(tx(`${'ר'.repeat(80)} ${c} סוג ${m}`, 100, `קטגוריה ${c}`))
      }
    }
    const text = formatCategoryBreakdown(buildCategoryBreakdown(txns)).join('\n')
    expect(text.length).toBeLessThan(30_000)   // route rejects over 40,000
  })

  it('renders the tail line when merchants were folded', () => {
    const lines = formatCategoryBreakdown(buildCategoryBreakdown(
      Array.from({ length: 17 }, (_, i) => tx(`ספק ${i}`, 100, 'שונות')),
    ))
    expect(lines[lines.length - 1]).toBe('  - שאר בתי העסק (2): 200 לחודש (2)')
  })

  // 🔴 This block used to send the period total plus a written instruction to
  // divide. On a real 3-month run the model divided the expenses and forgot the
  // income, and a household came out with ₪59,807 of "monthly" income. Asking a
  // model to do arithmetic the code can do is a bug in the code.
  it('divides the period total by the window instead of asking the model to', () => {
    const lines = formatCategoryBreakdown(buildCategoryBreakdown([tx('שופרסל', 7500, 'מזון לבית')]), 3)
    expect(lines[0]).toContain('אל תחלק שוב')
    expect(lines.find(l => l.startsWith('[משתנות]'))).toContain('2500 ש"ח לחודש')
  })

  it('divides the merchant lines too, not only the category total', () => {
    const lines = formatCategoryBreakdown(buildCategoryBreakdown([
      tx('שופרסל', 6000, 'מזון לבית'), tx('רמי לוי', 3000, 'מזון לבית'),
    ]), 3)
    expect(lines.find(l => l.includes('שופרסל'))).toContain('2000 לחודש')
    expect(lines.find(l => l.includes('רמי לוי'))).toContain('1000 לחודש')
  })

  it('treats a window of 0 as 1 rather than dividing by zero', () => {
    const lines = formatCategoryBreakdown(buildCategoryBreakdown([tx('שופרסל', 400, 'מזון לבית')]), 0)
    expect(lines.find(l => l.startsWith('[משתנות]'))).toContain('400 ש"ח לחודש')
  })

  // ⚠️ annualAmount is a YEARLY sum, so a monthly average is the wrong unit for
  // it. Printing one would leave the model to guess whether to multiply back
  // up, and either guess it makes is wrong by a factor of 12.
  it('does NOT divide an annual-section category, and says which unit it is', () => {
    const lines = formatCategoryBreakdown(buildCategoryBreakdown([tx('אל על', 6000, 'חופשה וטיול')]), 3)
    const line = lines.find(l => l.startsWith('[שנתיות]'))!
    expect(line).toContain('6000 ש"ח')       // the period total, not 2000
    expect(line).toContain('שנתי')
    expect(line).toContain('אל תחלק ב‑12')
  })

  it('still divides every other section in the same run', () => {
    const lines = formatCategoryBreakdown(buildCategoryBreakdown([
      tx('אל על', 6000, 'חופשה וטיול'),
      tx('שופרסל', 6000, 'מזון לבית'),
    ]), 3)
    expect(lines.find(l => l.startsWith('[שנתיות]'))).toContain('6000')
    expect(lines.find(l => l.startsWith('[משתנות]'))).toContain('2000 ש"ח לחודש')
  })

  it('never prints "(0)" for a refund-only merchant, and flags a negative category', () => {
    const lines = formatCategoryBreakdown(buildCategoryBreakdown([
      tx('כלי בית', 200, 'ריהוט וציוד לבית'),
      tx('איקאה', 4500, 'ריהוט וציוד לבית', true),
    ]))
    const ikea = lines.find(l => l.includes('איקאה'))!
    expect(ikea).toContain('זיכוי בלבד')
    expect(ikea).not.toMatch(/\(0\)/)
    expect(lines.find(l => l.startsWith('ריהוט'))).toContain('נטו שלילי')
  })
})

// The cross-check is the only automated defence against a hallucinated mapping.
const emptyResult = (): GeneratedMapping => ({
  creditScore: 0, creditCards: [], bankAccounts: [],
  income: [{ name: 'משכורת', amount: 12000 }],
  fixed: [], sub: [], ins: [], variable: [], annual: [],
  debts: [], installments: [], savings: [], businessIncome: [], businessExpenses: [], assessment: '',
})
const vtx = (amount: number, category: string, isRefund = false) => ({ amount, category, isRefund })

describe('validateMapping — period vs monthly', () => {
  it('does NOT warn when the AI correctly divided a 3-month upload', () => {
    const r = emptyResult()
    r.variable = [{ name: 'סופרמרקטים', amount: 2500, category: 'מזון לבית' }]
    const issues = validateMapping(r, [vtx(7500, 'מזון לבית')], 3)
    expect(issues.filter(i => i.message.includes('מזון לבית'))).toEqual([])
  })

  it('DOES warn when the AI echoed the 3-month period total as monthly', () => {
    const r = emptyResult()
    r.variable = [{ name: 'סופרמרקטים', amount: 7500, category: 'מזון לבית' }]
    const issues = validateMapping(r, [vtx(7500, 'מזון לבית')], 3)
    expect(issues.some(i => i.message.includes('מזון לבית') && i.message.includes('פער'))).toBe(true)
  })

  it('warns when the AI dropped a category that has real money behind it', () => {
    const issues = validateMapping(emptyResult(), [vtx(2500, 'מזון לבית')], 1)
    expect(issues.some(i => i.message.includes('אין שורה מתאימה'))).toBe(true)
  })

  it('stays quiet about a dropped category worth under ₪50/mo', () => {
    const issues = validateMapping(emptyResult(), [vtx(120, 'מזון לבית')], 3)
    expect(issues.some(i => i.message.includes('אין שורה מתאימה'))).toBe(false)
  })

  it('uses the same refund convention as the breakdown', () => {
    const r = emptyResult()
    r.variable = [{ name: 'סופרמרקטים', amount: 300, category: 'מזון לבית' }]
    const issues = validateMapping(r, [vtx(500, 'מזון לבית'), vtx(200, 'מזון לבית', true)], 1)
    expect(issues.filter(i => i.message.includes('מזון לבית'))).toEqual([])
  })
})

// The section is deterministic in constants.ts. Stating it — in the data we
// send and in the lab's row editor — is what stops rows landing in the wrong
// panel. Both consumers read this one function, so they cannot drift.
describe('sectionOfCategory', () => {
  it.each([
    ['ארנונה',       'fixed'],
    ['מזון לבית',    'variable'],
    ['חדר כושר',     'sub'],
    ['ביטוח רכב',    'ins'],
    ['חופשה וטיול',  'annual'],
    ['השקעות',       'skip'],
  ])('%s → %s', (cat, section) => {
    expect(sectionOfCategory(cat)).toBe(section)
  })

  it('routes הכנסות to income, not skip, so a misfiled salary row can be moved', () => {
    expect(sectionOfCategory('הכנסות')).toBe('income')
  })

  // 🔴 'החזר הלוואות' is in FIXED_CATEGORIES, so this used to tag a mortgage
  // repayment "[קבועות]" and the model dutifully filed it there — losing the
  // balance, the rate and the fact that the payment ever ends.
  it('routes a loan repayment to debts even though its category is a fixed one', () => {
    expect(sectionOfCategory('החזר הלוואות')).toBe('debts')
  })

  it('returns null for an unknown or empty category', () => {
    expect(sectionOfCategory('קטגוריה שלא קיימת')).toBeNull()
    expect(sectionOfCategory('')).toBeNull()
  })
})

// A rule that only holds when the model cooperates is not a rule. The prompt
// says it, the category tag says it, and this says it a third time.
describe('moveLoansToDebts', () => {
  const withRows = (over: Partial<GeneratedMapping>): GeneratedMapping => ({
    creditScore: 0, creditCards: [], bankAccounts: [],
    income: [], fixed: [], sub: [], ins: [], variable: [], annual: [],
    debts: [], installments: [], savings: [],
    businessIncome: [], businessExpenses: [], assessment: '', ...over,
  })

  it('moves a repayment out of קבועות and into הלוואות', () => {
    const out = moveLoansToDebts(withRows({
      fixed: [
        { name: 'ארנונה', amount: 620, category: 'ארנונה' },
        { name: 'החזר הלוואה', amount: 900, category: 'החזר הלוואות' },
      ],
    }))
    expect(out.fixed.map(r => r.name)).toEqual(['ארנונה'])
    expect(out.debts).toHaveLength(1)
    expect(out.debts[0]).toMatchObject({ name: 'החזר הלוואה', monthlyPayment: 900 })
  })

  it('leaves the balance, rate and term at 0 rather than inventing them', () => {
    const out = moveLoansToDebts(withRows({
      fixed: [{ name: 'משכנתה', amount: 4500, category: 'החזר הלוואות' }],
    }))
    expect(out.debts[0]).toMatchObject({
      remainingBalance: 0, originalBalance: 0, interestRate: 0, remainingMonths: 0,
    })
  })

  it('carries the confidence and source across so the review queue still sees it', () => {
    const out = moveLoansToDebts(withRows({
      fixed: [{ name: 'הלוואה', amount: 900, category: 'החזר הלוואות', confidence: 'low', source: 'עו"ש' }],
    }))
    expect(out.debts[0]).toMatchObject({ confidence: 'low', source: 'עו"ש' })
  })

  it('sweeps every expense section, not only קבועות', () => {
    const out = moveLoansToDebts(withRows({
      variable: [{ name: 'הלוואה א', amount: 100, category: 'החזר הלוואות' }],
      sub:      [{ name: 'הלוואה ב', amount: 200, category: 'החזר הלוואות' }],
      ins:      [{ name: 'הלוואה ג', amount: 300, category: 'החזר הלוואות' }],
    }))
    expect(out.variable).toHaveLength(0)
    expect(out.sub).toHaveLength(0)
    expect(out.ins).toHaveLength(0)
    expect(out.debts).toHaveLength(3)
  })

  // The model sometimes does the right thing AND leaves a copy behind. Two rows
  // for one loan would double the household's debt service.
  it('does not duplicate a loan the model already put in debts', () => {
    const out = moveLoansToDebts(withRows({
      fixed: [{ name: 'משכנתה', amount: 4500, category: 'החזר הלוואות' }],
      debts: [{
        name: 'משכנתה', monthlyPayment: 4500, originalBalance: 800000,
        remainingBalance: 700000, interestRate: 3.5, remainingMonths: 240,
      }],
    }))
    expect(out.debts).toHaveLength(1)
    expect(out.debts[0].remainingBalance).toBe(700000)   // the richer row survived
  })

  it('leaves a mapping with no loan rows untouched', () => {
    const input = withRows({ fixed: [{ name: 'ארנונה', amount: 620, category: 'ארנונה' }] })
    const out = moveLoansToDebts(input)
    expect(out.fixed).toEqual(input.fixed)
    expect(out.debts).toEqual([])
  })
})

// A debt with no balance is a debt the client's net worth prices at zero, and
// the payoff order is built from balances. On the real run a ₪80,000 loan came
// back with a monthly payment, a term, and remainingBalance 0.
describe('fillLoanBalances', () => {
  const withDebts = (debts: GeneratedMapping['debts']): GeneratedMapping => ({
    creditScore: 0, creditCards: [], bankAccounts: [],
    income: [], fixed: [], sub: [], ins: [], variable: [], annual: [],
    debts, installments: [], savings: [],
    businessIncome: [], businessExpenses: [], assessment: '',
  })
  const loan = (over: Partial<GeneratedMapping['debts'][number]> = {}) => ({
    name: 'הלוואה בנקאית', originalBalance: 0, remainingBalance: 0,
    interestRate: 0, remainingMonths: 0, monthlyPayment: 0, ...over,
  })

  it('computes the balance from payment, term and rate', () => {
    const out = fillLoanBalances(withDebts([
      loan({ monthlyPayment: 1500, remainingMonths: 60, interestRate: 6 }),
    ]))
    // PV of ₪1,500 × 60 at 0.5%/mo ≈ ₪77,600. Below the undiscounted ₪90,000.
    expect(out.debts[0].remainingBalance).toBeGreaterThan(75_000)
    expect(out.debts[0].remainingBalance).toBeLessThan(80_000)
  })

  it('falls back to payment × term when the rate is unknown', () => {
    const out = fillLoanBalances(withDebts([
      loan({ monthlyPayment: 1000, remainingMonths: 24 }),
    ]))
    expect(out.debts[0].remainingBalance).toBe(24_000)
  })

  // 🔴 A number read off the schedule always beats a number derived from three
  // other numbers also read off it.
  it('never overwrites a balance the model actually read', () => {
    const input = withDebts([
      loan({ remainingBalance: 42_000, monthlyPayment: 1000, remainingMonths: 24 }),
    ])
    expect(fillLoanBalances(input)).toBe(input)
    expect(fillLoanBalances(input).debts[0].remainingBalance).toBe(42_000)
  })

  it('stays out of it when there is nothing to compute from', () => {
    const noTerm = withDebts([loan({ monthlyPayment: 1000 })])
    expect(fillLoanBalances(noTerm)).toBe(noTerm)
    const noPayment = withDebts([loan({ remainingMonths: 24 })])
    expect(fillLoanBalances(noPayment)).toBe(noPayment)
  })

  it('cannot report owing more than was borrowed', () => {
    const out = fillLoanBalances(withDebts([
      loan({ originalBalance: 20_000, monthlyPayment: 1000, remainingMonths: 24 }),
    ]))
    expect(out.debts[0].remainingBalance).toBe(20_000)
  })

  // A computed balance and a quoted one must never look the same on screen.
  it('stamps the row so a computed balance is never mistaken for a quoted one', () => {
    const out = fillLoanBalances(withDebts([
      loan({ monthlyPayment: 1000, remainingMonths: 24, source: 'לוח סילוקין' }),
    ]))
    expect(out.debts[0].source).toContain('לוח סילוקין')
    expect(out.debts[0].source).toContain('יתרה מחושבת')
    expect(out.debts[0].confidence).toBe('medium')
  })
})

// Eight "שונות — ..." rows are eight things to read, judge and approve, and
// together they are why an advisor stops reading the mapping. Nothing is lost:
// the merchants live in the transaction detail, which is where they belong.
describe('consolidateByCategory', () => {
  const withRows = (over: Partial<GeneratedMapping>): GeneratedMapping => ({
    creditScore: 0, creditCards: [], bankAccounts: [],
    income: [], fixed: [], sub: [], ins: [], variable: [], annual: [],
    debts: [], installments: [], savings: [],
    businessIncome: [], businessExpenses: [], assessment: '', ...over,
  })

  it('merges every row of a category into one named after it', () => {
    const out = consolidateByCategory(withRows({
      variable: [
        { name: 'שונות — עמית כלים', amount: 87,  category: 'שונות' },
        { name: 'שונות — פרחי רונית', amount: 67, category: 'שונות' },
        { name: 'שונות — שאר',        amount: 267, category: 'שונות' },
        { name: 'מזון',               amount: 2000, category: 'מזון לבית' },
      ],
    }))
    expect(out.variable).toHaveLength(2)
    expect(out.variable.find(r => r.category === 'שונות')).toMatchObject({ name: 'שונות', amount: 421 })
    expect(out.variable.find(r => r.category === 'מזון לבית')!.amount).toBe(2000)
  })

  it('keeps the section total unchanged', () => {
    const before = withRows({
      variable: [
        { name: 'א', amount: 1547, category: 'ביגוד והנעלה' },
        { name: 'ב', amount: 18,   category: 'ביגוד והנעלה' },
      ],
    })
    const sum = (m: GeneratedMapping) => m.variable.reduce((s, r) => s + r.amount, 0)
    expect(sum(consolidateByCategory(before))).toBe(sum(before))
  })

  // A merged row is only as trustworthy as its least certain part — otherwise a
  // doubtful row hides inside a confident one and never reaches the queue.
  it('takes the lowest confidence of the rows it merged', () => {
    const out = consolidateByCategory(withRows({
      variable: [
        { name: 'א', amount: 100, category: 'שונות', confidence: 'high', reviewed: true },
        { name: 'ב', amount: 100, category: 'שונות', confidence: 'low',  reviewed: false },
      ],
    }))
    expect(out.variable[0]).toMatchObject({ confidence: 'low', reviewed: false })
  })

  it('leaves rows with no category alone rather than folding them together', () => {
    const out = consolidateByCategory(withRows({
      variable: [{ name: 'א', amount: 10 }, { name: 'ב', amount: 20 }],
    }))
    expect(out.variable).toHaveLength(2)
  })

  // 🔴 In an expense section the category IS the unit. In income it is not:
  // every row carries "הכנסות", so merging by category produced ONE row named
  // "הכנסות" — a single ₪25,921 where a salary, a pension and a one-off
  // reserve-duty grant used to be told apart.
  it('never merges income — its rows are sources, not categories', () => {
    const out = consolidateByCategory(withRows({
      income: [
        { name: 'משכורת', amount: 14000, category: 'הכנסות' },
        { name: 'ביטוח לאומי מילואים', amount: 7890, category: 'הכנסות' },
        { name: 'מענק מילואים', amount: 1936, category: 'הכנסות' },
      ],
    }))
    expect(out.income).toHaveLength(3)
    expect(out.income.map(r => r.name)).toContain('מענק מילואים')
  })

  // Same shape, different reason: ALL_CATEGORIES has only a generic "ביטוח",
  // so merging collapsed car, home, health and life into one meaningless line.
  it('never merges insurance — one row per policy', () => {
    const out = consolidateByCategory(withRows({
      ins: [
        { name: 'ביטוח בריאות הראל', amount: 41,  category: 'ביטוח' },
        { name: 'ביטוח דירה הראל',   amount: 270, category: 'ביטוח' },
        { name: 'הפניקס ביטוח חיים', amount: 57,  category: 'ביטוח' },
      ],
    }))
    expect(out.ins).toHaveLength(3)
  })

  it('still merges the expense sections it is meant to', () => {
    const out = consolidateByCategory(withRows({
      variable: [
        { name: 'שונות — א', amount: 10, category: 'שונות' },
        { name: 'שונות — ב', amount: 20, category: 'שונות' },
      ],
      sub: [
        { name: 'מנויים — נטפליקס', amount: 40, category: 'מנויים' },
        { name: 'מנויים — ספוטיפיי', amount: 20, category: 'מנויים' },
      ],
    }))
    expect(out.variable).toHaveLength(1)
    expect(out.sub).toHaveLength(1)
  })

  // "ביטוח בריאות מכבי" with an empty amount adds nothing to any total and
  // reads as an unfinished row the advisor has to decide about.
  it('drops a row the model named but never priced', () => {
    const out = dropEmptyRows(withRows({
      ins: [
        { name: 'ביטוח הראל (כללי)', amount: 1380, category: 'ביטוח' },
        { name: 'ביטוח בריאות מכבי', amount: 0, category: 'ביטוח' },
      ],
      annual: [{ name: 'ריק', annualAmount: 0 }, { name: 'חופשה', annualAmount: 1127 }],
    }))
    expect(out.ins).toHaveLength(1)
    expect(out.annual.map(r => r.name)).toEqual(['חופשה'])
  })

  it('keeps every row that carries a number', () => {
    const rows = withRows({ fixed: [{ name: 'ארנונה', amount: 620, category: 'ארנונה' }] })
    expect(dropEmptyRows(rows).fixed).toHaveLength(1)
  })

  it('merges within a section, never across sections', () => {
    const out = consolidateByCategory(withRows({
      fixed:    [{ name: 'א', amount: 100, category: 'ארנונה' }],
      variable: [{ name: 'ב', amount: 200, category: 'ארנונה' }],
    }))
    expect(out.fixed).toHaveLength(1)
    expect(out.variable).toHaveLength(1)
  })
})

// A confirmed annual charge is pulled OUT of the monthly expenses on purpose.
// Removing it was only half the job: when the model failed to put it back into
// the annual section, the expense left the mapping without a word.
describe('ensureAnnualItems', () => {
  const base: GeneratedMapping = {
    creditScore: 0, creditCards: [], bankAccounts: [],
    income: [], fixed: [], sub: [], ins: [], variable: [], annual: [],
    debts: [], installments: [], savings: [],
    businessIncome: [], businessExpenses: [], assessment: '',
  }
  const items = [{ name: 'העברה/אלוף הספות', category: 'ריהוט והבית', annualAmount: 3700 }]

  it('adds a confirmed annual expense the model dropped', () => {
    const out = ensureAnnualItems(base, items)
    expect(out.annual).toHaveLength(1)
    expect(out.annual[0]).toMatchObject({ annualAmount: 3700, source: 'אישור היועץ' })
  })

  it('does not duplicate one the model already returned', () => {
    const withIt = { ...base, annual: [{ name: 'העברה/אלוף הספות', annualAmount: 3700 }] }
    expect(ensureAnnualItems(withIt, items).annual).toHaveLength(1)
  })

  it('matches on the normalized name, not the exact string', () => {
    const withIt = { ...base, annual: [{ name: 'העברה/אלוף הספות בע"מ', annualAmount: 3700 }] }
    expect(ensureAnnualItems(withIt, items).annual).toHaveLength(1)
  })

  // 🔴 The real duplicate, 2026-08-11: the model qualified the name and the
  // advisor's confirmation kept the statement's prefix. Exact matching saw two
  // different charges and one ₪3,700 transfer became ₪7,400 a year.
  it('does not duplicate when the model qualified the name', () => {
    const withIt = { ...base, annual: [{ name: 'אלוף הספות (אוכל בחוץ ובילויים)', annualAmount: 3700 }] }
    expect(ensureAnnualItems(withIt, items).annual).toHaveLength(1)
  })

  it('does not duplicate when the confirmation is the shorter name', () => {
    const withIt = { ...base, annual: [{ name: 'העברה/אלוף הספות — ריהוט', annualAmount: 3700 }] }
    expect(ensureAnnualItems(withIt, [{ name: 'אלוף הספות', category: 'ריהוט והבית', annualAmount: 3700 }]).annual)
      .toHaveLength(1)
  })

  // Containment must not become "anything matches anything": two unrelated
  // annual expenses still have to survive as two rows.
  it('still adds a genuinely different expense', () => {
    const withIt = { ...base, annual: [{ name: 'אלוף הספות (אוכל בחוץ ובילויים)', annualAmount: 3700 }] }
    const out = ensureAnnualItems(withIt, [
      ...items,
      { name: 'ביטוח רכב הראל', category: 'ביטוח', annualAmount: 4200 },
    ])
    expect(out.annual).toHaveLength(2)
    expect(out.annual.map(a => a.annualAmount)).toContain(4200)
  })

  it('does nothing when there is nothing confirmed', () => {
    expect(ensureAnnualItems(base, [])).toBe(base)
  })
})

// ensureAnnualItems only guards the moment of generation, and the result is
// persisted — so a mapping made before the fix keeps its duplicate for as long
// as it lives. The same rule has to be able to clean up after the fact.
describe('findAnnualDuplicates / dedupeAnnual', () => {
  const withAnnual = (annual: { name: string; annualAmount: number }[]): GeneratedMapping => ({
    creditScore: 0, creditCards: [], bankAccounts: [],
    income: [], fixed: [], sub: [], ins: [], variable: [], annual,
    debts: [], installments: [], savings: [],
    businessIncome: [], businessExpenses: [], assessment: '',
  })

  it('finds the pair from the real result', () => {
    const rows = [
      { name: 'חופשה וטיול', annualAmount: 1127 },
      { name: 'אלוף הספות (חופשה/בילוי)', annualAmount: 3700 },
      { name: 'העברה/אלוף הספות', annualAmount: 3700 },
    ]
    expect(findAnnualDuplicates(rows)).toEqual([[1, 2]])
  })

  it('keeps the first of the pair and drops the rest', () => {
    const out = dedupeAnnual(withAnnual([
      { name: 'אלוף הספות (חופשה/בילוי)', annualAmount: 3700 },
      { name: 'העברה/אלוף הספות', annualAmount: 3700 },
    ]))
    expect(out.annual).toHaveLength(1)
    expect(out.annual[0].name).toBe('אלוף הספות (חופשה/בילוי)')
  })

  // Two policies at the same insurer share words but no consecutive pair. If
  // this ever merges them, a real annual expense disappears.
  it('leaves two genuinely different expenses alone', () => {
    const rows = [
      { name: 'ביטוח רכב הראל', annualAmount: 4200 },
      { name: 'ביטוח דירה הראל', annualAmount: 1800 },
      { name: 'חופשה וטיול', annualAmount: 1127 },
    ]
    expect(findAnnualDuplicates(rows)).toEqual([])
    expect(dedupeAnnual(withAnnual(rows)).annual).toHaveLength(3)
  })

  it('groups three copies of one charge together, not into pairs', () => {
    const rows = [
      { name: 'אלוף הספות', annualAmount: 3700 },
      { name: 'העברה/אלוף הספות', annualAmount: 3700 },
      { name: 'אלוף הספות (ריהוט)', annualAmount: 3700 },
    ]
    expect(findAnnualDuplicates(rows)).toEqual([[0, 1, 2]])
    expect(dedupeAnnual(withAnnual(rows)).annual).toHaveLength(1)
  })

  it('returns the mapping untouched when there is nothing to merge', () => {
    const m = withAnnual([{ name: 'חופשה וטיול', annualAmount: 1127 }])
    expect(dedupeAnnual(m)).toBe(m)
    expect(findAnnualDuplicates([])).toEqual([])
  })
})

// Reading the פירוט without being able to change it is half a tool. The rule is
// deliberately boring: take the transaction's MONTHLY share out of the row it
// was counted in, and put it into a row of the destination category.
describe('applyTxnRecategorization', () => {
  const withRows = (over: Partial<GeneratedMapping>): GeneratedMapping => ({
    creditScore: 0, creditCards: [], bankAccounts: [],
    income: [], fixed: [], sub: [], ins: [], variable: [], annual: [],
    debts: [], installments: [], savings: [],
    businessIncome: [], businessExpenses: [], assessment: '', ...over,
  })

  const clothes = () => withRows({
    variable: [
      { name: 'ביגוד והנעלה (בהצדעה)', amount: 1547, category: 'ביגוד והנעלה' },
      { name: 'שאר ביגוד',             amount: 18,   category: 'ביגוד והנעלה' },
      { name: 'מסעדות',                amount: 900,  category: 'אוכל בחוץ ובילויים' },
    ],
  })

  it('debits the source and credits the destination by the monthly share', () => {
    const { mapping } = applyTxnRecategorization(clothes(), {
      from: 'ביגוד והנעלה', to: 'אוכל בחוץ ובילויים', monthlyDelta: 6, merchant: 'דרייב קפה שורש',
    })
    expect(mapping.variable.find(r => r.name === 'ביגוד והנעלה (בהצדעה)')!.amount).toBe(1541)
    expect(mapping.variable.find(r => r.name === 'מסעדות')!.amount).toBe(906)
  })

  it('prefers the row named after the merchant over the biggest one', () => {
    const m = withRows({
      variable: [
        { name: 'כללי',      amount: 1000, category: 'ביגוד והנעלה' },
        { name: 'דרייב קפה', amount: 50,   category: 'ביגוד והנעלה' },
      ],
    })
    const { mapping } = applyTxnRecategorization(m, {
      from: 'ביגוד והנעלה', to: 'אוכל בחוץ ובילויים', monthlyDelta: 6, merchant: 'דרייב קפה',
    })
    expect(mapping.variable.find(r => r.name === 'דרייב קפה')!.amount).toBe(44)
    expect(mapping.variable.find(r => r.name === 'כללי')!.amount).toBe(1000)
  })

  it('creates a row in the destination when that category has none', () => {
    const { mapping } = applyTxnRecategorization(clothes(), {
      from: 'ביגוד והנעלה', to: 'מזון לבית', monthlyDelta: 30, merchant: 'שופרסל',
    })
    const created = mapping.variable.find(r => r.category === 'מזון לבית')!
    expect(created).toMatchObject({ name: 'שופרסל', amount: 30, source: 'תיקון ידני' })
  })

  it('moves a row across sections when the destination lives in another one', () => {
    const { mapping } = applyTxnRecategorization(clothes(), {
      from: 'ביגוד והנעלה', to: 'ארנונה', monthlyDelta: 100, merchant: 'עיריית תל אביב',
    })
    expect(mapping.fixed.find(r => r.category === 'ארנונה')!.amount).toBe(100)
    expect(mapping.variable.find(r => r.name === 'ביגוד והנעלה (בהצדעה)')!.amount).toBe(1447)
  })

  // A row driven negative would quietly inflate the household's surplus, which
  // is the one direction of error nothing downstream can see.
  it('never drives a row below zero, and removes it when it empties', () => {
    const { mapping } = applyTxnRecategorization(clothes(), {
      from: 'ביגוד והנעלה', to: 'מזון לבית', monthlyDelta: 99999, merchant: 'בהצדעה',
    })
    expect(mapping.variable.every(r => r.amount >= 0)).toBe(true)
    expect(mapping.variable.find(r => r.name === 'ביגוד והנעלה (בהצדעה)')).toBeUndefined()
  })

  // Silence here would show the advisor a total that grew out of nowhere.
  it('reports when there was nothing to debit', () => {
    const { nothingDebited } = applyTxnRecategorization(clothes(), {
      from: 'קטגוריה שאין לה שורה', to: 'מזון לבית', monthlyDelta: 30, merchant: 'שופרסל',
    })
    expect(nothingDebited).toBe(true)
  })

  it('does nothing at all for a no-op move or a zero amount', () => {
    const before = clothes()
    expect(applyTxnRecategorization(before, {
      from: 'ביגוד והנעלה', to: 'ביגוד והנעלה', monthlyDelta: 10, merchant: 'x',
    }).mapping.variable).toEqual(before.variable)
    expect(applyTxnRecategorization(before, {
      from: 'ביגוד והנעלה', to: 'מזון לבית', monthlyDelta: 0, merchant: 'x',
    }).mapping.variable).toEqual(before.variable)
  })
})

describe('formatCategoryBreakdown — section tag', () => {
  it('prefixes each category with the section it belongs to', () => {
    const lines = formatCategoryBreakdown(buildCategoryBreakdown([
      tx('חברת חשמל', 400, 'חשמל'),
      tx('שופרסל',    900, 'מזון לבית'),
    ]))
    expect(lines.find(l => l.includes('חשמל:'))).toContain('[קבועות]')
    expect(lines.find(l => l.includes('מזון לבית:'))).toContain('[משתנות]')
  })

  it('leaves an unknown category untagged rather than guessing', () => {
    const lines = formatCategoryBreakdown(buildCategoryBreakdown([tx('משהו', 100, 'קטגוריה מומצאת')]))
    expect(lines.find(l => l.startsWith('קטגוריה מומצאת'))).toBeTruthy()
    expect(lines.some(l => l.includes('[undefined]'))).toBe(false)
  })
})

describe('income block', () => {
  const dep = (desc: string, amount: number, date = '') => ({ desc, amount, date })

  it('groups deposits by payer, biggest first', () => {
    const lines = groupByName([dep('משכורת אלפא', 14000), dep('משכורת אלפא', 14000), dep('קצבת ילדים', 400)])
    expect(lines).toEqual([
      { name: 'משכורת אלפא', sum: 28000, count: 2, months: 0 },
      { name: 'קצבת ילדים',  sum: 400,   count: 1, months: 0 },
    ])
  })

  // Dividing alone turns one wrong answer into another: a ₪5,808 reserve-duty
  // grant paid once in three months is not ₪1,936 of monthly income. The count
  // of DISTINCT months is what lets the model tell a salary from a windfall.
  it('counts the distinct months a payer appeared in', () => {
    const lines = groupByName([
      dep('משכורת', 14000, '2026-06-05'),
      dep('משכורת', 14000, '2026-07-05'),
      dep('משכורת', 14000, '2026-08-05'),
      dep('מענק מילואים', 5808, '2026-07-20'),
    ])
    expect(lines.find(l => l.name === 'משכורת')!.months).toBe(3)
    expect(lines.find(l => l.name === 'מענק מילואים')!.months).toBe(1)
  })

  it('counts a payer paid twice in one month as one month, not two', () => {
    const lines = groupByName([dep('בונוס', 100, '2026-06-01'), dep('בונוס', 100, '2026-06-20')])
    expect(lines[0]).toMatchObject({ count: 2, months: 1 })
  })

  it('leaves months at 0 when the dates are not ISO, rather than guessing', () => {
    expect(groupByName([dep('משכורת', 14000, '05/06/2026')])[0].months).toBe(0)
  })

  it('folds a long tail so the block stays bounded', () => {
    const lines = groupByName(Array.from({ length: 30 }, (_, i) => dep(`מקור ${i}`, 100)), 25)
    expect(lines).toHaveLength(26)
    expect(lines[25].name).toContain('שאר ההפקדות (5)')
  })

  // The bug this whole change exists for: ₪42,000 of deposits over three months
  // is ₪14,000 a month, and the block used to hand over 42,000 with a note.
  it('divides the deposits by the window instead of asking the model to', () => {
    const out = formatIncomeBreakdown(groupByName([dep('משכורת', 42000)]), 3)
    expect(out[0]).toContain('אל תחלק שוב')
    const line = out.find(l => l.includes('משכורת'))!
    expect(line).toContain('14000 לחודש')
    expect(line).toContain('סה"כ 42000')     // the period total stays visible
  })

  it('says in how many months each source appeared', () => {
    const out = formatIncomeBreakdown(groupByName([
      dep('מענק מילואים', 5808, '2026-07-20'),
    ]), 3)
    expect(out.find(l => l.includes('מענק'))).toContain('הופיע ב‑1 מתוך 3 חודשים')
  })

  it('treats a window of 0 as 1 rather than dividing by zero', () => {
    const out = formatIncomeBreakdown(groupByName([dep('משכורת', 14000)]), 0)
    expect(out.find(l => l.includes('משכורת'))).toContain('14000 לחודש')
  })

  it('renders nothing when there are no deposits', () => {
    expect(formatIncomeBreakdown([], 3)).toEqual([])
  })
})

describe('detectMonthSpan', () => {
  it('counts distinct calendar months', () => {
    expect(detectMonthSpan([
      { date: '2026-06-03' }, { date: '2026-06-28' }, { date: '2026-07-01' }, { date: '2026-08-15' },
    ])).toBe(3)
  })

  it('returns 0 rather than guessing when the dates are not ISO', () => {
    expect(detectMonthSpan([{ date: '03/06/2026' }, { date: '' }])).toBe(0)
  })
})

// Deleting a charge in the פירוט, or fixing its amount, has to move the row
// above it too. Otherwise the advisor removes a ₪1,289 charge that was never
// the household's, the detail loses it, and the total still counts it — a row
// that no longer matches its own detail, which nobody catches because both
// halves look right on their own.
describe('adjustCategoryAmount', () => {
  const withRows = (over: Partial<GeneratedMapping>): GeneratedMapping => ({
    creditScore: 0, creditCards: [], bankAccounts: [],
    income: [], fixed: [], sub: [], ins: [], variable: [], annual: [],
    debts: [], installments: [], savings: [],
    businessIncome: [], businessExpenses: [], assessment: '', ...over,
  })

  const food = () => withRows({
    variable: [
      { name: 'מזון לבית',        amount: 900, category: 'מזון לבית' },
      { name: 'אוכל בחוץ',        amount: 500, category: 'אוכל בחוץ ובילויים' },
    ],
  })

  it('takes the monthly share out of the row when a charge is deleted', () => {
    const m = adjustCategoryAmount(food(), { category: 'מזון לבית', merchant: 'שופרסל', monthlyDelta: -100 })
    expect(m.variable.find(r => r.category === 'מזון לבית')!.amount).toBe(800)
    expect(m.variable.find(r => r.category === 'אוכל בחוץ ובילויים')!.amount).toBe(500)
  })

  it('adds it back when an amount is corrected upwards', () => {
    const m = adjustCategoryAmount(food(), { category: 'מזון לבית', merchant: 'שופרסל', monthlyDelta: 250 })
    expect(m.variable.find(r => r.category === 'מזון לבית')!.amount).toBe(1150)
  })

  it('prefers the row named after the merchant over the biggest one', () => {
    const m = withRows({
      variable: [
        { name: 'כללי',    amount: 1000, category: 'מזון לבית' },
        { name: 'שופרסל',  amount: 300,  category: 'מזון לבית' },
      ],
    })
    const out = adjustCategoryAmount(m, { category: 'מזון לבית', merchant: 'שופרסל', monthlyDelta: -50 })
    expect(out.variable.find(r => r.name === 'שופרסל')!.amount).toBe(250)
    expect(out.variable.find(r => r.name === 'כללי')!.amount).toBe(1000)
  })

  // A row that cannot absorb the debit would go negative and quietly inflate
  // the household's surplus — the one direction of error nobody questions.
  it('never takes a row below zero', () => {
    const m = adjustCategoryAmount(food(), { category: 'מזון לבית', merchant: 'שופרסל', monthlyDelta: -5000 })
    expect(m.variable.some(r => r.category === 'מזון לבית')).toBe(false)
    expect(m.variable).toHaveLength(1)
  })

  it('creates a row when the category has none and money is being added', () => {
    const m = adjustCategoryAmount(withRows({}), { category: 'מזון לבית', merchant: 'שופרסל', monthlyDelta: 120 })
    expect(m.variable).toEqual([expect.objectContaining({ name: 'שופרסל', amount: 120, category: 'מזון לבית' })])
  })

  it('does nothing when there is nothing to take it from', () => {
    const m = withRows({})
    expect(adjustCategoryAmount(m, { category: 'מזון לבית', merchant: 'שופרסל', monthlyDelta: -120 }).variable).toEqual([])
  })

  it('leaves the mapping alone on a zero change or an unknown category', () => {
    const m = food()
    expect(adjustCategoryAmount(m, { category: 'מזון לבית', merchant: 'x', monthlyDelta: 0 }).variable).toEqual(m.variable)
    expect(adjustCategoryAmount(m, { category: 'קטגוריה שלא קיימת', merchant: 'x', monthlyDelta: -50 }).variable).toEqual(m.variable)
  })

  it('does not touch a row of another category', () => {
    const m = adjustCategoryAmount(food(), { category: 'אוכל בחוץ ובילויים', merchant: 'WOLT', monthlyDelta: -200 })
    expect(m.variable.find(r => r.category === 'מזון לבית')!.amount).toBe(900)
    expect(m.variable.find(r => r.category === 'אוכל בחוץ ובילויים')!.amount).toBe(300)
  })
})
