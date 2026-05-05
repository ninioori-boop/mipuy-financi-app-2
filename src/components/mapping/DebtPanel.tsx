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

function NumInput({
  value, onChange, placeholder, cls = '',
}: { value: number; onChange: (v: number) => void; placeholder: string; cls?: string }) {
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

  function handleFieldChange(
    id: string,
    field: keyof Omit<DebtRow, 'id'>,
    value: number,
    row: DebtRow,
  ) {
    onUpdate(id, field, value)

    // Auto-recalculate Spitzer when balance / rate / months change
    const updated = { ...row, [field]: value }
    if (field === 'remainingBalance' || field === 'interestRate' || field === 'remainingMonths') {
      const calc = spitzer(updated.remainingBalance, updated.interestRate, updated.remainingMonths)
      if (calc > 0) onUpdate(id, 'monthlyPayment', calc)
    }
  }

  return (
    <div className="rounded-xl border border-line bg-surface2 p-5 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-semibold text-txt">💳 חובות והלוואות</h2>
        <span className="text-xs text-muted-txt">
          יתרה: <span className="font-bold text-expense">{fmt(totalBalance)}</span>
          <span className="mx-2">|</span>
          החזר חודשי: <span className="font-bold text-gold">{fmt(totalMonthly)}</span>
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[700px]">
          <thead>
            <tr className="text-muted-txt border-b border-line">
              <th className="text-right pb-2 font-medium w-[160px]">שם הנושה / הלוואה</th>
              <th className="text-left pb-2 font-medium px-1 w-[100px]">יתרה לסגירה ₪</th>
              <th className="text-left pb-2 font-medium px-1 w-[75px]">ריבית %</th>
              <th className="text-left pb-2 font-medium px-1 w-[75px]">חודשים</th>
              <th className="text-left pb-2 font-medium px-1 w-[120px]">
                החזר חודשי ₪
                <span className="mr-1 text-[10px] text-gold/70 font-normal">שפיצר ↻</span>
              </th>
              <th className="text-center pb-2 font-medium px-1 w-[90px]">סה"כ לתשלום</th>
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
                  {/* Name */}
                  <td className="py-1.5 pr-0">
                    <input
                      value={row.name}
                      onChange={e => onUpdate(row.id, 'name', e.target.value)}
                      placeholder="שם"
                      className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60"
                    />
                  </td>
                  {/* Remaining balance */}
                  <td className="py-1.5 px-1">
                    <NumInput
                      value={row.remainingBalance}
                      onChange={v => handleFieldChange(row.id, 'remainingBalance', v, row)}
                      placeholder="₪"
                    />
                  </td>
                  {/* Interest rate */}
                  <td className="py-1.5 px-1">
                    <NumInput
                      value={row.interestRate}
                      onChange={v => handleFieldChange(row.id, 'interestRate', v, row)}
                      placeholder="%"
                    />
                  </td>
                  {/* Remaining months */}
                  <td className="py-1.5 px-1">
                    <NumInput
                      value={row.remainingMonths}
                      onChange={v => handleFieldChange(row.id, 'remainingMonths', v, row)}
                      placeholder="חודשים"
                    />
                  </td>
                  {/* Monthly payment — auto or manual */}
                  <td className="py-1.5 px-1">
                    <div className="relative">
                      <NumInput
                        value={row.monthlyPayment}
                        onChange={v => onUpdate(row.id, 'monthlyPayment', v)}
                        placeholder="₪"
                        cls={isAutoCalc ? 'border-gold/40 text-gold' : ''}
                      />
                      {/* Recalc button */}
                      {calcPayment > 0 && !isAutoCalc && (
                        <button
                          onClick={() => onUpdate(row.id, 'monthlyPayment', calcPayment)}
                          title={`חישוב שפיצר: ${fmt(calcPayment)}`}
                          className="absolute left-1 top-1/2 -translate-y-1/2 text-[10px] text-gold/60 hover:text-gold transition-colors"
                        >
                          ↻
                        </button>
                      )}
                    </div>
                  </td>
                  {/* Total */}
                  <td className="py-1.5 px-1 text-center">
                    <span className="text-xs px-2 py-1 rounded-full border border-line text-muted-txt whitespace-nowrap">
                      {total > 0 ? fmt(total) : '—'}
                    </span>
                  </td>
                  {/* Delete */}
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
                <td colSpan={7} className="py-4 text-center text-muted-txt text-xs">אין הלוואות</td>
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
          יתרות: <span className="font-medium text-expense">{fmt(totalBalance)}</span>
          <span className="mx-2">|</span>
          החזר חודשי: <span className="font-medium text-gold">{fmt(totalMonthly)}</span>
        </span>
      </div>
    </div>
  )
}
