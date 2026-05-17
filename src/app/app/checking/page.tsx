'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useMonthlyStore } from '@/stores/monthlyStore'

function fmt(n: number) {
  return '₪' + Math.round(n).toLocaleString('he-IL')
}

type ScenarioId = 'conservative' | 'balanced' | 'aggressive'

interface Scenario {
  id: ScenarioId
  name: string
  emoji: string
  multiplier: number          // months of expenses to keep
  buffer: number              // extra fixed buffer (₪)
  accent: string              // tailwind text/border color
  bg: string                  // tailwind bg
  tagline: string             // one-line description
  pros: string[]
  cons: string[]
}

const SCENARIOS: Scenario[] = [
  {
    id: 'conservative',
    name: 'שמרני',
    emoji: '🛟',
    multiplier: 3,
    buffer: 3000,
    accent: 'text-blue-300',
    bg: 'border-blue-400/30 bg-blue-400/5',
    tagline: 'שקט נפשי מקסימלי — כיסוי ל-3 חודשי הוצאות',
    pros: ['רשת ביטחון בפני אובדן הכנסה', 'לא צריך לנגוע בחיסכון בחירום', 'מתאים אם ההכנסה לא יציבה'],
    cons: ['הון "תקוע" שלא עובד עליך', 'מפסיד תשואה אלטרנטיבית של ~4-6%/שנה'],
  },
  {
    id: 'balanced',
    name: 'מאוזן',
    emoji: '⚖️',
    multiplier: 1.5,
    buffer: 2000,
    accent: 'text-gold',
    bg: 'border-gold/50 bg-gold/10',
    tagline: 'נקודת האיזון — מספיק חודש וחצי + כרית',
    pros: ['כיסוי לעיכוב משכורת או חודש מאתגר', 'משאיר הון לחיסכון/השקעות', 'מתאים לרוב המשפחות'],
    cons: ['חירום מתמשך ידרוש שימוש בחיסכון', 'דורש משמעת — לא לחיות מעל הקו'],
  },
  {
    id: 'aggressive',
    name: 'אגרסיבי',
    emoji: '🚀',
    multiplier: 1,
    buffer: 1000,
    accent: 'text-purple-300',
    bg: 'border-purple-400/30 bg-purple-400/5',
    tagline: 'מקסום השקעה — חודש אחד + כרית קטנה',
    pros: ['מקסימום הון להשקעה / השקעות', 'תשואה גבוהה לאורך זמן', 'מתאים למי שיש לו חיסכון נזיל אחר'],
    cons: ['אפס מקום לטעות בקאש-פלואו', 'דורש מעקב צמוד ומשמעת', 'לא מתאים אם אין עוד עתודה נזילה'],
  },
]

export default function CheckingPage() {
  const months = useMonthlyStore(s => s.months)
  const [currentBalance, setCurrentBalance] = useState<number>(0)
  const [selected, setSelected] = useState<ScenarioId>('balanced')

  // ── Pull averages from monthly store ─────────────────────────────
  const stats = useMemo(() => {
    const entries = Object.values(months)
    // Only count months that have any data (income or any expense)
    const active = entries.filter(m => {
      const inc = m.income.reduce((s, r) => s + r.plan + r.actual, 0)
      const exp = m.fixed.reduce((s, r) => s + r.plan + r.actual, 0)
                + m.variable.reduce((s, r) => s + r.plan + r.actual, 0)
                + m.sub.reduce((s, r) => s + r.plan + r.actual, 0)
                + m.ins.reduce((s, r) => s + r.plan + r.actual, 0)
                + m.installments.reduce((s, r) => s + r.monthly, 0)
                + m.debts.reduce((s, r) => s + r.monthly, 0)
      return inc > 0 || exp > 0
    })

    if (active.length === 0) {
      return {
        hasData: false,
        avgIncome: 0,
        avgFixed: 0,
        avgVariable: 0,
        avgSub: 0,
        avgIns: 0,
        avgInst: 0,
        avgDebt: 0,
        avgSavings: 0,
        avgExpenses: 0,
        avgNetFlow: 0,
        monthsCount: 0,
      }
    }

    function avg(reducer: (m: typeof active[number]) => number): number {
      return active.reduce((s, m) => s + reducer(m), 0) / active.length
    }

    // Prefer actual when it exists, otherwise plan
    const avgIncome   = avg(m => m.income  .reduce((s, r) => s + (r.actual || r.plan), 0))
    const avgFixed    = avg(m => m.fixed   .reduce((s, r) => s + (r.actual || r.plan), 0))
    const avgVariable = avg(m => m.variable.reduce((s, r) => s + (r.actual || r.plan), 0))
    const avgSub      = avg(m => m.sub     .reduce((s, r) => s + (r.actual || r.plan), 0))
    const avgIns      = avg(m => m.ins     .reduce((s, r) => s + (r.actual || r.plan), 0))
    const avgInst     = avg(m => m.installments.reduce((s, r) => s + r.monthly, 0))
    const avgDebt     = avg(m => m.debts.reduce((s, r) => s + r.monthly, 0))
    const avgSavings  = avg(m => m.savings.reduce((s, r) => s + r.monthly, 0))

    const avgExpenses = avgFixed + avgVariable + avgSub + avgIns + avgInst + avgDebt
    const avgNetFlow  = avgIncome - avgExpenses - avgSavings

    return {
      hasData: true,
      avgIncome,
      avgFixed,
      avgVariable,
      avgSub,
      avgIns,
      avgInst,
      avgDebt,
      avgSavings,
      avgExpenses,
      avgNetFlow,
      monthsCount: active.length,
    }
  }, [months])

  // Compute recommended balance per scenario
  const scenariosWithAmount = SCENARIOS.map(s => ({
    ...s,
    amount: Math.round(stats.avgExpenses * s.multiplier + s.buffer),
  }))

  const chosenScenario = scenariosWithAmount.find(s => s.id === selected)!
  const delta = currentBalance - chosenScenario.amount   // positive = excess

  // ── Empty state ──────────────────────────────────────────────────
  if (!stats.hasData) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="rounded-xl border border-line bg-surface2 p-6">
          <h1 className="text-2xl font-bold text-gold mb-1">💧 התנהלות עו&quot;ש</h1>
          <p className="text-muted-txt text-sm">
            כלי שעוזר לך להחליט כמה כסף להשאיר בעו&quot;ש לפי ההוצאות שלך
          </p>
        </div>
        <div className="rounded-xl border border-line bg-surface2 p-8 text-center space-y-4">
          <div className="text-5xl">📅</div>
          <h2 className="text-lg font-semibold text-txt">עוד אין נתונים</h2>
          <p className="text-muted-txt text-sm max-w-md mx-auto">
            כדי לחשב כמה להשאיר בעו&quot;ש צריך לדעת את ההוצאות החודשיות שלך. מלא תקציב לפחות לחודש אחד במסך החודשי.
          </p>
          <Link
            href="/app/monthly/jan"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gold text-surface font-semibold text-sm hover:bg-gold-light transition-colors"
          >
            📅 לתקציב החודשי
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">

      {/* Header */}
      <div className="rounded-xl border border-line bg-surface2 p-6">
        <h1 className="text-2xl font-bold text-gold mb-1">💧 התנהלות עו&quot;ש</h1>
        <p className="text-muted-txt text-sm">
          כמה כסף כדאי להשאיר בחשבון העו&quot;ש ככרית ביטחון, ומה לעשות עם העודף.
          המספרים מחושבים אוטומטית מהתקציב החודשי שלך.
        </p>
      </div>

      {/* Stats card — your average monthly numbers */}
      <div className="rounded-xl border border-line bg-surface2 p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="font-semibold text-txt">📊 הממוצע החודשי שלך</h2>
          <span className="text-xs text-muted-txt">
            ממוצע על פני {stats.monthsCount} {stats.monthsCount === 1 ? 'חודש' : 'חודשים'} פעילים
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'הכנסות',       val: stats.avgIncome,   color: 'text-income' },
            { label: 'הוצאות',       val: stats.avgExpenses, color: 'text-expense' },
            { label: 'הפרשה לחיסכון', val: stats.avgSavings,  color: 'text-gold' },
            { label: 'תזרים נטו',    val: stats.avgNetFlow,  color: stats.avgNetFlow >= 0 ? 'text-income' : 'text-expense' },
          ].map(({ label, val, color }) => (
            <div key={label} className="bg-surface border border-line rounded-xl p-3">
              <div className="text-xs text-muted-txt font-medium mb-1">{label}</div>
              <div className={`text-lg font-black ${color}`}>{fmt(val)}</div>
            </div>
          ))}
        </div>
        {/* Expense breakdown */}
        <details className="text-xs text-muted-txt">
          <summary className="cursor-pointer hover:text-txt transition-colors">פירוט הוצאות חודשיות ▾</summary>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
            {[
              { label: 'קבועות',         val: stats.avgFixed },
              { label: 'משתנות',         val: stats.avgVariable },
              { label: 'מנויים',         val: stats.avgSub },
              { label: 'ביטוחים',        val: stats.avgIns },
              { label: 'תשלומים (אשראי)', val: stats.avgInst },
              { label: 'החזרי חובות',    val: stats.avgDebt },
            ].map(({ label, val }) => (
              <div key={label} className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-surface/50">
                <span>{label}</span>
                <span className="text-txt tabular-nums">{fmt(val)}</span>
              </div>
            ))}
          </div>
        </details>
      </div>

      {/* 3 Scenarios */}
      <div className="space-y-3">
        <h2 className="font-semibold text-txt px-1">🎯 בחר תרחיש</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {scenariosWithAmount.map(s => {
            const isSelected = s.id === selected
            return (
              <button
                key={s.id}
                onClick={() => setSelected(s.id)}
                className={[
                  'group text-right rounded-2xl border p-5 transition-all',
                  isSelected
                    ? `${s.bg} ring-2 ring-gold/50 shadow-[0_8px_32px_rgba(201,168,108,0.15)]`
                    : 'border-line bg-surface2 hover:bg-surface3 hover:border-line',
                ].join(' ')}
              >
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <div className={`text-xs font-bold uppercase tracking-wider mb-1 ${isSelected ? s.accent : 'text-muted-txt'}`}>
                      {s.emoji} {s.name}
                    </div>
                    <div className={`text-3xl font-black tabular-nums ${isSelected ? s.accent : 'text-txt'}`}>
                      {fmt(s.amount)}
                    </div>
                  </div>
                  {isSelected && (
                    <span className="size-6 rounded-full bg-gold text-surface text-xs font-bold flex items-center justify-center shrink-0">✓</span>
                  )}
                </div>

                <p className="text-xs text-muted-txt leading-relaxed mb-3">
                  {s.tagline}
                </p>

                <div className="text-[11px] text-muted-txt mb-3 pb-3 border-b border-line/50">
                  <span className="text-txt/80 tabular-nums">{fmt(stats.avgExpenses)}</span>
                  <span className="mx-1">×</span>
                  <span className="text-txt/80">{s.multiplier} חודשים</span>
                  <span className="mx-1">+</span>
                  <span className="text-txt/80 tabular-nums">{fmt(s.buffer)}</span>
                  <span className="text-muted-txt/70"> כרית</span>
                </div>

                <div className="space-y-2 text-xs text-right">
                  <div>
                    <div className="text-income/90 font-semibold mb-1">יתרונות</div>
                    <ul className="space-y-0.5">
                      {s.pros.map((p, i) => (
                        <li key={i} className="text-txt/75 flex items-start gap-1.5">
                          <span className="text-income shrink-0">+</span>
                          <span>{p}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="text-expense/90 font-semibold mb-1">חסרונות</div>
                    <ul className="space-y-0.5">
                      {s.cons.map((c, i) => (
                        <li key={i} className="text-txt/75 flex items-start gap-1.5">
                          <span className="text-expense shrink-0">−</span>
                          <span>{c}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Action card — compare to current balance */}
      <div className="rounded-2xl border border-gold/40 bg-gradient-to-br from-gold/10 to-transparent p-5 sm:p-6 space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="font-semibold text-txt">💼 כמה יש לך בעו&quot;ש כרגע?</h2>
          <span className="text-xs text-muted-txt">לפי תרחיש {chosenScenario.name}</span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xl">₪</span>
          <input
            type="number"
            value={currentBalance || ''}
            onChange={e => setCurrentBalance(parseFloat(e.target.value) || 0)}
            placeholder="הכנס יתרה נוכחית"
            min={0}
            style={{ direction: 'ltr' }}
            className="flex-1 max-w-xs rounded-xl border border-line bg-surface px-4 py-3 text-lg text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left tabular-nums font-semibold"
          />
        </div>

        {currentBalance > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-surface border border-line rounded-xl p-3">
              <div className="text-xs text-muted-txt mb-1">יתרה נוכחית</div>
              <div className="text-lg font-black text-txt tabular-nums">{fmt(currentBalance)}</div>
            </div>
            <div className="bg-surface border border-line rounded-xl p-3">
              <div className="text-xs text-muted-txt mb-1">{chosenScenario.emoji} מומלץ ({chosenScenario.name})</div>
              <div className={`text-lg font-black tabular-nums ${chosenScenario.accent}`}>{fmt(chosenScenario.amount)}</div>
            </div>
            <div className={`rounded-xl p-3 border ${
              delta >= 0
                ? 'bg-income/10 border-income/40'
                : 'bg-expense/10 border-expense/40'
            }`}>
              <div className="text-xs text-muted-txt mb-1">
                {delta >= 0 ? 'עודף שאפשר להפנות' : 'חוסר מהמלצה'}
              </div>
              <div className={`text-lg font-black tabular-nums ${delta >= 0 ? 'text-income' : 'text-expense'}`}>
                {delta >= 0 ? '+' : ''}{fmt(delta)}
              </div>
            </div>
          </div>
        )}

        {currentBalance > 0 && delta > 0 && (
          <div className="rounded-xl border border-line bg-surface/60 p-4 space-y-2">
            <div className="text-sm font-semibold text-txt">💡 הצעות לעודף</div>
            <ul className="text-xs text-muted-txt space-y-1.5 leading-relaxed">
              <li className="flex items-start gap-2">
                <span className="text-gold shrink-0">→</span>
                <span><strong className="text-txt">לחיסכון נזיל</strong> (קרן כספית / פיקדון): {fmt(Math.round(delta * 0.6))} — שמירה על נזילות</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-gold shrink-0">→</span>
                <span><strong className="text-txt">לחיסכון לטווח בינוני</strong> (קופת גמל להשקעה / ETF): {fmt(Math.round(delta * 0.3))} — לבניית הון</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-gold shrink-0">→</span>
                <span><strong className="text-txt">להחזר חובות מואץ</strong> (אם יש): {fmt(Math.round(delta * 0.1))} — לחסוך ריבית</span>
              </li>
            </ul>
            <Link href="/app/goals" className="inline-flex items-center gap-1 text-xs text-gold hover:text-gold-light mt-1">
              קבע יעדים חכמים לעודף ←
            </Link>
          </div>
        )}

        {currentBalance > 0 && delta < 0 && (
          <div className="rounded-xl border border-expense/40 bg-expense/10 p-4 text-sm text-txt leading-relaxed">
            ⚠️ היתרה שלך נמוכה מההמלצה ב-<strong className="tabular-nums">{fmt(Math.abs(delta))}</strong>.
            שקול לבחור בתרחיש אגרסיבי יותר, או להגדיל את העו&quot;ש בחודשים הקרובים מהתזרים החיובי.
          </div>
        )}
      </div>

      {/* Footer note */}
      <p className="text-xs text-muted-txt text-center px-4 leading-relaxed">
        ההמלצות אינן מהוות ייעוץ פיננסי. בחירת התרחיש תלויה ביציבות ההכנסה, רשת הביטחון האחרת שלך, והנוחות האישית שלך עם סיכון.
      </p>
    </div>
  )
}
