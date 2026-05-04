'use client'

import { create } from 'zustand'
import type { Transaction } from '@/types/transaction'

interface CreditState {
  transactions: Transaction[]
  uploadedFileNames: string[]
  learnedDB: Record<string, string>
  isLoading: boolean
  loadingMessage: string
  reportMonths: number  // how many months the uploaded report covers

  setTransactions: (txns: Transaction[], fileNames: string[]) => void
  updateCategory: (idx: number, category: string) => void
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
  isLoading: false,
  loadingMessage: '',
  reportMonths: 3,

  setTransactions: (txns, fileNames) =>
    set({ transactions: txns, uploadedFileNames: fileNames }),

  updateCategory: (idx, category) => {
    const txns = [...get().transactions]
    if (!txns[idx]) return
    const desc = txns[idx].desc.toLowerCase()
    txns[idx] = { ...txns[idx], category }
    set({
      transactions: txns,
      learnedDB: { ...get().learnedDB, [desc]: category },
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
