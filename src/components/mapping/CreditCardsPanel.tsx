'use client'

import type { CreditCardRow } from '@/stores/mappingStore'

const fmt = (n: number) =>
  '₪' + Math.round(n).toLocaleString('he-IL')

interface Props {
  cards:    CreditCardRow[]
  onAdd:    () => void
  onUpdate: (id: string, field: keyof Omit<CreditCardRow, 'id'>, value: string | number) => void
  onDelete: (id: string) => void
}

function NumInput({ value, onChange, placeholder, min = 0, max }: {
  value: number
  onChange: (v: number) => void
  placeholder: string
  min?: number
  max?: number
}) {
  return (
    <input
      type="number"
      value={value || ''}
      min={min}
      max={max}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      placeholder={placeholder}
      style={{ direction: 'ltr' }}
      className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left tabular-nums"
    />
  )
}

export function CreditCardsPanel({ cards, onAdd, onUpdate, onDelete }: Props) {
  const totalLimit = cards.reduce((s, r) => s + r.limit, 0)

  return (
    <div className="rounded-xl border border-line bg-surface2 p-3 sm:p-5 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-1">
        <h2 className="font-semibold text-txt">💳 כרטיסי אשראי</h2>
        <span className="text-xs text-muted-txt">
          סך מסגרות: <span className="font-bold text-gold">{fmt(totalLimit)}</span>
        </span>
      </div>

      {/* Desktop column headers */}
      <div className="hidden sm:grid grid-cols-[1fr_8rem_7rem_1.5rem] gap-2 px-1 text-xs text-muted-txt font-medium">
        <span>שם הכרטיס</span>
        <span className="text-start">מסגרת ₪</span>
        <span className="text-start">יום ירידה בחודש</span>
        <span />
      </div>

      <div className="space-y-2">
        {cards.map(row => (
          <div key={row.id} className="group">
            {/* Desktop */}
            <div className="hidden sm:grid grid-cols-[1fr_8rem_7rem_1.5rem] gap-2 items-center">
              <input
                value={row.name}
                onChange={e => onUpdate(row.id, 'name', e.target.value)}
                placeholder="למשל: ויזה לאומי"
                className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60"
              />
              <NumInput value={row.limit}     onChange={v => onUpdate(row.id, 'limit', v)}     placeholder="₪" />
              <NumInput value={row.chargeDay} onChange={v => onUpdate(row.id, 'chargeDay', v)} placeholder="2" min={1} max={28} />
              <button
                onClick={() => onDelete(row.id)}
                className="text-muted-txt hover:text-expense transition-colors opacity-0 group-hover:opacity-100 text-sm leading-none"
              >×</button>
            </div>

            {/* Mobile card */}
            <div className="sm:hidden bg-surface/40 rounded-lg p-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <input
                  value={row.name}
                  onChange={e => onUpdate(row.id, 'name', e.target.value)}
                  placeholder="שם הכרטיס"
                  className="flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60"
                />
                <button onClick={() => onDelete(row.id)} className="shrink-0 text-muted-txt hover:text-expense text-sm">×</button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-0.5">
                  <div className="text-[10px] text-muted-txt px-1">מסגרת ₪</div>
                  <NumInput value={row.limit} onChange={v => onUpdate(row.id, 'limit', v)} placeholder="₪" />
                </div>
                <div className="space-y-0.5">
                  <div className="text-[10px] text-muted-txt px-1">יום ירידה</div>
                  <NumInput value={row.chargeDay} onChange={v => onUpdate(row.id, 'chargeDay', v)} placeholder="2" min={1} max={28} />
                </div>
              </div>
            </div>
          </div>
        ))}
        {cards.length === 0 && (
          <p className="text-xs text-muted-txt py-2">אין כרטיסי אשראי עדיין</p>
        )}
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-line">
        <button onClick={onAdd} className="text-xs text-muted-txt hover:text-gold transition-colors">
          + הוסף כרטיס
        </button>
        <span className="text-xs text-muted-txt">
          סך מסגרות: <span className="font-medium text-gold">{fmt(totalLimit)}</span>
        </span>
      </div>
    </div>
  )
}
