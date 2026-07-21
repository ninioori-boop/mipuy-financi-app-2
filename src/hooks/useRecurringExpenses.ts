'use client'

import { useEffect } from 'react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/authStore'
import { useSyncStore } from '@/stores/syncStore'
import { useImpersonationStore } from '@/stores/impersonationStore'
import { useRecurringStore } from '@/stores/recurringStore'
import { useExpenseLogStore } from '@/stores/expenseLogStore'
import { useCategoryBudgetStore } from '@/stores/categoryBudgetStore'
import { computeBudgetStatus } from '@/lib/budgetStatus'

/**
 * Materializes recurring fixed expenses into the expense log.
 *
 * Once per month, when a rule's day arrives (or has passed and the app is
 * opened later), the rule is posted as a regular expense entry dated on its
 * dayOfMonth. `posted[ruleId] = ym` is the dedup marker — kept in the
 * recurring store, NOT inferred from the entries — so a client who deletes
 * the materialized entry doesn't get it re-added the same month.
 *
 * Gated on `hydrated` (like the transaction inbox) so we only decide AFTER
 * the saved snapshot loaded — otherwise `posted` would look empty and every
 * rule would double-post. DataSync persists both stores after we add.
 */
export function useRecurringExpenses() {
  const user     = useAuthStore(s => s.user)
  const hydrated = useSyncStore(s => s.hydrated)
  const rules    = useRecurringStore(s => s.rules)
  // Paused while the advisor is viewing a client's account — viewing must not
  // materialize anything (nothing is being saved anyway; keep the view pristine).
  const viewingAsClient = useImpersonationStore(s => !!s.client)

  useEffect(() => {
    if (!user || !hydrated || viewingAsClient) return

    const now = new Date()
    const ym  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const day = now.getDate()

    const { posted, markPosted } = useRecurringStore.getState()
    const { add } = useExpenseLogStore.getState()

    const justPosted: { name: string; category: string }[] = []
    for (const r of rules) {
      if (!r.active) continue
      if (!(r.amount > 0) || !r.category) continue
      const ruleDay = Math.min(Math.max(1, Math.round(r.dayOfMonth || 1)), 28)
      if (day < ruleDay) continue            // this month's date hasn't arrived yet
      if (posted[r.id] === ym) continue      // already materialized this month

      add({
        date:     `${ym}-${String(ruleDay).padStart(2, '0')}`,
        amount:   Math.round(r.amount),
        category: r.category,
        note:     `${r.name} · הוצאה קבועה ⟳`,
      })
      markPosted(r.id, ym)
      justPosted.push({ name: r.name, category: r.category })
    }

    if (justPosted.length === 0) return

    // One summary toast (never one-per-rule — a month's backlog could post
    // several at once). Flag any category these charges pushed over its budget.
    const budgets = useCategoryBudgetStore.getState().budgets
    const entries = useExpenseLogStore.getState().entries   // now includes the posts
    const over = [...new Set(justPosted.map(p => p.category))].filter(
      cat => computeBudgetStatus({ budgets, entries, category: cat, addedAmount: 0, ym }).level === 'over',
    )
    const label = justPosted.length === 1
      ? `⟳ נרשמה הוצאה קבועה: ${justPosted[0].name}`
      : `⟳ נרשמו ${justPosted.length} הוצאות קבועות`
    if (over.length) {
      toast.warning(`${label} · ⚠️ חריגה מתקציב: ${over.join(', ')}`)
    } else {
      toast.success(label)
    }
  }, [user, hydrated, viewingAsClient, rules])
}
