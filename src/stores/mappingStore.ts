'use client'

import { create } from 'zustand'
import type { Transaction } from '@/types/transaction'
import {
  VAR_CATEGORIES, ANNUAL_CATEGORIES, FIXED_CATEGORIES,
  INSURANCE_CATEGORIES, SUB_CATEGORIES, SKIP_CATEGORIES,
} from '@/lib/constants'

export interface MappingRow {
  id: string
  name: string
  amount: number       // monthly for income/fixed/sub/ins; period-total for variable
  fromCredit?: boolean
  fromBank?:   boolean // true → originated from Bank tab import; protects from Credit-import wipe
}

export interface AnnualRow {
  id: string
  name: string
  annualAmount: number // yearly; monthly = annualAmount / 12
  fromCredit?: boolean
  fromBank?:   boolean // true → originated from Bank tab import; protects from Credit-import wipe
}

export interface DebtRow {
  id: string
  name: string
  originalBalance: number
  remainingBalance: number
  interestRate: number
  remainingMonths: number
  monthlyPayment: number
}

export interface InstallmentRow {
  id: string
  name: string
  totalAmount: number
  monthlyPayment: number
  paidCount: number
  totalCount: number
}

export interface SavingRow {
  id: string
  name: string
  monthlyContribution: number
  accumulated: number
  feeBalance: number   // דמי ניהול מהצבירה (%)
  feeDeposit: number   // דמי ניהול מההפקדה (%)
}

export type SimpleSection = 'income' | 'fixed' | 'sub' | 'ins'

let _seq = 0
function uid(): string { return `r${++_seq}` }

function makeRows(names: string[]): MappingRow[] {
  return names.map(name => ({ id: uid(), name, amount: 0 }))
}

const DEFAULT_INCOME = makeRows([
  'בעל עבודה 1', 'בעל עבודה 2', 'אישה עבודה 1', 'אישה עבודה 2',
  'קצבת ילדים', 'קצבאות נוספות', 'הכנסה מנכס', 'הכנסות מהעסק',
])

const DEFAULT_FIXED = makeRows([
  'שכר דירה / משכנתא', 'ועד בית', 'ארנונה', 'חשמל', 'גז', 'מים וביוב',
])

const DEFAULT_SUB = makeRows([
  'Netflix', 'Spotify / Apple Music', 'כבלים / Hot / Yes', 'ספק אינטרנט', 'טלפון נייד',
])

const DEFAULT_INS = makeRows([
  'ביטוח חיים', 'ביטוח בריאות / מכבי', 'ביטוח רכב חובה', 'ביטוח רכב מקיף', 'ביטוח דירה',
])

// Variable rows store period totals (not monthly) — monthly = amount / varMonths
const DEFAULT_VARIABLE = makeRows([
  'מזון לבית', 'אוכל בחוץ ובילויים', 'פארם', 'דלק וחניה',
  'ביגוד והנעלה', 'תחב"צ', 'תספורת וקוסמטיקה', 'תחביבים',
  'תיקוני רכב', 'בריאות', 'בעלי חיים', 'חינוך / דמי כיס', 'שונות',
])

const DEFAULT_ANNUAL: AnnualRow[] = [
  'חינוך, חוגים וקייטנות', 'ביטוחי בריאות וחיים', 'ביטוחי רכב',
  'חופשות', 'מתנות לאירועים', 'מנויים שנתיים',
].map(name => ({ id: uid(), name, annualAmount: 0 }))

const DEFAULT_DEBTS: DebtRow[] = [
  { id: uid(), name: 'משכנתא', originalBalance: 0, remainingBalance: 0, interestRate: 0, remainingMonths: 0, monthlyPayment: 0 },
]

const DEFAULT_INSTALLMENTS: InstallmentRow[] = []

const DEFAULT_SAVINGS: SavingRow[] = [
  'קרן חירום', 'חיסכון בבנק', 'קרן השתלמות', 'קרן פנסיה', 'קופת גמל להשקעה', 'חסכונות ילדים',
].map(name => ({ id: uid(), name, monthlyContribution: 0, accumulated: 0, feeBalance: 0, feeDeposit: 0 }))

interface MappingState {
  income: MappingRow[]
  fixed: MappingRow[]
  sub: MappingRow[]
  ins: MappingRow[]
  variable: MappingRow[]
  annual: AnnualRow[]
  debts: DebtRow[]
  installments: InstallmentRow[]
  savings: SavingRow[]
  varMonths: number
  creditImported: boolean

  /** Fraction of monthly surplus the user wants kept in the checking buffer (0..1).
   *  Anything above this flows to the goals tab as the monthly savings budget. */
  bufferPct: number
  setBufferPct: (pct: number) => void

  /** Optional manual overrides for the checking tool. When null, the checking
   *  and goals tabs derive totals from the mapping rows. When set, they take
   *  precedence so the user's manual numbers flow downstream consistently. */
  incomeOverride:   number | null
  expensesOverride: number | null
  setIncomeOverride:   (val: number | null) => void
  setExpensesOverride: (val: number | null) => void

  /** Client credit-rating score (free number). */
  creditScore: number
  setCreditScore: (val: number) => void

  // Simple sections (income / fixed / sub / ins)
  addRow: (section: SimpleSection, name?: string) => void
  updateRow: (section: SimpleSection, id: string, field: 'name' | 'amount', value: string | number) => void
  deleteRow: (section: SimpleSection, id: string) => void

  // Variable
  addVarRow: (name?: string) => void
  updateVarRow: (id: string, field: 'name' | 'amount', value: string | number) => void
  deleteVarRow: (id: string) => void
  setVarMonths: (months: number) => void
  importFromCredit: (transactions: Transaction[], months: number) => void

  // Annual
  addAnnualRow: () => void
  updateAnnualRow: (id: string, field: 'name' | 'annualAmount', value: string | number) => void
  deleteAnnualRow: (id: string) => void

  // Debts
  addDebtRow: () => void
  updateDebtRow: (id: string, field: keyof Omit<DebtRow, 'id'>, value: string | number) => void
  deleteDebtRow: (id: string) => void

  // Installments
  addInstallmentRow: () => void
  updateInstallmentRow: (id: string, field: keyof Omit<InstallmentRow, 'id'>, value: string | number) => void
  deleteInstallmentRow: (id: string) => void

  // Savings
  addSavingRow: () => void
  updateSavingRow: (id: string, field: keyof Omit<SavingRow, 'id'>, value: string | number) => void
  deleteSavingRow: (id: string) => void

  // Bank import
  importFromBank: (rows: { name: string; amount: number; section: 'fixed' | 'variable' | 'sub' | 'ins' | 'annual' }[]) => void
}

export const useMappingStore = create<MappingState>((set, get) => ({
  income: DEFAULT_INCOME,
  fixed: DEFAULT_FIXED,
  sub: DEFAULT_SUB,
  ins: DEFAULT_INS,
  variable: DEFAULT_VARIABLE,
  annual: DEFAULT_ANNUAL,
  debts: DEFAULT_DEBTS,
  installments: DEFAULT_INSTALLMENTS,
  savings: DEFAULT_SAVINGS,
  varMonths: 3,
  creditImported: false,
  bufferPct: 0.4,
  setBufferPct: (pct) => set({ bufferPct: Math.max(0, Math.min(1, pct)) }),

  incomeOverride: null,
  expensesOverride: null,
  setIncomeOverride:   (val) => set({ incomeOverride:   val }),
  setExpensesOverride: (val) => set({ expensesOverride: val }),

  creditScore: 0,
  setCreditScore: (val) => set({ creditScore: Math.max(0, val) }),

  addRow: (section, name = '') => {
    const prev = get()[section] as MappingRow[]
    set({ [section]: [...prev, { id: uid(), name, amount: 0 }] })
  },
  updateRow: (section, id, field, value) => {
    const prev = get()[section] as MappingRow[]
    set({ [section]: prev.map(r => r.id === id ? { ...r, [field]: value } : r) })
  },
  deleteRow: (section, id) => {
    const prev = get()[section] as MappingRow[]
    set({ [section]: prev.filter(r => r.id !== id) })
  },

  addVarRow: (name = '') =>
    set(s => ({ variable: [...s.variable, { id: uid(), name, amount: 0 }] })),
  updateVarRow: (id, field, value) =>
    set(s => ({ variable: s.variable.map(r => r.id === id ? { ...r, [field]: value } : r) })),
  deleteVarRow: (id) =>
    set(s => ({ variable: s.variable.filter(r => r.id !== id) })),

  setVarMonths: (months) => set({ varMonths: Math.max(1, Math.min(24, months)) }),

  importFromCredit: (transactions, months) => {
    const m = Math.max(1, months)
    const s = get()

    // Sum amounts by category (exclude refunds)
    const totals: Record<string, number> = {}
    transactions.forEach(t => {
      if (t.isRefund) return
      totals[t.category] = (totals[t.category] ?? 0) + t.amount
    })

    // Helper: merge new amount into existing fromCredit rows, or add new row.
    // Bank-imported rows (fromBank) are NOT merge targets — they stay as-is to
    // preserve the bank-provided value; credit data lands in a separate row.
    function mergeRows(existing: MappingRow[], cat: string, addAmt: number): MappingRow[] {
      const idx = existing.findIndex(r => r.fromCredit && !r.fromBank && r.name === cat)
      if (idx >= 0) {
        const updated = [...existing]
        updated[idx] = { ...updated[idx], amount: updated[idx].amount + addAmt }
        return updated
      }
      return [...existing, { id: uid(), name: cat, amount: addAmt, fromCredit: true }]
    }

    function mergeAnnual(existing: AnnualRow[], cat: string, addAmt: number): AnnualRow[] {
      const idx = existing.findIndex(r => r.fromCredit && !r.fromBank && r.name === cat)
      if (idx >= 0) {
        const updated = [...existing]
        updated[idx] = { ...updated[idx], annualAmount: updated[idx].annualAmount + addAmt }
        return updated
      }
      return [...existing, { id: uid(), name: cat, annualAmount: addAmt, fromCredit: true }]
    }

    // Drop previously-imported credit rows first, keeping manual rows, so that
    // re-running the import (after AI, on months change, on re-upload) REPLACES
    // the credit-derived amounts instead of accumulating them. Without this the
    // amounts double/triple every time the import re-runs.
    // Drop fromCredit rows that did NOT originate from the Bank tab. Bank rows
    // (fromBank:true) survive the wipe — they represent manual setup work that
    // a re-run of credit import must not destroy.
    let variable = s.variable.filter(r => !(r.fromCredit && !r.fromBank))
    let fixed    = s.fixed.filter(r => !(r.fromCredit && !r.fromBank))
    let sub      = s.sub.filter(r => !(r.fromCredit && !r.fromBank))
    let ins      = s.ins.filter(r => !(r.fromCredit && !r.fromBank))
    let annual   = s.annual.filter(r => !(r.fromCredit && !r.fromBank))

    Object.entries(totals).forEach(([cat, totalAmt]) => {
      if (totalAmt <= 0) return
      if (SKIP_CATEGORIES.has(cat)) return

      if (VAR_CATEGORIES.has(cat)) {
        variable = mergeRows(variable, cat, Math.round(totalAmt))
      } else if (ANNUAL_CATEGORIES.has(cat)) {
        // Annual categories are lumpy (vacation, gifts) — use the actual total
        // spent as the yearly figure (the panel shows ÷12 for the monthly).
        // Do NOT annualize a monthly average, which over-inflates a one-off spend.
        annual = mergeAnnual(annual, cat, Math.round(totalAmt))
      } else if (FIXED_CATEGORIES.has(cat)) {
        fixed = mergeRows(fixed, cat, Math.round(totalAmt / m))
      } else if (INSURANCE_CATEGORIES.has(cat)) {
        ins = mergeRows(ins, cat, Math.round(totalAmt / m))
      } else if (SUB_CATEGORIES.has(cat)) {
        sub = mergeRows(sub, cat, Math.round(totalAmt / m))
      }
    })

    const sortMR = (rows: MappingRow[]) => [...rows].sort((a, b) => b.amount - a.amount)
    const sortAR = (rows: AnnualRow[])  => [...rows].sort((a, b) => b.annualAmount - a.annualAmount)

    set({
      variable: sortMR(variable),
      fixed:    sortMR(fixed),
      sub:      sortMR(sub),
      ins:      sortMR(ins),
      annual:   sortAR(annual),
      varMonths: months,
      creditImported: true,
    })
  },

  addAnnualRow: () =>
    set(s => ({ annual: [...s.annual, { id: uid(), name: '', annualAmount: 0 }] })),
  updateAnnualRow: (id, field, value) =>
    set(s => ({ annual: s.annual.map(r => r.id === id ? { ...r, [field]: value } : r) })),
  deleteAnnualRow: (id) =>
    set(s => ({ annual: s.annual.filter(r => r.id !== id) })),

  addDebtRow: () =>
    set(s => ({ debts: [...s.debts, { id: uid(), name: '', originalBalance: 0, remainingBalance: 0, interestRate: 0, remainingMonths: 0, monthlyPayment: 0 }] })),
  updateDebtRow: (id, field, value) =>
    set(s => ({ debts: s.debts.map(r => r.id === id ? { ...r, [field]: value } : r) })),
  deleteDebtRow: (id) =>
    set(s => ({ debts: s.debts.filter(r => r.id !== id) })),

  addInstallmentRow: () =>
    set(s => ({ installments: [...s.installments, { id: uid(), name: '', totalAmount: 0, monthlyPayment: 0, paidCount: 0, totalCount: 0 }] })),
  updateInstallmentRow: (id, field, value) =>
    set(s => ({ installments: s.installments.map(r => r.id === id ? { ...r, [field]: value } : r) })),
  deleteInstallmentRow: (id) =>
    set(s => ({ installments: s.installments.filter(r => r.id !== id) })),

  addSavingRow: () =>
    set(s => ({ savings: [...s.savings, { id: uid(), name: '', monthlyContribution: 0, accumulated: 0, feeBalance: 0, feeDeposit: 0 }] })),
  updateSavingRow: (id, field, value) =>
    set(s => ({ savings: s.savings.map(r => r.id === id ? { ...r, [field]: value } : r) })),
  deleteSavingRow: (id) =>
    set(s => ({ savings: s.savings.filter(r => r.id !== id) })),

  importFromBank: (rows) => {
    const newFixed:    MappingRow[] = []
    const newVariable: MappingRow[] = []
    const newSub:      MappingRow[] = []
    const newIns:      MappingRow[] = []
    const newAnnual:   AnnualRow[]  = []

    rows.forEach(r => {
      if (r.section === 'fixed')    newFixed.push(   { id: uid(), name: r.name, amount: r.amount, fromCredit: true, fromBank: true })
      else if (r.section === 'variable') newVariable.push({ id: uid(), name: r.name, amount: r.amount, fromCredit: true, fromBank: true })
      else if (r.section === 'sub')     newSub.push(    { id: uid(), name: r.name, amount: r.amount, fromCredit: true, fromBank: true })
      else if (r.section === 'ins')     newIns.push(    { id: uid(), name: r.name, amount: r.amount, fromCredit: true, fromBank: true })
      else if (r.section === 'annual')  newAnnual.push( { id: uid(), name: r.name, annualAmount: r.amount, fromCredit: true, fromBank: true })
    })

    set(s => ({
      fixed:    [...newFixed,    ...s.fixed],
      variable: [...newVariable, ...s.variable],
      sub:      [...newSub,      ...s.sub],
      ins:      [...newIns,      ...s.ins],
      annual:   [...newAnnual,   ...s.annual],
    }))
  },
}))
