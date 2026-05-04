'use client'

import { create } from 'zustand'

interface BankState {
  rawRows:   unknown[][]
  fileName:  string
  sentRows:  number[]        // indices of sent rows
  setData:   (rows: unknown[][], fileName: string) => void
  markSent:  (idx: number) => void
  reset:     () => void
}

export const useBankStore = create<BankState>((set) => ({
  rawRows:  [],
  fileName: '',
  sentRows: [],

  setData:  (rawRows, fileName) => set({ rawRows, fileName, sentRows: [] }),
  markSent: (idx) => set((s) => ({ sentRows: [...s.sentRows, idx] })),
  reset:    () => set({ rawRows: [], fileName: '', sentRows: [] }),
}))
