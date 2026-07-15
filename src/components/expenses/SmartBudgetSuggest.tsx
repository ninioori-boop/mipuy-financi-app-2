'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/authStore'
import { hasLabAccess } from '@/lib/labAccess'
import { useExpenseLogStore } from '@/stores/expenseLogStore'
import { useCategoryBudgetStore } from '@/stores/categoryBudgetStore'
import { suggestBudgets } from '@/lib/budgetSuggest'
import { CATEGORY_ICONS } from '@/lib/constants'

const fmt  = (n: number) => '₪' + Math.round(n).toLocaleString('he-IL')
const icon = (c: string) => CATEGORY_ICONS[c] ?? '📦'

/**
 * Suggests category budgets from spending history, one tap to apply. Self-gates
 * to advisors (hasLabAccess) so the page only needs to render it, and renders
 * nothing until there's enough history to suggest anything. "Apply all" fills
 * only the categories without a budget yet, so a manual budget is never clobbered.
 */
export function SmartBudgetSuggest() {
  const user      = useAuthStore(s => s.user)
  const entries   = useExpenseLogStore(s => s.entries)
  const budgets   = useCategoryBudgetStore(s => s.budgets)
  const setBudget = useCategoryBudgetStore(s => s.setBudget)
  const [open, setOpen] = useState(false)

  const { months, suggestions } = useMemo(() => suggestBudgets(entries), [entries])

  if (!hasLabAccess(user?.email)) return null      // lab-gated for now
  if (suggestions.length === 0) return null

  const gaps = suggestions.filter(s => !(budgets[s.category] > 0))

  function applyAll() {
    for (const s of gaps) setBudget(s.category, s.suggested)
    toast.success(`🎯 הוגדרו ${gaps.length} תקציבים מוצעים`)
    setOpen(false)
  }
  function applyOne(cat: string, amt: number) {
    setBudget(cat, amt)
    toast.success(`נקבע תקציב ל${cat}: ${fmt(amt)}`)
  }

  return (
    <div className="rounded-xl border border-gold/30 bg-gold/5 p-3 space-y-2">
      <button onClick={() => setOpen(v => !v)} className="flex items-center justify-between w-full min-h-[44px]">
        <span className="text-xs font-semibold text-gold">🎯 הצעת תקציב מההיסטוריה</span>
        <span className="text-[11px] text-gold/80">{open ? 'סגירה ▲' : 'פתיחה ▼'}</span>
      </button>

      {open && (
        <div className="space-y-2">
          <p className="text-[11px] text-muted-txt">
            לפי {months === 1 ? 'החודש האחרון' : months === 2 ? 'החודשיים האחרונים' : `${months} החודשים האחרונים`}. אפשר להחיל הכול או לבחור.
          </p>
          <div className="max-h-64 overflow-y-auto space-y-1.5 pe-1">
            {suggestions.map(s => {
              const already = budgets[s.category] > 0
              return (
                <div key={s.category} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-txt min-w-0 truncate">
                    {icon(s.category)} {s.category}
                    <span className="text-muted-txt"> · ממוצע <bdi className="tabular-nums">{fmt(s.avgMonthly)}</bdi></span>
                  </span>
                  {already ? (
                    <span className="shrink-0 text-[11px] text-muted-txt">כבר מוגדר</span>
                  ) : (
                    <button
                      onClick={() => applyOne(s.category, s.suggested)}
                      className="shrink-0 rounded-md border border-gold/40 bg-gold/10 px-3 py-1 min-h-[44px] text-xs text-gold hover:bg-gold/20 transition-colors tabular-nums"
                    >
                      {fmt(s.suggested)}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          {gaps.length > 0 && (
            <button
              onClick={applyAll}
              className="w-full rounded-lg bg-gold/15 hover:bg-gold/25 text-gold border border-gold/40 px-3 py-2 min-h-[44px] text-xs font-semibold transition-colors"
            >
              החל הכול ({gaps.length})
            </button>
          )}
        </div>
      )}
    </div>
  )
}
