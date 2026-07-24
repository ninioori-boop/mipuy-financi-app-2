'use client'

import { CashflowSummary } from '@/components/mapping/CashflowSummary'
import { fmt, isSnapshotable, neglectFlags, STAGE_LABELS, type MockClient } from '@/lib/advisorMock'
import { LifecycleBadge, NeglectPill, FlagPill } from './StatusPills'
import { Avatar } from './Avatar'

// Screen 3 — the advisor "enters" a client's account. Real data: view + (with
// the client's edit consent) edit. The edit controls below drive the real
// impersonation flow via the parent's handlers.

interface Props {
  client:      MockClient
  onExit:      () => void
  /** Enter read-only view-as-client mode (all tabs show this client's data). */
  onViewFull?:   () => void
  /** Enter EDIT mode — only wired when the client granted access:'write'. */
  onEditFull?:   () => void
  /** Ask the client for edit access (sets requestedAccess:'write'). */
  onRequestEdit?: () => void
  /** Update the engagement stage after a meeting. */
  onSetStage?:   (stage: string) => void
}

const dateFmt = (iso: string) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('he-IL', { month: '2-digit', year: 'numeric' })
}

const FINAL_STAGE = 'סוף תהליך'

export function ClientDetailView({ client, onExit, onViewFull, onEditFull, onRequestEdit, onSetStage }: Props) {
  const f = client.fin
  const snap = isSnapshotable(client)
  const goals = f.goals.filter(g => g.name || g.required > 0)
  const neg = neglectFlags(client)

  const isActive    = client.lifecycle === 'active'
  const canEdit     = client.access === 'write'
  const editPending = !canEdit && client.requestedAccess === 'write'
  const currentStage = STAGE_LABELS[client.stage] ?? STAGE_LABELS[0]

  function onStageChange(next: string) {
    if (!onSetStage || next === currentStage) return
    if (next === FINAL_STAGE) {
      const ok = window.confirm('סימון "סוף תהליך" יסגור אוטומטית את הרשאת העריכה שלך אצל הלקוח. להמשיך?')
      if (!ok) return
    }
    onSetStage(next)
  }

  return (
    <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6 pb-16">

      {/* Impersonation banner */}
      <div className="sticky top-0 z-20 rounded-2xl border border-gold/40 bg-gold/10 backdrop-blur p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar name={client.name} size="lg" />
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-gold/80">כרטיס הלקוח של</div>
            <div className="text-base font-bold text-txt truncate">{client.name}</div>
            <div className="text-xs text-muted-txt truncate" dir="ltr">{client.email}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Access badge */}
          {snap && (
            <span className={`text-xs font-semibold rounded-full px-3 py-1.5 ${
              canEdit ? 'bg-income/15 text-income'
                : editPending ? 'bg-gold/15 text-gold'
                : 'bg-surface border border-line text-muted-txt'
            }`}>
              {canEdit ? '✏️ עריכה מאושרת' : editPending ? '⏳ בקשת עריכה נשלחה' : '👁️ צפייה בלבד'}
            </span>
          )}
          {/* View — always available on a snapshotable client */}
          {snap && onViewFull && (
            <button
              onClick={onViewFull}
              className="min-h-[44px] rounded-full bg-surface border border-line px-4 text-sm font-semibold text-txt hover:border-gold/40 transition-colors whitespace-nowrap"
            >
              🖥️ צפה בכל הטאבים
            </button>
          )}
          {/* Edit — only when the client granted write access */}
          {snap && canEdit && onEditFull && (
            <button
              onClick={onEditFull}
              className="min-h-[44px] rounded-full bg-gold text-surface px-4 text-sm font-bold hover:bg-gold-light transition-colors whitespace-nowrap"
            >
              ✏️ ערוך את החשבון
            </button>
          )}
          {/* Request edit — active client, still read, no pending request */}
          {snap && isActive && !canEdit && !editPending && onRequestEdit && (
            <button
              onClick={onRequestEdit}
              className="min-h-[44px] rounded-full bg-surface border border-gold/40 px-4 text-sm font-semibold text-gold hover:bg-gold/10 transition-colors whitespace-nowrap"
            >
              בקש הרשאת עריכה
            </button>
          )}
          <button
            onClick={onExit}
            className="min-h-[44px] rounded-full bg-surface border border-line px-4 text-sm text-txt hover:border-gold/40 transition-colors whitespace-nowrap"
          >
            ⟵ חזרה לרשימת הלקוחות
          </button>
        </div>
      </div>

      {/* Engagement-stage control — advisor updates it after each meeting */}
      {snap && isActive && onSetStage && (
        <div className="rounded-2xl border border-line bg-surface2 p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wider text-gold">שלב הליווי</div>
            <p className="text-xs text-muted-txt mt-0.5">עדכן אחרי כל פגישה. סימון &quot;סוף תהליך&quot; סוגר אוטומטית את הרשאת העריכה.</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-txt">שלב:</span>
            <select
              value={currentStage}
              onChange={e => onStageChange(e.target.value)}
              className="min-h-[44px] rounded-full bg-surface border border-line px-4 text-sm font-semibold text-txt focus:border-gold/50 focus:outline-none"
            >
              {STAGE_LABELS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
      )}

      {/* Client meta strip */}
      <div className="rounded-2xl border border-line bg-surface2 p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <LifecycleBadge lifecycle={client.lifecycle} />
          {client.flags.map(fl => <FlagPill key={fl} flag={fl} />)}
          {neg.map(n => <NeglectPill key={n} flag={n} />)}
          {client.phone && <span className="text-xs text-muted-txt" dir="ltr">{client.phone}</span>}
        </div>
        <div className="text-xs text-muted-txt">פעילות אחרונה: {new Date(client.lastActivity).toLocaleDateString('he-IL')}</div>
      </div>

      {/* Concurrency warning — static demo */}
      {client.beingEdited && (
        <div className="rounded-2xl border border-line bg-surface2 border-s-[3px] border-s-gold px-4 py-3 text-sm text-txt">
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
          <div className="rounded-2xl border border-line bg-surface2 p-4 sm:p-5 space-y-3">
            <h2 className="text-xs uppercase tracking-wider text-gold flex items-center gap-2">🎯 יעדים</h2>
            {goals.length === 0 && <p className="text-xs text-muted-txt">אין יעדים מוגדרים.</p>}
            <div className="space-y-3">
              {goals.map(g => {
                const pct = g.required > 0 ? Math.min(100, Math.round((g.current / g.required) * 100)) : 0
                return (
                  <div key={g.id} className="rounded-xl bg-surface/40 border border-line/60 p-3 space-y-2">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2">
                      <span className="font-medium text-txt">{g.name || 'מטרה'}</span>
                      <span className="text-xs text-muted-txt tabular-nums" dir="ltr">
                        {fmt(g.current)} / {fmt(g.required)} · {fmt(g.monthly)}/חודש · יעד {dateFmt(g.targetDate)}
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

          <p className="text-[11px] text-muted-txt text-center">
            {canEdit
              ? 'לעריכת המיפוי, התקציב והיעדים ישירות, היכנס עם "ערוך את החשבון".'
              : 'סקירה מהירה. לצפייה מלאה בכל הטאבים השתמש ב"צפה בכל הטאבים".'}
          </p>
        </>
      ) : (
        <div className="rounded-2xl border border-line bg-surface2 p-8 text-center space-y-2">
          <div className="text-3xl">📭</div>
          <div className="font-semibold text-txt">הלקוח עדיין לא נרשם</div>
          <p className="text-sm text-muted-txt">ברגע שהלקוח ישלים הרשמה עם המייל שהוזמן, החשבון שלו יופיע כאן.</p>
        </div>
      )}

    </div>
  )
}
