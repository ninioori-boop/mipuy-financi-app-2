'use client'

import type { Lifecycle, ClientFlag, NeglectFlag, TrackingStatus } from '@/lib/advisorMock'
import { FLAG_LABELS, NEGLECT_LABELS, STAGE_LABELS } from '@/lib/advisorMock'

// Small presentational pills for the advisor dashboard. Refined "magic-portfolio"
// treatment: soft rounded-full chips with a leading status dot, mapped to the
// brand good / warning / critical palette.

const CHIP = 'inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border whitespace-nowrap font-medium'
const DOT  = 'h-1.5 w-1.5 rounded-full'

const LIFECYCLE: Record<Lifecycle, { cls: string; dot: string; label: string }> = {
  active:      { cls: 'border-income/30 text-income bg-income/10',   dot: 'bg-income',    label: 'פעיל' },
  pending:     { cls: 'border-gold/30 text-gold bg-gold/10',          dot: 'bg-gold',      label: 'ממתין' },
  graduated:   { cls: 'border-line text-muted-txt bg-surface',        dot: 'bg-muted-txt', label: 'בוגר · שנה חינם' },
  'read-only': { cls: 'border-expense/30 text-expense bg-expense/10', dot: 'bg-expense',   label: 'לקריאה בלבד' },
  declined:    { cls: 'border-line text-muted-txt bg-surface',        dot: 'bg-muted-txt', label: 'סירב לשתף' },
  revoked:     { cls: 'border-line text-muted-txt bg-surface',        dot: 'bg-muted-txt', label: 'ביטל שיתוף' },
}

export function LifecycleBadge({ lifecycle }: { lifecycle: Lifecycle }) {
  const { cls, dot, label } = LIFECYCLE[lifecycle]
  return (
    <span className={`${CHIP} ${cls}`}>
      <span className={`${DOT} ${dot}`} aria-hidden />
      {label}
    </span>
  )
}

export function FlagPill({ flag }: { flag: ClientFlag }) {
  return (
    <span className={`${CHIP} border-expense/30 text-expense bg-expense/10`}>
      <span className={`${DOT} bg-expense`} aria-hidden />
      {FLAG_LABELS[flag]}
    </span>
  )
}

export function NeglectPill({ flag }: { flag: NeglectFlag }) {
  // NEGLECT_LABELS already carry an emoji marker, so no leading dot here.
  return <span className={`${CHIP} border-gold/30 text-gold bg-gold/10`}>{NEGLECT_LABELS[flag]}</span>
}

// Expense-tracking engagement pill. Renders nothing when the client is logging
// fine (the card stays quiet) — the detail view shows the positive state.
export function TrackingPill({ status }: { status: TrackingStatus }) {
  if (!status || status.kind === 'ok') return null
  if (status.kind === 'never') {
    return <span className={`${CHIP} border-gold/30 text-gold bg-gold/10`}>✏️ עוד לא התחיל לתעד</span>
  }
  return (
    <span className={`${CHIP} border-expense/30 text-expense bg-expense/10`}>
      ✏️ לא תיעד {status.days} ימים
    </span>
  )
}

export function OkPill() {
  return (
    <span className={`${CHIP} border-income/30 text-income bg-income/10`}>
      <span className={`${DOT} bg-income`} aria-hidden />
      הכל תקין
    </span>
  )
}

export function FlagList({ flags }: { flags: ClientFlag[] }) {
  if (flags.length === 0) return <OkPill />
  return (
    <span className="inline-flex flex-wrap gap-1">
      {flags.map(f => <FlagPill key={f} flag={f} />)}
    </span>
  )
}

// Compact "שלב N/5" + 5 segment bars.
export function StageIndicator({ stage }: { stage: number }) {
  return (
    <span className="inline-flex items-center gap-2" title={STAGE_LABELS[stage] ?? ''}>
      <span className="inline-flex gap-1" aria-hidden>
        {Array.from({ length: 5 }, (_, i) => (
          <span
            key={i}
            className={`h-1.5 w-4 rounded-full transition-colors ${i < stage ? 'bg-gold' : 'bg-surface3'}`}
          />
        ))}
      </span>
      <span className="text-xs text-muted-txt tabular-nums whitespace-nowrap">
        שלב {stage}/5
        <span className="hidden lg:inline"> · {STAGE_LABELS[stage]}</span>
      </span>
    </span>
  )
}
