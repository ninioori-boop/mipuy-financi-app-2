'use client'

import { useState } from 'react'
import { useAnnualStore, type AnnualSection } from '@/stores/annualStore'
import { useMonthlyStore } from '@/stores/monthlyStore'
import { MONTHS_LIST } from '@/lib/constants'

const MONTH_IDS = MONTHS_LIST.map(m => m.id)
const MONTH_SHORT = ['ינו','פבר','מרץ','אפר','מאי','יוני','יול','אוג','ספט','אוק','נוב','דצמ']

function fmt(n: number) {
  return '₪' + Math.round(n || 0).toLocaleString('he-IL')
}

type ViewMode = 'plan' | 'actual' | 'both'

export default function AnnualPage() {
  const store = useAnnualStore()
  const { months } = useMonthlyStore()
  const [view, setView] = useState<ViewMode>('plan')

  // ── Per-month actuals from monthly store ──
  const moActuals = MONTH_IDS.map(mid => {
    const d = months[mid]
    if (!d) return { income: 0, fixed: 0, variable: 0, sub: 0, debt: 0, savings: 0, hasData: false }
    const income   = d.income.reduce((s, r) => s + r.actual, 0)
    const fixed    = d.fixed.reduce((s, r) => s + r.actual, 0)
    const variable = d.variable.reduce((s, r) => s + r.actual, 0)
    const sub      = d.sub.reduce((s, r) => s + r.actual, 0) + d.ins.reduce((s, r) => s + r.actual, 0)
    const debt     = d.debts.reduce((s, r) => s + r.monthly, 0) + d.installments.reduce((s, r) => s + r.monthly, 0)
    const savings  = d.savings.reduce((s, r) => s + r.monthly, 0)
    return { income, fixed, variable, sub, debt, savings, hasData: income > 0 || fixed > 0 || variable > 0 }
  })

  // ── Annual plan totals ──
  const pIncome   = store.income.reduce((s, r) => s + r.annual, 0)
  const pFixed    = store.fixed.reduce((s, r) => s + r.annual, 0)
  const pVariable = store.variable.reduce((s, r) => s + r.annual, 0)
  const pSub      = store.sub.reduce((s, r) => s + r.annual, 0)
  const pDebt     = store.debt.reduce((s, r) => s + r.annual, 0)
  const pSavings  = store.savings.reduce((s, r) => s + r.annual, 0)
  const pExp      = pFixed + pVariable + pSub + pDebt + pSavings
  const pCF       = pIncome - pExp

  // ── YTD actuals ──
  const aIncome   = moActuals.reduce((s, m) => s + m.income, 0)
  const aFixed    = moActuals.reduce((s, m) => s + m.fixed, 0)
  const aVariable = moActuals.reduce((s, m) => s + m.variable, 0)
  const aSub      = moActuals.reduce((s, m) => s + m.sub, 0)
  const aDebt     = moActuals.reduce((s, m) => s + m.debt, 0)
  const aSavings  = moActuals.reduce((s, m) => s + m.savings, 0)
  const aExp      = aFixed + aVariable + aSub + aDebt + aSavings
  const aCF       = aIncome - aExp
  const activeMonths = moActuals.filter(m => m.hasData).length

  // ── Inline plan section renderer ──
  function PlanSection({ section, title, icon, isIncome = false }: {
    section: AnnualSection; title: string; icon: string; isIncome?: boolean
  }) {
    const rows = store[section]
    const total = rows.reduce((s, r) => s + r.annual, 0)
    return (
      <div className="rounded-xl border border-line bg-surface2 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-txt">{icon} {title}</h2>
          <span className={`text-sm font-bold ${isIncome ? 'text-green-400' : 'text-gold'}`}>
            {fmt(total)}<span className="text-xs font-normal text-muted-txt">/שנה</span>
          </span>
        </div>
        <div className="grid grid-cols-[1fr_7rem_6rem_1.5rem] gap-2 px-1 text-xs text-muted-txt font-medium">
          <span>פריט</span>
          <span className="text-left">שנתי ₪</span>
          <span className="text-center">÷12/חודש</span>
          <span />
        </div>
        <div className="space-y-1">
          {rows.map(row => (
            <div key={row.id} className="grid grid-cols-[1fr_7rem_6rem_1.5rem] gap-2 items-center group">
              <input
                value={row.name}
                onChange={e => store.updateRow(section, row.id, 'name', e.target.value)}
                placeholder="פריט"
                className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60"
              />
              <input
                type="number" value={row.annual || ''}
                onChange={e => store.updateRow(section, row.id, 'annual', parseFloat(e.target.value) || 0)}
                placeholder="₪" min={0} style={{ direction: 'ltr' }}
                className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left tabular-nums"
              />
              <span className="text-xs text-center px-1 py-1.5 rounded border border-line bg-surface text-muted-txt tabular-nums">
                {row.annual > 0 ? fmt(Math.round(row.annual / 12)) : '—'}
              </span>
              <button onClick={() => store.deleteRow(section, row.id)}
                className="text-muted-txt hover:text-expense transition-colors opacity-0 group-hover:opacity-100 text-sm leading-none">×</button>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between pt-1 border-t border-line">
          <button onClick={() => store.addRow(section)} className="text-xs text-muted-txt hover:text-gold transition-colors">+ הוסף</button>
          <span className="text-xs text-muted-txt">
            שנתי: <span className={`font-medium ${isIncome ? 'text-green-400' : 'text-gold'}`}>{fmt(total)}</span>
            <span className="mr-2 text-muted-txt">| חודשי: <span className="font-medium text-txt">{fmt(Math.round(total / 12))}</span></span>
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">

      {/* Header */}
      <div className="rounded-xl border border-line bg-surface2 p-6 flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gold">📆 תכנון שנתי</h1>
          <p className="text-muted-txt text-sm mt-0.5">תקציב שנתי מול ביצוע YTD מהחודשים</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-txt">שנה:</span>
          <select
            value={store.year}
            onChange={e => store.setYear(parseInt(e.target.value))}
            className="bg-bg border border-gold rounded-lg px-3 py-1.5 text-gold font-bold text-sm focus:outline-none"
          >
            {Array.from({ length: 7 }, (_, i) => new Date().getFullYear() - 1 + i).map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'הכנסות שנתיות',   plan: pIncome,  actual: aIncome,  color: 'text-green-400' },
          { label: 'הוצאות שנתיות',   plan: pExp,     actual: aExp,     color: 'text-expense' },
          { label: 'חיסכון שנתי',     plan: pSavings, actual: aSavings, color: 'text-gold' },
          { label: 'תזרים נטו',        plan: pCF,      actual: aCF,      color: pCF >= 0 ? 'text-green-400' : 'text-expense' },
        ].map(({ label, plan, actual, color }) => (
          <div key={label} className="rounded-xl border border-line bg-surface2 p-4 space-y-1">
            <div className="text-xs text-muted-txt font-medium">{label}</div>
            <div className={`text-xl font-black ${color}`}>{fmt(plan)}</div>
            <div className="text-xs text-muted-txt">÷12 = {fmt(Math.round(plan / 12))}/חודש</div>
            {activeMonths > 0 && (
              <div className="text-xs text-muted-txt pt-1 border-t border-line">
                YTD: <span className={actual > 0 ? color : 'text-muted-txt'}>{actual > 0 ? fmt(actual) : '—'}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Plan sections grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <PlanSection section="income"   title="הכנסות"         icon="💰" isIncome />
        <PlanSection section="fixed"    title="הוצאות קבועות"  icon="📌" />
        <PlanSection section="variable" title="הוצאות משתנות"  icon="🛒" />
        <PlanSection section="sub"      title="מנויים וביטוחים" icon="🔄" />
        <PlanSection section="savings"  title="חיסכון"          icon="🏦" />

        {/* Debt section — has extra balance field */}
        <div className="rounded-xl border border-line bg-surface2 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-txt">💳 הלוואות וחובות</h2>
            <span className="text-sm font-bold text-expense">
              {fmt(pDebt)}<span className="text-xs font-normal text-muted-txt">/שנה</span>
            </span>
          </div>
          <div className="grid grid-cols-[1fr_6rem_6rem_6rem_1.5rem] gap-2 px-1 text-xs text-muted-txt font-medium">
            <span>שם הלוואה</span>
            <span className="text-left">תשלום שנתי ₪</span>
            <span className="text-center">÷12/חודש</span>
            <span className="text-left">יתרה לסגירה ₪</span>
            <span />
          </div>
          <div className="space-y-1">
            {store.debt.map(row => (
              <div key={row.id} className="grid grid-cols-[1fr_6rem_6rem_6rem_1.5rem] gap-2 items-center group">
                <input value={row.name} onChange={e => store.updateDebtRow(row.id, 'name', e.target.value)}
                  placeholder="שם הלוואה"
                  className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60" />
                <input type="number" value={row.annual || ''} onChange={e => store.updateDebtRow(row.id, 'annual', parseFloat(e.target.value) || 0)}
                  placeholder="₪" min={0} style={{ direction: 'ltr' }}
                  className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left tabular-nums" />
                <span className="text-xs text-center px-1 py-1.5 rounded border border-line bg-surface text-muted-txt tabular-nums">
                  {row.annual > 0 ? fmt(Math.round(row.annual / 12)) : '—'}
                </span>
                <input type="number" value={row.balance || ''} onChange={e => store.updateDebtRow(row.id, 'balance', parseFloat(e.target.value) || 0)}
                  placeholder="₪" min={0} style={{ direction: 'ltr' }}
                  className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left tabular-nums" />
                <button onClick={() => store.deleteDebtRow(row.id)}
                  className="text-muted-txt hover:text-expense transition-colors opacity-0 group-hover:opacity-100 text-sm leading-none">×</button>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between pt-1 border-t border-line">
            <button onClick={store.addDebtRow} className="text-xs text-muted-txt hover:text-gold transition-colors">+ הוסף</button>
            <span className="text-xs text-muted-txt">שנתי: <span className="font-medium text-expense">{fmt(pDebt)}</span></span>
          </div>
        </div>
      </div>

      {/* Monthly breakdown table */}
      <div className="rounded-xl border border-line bg-surface2 p-5 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="font-semibold text-txt">📊 פירוט חודשי</h2>
          <div className="flex items-center gap-1 bg-surface border border-line rounded-lg p-1">
            {(['plan', 'actual', 'both'] as ViewMode[]).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  view === v ? 'bg-gold/20 text-gold' : 'text-muted-txt hover:text-txt'
                }`}>
                {v === 'plan' ? 'תכנון' : v === 'actual' ? 'ביצוע' : 'שניהם'}
              </button>
            ))}
          </div>
          {activeMonths > 0 && (
            <span className="text-xs text-muted-txt">
              {activeMonths} חודשים עם נתוני ביצוע
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs" style={{ minWidth: '900px' }}>
            <thead>
              <tr className="border-b border-line">
                <th className="text-right py-2 px-2 text-muted-txt font-medium w-32">קטגוריה</th>
                {MONTH_SHORT.map(m => (
                  <th key={m} className="text-center py-2 px-1 text-muted-txt font-medium">{m}</th>
                ))}
                <th className="text-center py-2 px-2 text-gold font-medium">שנתי</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/40">
              {[
                { label: '💰 הכנסות',       plan: pIncome / 12,   key: 'income'   as const, total: pIncome,   totalAct: aIncome },
                { label: '📌 קבועות',        plan: pFixed / 12,    key: 'fixed'    as const, total: pFixed,    totalAct: aFixed },
                { label: '🛒 משתנות',        plan: pVariable / 12, key: 'variable' as const, total: pVariable, totalAct: aVariable },
                { label: '🔄 מנויים+ביטוח', plan: pSub / 12,      key: 'sub'      as const, total: pSub,      totalAct: aSub },
                { label: '💳 הלוואות',       plan: pDebt / 12,     key: 'debt'     as const, total: pDebt,     totalAct: aDebt },
                { label: '🏦 חיסכון',        plan: pSavings / 12,  key: 'savings'  as const, total: pSavings,  totalAct: aSavings },
              ].map(({ label, plan, key, total, totalAct }) => (
                <tr key={label} className="hover:bg-surface/30">
                  <td className="py-2 px-2 text-txt font-medium">{label}</td>
                  {moActuals.map((m, i) => {
                    const act = m[key as keyof typeof m] as number
                    if (view === 'plan') {
                      return <td key={i} className="py-2 px-1 text-center text-gold/80 tabular-nums">{plan > 0 ? fmt(plan) : '—'}</td>
                    }
                    if (view === 'actual') {
                      return <td key={i} className={`py-2 px-1 text-center tabular-nums ${act > 0 ? 'text-green-400' : 'text-muted-txt'}`}>{act > 0 ? fmt(act) : '—'}</td>
                    }
                    // both
                    return (
                      <td key={i} className="py-2 px-1 text-center">
                        <div className="text-gold/70 tabular-nums">{plan > 0 ? fmt(plan) : '—'}</div>
                        {m.hasData && <div className={`tabular-nums ${act > 0 ? 'text-green-400' : 'text-muted-txt'}`}>{act > 0 ? fmt(act) : '—'}</div>}
                      </td>
                    )
                  })}
                  <td className="py-2 px-2 text-center font-bold tabular-nums">
                    {view === 'actual'
                      ? <span className={totalAct > 0 ? 'text-green-400' : 'text-muted-txt'}>{totalAct > 0 ? fmt(totalAct) : '—'}</span>
                      : <span className="text-gold">{fmt(total)}</span>
                    }
                  </td>
                </tr>
              ))}

              {/* Net cashflow row */}
              <tr className="border-t-2 border-line">
                <td className="py-2 px-2 font-bold text-txt">📊 תזרים נטו</td>
                {moActuals.map((m, i) => {
                  const planNet = (pIncome - pFixed - pVariable - pSub - pDebt - pSavings) / 12
                  const actNet  = m.income - m.fixed - m.variable - m.sub - m.debt - m.savings
                  const val     = view === 'actual' ? (m.hasData ? actNet : null) : (view === 'both' ? null : planNet)
                  if (view === 'both') {
                    return (
                      <td key={i} className="py-2 px-1 text-center">
                        <div className={`tabular-nums text-xs ${planNet >= 0 ? 'text-green-400/70' : 'text-expense/70'}`}>{fmt(planNet)}</div>
                        {m.hasData && <div className={`tabular-nums text-xs ${actNet >= 0 ? 'text-green-400' : 'text-expense'}`}>{actNet >= 0 ? '+' : ''}{fmt(actNet)}</div>}
                      </td>
                    )
                  }
                  if (val === null) return <td key={i} className="py-2 px-1 text-center text-muted-txt">—</td>
                  return <td key={i} className={`py-2 px-1 text-center font-bold tabular-nums ${val >= 0 ? 'text-green-400' : 'text-expense'}`}>{val >= 0 ? '+' : ''}{fmt(val)}</td>
                })}
                <td className={`py-2 px-2 text-center font-black tabular-nums ${
                  (view === 'actual' ? aCF : pCF) >= 0 ? 'text-green-400' : 'text-expense'
                }`}>
                  {(() => { const v = view === 'actual' ? aCF : pCF; return (v >= 0 ? '+' : '') + fmt(v) })()}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

    </div>
  )
}
