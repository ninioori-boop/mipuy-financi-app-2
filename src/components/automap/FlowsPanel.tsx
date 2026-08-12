'use client'

// The two flows the mapping kept missing, on screen before it is generated.
//
// On Ori's first real run these were the two largest findings by a wide margin:
// ₪8,648 a month leaving for savings while every savings row read
// monthlyContribution 0, and ₪13,200 a month of reserve-duty grants arriving
// beside a declared salary and vanishing with it.
//
// Both now reach the model as their own block. This panel is the other half:
// the advisor sees the same arithmetic BEFORE spending a generation on it, and
// can tell at a glance whether the split is right. A block the model reads and
// nobody can check is a block that fails silently.
//
// 🔒 Lab-owned.

import { useState } from 'react'
import type { SavingsFlow, DepositSplit } from '@/lib/automapFlows'

const fmt = (n: number) => '₪' + Math.round(n).toLocaleString('he-IL')

export interface FlowsPanelProps {
  savings: SavingsFlow
  deposits: DepositSplit
  /** Whether the questionnaire declared an income. Without one there is nothing to split against. */
  hasDeclared: boolean
  months: number
}

function Line({ name, value, note }: { name: string; value: string; note?: string }) {
  return (
    <div className="flex items-baseline gap-2 py-0.5">
      <span className="min-w-0 truncate text-txt" title={name}>{name}</span>
      {note && <span className="text-[11px] text-muted-txt shrink-0">{note}</span>}
      <span className="flex-1 border-b border-dotted border-line/60 translate-y-[-3px]" />
      <span className="shrink-0 text-gold font-semibold tabular-nums">{value}</span>
    </div>
  )
}

export default function FlowsPanel({ savings, deposits, hasDeclared, months }: FlowsPanelProps) {
  const [open, setOpen] = useState(false)

  const recurring = savings.deposits.filter(d => d.recurring)
  const oneOffSavings = savings.deposits.filter(d => !d.recurring)
  const showDeposits = hasDeclared && (deposits.unexplained.length > 0 || deposits.explained.length > 0)
  if (!savings.deposits.length && !showDeposits) return null

  const headline: string[] = []
  if (savings.monthlyRecurring > 0) headline.push(`${fmt(savings.monthlyRecurring)} לחיסכון`)
  if (deposits.unexplainedMonthly > 0 && hasDeclared) headline.push(`${fmt(deposits.unexplainedMonthly)} הכנסה לא מוצהרת`)

  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-start hover:bg-surface2/60 transition-colors"
      >
        <span className="text-base">💧</span>
        <span className="text-sm font-semibold text-txt">כסף שזז ואינו הוצאה</span>
        {headline.length > 0 && (
          <span className="text-xs text-muted-txt">{headline.join(' · ')} לחודש</span>
        )}
        <span className="ms-auto text-xs text-muted-txt">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-3 py-2 space-y-3 text-xs">
          {recurring.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gold/80 border-b border-line pb-1 mb-1">
                הפקדות קבועות לחיסכון והשקעות
              </div>
              <p className="text-[11px] text-muted-txt leading-snug mb-1">
                אלה ה‑monthlyContribution של שורות החיסכון. הכסף לא יצא מהמשפחה, הוא רק עבר מקום.
              </p>
              {recurring.map(d => (
                <Line key={d.key} name={d.name} value={`${fmt(d.monthly)} לחודש`}
                      note={`${d.category} · ${d.months} מתוך ${months} חודשים`} />
              ))}
            </div>
          )}

          {oneOffSavings.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-muted-txt border-b border-line pb-1 mb-1">
                הפקדות חד־פעמיות
              </div>
              <p className="text-[11px] text-muted-txt leading-snug mb-1">
                סכום שהופקד פעם אחת הוא צבירה, לא קצב חודשי. חלוקה במספר החודשים תמציא כאן חיסכון שאינו קיים.
              </p>
              {oneOffSavings.map(d => (
                <Line key={d.key} name={d.name} value={fmt(d.total)}
                      note={`${d.category} · ${d.charges} הפקדות`} />
              ))}
            </div>
          )}

          {showDeposits && (
            <div>
              <div className="text-xs font-semibold text-gold/80 border-b border-line pb-1 mb-1">
                הפקדות מול ההכנסה שנמסרה בשאלון
              </div>
              {deposits.explained.length > 0 && (
                <>
                  <p className="text-[11px] text-muted-txt leading-snug mb-1">
                    תואם את מה שנמסר. אותו כסף, נספר פעם אחת.
                  </p>
                  {deposits.explained.map(l => (
                    <Line key={l.name} name={l.name} value={`${fmt(l.monthly)} לחודש`} note="מוסבר" />
                  ))}
                </>
              )}
              {deposits.unexplained.length > 0 && (
                <>
                  <p className="text-[11px] text-expense leading-snug mt-1.5 mb-1">
                    נכנס לחשבון בקביעות ואינו מוסבר על ידי השאלון. זה נוסף להכנסה, לא במקומה.
                  </p>
                  {deposits.unexplained.map(l => (
                    <Line key={l.name} name={l.name} value={`${fmt(l.monthly)} לחודש`}
                          note={`${l.months} מתוך ${months} חודשים`} />
                  ))}
                </>
              )}
              {deposits.oneOff.length > 0 && (
                <p className="text-[11px] text-muted-txt/70 leading-snug mt-1.5">
                  ועוד {deposits.oneOff.length} הפקדות שהופיעו בחודש אחד בלבד, {fmt(deposits.oneOff.reduce((s, l) => s + l.sum, 0))} סך הכל. כנראה חד־פעמיות.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
