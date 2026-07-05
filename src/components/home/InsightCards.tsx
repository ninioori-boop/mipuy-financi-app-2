'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { useExpenseLogStore } from '@/stores/expenseLogStore'
import { useCategoryBudgetStore } from '@/stores/categoryBudgetStore'
import { CATEGORY_ICONS } from '@/lib/constants'

const fmt  = (n: number) => '₪' + Math.round(n).toLocaleString('he-IL')
const icon = (c: string) => CATEGORY_ICONS[c] ?? '📦'

type Tone = 'good' | 'watch' | 'over' | 'info'
interface Insight { key: string; tone: Tone; text: string; href?: string }

const TONE_BORDER: Record<Tone, string> = {
  good:  'border-s-income',
  watch: 'border-s-gold',
  over:  'border-s-expense',
  info:  'border-s-line',
}

/**
 * Proactive coach cards — the app speaks first. Computed purely from the local
 * expense log + category budgets (no server, no push): per-category warnings
 * BEFORE an overrun, positive reinforcement, and pace vs. last month. At most
 * 3 cards, priority-ordered; renders nothing when there's nothing to say.
 */
export function InsightCards() {
  const entries = useExpenseLogStore(s => s.entries)
  const budgets = useCategoryBudgetStore(s => s.budgets)

  const insights = useMemo<Insight[]>(() => {
    const now = new Date()
    const ym  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const prevYm = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`
    const dayOfMonth  = now.getDate()
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const daysLeft    = Math.max(0, daysInMonth - dayOfMonth)
    const todayIso    = `${ym}-${String(dayOfMonth).padStart(2, '0')}`

    const monthEntries = entries.filter(e => e.date.slice(0, 7) === ym)
    const prevEntries  = entries.filter(e => e.date.slice(0, 7) === prevYm)
    const total = monthEntries.reduce((s, e) => s + e.amount, 0)

    const perCat = new Map<string, number>()
    for (const e of monthEntries) perCat.set(e.category, (perCat.get(e.category) ?? 0) + e.amount)

    const out: Insight[] = []

    // 1+2 — per-category budget status: overruns first, then near-limit warnings.
    const budgeted = [...perCat.entries()]
      .filter(([cat]) => budgets[cat] > 0)
      .map(([cat, sum]) => ({ cat, sum, budget: budgets[cat], pct: sum / budgets[cat] }))
      .sort((a, b) => b.pct - a.pct)
    for (const b of budgeted.filter(b => b.pct >= 1).slice(0, 2)) {
      out.push({
        key: `over-${b.cat}`, tone: 'over', href: '/app/expenses',
        text: `⚠️ חריגה מתקציב ${b.cat}: ${fmt(b.sum)} מתוך ${fmt(b.budget)}`,
      })
    }
    for (const b of budgeted.filter(b => b.pct >= 0.8 && b.pct < 1).slice(0, 2)) {
      out.push({
        key: `near-${b.cat}`, tone: 'watch', href: '/app/expenses',
        text: `${icon(b.cat)} תקציב ${b.cat} ב־${Math.round(b.pct * 100)}% — נשארו ${daysLeft} ימים לחודש`,
      })
    }

    // 3 — pace vs. last month at the same day-of-month (needs data on both sides).
    const prevSameDay = prevEntries
      .filter(e => parseInt(e.date.slice(8, 10), 10) <= dayOfMonth)
      .reduce((s, e) => s + e.amount, 0)
    if (total > 0 && prevSameDay > 0) {
      const diff = (total - prevSameDay) / prevSameDay
      if (diff <= -0.05) {
        out.push({
          key: 'pace-good', tone: 'good',
          text: `👏 עד היום הוצאת ${Math.round(Math.abs(diff) * 100)}% פחות מאשר בחודש שעבר — המשך כך`,
        })
      } else if (diff >= 0.15) {
        out.push({
          key: 'pace-watch', tone: 'watch', href: '/app/trends',
          text: `📈 עד היום הוצאת ${Math.round(diff * 100)}% יותר מאשר בחודש שעבר — שווה מבט`,
        })
      }
    }

    // 4 — last month finished with every budgeted category within its cap.
    if (prevEntries.length > 0) {
      const prevPerCat = new Map<string, number>()
      for (const e of prevEntries) prevPerCat.set(e.category, (prevPerCat.get(e.category) ?? 0) + e.amount)
      const prevBudgeted = [...prevPerCat.entries()].filter(([cat]) => budgets[cat] > 0)
      if (prevBudgeted.length > 0 && prevBudgeted.every(([cat, sum]) => sum <= budgets[cat])) {
        out.push({ key: 'prev-clean', tone: 'good', text: '🎉 בחודש שעבר עמדת בכל התקציבים!' })
      }
    }

    // 5 — biggest category this month.
    if (total > 0) {
      const [topCat, topSum] = [...perCat.entries()].sort((a, b) => b[1] - a[1])[0]
      out.push({
        key: 'top-cat', tone: 'info', href: '/app/expenses',
        text: `${icon(topCat)} ${topCat} היא הקטגוריה הגדולה החודש · ${fmt(topSum)}`,
      })
    }

    // 6 — quiet daily recap: everything captured, all in order.
    const todayEntries = monthEntries.filter(e => e.date === todayIso)
    if (todayEntries.length > 0) {
      const todaySum = todayEntries.reduce((s, e) => s + e.amount, 0)
      out.push({
        key: 'today', tone: 'info',
        text: `✓ נרשמו היום ${todayEntries.length === 1 ? 'הוצאה אחת' : `${todayEntries.length} הוצאות`} · ${fmt(todaySum)} — הכל מתועד`,
      })
    }

    return out.slice(0, 3)
  }, [entries, budgets])

  if (insights.length === 0) return null

  return (
    <div className="space-y-2">
      <div className="text-[11px] font-semibold text-muted-txt px-1">💬 תובנות עבורך</div>
      {insights.map(ins => {
        const cls = `block rounded-xl border border-line bg-surface2 border-s-4 ${TONE_BORDER[ins.tone]} px-4 py-3 text-sm text-txt leading-snug tabular-nums`
        return ins.href ? (
          <Link key={ins.key} href={ins.href} className={`${cls} hover:bg-surface3 transition-colors`}>
            {ins.text}
          </Link>
        ) : (
          <div key={ins.key} className={cls}>{ins.text}</div>
        )
      })}
    </div>
  )
}
