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

function Num({ value, onChange, placeholder, int = false }: { value: number; onChange: (v: number) => void; placeholder: string; int?: boolean }) {
  return (
    <input type="number" value={value || ''} min={0}
      onChange={e => onChange(int ? parseInt(e.target.value) || 0 : parseFloat(e.target.value) || 0)}
      placeholder={placeholder} style={{ direction: 'ltr' }}
      className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left tabular-nums"
    />
  )
}

export function InstallmentPanel({ installments, onAdd, onUpdate, onDelete }: Props) {
  const totalMonthly = installments.reduce((s, r) => s + r.monthlyPayment, 0)
  const totalDebt    = installments.reduce((s, r) => {
    const remaining = Math.max(0, r.totalCount - r.paidCount)
    return s + r.monthlyPayment * remaining
  }, 0)

  return (
    <div className="rounded-xl border border-line bg-surface2 p-3 sm:p-5 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-1">
        <h2 className="font-semibold text-txt">📅 עסקאות בתשלומים</h2>
        <span className="text-xs text-muted-txt">
          חודשי: <span className="font-bold text-gold">{fmt(totalMonthly)}</span>
          <span className="mx-1.5">|</span>
          חוב עתידי: <span className="font-bold text-expense">{fmt(totalDebt)}</span>
        </span>
      </div>

      {/* Desktop table */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-xs min-w-[580px]">
          <thead>
            <tr className="text-muted-txt border-b border-line">
              <th className="text-right pb-2 font-medium">שם החברה</th>
              <th className="text-left pb-2 font-medium px-1">סכום כולל ₪</th>
              <th className="text-left pb-2 font-medium px-1">חודשי ₪</th>
              <th className="text-left pb-2 font-medium px-1">שולמו</th>
              <th className="text-left pb-2 font-medium px-1">מתוך</th>
              <th className="text-center pb-2 font-medium px-1">נותרו</th>
              <th className="w-6" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line/50">
            {installments.map(row => {
              const remaining = Math.max(0, row.totalCount - row.paidCount)
              const remainingDebt = row.monthlyPayment * remaining
              return (
                <tr key={row.id} className="group">
                  <td className="py-1.5 pr-0 w-36">
                    <input value={row.name} onChange={e => onUpdate(row.id, 'name', e.target.value)} placeholder="שם"
                      className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60" />
                  </td>
                  <td className="py-1.5 px-1"><Num value={row.totalAmount} onChange={v => onUpdate(row.id, 'totalAmount', v)} placeholder="₪" /></td>
                  <td className="py-1.5 px-1"><Num value={row.monthlyPayment} onChange={v => onUpdate(row.id, 'monthlyPayment', v)} placeholder="₪" /></td>
                  <td className="py-1.5 px-1"><Num value={row.paidCount} onChange={v => onUpdate(row.id, 'paidCount', v)} placeholder="0" int /></td>
                  <td className="py-1.5 px-1"><Num value={row.totalCount} onChange={v => onUpdate(row.id, 'totalCount', v)} placeholder="0" int /></td>
                  <td className="py-1.5 px-1 text-center">
                    <span className="text-xs px-2 py-1 rounded-full border border-line text-muted-txt whitespace-nowrap">
                      {row.paidCount > 0 && row.totalCount > 0 ? `${remaining} נותרו${remainingDebt > 0 ? ` (${fmt(remainingDebt)})` : ''}` : '—'}
                    </span>
                  </td>
                  <td className="py-1.5 pl-1">
                    <button onClick={() => onDelete(row.id)} className="text-muted-txt hover:text-expense transition-colors opacity-0 group-hover:opacity-100">×</button>
                  </td>
                </tr>
              )
            })}
            {installments.length === 0 && <tr><td colSpan={7} className="py-4 text-center text-muted-txt text-xs">אין עסקאות</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="sm:hidden space-y-2">
        {installments.map(row => {
          const remaining = Math.max(0, row.totalCount - row.paidCount)
          return (
            <div key={row.id} className="bg-surface/40 rounded-lg p-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <input value={row.name} onChange={e => onUpdate(row.id, 'name', e.target.value)} placeholder="שם החברה"
                  className="flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60" />
                <button onClick={() => onDelete(row.id)} className="shrink-0 text-muted-txt hover:text-expense text-sm">×</button>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <div className="space-y-0.5">
                  <div className="text-[10px] text-muted-txt px-1">סכום כולל ₪</div>
                  <Num value={row.totalAmount} onChange={v => onUpdate(row.id, 'totalAmount', v)} placeholder="₪" />
                </div>
                <div className="space-y-0.5">
                  <div className="text-[10px] text-muted-txt px-1">תשלום חודשי ₪</div>
                  <Num value={row.monthlyPayment} onChange={v => onUpdate(row.id, 'monthlyPayment', v)} placeholder="₪" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1.5 items-end">
                <div className="space-y-0.5">
                  <div className="text-[10px] text-muted-txt px-1">שולמו</div>
                  <Num value={row.paidCount} onChange={v => onUpdate(row.id, 'paidCount', v)} placeholder="0" int />
                </div>
                <div className="space-y-0.5">
                  <div className="text-[10px] text-muted-txt px-1">מתוך</div>
                  <Num value={row.totalCount} onChange={v => onUpdate(row.id, 'totalCount', v)} placeholder="0" int />
                </div>
                <div className="text-center">
                  {row.totalCount > 0 && (
                    <span className="text-xs px-2 py-1 rounded-full border border-line text-muted-txt">
                      {remaining} נותרו
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
        {installments.length === 0 && <p className="text-xs text-muted-txt py-2 text-center">אין עסקאות</p>}
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-line">
        <button onClick={onAdd} className="text-xs text-muted-txt hover:text-gold transition-colors">+ הוסף עסקה</button>
        <span className="text-xs text-muted-txt">
          חודשי: <span className="font-medium text-gold">{fmt(totalMonthly)}</span>
          <span className="mx-1.5">|</span>
          עתידי: <span className="font-medium text-expense">{fmt(totalDebt)}</span>
        </span>
      </div>
    </div>
  )
}
