'use client'

// The lab's own section panel.
//
// The mapping tab's SectionPanel renders its פירוט read-only, and it is live for
// every client, so the lab could not make the detail editable without touching
// it. That left corrections available in one place at the bottom of the page
// instead of inside the row the mistake is visible in.
//
// Two more things this fixes by owning the row:
//   · The detail no longer depends on the model filling in a category. A row
//     that came back as "סך ביטוחים (הראל + מכבי)" with an empty category had
//     no drill-down at all — the one row the advisor most needed to open.
//   · SectionPanel's name field is flex-1 with no min-w-0, so it cannot shrink
//     below an input's intrinsic ~200px; with a category picker, a drill button
//     and an amount beside it the row outgrew the card and the controls
//     overlapped. Here the name is a grid track that is allowed to shrink.

import { useState } from 'react'
import { CategoryPicker } from '@/components/shared/CategoryPicker'
import { TxnDetailTable } from '@/components/automap/TxnDetailTable'
import type { Transaction } from '@/types/transaction'

const fmt = (n: number) => '₪' + Math.round(n).toLocaleString('he-IL')

const inputCls =
  'w-full min-w-0 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-txt ' +
  'placeholder:text-muted-txt focus:outline-none focus:border-gold/60'

export interface LabRow {
  id:     string
  name:   string
  amount: number
  category?:   string
  confidence?: 'high' | 'medium' | 'low'
  source?:     string
}

export interface LabSectionPanelProps {
  title: string
  icon:  string
  rows:  LabRow[]
  totalLabel: string
  totalColor?: string
  colName: string
  colAmt?: string
  /** The transactions this row is made of. Never empty by accident — see above. */
  txnsFor: (row: LabRow) => Transaction[]
  months: number
  onCategory: (row: LabRow, category: string) => void
  onRecategorize: (txn: Transaction, category: string) => void
  onAdd: () => void
  onUpdate: (id: string, field: 'name' | 'amount', value: string | number) => void
  onDelete: (id: string) => void
}

export function LabSectionPanel({
  title, icon, rows, totalLabel, totalColor = 'text-gold', colName, colAmt,
  txnsFor, months, onCategory, onRecategorize, onAdd, onUpdate, onDelete,
}: LabSectionPanelProps) {
  const [open, setOpen] = useState<string | null>(null)
  const total = rows.reduce((s, r) => s + r.amount, 0)

  return (
    <div className="rounded-xl border border-line bg-surface2 p-4 sm:p-5 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="font-semibold text-txt">{icon} {title}</h2>
        <span className={`text-sm font-bold ${totalColor}`}>
          {fmt(total)}<span className="text-xs font-normal text-muted-txt">/חודש</span>
        </span>
      </div>

      <div className="hidden sm:grid grid-cols-[minmax(0,1fr)_7rem_5.5rem_1.5rem] gap-2 px-1 text-xs text-muted-txt font-medium">
        <span>{colName}</span>
        <span>קטגוריה</span>
        <span className="text-start">{colAmt ?? 'סכום חודשי ₪'}</span>
        <span />
      </div>

      {rows.length === 0 && (
        <p className="text-xs text-muted-txt py-1">אין שורות, לחץ &quot;הוסף שורה&quot; כדי להוסיף ידנית</p>
      )}

      <div className="space-y-1.5">
        {rows.map(row => {
          const txns   = txnsFor(row)
          const isOpen = open === row.id
          const meta = [
            row.confidence ? `אמינות: ${{ high: 'אמין', medium: 'בינוני', low: 'נמוך' }[row.confidence]}` : '',
            row.source ? `מקור: ${row.source}` : '',
          ].filter(Boolean).join(' · ')

          return (
            <div key={row.id} className="group">
              {/* The name track is minmax(0,1fr) so it can actually shrink;
                  everything else is a fixed track and nothing overlaps. */}
              <div className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_7rem_5.5rem_1.5rem] gap-2 items-center">
                <input
                  value={row.name}
                  onChange={e => onUpdate(row.id, 'name', e.target.value)}
                  placeholder={colName}
                  title={meta || undefined}
                  className={inputCls}
                />
                <div className="min-w-0 order-3 sm:order-none col-span-2 sm:col-span-1">
                  <CategoryPicker
                    value={row.category ?? ''}
                    onChange={cat => onCategory(row, cat)}
                    variant="chip"
                    placeholder="קטגוריה"
                    className="w-full"
                  />
                </div>
                <input
                  type="number"
                  value={row.amount || ''}
                  onChange={e => onUpdate(row.id, 'amount', parseFloat(e.target.value) || 0)}
                  placeholder="₪"
                  style={{ direction: 'ltr' }}
                  className={`${inputCls} text-left tabular-nums`}
                />
                <button
                  onClick={() => onDelete(row.id)}
                  aria-label={`מחק ${row.name}`}
                  className="justify-self-end p-1.5 rounded text-muted-txt hover:text-expense transition-colors sm:opacity-0 sm:group-hover:opacity-100"
                >×</button>
              </div>

              {/* Every row gets this. A row with no transactions behind it says
                  so, rather than silently offering nothing to open. */}
              <button
                onClick={() => setOpen(isOpen ? null : row.id)}
                disabled={!txns.length}
                className={`mt-1 w-full text-start text-[11px] px-2 py-1 rounded border transition-colors ${
                  txns.length
                    ? 'border-line bg-surface text-muted-txt hover:border-gold/40 hover:text-gold'
                    : 'border-line/60 bg-surface/40 text-muted-txt/50 cursor-default'
                }`}
              >
                {txns.length
                  ? <>📊 פירוט: {txns.length} עסקאות מהדוחות {isOpen ? '▲' : '▶'}</>
                  : <>אין עסקאות מהדוחות מאחורי השורה הזאת</>}
              </button>

              {isOpen && txns.length > 0 && (
                <div className="mt-1">
                  <TxnDetailTable txns={txns} months={months} onRecategorize={onRecategorize} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-line">
        <button onClick={onAdd} className="text-xs text-muted-txt hover:text-gold transition-colors">
          + הוסף שורה
        </button>
        <span className="text-xs text-muted-txt">
          {totalLabel}: <span className={`font-medium ${totalColor}`}>{fmt(total)}</span>
        </span>
      </div>
    </div>
  )
}
