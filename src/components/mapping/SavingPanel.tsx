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

function Num({ value, onChange, placeholder }: { value: number; onChange: (v: number) => void; placeholder: string }) {
  return (
    <input
      type="number" value={value || ''} min={0}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      placeholder={placeholder} style={{ direction: 'ltr' }}
      className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left tabular-nums"
    />
  )
}

export function SavingPanel({ savings, onAdd, onUpdate, onDelete }: Props) {
  const totalAccum   = savings.reduce((s, r) => s + r.accumulated, 0)
  const totalMonthly = savings.reduce((s, r) => s + r.monthlyContribution, 0)

  return (
    <div className="rounded-xl border border-line bg-surface2 p-3 sm:p-5 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-1">
        <h2 className="font-semibold text-txt">🏦 חסכונות ונכסים</h2>
        <span className="text-xs text-muted-txt">
          נכסים: <span className="font-bold text-green-400">{fmt(totalAccum)}</span>
          <span className="mx-1.5">|</span>
          חודשי: <span className="font-bold text-gold">{fmt(totalMonthly)}</span>
        </span>
      </div>

      {/* Desktop column headers */}
      <div className="hidden sm:grid grid-cols-[1fr_8rem_8rem_1.5rem] gap-2 px-1 text-xs text-muted-txt font-medium">
        <span>סוג החיסכון / נכס</span>
        <span className="text-left">הפרשה חודשית ₪</span>
        <span className="text-left">סכום מצטבר ₪</span>
        <span />
      </div>

      <div className="space-y-2">
        {savings.map(row => (
          <div key={row.id} className="group">
            {/* Desktop row */}
            <div className="hidden sm:grid grid-cols-[1fr_8rem_8rem_1.5rem] gap-2 items-center">
              <input
                value={row.name} onChange={e => onUpdate(row.id, 'name', e.target.value)}
                placeholder="שם" className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60"
              />
              <Num value={row.monthlyContribution} onChange={v => onUpdate(row.id, 'monthlyContribution', v)} placeholder="₪" />
              <Num value={row.accumulated} onChange={v => onUpdate(row.id, 'accumulated', v)} placeholder="₪" />
              <button onClick={() => onDelete(row.id)} className="text-muted-txt hover:text-expense transition-colors opacity-0 group-hover:opacity-100 text-sm leading-none">×</button>
            </div>

            {/* Mobile card */}
            <div className="sm:hidden bg-surface/40 rounded-lg p-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <input
                  value={row.name} onChange={e => onUpdate(row.id, 'name', e.target.value)}
                  placeholder="שם החיסכון / נכס"
                  className="flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60"
                />
                <button onClick={() => onDelete(row.id)} className="shrink-0 text-muted-txt hover:text-expense text-sm">×</button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-0.5">
                  <div className="text-xs text-muted-txt px-1">הפרשה חודשית ₪</div>
                  <Num value={row.monthlyContribution} onChange={v => onUpdate(row.id, 'monthlyContribution', v)} placeholder="₪" />
                </div>
                <div className="space-y-0.5">
                  <div className="text-xs text-muted-txt px-1">סכום מצטבר ₪</div>
                  <Num value={row.accumulated} onChange={v => onUpdate(row.id, 'accumulated', v)} placeholder="₪" />
                </div>
              </div>
            </div>
          </div>
        ))}
        {savings.length === 0 && (
          <p className="text-xs text-muted-txt py-2">אין חסכונות עדיין</p>
        )}
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-line">
        <button onClick={onAdd} className="text-xs text-muted-txt hover:text-gold transition-colors">+ הוסף חיסכון</button>
        <span className="text-xs text-muted-txt">
          נכסים: <span className="font-medium text-green-400">{fmt(totalAccum)}</span>
          <span className="mx-1.5">|</span>
          חודשי: <span className="font-medium text-gold">{fmt(totalMonthly)}</span>
        </span>
      </div>
    </div>
  )
}
