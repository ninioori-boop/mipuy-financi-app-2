import { describe, it, expect } from 'vitest'
import { buildCategoryBreakdown, formatCategoryBreakdown } from '@/lib/autoMap'

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

  it('does not drop a transaction whose description is punctuation only', () => {
    const rows = buildCategoryBreakdown([tx('...', 80, 'שונות')])
    expect(rows[0].sum).toBe(80)
    expect(rows[0].merchants).toHaveLength(1)
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
      'מזון לבית: 400 ש"ח (2 עסקאות)',
      '  - שופרסל: 300 (1)',
      '  - רמי לוי: 100 (1)',
    ])
  })

  it('truncates a very long merchant name so the block stays bounded', () => {
    const lines = formatCategoryBreakdown(buildCategoryBreakdown([
      tx('ח'.repeat(120), 50, 'שונות'),
    ]))
    expect(lines[1].length).toBeLessThan(70)
    expect(lines[1]).toContain('…')
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
})
