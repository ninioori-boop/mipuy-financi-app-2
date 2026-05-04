'use client'

import type { MappingRow, AnnualRow, DebtRow, InstallmentRow, SavingRow } from '@/stores/mappingStore'

function fmt(n: number) {
  return '₪' + Math.abs(n).toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

interface Props {
  income: MappingRow[]
  fixed: MappingRow[]
  sub: MappingRow[]
  ins: MappingRow[]
  variable: MappingRow[]
  annual: AnnualRow[]
  debts: DebtRow[]
  installments: InstallmentRow[]
  savings: SavingRow[]
  varMonths: number
}

export function CashflowSummary({ income, fixed, sub, ins, variable, annual, debts, installments, savings, varMonths }: Props) {
  const sum = (rs: MappingRow[]) => rs.reduce((s, r) => s + r.amount, 0)

  const totalIncome       = sum(income)
  const totalFixed        = sum(fixed)
  const totalSub          = sum(sub)
  const totalIns          = sum(ins)
  const totalVarMonthly   = Math.round(sum(variable) / Math.max(1, varMonths))
  const totalAnnualMo     = Math.round(annual.reduce((s, r) => s + r.annualAmount, 0) / 12)
  const totalDebtMo       = debts.reduce((s, r) => s + r.monthlyPayment, 0)
  const totalInstMo       = installments.reduce((s, r) => s + r.monthlyPayment, 0)
  const totalExpenses     = totalFixed + totalSub + totalIns + totalVarMonthly + totalAnnualMo + totalDebtMo + totalInstMo
  const cashflow          = totalIncome - totalExpenses

  const totalAssetsAccum  = savings.reduce((s, r) => s + r.accumulated, 0)
  const totalAssetsMo     = savings.reduce((s, r) => s + r.monthlyContribution, 0)
  const totalDebtBal      = debts.reduce((s, r) => s + r.remainingBalance, 0)

  const positive = cashflow >= 0

  return (
    <div className="rounded-xl border border-line bg-surface2 p-5 space-y-4">
      <div className="text-sm font-bold text-txt">📊 תזרים חודשי — עדכון חי</div>

      {/* Two-column breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Income column */}
        <div className="space-y-1.5">
          <div className="text-xs font-bold text-green-400 mb-2">💰 הכנסות</div>
          {income.filter(r => r.name || r.amount > 0).map(r => (
            <div key={r.id} className="flex justify-between text-xs">
              <span className="text-muted-txt truncate">{r.name || '—'}</span>
              <span className="text-txt font-medium tabular-nums mr-2">{fmt(r.amount)}</span>
            </div>
          ))}
          <div className="flex justify-between text-xs font-bold border-t border-line pt-2 mt-2">
            <span className="text-txt">סה&quot;כ הכנסות</span>
            <span className="text-green-400 tabular-nums">{fmt(totalIncome)}</span>
          </div>
        </div>

        {/* Expenses column */}
        <div className="space-y-1.5">
          <div className="text-xs font-bold text-expense mb-2">📊 הוצאות חודשיות</div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-txt">📌 הוצאות קבועות <span className="text-gold/60">÷1</span></span>
            <span className="text-txt font-medium tabular-nums">{fmt(totalFixed)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-txt">🔄 מנויים <span className="text-gold/60">÷1</span></span>
            <span className="text-txt font-medium tabular-nums">{fmt(totalSub)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-txt">🛡️ ביטוחים <span className="text-gold/60">÷1</span></span>
            <span className="text-txt font-medium tabular-nums">{fmt(totalIns)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-txt">🛒 הוצאות משתנות <span className="text-gold/60">÷{varMonths}</span></span>
            <span className="text-txt font-medium tabular-nums">{fmt(totalVarMonthly)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-txt">📅 הוצאות שנתיות <span className="text-gold/60">÷12</span></span>
            <span className="text-txt font-medium tabular-nums">{fmt(totalAnnualMo)}</span>
          </div>
          {totalDebtMo > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-txt">💳 החזרי הלוואות <span className="text-gold/60">÷1</span></span>
              <span className="text-txt font-medium tabular-nums">{fmt(totalDebtMo)}</span>
            </div>
          )}
          {totalInstMo > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-txt">📅 תשלומים <span className="text-gold/60">÷1</span></span>
              <span className="text-txt font-medium tabular-nums">{fmt(totalInstMo)}</span>
            </div>
          )}
          <div className="flex justify-between text-xs font-bold border-t border-line pt-2 mt-2">
            <span className="text-txt">סה&quot;כ הוצאות</span>
            <span className="text-expense tabular-nums">{fmt(totalExpenses)}</span>
          </div>
        </div>
      </div>

      {/* Cash flow banner */}
      <div className={`rounded-xl p-4 border ${positive ? 'border-green-400/30 bg-green-400/5' : 'border-expense/30 bg-expense/5'}`}>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="text-xs text-muted-txt mb-1">תזרים חודשי נטו</div>
            <div className={`text-3xl font-black tabular-nums ${positive ? 'text-green-400' : 'text-expense'}`}>
              {cashflow >= 0 ? '+' : '-'}{fmt(cashflow)}
            </div>
          </div>
          <div className="flex gap-6">
            <div className="text-center">
              <div className="text-xs text-muted-txt font-semibold uppercase mb-1">הכנסות</div>
              <div className="text-lg font-bold text-green-400 tabular-nums">{fmt(totalIncome)}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-muted-txt font-semibold uppercase mb-1">הוצאות</div>
              <div className="text-lg font-bold text-expense tabular-nums">{fmt(totalExpenses)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Assets & Debts cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-lg border border-green-400/20 bg-green-400/5 p-4 space-y-2">
          <div className="text-xs font-bold text-green-400">🏦 נכסים וחסכונות</div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-txt">סך נכסים מצטבר</span>
            <span className="font-bold text-green-400 tabular-nums">{fmt(totalAssetsAccum)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-txt">הפרשה חודשית</span>
            <span className="font-medium text-txt tabular-nums">{fmt(totalAssetsMo)}</span>
          </div>
        </div>
        <div className="rounded-lg border border-expense/20 bg-expense/5 p-4 space-y-2">
          <div className="text-xs font-bold text-expense">💳 התחייבויות והלוואות</div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-txt">יתרה לסגירה</span>
            <span className="font-bold text-expense tabular-nums">{fmt(totalDebtBal)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-txt">החזר חודשי <span className="text-gold/60">÷1</span></span>
            <span className="font-medium text-txt tabular-nums">{fmt(totalDebtMo + totalInstMo)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
