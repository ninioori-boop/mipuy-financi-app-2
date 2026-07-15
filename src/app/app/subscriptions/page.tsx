'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useExpenseLogStore } from '@/stores/expenseLogStore'
import { detectSubscriptions, subscriptionsMonthlyTotal } from '@/lib/subscriptions'
import { CATEGORY_ICONS } from '@/lib/constants'

const fmt  = (n: number) => '₪' + Math.round(n).toLocaleString('he-IL')
const icon = (c: string) => CATEGORY_ICONS[c] ?? '📦'

function dateLabel(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return ''
  return new Date(y, m - 1, d).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })
}

// Detected subscriptions — recurring charges the app inferred from the expense
// log. The big total (monthly + yearly) is the eye-opener; the list invites the
// client to spot forgotten or unused subscriptions. Pure/local, no server.
export default function SubscriptionsPage() {
  const entries = useExpenseLogStore(s => s.entries)
  const subs    = useMemo(() => detectSubscriptions(entries), [entries])
  const monthly = subscriptionsMonthlyTotal(subs)
  const yearly  = monthly * 12

  return (
    <div className="max-w-xl mx-auto space-y-5">

      {/* Header */}
      <h1 className="text-2xl font-extrabold text-gold tracking-tight px-1 pt-1">🔁 מנויים קבועים</h1>

      {subs.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-line bg-surface2/50 p-6 sm:p-8 text-center">
          <div className="text-4xl mb-3">🔁</div>
          <p className="text-base font-semibold text-txt">עוד לא זיהינו מנויים</p>
          <p className="mt-1.5 text-sm text-muted-txt leading-relaxed">
            אחרי כמה חודשים של שימוש נזהה לך אוטומטית חיובים חוזרים (סטרימינג, חדר כושר, ביטוחים) ונציג כמה הם עולים לך בחודש ובשנה.
          </p>
        </div>
      ) : (
        <>
          {/* Big total — the eye-opener */}
          <div className="rounded-3xl border border-gold/30 bg-gradient-to-br from-gold/10 to-transparent p-4 sm:p-6 text-center">
            <div className="text-base font-semibold text-muted-txt">סך המנויים החודשיים</div>
            <div className="my-2 text-4xl sm:text-6xl leading-none font-extrabold tracking-tight tabular-nums text-gold">
              {fmt(monthly)}
            </div>
            <div className="text-sm text-muted-txt tabular-nums">
              כלומר {fmt(yearly)} בשנה · {subs.length} מנויים
            </div>
          </div>

          <p className="px-1 text-sm text-muted-txt leading-relaxed">
            אלה חיובים שחוזרים אצלך כל חודש. שווה לעבור עליהם ולוודא שאתה עדיין משתמש בכולם.
          </p>

          {/* List — biggest cost first */}
          <div className="space-y-3">
            {subs.map(sub => (
              <div
                key={sub.name}
                className="flex items-center gap-3.5 p-4 rounded-2xl border border-line bg-surface2"
              >
                <span className="w-12 h-12 shrink-0 grid place-items-center rounded-2xl text-xl bg-gold/10 border border-gold/20">
                  {icon(sub.category)}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-base font-bold text-txt truncate">{sub.name}</span>
                  <span className="block text-sm text-muted-txt truncate">
                    {sub.category}
                    {sub.lastDate && ` · חיוב אחרון ${dateLabel(sub.lastDate)}`}
                  </span>
                </span>
                <span className="text-end shrink-0">
                  <span className="block text-lg font-bold text-txt tabular-nums">{fmt(sub.monthlyAmount)}</span>
                  <span className="block text-xs text-muted-txt">לחודש</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <Link
        href="/app/home"
        className="block text-center text-sm text-muted-txt hover:text-txt transition-colors py-3 min-h-[44px]"
      >
        חזרה לבית
      </Link>
    </div>
  )
}
