'use client'

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, AreaChart, Area, ReferenceLine,
} from 'recharts'
import { useMonthlyStore } from '@/stores/monthlyStore'
import { MONTHS_LIST } from '@/lib/constants'

const SHORT = ['ינו','פבר','מרץ','אפר','מאי','יוני','יולי','אוג','ספט','אוק','נוב','דצמ']

function fmt(n: number) {
  return '₪' + Math.round(Math.abs(n)).toLocaleString('he-IL')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fmtTip = (v: any, name: any) => [fmt(Number(v)), String(name)] as [string, string]
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fmtTipCash = (v: any, name: any) => [`${Number(v) >= 0 ? '+' : '−'}${fmt(Number(v))}`, String(name)] as [string, string]

const TOOLTIP_STYLE = {
  backgroundColor: '#1A1A1A',
  border: '1px solid #2A2A2A',
  borderRadius: 8,
  color: '#F0EDEA',
  fontSize: 12,
  direction: 'rtl' as const,
}

export default function TrendsPage() {
  const { months } = useMonthlyStore()

  const allRows = MONTHS_LIST.map((m, i) => {
    const d = months[m.id]

    const bIncome = d ? d.income.reduce((s, r) => s + r.plan,   0) : 0
    const aIncome = d ? d.income.reduce((s, r) => s + r.actual, 0) : 0
    const bFixed  = d ? d.fixed.reduce((s, r) => s + r.plan,    0) : 0
    const aFixed  = d ? d.fixed.reduce((s, r) => s + r.actual,  0) : 0
    const bVar    = d ? d.variable.reduce((s, r) => s + r.plan,   0) : 0
    const aVar    = d ? d.variable.reduce((s, r) => s + r.actual, 0) : 0
    const bSub    = d ? d.sub.reduce((s, r) => s + r.plan,    0) : 0
    const aSub    = d ? d.sub.reduce((s, r) => s + r.actual,  0) : 0
    const bIns    = d ? d.ins.reduce((s, r) => s + r.plan,    0) : 0
    const aIns    = d ? d.ins.reduce((s, r) => s + r.actual,  0) : 0
    const tInst   = d ? d.installments.reduce((s, r) => s + r.monthly, 0) : 0
    const tDebt   = d ? d.debts.reduce((s, r) => s + r.monthly, 0) : 0
    const tSav    = d ? d.savings.reduce((s, r) => s + r.monthly, 0) : 0

    const bExp = bFixed + bVar + bSub + bIns + tInst + tDebt
    const aExp = aFixed + aVar + aSub + aIns + tInst + tDebt

    const hasActual = aIncome > 0
    const effectiveIncome = hasActual ? aIncome : bIncome
    const effectiveExp    = hasActual ? aExp    : bExp

    return {
      month:   SHORT[i],
      monthId: m.id,
      hasData: bIncome > 0 || aIncome > 0,
      hasActual,
      bIncome, aIncome,
      bExp,    aExp,
      aFixed, aVar, aSub, aIns,
      tSav,
      cashflow: effectiveIncome - effectiveExp - tSav,
    }
  })

  const rows = allRows.filter(r => r.hasData)

  // ── KPIs ──
  const activeMonths = rows.filter(r => r.hasActual).length
  const ytdIncome   = rows.reduce((s, r) => s + (r.aIncome || r.bIncome), 0)
  const ytdExpenses = rows.reduce((s, r) => s + (r.aExp    || r.bExp),    0)
  const ytdSavings  = rows.reduce((s, r) => s + r.tSav, 0)
  const avgCashflow = rows.length > 0
    ? Math.round(rows.reduce((s, r) => s + r.cashflow, 0) / rows.length)
    : 0
  const savingsRate = ytdIncome > 0 ? Math.round((ytdSavings / ytdIncome) * 100) : 0

  // ── Chart data ──
  const incomeExpData = rows.map(r => ({
    month:   r.month,
    הכנסות: r.aIncome || r.bIncome,
    הוצאות: r.aExp    || r.bExp,
  }))

  const stackData = rows.map(r => ({
    month:    r.month,
    קבוע:    r.aFixed,
    משתנה:   r.aVar,
    מנויים:  r.aSub,
    ביטוחים: r.aIns,
  }))

  const cashflowData = rows.map(r => ({
    month:  r.month,
    תזרים: r.cashflow,
  }))

  let cumSav = 0
  const savingsData = rows.map(r => {
    cumSav += r.tSav
    return { month: r.month, חיסכון: cumSav }
  })

  const tickFmt = (v: number) => `₪${Math.round(v / 1000)}K`

  if (rows.length === 0) {
    return (
      <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6">
        <div className="rounded-xl border border-line bg-surface2 p-4 sm:p-6">
          <h1 className="text-xl sm:text-2xl font-bold text-gold mb-1">📊 מגמות</h1>
          <p className="hidden sm:block text-muted-txt text-sm">ניתוח שנתי על בסיס נתוני התקציב החודשי</p>
        </div>
        <div className="rounded-xl border border-line bg-surface2 p-8 sm:p-14 text-center">
          <div className="text-4xl sm:text-5xl mb-4">📊</div>
          <p className="font-semibold text-txt">אין נתונים עדיין</p>
          <p className="text-sm text-muted-txt mt-1">הזן נתונים בטאב התקציב החודשי כדי לראות מגמות</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6">

      {/* Header */}
      <div className="rounded-xl border border-line bg-surface2 p-4 sm:p-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gold mb-1">📊 מגמות</h1>
        <p className="hidden sm:block text-muted-txt text-sm">
          ניתוח שנתי על בסיס {rows.length} חודשים
          {activeMonths > 0 && ` · ${activeMonths} עם ביצוע בפועל`}
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <div className="rounded-xl border border-line bg-surface2 p-4">
          <div className="text-xs text-muted-txt font-medium mb-1">סך הכנסות YTD</div>
          <div className="text-xl font-black text-green-400 tabular-nums">{fmt(ytdIncome)}</div>
        </div>
        <div className="rounded-xl border border-line bg-surface2 p-4">
          <div className="text-xs text-muted-txt font-medium mb-1">סך הוצאות YTD</div>
          <div className="text-xl font-black text-expense tabular-nums">{fmt(ytdExpenses)}</div>
        </div>
        <div className="rounded-xl border border-line bg-surface2 p-4">
          <div className="text-xs text-muted-txt font-medium mb-1">ממוצע תזרים חודשי</div>
          <div className={`text-xl font-black tabular-nums ${avgCashflow >= 0 ? 'text-green-400' : 'text-expense'}`}>
            {avgCashflow >= 0 ? '+' : '−'}{fmt(avgCashflow)}
          </div>
        </div>
        <div className="rounded-xl border border-line bg-surface2 p-4">
          <div className="text-xs text-muted-txt font-medium mb-1">שיעור חיסכון</div>
          <div className="text-xl font-black text-gold tabular-nums">{savingsRate}%</div>
        </div>
      </div>

      {/* Chart 1 — Income vs Expenses */}
      <div className="rounded-xl border border-line bg-surface2 p-4 sm:p-5 space-y-3 sm:space-y-4">
        <h2 className="font-semibold text-txt">💰 הכנסות מול הוצאות</h2>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={incomeExpData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2A2A2A" vertical={false} />
            <XAxis dataKey="month" tick={{ fill: '#8A8178', fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#8A8178', fontSize: 10 }} axisLine={false} tickLine={false}
              tickFormatter={tickFmt} width={44} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={fmtTip} />
            <Legend iconSize={8} wrapperStyle={{ color: '#8A8178', fontSize: 11, paddingTop: 8 }} />
            <Bar dataKey="הכנסות" fill="#4ade80" radius={[4, 4, 0, 0]} maxBarSize={44} />
            <Bar dataKey="הוצאות" fill="#f87171" radius={[4, 4, 0, 0]} maxBarSize={44} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Chart 2 — Expense breakdown stacked */}
      <div className="rounded-xl border border-line bg-surface2 p-4 sm:p-5 space-y-3 sm:space-y-4">
        <h2 className="font-semibold text-txt">📋 פירוט הוצאות לפי קטגוריה</h2>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={stackData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2A2A2A" vertical={false} />
            <XAxis dataKey="month" tick={{ fill: '#8A8178', fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#8A8178', fontSize: 10 }} axisLine={false} tickLine={false}
              tickFormatter={tickFmt} width={44} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={fmtTip} />
            <Legend iconSize={8} wrapperStyle={{ color: '#8A8178', fontSize: 11, paddingTop: 8 }} />
            <Bar dataKey="קבוע"    fill="#6366f1" stackId="a" maxBarSize={44} />
            <Bar dataKey="משתנה"  fill="#a78bfa" stackId="a" maxBarSize={44} />
            <Bar dataKey="מנויים" fill="#22d3ee" stackId="a" maxBarSize={44} />
            <Bar dataKey="ביטוחים" fill="#fb923c" stackId="a" radius={[4, 4, 0, 0]} maxBarSize={44} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Chart 3 — Monthly cashflow area */}
      <div className="rounded-xl border border-line bg-surface2 p-4 sm:p-5 space-y-3 sm:space-y-4">
        <h2 className="font-semibold text-txt">📈 תזרים חודשי</h2>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={cashflowData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id="cfGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#C9A86C" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#C9A86C" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#2A2A2A" vertical={false} />
            <XAxis dataKey="month" tick={{ fill: '#8A8178', fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#8A8178', fontSize: 10 }} axisLine={false} tickLine={false}
              tickFormatter={tickFmt} width={44} />
            <ReferenceLine y={0} stroke="#3A3A3A" strokeWidth={1.5} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={fmtTipCash} />
            <Area type="monotone" dataKey="תזרים" stroke="#C9A86C" strokeWidth={2}
              fill="url(#cfGrad)" dot={{ fill: '#C9A86C', r: 4, strokeWidth: 0 }}
              activeDot={{ r: 8, strokeWidth: 0 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Chart 4 — Cumulative savings (only if savings exist) */}
      {ytdSavings > 0 && (
        <div className="rounded-xl border border-line bg-surface2 p-4 sm:p-5 space-y-3 sm:space-y-4">
          <h2 className="font-semibold text-txt">🏦 חיסכון מצטבר</h2>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={savingsData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="savGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#4ade80" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#4ade80" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#2A2A2A" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: '#8A8178', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#8A8178', fontSize: 10 }} axisLine={false} tickLine={false}
                tickFormatter={tickFmt} width={44} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={fmtTip} />
              <Area type="monotone" dataKey="חיסכון" stroke="#4ade80" strokeWidth={2}
                fill="url(#savGrad)" dot={{ fill: '#4ade80', r: 4, strokeWidth: 0 }}
                activeDot={{ r: 8, strokeWidth: 0 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

    </div>
  )
}
