'use client'

import { useMemo } from 'react'
import { useExpenseLogStore } from '@/stores/expenseLogStore'
import { useCategoryBudgetStore } from '@/stores/categoryBudgetStore'

const fmt = (n: number) => '₪' + Math.round(n).toLocaleString('he-IL')

/**
 * "Safe to spend today" — turns the abstract monthly budget into one concrete
 * daily number. Rolling model: today's allowance = (budget minus what was spent
 * on earlier days) divided by the days left including today, so underspending
 * past days rolls forward. Then we subtract what's already been spent today.
 *
 * Renders nothing without a monthly budget (nothing to divide). Pure/local.
 */
export function SafeToSpendToday() {
  const entries = useExpenseLogStore(s => s.entries)
  const budgets = useCategoryBudgetStore(s => s.budgets)

  const data = useMemo(() => {
    const now         = new Date()
    const ym          = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const dayOfMonth  = now.getDate()
    const daysLeftIncl = daysInMonth - dayOfMonth + 1     // including today
    const todayIso    = `${ym}-${String(dayOfMonth).padStart(2, '0')}`

    const totalBudget = Object.values(budgets).reduce((s, b) => s + (b || 0), 0)
    if (totalBudget <= 0) return null

    const monthEntries     = entries.filter(e => e.date.slice(0, 7) === ym)
    const spentToday       = monthEntries.filter(e => e.date === todayIso).reduce((s, e) => s + e.amount, 0)
    const spentBeforeToday = monthEntries.filter(e => e.date <  todayIso).reduce((s, e) => s + e.amount, 0)

    const todayBudget = Math.max(0, (totalBudget - spentBeforeToday) / daysLeftIncl)
    const safeMore    = todayBudget - spentToday

    return { todayBudget, safeMore }
  }, [entries, budgets])

  if (!data) return null

  const over = data.safeMore < 0

  return (
    <div className="rounded-2xl border border-line bg-surface2 p-4 flex items-center justify-between gap-3">
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-muted-txt">💸 בטוח להוציא היום</span>
        <span className="block text-xs text-muted-txt mt-0.5">
          {over
            ? <>עברת את המנה של היום ב־<bdi className="tabular-nums">{fmt(Math.abs(data.safeMore))}</bdi></>
            : <>מתוך <bdi className="tabular-nums">{fmt(data.todayBudget)}</bdi> להיום</>}
        </span>
      </span>
      <span dir="ltr" className={`shrink-0 text-3xl font-extrabold tracking-tight tabular-nums ${over ? 'text-expense' : 'text-income'}`}>
        {over ? fmt(0) : fmt(data.safeMore)}
      </span>
    </div>
  )
}
