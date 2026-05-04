'use client'

import { useState } from 'react'
import type { Transaction } from '@/types/transaction'
import { ALL_CATEGORIES, CATEGORY_ICONS } from '@/lib/constants'
import { CategoryBadge } from './CategoryBadge'

interface Props {
  transactions: Transaction[]
  onCategoryChange: (idx: number, category: string) => void
  onDescChange: (idx: number, desc: string) => void
  onAmountChange: (idx: number, amount: number) => void
  onDelete: (idx: number) => void
}

function fmt(n: number) {
  return '₪' + n.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export function TransactionTable({ transactions, onCategoryChange, onDescChange, onAmountChange, onDelete }: Props) {
  const [search, setSearch] = useState('')
  const [editingCatIdx, setEditingCatIdx] = useState<number | null>(null)
  const [editingDescIdx, setEditingDescIdx] = useState<number | null>(null)
  const [editingDescValue, setEditingDescValue] = useState('')
  const [editingAmountIdx, setEditingAmountIdx] = useState<number | null>(null)
  const [editingAmountValue, setEditingAmountValue] = useState('')

  const filtered = transactions.filter(t =>
    !search || t.desc.includes(search) || t.category.includes(search),
  )

  const total = transactions.reduce((s, t) => s + (t.isRefund ? -t.amount : t.amount), 0)

  function startEditDesc(realIdx: number, desc: string) {
    setEditingDescIdx(realIdx)
    setEditingDescValue(desc)
    setEditingCatIdx(null)
    setEditingAmountIdx(null)
  }

  function commitDesc() {
    if (editingDescIdx !== null && editingDescValue.trim()) {
      onDescChange(editingDescIdx, editingDescValue.trim())
    }
    setEditingDescIdx(null)
  }

  function startEditAmount(realIdx: number, amount: number) {
    setEditingAmountIdx(realIdx)
    setEditingAmountValue(String(amount))
    setEditingDescIdx(null)
    setEditingCatIdx(null)
  }

  function commitAmount() {
    if (editingAmountIdx !== null) {
      const v = parseFloat(editingAmountValue)
      if (!isNaN(v) && v >= 0) onAmountChange(editingAmountIdx, v)
    }
    setEditingAmountIdx(null)
  }

  function searchOnline(desc: string) {
    window.open(`https://www.google.com/search?q=${encodeURIComponent(desc)}`, '_blank')
  }

  return (
    <div className="space-y-3">
      {/* Stats + search */}
      <div className="flex items-center gap-4 flex-wrap text-sm">
        <span className="text-muted-txt">
          <span className="font-semibold text-txt">{transactions.length}</span> עסקאות
        </span>
        <span className="text-muted-txt">
          סה&quot;כ: <span className="font-semibold text-gold">{fmt(total)}</span>
        </span>
        <span className="text-muted-txt">
          ללא סיווג:{' '}
          <span className="font-semibold text-expense">
            {transactions.filter(t => t.category === 'שונות').length}
          </span>
        </span>
        <div className="flex-1" />
        <input
          type="text"
          placeholder="חיפוש..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-txt placeholder:text-muted-txt focus:outline-none focus:border-gold/60 w-40"
        />
      </div>

      {/* Table */}
      <div className="rounded-xl border border-line overflow-hidden">
        <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
          <table className="w-full text-sm min-w-[740px]">
            <thead className="sticky top-0 bg-surface2 border-b border-line z-10">
              <tr>
                <th className="text-right px-4 py-2.5 font-medium text-muted-txt">תיאור</th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-txt">קטגוריה</th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-txt">סכום</th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-txt">תאריך</th>
                <th className="px-4 py-2.5 font-medium text-muted-txt text-center">פעולות</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.map((t, i) => {
                const realIdx = transactions.indexOf(t)
                const isEditingDesc   = editingDescIdx   === realIdx
                const isEditingCat    = editingCatIdx    === realIdx
                const isEditingAmount = editingAmountIdx === realIdx

                return (
                  <tr key={i} className="hover:bg-surface2/50 transition-colors group">
                    {/* תיאור */}
                    <td className="px-4 py-2.5 max-w-[220px]">
                      {isEditingDesc ? (
                        <input
                          autoFocus
                          value={editingDescValue}
                          onChange={e => setEditingDescValue(e.target.value)}
                          onBlur={commitDesc}
                          onKeyDown={e => { if (e.key === 'Enter') commitDesc(); if (e.key === 'Escape') setEditingDescIdx(null) }}
                          className="w-full rounded border border-gold bg-surface px-2 py-1 text-sm text-txt focus:outline-none"
                        />
                      ) : (
                        <div>
                          <div className="truncate font-medium">{t.desc}</div>
                          {t.notes && <div className="text-xs text-muted-txt truncate">{t.notes}</div>}
                        </div>
                      )}
                    </td>

                    {/* קטגוריה */}
                    <td className="px-4 py-2.5">
                      {isEditingCat ? (
                        <select
                          autoFocus
                          value={t.category}
                          onChange={e => { onCategoryChange(realIdx, e.target.value); setEditingCatIdx(null) }}
                          onBlur={() => setEditingCatIdx(null)}
                          className="rounded-lg border border-gold bg-surface px-2 py-1 text-xs text-txt focus:outline-none"
                        >
                          {ALL_CATEGORIES.map(c => (
                            <option key={c} value={c}>{CATEGORY_ICONS[c] ?? '📦'} {c}</option>
                          ))}
                        </select>
                      ) : (
                        <button onClick={() => { setEditingCatIdx(realIdx); setEditingDescIdx(null); setEditingAmountIdx(null) }}>
                          <CategoryBadge category={t.category} />
                        </button>
                      )}
                    </td>

                    {/* סכום */}
                    <td className="px-4 py-2.5">
                      {isEditingAmount ? (
                        <input
                          autoFocus
                          type="number"
                          value={editingAmountValue}
                          onChange={e => setEditingAmountValue(e.target.value)}
                          onBlur={commitAmount}
                          onKeyDown={e => { if (e.key === 'Enter') commitAmount(); if (e.key === 'Escape') setEditingAmountIdx(null) }}
                          min={0}
                          style={{ direction: 'ltr' }}
                          className="w-24 rounded border border-gold bg-surface px-2 py-1 text-sm text-txt text-left focus:outline-none tabular-nums"
                        />
                      ) : (
                        <span className={`font-medium tabular-nums whitespace-nowrap ${t.isRefund ? 'text-green-400' : 'text-txt'}`}>
                          {t.isRefund ? '+' : ''}{fmt(t.amount)}
                        </span>
                      )}
                    </td>

                    {/* תאריך */}
                    <td className="px-4 py-2.5 text-muted-txt text-xs whitespace-nowrap">{t.date}</td>

                    {/* פעולות */}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button title="חיפוש באינטרנט" onClick={() => searchOnline(t.desc)}
                          className="p-1.5 rounded hover:bg-surface text-muted-txt hover:text-txt transition-colors">
                          🌐
                        </button>
                        <button title="ערוך תיאור" onClick={() => startEditDesc(realIdx, t.desc)}
                          className="p-1.5 rounded hover:bg-surface text-muted-txt hover:text-txt transition-colors">
                          ✏️
                        </button>
                        <button title="ערוך סכום" onClick={() => startEditAmount(realIdx, t.amount)}
                          className="p-1.5 rounded hover:bg-surface text-muted-txt hover:text-txt transition-colors">
                          💲
                        </button>
                        <button title="שנה קטגוריה" onClick={() => { setEditingCatIdx(realIdx); setEditingDescIdx(null); setEditingAmountIdx(null) }}
                          className="p-1.5 rounded hover:bg-surface text-muted-txt hover:text-txt transition-colors">
                          🏷️
                        </button>
                        <button title="מחק עסקה" onClick={() => onDelete(realIdx)}
                          className="p-1.5 rounded hover:bg-surface text-muted-txt hover:text-expense transition-colors">
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-txt">אין תוצאות</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
