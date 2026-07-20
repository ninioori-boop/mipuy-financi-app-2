'use client'

import {
  fmt, clientTotals, weeklyDigestGroups, isSnapshotable,
  STAGE_LABELS, type MockClient,
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
  return (
    <div className="flex items-center justify-between gap-2 py-2.5 border-b border-line/50 last:border-0">
      <div className="min-w-0">
        <span className="text-sm text-txt font-medium">{c.name}</span>
        <span className="text-xs text-muted-txt"> · {STAGE_LABELS[c.stage]}</span>
      </div>
      {t && (
        <span dir="ltr" className={`text-xs font-semibold tabular-nums shrink-0 ${t.cashflow >= 0 ? 'text-income' : 'text-expense'}`}>
          {(t.cashflow >= 0 ? '+' : '−') + fmt(Math.abs(t.cashflow))}
        </span>
      )}
    </div>
  )
}

function Group({ icon, title, tone, clients }: { icon: string; title: string; tone: string; clients: MockClient[] }) {
  if (clients.length === 0) return null
  return (
    <div className="space-y-0.5">
      <div className={`text-xs uppercase tracking-wider font-semibold mb-1.5 flex items-center gap-2 ${tone}`}>
        <span aria-hidden>{icon}</span>{title}<span className="text-muted-txt">· {clients.length}</span>
      </div>
      {clients.map(c => <Line key={c.id} c={c} />)}
    </div>
  )
}

export function WeeklyEmailPreview({ clients, advisorName, onClose }: Props) {
  const g     = weeklyDigestGroups(clients)
  const today = new Date().toLocaleDateString('he-IL', { day: 'numeric', month: 'long' })

  return (
    <div className="max-w-2xl mx-auto space-y-4 pb-16">
      <button
        onClick={onClose}
        className="min-h-[44px] rounded-full bg-surface border border-line px-4 text-sm text-txt hover:border-gold/40 transition-colors"
      >
        ⟵ חזרה לדשבורד
      </button>

      {/* Email frame */}
      <div className="rounded-2xl border border-line bg-surface2 overflow-hidden">
        {/* Faux email header */}
        <div className="bg-surface px-4 sm:px-5 py-4 border-b border-line space-y-1">
          <div className="text-xs text-muted-txt">מאת: <span className="text-txt" dir="ltr">no-reply@mipuy.app</span></div>
          <div className="text-sm font-bold text-txt">סיכום שבועי · מצב הלקוחות שלך</div>
          <div className="text-xs text-muted-txt">{today}</div>
        </div>

        {/* Body */}
        <div className="px-4 sm:px-5 py-5 space-y-5">
          <p className="text-sm text-txt">שלום {advisorName}, הנה תמונת המצב של הלקוחות שלך השבוע.</p>

          <Group icon="🔴" title="דורשים תשומת לב" tone="text-expense"   clients={g.attention} />
          <Group icon="🟢" title="מתקדמים יפה"     tone="text-income"    clients={g.progressing} />
          <Group icon="⚪" title="ממתינים להצטרפות" tone="text-muted-txt" clients={g.pending} />

          <div className="pt-1">
            <span className="inline-flex items-center rounded-full bg-gold text-surface px-5 py-2.5 text-sm font-bold">
              כניסה למערכת ←
            </span>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-muted-txt text-center">תצוגה מקדימה. המייל יישלח אוטומטית בכל יום ראשון (בשלב מאוחר יותר).</p>
    </div>
  )
}
