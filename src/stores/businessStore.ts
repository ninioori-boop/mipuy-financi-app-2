'use client'

import { create } from 'zustand'
import { VAT_RATE, DEFAULT_TAX_POINTS } from '@/lib/businessTax'
import { PRIMARY_BUSINESS_ID } from '@/stores/businessRosterStore'

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

/** Everything the monthly business tab holds for ONE business. */
export interface BizData {
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
}

interface BusinessState {
  /** One entry per business in businessRosterStore.list, keyed by the same id. */
  byId: Record<string, BizData>

  // ── actions — every one names the business it edits ──
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

  // ── lifecycle (called by lib/businessProfiles, not by pages) ──
  /** Create the data slot for a new business — a deep copy of `from`, or fresh defaults. */
  createFor: (bizId: string, from?: string) => void
  removeFor: (bizId: string) => void
}

function makeRows(items: { name: string; vatDeductible?: boolean }[]): BizRow[] {
  return items.map(it => ({ id: uid(), name: it.name, amount: 0, vatDeductible: it.vatDeductible ?? true }))
}

const DEFAULT_REVENUE = [{ name: 'מכירות / שירותים' }]
const DEFAULT_COGS = [{ name: 'חומרי גלם / מלאי' }, { name: 'קבלני משנה' }]
const DEFAULT_OPEX = [
  { name: 'שכירות וארנונה' },
  { name: 'שיווק ופרסום' },
  { name: 'רכב ונסיעות' },
  { name: 'תקשורת ומשרד' },
  { name: 'הנהלת חשבונות' },
  { name: 'משכורות עובדים', vatDeductible: false },
]

/** Tax/type defaults — no rows. Shared with dataSync's reset path. */
export const DEFAULT_BUSINESS = {
  businessType: 'osek_murshe' as BusinessType,
  ownerSalary: 0,
  taxPoints: DEFAULT_TAX_POINTS,
  vatRate: VAT_RATE,
  incomeTaxOverride: null as number | null,
  bituachLeumiOverride: null as number | null,
  companyTaxOverride: null as number | null,
  vatOverride: null as number | null,
}

/** A brand-new business: default section rows at 0. */
export function makeDefaultBizData(): BizData {
  return {
    ...DEFAULT_BUSINESS,
    revenue: makeRows(DEFAULT_REVENUE),
    cogs: makeRows(DEFAULT_COGS),
    opex: makeRows(DEFAULT_OPEX),
  }
}

/** An empty business — used when resetting stores on sign-out. */
export function makeEmptyBizData(): BizData {
  return { ...DEFAULT_BUSINESS, revenue: [], cogs: [], opex: [] }
}

/**
 * Deep copy for duplication. Row ids are re-issued so the copy can never
 * alias the original — editing one business must not touch the other.
 */
export function cloneBizData(src: BizData): BizData {
  const copyRows = (rows: BizRow[]) => rows.map(r => ({ ...r, id: uid() }))
  return {
    ...src,
    revenue: copyRows(src.revenue),
    cogs: copyRows(src.cogs),
    opex: copyRows(src.opex),
  }
}

/**
 * Stable fallback for a missing id — a frozen module-level object, so a page
 * reading it repeatedly keeps referential equality and useMemo stays quiet.
 */
export const EMPTY_BIZ_DATA: BizData = Object.freeze({
  ...DEFAULT_BUSINESS,
  revenue: Object.freeze([]) as unknown as BizRow[],
  cogs: Object.freeze([]) as unknown as BizRow[],
  opex: Object.freeze([]) as unknown as BizRow[],
})

/** Read one business's data, never undefined. */
export function bizDataOf(byId: Record<string, BizData>, bizId: string): BizData {
  return byId[bizId] ?? EMPTY_BIZ_DATA
}

export const useBusinessStore = create<BusinessState>((set, get) => {
  /** Apply a patch to one business; a no-op if that business doesn't exist. */
  function patch(bizId: string, fn: (d: BizData) => Partial<BizData>) {
    const cur = get().byId[bizId]
    if (!cur) return
    set({ byId: { ...get().byId, [bizId]: { ...cur, ...fn(cur) } } })
  }

  return {
    byId: { [PRIMARY_BUSINESS_ID]: makeDefaultBizData() },

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

    createFor: (bizId, from) => {
      const byId = get().byId
      if (byId[bizId]) return
      const src = from ? byId[from] : undefined
      set({ byId: { ...byId, [bizId]: src ? cloneBizData(src) : makeDefaultBizData() } })
    },

    removeFor: (bizId) => {
      const byId = { ...get().byId }
      delete byId[bizId]
      set({ byId })
    },
  }
})
