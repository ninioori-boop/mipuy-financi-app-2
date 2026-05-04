'use client'

import { create } from 'zustand'
import { MONTH_DEFAULT_ROWS, FIXED_CATEGORIES, VAR_CATEGORIES, INSURANCE_CATEGORIES, SUB_CATEGORIES } from '@/lib/constants'

function uid() { return Math.random().toString(36).slice(2) }

export interface BudgetRow {
  id: string
  name: string
  plan: number
  actual: number
}

export interface InstRow {
  id: string
  name: string
  total: number
  monthly: number
  current: number
  totalPay: number
}

export interface DebtRow {
  id: string
  name: string
  remaining: number
  monthly: number
  months: number
}

export interface SavingRow {
  id: string
  name: string
  monthly: number
  accumulated: number
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
    varMonths: number,
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
        [section]: m[section].map(r => r.id === id ? { ...r, [field]: value } : r),
      })),

    deleteRow: (monthId, section, id) =>
      updateMonth(monthId, m => ({
        ...m,
        [section]: m[section].filter(r => r.id !== id),
      })),

    addInstRow: (monthId) =>
      updateMonth(monthId, m => ({
        ...m,
        installments: [...m.installments, { id: uid(), name: '', total: 0, monthly: 0, current: 0, totalPay: 0 }],
      })),

    updateInstRow: (monthId, id, field, value) =>
      updateMonth(monthId, m => ({
        ...m,
        installments: m.installments.map(r => r.id === id ? { ...r, [field]: value } : r),
      })),

    deleteInstRow: (monthId, id) =>
      updateMonth(monthId, m => ({
        ...m,
        installments: m.installments.filter(r => r.id !== id),
      })),

    addDebtRow: (monthId) =>
      updateMonth(monthId, m => ({
        ...m,
        debts: [...m.debts, { id: uid(), name: '', remaining: 0, monthly: 0, months: 0 }],
      })),

    updateDebtRow: (monthId, id, field, value) =>
      updateMonth(monthId, m => ({
        ...m,
        debts: m.debts.map(r => r.id === id ? { ...r, [field]: value } : r),
      })),

    deleteDebtRow: (monthId, id) =>
      updateMonth(monthId, m => ({
        ...m,
        debts: m.debts.filter(r => r.id !== id),
      })),

    addSavingRow: (monthId) =>
      updateMonth(monthId, m => ({
        ...m,
        savings: [...m.savings, { id: uid(), name: '', monthly: 0, accumulated: 0 }],
      })),

    updateSavingRow: (monthId, id, field, value) =>
      updateMonth(monthId, m => ({
        ...m,
        savings: m.savings.map(r => r.id === id ? { ...r, [field]: value } : r),
      })),

    deleteSavingRow: (monthId, id) =>
      updateMonth(monthId, m => ({
        ...m,
        savings: m.savings.filter(r => r.id !== id),
      })),

    applyImport: (monthId, catSums, mappingFixed, mappingVariable, mappingSub, mappingIns, varMonths) => {
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
        fixed    = fillActual(fixed,    FIXED_CATEGORIES)
        variable = fillActual(variable, VAR_CATEGORIES)
        sub      = fillActual(sub,      SUB_CATEGORIES)
        ins      = fillActual(ins,      INSURANCE_CATEGORIES)

        return { ...m, fixed, variable, sub, ins }
      })
    },
  }
})
