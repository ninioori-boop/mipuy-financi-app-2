'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useGoalsStore } from '@/stores/goalsStore'
import { useMappingStore } from '@/stores/mappingStore'
import type { GoalHorizon, GoalRow } from '@/stores/goalsStore'

function fmt(n: number) {
  return '₪' + Math.round(n).toLocaleString('he-IL')
}

const HORIZONS: { id: GoalHorizon; label: string; sub: string; accent: string; bar: string }[] = [
  { id: 'short',  label: 'טווח קצר',    sub: 'עד 3 שנים',     accent: 'text-green-400  border-green-400/30  bg-green-400/5',  bar: 'bg-green-400' },
  { id: 'medium', label: 'טווח בינוני', sub: '3–7 שנים',       accent: 'text-gold       border-gold/30       bg-gold/5',       bar: 'bg-gold' },
  { id: 'long',   label: 'טווח ארוך',   sub: '7 שנים ומעלה',  accent: 'text-purple-400 border-purple-400/30 bg-purple-400/5', bar: 'bg-purple-400' },
]

function monthsUntil(targetDate: string): number | null {
  if (!targetDate) return null
  const [y, m] = targetDate.split('-').map(Number)
  const now = new Date()
  return Math.max(0, (y - now.getFullYear()) * 12 + (m - now.getMonth() - 1))
}

function autoMonthly(row: GoalRow): number {
  if (row.monthly > 0) return row.monthly
  const remaining = Math.max(0, row.required - row.current)
  const months    = monthsUntil(row.targetDate)
  if (months && months > 0) return Math.ceil(remaining / months)
  return 0
}

function numInput(
  value: number,
  onChange: (v: number) => void,
  placeholder: string,
  cls = '',
) {
  return (
    <input
      type="number" value={value || ''} min={0}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      placeholder={placeholder} style={{ direction: 'ltr' }}
      className={`rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt focus:outline-none focus:border-gold/60 text-left tabular-nums w-full ${cls}`}
    />
  )
}

export default function GoalsPage() {
  const { short, medium, long, addGoal, updateGoal, deleteGoal } = useGoalsStore()
  const mapping = useMappingStore()
  const sections = { short, medium, long }

  const allGoals    = [...short, ...medium, ...long]
  const totalReq    = allGoals.reduce((s, r) => s + r.required, 0)
  const totalMo     = allGoals.reduce((s, r) => s + autoMonthly(r), 0)
  const doneCount   = allGoals.filter(r => r.required > 0 && r.current >= r.required).length
  const activeGoals = allGoals.filter(r => r.name || r.required > 0)

  // ── Savings budget from /checking (effective income − expenses, then × (1−bufferPct)) ──
  const savingsBudget = useMemo(() => {
    const rawIncome = mapping.income.reduce((s, r) => s + (r.amount || 0), 0)
    const fixed     = mapping.fixed.reduce((s, r) => s + (r.amount || 0), 0)
    const sub       = mapping.sub.reduce((s, r) => s + (r.amount || 0), 0)
    const ins       = mapping.ins.reduce((s, r) => s + (r.amount || 0), 0)
    const varMo     = mapping.variable.reduce((s, r) => s + (r.amount || 0), 0) / Math.max(1, mapping.varMonths)
    const annMo     = mapping.annual.reduce((s, r) => s + (r.annualAmount || 0), 0) / 12
    const inst      = mapping.installments.reduce((s, r) => s + (r.monthlyPayment || 0), 0)
    const debts     = mapping.debts.reduce((s, r) => s + (r.monthlyPayment || 0), 0)
    const rawExpenses = fixed + sub + ins + varMo + annMo + inst + debts

    const income   = mapping.incomeOverride   !== null ? mapping.incomeOverride   : Math.round(rawIncome)
    const expenses = mapping.expensesOverride !== null ? mapping.expensesOverride : Math.round(rawExpenses)
    const surplus  = Math.max(0, income - expenses)
    const budget   = Math.round(surplus * (1 - Math.max(0, Math.min(1, mapping.bufferPct))))
    return { budget, hasData: rawIncome > 0 || rawExpenses > 0, surplus }
  }, [mapping])

  const allocated = totalMo
  const remaining = savingsBudget.budget - allocated
  const allocPct  = savingsBudget.budget > 0 ? Math.min(100, (allocated / savingsBudget.budget) * 100) : 0
  const isOver    = allocated > savingsBudget.budget && savingsBudget.budget > 0

  return (
    <div className="max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div className="rounded-xl border border-line bg-surface2 p-5">
        <h1 className="text-xl sm:text-2xl font-bold text-gold mb-1">🎯 יעדים פיננסיים</h1>
        <p className="text-muted-txt text-sm">הגדר יעדים לפי טווח זמן — המערכת תחשב כמה לחסוך מדי חודש</p>
      </div>

      {/* Savings budget bar — comes from /app/checking */}
      {savingsBudget.hasData && savingsBudget.budget > 0 ? (
        <div className={`rounded-2xl border-2 p-5 transition-colors ${
          isOver
            ? 'border-expense/50 bg-expense/5'
            : 'border-gold/40 bg-gradient-to-br from-gold/10 to-transparent'
        }`}>
          <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
            <div>
              <div className="text-xs text-muted-txt mb-1 flex items-center gap-1.5">
                💧 תקציב חיסכון חודשי · מטאב <Link href="/app/checking" className="text-gold hover:underline">התנהלות עו&quot;ש</Link>
              </div>
              <div className="text-3xl sm:text-4xl font-black text-gold tabular-nums">{fmt(savingsBudget.budget)}<span className="text-xs font-normal text-muted-txt me-2">/חודש</span></div>
            </div>
            <div className="text-end space-y-0.5">
              <div className="text-xs text-muted-txt">מוקצה ליעדים</div>
              <div className={`text-xl font-bold tabular-nums ${isOver ? 'text-expense' : 'text-txt'}`}>{fmt(allocated)}</div>
              <div className="text-xs text-muted-txt">
                {remaining >= 0 ? 'נותר: ' : 'חריגה: '}
                <span className={`tabular-nums font-bold ${remaining >= 0 ? 'text-income' : 'text-expense'}`}>
                  {fmt(Math.abs(remaining))}
                </span>
              </div>
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-3 rounded-full bg-line overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isOver ? 'bg-expense' : allocPct > 85 ? 'bg-gold' : 'bg-income'
              }`}
              style={{ width: `${allocPct}%` }}
            />
          </div>

          {isOver && (
            <div className="mt-3 text-xs text-expense">
              ⚠️ ההפרשות שלך עולות על תקציב החיסכון החודשי בעוד {fmt(Math.abs(remaining))}. הקטן את הסכומים או הגדל את התקציב.
            </div>
          )}
        </div>
      ) : (
        <Link
          href="/app/checking"
          className="block rounded-2xl border border-dashed border-gold/40 bg-surface2 p-4 hover:bg-surface3 hover:border-gold/60 transition-colors"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-txt">💧 קבע תקציב חיסכון חודשי</div>
              <div className="text-xs text-muted-txt mt-0.5">
                לך לטאב &quot;התנהלות עו&quot;ש&quot; כדי לחשב כמה אפשר להקצות מדי חודש לחיסכון
              </div>
            </div>
            <span className="text-gold text-xl">←</span>
          </div>
        </Link>
      )}

      {/* KPI cards */}
      {activeGoals.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'יעדים פעילים',           val: activeGoals.length, color: 'text-txt' },
            { label: 'סך נדרש',                 val: fmt(totalReq),      color: 'text-txt' },
            { label: 'הפרשה חודשית נדרשת',      val: fmt(totalMo),       color: 'text-gold' },
            { label: 'יעדים שהושגו',             val: doneCount,          color: 'text-income' },
          ].map(({ label, val, color }) => (
            <div key={label} className="rounded-xl border border-line bg-surface2 p-3 sm:p-4">
              <div className="text-xs text-muted-txt mb-1">{label}</div>
              <div className={`text-xl font-black ${color}`}>{val}</div>
            </div>
          ))}
        </div>
      )}

      {/* Horizon sections */}
      {HORIZONS.map(({ id, label, sub, accent, bar }) => {
        const rows: GoalRow[] = sections[id]
        const secTotal = rows.reduce((s, r) => s + autoMonthly(r), 0)

        return (
          <div key={id} className={`rounded-xl border p-4 sm:p-5 space-y-3 ${accent}`}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="font-bold text-txt">{label}</h2>
                <p className="text-xs text-muted-txt">{sub}</p>
              </div>
              {secTotal > 0 && (
                <div className="text-sm text-muted-txt">
                  סה&quot;כ: <span className="font-bold text-txt">{fmt(secTotal)}/חודש</span>
                </div>
              )}
            </div>

            <div className="space-y-3">
              {rows.map(row => {
                const pct      = row.required > 0 ? Math.min(100, Math.round((row.current / row.required) * 100)) : 0
                const isDone   = pct >= 100
                const moAuto   = autoMonthly(row)
                const moMonths = monthsUntil(row.targetDate)

                return (
                  <div key={row.id} className="space-y-2 group bg-surface/30 rounded-lg p-3">
                    {/* Name + delete */}
                    <div className="flex items-center gap-2">
                      <input
                        value={row.name}
                        onChange={e => updateGoal(id, row.id, 'name', e.target.value)}
                        placeholder="שם המטרה"
                        className="flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60"
                      />
                      <button
                        onClick={() => deleteGoal(id, row.id)}
                        className="shrink-0 text-muted-txt hover:text-expense transition-colors text-sm"
                      >×</button>
                    </div>

                    {/* Fields grid — 2 cols on mobile, 5 on desktop */}
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                      <div className="space-y-0.5">
                        <div className="text-xs text-muted-txt px-1">נדרש ₪</div>
                        {numInput(row.required, v => updateGoal(id, row.id, 'required', v), '₪')}
                      </div>
                      <div className="space-y-0.5">
                        <div className="text-xs text-muted-txt px-1">נוכחי ₪</div>
                        {numInput(row.current, v => updateGoal(id, row.id, 'current', v), '₪')}
                      </div>
                      <div className="space-y-0.5">
                        <div className="text-xs text-muted-txt px-1">
                          חודשי ₪{moAuto > 0 && row.monthly === 0 && <span className="text-gold"> ({fmt(moAuto)})</span>}
                        </div>
                        {numInput(row.monthly, v => updateGoal(id, row.id, 'monthly', v), moAuto > 0 ? fmt(moAuto) : '₪')}
                      </div>
                      <div className="space-y-0.5">
                        <div className="text-xs text-muted-txt px-1">תאריך יעד</div>
                        <input
                          type="month" value={row.targetDate}
                          onChange={e => updateGoal(id, row.id, 'targetDate', e.target.value)}
                          style={{ direction: 'ltr' }}
                          className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt focus:outline-none focus:border-gold/60 text-left"
                        />
                      </div>
                      <div className="space-y-0.5 col-span-2 sm:col-span-1">
                        <div className="text-xs text-muted-txt px-1">מוצר השקעה</div>
                        <input
                          type="text"
                          value={row.product || ''}
                          onChange={e => updateGoal(id, row.id, 'product', e.target.value)}
                          placeholder="לדוגמה: קרן השתלמות"
                          className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60"
                        />
                      </div>
                    </div>

                    {/* Progress */}
                    {row.required > 0 && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className={`font-bold ${isDone ? 'text-income' : pct > 0 ? 'text-gold' : 'text-muted-txt'}`}>
                            {isDone ? '✓ הושג' : `${pct}%`}
                          </span>
                          {moMonths !== null && !isDone && (
                            <span className="text-muted-txt">{moMonths} חודשים נותרו</span>
                          )}
                        </div>
                        <div className="h-1.5 rounded-full bg-line overflow-hidden">
                          <div className={`h-full rounded-full transition-all duration-500 ${bar}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <button onClick={() => addGoal(id)} className="text-xs text-muted-txt hover:text-gold transition-colors">
              + הוסף יעד
            </button>
          </div>
        )
      })}
    </div>
  )
}
