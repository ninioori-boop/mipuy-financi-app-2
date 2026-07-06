'use client'

import { useEffect } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { useSyncStore } from '@/stores/syncStore'
import { useRecurringStore } from '@/stores/recurringStore'
import { useExpenseLogStore } from '@/stores/expenseLogStore'

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

  useEffect(() => {
    if (!user || !hydrated) return

    const now = new Date()
    const ym  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const day = now.getDate()

    const { posted, markPosted } = useRecurringStore.getState()
    const { add } = useExpenseLogStore.getState()

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
    }
  }, [user, hydrated, rules])
}
