'use client'

import { create } from 'zustand'
import { VAT_RATE, DEFAULT_TAX_POINTS } from '@/lib/businessTax'
import type { BizRow, BizSection, BusinessType } from '@/stores/businessStore'

function uid() { return Math.random().toString(36).slice(2) }

/**
 * Annual business plan — a full-year P&L. Amounts are ANNUAL (₪/year).
 * Fully isolated from businessStore (the monthly tab); the page may seed
 * this store from the monthly averages via a one-way read, but never aliases.
 */
interface BusinessAnnualState {
  businessType: BusinessType
  year: number

  revenue: BizRow[] // מחזור / הכנסות שנתי
  cogs: BizRow[]    // הוצאות גולמיות שנתי
  opex: BizRow[]    // הוצאות תפעוליות שנתי

  ownerSalary: number // משכורת אישית שנתית

  taxPoints: number
  vatRate: number

  incomeTaxOverride: number | null
  bituachLeumiOverride: number | null
  companyTaxOverride: number | null
  vatOverride: number | null

  setBusinessType: (t: BusinessType) => void
  setYear: (y: number) => void

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

  /** Replace revenue/cogs/opex/salary with seeded annual rows (called by the page). */
  seed: (data: {
    businessType: BusinessType
    revenue: BizRow[]; cogs: BizRow[]; opex: BizRow[]
    ownerSalary: number; taxPoints: number; vatRate: number
  }) => void
}

function makeRows(items: { name: string; vatDeductible?: boolean }[]): BizRow[] {
  return items.map(it => ({ id: uid(), name: it.name, amount: 0, vatDeductible: it.vatDeductible ?? true }))
}

export const DEFAULT_BUSINESS_ANNUAL = {
  businessType: 'osek_murshe' as BusinessType,
  year: new Date().getFullYear(),
  revenue: makeRows([{ name: 'מכירות / שירותים' }]),
  cogs: makeRows([{ name: 'חומרי גלם / מלאי' }, { name: 'קבלני משנה' }]),
  opex: makeRows([
    { name: 'שכירות וארנונה' },
    { name: 'שיווק ופרסום' },
    { name: 'רכב ונסיעות' },
    { name: 'תקשורת ומשרד' },
    { name: 'הנהלת חשבונות' },
    { name: 'משכורות עובדים', vatDeductible: false },
  ]),
  ownerSalary: 0,
  taxPoints: DEFAULT_TAX_POINTS,
  vatRate: VAT_RATE,
  incomeTaxOverride: null as number | null,
  bituachLeumiOverride: null as number | null,
  companyTaxOverride: null as number | null,
  vatOverride: null as number | null,
}

export const useBusinessAnnualStore = create<BusinessAnnualState>((set, get) => ({
  ...DEFAULT_BUSINESS_ANNUAL,
  // fresh row identities (avoid sharing default array references across reloads)
  revenue: makeRows([{ name: 'מכירות / שירותים' }]),
  cogs: makeRows([{ name: 'חומרי גלם / מלאי' }, { name: 'קבלני משנה' }]),
  opex: makeRows([
    { name: 'שכירות וארנונה' },
    { name: 'שיווק ופרסום' },
    { name: 'רכב ונסיעות' },
    { name: 'תקשורת ומשרד' },
    { name: 'הנהלת חשבונות' },
    { name: 'משכורות עובדים', vatDeductible: false },
  ]),

  setBusinessType: (t) => set({ businessType: t }),
  setYear: (y) => set({ year: y }),

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

  seed: (data) => set({
    businessType: data.businessType,
    revenue: data.revenue,
    cogs: data.cogs,
    opex: data.opex,
    ownerSalary: data.ownerSalary,
    taxPoints: data.taxPoints,
    vatRate: data.vatRate,
  }),
}))
