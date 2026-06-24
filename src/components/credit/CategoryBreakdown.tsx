'use client'

import { useState } from 'react'
import type { Transaction } from '@/types/transaction'
import { CATEGORY_ICONS } from '@/lib/constants'
import { CategoryPicker } from '@/components/shared/CategoryPicker'

// Per-device persistence for the open-category state in CategoryBreakdown.
// Local-only on purpose (not synced via Firestore): expansion is purely a
// UX preference, and bouncing it through the snapshot would create chatty
// writes on every accordion click. localStorage is enough — the advisor
// can refresh / close / reopen the credit tab and the same category stays
// expanded so they can keep walking the client through the same line item.
const OPEN_CATEGORY_STORAGE_KEY = 'credit-breakdown-open-category'

function readStoredOpenCategory(): string | null {
  if (typeof window === 'undefined') return null
  try { return window.localStorage.getItem(OPEN_CATEGORY_STORAGE_KEY) } catch { return null }
}

function writeStoredOpenCategory(cat: string | null) {
  if (typeof window === 'undefined') return
  try {
    if (cat === null) window.localStorage.removeItem(OPEN_CATEGORY_STORAGE_KEY)
    else window.localStorage.setItem(OPEN_CATEGORY_STORAGE_KEY, cat)
  } catch { /* quota / disabled storage — non-fatal */ }
}

interface TxEntry { t: Transaction; idx: number }

interface CategoryGroup {
  category: string
  total: number
  count: number
  entries: TxEntry[]
}

function fmt(n: number) {
  return '₪' + n.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function buildGroups(transactions: Transaction[]): CategoryGroup[] {
  const map = new Map<string, { total: number; count: number; entries: TxEntry[] }>()
  transactions.forEach((t, idx) => {
    if (t.isRefund) return
    const entry = map.get(t.category) ?? { total: 0, count: 0, entries: [] }
    entry.total += t.amount
    entry.count++
    entry.entries.push({ t, idx })
    map.set(t.category, entry)
  })
  return Array.from(map.entries())
    .map(([category, data]) => ({ category, ...data }))
    .sort((a, b) => b.total - a.total)
}

interface Props {
  transactions: Transaction[]
  onCategoryChange: (idx: number, category: string) => void
  onDescChange: (idx: number, desc: string) => void
  onAmountChange: (idx: number, amount: number) => void
  onDelete: (idx: number) => void
}

export function CategoryBreakdown({ transactions, onCategoryChange, onDescChange, onAmountChange, onDelete }: Props) {
  // Lazy initializer runs once on first render. CategoryBreakdown is only
  // rendered inside the parent's `hasResults && (...)` block — which is
  // always client-side (creditStore hydrates from Firestore post-auth), so
  // it's safe to touch localStorage here without an SSR/hydration mismatch.
  const [openCategory, setOpenCategoryState] = useState<string | null>(readStoredOpenCategory)
  const setOpenCategory = (cat: string | null) => {
    setOpenCategoryState(cat)
    writeStoredOpenCategory(cat)
  }
  const [editingDesc, setEditingDesc] = useState<{ idx: number; value: string } | null>(null)
  const [editingAmount, setEditingAmount] = useState<{ idx: number; value: string } | null>(null)
  const [editingCat, setEditingCat] = useState<number | null>(null)

  const groups = buildGroups(transactions)
  if (groups.length === 0) return null
  const grandTotal = groups.reduce((s, g) => s + g.total, 0)

  function commitDesc() {
    if (editingDesc && editingDesc.value.trim()) {
      onDescChange(editingDesc.idx, editingDesc.value.trim())
    }
    setEditingDesc(null)
  }

  function commitAmount() {
    if (editingAmount) {
      const v = parseFloat(editingAmount.value)
      if (!isNaN(v) && v >= 0) onAmountChange(editingAmount.idx, v)
    }
    setEditingAmount(null)
  }

  function searchOnline(desc: string) {
    window.open(`https://www.google.com/search?q=${encodeURIComponent(desc)}`, '_blank')
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-semibold text-txt">
          {groups.length} קטגוריות — {fmt(grandTotal)} סה&quot;כ
        </span>
        {openCategory && (
          <button onClick={() => setOpenCategory(null)} className="text-xs text-muted-txt hover:text-txt transition-colors">
            סגור פירוט ×
          </button>
        )}
      </div>

      {groups.map(group => {
        const pct = grandTotal > 0 ? (group.total / grandTotal) * 100 : 0
        const isOpen = openCategory === group.category
        const icon = CATEGORY_ICONS[group.category] ?? '📦'

        return (
          <div key={group.category} className="rounded-xl border border-line bg-surface overflow-hidden">
            {/* Category header row */}
            <button
              onClick={() => setOpenCategory(isOpen ? null : group.category)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface2/60 transition-colors text-right"
            >
              <span className="text-lg shrink-0">{icon}</span>
              <span className="flex-1 text-sm font-medium text-txt text-right">{group.category}</span>
              <div className="w-24 h-1.5 rounded-full bg-line overflow-hidden shrink-0">
                <div className="h-full rounded-full bg-gold/70" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-xs text-muted-txt w-10 text-left shrink-0 tabular-nums">{pct.toFixed(0)}%</span>
              <span className="text-xs text-muted-txt w-7 text-left shrink-0 tabular-nums">{group.count}</span>
              <span className="font-bold text-gold tabular-nums shrink-0 w-24 text-left">{fmt(group.total)}</span>
              <span className={`text-muted-txt text-xs transition-transform shrink-0 ${isOpen ? 'rotate-180' : ''}`}>▼</span>
            </button>

            {/* Expanded transaction list */}
            {isOpen && (
              <div className="border-t border-line">
                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-surface2 border-b border-line z-10">
                      <tr>
                        <th className="text-right px-4 py-2 font-medium text-muted-txt">תיאור</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-txt">קטגוריה</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-txt">תאריך</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-txt">סכום</th>
                        <th className="text-center px-3 py-2 font-medium text-muted-txt">פעולות</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line/50">
                      {group.entries
                        .slice()
                        .sort((a, b) => b.t.amount - a.t.amount)
                        .map(({ t, idx }) => (
                          <tr key={idx} className="hover:bg-surface2/40 group">

                            {/* תיאור */}
                            <td className="px-4 py-2 max-w-[200px]">
                              {editingDesc?.idx === idx ? (
                                <input
                                  autoFocus
                                  value={editingDesc.value}
                                  onChange={e => setEditingDesc({ idx, value: e.target.value })}
                                  onBlur={commitDesc}
                                  onKeyDown={e => { if (e.key === 'Enter') commitDesc(); if (e.key === 'Escape') setEditingDesc(null) }}
                                  className="w-full rounded border border-gold bg-surface px-2 py-0.5 text-xs text-txt focus:outline-none"
                                />
                              ) : (
                                <div>
                                  <div className="truncate text-txt">{t.desc}</div>
                                  {t.notes && <div className="truncate text-muted-txt">{t.notes}</div>}
                                </div>
                              )}
                            </td>

                            {/* קטגוריה */}
                            <td className="px-3 py-2">
                              <CategoryPicker
                                value={t.category}
                                onChange={c => { onCategoryChange(idx, c); setEditingCat(null) }}
                                autoOpen={editingCat === idx}
                                onClose={() => setEditingCat(null)}
                                variant="chip"
                              />
                            </td>

                            {/* תאריך */}
                            <td className="px-3 py-2 text-muted-txt whitespace-nowrap">{t.date}</td>

                            {/* סכום */}
                            <td className="px-3 py-2 text-left">
                              {editingAmount?.idx === idx ? (
                                <input
                                  autoFocus
                                  type="number"
                                  value={editingAmount.value}
                                  onChange={e => setEditingAmount({ idx, value: e.target.value })}
                                  onBlur={commitAmount}
                                  onKeyDown={e => { if (e.key === 'Enter') commitAmount(); if (e.key === 'Escape') setEditingAmount(null) }}
                                  min={0}
                                  style={{ direction: 'ltr' }}
                                  className="w-20 rounded border border-gold bg-surface px-2 py-0.5 text-xs text-txt text-left focus:outline-none tabular-nums"
                                />
                              ) : (
                                <span className="font-medium text-gold tabular-nums whitespace-nowrap">{fmt(t.amount)}</span>
                              )}
                            </td>

                            {/* פעולות */}
                            <td className="px-3 py-2">
                              <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  title="חיפוש באינטרנט"
                                  onClick={() => searchOnline(t.desc)}
                                  className="p-1 rounded hover:bg-surface text-muted-txt hover:text-txt transition-colors"
                                >🌐</button>
                                <button
                                  title="ערוך תיאור"
                                  onClick={() => { setEditingDesc({ idx, value: t.desc }); setEditingAmount(null); setEditingCat(null) }}
                                  className="p-1 rounded hover:bg-surface text-muted-txt hover:text-txt transition-colors"
                                >✏️</button>
                                <button
                                  title="ערוך סכום"
                                  onClick={() => { setEditingAmount({ idx, value: String(t.amount) }); setEditingDesc(null); setEditingCat(null) }}
                                  className="p-1 rounded hover:bg-surface text-muted-txt hover:text-txt transition-colors"
                                >💲</button>
                                <button
                                  title="שנה קטגוריה"
                                  onClick={() => { setEditingCat(idx); setEditingDesc(null); setEditingAmount(null) }}
                                  className="p-1 rounded hover:bg-surface text-muted-txt hover:text-txt transition-colors"
                                >🏷️</button>
                                <button
                                  title="מחק עסקה"
                                  onClick={() => onDelete(idx)}
                                  className="p-1 rounded hover:bg-surface text-muted-txt hover:text-expense transition-colors"
                                >🗑️</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                    <tfoot className="border-t border-line bg-surface2">
                      <tr>
                        <td colSpan={3} className="px-4 py-2 text-xs font-semibold text-muted-txt">
                          {group.count} עסקאות
                        </td>
                        <td className="px-3 py-2 text-left font-bold text-gold tabular-nums">
                          {fmt(group.total)}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
