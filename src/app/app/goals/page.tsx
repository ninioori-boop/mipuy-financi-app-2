'use client'

import { useGoalsStore } from '@/stores/goalsStore'
import type { GoalHorizon, GoalRow } from '@/stores/goalsStore'

function fmt(n: number) {
  return '₪' + Math.round(n).toLocaleString('he-IL')
}

const HORIZONS: { id: GoalHorizon; label: string; sub: string; accent: string; bar: string }[] = [
  { id: 'short',  label: 'טווח קצר',    sub: 'עד 3 שנים',  accent: 'text-green-400  border-green-400/30  bg-green-400/5',  bar: 'bg-green-400' },
  { id: 'medium', label: 'טווח בינוני', sub: '3–7 שנים',   accent: 'text-gold       border-gold/30       bg-gold/5',       bar: 'bg-gold' },
  { id: 'long',   label: 'טווח ארוך',   sub: '7 שנים ומעלה', accent: 'text-purple-400 border-purple-400/30 bg-purple-400/5', bar: 'bg-purple-400' },
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

export default function GoalsPage() {
  const { short, medium, long, addGoal, updateGoal, deleteGoal } = useGoalsStore()
  const sections = { short, medium, long }

  // KPIs across all horizons
  const allGoals   = [...short, ...medium, ...long]
  const totalReq   = allGoals.reduce((s, r) => s + r.required, 0)
  const totalCur   = allGoals.reduce((s, r) => s + r.current, 0)
  const totalMo    = allGoals.reduce((s, r) => s + autoMonthly(r), 0)
  const doneCount  = allGoals.filter(r => r.required > 0 && r.current >= r.required).length
  const activeGoals = allGoals.filter(r => r.name || r.required > 0)

  return (
    <div className="max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div className="rounded-xl border border-line bg-surface2 p-6">
        <h1 className="text-2xl font-bold text-gold mb-1">🎯 יעדים פיננסיים</h1>
        <p className="text-muted-txt text-sm">הגדר יעדים לפי טווח זמן — המערכת תחשב כמה לחסוך מדי חודש</p>
      </div>

      {/* KPI cards */}
      {activeGoals.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-xl border border-line bg-surface2 p-4">
            <div className="text-xs text-muted-txt mb-1">יעדים פעילים</div>
            <div className="text-2xl font-black text-txt">{activeGoals.length}</div>
          </div>
          <div className="rounded-xl border border-line bg-surface2 p-4">
            <div className="text-xs text-muted-txt mb-1">סך נדרש</div>
            <div className="text-2xl font-black text-txt">{fmt(totalReq)}</div>
          </div>
          <div className="rounded-xl border border-line bg-surface2 p-4">
            <div className="text-xs text-muted-txt mb-1">הפרשה חודשית נדרשת</div>
            <div className="text-2xl font-black text-gold">{fmt(totalMo)}</div>
          </div>
          <div className="rounded-xl border border-line bg-surface2 p-4">
            <div className="text-xs text-muted-txt mb-1">יעדים שהושגו</div>
            <div className="text-2xl font-black text-green-400">{doneCount}</div>
            {totalReq > 0 && (
              <div className="text-xs text-muted-txt mt-0.5">{Math.round((totalCur / totalReq) * 100)}% מהסכום הכולל</div>
            )}
          </div>
        </div>
      )}

      {/* Horizon sections */}
      {HORIZONS.map(({ id, label, sub, accent, bar }) => {
        const rows: GoalRow[] = sections[id]
        const secTotal = rows.reduce((s, r) => s + autoMonthly(r), 0)

        return (
          <div key={id} className={`rounded-xl border p-5 space-y-4 ${accent}`}>

            {/* Section header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-bold text-txt text-lg">{label}</h2>
                <p className="text-xs text-muted-txt">{sub}</p>
              </div>
              {secTotal > 0 && (
                <div className="text-sm text-muted-txt">
                  סה&quot;כ: <span className="font-bold text-txt">{fmt(secTotal)}/חודש</span>
                </div>
              )}
            </div>

            {/* Column headers */}
            <div className="grid gap-2 px-1 text-xs font-semibold text-muted-txt"
              style={{ gridTemplateColumns: '1fr 7rem 7rem 7rem 8rem 5rem 1.5rem' }}>
              <span>שם המטרה</span>
              <span>סכום נדרש ₪</span>
              <span>סכום נוכחי ₪</span>
              <span>הפרשה/חודש ₪</span>
              <span>תאריך יעד</span>
              <span className="text-center">התקדמות</span>
              <span />
            </div>

            {/* Rows */}
            <div className="space-y-2">
              {rows.map(row => {
                const pct        = row.required > 0 ? Math.min(100, Math.round((row.current / row.required) * 100)) : 0
                const isDone     = pct >= 100
                const moAuto     = autoMonthly(row)
                const moMonths   = monthsUntil(row.targetDate)

                return (
                  <div key={row.id} className="space-y-1.5 group">
                    <div className="grid gap-2 items-center"
                      style={{ gridTemplateColumns: '1fr 7rem 7rem 7rem 8rem 5rem 1.5rem' }}>

                      {/* Name */}
                      <input
                        value={row.name}
                        onChange={e => updateGoal(id, row.id, 'name', e.target.value)}
                        placeholder="שם המטרה (למשל: רכב, חתונה, קרן חירום)"
                        className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60"
                      />

                      {/* Required */}
                      <input
                        type="number"
                        value={row.required || ''}
                        onChange={e => updateGoal(id, row.id, 'required', parseFloat(e.target.value) || 0)}
                        placeholder="₪"
                        min={0}
                        style={{ direction: 'ltr' }}
                        className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt focus:outline-none focus:border-gold/60 text-left tabular-nums"
                      />

                      {/* Current */}
                      <input
                        type="number"
                        value={row.current || ''}
                        onChange={e => updateGoal(id, row.id, 'current', parseFloat(e.target.value) || 0)}
                        placeholder="₪"
                        min={0}
                        style={{ direction: 'ltr' }}
                        className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt focus:outline-none focus:border-gold/60 text-left tabular-nums"
                      />

                      {/* Monthly — manual override or auto-calc */}
                      <div className="relative">
                        <input
                          type="number"
                          value={row.monthly || ''}
                          onChange={e => updateGoal(id, row.id, 'monthly', parseFloat(e.target.value) || 0)}
                          placeholder={moAuto > 0 && row.monthly === 0 ? String(moAuto) : '₪'}
                          min={0}
                          style={{ direction: 'ltr' }}
                          className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt focus:outline-none focus:border-gold/60 text-left tabular-nums"
                        />
                        {row.monthly === 0 && moAuto > 0 && (
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-txt pointer-events-none tabular-nums">
                            {fmt(moAuto)}
                          </span>
                        )}
                      </div>

                      {/* Target date */}
                      <input
                        type="month"
                        value={row.targetDate}
                        onChange={e => updateGoal(id, row.id, 'targetDate', e.target.value)}
                        style={{ direction: 'ltr' }}
                        className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt focus:outline-none focus:border-gold/60 text-left"
                      />

                      {/* Progress badge */}
                      <div className="text-center">
                        <span className={`text-sm font-bold tabular-nums ${
                          isDone ? 'text-green-400' : pct > 0 ? 'text-gold' : 'text-muted-txt'
                        }`}>
                          {isDone ? '✓ הושג' : `${pct}%`}
                        </span>
                        {moMonths !== null && !isDone && (
                          <div className="text-xs text-muted-txt">{moMonths} חו׳</div>
                        )}
                      </div>

                      {/* Delete */}
                      <button
                        onClick={() => deleteGoal(id, row.id)}
                        className="text-muted-txt hover:text-expense transition-colors opacity-0 group-hover:opacity-100 text-sm leading-none"
                      >×</button>
                    </div>

                    {/* Progress bar */}
                    {row.required > 0 && (
                      <div className="h-1 rounded-full bg-line overflow-hidden mx-1">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${bar}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <button
              onClick={() => addGoal(id)}
              className="text-xs text-muted-txt hover:text-gold transition-colors"
            >
              + הוסף יעד
            </button>
          </div>
        )
      })}

    </div>
  )
}
