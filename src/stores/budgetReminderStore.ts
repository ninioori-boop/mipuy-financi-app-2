'use client'

import { create } from 'zustand'

// Remembers which upcoming months the client already handled the "review your
// budget for next month" reminder for, so it appears at most once per month.
// Keyed by the TARGET month ("YYYY-MM", the month being prompted about).
interface BudgetReminderState {
  dismissed: Record<string, true>
  dismiss: (targetYm: string) => void
}

export const useBudgetReminderStore = create<BudgetReminderState>((set) => ({
  dismissed: {},
  dismiss: (targetYm) =>
    set(s => ({ dismissed: { ...s.dismissed, [targetYm]: true } })),
}))
