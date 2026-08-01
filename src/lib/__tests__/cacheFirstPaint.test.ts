import { describe, it, expect, beforeEach, vi } from 'vitest'

// The stores reach Firestore through firestoreService; neither is exercised here.
vi.mock('@/lib/firebase', () => ({ auth: {}, db: {} }))
vi.mock('@/lib/firestoreService', () => ({
  saveLearnedEntry:    vi.fn().mockResolvedValue(undefined),
  loadSharedLearnedDB: vi.fn().mockResolvedValue({}),
}))

import { collectSnapshot, applySnapshot, resetAllStores, isUsableSnapshot, SCHEMA_VERSION } from '@/lib/dataSync'
import { useCreditStore } from '@/stores/creditStore'
import { useSyncStore } from '@/stores/syncStore'

beforeEach(() => {
  resetAllStores()
  useSyncStore.setState({ hydrated: false, painted: false })
})

describe('isUsableSnapshot — what may be painted before the server answers', () => {
  it('accepts a snapshot of the current schema', () => {
    expect(isUsableSnapshot(collectSnapshot())).toBe(true)
  })

  it('rejects another schema version, non-objects and null', () => {
    expect(isUsableSnapshot({ ...collectSnapshot(), version: SCHEMA_VERSION + 1 })).toBe(false)
    expect(isUsableSnapshot({ meetings: [] })).toBe(false)   // no version at all
    expect(isUsableSnapshot('not an object')).toBe(false)
    expect(isUsableSnapshot(null)).toBe(false)
    expect(isUsableSnapshot(undefined)).toBe(false)
  })
})

// These prove the SEMANTICS the load path depends on: applySnapshot MERGES, so
// a key the server lacks keeps whatever is already in the store. Painting a
// cache and then applying the server copy without resetAllStores() leaves
// cache∪server, and DataSync records that union as `lastSavedJson` = "what the
// server has". Every anti-clobber guard then agrees we are clean, and the first
// edit pushes rows the user deleted elsewhere back to Firestore.
//
// ⚠️ HONEST LIMIT (grill, 2026-08-01): these call resetAllStores() in the test
// body. They do NOT execute DataSync.tsx, so deleting the reset from the real
// load path would leave them green. No test in this repo mounts DataSync — it
// needs auth, Firestore and timers. The load path is covered by adversarial
// review and manual verification, not by this file. Do not read a green run
// here as proof that the wiring is right.
describe('cache-first paint: the server copy must REPLACE the cache, not merge', () => {
  // A cache holding a meeting the user has since deleted on another device.
  const cache = () => ({
    ...collectSnapshot(),
    meetings: { meetings: [{ id: 'from-cache', date: '2026-01-01', title: 'נמחקה במכשיר אחר', notes: '', tasks: [] }] },
  })
  // A server document written before the section existed — so the key is ABSENT,
  // which is exactly when applySnapshot's merge keeps whatever is already there.
  const serverWithoutMeetings = () => {
    const s = { ...collectSnapshot() } as Record<string, unknown>
    delete s.meetings
    return s
  }

  it('without a reset the cache survives — this is the bug being prevented', () => {
    applySnapshot(cache())
    applySnapshot(serverWithoutMeetings())
    // Documents the merge semantics that make the reset necessary.
    expect(collectSnapshot().meetings.meetings).toHaveLength(1)
  })

  it('WITH the reset the stores match the server exactly', () => {
    applySnapshot(cache())
    expect(collectSnapshot().meetings.meetings).toHaveLength(1)   // painted

    const server = serverWithoutMeetings()
    resetAllStores()          // ← the fix, mirroring DataSync's load path
    applySnapshot(server)

    expect(collectSnapshot().meetings.meetings).toHaveLength(0)
  })

  it('sharedLearnedDB survives the reset when preserved as applyRemote does', () => {
    useCreditStore.setState({ sharedLearnedDB: { 'שופרסל דיל': 'מזון לבית' } })
    applySnapshot(cache())

    const shared = useCreditStore.getState().sharedLearnedDB
    resetAllStores()
    applySnapshot(collectSnapshot())
    if (shared && Object.keys(shared).length) useCreditStore.setState({ sharedLearnedDB: shared })

    expect(useCreditStore.getState().sharedLearnedDB).toEqual({ 'שופרסל דיל': 'מזון לבית' })
  })

  it('resetAllStores does NOT clear the sync flags (they are not data)', () => {
    useSyncStore.setState({ hydrated: true, painted: true })
    resetAllStores()
    expect(useSyncStore.getState().hydrated).toBe(true)
    expect(useSyncStore.getState().painted).toBe(true)
  })
})
