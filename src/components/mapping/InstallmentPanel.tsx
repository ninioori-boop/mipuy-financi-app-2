'use client'

import type { InstallmentRow } from '@/stores/mappingStore'

function fmt(n: number) {
  return '₪' + n.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

interface Props {
  installments: InstallmentRow[]
  onAdd: () => void
  onUpdate: (id: string, field: keyof Omit<InstallmentRow, 'id'>, value: string | number) => void
  onDelete: (id: string) => void
}

export function InstallmentPanel({ installments, onAdd, onUpdate, onDelete }: Props) {
  const totalMonthly = installments.reduce((s, r) => s + r.monthlyPayment, 0)
  const totalDebt    = installments.reduce((s, r) => {
    const remaining = Math.max(0, r.totalCount - r.paidCount)
    return s + r.monthlyPayment * remaining
  }, 0)

  return (
    <div className="rounded-xl border border-line bg-surface2 p-5 space-y-3 overflow-hidden">
      <div className="flex items-center justify-between flex-wrap gap-1">
        <h2 className="font-semibold text-txt">📅 עסקאות בתשלומים</h2>
        <span className="text-xs text-muted-txt">
          חודשי: <span className="font-bold text-gold">{fmt(totalMonthly)}</span>
          <span className="mx-2">|</span>
          חוב עתידי: <span className="font-bold text-expense">{fmt(totalDebt)}</span>
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[680px]">
          <thead>
            <tr className="text-muted-txt border-b border-line">
              <th className="text-right pb-2 font-medium w-[170px]">שם החברה</th>
              <th className="text-left pb-2 font-medium px-1 w-[110px]">סכום כולל ₪</th>
              <th className="text-left pb-2 font-medium px-1 w-[110px]">תשלום חודשי ₪</th>
              <th className="text-left pb-2 font-medium px-1 w-[70px]">שולמו</th>
              <th className="text-left pb-2 font-medium px-1 w-[70px]">מתוך</th>
              <th className="text-center pb-2 font-medium px-1 w-[100px]">נותרו</th>
              <th className="w-6" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line/50">
            {installments.map(row => {
              const remaining = Math.max(0, row.totalCount - row.paidCount)
              const remainingDebt = row.monthlyPayment * remaining
              return (
                <tr key={row.id} className="group">
                  <td className="py-1.5 pr-0">
                    <input
                      value={row.name}
                      onChange={e => onUpdate(row.id, 'name', e.target.value)}
                      placeholder="שם החברה"
                      className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60"
                    />
                  </td>
                  <td className="py-1.5 px-1">
                    <input type="number" value={row.totalAmount || ''} min={0}
                      onChange={e => onUpdate(row.id, 'totalAmount', parseFloat(e.target.value) || 0)}
                      placeholder="₪" style={{ direction: 'ltr' }}
                      className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left tabular-nums" />
                  </td>
                  <td className="py-1.5 px-1">
                    <input type="number" value={row.monthlyPayment || ''} min={0}
                      onChange={e => onUpdate(row.id, 'monthlyPayment', parseFloat(e.target.value) || 0)}
                      placeholder="₪" style={{ direction: 'ltr' }}
                      className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left tabular-nums" />
                  </td>
                  <td className="py-1.5 px-1">
                    <input type="number" value={row.paidCount || ''} min={0}
                      onChange={e => onUpdate(row.id, 'paidCount', parseInt(e.target.value) || 0)}
                      placeholder="0" style={{ direction: 'ltr' }}
                      className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left tabular-nums" />
                  </td>
                  <td className="py-1.5 px-1">
                    <input type="number" value={row.totalCount || ''} min={1}
                      onChange={e => onUpdate(row.id, 'totalCount', parseInt(e.target.value) || 0)}
                      placeholder="0" style={{ direction: 'ltr' }}
                      className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left tabular-nums" />
                  </td>
                  <td className="py-1.5 px-1 text-center">
                    <span className="text-xs px-2 py-1 rounded-full border border-line text-muted-txt whitespace-nowrap">
                      {row.paidCount > 0 && row.totalCount > 0
                        ? `${remaining} נותרו${remainingDebt > 0 ? ` (${fmt(remainingDebt)})` : ''}`
                        : '—'}
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
            {installments.length === 0 && (
              <tr>
                <td colSpan={7} className="py-4 text-center text-muted-txt text-xs">אין עסקאות בתשלומים</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-line">
        <button onClick={onAdd} className="text-xs text-muted-txt hover:text-gold transition-colors">
          + הוסף עסקה
        </button>
        <span className="text-xs text-muted-txt">
          תשלום חודשי: <span className="font-medium text-gold">{fmt(totalMonthly)}</span>
          <span className="mx-2">|</span>
          חוב עתידי: <span className="font-medium text-expense">{fmt(totalDebt)}</span>
        </span>
      </div>
    </div>
  )
}
