'use client'

import { useState } from 'react'
import { kpis, dashboardSections, type MockClient } from '@/lib/advisorMock'
import { AddClientForm } from './AddClientForm'
import { ClientCard } from './ClientCard'

interface Props {
  clients:      MockClient[]
  advisorName?: string
  onOpenClient: (id: string) => void
  onAddClient:  (email: string) => void | Promise<void>
  onOpenEmail:  () => void
}

function KpiTile({
  label, value, tone, dot,
}: { label: string; value: number; tone: string; dot: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface2 p-4 sm:p-5 transition-colors hover:border-gold/25">
      <div className="flex items-center gap-1.5 mb-2">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
        <span className="text-[11px] uppercase tracking-wider text-muted-txt">{label}</span>
      </div>
      <div className={`text-3xl sm:text-4xl font-bold tabular-nums leading-none ${tone}`}>{value}</div>
    </div>
  )
}

function Section({
  icon, title, tone, clients, onOpen,
}: { icon: string; title: string; tone: string; clients: MockClient[]; onOpen: (id: string) => void }) {
  if (clients.length === 0) return null
  return (
    <section className="space-y-3">
      <h2 className={`text-xs uppercase tracking-wider flex items-center gap-2 px-1 ${tone}`}>
        <span aria-hidden>{icon}</span>
        {title}
        <span className="text-muted-txt">· {clients.length}</span>
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {clients.map(c => <ClientCard key={c.id} client={c} onOpen={onOpen} />)}
      </div>
    </section>
  )
}

export function AdvisorDashboard({ clients, advisorName, onOpenClient, onAddClient, onOpenEmail }: Props) {
  const [addOpen, setAddOpen] = useState(false)
  const k = kpis(clients)
  const s = dashboardSections(clients)

  return (
    <div className="max-w-6xl mx-auto space-y-6 sm:space-y-8 pb-16">

      {/* Header — editorial */}
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 pt-1">
        <div className="min-w-0 space-y-1.5">
          <div className="text-[11px] uppercase tracking-[0.2em] text-gold/80">פאנל יועץ</div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-txt">
            {advisorName ? `שלום, ${advisorName}` : 'ניהול לקוחות'}
          </h1>
          <p className="text-sm text-muted-txt">
            מבט על כל הלקוחות שלך — מי דורש טיפול, מי נופל בין הכיסאות, ומי מתקדם יפה.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <button
            onClick={onOpenEmail}
            className="min-h-[44px] rounded-full border border-line bg-surface px-4 text-sm text-muted-txt hover:text-gold hover:border-gold/40 transition-colors"
          >
            👁️ מייל שבועי
          </button>
          <button
            onClick={() => setAddOpen(v => !v)}
            className="min-h-[44px] rounded-full bg-gold text-surface px-5 text-sm font-semibold hover:bg-gold-light transition-colors"
          >
            ➕ הוסף לקוח
          </button>
        </div>
      </header>

      {addOpen && (
        <AddClientForm onAdd={async email => { await onAddClient(email); setAddOpen(false) }} onCancel={() => setAddOpen(false)} />
      )}

      {/* KPI strip — the 30-second overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <KpiTile label="לקוחות פעילים" value={k.active}    tone="text-txt"       dot="bg-income" />
        <KpiTile label="דורשים טיפול"  value={k.attention} tone={k.attention > 0 ? 'text-expense' : 'text-txt'} dot="bg-expense" />
        <KpiTile label="לא קיבלו יחס"  value={k.neglected} tone={k.neglected > 0 ? 'text-gold' : 'text-txt'}    dot="bg-gold" />
        <KpiTile label="ממתינים"       value={k.pending}   tone="text-muted-txt" dot="bg-muted-txt" />
      </div>

      {/* Sections — triage order */}
      <Section icon="🔴" title="דורשים טיפול"                tone="text-expense"   clients={s.attention}   onOpen={onOpenClient} />
      <Section icon="🟡" title="לקוחות שלא קיבלו יחס לאחרונה"  tone="text-gold"      clients={s.neglected}   onOpen={onOpenClient} />
      <Section icon="🟢" title="מתקדמים יפה"                  tone="text-income"    clients={s.progressing} onOpen={onOpenClient} />
      <Section icon="⚪" title="ממתינים להצטרפות"             tone="text-muted-txt" clients={s.pending}     onOpen={onOpenClient} />
      <Section icon="🔒" title="לא משתפים כרגע"               tone="text-muted-txt" clients={s.notSharing}  onOpen={onOpenClient} />

      {clients.length === 0 && (
        <div className="rounded-2xl border border-line bg-surface2 p-6 sm:p-8 text-center text-muted-txt">
          עוד אין לקוחות. לחץ על כפתור הוספת הלקוח כדי לשלוח הזמנה ראשונה.
        </div>
      )}
    </div>
  )
}
