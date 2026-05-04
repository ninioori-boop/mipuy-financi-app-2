export type MonthId = 'jan' | 'feb' | 'mar' | 'apr' | 'may' | 'jun' | 'jul' | 'aug' | 'sep' | 'oct' | 'nov' | 'dec'

export type MonthSection = 'income' | 'fixed' | 'variable' | 'sub' | 'ins'

export interface MonthRow {
  name: string
  plan: number
  actual: number
}

export interface MonthData {
  income: MonthRow[]
  fixed: MonthRow[]
  variable: MonthRow[]
  sub: MonthRow[]
  ins: MonthRow[]
}

export type BudgetData = Partial<Record<MonthId, MonthData>>

export interface MonthMeta {
  id: MonthId
  name: string
}
