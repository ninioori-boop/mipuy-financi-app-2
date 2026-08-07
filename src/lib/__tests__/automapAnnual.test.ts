import { describe, it, expect } from 'vitest'
import {
  ANNUAL_CHECKLIST, ONE_OFF_MIN, detectOneOffCharges, formatAnnualItems, oneOffKey,
  type AnnualItem,
} from '@/lib/automapAnnual'
import { buildCategoryBreakdown } from '@/lib/autoMap'
import { ALL_CATEGORIES } from '@/lib/constants'

const tx = (desc: string, amount: number, category: string) =>
  ({ desc, amount, category, isRefund: false })

describe('ANNUAL_CHECKLIST', () => {
  it('covers the four groups Ori asked for', () => {
    expect([...new Set(ANNUAL_CHECKLIST.map(i => i.group))]).toEqual([
      'ביטוחים', 'רכב ואגרות', 'ילדים וחינוך', 'אירועים וחופשות',
    ])
  })

  it('every item maps to a real category, so a confirmed amount lands somewhere valid', () => {
    for (const item of ANNUAL_CHECKLIST) {
      expect(ALL_CATEGORIES, `${item.label} → ${item.category}`).toContain(item.category)
    }
  })

  it('has unique keys — the store upserts by key', () => {
    const keys = ANNUAL_CHECKLIST.map(i => i.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('stays short enough that someone will actually fill it in', () => {
    expect(ANNUAL_CHECKLIST.length).toBeLessThanOrEqual(15)
  })
})

describe('detectOneOffCharges', () => {
  const breakdown = () => buildCategoryBreakdown([
    tx('הראל ביטוח', 3600, 'ביטוח רכב'),          // once, big  → candidate
    tx('שופרסל', 900, 'מזון לבית'),                // once, small → no
    tx('רמי לוי', 2500, 'מזון לבית'),              // twice, big  → no
    tx('רמי לוי', 2500, 'מזון לבית'),
  ])

  it('flags a large charge that appeared exactly once', () => {
    const found = detectOneOffCharges(breakdown(), 3)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ name: 'הראל ביטוח', category: 'ביטוח רכב', amount: 3600 })
  })

  it('ignores charges below the threshold Ori chose', () => {
    expect(ONE_OFF_MIN).toBe(2000)
    const found = detectOneOffCharges(buildCategoryBreakdown([tx('משהו', 1999, 'שונות')]), 3)
    expect(found).toEqual([])
  })

  it('ignores a recurring charge however large', () => {
    expect(detectOneOffCharges(breakdown(), 3).some(c => c.name === 'רמי לוי')).toBe(false)
  })

  it('returns nothing for a single-month window — every charge appears once there', () => {
    expect(detectOneOffCharges(breakdown(), 1)).toEqual([])
  })

  it('never offers a dismissed charge again', () => {
    const key = detectOneOffCharges(breakdown(), 3)[0].key
    expect(detectOneOffCharges(breakdown(), 3, new Set([key]))).toEqual([])
  })

  it('never offers a charge already confirmed as annual', () => {
    const key = detectOneOffCharges(breakdown(), 3)[0].key
    expect(detectOneOffCharges(breakdown(), 3, new Set(), new Set([key]))).toEqual([])
  })

  it('sorts biggest first', () => {
    const found = detectOneOffCharges(buildCategoryBreakdown([
      tx('א', 2500, 'שונות'), tx('ב', 9000, 'שונות'), tx('ג', 4000, 'שונות'),
    ]), 3)
    expect(found.map(c => c.amount)).toEqual([9000, 4000, 2500])
  })

  // The key is what lets the page drop a confirmed charge from the expense set.
  // Built from the NORMALIZED merchant key, so the two sides can't disagree.
  it('keys on the normalized merchant, not the raw spelling', () => {
    const rows = buildCategoryBreakdown([tx('הראל ביטוח בע"מ', 3600, 'ביטוח רכב')])
    const found = detectOneOffCharges(rows, 3)
    expect(found[0].key).toBe(oneOffKey('ביטוח רכב', rows[0].merchants[0].key))
    expect(found[0].key).not.toContain('בע"מ')   // the legal suffix is normalized away
  })
})

describe('formatAnnualItems', () => {
  const item = (p: Partial<AnnualItem>): AnnualItem => ({
    key: 'k', name: 'ביטוח רכב', category: 'ביטוח רכב',
    annualAmount: 3600, source: 'checklist', ...p,
  })

  it('states these are yearly sums, not to be divided or double counted', () => {
    const out = formatAnnualItems([item({})])
    expect(out[0]).toContain('annual')
    expect(out[0]).toContain('אל תחלק')
  })

  it('marks a detected charge as already removed, and a checklist item as not', () => {
    const [, detected] = formatAnnualItems([item({ source: 'detected' })])
    const [, checklist] = formatAnnualItems([item({ source: 'checklist' })])
    expect(detected).toContain('כבר הוסר')
    expect(checklist).not.toContain('כבר הוסר')
  })

  it('renders nothing when the advisor confirmed nothing', () => {
    expect(formatAnnualItems([])).toEqual([])
  })
})
