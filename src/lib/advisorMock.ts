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

export type Lifecycle  = 'pending' | 'active' | 'graduated' | 'read-only'
export type ClientFlag = 'over-budget' | 'negative-cashflow' | 'overdraft'

export interface MockClientFinancials {
  income:       MappingRow[]
  fixed:        MappingRow[]
  sub:          MappingRow[]
  ins:          MappingRow[]
  variable:     MappingRow[]
  annual:       AnnualRow[]
  debts:        DebtRow[]
  installments: InstallmentRow[]
  savings:      SavingRow[]
  creditCards:  CreditCardRow[]
  bankAccounts: BankAccountRow[]
  varMonths:    number
  goals:        GoalRow[]
}

export interface MockClient {
  id:           string
  name:         string
  email:        string
  phone?:       string
  lifecycle:    Lifecycle
  stage:        0 | 1 | 2 | 3 | 4 | 5
  lastActivity: string        // ISO date
  flags:        ClientFlag[]
  beingEdited?: boolean        // powers the static "someone else editing" demo
  fin:          MockClientFinancials
}

export const fmt = (n: number) => '₪' + Math.round(n).toLocaleString('he-IL')

export const STAGE_LABELS = ['טרם התחיל', 'מיפוי', 'תקציב', 'יעדים', 'מעקב', 'עצמאות'] as const

export const FLAG_LABELS: Record<ClientFlag, string> = {
  'over-budget':      'חריגה מהתקציב',
  'negative-cashflow':'תזרים שלילי',
  'overdraft':        'מינוס בעו״ש',
}

const emptyFin = (): MockClientFinancials => ({
  income: [], fixed: [], sub: [], ins: [], variable: [], annual: [],
  debts: [], installments: [], savings: [], creditCards: [], bankAccounts: [],
  varMonths: 1, goals: [],
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
    lifecycle: 'active', stage: 4, lastActivity: '2026-07-17', flags: [],
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
      goals: [
        goal('קרן חירום', 60000, 42000, 1200, '2027-06', 'קרן כספית'),
        goal('רכב חדש', 90000, 20000, 1500, '2028-01'),
        goal('פנסיה משופרת', 500000, 210000, 1500, '2045-01'),
      ],
    },
  },
  {
    id: 'yossi', name: 'יוסי כהן', email: 'yossi.cohen@gmail.com', phone: '052-7654321',
    lifecycle: 'active', stage: 3, lastActivity: '2026-07-11', flags: ['over-budget', 'negative-cashflow'],
    beingEdited: true,
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
      goals: [
        goal('לצאת מהמינוס', 3200, 0, 800, '2026-12', 'פיקדון נזיל'),
        goal('חתונה', 80000, 5000, 2000, '2027-09'),
      ],
    },
  },
  {
    id: 'michal', name: 'מיכל ברק', email: 'michal.barak@gmail.com', phone: '054-3216549',
    lifecycle: 'active', stage: 2, lastActivity: '2026-07-05', flags: ['overdraft'],
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
      goals: [
        goal('קרן חירום', 40000, 9000, 700, '2028-03', 'קרן כספית'),
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
    lifecycle: 'graduated', stage: 5, lastActivity: '2026-06-28', flags: [],
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
      goals: [
        goal('עצמאות כלכלית', 1500000, 465000, 3200, '2040-01', 'תיק מנייתי מפוזר'),
      ],
    },
  },
  {
    id: 'tal', name: 'טל אזולאי', email: 'tal.azoulay@gmail.com', phone: '053-1112223',
    lifecycle: 'read-only', stage: 4, lastActivity: '2026-04-02', flags: [],
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

export const hasFlags     = (c: MockClient) => c.flags.length > 0
export const isSnapshotable = (c: MockClient) => c.lifecycle !== 'pending'

export function needsAttention(clients: MockClient[]): MockClient[] {
  return clients.filter(c => c.lifecycle !== 'pending' && hasFlags(c))
}

export interface Kpis { active: number; pending: number; attention: number; graduated: number }
export function kpis(clients: MockClient[]): Kpis {
  return {
    active:    clients.filter(c => c.lifecycle === 'active').length,
    pending:   clients.filter(c => c.lifecycle === 'pending').length,
    attention: needsAttention(clients).length,
    graduated: clients.filter(c => c.lifecycle === 'graduated').length,
  }
}

/** Sort for the list: attention first, then active, pending, graduated, read-only. */
export function sortForList(clients: MockClient[]): MockClient[] {
  const rank = (c: MockClient) =>
    hasFlags(c) && c.lifecycle !== 'pending' ? 0
    : c.lifecycle === 'active'    ? 1
    : c.lifecycle === 'pending'   ? 2
    : c.lifecycle === 'graduated' ? 3
    : 4
  return [...clients].sort((a, b) => rank(a) - rank(b))
}

export interface DigestGroups {
  attention:   MockClient[]
  progressing: MockClient[]
  pending:     MockClient[]
}
export function weeklyDigestGroups(clients: MockClient[]): DigestGroups {
  return {
    attention:   clients.filter(c => c.lifecycle !== 'pending' && hasFlags(c)),
    progressing: clients.filter(c => (c.lifecycle === 'active' || c.lifecycle === 'graduated') && !hasFlags(c)),
    pending:     clients.filter(c => c.lifecycle === 'pending'),
  }
}

/** Derive a display name from an email (for a freshly-added pending client). */
export function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email
  return local.replace(/[._]/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase())
}
