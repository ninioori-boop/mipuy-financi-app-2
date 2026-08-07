import { describe, it, expect } from 'vitest'
import {
  buildCategoryBreakdown, formatCategoryBreakdown, detectMonthSpan, validateMapping,
  sectionOfCategory, groupByName, formatIncomeBreakdown,
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
      { name: 'שופרסל דיל', sum: 500, count: 2 },
      { name: 'רמי לוי',    sum: 400, count: 1 },
    ])
  })

  it('nets refunds into the merchant and the category, and never counts them', () => {
    const rows = buildCategoryBreakdown([
      tx('זארה', 500, 'ביגוד'),
      tx('זארה', 200, 'ביגוד', true),
    ])
    expect(rows[0]).toMatchObject({ sum: 300, count: 1 })
    expect(rows[0].merchants).toEqual([{ name: 'זארה', sum: 300, count: 1 }])
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
    expect(rows[0].merchants).toEqual([{ name: desc, sum: 80, count: 1 }])
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
    expect(ikea).toEqual({ name: 'איקאה', sum: -4500, count: 0 })
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
      '(כל הסכומים כאן הם סך הכל על פני חודש אחד, אחרי קיזוז זיכויים)',
      '[משתנות] מזון לבית: 400 ש"ח (2 עסקאות)',
      '  - שופרסל: 300 (1)',
      '  - רמי לוי: 100 (1)',
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
    expect(lines[lines.length - 1]).toBe('  - שאר בתי העסק (2): 200 (2)')
  })

  it('states the period so the model cannot read a 3-month total as monthly', () => {
    const lines = formatCategoryBreakdown(buildCategoryBreakdown([tx('שופרסל', 7500, 'מזון לבית')]), 3)
    expect(lines[0]).toContain('3 חודשים')
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
  debts: [], installments: [], savings: [], assessment: '',
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

  it('returns null for an unknown or empty category', () => {
    expect(sectionOfCategory('קטגוריה שלא קיימת')).toBeNull()
    expect(sectionOfCategory('')).toBeNull()
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
  const dep = (desc: string, amount: number) => ({ desc, amount })

  it('groups deposits by payer, biggest first', () => {
    const lines = groupByName([dep('משכורת אלפא', 14000), dep('משכורת אלפא', 14000), dep('קצבת ילדים', 400)])
    expect(lines).toEqual([
      { name: 'משכורת אלפא', sum: 28000, count: 2 },
      { name: 'קצבת ילדים',  sum: 400,   count: 1 },
    ])
  })

  it('folds a long tail so the block stays bounded', () => {
    const lines = groupByName(Array.from({ length: 30 }, (_, i) => dep(`מקור ${i}`, 100)), 25)
    expect(lines).toHaveLength(26)
    expect(lines[25].name).toContain('שאר ההפקדות (5)')
  })

  it('states that the figures are a period total, so they are not read as monthly', () => {
    const out = formatIncomeBreakdown(groupByName([dep('משכורת', 42000)]), 3)
    expect(out[0]).toContain('3 חודשים')
    expect(out[1]).toContain('42000')
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
