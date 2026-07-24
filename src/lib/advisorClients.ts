'use client'

import { collection, query, where, getDocs, getDoc, doc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Snapshot } from '@/lib/dataSync'
import {
  emptyFin, nameFromEmail, clientTotals, STAGE_LABELS,
  type MockClient, type MockClientFinancials, type Lifecycle, type ClientFlag,
} from '@/lib/advisorMock'

// Real advisor↔client data. Loads the advisor's clientLinks and, for actively
// shared clients, their financial snapshot — mapping it into the SAME shape the
// mock dashboard already renders (MockClient), so the whole advisor UI is reused
// unchanged. Read-only: never writes. Advisor read of users/{clientUid} is
// permitted by the additive Firestore rule only while the link is 'active'.

interface ClientLink {
  status: 'pending' | 'active' | 'declined' | 'revoked' | 'consumed'
  clientUid: string | null
  invitedEmail: string
  invitedByUid: string
  practiceId: string
  access?: 'read' | 'write'
  requestedAccess?: 'write'
  stage?: string          // one of STAGE_LABELS; set by setClientStage (advisor)
  updatedAt?: unknown
  statusChangedAt?: unknown
}

/** Map the stored stage STRING to the numeric MockClient.stage (index in
 *  STAGE_LABELS). Unknown/absent → 0 ('היכרות'). */
function stageIndex(stage?: string): MockClient['stage'] {
  const i = stage ? STAGE_LABELS.indexOf(stage as (typeof STAGE_LABELS)[number]) : -1
  return (i >= 0 ? i : 0) as MockClient['stage']
}

const msToIso = (ms?: number) => (ms ? new Date(ms).toISOString().slice(0, 10) : '')

/** Firestore Timestamp | epoch-ms → epoch-ms. */
function tsToMs(v: unknown): number | undefined {
  if (typeof v === 'number') return v
  if (v && typeof (v as { toMillis?: () => number }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis()
  }
  return undefined
}

/** Map a stored user Snapshot blob into the dashboard's financials shape. */
export function snapshotToClientFinancials(data: Partial<Snapshot> | null | undefined): MockClientFinancials {
  const m = data?.mapping
  const g = data?.goals
  if (!m) return emptyFin()
  return {
    income:       m.income ?? [],
    fixed:        m.fixed ?? [],
    sub:          m.sub ?? [],
    ins:          m.ins ?? [],
    variable:     m.variable ?? [],
    annual:       m.annual ?? [],
    debts:        m.debts ?? [],
    installments: m.installments ?? [],
    savings:      m.savings ?? [],
    creditCards:  m.creditCards ?? [],
    bankAccounts: m.bankAccounts ?? [],
    varMonths:    m.varMonths ?? 1,
    cashflowHistory: [],
    goals: [...(g?.short ?? []), ...(g?.medium ?? []), ...(g?.long ?? [])],
  }
}

/** Hard flags derivable cheaply from the snapshot (over-budget needs budgets, deferred). */
function deriveFlags(fin: MockClientFinancials): ClientFlag[] {
  const out: ClientFlag[] = []
  if (clientTotals(fin).cashflow < 0) out.push('negative-cashflow')
  if (fin.bankAccounts.some(b => b.balance < 0)) out.push('overdraft')
  return out
}

const LIFECYCLE_FROM_STATUS: Record<string, Lifecycle> = {
  pending: 'pending', active: 'active', declined: 'declined', revoked: 'revoked',
}

/** All of an advisor's clients (real links), shaped for the dashboard UI. */
export async function listAdvisorClients(advisorUid: string): Promise<MockClient[]> {
  const snap = await getDocs(
    query(collection(db, 'clientLinks'), where('invitedByUid', '==', advisorUid)),
  )
  const links = snap.docs
    .map(d => ({ id: d.id, ...(d.data() as ClientLink) }))
    .filter(l => l.status !== 'consumed') // hide consumed pending_ twins

  const out: MockClient[] = []
  for (const l of links) {
    const lifecycle = LIFECYCLE_FROM_STATUS[l.status] ?? 'pending'
    const client: MockClient = {
      id: l.clientUid || l.id,
      name: nameFromEmail(l.invitedEmail),
      email: l.invitedEmail,
      lifecycle,
      stage: stageIndex(l.stage),
      lastActivity: msToIso(tsToMs(l.statusChangedAt) ?? tsToMs(l.updatedAt)),
      flags: [],
      fin: emptyFin(),
      access: l.access ?? 'read',
      requestedAccess: l.requestedAccess,
    }

    if (lifecycle === 'active' && l.clientUid) {
      try {
        const uDoc = await getDoc(doc(db, 'users', l.clientUid))
        const data = uDoc.exists() ? (uDoc.data().data as Partial<Snapshot>) : null
        const fin = snapshotToClientFinancials(data)
        client.fin = fin
        client.flags = deriveFlags(fin)
        const upd = msToIso(tsToMs(uDoc.data()?.updatedAt))
        if (upd) { client.clientLastSeen = upd; client.lastActivity = upd }

        // Expense-log engagement: when the client last LOGGED an entry
        // (createdAt = the moment of logging; the entry's `date` is only a
        // fallback for pre-createdAt rows) + how many they logged this week.
        // Feeds trackingStatus() → the "לא תיעד X ימים" pill.
        const entries = data?.expenseLog?.entries ?? []
        const weekAgo = Date.now() - 7 * 86_400_000
        let lastMs = 0, last7 = 0
        for (const e of entries) {
          const t = e.createdAt || new Date(e.date).getTime() || 0
          if (t > lastMs) lastMs = t
          if (t >= weekAgo) last7++
        }
        client.expensesLast7 = last7
        if (lastMs) client.lastExpenseAt = msToIso(lastMs)
      } catch {
        // read denied / missing — keep as active with empty data
      }
    }
    out.push(client)
  }
  return out
}
