'use client'

import {
  fmt, clientTotals, isSnapshotable, goalsOnTrack, neglectFlags, trackingStatus,
  type MockClient,
} from '@/lib/advisorMock'
import { LifecycleBadge, StageIndicator, FlagPill, NeglectPill, TrackingPill } from './StatusPills'
import { Avatar } from './Avatar'

// A single client card — the dashboard's core unit. Whole card is one button
// (click = enter the client's account). Hero = this-month cashflow; a 6-month
// cashflow sparkline sits beside it; goals-on-track and flags support below.

const dateFmt = (iso: string) => {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })
}

/** Tiny inline cashflow sparkline. Colour follows currentColor (set by parent),
 *  drawn LTR (time flows left→right) regardless of the RTL page. */
function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null
  const w = 96, h = 30, pad = 3
  const min = Math.min(...data), max = Math.max(...data)
  const range = max - min || 1
  const pts = data.map((v, i) => {
    const x = pad + (i * (w - pad * 2)) / (data.length - 1)
    const y = pad + (h - pad * 2) * (1 - (v - min) / range)
    return [x, y] as const
  })
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)} ${h - pad} L${pts[0][0].toFixed(1)} ${h - pad} Z`
  const last = pts[pts.length - 1]
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="block">
      <path d={area} fill="currentColor" opacity="0.12" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="2.3" fill="currentColor" />
    </svg>
  )
}

interface Props {
  client: MockClient
  onOpen: (id: string) => void
}

export function ClientCard({ client: c, onOpen }: Props) {
  const snap = isSnapshotable(c)
  const t    = snap ? clientTotals(c.fin) : null
  const g    = snap ? goalsOnTrack(c.fin) : { onTrack: 0, total: 0 }
  const neg  = neglectFlags(c)
  const trk  = trackingStatus(c)
  const trkAlert = trk?.kind === 'stale' || trk?.kind === 'never'
  const hist = c.fin.cashflowHistory
  const positive = (t?.cashflow ?? 0) >= 0

  return (
    <button
      onClick={() => onOpen(c.id)}
      className="group text-start w-full rounded-2xl border border-line bg-surface2 p-4 sm:p-5 space-y-4
        hover:border-gold/30 hover:bg-surface3/40 transition-colors"
    >
      {/* Head */}
      <div className="flex items-center gap-3">
        <Avatar name={c.name} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-txt truncate">{c.name}</div>
          <div className="text-[11px] text-muted-txt truncate" dir="ltr">{c.email}</div>
        </div>
        <LifecycleBadge lifecycle={c.lifecycle} />
      </div>

      {snap && t ? (
        <>
          {/* Hero — cashflow + sparkline */}
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-wider text-muted-txt mb-1">תזרים החודש</div>
              <div dir="ltr" className={`text-start text-2xl sm:text-3xl font-bold tabular-nums leading-none ${positive ? 'text-income' : 'text-expense'}`}>
                {(positive ? '+' : '−') + fmt(Math.abs(t.cashflow))}
              </div>
            </div>
            {hist.length > 1 && (
              <div dir="ltr" className={`shrink-0 ${positive ? 'text-income' : 'text-expense'}`}>
                <Sparkline data={hist} />
              </div>
            )}
          </div>

          {/* Goals on track */}
          {g.total > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <span aria-hidden>🎯</span>
              <span className="text-txt font-medium">{g.onTrack}/{g.total} יעדים על המסלול</span>
              <span className="inline-flex gap-1 ms-auto" aria-hidden>
                {Array.from({ length: g.total }, (_, i) => (
                  <span key={i} className={`h-1.5 w-1.5 rounded-full ${i < g.onTrack ? 'bg-income' : 'bg-surface3'}`} />
                ))}
              </span>
            </div>
          )}

          {/* Footer — stage, activity, flags */}
          <div className="pt-3 border-t border-line/60 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <StageIndicator stage={c.stage} />
              <span className="text-[11px] text-muted-txt whitespace-nowrap">פעילות: {dateFmt(c.lastActivity)}</span>
            </div>
            {(c.flags.length > 0 || neg.length > 0 || trkAlert) && (
              <div className="flex flex-wrap gap-1.5">
                {c.flags.map(f => <FlagPill key={f} flag={f} />)}
                {neg.map(n => <NeglectPill key={n} flag={n} />)}
                <TrackingPill status={trk} />
              </div>
            )}
          </div>
        </>
      ) : c.lifecycle === 'declined' || c.lifecycle === 'revoked' ? (
        <div className="text-sm text-muted-txt py-2">
          🔒 הלקוח לא משתף את הנתונים כרגע. אם ישתף, הכרטיס יתמלא אוטומטית.
        </div>
      ) : (
        <div className="text-sm text-muted-txt py-2">
          עדיין לא נרשם — אין נתונים. ברגע שישלים הרשמה עם המייל שהוזמן, הכרטיס יתמלא.
        </div>
      )}
    </button>
  )
}
