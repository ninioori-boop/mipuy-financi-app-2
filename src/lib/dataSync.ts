'use client'

/**
 * Snapshot serialization layer.
 *
 * Handles collecting persistable state from all stores into a single
 * snapshot and hydrating stores back from that snapshot.
 *
 * Only data fields are persisted — never actions/methods.
 * Ephemeral stores (bankStore raw rows, creditStore.transactions, sync UI state)
 * are intentionally excluded.
 */

import { useMonthlyStore } from '@/stores/monthlyStore'
import { useAnnualStore }  from '@/stores/annualStore'
import { useMappingStore } from '@/stores/mappingStore'
import { useGoalsStore }   from '@/stores/goalsStore'
import { useCreditStore }  from '@/stores/creditStore'
import { useMeetingsStore } from '@/stores/meetingsStore'

export const SCHEMA_VERSION = 1

export interface Snapshot {
  version: number
  monthly: { months: ReturnType<typeof useMonthlyStore.getState>['months'] }
  annual: {
    year:     number
    income:   ReturnType<typeof useAnnualStore.getState>['income']
    fixed:    ReturnType<typeof useAnnualStore.getState>['fixed']
    variable: ReturnType<typeof useAnnualStore.getState>['variable']
    sub:      ReturnType<typeof useAnnualStore.getState>['sub']
    savings:  ReturnType<typeof useAnnualStore.getState>['savings']
    debt:     ReturnType<typeof useAnnualStore.getState>['debt']
  }
  mapping: {
    income:        ReturnType<typeof useMappingStore.getState>['income']
    fixed:         ReturnType<typeof useMappingStore.getState>['fixed']
    sub:           ReturnType<typeof useMappingStore.getState>['sub']
    ins:           ReturnType<typeof useMappingStore.getState>['ins']
    variable:      ReturnType<typeof useMappingStore.getState>['variable']
    annual:        ReturnType<typeof useMappingStore.getState>['annual']
    debts:         ReturnType<typeof useMappingStore.getState>['debts']
    installments:  ReturnType<typeof useMappingStore.getState>['installments']
    savings:       ReturnType<typeof useMappingStore.getState>['savings']
    varMonths:     number
    creditImported: boolean
    bufferPct:     number
    incomeOverride:   number | null
    expensesOverride: number | null
  }
  goals: {
    short:  ReturnType<typeof useGoalsStore.getState>['short']
    medium: ReturnType<typeof useGoalsStore.getState>['medium']
    long:   ReturnType<typeof useGoalsStore.getState>['long']
  }
  credit: {
    learnedDB:    Record<string, string>
    reportMonths: number
  }
  meetings: {
    meetings: ReturnType<typeof useMeetingsStore.getState>['meetings']
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Pull a serializable snapshot from all live stores. */
export function collectSnapshot(): Snapshot {
  const m = useMonthlyStore.getState()
  const a = useAnnualStore.getState()
  const p = useMappingStore.getState()
  const g = useGoalsStore.getState()
  const c = useCreditStore.getState()
  const mt = useMeetingsStore.getState()

  return {
    version: SCHEMA_VERSION,
    monthly: { months: m.months },
    annual: {
      year: a.year, income: a.income, fixed: a.fixed, variable: a.variable,
      sub: a.sub, savings: a.savings, debt: a.debt,
    },
    mapping: {
      income: p.income, fixed: p.fixed, sub: p.sub, ins: p.ins,
      variable: p.variable, annual: p.annual,
      debts: p.debts, installments: p.installments, savings: p.savings,
      varMonths: p.varMonths, creditImported: p.creditImported,
      bufferPct: p.bufferPct,
      incomeOverride:   p.incomeOverride,
      expensesOverride: p.expensesOverride,
    },
    goals: { short: g.short, medium: g.medium, long: g.long },
    credit: { learnedDB: c.learnedDB, reportMonths: c.reportMonths },
    meetings: { meetings: mt.meetings },
  }
}

/** Apply a snapshot to all stores. Missing/invalid keys are skipped. */
export function applySnapshot(raw: unknown): void {
  if (!isObject(raw)) return

  // monthly
  if (isObject(raw.monthly) && isObject(raw.monthly.months)) {
    useMonthlyStore.setState({ months: raw.monthly.months as ReturnType<typeof useMonthlyStore.getState>['months'] })
  }

  // annual
  if (isObject(raw.annual)) {
    const a = raw.annual as Partial<Snapshot['annual']>
    useAnnualStore.setState({
      ...(typeof a.year     === 'number' ? { year: a.year } : {}),
      ...(Array.isArray(a.income)   ? { income: a.income }     : {}),
      ...(Array.isArray(a.fixed)    ? { fixed: a.fixed }       : {}),
      ...(Array.isArray(a.variable) ? { variable: a.variable } : {}),
      ...(Array.isArray(a.sub)      ? { sub: a.sub }           : {}),
      ...(Array.isArray(a.savings)  ? { savings: a.savings }   : {}),
      ...(Array.isArray(a.debt)     ? { debt: a.debt }         : {}),
    })
  }

  // mapping
  if (isObject(raw.mapping)) {
    const m = raw.mapping as Partial<Snapshot['mapping']>
    useMappingStore.setState({
      ...(Array.isArray(m.income)       ? { income: m.income }             : {}),
      ...(Array.isArray(m.fixed)        ? { fixed: m.fixed }               : {}),
      ...(Array.isArray(m.sub)          ? { sub: m.sub }                   : {}),
      ...(Array.isArray(m.ins)          ? { ins: m.ins }                   : {}),
      ...(Array.isArray(m.variable)     ? { variable: m.variable }         : {}),
      ...(Array.isArray(m.annual)       ? { annual: m.annual }             : {}),
      ...(Array.isArray(m.debts)        ? { debts: m.debts }               : {}),
      ...(Array.isArray(m.installments) ? { installments: m.installments } : {}),
      ...(Array.isArray(m.savings)      ? { savings: m.savings }           : {}),
      ...(typeof m.varMonths === 'number'  ? { varMonths: m.varMonths }       : {}),
      ...(typeof m.creditImported === 'boolean' ? { creditImported: m.creditImported } : {}),
      ...(typeof m.bufferPct === 'number' ? { bufferPct: m.bufferPct }         : {}),
      ...(typeof m.incomeOverride   === 'number' || m.incomeOverride   === null ? { incomeOverride:   m.incomeOverride   } : {}),
      ...(typeof m.expensesOverride === 'number' || m.expensesOverride === null ? { expensesOverride: m.expensesOverride } : {}),
    })
  }

  // goals
  if (isObject(raw.goals)) {
    const g = raw.goals as Partial<Snapshot['goals']>
    useGoalsStore.setState({
      ...(Array.isArray(g.short)  ? { short: g.short }   : {}),
      ...(Array.isArray(g.medium) ? { medium: g.medium } : {}),
      ...(Array.isArray(g.long)   ? { long: g.long }     : {}),
    })
  }

  // credit (only learnedDB + reportMonths — transactions stay ephemeral)
  if (isObject(raw.credit)) {
    const c = raw.credit as Partial<Snapshot['credit']>
    useCreditStore.setState({
      ...(isObject(c.learnedDB)              ? { learnedDB: c.learnedDB as Record<string, string> } : {}),
      ...(typeof c.reportMonths === 'number' ? { reportMonths: c.reportMonths }                     : {}),
    })
  }

  // meetings
  if (isObject(raw.meetings) && Array.isArray(raw.meetings.meetings)) {
    useMeetingsStore.setState({
      meetings: raw.meetings.meetings as ReturnType<typeof useMeetingsStore.getState>['meetings'],
    })
  }
}

/**
 * Reset all persistent stores to their default state.
 * Used on logout to prevent data leakage between users.
 */
export function resetAllStores(): void {
  // Force a re-init by reaching into each store and replacing data fields
  // We use empty objects/arrays — store actions will re-add defaults on next interaction
  useMonthlyStore.setState({ months: {} })
  useAnnualStore.setState({
    year: new Date().getFullYear(),
    income: [], fixed: [], variable: [], sub: [], savings: [], debt: [],
  })
  useMappingStore.setState({
    income: [], fixed: [], sub: [], ins: [],
    variable: [], annual: [], debts: [], installments: [], savings: [],
    varMonths: 3, creditImported: false, bufferPct: 0.4,
    incomeOverride: null, expensesOverride: null,
  })
  useGoalsStore.setState({ short: [], medium: [], long: [] })
  useCreditStore.setState({
    transactions: [], uploadedFileNames: [],
    learnedDB: {}, reportMonths: 3,
    isLoading: false, loadingMessage: '',
  })
  useMeetingsStore.setState({ meetings: [] })
}

/** Quick byte-size estimate to enforce a sanity cap before saving. */
export function snapshotSize(snap: Snapshot): number {
  try {
    return new TextEncoder().encode(JSON.stringify(snap)).length
  } catch {
    return 0
  }
}
