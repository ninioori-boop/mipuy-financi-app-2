'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useGoalsStore } from '@/stores/goalsStore'
import { useMappingStore } from '@/stores/mappingStore'
import { GoalsAnalysis } from '@/components/goals/GoalsAnalysis'
import type { GoalFacts } from '@/lib/goalsAnalysis'
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
  // Guard against malformed/legacy dates (e.g. "2026" or "") that would
  // otherwise yield NaN and surface as "NaN חודשים נותרו".
  if (!Number.isFinite(y) || !Number.isFinite(m)) return null
  const now = new Date()
  return Math.max(0, (y - now.getFullYear()) * 12 + (m - now.getMonth() - 1))
}

function autoMonthly(row: GoalRow): number {
  if (row.monthly > 0) return row.monthly
  // Liquid capital earmarked for this goal shrinks the gap that monthly
  // savings still needs to cover.
  const remaining = Math.max(0, row.required - row.current - (row.liquidAllocated || 0))
  const months    = monthsUntil(row.targetDate)
  if (months === null) return 0                 // no target date — can't auto-plan
  if (months <= 0) return Math.ceil(remaining)  // due this month / overdue — need the full remaining now
  return Math.ceil(remaining / months)
}

function numInput(
  value: number,
  onChange: (v: number) => void,
  placeholder: string,
  cls = '',
) {
  return (
    <input
      type="number" inputMode="decimal" value={value || ''} min={0}
      onChange={e => onChange(Math.max(0, parseFloat(e.target.value) || 0))}
      placeholder={placeholder} style={{ direction: 'ltr' }}
      className={`rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt focus:outline-none focus:border-gold/60 text-left tabular-nums w-full ${cls}`}
    />
  )
}

export default function GoalsPage() {
  const { short, medium, long, addGoal, updateGoal, deleteGoal, liquidTotal, setLiquidTotal, liquidSources, setLiquidSources } = useGoalsStore()
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

  // ── Liquid capital pool — the capital picture comes from the mapping tab
  //    (savings accumulations + positive checking balances); the client decides
  //    how much of it is actually liquid and investable. ──
  const capital = useMemo(() => {
    const rows = [
      ...mapping.savings
        .filter(r => (r.accumulated || 0) > 0)
        .map(r => ({ id: `sav:${r.id}`, name: r.name || 'חיסכון', amount: r.accumulated })),
      ...mapping.bankAccounts
        .filter(r => (r.balance || 0) > 0)
        .map(r => ({ id: `bank:${r.id}`, name: r.name ? `עו"ש · ${r.name}` : 'עו"ש', amount: r.balance })),
    ]
    return { rows, total: rows.reduce((s, r) => s + r.amount, 0) }
  }, [mapping.savings, mapping.bankAccounts])

  // Tapping a capital row counts it toward the liquid pool (tap again to undo).
  // The pool is then re-summed from every selected row, so it always equals
  // what's highlighted — and stays hand-editable afterwards.
  function toggleSource(rowId: string) {
    const next = liquidSources.includes(rowId)
      ? liquidSources.filter(x => x !== rowId)
      : [...liquidSources, rowId]
    setLiquidSources(next)
    setLiquidTotal(capital.rows.filter(r => next.includes(r.id)).reduce((s, r) => s + r.amount, 0))
  }

  const liquidAllocatedTotal = allGoals.reduce((s, r) => s + (r.liquidAllocated || 0), 0)
  const liquidRemaining      = liquidTotal - liquidAllocatedTotal
  const liquidPct            = liquidTotal > 0 ? Math.min(100, (liquidAllocatedTotal / liquidTotal) * 100) : 0
  // Over also covers the orphan case (allocations exist but the pool was
  // cleared back to 0) — those still shrink the monthly numbers, so they must
  // stay visible and correctable, never silently active.
  const liquidOver           = liquidAllocatedTotal > liquidTotal

  // Facts for the goal analysis — months derived from each goal's
  // target date; the analysis engine is pure and lives in lib/.
  // `current` must include earmarked liquid capital, exactly like autoMonthly
  // does — otherwise the analysis says "you need ₪X/mo" while the row next to
  // it shows a different number.
  const factCurrent = (r: GoalRow) => r.current + (r.liquidAllocated || 0)
  const shortFacts: GoalFacts[] = short.map(r => ({
    id: r.id, name: r.name, required: r.required, current: factCurrent(r),
    months: monthsUntil(r.targetDate), liquidity: r.liquidity,
  }))
  const mediumFacts: GoalFacts[] = medium.map(r => ({
    id: r.id, name: r.name, required: r.required, current: factCurrent(r),
    months: monthsUntil(r.targetDate), riskLevel: r.riskLevel, investorType: r.investorType,
  }))
  const longFacts: GoalFacts[] = long.map(r => ({
    id: r.id, name: r.name, required: r.required, current: factCurrent(r),
    months: monthsUntil(r.targetDate), riskLevel: r.riskLevel, investorType: r.investorType,
  }))

  return (
    <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6">

      {/* Header */}
      <div className="rounded-xl border border-line bg-surface2 p-4 sm:p-5">
        <h1 className="text-xl sm:text-2xl font-bold text-gold mb-1">🎯 יעדים פיננסיים</h1>
        <p className="hidden sm:block text-muted-txt text-sm">הגדר יעדים לפי טווח זמן: המערכת תחשב כמה לחסוך מדי חודש</p>
      </div>

      {/* Savings budget bar — comes from /app/checking */}
      {savingsBudget.hasData && savingsBudget.budget > 0 ? (
        <div className={`rounded-2xl border-2 p-4 sm:p-5 transition-colors ${
          isOver
            ? 'border-expense/50 bg-expense/5'
            : 'border-gold/40 bg-gradient-to-br from-gold/10 to-transparent'
        }`}>
          <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
            <div>
              <div className="text-xs text-muted-txt mb-1 flex items-center gap-1.5">
                💧 תקציב חיסכון חודשי · מטאב <Link href="/app/checking" className="text-gold hover:underline">התנהלות עו&quot;ש</Link>
              </div>
              <div className="text-2xl sm:text-3xl font-black text-gold tabular-nums">{fmt(savingsBudget.budget)}<span className="text-xs font-normal text-muted-txt me-2">/חודש</span></div>
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

      {/* Liquid capital to invest — capital breakdown from the mapping tab on
          top, then the client's own "how much of it is liquid" decision, then
          an allocation bar mirroring the monthly one above. */}
      <div className={`rounded-2xl border-2 p-4 sm:p-5 transition-colors ${
        liquidOver
          ? 'border-expense/50 bg-expense/5'
          : 'border-gold/40 bg-gradient-to-br from-gold/10 to-transparent'
      }`}>
        {/* Same head layout as the monthly savings-budget bar above: the pool
            on one side (editable), what's already allocated on the other. */}
        <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
          <div>
            <div className="text-xs text-muted-txt mb-1">💰 כסף נזיל להשקעה · אתה מחליט כמה מההון זמין</div>
            <input
              type="number" inputMode="decimal" value={liquidTotal || ''} min={0}
              onChange={e => setLiquidTotal(Math.max(0, parseFloat(e.target.value) || 0))}
              placeholder="0" style={{ direction: 'ltr' }}
              className="w-full max-w-[13rem] bg-transparent border-b border-gold/40 focus:border-gold focus:outline-none text-2xl sm:text-3xl font-black text-gold tabular-nums text-left px-1"
            />
          </div>
          <div className="text-end space-y-0.5">
            <div className="text-xs text-muted-txt">שויך ליעדים</div>
            <div className={`text-xl font-bold tabular-nums ${liquidOver ? 'text-expense' : 'text-txt'}`}>{fmt(liquidAllocatedTotal)}</div>
            <div className="text-xs text-muted-txt">
              {liquidRemaining >= 0 ? 'נותר: ' : 'חריגה: '}
              <span className={`tabular-nums font-bold ${liquidRemaining >= 0 ? 'text-income' : 'text-expense'}`}>
                {fmt(Math.abs(liquidRemaining))}
              </span>
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-3 rounded-full bg-line overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              liquidOver ? 'bg-expense' : liquidPct > 85 ? 'bg-gold' : 'bg-income'
            }`}
            style={{ width: `${liquidPct}%` }}
          />
        </div>

        {liquidOver ? (
          <div className="mt-3 text-xs text-expense">
            ⚠️ סך השיוך ליעדים עולה על הכסף הנזיל בעוד <span className="tabular-nums">{fmt(Math.abs(liquidRemaining))}</span>. הקטן את הסכומים, או עדכן את הסכום הנזיל.
          </div>
        ) : liquidTotal > 0 && liquidAllocatedTotal === 0 ? (
          <div className="mt-3 text-xs text-muted-txt">
            חלק את הכסף בין היעדים בשדה &quot;💰 מהכסף הנזיל&quot; שמופיע בכל יעד למטה. כל סכום שתקליד יירד מהיתרה כאן.
          </div>
        ) : null}

        {/* Where the capital actually sits, per the mapping tab */}
        {capital.rows.length > 0 ? (
          <div className="mt-4 rounded-xl border border-line bg-surface/40 p-3">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-xs text-muted-txt">
                ההון שלך · מטאב <Link href="/app/mapping" className="text-gold hover:underline">מיפוי</Link>
              </span>
              <span className="text-sm font-bold text-txt tabular-nums">{fmt(capital.total)}</span>
            </div>
            <p className="text-xs text-muted-txt mb-2">לחץ על נכס כדי לספור אותו ככסף נזיל. לחיצה נוספת מבטלת.</p>
            <div className="space-y-1">
              {capital.rows.map(r => {
                const picked = liquidSources.includes(r.id)
                return (
                  <button
                    key={r.id}
                    onClick={() => toggleSource(r.id)}
                    aria-pressed={picked}
                    className={`w-full min-h-[44px] flex items-center justify-between gap-2 text-sm rounded-lg border px-2.5 py-2 text-start transition-colors ${
                      picked
                        ? 'border-gold/60 bg-gold/10 text-txt'
                        : 'border-transparent hover:border-line hover:bg-surface3 text-txt'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className={`shrink-0 w-4 text-center ${picked ? 'text-gold' : 'text-muted-txt/40'}`}>
                        {picked ? '✓' : '+'}
                      </span>
                      <span className="truncate min-w-0">{r.name}</span>
                    </span>
                    <span className={`tabular-nums shrink-0 ${picked ? 'text-gold font-bold' : 'text-muted-txt'}`}>{fmt(r.amount)}</span>
                  </button>
                )
              })}
            </div>
            {liquidSources.length > 0 && (
              <button
                onClick={() => { setLiquidSources([]); setLiquidTotal(0) }}
                className="mt-2 text-xs text-muted-txt hover:text-expense transition-colors py-2 min-h-[44px] inline-flex items-center"
              >
                נקה את כל הבחירות
              </button>
            )}
          </div>
        ) : (
          <Link
            href="/app/mapping"
            className="mt-4 block rounded-xl border border-dashed border-line bg-surface/40 p-3 hover:border-gold/60 transition-colors"
          >
            <span className="text-xs text-muted-txt">
              עדיין אין נתוני הון במיפוי. מלא צבירות בחלק החסכונות בטאב המיפוי, והפירוט יופיע כאן.
            </span>
          </Link>
        )}
      </div>

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
              <div className={`text-lg sm:text-xl font-black tabular-nums truncate ${color}`}>{val}</div>
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
                        className="shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center text-muted-txt hover:text-expense transition-colors text-sm"
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

                    {/* Liquid-capital allocation — visible once a liquid pool
                        was defined in the card above, and always when this goal
                        already carries an allocation (so it can be cleared even
                        if the pool went back to 0). */}
                    {(liquidTotal > 0 || (row.liquidAllocated || 0) > 0) && (
                      <div className="flex items-center gap-2 flex-wrap pt-0.5">
                        <span className="text-xs text-muted-txt">💰 מהכסף הנזיל:</span>
                        <div className="w-28">
                          {numInput(row.liquidAllocated || 0, v => updateGoal(id, row.id, 'liquidAllocated', v), '₪')}
                        </div>
                        {(row.liquidAllocated || 0) > 0 && row.required > 0 && (
                          <span className="text-xs text-muted-txt">
                            נשאר להשלים ביעד:{' '}
                            <span className="tabular-nums font-semibold text-txt">
                              {fmt(Math.max(0, row.required - row.current - (row.liquidAllocated || 0)))}
                            </span>
                          </span>
                        )}
                      </div>
                    )}

                    {/* Liquidity toggle — short-term goals. Feeds the
                        analysis (money-market vs deposit). */}
                    {id === 'short' && (
                      <div className="flex items-center gap-2 flex-wrap pt-0.5">
                        <span className="text-xs text-muted-txt">נזילות:</span>
                        <button
                          onClick={() => updateGoal(id, row.id, 'liquidity', 'liquid')}
                          className={`text-xs px-3 py-2 min-h-[44px] inline-flex items-center justify-center rounded-lg border transition-colors ${row.liquidity === 'liquid' ? 'border-gold bg-gold/15 text-gold font-semibold' : 'border-line bg-surface text-muted-txt hover:border-gold/40'}`}
                        >צריך נזיל</button>
                        <button
                          onClick={() => updateGoal(id, row.id, 'liquidity', 'lockable')}
                          className={`text-xs px-3 py-2 min-h-[44px] inline-flex items-center justify-center rounded-lg border transition-colors ${row.liquidity === 'lockable' ? 'border-gold bg-gold/15 text-gold font-semibold' : 'border-line bg-surface text-muted-txt hover:border-gold/40'}`}
                        >אפשר לנעול</button>
                      </div>
                    )}

                    {/* Risk + investor toggles — medium & long goals.
                        Feed the analysis (equity/solid tilt + vehicles). */}
                    {(id === 'medium' || id === 'long') && (
                      <div className="space-y-1.5 pt-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-muted-txt">רמת סיכון:</span>
                          {([['solid', 'סולידי'], ['balanced', 'מאוזן'], ['growth', 'צמיחה']] as const).map(([val, label]) => (
                            <button key={val}
                              onClick={() => updateGoal(id, row.id, 'riskLevel', val)}
                              className={`text-xs px-3 py-2 min-h-[44px] inline-flex items-center justify-center rounded-lg border transition-colors ${row.riskLevel === val ? 'border-gold bg-gold/15 text-gold font-semibold' : 'border-line bg-surface text-muted-txt hover:border-gold/40'}`}
                            >{label}</button>
                          ))}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-muted-txt">סוג משקיע:</span>
                          {([['managed', 'מוצר מנוהל'], ['diy', 'משקיע לבד']] as const).map(([val, label]) => (
                            <button key={val}
                              onClick={() => updateGoal(id, row.id, 'investorType', val)}
                              className={`text-xs px-3 py-2 min-h-[44px] inline-flex items-center justify-center rounded-lg border transition-colors ${row.investorType === val ? 'border-gold bg-gold/15 text-gold font-semibold' : 'border-line bg-surface text-muted-txt hover:border-gold/40'}`}
                            >{label}</button>
                          ))}
                        </div>
                      </div>
                    )}

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

            <button onClick={() => addGoal(id)} className="text-xs text-muted-txt hover:text-gold transition-colors py-3 min-h-[44px] inline-flex items-center">
              + הוסף יעד
            </button>

            {/* Goal analysis — rendered inside its horizon section. */}
            {id === 'short' && (
              <GoalsAnalysis horizon="short" facts={shortFacts} monthlyBudget={savingsBudget.budget} />
            )}
            {id === 'medium' && (
              <GoalsAnalysis horizon="medium" facts={mediumFacts} monthlyBudget={savingsBudget.budget} />
            )}
            {id === 'long' && (
              <GoalsAnalysis horizon="long" facts={longFacts} monthlyBudget={savingsBudget.budget} />
            )}
          </div>
        )
      })}
    </div>
  )
}
