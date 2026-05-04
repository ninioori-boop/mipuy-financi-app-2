'use client'

import { useState, useMemo } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts'

// ── helpers ────────────────────────────────────────────────────────────────
function fmt(n: number) {
  if (!isFinite(n) || isNaN(n)) return '—'
  return '₪' + Math.round(n).toLocaleString('he-IL')
}
function fmtX(n: number) {
  if (!isFinite(n) || isNaN(n)) return ''
  return Math.round(n) >= 1000
    ? '₪' + Math.round(n / 1000) + 'K'
    : '₪' + Math.round(n)
}

// Month-by-month simulation (accurate for Israeli fund fees)
// balanceFee  = annual % deducted from balance each month
// depositFee  = one-time % deducted from each new deposit
function buildYearly(
  principal: number,
  monthly: number,
  rate: number,
  balanceFee: number,
  depositFee: number,
  years: number,
): { year: number; balance: number; deposits: number; gain: number }[] {
  const r  = rate        / 100 / 12
  const bf = balanceFee  / 100 / 12
  const df = depositFee  / 100

  let balance      = principal * (1 - df)   // initial deposit after deposit fee
  let totalDeposit = principal

  const rows = []
  for (let y = 1; y <= years; y++) {
    for (let m = 0; m < 12; m++) {
      balance      *= (1 + r - bf)           // grow + deduct monthly balance fee
      balance      += monthly * (1 - df)     // new deposit after deposit fee
      totalDeposit += monthly
    }
    rows.push({ year: y, balance: Math.max(0, balance), deposits: totalDeposit, gain: Math.max(0, balance - totalDeposit) })
  }
  return rows
}

// ── sub-components (module level → stable identity) ────────────────────────
type VT = number | string | readonly (string | number)[] | undefined
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tipFmt = (v: any, name: any): [string, string] =>
  [fmt(Number(v)), String(name)]

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

function NumInput({ label, value, onChange, min = 0, step = 1, note }: {
  label: string; value: number; onChange: (n: number) => void
  min?: number; step?: number; note?: string
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold text-muted-txt">
        {label}{note ? <span className="font-normal ms-1 text-muted-txt/70">{note}</span> : null}
      </label>
      <input
        type="number" value={value} min={min} step={step}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        style={{ direction: 'ltr' }}
        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt focus:outline-none focus:border-gold/60 tabular-nums text-left"
      />
    </div>
  )
}

const TOOLTIP_STYLE = {
  backgroundColor: '#1A1A1A', border: '1px solid #2A2A2A',
  borderRadius: 8, color: '#F0EDEA', fontSize: 12,
}

// ── main component ─────────────────────────────────────────────────────────
type Tab = 'compound' | 'fees'

export default function CompoundPage() {
  const [tab, setTab]             = useState<Tab>('compound')
  const [principal, setPrincipal] = useState(50000)
  const [monthly, setMonthly]     = useState(1000)
  const [rate, setRate]           = useState(7)
  const [years, setYears]         = useState(20)
  const [feeBalance, setFeeBalance] = useState(0.5)   // % מהצבירה
  const [feeDeposit, setFeeDeposit] = useState(1.0)   // % מההפקדה

  // ── 4 scenarios ──
  const tNone  = useMemo(() => buildYearly(principal, monthly, rate, 0,          0,          years), [principal, monthly, rate, years])
  const tBal   = useMemo(() => buildYearly(principal, monthly, rate, feeBalance, 0,          years), [principal, monthly, rate, feeBalance, years])
  const tDep   = useMemo(() => buildYearly(principal, monthly, rate, 0,          feeDeposit, years), [principal, monthly, rate, feeDeposit, years])
  const tBoth  = useMemo(() => buildYearly(principal, monthly, rate, feeBalance, feeDeposit, years), [principal, monthly, rate, feeBalance, feeDeposit, years])

  const finalNone = tNone[years - 1]
  const finalBal  = tBal[years  - 1]
  const finalDep  = tDep[years  - 1]
  const finalBoth = tBoth[years - 1]
  const totalDeposits = principal + monthly * years * 12

  // chart data — compound tab uses tNone; fees tab uses all 4
  const chartCompound = tNone.map((r, i) => ({
    year: `${i + 1}`,
    'יתרה':    Math.round(r.balance),
    'הפקדות':  Math.round(r.deposits),
  }))

  const chartFees = tNone.map((r, i) => ({
    year: `${i + 1}`,
    'ללא דמי ניהול':           Math.round(r.balance),
    'דמי ניהול מהצבירה בלבד': Math.round(tBal[i]?.balance ?? 0),
    'דמי ניהול מההפקדה בלבד': Math.round(tDep[i]?.balance ?? 0),
    'שניהם':                   Math.round(tBoth[i]?.balance ?? 0),
  }))

  return (
    <div className="max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div className="rounded-xl border border-line bg-surface2 p-6">
        <h1 className="text-2xl font-bold text-gold mb-1">📈 מחשבון ריבית דריבית</h1>
        <p className="text-muted-txt text-sm">השפעת ריבית דריבית לאורך זמן, כולל ניתוח השפעת דמי ניהול</p>
      </div>

      {/* Inner tabs */}
      <div className="flex gap-1 rounded-xl border border-line bg-surface2 p-1">
        {([
          { id: 'compound', label: '📈 ריבית דריבית' },
          { id: 'fees',     label: '📉 דמי ניהול' },
        ] as { id: Tab; label: string }[]).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t.id ? 'bg-gold/20 text-gold' : 'text-muted-txt hover:text-txt'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Inputs */}
      <div className="rounded-xl border border-line bg-surface2 p-6 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <NumInput label="סכום התחלתי ₪"  value={principal} onChange={setPrincipal} step={1000} />
          <NumInput label="הפקדה חודשית ₪" value={monthly}   onChange={setMonthly}   step={100} />
          <NumInput label="תשואה שנתית %"  value={rate}      onChange={setRate}      step={0.1} min={0} />
          <NumInput label="תקופה (שנים)"   value={years}     onChange={setYears}     step={1}   min={1} />
        </div>
        {tab === 'fees' && (
          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-line">
            <NumInput label="דמי ניהול מהצבירה % (שנתי)"
              value={feeBalance} onChange={setFeeBalance} step={0.1} min={0}
              note="מנוכה מהיתרה כל חודש" />
            <NumInput label="דמי ניהול מההפקדה %"
              value={feeDeposit} onChange={setFeeDeposit} step={0.1} min={0}
              note="מנוכה מכל הפקדה" />
          </div>
        )}
      </div>

      {/* ── TAB: compound ── */}
      {tab === 'compound' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="rounded-xl border border-gold/30 bg-gold/5 p-4">
              <div className="text-xs text-muted-txt mb-1">סכום סופי</div>
              <div className="text-2xl font-black text-gold">{fmt(finalNone?.balance ?? 0)}</div>
            </div>
            <div className="rounded-xl border border-line bg-surface2 p-4">
              <div className="text-xs text-muted-txt mb-1">סך הפקדות</div>
              <div className="text-2xl font-black text-txt">{fmt(totalDeposits)}</div>
            </div>
            <div className="rounded-xl border border-green-400/20 bg-green-400/5 p-4">
              <div className="text-xs text-muted-txt mb-1">רווח מריבית</div>
              <div className="text-2xl font-black text-green-400">{fmt(finalNone?.gain ?? 0)}</div>
            </div>
            <div className="rounded-xl border border-line bg-surface2 p-4">
              <div className="text-xs text-muted-txt mb-1">הכפלה</div>
              <div className="text-2xl font-black text-txt">
                ×{totalDeposits > 0
                  ? ((finalNone?.balance ?? 0) / totalDeposits).toLocaleString('he-IL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
                  : '—'}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-line bg-surface2 p-5 space-y-4">
            <h2 className="font-semibold text-txt">📊 צמיחה לאורך זמן</h2>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={chartCompound} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="gGold" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#C9A86C" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#C9A86C" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="gGreen" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#4ade80" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#4ade80" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#2A2A2A" vertical={false} />
                <XAxis dataKey="year" tick={{ fill: '#8A8178', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#8A8178', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={fmtX} width={60} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tipFmt} />
                <Legend wrapperStyle={{ color: '#8A8178', fontSize: 12, paddingTop: 8 }} />
                <Area type="monotone" dataKey="יתרה"   stroke="#C9A86C" strokeWidth={2}   fill="url(#gGold)"  dot={false} />
                <Area type="monotone" dataKey="הפקדות" stroke="#4ade80" strokeWidth={1.5} fill="url(#gGreen)" dot={false} strokeDasharray="4 2" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-xl border border-line bg-surface2 overflow-hidden">
            <div className="p-4 border-b border-line"><h2 className="font-semibold text-txt">📋 פירוט שנתי</h2></div>
            <div className="overflow-auto max-h-[50vh]">
              <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
                <thead className="sticky top-0">
                  <tr style={{ backgroundColor: '#1e1e1e' }}>
                    {['שנה', 'יתרה', 'הפקדות בשנה', 'תשואה בשנה', 'סה"כ הפקדות', 'סה"כ תשואה'].map(h => (
                      <th key={h} style={{ padding: '8px 14px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: '#8A8178', border: '1px solid #2A2A2A', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tNone.map((row, i) => {
                    const prev = i === 0 ? { gain: 0 } : tNone[i - 1]
                    return (
                      <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#111' : '#161616' }}>
                        <td style={{ padding: '6px 14px', textAlign: 'right', border: '1px solid #2A2A2A', color: '#8A8178', fontWeight: 600 }}>{i + 1}</td>
                        <td style={{ padding: '6px 14px', textAlign: 'left', direction: 'ltr', border: '1px solid #2A2A2A', color: '#C9A86C', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(row.balance)}</td>
                        <td style={{ padding: '6px 14px', textAlign: 'left', direction: 'ltr', border: '1px solid #2A2A2A', color: '#F0EDEA', fontVariantNumeric: 'tabular-nums' }}>{fmt(monthly * 12)}</td>
                        <td style={{ padding: '6px 14px', textAlign: 'left', direction: 'ltr', border: '1px solid #2A2A2A', color: '#4ade80', fontVariantNumeric: 'tabular-nums' }}>{fmt(row.gain - prev.gain)}</td>
                        <td style={{ padding: '6px 14px', textAlign: 'left', direction: 'ltr', border: '1px solid #2A2A2A', color: '#F0EDEA', fontVariantNumeric: 'tabular-nums' }}>{fmt(row.deposits)}</td>
                        <td style={{ padding: '6px 14px', textAlign: 'left', direction: 'ltr', border: '1px solid #2A2A2A', color: '#4ade80', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(row.gain)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── TAB: fees ── */}
      {tab === 'fees' && (
        <>
          {/* 4 KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'ללא דמי ניהול',              val: finalNone?.balance, color: 'text-gold',       border: 'border-gold/30       bg-gold/5' },
              { label: `מהצבירה ${feeBalance}% בלבד`, val: finalBal?.balance,  color: 'text-yellow-400', border: 'border-yellow-400/20  bg-yellow-400/5' },
              { label: `מההפקדה ${feeDeposit}% בלבד`, val: finalDep?.balance,  color: 'text-orange-400', border: 'border-orange-400/20  bg-orange-400/5' },
              { label: 'שני סוגי דמי ניהול',          val: finalBoth?.balance, color: 'text-expense',    border: 'border-expense/20    bg-expense/5' },
            ].map(({ label, val, color, border }) => (
              <div key={label} className={`rounded-xl border p-4 ${border}`}>
                <div className="text-xs text-muted-txt mb-1">{label}</div>
                <div className={`text-xl font-black ${color}`}>{fmt(val ?? 0)}</div>
                {(finalNone?.balance ?? 0) > 0 && val !== undefined && val < (finalNone?.balance ?? 0) && (
                  <div className="text-xs text-expense mt-0.5">הפסד: {fmt((finalNone?.balance ?? 0) - val)}</div>
                )}
              </div>
            ))}
          </div>

          {/* 4-line comparison chart */}
          <div className="rounded-xl border border-line bg-surface2 p-5 space-y-4">
            <h2 className="font-semibold text-txt">📊 השוואת 4 תרחישים</h2>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={chartFees} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                <defs>
                  {[['gF1','#C9A86C'], ['gF2','#facc15'], ['gF3','#fb923c'], ['gF4','#f87171']].map(([id, c]) => (
                    <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={c} stopOpacity={0.2} />
                      <stop offset="95%" stopColor={c} stopOpacity={0.01} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#2A2A2A" vertical={false} />
                <XAxis dataKey="year" tick={{ fill: '#8A8178', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#8A8178', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={fmtX} width={60} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tipFmt} />
                <Legend wrapperStyle={{ color: '#8A8178', fontSize: 12, paddingTop: 8 }} />
                <Area type="monotone" dataKey="ללא דמי ניהול"           stroke="#C9A86C" strokeWidth={2}   fill="url(#gF1)" dot={false} />
                <Area type="monotone" dataKey="דמי ניהול מהצבירה בלבד" stroke="#facc15" strokeWidth={1.5} fill="url(#gF2)" dot={false} />
                <Area type="monotone" dataKey="דמי ניהול מההפקדה בלבד" stroke="#fb923c" strokeWidth={1.5} fill="url(#gF3)" dot={false} />
                <Area type="monotone" dataKey="שניהם"                   stroke="#f87171" strokeWidth={2}   fill="url(#gF4)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Comparison table */}
          <div className="rounded-xl border border-line bg-surface2 overflow-hidden">
            <div className="p-4 border-b border-line"><h2 className="font-semibold text-txt">📋 השוואה שנתית</h2></div>
            <div className="overflow-auto max-h-[50vh]">
              <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
                <thead className="sticky top-0">
                  <tr style={{ backgroundColor: '#1e1e1e' }}>
                    {['שנה', 'ללא דמי ניהול', 'מהצבירה בלבד', 'מההפקדה בלבד', 'שניהם', 'הפסד מצטבר'].map(h => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: '#8A8178', border: '1px solid #2A2A2A', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tNone.map((rN, i) => {
                    const rB = tBal[i],  rD = tDep[i],  rBo = tBoth[i]
                    const loss = rN.balance - (rBo?.balance ?? 0)
                    return (
                      <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#111' : '#161616' }}>
                        <td style={{ padding: '6px 12px', textAlign: 'right', border: '1px solid #2A2A2A', color: '#8A8178', fontWeight: 600 }}>{i + 1}</td>
                        <td style={{ padding: '6px 12px', textAlign: 'left', direction: 'ltr', border: '1px solid #2A2A2A', color: '#C9A86C', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(rN.balance)}</td>
                        <td style={{ padding: '6px 12px', textAlign: 'left', direction: 'ltr', border: '1px solid #2A2A2A', color: '#facc15', fontVariantNumeric: 'tabular-nums' }}>{fmt(rB?.balance ?? 0)}</td>
                        <td style={{ padding: '6px 12px', textAlign: 'left', direction: 'ltr', border: '1px solid #2A2A2A', color: '#fb923c', fontVariantNumeric: 'tabular-nums' }}>{fmt(rD?.balance ?? 0)}</td>
                        <td style={{ padding: '6px 12px', textAlign: 'left', direction: 'ltr', border: '1px solid #2A2A2A', color: '#f87171', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(rBo?.balance ?? 0)}</td>
                        <td style={{ padding: '6px 12px', textAlign: 'left', direction: 'ltr', border: '1px solid #2A2A2A', color: '#f87171', fontVariantNumeric: 'tabular-nums' }}>{fmt(loss)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

    </div>
  )
}
