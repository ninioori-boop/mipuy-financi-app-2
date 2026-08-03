import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'

/**
 * Behavioural coverage for the identity-switch teardown.
 *
 * Source-text assertions are not enough here, and that is not a hypothesis: a
 * grill proved that `if (false && needsIdentityTeardown({...}))` and an INVERTED
 * `if (!needsIdentityTeardown({...}))` both pass every string-matching test. The
 * second one is the catastrophe — it fires on a re-emit of the SAME user and
 * wipes their unsaved work. Only mounting the component catches either.
 */

const loadUserData = vi.fn()
const saveUserData = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/firestoreService', () => ({
  loadUserData:   (...a: unknown[]) => loadUserData(...a),
  saveUserData:   (...a: unknown[]) => saveUserData(...a),
  saveClientDataAsAdvisor: vi.fn().mockResolvedValue(undefined),
  loadSharedLearnedDB: vi.fn().mockResolvedValue({}),
  createVersion:  vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/firebase', () => ({ db: {}, auth: {} }))
vi.mock('firebase/firestore', () => ({ onSnapshot: () => () => {}, doc: () => ({}) }))
vi.mock('@/lib/creditSection', () => ({ saveCreditSection: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/hooks/useTransactionInbox', () => ({ useTransactionInbox: () => {} }))
vi.mock('@/hooks/useRecurringExpenses', () => ({ useRecurringExpenses: () => {} }))
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), dismiss: vi.fn(),
  }),
}))

import { DataSync } from '@/components/layout/DataSync'
import { useAuthStore } from '@/stores/authStore'
import { useSyncStore } from '@/stores/syncStore'
import { useMappingStore } from '@/stores/mappingStore'
import { resetAllStores } from '@/lib/dataSync'
import type { User } from 'firebase/auth'

const asUser = (uid: string) => ({ uid, email: `${uid}@x.com` } as User)

/** Person A's portfolio — recognisable, and nothing like a default store. */
const PORTFOLIO_A = { mapping: { varMonths: 9, creditScore: 811 } }

async function signIn(uid: string) {
  await act(async () => {
    useAuthStore.setState({ user: asUser(uid), loading: false })
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('DataSync — identity switch teardown', () => {
  beforeEach(() => {
    loadUserData.mockReset()
    saveUserData.mockClear()
    resetAllStores()
    useSyncStore.setState({ hydrated: false, isDirty: false })
    useAuthStore.setState({ user: null, loading: false })
    loadUserData.mockResolvedValue({ data: PORTFOLIO_A, updatedAt: 1_000 })
  })
  afterEach(() => cleanup())

  it('drops hydration and clears the previous person\'s data when someone else signs in', async () => {
    render(<DataSync><div /></DataSync>)

    await signIn('personA')
    expect(useSyncStore.getState().hydrated, 'A should be hydrated').toBe(true)
    expect(useMappingStore.getState().creditScore).toBe(811)

    // Person B signs in with NO sign-out between — what /connect actually does.
    loadUserData.mockReturnValue(new Promise(() => {}))   // B's load never settles
    await signIn('personB')

    // While B's data is in flight the app must not still be holding A's.
    expect(useSyncStore.getState().hydrated, 'hydrated must drop on a switch').toBe(false)
    expect(useMappingStore.getState().creditScore, "A's data must be gone").toBe(0)
    expect(useMappingStore.getState().varMonths).toBe(3)
  })

  it('never writes the previous person\'s portfolio into the new account', async () => {
    render(<DataSync><div /></DataSync>)
    await signIn('personA')

    loadUserData.mockReturnValue(new Promise(() => {}))
    await signIn('personB')

    // Let the 500ms backup mirror and the ~2s debounced save both come due.
    await act(async () => { await new Promise(r => setTimeout(r, 2_600)) })

    const wroteAsB = saveUserData.mock.calls.filter(c => c[0] === 'personB')
    expect(wroteAsB, 'nothing may be saved for B while their load is pending').toEqual([])
    const backup = localStorage.getItem('snapshot-backup:personB')
    expect(backup == null || !backup.includes('811'),
      "A's portfolio must never reach B's local backup").toBe(true)
  })

  // The mirror image, and the reason the guard is conditional rather than
  // unconditional. Firebase replays the current user to every new subscriber and
  // AuthProvider re-subscribes on each navigation, so a same-uid re-emit is
  // routine; tearing down there would destroy work the user is mid-way through.
  //
  // Asserted on `hydrated` and on "not reset to defaults", which is exactly what
  // the teardown controls. Note the re-emit here uses a NEW object to force the
  // effect to re-run at all — in production Firebase hands back the same
  // instance, so it does not. That re-run also re-applies the server snapshot
  // over local edits; that is pre-existing behaviour, unrelated to this guard,
  // which is why this test does not assert on the edited value.
  it('does NOT tear down when the SAME person is re-emitted', async () => {
    render(<DataSync><div /></DataSync>)
    await signIn('personA')

    useMappingStore.setState({ creditScore: 777 })
    await signIn('personA')

    expect(useSyncStore.getState().hydrated, 'must stay hydrated').toBe(true)
    // 0 would mean the teardown ran and wiped the stores; any other value means
    // it correctly did not.
    expect(useMappingStore.getState().creditScore, 'stores must not be reset').not.toBe(0)
  })
})
