'use client'

import { create } from 'zustand'

function uid() { return Math.random().toString(36).slice(2) }

export interface AnnualRow {
  id: string
  name: string
  annual: number
}

export interface AnnualDebtRow {
  id: string
  name: string
  annual: number
  balance: number
}

export type AnnualSection = 'income' | 'fixed' | 'variable' | 'sub' | 'savings'

// The expense rows carry the CANONICAL category names (src/lib/constants.ts),
// the same vocabulary the mapping tab and the imported reports speak. They used
// to carry a private set of labels ("פנאי ובילויים" where everything else says
// "אוכל בחוץ ובילויים"), which was harmless while this tab talked to nobody, but
// now that the plan flows into the month it would put two lines in front of the
// client for one real expense. Income and savings stay free text: they are not
// categories, nothing classifies into them.
// Existing clients keep whatever they typed — this only seeds an empty tab.
const DEFAULTS: Record<AnnualSection, string[]> = {
  income:   ['שכר עבודה (נטו)', 'הכנסה נוספת'],
  fixed:    ['שכר דירה', 'משכנתא', 'ארנונה', 'ועד בית', 'חשמל', 'מים', 'גז'],
  variable: ['מזון לבית', 'אוכל בחוץ ובילויים', 'דלק וחניה', 'בריאות', 'חינוך וקייטנות', 'ביגוד והנעלה'],
  sub:      ['מנויים', 'חדר כושר', 'ביטוח חיים', 'ביטוח בריאות', 'ביטוח רכב'],
  savings:  ['קרן חירום', 'פנסיה / השקעות'],
}

function makeRows(section: AnnualSection): AnnualRow[] {
  return DEFAULTS[section].map(name => ({ id: uid(), name, annual: 0 }))
}

interface AnnualState {
  year: number
  income:   AnnualRow[]
  fixed:    AnnualRow[]
  variable: AnnualRow[]
  sub:      AnnualRow[]
  savings:  AnnualRow[]
  debt:     AnnualDebtRow[]

  setYear:    (year: number) => void
  addRow:     (section: AnnualSection) => void
  updateRow:  (section: AnnualSection, id: string, field: 'name' | 'annual', value: string | number) => void
  deleteRow:  (section: AnnualSection, id: string) => void
  addDebtRow: () => void
  updateDebtRow: (id: string, field: 'name' | 'annual' | 'balance', value: string | number) => void
  deleteDebtRow: (id: string) => void
}

export const useAnnualStore = create<AnnualState>((set, get) => ({
  year:     new Date().getFullYear(),
  income:   makeRows('income'),
  fixed:    makeRows('fixed'),
  variable: makeRows('variable'),
  sub:      makeRows('sub'),
  savings:  makeRows('savings'),
  debt:     [{ id: uid(), name: '', annual: 0, balance: 0 }],

  setYear: (year) => set({ year }),

  addRow: (section) =>
    set(s => ({ [section]: [...s[section], { id: uid(), name: '', annual: 0 }] })),

  updateRow: (section, id, field, value) =>
    set(s => ({ [section]: s[section].map(r => r.id === id ? { ...r, [field]: value } : r) })),

  deleteRow: (section, id) =>
    set(s => ({ [section]: s[section].filter(r => r.id !== id) })),

  addDebtRow: () =>
    set(s => ({ debt: [...s.debt, { id: uid(), name: '', annual: 0, balance: 0 }] })),

  updateDebtRow: (id, field, value) =>
    set(s => ({ debt: s.debt.map(r => r.id === id ? { ...r, [field]: value } : r) })),

  deleteDebtRow: (id) =>
    set(s => ({ debt: s.debt.filter(r => r.id !== id) })),
}))
