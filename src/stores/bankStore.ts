'use client'

import { create } from 'zustand'

interface BankState {
  rawRows:      unknown[][]
  fileName:     string
  sentRows:     number[]        // indices of sent rows
  reportMonths: number          // how many months the uploaded statement covers (default 1 = no division)
  setData:         (rows: unknown[][], fileName: string) => void
  markSent:        (idx: number) => void
  setReportMonths: (months: number) => void
  reset:           () => void
}

export const useBankStore = create<BankState>((set) => ({
  rawRows:      [],
  fileName:     '',
  sentRows:     [],
  reportMonths: 1,

  setData:  (rawRows, fileName) => set({ rawRows, fileName, sentRows: [] }),
  markSent: (idx) => set((s) => ({ sentRows: [...s.sentRows, idx] })),
  setReportMonths: (months) => set({ reportMonths: Math.max(1, Math.min(24, Math.floor(months || 1))) }),
  reset:    () => set({ rawRows: [], fileName: '', sentRows: [], reportMonths: 1 }),
}))
