'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useBudgetReminderStore } from '@/stores/budgetReminderStore'
import { useCategoryBudgetStore } from '@/stores/categoryBudgetStore'

function nextMonthInfo(now: Date) {
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const daysLeft    = daysInMonth - now.getDate()               // full days left after today
  const next        = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const targetYm    = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`
  const targetLabel = next.toLocaleDateString('he-IL', { month: 'long' })
  return { daysLeft, targetYm, targetLabel }
}

/**
 * A once-a-month nudge, in the last week of the month, to review the budget
 * before the next month starts. Budgets roll over (a flat monthly cap), so this
 * is a "refresh", not a rebuild — it opens the budget editor (with the smart
 * suggestions) via the #budget hash. Dismissal is remembered per target month
 * so it shows at most once each month. Renders nothing outside that window.
 */
export function BudgetReviewReminder() {
  const router    = useRouter()
  const dismissed = useBudgetReminderStore(s => s.dismissed)
  const dismiss   = useBudgetReminderStore(s => s.dismiss)
  const budgets   = useCategoryBudgetStore(s => s.budgets)

  const info      = useMemo(() => nextMonthInfo(new Date()), [])
  const hasBudget = Object.values(budgets).some(b => b > 0)

  if (info.daysLeft > 6) return null              // only in the last week
  if (dismissed[info.targetYm]) return null       // already handled this month

  function go() {
    dismiss(info.targetYm)
    router.push('/app/expenses#budget')
  }

  return (
    <div className="rounded-2xl border border-gold/40 bg-gradient-to-br from-gold/10 to-transparent p-4 space-y-3">
      <div>
        <div className="text-base font-bold text-txt">
          🗓️ {info.daysLeft <= 0
            ? <>מחר כבר {info.targetLabel}</>
            : info.daysLeft === 1
              ? <>עוד יום ל{info.targetLabel}</>
              : <>עוד <bdi className="tabular-nums">{info.daysLeft}</bdi> ימים ל{info.targetLabel}</>}
        </div>
        <div className="text-sm text-muted-txt mt-0.5">
          {hasBudget
            ? 'רוצה לעבור על התקציב ולעדכן לקראת החודש הבא?'
            : 'רוצה להגדיר תקציב לקראת החודש הבא?'}
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={go}
          className="flex-1 rounded-xl bg-gold text-surface font-bold px-4 py-3 min-h-[48px] hover:bg-gold-light active:bg-gold-dark transition-colors"
        >
          {hasBudget ? 'בוא נעדכן' : 'בוא נגדיר'}
        </button>
        <button
          type="button"
          onClick={() => dismiss(info.targetYm)}
          className="shrink-0 rounded-xl border border-line bg-surface2 px-4 py-3 min-h-[48px] text-sm text-muted-txt hover:text-txt transition-colors"
        >
          לא עכשיו
        </button>
      </div>
    </div>
  )
}
