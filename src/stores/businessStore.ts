'use client'

import { create } from 'zustand'
import { VAT_RATE, DEFAULT_TAX_POINTS } from '@/lib/businessTax'

function uid() { return Math.random().toString(36).slice(2) }

export type BusinessType = 'osek_murshe' | 'osek_patur' | 'company'

/** Row of a business P&L section. Amounts are monthly and entered לפני מע"מ. */
export interface BizRow {
  id: string
  name: string
  amount: number
  /** Only meaningful for expense rows — whether the row's VAT is recoverable as תשומות. */
  vatDeductible: boolean
}

export type BizSection = 'revenue' | 'cogs' | 'opex'

interface BusinessState {
  businessType: BusinessType

  revenue: BizRow[] // מחזור / הכנסות (לפני מע"מ)
  cogs: BizRow[]    // הוצאות גולמיות (עלות המכר)
  opex: BizRow[]    // הוצאות תפעוליות

  ownerSalary: number // משכורת אישית — משיכה חודשית לבית

  // ── tax config ──
  taxPoints: number // נקודות זיכוי
  vatRate: number   // ברירת מחדל 18%

  // ── manual overrides (auto-calc unless set) ──
  incomeTaxOverride: number | null
  bituachLeumiOverride: number | null
  companyTaxOverride: number | null
  vatOverride: number | null

  // ── actions ──
  setBusinessType: (t: BusinessType) => void

  addRow: (section: BizSection, name?: string) => void
  updateRow: (section: BizSection, id: string, field: 'name' | 'amount' | 'vatDeductible', value: string | number | boolean) => void
  deleteRow: (section: BizSection, id: string) => void

  setOwnerSalary: (v: number) => void
  setTaxPoints: (v: number) => void
  setVatRate: (v: number) => void

  setIncomeTaxOverride: (v: number | null) => void
  setBituachLeumiOverride: (v: number | null) => void
  setCompanyTaxOverride: (v: number | null) => void
  setVatOverride: (v: number | null) => void
}

function makeRows(items: { name: string; vatDeductible?: boolean }[]): BizRow[] {
  return items.map(it => ({ id: uid(), name: it.name, amount: 0, vatDeductible: it.vatDeductible ?? true }))
}

const DEFAULT_REVENUE: BizRow[] = makeRows([
  { name: 'מכירות / שירותים' },
])

const DEFAULT_COGS: BizRow[] = makeRows([
  { name: 'חומרי גלם / מלאי' },
  { name: 'קבלני משנה' },
])

const DEFAULT_OPEX: BizRow[] = makeRows([
  { name: 'שכירות וארנונה' },
  { name: 'שיווק ופרסום' },
  { name: 'רכב ונסיעות' },
  { name: 'תקשורת ומשרד' },
  { name: 'הנהלת חשבונות' },
  { name: 'משכורות עובדים', vatDeductible: false },
])

export const DEFAULT_BUSINESS = {
  businessType: 'osek_murshe' as BusinessType,
  revenue: DEFAULT_REVENUE,
  cogs: DEFAULT_COGS,
  opex: DEFAULT_OPEX,
  ownerSalary: 0,
  taxPoints: DEFAULT_TAX_POINTS,
  vatRate: VAT_RATE,
  incomeTaxOverride: null as number | null,
  bituachLeumiOverride: null as number | null,
  companyTaxOverride: null as number | null,
  vatOverride: null as number | null,
}

export const useBusinessStore = create<BusinessState>((set, get) => ({
  ...DEFAULT_BUSINESS,

  setBusinessType: (t) => set({ businessType: t }),

  addRow: (section, name = '') => {
    const prev = get()[section]
    set({ [section]: [...prev, { id: uid(), name, amount: 0, vatDeductible: true }] })
  },
  updateRow: (section, id, field, value) => {
    const prev = get()[section]
    set({ [section]: prev.map(r => r.id === id ? { ...r, [field]: value } : r) })
  },
  deleteRow: (section, id) => {
    const prev = get()[section]
    set({ [section]: prev.filter(r => r.id !== id) })
  },

  setOwnerSalary: (v) => set({ ownerSalary: Math.max(0, v) }),
  setTaxPoints: (v) => set({ taxPoints: Math.max(0, v) }),
  setVatRate: (v) => set({ vatRate: Math.max(0, v) }),

  setIncomeTaxOverride: (v) => set({ incomeTaxOverride: v }),
  setBituachLeumiOverride: (v) => set({ bituachLeumiOverride: v }),
  setCompanyTaxOverride: (v) => set({ companyTaxOverride: v }),
  setVatOverride: (v) => set({ vatOverride: v }),
}))
