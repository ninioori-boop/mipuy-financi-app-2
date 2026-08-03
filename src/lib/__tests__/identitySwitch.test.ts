import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { needsIdentityTeardown } from '@/lib/identitySwitch'

describe('needsIdentityTeardown', () => {
  // THE BUG: a client signs in on /connect in the advisor's browser without the
  // advisor signing out first. Firebase emits user B with no null in between,
  // the stores still hold A's portfolio, and within ~2.5s it is written into B's
  // document.
  it('tears down when a different person signs in with no sign-out between', () => {
    expect(needsIdentityTeardown({ hydratedUid: 'advisorA', incomingUid: 'clientB' })).toBe(true)
  })

  it('does NOT tear down on the first sign-in of a session', () => {
    // Stores are already empty and `hydrated` is already false — tearing down
    // would make every session's first load do redundant work.
    expect(needsIdentityTeardown({ hydratedUid: '', incomingUid: 'advisorA' })).toBe(false)
  })

  it('does NOT tear down when the same person is re-emitted', () => {
    // Firebase replays the current user to new subscribers, and AuthProvider
    // re-subscribes on every navigation. Tearing down here would wipe the
    // user's own unsaved work on an ordinary page change.
    expect(needsIdentityTeardown({ hydratedUid: 'advisorA', incomingUid: 'advisorA' })).toBe(false)
  })

  it('leaves sign-out to the branch that already handles it', () => {
    expect(needsIdentityTeardown({ hydratedUid: 'advisorA', incomingUid: '' })).toBe(false)
  })

  it('handles a switch back to a previously-seen person', () => {
    expect(needsIdentityTeardown({ hydratedUid: 'clientB', incomingUid: 'advisorA' })).toBe(true)
  })
})

/**
 * The decision above is trivial; the WIRING is where this class of bug lives —
 * the previous rounds shipped a fix that was individually correct and inert, and
 * a guard that was correct but never called on exit. So assert the call site.
 */
describe('needsIdentityTeardown — wiring in DataSync', () => {
  const SRC = readFileSync(join(process.cwd(), 'src/components/layout/DataSync.tsx'), 'utf8')

  it('is called, and its teardown clears the four things the old branch missed', () => {
    const at = SRC.indexOf('needsIdentityTeardown({')
    expect(at, 'needsIdentityTeardown is never called').toBeGreaterThan(-1)
    const block = SRC.slice(at, at + 1600)
    // The refs the signed-in branch already reset are not the problem. These are.
    expect(block, 'stores must be cleared').toContain('resetAllStores()')
    expect(block, 'ephemeral stores must be cleared').toContain('resetSessionStores()')
    expect(block, 'hydrated must drop so a failed load blocks the UI').toContain('setHydrated(false)')
    expect(block, "the previous person's saved-snapshot marker must be cleared")
      .toMatch(/lastSavedJson\.current\s*=\s*''/)
  })

  it('runs BEFORE the load, so no save can fire against stale state', () => {
    const teardownAt = SRC.indexOf('needsIdentityTeardown({')
    const loadAt = SRC.indexOf('loadUserData(user.uid)')
    expect(teardownAt).toBeGreaterThan(-1)
    expect(loadAt).toBeGreaterThan(-1)
    expect(teardownAt).toBeLessThan(loadAt)
  })

  it('records the hydrated uid where hydration completes, and clears it on sign-out', () => {
    // Without both halves the guard silently never fires: an unset marker means
    // needsIdentityTeardown always sees '' and returns false.
    expect(SRC).toMatch(/hydratedUid\.current\s*=\s*user\.uid/)
    expect(SRC).toMatch(/hydratedUid\.current\s*=\s*''/)
  })
})
