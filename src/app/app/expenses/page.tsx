'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useExpenseLogStore } from '@/stores/expenseLogStore'
import { useMonthlyStore } from '@/stores/monthlyStore'
import { useCreditStore } from '@/stores/creditStore'
import { CATEGORY_ICONS, MONTHS_LIST } from '@/lib/constants'
import { CategoryPicker } from '@/components/shared/CategoryPicker'

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
  const { entries, add, update, remove } = useExpenseLogStore()
  const { initMonth, applyExpenseLog } = useMonthlyStore()
  const learn = useCreditStore(s => s.learn)   // shared learnedDB — same teaching as credit/import

  const [selMonth, setSelMonth] = useState(currentMonth())
  const [amount, setAmount]     = useState('')
  const [category, setCategory] = useState('')
  const [note, setNote]         = useState('')
  const [date, setDate]         = useState(today())

  function handleAdd() {
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) { toast.error('הזן סכום'); return }
    if (!category)        { toast.error('בחר קטגוריה'); return }
    add({ date, amount: Math.round(amt), category, note: note.trim() })
    // Keep category + date for fast repeated logging; clear amount + note.
    setAmount('')
    setNote('')
    // Jump the viewed month to where the entry landed, so it's visible.
    setSelMonth(date.slice(0, 7))
    toast.success(`נרשם: ${icon(category)} ${category} · ${fmt(amt)}`)
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
    <div className="max-w-4xl mx-auto space-y-6">

      {/* Header */}
      <div className="rounded-xl border border-line bg-surface2 p-6">
        <h1 className="text-2xl font-bold text-gold mb-1">🧾 תיעוד הוצאות</h1>
        <p className="text-muted-txt text-sm">
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
              className="w-8 h-8 rounded-lg bg-line text-txt hover:bg-gold/20 transition-colors font-bold">›</button>
            <span className="text-sm font-semibold text-txt min-w-[120px] text-center">{monthLabel(selMonth)}</span>
            <button onClick={() => setSelMonth(shiftMonth(selMonth, 1))}
              className="w-8 h-8 rounded-lg bg-line text-txt hover:bg-gold/20 transition-colors font-bold">‹</button>
            {selMonth !== currentMonth() && (
              <button onClick={() => setSelMonth(currentMonth())}
                className="text-xs text-gold/80 hover:text-gold transition-colors ms-1">חזרה לחודש הנוכחי</button>
            )}
          </div>
          <div className="text-end">
            <div className="text-[11px] text-muted-txt">סה&quot;כ החודש</div>
            <div className="text-xl font-black text-expense tabular-nums">{fmt(monthTotal)}</div>
            <div className="text-[11px] text-muted-txt">{monthEntries.length} רישומים</div>
          </div>
        </div>

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
      </div>

      {/* Category breakdown */}
      {catTotals.length > 0 && (
        <div className="rounded-xl border border-line bg-surface2 p-4 sm:p-5 space-y-2.5">
          <div className="text-sm font-semibold text-txt mb-1">פילוח לפי קטגוריה</div>
          {catTotals.map(([cat, sum]) => (
            <div key={cat} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-txt">{icon(cat)} {cat}</span>
                <span className="text-muted-txt tabular-nums">
                  {fmt(sum)} · {Math.round((sum / monthTotal) * 100)}%
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-surface overflow-hidden">
                <div className="h-full bg-gold/60 rounded-full" style={{ width: `${(sum / monthTotal) * 100}%` }} />
              </div>
            </div>
          ))}
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
                        onClick={() => remove(e.id)}
                        className="text-muted-txt hover:text-expense transition-colors opacity-0 group-hover:opacity-100 text-sm leading-none shrink-0"
                        title="מחק"
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
