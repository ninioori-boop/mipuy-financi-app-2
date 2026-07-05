'use client'

import { create } from 'zustand'
import type { Transaction } from '@/types/transaction'
import {
  VAR_CATEGORIES, ANNUAL_CATEGORIES, FIXED_CATEGORIES,
  INSURANCE_CATEGORIES, SUB_CATEGORIES, SKIP_CATEGORIES,
} from '@/lib/constants'
import { normalizeForLookup } from '@/lib/categorize'

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

// Credit card snapshot — limit + when the monthly charge hits the bank.
// Helps the advisor plan cash-flow timing (income must arrive before the
// charge date). chargeDay is the day-of-month the bill is debited.
export interface CreditCardRow {
  id: string
  name: string
  limit: number       // מסגרת — total credit line on the card
  chargeDay: number   // 1-28; the safe upper bound that exists in every month
}

// Checking-account (עו"ש) snapshot — current balance + agreed overdraft.
// balance can be negative when the client is in overdraft; overdraftLimit
// is the bank-approved minus line ("מסגרת אוברדראפט").
export interface BankAccountRow {
  id: string
  name: string
  balance: number
  overdraftLimit: number
}

export type SimpleSection = 'income' | 'fixed' | 'sub' | 'ins'

// Random-enough id. Used to be a counter (`r${++_seq}`), but that reset to
// zero on every page reload — and then collided with IDs already present in
// the loaded Firestore snapshot. Two rows ending up with the same id makes
// React render them with the same key, which causes the symptom where a
// delete click removes the wrong row and the UI gets stuck.
function uid(): string { return 'r' + Math.random().toString(36).slice(2, 11) }

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

// Default with one empty row so the panel doesn't feel barren on first open —
// the advisor sees the column structure and fills it in.
const DEFAULT_CREDIT_CARDS: CreditCardRow[] = [
  { id: uid(), name: '', limit: 0, chargeDay: 2 },
]

const DEFAULT_BANK_ACCOUNTS: BankAccountRow[] = [
  { id: uid(), name: '', balance: 0, overdraftLimit: 0 },
]

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
  creditCards: CreditCardRow[]
  bankAccounts: BankAccountRow[]
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

  // Credit cards (snapshot only — limit + charge date, no monthly amount)
  addCreditCardRow: () => void
  updateCreditCardRow: (id: string, field: keyof Omit<CreditCardRow, 'id'>, value: string | number) => void
  deleteCreditCardRow: (id: string) => void

  // Checking account (עו"ש) — current balance + agreed overdraft
  addBankAccountRow: () => void
  updateBankAccountRow: (id: string, field: keyof Omit<BankAccountRow, 'id'>, value: string | number) => void
  deleteBankAccountRow: (id: string) => void

  // Bank import
  importFromBank: (rows: {
    name:    string
    amount:  number             // monthly cost-basis to ADD to the target section as a new row
    section: 'income' | 'fixed' | 'variable' | 'sub' | 'ins' | 'annual'
    /**
     * When present, the matching fromCredit row in the source category's
     * section gets reduced by `amount`. Used by the credit-tab SmartPatterns
     * "carve a merchant out of its category" flow: e.g. sending Cellcom to
     * "מנויים" should reduce the "תקשורת" row by Cellcom's historical
     * contribution (item.amount × count), leaving only non-Cellcom items.
     */
    subtractFrom?: { category: string; amount: number }
  }[]) => void
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
  creditCards: DEFAULT_CREDIT_CARDS,
  bankAccounts: DEFAULT_BANK_ACCOUNTS,
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

    // Sum amounts by category (exclude refunds). Each category produces ONE
    // row in mapping — a clear, consolidated total the coach can read at a
    // glance. Individual merchants get "carved out" of their category row on
    // demand via the SmartPatterns "send to mapping" buttons (which subtract
    // the merchant's historical contribution from the category total).
    //
    // Merchants that already have their own carved-out row (fromBank:true)
    // are excluded from the aggregated totals — otherwise re-running import
    // would double-count them (once in the standalone row + once in the
    // category total). This is what SmartPatterns' subtractFrom achieves
    // for the LIVE row; here we do the same for a fresh rebuild.
    const carvedOutMerchants = new Set<string>()
    for (const r of [...s.fixed, ...s.sub, ...s.ins, ...s.variable, ...s.annual]) {
      if (!r.fromBank) continue
      const key = normalizeForLookup(r.name)
      if (key) carvedOutMerchants.add(key)
    }
    const totals: Record<string, number> = {}
    transactions.forEach(t => {
      if (t.isRefund) return
      if (carvedOutMerchants.has(normalizeForLookup(t.desc))) return
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

  addCreditCardRow: () =>
    set(s => ({ creditCards: [...s.creditCards, { id: uid(), name: '', limit: 0, chargeDay: 2 }] })),
  updateCreditCardRow: (id, field, value) =>
    set(s => ({
      creditCards: s.creditCards.map(r => {
        if (r.id !== id) return r
        // chargeDay clamped 1..28 so the date exists in every month (Feb in
        // particular). limit clamped to non-negative.
        if (field === 'chargeDay') return { ...r, chargeDay: Math.max(1, Math.min(28, Math.round(Number(value) || 1))) }
        if (field === 'limit')     return { ...r, limit:     Math.max(0, Number(value) || 0) }
        if (field === 'name')      return { ...r, name:      String(value) }
        return r
      }),
    })),
  deleteCreditCardRow: (id) =>
    set(s => ({ creditCards: s.creditCards.filter(r => r.id !== id) })),

  addBankAccountRow: () =>
    set(s => ({ bankAccounts: [...s.bankAccounts, { id: uid(), name: '', balance: 0, overdraftLimit: 0 }] })),
  updateBankAccountRow: (id, field, value) =>
    set(s => ({
      bankAccounts: s.bankAccounts.map(r => {
        if (r.id !== id) return r
        // overdraftLimit non-negative; balance can be negative (overdraft).
        if (field === 'overdraftLimit') return { ...r, overdraftLimit: Math.max(0, Number(value) || 0) }
        if (field === 'balance')        return { ...r, balance:        Number(value) || 0 }
        if (field === 'name')           return { ...r, name:           String(value) }
        return r
      }),
    })),
  deleteBankAccountRow: (id) =>
    set(s => ({ bankAccounts: s.bankAccounts.filter(r => r.id !== id) })),

  importFromBank: (rows) => {
    set(s => {
      let income   = s.income
      let fixed    = s.fixed
      let variable = s.variable
      let sub      = s.sub
      let ins      = s.ins
      let annual   = s.annual

      // For each incoming row: (a) add a fromCredit+fromBank row to the
      // target section, (b) optionally subtract the merchant's historical
      // contribution from a category row in its source section.
      rows.forEach(r => {
        // (a) ADD to target
        if (r.section === 'annual') {
          annual = [{ id: uid(), name: r.name, annualAmount: r.amount, fromCredit: true, fromBank: true }, ...annual]
        } else {
          const newRow: MappingRow = { id: uid(), name: r.name, amount: r.amount, fromCredit: true, fromBank: true }
          if      (r.section === 'income')   income   = [newRow, ...income]
          else if (r.section === 'fixed')    fixed    = [newRow, ...fixed]
          else if (r.section === 'variable') variable = [newRow, ...variable]
          else if (r.section === 'sub')      sub      = [newRow, ...sub]
          else if (r.section === 'ins')      ins      = [newRow, ...ins]
        }

        // (b) SUBTRACT from source category row, if requested
        if (!r.subtractFrom) return
        const { category, amount: rawSubAmt } = r.subtractFrom

        let sourceSection: 'fixed' | 'variable' | 'sub' | 'ins' | 'annual' | null = null
        if      (FIXED_CATEGORIES.has(category))     sourceSection = 'fixed'
        else if (VAR_CATEGORIES.has(category))       sourceSection = 'variable'
        else if (SUB_CATEGORIES.has(category))       sourceSection = 'sub'
        else if (INSURANCE_CATEGORIES.has(category)) sourceSection = 'ins'
        else if (ANNUAL_CATEGORIES.has(category))    sourceSection = 'annual'
        if (!sourceSection) return  // category not classifiable — silently skip

        // Scale the raw period total to match how the target row is stored.
        // importFromCredit divides fixed/sub/ins totals by `varMonths` (monthly
        // average), so the merchant's carve-out must be scaled the same way
        // to hit the row at the right magnitude. Without this scaling a raw
        // 150₪ period total gets subtracted from a 100₪/mo aggregated row →
        // row deleted entirely, including OTHER merchants that also lived in
        // it. Variable + annual store raw period totals (no scaling needed).
        const m = Math.max(1, s.varMonths)
        const subAmt = (sourceSection === 'fixed' || sourceSection === 'sub' || sourceSection === 'ins')
          ? Math.round(rawSubAmt / m)
          : rawSubAmt

        if (sourceSection === 'annual') {
          const idx = annual.findIndex(row => row.fromCredit && !row.fromBank && row.name === category)
          if (idx < 0) return
          const newAmt = annual[idx].annualAmount - subAmt
          annual = newAmt <= 0
            ? annual.filter((_, i) => i !== idx)
            : annual.map((row, i) => i === idx ? { ...row, annualAmount: newAmt } : row)
          return
        }

        const target = sourceSection === 'fixed' ? fixed
                     : sourceSection === 'variable' ? variable
                     : sourceSection === 'sub' ? sub
                     : ins
        const idx = target.findIndex(row => row.fromCredit && !row.fromBank && row.name === category)
        if (idx < 0) return
        const newAmt  = target[idx].amount - subAmt
        const updated = newAmt <= 0
          ? target.filter((_, i) => i !== idx)
          : target.map((row, i) => i === idx ? { ...row, amount: newAmt } : row)
        if      (sourceSection === 'fixed')    fixed    = updated
        else if (sourceSection === 'variable') variable = updated
        else if (sourceSection === 'sub')      sub      = updated
        else                                   ins      = updated
      })

      return { income, fixed, variable, sub, ins, annual }
    })
  },
}))
