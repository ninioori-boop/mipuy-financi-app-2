import { stableStringify } from './liveSync'

// Canonical form of the last-saved baseline, memoized on the JSON string itself.
// The cheap exact compare below almost never hits (Firestore does not preserve
// map key order), so the canonical pass runs on essentially every held event —
// including our own echo, which is the common case while typing. Caching the
// baseline halves the work; the held document still has to be canonicalized
// fresh each time, since it is a different document every event.
let canonCacheSrc = ''
let canonCacheOut = ''
function canonicalBaseline(lastSavedJson: string): string | null {
  if (canonCacheSrc === lastSavedJson) return canonCacheOut
  try {
    canonCacheOut = stableStringify(JSON.parse(lastSavedJson))
    canonCacheSrc = lastSavedJson
    return canonCacheOut
  } catch {
    return null
  }
}

/**
 * Does a foreign document the live listener is HOLDING mean our pending save
 * would clobber someone else's change?
 *
 * Why this exists — the hole it closes:
 *
 * DataSync guards every full-snapshot write with a freshness probe: read the
 * target document, and if its `updatedAt` is newer than our baseline, block and
 * prompt. That comparison carries a deliberate 15-second tolerance
 * (CONFLICT_SKEW_MS), because baselines mix client clocks with server timestamps
 * and a false conflict is a hard block, not just a nag. Its own comment states
 * the trade: "favor missing a sub-15s foreign write over nagging users whose
 * clock drifts."
 *
 * That trade is what loses data. Advisor and client edit together; the client's
 * write lands 3 seconds after the advisor's last save. The listener receives it
 * but HOLDS it rather than yanking text out from under a focused input. The
 * advisor's next save probes, finds the write only 3s past the baseline, decides
 * that is within tolerance, and overwrites it. The held event is then discarded
 * on save success. The client's field is gone with no prompt and no error.
 *
 * The fix is to stop asking the clock a question we can answer exactly. When the
 * listener is holding an event we are holding the other side's ACTUAL DOCUMENT in
 * memory. Comparing content needs no timestamps, no tolerance, and no extra
 * Firestore read: if the held document is merely our own write echoing back, there
 * is no conflict; if it differs, someone else really did change something and the
 * user must be asked before we overwrite it.
 *
 * Kept pure and separate because DataSync.tsx has no test coverage of its own and
 * this is the decision that must not be wrong in either direction: too eager and
 * every save nags, too lax and edits vanish silently.
 */
export function heldEventBlocksSave(opts: {
  /** The held foreign document, or null when the listener holds nothing. */
  heldData: unknown
  /** Its server timestamp, in ms. */
  heldUpdatedAt: number
  /** JSON of our last successfully-saved snapshot ('' = a restore is pending). */
  lastSavedJson: string
  /** High-water mark of remote events we already consumed. */
  lastRemoteApplied: number
}): boolean {
  const { heldData, heldUpdatedAt, lastSavedJson, lastRemoteApplied } = opts

  // Nothing held → nothing to protect against.
  if (heldData == null) return false

  // Already consumed: applied earlier, so it cannot be news. (Guard mirrors the
  // listener's own staleness check, so both paths agree on what is old.)
  if (heldUpdatedAt > 0 && heldUpdatedAt <= lastRemoteApplied) return false

  // '' means a local restore has not been pushed yet — we have no baseline
  // content to compare against, so we cannot claim a conflict. The timestamp
  // probe still covers this case; do not block on a comparison we cannot make.
  if (!lastSavedJson) return false

  // Our own write echoing back is the common case during any editing session,
  // and it is NOT a conflict. Cheap exact compare first (Firestore usually
  // preserves key order), then the canonical form, which is order-insensitive.
  if (JSON.stringify(heldData) === lastSavedJson) return false
  const canon = canonicalBaseline(lastSavedJson)
  // Unparseable baseline: treat the event as foreign. Better to ask than to
  // overwrite on the strength of a comparison that failed.
  if (canon === null) return true
  if (stableStringify(heldData) === canon) return false

  // Genuinely someone else's change, still unapplied, and we are about to
  // overwrite the document it lives in. Ask.
  return true
}
