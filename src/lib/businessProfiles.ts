'use client'

/**
 * The ONLY place that creates, duplicates or removes a business.
 *
 * Three stores have to move together — the roster (identity), the monthly P&L
 * and the annual plan — and each keys its data by the same business id. Doing
 * that inline in a page is how you end up with a business that exists in one
 * tab and not the other, so every mutation goes through here.
 */

import {
  useBusinessRosterStore, PRIMARY_BUSINESS_ID, DEFAULT_BUSINESS_NAME,
  type BizProfile,
} from '@/stores/businessRosterStore'
import { useBusinessStore, makeDefaultBizData } from '@/stores/businessStore'
import { useBusinessAnnualStore, makeDefaultAnnualData } from '@/stores/businessAnnualStore'

/** Add a fresh, empty business (default rows at 0). Returns its id. */
export function addBusiness(name?: string): string {
  const id = useBusinessRosterStore.getState().add(name)
  useBusinessStore.getState().createFor(id)
  useBusinessAnnualStore.getState().createFor(id)
  return id
}

/**
 * Duplicate a business — identity, monthly P&L and annual plan.
 * Rows are deep-copied with fresh ids (see cloneBizData), so the copy can
 * never alias the original.
 */
export function duplicateBusiness(sourceId: string): string {
  const id = useBusinessRosterStore.getState().duplicate(sourceId)
  useBusinessStore.getState().createFor(id, sourceId)
  useBusinessAnnualStore.getState().createFor(id, sourceId)
  return id
}

/** Remove a business everywhere. The last remaining business is never removed. */
export function removeBusiness(id: string): boolean {
  const roster = useBusinessRosterStore.getState()
  if (roster.list.length <= 1) return false
  roster.remove(id)
  useBusinessStore.getState().removeFor(id)
  useBusinessAnnualStore.getState().removeFor(id)
  return true
}

/**
 * Income-row label used when pushing an owner salary into the monthly budget.
 *
 * The first business keeps the original 'משכורת מהעסק' so existing clients'
 * rows keep updating in place; every additional business gets its own row.
 * Renaming a business therefore starts writing to a NEW row — the page shows
 * the exact target row name next to the button so that is never a surprise.
 */
export const SALARY_LABEL = 'משכורת מהעסק'

export function salaryRowLabel(bizId: string, name: string): string {
  if (bizId === PRIMARY_BUSINESS_ID) return SALARY_LABEL
  return `${SALARY_LABEL} (${name})`
}

/**
 * Make the roster and the two data maps consistent after a snapshot load.
 *
 * - every roster entry gets a data slot in both stores (missing ⇒ defaults)
 * - data with no roster entry is ADOPTED rather than dropped: an orphan would
 *   otherwise be invisible and unrecoverable for the client
 * - activeId always points at a business that exists
 *
 * MUST be a true no-op when nothing is wrong — it runs on every applySnapshot,
 * including the ones live onSnapshot sync delivers. Writing fresh object
 * identities unconditionally would mark the stores dirty, trigger a save, come
 * back as another snapshot, and loop forever.
 */
export function reconcileBusinessProfiles(): void {
  const roster = useBusinessRosterStore.getState()
  const monthly = useBusinessStore.getState()
  const annual = useBusinessAnnualStore.getState()

  let list: BizProfile[] = roster.list.length
    ? roster.list
    : [{ id: PRIMARY_BUSINESS_ID, name: DEFAULT_BUSINESS_NAME }]
  let listChanged = list !== roster.list

  const known = new Set(list.map(p => p.id))
  const orphans = [...new Set([...Object.keys(monthly.byId), ...Object.keys(annual.byId)])]
    .filter(id => !known.has(id))

  if (orphans.length) {
    const base = list.length
    list = [
      ...list,
      ...orphans.map((id, i) => ({
        id,
        name: id === PRIMARY_BUSINESS_ID ? DEFAULT_BUSINESS_NAME : `עסק ${base + i + 1}`,
      })),
    ]
    listChanged = true
  }

  const missingMonthly = list.filter(p => !monthly.byId[p.id])
  const missingAnnual = list.filter(p => !annual.byId[p.id])

  if (missingMonthly.length) {
    const byId = { ...monthly.byId }
    for (const p of missingMonthly) byId[p.id] = makeDefaultBizData()
    useBusinessStore.setState({ byId })
  }
  if (missingAnnual.length) {
    const byId = { ...annual.byId }
    for (const p of missingAnnual) byId[p.id] = makeDefaultAnnualData()
    useBusinessAnnualStore.setState({ byId })
  }

  const activeId = list.some(p => p.id === roster.activeId) ? roster.activeId : list[0].id
  if (listChanged || activeId !== roster.activeId) {
    useBusinessRosterStore.setState({ list, activeId })
  }
}
