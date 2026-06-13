'use client'

import { useState, useMemo } from 'react'

// ── types ──────────────────────────────────────────────────────────────────
type CalcMode    = 'byAmount'  | 'byPayment'
type RepayMethod = 'spitzer'   | 'equalPrincipal'
type IndexMode   = 'none'      | 'indexed'

interface MonthRow {
  month:     number
  payment:   number
  principal: number
  interest:  number
  balance:   number
}

// ── helpers ────────────────────────────────────────────────────────────────
function fmt(n: number, decimals = 0) {
  if (!isFinite(n) || isNaN(n)) return '—'
  return '₪' + n.toLocaleString('he-IL', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}
function fmtPct(n: number) {
  return n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%'
}

function calcSpitzer(P: number, r: number, n: number): number {
  if (n <= 0) return 0
  if (r === 0) return P / n
  return (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1)
}

function buildTable(
  P: number, annualRate: number, months: number,
  method: RepayMethod, annualIndex: number,
): MonthRow[] {
  if (P <= 0 || months <= 0) return []
  const r  = annualRate / 100 / 12
  const ri = annualIndex / 100 / 12
  const rows: MonthRow[] = []
  let balance = P

  for (let m = 1; m <= months; m++) {
    // apply index
    if (ri > 0) balance *= (1 + ri)

    let payment: number, principal: number, interest: number

    if (method === 'spitzer') {
      const remaining = months - m + 1
      const M = calcSpitzer(balance, r, remaining)
      interest  = balance * r
      principal = M - interest
      payment   = M
    } else {
      // קרן שווה
      principal = balance / (months - m + 1)
      interest  = balance * r
      payment   = principal + interest
    }

    balance -= principal
    rows.push({
      month:     m,
      payment:   Math.max(0, payment),
      principal: Math.max(0, principal),
      interest:  Math.max(0, interest),
      balance:   Math.max(0, balance),
    })
  }
  return rows
}

// ── shared sub-components (module-level → stable identity → no focus loss) ──

function Toggle({ options, value, onChange }: {
  options: { id: string; label: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex rounded-lg border border-line overflow-hidden text-sm">
      {options.map(o => (
        <button key={o.id} onClick={() => onChange(o.id)}
          className={`flex-1 px-3 py-1.5 font-medium transition-colors ${
            value === o.id ? 'bg-gold/20 text-gold' : 'bg-surface text-muted-txt hover:text-txt'
          }`}>{o.label}</button>
      ))}
    </div>
  )
}

function NumInput({ label, value, onChange, min = 0, step = 1, suffix }: {
  label: string; value: number; onChange: (n: number) => void
  min?: number; step?: number; suffix?: string
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold text-muted-txt">{label}{suffix ? ` (${suffix})` : ''}</label>
      <input
        type="number" value={value} min={min} step={step}
        onChange={e => onChange(Math.max(min, parseFloat(e.target.value) || 0))}
        style={{ direction: 'ltr' }}
        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt focus:outline-none focus:border-gold/60 tabular-nums text-left"
      />
    </div>
  )
}

// ── component ──────────────────────────────────────────────────────────────
export default function LoansPage() {
  const [calcMode,   setCalcMode]   = useState<CalcMode>('byAmount')
  const [method,     setMethod]     = useState<RepayMethod>('spitzer')
  const [indexMode,  setIndexMode]  = useState<IndexMode>('none')

  const [amount,     setAmount]     = useState(200000)
  const [payment,    setPayment]    = useState(3000)
  const [rate,       setRate]       = useState(4.5)
  const [months,     setMonths]     = useState(120)
  const [indexRate,  setIndexRate]  = useState(2)

  // ── derived values ──
  const r  = rate / 100 / 12
  const ri = indexMode === 'indexed' ? indexRate / 100 / 12 : 0

  const principal = useMemo(() => {
    if (calcMode === 'byAmount') return amount
    if (r === 0) return payment * months
    return payment * (Math.pow(1 + r, months) - 1) / (r * Math.pow(1 + r, months))
  }, [calcMode, amount, payment, r, months])

  const monthlyPayment = useMemo(() => {
    if (calcMode === 'byPayment') return payment
    return calcSpitzer(principal, r, months)
  }, [calcMode, payment, principal, r, months])

  const table = useMemo(() =>
    buildTable(principal, rate, months, method, indexMode === 'indexed' ? indexRate : 0),
    [principal, rate, months, method, indexMode, indexRate]
  )

  const totalPayment = table.reduce((s, r) => s + r.payment, 0)
  const totalInterest = totalPayment - principal
  const interestPct = principal > 0 ? (totalInterest / principal) * 100 : 0
  const firstPayment = table[0]?.payment ?? 0
  const lastPayment  = table[table.length - 1]?.payment ?? 0

  // Toggle and NumInput are defined at module level (below) to prevent remount on every keystroke

  return (
    <div className="max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div className="rounded-xl border border-line bg-surface2 p-6">
        <h1 className="text-2xl font-bold text-gold mb-1">💰 מחשבון הלוואות</h1>
        <p className="text-muted-txt text-sm">חישוב תשלום חודשי, לוח סילוקין ועלות ריבית כוללת</p>
      </div>

      {/* Inputs */}
      <div className="rounded-xl border border-line bg-surface2 p-6 space-y-5">

        {/* Toggle row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1">
            <div className="text-xs font-semibold text-muted-txt">חשב לפי</div>
            <Toggle
              options={[{ id: 'byAmount', label: 'סכום הלוואה' }, { id: 'byPayment', label: 'החזר חודשי' }]}
              value={calcMode} onChange={v => setCalcMode(v as CalcMode)}
            />
          </div>
          <div className="space-y-1">
            <div className="text-xs font-semibold text-muted-txt">שיטת החזר</div>
            <Toggle
              options={[{ id: 'spitzer', label: 'שפיצר' }, { id: 'equalPrincipal', label: 'קרן שווה' }]}
              value={method} onChange={v => setMethod(v as RepayMethod)}
            />
          </div>
          <div className="space-y-1">
            <div className="text-xs font-semibold text-muted-txt">הצמדה למדד</div>
            <Toggle
              options={[{ id: 'none', label: 'ללא הצמדה' }, { id: 'indexed', label: 'עם הצמדה' }]}
              value={indexMode} onChange={v => setIndexMode(v as IndexMode)}
            />
          </div>
        </div>

        {/* Number inputs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {calcMode === 'byAmount'
            ? <NumInput label="סכום ההלוואה ₪"     value={amount}   onChange={setAmount}   min={0}    step={1000} />
            : <NumInput label="החזר חודשי רצוי ₪"  value={payment}  onChange={setPayment}  min={100}  step={100}  />
          }
          <NumInput label="ריבית שנתית %"         value={rate}     onChange={setRate}     min={0}    step={0.1}  suffix="%" />
          <NumInput label="תקופה (חודשים)"         value={months}   onChange={setMonths}   min={1}    step={1}    />
          {indexMode === 'indexed' &&
            <NumInput label="מדד שנתי %"           value={indexRate} onChange={setIndexRate} min={0} step={0.1} suffix="%" />
          }
        </div>
      </div>

      {/* Results KPIs */}
      {table.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {method === 'spitzer' && indexMode !== 'indexed' ? (
            <div className="rounded-xl border border-gold/30 bg-gold/5 p-4">
              <div className="text-xs text-muted-txt mb-1">תשלום חודשי</div>
              <div className="text-2xl font-black text-gold">{fmt(firstPayment, 2)}</div>
              <div className="text-xs text-muted-txt mt-0.5">קבוע לאורך כל התקופה</div>
            </div>
          ) : method === 'spitzer' ? (
            <div className="rounded-xl border border-gold/30 bg-gold/5 p-4">
              <div className="text-xs text-muted-txt mb-1">תשלום ראשון / אחרון</div>
              <div className="text-xl font-black text-gold">{fmt(firstPayment, 2)}</div>
              <div className="text-xs text-muted-txt mt-0.5">↑ עולה עד {fmt(lastPayment, 2)} (צמוד מדד)</div>
            </div>
          ) : (
            <div className="rounded-xl border border-gold/30 bg-gold/5 p-4">
              <div className="text-xs text-muted-txt mb-1">תשלום ראשון / אחרון</div>
              <div className="text-xl font-black text-gold">{fmt(firstPayment, 2)}</div>
              <div className="text-xs text-muted-txt mt-0.5">↓ יורד עד {fmt(lastPayment, 2)}</div>
            </div>
          )}
          <div className="rounded-xl border border-line bg-surface2 p-4">
            <div className="text-xs text-muted-txt mb-1">
              {calcMode === 'byPayment' ? 'סכום ההלוואה' : 'סך תשלומים'}
            </div>
            <div className="text-2xl font-black text-txt">
              {fmt(calcMode === 'byPayment' ? principal : totalPayment)}
            </div>
          </div>
          <div className="rounded-xl border border-expense/20 bg-expense/5 p-4">
            <div className="text-xs text-muted-txt mb-1">סך ריבית</div>
            <div className="text-2xl font-black text-expense">{fmt(totalInterest)}</div>
            <div className="text-xs text-muted-txt mt-0.5">{fmtPct(interestPct)} מהקרן</div>
          </div>
          <div className="rounded-xl border border-line bg-surface2 p-4">
            <div className="text-xs text-muted-txt mb-1">תקופה</div>
            <div className="text-2xl font-black text-txt">{months}</div>
            <div className="text-xs text-muted-txt mt-0.5">
              חודשים ({Math.floor(months / 12)} שנים{months % 12 > 0 ? ` ו-${months % 12} חודשים` : ''})
            </div>
          </div>
        </div>
      )}

      {/* Amortization table */}
      {table.length > 0 && (
        <div className="rounded-xl border border-line bg-surface2 overflow-hidden">
          <div className="p-4 border-b border-line flex items-center justify-between">
            <h2 className="font-semibold text-txt">📋 לוח סילוקין</h2>
            <span className="text-xs text-muted-txt">{table.length} תשלומים</span>
          </div>

          <div className="overflow-auto max-h-[55vh]">
            <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
              <thead className="sticky top-0 z-10">
                <tr style={{ backgroundColor: '#1e1e1e' }}>
                  {['חודש', 'תשלום חודשי', 'קרן', 'ריבית', 'יתרה'].map(h => (
                    <th key={h} style={{
                      padding: '9px 14px', textAlign: 'right', fontSize: 11,
                      fontWeight: 600, color: '#8A8178', whiteSpace: 'nowrap',
                      border: '1px solid #2A2A2A',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.map((row, i) => (
                  <tr key={row.month} style={{ backgroundColor: i % 2 === 0 ? '#111' : '#161616' }}>
                    <td style={{ padding: '6px 14px', textAlign: 'right', border: '1px solid #2A2A2A', color: '#8A8178', fontWeight: 600 }}>
                      {row.month}
                    </td>
                    <td style={{ padding: '6px 14px', textAlign: 'left', direction: 'ltr', border: '1px solid #2A2A2A', color: '#C9A86C', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                      {fmt(row.payment, 2)}
                    </td>
                    <td style={{ padding: '6px 14px', textAlign: 'left', direction: 'ltr', border: '1px solid #2A2A2A', color: '#4ade80', fontVariantNumeric: 'tabular-nums' }}>
                      {fmt(row.principal, 2)}
                    </td>
                    <td style={{ padding: '6px 14px', textAlign: 'left', direction: 'ltr', border: '1px solid #2A2A2A', color: '#f87171', fontVariantNumeric: 'tabular-nums' }}>
                      {fmt(row.interest, 2)}
                    </td>
                    <td style={{ padding: '6px 14px', textAlign: 'left', direction: 'ltr', border: '1px solid #2A2A2A', color: '#F0EDEA', fontVariantNumeric: 'tabular-nums' }}>
                      {fmt(row.balance, 2)}
                    </td>
                  </tr>
                ))}
                {/* Totals row */}
                <tr style={{ backgroundColor: '#1e1e1e', position: 'sticky', bottom: 0 }}>
                  <td style={{ padding: '8px 14px', textAlign: 'right', border: '1px solid #2A2A2A', color: '#F0EDEA', fontWeight: 700 }}>סך הכל</td>
                  <td style={{ padding: '8px 14px', textAlign: 'left', direction: 'ltr', border: '1px solid #2A2A2A', color: '#C9A86C', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(totalPayment, 2)}
                  </td>
                  <td style={{ padding: '8px 14px', textAlign: 'left', direction: 'ltr', border: '1px solid #2A2A2A', color: '#4ade80', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(principal, 2)}
                  </td>
                  <td style={{ padding: '8px 14px', textAlign: 'left', direction: 'ltr', border: '1px solid #2A2A2A', color: '#f87171', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(totalInterest, 2)}
                  </td>
                  <td style={{ padding: '8px 14px', border: '1px solid #2A2A2A' }} />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  )
}
