'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useExpenseLogStore } from '@/stores/expenseLogStore'
import { useCategoryBudgetStore } from '@/stores/categoryBudgetStore'
import { useMonthlyStore } from '@/stores/monthlyStore'
import { useCreditStore } from '@/stores/creditStore'
import { CATEGORY_ICONS, MONTHS_LIST, ALL_CATEGORIES } from '@/lib/constants'
import { CategoryPicker } from '@/components/shared/CategoryPicker'
import { EditEntrySheet } from '@/components/expenses/EditEntrySheet'
import { SmartBudgetSuggest } from '@/components/expenses/SmartBudgetSuggest'
import { useClientMode } from '@/hooks/useClientMode'
import { useRecurringStore } from '@/stores/recurringStore'
import { computeBudgetStatus } from '@/lib/budgetStatus'
import { notifyBudget } from '@/lib/budgetToast'

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

// Entries sitting on these payment-method placeholders carry a generic string
// ("העברה בביט", "משיכת מזומן") as their "merchant" — not a real business.
// Learning it would override the placeholder for every future Bit/ATM charge,
// and through the shared pool poison every account. Fix the entry, never learn.
const NO_LEARN_CATS = new Set(['ביט ללא מעקב', 'מזומן ללא מעקב'])

export default function ExpensesPage() {
  const router = useRouter()
  const clientMode = useClientMode()   // in-app: declutter for the phone
  const { entries, add, update, remove } = useExpenseLogStore()
  const { budgets, setBudget } = useCategoryBudgetStore()
  const { months, initMonth, applyExpenseLog } = useMonthlyStore()
  const learn = useCreditStore(s => s.learn)   // shared learnedDB — same teaching as credit/import
  const { rules, add: addRule, update: updateRule, remove: removeRule } = useRecurringStore()

  const [selMonth, setSelMonth] = useState(currentMonth())
  const [showBudgetEditor, setShowBudgetEditor] = useState(false)
  const [showRecurring, setShowRecurring] = useState(false)
  const [showAllBudgetCats, setShowAllBudgetCats] = useState(false)
  const [amount, setAmount]     = useState('')
  const [category, setCategory] = useState('')
  const [note, setNote]         = useState('')
  const [date, setDate]         = useState(today())
  const [editingId, setEditingId] = useState<string | null>(null)

  // Deep-link from the home budget-review reminder: #budget opens the editor.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hash === '#budget') {
      setShowBudgetEditor(true)
    }
  }, [])
  const editingEntry = editingId ? entries.find(e => e.id === editingId) ?? null : null

  // Recurring-rule add form
  const [rName, setRName] = useState('')
  const [rAmount, setRAmount] = useState('')
  const [rCategory, setRCategory] = useState('')
  const [rDay, setRDay] = useState('1')

  function handleAddRule() {
    const amt = parseFloat(rAmount)
    const day = parseInt(rDay, 10)
    if (!rName.trim())            { toast.error('תן שם להוצאה (למשל "שכר דירה")'); return }
    if (!amt || amt <= 0)         { toast.error('הזן סכום'); return }
    if (!rCategory)               { toast.error('בחר קטגוריה'); return }
    if (!day || day < 1 || day > 28) { toast.error('יום בחודש: 1 עד 28'); return }
    addRule({ name: rName.trim(), amount: Math.round(amt), category: rCategory, dayOfMonth: day })
    setRName(''); setRAmount('')
    toast.success(`⟳ נוסף: ${rName.trim()} — יירשם אוטומטית כל חודש ב-${day} בחודש`)
  }

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
    // `entries` here is the pre-add list (closure), so addedAmount folds in the new charge.
    notifyBudget(
      computeBudgetStatus({ budgets, entries, category, addedAmount: rounded, ym: date.slice(0, 7) }),
      category,
    )
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

  // Auto-captured entries that need a human to pick the right category — the
  // catch-all 'שונות' plus the payment-method placeholders ('ביט ללא מעקב',
  // 'מזומן ללא מעקב') that Bit/cash transfers land on. Note carries the
  // ingestion #ref. Surfaced for a one-tap fix that also learns for next time.
  const REVIEW_CATS = useMemo(() => new Set(['שונות', 'ביט ללא מעקב', 'מזומן ללא מעקב']), [])
  const pendingReview = useMemo(
    () => monthEntries.filter(e => REVIEW_CATS.has(e.category) && / #\S+$/.test(e.note)),
    [monthEntries, REVIEW_CATS],
  )

  // One-tap suggestion chips: the user's most-used categories, padded with
  // sensible defaults — so the likely fix is always a single tap away.
  const suggestedCats = useMemo(() => {
    const freq = new Map<string, number>()
    for (const e of entries) {
      if (e.category !== 'שונות') freq.set(e.category, (freq.get(e.category) ?? 0) + 1)
    }
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c)
    const defaults = ['מזון לבית', 'אוכל בחוץ ובילויים', 'דלק וחניה', 'פארם', 'הוצאות בית', 'בריאות']
    return [...new Set([...top, ...defaults])].slice(0, 6)
  }, [entries])

  // Default the add-form category to the user's top category once (while still
  // empty), so the hot path is just "type amount → Enter". Once the user picks a
  // category it sticks — handleAdd keeps category+date between adds.
  useEffect(() => {
    if (!category && suggestedCats.length > 0) setCategory(suggestedCats[0])
  }, [suggestedCats, category])

  function fixCategory(id: string, note: string, fromCat: string, cat: string) {
    update(id, { category: cat })
    const merchant = note.replace(/ #\S+$/, '').trim()
    const teach = Boolean(merchant) && !NO_LEARN_CATS.has(fromCat)
    if (teach) learn(merchant, cat)
    toast.success(teach ? `${icon(cat)} קוטלג ל${cat} — ונלמד לפעם הבאה ✓` : `${icon(cat)} קוטלג ל${cat} ✓`)
  }

  // One-tap budget adoption: pull the current calendar month's PLAN values from
  // the monthly-budget tab (the advisor already built them there) into the
  // per-category budgets here. Only rows whose name is a real category are
  // taken; multiple rows of the same category sum up.
  function adoptFromMonthly() {
    const mid = MONTHS_LIST[new Date().getMonth()]?.id
    const m = mid ? months[mid] : undefined
    if (!m) { toast.error('אין עדיין תקציב חודשי לחודש הנוכחי'); return }
    const catSet = new Set(ALL_CATEGORIES)
    const plans = new Map<string, number>()
    for (const sec of ['fixed', 'variable', 'sub', 'ins'] as const) {
      for (const r of m[sec] ?? []) {
        if (r.plan > 0 && catSet.has(r.name)) plans.set(r.name, (plans.get(r.name) ?? 0) + r.plan)
      }
    }
    if (plans.size === 0) { toast.error('לא נמצאו סעיפים עם תקציב מתוכנן בחודש הנוכחי'); return }
    for (const [cat, plan] of plans) setBudget(cat, Math.round(plan))
    toast.success(`⚡ אומצו ${plans.size} תקציבים מהתקציב החודשי`)
  }

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

  // Budget-editor rows: clients get a short list (budgeted + most-used) so they
  // don't scroll 44 rows on a phone; "הצג הכל" reveals the full list. Advisor = full.
  const budgetEditorCats = useMemo(() => {
    if (!clientMode || showAllBudgetCats) return ALL_CATEGORIES
    const keep = new Set<string>([
      ...ALL_CATEGORIES.filter(c => (budgets[c] ?? 0) > 0),
      ...suggestedCats,
    ])
    return ALL_CATEGORIES.filter(c => keep.has(c))
  }, [clientMode, showAllBudgetCats, budgets, suggestedCats])

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
      <div className="flex items-baseline justify-between gap-2 px-1 pt-1">
        <h1 className="text-2xl font-extrabold text-gold tracking-tight">🧾 תיעוד הוצאות</h1>
        <p className="text-muted-txt text-sm hidden sm:block">יומן עצמאי — לא מתחבר לדוחות</p>
      </div>

      {/* Quick add — the primary action, big & prominent */}
      <div className="rounded-3xl border border-line bg-surface2 p-5 space-y-3">
        <div className="text-lg font-bold text-txt">➕ הוצאה חדשה</div>
        <div className="grid grid-cols-2 sm:grid-cols-[8rem_1fr_9rem_auto] gap-2.5 items-end">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-txt">סכום ₪</label>
            <input
              type="number"
              inputMode="numeric"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
              placeholder="₪"
              min={0}
              style={{ direction: 'ltr' }}
              className="w-full rounded-xl border border-line bg-surface px-3.5 min-h-[52px] text-lg text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left tabular-nums"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-txt">קטגוריה</label>
            <CategoryPicker
              value={category}
              onChange={setCategory}
              suggested={suggestedCats}
              variant="field"
              placeholder="בחר קטגוריה…"
              className="min-h-[52px]"
            />
          </div>
          <div className="space-y-1.5 col-span-2 sm:col-span-1">
            <label className="text-xs text-muted-txt">תאריך</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              style={{ direction: 'ltr' }}
              className="w-full rounded-xl border border-line bg-surface px-3.5 min-h-[52px] text-sm text-txt focus:outline-none focus:border-gold/60"
            />
          </div>
          <button
            onClick={handleAdd}
            className="col-span-2 sm:col-span-1 min-h-[52px] bg-gold text-surface rounded-xl px-6 text-base font-extrabold hover:bg-gold-light active:bg-gold-dark transition-colors whitespace-nowrap"
          >
            הוסף
          </button>
        </div>
        <input
          value={note}
          onChange={e => setNote(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
          placeholder="הערה (לא חובה) — איפה / על מה…"
          className="w-full rounded-xl border border-line bg-surface px-3.5 min-h-[48px] text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60"
        />
      </div>

      {/* Month switcher + total + transfer */}
      <div className="rounded-2xl border border-line bg-surface2 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
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
                className="text-xs text-gold/80 hover:text-gold transition-colors ms-1 whitespace-nowrap py-2 min-h-[36px]">חזרה לחודש הנוכחי</button>
            )}
          </div>
          <div className="text-end">
            <div className="text-xs text-muted-txt">סה&quot;כ החודש</div>
            <div className="text-3xl font-extrabold text-expense tabular-nums tracking-tight">{fmt(monthTotal)}</div>
            <div className="text-xs text-muted-txt">{monthEntries.length} רישומים</div>
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

      {/* One-tap review — auto-captured charges awaiting a precise category */}
      {pendingReview.length > 0 && (
        <div className="rounded-xl border border-gold/40 bg-gold/5 p-4 space-y-3">
          <div className="text-sm font-semibold text-gold">
            🏷️ {pendingReview.length === 1 ? 'הוצאה אחת ממתינה' : `${pendingReview.length} הוצאות ממתינות`} לקטלוג — הקש על הקטגוריה הנכונה
          </div>
          <div className="space-y-3">
            {pendingReview.map(e => {
              const merchant = e.note.replace(/ #\S+$/, '').trim()
              return (
                <div key={e.id} className="space-y-1.5 border-t border-line/60 pt-2.5 first:border-t-0 first:pt-0">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-txt truncate">{merchant || 'ללא שם'}</span>
                    <span className="font-semibold text-txt tabular-nums shrink-0">{fmt(e.amount)}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 items-center">
                    {suggestedCats.map(cat => (
                      <button
                        key={cat}
                        onClick={() => fixCategory(e.id, e.note, e.category, cat)}
                        className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-txt hover:border-gold/60 hover:text-gold active:bg-gold/10 transition-colors min-h-[36px]"
                      >
                        {icon(cat)} {cat}
                      </button>
                    ))}
                    <div className="min-w-[7.5rem]">
                      <CategoryPicker
                        value=""
                        onChange={cat => fixCategory(e.id, e.note, e.category, cat)}
                        suggested={suggestedCats}
                        variant="field"
                        placeholder="עוד…"
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

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
          className="flex items-center justify-between w-full py-2 min-h-[44px]"
        >
          <span className="text-sm font-semibold text-txt">🎯 תקצוב קטגוריות</span>
          <span className="text-xs text-gold/80">{showBudgetEditor ? 'סגירה ▲' : 'פתיחה ▼'}</span>
        </button>
        {showBudgetEditor && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-[11px] text-muted-txt">
                קבע תקציב חודשי לכל קטגוריה. השאר ריק = ללא תקציב. התקציב חל על כל חודש.
              </p>
              <button
                onClick={adoptFromMonthly}
                className="text-xs bg-gold/15 hover:bg-gold/25 text-gold border border-gold/40 rounded-lg px-3 py-2 min-h-[36px] font-semibold transition-colors whitespace-nowrap"
              >
                ⚡ אמץ מהתקציב החודשי
              </button>
            </div>
            <SmartBudgetSuggest />
            <div className="max-h-80 overflow-y-auto space-y-1.5 pe-1">
              {budgetEditorCats.map(cat => {
                const spent = spentByCat.get(cat) ?? 0
                return (
                  <div key={cat} className="flex items-center justify-between gap-2">
                    <span className="text-xs text-txt min-w-0 truncate">
                      {icon(cat)} {cat}
                      {spent > 0 && <span className="text-muted-txt"> · {fmt(spent)} החודש</span>}
                    </span>
                    <input
                      key={`${cat}:${budgets[cat] ?? ''}`}
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
            {clientMode && !showAllBudgetCats && (
              <button
                onClick={() => setShowAllBudgetCats(true)}
                className="text-xs text-gold/80 hover:text-gold transition-colors py-2 min-h-[36px]"
              >
                הצג את כל הקטגוריות
              </button>
            )}
          </div>
        )}
      </div>

      {/* Recurring fixed expenses — defined once, auto-posted every month */}
      <div className="rounded-xl border border-line bg-surface2 p-4 sm:p-5 space-y-3">
        <button
          onClick={() => setShowRecurring(v => !v)}
          className="flex items-center justify-between w-full py-2 min-h-[44px]"
        >
          <span className="text-sm font-semibold text-txt">
            ⟳ הוצאות קבועות{rules.length > 0 ? ` (${rules.length})` : ''}
          </span>
          <span className="text-xs text-gold/80">{showRecurring ? 'סגירה ▲' : 'פתיחה ▼'}</span>
        </button>
        {showRecurring && (
          <div className="space-y-3">
            <p className="text-[11px] text-muted-txt">
              שכ&quot;ד, מנויים, ביטוחים — מגדיר פעם אחת, וההוצאה נרשמת לבד ביומן כל חודש ביום שקבעת.
            </p>

            {rules.length > 0 && (
              <div className="space-y-1">
                {rules.map(r => (
                  <div key={r.id} className="flex items-center gap-2 text-xs">
                    <button
                      onClick={() => updateRule(r.id, { active: !r.active })}
                      title={r.active ? 'השהה' : 'הפעל'}
                      aria-label={r.active ? 'השהה הוצאה קבועה' : 'הפעל הוצאה קבועה'}
                      className={[
                        'shrink-0 w-9 h-9 rounded-lg border flex items-center justify-center transition-colors',
                        r.active
                          ? 'border-income/40 bg-income/10 text-income'
                          : 'border-line bg-surface text-muted-txt',
                      ].join(' ')}
                    >
                      {r.active ? '✓' : '⏸'}
                    </button>
                    <span className={`flex-1 min-w-0 truncate ${r.active ? 'text-txt' : 'text-muted-txt line-through'}`}>
                      {icon(r.category)} {r.name} · כל {r.dayOfMonth} בחודש
                    </span>
                    <span className="tabular-nums text-txt shrink-0 font-semibold">{fmt(r.amount)}</span>
                    <button
                      onClick={() => { removeRule(r.id); toast.success('ההוצאה הקבועה הוסרה') }}
                      title="הסר"
                      aria-label="הסר הוצאה קבועה"
                      className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-muted-txt/70 hover:text-expense transition-colors text-base leading-none"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-[1fr_6rem_9rem_5rem_auto] gap-2 items-end border-t border-line pt-3">
              <div className="space-y-1 col-span-2 sm:col-span-1">
                <label className="text-[11px] text-muted-txt">שם ההוצאה</label>
                <input
                  value={rName}
                  onChange={e => setRName(e.target.value)}
                  placeholder='למשל: שכר דירה'
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-txt">סכום ₪</label>
                <input
                  type="number"
                  inputMode="numeric"
                  value={rAmount}
                  onChange={e => setRAmount(e.target.value)}
                  placeholder="₪"
                  min={0}
                  style={{ direction: 'ltr' }}
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-txt">קטגוריה</label>
                <CategoryPicker
                  value={rCategory}
                  onChange={setRCategory}
                  suggested={suggestedCats}
                  variant="field"
                  placeholder="בחר…"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-txt">יום בחודש</label>
                <input
                  type="number"
                  inputMode="numeric"
                  value={rDay}
                  onChange={e => setRDay(e.target.value)}
                  min={1}
                  max={28}
                  style={{ direction: 'ltr' }}
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-txt focus:outline-none focus:border-gold/60 text-left tabular-nums"
                />
              </div>
              <button
                onClick={handleAddRule}
                className="col-span-2 sm:col-span-1 bg-gold/20 hover:bg-gold/30 text-gold border border-gold/40 rounded-lg px-5 py-2 min-h-[40px] text-sm font-semibold transition-colors whitespace-nowrap"
              >
                הוסף
              </button>
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
                  <span className="text-txt min-w-0 truncate">{icon(cat)} {cat}</span>
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
        <div className="rounded-xl border border-dashed border-line bg-surface2/50 p-6 sm:p-10 text-center">
          <div className="text-4xl mb-2">🧾</div>
          <p className="text-muted-txt text-sm">אין רישומים בחודש זה. הוסף הוצאה למעלה כדי להתחיל.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {byDay.map(([day, items]) => {
            const dayTotal = items.reduce((s, e) => s + e.amount, 0)
            return (
              <div key={day} className="rounded-2xl border border-line bg-surface2 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 bg-surface3/40 border-b border-line">
                  <span className="text-sm font-bold text-txt">{dayLabel(day)}</span>
                  <span className="text-sm text-muted-txt tabular-nums">{fmt(dayTotal)}</span>
                </div>
                <div className="divide-y divide-line">
                  {items.map(e => (
                    <div key={e.id} className="group flex items-center gap-2.5 sm:gap-3.5 px-3 sm:px-4 py-3">
                      <span className="w-11 h-11 shrink-0 grid place-items-center rounded-xl text-xl bg-gold/10 border border-gold/20">{icon(e.category)}</span>
                      <div className="flex-1 min-w-0">
                        <CategoryPicker
                          value={e.category}
                          suggested={suggestedCats}
                          onChange={cat => {
                            update(e.id, { category: cat })
                            const merchant = e.note.replace(/ #\S+$/, '').trim()
                            const teach = Boolean(merchant) && !NO_LEARN_CATS.has(e.category)
                            if (teach) learn(merchant, cat)
                            toast.success(teach ? 'עודכן ונלמד לעתיד ✓' : 'הקטגוריה עודכנה ✓')
                          }}
                          variant="plain"
                          className="!text-base font-semibold min-h-[44px]"
                        />
                        {e.note && <div className="text-sm text-muted-txt truncate">{e.note}</div>}
                      </div>
                      <span className="text-lg font-bold text-txt tabular-nums shrink-0">{fmt(e.amount)}</span>
                      <button
                        onClick={() => setEditingId(e.id)}
                        className="shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-muted-txt/70 hover:text-gold active:text-gold sm:opacity-0 sm:group-hover:opacity-100 transition-colors text-lg leading-none"
                        title="ערוך הוצאה"
                        aria-label="ערוך הוצאה"
                      >
                        ✎
                      </button>
                      <button
                        onClick={() => {
                          const gone = e
                          remove(e.id)
                          toast.success('ההוצאה נמחקה', {
                            action: {
                              label: 'ביטול',
                              onClick: () => add({ date: gone.date, amount: gone.amount, category: gone.category, note: gone.note }),
                            },
                          })
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

      {editingEntry && (
        <EditEntrySheet
          entry={editingEntry}
          suggested={suggestedCats}
          onClose={() => setEditingId(null)}
          onSave={patch => {
            update(editingEntry.id, patch)
            // If the category changed here, teach the shared DB — same loop as the
            // inline row picker (guarded against the Bit/cash placeholders).
            if (patch.category !== editingEntry.category) {
              const merchant = patch.note.replace(/ #\S+$/, '').trim()
              if (merchant && !NO_LEARN_CATS.has(editingEntry.category)) learn(merchant, patch.category)
            }
            toast.success('ההוצאה עודכנה ✓')
          }}
        />
      )}
    </div>
  )
}
