'use client'

import { create } from 'zustand'
import { MONTH_DEFAULT_ROWS, FIXED_CATEGORIES, VAR_CATEGORIES, ANNUAL_CATEGORIES, INSURANCE_CATEGORIES, SUB_CATEGORIES } from '@/lib/constants'

function uid() { return Math.random().toString(36).slice(2) }

export interface BudgetRow {
  id: string
  name: string
  plan: number
  actual: number
  fromMapping?: boolean   // true → managed by mapping→monthly auto-sync (fixed/variable/sub/ins only)
}

export interface InstRow {
  id: string
  name: string
  total: number
  monthly: number
  current: number
  totalPay: number
  fromMapping?: boolean   // true → managed by mapping→monthly auto-sync
}

export interface DebtRow {
  id: string
  name: string
  remaining: number
  monthly: number
  months: number
  fromMapping?: boolean   // true → managed by mapping→monthly auto-sync
}

export interface SavingRow {
  id: string
  name: string
  monthly: number
  accumulated: number
  fromMapping?: boolean   // true → managed by mapping→monthly auto-sync
}

export interface MonthData {
  year: number
  income: BudgetRow[]
  fixed: BudgetRow[]
  variable: BudgetRow[]
  sub: BudgetRow[]
  ins: BudgetRow[]
  installments: InstRow[]
  debts: DebtRow[]
  savings: SavingRow[]
  // Names of fromMapping rows the user deleted in this month. syncFromMapping
  // checks this so a deletion isn't undone on the next sync run. Per-section
  // because the same name could legitimately exist in multiple sections.
  deletedFromMapping: {
    fixed:         string[]
    variable:      string[]
    sub:           string[]
    ins:           string[]
    installments:  string[]
    debts:         string[]
    savings:       string[]
  }
}

export type SimpleSection = 'income' | 'fixed' | 'variable' | 'sub' | 'ins'

function makeDefaultMonth(): MonthData {
  function rows(names: string[]): BudgetRow[] {
    return names.map(name => ({ id: uid(), name, plan: 0, actual: 0 }))
  }
  return {
    year: new Date().getFullYear(),
    income:       rows(MONTH_DEFAULT_ROWS.income),
    fixed:        rows(MONTH_DEFAULT_ROWS.fixed),
    variable:     rows(MONTH_DEFAULT_ROWS.variable),
    sub:          rows(MONTH_DEFAULT_ROWS.sub),
    ins:          rows(MONTH_DEFAULT_ROWS.ins),
    installments: [],
    debts:        [],
    savings:      [],
    deletedFromMapping: {
      fixed: [], variable: [], sub: [], ins: [],
      installments: [], debts: [], savings: [],
    },
  }
}

interface MonthlyState {
  months: Record<string, MonthData>

  initMonth:  (monthId: string) => void
  setYear:    (monthId: string, year: number) => void

  addRow:    (monthId: string, section: SimpleSection, name?: string) => void
  updateRow: (monthId: string, section: SimpleSection, id: string, field: 'name' | 'plan' | 'actual', value: string | number) => void
  deleteRow: (monthId: string, section: SimpleSection, id: string) => void

  addInstRow:    (monthId: string) => void
  updateInstRow: (monthId: string, id: string, field: keyof Omit<InstRow, 'id'>, value: string | number) => void
  deleteInstRow: (monthId: string, id: string) => void

  addDebtRow:    (monthId: string) => void
  updateDebtRow: (monthId: string, id: string, field: keyof Omit<DebtRow, 'id'>, value: string | number) => void
  deleteDebtRow: (monthId: string, id: string) => void

  addSavingRow:    (monthId: string) => void
  updateSavingRow: (monthId: string, id: string, field: keyof Omit<SavingRow, 'id'>, value: string | number) => void
  deleteSavingRow: (monthId: string, id: string) => void

  applyImport: (
    monthId: string,
    catSums: Record<string, number>,
    mappingFixed:    { name: string; amount: number }[],
    mappingVariable: { name: string; amount: number }[],
    mappingSub:      { name: string; amount: number }[],
    mappingIns:      { name: string; amount: number }[],
    mappingInstallments: { name: string; totalAmount: number; monthlyPayment: number; paidCount: number; totalCount: number }[],
    mappingDebts:        { name: string; remainingBalance: number; monthlyPayment: number; remainingMonths: number }[],
    mappingSavings:      { name: string; monthlyContribution: number; accumulated: number }[],
    varMonths: number,
  ) => void

  /**
   * Mirror mapping into every existing month (or just `monthId` if provided).
   * Covers 4 budget sections (fixed/variable/sub/ins) + 3 specialty sections
   * (installments/debts/savings). Rows are tagged with fromMapping:true so
   * that user edits in the monthly tab (which clear the flag) are preserved
   * against future syncs.
   *
   * Variable rows: mapping stores period totals; this divides by varMonths
   * to land a monthly plan amount, matching the existing applyImport logic.
   *
   * Rules per section:
   *   - fromMapping rows whose name is no longer in mapping → removed.
   *   - fromMapping rows whose mapping counterpart changed → updated in place.
   *   - Mapping rows not yet present in the month → added as fromMapping.
   *   - Non-fromMapping rows (manual) → NEVER touched.
   */
  syncFromMapping: (
    mappingFixed:    { name: string; amount: number }[],
    mappingVariable: { name: string; amount: number }[],
    mappingSub:      { name: string; amount: number }[],
    mappingIns:      { name: string; amount: number }[],
    mappingInstallments: { name: string; totalAmount: number; monthlyPayment: number; paidCount: number; totalCount: number }[],
    mappingDebts:        { name: string; remainingBalance: number; monthlyPayment: number; remainingMonths: number }[],
    mappingSavings:      { name: string; monthlyContribution: number; accumulated: number }[],
    varMonths: number,
    monthId?: string,
  ) => void
}

export const useMonthlyStore = create<MonthlyState>((set, get) => {
  function updateMonth(monthId: string, updater: (m: MonthData) => MonthData) {
    set(s => {
      const m = s.months[monthId] ?? makeDefaultMonth()
      return { months: { ...s.months, [monthId]: updater(m) } }
    })
  }

  return {
    months: {},

    initMonth: (monthId) => {
      if (get().months[monthId]) return
      set(s => ({ months: { ...s.months, [monthId]: makeDefaultMonth() } }))
    },

    setYear: (monthId, year) => updateMonth(monthId, m => ({ ...m, year })),

    addRow: (monthId, section, name = '') =>
      updateMonth(monthId, m => ({
        ...m,
        [section]: [...m[section], { id: uid(), name, plan: 0, actual: 0 }],
      })),

    updateRow: (monthId, section, id, field, value) =>
      updateMonth(monthId, m => ({
        ...m,
        // Clear fromMapping on user edit — the row becomes "manual" for this
        // specific month and future mapping syncs will no longer touch it.
        // (income section never carries fromMapping, so this is a no-op there.)
        [section]: m[section].map(r => r.id === id ? { ...r, [field]: value, fromMapping: false } : r),
      })),

    deleteRow: (monthId, section, id) =>
      updateMonth(monthId, m => {
        const target = m[section].find(r => r.id === id)
        const filtered = m[section].filter(r => r.id !== id)
        // If we just deleted a row that came from mapping, remember its name
        // so the next sync doesn't undo the deletion.
        if (target?.fromMapping && target.name && section !== 'income') {
          const list = m.deletedFromMapping[section as keyof MonthData['deletedFromMapping']]
          if (!list.includes(target.name)) {
            return {
              ...m,
              [section]: filtered,
              deletedFromMapping: {
                ...m.deletedFromMapping,
                [section]: [...list, target.name],
              },
            }
          }
        }
        return { ...m, [section]: filtered }
      }),

    addInstRow: (monthId) =>
      updateMonth(monthId, m => ({
        ...m,
        installments: [...m.installments, { id: uid(), name: '', total: 0, monthly: 0, current: 0, totalPay: 0 }],
      })),

    updateInstRow: (monthId, id, field, value) =>
      updateMonth(monthId, m => ({
        ...m,
        // Clear fromMapping on user edit — the row becomes "manual" for this
        // specific month and future mapping syncs will no longer touch it.
        installments: m.installments.map(r => r.id === id ? { ...r, [field]: value, fromMapping: false } : r),
      })),

    deleteInstRow: (monthId, id) =>
      updateMonth(monthId, m => {
        const target = m.installments.find(r => r.id === id)
        const filtered = m.installments.filter(r => r.id !== id)
        if (target?.fromMapping && target.name && !m.deletedFromMapping.installments.includes(target.name)) {
          return {
            ...m,
            installments: filtered,
            deletedFromMapping: {
              ...m.deletedFromMapping,
              installments: [...m.deletedFromMapping.installments, target.name],
            },
          }
        }
        return { ...m, installments: filtered }
      }),

    addDebtRow: (monthId) =>
      updateMonth(monthId, m => ({
        ...m,
        debts: [...m.debts, { id: uid(), name: '', remaining: 0, monthly: 0, months: 0 }],
      })),

    updateDebtRow: (monthId, id, field, value) =>
      updateMonth(monthId, m => ({
        ...m,
        // Clear fromMapping on user edit — see updateInstRow comment.
        debts: m.debts.map(r => r.id === id ? { ...r, [field]: value, fromMapping: false } : r),
      })),

    deleteDebtRow: (monthId, id) =>
      updateMonth(monthId, m => {
        const target = m.debts.find(r => r.id === id)
        const filtered = m.debts.filter(r => r.id !== id)
        if (target?.fromMapping && target.name && !m.deletedFromMapping.debts.includes(target.name)) {
          return {
            ...m,
            debts: filtered,
            deletedFromMapping: {
              ...m.deletedFromMapping,
              debts: [...m.deletedFromMapping.debts, target.name],
            },
          }
        }
        return { ...m, debts: filtered }
      }),

    addSavingRow: (monthId) =>
      updateMonth(monthId, m => ({
        ...m,
        savings: [...m.savings, { id: uid(), name: '', monthly: 0, accumulated: 0 }],
      })),

    updateSavingRow: (monthId, id, field, value) =>
      updateMonth(monthId, m => ({
        ...m,
        // Clear fromMapping on user edit — see updateInstRow comment.
        savings: m.savings.map(r => r.id === id ? { ...r, [field]: value, fromMapping: false } : r),
      })),

    deleteSavingRow: (monthId, id) =>
      updateMonth(monthId, m => {
        const target = m.savings.find(r => r.id === id)
        const filtered = m.savings.filter(r => r.id !== id)
        if (target?.fromMapping && target.name && !m.deletedFromMapping.savings.includes(target.name)) {
          return {
            ...m,
            savings: filtered,
            deletedFromMapping: {
              ...m.deletedFromMapping,
              savings: [...m.deletedFromMapping.savings, target.name],
            },
          }
        }
        return { ...m, savings: filtered }
      }),

    applyImport: (monthId, catSums, mappingFixed, mappingVariable, mappingSub, mappingIns, mappingInstallments, mappingDebts, mappingSavings, varMonths) => {
      updateMonth(monthId, m => {
        // Step 1: merge mapping plan rows (skip rows already present by name)
        function mergePlan(rows: BudgetRow[], src: { name: string; amount: number }[]): BudgetRow[] {
          const names = new Set(rows.map(r => r.name))
          const added = src
            .filter(s => !names.has(s.name) && s.amount > 0)
            .map(s => ({ id: uid(), name: s.name, plan: s.amount, actual: 0 }))
          return [...rows, ...added]
        }
        const varMonthly = mappingVariable.map(s => ({ name: s.name, amount: Math.round(s.amount / Math.max(1, varMonths)) }))
        let fixed    = mergePlan(m.fixed,    mappingFixed)
        let variable = mergePlan(m.variable, varMonthly)
        let sub      = mergePlan(m.sub,      mappingSub)
        let ins      = mergePlan(m.ins,      mappingIns)

        // Step 2: fill actual from catSums
        function fillActual(rows: BudgetRow[], cats: Set<string>): BudgetRow[] {
          const names = new Set(rows.map(r => r.name))
          const updated = rows.map(r => {
            const s = catSums[r.name]
            return (s !== undefined && cats.has(r.name)) ? { ...r, actual: Math.round(s) } : r
          })
          Object.entries(catSums).forEach(([cat, sum]) => {
            if (cats.has(cat) && !names.has(cat) && sum > 0)
              updated.push({ id: uid(), name: cat, plan: 0, actual: Math.round(sum) })
          })
          return updated
        }
        // Annual categories (e.g. חופשה וטיול) have no dedicated monthly section;
        // fold them into variable expenses so the amount isn't silently dropped.
        const variableCats = new Set([...VAR_CATEGORIES, ...ANNUAL_CATEGORIES])
        fixed    = fillActual(fixed,    FIXED_CATEGORIES)
        variable = fillActual(variable, variableCats)
        sub      = fillActual(sub,      SUB_CATEGORIES)
        ins      = fillActual(ins,      INSURANCE_CATEGORIES)

        // Step 3: merge installments / debts / savings from mapping into the
        // month's own sections. Skip rows already present in the month by name
        // (so re-running the import doesn't duplicate). Annual-plan rows from
        // the mapping intentionally stay only in the mapping/annual view — they
        // are not pushed per-month.
        const namesIn = <T extends { name: string }>(rows: T[]) => new Set(rows.map(r => r.name))

        const instNames = namesIn(m.installments)
        const newInstallments: InstRow[] = mappingInstallments
          .filter(i => !instNames.has(i.name) && (i.monthlyPayment > 0 || i.totalAmount > 0))
          .map(i => ({
            id: uid(),
            name: i.name,
            total:    Math.round(i.totalAmount),
            monthly:  Math.round(i.monthlyPayment),
            current:  i.paidCount,
            totalPay: i.totalCount,
          }))
        const installments = [...m.installments, ...newInstallments]

        const debtNames = namesIn(m.debts)
        const newDebts: DebtRow[] = mappingDebts
          .filter(d => !debtNames.has(d.name) && (d.monthlyPayment > 0 || d.remainingBalance > 0))
          .map(d => ({
            id: uid(),
            name: d.name,
            remaining: Math.round(d.remainingBalance),
            monthly:   Math.round(d.monthlyPayment),
            months:    d.remainingMonths,
          }))
        const debts = [...m.debts, ...newDebts]

        const savNames = namesIn(m.savings)
        const newSavings: SavingRow[] = mappingSavings
          .filter(s => !savNames.has(s.name) && (s.monthlyContribution > 0 || s.accumulated > 0))
          .map(s => ({
            id: uid(),
            name: s.name,
            monthly:     Math.round(s.monthlyContribution),
            accumulated: Math.round(s.accumulated),
          }))
        const savings = [...m.savings, ...newSavings]

        return { ...m, fixed, variable, sub, ins, installments, debts, savings }
      })
    },

    syncFromMapping: (mFixed, mVariable, mSub, mIns, mInst, mDebts, mSav, varMonths, monthId) => {
      set(s => {
        const targets = monthId ? [monthId] : Object.keys(s.months)
        if (targets.length === 0) return s

        const varDivisor = Math.max(1, varMonths)
        // Budget sections: mapping rows arrive as { name, amount }. Variable
        // mapping amounts are period totals, so they need division to land a
        // monthly plan figure.
        const fixedByName = new Map(mFixed.map(r => [r.name, r.amount] as const))
        const varByName   = new Map(mVariable.map(r => [r.name, Math.round(r.amount / varDivisor)] as const))
        const subByName   = new Map(mSub.map(r => [r.name, r.amount] as const))
        const insByName   = new Map(mIns.map(r => [r.name, r.amount] as const))

        // Specialty sections: shape-converted from mapping types.
        const instByName = new Map(mInst.map(i => [i.name, i]))
        const debtByName = new Map(mDebts.map(d => [d.name, d]))
        const savByName  = new Map(mSav.map(v => [v.name, v]))

        // Generic merge for the 4 budget sections (BudgetRow shape).
        // deletedNames blocks re-adding rows the user explicitly deleted.
        function syncBudgetSection(existing: BudgetRow[], byName: Map<string, number>, deletedNames: string[]): BudgetRow[] {
          const existingNames = new Set(existing.map(r => r.name))
          const deletedSet = new Set(deletedNames)
          const result: BudgetRow[] = []
          for (const r of existing) {
            if (!r.fromMapping) { result.push(r); continue }  // manual — leave untouched
            const newPlan = byName.get(r.name)
            if (newPlan === undefined) continue                // mapping removed → drop
            result.push({ ...r, plan: Math.round(newPlan) })
          }
          for (const [name, amount] of byName) {
            if (existingNames.has(name)) continue              // name already in month (manual or fromMapping)
            if (deletedSet.has(name)) continue                 // user explicitly deleted — respect it
            if (amount <= 0) continue                          // skip empty/noise
            result.push({
              id: uid(),
              name,
              plan: Math.round(amount),
              actual: 0,
              fromMapping: true,
            })
          }
          return result
        }

        const newMonths = { ...s.months }
        targets.forEach(mid => {
          const m = newMonths[mid]
          if (!m) return

          // BUDGET SECTIONS (fixed / variable / sub / ins)
          const del = m.deletedFromMapping
          const fixed    = syncBudgetSection(m.fixed,    fixedByName, del.fixed)
          const variable = syncBudgetSection(m.variable, varByName,   del.variable)
          const sub      = syncBudgetSection(m.sub,      subByName,   del.sub)
          const ins      = syncBudgetSection(m.ins,      insByName,   del.ins)

          // INSTALLMENTS
          const instExisting = new Set(m.installments.map(r => r.name))
          const installments: InstRow[] = []
          for (const r of m.installments) {
            if (!r.fromMapping) { installments.push(r); continue }
            const src = instByName.get(r.name)
            if (!src) continue   // mapping removed it → drop from monthly
            installments.push({
              ...r,
              total:    Math.round(src.totalAmount),
              monthly:  Math.round(src.monthlyPayment),
              current:  src.paidCount,
              totalPay: src.totalCount,
            })
          }
          const instDeleted = new Set(del.installments)
          for (const [name, src] of instByName) {
            if (instExisting.has(name)) continue
            if (instDeleted.has(name)) continue   // user explicitly deleted — respect it
            if (src.monthlyPayment <= 0 && src.totalAmount <= 0) continue
            installments.push({
              id: uid(), name,
              total:    Math.round(src.totalAmount),
              monthly:  Math.round(src.monthlyPayment),
              current:  src.paidCount,
              totalPay: src.totalCount,
              fromMapping: true,
            })
          }

          // DEBTS
          const debtExisting = new Set(m.debts.map(r => r.name))
          const debts: DebtRow[] = []
          for (const r of m.debts) {
            if (!r.fromMapping) { debts.push(r); continue }
            const src = debtByName.get(r.name)
            if (!src) continue
            debts.push({
              ...r,
              remaining: Math.round(src.remainingBalance),
              monthly:   Math.round(src.monthlyPayment),
              months:    src.remainingMonths,
            })
          }
          const debtDeleted = new Set(del.debts)
          for (const [name, src] of debtByName) {
            if (debtExisting.has(name)) continue
            if (debtDeleted.has(name)) continue   // user explicitly deleted — respect it
            if (src.monthlyPayment <= 0 && src.remainingBalance <= 0) continue
            debts.push({
              id: uid(), name,
              remaining: Math.round(src.remainingBalance),
              monthly:   Math.round(src.monthlyPayment),
              months:    src.remainingMonths,
              fromMapping: true,
            })
          }

          // SAVINGS
          const savExisting = new Set(m.savings.map(r => r.name))
          const savings: SavingRow[] = []
          for (const r of m.savings) {
            if (!r.fromMapping) { savings.push(r); continue }
            const src = savByName.get(r.name)
            if (!src) continue
            savings.push({
              ...r,
              monthly:     Math.round(src.monthlyContribution),
              accumulated: Math.round(src.accumulated),
            })
          }
          const savDeleted = new Set(del.savings)
          for (const [name, src] of savByName) {
            if (savExisting.has(name)) continue
            if (savDeleted.has(name)) continue   // user explicitly deleted — respect it
            if (src.monthlyContribution <= 0 && src.accumulated <= 0) continue
            savings.push({
              id: uid(), name,
              monthly:     Math.round(src.monthlyContribution),
              accumulated: Math.round(src.accumulated),
              fromMapping: true,
            })
          }

          newMonths[mid] = { ...m, fixed, variable, sub, ins, installments, debts, savings }
        })

        return { months: newMonths }
      })
    },
  }
})
