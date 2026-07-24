'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { useExpenseLogStore } from '@/stores/expenseLogStore'
import { useSubscriptionPrefsStore } from '@/stores/subscriptionPrefsStore'
import { detectSubscriptions, subscriptionsMonthlyTotal } from '@/lib/subscriptions'

const fmt = (n: number) => '₪' + Math.round(n).toLocaleString('he-IL')

/**
 * Home hero for detected subscriptions — the app speaks first: "you have N
 * recurring charges costing ₪X/mo". Renders nothing until the log holds enough
 * history to detect anything (so a new client never sees an empty promise).
 */
export function SubscriptionsCard() {
  const entries   = useExpenseLogStore(s => s.entries)
  const dismissed = useSubscriptionPrefsStore(s => s.dismissed)
  const dismissedKeys = useMemo(() => new Set(Object.keys(dismissed)), [dismissed])
  const subs    = useMemo(() => detectSubscriptions(entries, dismissedKeys), [entries, dismissedKeys])
  if (subs.length === 0) return null

  const monthly = subscriptionsMonthlyTotal(subs)
  const yearly  = monthly * 12

  return (
    <Link
      href="/app/subscriptions"
      className="block rounded-3xl border border-gold/30 bg-gradient-to-br from-gold/10 to-transparent p-4 sm:p-5 hover:border-gold/50 transition-colors"
    >
      <div className="flex items-center gap-4">
        <span className="w-[52px] h-[52px] shrink-0 grid place-items-center rounded-2xl text-2xl bg-gold/15 border border-gold/25">
          🔁
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-base font-bold text-txt">זיהינו {subs.length} מנויים קבועים</span>
          <span className="block text-sm text-muted-txt tabular-nums">{fmt(monthly)} בחודש · {fmt(yearly)} בשנה</span>
        </span>
        <span dir="ltr" className="text-xl text-muted-txt">‹</span>
      </div>
    </Link>
  )
}
