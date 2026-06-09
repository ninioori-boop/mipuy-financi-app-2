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

// Helper to keep syncFromMapping calls concise — the action now takes 8
// positional args (4 budget sections + 3 specialty sections + varMonths)
// plus an optional monthId. Tests only specify what they care about.
type SyncOpts = {
  fixed?:    { name: string; amount: number }[]
  variable?: { name: string; amount: number }[]
  sub?:      { name: string; amount: number }[]
  ins?:      { name: string; amount: number }[]
  inst?:     { name: string; totalAmount: number; monthlyPayment: number; paidCount: number; totalCount: number }[]
  debt?:     { name: string; remainingBalance: number; monthlyPayment: number; remainingMonths: number }[]
  sav?:      { name: string; monthlyContribution: number; accumulated: number }[]
  varMonths?: number
  monthId?:  string
}
function callSync(o: SyncOpts = {}) {
  useMonthlyStore.getState().syncFromMapping(
    o.fixed ?? [], o.variable ?? [], o.sub ?? [], o.ins ?? [],
    o.inst ?? [], o.debt ?? [], o.sav ?? [],
    o.varMonths ?? 1,
    o.monthId,
  )
}

describe('syncFromMapping — mirrors installments/debts/savings into every month', () => {
  beforeEach(() => useMonthlyStore.setState({ months: {} }))

  it('adds fromMapping rows to all existing months on first sync', () => {
    const store = useMonthlyStore.getState()
    store.initMonth('jan')
    store.initMonth('feb')

    callSync({
      inst: [{ name: 'TV', totalAmount: 6000, monthlyPayment: 500, paidCount: 1, totalCount: 12 }],
      debt: [{ name: 'loan', remainingBalance: 25000, monthlyPayment: 850, remainingMonths: 30 }],
      sav:  [{ name: 'pension', monthlyContribution: 1200, accumulated: 50000 }],
    })

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
    callSync({ inst: [{ name: 'TV', totalAmount: 6000, monthlyPayment: 500, paidCount: 1, totalCount: 12 }] })
    // user changes amount in mapping → second sync
    callSync({ inst: [{ name: 'TV', totalAmount: 7200, monthlyPayment: 600, paidCount: 1, totalCount: 12 }] })

    const m = useMonthlyStore.getState().months['mar']
    const tvRows = m.installments.filter(r => r.name === 'TV')
    expect(tvRows).toHaveLength(1)                      // no duplicate
    expect(tvRows[0].monthly).toBe(600)                 // updated
    expect(tvRows[0].fromMapping).toBe(true)
  })

  it('removes fromMapping rows when mapping deletes them', () => {
    const store = useMonthlyStore.getState()
    store.initMonth('apr')
    callSync({ inst: [{ name: 'TV', totalAmount: 6000, monthlyPayment: 500, paidCount: 1, totalCount: 12 }] })
    expect(useMonthlyStore.getState().months['apr'].installments.find(r => r.name === 'TV')).toBeDefined()

    // mapping no longer has TV
    callSync({})

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
    callSync({ inst: [{ name: 'TV', totalAmount: 6000, monthlyPayment: 500, paidCount: 1, totalCount: 12 }] })

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
    callSync({ inst: [{ name: 'TV', totalAmount: 6000, monthlyPayment: 500, paidCount: 1, totalCount: 12 }] })
    const tvId = useMonthlyStore.getState().months['jun'].installments.find(r => r.name === 'TV')!.id

    // User edits the monthly row — should clear fromMapping
    store.updateInstRow('jun', tvId, 'monthly', 450)
    expect(useMonthlyStore.getState().months['jun'].installments.find(r => r.id === tvId)!.fromMapping).toBe(false)

    // Mapping changes amount, then deletes — neither should affect this manual row
    callSync({ inst: [{ name: 'TV', totalAmount: 7200, monthlyPayment: 600, paidCount: 1, totalCount: 12 }] })
    expect(useMonthlyStore.getState().months['jun'].installments.find(r => r.id === tvId)!.monthly).toBe(450)

    callSync({})
    expect(useMonthlyStore.getState().months['jun'].installments.find(r => r.id === tvId)?.monthly).toBe(450)
  })

  it('with monthId argument, syncs only that month', () => {
    const store = useMonthlyStore.getState()
    store.initMonth('jul')
    store.initMonth('aug')
    callSync({
      inst: [{ name: 'TV', totalAmount: 6000, monthlyPayment: 500, paidCount: 1, totalCount: 12 }],
      monthId: 'jul',
    })
    expect(useMonthlyStore.getState().months['jul'].installments.find(r => r.name === 'TV')).toBeDefined()
    expect(useMonthlyStore.getState().months['aug'].installments.find(r => r.name === 'TV')).toBeUndefined()
  })
})

describe('syncFromMapping — mirrors budget sections (fixed/variable/sub/ins) into every month', () => {
  beforeEach(() => useMonthlyStore.setState({ months: {} }))

  it('adds fromMapping rows for all 4 budget sections; variable amount is divided by varMonths', () => {
    const store = useMonthlyStore.getState()
    store.initMonth('jan')

    // Use category names that do NOT collide with MONTH_DEFAULT_ROWS — those
    // defaults exist as plain rows (no fromMapping) and are treated as manual,
    // so sync would skip them. This is the SAME mechanism that protects Oliver.
    callSync({
      fixed:    [{ name: 'משכנתא',         amount: 4500 }],
      variable: [{ name: 'מזון לבית',       amount: 3600 }],   // period total over varMonths
      sub:      [{ name: 'Netflix',        amount: 30 }],
      ins:      [{ name: 'ביטוח דירה',      amount: 220 }],
      varMonths: 3,
    })

    const m = useMonthlyStore.getState().months['jan']
    expect(m.fixed.find(r => r.name === 'משכנתא')?.fromMapping).toBe(true)
    expect(m.fixed.find(r => r.name === 'משכנתא')?.plan).toBe(4500)
    expect(m.variable.find(r => r.name === 'מזון לבית')?.fromMapping).toBe(true)
    expect(m.variable.find(r => r.name === 'מזון לבית')?.plan).toBe(1200) // 3600 / 3
    expect(m.sub.find(r => r.name === 'Netflix')?.plan).toBe(30)
    expect(m.ins.find(r => r.name === 'ביטוח דירה')?.plan).toBe(220)
  })

  it('default monthly rows are treated as manual (sync does not overwrite them — preserves user setup)', () => {
    // MONTH_DEFAULT_ROWS gives a fresh month some pre-filled rows (e.g.,
    // 'ביטוח רכב' in ins). These count as manual because they have no
    // fromMapping flag. Even if the user later adds a same-named row in
    // mapping, the default row's plan stays at its current value.
    const store = useMonthlyStore.getState()
    store.initMonth('jan2')
    const defaultId = useMonthlyStore.getState().months['jan2'].ins.find(r => r.name === 'ביטוח רכב')?.id
    expect(defaultId, 'sanity: default ins includes ביטוח רכב').toBeDefined()

    callSync({ ins: [{ name: 'ביטוח רכב', amount: 999 }] })

    const ins = useMonthlyStore.getState().months['jan2'].ins
    const row = ins.find(r => r.id === defaultId)
    expect(row, 'default row must still exist').toBeDefined()
    expect(row!.plan).toBe(0)                              // default plan, unchanged
    expect(row!.fromMapping).toBeFalsy()
    expect(ins.filter(r => r.name === 'ביטוח רכב')).toHaveLength(1) // no duplicate
  })

  it('Oliver-scenario: manual rows in monthly are preserved when sync runs', () => {
    // Oliver opened his next-month budget BEFORE the auto-sync existed, and
    // typed in variable amounts himself. After we deploy this, the sync must
    // NOT overwrite his work, and must NOT create duplicates by name.
    const store = useMonthlyStore.getState()
    store.initMonth('aug')

    // Oliver's hand-typed row in his monthly variable (no fromMapping flag)
    store.addRow('aug', 'variable', 'מזון לבית')
    const oliverRowId = useMonthlyStore.getState().months['aug'].variable.find(r => r.name === 'מזון לבית')!.id
    store.updateRow('aug', 'variable', oliverRowId, 'plan', 2500)

    // Mapping now has a different amount for the same category name
    callSync({
      variable: [{ name: 'מזון לבית', amount: 3000 }],
      varMonths: 1,
    })

    const m = useMonthlyStore.getState().months['aug']
    const rows = m.variable.filter(r => r.name === 'מזון לבית')
    expect(rows, 'no duplicate row created').toHaveLength(1)
    expect(rows[0].id).toBe(oliverRowId)                  // same row, not replaced
    expect(rows[0].plan).toBe(2500)                       // Oliver's value preserved
    expect(rows[0].fromMapping).toBeFalsy()               // still manual
  })

  it('new mapping row that is NOT in the month is added (fixed section)', () => {
    const store = useMonthlyStore.getState()
    store.initMonth('sep')
    callSync({ fixed: [{ name: 'ארנונה חדשה', amount: 380 }] })

    const row = useMonthlyStore.getState().months['sep'].fixed.find(r => r.name === 'ארנונה חדשה')
    expect(row, 'new mapping row must appear in the month').toBeDefined()
    expect(row!.plan).toBe(380)
    expect(row!.fromMapping).toBe(true)
  })

  it('user editing a budget row disconnects it from mapping', () => {
    const store = useMonthlyStore.getState()
    store.initMonth('oct')
    callSync({ variable: [{ name: 'דלק וחניה', amount: 800 }] })
    const id = useMonthlyStore.getState().months['oct'].variable.find(r => r.name === 'דלק וחניה')!.id

    store.updateRow('oct', 'variable', id, 'plan', 950)
    expect(useMonthlyStore.getState().months['oct'].variable.find(r => r.id === id)!.fromMapping).toBe(false)

    // Future sync changes the mapping — row stays at user's value
    callSync({ variable: [{ name: 'דלק וחניה', amount: 1200 }] })
    expect(useMonthlyStore.getState().months['oct'].variable.find(r => r.id === id)!.plan).toBe(950)
  })
})

describe('syncFromMapping — user deletions in monthly persist across syncs', () => {
  beforeEach(() => useMonthlyStore.setState({ months: {} }))

  it('deleting a fromMapping variable row blocks the next sync from re-adding it', () => {
    const store = useMonthlyStore.getState()
    store.initMonth('jan')

    // First sync brings in a mapping row
    callSync({ variable: [{ name: 'מזון לבית', amount: 1500 }] })
    const id = useMonthlyStore.getState().months['jan'].variable.find(r => r.name === 'מזון לבית')!.id
    expect(useMonthlyStore.getState().months['jan'].variable.find(r => r.name === 'מזון לבית')?.fromMapping).toBe(true)

    // User deletes the row in monthly
    store.deleteRow('jan', 'variable', id)
    expect(useMonthlyStore.getState().months['jan'].variable.find(r => r.name === 'מזון לבית')).toBeUndefined()
    // Deletion is tracked
    expect(useMonthlyStore.getState().months['jan'].deletedFromMapping.variable).toContain('מזון לבית')

    // Sync runs again — mapping STILL has the row — but the user's deletion wins
    callSync({ variable: [{ name: 'מזון לבית', amount: 1500 }] })
    expect(useMonthlyStore.getState().months['jan'].variable.find(r => r.name === 'מזון לבית')).toBeUndefined()
  })

  it('same protection works for installments / debts / savings', () => {
    const store = useMonthlyStore.getState()
    store.initMonth('feb')

    callSync({
      inst: [{ name: 'TV', totalAmount: 6000, monthlyPayment: 500, paidCount: 1, totalCount: 12 }],
      debt: [{ name: 'loan', remainingBalance: 10000, monthlyPayment: 400, remainingMonths: 25 }],
      sav:  [{ name: 'pension', monthlyContribution: 1000, accumulated: 20000 }],
    })

    const m = useMonthlyStore.getState().months['feb']
    store.deleteInstRow('feb', m.installments.find(r => r.name === 'TV')!.id)
    store.deleteDebtRow('feb', m.debts.find(r => r.name === 'loan')!.id)
    store.deleteSavingRow('feb', m.savings.find(r => r.name === 'pension')!.id)

    // Re-sync with same mapping data — deletions must persist
    callSync({
      inst: [{ name: 'TV', totalAmount: 6000, monthlyPayment: 500, paidCount: 1, totalCount: 12 }],
      debt: [{ name: 'loan', remainingBalance: 10000, monthlyPayment: 400, remainingMonths: 25 }],
      sav:  [{ name: 'pension', monthlyContribution: 1000, accumulated: 20000 }],
    })

    const after = useMonthlyStore.getState().months['feb']
    expect(after.installments.find(r => r.name === 'TV')).toBeUndefined()
    expect(after.debts.find(r => r.name === 'loan')).toBeUndefined()
    expect(after.savings.find(r => r.name === 'pension')).toBeUndefined()
  })

  it('deleting a MANUAL row does NOT track it (mapping had no claim on it)', () => {
    const store = useMonthlyStore.getState()
    store.initMonth('mar')
    store.addRow('mar', 'fixed', 'manual-fixed-row')
    const id = useMonthlyStore.getState().months['mar'].fixed.find(r => r.name === 'manual-fixed-row')!.id

    store.deleteRow('mar', 'fixed', id)
    // No deletion tracking for manual rows — they never came from mapping
    expect(useMonthlyStore.getState().months['mar'].deletedFromMapping.fixed).not.toContain('manual-fixed-row')
  })
})

describe('applyImport — respects monthly deletions (import brings actual, not resurrected plan)', () => {
  beforeEach(() => useMonthlyStore.setState({ months: {} }))

  // 'מזון לבית' is a real VAR category that is NOT a default monthly row,
  // so the mapping sync genuinely adds it as a fresh fromMapping row.
  const VAR_CAT = 'מזון לבית'

  it('a deleted mapping row does not resurrect its mapping PLAN, but imported actual still shows', () => {
    const store = useMonthlyStore.getState()
    store.initMonth('jan')

    // Mapping seeds the row into the month (fromMapping:true), like the auto-sync.
    store.syncFromMapping([], [{ name: VAR_CAT, amount: 1500 }], [], [], [], [], [], 1, 'jan')
    const id = useMonthlyStore.getState().months['jan'].variable.find(r => r.name === VAR_CAT)!.id

    // User deletes it in the monthly tab.
    store.deleteRow('jan', 'variable', id)
    expect(useMonthlyStore.getState().months['jan'].variable.find(r => r.name === VAR_CAT)).toBeUndefined()

    // User imports a credit report with spending in that category, while mapping
    // STILL has the row. The mapping PLAN (1500) must NOT come back — but the
    // report's real spending (900) MUST show. (Regression guard: deleting the
    // variable rows before importing once swallowed the imported actuals.)
    store.applyImport('jan', { [VAR_CAT]: 900 }, [], [{ name: VAR_CAT, amount: 1500 }], [], [], [], [], [], 1)

    const row = useMonthlyStore.getState().months['jan'].variable.find(r => r.name === VAR_CAT)
    expect(row, 'imported actual spending must not be swallowed').toBeDefined()
    expect(row!.actual).toBe(900)   // real spending shows
    expect(row!.plan).toBe(0)       // mapping plan (1500) NOT resurrected
  })

  it('a kept-and-edited row is not duplicated and keeps the user plan; only actual is filled', () => {
    const store = useMonthlyStore.getState()
    store.initMonth('feb')

    store.syncFromMapping([], [{ name: VAR_CAT, amount: 1500 }], [], [], [], [], [], 1, 'feb')
    const row = useMonthlyStore.getState().months['feb'].variable.find(r => r.name === VAR_CAT)!
    // User edits the plan in monthly (this clears fromMapping → row becomes manual).
    store.updateRow('feb', 'variable', row.id, 'plan', 2000)

    store.applyImport('feb', { [VAR_CAT]: 900 }, [], [{ name: VAR_CAT, amount: 1500 }], [], [], [], [], [], 1)

    const after = useMonthlyStore.getState().months['feb'].variable.filter(r => r.name === VAR_CAT)
    expect(after).toHaveLength(1)      // not duplicated by the import
    expect(after[0].plan).toBe(2000)   // user's edited plan preserved (not reset to mapping's 1500)
    expect(after[0].actual).toBe(900)  // actual from the report filled in
  })

  it('a deleted installment is not resurrected by import', () => {
    const store = useMonthlyStore.getState()
    store.initMonth('mar')
    const inst = [{ name: 'TV', totalAmount: 6000, monthlyPayment: 500, paidCount: 1, totalCount: 12 }]

    store.syncFromMapping([], [], [], [], inst, [], [], 1, 'mar')
    const id = useMonthlyStore.getState().months['mar'].installments.find(r => r.name === 'TV')!.id
    store.deleteInstRow('mar', id)

    store.applyImport('mar', {}, [], [], [], [], inst, [], [], 1)
    expect(useMonthlyStore.getState().months['mar'].installments.find(r => r.name === 'TV')).toBeUndefined()
  })
})
