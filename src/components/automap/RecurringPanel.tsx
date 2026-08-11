'use client'

// What repeats every month, and what only looks like it does.
//
// The mapping collapses every subscription into one row. On Ori's first real
// run the whole מנויים section was "מנויים ₪421", while underneath it sat
// 217ACADEMY ₪400, פרטנר ₪113, גוגל בוסו ₪32 and ספוטיפיי ₪24 — four decisions
// a household could actually make, shown as one number nobody can act on. And a
// barber charging ₪100 every month for four months sat in משתנות, where nothing
// marks it as a standing commitment at all.
//
// Ori asked for both halves: the subscriptions that were found, and the
// expenses SUSPECTED of being subscriptions, with a way to move them across.
// The second list is the one with a button.
//
// Lab-only. The credit tab's SmartPatterns panel is live and untouched.

import { useMemo, useState } from 'react'
import { detectRecurring, splitRecurring, SUB_TARGET, type RecurringItem } from '@/lib/automapRecurring'
import type { Transaction } from '@/types/transaction'

const fmt = (n: number) => '₪' + Math.round(n).toLocaleString('he-IL')
const monthLabel = (m: string) => m.slice(5) + '/' + m.slice(2, 4)

export interface RecurringPanelProps {
  txns:   Transaction[]
  months: number
  /** Moves every charge of this merchant to a category. Same path as the פירוט. */
  onMove: (txn: Transaction, category: string) => void
}

function Row({ item, txns, onMove }: { item: RecurringItem; txns: Transaction[]; onMove: RecurringPanelProps['onMove'] }) {
  const [open, setOpen] = useState(false)
  // The move goes through the same merchant-wide path the פירוט uses, so one
  // representative charge is all it needs — and it must carry the category the
  // row is leaving, or nothing gets debited from it.
  const sample = txns.find(t => t.desc.trim() === item.name) ?? txns[0]

  return (
    <div className="rounded-lg border border-line bg-surface px-2.5 py-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="shrink-0" title={item.confidence === 'high' ? 'חוזר בכל חודש באותו סכום' : 'חוזר, אבל לא בכל חודש או לא באותו סכום'}>
          {item.confidence === 'high' ? '🔁' : '·'}
        </span>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="min-w-0 text-start hover:text-gold transition-colors"
        >
          <div className="truncate text-txt" title={item.name}>{item.name}</div>
          <div className="text-[11px] text-muted-txt">{item.reason} · {item.category || 'ללא קטגוריה'}</div>
        </button>
        <div className="flex-1" />
        <span className="text-gold font-semibold tabular-nums whitespace-nowrap">{fmt(item.monthly)}<span className="text-[11px] text-muted-txt font-normal"> לחודש</span></span>
        {item.status === 'suspect' && sample && (
          <button
            type="button"
            onClick={() => onMove(sample, SUB_TARGET)}
            className="shrink-0 rounded-lg border border-gold/50 bg-gold/10 px-2 py-1 text-[11px] text-gold hover:bg-gold/20 transition-colors"
          >העבר למנויים</button>
        )}
      </div>

      {open && (
        <div className="mt-1.5 pt-1.5 border-t border-line/60 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-txt tabular-nums">
          {item.perMonth.map(p => (
            <span key={p.month}>{monthLabel(p.month)}: <span className="text-txt">{fmt(p.amount)}</span></span>
          ))}
          <span>· {item.charges} חיובים</span>
        </div>
      )}
    </div>
  )
}

export default function RecurringPanel({ txns, months, onMove }: RecurringPanelProps) {
  const [open, setOpen] = useState(false)
  const { known, suspects } = useMemo(
    () => splitRecurring(detectRecurring(txns, months)),
    [txns, months],
  )

  if (!known.length && !suspects.length) return null
  const suspectTotal = suspects.reduce((s, i) => s + i.monthly, 0)

  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-start hover:bg-surface2/60 transition-colors"
      >
        <span className="text-base">🔁</span>
        <span className="text-sm font-semibold text-txt">הוצאות שחוזרות כל חודש</span>
        <span className="text-xs text-muted-txt">
          {known.length} מנויים מזוהים
          {suspects.length > 0 && ` · ${suspects.length} חשודים, ${fmt(suspectTotal)} לחודש`}
        </span>
        <span className="ms-auto text-xs text-muted-txt">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-3 py-2 space-y-3">
          {suspects.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-gold/80 border-b border-line pb-1">
                חשודים כמנויים, ויושבים במקום אחר
              </div>
              <p className="text-[11px] text-muted-txt leading-snug">
                חיוב אחד בחודש, בערך באותו סכום, שלא מסווג כמנוי. חלקם באמת מנויים וחלקם הוצאה חוזרת שאינה מנוי, כמו תספורת קבועה. אתה מכריע.
              </p>
              {suspects.map(i => <Row key={i.key} item={i} txns={txns} onMove={onMove} />)}
            </div>
          )}

          {known.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-gold/80 border-b border-line pb-1">
                כבר מסווגים כמנויים
              </div>
              {known.map(i => <Row key={i.key} item={i} txns={txns} onMove={onMove} />)}
            </div>
          )}

          {/* Said out loud, because a panel that is silent about what it skips
              reads as "there is nothing else", and here there always is. */}
          <p className="text-[11px] text-muted-txt/70 leading-snug border-t border-line/60 pt-1.5">
            לא נכללים כאן: הוצאות שכבר בקבועות, בביטוחים או בשנתיות; העברות לחיסכון והשקעות; וביט או פייבוקס, שבהם כל חודש עומד מאחוריהם אדם אחר.
          </p>
        </div>
      )}
    </div>
  )
}
