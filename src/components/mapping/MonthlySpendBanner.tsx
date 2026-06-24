'use client'

import type {
  MappingRow, AnnualRow, DebtRow, InstallmentRow, SavingRow,
} from '@/stores/mappingStore'

// "How much does the client actually move out every month?" — the single
// number the coach gets asked first in every meeting. Lives at the top of
// the mapping page because it shows the *current* picture as the advisor
// fills the form, before the user has to scroll to the cashflow summary
// at the bottom.

interface Props {
  fixed:        MappingRow[]
  sub:          MappingRow[]
  ins:          MappingRow[]
  variable:     MappingRow[]
  annual:       AnnualRow[]
  debts:        DebtRow[]
  installments: InstallmentRow[]
  savings:      SavingRow[]
  varMonths:    number
}

const fmt = (n: number) =>
  '₪' + Math.round(Math.abs(n)).toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

const sumAmount = (rs: MappingRow[]) => rs.reduce((s, r) => s + r.amount, 0)

export function MonthlySpendBanner({
  fixed, sub, ins, variable, annual, debts, installments, savings, varMonths,
}: Props) {
  const monthlyFixed    = sumAmount(fixed)
  const monthlySub      = sumAmount(sub)
  const monthlyIns      = sumAmount(ins)
  const monthlyVariable = Math.round(sumAmount(variable) / Math.max(1, varMonths))
  const monthlyAnnual   = Math.round(annual.reduce((s, r) => s + r.annualAmount, 0) / 12)
  const monthlyDebt     = debts.reduce((s, r) => s + r.monthlyPayment, 0)
  const monthlyInst     = installments.reduce((s, r) => s + r.monthlyPayment, 0)

  const monthlySpend    = monthlyFixed + monthlySub + monthlyIns + monthlyVariable + monthlyAnnual + monthlyDebt + monthlyInst
  const monthlySavings  = savings.reduce((s, r) => s + r.monthlyContribution, 0)
  const monthlyOutflow  = monthlySpend + monthlySavings

  return (
    <div className="rounded-xl border border-gold/30 bg-gradient-to-bl from-gold/10 via-surface2 to-surface2 p-4 sm:p-5">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="min-w-0">
          <div className="text-sm font-bold text-gold">💸 כמה הלקוח משלם בחודש</div>
          <div className="text-xs text-muted-txt mt-0.5">סיכום חי לפי כל הסקציות במיפוי + הפרשות לחסכון</div>
        </div>
        <div className="flex items-stretch gap-3 sm:gap-5 flex-wrap">
          <div className="text-end">
            <div className="text-[11px] text-muted-txt">תשלום חודשי</div>
            <div className="text-xl sm:text-2xl font-black text-expense tabular-nums">{fmt(monthlySpend)}</div>
          </div>
          <div className="self-stretch w-px bg-line hidden sm:block" />
          <div className="text-end">
            <div className="text-[11px] text-muted-txt">הפרשות לחסכון</div>
            <div className="text-xl sm:text-2xl font-black text-income tabular-nums">{fmt(monthlySavings)}</div>
          </div>
          <div className="self-stretch w-px bg-line hidden sm:block" />
          <div className="text-end">
            <div className="text-[11px] text-muted-txt">סה&quot;כ יציאה חודשית</div>
            <div className="text-xl sm:text-2xl font-black text-gold tabular-nums">{fmt(monthlyOutflow)}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
