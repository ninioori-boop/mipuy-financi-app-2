'use client'

import { create } from 'zustand'

// Per-category MONTHLY budget limits for the expense-log tab.
// Intentionally simple + isolated: a flat { category -> monthly ₪ limit } map.
// Same limit applies to every month (a budget is a recurring monthly cap).
// Persisted via dataSync so limits survive reload + a Firestore round-trip.
interface CategoryBudgetState {
  budgets: Record<string, number>
  setBudget:    (category: string, limit: number) => void
  removeBudget: (category: string) => void
}

export const useCategoryBudgetStore = create<CategoryBudgetState>((set) => ({
  budgets: {},

  setBudget: (category, limit) =>
    set(s => {
      // A non-positive limit clears the budget rather than storing 0.
      if (!category || !Number.isFinite(limit) || limit <= 0) {
        const next = { ...s.budgets }
        delete next[category]
        return { budgets: next }
      }
      return { budgets: { ...s.budgets, [category]: Math.round(limit) } }
    }),

  removeBudget: (category) =>
    set(s => {
      const next = { ...s.budgets }
      delete next[category]
      return { budgets: next }
    }),
}))
