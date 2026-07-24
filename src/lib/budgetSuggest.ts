import type { ExpenseEntry } from '@/stores/expenseLogStore'

export interface BudgetSuggestion {
  category:   string
  avgMonthly: number   // average monthly spend across the months considered
  suggested:  number   // budget recommendation (avg rounded up for headroom)
}

export interface BudgetSuggestResult {
  months:      number              // how many months of history were used
  suggestions: BudgetSuggestion[]  // sorted by avgMonthly, biggest first
}

function ym(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Suggests a per-category monthly budget from spending history. Removes the
 * biggest friction: most clients never set a budget, so every budget-driven
 * feature stays dark. We average each category over recent COMPLETE months
 * (the current partial month would understate) and round up to the next ₪50 for
 * a little breathing room. Categories under ₪50/mo are skipped as noise.
 *
 * Falls back to the current month only when there is no completed month yet, so
 * a brand-new user still gets a rough hint.
 */
export function suggestBudgets(entries: ExpenseEntry[], now: Date = new Date()): BudgetSuggestResult {
  const curYm = ym(now)
  const monthsWithData = [...new Set(entries.map(e => e.date.slice(0, 7)))].sort().reverse()

  const complete  = monthsWithData.filter(m => m < curYm).slice(0, 3)
  const useMonths = complete.length > 0 ? complete : monthsWithData.slice(0, 1)
  if (useMonths.length === 0) return { months: 0, suggestions: [] }

  const useSet = new Set(useMonths)
  const perCat = new Map<string, number>()
  for (const e of entries) {
    if (!(e.amount > 0)) continue
    if (!useSet.has(e.date.slice(0, 7))) continue
    perCat.set(e.category, (perCat.get(e.category) ?? 0) + e.amount)
  }

  const suggestions: BudgetSuggestion[] = []
  for (const [category, total] of perCat) {
    const avg = total / useMonths.length
    if (avg < 50) continue                        // too small to be worth budgeting
    suggestions.push({
      category,
      avgMonthly: Math.round(avg),
      suggested:  Math.ceil(avg / 50) * 50,       // round up to the next ₪50
    })
  }
  suggestions.sort((a, b) => b.avgMonthly - a.avgMonthly)
  return { months: useMonths.length, suggestions }
}
