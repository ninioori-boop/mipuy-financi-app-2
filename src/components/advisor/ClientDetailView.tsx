'use client'

import { CashflowSummary } from '@/components/mapping/CashflowSummary'
import { fmt, isSnapshotable, type MockClient } from '@/lib/advisorMock'
import { LifecycleBadge } from './StatusPills'

// Screen 3 — the advisor "enters" a client's account. Prototype: read-only,
// fed by mock data, reusing the real CashflowSummary. The impersonation banner
// and the "someone else editing" warning are visual only (no real access).

interface Props {
  client: MockClient
  onExit: () => void
}

const dateFmt = (iso: string) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('he-IL', { month: '2-digit', year: 'numeric' })
}

export function ClientDetailView({ client, onExit }: Props) {
  const f = client.fin
  const snap = isSnapshotable(client)
  const goals = f.goals.filter(g => g.name || g.required > 0)

  return (
    <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6 pb-16">

      {/* Impersonation banner */}
      <div className="sticky top-0 z-20 rounded-xl border border-gold/40 bg-gold/10 backdrop-blur p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg">👁️</span>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gold truncate">אתה עורך את החשבון של {client.name}</div>
            <div className="text-xs text-muted-txt truncate" dir="ltr">{client.email}</div>
          </div>
        </div>
        <button
          onClick={onExit}
          className="min-h-[44px] rounded-lg bg-surface border border-line px-4 text-sm text-txt hover:border-gold/40 transition-colors whitespace-nowrap"
        >
          ⟵ חזרה לרשימת הלקוחות
        </button>
      </div>

      {/* Client meta strip */}
      <div className="rounded-xl border border-line bg-surface2 p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <LifecycleBadge lifecycle={client.lifecycle} />
          {client.phone && <span className="text-xs text-muted-txt" dir="ltr">{client.phone}</span>}
        </div>
        <div className="text-xs text-muted-txt">פעילות אחרונה: {new Date(client.lastActivity).toLocaleDateString('he-IL')}</div>
      </div>

      {/* Concurrency warning — static demo */}
      {client.beingEdited && (
        <div className="rounded-xl border border-line bg-surface2 border-s-4 border-s-gold px-4 py-3 text-sm text-txt">
          ⚠️ יועץ אחר (מנהל המשרד) צופה כעת בחשבון זה. שינויים אחרונים מנצחים.
        </div>
      )}

      {snap ? (
        <>
          {/* Reused, read-only cashflow snapshot */}
          <CashflowSummary
            income={f.income} fixed={f.fixed} sub={f.sub} ins={f.ins} variable={f.variable}
            annual={f.annual} debts={f.debts} installments={f.installments} savings={f.savings}
            varMonths={f.varMonths}
          />

          {/* Goals block (read-only) */}
          <div className="rounded-xl border border-line bg-surface2 p-4 sm:p-5 space-y-3">
            <h2 className="font-semibold text-txt">🎯 יעדים</h2>
            {goals.length === 0 && <p className="text-xs text-muted-txt">אין יעדים מוגדרים.</p>}
            <div className="space-y-3">
              {goals.map(g => {
                const pct = g.required > 0 ? Math.min(100, Math.round((g.current / g.required) * 100)) : 0
                return (
                  <div key={g.id} className="rounded-lg bg-surface/40 p-3 space-y-2">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2">
                      <span className="font-medium text-txt">{g.name || 'מטרה'}</span>
                      <span className="text-xs text-muted-txt tabular-nums">
                        {fmt(g.current)} מתוך {fmt(g.required)} · {fmt(g.monthly)}/חודש · יעד {dateFmt(g.targetDate)}
                        {g.product ? ` · ${g.product}` : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 rounded-full bg-line overflow-hidden">
                        <div className={`h-full rounded-full ${pct >= 100 ? 'bg-income' : pct >= 80 ? 'bg-gold' : 'bg-income/70'}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs font-semibold text-gold tabular-nums w-10 text-end">{pct}%</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <p className="text-[11px] text-muted-txt text-center">תצוגה מוקטנת לצורך הדגמת העיצוב. בגרסה המלאה כאן ייערכו המיפוי, התקציב והיעדים ישירות.</p>
        </>
      ) : (
        <div className="rounded-xl border border-line bg-surface2 p-8 text-center space-y-2">
          <div className="text-3xl">📭</div>
          <div className="font-semibold text-txt">הלקוח עדיין לא נרשם</div>
          <p className="text-sm text-muted-txt">ברגע שהלקוח ישלים הרשמה עם המייל שהוזמן, החשבון שלו יופיע כאן.</p>
        </div>
      )}

    </div>
  )
}
