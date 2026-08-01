/**
 * A Firestore read can stay pending forever. Without offline persistence an
 * interrupted request neither resolves nor rejects — the same hazard DataSync
 * guards with SYNC_BUSY_MAX_MS — so any `await` on the render path needs a
 * deadline or it can strand the UI on a spinner with no way out but a reload.
 *
 * Deliberately a RACE and not a side-timer that pokes state on its own: with a
 * race there is exactly one settle path, so a late-arriving answer cannot
 * overwrite a decision the timeout already made (or the reverse). A separate
 * `setTimeout(() => setState(...))` alongside a `.then(() => setState(...))` has
 * two writers and needs flag discipline to stay correct; this has one by
 * construction.
 */

/** Resolved value when the raced promise did not settle in time. */
export const TIMED_OUT = Symbol('timed-out')

/**
 * Resolve with `p`'s value, or with TIMED_OUT after `ms`.
 *
 * Rejections propagate untouched — the caller's own catch still runs, so a
 * failing read behaves exactly as it did before the deadline existed. The timer
 * is cleared on every outcome so a resolved race leaves nothing pending.
 */
export function raceWithTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    p,
    new Promise<typeof TIMED_OUT>(resolve => {
      timer = setTimeout(() => resolve(TIMED_OUT), ms)
    }),
  ]).finally(() => { if (timer !== undefined) clearTimeout(timer) })
}
