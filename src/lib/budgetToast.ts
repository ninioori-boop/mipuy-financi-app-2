'use client'

import { toast } from 'sonner'
import type { BudgetStatus } from '@/lib/budgetStatus'

// One place that turns a BudgetStatus into the near/over toast, so manual add,
// auto-capture drain, and recurring post all warn identically. No-op when the
// category is under 80% (level 'none').

const nis = (n: number) => '₪' + Math.round(n).toLocaleString('he-IL')

export function notifyBudget(status: BudgetStatus, category: string): void {
  if (status.level === 'none') return
  const pct = Math.round(status.pct * 100)
  if (status.level === 'over') {
    toast.error(`⚠️ חריגה מהתקציב ל${category}: ${nis(status.spent)} מתוך ${nis(status.budget)} (${pct}%)`)
  } else {
    toast.warning(`מתקרב לתקציב ל${category}: ${pct}% (${nis(status.spent)} מתוך ${nis(status.budget)})`)
  }
}
