'use client'

import { create } from 'zustand'

function uid() { return Math.random().toString(36).slice(2) }

// Standalone, real-time expense journal. Intentionally ISOLATED — it does NOT
// feed mapping/monthly actuals (those come from credit/bank imports), so there
// is zero double-counting. A client logs every expense the moment it happens.
export interface ExpenseEntry {
  id:        string
  date:      string   // YYYY-MM-DD
  amount:    number
  category:  string
  note:      string
  createdAt: number
}

interface ExpenseLogState {
  entries: ExpenseEntry[]
  add:    (e: { date: string; amount: number; category: string; note: string }) => void
  update: (id: string, patch: Partial<Omit<ExpenseEntry, 'id' | 'createdAt'>>) => void
  remove: (id: string) => void
}

export const useExpenseLogStore = create<ExpenseLogState>((set) => ({
  entries: [],

  add: (e) =>
    set(s => ({
      entries: [
        { id: uid(), createdAt: Date.now(), date: e.date, amount: e.amount, category: e.category, note: e.note },
        ...s.entries,
      ],
    })),

  update: (id, patch) =>
    set(s => ({
      entries: s.entries.map(en => en.id === id ? { ...en, ...patch } : en),
    })),

  remove: (id) =>
    set(s => ({ entries: s.entries.filter(en => en.id !== id) })),
}))
