'use client'

import type { DebtRow } from '@/stores/mappingStore'

function fmt(n: number) {
  return '₪' + n.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

interface Props {
  debts: DebtRow[]
  onAdd: () => void
  onUpdate: (id: string, field: keyof Omit<DebtRow, 'id'>, value: string | number) => void
  onDelete: (id: string) => void
}

function numInput(
  value: number,
  onChange: (v: number) => void,
  placeholder: string,
  cls = '',
) {
  return (
    <input
      type="number"
      value={value || ''}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      placeholder={placeholder}
      min={0}
      className={`rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left tabular-nums w-full ${cls}`}
      style={{ direction: 'ltr' }}
    />
  )
}

export function DebtPanel({ debts, onAdd, onUpdate, onDelete }: Props) {
  const totalBalance = debts.reduce((s, r) => s + r.remainingBalance, 0)
  const totalMonthly = debts.reduce((s, r) => s + r.monthlyPayment, 0)

  return (
    <div className="rounded-xl border border-line bg-surface2 p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-txt">💳 חובות והלוואות</h2>
        <span className="text-xs text-muted-txt">
          יתרה: <span className="font-bold text-expense">{fmt(totalBalance)}</span>
          <span className="mx-2">|</span>
          החזר חודשי: <span className="font-bold text-gold">{fmt(totalMonthly)}</span>
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[760px]">
          <thead>
            <tr className="text-muted-txt border-b border-line">
              <th className="text-right pb-2 font-medium w-[180px]">שם הנושה / הלוואה</th>
              <th className="text-left pb-2 font-medium px-1 w-[110px]">יתרה התחלתית ₪</th>
              <th className="text-left pb-2 font-medium px-1 w-[110px]">יתרה לסגירה ₪</th>
              <th className="text-left pb-2 font-medium px-1 w-[80px]">ריבית %</th>
              <th className="text-left pb-2 font-medium px-1 w-[80px]">חודשים</th>
              <th className="text-left pb-2 font-medium px-1 w-[110px]">החזר חודשי ₪</th>
              <th className="text-center pb-2 font-medium px-1 w-[90px]">תשלום כולל</th>
              <th className="w-6" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line/50">
            {debts.map(row => {
              const total = row.monthlyPayment * row.remainingMonths
              return (
                <tr key={row.id} className="group">
                  <td className="py-1.5 pr-0">
                    <input
                      value={row.name}
                      onChange={e => onUpdate(row.id, 'name', e.target.value)}
                      placeholder="שם"
                      className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60"
                    />
                  </td>
                  <td className="py-1.5 px-1">{numInput(row.originalBalance, v => onUpdate(row.id, 'originalBalance', v), '₪')}</td>
                  <td className="py-1.5 px-1">{numInput(row.remainingBalance, v => onUpdate(row.id, 'remainingBalance', v), '₪')}</td>
                  <td className="py-1.5 px-1">{numInput(row.interestRate, v => onUpdate(row.id, 'interestRate', v), '%')}</td>
                  <td className="py-1.5 px-1">{numInput(row.remainingMonths, v => onUpdate(row.id, 'remainingMonths', v), '0')}</td>
                  <td className="py-1.5 px-1">{numInput(row.monthlyPayment, v => onUpdate(row.id, 'monthlyPayment', v), '₪')}</td>
                  <td className="py-1.5 px-1 text-center">
                    <span className="text-xs px-2 py-1 rounded-full border border-line text-muted-txt whitespace-nowrap">
                      {total > 0 ? fmt(total) : '—'}
                    </span>
                  </td>
                  <td className="py-1.5 pl-1">
                    <button
                      onClick={() => onDelete(row.id)}
                      className="text-muted-txt hover:text-expense transition-colors opacity-0 group-hover:opacity-100"
                    >×</button>
                  </td>
                </tr>
              )
            })}
            {debts.length === 0 && (
              <tr>
                <td colSpan={8} className="py-4 text-center text-muted-txt text-xs">אין הלוואות</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-line">
        <button onClick={onAdd} className="text-xs text-muted-txt hover:text-gold transition-colors">
          + הוסף הלוואה
        </button>
        <span className="text-xs text-muted-txt">
          סה&quot;כ יתרות לסגירה: <span className="font-medium text-expense">{fmt(totalBalance)}</span>
          <span className="mx-2">|</span>
          החזר חודשי כולל: <span className="font-medium text-gold">{fmt(totalMonthly)}</span>
        </span>
      </div>
    </div>
  )
}
