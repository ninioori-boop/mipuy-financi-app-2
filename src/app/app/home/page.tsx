'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { useExpenseLogStore } from '@/stores/expenseLogStore'
import { useCategoryBudgetStore } from '@/stores/categoryBudgetStore'
import { useClientProfileStore } from '@/stores/clientProfileStore'
import { useAuthStore } from '@/stores/authStore'
import { InsightCards } from '@/components/home/InsightCards'

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function monthLabel(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })
}
const fmt = (n: number) => '₪' + Math.round(n).toLocaleString('he-IL')

// Client home / landing — the app's front door. One glance answers the only
// question that matters: "am I OK this month?" A hero status card (money left +
// pace verdict) sits on top; big tappable cards lead into the tabs. Mobile-first.
export default function HomePage() {
  const entries     = useExpenseLogStore(s => s.entries)
  const budgets     = useCategoryBudgetStore(s => s.budgets)
  const hasBusiness = useClientProfileStore(s => s.hasBusiness)
  const user        = useAuthStore(s => s.user)
  const ym          = currentMonth()
  const firstName   = (user?.displayName || '').trim().split(' ')[0]

  const s = useMemo(() => {
    const now = new Date()
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const dayOfMonth  = now.getDate()
    const daysLeft    = Math.max(0, daysInMonth - dayOfMonth)
    const elapsed     = dayOfMonth / daysInMonth   // 0..1 of the month gone by

    const monthEntries = entries.filter(e => e.date.slice(0, 7) === ym)
    const total = monthEntries.reduce((sum, e) => sum + e.amount, 0)

    // Total monthly budget = sum of all per-category caps the client has set.
    const totalBudget = Object.values(budgets).reduce((sum, b) => sum + (b || 0), 0)
    const hasBudget   = totalBudget > 0
    const remaining   = totalBudget - total
    const spentFrac   = hasBudget ? total / totalBudget : 0

    // Per-category alerts (>=80% of that category's cap).
    const perCat = new Map<string, number>()
    for (const e of monthEntries) perCat.set(e.category, (perCat.get(e.category) ?? 0) + e.amount)
    let alerts = 0
    for (const [cat, sum] of perCat) {
      const b = budgets[cat]
      if (b && sum / b >= 0.8) alerts++
    }

    // Pace verdict — am I spending faster than the month is passing?
    let verdict: { text: string; tone: 'good' | 'watch' | 'over' } = { text: '', tone: 'good' }
    if (hasBudget) {
      if (spentFrac >= 1)                       verdict = { text: 'חרגת מהתקציב החודשי', tone: 'over' }
      else if (spentFrac > elapsed + 0.1)       verdict = { text: 'הקצב מהיר — שווה להאט קצת', tone: 'watch' }
      else                                       verdict = { text: 'אתה בקצב טוב, כל הכבוד 👍', tone: 'good' }
    }

    return { total, count: monthEntries.length, totalBudget, hasBudget, remaining, spentFrac, alerts, daysLeft, verdict }
  }, [entries, budgets, ym])

  const tiles = [
    { href: '/app/expenses',    emoji: '🧾', label: 'תיעוד הוצאות', desc: 'רישום וקטלוג' },
    { href: '/app/monthly/jan', emoji: '📅', label: 'תקציב חודשי', desc: 'תכנון מול ביצוע' },
    { href: '/app/checking',    emoji: '💧', label: 'התנהלות עו"ש', desc: 'כמה להשאיר / לחסוך' },
    { href: '/app/trends',      emoji: '📊', label: 'מגמות',        desc: 'גרפים לאורך זמן' },
    { href: '/app/goals',       emoji: '🎯', label: 'יעדים',         desc: 'חיסכון ומטרות' },
    { href: '/app/meetings',    emoji: '📝', label: 'פגישות',       desc: 'סיכומים ומשימות' },
    ...(hasBusiness ? [{ href: '/app/business', emoji: '🏢', label: 'תקציב עסקי', desc: 'הכנסות והוצאות' }] : []),
  ]

  const barColor  = s.spentFrac >= 1 ? 'bg-expense' : s.spentFrac >= 0.8 ? 'bg-gold' : 'bg-income'
  const overBudget = s.remaining < 0
  const verdictColor =
    s.verdict.tone === 'over' ? 'text-expense' : s.verdict.tone === 'watch' ? 'text-gold' : 'text-income'

  return (
    <div className="max-w-2xl mx-auto space-y-4">

      {/* Greeting */}
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-lg font-bold text-txt">
          {firstName ? `שלום, ${firstName} 👋` : 'הכלכלן של הבית 👋'}
        </h1>
        <span className="text-xs text-muted-txt">{monthLabel(ym)}</span>
      </div>

      {/* HERO — "am I OK?" */}
      {s.hasBudget ? (
        <div className="rounded-2xl border border-gold/30 bg-gradient-to-br from-gold/10 to-transparent p-6 text-center space-y-3">
          <div className="text-xs text-muted-txt">{overBudget ? 'חרגת מהתקציב החודשי ב־' : 'נשאר לך החודש'}</div>
          <div className={`text-4xl sm:text-[2.75rem] leading-none font-black tabular-nums ${overBudget ? 'text-expense' : 'text-income'}`}>
            {fmt(Math.abs(s.remaining))}
          </div>
          <div className="text-xs text-muted-txt tabular-nums">
            הוצאת {fmt(s.total)} מתוך {fmt(s.totalBudget)}
          </div>

          {/* Progress */}
          <div className="h-2 rounded-full bg-surface overflow-hidden">
            <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${Math.min(100, s.spentFrac * 100)}%` }} />
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className={`font-semibold ${verdictColor}`}>{s.verdict.text}</span>
            <span className="text-muted-txt">נשארו {s.daysLeft} ימים</span>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-gold/30 bg-gradient-to-br from-gold/10 to-transparent p-6 text-center space-y-3">
          <div className="text-xs text-muted-txt">הוצאת החודש</div>
          <div className="text-4xl sm:text-[2.75rem] leading-none font-black tabular-nums text-expense">{fmt(s.total)}</div>
          <Link
            href="/app/expenses"
            className="inline-flex items-center justify-center min-h-[44px] rounded-lg border border-gold/40 bg-gold/10 px-4 py-2 text-xs font-semibold text-gold hover:bg-gold/20 transition-colors"
          >
            💡 הגדר תקציב חודשי כדי לראות כמה נשאר לך
          </Link>
        </div>
      )}

      {/* Proactive coach insights — the app speaks first */}
      <InsightCards />

      {/* Secondary stats + budget alert */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-line bg-surface2 p-4 text-center">
          <div className="text-2xl font-black text-txt tabular-nums">{s.count}</div>
          <div className="text-xs text-muted-txt mt-1">רישומים החודש</div>
        </div>
        <Link
          href="/app/expenses"
          className={[
            'rounded-xl border p-4 text-center transition-colors flex flex-col justify-center',
            s.alerts > 0
              ? 'border-gold/40 bg-gold/10 hover:bg-gold/15'
              : 'border-line bg-surface2 hover:bg-surface3',
          ].join(' ')}
        >
          <div className={`text-2xl font-black tabular-nums ${s.alerts > 0 ? 'text-gold' : 'text-income'}`}>
            {s.alerts > 0 ? `⚠️ ${s.alerts}` : '✓'}
          </div>
          <div className="text-xs text-muted-txt mt-1">
            {s.alerts > 0 ? 'קטגוריות קרובות לחריגה' : 'הכל בתוך התקציב'}
          </div>
        </Link>
      </div>

      {/* Empty-state nudge — the app never feels dead on day one */}
      {s.count === 0 && (
        <div className="rounded-xl border border-dashed border-line bg-surface2/50 p-5 text-center">
          <div className="text-3xl mb-1">💳</div>
          <p className="text-sm text-txt font-semibold">עוד לא נרשמו הוצאות החודש</p>
          <p className="text-xs text-muted-txt mt-1">כל תשלום ב-Google Pay ייכנס לכאן אוטומטית — או הוסף הוצאה ידנית בתיעוד ההוצאות.</p>
        </div>
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
