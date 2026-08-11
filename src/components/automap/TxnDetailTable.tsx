'use client'

// The פירוט, editable — with the same controls the credit tab has.
//
// A read-only breakdown is half a tool: the advisor opens ביגוד והנעלה, sees
// "דרייב קפה" sitting in it, and can do nothing except edit two aggregate rows
// by hand and hope the arithmetic lands. Here the category is a control, and
// changing it moves the money.
//
// Ori, 2026-08-11: "הם קיימים אבל חסרים כפתורים שיש באשראי וכאן אין". He is
// right, and the missing ones are not decoration. A bank description arrives as
// "‫קניה/‫( כ00) מגדל/‫טלפון ני" — truncated mid-word and stuffed with invisible
// direction marks — and without an edit button there is no way to make it
// readable. A charge that is not the household's at all has no way out.
//
// 🔴 Editing an amount or deleting a charge also adjusts the row above it. The
// alternative is a total that no longer matches the detail under it, which is
// the kind of wrong nobody catches because both halves look right alone.
//
// Lab-owned on purpose: the mapping tab's SectionPanel renders its detail
// read-only and is live for every client, so it is not touched. The credit
// tab's own TransactionTable is not touched either — it is indexed by position
// in one flat list, and here every row is a slice of two merged sources.

import { useState } from 'react'
import { CategoryPicker } from '@/components/shared/CategoryPicker'
import { CategoryBadge } from '@/components/credit/CategoryBadge'
import type { Transaction } from '@/types/transaction'

const fmt = (n: number) => '₪' + Math.round(n).toLocaleString('he-IL')

/**
 * The edit controls, bundled — the detail table is rendered from five places
 * and threading three more callbacks through each of them is how one of them
 * silently ends up without the delete button.
 */
export interface TxnEditHandlers {
  onDescChange?:   (txn: Transaction, desc: string) => void
  onAmountChange?: (txn: Transaction, amount: number) => void
  onDelete?:       (txn: Transaction) => void
}

export interface TxnDetailTableProps extends TxnEditHandlers {
  txns: Transaction[]
  /** Window length — the row amounts are monthly, these transactions are not. */
  months: number
  onRecategorize: (txn: Transaction, category: string) => void
}

/** Identity within this table. Object identity does not survive the re-derive. */
const idOf = (t: Transaction, i: number) => `${t.desc}|${t.date}|${t.amount}|${i}`

export function TxnDetailTable({
  txns, months, onRecategorize, onDescChange, onAmountChange, onDelete,
}: TxnDetailTableProps) {
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<{ id: string; field: 'desc' | 'amount' | 'cat' } | null>(null)
  const [draft, setDraft] = useState('')

  if (!txns.length) return null

  const sorted = [...txns].sort((a, b) => b.amount - a.amount)
  const rows = sorted.filter(t =>
    !search || t.desc.includes(search) || (t.category ?? '').includes(search))
  const total = txns.reduce((s, t) => s + t.amount, 0)
  const unclassified = txns.filter(t => !t.category?.trim() || t.category === 'שונות').length

  const start = (id: string, field: 'desc' | 'amount' | 'cat', value: string) => {
    setEditing({ id, field })
    setDraft(value)
  }
  const commit = (t: Transaction) => {
    if (editing?.field === 'desc' && draft.trim() && draft.trim() !== t.desc) {
      onDescChange?.(t, draft.trim())
    }
    if (editing?.field === 'amount') {
      const v = parseFloat(draft)
      if (Number.isFinite(v) && v >= 0 && v !== t.amount) onAmountChange?.(t, v)
    }
    setEditing(null)
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-3 flex-wrap text-[11px] text-muted-txt px-0.5">
        <span><span className="font-semibold text-txt">{txns.length}</span> עסקאות</span>
        {unclassified > 0 && <span>ללא סיווג: <span className="font-semibold text-expense">{unclassified}</span></span>}
        <div className="flex-1" />
        <input
          type="text"
          placeholder="חיפוש בפירוט..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="rounded-lg border border-line bg-surface px-2 py-1 text-[11px] text-txt placeholder:text-muted-txt/60 focus:outline-none focus:border-gold/60 w-36"
        />
      </div>

      <div className="rounded-lg border border-line overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="bg-surface2 border-b border-line">
            <tr>
              <th className="text-start px-2 py-1 font-medium text-muted-txt">תיאור</th>
              <th className="text-start px-2 py-1 font-medium text-muted-txt whitespace-nowrap">תאריך</th>
              <th className="text-start px-2 py-1 font-medium text-muted-txt">קטגוריה</th>
              <th className="text-end px-2 py-1 font-medium text-muted-txt">סכום</th>
              <th className="px-2 py-1 font-medium text-muted-txt text-center">פעולות</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/50">
            {rows.map((t, i) => {
              const id = idOf(t, i)
              const editingThis = editing?.id === id ? editing.field : null
              return (
                <tr key={id} className="hover:bg-surface2/40 group">
                  <td className="px-2 py-1 max-w-[200px]">
                    {editingThis === 'desc' ? (
                      <input
                        autoFocus
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        onBlur={() => commit(t)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') commit(t)
                          if (e.key === 'Escape') setEditing(null)
                        }}
                        className="w-full rounded border border-gold bg-surface px-1.5 py-0.5 text-[11px] text-txt focus:outline-none"
                      />
                    ) : (
                      <div>
                        <div className="truncate text-txt" title={t.desc}>{t.desc}</div>
                        {t.notes && <div className="truncate text-muted-txt/70" title={t.notes}>{t.notes}</div>}
                      </div>
                    )}
                  </td>

                  <td className="px-2 py-1 text-muted-txt whitespace-nowrap">{t.date}</td>

                  <td className="px-2 py-1">
                    {editingThis === 'cat' ? (
                      <CategoryPicker
                        value={t.category ?? ''}
                        onChange={cat => { onRecategorize(t, cat); setEditing(null) }}
                        autoOpen
                        onClose={() => setEditing(null)}
                        variant="badge"
                      />
                    ) : (
                      <button type="button" onClick={() => start(id, 'cat', t.category ?? '')}>
                        <CategoryBadge category={t.category ?? ''} />
                      </button>
                    )}
                  </td>

                  <td className="px-2 py-1 text-end whitespace-nowrap">
                    {editingThis === 'amount' ? (
                      <input
                        autoFocus
                        type="number"
                        min={0}
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        onBlur={() => commit(t)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') commit(t)
                          if (e.key === 'Escape') setEditing(null)
                        }}
                        style={{ direction: 'ltr' }}
                        className="w-20 rounded border border-gold bg-surface px-1.5 py-0.5 text-[11px] text-txt text-left focus:outline-none tabular-nums"
                      />
                    ) : (
                      <span className="font-medium text-gold tabular-nums">{fmt(t.amount)}</span>
                    )}
                  </td>

                  <td className="px-2 py-1">
                    <div className="flex items-center justify-center gap-0.5 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                      <button
                        type="button" title="חיפוש באינטרנט"
                        onClick={() => window.open(`https://www.google.com/search?q=${encodeURIComponent(t.desc)}`, '_blank')}
                        className="p-1 rounded hover:bg-surface text-muted-txt hover:text-txt transition-colors"
                      >🌐</button>
                      {onDescChange && (
                        <button
                          type="button" title="ערוך תיאור"
                          onClick={() => start(id, 'desc', t.desc)}
                          className="p-1 rounded hover:bg-surface text-muted-txt hover:text-txt transition-colors"
                        >✏️</button>
                      )}
                      {onAmountChange && (
                        <button
                          type="button" title="ערוך סכום"
                          onClick={() => start(id, 'amount', String(t.amount))}
                          className="p-1 rounded hover:bg-surface text-muted-txt hover:text-txt transition-colors"
                        >💲</button>
                      )}
                      <button
                        type="button" title="שנה קטגוריה"
                        onClick={() => start(id, 'cat', t.category ?? '')}
                        className="p-1 rounded hover:bg-surface text-muted-txt hover:text-txt transition-colors"
                      >🏷️</button>
                      {onDelete && (
                        <button
                          type="button" title="מחק עסקה"
                          onClick={() => onDelete(t)}
                          className="p-1 rounded hover:bg-surface text-muted-txt hover:text-expense transition-colors"
                        >🗑️</button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {!rows.length && (
              <tr><td colSpan={5} className="px-2 py-4 text-center text-muted-txt">אין תוצאות</td></tr>
            )}
          </tbody>
          {/* The footer is the honest half of the monthly/period distinction: the
              transactions below sum to the WINDOW, the row above is per month. */}
          <tfoot className="border-t border-line bg-surface2/60">
            <tr>
              <td colSpan={4} className="px-2 py-1 text-muted-txt">
                סה&quot;כ {txns.length} עסקאות{months > 1 && ` ב‑${months} חודשים · ${fmt(total / months)} לחודש`}
              </td>
              <td className="px-2 py-1 text-end font-semibold text-txt tabular-nums">{fmt(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
