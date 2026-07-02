'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useExpenseLogStore } from '@/stores/expenseLogStore'
import { useCategoryBudgetStore } from '@/stores/categoryBudgetStore'
import { useMonthlyStore } from '@/stores/monthlyStore'
import { useCreditStore } from '@/stores/creditStore'
import { CATEGORY_ICONS, MONTHS_LIST, ALL_CATEGORIES } from '@/lib/constants'
import { CategoryPicker } from '@/components/shared/CategoryPicker'
import { useClientMode } from '@/hooks/useClientMode'

function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function currentMonth() {
  return today().slice(0, 7)   // YYYY-MM
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })
}

function dayLabel(iso: string): string {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${d}/${m}/${y}`
}

const icon = (c: string) => CATEGORY_ICONS[c] ?? '📦'
const fmt  = (n: number) => '₪' + Math.round(n).toLocaleString('he-IL')

export default function ExpensesPage() {
  const router = useRouter()
  const clientMode = useClientMode()   // in-app: declutter for the phone
  const { entries, add, update, remove } = useExpenseLogStore()
  const { budgets, setBudget } = useCategoryBudgetStore()
  const { initMonth, applyExpenseLog } = useMonthlyStore()
  const learn = useCreditStore(s => s.learn)   // shared learnedDB — same teaching as credit/import

  const [selMonth, setSelMonth] = useState(currentMonth())
  const [showBudgetEditor, setShowBudgetEditor] = useState(false)
  const [amount, setAmount]     = useState('')
  const [category, setCategory] = useState('')
  const [note, setNote]         = useState('')
  const [date, setDate]         = useState(today())

  function handleAdd() {
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) { toast.error('הזן סכום'); return }
    if (!category)        { toast.error('בחר קטגוריה'); return }
    const rounded = Math.round(amt)
    add({ date, amount: rounded, category, note: note.trim() })
    // Keep category + date for fast repeated logging; clear amount + note.
    setAmount('')
    setNote('')
    // Jump the viewed month to where the entry landed, so it's visible.
    setSelMonth(date.slice(0, 7))
    toast.success(`נרשם: ${icon(category)} ${category} · ${fmt(amt)}`)

    // Budget alert — does this expense push the category near/over its monthly cap?
    // `entries` here is the pre-add list (closure), so + rounded = the new total.
    const budget = budgets[category]
    if (budget) {
      const ym = date.slice(0, 7)
      const spent = entries
        .filter(e => e.category === category && e.date.slice(0, 7) === ym)
        .reduce((s, e) => s + e.amount, 0) + rounded
      const pct = spent / budget
      if (pct >= 1) {
        toast.error(`⚠️ חריגה מהתקציב ל${category}: ${fmt(spent)} מתוך ${fmt(budget)} (${Math.round(pct * 100)}%)`)
      } else if (pct >= 0.8) {
        toast.warning(`מתקרב לתקציב ל${category}: ${Math.round(pct * 100)}% (${fmt(spent)} מתוך ${fmt(budget)})`)
      }
    }
  }

  const monthEntries = useMemo(
    () => entries
      .filter(e => e.date.slice(0, 7) === selMonth)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt),
    [entries, selMonth],
  )

  const monthTotal = monthEntries.reduce((s, e) => s + e.amount, 0)

  // Category breakdown for the selected month, descending.
  const catTotals = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of monthEntries) map.set(e.category, (map.get(e.category) ?? 0) + e.amount)
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [monthEntries])

  // All months that have any entries, each with its total — for the month dropdown.
  // The current month is always included (even if empty) so you can land on it.
  const monthsWithData = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of entries) {
      const ym = e.date.slice(0, 7)
      map.set(ym, (map.get(ym) ?? 0) + e.amount)
    }
    if (!map.has(currentMonth())) map.set(currentMonth(), 0)
    // The viewed month might be a future month jumped to via the › arrow — keep it selectable.
    if (!map.has(selMonth)) map.set(selMonth, 0)
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [entries, selMonth])

  // Categories at/over 80% of their monthly budget THIS viewed month — for the banner.
  const budgetAlerts = useMemo(
    () => catTotals
      .filter(([cat]) => budgets[cat])
      .map(([cat, sum]) => ({ cat, sum, budget: budgets[cat], pct: sum / budgets[cat] }))
      .filter(b => b.pct >= 0.8)
      .sort((a, b) => b.pct - a.pct),
    [catTotals, budgets],
  )

  // Quick category -> spent-this-month lookup, for the budget editor list.
  const spentByCat = useMemo(() => new Map(catTotals), [catTotals])

  // Rows for the breakdown = every category spent this month, PLUS any budgeted
  // category with no spend yet (so the user sees the full budget picture at 0%).
  const breakdownRows = useMemo(() => {
    const rows = catTotals.map(([cat, sum]) => ({ cat, sum }))
    const present = new Set(catTotals.map(([c]) => c))
    for (const cat of Object.keys(budgets)) {
      if (!present.has(cat)) rows.push({ cat, sum: 0 })
    }
    return rows
  }, [catTotals, budgets])

  // Map the viewed YYYY-MM to a monthly-tab month (jan..dec, year-agnostic).
  const targetMonth = MONTHS_LIST[parseInt(selMonth.slice(5, 7), 10) - 1]

  function transferToMonthly() {
    if (monthEntries.length === 0) { toast.error('אין רישומים להעברה בחודש זה'); return }
    if (!targetMonth) { toast.error('חודש לא תקין'); return }
    initMonth(targetMonth.id)
    applyExpenseLog(targetMonth.id, catTotals.map(([name, amount]) => ({ name, amount })))
    toast.success(`✅ הסיכום הועבר ל${targetMonth.name} בטאב החודשי (${fmt(monthTotal)})`, {
      action: { label: 'פתח חודשי', onClick: () => router.push(`/app/monthly/${targetMonth.id}`) },
    })
  }

  // Group entries by day for the list.
  const byDay = useMemo(() => {
    const map = new Map<string, typeof monthEntries>()
    for (const e of monthEntries) {
      const arr = map.get(e.date) ?? []
      arr.push(e)
      map.set(e.date, arr)
    }
    return [...map.entries()]
  }, [monthEntries])

  return (
    <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6">

      {/* Header */}
      <div className="rounded-xl border border-line bg-surface2 p-4 sm:p-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gold">🧾 תיעוד הוצאות</h1>
        <p className="text-muted-txt text-sm mt-1 hidden sm:block">
          רשמו כל הוצאה ברגע שהיא קורית ושייכו אותה לקטגוריה. יומן עצמאי — לא מתחבר לדוחות או לתקציב החודשי.
        </p>
      </div>

      {/* Quick add */}
      <div className="rounded-xl border border-line bg-surface2 p-4 sm:p-5 space-y-3">
        <div className="text-sm font-semibold text-txt">➕ הוצאה חדשה</div>
        <div className="grid grid-cols-2 sm:grid-cols-[7rem_1fr_8rem_auto] gap-2 sm:gap-3 items-end">
          <div className="space-y-1">
            <label className="text-[11px] text-muted-txt">סכום ₪</label>
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
              placeholder="₪"
              min={0}
              style={{ direction: 'ltr' }}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left tabular-nums"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] text-muted-txt">קטגוריה</label>
            <CategoryPicker
              value={category}
              onChange={setCategory}
              variant="field"
              placeholder="בחר קטגוריה…"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] text-muted-txt">תאריך</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              style={{ direction: 'ltr' }}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt focus:outline-none focus:border-gold/60"
            />
          </div>
          <button
            onClick={handleAdd}
            className="col-span-2 sm:col-span-1 bg-gold/20 hover:bg-gold/30 text-gold border border-gold/40 rounded-lg px-5 py-2 text-sm font-semibold transition-colors whitespace-nowrap"
          >
            הוסף
          </button>
        </div>
        <input
          value={note}
          onChange={e => setNote(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
          placeholder="הערה (לא חובה) — איפה / על מה…"
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60"
        />
      </div>

      {/* Month switcher + total + transfer */}
      <div className="rounded-xl border border-line bg-surface2 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <button onClick={() => setSelMonth(shiftMonth(selMonth, -1))}
              className="w-8 h-8 rounded-lg bg-line text-txt hover:bg-gold/20 transition-colors font-bold shrink-0">›</button>
            <select
              value={selMonth}
              onChange={e => setSelMonth(e.target.value)}
              title="בחר חודש לצפייה"
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-txt focus:outline-none focus:border-gold/60 cursor-pointer min-w-[150px]"
            >
              {monthsWithData.map(([ym, total]) => (
                <option key={ym} value={ym}>
                  {monthLabel(ym)}{total > 0 ? ` · ${fmt(total)}` : ''}
                </option>
              ))}
            </select>
            <button onClick={() => setSelMonth(shiftMonth(selMonth, 1))}
              className="w-8 h-8 rounded-lg bg-line text-txt hover:bg-gold/20 transition-colors font-bold shrink-0">‹</button>
            {selMonth !== currentMonth() && (
              <button onClick={() => setSelMonth(currentMonth())}
                className="text-xs text-gold/80 hover:text-gold transition-colors ms-1 whitespace-nowrap">חזרה לחודש הנוכחי</button>
            )}
          </div>
          <div className="text-end">
            <div className="text-[11px] text-muted-txt">סה&quot;כ החודש</div>
            <div className="text-xl font-black text-expense tabular-nums">{fmt(monthTotal)}</div>
            <div className="text-[11px] text-muted-txt">{monthEntries.length} רישומים</div>
          </div>
        </div>

        {/* Advisor power-action — hidden in the in-app client view to declutter. */}
        {!clientMode && (
          <div className="flex items-center justify-between gap-2 flex-wrap border-t border-line pt-3">
            <span className="text-[11px] text-muted-txt">
              מעביר את סיכום היומן ל{targetMonth?.name ?? '—'} בטאב החודשי — כסעיף נפרד, בלי להשפיע על הייבוא.
            </span>
            <button
              onClick={transferToMonthly}
              disabled={monthEntries.length === 0}
              className="text-sm bg-gold/20 hover:bg-gold/30 text-gold border border-gold/40 rounded-lg px-4 py-1.5 font-semibold transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ⬆ העבר ל{targetMonth?.name ?? ''} בחודשי
            </button>
          </div>
        )}
      </div>

      {/* Budget alert banner — categories at/over 80% of their monthly cap */}
      {budgetAlerts.length > 0 && (
        <div className="rounded-xl border border-gold/40 bg-gold/10 p-4 space-y-2">
          <div className="text-sm font-semibold text-gold">⚠️ קרוב או חורג מהתקציב</div>
          <div className="space-y-1">
            {budgetAlerts.map(({ cat, sum, budget, pct }) => (
              <div key={cat} className="flex items-center justify-between text-xs gap-2">
                <span className="text-txt">{icon(cat)} {cat}</span>
                <span className={`tabular-nums whitespace-nowrap ${pct >= 1 ? 'text-expense' : 'text-gold'}`}>
                  {fmt(sum)} / {fmt(budget)} · {Math.round(pct * 100)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Budget editor — pick ANY category from the full list and set its monthly budget */}
      <div className="rounded-xl border border-line bg-surface2 p-4 sm:p-5 space-y-3">
        <button
          onClick={() => setShowBudgetEditor(v => !v)}
          className="flex items-center justify-between w-full"
        >
          <span className="text-sm font-semibold text-txt">🎯 תקצוב קטגוריות</span>
          <span className="text-xs text-gold/80">{showBudgetEditor ? 'סגירה ▲' : 'פתיחה ▼'}</span>
        </button>
        {showBudgetEditor && (
          <div className="space-y-2">
            <p className="text-[11px] text-muted-txt">
              קבעו תקציב חודשי לכל קטגוריה. השאירו ריק = ללא תקציב. התקציב חל על כל חודש.
            </p>
            <div className="max-h-80 overflow-y-auto space-y-1.5 pe-1">
              {ALL_CATEGORIES.map(cat => {
                const spent = spentByCat.get(cat) ?? 0
                return (
                  <div key={cat} className="flex items-center justify-between gap-2">
                    <span className="text-xs text-txt min-w-0 truncate">
                      {icon(cat)} {cat}
                      {spent > 0 && <span className="text-muted-txt"> · {fmt(spent)} החודש</span>}
                    </span>
                    <input
                      type="number"
                      inputMode="numeric"
                      defaultValue={budgets[cat] || ''}
                      onBlur={e => setBudget(cat, parseFloat(e.target.value) || 0)}
                      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                      placeholder="תקציב ₪"
                      min={0}
                      style={{ direction: 'ltr' }}
                      className="w-24 shrink-0 rounded-md border border-line bg-surface px-2 py-1 text-xs text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left tabular-nums"
                    />
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Category breakdown — spend vs budget, color-coded */}
      {breakdownRows.length > 0 && (
        <div className="rounded-xl border border-line bg-surface2 p-4 sm:p-5 space-y-2.5">
          <div className="text-sm font-semibold text-txt mb-1">פילוח לפי קטגוריה</div>
          {breakdownRows.map(({ cat, sum }) => {
            const budget = budgets[cat]
            const pct = budget ? sum / budget : 0
            const barColor = !budget ? 'bg-gold/60' : pct >= 1 ? 'bg-expense' : pct >= 0.8 ? 'bg-gold' : 'bg-income'
            const textColor = !budget ? 'text-muted-txt' : pct >= 1 ? 'text-expense' : pct >= 0.8 ? 'text-gold' : 'text-income'
            const barWidth = budget ? Math.min(100, pct * 100) : (monthTotal > 0 ? (sum / monthTotal) * 100 : 0)
            return (
              <div key={cat} className="space-y-1">
                <div className="flex items-center justify-between text-xs gap-2">
                  <span className="text-txt shrink-0">{icon(cat)} {cat}</span>
                  <span className={`tabular-nums whitespace-nowrap ${textColor}`}>
                    {budget
                      ? `${fmt(sum)} / ${fmt(budget)} · ${Math.round(pct * 100)}%`
                      : `${fmt(sum)} · ${monthTotal > 0 ? Math.round((sum / monthTotal) * 100) : 0}%`}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-surface overflow-hidden">
                  <div className={`h-full rounded-full ${barColor}`} style={{ width: `${barWidth}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Entries list */}
      {byDay.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface2/50 p-10 text-center">
          <div className="text-4xl mb-2">🧾</div>
          <p className="text-muted-txt text-sm">אין רישומים בחודש זה. הוסיפו הוצאה למעלה כדי להתחיל.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {byDay.map(([day, items]) => {
            const dayTotal = items.reduce((s, e) => s + e.amount, 0)
            return (
              <div key={day} className="rounded-xl border border-line bg-surface2 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 bg-surface3/40 border-b border-line">
                  <span className="text-xs font-semibold text-txt">{dayLabel(day)}</span>
                  <span className="text-xs text-muted-txt tabular-nums">{fmt(dayTotal)}</span>
                </div>
                <div className="divide-y divide-line">
                  {items.map(e => (
                    <div key={e.id} className="group flex items-center gap-3 px-4 py-2.5">
                      <span className="text-lg shrink-0">{icon(e.category)}</span>
                      <div className="flex-1 min-w-0">
                        <CategoryPicker
                          value={e.category}
                          onChange={cat => {
                            update(e.id, { category: cat })
                            const merchant = e.note.replace(/ #\S+$/, '').trim()
                            if (merchant) learn(merchant, cat)
                            toast.success(merchant ? 'עודכן ונלמד לעתיד ✓' : 'הקטגוריה עודכנה ✓')
                          }}
                          variant="plain"
                        />
                        {e.note && <div className="text-xs text-muted-txt truncate">{e.note}</div>}
                      </div>
                      <span className="text-sm font-semibold text-txt tabular-nums shrink-0">{fmt(e.amount)}</span>
                      <button
                        onClick={() => {
                          if (confirm(`למחוק את ההוצאה?\n${icon(e.category)} ${e.category} · ${fmt(e.amount)}`)) {
                            remove(e.id)
                            toast.success('ההוצאה נמחקה')
                          }
                        }}
                        className="shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-muted-txt/70 hover:text-expense active:text-expense sm:opacity-0 sm:group-hover:opacity-100 transition-colors text-lg leading-none"
                        title="מחק הוצאה"
                        aria-label="מחק הוצאה"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
