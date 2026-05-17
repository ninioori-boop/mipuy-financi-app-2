'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useMappingStore } from '@/stores/mappingStore'

function fmt(n: number) {
  const sign = n < 0 ? '-' : ''
  return sign + '₪' + Math.abs(Math.round(n)).toLocaleString('he-IL')
}

interface Preset {
  id: 'aggressive' | 'balanced' | 'conservative'
  name: string
  emoji: string
  bufferPct: number
  accent: string
  tagline: string
  rationale: string
}

const PRESETS: Preset[] = [
  { id: 'aggressive',   name: 'אגרסיבי', emoji: '🚀', bufferPct: 0.10, accent: 'text-purple-300', tagline: '90% לחיסכון, 10% נשאר בעו"ש', rationale: 'מקסום הון בחיסכון/השקעות. מתאים אם יש כבר עתודה נזילה.' },
  { id: 'balanced',     name: 'מאוזן',   emoji: '⚖️', bufferPct: 0.40, accent: 'text-gold',         tagline: '60% לחיסכון, 40% נשאר בעו"ש', rationale: 'נקודת איזון בריאה — גם בונים חיסכון, גם משאירים כרית.' },
  { id: 'conservative', name: 'שמרני',   emoji: '🛟', bufferPct: 0.70, accent: 'text-blue-300',     tagline: '30% לחיסכון, 70% נשאר בעו"ש', rationale: 'מקסום כרית הביטחון. מתאים אם ההכנסה משתנה או יש חשש מהוצאות פתאומיות.' },
]

export default function CheckingPage() {
  // Persistent state lives in mappingStore — both /checking and /goals read it
  const mapping = useMappingStore()

  // ── Pull averages from mapping (monthly) ─────────────────────────
  const mappingAvg = useMemo(() => {
    const income       = mapping.income.reduce((s, r) => s + (r.amount || 0), 0)
    const fixed        = mapping.fixed.reduce((s, r) => s + (r.amount || 0), 0)
    const sub          = mapping.sub.reduce((s, r) => s + (r.amount || 0), 0)
    const ins          = mapping.ins.reduce((s, r) => s + (r.amount || 0), 0)
    const varMonthly   = mapping.variable.reduce((s, r) => s + (r.amount || 0), 0) / Math.max(1, mapping.varMonths)
    const annualMonthly = mapping.annual.reduce((s, r) => s + (r.annualAmount || 0), 0) / 12
    const inst         = mapping.installments.reduce((s, r) => s + (r.monthlyPayment || 0), 0)
    const debts        = mapping.debts.reduce((s, r) => s + (r.monthlyPayment || 0), 0)
    const expenses = fixed + sub + ins + varMonthly + annualMonthly + inst + debts

    return {
      income, expenses,
      breakdown: {
        fixed:    Math.round(fixed),
        sub:      Math.round(sub),
        ins:      Math.round(ins),
        variable: Math.round(varMonthly),
        annual:   Math.round(annualMonthly),
        inst:     Math.round(inst),
        debts:    Math.round(debts),
      },
    }
  }, [mapping])

  const hasMappingData = mappingAvg.income > 0 || mappingAvg.expenses > 0

  // Effective values (override if set, else from mapping)
  const income   = mapping.incomeOverride   ?? Math.round(mappingAvg.income)
  const expenses = mapping.expensesOverride ?? Math.round(mappingAvg.expenses)
  const surplus  = income - expenses
  const isNegative = surplus < 0

  // Buffer derived from persistent bufferPct
  const positiveSurplus = Math.max(0, surplus)
  const safeBuffer  = Math.round(positiveSurplus * mapping.bufferPct)
  const toSavings   = Math.max(0, surplus - safeBuffer)

  const activePresetId =
    PRESETS.find(p => Math.abs(p.bufferPct - mapping.bufferPct) < 0.005)?.id ?? null

  function applyPreset(p: Preset) {
    mapping.setBufferPct(p.bufferPct)
  }

  // ── Empty state ──────────────────────────────────────────────────
  if (!hasMappingData) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="rounded-xl border border-line bg-surface2 p-6">
          <h1 className="text-2xl font-bold text-gold mb-1">💧 התנהלות עו&quot;ש</h1>
          <p className="text-muted-txt text-sm">
            כלי שעוזר לך להחליט כמה כסף להשאיר בעו&quot;ש וכמה להעביר לחיסכון
          </p>
        </div>
        <div className="rounded-xl border border-line bg-surface2 p-8 text-center space-y-4">
          <div className="text-5xl">🗂️</div>
          <h2 className="text-lg font-semibold text-txt">עוד אין נתונים במיפוי</h2>
          <p className="text-muted-txt text-sm max-w-md mx-auto">
            הכלי משתמש בממוצע ההכנסות וההוצאות מהמיפוי. מלא קודם את הסעיפים שם (הכנסה, קבועות, משתנות, וכו&apos;).
          </p>
          <Link
            href="/app/mapping"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gold text-surface font-semibold text-sm hover:bg-gold-light transition-colors"
          >
            🗂️ למיפוי
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div className="rounded-xl border border-line bg-surface2 p-6">
        <h1 className="text-2xl font-bold text-gold mb-1">💧 התנהלות עו&quot;ש</h1>
        <p className="text-muted-txt text-sm">
          המספרים מחושבים אוטומטית מהמיפוי שלך. אפשר לערוך ידנית, ואז לבחור כמה מהעודף נשאר בעו&quot;ש ככרית — והשאר עובר ל<Link href="/app/goals" className="text-gold hover:underline">יעדים</Link>.
        </p>
      </div>

      {/* Step 1: Income + Expenses (editable, persisted to mapping) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-income/30 bg-income/5 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-income flex items-center gap-2">💰 הכנסות חודשיות</div>
            {mapping.incomeOverride !== null && (
              <button onClick={() => mapping.setIncomeOverride(null)} className="text-[10px] text-muted-txt hover:text-gold transition-colors" title="אפס לערך מהמיפוי">
                ↺ אפס למיפוי
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-2xl">₪</span>
            <input
              type="number"
              value={income || ''}
              onChange={e => mapping.setIncomeOverride(parseFloat(e.target.value) || 0)}
              min={0}
              style={{ direction: 'ltr' }}
              className="flex-1 bg-transparent text-3xl font-black text-income placeholder:text-muted-txt focus:outline-none text-left tabular-nums"
            />
          </div>
          <div className="text-xs text-muted-txt">
            {mapping.incomeOverride === null
              ? <>ממיפוי · {mapping.income.filter(r => r.amount > 0).length} שורות</>
              : <>ערך מותאם · מהמיפוי: {fmt(mappingAvg.income)}</>
            }
          </div>
        </div>

        <div className="rounded-2xl border border-expense/30 bg-expense/5 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-expense flex items-center gap-2">💸 הוצאות חודשיות</div>
            {mapping.expensesOverride !== null && (
              <button onClick={() => mapping.setExpensesOverride(null)} className="text-[10px] text-muted-txt hover:text-gold transition-colors" title="אפס לערך מהמיפוי">
                ↺ אפס למיפוי
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-2xl">₪</span>
            <input
              type="number"
              value={expenses || ''}
              onChange={e => mapping.setExpensesOverride(parseFloat(e.target.value) || 0)}
              min={0}
              style={{ direction: 'ltr' }}
              className="flex-1 bg-transparent text-3xl font-black text-expense placeholder:text-muted-txt focus:outline-none text-left tabular-nums"
            />
          </div>
          <div className="text-xs text-muted-txt">
            {mapping.expensesOverride === null
              ? <>ממיפוי · ממוצע חודשי כולל הכל</>
              : <>ערך מותאם · מהמיפוי: {fmt(mappingAvg.expenses)}</>
            }
          </div>
        </div>
      </div>

      {/* Expense breakdown */}
      <details className="rounded-xl border border-line bg-surface2 px-4 py-2 text-xs">
        <summary className="cursor-pointer text-muted-txt hover:text-txt transition-colors py-1">
          פירוט הוצאות מהמיפוי (חודשי) ▾
        </summary>
        <div className="mt-3 pb-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: 'קבועות',  val: mappingAvg.breakdown.fixed    },
            { label: 'משתנות',  val: mappingAvg.breakdown.variable },
            { label: 'מנויים',  val: mappingAvg.breakdown.sub      },
            { label: 'ביטוחים', val: mappingAvg.breakdown.ins      },
            { label: 'שנתיות (÷12)', val: mappingAvg.breakdown.annual },
            { label: 'תשלומי אשראי', val: mappingAvg.breakdown.inst   },
            { label: 'החזרי חובות',  val: mappingAvg.breakdown.debts  },
          ].map(({ label, val }) => (
            <div key={label} className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-surface/50">
              <span className="text-muted-txt">{label}</span>
              <span className="text-txt tabular-nums">{fmt(val)}</span>
            </div>
          ))}
        </div>
      </details>

      {/* Step 2: Surplus */}
      <div className={`rounded-2xl border-2 p-6 transition-colors ${
        isNegative ? 'border-expense/40 bg-expense/5' : 'border-gold/40 bg-gradient-to-br from-gold/10 to-transparent'
      }`}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-muted-txt mb-1">
              {isNegative ? '⚠️ גירעון חודשי' : '✨ עודף חודשי'}
            </div>
            <div className={`text-5xl font-black tabular-nums ${isNegative ? 'text-expense' : 'text-gold'}`}>
              {fmt(surplus)}
            </div>
            <div className="text-xs text-muted-txt mt-2">
              {fmt(income)} (הכנסות) − {fmt(expenses)} (הוצאות)
            </div>
          </div>
          {!isNegative && (
            <div className="text-right">
              <div className="text-xs text-muted-txt">בשנה</div>
              <div className="text-2xl font-bold text-gold tabular-nums">{fmt(surplus * 12)}</div>
            </div>
          )}
        </div>

        {isNegative && (
          <div className="mt-4 rounded-lg bg-expense/10 border border-expense/30 p-3 text-sm text-txt">
            ההוצאות עולות על ההכנסות — אין עודף חודשי לחיסכון. בדוק את ההוצאות במיפוי או הגדל הכנסות.
          </div>
        )}
      </div>

      {/* Step 3: Buffer split */}
      {!isNegative && surplus > 0 && (
        <div className="rounded-2xl border border-line bg-surface2 p-5 sm:p-6 space-y-5">

          <div>
            <h2 className="font-semibold text-txt mb-1">🎯 כמה מהעודף נשאר בעו&quot;ש?</h2>
            <p className="text-xs text-muted-txt">
              ה-Buffer הוא כרית הביטחון שמצטברת בעו&quot;ש כל חודש. השאר עובר לחיסכון ומשמש כתקציב לחלוקה בין יעדים.
            </p>
          </div>

          {/* Preset buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {PRESETS.map(p => {
              const isActive = activePresetId === p.id
              return (
                <button
                  key={p.id}
                  onClick={() => applyPreset(p)}
                  className={[
                    'text-right rounded-xl border p-3 transition-all',
                    isActive
                      ? 'border-gold bg-gold/15 ring-2 ring-gold/30'
                      : 'border-line bg-surface hover:bg-surface3 hover:border-line',
                  ].join(' ')}
                >
                  <div className={`text-xs font-bold mb-0.5 ${isActive ? p.accent : 'text-muted-txt'}`}>
                    {p.emoji} {p.name}
                  </div>
                  <div className="text-xs text-txt/80 leading-snug">{p.tagline}</div>
                </button>
              )
            })}
          </div>

          {/* Slider + number input */}
          <div className="space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <label className="text-sm text-muted-txt">Buffer חודשי לעו&quot;ש:</label>
              <div className="flex items-center gap-2">
                <span className="text-base">₪</span>
                <input
                  type="number"
                  value={safeBuffer || ''}
                  onChange={e => {
                    const v = parseFloat(e.target.value) || 0
                    const pct = positiveSurplus > 0 ? v / positiveSurplus : 0
                    mapping.setBufferPct(pct)
                  }}
                  min={0}
                  max={positiveSurplus}
                  style={{ direction: 'ltr' }}
                  className="w-28 rounded-lg border border-line bg-surface px-3 py-1.5 text-base font-bold text-gold focus:outline-none focus:border-gold/60 text-left tabular-nums"
                />
              </div>
            </div>

            <input
              type="range"
              min={0}
              max={Math.max(1, positiveSurplus)}
              step={50}
              value={safeBuffer}
              onChange={e => {
                const v = parseFloat(e.target.value) || 0
                const pct = positiveSurplus > 0 ? v / positiveSurplus : 0
                mapping.setBufferPct(pct)
              }}
              className="w-full accent-gold"
              dir="ltr"
              style={{ direction: 'ltr' }}
            />

            <div className="flex items-center justify-between text-[10px] text-muted-txt tabular-nums">
              <span>{fmt(0)}</span>
              <span>{fmt(positiveSurplus)}</span>
            </div>
          </div>

          {/* Active preset rationale */}
          {(() => {
            const p = PRESETS.find(x => x.id === activePresetId)
            return p ? (
              <div className="rounded-lg border border-line bg-surface/50 p-3 text-xs text-muted-txt leading-relaxed">
                <span className="text-txt font-semibold">{p.emoji} {p.name}:</span> {p.rationale}
              </div>
            ) : null
          })()}

          {/* Result split */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <div className="rounded-2xl border-2 border-blue-400/30 bg-blue-400/5 p-4">
              <div className="text-xs font-bold uppercase tracking-wider text-blue-300 mb-1">
                🛟 Buffer לעו&quot;ש
              </div>
              <div className="text-3xl font-black tabular-nums text-blue-300">
                {fmt(safeBuffer)}
                <span className="text-xs font-normal text-muted-txt me-1">/חודש</span>
              </div>
              <div className="text-xs text-muted-txt mt-2">
                בשנה: <span className="tabular-nums text-txt">{fmt(safeBuffer * 12)}</span>
                {positiveSurplus > 0 && <span> · {Math.round((safeBuffer / positiveSurplus) * 100)}% מהעודף</span>}
              </div>
            </div>

            <div className="rounded-2xl border-2 border-gold/50 bg-gradient-to-br from-gold/15 to-transparent p-4">
              <div className="text-xs font-bold uppercase tracking-wider text-gold mb-1">
                💎 לחיסכון (תקציב יעדים)
              </div>
              <div className="text-3xl font-black tabular-nums text-gold">
                {fmt(toSavings)}
                <span className="text-xs font-normal text-muted-txt me-1">/חודש</span>
              </div>
              <div className="text-xs text-muted-txt mt-2">
                בשנה: <span className="tabular-nums text-txt">{fmt(toSavings * 12)}</span>
                {positiveSurplus > 0 && <span> · {Math.round((toSavings / positiveSurplus) * 100)}% מהעודף</span>}
              </div>
            </div>
          </div>

          {/* Big CTA to goals */}
          {toSavings > 0 && (
            <Link
              href="/app/goals"
              className="group block rounded-xl border border-gold/40 bg-gradient-to-br from-gold/20 via-gold/10 to-transparent p-4 hover:from-gold/25 hover:border-gold/60 transition-all"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs text-muted-txt mb-0.5">📌 הסכום הזה זמין כעת ב</div>
                  <div className="text-base font-semibold text-gold">
                    יעדים פיננסיים — חלק את {fmt(toSavings)} לחודש בין היעדים
                  </div>
                </div>
                <span className="text-gold text-xl group-hover:-translate-x-1 transition-transform">←</span>
              </div>
            </Link>
          )}
        </div>
      )}

      <p className="text-xs text-muted-txt text-center px-4 leading-relaxed">
        ההמלצות אינן מהוות ייעוץ פיננסי. החלוקה האידיאלית תלויה ביציבות ההכנסה, חיסכון נזיל קיים, וטולרנס לסיכון.
      </p>
    </div>
  )
}
