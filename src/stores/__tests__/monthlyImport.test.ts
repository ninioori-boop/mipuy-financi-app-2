import { describe, it, expect, beforeEach } from 'vitest'
import { useMonthlyStore } from '@/stores/monthlyStore'
import {
  ALL_CATEGORIES, SKIP_CATEGORIES,
  VAR_CATEGORIES, ANNUAL_CATEGORIES, FIXED_CATEGORIES,
  SUB_CATEGORIES, INSURANCE_CATEGORIES,
} from '@/lib/constants'

// The section an expense category is expected to land in when imported into a
// month. This is the SPEC the import flow must satisfy — annual categories
// (e.g. חופשה וטיול) deliberately fold into variable on a monthly import.
// null = intentionally not imported (income / savings / transfers).
type Section = 'fixed' | 'variable' | 'sub' | 'ins'
function expectedSection(cat: string): Section | null {
  if (FIXED_CATEGORIES.has(cat)) return 'fixed'
  if (VAR_CATEGORIES.has(cat) || ANNUAL_CATEGORIES.has(cat)) return 'variable'
  if (SUB_CATEGORIES.has(cat)) return 'sub'
  if (INSURANCE_CATEGORIES.has(cat)) return 'ins'
  return null
}

const CLASSIFICATION_SETS = [
  ['VAR', VAR_CATEGORIES],
  ['ANNUAL', ANNUAL_CATEGORIES],
  ['FIXED', FIXED_CATEGORIES],
  ['SUB', SUB_CATEGORIES],
  ['INSURANCE', INSURANCE_CATEGORIES],
  ['SKIP', SKIP_CATEGORIES],
] as const

describe('category classification is well-formed', () => {
  it('every category belongs to exactly one classification set', () => {
    for (const cat of ALL_CATEGORIES) {
      const members = CLASSIFICATION_SETS.filter(([, set]) => set.has(cat)).map(([n]) => n)
      // A category with 0 sets would vanish on import; with 2+ it could double-count.
      expect(members, `"${cat}" must be in exactly one set, found: [${members.join(', ')}]`).toHaveLength(1)
    }
  })
})

describe('applyImport — import to month routes every category', () => {
  beforeEach(() => useMonthlyStore.setState({ months: {} }))

  it('no expense category is silently dropped, and each lands in its correct section', () => {
    const AMOUNT = 100
    const catSums = Object.fromEntries(ALL_CATEGORIES.map(c => [c, AMOUNT]))

    const store = useMonthlyStore.getState()
    store.initMonth('jan')
    store.applyImport('jan', catSums, [], [], [], [], [], [], [], 1)

    const m = useMonthlyStore.getState().months['jan']
    const sections: Record<Section, typeof m.fixed> = {
      fixed: m.fixed, variable: m.variable, sub: m.sub, ins: m.ins,
    }

    for (const cat of ALL_CATEGORIES) {
      const expected = expectedSection(cat)
      if (expected === null) {
        for (const rows of Object.values(sections)) {
          expect(
            rows.find(r => r.name === cat),
            `"${cat}" is a skip category and must NOT be imported into the month`,
          ).toBeUndefined()
        }
        continue
      }
      const row = sections[expected].find(r => r.name === cat)
      expect(row, `"${cat}" should land in "${expected}" — it vanished or went to the wrong section`).toBeDefined()
      expect(row!.actual).toBe(AMOUNT)
    }
  })

  it('total imported equals the sum of all non-skip categories (no money lost or duplicated)', () => {
    const AMOUNT = 100
    const catSums = Object.fromEntries(ALL_CATEGORIES.map(c => [c, AMOUNT]))

    const store = useMonthlyStore.getState()
    store.initMonth('feb')
    store.applyImport('feb', catSums, [], [], [], [], [], [], [], 1)

    const m = useMonthlyStore.getState().months['feb']
    const landed = [...m.fixed, ...m.variable, ...m.sub, ...m.ins]
      .reduce((s, r) => s + r.actual, 0)
    const expected = ALL_CATEGORIES.filter(c => !SKIP_CATEGORIES.has(c)).length * AMOUNT

    expect(landed).toBe(expected)
  })
})

describe('applyImport — installments / debts / savings carry mapping rows into the month', () => {
  beforeEach(() => useMonthlyStore.setState({ months: {} }))

  it('installments from mapping land in monthly.installments with mapped fields', () => {
    const store = useMonthlyStore.getState()
    store.initMonth('mar')
    store.applyImport(
      'mar', {}, [], [], [], [],
      [{ name: 'TV', totalAmount: 6000, monthlyPayment: 500, paidCount: 2, totalCount: 12 }],
      [],
      [],
      1,
    )

    const m = useMonthlyStore.getState().months['mar']
    const tv = m.installments.find(r => r.name === 'TV')
    expect(tv, 'TV installment must land in monthly.installments').toBeDefined()
    expect(tv!.total).toBe(6000)
    expect(tv!.monthly).toBe(500)
    expect(tv!.current).toBe(2)
    expect(tv!.totalPay).toBe(12)
  })

  it('debts from mapping land in monthly.debts with mapped fields', () => {
    const store = useMonthlyStore.getState()
    store.initMonth('apr')
    store.applyImport(
      'apr', {}, [], [], [], [],
      [],
      [{ name: 'car loan', remainingBalance: 25000, monthlyPayment: 850, remainingMonths: 30 }],
      [],
      1,
    )

    const m = useMonthlyStore.getState().months['apr']
    const loan = m.debts.find(r => r.name === 'car loan')
    expect(loan, 'car loan must land in monthly.debts').toBeDefined()
    expect(loan!.remaining).toBe(25000)
    expect(loan!.monthly).toBe(850)
    expect(loan!.months).toBe(30)
  })

  it('savings from mapping land in monthly.savings with mapped fields', () => {
    const store = useMonthlyStore.getState()
    store.initMonth('may')
    store.applyImport(
      'may', {}, [], [], [], [],
      [],
      [],
      [{ name: 'emergency', monthlyContribution: 750, accumulated: 12500 }],
      1,
    )

    const m = useMonthlyStore.getState().months['may']
    const fund = m.savings.find(r => r.name === 'emergency')
    expect(fund, 'emergency saving must land in monthly.savings').toBeDefined()
    expect(fund!.monthly).toBe(750)
    expect(fund!.accumulated).toBe(12500)
  })

  it('re-running import with the same names does not duplicate rows', () => {
    const store = useMonthlyStore.getState()
    store.initMonth('jun')
    const inst = [{ name: 'TV', totalAmount: 6000, monthlyPayment: 500, paidCount: 2, totalCount: 12 }]
    const debts = [{ name: 'car loan', remainingBalance: 25000, monthlyPayment: 850, remainingMonths: 30 }]
    const savings = [{ name: 'emergency', monthlyContribution: 750, accumulated: 12500 }]

    store.applyImport('jun', {}, [], [], [], [], inst, debts, savings, 1)
    store.applyImport('jun', {}, [], [], [], [], inst, debts, savings, 1)

    const m = useMonthlyStore.getState().months['jun']
    expect(m.installments.filter(r => r.name === 'TV')).toHaveLength(1)
    expect(m.debts.filter(r => r.name === 'car loan')).toHaveLength(1)
    expect(m.savings.filter(r => r.name === 'emergency')).toHaveLength(1)
  })

  it('zero-amount mapping rows are skipped (no empty noise in the month)', () => {
    const store = useMonthlyStore.getState()
    store.initMonth('jul')
    store.applyImport(
      'jul', {}, [], [], [], [],
      [{ name: 'empty-inst', totalAmount: 0, monthlyPayment: 0, paidCount: 0, totalCount: 0 }],
      [{ name: 'empty-debt', remainingBalance: 0, monthlyPayment: 0, remainingMonths: 0 }],
      [{ name: 'empty-sav',  monthlyContribution: 0, accumulated: 0 }],
      1,
    )

    const m = useMonthlyStore.getState().months['jul']
    expect(m.installments.find(r => r.name === 'empty-inst')).toBeUndefined()
    expect(m.debts.find(r => r.name === 'empty-debt')).toBeUndefined()
    expect(m.savings.find(r => r.name === 'empty-sav')).toBeUndefined()
  })
})
