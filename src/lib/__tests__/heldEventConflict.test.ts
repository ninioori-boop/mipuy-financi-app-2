import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { heldEventBlocksSave } from '@/lib/heldEventConflict'

const saved = { mapping: { income: [{ id: 'a', amount: 100 }] }, monthly: {} }
const savedJson = JSON.stringify(saved)

const base = {
  heldUpdatedAt: 5_000,
  lastSavedJson: savedJson,
  lastRemoteApplied: 0,
}

describe('heldEventBlocksSave', () => {
  it('does not block when the listener holds nothing', () => {
    expect(heldEventBlocksSave({ ...base, heldData: null })).toBe(false)
  })

  // THE BUG. The client's write landed 3s after the advisor's last save — well
  // inside the 15s skew tolerance the timestamp probe allows — so the probe waved
  // the advisor's overwrite through and the client's field vanished silently.
  // Content comparison has no tolerance to hide behind.
  it('BLOCKS when the held document differs from our last save', () => {
    const foreign = { ...saved, mapping: { income: [{ id: 'a', amount: 100 }, { id: 'b', amount: 55 }] } }
    expect(heldEventBlocksSave({ ...base, heldData: foreign })).toBe(true)
  })

  it('blocks regardless of how recent the foreign write is (no skew window)', () => {
    const foreign = { ...saved, monthly: { '2026-08': { spent: 1 } } }
    for (const ts of [1, 500, 3_000, 14_999, 60_000]) {
      expect(heldEventBlocksSave({ ...base, heldData: foreign, heldUpdatedAt: ts }),
        `a foreign write at t=${ts}ms must still block`).toBe(true)
    }
  })

  // The common case in ANY editing session: our own save comes back through the
  // listener. Treating that as a conflict would nag on every single save.
  it('does NOT block on our own write echoing back', () => {
    expect(heldEventBlocksSave({ ...base, heldData: saved })).toBe(false)
  })

  it('does NOT block on our own echo with reordered keys', () => {
    // Firestore usually preserves key order, but not by contract — the canonical
    // comparison is what makes the echo test reliable.
    const reordered = { monthly: {}, mapping: { income: [{ amount: 100, id: 'a' }] } }
    expect(JSON.stringify(reordered)).not.toBe(savedJson)      // the cheap compare misses it
    expect(heldEventBlocksSave({ ...base, heldData: reordered })).toBe(false)
  })

  it('does not block on an event we already applied', () => {
    const foreign = { ...saved, monthly: { x: 1 } }
    expect(heldEventBlocksSave({
      ...base, heldData: foreign, heldUpdatedAt: 4_000, lastRemoteApplied: 9_000,
    })).toBe(false)
  })

  // The `<=` boundary is load-bearing, and mutation testing showed `<` passed
  // every other test. It matters on the FIRST save of a session: lastRemoteApplied
  // is seeded from the loaded doc's updatedAt, and the listener's attach event
  // carries that SAME timestamp but the RAW stored document — which differs from
  // our normalized baseline, because applySnapshot injects defaults. With `<`
  // that equal-timestamp attach event reads as a conflict and blocks the user's
  // very first save while they type.
  it('treats an event with updatedAt EQUAL to the high-water mark as consumed', () => {
    const rawStoredDoc = { ...saved, monthly: { '2026-08': {} } }   // pre-normalization
    expect(heldEventBlocksSave({
      ...base, heldData: rawStoredDoc, heldUpdatedAt: 7_000, lastRemoteApplied: 7_000,
    })).toBe(false)
  })

  it('does not block when there is no baseline to compare against', () => {
    // '' = a local restore is waiting to be pushed. No content baseline exists,
    // so no conflict can be claimed; the timestamp probe still covers this.
    const foreign = { ...saved, monthly: { x: 1 } }
    expect(heldEventBlocksSave({ ...base, heldData: foreign, lastSavedJson: '' })).toBe(false)
  })

  it('blocks rather than overwrites when the baseline cannot be parsed', () => {
    const foreign = { ...saved, monthly: { x: 1 } }
    expect(heldEventBlocksSave({ ...base, heldData: foreign, lastSavedJson: '{not json' })).toBe(true)
  })

  it('array ORDER still counts as a difference — reordering rows is a real edit', () => {
    const reorderedRows = { ...saved, mapping: { income: [{ id: 'b', amount: 55 }, { id: 'a', amount: 100 }] } }
    expect(heldEventBlocksSave({ ...base, heldData: reorderedRows })).toBe(true)
  })
})

/**
 * A correct predicate wired backwards passes every test above. These assert the
 * CALL SITE, because DataSync.tsx has no runtime coverage and the previous round
 * shipped a fix that was individually correct and collectively inert.
 */
describe('heldEventBlocksSave — wiring in DataSync', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/components/layout/DataSync.tsx'), 'utf8')
  // Slice from probeBeforeWrite to whichever declaration follows it, so moving
  // openConflictChoice above probeBeforeWrite (a legitimate refactor) does not
  // silently yield an empty string and fail these tests for the wrong reason.
  const start = SRC.indexOf('const probeBeforeWrite')
  const after = SRC.indexOf('\n  const ', start + 10)
  const probeFn = SRC.slice(start, after > start ? after : undefined)

  it('the slice actually found the function (guards the guard)', () => {
    expect(start).toBeGreaterThan(-1)
    expect(probeFn).toContain("return 'proceed'")
    expect(probeFn.length).toBeGreaterThan(200)
  })

  it('blocks (not proceeds) when the predicate says so', () => {
    // Everything between the guard and the throttle line IS the guard's block —
    // a stable boundary that survives adding fields or comments to the call.
    const guardBlock = probeFn.slice(
      probeFn.indexOf('heldEventBlocksSave'),
      probeFn.indexOf('PROBE_MIN_INTERVAL_MS'),
    )
    expect(probeFn).not.toMatch(/!\s*heldEventBlocksSave/)
    expect(guardBlock).toContain("return 'blocked'")
    expect(guardBlock).toContain('openConflictChoice')
  })

  it('runs BEFORE the timestamp throttle — the throttle would skip the probe entirely', () => {
    const guardAt = probeFn.indexOf('heldEventBlocksSave')
    const throttleAt = probeFn.indexOf('PROBE_MIN_INTERVAL_MS')
    expect(guardAt).toBeGreaterThan(-1)
    expect(throttleAt).toBeGreaterThan(-1)
    expect(guardAt).toBeLessThan(throttleAt)
  })

  it('still honours explicit "save anyway" consent before anything else', () => {
    // skipOnce is the user overriding a prompt they already saw; the content
    // guard must not re-block them into a loop.
    const skipAt = probeFn.indexOf('opts.skipOnce')
    expect(skipAt).toBeGreaterThan(-1)
    expect(skipAt).toBeLessThan(probeFn.indexOf('heldEventBlocksSave'))
  })
})
