'use client'

import { create } from 'zustand'

function uid() { return Math.random().toString(36).slice(2) }

// Standalone, real-time expense journal. Intentionally ISOLATED — it does NOT
// feed mapping/monthly actuals (those come from credit/bank imports), so there
// is zero double-counting. A client logs every expense the moment it happens.
export interface ExpenseEntry {
  id:        string
  date:      string   // YYYY-MM-DD
  amount:    number   // ALWAYS shekels — every total in the app sums this field
  category:  string
  note:      string
  createdAt: number
  // Set only for a charge made in a foreign currency (captured abroad by the
  // phone automation). `amount` above is the converted shekel estimate; these
  // preserve what was actually paid, so the row can show "₪212 (£45)" and can
  // later be reconciled against the card statement. Absent on shekel charges.
  // The code is a plain string, not a union: it is read back from persisted
  // data, where nothing enforces the type (see formatMoneyLoose).
  foreignAmount?:   number
  foreignCurrency?: string
  fxRate?:          number
}

type NewEntry = {
  date: string; amount: number; category: string; note: string
  foreignAmount?: number; foreignCurrency?: string; fxRate?: number
}

interface ExpenseLogState {
  entries: ExpenseEntry[]
  add:    (e: NewEntry) => void
  update: (id: string, patch: Partial<Omit<ExpenseEntry, 'id' | 'createdAt'>>) => void
  remove: (id: string) => void
}

export const useExpenseLogStore = create<ExpenseLogState>((set) => ({
  entries: [],

  add: (e) =>
    set(s => {
      const entry: ExpenseEntry = {
        id: uid(), createdAt: Date.now(),
        date: e.date, amount: e.amount, category: e.category, note: e.note,
      }
      // Assigned only when actually present: an explicit `undefined` value is
      // rejected by the Firestore SDK on save, which would break the whole
      // snapshot write for every entry, not just this one.
      if (e.foreignCurrency && typeof e.foreignAmount === 'number') {
        entry.foreignAmount   = e.foreignAmount
        entry.foreignCurrency = e.foreignCurrency
        if (typeof e.fxRate === 'number') entry.fxRate = e.fxRate
      }
      return { entries: [entry, ...s.entries] }
    }),

  update: (id, patch) =>
    set(s => ({
      entries: s.entries.map(en => en.id === id ? { ...en, ...patch } : en),
    })),

  remove: (id) =>
    set(s => ({ entries: s.entries.filter(en => en.id !== id) })),
}))
