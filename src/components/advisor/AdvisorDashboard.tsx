'use client'

import { useState } from 'react'
import {
  fmt, kpis, needsAttention, sortForList, clientTotals, isSnapshotable,
  type MockClient,
} from '@/lib/advisorMock'
import { LifecycleBadge, FlagList, StageIndicator, FlagPill } from './StatusPills'
import { AddClientForm } from './AddClientForm'

interface Props {
  clients:      MockClient[]
  onOpenClient: (id: string) => void
  onAddClient:  (email: string) => void
  onOpenEmail:  () => void
}

const dateFmt = (iso: string) => {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })
}

function KpiTile({ label, value, tone = 'text-txt' }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface2 p-3 sm:p-4">
      <div className="text-xs text-muted-txt mb-1">{label}</div>
      <div className={`text-2xl font-black tabular-nums ${tone}`}>{value}</div>
    </div>
  )
}

export function AdvisorDashboard({ clients, onOpenClient, onAddClient, onOpenEmail }: Props) {
  const [addOpen, setAddOpen] = useState(false)
  const k         = kpis(clients)
  const attention = needsAttention(clients)
  const ordered   = sortForList(clients)

  return (
    <div className="max-w-6xl mx-auto space-y-4 sm:space-y-6 pb-16">

      {/* Header */}
      <div className="rounded-xl border border-line bg-surface2 p-5 sm:p-6 flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-gold mb-1">🧑‍💼 ניהול לקוחות</h1>
          <p className="text-muted-txt text-sm">מבט על כל הלקוחות שלך, מי מתקדם, מי תקוע, ומי דורש טיפול.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={onOpenEmail}
            className="min-h-[44px] rounded-lg border border-line bg-surface px-4 text-sm text-muted-txt hover:text-gold hover:border-gold/40 transition-colors"
          >
            👁️ מייל שבועי
          </button>
          <button
            onClick={() => setAddOpen(v => !v)}
            className="min-h-[44px] rounded-lg bg-gold/20 text-gold border border-gold/40 px-5 text-sm font-semibold hover:bg-gold/30 transition-colors"
          >
            ➕ הוסף לקוח
          </button>
        </div>
      </div>

      {addOpen && (
        <AddClientForm onAdd={email => { onAddClient(email); setAddOpen(false) }} onCancel={() => setAddOpen(false)} />
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile label="לקוחות פעילים"  value={k.active} />
        <KpiTile label="ממתינים להצטרפות" value={k.pending} tone="text-gold" />
        <KpiTile label="דורשים טיפול"    value={k.attention} tone="text-expense" />
        <KpiTile label="בוגרים"          value={k.graduated} tone="text-muted-txt" />
      </div>

      {/* Needs attention */}
      {attention.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-bold text-expense flex items-center gap-2">🔴 דורשים טיפול ({attention.length})</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {attention.map(c => (
              <button
                key={c.id}
                onClick={() => onOpenClient(c.id)}
                className="text-start rounded-xl border border-line bg-surface2 border-s-4 border-s-expense px-4 py-3 hover:bg-surface3 transition-colors"
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="font-semibold text-txt truncate">{c.name}</span>
                  <StageIndicator stage={c.stage} />
                </div>
                <div className="flex flex-wrap gap-1">
                  {c.flags.map(f => <FlagPill key={f} flag={f} />)}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Client list — desktop table */}
      <div className="hidden md:block rounded-xl border border-line bg-surface2 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead className="bg-surface border-b border-line">
              <tr className="text-muted-txt">
                <th className="text-start px-4 py-3 font-medium">לקוח</th>
                <th className="text-start px-4 py-3 font-medium">סטטוס</th>
                <th className="text-start px-4 py-3 font-medium">שלב</th>
                <th className="text-start px-4 py-3 font-medium">תזרים</th>
                <th className="text-start px-4 py-3 font-medium">הכנסות</th>
                <th className="text-start px-4 py-3 font-medium">הוצאות</th>
                <th className="text-start px-4 py-3 font-medium">יעדים</th>
                <th className="text-start px-4 py-3 font-medium">דגלים</th>
                <th className="text-start px-4 py-3 font-medium">פעילות</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {ordered.map(c => {
                const t = clientTotals(c.fin)
                const snap = isSnapshotable(c)
                const goalsN = c.fin.goals.filter(g => g.name || g.required > 0).length
                return (
                  <tr
                    key={c.id}
                    onClick={() => onOpenClient(c.id)}
                    className="hover:bg-surface3/60 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-txt">{c.name}</div>
                      <div className="text-xs text-muted-txt" dir="ltr">{c.email}</div>
                    </td>
                    <td className="px-4 py-3"><LifecycleBadge lifecycle={c.lifecycle} /></td>
                    <td className="px-4 py-3"><StageIndicator stage={c.stage} /></td>
                    <td className={`px-4 py-3 tabular-nums whitespace-nowrap font-semibold ${!snap ? 'text-muted-txt' : t.cashflow >= 0 ? 'text-income' : 'text-expense'}`}>
                      {snap ? (t.cashflow >= 0 ? '+' : '−') + fmt(Math.abs(t.cashflow)) : '—'}
                    </td>
                    <td className="px-4 py-3 tabular-nums whitespace-nowrap text-muted-txt">{snap ? fmt(t.income) : '—'}</td>
                    <td className="px-4 py-3 tabular-nums whitespace-nowrap text-muted-txt">{snap ? fmt(t.expenses) : '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-txt">{snap ? `${goalsN} יעדים` : '—'}</td>
                    <td className="px-4 py-3"><FlagList flags={c.flags} /></td>
                    <td className="px-4 py-3 text-xs text-muted-txt whitespace-nowrap">{dateFmt(c.lastActivity)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Client list — mobile cards */}
      <div className="md:hidden space-y-3">
        {ordered.map(c => {
          const t = clientTotals(c.fin)
          const snap = isSnapshotable(c)
          return (
            <button
              key={c.id}
              onClick={() => onOpenClient(c.id)}
              className="w-full text-start rounded-xl border border-line bg-surface2 p-4 space-y-2.5 hover:bg-surface3 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-txt truncate">{c.name}</div>
                  <div className="text-xs text-muted-txt truncate" dir="ltr">{c.email}</div>
                </div>
                <LifecycleBadge lifecycle={c.lifecycle} />
              </div>
              {snap ? (
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-surface border border-line p-2">
                    <div className="text-[10px] text-muted-txt">הכנסות</div>
                    <div className="text-xs font-bold text-income tabular-nums">{fmt(t.income)}</div>
                  </div>
                  <div className="rounded-lg bg-surface border border-line p-2">
                    <div className="text-[10px] text-muted-txt">הוצאות</div>
                    <div className="text-xs font-bold text-expense tabular-nums">{fmt(t.expenses)}</div>
                  </div>
                  <div className="rounded-lg bg-surface border border-line p-2">
                    <div className="text-[10px] text-muted-txt">תזרים</div>
                    <div className={`text-xs font-bold tabular-nums ${t.cashflow >= 0 ? 'text-income' : 'text-expense'}`}>
                      {(t.cashflow >= 0 ? '+' : '−') + fmt(Math.abs(t.cashflow))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-muted-txt">עוד לא נרשם — אין נתונים.</div>
              )}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <StageIndicator stage={c.stage} />
                <FlagList flags={c.flags} />
              </div>
            </button>
          )
        })}
      </div>

    </div>
  )
}
