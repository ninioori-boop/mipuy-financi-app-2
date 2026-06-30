'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { useExpenseLogStore } from '@/stores/expenseLogStore'
import { useCategoryBudgetStore } from '@/stores/categoryBudgetStore'
import { useClientProfileStore } from '@/stores/clientProfileStore'
import { useAuthStore } from '@/stores/authStore'

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function monthLabel(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })
}
const fmt = (n: number) => '₪' + Math.round(n).toLocaleString('he-IL')

// Client home / landing — a warm, simple dashboard the app opens to: a greeting,
// this-month snapshot, and big tappable cards to the tabs. Mobile-first.
export default function HomePage() {
  const entries     = useExpenseLogStore(s => s.entries)
  const budgets     = useCategoryBudgetStore(s => s.budgets)
  const hasBusiness = useClientProfileStore(s => s.hasBusiness)
  const user        = useAuthStore(s => s.user)
  const ym          = currentMonth()
  const firstName   = (user?.displayName || '').trim().split(' ')[0]

  const { total, count, alerts } = useMemo(() => {
    const monthEntries = entries.filter(e => e.date.slice(0, 7) === ym)
    const total = monthEntries.reduce((s, e) => s + e.amount, 0)
    const perCat = new Map<string, number>()
    for (const e of monthEntries) perCat.set(e.category, (perCat.get(e.category) ?? 0) + e.amount)
    let alerts = 0
    for (const [cat, sum] of perCat) {
      const b = budgets[cat]
      if (b && sum / b >= 0.8) alerts++
    }
    return { total, count: monthEntries.length, alerts }
  }, [entries, budgets, ym])

  const tiles = [
    { href: '/app/expenses',    emoji: '🧾', label: 'תיעוד הוצאות', desc: 'רישום וקטלוג' },
    { href: '/app/monthly/jan', emoji: '📅', label: 'תקציב חודשי', desc: 'תכנון מול ביצוע' },
    { href: '/app/trends',      emoji: '📊', label: 'מגמות',        desc: 'גרפים לאורך זמן' },
    { href: '/app/goals',       emoji: '🎯', label: 'יעדים',         desc: 'חיסכון ומטרות' },
    { href: '/app/meetings',    emoji: '📝', label: 'פגישות',       desc: 'סיכומים ומשימות' },
    ...(hasBusiness ? [{ href: '/app/business', emoji: '🏢', label: 'תקציב עסקי', desc: 'הכנסות והוצאות' }] : []),
  ]

  return (
    <div className="max-w-2xl mx-auto space-y-5">

      {/* Greeting */}
      <div className="rounded-2xl border border-gold/30 bg-gradient-to-br from-gold/10 to-transparent p-6 text-center">
        <div className="text-4xl mb-1">👋</div>
        <h1 className="text-xl font-bold text-gold">
          {firstName ? `שלום, ${firstName}` : 'הכלכלן של הבית'}
        </h1>
        <p className="text-muted-txt text-sm mt-1">{monthLabel(ym)}</p>
      </div>

      {/* Month snapshot */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-line bg-surface2 p-4 text-center">
          <div className="text-2xl font-black text-expense tabular-nums">{fmt(total)}</div>
          <div className="text-xs text-muted-txt mt-1">הוצאות החודש</div>
        </div>
        <div className="rounded-xl border border-line bg-surface2 p-4 text-center">
          <div className="text-2xl font-black text-txt tabular-nums">{count}</div>
          <div className="text-xs text-muted-txt mt-1">רישומים</div>
        </div>
      </div>

      {/* Budget alert */}
      {alerts > 0 && (
        <Link
          href="/app/expenses"
          className="block rounded-xl border border-gold/40 bg-gold/10 p-4 hover:bg-gold/15 transition-colors"
        >
          <div className="text-sm font-semibold text-gold">
            ⚠️ {alerts} {alerts === 1 ? 'קטגוריה קרובה' : 'קטגוריות קרובות'} לחריגה מהתקציב
          </div>
          <div className="text-xs text-muted-txt mt-0.5">הקש לפרטים ←</div>
        </Link>
      )}

      {/* Nav tiles — big, accessible */}
      <div className="grid grid-cols-2 gap-3">
        {tiles.map(t => (
          <Link
            key={t.href}
            href={t.href}
            className="rounded-xl border border-line bg-surface2 p-4 hover:border-gold/50 hover:bg-surface3 transition-colors flex flex-col items-center text-center gap-1 min-h-[116px] justify-center"
          >
            <span className="text-3xl leading-none">{t.emoji}</span>
            <span className="text-sm font-semibold text-txt mt-1">{t.label}</span>
            <span className="text-[11px] text-muted-txt">{t.desc}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
