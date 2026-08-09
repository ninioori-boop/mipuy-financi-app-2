'use client'

import { create } from 'zustand'
import type { Transaction } from '@/types/transaction'

// The import tab's analysis, persisted (2026-08-09, Ori: "שהניתוחים יישמרו
// בטאב עד שאני עושה ניתוח חדש — כמו באשראי"). Until now the parsed
// transactions lived in the page's useState and evaporated on every
// navigation, forcing a re-upload + re-AI-run each visit.
//
// INVARIANT (the v1 app's defining bug — see CLAUDE.md): this store must
// NEVER share array/object references with creditStore. Setters take
// ownership of fresh arrays from the parser; nothing here reads from or
// writes into creditStore.
interface ImportState {
  transactions:      Transaction[]
  uploadedFileNames: string[]
  reportMonths:      number
  setTransactions:      (updater: Transaction[] | ((prev: Transaction[]) => Transaction[])) => void
  setUploadedFileNames: (names: string[]) => void
  setReportMonths:      (months: number) => void
  reset:                () => void
}

export const useImportStore = create<ImportState>((set) => ({
  transactions:      [],
  uploadedFileNames: [],
  reportMonths:      1,

  setTransactions: (updater) =>
    set((s) => ({
      transactions: typeof updater === 'function' ? updater(s.transactions) : updater,
    })),
  setUploadedFileNames: (names) => set({ uploadedFileNames: names }),
  setReportMonths: (months) =>
    set({ reportMonths: Math.max(1, Math.min(24, Math.floor(months || 1))) }),
  reset: () => set({ transactions: [], uploadedFileNames: [], reportMonths: 1 }),
}))
