// Where a category's monthly budget stands after a charge lands — shared by
// every add path (manual add, auto-captured charge drain, recurring post) so a
// budget warning is consistent everywhere, not only on manual entry.
//
// Pure (no React, no toast) → trivially testable and reusable. Thresholds match
// the server's buildNotify (src/app/api/transaction/route.ts): >=100% over,
// >=80% near.

export type BudgetLevel = 'none' | 'near' | 'over'

export interface BudgetStatus {
  level:  BudgetLevel
  pct:    number   // spent / budget (folding in the new charge); 0 when no budget
  spent:  number   // category total for the month INCLUDING the new charge
  budget: number   // the monthly cap, or 0 when none is set
}

// Minimal structural shape — accepts expenseLogStore entries as-is.
interface EntryLike {
  category: string
  date:     string   // 'YYYY-MM-DD'
  amount:   number
}

/**
 * Computes budget standing for `category` in month `ym` after adding
 * `addedAmount`. Pass the PRE-add entries list and the amount being added; pass
 * `addedAmount: 0` with a post-add list to read the current standing.
 */
export function computeBudgetStatus(params: {
  budgets:     Record<string, number>
  entries:     readonly EntryLike[]
  category:    string
  addedAmount: number
  ym:          string   // 'YYYY-MM'
}): BudgetStatus {
  const { budgets, entries, category, addedAmount, ym } = params
  const budget = budgets[category] ?? 0
  const spent = entries
    .filter(e => e.category === category && e.date.slice(0, 7) === ym)
    .reduce((s, e) => s + e.amount, 0) + addedAmount

  if (!(budget > 0)) return { level: 'none', pct: 0, spent, budget: 0 }

  const pct = spent / budget
  const level: BudgetLevel = pct >= 1 ? 'over' : pct >= 0.8 ? 'near' : 'none'
  return { level, pct, spent, budget }
}
