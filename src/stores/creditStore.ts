'use client'

import { create } from 'zustand'
import type { Transaction } from '@/types/transaction'
import { normalizeForLookup } from '@/lib/categorize'
import { saveLearnedEntry } from '@/lib/firestoreService'

interface CreditState {
  transactions: Transaction[]
  uploadedFileNames: string[]
  learnedDB: Record<string, string>        // this account's own corrections (persisted per-user)
  sharedLearnedDB: Record<string, string>  // global cross-account corrections (loaded each session, NOT persisted per-user)
  isLoading: boolean
  loadingMessage: string
  reportMonths: number  // how many months the uploaded report covers

  setTransactions: (txns: Transaction[], fileNames: string[]) => void
  updateCategory: (idx: number, category: string) => void
  applyAiCategory: (idx: number, category: string) => void
  applyAiCategoryById: (id: string, category: string) => void
  learn: (desc: string, category: string) => void
  setSharedLearnedDB: (db: Record<string, string>) => void
  mergedLearnedDB: () => Record<string, string>
  updateDesc: (idx: number, desc: string) => void
  updateAmount: (idx: number, amount: number) => void
  deleteTransaction: (idx: number) => void
  setLoading: (loading: boolean, message?: string) => void
  setReportMonths: (months: number) => void
  reset: () => void
}

export const useCreditStore = create<CreditState>((set, get) => ({
  transactions: [],
  uploadedFileNames: [],
  learnedDB: {},
  sharedLearnedDB: {},
  isLoading: false,
  loadingMessage: '',
  reportMonths: 3,

  setTransactions: (txns, fileNames) =>
    set({ transactions: txns, uploadedFileNames: fileNames }),

  // Lookup order at parse time: account's own corrections override the shared pool.
  mergedLearnedDB: () => ({ ...get().sharedLearnedDB, ...get().learnedDB }),

  setSharedLearnedDB: (db) => set({ sharedLearnedDB: db }),

  // Record a deliberate human correction: remember it locally AND push the single
  // merchant→category pair to the shared cross-account pool (fire-and-forget).
  learn: (desc, category) => {
    const key = normalizeForLookup(desc)
    if (!key) return
    set({ learnedDB: { ...get().learnedDB, [key]: category } })
    saveLearnedEntry(key, category).catch(() => {})
  },

  // Manual correction from the UI — apply to every row with the same merchant,
  // then learn it (which writes to the shared pool).
  updateCategory: (idx, category) => {
    const txns = get().transactions
    const target = txns[idx]
    if (!target) return
    const key = normalizeForLookup(target.desc)
    set({
      transactions: txns.map(t => normalizeForLookup(t.desc) === key ? { ...t, category } : t),
    })
    get().learn(target.desc, category)
  },

  // AI-assigned category — remember locally so future uploads in THIS account skip
  // re-asking the AI, but never write AI guesses to the shared pool (avoids
  // propagating a wrong guess to every client).
  applyAiCategory: (idx, category) => {
    const txns = [...get().transactions]
    if (!txns[idx]) return
    const key = normalizeForLookup(txns[idx].desc)
    txns[idx] = { ...txns[idx], category }
    set({
      transactions: txns,
      learnedDB: { ...get().learnedDB, [key]: category },
    })
  },

  // Same as applyAiCategory but looks up the row by its stable id. Used by the
  // AI batch loop so a delete that lands between batch creation and result
  // application can't shift indices and assign a category to the wrong row.
  // If the row was deleted (id no longer exists), this is a silent no-op.
  applyAiCategoryById: (id, category) => {
    const txns = get().transactions
    const target = txns.find(t => t.id === id)
    if (!target) return
    const key = normalizeForLookup(target.desc)
    set({
      transactions: txns.map(t => t.id === id ? { ...t, category } : t),
      learnedDB: { ...get().learnedDB, [key]: category },
    })
  },

  updateDesc: (idx, desc) => {
    const txns = [...get().transactions]
    if (!txns[idx]) return
    txns[idx] = { ...txns[idx], desc }
    set({ transactions: txns })
  },

  updateAmount: (idx, amount) => {
    const txns = [...get().transactions]
    if (!txns[idx]) return
    txns[idx] = { ...txns[idx], amount }
    set({ transactions: txns })
  },

  deleteTransaction: (idx) =>
    set({ transactions: get().transactions.filter((_, i) => i !== idx) }),

  setLoading: (loading, message = '') =>
    set({ isLoading: loading, loadingMessage: message }),

  setReportMonths: (months) =>
    set({ reportMonths: Math.max(1, Math.min(24, months)) }),

  reset: () =>
    set({ transactions: [], uploadedFileNames: [], isLoading: false, loadingMessage: '' }),
}))
