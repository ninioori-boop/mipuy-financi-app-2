'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { useExpenseLogStore } from '@/stores/expenseLogStore'
import { useCategoryBudgetStore } from '@/stores/categoryBudgetStore'
import { useClientProfileStore } from '@/stores/clientProfileStore'
import { useAuthStore } from '@/stores/authStore'
import { hasLabAccess } from '@/lib/labAccess'
import { InsightCards } from '@/components/home/InsightCards'
import { SubscriptionsCard } from '@/components/home/SubscriptionsCard'
import { SafeToSpendToday } from '@/components/home/SafeToSpendToday'
import { EnablePushCard } from '@/components/home/EnablePushCard'
import { BudgetReviewReminder } from '@/components/home/BudgetReviewReminder'

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
// question that matters: "am I OK this month?" A big, calm status card sits on
// top; one prominent "רשום הוצאה" action is always in reach; big readable rows
// lead into the tabs. Mobile-first, tuned for readability + comfort.
export default function HomePage() {
  const entries     = useExpenseLogStore(s => s.entries)
  const budgets     = useCategoryBudgetStore(s => s.budgets)
  const hasBusiness = useClientProfileStore(s => s.hasBusiness)
  const user        = useAuthStore(s => s.user)
  const ym          = currentMonth()
  const firstName   = (user?.displayName || '').trim().split(' ')[0]
  // Subscriptions are lab-gated for now — advisor-only until it's ready for clients.
  const isAdvisor   = hasLabAccess(user?.email)

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
    { href: '/app/expenses',    emoji: '🧾', label: 'תיעוד הוצאות', desc: 'ראה ורשום את ההוצאות שלך' },
    { href: '/app/monthly/jan', emoji: '📅', label: 'תקציב חודשי', desc: 'תכנון מול ביצוע' },
    { href: '/app/checking',    emoji: '💧', label: 'התנהלות עו"ש', desc: 'כמה להשאיר / לחסוך' },
    ...(isAdvisor ? [{ href: '/app/subscriptions', emoji: '🔁', label: 'מנויים קבועים', desc: 'חיובים חוזרים שזיהינו' }] : []),
    { href: '/app/trends',      emoji: '📊', label: 'מגמות',        desc: 'איך אתה מתנהל לאורך זמן' },
    { href: '/app/goals',       emoji: '🎯', label: 'יעדים',         desc: 'חיסכון ומטרות' },
    { href: '/app/meetings',    emoji: '📝', label: 'פגישות',       desc: 'סיכומים ומשימות' },
    ...(hasBusiness ? [{ href: '/app/business', emoji: '🏢', label: 'תקציב עסקי', desc: 'הכנסות והוצאות' }] : []),
  ]

  const barColor  = s.spentFrac >= 1 ? 'bg-expense' : s.spentFrac >= 0.8 ? 'bg-gold' : 'bg-income'
  const overBudget = s.remaining < 0
  const verdictColor =
    s.verdict.tone === 'over' ? 'text-expense' : s.verdict.tone === 'watch' ? 'text-gold' : 'text-income'

  return (
    <div className="max-w-xl mx-auto space-y-5">

      {/* Greeting */}
      <div className="flex items-baseline justify-between gap-2 px-1 pt-1">
        <h1 className="text-2xl font-extrabold text-txt tracking-tight">
          {firstName ? `שלום ${firstName} 👋` : 'הכלכלן של הבית 👋'}
        </h1>
        <span className="text-sm text-muted-txt">{monthLabel(ym)}</span>
      </div>

      {/* STATUS — big & calm: "am I OK this month?" */}
      {s.hasBudget ? (
        <div className="rounded-3xl border border-line bg-surface2 p-6 text-center">
          <div className="text-base font-semibold text-muted-txt">
            {overBudget ? 'חרגת מהתקציב החודשי ב־' : 'נשאר לך החודש'}
          </div>
          <div className={`my-2 text-5xl sm:text-6xl leading-none font-extrabold tracking-tight tabular-nums ${overBudget ? 'text-expense' : 'text-income'}`}>
            {fmt(Math.abs(s.remaining))}
          </div>
          <div className="text-sm text-muted-txt tabular-nums">
            מתוך {fmt(s.totalBudget)} · הוצאת {fmt(s.total)}
          </div>
          <div className="my-4 h-3.5 rounded-full bg-surface border border-line overflow-hidden">
            <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${Math.min(100, s.spentFrac * 100)}%` }} />
          </div>
          <div className={`text-base font-bold ${verdictColor}`}>{s.verdict.text}</div>
          <div className="mt-1 text-sm text-muted-txt">נשארו {s.daysLeft} ימים · {s.count} רישומים החודש</div>
        </div>
      ) : (
        <div className="rounded-3xl border border-line bg-surface2 p-6 text-center">
          <div className="text-base font-semibold text-muted-txt">הוצאת החודש</div>
          <div className="my-2 text-5xl sm:text-6xl leading-none font-extrabold tracking-tight tabular-nums text-txt">
            {fmt(s.total)}
          </div>
          <div className="text-sm text-muted-txt">{s.count} רישומים</div>
        </div>
      )}

      {/* Safe-to-spend-today — lab-gated (advisor-only) for now */}
      {isAdvisor && <SafeToSpendToday />}

      {/* End-of-month budget-review reminder — open to everyone */}
      <BudgetReviewReminder />

      {/* BIG primary action — the thing you do most, always in reach */}
      <Link
        href="/app/expenses"
        className="flex items-center justify-center gap-2 w-full min-h-[58px] rounded-2xl bg-gold text-surface text-lg font-extrabold hover:bg-gold-light active:bg-gold-dark transition-colors shadow-lg shadow-gold/20"
      >
        ➕ רשום הוצאה
      </Link>

      {/* Budget nudge when none set yet */}
      {!s.hasBudget && (
        <Link
          href="/app/expenses"
          className="flex items-center justify-center min-h-[52px] rounded-2xl border border-gold/40 bg-gold/10 px-4 text-center text-sm font-semibold text-gold hover:bg-gold/20 transition-colors"
        >
          💡 הגדר תקציב חודשי כדי לראות כמה נשאר לך
        </Link>
      )}

      {/* Branded push opt-in — renders only where push can actually work */}
      <EnablePushCard />

      {/* Proactive coach insights — the app speaks first */}
      <InsightCards />

      {/* Detected recurring subscriptions — lab-gated (advisor-only) for now */}
      {isAdvisor && <SubscriptionsCard />}

      {/* Empty-state nudge — the app never feels dead on day one */}
      {s.count === 0 && (
        <div className="rounded-2xl border border-dashed border-line bg-surface2/50 p-6 text-center">
          <div className="text-4xl mb-2">💳</div>
          <p className="text-base font-semibold text-txt">עוד לא נרשמו הוצאות החודש</p>
          <p className="mt-1 text-sm text-muted-txt">כל תשלום ב-Google Pay ייכנס לכאן אוטומטית — או הוסף הוצאה ידנית.</p>
        </div>
      )}

      {/* Nav — big, readable rows (easy to scan and tap) */}
      <div className="space-y-3">
        {tiles.map(t => (
          <Link
            key={t.href}
            href={t.href}
            className="flex items-center gap-4 p-4 min-h-[74px] rounded-2xl border border-line bg-surface2 hover:border-gold/50 hover:bg-surface3 transition-colors"
          >
            <span className="w-[52px] h-[52px] shrink-0 grid place-items-center rounded-2xl text-2xl bg-gold/10 border border-gold/20">
              {t.emoji}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-lg font-bold text-txt">{t.label}</span>
              <span className="block text-sm text-muted-txt truncate">{t.desc}</span>
            </span>
            <span dir="ltr" className="text-xl text-muted-txt">‹</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
