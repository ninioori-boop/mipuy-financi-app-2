'use client'

import { useMemo, useState } from 'react'
import { useMappingStore, type MappingRow } from '@/stores/mappingStore'
import type { Transaction } from '@/types/transaction'
import { normalizeForLookup } from '@/lib/categorize'

function fmt(n: number) {
  return '₪' + n.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

interface Props {
  rows: MappingRow[]
  varMonths: number
  creditImported: boolean
  hasCredit: boolean
  creditTransactions?: Transaction[]
  onAdd: () => void
  onUpdate: (id: string, field: 'name' | 'amount', value: string | number) => void
  onDelete: (id: string) => void
  onMonthsChange: (months: number) => void
  onImport: () => void
}

export function VariablePanel({
  rows, varMonths, creditImported, hasCredit, creditTransactions,
  onAdd, onUpdate, onDelete, onMonthsChange, onImport,
}: Props) {
  const [openDetail, setOpenDetail] = useState<string | null>(null)

  const totalPeriod  = rows.reduce((s, r) => s + r.amount, 0)
  const totalMonthly = Math.round(totalPeriod / Math.max(1, varMonths))

  // See SectionPanel: same logic for suppressing carved-out merchants from
  // the aggregated category row's פירוט (so a merchant that has its own row
  // doesn't also show inside the category total).
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
      if (merchantKey && merchantKey !== myKey && allMappingNames.has(merchantKey)) return false
      return true
    })
  }

  return (
    <div className="rounded-xl border border-line bg-surface2 p-5 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-txt">🛒 הוצאות משתנות</h2>
        <span className="text-sm font-bold text-gold">
          {fmt(totalMonthly)}<span className="text-xs font-normal text-muted-txt">/חודש</span>
        </span>
      </div>

      {/* Months selector */}
      <div className="flex items-center gap-3 bg-surface border border-line rounded-lg px-3 py-2.5 flex-wrap">
        <span className="text-xs text-muted-txt flex-1">הכנס סה&quot;כ הוצאה ל:</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onMonthsChange(varMonths - 1)}
            className="w-7 h-7 rounded bg-line text-txt hover:bg-gold/20 transition-colors text-base leading-none"
          >−</button>
          <input
            type="number"
            value={varMonths}
            min={1}
            max={24}
            onChange={e => onMonthsChange(parseInt(e.target.value) || 1)}
            className="w-11 text-center bg-bg border border-gold rounded-lg text-gold font-bold text-base py-0.5 focus:outline-none"
            style={{ direction: 'ltr' }}
          />
          <button
            onClick={() => onMonthsChange(varMonths + 1)}
            className="w-7 h-7 rounded bg-line text-txt hover:bg-gold/20 transition-colors text-base leading-none"
          >+</button>
          <span className="text-xs text-gold/80 font-semibold min-w-[90px]">
            {varMonths === 1 ? 'חודש ← ללא חלוקה' : `חודשים ← ÷${varMonths}`}
          </span>
        </div>
        <button
          onClick={onImport}
          disabled={!hasCredit}
          title={hasCredit ? 'ייבא מטאב האשראי' : 'אין עסקאות בטאב האשראי'}
          className="text-xs px-3 py-1.5 rounded-lg bg-gold/10 border border-gold/30 text-gold hover:bg-gold/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          📥 ייבא מאשראי
          {creditImported && <span className="mr-1 text-green-400">✓</span>}
        </button>
      </div>

      {/* Column headers */}
      <div className="flex items-center gap-2 px-1 text-xs text-muted-txt font-medium">
        <span className="flex-1">קטגוריה</span>
        <span className="hidden sm:block w-24 shrink-0 text-right">פירוט</span>
        <span className="w-20 sm:w-24 shrink-0 text-left">סכום ₪</span>
        <span className="hidden sm:block w-28 shrink-0 text-center">ממוצע/חודש</span>
        <span className="w-5 shrink-0" />
      </div>

      {/* Rows */}
      <div className="space-y-1">
        {rows.map(row => {
          const monthly = varMonths > 0 ? Math.round(row.amount / varMonths) : row.amount
          const txs     = row.fromCredit ? txsForRow(row.name) : []
          const isOpen  = openDetail === row.id

          return (
            <div key={row.id}>
              {/* Row */}
              <div className="flex items-center gap-2 group">
                {/* Name */}
                <input
                  value={row.name}
                  onChange={e => onUpdate(row.id, 'name', e.target.value)}
                  placeholder="הוצאה"
                  className={`flex-1 min-w-0 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm placeholder:text-muted-txt focus:outline-none focus:border-gold/60 ${row.fromCredit ? 'text-gold/90' : 'text-txt'}`}
                />
                {/* Detail button — hidden on mobile */}
                <div className="hidden sm:block w-24 shrink-0">
                  {row.fromCredit && txs.length > 0 && (
                    <button
                      onClick={() => setOpenDetail(isOpen ? null : row.id)}
                      className="w-full text-xs px-2 py-1 rounded border border-line bg-surface text-muted-txt hover:text-gold hover:border-gold/40 transition-colors whitespace-nowrap"
                    >
                      {isOpen ? '▲' : '▶'} {txs.length} פריטים
                    </button>
                  )}
                </div>
                {/* Mobile detail button — compact */}
                {row.fromCredit && txs.length > 0 && (
                  <button
                    onClick={() => setOpenDetail(isOpen ? null : row.id)}
                    className="sm:hidden text-xs px-1.5 py-1 rounded border border-line bg-surface text-muted-txt hover:text-gold transition-colors shrink-0"
                  >
                    {isOpen ? '▲' : '▶'}
                  </button>
                )}
                {/* Amount input */}
                <input
                  type="number"
                  value={row.amount || ''}
                  onChange={e => onUpdate(row.id, 'amount', parseFloat(e.target.value) || 0)}
                  placeholder="₪"
                  min={0}
                  className="w-20 sm:w-24 shrink-0 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 text-left tabular-nums"
                  style={{ direction: 'ltr' }}
                />
                {/* Monthly tag — hidden on mobile */}
                <span className="hidden sm:block w-28 shrink-0 text-xs text-center px-1 py-1 rounded border border-line bg-surface text-muted-txt tabular-nums whitespace-nowrap">
                  {varMonths === 1 ? fmt(row.amount) : `÷${varMonths} = ${fmt(monthly)}`}
                </span>
                {/* Delete */}
                <button
                  onClick={() => onDelete(row.id)}
                  className="w-5 shrink-0 text-muted-txt hover:text-expense transition-colors opacity-0 group-hover:opacity-100 text-sm leading-none"
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
                          <td className="px-3 py-1.5 max-w-[200px]">
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
                        <td colSpan={2} className="px-3 py-1.5 text-muted-txt">
                          {txs.length} עסקאות | סה&quot;כ {fmt(txs.reduce((s, t) => s + t.amount, 0))}
                          {varMonths > 1 && ` | ÷${varMonths} = ${fmt(Math.round(txs.reduce((s, t) => s + t.amount, 0) / varMonths))}/חודש`}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )
        })}
        {rows.length === 0 && (
          <p className="text-xs text-muted-txt py-2">אין שורות — הוסף ידנית או ייבא מאשראי</p>
        )}
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-line">
        <button onClick={onAdd} className="text-xs text-muted-txt hover:text-gold transition-colors">
          + הוסף שורה
        </button>
        <span className="text-xs text-muted-txt">
          סה&quot;כ לתקופה: <span className="font-medium text-txt">{fmt(totalPeriod)}</span>
          {varMonths > 1 && <span className="mr-2">| ממוצע: <span className="font-medium text-gold">{fmt(totalMonthly)}/חודש</span></span>}
        </span>
      </div>
    </div>
  )
}
