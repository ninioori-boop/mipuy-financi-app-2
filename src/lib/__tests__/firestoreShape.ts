/**
 * Test helper (not a test file — no `.test.` in the name, so vitest skips it).
 *
 * Firestore refuses two things that JSON is perfectly happy with, and it
 * refuses the WHOLE document write for either one: an array nested inside an
 * array, and `undefined`. On 2026-08-12 the first of those took down every save
 * for any client who had loaded a bank statement since 2026-08-09 — the entire
 * portfolio lives in one document, so the bank tab's raw grid blocked the
 * mapping, the monthly plan and the expense log along with it.
 *
 * Anything destined for `users/{uid}` should be walked through here.
 */

/** Returns the first thing Firestore would reject, or null if the value is clean. */
export function firestoreViolation(v: unknown, path = '$'): string | null {
  if (v === undefined) return `${path} is undefined`
  if (v instanceof Date) return null          // stored as a Timestamp; legal
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      if (Array.isArray(v[i])) return `${path}[${i}] is an array inside an array`
      const deeper = firestoreViolation(v[i], `${path}[${i}]`)
      if (deeper) return deeper
    }
    return null
  }
  if (typeof v === 'object' && v !== null) {
    for (const [k, val] of Object.entries(v)) {
      const deeper = firestoreViolation(val, `${path}.${k}`)
      if (deeper) return deeper
    }
  }
  return null
}
