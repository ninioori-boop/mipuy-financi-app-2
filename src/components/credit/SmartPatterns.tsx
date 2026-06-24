'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import type { Transaction } from '@/types/transaction'
import { useMappingStore } from '@/stores/mappingStore'

type MappingSection = 'fixed' | 'sub' | 'ins'

interface PatternItem {
  desc:      string
  amount:    number             // displayed amount (avg charge for recurring; single charge for standing orders)
  meta:      string
  tag:       string
  tagColor:  string
  progress?: number
  // When present, sending this item to mapping ALSO subtracts the merchant's
  // historical contribution from its source category row (so the category
  // total reduces and accounting stays clean).
  category?: string             // source category (auto-categorized)
  count?:    number             // how many times this merchant charged in the report
  total?:    number             // exact sum across all charges; preferred over amount × count when present
}

interface SendOption {
  label:         string             // button text, e.g. "קבועות"
  target:        MappingSection
  buttonClass:   string             // tailwind classes for the button color
}

interface Section {
  icon:         string
  title:        string
  color:        string
  items:        PatternItem[]
  sendActions?: SendOption[]         // when present, each item gets one button per option
}

function detectPatterns(txs: Transaction[]) {
  const standingOrders: Transaction[] = []
  const installments: Transaction[]   = []
  const refunds: Transaction[]        = []
  const merchantMap: Record<string, Transaction[]> = {}
  // Subscriptions = anything auto-categorized as "מנויים", grouped by merchant.
  // Kept separate from `recurring` (which is purely pattern-based: any merchant
  // with 2+ charges) so the advisor can SEE all subs at a glance — including
  // single-charge ones the pattern detector ignores.
  const subscriptionsMap: Record<string, Transaction[]> = {}

  for (const t of txs) {
    if (t.isStandingOrder) standingOrders.push(t)
    if (t.installment)     installments.push(t)
    if (t.isRefund)        refunds.push(t)
    if (!t.isRefund) {
      const key = t.desc.toLowerCase().replace(/\s+/g, ' ').trim()
      if (!merchantMap[key]) merchantMap[key] = []
      merchantMap[key].push(t)
      if (t.category === 'מנויים') {
        if (!subscriptionsMap[key]) subscriptionsMap[key] = []
        subscriptionsMap[key].push(t)
      }
    }
  }

  // Group all charges from the same merchant (regardless of amount). The old
  // "bucket by exact amount" logic missed merchants with varying prices (e.g.
  // APPLE.COM/BILL ITUNES with charges of 130/120/120 was reported as "2
  // times at 120" — losing the 130). One row per merchant now, with the
  // average charge as the display amount and the exact period total
  // available for downstream subtract-from-category math.
  const recurring: { desc: string; amount: number; count: number; total: number; category: string }[] = []
  for (const [, group] of Object.entries(merchantMap)) {
    if (group.length < 2) continue
    const total = group.reduce((s, t) => s + t.amount, 0)
    recurring.push({
      desc:     group[0].desc,
      amount:   Math.round(total / group.length),
      count:    group.length,
      total:    Math.round(total),
      category: group[0].category,
    })
  }
  // Show the biggest spenders first so the coach scans the relevant ones fast
  recurring.sort((a, b) => b.total - a.total)

  const subscriptions: { desc: string; amount: number; count: number; total: number; category: string }[] = []
  for (const [, group] of Object.entries(subscriptionsMap)) {
    const total = group.reduce((s, t) => s + t.amount, 0)
    subscriptions.push({
      desc:     group[0].desc,
      amount:   Math.round(total / group.length),
      count:    group.length,
      total:    Math.round(total),
      category: 'מנויים',
    })
  }
  subscriptions.sort((a, b) => b.total - a.total)

  return { standingOrders, installments, refunds, recurring, subscriptions }
}

function fmt(n: number) {
  return '₪' + n.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function itemKey(item: PatternItem): string {
  return `${item.desc}|${Math.round(item.amount * 10)}`
}

function SectionBlock({
  icon, title, color, items, sendActions, sentItems, onSend,
}: Section & {
  sentItems: Map<string, string>     // itemKey → targetLabel of the section it was sent to
  onSend:    (item: PatternItem, target: MappingSection, targetLabel: string) => void
}) {
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
          {items.map((item, i) => {
            const key      = itemKey(item)
            const sentTo   = sentItems.get(key)
            return (
              <div key={i} className="px-4 py-2.5 flex items-center gap-2 text-sm flex-wrap">
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
                {sendActions && (
                  sentTo ? (
                    <span className="text-xs px-2 py-0.5 rounded-lg border border-green-400/30 bg-green-400/10 text-green-400 whitespace-nowrap">
                      ✓ נשלח ל{sentTo}
                    </span>
                  ) : (
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-xs text-muted-txt">→</span>
                      {sendActions.map(action => (
                        <button
                          key={action.target}
                          onClick={() => onSend(item, action.target, action.label)}
                          className={`text-xs px-2 py-0.5 rounded-lg border transition-colors whitespace-nowrap ${action.buttonClass}`}
                          title={`שלח ל${action.label} במיפוי`}
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  )
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function SmartPatterns({ transactions }: { transactions: Transaction[] }) {
  const p = detectPatterns(transactions)
  const importFromBank = useMappingStore(s => s.importFromBank)
  const [sentItems, setSentItems] = useState<Map<string, string>>(new Map())

  function handleSend(item: PatternItem, target: MappingSection, targetLabel: string) {
    const amount = Math.round(item.amount)
    // Prefer the exact period total when detectPatterns supplied one (variable-
    // amount merchants like Apple iTunes). Fall back to amount × count for
    // standing orders where the single-charge amount IS monthly and count=1.
    const subtractTotal = item.total
      ?? (item.count ? Math.round(item.amount * item.count) : amount)
    const subtractFrom  = item.category
      ? { category: item.category, amount: subtractTotal }
      : undefined
    importFromBank([{ name: item.desc, amount, section: target, subtractFrom }])
    setSentItems(prev => {
      const next = new Map(prev)
      next.set(itemKey(item), targetLabel)
      return next
    })
    toast.success(`✅ "${item.desc}" נשלח ל${targetLabel} במיפוי`)
  }

  // Three colored chip styles for the multi-target send picker
  // (used by both "standing orders" and "recurring" sections — the same item
  // can legitimately be a fixed cost, a subscription, or an insurance payment)
  const fixedBtn = 'border-blue-400/40 bg-blue-400/10 text-blue-300 hover:bg-blue-400/25'
  const subBtn   = 'border-purple-400/40 bg-purple-400/10 text-purple-300 hover:bg-purple-400/25'
  const insBtn   = 'border-orange-400/40 bg-orange-400/10 text-orange-300 hover:bg-orange-400/25'

  const sections: Section[] = [
    // Subscriptions section — kept FIRST because it's the one the advisor most
    // often wants to carve out into per-merchant rows in mapping (Netflix,
    // Spotify, ChatGPT, gym, etc.). Sending one here subtracts its total from
    // the aggregated "מנויים" category row so accounting stays clean.
    {
      icon: '🎬',
      title: 'מנויים מזוהים',
      color: 'bg-purple-500/20 text-purple-300',
      items: p.subscriptions.map(s => ({
        desc:   s.desc,
        amount: s.amount,
        meta:   s.count === 1
          ? `חיוב יחיד · ${fmt(s.total)}`
          : `${s.count} חיובים · סה"כ ${fmt(s.total)}`,
        tag:    'מנוי', tagColor: 'border-purple-400/50 text-purple-300',
        category: s.category,
        count:    s.count,
        total:    s.total,
      })),
      sendActions: [
        { label: 'קבועות', target: 'fixed' as const, buttonClass: fixedBtn },
        { label: 'מנויים', target: 'sub'   as const, buttonClass: subBtn   },
        { label: 'ביטוחים', target: 'ins'  as const, buttonClass: insBtn   },
      ],
    },
    {
      icon: '📌',
      title: 'הוראות קבע',
      color: 'bg-blue-500/20 text-blue-300',
      items: p.standingOrders.map(t => ({
        desc: t.desc, amount: t.amount,
        meta: t.date,
        tag: 'הו"ק', tagColor: 'border-blue-400/50 text-blue-300',
        category: t.category,
        count: 1,                                     // standing orders are typically one charge per month
      })),
      sendActions: [
        { label: 'קבועות', target: 'fixed' as const, buttonClass: fixedBtn },
        { label: 'מנויים', target: 'sub'   as const, buttonClass: subBtn   },
        { label: 'ביטוחים', target: 'ins'  as const, buttonClass: insBtn   },
      ],
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
        desc:   r.desc,
        amount: r.amount,
        meta:   `${r.count} חיובים · סה"כ ${fmt(r.total)}`,
        tag:    'חוזר', tagColor: 'border-purple-400/50 text-purple-300',
        category: r.category,
        count:    r.count,
        total:    r.total,
      })),
      sendActions: [
        { label: 'קבועות', target: 'fixed' as const, buttonClass: fixedBtn },
        { label: 'מנויים', target: 'sub'   as const, buttonClass: subBtn   },
        { label: 'ביטוחים', target: 'ins'  as const, buttonClass: insBtn   },
      ],
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
        {sections.map((s, i) => (
          <SectionBlock key={i} {...s} sentItems={sentItems} onSend={handleSend} />
        ))}
      </div>
    </div>
  )
}
