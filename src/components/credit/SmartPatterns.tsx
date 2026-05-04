'use client'

import { useState } from 'react'
import type { Transaction } from '@/types/transaction'

interface PatternItem {
  desc: string
  amount: number
  meta: string
  tag: string
  tagColor: string
  progress?: number
}

interface Section {
  icon: string
  title: string
  color: string
  items: PatternItem[]
}

function detectPatterns(txs: Transaction[]) {
  const standingOrders: Transaction[] = []
  const installments: Transaction[]   = []
  const refunds: Transaction[]        = []
  const merchantMap: Record<string, Transaction[]> = {}

  for (const t of txs) {
    if (t.isStandingOrder) standingOrders.push(t)
    if (t.installment)     installments.push(t)
    if (t.isRefund)        refunds.push(t)
    if (!t.isRefund) {
      const key = t.desc.toLowerCase().replace(/\s+/g, ' ').trim()
      if (!merchantMap[key]) merchantMap[key] = []
      merchantMap[key].push(t)
    }
  }

  const recurring: { desc: string; amount: number; count: number; category: string }[] = []
  const seen = new Set<string>()
  for (const [, group] of Object.entries(merchantMap)) {
    if (group.length < 2) continue
    const buckets: Record<number, Transaction[]> = {}
    for (const t of group) {
      const k = Math.round(t.amount * 10)
      if (!buckets[k]) buckets[k] = []
      buckets[k].push(t)
    }
    for (const [, bucket] of Object.entries(buckets)) {
      if (bucket.length < 2) continue
      const uid = group[0].desc + '|' + Math.round(group[0].amount * 10)
      if (!seen.has(uid)) {
        seen.add(uid)
        recurring.push({ desc: group[0].desc, amount: group[0].amount, count: bucket.length, category: group[0].category })
      }
    }
  }

  return { standingOrders, installments, refunds, recurring }
}

function fmt(n: number) {
  return '₪' + n.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function SectionBlock({ icon, title, color, items }: Section) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-line rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 bg-surface2 hover:bg-surface text-right"
      >
        <span>{icon}</span>
        <span className="font-medium text-sm flex-1 text-right">{title}</span>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${color}`}>
          {items.length}
        </span>
        <span className="text-muted-txt text-xs">{open ? '▼' : '▶'}</span>
      </button>

      {open && (
        <div className="divide-y divide-line">
          {items.map((item, i) => (
            <div key={i} className="px-4 py-2.5 flex items-center gap-3 text-sm">
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{item.desc}</div>
                {item.meta && <div className="text-xs text-muted-txt">{item.meta}</div>}
                {item.progress !== undefined && (
                  <div className="mt-1 h-1 bg-surface rounded-full overflow-hidden">
                    <div className="h-full bg-gold rounded-full" style={{ width: `${item.progress}%` }} />
                  </div>
                )}
              </div>
              <span className="font-medium text-gold">{fmt(item.amount)}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full border ${item.tagColor}`}>
                {item.tag}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function SmartPatterns({ transactions }: { transactions: Transaction[] }) {
  const p = detectPatterns(transactions)

  const sections: Section[] = [
    {
      icon: '📌',
      title: 'הוראות קבע',
      color: 'bg-blue-500/20 text-blue-300',
      items: p.standingOrders.map(t => ({
        desc: t.desc, amount: t.amount,
        meta: t.date,
        tag: 'הו"ק', tagColor: 'border-blue-400/50 text-blue-300',
      })),
    },
    {
      icon: '📅',
      title: 'תשלומים',
      color: 'bg-orange-500/20 text-orange-300',
      items: p.installments.map(t => {
        const inst = t.installment!
        const pct  = Math.round((inst.current / inst.total) * 100)
        const rem  = inst.total - inst.current
        return {
          desc: t.desc, amount: t.amount,
          meta: `תשלום ${inst.current} מתוך ${inst.total}${rem > 0 ? ` · נותרו ${rem}` : ' · אחרון!'}`,
          tag: `${inst.current}/${inst.total}`, tagColor: 'border-orange-400/50 text-orange-300',
          progress: pct,
        }
      }),
    },
    {
      icon: '🔄',
      title: 'חוזרים / מנויים אפשריים',
      color: 'bg-purple-500/20 text-purple-300',
      items: p.recurring.map(r => ({
        desc: r.desc, amount: r.amount,
        meta: `מופיע ${r.count} פעמים`,
        tag: 'חוזר', tagColor: 'border-purple-400/50 text-purple-300',
      })),
    },
    {
      icon: '↩️',
      title: 'החזרים / זיכויים',
      color: 'bg-green-500/20 text-green-300',
      items: p.refunds.map(t => ({
        desc: t.desc, amount: t.amount,
        meta: t.date,
        tag: 'זיכוי', tagColor: 'border-green-400/50 text-green-300',
      })),
    },
  ].filter(s => s.items.length > 0)

  if (!sections.length) return null

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-semibold text-gold">
        🔍 ניתוח חכם
      </div>
      <div className="space-y-2">
        {sections.map((s, i) => <SectionBlock key={i} {...s} />)}
      </div>
    </div>
  )
}
