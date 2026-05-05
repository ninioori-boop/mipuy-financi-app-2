'use client'

import type { BudgetRow } from '@/stores/monthlyStore'

function fmt(n: number) {
  return '₪' + Math.round(n).toLocaleString('he-IL')
}

interface Props {
  title: string
  icon: string
  rows: BudgetRow[]
  isIncome?: boolean
  onAdd: () => void
  onUpdate: (id: string, field: 'name' | 'plan' | 'actual', value: string | number) => void
  onDelete: (id: string) => void
}

export function BudgetSection({ title, icon, rows, isIncome = false, onAdd, onUpdate, onDelete }: Props) {
  const totalPlan   = rows.reduce((s, r) => s + r.plan, 0)
  const totalActual = rows.reduce((s, r) => s + r.actual, 0)
  const hasActual   = totalActual > 0
  const diff        = isIncome ? totalActual - totalPlan : totalPlan - totalActual
  const diffOk      = diff >= 0

  return (
    <div className="rounded-xl border border-line bg-surface2 p-3 sm:p-5 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-semibold text-txt">{icon} {title}</h2>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-muted-txt">
            תכנון: <span className="font-bold text-gold">{fmt(totalPlan)}</span>
          </span>
          {hasActual && (
            <>
              <span className="text-muted-txt">
                ביצוע: <span className="font-bold text-txt">{fmt(totalActual)}</span>
              </span>
              <span className={`px-2 py-0.5 rounded-full font-bold border ${
                diffOk
                  ? 'bg-green-400/10 border-green-400/30 text-green-400'
                  : 'bg-expense/10 border-expense/30 text-expense'
              }`}>
                {diffOk ? '+' : ''}{fmt(diff)}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[1fr_3.2rem_3.2rem_1rem] sm:grid-cols-[1fr_6rem_6rem_1.5rem] gap-2 px-1 text-xs text-muted-txt font-medium">
        <span>פריט</span>
        <span className="text-center text-gold/80">תכנון ₪</span>
        <span className="text-center text-green-400/80">ביצוע ₪</span>
        <span />
      </div>

      {/* Rows */}
      <div className="space-y-1">
        {rows.map(row => (
          <div key={row.id} className="grid grid-cols-[1fr_3.2rem_3.2rem_1rem] sm:grid-cols-[1fr_6rem_6rem_1.5rem] gap-2 items-center group">
            <input
              value={row.name}
              onChange={e => onUpdate(row.id, 'name', e.target.value)}
              placeholder="פריט"
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60"
            />
            <input
              type="number"
              value={row.plan || ''}
              onChange={e => onUpdate(row.id, 'plan', parseFloat(e.target.value) || 0)}
              placeholder="₪"
              min={0}
              style={{ direction: 'ltr' }}
              className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left tabular-nums"
            />
            <input
              type="number"
              value={row.actual || ''}
              onChange={e => onUpdate(row.id, 'actual', parseFloat(e.target.value) || 0)}
              placeholder="₪"
              min={0}
              style={{ direction: 'ltr' }}
              className="rounded-lg border border-green-400/30 bg-surface px-2 py-1.5 text-sm text-green-400/90 placeholder:text-muted-txt focus:outline-none focus:border-green-400/60 text-left tabular-nums"
            />
            <button
              onClick={() => onDelete(row.id)}
              className="text-muted-txt hover:text-expense transition-colors opacity-0 group-hover:opacity-100 text-sm leading-none"
            >×</button>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="text-xs text-muted-txt py-2">אין שורות</p>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-line">
        <button onClick={onAdd} className="text-xs text-muted-txt hover:text-gold transition-colors">
          + הוסף
        </button>
        <span className="text-xs text-muted-txt">
          תכנון: <span className="font-medium text-gold">{fmt(totalPlan)}</span>
          {hasActual && (
            <span className="mr-2">
              ביצוע: <span className="font-medium text-txt">{fmt(totalActual)}</span>
            </span>
          )}
        </span>
      </div>
    </div>
  )
}
