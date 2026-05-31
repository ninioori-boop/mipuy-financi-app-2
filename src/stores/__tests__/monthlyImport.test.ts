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

describe('syncFromMapping — mirrors installments/debts/savings into every month', () => {
  beforeEach(() => useMonthlyStore.setState({ months: {} }))

  it('adds fromMapping rows to all existing months on first sync', () => {
    const store = useMonthlyStore.getState()
    store.initMonth('jan')
    store.initMonth('feb')

    store.syncFromMapping(
      [{ name: 'TV', totalAmount: 6000, monthlyPayment: 500, paidCount: 1, totalCount: 12 }],
      [{ name: 'loan', remainingBalance: 25000, monthlyPayment: 850, remainingMonths: 30 }],
      [{ name: 'pension', monthlyContribution: 1200, accumulated: 50000 }],
    )

    for (const mid of ['jan', 'feb']) {
      const m = useMonthlyStore.getState().months[mid]
      const inst = m.installments.find(r => r.name === 'TV')
      const debt = m.debts.find(r => r.name === 'loan')
      const sav  = m.savings.find(r => r.name === 'pension')
      expect(inst?.fromMapping).toBe(true)
      expect(inst?.monthly).toBe(500)
      expect(debt?.fromMapping).toBe(true)
      expect(debt?.remaining).toBe(25000)
      expect(sav?.fromMapping).toBe(true)
      expect(sav?.monthly).toBe(1200)
    }
  })

  it('updates fromMapping rows when mapping changes (same name, new values)', () => {
    const store = useMonthlyStore.getState()
    store.initMonth('mar')
    store.syncFromMapping(
      [{ name: 'TV', totalAmount: 6000, monthlyPayment: 500, paidCount: 1, totalCount: 12 }],
      [], [],
    )
    // user changes amount in mapping → second sync
    store.syncFromMapping(
      [{ name: 'TV', totalAmount: 7200, monthlyPayment: 600, paidCount: 1, totalCount: 12 }],
      [], [],
    )

    const m = useMonthlyStore.getState().months['mar']
    const tvRows = m.installments.filter(r => r.name === 'TV')
    expect(tvRows).toHaveLength(1)                      // no duplicate
    expect(tvRows[0].monthly).toBe(600)                 // updated
    expect(tvRows[0].fromMapping).toBe(true)
  })

  it('removes fromMapping rows when mapping deletes them', () => {
    const store = useMonthlyStore.getState()
    store.initMonth('apr')
    store.syncFromMapping(
      [{ name: 'TV', totalAmount: 6000, monthlyPayment: 500, paidCount: 1, totalCount: 12 }],
      [], [],
    )
    expect(useMonthlyStore.getState().months['apr'].installments.find(r => r.name === 'TV')).toBeDefined()

    // mapping no longer has TV
    store.syncFromMapping([], [], [])

    expect(useMonthlyStore.getState().months['apr'].installments.find(r => r.name === 'TV')).toBeUndefined()
  })

  it('NEVER touches manual rows (rows without fromMapping flag)', () => {
    const store = useMonthlyStore.getState()
    store.initMonth('may')
    // Manually add a row (no fromMapping flag)
    store.addInstRow('may')
    const manualId = useMonthlyStore.getState().months['may'].installments[0].id
    store.updateInstRow('may', manualId, 'name', 'special-deal')
    store.updateInstRow('may', manualId, 'monthly', 999)

    // Sync brings in unrelated mapping rows
    store.syncFromMapping(
      [{ name: 'TV', totalAmount: 6000, monthlyPayment: 500, paidCount: 1, totalCount: 12 }],
      [], [],
    )

    const m = useMonthlyStore.getState().months['may']
    const manual = m.installments.find(r => r.id === manualId)
    expect(manual, 'manual row must survive sync').toBeDefined()
    expect(manual!.name).toBe('special-deal')
    expect(manual!.monthly).toBe(999)
    expect(manual!.fromMapping).toBeFalsy()
  })

  it('user editing a fromMapping row disconnects it (subsequent mapping changes do not touch it)', () => {
    const store = useMonthlyStore.getState()
    store.initMonth('jun')
    store.syncFromMapping(
      [{ name: 'TV', totalAmount: 6000, monthlyPayment: 500, paidCount: 1, totalCount: 12 }],
      [], [],
    )
    const tvId = useMonthlyStore.getState().months['jun'].installments.find(r => r.name === 'TV')!.id

    // User edits the monthly row — should clear fromMapping
    store.updateInstRow('jun', tvId, 'monthly', 450)
    expect(useMonthlyStore.getState().months['jun'].installments.find(r => r.id === tvId)!.fromMapping).toBe(false)

    // Mapping changes amount, then deletes — neither should affect this manual row
    store.syncFromMapping(
      [{ name: 'TV', totalAmount: 7200, monthlyPayment: 600, paidCount: 1, totalCount: 12 }],
      [], [],
    )
    expect(useMonthlyStore.getState().months['jun'].installments.find(r => r.id === tvId)!.monthly).toBe(450)

    store.syncFromMapping([], [], [])
    expect(useMonthlyStore.getState().months['jun'].installments.find(r => r.id === tvId)?.monthly).toBe(450)
  })

  it('with monthId argument, syncs only that month', () => {
    const store = useMonthlyStore.getState()
    store.initMonth('jul')
    store.initMonth('aug')
    store.syncFromMapping(
      [{ name: 'TV', totalAmount: 6000, monthlyPayment: 500, paidCount: 1, totalCount: 12 }],
      [], [],
      'jul',
    )
    expect(useMonthlyStore.getState().months['jul'].installments.find(r => r.name === 'TV')).toBeDefined()
    expect(useMonthlyStore.getState().months['aug'].installments.find(r => r.name === 'TV')).toBeUndefined()
  })
})
