'use client'

// The פירוט, editable.
//
// A read-only breakdown is half a tool: the advisor opens ביגוד והנעלה, sees
// "דרייב קפה" sitting in it, and can do nothing except edit two aggregate rows
// by hand and hope the arithmetic lands. Here the category is a control, and
// changing it moves the money — the transaction's MONTHLY share leaves the row
// it was counted in and joins one of the destination category.
//
// Lab-owned on purpose: the mapping tab's SectionPanel renders its detail
// read-only and is live for every client, so it is not touched.

import { CategoryPicker } from '@/components/shared/CategoryPicker'
import type { Transaction } from '@/types/transaction'

const fmt = (n: number) => '₪' + Math.round(n).toLocaleString('he-IL')

export interface TxnDetailTableProps {
  txns: Transaction[]
  /** Window length — the row amounts are monthly, these transactions are not. */
  months: number
  onRecategorize: (txn: Transaction, category: string) => void
}

export function TxnDetailTable({ txns, months, onRecategorize }: TxnDetailTableProps) {
  if (!txns.length) return null
  const total = txns.reduce((s, t) => s + t.amount, 0)

  return (
    <div className="rounded-lg border border-line overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead className="bg-surface2 border-b border-line">
          <tr>
            <th className="text-start px-2 py-1 font-medium text-muted-txt">תיאור</th>
            <th className="text-start px-2 py-1 font-medium text-muted-txt whitespace-nowrap">תאריך</th>
            <th className="text-start px-2 py-1 font-medium text-muted-txt">קטגוריה</th>
            <th className="text-end px-2 py-1 font-medium text-muted-txt">סכום</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/50">
          {[...txns].sort((a, b) => b.amount - a.amount).map((t, i) => (
            <tr key={`${t.desc}|${t.date}|${t.amount}|${i}`} className="hover:bg-surface2/40">
              <td className="px-2 py-1 max-w-[200px] truncate text-txt" title={t.desc}>{t.desc}</td>
              <td className="px-2 py-1 text-muted-txt whitespace-nowrap">{t.date}</td>
              <td className="px-2 py-1">
                <CategoryPicker
                  value={t.category ?? ''}
                  onChange={cat => onRecategorize(t, cat)}
                  variant="chip"
                  placeholder="קטגוריה"
                  className="max-w-[130px]"
                />
              </td>
              <td className="px-2 py-1 text-end font-medium text-gold tabular-nums whitespace-nowrap">{fmt(t.amount)}</td>
            </tr>
          ))}
        </tbody>
        {/* The footer is the honest half of the monthly/period distinction: the
            transactions below sum to the WINDOW, the row above is per month. */}
        <tfoot className="border-t border-line bg-surface2/60">
          <tr>
            <td colSpan={3} className="px-2 py-1 text-muted-txt">
              סה&quot;כ {txns.length} עסקאות{months > 1 && ` ב‑${months} חודשים · ${fmt(total / months)} לחודש`}
            </td>
            <td className="px-2 py-1 text-end font-semibold text-txt tabular-nums">{fmt(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
