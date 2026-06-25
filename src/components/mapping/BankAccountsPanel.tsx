'use client'

import type { BankAccountRow } from '@/stores/mappingStore'

const fmt = (n: number) =>
  '₪' + Math.round(Math.abs(n)).toLocaleString('he-IL')

// Signed format for the balance only — negative means the client is in
// overdraft, which we want to flag visually.
const fmtSigned = (n: number) => (n < 0 ? '-' : '') + fmt(n)

interface Props {
  accounts: BankAccountRow[]
  onAdd:    () => void
  onUpdate: (id: string, field: keyof Omit<BankAccountRow, 'id'>, value: string | number) => void
  onDelete: (id: string) => void
}

// Balance input allows negative (overdraft); overdraftLimit is non-negative.
function NumInput({ value, onChange, placeholder, allowNegative = false }: {
  value: number
  onChange: (v: number) => void
  placeholder: string
  allowNegative?: boolean
}) {
  return (
    <input
      type="number"
      value={value === 0 ? '' : value}
      min={allowNegative ? undefined : 0}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      placeholder={placeholder}
      style={{ direction: 'ltr' }}
      className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left tabular-nums"
    />
  )
}

export function BankAccountsPanel({ accounts, onAdd, onUpdate, onDelete }: Props) {
  const totalBalance = accounts.reduce((s, r) => s + r.balance, 0)
  const balanceColor = totalBalance < 0 ? 'text-expense' : totalBalance > 0 ? 'text-income' : 'text-muted-txt'

  return (
    <div className="rounded-xl border border-line bg-surface2 p-3 sm:p-5 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-1">
        <h2 className="font-semibold text-txt">🏛️ מצב עו&quot;ש</h2>
        <span className="text-xs text-muted-txt">
          סך יתרה: <span className={`font-bold ${balanceColor}`}>{fmtSigned(totalBalance)}</span>
        </span>
      </div>

      {/* Desktop column headers */}
      <div className="hidden sm:grid grid-cols-[1fr_8rem_8rem_1.5rem] gap-2 px-1 text-xs text-muted-txt font-medium">
        <span>שם החשבון</span>
        <span className="text-start">יתרה נוכחית ₪</span>
        <span className="text-start">מסגרת אוברדראפט ₪</span>
        <span />
      </div>

      <div className="space-y-2">
        {accounts.map(row => {
          const rowColor = row.balance < 0 ? 'text-expense' : 'text-income'
          return (
            <div key={row.id} className="group">
              {/* Desktop */}
              <div className="hidden sm:grid grid-cols-[1fr_8rem_8rem_1.5rem] gap-2 items-center">
                <input
                  value={row.name}
                  onChange={e => onUpdate(row.id, 'name', e.target.value)}
                  placeholder="למשל: עו&quot;ש לאומי"
                  className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60"
                />
                <NumInput value={row.balance}        onChange={v => onUpdate(row.id, 'balance', v)}        placeholder="₪" allowNegative />
                <NumInput value={row.overdraftLimit} onChange={v => onUpdate(row.id, 'overdraftLimit', v)} placeholder="₪" />
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
                    placeholder="שם החשבון"
                    className="flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60"
                  />
                  <button onClick={() => onDelete(row.id)} className="shrink-0 text-muted-txt hover:text-expense text-sm">×</button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-0.5">
                    <div className="text-[10px] text-muted-txt px-1">יתרה נוכחית ₪</div>
                    <NumInput value={row.balance} onChange={v => onUpdate(row.id, 'balance', v)} placeholder="₪" allowNegative />
                  </div>
                  <div className="space-y-0.5">
                    <div className="text-[10px] text-muted-txt px-1">מסגרת אוברדראפט ₪</div>
                    <NumInput value={row.overdraftLimit} onChange={v => onUpdate(row.id, 'overdraftLimit', v)} placeholder="₪" />
                  </div>
                </div>
                {row.balance !== 0 && (
                  <div className={`text-[11px] text-end ${rowColor}`}>
                    יתרה: {fmtSigned(row.balance)}
                  </div>
                )}
              </div>
            </div>
          )
        })}
        {accounts.length === 0 && (
          <p className="text-xs text-muted-txt py-2">אין חשבונות עדיין</p>
        )}
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-line">
        <button onClick={onAdd} className="text-xs text-muted-txt hover:text-gold transition-colors">
          + הוסף חשבון
        </button>
        <span className="text-xs text-muted-txt">
          סך יתרה: <span className={`font-medium ${balanceColor}`}>{fmtSigned(totalBalance)}</span>
        </span>
      </div>
    </div>
  )
}
