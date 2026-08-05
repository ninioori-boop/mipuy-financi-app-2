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
const saveClientDataAsAdvisor = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/firestoreService', () => ({
  loadUserData:   (...a: unknown[]) => loadUserData(...a),
  saveUserData:   (...a: unknown[]) => saveUserData(...a),
  saveClientDataAsAdvisor: (...a: unknown[]) => saveClientDataAsAdvisor(...a),
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
import { useImpersonationStore } from '@/stores/impersonationStore'
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

async function signOut() {
  await act(async () => {
    useAuthStore.setState({ user: null, loading: false })
    await Promise.resolve()
  })
}

const CLIENT = { uid: 'client1', name: 'לקוח', email: 'client1@x.com' }

function enterEditAsClient() {
  act(() => { useImpersonationStore.getState().start(CLIENT, 'edit', 500) })
}

describe('DataSync — identity switch teardown', () => {
  beforeEach(() => {
    loadUserData.mockReset()
    saveUserData.mockClear()
    saveClientDataAsAdvisor.mockClear()
    resetAllStores()
    useSyncStore.setState({ hydrated: false, isDirty: false })
    useAuthStore.setState({ user: null, loading: false })
    useImpersonationStore.setState({ client: null, mode: 'view', clientUpdatedAt: 0, startedAt: 0 })
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

describe('DataSync — act-as-client must not survive an identity boundary', () => {
  beforeEach(() => {
    loadUserData.mockReset()
    saveUserData.mockClear()
    saveClientDataAsAdvisor.mockClear()
    resetAllStores()
    useSyncStore.setState({ hydrated: false, isDirty: false })
    useAuthStore.setState({ user: null, loading: false })
    useImpersonationStore.setState({ client: null, mode: 'view', clientUpdatedAt: 0, startedAt: 0 })
    loadUserData.mockResolvedValue({ data: PORTFOLIO_A, updatedAt: 1_000 })
  })
  afterEach(() => cleanup())

  it('sign-out clears an active act-as-client session', async () => {
    render(<DataSync><div /></DataSync>)
    await signIn('advisor')
    enterEditAsClient()
    expect(useImpersonationStore.getState().client?.uid).toBe('client1')

    await signOut()

    expect(useImpersonationStore.getState().client,
      'the act-as-client flag must not survive sign-out').toBeNull()
  })

  it('a DIFFERENT person signing in directly clears an active act-as-client session', async () => {
    render(<DataSync><div /></DataSync>)
    await signIn('advisor')
    enterEditAsClient()

    // Direct switch, no null in between — the /connect path.
    loadUserData.mockReturnValue(new Promise(() => {}))
    await signIn('personB')

    expect(useImpersonationStore.getState().client,
      'the act-as-client flag must not survive an identity switch').toBeNull()
  })

  // The catastrophic inversion: Firebase re-emits the SAME advisor on every new
  // auth subscriber (navigation, token refresh). Clearing there would silently
  // kick the advisor out of act-as-client mid-work — and their next save, still
  // showing the client's data on screen, would write it into their OWN account.
  it('does NOT clear act-as-client when the same advisor is re-emitted', async () => {
    render(<DataSync><div /></DataSync>)
    await signIn('advisor')
    enterEditAsClient()

    await signIn('advisor')   // new object, same uid — forces the effect to re-run

    expect(useImpersonationStore.getState().client?.uid,
      'a same-uid re-emit must not exit act-as-client').toBe('client1')
    expect(useImpersonationStore.getState().mode).toBe('edit')
  })

  // The pre-existing race the grill spotted while verifying the fix above: the
  // advisor page is reachable before hydration, so act-as-client can begin while
  // the advisor's OWN load is still in flight. That load resolving late used to
  // apply the ADVISOR's portfolio over the client's snapshot — under an active
  // edit flag, the next save would write it into the client's document.
  it('a self-load resolving AFTER act-as-client entry must not clobber the client session', async () => {
    render(<DataSync><div /></DataSync>)
    let resolveLoad!: (v: { data: unknown; updatedAt: number }) => void
    loadUserData.mockReturnValue(new Promise(r => { resolveLoad = r }))
    await signIn('advisor')
    expect(useSyncStore.getState().hydrated, 'load must still be pending').toBe(false)

    // Mirrors editFullAccount: apply the client's snapshot, then raise the flag.
    act(() => {
      useMappingStore.setState({ creditScore: 555 })
      useImpersonationStore.getState().start(CLIENT, 'edit', 500)
    })

    await act(async () => {
      resolveLoad({ data: PORTFOLIO_A, updatedAt: 1_000 })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(useMappingStore.getState().creditScore,
      "the advisor's late-arriving portfolio must not replace the client's data").toBe(555)
    expect(useSyncStore.getState().hydrated,
      'the dropped result must not mark the session hydrated').toBe(false)
  })

  // The last remnant of this family (2026-08-05 audit): a DataSync REMOUNT
  // (ConsentGate renders a spinner INSTEAD of its children while re-checking
  // consent, so DataSync unmounts) resets the hydratedUid ref to ''. The
  // remounted instance's own load is then DISCARDED because act-as-client is
  // active — and before the fix that early-return skipped the hydratedUid
  // stamp, so a later direct sign-in by a different person compared '' vs
  // their uid, decided "nothing hydrated, nothing to tear down", and inherited
  // the advisor's act-as-client session — client portfolio on screen included.
  it('clears act-as-client for person B even after a remount discarded the advisor\'s load', async () => {
    const first = render(<DataSync><div /></DataSync>)
    await signIn('advisor')
    enterEditAsClient()

    // The ConsentGate flicker: DataSync unmounts and remounts mid-session.
    first.unmount()
    render(<DataSync><div /></DataSync>)
    // The remounted instance re-fires the advisor's own load; the result is
    // discarded because the impersonation flag is up.
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    // Direct switch, no null in between — the /connect path.
    loadUserData.mockReturnValue(new Promise(() => {}))
    await signIn('personB')

    expect(useImpersonationStore.getState().client,
      'a remount + discarded load must not disarm the identity teardown').toBeNull()
  })

  // Same hole through the ERROR branch: the remounted instance's own load
  // FAILS while act-as-client is active. The .catch guard also early-returns,
  // and without its hydratedUid stamp the teardown for the next person is
  // disarmed exactly as in the success-path test above.
  it('clears act-as-client for person B even after a remount load FAILED during impersonation', async () => {
    const first = render(<DataSync><div /></DataSync>)
    await signIn('advisor')
    enterEditAsClient()

    first.unmount()
    loadUserData.mockRejectedValue(new Error('offline'))
    render(<DataSync><div /></DataSync>)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    loadUserData.mockReturnValue(new Promise(() => {}))
    await signIn('personB')

    expect(useImpersonationStore.getState().client,
      'a remount + failed load must not disarm the identity teardown').toBeNull()
  })

  // The money test — the defect the grill reproduced, end to end: edit-as-client,
  // sign out, sign back in, make an edit. Before the fix the surviving flag made
  // saveTarget() redirect the advisor's OWN portfolio into the CLIENT's document.
  it('after sign-out and sign-in, a save targets the signed-in user, never the old client', async () => {
    render(<DataSync><div /></DataSync>)
    await signIn('advisor')
    enterEditAsClient()

    await signOut()
    await signIn('advisor')

    // A real post-hydration edit → the 2s debounced save comes due.
    act(() => { useMappingStore.setState({ creditScore: 123 }) })
    await act(async () => { await new Promise(r => setTimeout(r, 2_600)) })

    expect(saveClientDataAsAdvisor.mock.calls,
      "the advisor's own data must never be written to the client's document").toEqual([])
    const selfSaves = saveUserData.mock.calls.filter(c => c[0] === 'advisor')
    expect(selfSaves.length,
      'the save must reach the advisor\'s OWN document').toBeGreaterThan(0)
  })
})
