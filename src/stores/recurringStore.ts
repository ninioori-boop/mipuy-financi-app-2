'use client'

import { create } from 'zustand'

function uid() { return Math.random().toString(36).slice(2) }

// Fixed monthly expenses (rent, subscriptions, insurance…) the client defines
// ONCE; useRecurringExpenses materializes each rule into the expense log every
// month when its day arrives. Rules live here — the materialized entries live
// in expenseLogStore like any other expense (editable/deletable as usual).
export interface RecurringRule {
  id:         string
  name:       string   // "שכר דירה"
  amount:     number
  category:   string
  dayOfMonth: number   // 1-28, so the day exists in every month
  active:     boolean
}

interface RecurringState {
  rules:  RecurringRule[]
  // ruleId → last YYYY-MM materialized. This (not the entry itself) is the
  // dedup marker, so deleting the materialized entry does NOT resurrect it
  // in the same month.
  posted: Record<string, string>
  add:        (r: { name: string; amount: number; category: string; dayOfMonth: number }) => void
  update:     (id: string, patch: Partial<Omit<RecurringRule, 'id'>>) => void
  remove:     (id: string) => void
  markPosted: (id: string, ym: string) => void
}

export const useRecurringStore = create<RecurringState>((set) => ({
  rules:  [],
  posted: {},

  add: (r) =>
    set(s => ({ rules: [...s.rules, { id: uid(), active: true, ...r }] })),

  update: (id, patch) =>
    set(s => ({ rules: s.rules.map(r => r.id === id ? { ...r, ...patch } : r) })),

  remove: (id) =>
    set(s => {
      const posted = { ...s.posted }
      delete posted[id]
      return { rules: s.rules.filter(r => r.id !== id), posted }
    }),

  markPosted: (id, ym) =>
    set(s => ({ posted: { ...s.posted, [id]: ym } })),
}))
