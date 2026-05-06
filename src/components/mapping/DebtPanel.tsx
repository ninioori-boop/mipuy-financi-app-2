'use client'

import type { DebtRow } from '@/stores/mappingStore'

function fmt(n: number) {
  return '₪' + n.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function spitzer(balance: number, annualRate: number, months: number): number {
  if (balance <= 0 || months <= 0) return 0
  if (annualRate <= 0) return Math.round(balance / months)
  const r = annualRate / 100 / 12
  return Math.round(balance * r * Math.pow(1 + r, months) / (Math.pow(1 + r, months) - 1))
}

interface Props {
  debts: DebtRow[]
  onAdd: () => void
  onUpdate: (id: string, field: keyof Omit<DebtRow, 'id'>, value: string | number) => void
  onDelete: (id: string) => void
}

function Num({ value, onChange, placeholder, cls = '' }: { value: number; onChange: (v: number) => void; placeholder: string; cls?: string }) {
  return (
    <input type="number" value={value || ''} min={0}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      placeholder={placeholder} style={{ direction: 'ltr' }}
      className={`w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left tabular-nums ${cls}`}
    />
  )
}

export function DebtPanel({ debts, onAdd, onUpdate, onDelete }: Props) {
  const totalBalance = debts.reduce((s, r) => s + r.remainingBalance, 0)
  const totalMonthly = debts.reduce((s, r) => s + r.monthlyPayment, 0)

  function handleField(id: string, field: keyof Omit<DebtRow, 'id'>, value: number, row: DebtRow) {
    onUpdate(id, field, value)
    const updated = { ...row, [field]: value }
    if (field === 'remainingBalance' || field === 'interestRate' || field === 'remainingMonths') {
      const calc = spitzer(updated.remainingBalance, updated.interestRate, updated.remainingMonths)
      if (calc > 0) onUpdate(id, 'monthlyPayment', calc)
    }
  }

  return (
    <div className="rounded-xl border border-line bg-surface2 p-3 sm:p-5 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-semibold text-txt">💳 חובות והלוואות</h2>
        <span className="text-xs text-muted-txt">
          יתרה: <span className="font-bold text-expense">{fmt(totalBalance)}</span>
          <span className="mx-2">|</span>
          החזר: <span className="font-bold text-gold">{fmt(totalMonthly)}</span>
        </span>
      </div>

      {/* Desktop table */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-xs min-w-[700px]">
          <thead>
            <tr className="text-muted-txt border-b border-line">
              <th className="text-right pb-2 font-medium">שם הנושה</th>
              <th className="text-left pb-2 font-medium px-1">יתרה ₪</th>
              <th className="text-left pb-2 font-medium px-1">ריבית %</th>
              <th className="text-left pb-2 font-medium px-1">חודשים</th>
              <th className="text-left pb-2 font-medium px-1">החזר חודשי ₪ <span className="text-[10px] text-gold/70 font-normal">שפיצר ↻</span></th>
              <th className="text-center pb-2 font-medium px-1">סה"כ</th>
              <th className="w-6" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line/50">
            {debts.map(row => {
              const calcPayment = spitzer(row.remainingBalance, row.interestRate, row.remainingMonths)
              const isAutoCalc  = calcPayment > 0 && row.monthlyPayment === calcPayment
              const total       = row.monthlyPayment * row.remainingMonths
              return (
                <tr key={row.id} className="group">
                  <td className="py-1.5 pr-0 w-40">
                    <input value={row.name} onChange={e => onUpdate(row.id, 'name', e.target.value)} placeholder="שם"
                      className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60" />
                  </td>
                  <td className="py-1.5 px-1 w-24"><Num value={row.remainingBalance} onChange={v => handleField(row.id, 'remainingBalance', v, row)} placeholder="₪" /></td>
                  <td className="py-1.5 px-1 w-16"><Num value={row.interestRate} onChange={v => handleField(row.id, 'interestRate', v, row)} placeholder="%" /></td>
                  <td className="py-1.5 px-1 w-16"><Num value={row.remainingMonths} onChange={v => handleField(row.id, 'remainingMonths', v, row)} placeholder="חו׳" /></td>
                  <td className="py-1.5 px-1 w-28">
                    <div className="relative">
                      <Num value={row.monthlyPayment} onChange={v => onUpdate(row.id, 'monthlyPayment', v)} placeholder="₪" cls={isAutoCalc ? 'border-gold/40 text-gold' : ''} />
                      {calcPayment > 0 && !isAutoCalc && (
                        <button onClick={() => onUpdate(row.id, 'monthlyPayment', calcPayment)} title={`שפיצר: ${fmt(calcPayment)}`}
                          className="absolute left-1 top-1/2 -translate-y-1/2 text-[10px] text-gold/60 hover:text-gold">↻</button>
                      )}
                    </div>
                  </td>
                  <td className="py-1.5 px-1 text-center w-20">
                    <span className="text-xs px-2 py-1 rounded-full border border-line text-muted-txt whitespace-nowrap">{total > 0 ? fmt(total) : '—'}</span>
                  </td>
                  <td className="py-1.5 pl-1">
                    <button onClick={() => onDelete(row.id)} className="text-muted-txt hover:text-expense transition-colors opacity-0 group-hover:opacity-100">×</button>
                  </td>
                </tr>
              )
            })}
            {debts.length === 0 && <tr><td colSpan={7} className="py-4 text-center text-muted-txt text-xs">אין הלוואות</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="sm:hidden space-y-2">
        {debts.map(row => {
          const calcPayment = spitzer(row.remainingBalance, row.interestRate, row.remainingMonths)
          const isAutoCalc  = calcPayment > 0 && row.monthlyPayment === calcPayment
          return (
            <div key={row.id} className="bg-surface/40 rounded-lg p-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <input value={row.name} onChange={e => onUpdate(row.id, 'name', e.target.value)} placeholder="שם הלוואה"
                  className="flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60" />
                <button onClick={() => onDelete(row.id)} className="shrink-0 text-muted-txt hover:text-expense text-sm">×</button>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                <div className="space-y-0.5">
                  <div className="text-[10px] text-muted-txt px-1">יתרה ₪</div>
                  <Num value={row.remainingBalance} onChange={v => handleField(row.id, 'remainingBalance', v, row)} placeholder="₪" />
                </div>
                <div className="space-y-0.5">
                  <div className="text-[10px] text-muted-txt px-1">ריבית %</div>
                  <Num value={row.interestRate} onChange={v => handleField(row.id, 'interestRate', v, row)} placeholder="%" />
                </div>
                <div className="space-y-0.5">
                  <div className="text-[10px] text-muted-txt px-1">חודשים</div>
                  <Num value={row.remainingMonths} onChange={v => handleField(row.id, 'remainingMonths', v, row)} placeholder="חו׳" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 space-y-0.5">
                  <div className="text-[10px] text-muted-txt px-1">החזר חודשי ₪ {isAutoCalc && <span className="text-gold">↻ שפיצר</span>}</div>
                  <Num value={row.monthlyPayment} onChange={v => onUpdate(row.id, 'monthlyPayment', v)} placeholder="₪" cls={isAutoCalc ? 'border-gold/40 text-gold' : ''} />
                </div>
                {calcPayment > 0 && !isAutoCalc && (
                  <button onClick={() => onUpdate(row.id, 'monthlyPayment', calcPayment)}
                    className="mt-4 text-xs px-2 py-1.5 rounded border border-gold/30 text-gold bg-gold/10 whitespace-nowrap">
                    ↻ {fmt(calcPayment)}
                  </button>
                )}
              </div>
            </div>
          )
        })}
        {debts.length === 0 && <p className="text-xs text-muted-txt py-2 text-center">אין הלוואות</p>}
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-line">
        <button onClick={onAdd} className="text-xs text-muted-txt hover:text-gold transition-colors">+ הוסף הלוואה</button>
        <span className="text-xs text-muted-txt">
          יתרות: <span className="font-medium text-expense">{fmt(totalBalance)}</span>
          <span className="mx-2">|</span>
          החזר: <span className="font-medium text-gold">{fmt(totalMonthly)}</span>
        </span>
      </div>
    </div>
  )
}
