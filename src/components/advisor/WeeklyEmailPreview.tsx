'use client'

import {
  fmt, clientTotals, weeklyDigestGroups, isSnapshotable,
  FLAG_LABELS, STAGE_LABELS, type MockClient,
} from '@/lib/advisorMock'

// Screen 4 — a rendered preview of the advisor's weekly digest email. Static:
// no sending, no scheduling. Composed from the same mock roster.

interface Props {
  clients:     MockClient[]
  advisorName: string
  onClose:     () => void
}

function Line({ c }: { c: MockClient }) {
  const t = isSnapshotable(c) ? clientTotals(c.fin) : null
  const topFlag = c.flags[0]
  return (
    <div className="flex items-center justify-between gap-2 py-2 border-b border-line/60 last:border-0">
      <div className="min-w-0">
        <span className="text-sm text-txt font-medium">{c.name}</span>
        <span className="text-xs text-muted-txt"> · {STAGE_LABELS[c.stage]}</span>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {topFlag && <span className="text-xs text-expense">{FLAG_LABELS[topFlag]}</span>}
        {t && (
          <span className={`text-xs font-semibold tabular-nums ${t.cashflow >= 0 ? 'text-income' : 'text-expense'}`}>
            {(t.cashflow >= 0 ? '+' : '−') + fmt(Math.abs(t.cashflow))}
          </span>
        )}
      </div>
    </div>
  )
}

function Group({ title, clients }: { title: string; clients: MockClient[] }) {
  if (clients.length === 0) return null
  return (
    <div className="space-y-0.5">
      <div className="text-sm font-bold text-txt mb-1">{title} ({clients.length})</div>
      {clients.map(c => <Line key={c.id} c={c} />)}
    </div>
  )
}

export function WeeklyEmailPreview({ clients, advisorName, onClose }: Props) {
  const g       = weeklyDigestGroups(clients)
  const today   = new Date().toLocaleDateString('he-IL', { day: 'numeric', month: 'long' })

  return (
    <div className="max-w-2xl mx-auto space-y-4 pb-16">
      <button
        onClick={onClose}
        className="min-h-[44px] rounded-lg bg-surface border border-line px-4 text-sm text-txt hover:border-gold/40 transition-colors"
      >
        ⟵ חזרה לדשבורד
      </button>

      {/* Email frame */}
      <div className="rounded-xl border border-line bg-surface2 overflow-hidden">
        {/* Faux email header */}
        <div className="bg-surface px-4 sm:px-5 py-4 border-b border-line space-y-1">
          <div className="text-xs text-muted-txt">מאת: <span className="text-txt" dir="ltr">no-reply@mipuy.app</span></div>
          <div className="text-sm font-bold text-txt">סיכום שבועי · מצב הלקוחות שלך</div>
          <div className="text-xs text-muted-txt">{today}</div>
        </div>

        {/* Body */}
        <div className="px-4 sm:px-5 py-5 space-y-5">
          <p className="text-sm text-txt">שלום {advisorName}, הנה תמונת המצב של הלקוחות שלך השבוע.</p>

          <Group title="🔴 דורשים טיפול" clients={g.attention} />
          <Group title="🟢 מתקדמים יפה"   clients={g.progressing} />
          <Group title="🟡 ממתינים להצטרפות" clients={g.pending} />

          <div className="pt-2">
            <span className="inline-flex items-center rounded-lg bg-gold text-surface px-5 py-2.5 text-sm font-bold">
              כניסה למערכת ←
            </span>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-muted-txt text-center">תצוגה מקדימה. המייל יישלח אוטומטית בכל יום ראשון (בשלב מאוחר יותר).</p>
    </div>
  )
}
