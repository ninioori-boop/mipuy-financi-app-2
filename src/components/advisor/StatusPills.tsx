'use client'

import type { Lifecycle, ClientFlag } from '@/lib/advisorMock'
import { FLAG_LABELS, STAGE_LABELS } from '@/lib/advisorMock'

// Small presentational pills for the advisor dashboard. Same chip shape as the
// lab's RowMetaChip, mapped to the brand good/warning/critical palette.

const CHIP = 'inline-flex items-center text-[11px] px-2 py-0.5 rounded border whitespace-nowrap'

const LIFECYCLE: Record<Lifecycle, { cls: string; label: string }> = {
  active:      { cls: 'border-income/40 text-income bg-income/10',  label: 'פעיל' },
  pending:     { cls: 'border-gold/40 text-gold bg-gold/10',         label: 'ממתין' },
  graduated:   { cls: 'border-line text-muted-txt bg-surface',       label: 'בוגר · שנה חינם' },
  'read-only': { cls: 'border-expense/40 text-expense bg-expense/10', label: 'לקריאה בלבד' },
}

export function LifecycleBadge({ lifecycle }: { lifecycle: Lifecycle }) {
  const { cls, label } = LIFECYCLE[lifecycle]
  return <span className={`${CHIP} ${cls}`}>{label}</span>
}

export function FlagPill({ flag }: { flag: ClientFlag }) {
  return <span className={`${CHIP} border-expense/40 text-expense bg-expense/10`}>{FLAG_LABELS[flag]}</span>
}

export function OkPill() {
  return <span className={`${CHIP} border-income/40 text-income bg-income/10`}>הכל תקין</span>
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
      <span className="inline-flex gap-0.5" aria-hidden>
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} className={`h-3 w-1.5 rounded-full ${i < stage ? 'bg-gold' : 'bg-surface3'}`} />
        ))}
      </span>
      <span className="text-xs text-muted-txt tabular-nums whitespace-nowrap">
        שלב {stage}/5
        <span className="hidden lg:inline"> · {STAGE_LABELS[stage]}</span>
      </span>
    </span>
  )
}
