'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { useMappingStore, type MappingRow } from '@/stores/mappingStore'
import type { Transaction } from '@/types/transaction'
import { normalizeForLookup } from '@/lib/categorize'

function fmt(n: number) {
  return '₪' + n.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

interface Props {
  title: string
  icon: string
  rows: MappingRow[]
  subtitle?: string
  totalLabel?: string
  totalColor?: string
  colName?: string
  colAmt?: string
  creditTransactions?: Transaction[]
  // Optional slot rendered right after a row's name input. The mapping tab
  // leaves it undefined (nothing renders); the auto-mapping lab uses it to
  // surface the AI's per-row confidence / source chips. Additive — no effect
  // on existing callers.
  rowExtra?: (row: MappingRow) => ReactNode
  onAdd: () => void
  onUpdate: (id: string, field: 'name' | 'amount', value: string | number) => void
  onDelete: (id: string) => void
}

export function SectionPanel({
  title, icon, rows, subtitle,
  totalLabel, totalColor = 'text-gold',
  colName, colAmt,
  creditTransactions,
  rowExtra,
  onAdd, onUpdate, onDelete,
}: Props) {
  const [openDetail, setOpenDetail] = useState<string | null>(null)
  const total = rows.reduce((s, r) => s + r.amount, 0)

  // Names of every mapping row across the entire mapping (all sections),
  // normalized. Used to suppress transactions in a category-aggregated row's
  // פירוט view once their merchant has been carved out to its own row — so
  // PIC* CLAUDE doesn't appear under both the standalone Anthropic row AND
  // the aggregated "מנויים" row.
  const mFixed    = useMappingStore(s => s.fixed)
  const mVariable = useMappingStore(s => s.variable)
  const mSub      = useMappingStore(s => s.sub)
  const mIns      = useMappingStore(s => s.ins)
  const mAnnual   = useMappingStore(s => s.annual)
  const allMappingNames = useMemo(() => {
    const set = new Set<string>()
    for (const r of [...mFixed, ...mVariable, ...mSub, ...mIns, ...mAnnual]) {
      const k = normalizeForLookup(r.name)
      if (k) set.add(k)
    }
    return set
  }, [mFixed, mVariable, mSub, mIns, mAnnual])

  function txsForRow(name: string): Transaction[] {
    if (!creditTransactions) return []
    const myKey = normalizeForLookup(name)
    return creditTransactions.filter(t => {
      if (t.isRefund) return false
      if (t.category !== name) return false
      const merchantKey = normalizeForLookup(t.desc)
      // Skip the txn if its merchant has its OWN mapping row elsewhere.
      // (myKey check keeps the txn visible when the row IS the merchant's
      // dedicated row — edge case where row name equals merchant desc.)
      if (merchantKey && merchantKey !== myKey && allMappingNames.has(merchantKey)) return false
      return true
    })
  }

  return (
    <div className="rounded-xl border border-line bg-surface2 p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-txt">{icon} {title}</h2>
          {subtitle && <p className="text-xs text-muted-txt mt-0.5">{subtitle}</p>}
        </div>
        <span className={`text-sm font-bold ${totalColor}`}>
          {fmt(total)}<span className="text-xs font-normal text-muted-txt">/חודש</span>
        </span>
      </div>

      {(colName || colAmt) && (
        <div className="flex items-center gap-2 px-1 text-xs text-muted-txt font-medium">
          <span className="flex-1">{colName ?? 'שם'}</span>
          <span className="w-28 text-left">{colAmt ?? 'סכום חודשי ₪'}</span>
          <span className="w-6" />
        </div>
      )}

      <div className="space-y-1">
        {rows.map(row => {
          const txs = row.fromCredit ? txsForRow(row.name) : []
          const isOpen = openDetail === row.id

          return (
            <div key={row.id}>
              {/* Row */}
              <div className="flex items-center gap-2 group">
                <input
                  value={row.name}
                  onChange={e => onUpdate(row.id, 'name', e.target.value)}
                  placeholder={colName ?? 'שם'}
                  className="flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60"
                />
                {rowExtra?.(row)}
                <div className="flex items-center gap-1.5 shrink-0">
                  {row.fromCredit && txs.length > 0 && (
                    <button
                      onClick={() => setOpenDetail(isOpen ? null : row.id)}
                      className="text-xs px-1.5 py-1 rounded border border-line bg-surface text-muted-txt hover:text-gold hover:border-gold/40 transition-colors whitespace-nowrap"
                    >
                      {isOpen ? '▲' : '▶'} <span className="hidden sm:inline">{txs.length} פריטים</span><span className="sm:hidden">{txs.length}</span>
                    </button>
                  )}
                  <input
                    type="number"
                    value={row.amount || ''}
                    onChange={e => onUpdate(row.id, 'amount', parseFloat(e.target.value) || 0)}
                    placeholder="₪"
                    min={0}
                    style={{ direction: 'ltr' }}
                    className="w-20 sm:w-28 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left tabular-nums"
                  />
                </div>
                <button
                  onClick={() => onDelete(row.id)}
                  className="p-1.5 rounded text-muted-txt hover:text-expense transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                >×</button>
              </div>

              {/* Detail panel */}
              {isOpen && txs.length > 0 && (
                <div className="mt-1 mb-1 rounded-lg border border-line overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-surface2 border-b border-line">
                      <tr>
                        <th className="text-right px-3 py-1.5 font-medium text-muted-txt">תיאור</th>
                        <th className="text-right px-3 py-1.5 font-medium text-muted-txt">תאריך</th>
                        <th className="text-left px-3 py-1.5 font-medium text-muted-txt">סכום</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line/50">
                      {txs.sort((a, b) => b.amount - a.amount).map((t, i) => (
                        <tr key={i} className="hover:bg-surface2/40">
                          <td className="px-3 py-1.5 max-w-[180px]">
                            <div className="truncate text-txt">{t.desc}</div>
                          </td>
                          <td className="px-3 py-1.5 text-muted-txt whitespace-nowrap">{t.date}</td>
                          <td className="px-3 py-1.5 text-left font-medium text-gold tabular-nums whitespace-nowrap">
                            {fmt(t.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t border-line bg-surface2">
                      <tr>
                        <td colSpan={2} className="px-3 py-1.5 text-muted-txt">{txs.length} עסקאות</td>
                        <td className="px-3 py-1.5 text-left font-bold text-gold tabular-nums">
                          {fmt(txs.reduce((s, t) => s + t.amount, 0))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )
        })}
        {rows.length === 0 && (
          <p className="text-xs text-muted-txt py-2">אין שורות עדיין</p>
        )}
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-line">
        <button onClick={onAdd} className="text-xs text-muted-txt hover:text-gold transition-colors">
          + הוסף שורה
        </button>
        {totalLabel && (
          <span className="text-xs text-muted-txt">
            {totalLabel}: <span className={`font-medium ${totalColor}`}>{fmt(total)}</span>
          </span>
        )}
      </div>
    </div>
  )
}
