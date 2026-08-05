import type { ExpenseEntry } from '@/stores/expenseLogStore'

/**
 * Has this transactionInbox item already been drained into the expense log?
 *
 * Two independent fingerprints, either one is proof:
 *  - `src` — the inbox item's own document id, stamped on every drained entry
 *    since 2026-08-05. THE reliable key: it exists whether or not the capture
 *    carried a ref, survives a tab killed between save-ack and the inbox
 *    deleteDoc, and survives two tabs racing the same 'added' event.
 *  - the legacy ` #ref` note suffix — kept for entries drained before `src`
 *    existed (and as belt-and-braces when the automation does send a ref).
 *
 * Deliberately NOT a merchant+amount+date fingerprint: two genuine identical
 * purchases on the same day (two coffees) are different inbox items with
 * different ids, and a date-level fingerprint would swallow the second one.
 */
export function alreadyDrained(entries: ExpenseEntry[], itemId: string, ref: string): boolean {
  if (entries.some(e => e.src === itemId)) return true
  if (ref && entries.some(e => e.note.endsWith(` #${ref}`))) return true
  return false
}
