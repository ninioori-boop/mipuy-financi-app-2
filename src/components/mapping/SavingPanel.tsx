'use client'

import type { SavingRow } from '@/stores/mappingStore'

function fmt(n: number) {
  return '₪' + n.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

interface Props {
  savings: SavingRow[]
  onAdd: () => void
  onUpdate: (id: string, field: keyof Omit<SavingRow, 'id'>, value: string | number) => void
  onDelete: (id: string) => void
}

export function SavingPanel({ savings, onAdd, onUpdate, onDelete }: Props) {
  const totalAccum   = savings.reduce((s, r) => s + r.accumulated, 0)
  const totalMonthly = savings.reduce((s, r) => s + r.monthlyContribution, 0)

  return (
    <div className="rounded-xl border border-line bg-surface2 p-5 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-1">
        <h2 className="font-semibold text-txt">🏦 חסכונות ונכסים</h2>
        <span className="text-xs text-muted-txt">
          נכסים: <span className="font-bold text-green-400">{fmt(totalAccum)}</span>
          <span className="mx-1.5">|</span>
          חודשי: <span className="font-bold text-gold">{fmt(totalMonthly)}</span>
        </span>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[1fr_4.5rem_4.5rem_1.5rem] sm:grid-cols-[1fr_8rem_8rem_1.5rem] gap-2 px-1 text-xs text-muted-txt font-medium">
        <span>סוג החיסכון / נכס</span>
        <span className="text-left">הפרשה ₪</span>
        <span className="text-left">מצטבר ₪</span>
        <span />
      </div>

      {/* Rows */}
      <div className="space-y-1.5">
        {savings.map(row => (
          <div key={row.id} className="grid grid-cols-[1fr_4.5rem_4.5rem_1.5rem] sm:grid-cols-[1fr_8rem_8rem_1.5rem] gap-2 items-center group">
            <input
              value={row.name}
              onChange={e => onUpdate(row.id, 'name', e.target.value)}
              placeholder="שם"
              className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60"
            />
            <input
              type="number"
              value={row.monthlyContribution || ''}
              onChange={e => onUpdate(row.id, 'monthlyContribution', parseFloat(e.target.value) || 0)}
              placeholder="₪" min={0} style={{ direction: 'ltr' }}
              className="rounded-lg border border-line bg-surface px-1.5 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left tabular-nums"
            />
            <input
              type="number"
              value={row.accumulated || ''}
              onChange={e => onUpdate(row.id, 'accumulated', parseFloat(e.target.value) || 0)}
              placeholder="₪" min={0} style={{ direction: 'ltr' }}
              className="rounded-lg border border-line bg-surface px-1.5 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left tabular-nums"
            />
            <button
              onClick={() => onDelete(row.id)}
              className="text-muted-txt hover:text-expense transition-colors opacity-0 group-hover:opacity-100 text-sm leading-none"
            >×</button>
          </div>
        ))}
        {savings.length === 0 && (
          <p className="text-xs text-muted-txt py-2">אין חסכונות עדיין</p>
        )}
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-line">
        <button onClick={onAdd} className="text-xs text-muted-txt hover:text-gold transition-colors">
          + הוסף חיסכון
        </button>
        <span className="text-xs text-muted-txt">
          נכסים: <span className="font-medium text-green-400">{fmt(totalAccum)}</span>
          <span className="mx-1.5">|</span>
          חודשי: <span className="font-medium text-gold">{fmt(totalMonthly)}</span>
        </span>
      </div>
    </div>
  )
}
