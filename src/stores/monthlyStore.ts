'use client'

import { create } from 'zustand'
import { MONTH_DEFAULT_ROWS, FIXED_CATEGORIES, VAR_CATEGORIES, ANNUAL_CATEGORIES, INSURANCE_CATEGORIES, SUB_CATEGORIES, SKIP_CATEGORIES } from '@/lib/constants'
import { normalizeForLookup } from '@/lib/normalizeForLookup'

function uid() { return Math.random().toString(36).slice(2) }

/** One source transaction behind an imported ACTUAL — the drill-down the
 *  mapping panels have, now carried into the month (Ori, 2026-08-09). */
export interface BudgetTxn {
  desc:      string
  date:      string
  amount:    number
  isRefund?: boolean
}

export interface BudgetRow {
  id: string
  name: string
  plan: number
  actual: number
  fromMapping?: boolean   // true → managed by mapping→monthly auto-sync (fixed/variable/sub/ins only)
  // true → this row's actual came from the standalone expense-log (תיעוד הוצאות),
  // not from an imported report. It carries real spending, so it counts in ביצוע
  // like any other row, but the import must never write to it and it must never
  // hide an imported row of the same category — otherwise the two sources would
  // silently overwrite each other. A hand edit clears the flag (see updateRow).
  fromLog?: boolean
  // Set by applyImport when the actual came from an imported report — lets the
  // month show WHICH charges built the number. Optional: rows created before
  // this existed, and hand-typed actuals, simply have none.
  txns?: BudgetTxn[]
}

export interface InstRow {
  id: string
  name: string
  total: number
  monthly: number
  current: number
  totalPay: number
  fromMapping?: boolean   // true → managed by mapping→monthly auto-sync
}

export interface DebtRow {
  id: string
  name: string
  remaining: number
  monthly: number
  months: number
  fromMapping?: boolean   // true → managed by mapping→monthly auto-sync
}

export interface SavingRow {
  id: string
  name: string
  monthly: number
  accumulated: number
  fromMapping?: boolean   // true → managed by mapping→monthly auto-sync
}

// Checking-account (עו"ש) balance snapshots at 5 fixed days in the month.
export interface OshBalances {
  d2:  number
  d10: number
  d15: number
  d20: number
  d30: number
}

// Ordered list driving the UI table and the start-of-month delta. Keys map 1:1
// to OshBalances; `day` is the calendar day shown to the user.
export const OSH_POINTS = [
  { key: 'd2'  as const, day: 2  },
  { key: 'd10' as const, day: 10 },
  { key: 'd15' as const, day: 15 },
  { key: 'd20' as const, day: 20 },
  { key: 'd30' as const, day: 30 },
]
export type OshDay = keyof OshBalances

const EMPTY_OSH: OshBalances = { d2: 0, d10: 0, d15: 0, d20: 0, d30: 0 }

export interface MonthData {
  year: number
  income: BudgetRow[]
  fixed: BudgetRow[]
  variable: BudgetRow[]
  sub: BudgetRow[]
  ins: BudgetRow[]
  installments: InstRow[]
  debts: DebtRow[]
  savings: SavingRow[]
  osh: OshBalances
  // LEGACY. The expense-log summary used to live here as a display-only list.
  // It is now materialised as fromLog rows inside the budget sections (see
  // applyLogRows) so it counts in ביצוע; dataSync converts any month still
  // holding data here on load. Kept on the type so old snapshots still parse.
  logged: { name: string; amount: number }[]
  // Names of fromMapping rows the user deleted in this month. syncFromMapping
  // checks this so a deletion isn't undone on the next sync run. Per-section
  // because the same name could legitimately exist in multiple sections.
  deletedFromMapping: {
    fixed:         string[]
    variable:      string[]
    sub:           string[]
    ins:           string[]
    installments:  string[]
    debts:         string[]
    savings:       string[]
  }
}

export type SimpleSection = 'income' | 'fixed' | 'variable' | 'sub' | 'ins'

/** The four sections an expense-log category can land in. */
export type ExpenseSection = 'fixed' | 'variable' | 'sub' | 'ins'

/**
 * Which monthly section a category belongs to — the SAME routing applyImport
 * uses, so a category coming from the journal lands exactly where the same
 * category coming from a bank report would. Annual categories (חופשה וטיול)
 * fold into variable, matching the import. null ONLY for the skip set (income /
 * savings / investments / transfers) — those are not spending.
 *
 * Anything unrecognised falls back to variable instead of returning null. A
 * renamed or hand-typed label must still carry its money into the month; a
 * category whose amount silently evaporates is the worse failure by far.
 */
export function sectionOfCategory(cat: string): ExpenseSection | null {
  if (SKIP_CATEGORIES.has(cat)) return null
  if (FIXED_CATEGORIES.has(cat)) return 'fixed'
  if (SUB_CATEGORIES.has(cat)) return 'sub'
  if (INSURANCE_CATEGORIES.has(cat)) return 'ins'
  return 'variable'
}

/**
 * Materialise the expense-log summary as real budget rows inside a month.
 *
 * Every previous fromLog row is dropped first, so transferring again REPLACES
 * the journal's contribution instead of stacking a second copy on top of it —
 * the operation is idempotent no matter how many times it runs.
 *
 * `logged` (the old display-only snapshot) is cleared on the way out. Rows are
 * the single record of this money now; keeping both would let the two drift
 * apart and show the same shekel twice.
 *
 * Exported because the one-time carry-over of legacy `logged` data runs from
 * dataSync, and both paths must build rows identically.
 */
export function applyLogRows(m: MonthData, items: { name: string; amount: number }[]): MonthData {
  const bySection: Record<ExpenseSection, BudgetRow[]> = { fixed: [], variable: [], sub: [], ins: [] }
  for (const { name, amount } of items) {
    const section = sectionOfCategory(name)
    const rounded = Math.round(amount)
    if (!section || rounded <= 0) continue
    bySection[section].push({ id: uid(), name, plan: 0, actual: rounded, fromLog: true })
  }
  const keep = (rows: BudgetRow[]) => rows.filter(r => !r.fromLog)
  return {
    ...m,
    fixed:    [...keep(m.fixed),    ...bySection.fixed],
    variable: [...keep(m.variable), ...bySection.variable],
    sub:      [...keep(m.sub),      ...bySection.sub],
    ins:      [...keep(m.ins),      ...bySection.ins],
    logged: [],
  }
}

function makeDefaultMonth(): MonthData {
  function rows(names: string[]): BudgetRow[] {
    return names.map(name => ({ id: uid(), name, plan: 0, actual: 0 }))
  }
  return {
    year: new Date().getFullYear(),
    income:       rows(MONTH_DEFAULT_ROWS.income),
    fixed:        rows(MONTH_DEFAULT_ROWS.fixed),
    variable:     rows(MONTH_DEFAULT_ROWS.variable),
    sub:          rows(MONTH_DEFAULT_ROWS.sub),
    ins:          rows(MONTH_DEFAULT_ROWS.ins),
    installments: [],
    debts:        [],
    savings:      [],
    osh:          { ...EMPTY_OSH },
    logged:       [],
    deletedFromMapping: {
      fixed: [], variable: [], sub: [], ins: [],
      installments: [], debts: [], savings: [],
    },
  }
}

interface MonthlyState {
  months: Record<string, MonthData>

  initMonth:  (monthId: string) => void
  setYear:    (monthId: string, year: number) => void
  updateOsh:  (monthId: string, day: OshDay, value: number) => void
  // Carry the תיעוד הוצאות summary into this month as real fromLog rows, so the
  // journal's spending counts in ביצוע. Replaces any previous transfer.
  applyExpenseLog: (monthId: string, items: { name: string; amount: number }[]) => void

  addRow:    (monthId: string, section: SimpleSection, name?: string) => void
  updateRow: (monthId: string, section: SimpleSection, id: string, field: 'name' | 'plan' | 'actual', value: string | number) => void
  deleteRow: (monthId: string, section: SimpleSection, id: string) => void

  addInstRow:    (monthId: string) => void
  updateInstRow: (monthId: string, id: string, field: keyof Omit<InstRow, 'id'>, value: string | number) => void
  deleteInstRow: (monthId: string, id: string) => void

  addDebtRow:    (monthId: string) => void
  updateDebtRow: (monthId: string, id: string, field: keyof Omit<DebtRow, 'id'>, value: string | number) => void
  deleteDebtRow: (monthId: string, id: string) => void

  addSavingRow:    (monthId: string) => void
  updateSavingRow: (monthId: string, id: string, field: keyof Omit<SavingRow, 'id'>, value: string | number) => void
  deleteSavingRow: (monthId: string, id: string) => void

  applyImport: (
    monthId: string,
    catSums: Record<string, number>,
    mappingFixed:    { name: string; amount: number }[],
    mappingVariable: { name: string; amount: number }[],
    mappingSub:      { name: string; amount: number }[],
    mappingIns:      { name: string; amount: number }[],
    mappingInstallments: { name: string; totalAmount: number; monthlyPayment: number; paidCount: number; totalCount: number }[],
    mappingDebts:        { name: string; remainingBalance: number; monthlyPayment: number; remainingMonths: number }[],
    mappingSavings:      { name: string; monthlyContribution: number; accumulated: number }[],
    varMonths: number,
    // Per-business actuals (from the imported report) used to fill the ACTUAL of
    // matching NAMED rows in fixed/sub/ins by business name; unmatched businesses
    // fold into their category total. Optional — when omitted, actuals stay
    // category-level (backward-compatible with older callers/tests).
    merchantSums?: { name: string; amount: number; category: string; txns?: BudgetTxn[] }[],
    catTxns?: Record<string, BudgetTxn[]>,
  ) => void

  /**
   * Mirror mapping into every existing month (or just `monthId` if provided).
   * Covers 4 budget sections (fixed/variable/sub/ins) + 3 specialty sections
   * (installments/debts/savings). Rows are tagged with fromMapping:true so
   * that user edits in the monthly tab (which clear the flag) are preserved
   * against future syncs.
   *
   * Variable rows: mapping stores period totals; this divides by varMonths
   * to land a monthly plan amount, matching the existing applyImport logic.
   *
   * Rules per section:
   *   - fromMapping rows whose name is no longer in mapping → removed.
   *   - fromMapping rows whose mapping counterpart changed → updated in place.
   *   - Mapping rows not yet present in the month → added as fromMapping.
   *   - Non-fromMapping rows (manual) → NEVER touched.
   */
  syncFromMapping: (
    mappingFixed:    { name: string; amount: number }[],
    mappingVariable: { name: string; amount: number }[],
    mappingSub:      { name: string; amount: number }[],
    mappingIns:      { name: string; amount: number }[],
    mappingInstallments: { name: string; totalAmount: number; monthlyPayment: number; paidCount: number; totalCount: number }[],
    mappingDebts:        { name: string; remainingBalance: number; monthlyPayment: number; remainingMonths: number }[],
    mappingSavings:      { name: string; monthlyContribution: number; accumulated: number }[],
    varMonths: number,
    monthId?: string,
  ) => void
}

export const useMonthlyStore = create<MonthlyState>((set, get) => {
  function updateMonth(monthId: string, updater: (m: MonthData) => MonthData) {
    set(s => {
      const m = s.months[monthId] ?? makeDefaultMonth()
      return { months: { ...s.months, [monthId]: updater(m) } }
    })
  }

  return {
    months: {},

    initMonth: (monthId) => {
      if (get().months[monthId]) return
      set(s => ({ months: { ...s.months, [monthId]: makeDefaultMonth() } }))
    },

    setYear: (monthId, year) => updateMonth(monthId, m => ({ ...m, year })),

    updateOsh: (monthId, day, value) =>
      updateMonth(monthId, m => ({
        ...m,
        osh: { ...(m.osh ?? EMPTY_OSH), [day]: value },
      })),

    applyExpenseLog: (monthId, items) => updateMonth(monthId, m => applyLogRows(m, items)),

    addRow: (monthId, section, name = '') =>
      updateMonth(monthId, m => ({
        ...m,
        [section]: [...m[section], { id: uid(), name, plan: 0, actual: 0 }],
      })),

    updateRow: (monthId, section, id, field, value) =>
      updateMonth(monthId, m => ({
        ...m,
        // Clear fromMapping AND fromLog on user edit — the row becomes "manual"
        // for this specific month, so neither a future mapping sync nor a
        // re-transfer from the journal will overwrite what was typed by hand.
        // fromLog is written back only when the row actually had it: every row
        // in every month passes through here, and an unconditional `false`
        // would add a dead field to all of them inside a 900KB-capped document.
        [section]: m[section].map(r => r.id === id
          ? { ...r, [field]: value, fromMapping: false, ...(r.fromLog ? { fromLog: false } : {}) }
          : r),
      })),

    deleteRow: (monthId, section, id) =>
      updateMonth(monthId, m => {
        const target = m[section].find(r => r.id === id)
        const filtered = m[section].filter(r => r.id !== id)
        // If we just deleted a row that came from mapping, remember its name
        // so the next sync doesn't undo the deletion.
        if (target?.fromMapping && target.name && section !== 'income') {
          const list = m.deletedFromMapping[section as keyof MonthData['deletedFromMapping']]
          if (!list.includes(target.name)) {
            return {
              ...m,
              [section]: filtered,
              deletedFromMapping: {
                ...m.deletedFromMapping,
                [section]: [...list, target.name],
              },
            }
          }
        }
        return { ...m, [section]: filtered }
      }),

    addInstRow: (monthId) =>
      updateMonth(monthId, m => ({
        ...m,
        installments: [...m.installments, { id: uid(), name: '', total: 0, monthly: 0, current: 0, totalPay: 0 }],
      })),

    updateInstRow: (monthId, id, field, value) =>
      updateMonth(monthId, m => ({
        ...m,
        // Clear fromMapping on user edit — the row becomes "manual" for this
        // specific month and future mapping syncs will no longer touch it.
        installments: m.installments.map(r => r.id === id ? { ...r, [field]: value, fromMapping: false } : r),
      })),

    deleteInstRow: (monthId, id) =>
      updateMonth(monthId, m => {
        const target = m.installments.find(r => r.id === id)
        const filtered = m.installments.filter(r => r.id !== id)
        if (target?.fromMapping && target.name && !m.deletedFromMapping.installments.includes(target.name)) {
          return {
            ...m,
            installments: filtered,
            deletedFromMapping: {
              ...m.deletedFromMapping,
              installments: [...m.deletedFromMapping.installments, target.name],
            },
          }
        }
        return { ...m, installments: filtered }
      }),

    addDebtRow: (monthId) =>
      updateMonth(monthId, m => ({
        ...m,
        debts: [...m.debts, { id: uid(), name: '', remaining: 0, monthly: 0, months: 0 }],
      })),

    updateDebtRow: (monthId, id, field, value) =>
      updateMonth(monthId, m => ({
        ...m,
        // Clear fromMapping on user edit — see updateInstRow comment.
        debts: m.debts.map(r => r.id === id ? { ...r, [field]: value, fromMapping: false } : r),
      })),

    deleteDebtRow: (monthId, id) =>
      updateMonth(monthId, m => {
        const target = m.debts.find(r => r.id === id)
        const filtered = m.debts.filter(r => r.id !== id)
        if (target?.fromMapping && target.name && !m.deletedFromMapping.debts.includes(target.name)) {
          return {
            ...m,
            debts: filtered,
            deletedFromMapping: {
              ...m.deletedFromMapping,
              debts: [...m.deletedFromMapping.debts, target.name],
            },
          }
        }
        return { ...m, debts: filtered }
      }),

    addSavingRow: (monthId) =>
      updateMonth(monthId, m => ({
        ...m,
        savings: [...m.savings, { id: uid(), name: '', monthly: 0, accumulated: 0 }],
      })),

    updateSavingRow: (monthId, id, field, value) =>
      updateMonth(monthId, m => ({
        ...m,
        // Clear fromMapping on user edit — see updateInstRow comment.
        savings: m.savings.map(r => r.id === id ? { ...r, [field]: value, fromMapping: false } : r),
      })),

    deleteSavingRow: (monthId, id) =>
      updateMonth(monthId, m => {
        const target = m.savings.find(r => r.id === id)
        const filtered = m.savings.filter(r => r.id !== id)
        if (target?.fromMapping && target.name && !m.deletedFromMapping.savings.includes(target.name)) {
          return {
            ...m,
            savings: filtered,
            deletedFromMapping: {
              ...m.deletedFromMapping,
              savings: [...m.deletedFromMapping.savings, target.name],
            },
          }
        }
        return { ...m, savings: filtered }
      }),

    applyImport: (monthId, catSums, mappingFixed, mappingVariable, mappingSub, mappingIns, mappingInstallments, mappingDebts, mappingSavings, varMonths, merchantSums, catTxns) => {
      // Detail arrays are capped per row — they live inside the month, which
      // lives inside the 900KB snapshot. 300 slim rows ≈ 20KB worst case.
      const TXN_CAP = 300
      const capTxns = (list?: BudgetTxn[]) =>
        list && list.length ? list.slice(0, TXN_CAP) : undefined
      updateMonth(monthId, m => {
        const del = m.deletedFromMapping
        // Step 1: merge mapping plan rows. Skip rows already present by name OR
        // ones the user deleted in this month (deletedFromMapping) — otherwise an
        // import would resurrect rows the user intentionally removed. Rows that
        // do come in are tagged fromMapping:true so they integrate with the
        // mapping→monthly auto-sync (and stay re-deletable).
        function mergePlan(rows: BudgetRow[], src: { name: string; amount: number }[], deletedNames: string[]): BudgetRow[] {
          // fromLog rows are excluded from the name check: a journal row for
          // "מזון לבית" must not stop the mapping's planned "מזון לבית" from
          // being added, or the month would show spending with no plan beside it.
          const names = new Set(rows.filter(r => !r.fromLog).map(r => r.name))
          const deleted = new Set(deletedNames)
          const added = src
            .filter(s => !names.has(s.name) && !deleted.has(s.name) && s.amount > 0)
            .map(s => ({ id: uid(), name: s.name, plan: s.amount, actual: 0, fromMapping: true }))
          return [...rows, ...added]
        }
        const varMonthly = mappingVariable.map(s => ({ name: s.name, amount: Math.round(s.amount / Math.max(1, varMonths)) }))
        let fixed    = mergePlan(m.fixed,    mappingFixed, del.fixed)
        let variable = mergePlan(m.variable, varMonthly,   del.variable)
        let sub      = mergePlan(m.sub,      mappingSub,   del.sub)
        let ins      = mergePlan(m.ins,      mappingIns,   del.ins)

        // Step 2: fill actual from catSums. ACTUAL is real spending from the
        // imported report and is NEVER suppressed — not even for a category the
        // user deleted in this month. (Gating this on deletedFromMapping was a
        // bug: deleting the variable rows before importing made the imported
        // spending vanish entirely.) A category with spending but no row is added
        // as actual-only — note this brings back the ROW but with plan 0, so a
        // deleted budget line shows its real spending without resurrecting its
        // old mapping plan amount.
        function fillActual(rows: BudgetRow[], cats: Set<string>): BudgetRow[] {
          // A fromLog row holds the journal's own money. The import must neither
          // overwrite it (its name is skipped below) nor treat it as "this
          // category already has a row" (excluded from `names`), or the report's
          // spending for that category would be dropped on the floor.
          const names = new Set(rows.filter(r => !r.fromLog).map(r => r.name))
          const updated = rows.map(r => {
            const s = catSums[r.name]
            if (s === undefined || !cats.has(r.name) || r.fromLog) return r
            // Conditional spread, never an explicit undefined — Firestore
            // rejects undefined values and would fail the whole snapshot save.
            // STALE detail is dropped first: a re-send that fills this actual
            // without new detail must not leave last report's charges shown.
            const t = capTxns(catTxns?.[r.name])
            const base = { ...r }; delete base.txns
            return { ...base, actual: Math.round(s), ...(t ? { txns: t } : {}) }
          })
          Object.entries(catSums).forEach(([cat, sum]) => {
            if (cats.has(cat) && !names.has(cat) && sum > 0) {
              const t = capTxns(catTxns?.[cat])
              updated.push({ id: uid(), name: cat, plan: 0, actual: Math.round(sum), ...(t ? { txns: t } : {}) })
            }
          })
          return updated
        }

        // Per-ITEM actual for fixed/sub/ins: match each report business to a NAMED
        // budget row (a mapping-derived per-business row like "ביטוח הראל") by
        // normalized business name and fill THAT row's actual — so the month shows
        // plan-vs-actual per specific insurance / subscription / fixed commitment.
        // Whatever isn't matched to a named row folds into its category row
        // (leftover = category total − amounts already consumed by named rows), so
        // the grand total is preserved and nothing is double-counted. Category rows
        // and unmatched businesses behave exactly like fillActual. When merchantSums
        // is absent this degrades to category-level (identical to fillActual).
        const merchants = merchantSums ?? []
        function fillActualPerItem(rows: BudgetRow[], cats: Set<string>): BudgetRow[] {
          // This section's businesses (selected by their category), summed per
          // normalized name so multiple charges of the same business collapse.
          const byKey = new Map<string, { sum: number; category: string; txns: BudgetTxn[] }>()
          for (const mrc of merchants) {
            // amount 0 is allowed through (a merchant fully netted by refunds
            // must ZERO its named row's actual on re-send); negatives are not.
            if (!cats.has(mrc.category) || mrc.amount < 0) continue
            const k = normalizeForLookup(mrc.name)
            if (!k) continue
            const e = byKey.get(k) ?? { sum: 0, category: mrc.category, txns: [] }
            e.sum += mrc.amount
            if (mrc.txns) e.txns.push(...mrc.txns)
            byKey.set(k, e)
          }
          // Normalized names of this section's NAMED (non-category) rows.
          const namedKeys = new Set(
            rows.filter(r => !cats.has(r.name) && !r.fromLog).map(r => normalizeForLookup(r.name)).filter(Boolean),
          )
          // Amount consumed by named rows, per category — subtracted from leftover.
          const consumed: Record<string, number> = {}
          for (const [k, { sum, category }] of byKey) {
            if (namedKeys.has(k)) consumed[category] = (consumed[category] ?? 0) + sum
          }
          // Pass 1 — fill named (per-business) rows from their matched total.
          // No match in this import → leave the row's existing actual untouched.
          let out = rows.map(r => {
            if (cats.has(r.name) || r.fromLog) return r
            const hit = byKey.get(normalizeForLookup(r.name))
            if (!hit) return r
            const t = capTxns(hit.txns)
            const base = { ...r }; delete base.txns
            return { ...base, actual: Math.round(hit.sum), ...(t ? { txns: t } : {}) }
          })
          // Leftover detail for a category row = the category's transactions
          // minus those consumed by named rows — mirrors the amount math.
          const leftoverTxnsOf = (cat: string) =>
            capTxns(catTxns?.[cat]?.filter(t => !namedKeys.has(normalizeForLookup(t.desc))))
          // Pass 2 — fill category rows from the leftover (total − consumed).
          // fromLog rows are invisible to both the overwrite pass and the
          // "does this category already have a row?" check — same reasoning as
          // fillActual: the journal and the report each keep their own row.
          const present = new Set(out.filter(r => !r.fromLog).map(r => r.name))
          out = out.map(r => {
            if (!cats.has(r.name) || r.fromLog) return r
            const total = catSums[r.name]
            if (total === undefined) return r
            const t = leftoverTxnsOf(r.name)
            const base = { ...r }; delete base.txns
            return { ...base, actual: Math.max(0, Math.round(total - (consumed[r.name] ?? 0))), ...(t ? { txns: t } : {}) }
          })
          // Category with leftover spending but no row yet → add it (plan 0).
          Object.entries(catSums).forEach(([cat, total]) => {
            if (!cats.has(cat) || present.has(cat)) return
            const leftover = Math.max(0, Math.round(total - (consumed[cat] ?? 0)))
            if (leftover > 0) {
              const t = leftoverTxnsOf(cat)
              out.push({ id: uid(), name: cat, plan: 0, actual: leftover, ...(t ? { txns: t } : {}) })
            }
          })
          return out
        }

        // Annual categories (e.g. חופשה וטיול) have no dedicated monthly section;
        // fold them into variable expenses so the amount isn't silently dropped.
        const variableCats = new Set([...VAR_CATEGORIES, ...ANNUAL_CATEGORIES])
        // Per-item actual for the three "named row" sections; variable stays
        // category-level (only fixed/sub/ins carry per-business rows worth
        // reconciling against the report).
        fixed    = fillActualPerItem(fixed,    FIXED_CATEGORIES)
        variable = fillActual(variable, variableCats)
        sub      = fillActualPerItem(sub,      SUB_CATEGORIES)
        ins      = fillActualPerItem(ins,      INSURANCE_CATEGORIES)

        // Step 3: merge installments / debts / savings from mapping into the
        // month's own sections. Skip rows already present in the month by name
        // (so re-running the import doesn't duplicate). Annual-plan rows from
        // the mapping intentionally stay only in the mapping/annual view — they
        // are not pushed per-month.
        // Same discipline as the budget sections: skip names the user deleted in
        // this month, and tag carried rows fromMapping:true so the auto-sync owns
        // them and re-deletion sticks.
        const namesIn = <T extends { name: string }>(rows: T[]) => new Set(rows.map(r => r.name))

        const instNames = namesIn(m.installments)
        const instDeleted = new Set(del.installments)
        const newInstallments: InstRow[] = mappingInstallments
          .filter(i => !instNames.has(i.name) && !instDeleted.has(i.name) && (i.monthlyPayment > 0 || i.totalAmount > 0))
          .map(i => ({
            id: uid(),
            name: i.name,
            total:    Math.round(i.totalAmount),
            monthly:  Math.round(i.monthlyPayment),
            current:  i.paidCount,
            totalPay: i.totalCount,
            fromMapping: true,
          }))
        const installments = [...m.installments, ...newInstallments]

        const debtNames = namesIn(m.debts)
        const debtDeleted = new Set(del.debts)
        const newDebts: DebtRow[] = mappingDebts
          .filter(d => !debtNames.has(d.name) && !debtDeleted.has(d.name) && (d.monthlyPayment > 0 || d.remainingBalance > 0))
          .map(d => ({
            id: uid(),
            name: d.name,
            remaining: Math.round(d.remainingBalance),
            monthly:   Math.round(d.monthlyPayment),
            months:    d.remainingMonths,
            fromMapping: true,
          }))
        const debts = [...m.debts, ...newDebts]

        const savNames = namesIn(m.savings)
        const savDeleted = new Set(del.savings)
        const newSavings: SavingRow[] = mappingSavings
          .filter(s => !savNames.has(s.name) && !savDeleted.has(s.name) && (s.monthlyContribution > 0 || s.accumulated > 0))
          .map(s => ({
            id: uid(),
            name: s.name,
            monthly:     Math.round(s.monthlyContribution),
            accumulated: Math.round(s.accumulated),
            fromMapping: true,
          }))
        const savings = [...m.savings, ...newSavings]

        return { ...m, fixed, variable, sub, ins, installments, debts, savings }
      })
    },

    syncFromMapping: (mFixed, mVariable, mSub, mIns, mInst, mDebts, mSav, varMonths, monthId) => {
      set(s => {
        const targets = monthId ? [monthId] : Object.keys(s.months)
        if (targets.length === 0) return s

        const varDivisor = Math.max(1, varMonths)
        // Budget sections: mapping rows arrive as { name, amount }. Variable
        // mapping amounts are period totals, so they need division to land a
        // monthly plan figure.
        const fixedByName = new Map(mFixed.map(r => [r.name, r.amount] as const))
        const varByName   = new Map(mVariable.map(r => [r.name, Math.round(r.amount / varDivisor)] as const))
        const subByName   = new Map(mSub.map(r => [r.name, r.amount] as const))
        const insByName   = new Map(mIns.map(r => [r.name, r.amount] as const))

        // Specialty sections: shape-converted from mapping types.
        const instByName = new Map(mInst.map(i => [i.name, i]))
        const debtByName = new Map(mDebts.map(d => [d.name, d]))
        const savByName  = new Map(mSav.map(v => [v.name, v]))

        // Generic merge for the 4 budget sections (BudgetRow shape).
        // deletedNames blocks re-adding rows the user explicitly deleted.
        function syncBudgetSection(existing: BudgetRow[], byName: Map<string, number>, deletedNames: string[]): BudgetRow[] {
          // fromLog rows carry spending, never a plan, so they must not stand in
          // for a mapping row of the same name — otherwise the planned amount
          // would never reach the month. (They fall through the loop below
          // untouched, like any other non-fromMapping row.)
          const existingNames = new Set(existing.filter(r => !r.fromLog).map(r => r.name))
          const deletedSet = new Set(deletedNames)
          const result: BudgetRow[] = []
          for (const r of existing) {
            if (!r.fromMapping) { result.push(r); continue }  // manual — leave untouched
            const newPlan = byName.get(r.name)
            if (newPlan === undefined) continue                // mapping removed → drop
            result.push({ ...r, plan: Math.round(newPlan) })
          }
          for (const [name, amount] of byName) {
            if (existingNames.has(name)) continue              // name already in month (manual or fromMapping)
            if (deletedSet.has(name)) continue                 // user explicitly deleted — respect it
            if (amount <= 0) continue                          // skip empty/noise
            result.push({
              id: uid(),
              name,
              plan: Math.round(amount),
              actual: 0,
              fromMapping: true,
            })
          }
          return result
        }

        const newMonths = { ...s.months }
        targets.forEach(mid => {
          const m = newMonths[mid]
          if (!m) return

          // BUDGET SECTIONS (fixed / variable / sub / ins)
          const del = m.deletedFromMapping
          const fixed    = syncBudgetSection(m.fixed,    fixedByName, del.fixed)
          const variable = syncBudgetSection(m.variable, varByName,   del.variable)
          const sub      = syncBudgetSection(m.sub,      subByName,   del.sub)
          const ins      = syncBudgetSection(m.ins,      insByName,   del.ins)

          // INSTALLMENTS
          const instExisting = new Set(m.installments.map(r => r.name))
          const installments: InstRow[] = []
          for (const r of m.installments) {
            if (!r.fromMapping) { installments.push(r); continue }
            const src = instByName.get(r.name)
            if (!src) continue   // mapping removed it → drop from monthly
            installments.push({
              ...r,
              total:    Math.round(src.totalAmount),
              monthly:  Math.round(src.monthlyPayment),
              current:  src.paidCount,
              totalPay: src.totalCount,
            })
          }
          const instDeleted = new Set(del.installments)
          for (const [name, src] of instByName) {
            if (instExisting.has(name)) continue
            if (instDeleted.has(name)) continue   // user explicitly deleted — respect it
            if (src.monthlyPayment <= 0 && src.totalAmount <= 0) continue
            installments.push({
              id: uid(), name,
              total:    Math.round(src.totalAmount),
              monthly:  Math.round(src.monthlyPayment),
              current:  src.paidCount,
              totalPay: src.totalCount,
              fromMapping: true,
            })
          }

          // DEBTS
          const debtExisting = new Set(m.debts.map(r => r.name))
          const debts: DebtRow[] = []
          for (const r of m.debts) {
            if (!r.fromMapping) { debts.push(r); continue }
            const src = debtByName.get(r.name)
            if (!src) continue
            debts.push({
              ...r,
              remaining: Math.round(src.remainingBalance),
              monthly:   Math.round(src.monthlyPayment),
              months:    src.remainingMonths,
            })
          }
          const debtDeleted = new Set(del.debts)
          for (const [name, src] of debtByName) {
            if (debtExisting.has(name)) continue
            if (debtDeleted.has(name)) continue   // user explicitly deleted — respect it
            if (src.monthlyPayment <= 0 && src.remainingBalance <= 0) continue
            debts.push({
              id: uid(), name,
              remaining: Math.round(src.remainingBalance),
              monthly:   Math.round(src.monthlyPayment),
              months:    src.remainingMonths,
              fromMapping: true,
            })
          }

          // SAVINGS
          const savExisting = new Set(m.savings.map(r => r.name))
          const savings: SavingRow[] = []
          for (const r of m.savings) {
            if (!r.fromMapping) { savings.push(r); continue }
            const src = savByName.get(r.name)
            if (!src) continue
            savings.push({
              ...r,
              monthly:     Math.round(src.monthlyContribution),
              accumulated: Math.round(src.accumulated),
            })
          }
          const savDeleted = new Set(del.savings)
          for (const [name, src] of savByName) {
            if (savExisting.has(name)) continue
            if (savDeleted.has(name)) continue   // user explicitly deleted — respect it
            if (src.monthlyContribution <= 0 && src.accumulated <= 0) continue
            savings.push({
              id: uid(), name,
              monthly:     Math.round(src.monthlyContribution),
              accumulated: Math.round(src.accumulated),
              fromMapping: true,
            })
          }

          newMonths[mid] = { ...m, fixed, variable, sub, ins, installments, debts, savings }
        })

        return { months: newMonths }
      })
    },
  }
})
