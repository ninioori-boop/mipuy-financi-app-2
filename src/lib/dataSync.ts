'use client'

/**
 * Snapshot serialization layer.
 *
 * Handles collecting persistable state from all stores into a single
 * snapshot and hydrating stores back from that snapshot.
 *
 * Only data fields are persisted — never actions/methods.
 * Ephemeral stores (bankStore raw rows, sync UI state) are intentionally
 * excluded. creditStore.transactions WAS ephemeral but is now persisted —
 * the mapping tab's per-row breakdown reads from creditStore, so without
 * persistence the breakdown vanished on every refresh.
 */

import { useMonthlyStore } from '@/stores/monthlyStore'
import { useAnnualStore }  from '@/stores/annualStore'
import { useMappingStore } from '@/stores/mappingStore'
import { useGoalsStore }   from '@/stores/goalsStore'
import { useCreditStore }  from '@/stores/creditStore'
import { useMeetingsStore } from '@/stores/meetingsStore'
import { useBusinessStore, DEFAULT_BUSINESS } from '@/stores/businessStore'
import { useBusinessAnnualStore, DEFAULT_BUSINESS_ANNUAL } from '@/stores/businessAnnualStore'
import type { Transaction } from '@/types/transaction'

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
    creditScore:   number
  }
  goals: {
    short:  ReturnType<typeof useGoalsStore.getState>['short']
    medium: ReturnType<typeof useGoalsStore.getState>['medium']
    long:   ReturnType<typeof useGoalsStore.getState>['long']
  }
  credit: {
    learnedDB:         Record<string, string>
    reportMonths:      number
    transactions:      Transaction[]    // persisted so the mapping breakdown survives refresh
    uploadedFileNames: string[]         // file chips shown above the credit table — kept in sync with `transactions`
  }
  meetings: {
    meetings: ReturnType<typeof useMeetingsStore.getState>['meetings']
  }
  business: {
    businessType:         ReturnType<typeof useBusinessStore.getState>['businessType']
    revenue:              ReturnType<typeof useBusinessStore.getState>['revenue']
    cogs:                 ReturnType<typeof useBusinessStore.getState>['cogs']
    opex:                 ReturnType<typeof useBusinessStore.getState>['opex']
    ownerSalary:          number
    taxPoints:            number
    vatRate:              number
    incomeTaxOverride:    number | null
    bituachLeumiOverride: number | null
    companyTaxOverride:   number | null
    vatOverride:          number | null
  }
  businessAnnual: {
    businessType:         ReturnType<typeof useBusinessAnnualStore.getState>['businessType']
    year:                 number
    revenue:              ReturnType<typeof useBusinessAnnualStore.getState>['revenue']
    cogs:                 ReturnType<typeof useBusinessAnnualStore.getState>['cogs']
    opex:                 ReturnType<typeof useBusinessAnnualStore.getState>['opex']
    ownerSalary:          number
    taxPoints:            number
    vatRate:              number
    incomeTaxOverride:    number | null
    bituachLeumiOverride: number | null
    companyTaxOverride:   number | null
    vatOverride:          number | null
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
  const b = useBusinessStore.getState()
  const ba = useBusinessAnnualStore.getState()

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
      creditScore:      p.creditScore,
    },
    goals: { short: g.short, medium: g.medium, long: g.long },
    credit: {
      learnedDB:         c.learnedDB,
      reportMonths:      c.reportMonths,
      transactions:      c.transactions,
      uploadedFileNames: c.uploadedFileNames,
    },
    meetings: { meetings: mt.meetings },
    business: {
      businessType: b.businessType,
      revenue: b.revenue, cogs: b.cogs, opex: b.opex,
      ownerSalary: b.ownerSalary,
      taxPoints: b.taxPoints, vatRate: b.vatRate,
      incomeTaxOverride: b.incomeTaxOverride,
      bituachLeumiOverride: b.bituachLeumiOverride,
      companyTaxOverride: b.companyTaxOverride,
      vatOverride: b.vatOverride,
    },
    businessAnnual: {
      businessType: ba.businessType,
      year: ba.year,
      revenue: ba.revenue, cogs: ba.cogs, opex: ba.opex,
      ownerSalary: ba.ownerSalary,
      taxPoints: ba.taxPoints, vatRate: ba.vatRate,
      incomeTaxOverride: ba.incomeTaxOverride,
      bituachLeumiOverride: ba.bituachLeumiOverride,
      companyTaxOverride: ba.companyTaxOverride,
      vatOverride: ba.vatOverride,
    },
  }
}

/** Apply a snapshot to all stores. Missing/invalid keys are skipped. */
export function applySnapshot(raw: unknown): void {
  if (!isObject(raw)) return

  // monthly — back-compat: months saved before the deletion-tracker existed
  // don't have `deletedFromMapping`. Inject it as empty arrays so the rest of
  // the app can rely on the field being present.
  if (isObject(raw.monthly) && isObject(raw.monthly.months)) {
    const migrated: Record<string, unknown> = {}
    for (const [id, m] of Object.entries(raw.monthly.months as Record<string, unknown>)) {
      if (!isObject(m)) continue
      const dm = (m.deletedFromMapping ?? {}) as Record<string, unknown>
      migrated[id] = {
        ...m,
        deletedFromMapping: {
          fixed:        Array.isArray(dm.fixed)        ? dm.fixed        : [],
          variable:     Array.isArray(dm.variable)     ? dm.variable     : [],
          sub:          Array.isArray(dm.sub)          ? dm.sub          : [],
          ins:          Array.isArray(dm.ins)          ? dm.ins          : [],
          installments: Array.isArray(dm.installments) ? dm.installments : [],
          debts:        Array.isArray(dm.debts)        ? dm.debts        : [],
          savings:      Array.isArray(dm.savings)      ? dm.savings      : [],
        },
      }
    }
    useMonthlyStore.setState({ months: migrated as ReturnType<typeof useMonthlyStore.getState>['months'] })
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

  // mapping — load + dedup IDs.
  // Older snapshots may contain rows with duplicate ids (the previous uid
  // implementation was a counter that reset to 0 on each page load and could
  // collide with snapshot ids). Duplicate React keys cause the row-delete
  // bug where clicking ✕ removes the wrong row and the panel "gets stuck".
  // Re-issue a fresh id whenever we encounter a duplicate during load.
  if (isObject(raw.mapping)) {
    const m = raw.mapping as Partial<Snapshot['mapping']>

    function freshId(): string { return 'r' + Math.random().toString(36).slice(2, 11) }
    function dedupRows<T extends { id: string }>(rows: T[] | undefined): T[] | undefined {
      if (!Array.isArray(rows)) return undefined
      const seen = new Set<string>()
      return rows.map(r => {
        if (!r.id || seen.has(r.id)) {
          const newId = freshId()
          seen.add(newId)
          return { ...r, id: newId }
        }
        seen.add(r.id)
        return r
      })
    }

    const income       = dedupRows(m.income as Snapshot['mapping']['income']        | undefined)
    const fixed        = dedupRows(m.fixed as Snapshot['mapping']['fixed']          | undefined)
    const sub          = dedupRows(m.sub as Snapshot['mapping']['sub']              | undefined)
    const ins          = dedupRows(m.ins as Snapshot['mapping']['ins']              | undefined)
    const variable     = dedupRows(m.variable as Snapshot['mapping']['variable']    | undefined)
    const annual       = dedupRows(m.annual as Snapshot['mapping']['annual']        | undefined)
    const debts        = dedupRows(m.debts as Snapshot['mapping']['debts']          | undefined)
    const installments = dedupRows(m.installments as Snapshot['mapping']['installments'] | undefined)
    const savings      = dedupRows(m.savings as Snapshot['mapping']['savings']      | undefined)

    useMappingStore.setState({
      ...(income       ? { income }       : {}),
      ...(fixed        ? { fixed }        : {}),
      ...(sub          ? { sub }          : {}),
      ...(ins          ? { ins }          : {}),
      ...(variable     ? { variable }     : {}),
      ...(annual       ? { annual }       : {}),
      ...(debts        ? { debts }        : {}),
      ...(installments ? { installments } : {}),
      ...(savings      ? { savings }      : {}),
      ...(typeof m.varMonths === 'number'  ? { varMonths: m.varMonths }       : {}),
      ...(typeof m.creditImported === 'boolean' ? { creditImported: m.creditImported } : {}),
      ...(typeof m.bufferPct === 'number' ? { bufferPct: m.bufferPct }         : {}),
      ...(typeof m.incomeOverride   === 'number' || m.incomeOverride   === null ? { incomeOverride:   m.incomeOverride   } : {}),
      ...(typeof m.expensesOverride === 'number' || m.expensesOverride === null ? { expensesOverride: m.expensesOverride } : {}),
      ...(typeof m.creditScore === 'number' ? { creditScore: m.creditScore } : {}),
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

  // credit — learnedDB, reportMonths, plus the credit transactions and the
  // uploaded-file-name chips. Snapshots saved before transactions were
  // persisted simply lack the field; the Array.isArray guard skips them and
  // creditStore keeps its default (empty array).
  if (isObject(raw.credit)) {
    const c = raw.credit as Partial<Snapshot['credit']>
    useCreditStore.setState({
      ...(isObject(c.learnedDB)              ? { learnedDB: c.learnedDB as Record<string, string> } : {}),
      ...(typeof c.reportMonths === 'number' ? { reportMonths: c.reportMonths }                     : {}),
      ...(Array.isArray(c.transactions)      ? { transactions: c.transactions }                     : {}),
      ...(Array.isArray(c.uploadedFileNames) ? { uploadedFileNames: c.uploadedFileNames }           : {}),
    })
  }

  // meetings
  if (isObject(raw.meetings) && Array.isArray(raw.meetings.meetings)) {
    useMeetingsStore.setState({
      meetings: raw.meetings.meetings as ReturnType<typeof useMeetingsStore.getState>['meetings'],
    })
  }

  // business
  if (isObject(raw.business)) {
    const b = raw.business as Partial<Snapshot['business']>
    const validType = b.businessType === 'osek_murshe' || b.businessType === 'osek_patur' || b.businessType === 'company'
    useBusinessStore.setState({
      ...(validType ? { businessType: b.businessType } : {}),
      ...(Array.isArray(b.revenue) ? { revenue: b.revenue } : {}),
      ...(Array.isArray(b.cogs)    ? { cogs: b.cogs }       : {}),
      ...(Array.isArray(b.opex)    ? { opex: b.opex }       : {}),
      ...(typeof b.ownerSalary === 'number' ? { ownerSalary: b.ownerSalary } : {}),
      ...(typeof b.taxPoints   === 'number' ? { taxPoints: b.taxPoints }     : {}),
      ...(typeof b.vatRate     === 'number' ? { vatRate: b.vatRate }         : {}),
      ...(typeof b.incomeTaxOverride    === 'number' || b.incomeTaxOverride    === null ? { incomeTaxOverride: b.incomeTaxOverride }       : {}),
      ...(typeof b.bituachLeumiOverride === 'number' || b.bituachLeumiOverride === null ? { bituachLeumiOverride: b.bituachLeumiOverride } : {}),
      ...(typeof b.companyTaxOverride   === 'number' || b.companyTaxOverride   === null ? { companyTaxOverride: b.companyTaxOverride }     : {}),
      ...(typeof b.vatOverride          === 'number' || b.vatOverride          === null ? { vatOverride: b.vatOverride }                   : {}),
    })
  }

  // businessAnnual
  if (isObject(raw.businessAnnual)) {
    const ba = raw.businessAnnual as Partial<Snapshot['businessAnnual']>
    const validType = ba.businessType === 'osek_murshe' || ba.businessType === 'osek_patur' || ba.businessType === 'company'
    useBusinessAnnualStore.setState({
      ...(validType ? { businessType: ba.businessType } : {}),
      ...(typeof ba.year === 'number' ? { year: ba.year } : {}),
      ...(Array.isArray(ba.revenue) ? { revenue: ba.revenue } : {}),
      ...(Array.isArray(ba.cogs)    ? { cogs: ba.cogs }       : {}),
      ...(Array.isArray(ba.opex)    ? { opex: ba.opex }       : {}),
      ...(typeof ba.ownerSalary === 'number' ? { ownerSalary: ba.ownerSalary } : {}),
      ...(typeof ba.taxPoints   === 'number' ? { taxPoints: ba.taxPoints }     : {}),
      ...(typeof ba.vatRate     === 'number' ? { vatRate: ba.vatRate }         : {}),
      ...(typeof ba.incomeTaxOverride    === 'number' || ba.incomeTaxOverride    === null ? { incomeTaxOverride: ba.incomeTaxOverride }       : {}),
      ...(typeof ba.bituachLeumiOverride === 'number' || ba.bituachLeumiOverride === null ? { bituachLeumiOverride: ba.bituachLeumiOverride } : {}),
      ...(typeof ba.companyTaxOverride   === 'number' || ba.companyTaxOverride   === null ? { companyTaxOverride: ba.companyTaxOverride }     : {}),
      ...(typeof ba.vatOverride          === 'number' || ba.vatOverride          === null ? { vatOverride: ba.vatOverride }                   : {}),
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
    creditScore: 0,
  })
  useGoalsStore.setState({ short: [], medium: [], long: [] })
  useCreditStore.setState({
    transactions: [], uploadedFileNames: [],
    learnedDB: {}, sharedLearnedDB: {}, reportMonths: 3,
    isLoading: false, loadingMessage: '',
  })
  useMeetingsStore.setState({ meetings: [] })
  useBusinessStore.setState({
    businessType: DEFAULT_BUSINESS.businessType,
    revenue: [], cogs: [], opex: [],
    ownerSalary: 0,
    taxPoints: DEFAULT_BUSINESS.taxPoints,
    vatRate: DEFAULT_BUSINESS.vatRate,
    incomeTaxOverride: null,
    bituachLeumiOverride: null,
    companyTaxOverride: null,
    vatOverride: null,
  })
  useBusinessAnnualStore.setState({
    businessType: DEFAULT_BUSINESS_ANNUAL.businessType,
    year: new Date().getFullYear(),
    revenue: [], cogs: [], opex: [],
    ownerSalary: 0,
    taxPoints: DEFAULT_BUSINESS_ANNUAL.taxPoints,
    vatRate: DEFAULT_BUSINESS_ANNUAL.vatRate,
    incomeTaxOverride: null,
    bituachLeumiOverride: null,
    companyTaxOverride: null,
    vatOverride: null,
  })
}

/** Quick byte-size estimate to enforce a sanity cap before saving. */
export function snapshotSize(snap: Snapshot): number {
  try {
    return new TextEncoder().encode(JSON.stringify(snap)).length
  } catch {
    return 0
  }
}
