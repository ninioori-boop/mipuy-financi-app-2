'use client'

import { useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useMonthlyStore } from '@/stores/monthlyStore'
import { useMappingStore } from '@/stores/mappingStore'
import { MONTHS_LIST } from '@/lib/constants'
import { BudgetSection } from '@/components/monthly/BudgetSection'

function fmt(n: number) {
  return '₪' + Math.round(n).toLocaleString('he-IL')
}

export default function MonthlyPage() {
  const { month: monthId } = useParams<{ month: string }>()
  const monthName = MONTHS_LIST.find(m => m.id === monthId)?.name ?? monthId

  const { months, initMonth, syncFromMapping, setYear, addRow, updateRow, deleteRow,
          addInstRow, updateInstRow, deleteInstRow,
          addDebtRow, updateDebtRow, deleteDebtRow,
          addSavingRow, updateSavingRow, deleteSavingRow } = useMonthlyStore()

  // Initialize the month and immediately mirror mapping installments/debts/savings.
  // The sync uses fromMapping:true so subsequent user edits in this month are
  // preserved (the edit clears the flag and future syncs leave that row alone).
  useEffect(() => {
    initMonth(monthId)
    const mp = useMappingStore.getState()
    syncFromMapping(mp.installments, mp.debts, mp.savings, monthId)
  }, [monthId, initMonth, syncFromMapping])

  const data = months[monthId]
  if (!data) return null

  const bind = (section: Parameters<typeof addRow>[1]) => ({
    onAdd:    ()                                  => addRow(monthId, section),
    onUpdate: (id: string, field: 'name' | 'plan' | 'actual', value: string | number) =>
                                                     updateRow(monthId, section, id, field, value),
    onDelete: (id: string)                        => deleteRow(monthId, section, id),
  })

  // ── Cashflow calculations (mirrors v1 moRecalc logic) ──
  const bIncome = data.income.reduce((s, r) => s + r.plan, 0)
  const aIncome = data.income.reduce((s, r) => s + r.actual, 0)
  const bFixed  = data.fixed.reduce((s, r) => s + r.plan, 0)
  const aFixed  = data.fixed.reduce((s, r) => s + r.actual, 0)
  const bVar    = data.variable.reduce((s, r) => s + r.plan, 0)
  const aVar    = data.variable.reduce((s, r) => s + r.actual, 0)
  const bSub    = data.sub.reduce((s, r) => s + r.plan, 0)
  const aSub    = data.sub.reduce((s, r) => s + r.actual, 0)
  const bIns    = data.ins.reduce((s, r) => s + r.plan, 0)
  const aIns    = data.ins.reduce((s, r) => s + r.actual, 0)
  const tInst   = data.installments.reduce((s, r) => s + r.monthly, 0)
  const tDebt   = data.debts.reduce((s, r) => s + r.monthly, 0)
  const tSav    = data.savings.reduce((s, r) => s + r.monthly, 0)

  const bExp     = bFixed + bVar + bSub + bIns + tInst + tDebt
  const aExp     = aFixed + aVar + aSub + aIns + tInst + tDebt
  const bBalance = bIncome - bExp - tSav
  const hasActual = aIncome > 0 || aExp > 0
  const effectiveIncome = aIncome > 0 ? aIncome : bIncome
  const aBalance = hasActual ? effectiveIncome - aExp - tSav : null

  // ── Alerts ──
  type Alert = { level: 'high' | 'med'; msg: string }
  const alerts: Alert[] = []
  if (hasActual) {
    if (bExp > 0 && aExp > bExp) {
      const over = aExp - bExp
      const pct  = Math.round((over / bExp) * 100)
      alerts.push({ level: pct >= 20 ? 'high' : 'med', msg: `חריגה כוללת מהתקציב: ${fmt(over)} (${pct}%)` })
    }
    const sections = [
      { label: 'הוצאות קבועות', b: bFixed, a: aFixed },
      { label: 'הוצאות משתנות', b: bVar,   a: aVar },
      { label: 'מנויים',        b: bSub,   a: aSub },
      { label: 'ביטוחים',       b: bIns,   a: aIns },
    ]
    sections.forEach(({ label, b, a }) => {
      if (b > 0 && a > b) {
        const over = a - b
        const pct  = Math.round((over / b) * 100)
        if (pct >= 10) alerts.push({ level: pct >= 25 ? 'high' : 'med', msg: `${label}: חריגה של ${fmt(over)} (${pct}%)` })
      }
    })
    if (aBalance !== null && aBalance < 0) {
      alerts.push({ level: 'high', msg: `תזרים שלילי: ${fmt(aBalance)}` })
    }
    if (bIncome > 0 && aIncome > 0 && aIncome < bIncome * 0.9) {
      alerts.push({ level: 'med', msg: `הכנסה נמוכה מהתכנון ב-${fmt(bIncome - aIncome)}` })
    }
  }


  return (
    <div className="max-w-5xl mx-auto space-y-6">

      {/* Month sub-navigation */}
      <div className="rounded-xl border border-line bg-surface2 overflow-hidden">
        <div className="flex overflow-x-auto">
          {MONTHS_LIST.map(m => (
            <Link
              key={m.id}
              href={`/app/monthly/${m.id}`}
              className={[
                'px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors flex-shrink-0',
                m.id === monthId
                  ? 'border-b-2 border-gold text-gold bg-gold/5'
                  : 'text-muted-txt hover:text-txt',
              ].join(' ')}
            >
              {m.name}
            </Link>
          ))}
        </div>
      </div>

      {/* Header */}
      <div className="rounded-xl border border-line bg-surface2 p-6 flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gold">📅 תקציב {monthName}</h1>
          <p className="text-muted-txt text-sm mt-0.5">תכנון מול ביצוע בפועל</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-txt">שנה:</span>
          <input
            type="number"
            value={data.year}
            min={2020}
            max={2035}
            onChange={e => setYear(monthId, parseInt(e.target.value) || data.year)}
            style={{ direction: 'ltr' }}
            className="w-20 text-center bg-bg border border-gold rounded-lg text-gold font-bold py-1 focus:outline-none text-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* שורה 1: הכנסות | קבועות */}
        <BudgetSection title="הכנסות" icon="💰" rows={data.income} isIncome {...bind('income')} />
        <BudgetSection title="הוצאות קבועות" icon="📌" rows={data.fixed} {...bind('fixed')} />
        {/* שורה 2: מנויים | ביטוחים */}
        <BudgetSection title="מנויים" icon="🔄" rows={data.sub} {...bind('sub')} />
        <BudgetSection title="ביטוחים" icon="🛡️" rows={data.ins} {...bind('ins')} />
        {/* שורה 3: משתנות — רוחב מלא */}
        <div className="md:col-span-2">
          <BudgetSection title="הוצאות משתנות" icon="🛒" rows={data.variable} {...bind('variable')} />
        </div>
      </div>

      {/* Full-width: Installments */}
      <div className="rounded-xl border border-line bg-surface2 p-3 sm:p-5 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-1">
          <h2 className="font-semibold text-txt">🛍️ עסקאות בתשלומים</h2>
          <span className="text-sm font-bold text-gold">{fmt(tInst)}<span className="text-xs font-normal text-muted-txt">/חודש</span></span>
        </div>
        {/* Desktop headers */}
        <div className="hidden sm:grid grid-cols-[1fr_6rem_6rem_5rem_5rem_1.5rem] gap-2 px-1 text-xs text-muted-txt font-medium">
          <span>שם העסקה</span><span className="text-left">סכום כולל ₪</span><span className="text-left">חודשי ₪</span>
          <span className="text-center">תשלום נוכחי</span><span className="text-center">סה"כ תשלומים</span><span />
        </div>
        <div className="space-y-1.5">
          {data.installments.map(row => (
            <div key={row.id} className="group">
              {/* Desktop */}
              <div className="hidden sm:grid grid-cols-[1fr_6rem_6rem_5rem_5rem_1.5rem] gap-2 items-center">
                <input value={row.name} onChange={e => updateInstRow(monthId, row.id, 'name', e.target.value)} placeholder="שם העסקה"
                  className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60" />
                {(['total','monthly','current','totalPay'] as const).map(f => (
                  <input key={f} type="number" value={(row[f] as number) || ''} onChange={e => updateInstRow(monthId, row.id, f, parseFloat(e.target.value) || 0)}
                    placeholder={f === 'total' || f === 'monthly' ? '₪' : '#'} min={0} style={{ direction: 'ltr' }}
                    className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left tabular-nums" />
                ))}
                <button onClick={() => deleteInstRow(monthId, row.id)} className="text-muted-txt hover:text-expense transition-colors opacity-0 group-hover:opacity-100 text-sm leading-none">×</button>
              </div>
              {/* Mobile card */}
              <div className="sm:hidden bg-surface/40 rounded-lg p-2 space-y-1.5">
                <div className="flex items-center gap-2">
                  <input value={row.name} onChange={e => updateInstRow(monthId, row.id, 'name', e.target.value)} placeholder="שם העסקה"
                    className="flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60" />
                  <button onClick={() => deleteInstRow(monthId, row.id)} className="shrink-0 text-muted-txt hover:text-expense text-sm">×</button>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {[{f:'total' as const,l:'סכום כולל ₪'},{f:'monthly' as const,l:'חודשי ₪'}].map(({f,l}) => (
                    <div key={f} className="space-y-0.5">
                      <div className="text-[10px] text-muted-txt px-1">{l}</div>
                      <input type="number" value={(row[f] as number) || ''} onChange={e => updateInstRow(monthId, row.id, f, parseFloat(e.target.value) || 0)}
                        placeholder="₪" min={0} style={{ direction: 'ltr' }}
                        className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left tabular-nums" />
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {[{f:'current' as const,l:'תשלום נוכחי'},{f:'totalPay' as const,l:'סה"כ תשלומים'}].map(({f,l}) => (
                    <div key={f} className="space-y-0.5">
                      <div className="text-[10px] text-muted-txt px-1">{l}</div>
                      <input type="number" value={(row[f] as number) || ''} onChange={e => updateInstRow(monthId, row.id, f, parseFloat(e.target.value) || 0)}
                        placeholder="#" min={0} style={{ direction: 'ltr' }}
                        className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left tabular-nums" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
          {data.installments.length === 0 && <p className="text-xs text-muted-txt py-2">אין עסקאות בתשלומים</p>}
        </div>
        <button onClick={() => addInstRow(monthId)} className="text-xs text-muted-txt hover:text-gold transition-colors">+ הוסף עסקה</button>
      </div>

      {/* Full-width: Debts */}
      <div className="rounded-xl border border-line bg-surface2 p-3 sm:p-5 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-1">
          <h2 className="font-semibold text-txt">💳 החזר חובות</h2>
          <span className="text-sm font-bold text-expense">{fmt(tDebt)}<span className="text-xs font-normal text-muted-txt">/חודש</span></span>
        </div>
        <div className="hidden sm:grid grid-cols-[1fr_7rem_7rem_6rem_1.5rem] gap-2 px-1 text-xs text-muted-txt font-medium">
          <span>שם הנושה</span><span className="text-left">יתרה ₪</span><span className="text-left">החזר חודשי ₪</span><span className="text-center">חודשים</span><span />
        </div>
        <div className="space-y-1.5">
          {data.debts.map(row => (
            <div key={row.id} className="group">
              <div className="hidden sm:grid grid-cols-[1fr_7rem_7rem_6rem_1.5rem] gap-2 items-center">
                <input value={row.name} onChange={e => updateDebtRow(monthId, row.id, 'name', e.target.value)} placeholder="שם הנושה"
                  className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60" />
                <input type="number" value={row.remaining || ''} onChange={e => updateDebtRow(monthId, row.id, 'remaining', parseFloat(e.target.value) || 0)} placeholder="₪" min={0} style={{ direction: 'ltr' }} className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left tabular-nums" />
                <input type="number" value={row.monthly || ''} onChange={e => updateDebtRow(monthId, row.id, 'monthly', parseFloat(e.target.value) || 0)} placeholder="₪" min={0} style={{ direction: 'ltr' }} className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left tabular-nums" />
                <input type="number" value={row.months || ''} onChange={e => updateDebtRow(monthId, row.id, 'months', parseFloat(e.target.value) || 0)} placeholder="#" min={0} style={{ direction: 'ltr' }} className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-center tabular-nums" />
                <button onClick={() => deleteDebtRow(monthId, row.id)} className="text-muted-txt hover:text-expense transition-colors opacity-0 group-hover:opacity-100 text-sm leading-none">×</button>
              </div>
              <div className="sm:hidden bg-surface/40 rounded-lg p-2 space-y-1.5">
                <div className="flex items-center gap-2">
                  <input value={row.name} onChange={e => updateDebtRow(monthId, row.id, 'name', e.target.value)} placeholder="שם הנושה"
                    className="flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60" />
                  <button onClick={() => deleteDebtRow(monthId, row.id)} className="shrink-0 text-muted-txt hover:text-expense text-sm">×</button>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {[{f:'remaining' as const,l:'יתרה ₪'},{f:'monthly' as const,l:'החזר חודשי ₪'},{f:'months' as const,l:'חודשים'}].map(({f,l}) => (
                    <div key={f} className="space-y-0.5">
                      <div className="text-[10px] text-muted-txt px-1">{l}</div>
                      <input type="number" value={(row[f] as number) || ''} onChange={e => updateDebtRow(monthId, row.id, f, parseFloat(e.target.value) || 0)}
                        placeholder={f === 'months' ? '#' : '₪'} min={0} style={{ direction: 'ltr' }}
                        className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left tabular-nums" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
          {data.debts.length === 0 && <p className="text-xs text-muted-txt py-2">אין החזרי חובות</p>}
        </div>
        <button onClick={() => addDebtRow(monthId)} className="text-xs text-muted-txt hover:text-gold transition-colors">+ הוסף חוב</button>
      </div>

      {/* Full-width: Savings */}
      <div className="rounded-xl border border-line bg-surface2 p-3 sm:p-5 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-1">
          <h2 className="font-semibold text-txt">🏦 הפרשה לחיסכון</h2>
          <span className="text-sm font-bold text-gold">{fmt(tSav)}<span className="text-xs font-normal text-muted-txt">/חודש</span></span>
        </div>
        <div className="hidden sm:grid grid-cols-[1fr_8rem_8rem_1.5rem] gap-2 px-1 text-xs text-muted-txt font-medium">
          <span>שם / סוג חיסכון</span><span className="text-left">הפרשה חודשית ₪</span><span className="text-left">סך נצבר ₪</span><span />
        </div>
        <div className="space-y-1.5">
          {data.savings.map(row => (
            <div key={row.id} className="group">
              <div className="hidden sm:grid grid-cols-[1fr_8rem_8rem_1.5rem] gap-2 items-center">
                <input value={row.name} onChange={e => updateSavingRow(monthId, row.id, 'name', e.target.value)} placeholder="חיסכון"
                  className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60" />
                <input type="number" value={row.monthly || ''} onChange={e => updateSavingRow(monthId, row.id, 'monthly', parseFloat(e.target.value) || 0)} placeholder="₪" min={0} style={{ direction: 'ltr' }} className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left tabular-nums" />
                <input type="number" value={row.accumulated || ''} onChange={e => updateSavingRow(monthId, row.id, 'accumulated', parseFloat(e.target.value) || 0)} placeholder="₪" min={0} style={{ direction: 'ltr' }} className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left tabular-nums" />
                <button onClick={() => deleteSavingRow(monthId, row.id)} className="text-muted-txt hover:text-expense transition-colors opacity-0 group-hover:opacity-100 text-sm leading-none">×</button>
              </div>
              <div className="sm:hidden bg-surface/40 rounded-lg p-2 space-y-1.5">
                <div className="flex items-center gap-2">
                  <input value={row.name} onChange={e => updateSavingRow(monthId, row.id, 'name', e.target.value)} placeholder="שם החיסכון"
                    className="flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60" />
                  <button onClick={() => deleteSavingRow(monthId, row.id)} className="shrink-0 text-muted-txt hover:text-expense text-sm">×</button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-0.5">
                    <div className="text-[10px] text-muted-txt px-1">הפרשה חודשית ₪</div>
                    <input type="number" value={row.monthly || ''} onChange={e => updateSavingRow(monthId, row.id, 'monthly', parseFloat(e.target.value) || 0)} placeholder="₪" min={0} style={{ direction: 'ltr' }} className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left tabular-nums" />
                  </div>
                  <div className="space-y-0.5">
                    <div className="text-[10px] text-muted-txt px-1">סך נצבר ₪</div>
                    <input type="number" value={row.accumulated || ''} onChange={e => updateSavingRow(monthId, row.id, 'accumulated', parseFloat(e.target.value) || 0)} placeholder="₪" min={0} style={{ direction: 'ltr' }} className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left tabular-nums" />
                  </div>
                </div>
              </div>
            </div>
          ))}
          {data.savings.length === 0 && <p className="text-xs text-muted-txt py-2">אין הפרשות חיסכון</p>}
        </div>
        <button onClick={() => addSavingRow(monthId)} className="text-xs text-muted-txt hover:text-gold transition-colors">+ הוסף חיסכון</button>
      </div>

      {/* Summary — bottom */}
      <div className="rounded-xl border border-line bg-surface2 p-4 sm:p-5 space-y-3">
        <h2 className="font-semibold text-txt">📊 סיכום {monthName}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'הכנסות',    val: bIncome,  actual: hasActual ? aIncome : null, color: 'text-green-400' },
            { label: 'הוצאות',    val: bExp,     actual: hasActual ? aExp : null,    color: 'text-expense' },
            { label: 'חיסכון',    val: tSav,     actual: null,                        color: 'text-gold' },
            { label: 'תזרים נטו', val: bBalance, actual: aBalance,                    color: bBalance >= 0 ? 'text-green-400' : 'text-expense' },
          ].map(({ label, val, actual, color }) => (
            <div key={label} className="bg-surface border border-line rounded-xl p-3">
              <div className="text-xs text-muted-txt font-medium mb-1">{label}</div>
              <div className={`text-lg font-black ${color}`}>{fmt(val)}</div>
              {actual !== null && (
                <div className="text-xs text-muted-txt mt-0.5">ביצוע: {fmt(actual)}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((a, i) => (
            <div key={i} className={`rounded-xl border px-4 py-2.5 flex items-center gap-3 text-sm ${
              a.level === 'high'
                ? 'bg-expense/10 border-expense/30 text-txt'
                : 'bg-yellow-400/8 border-yellow-400/30 text-txt'
            }`}>
              <span>{a.level === 'high' ? '🔴' : '🟡'}</span>
              <span>{a.msg}</span>
            </div>
          ))}
        </div>
      )}

    </div>
  )
}
