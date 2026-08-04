'use client'

import { create } from 'zustand'
import { VAT_RATE, DEFAULT_TAX_POINTS } from '@/lib/businessTax'
import {
  type BizData, type BizRow, type BizSection, type BusinessType,
  cloneBizData,
} from '@/stores/businessStore'
import { PRIMARY_BUSINESS_ID } from '@/stores/businessRosterStore'

function uid() { return Math.random().toString(36).slice(2) }

/**
 * Annual business plan — a full-year P&L per business. Amounts are ANNUAL (₪/year).
 * Keyed by the same business ids as businessRosterStore, but fully isolated from
 * businessStore (the monthly tab): the page may seed a business here from its
 * monthly averages via a one-way read, and the seed deep-copies — never aliases.
 *
 * `year` is deliberately global, not per business: the household plans one year.
 */
interface BusinessAnnualState {
  year: number
  byId: Record<string, BizData>

  setYear: (y: number) => void
  setBusinessType: (bizId: string, t: BusinessType) => void

  addRow: (bizId: string, section: BizSection, name?: string) => void
  updateRow: (bizId: string, section: BizSection, id: string, field: 'name' | 'amount' | 'vatDeductible', value: string | number | boolean) => void
  deleteRow: (bizId: string, section: BizSection, id: string) => void

  setOwnerSalary: (bizId: string, v: number) => void
  setTaxPoints: (bizId: string, v: number) => void
  setVatRate: (bizId: string, v: number) => void

  setIncomeTaxOverride: (bizId: string, v: number | null) => void
  setBituachLeumiOverride: (bizId: string, v: number | null) => void
  setCompanyTaxOverride: (bizId: string, v: number | null) => void
  setVatOverride: (bizId: string, v: number | null) => void

  /** Replace one business's revenue/cogs/opex/salary with seeded annual rows (called by the page). */
  seed: (bizId: string, data: {
    businessType: BusinessType
    revenue: BizRow[]; cogs: BizRow[]; opex: BizRow[]
    ownerSalary: number; taxPoints: number; vatRate: number
  }) => void

  // ── lifecycle (called by lib/businessProfiles, not by pages) ──
  createFor: (bizId: string, from?: string) => void
  removeFor: (bizId: string) => void
}

function makeRows(items: { name: string; vatDeductible?: boolean }[]): BizRow[] {
  return items.map(it => ({ id: uid(), name: it.name, amount: 0, vatDeductible: it.vatDeductible ?? true }))
}

export const DEFAULT_BUSINESS_ANNUAL = {
  businessType: 'osek_murshe' as BusinessType,
  ownerSalary: 0,
  taxPoints: DEFAULT_TAX_POINTS,
  vatRate: VAT_RATE,
  incomeTaxOverride: null as number | null,
  bituachLeumiOverride: null as number | null,
  companyTaxOverride: null as number | null,
  vatOverride: null as number | null,
}

/** A brand-new annual plan: default section rows at 0. */
export function makeDefaultAnnualData(): BizData {
  return {
    ...DEFAULT_BUSINESS_ANNUAL,
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
  }
}

export function makeEmptyAnnualData(): BizData {
  return { ...DEFAULT_BUSINESS_ANNUAL, revenue: [], cogs: [], opex: [] }
}

export const useBusinessAnnualStore = create<BusinessAnnualState>((set, get) => {
  function patch(bizId: string, fn: (d: BizData) => Partial<BizData>) {
    const cur = get().byId[bizId]
    if (!cur) return
    set({ byId: { ...get().byId, [bizId]: { ...cur, ...fn(cur) } } })
  }

  return {
    year: new Date().getFullYear(),
    byId: { [PRIMARY_BUSINESS_ID]: makeDefaultAnnualData() },

    setYear: (y) => set({ year: y }),
    setBusinessType: (bizId, t) => patch(bizId, () => ({ businessType: t })),

    addRow: (bizId, section, name = '') =>
      patch(bizId, d => ({ [section]: [...d[section], { id: uid(), name, amount: 0, vatDeductible: true }] })),

    updateRow: (bizId, section, id, field, value) =>
      patch(bizId, d => ({ [section]: d[section].map(r => r.id === id ? { ...r, [field]: value } : r) })),

    deleteRow: (bizId, section, id) =>
      patch(bizId, d => ({ [section]: d[section].filter(r => r.id !== id) })),

    setOwnerSalary: (bizId, v) => patch(bizId, () => ({ ownerSalary: Math.max(0, v) })),
    setTaxPoints:   (bizId, v) => patch(bizId, () => ({ taxPoints: Math.max(0, v) })),
    setVatRate:     (bizId, v) => patch(bizId, () => ({ vatRate: Math.max(0, v) })),

    setIncomeTaxOverride:    (bizId, v) => patch(bizId, () => ({ incomeTaxOverride: v })),
    setBituachLeumiOverride: (bizId, v) => patch(bizId, () => ({ bituachLeumiOverride: v })),
    setCompanyTaxOverride:   (bizId, v) => patch(bizId, () => ({ companyTaxOverride: v })),
    setVatOverride:          (bizId, v) => patch(bizId, () => ({ vatOverride: v })),

    seed: (bizId, data) => patch(bizId, () => ({
      businessType: data.businessType,
      revenue: data.revenue,
      cogs: data.cogs,
      opex: data.opex,
      ownerSalary: data.ownerSalary,
      taxPoints: data.taxPoints,
      vatRate: data.vatRate,
    })),

    createFor: (bizId, from) => {
      const byId = get().byId
      if (byId[bizId]) return
      const src = from ? byId[from] : undefined
      set({ byId: { ...byId, [bizId]: src ? cloneBizData(src) : makeDefaultAnnualData() } })
    },

    removeFor: (bizId) => {
      const byId = { ...get().byId }
      delete byId[bizId]
      set({ byId })
    },
  }
})
