'use client'

/**
 * Snapshot serialization layer.
 *
 * Handles collecting persistable state from all stores into a single
 * snapshot and hydrating stores back from that snapshot.
 *
 * Only data fields are persisted — never actions/methods. Sync UI state is
 * intentionally excluded. Two stores that WERE ephemeral are now persisted, in
 * both cases because re-running an upload and a paid AI extraction on every
 * visit was the actual complaint: creditStore.transactions (the mapping tab's
 * per-row breakdown reads from it) and bankStore's raw grid, which needs the
 * encoding described in the bank-grid block below to be a legal Firestore
 * value at all. Both still count as SESSION stores for reset purposes — they
 * belong to whoever is at the screen (see storeCoverage.test.ts).
 */

import { useMonthlyStore, applyLogRows } from '@/stores/monthlyStore'
type MonthDataShape = Parameters<typeof applyLogRows>[0]
import { useAnnualStore }  from '@/stores/annualStore'
import { useMappingStore } from '@/stores/mappingStore'
import { useGoalsStore }   from '@/stores/goalsStore'
import { useCreditStore }  from '@/stores/creditStore'
import { useMeetingsStore } from '@/stores/meetingsStore'
import {
  useBusinessStore, DEFAULT_BUSINESS, makeEmptyBizData,
  type BizData, type BizRow, type BusinessType,
} from '@/stores/businessStore'
import { useBusinessAnnualStore, DEFAULT_BUSINESS_ANNUAL, makeEmptyAnnualData } from '@/stores/businessAnnualStore'
import {
  useBusinessRosterStore, DEFAULT_ROSTER, PRIMARY_BUSINESS_ID,
  type BizProfile,
} from '@/stores/businessRosterStore'
import { reconcileBusinessProfiles } from '@/lib/businessProfiles'
import { useExpenseLogStore, type ExpenseEntry } from '@/stores/expenseLogStore'
import { useCategoryBudgetStore } from '@/stores/categoryBudgetStore'
import { useClientProfileStore } from '@/stores/clientProfileStore'
import { useRecurringStore, type RecurringRule } from '@/stores/recurringStore'
import { useSubscriptionPrefsStore, type DismissedSub } from '@/stores/subscriptionPrefsStore'
import { useBudgetReminderStore } from '@/stores/budgetReminderStore'
import { useBankStore } from '@/stores/bankStore'
import { useImportStore } from '@/stores/importStore'
import { useAutoMapStore, AUTOMAP_STORAGE_KEY } from '@/stores/autoMapStore'
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
    creditCards:   ReturnType<typeof useMappingStore.getState>['creditCards']
    bankAccounts:  ReturnType<typeof useMappingStore.getState>['bankAccounts']
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
    isUSCitizen: boolean | null
    liquidTotal: number
    liquidSources: string[]
  }
  credit: {
    learnedDB:         Record<string, string>
    reportMonths:      number
    transactions:      Transaction[]    // persisted so the mapping breakdown survives refresh
    uploadedFileNames: string[]         // file chips shown above the credit table — kept in sync with `transactions`
  }
  // The import tab's analysis (2026-08-09) — persisted for the same reason as
  // credit: re-running the upload + AI on every visit was the complaint.
  // OWN arrays only — never a reference shared with creditStore (CLAUDE.md).
  importTab: {
    transactions:      Transaction[]
    uploadedFileNames: string[]
    reportMonths:      number
  }
  // The bank tab's extracted rows (2026-08-09) — same persistence rule.
  // Stored ENCODED, one object per row: see the bank-grid block below.
  bank: {
    rawRows:      PersistedBankRow[]
    fileName:     string
    sentRows:     number[]
    reportMonths: number
  }
  meetings: {
    meetings: ReturnType<typeof useMeetingsStore.getState>['meetings']
  }
  expenseLog: {
    entries: ReturnType<typeof useExpenseLogStore.getState>['entries']
  }
  categoryBudgets: {
    budgets: ReturnType<typeof useCategoryBudgetStore.getState>['budgets']
  }
  clientProfile: {
    hasBusiness: ReturnType<typeof useClientProfileStore.getState>['hasBusiness']
  }
  recurring: {
    rules:  ReturnType<typeof useRecurringStore.getState>['rules']
    posted: ReturnType<typeof useRecurringStore.getState>['posted']
  }
  subscriptionPrefs: {
    dismissed: ReturnType<typeof useSubscriptionPrefsStore.getState>['dismissed']
  }
  budgetReminder: {
    dismissed: ReturnType<typeof useBudgetReminderStore.getState>['dismissed']
  }
  /** Identity of every business the household runs — shared by both business tabs. */
  businessRoster: {
    list:     BizProfile[]
    activeId: string
  }
  /**
   * `byId` is the real data (one entry per business). The flat fields alongside
   * it are a LEGACY MIRROR of the primary business only: a bundle from before
   * multi-business shipped reads those, so an old open tab still sees the main
   * business instead of a blank one.
   */
  business: BizData & {
    byId: Record<string, BizData>
  }
  businessAnnual: BizData & {
    year: number
    byId: Record<string, BizData>
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/* ── Bank grid encoding ───────────────────────────────────────────────────
 * Firestore REFUSES a document holding an array inside an array, and it
 * refuses the whole write — not just the offending field. The bank tab holds a
 * spreadsheet grid (rows of cells), so from 2026-08-09 (fd2fd0a, "bank+import
 * analyses persist like credit") until this fix, every save of the ENTIRE
 * portfolio failed from the moment a statement was loaded: mapping, monthly,
 * expense log, all of it, with Firebase's raw English message on screen. The
 * feature never worked either — no grid ever reached the cloud to be restored.
 *
 * So each row is wrapped in an object on the way out. Cells need their own
 * care for two reasons:
 *   · the bank flow keys off `c instanceof Date` (pickDate / detectBankHeader /
 *     looksLikeTransaction). Firestore hands a stored Date back as a Timestamp
 *     and JSON hands it back as a string, so a naive round-trip would restore a
 *     grid whose dates are gone and whose rows no longer look like transactions
 *     — the tab would then blame the file ("לא זוהו עסקאות"). Date cells are
 *     tagged explicitly and rebuilt on load.
 *   · sheet_to_json produces sparse rows, and Firestore rejects `undefined`
 *     just as hard as it rejects nested arrays. Holes become null.
 */

type PersistedCell = string | number | boolean | null | { d: string }
export interface PersistedBankRow { c: PersistedCell[] }

/**
 * Ceiling for the persisted grid. The whole portfolio shares ONE ~900KB
 * document (MAX_BYTES in DataSync), so a long statement must not eat the room
 * the rest of the portfolio needs — blowing that budget blocks EVERY save, a
 * worse failure than not keeping the grid. Over the cap the grid is dropped
 * from the snapshot entirely, file name and sent-marks included, so the tab
 * shows its plain "upload a file" state rather than accusing the file of being
 * unreadable.
 *
 * ~1,550 rows crosses this. That is a plausible 12-month statement, so the
 * over-cap path is a real path, not a theoretical one:
 *   · the rows live on in memory, and applyRemote() carries them over its
 *     reset (see keepOversizeGrid in DataSync.tsx) — otherwise a remote save
 *     from the advisor or another device would wipe a statement mid-review and
 *     the only way back is another upload plus another paid AI extraction.
 *   · the bank tab says so on screen, because "it will be gone after you
 *     refresh" is not something the user can infer.
 */
export const BANK_PERSIST_MAX_BYTES = 150_000

function encodeCell(v: unknown): PersistedCell {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : { d: v.toISOString() }
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  return null   // undefined (sparse row), nested structures, anything exotic
}

export function encodeBankRows(rows: unknown[][]): PersistedBankRow[] {
  // Array.from at BOTH levels, never .map: .map preserves holes, and a hole is
  // read back as `undefined` — the very thing this encoder exists to keep out
  // of the payload. Outer-level holes are not reachable from today's callers
  // (both build dense arrays), which is exactly why they would go unnoticed.
  return Array.from(rows, r => ({ c: Array.isArray(r) ? Array.from(r, encodeCell) : [] }))
}

function decodeCell(v: unknown): unknown {
  if (isObject(v) && typeof v.d === 'string') {
    const d = new Date(v.d)
    return isNaN(d.getTime()) ? null : d
  }
  return v ?? null
}

// Full ISO timestamps only. Applied ONLY to the legacy shape below, where
// JSON.stringify had already flattened Date cells to strings — a bank cell's
// own text never looks like this, so nothing real gets converted by mistake.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/

function decodeLegacyCell(v: unknown): unknown {
  if (typeof v === 'string' && ISO_DATE_RE.test(v)) {
    const d = new Date(v)
    if (!isNaN(d.getTime())) return d
  }
  return decodeCell(v)
}

/** Rebuild the live grid from a snapshot. Returns null when there is none. */
export function decodeBankRows(raw: unknown): unknown[][] | null {
  if (!Array.isArray(raw)) return null
  return raw.map(r => {
    // Legacy shape: a localStorage backup written between 2026-08-09 and this
    // fix holds the plain nested array (JSON allowed what Firestore did not).
    // Those restore here and get re-encoded on the next save.
    if (Array.isArray(r)) return Array.from(r, decodeLegacyCell)
    if (isObject(r) && Array.isArray(r.c)) return Array.from(r.c, decodeCell)
    return []
  })
}

// collectSnapshot runs on every keystroke-debounce; warn once per file, not
// once per call.
let warnedOversizeGrid = ''

// Encoding + measuring a grid is O(cells), and collectSnapshot is called
// several times per save cycle plus on every 500ms backup tick — on a
// thousand-row statement that is real work to repeat while someone is typing.
// Keyed on the array IDENTITY, which is sound for the same reason the save is
// scheduled at all: bankStore only ever REPLACES rawRows (setData / reset), and
// zustand subscribers — including DataSync's — fire on reference change.
let gridCacheSrc: unknown[][] | null = null
let gridCacheOut: { rows: PersistedBankRow[]; bytes: number } | null = null

function encodeGrid(rows: unknown[][]): { rows: PersistedBankRow[]; bytes: number } {
  if (gridCacheSrc === rows && gridCacheOut) return gridCacheOut
  const encoded = encodeBankRows(rows)
  const out = {
    rows:  encoded,
    bytes: encoded.length ? new TextEncoder().encode(JSON.stringify(encoded)).length : 0,
  }
  gridCacheSrc = rows
  gridCacheOut = out
  return out
}

/**
 * True when this grid cannot be persisted at all. Cheap to call from render:
 * it rides the same identity-keyed cache as the encoder.
 */
export function bankGridTooLargeToPersist(rows: unknown[][]): boolean {
  return rows.length > 0 && encodeGrid(rows).bytes > BANK_PERSIST_MAX_BYTES
}

/* ── An unsaveable grid survives a live-sync apply ────────────────────────
 * A statement over the cap is left out of the snapshot on purpose, so there is
 * nothing in the cloud for applySnapshot to put back after resetAllStores.
 * Without the pair below, one remote write — the advisor saving, the user's own
 * phone saving, the focus refetch — makes a long statement vanish from under
 * someone reviewing it, recoverable only by uploading again and paying for
 * another AI extraction. It is also what the sign-out path already claims to
 * protect: "Deliberately NOT done in applyRemote(), which resets stores within
 * ONE identity and would otherwise wipe a bank statement mid-review".
 *
 * Safe across identities BY CONSTRUCTION, which matters because carrying store
 * state over a reset is exactly how client data has leaked between people here
 * before: applyRemote is synchronous, so no sign-in, sign-out or act-as-client
 * entry can interleave between the capture and the restore. And a grid small
 * enough to persist is never carried, so an empty grid arriving from the cloud
 * still means "cleared on another device" and is honored.
 */
export type KeptGrid = ReturnType<typeof useBankStore.getState> | null

export function keepOversizeGrid(): KeptGrid {
  const b = useBankStore.getState()
  return bankGridTooLargeToPersist(b.rawRows) ? b : null
}

export function restoreOversizeGrid(kept: KeptGrid): void {
  if (!kept) return
  useBankStore.setState({
    rawRows:      kept.rawRows,
    fileName:     kept.fileName,
    sentRows:     kept.sentRows,
    reportMonths: kept.reportMonths,
  })
}

function collectBank(): Snapshot['bank'] {
  const b = useBankStore.getState()
  const { rows: rawRows, bytes } = encodeGrid(b.rawRows)
  if (bytes > BANK_PERSIST_MAX_BYTES) {
    if (warnedOversizeGrid !== b.fileName) {
      warnedOversizeGrid = b.fileName
      console.warn(
        `[dataSync] bank grid too large to persist (${Math.round(bytes / 1024)}KB > ` +
        `${Math.round(BANK_PERSIST_MAX_BYTES / 1024)}KB) — kept in memory for this session only`,
      )
    }
    return { rawRows: [], fileName: '', sentRows: [], reportMonths: b.reportMonths }
  }
  return {
    rawRows,
    fileName:     b.fileName,
    sentRows:     b.sentRows,
    reportMonths: b.reportMonths,
  }
}

/** Pull a serializable snapshot from all live stores. */
export function collectSnapshot(): Snapshot {
  const m = useMonthlyStore.getState()
  const a = useAnnualStore.getState()
  const p = useMappingStore.getState()
  const g = useGoalsStore.getState()
  const c = useCreditStore.getState()
  const mt = useMeetingsStore.getState()
  const el = useExpenseLogStore.getState()
  const cb = useCategoryBudgetStore.getState()
  const clp = useClientProfileStore.getState()
  const rc = useRecurringStore.getState()
  const sp = useSubscriptionPrefsStore.getState()
  const br = useBudgetReminderStore.getState()
  const b = useBusinessStore.getState()
  const ba = useBusinessAnnualStore.getState()
  const roster = useBusinessRosterStore.getState()

  // Legacy mirror source: the primary business, or the first one if it's gone.
  const primaryId = b.byId[PRIMARY_BUSINESS_ID] ? PRIMARY_BUSINESS_ID : (roster.list[0]?.id ?? PRIMARY_BUSINESS_ID)
  const bPrimary = b.byId[primaryId] ?? makeEmptyBizData()
  const baPrimary = ba.byId[primaryId] ?? makeEmptyBizData()

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
      creditCards: p.creditCards, bankAccounts: p.bankAccounts,
      varMonths: p.varMonths, creditImported: p.creditImported,
      bufferPct: p.bufferPct,
      incomeOverride:   p.incomeOverride,
      expensesOverride: p.expensesOverride,
      creditScore:      p.creditScore,
    },
    goals: { short: g.short, medium: g.medium, long: g.long, isUSCitizen: g.isUSCitizen, liquidTotal: g.liquidTotal, liquidSources: g.liquidSources },
    credit: {
      learnedDB:         c.learnedDB,
      reportMonths:      c.reportMonths,
      transactions:      c.transactions,
      uploadedFileNames: c.uploadedFileNames,
    },
    importTab: {
      transactions:      useImportStore.getState().transactions,
      uploadedFileNames: useImportStore.getState().uploadedFileNames,
      reportMonths:      useImportStore.getState().reportMonths,
    },
    bank: collectBank(),
    meetings: { meetings: mt.meetings },
    expenseLog: { entries: el.entries },
    categoryBudgets: { budgets: cb.budgets },
    clientProfile: { hasBusiness: clp.hasBusiness },
    recurring: { rules: rc.rules, posted: rc.posted },
    subscriptionPrefs: { dismissed: sp.dismissed },
    budgetReminder: { dismissed: br.dismissed },
    businessRoster: { list: roster.list, activeId: roster.activeId },
    business: {
      byId: b.byId,
      ...bPrimary,   // legacy mirror — see the Snapshot type
    },
    businessAnnual: {
      byId: ba.byId,
      year: ba.year,
      ...baPrimary,  // legacy mirror
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
      // osh (checking-account snapshots) was added later — months saved before it
      // existed need the field injected so the monthly tab can rely on it.
      const osh = (m.osh ?? {}) as Record<string, unknown>
      const num = (v: unknown) => (typeof v === 'number' ? v : 0)
      migrated[id] = {
        ...m,
        osh: {
          d2:  num(osh.d2),
          d10: num(osh.d10),
          d15: num(osh.d15),
          d20: num(osh.d20),
          d30: num(osh.d30),
        },
        // Legacy field — carried over to real rows a few lines below, then emptied.
        logged: Array.isArray(m.logged) ? m.logged : [],
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

      // One-time carry-over: months saved while the expense-log summary was a
      // display-only list get it rebuilt as real fromLog rows, so the journal's
      // spending lands in ביצוע like it does for every new transfer. Skipping
      // this would blank the summary out of those months entirely.
      // Idempotent — applyLogRows drops existing fromLog rows first and empties
      // `logged`, so a second pass over the same data changes nothing.
      const legacy = migrated[id] as MonthDataShape
      if (legacy.logged.length > 0) migrated[id] = applyLogRows(legacy, legacy.logged)
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
    const creditCards  = dedupRows(m.creditCards as Snapshot['mapping']['creditCards'] | undefined)
    const bankAccounts = dedupRows(m.bankAccounts as Snapshot['mapping']['bankAccounts'] | undefined)

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
      ...(creditCards  ? { creditCards }  : {}),
      ...(bankAccounts ? { bankAccounts } : {}),
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
      // Snapshots written before this field existed simply don't carry it —
      // only apply a real boolean, otherwise leave the store's default (null).
      ...(typeof g.isUSCitizen === 'boolean' ? { isUSCitizen: g.isUSCitizen } : {}),
      ...(typeof g.liquidTotal === 'number' ? { liquidTotal: g.liquidTotal } : {}),
      ...(Array.isArray(g.liquidSources) ? { liquidSources: g.liquidSources } : {}),
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

  // importTab — snapshots saved before it existed simply lack the key; the
  // guards skip them and the store keeps its empty defaults.
  if (isObject(raw.importTab)) {
    const it = raw.importTab as Partial<Snapshot['importTab']>
    useImportStore.setState({
      ...(Array.isArray(it.transactions)       ? { transactions: it.transactions }           : {}),
      ...(Array.isArray(it.uploadedFileNames)  ? { uploadedFileNames: it.uploadedFileNames } : {}),
      ...(typeof it.reportMonths === 'number'  ? { reportMonths: it.reportMonths }           : {}),
    })
  }

  // bank — same back-compat shape guards, plus the grid decode (which also
  // accepts the pre-2026-08-12 plain-array shape still sitting in localStorage).
  if (isObject(raw.bank)) {
    const b = raw.bank as Partial<Snapshot['bank']>
    const bankRows = decodeBankRows(b.rawRows)
    useBankStore.setState({
      ...(bankRows                            ? { rawRows: bankRows }            : {}),
      ...(typeof b.fileName === 'string'      ? { fileName: b.fileName }         : {}),
      ...(Array.isArray(b.sentRows)           ? { sentRows: b.sentRows }         : {}),
      ...(typeof b.reportMonths === 'number'  ? { reportMonths: b.reportMonths } : {}),
    })
  }

  // meetings
  if (isObject(raw.meetings) && Array.isArray(raw.meetings.meetings)) {
    useMeetingsStore.setState({
      meetings: raw.meetings.meetings as ReturnType<typeof useMeetingsStore.getState>['meetings'],
    })
  }

  // expenseLog (standalone real-time expense journal)
  if (isObject(raw.expenseLog) && Array.isArray(raw.expenseLog.entries)) {
    useExpenseLogStore.setState({ entries: raw.expenseLog.entries as ExpenseEntry[] })
  }

  // categoryBudgets (per-category monthly limits for the expense-log tab).
  // Snapshots saved before budgets existed simply lack the key — the guard
  // skips them and the store keeps its default (empty map). Coerce to a clean
  // { category -> positive number } map so a malformed value can't poison the UI.
  if (isObject(raw.categoryBudgets) && isObject(raw.categoryBudgets.budgets)) {
    const src = raw.categoryBudgets.budgets as Record<string, unknown>
    const budgets: Record<string, number> = {}
    for (const [cat, lim] of Object.entries(src)) {
      if (typeof lim === 'number' && Number.isFinite(lim) && lim > 0) budgets[cat] = lim
    }
    useCategoryBudgetStore.setState({ budgets })
  }

  // clientProfile — the one-time "has business" answer. Accept only a real
  // boolean; anything else (incl. missing key on old snapshots) leaves the
  // default null, so the client is asked once.
  if (isObject(raw.clientProfile)) {
    const hb = (raw.clientProfile as { hasBusiness?: unknown }).hasBusiness
    if (typeof hb === 'boolean') useClientProfileStore.setState({ hasBusiness: hb })
  }

  // recurring fixed expenses — rules + the per-month posted markers. Old
  // snapshots lack the key → guard skips, store keeps defaults (empty).
  if (isObject(raw.recurring)) {
    const rec = raw.recurring as { rules?: unknown; posted?: unknown }
    useRecurringStore.setState({
      rules:  Array.isArray(rec.rules) ? rec.rules as RecurringRule[] : [],
      posted: isObject(rec.posted) ? rec.posted as Record<string, string> : {},
    })
  }

  // subscription prefs — merchants the client dismissed from the detected list
  // (cancelled, or "not a subscription"). Old snapshots lack the key → guard
  // skips it and the store keeps its default (empty). Each entry is sanitized to
  // a { reason, name } shape so a malformed value can't poison the list.
  if (isObject(raw.subscriptionPrefs) && isObject(raw.subscriptionPrefs.dismissed)) {
    const src = raw.subscriptionPrefs.dismissed as Record<string, unknown>
    const dismissed: Record<string, DismissedSub> = {}
    for (const [key, v] of Object.entries(src)) {
      if (!isObject(v)) continue
      const reason = v.reason === 'not-sub' ? 'not-sub' : 'cancelled'
      const name   = typeof v.name === 'string' ? v.name : key
      dismissed[key] = { reason, name }
    }
    useSubscriptionPrefsStore.setState({ dismissed })
  }

  // budget reminder — target months whose "review your budget" nudge was already
  // handled. Old snapshots lack the key → guard skips it. Coerce to a clean
  // { "YYYY-MM" -> true } map so a malformed value can't poison the reminder.
  if (isObject(raw.budgetReminder) && isObject(raw.budgetReminder.dismissed)) {
    const src = raw.budgetReminder.dismissed as Record<string, unknown>
    const dismissed: Record<string, true> = {}
    for (const [ym, v] of Object.entries(src)) {
      if (v) dismissed[ym] = true
    }
    useBudgetReminderStore.setState({ dismissed })
  }

  // ── businesses ──
  // Two shapes exist in the wild: the current one (`byId` keyed by business id,
  // plus a `businessRoster`) and the original single-business one (flat fields).
  // A snapshot without `byId` is migrated into a single business under the
  // primary id, so nothing a client already entered is lost.

  if (isObject(raw.business)) {
    const b = raw.business as Record<string, unknown>
    const byId = readBizMap(b.byId, DEFAULT_BUSINESS)
    useBusinessStore.setState({
      byId: byId ?? { [PRIMARY_BUSINESS_ID]: readBizData(b, DEFAULT_BUSINESS) },
    })
  }

  if (isObject(raw.businessAnnual)) {
    const ba = raw.businessAnnual as Record<string, unknown>
    const byId = readBizMap(ba.byId, DEFAULT_BUSINESS_ANNUAL)
    useBusinessAnnualStore.setState({
      ...(typeof ba.year === 'number' ? { year: ba.year } : {}),
      byId: byId ?? { [PRIMARY_BUSINESS_ID]: readBizData(ba, DEFAULT_BUSINESS_ANNUAL) },
    })
  }

  if (isObject(raw.businessRoster)) {
    const r = raw.businessRoster as Record<string, unknown>
    const list = Array.isArray(r.list)
      ? (r.list as unknown[])
          .filter((p): p is BizProfile =>
            isObject(p) && typeof p.id === 'string' && !!p.id && typeof p.name === 'string')
          .map(p => ({ id: p.id, name: p.name }))
      : []
    if (list.length) {
      useBusinessRosterStore.setState({
        list,
        activeId: typeof r.activeId === 'string' && list.some(p => p.id === r.activeId)
          ? r.activeId
          : list[0].id,
      })
    }
  }

  // Roster ↔ data must agree: fills gaps, adopts orphans, fixes a dangling activeId.
  reconcileBusinessProfiles()
}

/** Read one business's fields off a raw object, falling back to defaults. */
function readBizData(raw: Record<string, unknown>, defaults: Omit<BizData, 'revenue' | 'cogs' | 'opex'>): BizData {
  const rows = (v: unknown): BizRow[] => (Array.isArray(v) ? v as BizRow[] : [])
  const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d)
  const numOrNull = (v: unknown) => (typeof v === 'number' ? v : null)
  const validType = raw.businessType === 'osek_murshe' || raw.businessType === 'osek_patur' || raw.businessType === 'company'
  return {
    businessType: validType ? raw.businessType as BusinessType : defaults.businessType,
    revenue: rows(raw.revenue),
    cogs:    rows(raw.cogs),
    opex:    rows(raw.opex),
    ownerSalary: num(raw.ownerSalary, defaults.ownerSalary),
    taxPoints:   num(raw.taxPoints, defaults.taxPoints),
    vatRate:     num(raw.vatRate, defaults.vatRate),
    incomeTaxOverride:    numOrNull(raw.incomeTaxOverride),
    bituachLeumiOverride: numOrNull(raw.bituachLeumiOverride),
    companyTaxOverride:   numOrNull(raw.companyTaxOverride),
    vatOverride:          numOrNull(raw.vatOverride),
  }
}

/** Read a `byId` map, or undefined when the snapshot predates multi-business. */
function readBizMap(
  raw: unknown,
  defaults: Omit<BizData, 'revenue' | 'cogs' | 'opex'>,
): Record<string, BizData> | undefined {
  if (!isObject(raw)) return undefined
  const out: Record<string, BizData> = {}
  for (const [id, v] of Object.entries(raw)) {
    if (!id || !isObject(v)) continue
    out[id] = readBizData(v, defaults)
  }
  return Object.keys(out).length ? out : undefined
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
    creditCards: [], bankAccounts: [],
    varMonths: 3, creditImported: false, bufferPct: 0.4,
    incomeOverride: null, expensesOverride: null,
    creditScore: 0,
  })
  useGoalsStore.setState({ short: [], medium: [], long: [], isUSCitizen: null, liquidTotal: 0, liquidSources: [] })
  useCreditStore.setState({
    transactions: [], uploadedFileNames: [],
    learnedDB: {}, sharedLearnedDB: {}, reportMonths: 3,
    isLoading: false, loadingMessage: '',
  })
  useImportStore.setState({ transactions: [], uploadedFileNames: [], reportMonths: 1 })
  useBankStore.setState({ rawRows: [], fileName: '', sentRows: [], reportMonths: 1 })
  useMeetingsStore.setState({ meetings: [] })
  useExpenseLogStore.setState({ entries: [] })
  useCategoryBudgetStore.setState({ budgets: {} })
  useClientProfileStore.setState({ hasBusiness: null })
  useRecurringStore.setState({ rules: [], posted: {} })
  useSubscriptionPrefsStore.setState({ dismissed: {} })
  useBudgetReminderStore.setState({ dismissed: {} })
  // Businesses: back to a single, empty primary business.
  useBusinessRosterStore.setState({
    list: DEFAULT_ROSTER.map(p => ({ ...p })),
    activeId: PRIMARY_BUSINESS_ID,
  })
  useBusinessStore.setState({ byId: { [PRIMARY_BUSINESS_ID]: makeEmptyBizData() } })
  useBusinessAnnualStore.setState({
    year: new Date().getFullYear(),
    byId: { [PRIMARY_BUSINESS_ID]: makeEmptyAnnualData() },
  })
}

/**
 * Reset the EPHEMERAL, per-person stores — the ones deliberately kept out of the
 * snapshot, and therefore untouched by resetAllStores().
 *
 * Call this ONLY when the person behind the screen changes: sign-out, entering or
 * leaving view/edit-as-client, account deletion. Leaving matters as much as
 * entering — exit is a full page reload, which clears bankStore for free but
 * REHYDRATES autoMapStore from localStorage, carrying the client's context back
 * into the advisor's own identity where "העתק למיפוי" would save it to the
 * advisor's own document. It must NOT be called from
 * applyRemote(), because that runs on every live-sync event from the other side
 * WITHIN one identity — clearing the bank tab there would delete a statement the
 * user is in the middle of working through, with no way to get it back.
 *
 * Why this exists: both stores below survived resetAllStores(), and entering
 * edit-as-client is an SPA navigation rather than a reload, so module-level
 * zustand state carried across. The advisor's own uploaded bank statement stayed
 * on screen under the CLIENT's name, and "send to section" pushed the advisor's
 * transactions into the client's mapping. autoMapStore was worse: it persists to
 * one un-scoped localStorage key holding the free-text financial context pasted
 * about a client, so it outlived sign-out entirely on a shared browser.
 */
export function resetSessionStores(opts?: { purgeArchive?: boolean }): void {
  useBankStore.setState({ rawRows: [], fileName: '', sentRows: [], reportMonths: 1 })

  // Only the LIVE lab session. `drafts` is deliberately preserved: it is a
  // durable archive of past AI generations (deleting a single one asks for
  // confirmation in the UI), it is the advisor's OWN work, and localStorage is
  // its only copy — it is in neither the snapshot nor the cloud backup. Wiping it
  // on every sign-out and every "view as client" would be silent, permanent data
  // loss on the most routine click in the app. Everything else here is one
  // person's financials, which is exactly what carried onto the next person's
  // screen and into "העתק למיפוי".
  //
  // ⚠️ Every field added to the live lab session must be listed here. annualItems
  // and dismissedOneOffs were added 2026-08-07 and initially were not: confirmed
  // annual expenses and dismissed merchant keys both carry the client's own
  // merchant names and amounts, so they survived an identity switch and would
  // have been sent to the AI as the NEXT client's context.
  // intakeForm (2026-08-09) is the most identifying of all of them: names, phone,
  // which banks, balances, credit limits — typed in about one specific person.
  // intakeRows (2026-08-11) is the same data in table form: three months of
  // salary per earner, pension balances, what the household owns.
  // The parsed upload (2026-08-10) is client data of the heaviest kind: one
  // person's entire transaction history, their bank rows, and the corrections
  // typed about them. It is persisted now so a refresh keeps the פירוט, which
  // is exactly why it must be cleared here.
  useAutoMapStore.setState({
    contextText: '', reportMonths: 1, result: null,
    annualItems: [], dismissedOneOffs: [], intakeForm: {}, intakeRows: {},
    txns: [], bankRows: [], fileNames: [], attachedByQ: {}, txnOverrides: {}, docNames: [],
  })

  // Account deletion is the one boundary that must leave nothing behind at all —
  // that flow's stated contract. Here the archive goes too.
  if (opts?.purgeArchive) {
    useAutoMapStore.setState({ drafts: [] })
    try {
      localStorage.removeItem(AUTOMAP_STORAGE_KEY)
    } catch { /* private mode / SSR */ }
  }
}

/** Quick byte-size estimate to enforce a sanity cap before saving. */
export function snapshotSize(snap: Snapshot): number {
  try {
    return new TextEncoder().encode(JSON.stringify(snap)).length
  } catch {
    return 0
  }
}
