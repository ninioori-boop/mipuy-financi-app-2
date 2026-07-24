// Advisor prototype — MOCK data only. No Firebase, no persistence, no writes.
// This module is deliberately a plain set of consts + pure selectors (not a
// Zustand store) so it reads as obviously throwaway and never couples to real
// client data. Stage 2 swaps this for the real backend; nothing here ships.
//
// Financial rows reuse the REAL row types from the stores, so the actual
// mapping / cashflow / goals components render mock clients with zero adaptation.

import type {
  MappingRow, AnnualRow, DebtRow, InstallmentRow, SavingRow,
  CreditCardRow, BankAccountRow,
} from '@/stores/mappingStore'
import type { GoalRow } from '@/stores/goalsStore'

// 'declined' / 'revoked' come from the real advisor↔client link (client is not
// sharing): the advisor sees the status but no financial data. The others power
// the mock prototype (and 'active' maps a live consented client).
export type Lifecycle   = 'pending' | 'active' | 'graduated' | 'read-only' | 'declined' | 'revoked'
export type ClientFlag  = 'over-budget' | 'negative-cashflow' | 'overdraft'
export type NeglectFlag = 'client-inactive' | 'advisor-neglect'

export interface MockClientFinancials {
  income:          MappingRow[]
  fixed:           MappingRow[]
  sub:             MappingRow[]
  ins:             MappingRow[]
  variable:        MappingRow[]
  annual:          AnnualRow[]
  debts:           DebtRow[]
  installments:    InstallmentRow[]
  savings:         SavingRow[]
  creditCards:     CreditCardRow[]
  bankAccounts:    BankAccountRow[]
  varMonths:       number
  cashflowHistory: number[]   // last ~6 months of monthly cashflow, for the sparkline
  goals:           GoalRow[]
}

export interface MockClient {
  id:             string
  name:           string
  email:          string
  phone?:         string
  lifecycle:      Lifecycle
  stage:          0 | 1 | 2 | 3 | 4 | 5
  lastActivity:   string        // ISO date — most recent touch of any kind
  clientLastSeen?: string       // ISO date — client last logged in / logged an expense
  advisorLastSeen?: string      // ISO date — advisor last opened this account
  // Expense-log engagement (real clients only — advisorClients fills these from
  // the snapshot; mock clients leave them undefined so no tracking pill shows).
  lastExpenseAt?:  string       // ISO date the client last LOGGED an expense (createdAt)
  expensesLast7?:  number       // entries logged in the past 7 days
  flags:          ClientFlag[]
  beingEdited?:   boolean        // powers the static "someone else editing" demo
  fin:            MockClientFinancials
  // Edit-access seam (Stage 3). Only set for real links; mock clients omit them.
  //  access          — the granted tier: 'read' (view only) or 'write' (advisor may edit)
  //  requestedAccess — 'write' while the advisor's edit request awaits client consent
  access?:          'read' | 'write'
  requestedAccess?: 'write'
}

export const fmt = (n: number) => '₪' + Math.round(n).toLocaleString('he-IL')

// Engagement stages the advisor sets after each meeting (Stage 3). Index order
// MUST match ENGAGEMENT_STAGES in functions/index.js — advisorClients maps the
// stored stage STRING to this array's index (MockClient.stage: 0..5). The last
// stage ('סוף תהליך') auto-expires the advisor's edit access server-side.
export const STAGE_LABELS = ['היכרות', 'מיפוי', 'תקציב', 'בקרה', 'תוכנית כלכלית', 'סוף תהליך'] as const

export const FLAG_LABELS: Record<ClientFlag, string> = {
  'over-budget':      'חריגה מהתקציב',
  'negative-cashflow':'תזרים שלילי',
  'overdraft':        'מינוס בעו״ש',
}

export const NEGLECT_LABELS: Record<NeglectFlag, string> = {
  'client-inactive': '😴 הלקוח נעלם',
  'advisor-neglect': '👋 לא נגעת בו',
}

export const emptyFin = (): MockClientFinancials => ({
  income: [], fixed: [], sub: [], ins: [], variable: [], annual: [],
  debts: [], installments: [], savings: [], creditCards: [], bankAccounts: [],
  varMonths: 1, cashflowHistory: [], goals: [],
})

// ── row builders (terse, ids are stable strings) ──
let _n = 0
const uid = (p: string) => `${p}-${++_n}`
const m  = (name: string, amount: number): MappingRow      => ({ id: uid('m'), name, amount })
const an = (name: string, annualAmount: number): AnnualRow  => ({ id: uid('a'), name, annualAmount })
const dbt = (name: string, remainingBalance: number, monthlyPayment: number, interestRate = 0, remainingMonths = 0): DebtRow =>
  ({ id: uid('d'), name, originalBalance: remainingBalance, remainingBalance, interestRate, remainingMonths, monthlyPayment })
const inst = (name: string, totalAmount: number, monthlyPayment: number, paidCount: number, totalCount: number): InstallmentRow =>
  ({ id: uid('i'), name, totalAmount, monthlyPayment, paidCount, totalCount })
const sav = (name: string, monthlyContribution: number, accumulated: number): SavingRow =>
  ({ id: uid('s'), name, monthlyContribution, accumulated, feeBalance: 0, feeDeposit: 0 })
const card = (name: string, limit: number): CreditCardRow => ({ id: uid('c'), name, limit, chargeDay: 10 })
const bank = (name: string, balance: number, overdraftLimit = 10000): BankAccountRow => ({ id: uid('b'), name, balance, overdraftLimit })
const goal = (name: string, required: number, current: number, monthly: number, targetDate: string, product = ''): GoalRow =>
  ({ id: uid('g'), name, required, current, monthly, targetDate, product })

// ── the mock roster ──
export const MOCK_CLIENTS: MockClient[] = [
  {
    id: 'dana', name: 'דנה לוי', email: 'dana.levi@gmail.com', phone: '050-1234567',
    lifecycle: 'active', stage: 4, lastActivity: '2026-07-17',
    clientLastSeen: '2026-07-17', advisorLastSeen: '2026-07-14', flags: [],
    fin: {
      ...emptyFin(),
      income:   [m('משכורת נטו', 15200), m('הכנסה נוספת', 1800)],
      fixed:    [m('משכנתא', 4200), m('ארנונה', 620), m('חשמל ומים', 480), m('גן ילדים', 1600)],
      sub:      [m('נטפליקס', 55), m('ספוטיפיי', 20), m('חדר כושר', 180)],
      ins:      [m('ביטוח רכב', 340), m('ביטוח בריאות', 290)],
      variable: [m('סופרמרקטים', 2600), m('דלק', 700), m('מסעדות ובילויים', 900)],
      annual:   [an('חופשה שנתית', 9000), an('ביטוח מבנה', 1800)],
      debts:    [],
      savings:  [sav('קרן השתלמות', 900, 62000), sav('פנסיה', 1500, 210000)],
      creditCards:  [card('ויזה לאומי', 25000)],
      bankAccounts: [bank('עו״ש לאומי', 8400)],
      varMonths: 1,
      cashflowHistory: [3400, 3700, 3300, 3900, 4000, 4115],
      goals: [
        goal('קרן חירום', 60000, 42000, 1200, '2027-06', 'קרן כספית'),
        goal('רכב חדש', 90000, 20000, 1500, '2028-01'),
        goal('פנסיה משופרת', 500000, 210000, 1500, '2045-01'),
      ],
    },
  },
  {
    id: 'yossi', name: 'יוסי כהן', email: 'yossi.cohen@gmail.com', phone: '052-7654321',
    lifecycle: 'active', stage: 3, lastActivity: '2026-07-11',
    clientLastSeen: '2026-07-11', advisorLastSeen: '2026-07-10',
    flags: ['over-budget', 'negative-cashflow'], beingEdited: true,
    fin: {
      ...emptyFin(),
      income:   [m('משכורת נטו', 11500)],
      fixed:    [m('שכר דירה', 5200), m('ארנונה', 540), m('חשמל ומים', 520), m('אינטרנט וסלולר', 260)],
      sub:      [m('נטפליקס', 55), m('דיסני+', 30), m('יוטיוב פרימיום', 25)],
      ins:      [m('ביטוח רכב', 380)],
      variable: [m('סופרמרקטים', 3100), m('דלק', 850), m('מסעדות ומשלוחים', 1400), m('קניות', 1200)],
      annual:   [an('חופשה', 8000)],
      debts:    [dbt('הלוואת רכב', 48000, 1650, 7.5, 30)],
      installments: [inst('ריהוט', 12000, 500, 8, 24)],
      savings:  [],
      creditCards:  [card('מקס', 18000), card('ישראכרט', 22000)],
      bankAccounts: [bank('עו״ש דיסקונט', -3200, 15000)],
      varMonths: 1,
      cashflowHistory: [-1500, -2400, -3100, -3900, -4400, -4877],
      goals: [
        goal('לצאת מהמינוס', 3200, 0, 800, '2026-12', 'פיקדון נזיל'),
        goal('חתונה', 80000, 5000, 2000, '2027-09'),
      ],
    },
  },
  {
    id: 'michal', name: 'מיכל ברק', email: 'michal.barak@gmail.com', phone: '054-3216549',
    lifecycle: 'active', stage: 2, lastActivity: '2026-07-05',
    clientLastSeen: '2026-07-05', advisorLastSeen: '2026-07-08', flags: ['overdraft'],
    fin: {
      ...emptyFin(),
      income:   [m('משכורת נטו', 9800)],
      fixed:    [m('שכר דירה', 4100), m('ארנונה', 480), m('חשמל ומים', 410)],
      sub:      [m('ספוטיפיי', 20), m('חדר כושר', 150)],
      ins:      [m('ביטוח בריאות', 220)],
      variable: [m('סופרמרקטים', 2200), m('תחבורה', 500), m('בילויים', 700)],
      annual:   [an('ביטוח נסיעות', 1200)],
      debts:    [],
      savings:  [sav('חיסכון חודשי', 400, 9000)],
      creditCards:  [card('ויזה כאל', 15000)],
      bankAccounts: [bank('עו״ש הפועלים', -6800, 10000)],
      varMonths: 1,
      cashflowHistory: [200, -100, 300, 600, 800, 920],
      goals: [
        goal('קרן חירום', 40000, 9000, 700, '2028-03', 'קרן כספית'),
      ],
    },
  },
  {
    id: 'omer', name: 'עומר פרץ', email: 'omer.peretz@gmail.com', phone: '050-5558888',
    lifecycle: 'active', stage: 3, lastActivity: '2026-06-04',
    clientLastSeen: '2026-06-04', advisorLastSeen: '2026-06-08', flags: [],
    fin: {
      ...emptyFin(),
      income:   [m('משכורת נטו', 13000)],
      fixed:    [m('משכנתא', 3900), m('ארנונה', 560), m('חשמל ומים', 450)],
      sub:      [m('נטפליקס', 55), m('ספוטיפיי', 20)],
      ins:      [m('ביטוח רכב', 330)],
      variable: [m('סופרמרקטים', 2400), m('דלק', 650), m('בילויים', 700)],
      annual:   [an('חופשה', 7000)],
      debts:    [],
      savings:  [sav('קרן השתלמות', 700, 40000)],
      creditCards:  [card('ויזה לאומי', 22000)],
      bankAccounts: [bank('עו״ש לאומי', 6200)],
      varMonths: 1,
      cashflowHistory: [3000, 3200, 2900, 3100, 3300, 3350],
      goals: [
        goal('קרן חירום', 50000, 22000, 900, '2027-10', 'קרן כספית'),
        goal('שיפוץ', 60000, 8000, 1000, '2028-06'),
      ],
    },
  },
  {
    id: 'avi', name: 'אבי שרון', email: 'avi.sharon@gmail.com',
    lifecycle: 'pending', stage: 0, lastActivity: '2026-07-18', flags: [],
    fin: emptyFin(),
  },
  {
    id: 'ronit', name: 'רונית מזרחי', email: 'ronit.m@gmail.com', phone: '050-9876543',
    lifecycle: 'graduated', stage: 5, lastActivity: '2026-06-28',
    clientLastSeen: '2026-06-28', advisorLastSeen: '2026-06-25', flags: [],
    fin: {
      ...emptyFin(),
      income:   [m('משכורת נטו', 17800)],
      fixed:    [m('משכנתא', 3800), m('ארנונה', 700), m('חשמל ומים', 500)],
      sub:      [m('נטפליקס', 55)],
      ins:      [m('ביטוח רכב', 300), m('ביטוח חיים', 180)],
      variable: [m('סופרמרקטים', 2400), m('דלק', 650), m('בילויים', 800)],
      annual:   [an('חופשה שנתית', 12000)],
      debts:    [],
      savings:  [sav('קרן השתלמות', 1200, 145000), sav('תיק השקעות', 2000, 320000)],
      creditCards:  [card('ויזה לאומי', 40000)],
      bankAccounts: [bank('עו״ש לאומי', 22000)],
      varMonths: 1,
      cashflowHistory: [6200, 6500, 6800, 7000, 7200, 7415],
      goals: [
        goal('עצמאות כלכלית', 1500000, 465000, 3200, '2040-01', 'תיק מנייתי מפוזר'),
      ],
    },
  },
  {
    id: 'tal', name: 'טל אזולאי', email: 'tal.azoulay@gmail.com', phone: '053-1112223',
    lifecycle: 'read-only', stage: 4, lastActivity: '2026-04-02',
    clientLastSeen: '2026-04-02', advisorLastSeen: '2026-04-01', flags: [],
    fin: {
      ...emptyFin(),
      income:   [m('משכורת נטו', 12400)],
      fixed:    [m('שכר דירה', 4600), m('ארנונה', 520), m('חשמל ומים', 440)],
      sub:      [m('נטפליקס', 55), m('ספוטיפיי', 20)],
      ins:      [m('ביטוח רכב', 350)],
      variable: [m('סופרמרקטים', 2500), m('דלק', 700), m('בילויים', 600)],
      annual:   [an('חופשה', 7000)],
      debts:    [],
      savings:  [sav('חיסכון', 800, 34000)],
      creditCards:  [card('מקס', 20000)],
      bankAccounts: [bank('עו״ש מזרחי', 5100)],
      varMonths: 1,
      cashflowHistory: [1600, 1750, 1700, 1900, 2000, 2032],
      goals: [
        goal('דירה', 400000, 120000, 3000, '2032-01'),
      ],
    },
  },
]

// ── pure selectors ──

/** Monthly income / expenses / cashflow for a client's snapshot. Mirrors the
 *  CashflowSummary math (variable ÷ varMonths, annual ÷ 12, debts + installments). */
export function clientTotals(f: MockClientFinancials): { income: number; expenses: number; cashflow: number } {
  const sum = (rs: { amount: number }[]) => rs.reduce((s, r) => s + r.amount, 0)
  const income   = sum(f.income)
  const varMo    = sum(f.variable) / Math.max(1, f.varMonths)
  const annMo    = f.annual.reduce((s, r) => s + r.annualAmount, 0) / 12
  const debtMo   = f.debts.reduce((s, r) => s + r.monthlyPayment, 0)
  const instMo   = f.installments.reduce((s, r) => s + r.monthlyPayment, 0)
  const expenses = sum(f.fixed) + sum(f.sub) + sum(f.ins) + varMo + annMo + debtMo + instMo
  return { income: Math.round(income), expenses: Math.round(expenses), cashflow: Math.round(income - expenses) }
}

export const hasFlags       = (c: MockClient) => c.flags.length > 0
// Has viewable financial data: everything except the no-data states (not yet
// registered, or not sharing).
export const isSnapshotable = (c: MockClient) =>
  c.lifecycle !== 'pending' && c.lifecycle !== 'declined' && c.lifecycle !== 'revoked'

const NEGLECT_DAYS = 30
const MS_DAY = 86_400_000

function daysSince(iso?: string): number {
  if (!iso) return Infinity
  const t = new Date(iso).getTime()
  if (isNaN(t)) return Infinity
  return Math.floor((Date.now() - t) / MS_DAY)
}

/** Neglect flags — only meaningful for active clients (pending haven't started,
 *  graduated / read-only are intentionally dormant). Both thresholds: 30 days. */
export function neglectFlags(c: MockClient): NeglectFlag[] {
  if (c.lifecycle !== 'active') return []
  const out: NeglectFlag[] = []
  // Only fire when the timestamp is actually tracked — a real client with no
  // recorded advisorLastSeen must not falsely read as neglected.
  if (c.clientLastSeen  && daysSince(c.clientLastSeen)  >= NEGLECT_DAYS) out.push('client-inactive')
  if (c.advisorLastSeen && daysSince(c.advisorLastSeen) >= NEGLECT_DAYS) out.push('advisor-neglect')
  return out
}

// ── Expense-tracking engagement ──────────────────────────────────────────────
// Sharper than the 30-day neglect flags: daily expense logging is the habit the
// coaching is built on, so the advisor should hear about a lapse within days,
// not weeks. Only fires for active clients whose engagement data is actually
// known (expensesLast7 set by advisorClients) — mock clients return null.

export const TRACKING_STALE_DAYS = 5

export type TrackingStatus =
  | { kind: 'stale'; days: number }   // logged before, quiet ≥ TRACKING_STALE_DAYS
  | { kind: 'never' }                 // stage תקציב+ but never logged an expense
  | { kind: 'ok'; last7: number }     // actively logging
  | null                              // not active / engagement unknown (mocks)

export function trackingStatus(c: MockClient): TrackingStatus {
  if (c.lifecycle !== 'active' || c.expensesLast7 === undefined) return null
  if (!c.lastExpenseAt) {
    // Before the תקציב stage the client isn't expected to log yet — stay quiet.
    return c.stage >= 2 ? { kind: 'never' } : null
  }
  const d = daysSince(c.lastExpenseAt)
  if (d >= TRACKING_STALE_DAYS && isFinite(d)) return { kind: 'stale', days: d }
  return { kind: 'ok', last7: c.expensesLast7 }
}

/** Is a single goal on track — will the planned monthly contribution reach the
 *  target by the target date? (5% tolerance.) */
function isGoalOnTrack(g: GoalRow): boolean {
  const remaining = g.required - g.current
  if (remaining <= 0) return true
  const target = new Date(g.targetDate).getTime()
  if (isNaN(target)) return false
  const monthsLeft = (target - Date.now()) / (30.44 * MS_DAY)
  if (monthsLeft < 1) return g.current >= g.required
  const needed = remaining / monthsLeft
  return g.monthly >= needed * 0.95
}

/** How many of a client's goals are on track, out of the total. */
export function goalsOnTrack(f: MockClientFinancials): { onTrack: number; total: number } {
  const goals = f.goals.filter(g => g.name || g.required > 0)
  const onTrack = goals.filter(isGoalOnTrack).length
  return { onTrack, total: goals.length }
}

export function needsAttention(clients: MockClient[]): MockClient[] {
  return clients.filter(c => c.lifecycle === 'active' && hasFlags(c))
}

export interface Kpis { active: number; attention: number; neglected: number; pending: number; graduated: number }
export function kpis(clients: MockClient[]): Kpis {
  const s = dashboardSections(clients)
  return {
    active:    clients.filter(c => c.lifecycle === 'active').length,
    attention: s.attention.length,
    neglected: s.neglected.length,
    pending:   s.pending.length,
    graduated: clients.filter(c => c.lifecycle === 'graduated').length,
  }
}

export interface DashboardSections {
  attention:   MockClient[]   // active + a hard budget/cashflow/overdraft flag
  neglected:   MockClient[]   // active, no hard flag, but a 30-day neglect flag
  progressing: MockClient[]   // active healthy · graduated · read-only
  pending:     MockClient[]   // invited, not yet registered
  notSharing:  MockClient[]   // registered but declined / revoked sharing (no data)
}

/** The dashboard sections, in triage order. A client lands in exactly one. */
export function dashboardSections(clients: MockClient[]): DashboardSections {
  const out: DashboardSections = { attention: [], neglected: [], progressing: [], pending: [], notSharing: [] }
  for (const c of clients) {
    if (c.lifecycle === 'pending')                              { out.pending.push(c); continue }
    if (c.lifecycle === 'declined' || c.lifecycle === 'revoked') { out.notSharing.push(c); continue }
    if (c.lifecycle === 'active' && hasFlags(c))                { out.attention.push(c); continue }
    const trk = trackingStatus(c)
    if (neglectFlags(c).length > 0 || trk?.kind === 'stale' || trk?.kind === 'never') { out.neglected.push(c); continue }
    out.progressing.push(c)
  }
  return out
}

export interface DigestGroups {
  attention:   MockClient[]
  progressing: MockClient[]
  pending:     MockClient[]
}
export function weeklyDigestGroups(clients: MockClient[]): DigestGroups {
  const s = dashboardSections(clients)
  return {
    attention:   [...s.attention, ...s.neglected],
    progressing: s.progressing,
    pending:     s.pending,
  }
}

/** Derive a display name from an email (for a freshly-added pending client). */
export function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email
  return local.replace(/[._]/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase())
}
