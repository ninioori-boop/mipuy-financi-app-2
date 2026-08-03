import { describe, it, expect, beforeEach, vi } from 'vitest'

// Same mocks the sibling dataSync test uses: the store chain reaches Firebase via
// creditStore → firestoreService, and these assertions are pure in-memory state.
vi.mock('@/lib/firebase', () => ({ auth: {}, db: {} }))
vi.mock('@/lib/firestoreService', () => ({
  saveLearnedEntry:    vi.fn().mockResolvedValue(undefined),
  loadSharedLearnedDB: vi.fn().mockResolvedValue({}),
}))

import { resetAllStores, resetSessionStores, collectSnapshot, applySnapshot } from '@/lib/dataSync'
import { useBankStore } from '@/stores/bankStore'
import { useAutoMapStore, AUTOMAP_STORAGE_KEY } from '@/stores/autoMapStore'
import { useMappingStore } from '@/stores/mappingStore'

/**
 * The advisor→client leak, and the regression that a naive fix would have caused.
 *
 * Entering view/edit-as-client is an SPA navigation, so module-level zustand
 * state survives it. bankStore and autoMapStore were in neither the snapshot nor
 * resetAllStores(), so the advisor's own uploaded statement stayed on screen
 * under the client's name — and "send to section" pushed the advisor's own
 * transactions into the client's mapping.
 */
describe('resetSessionStores — the cross-client leak', () => {
  beforeEach(() => {
    resetAllStores()
    resetSessionStores()
  })

  it('clears an uploaded bank statement, which resetAllStores does not', () => {
    useBankStore.getState().setData([['ADVISOR ROW', 100]], 'my-own-statement.xlsx')
    useBankStore.getState().markSent(0)

    // Snapshot reset alone leaves it behind — this is precisely the bug.
    resetAllStores()
    expect(useBankStore.getState().fileName).toBe('my-own-statement.xlsx')

    resetSessionStores()
    expect(useBankStore.getState().rawRows).toEqual([])
    expect(useBankStore.getState().fileName).toBe('')
    expect(useBankStore.getState().sentRows).toEqual([])
    expect(useBankStore.getState().reportMonths).toBe(1)
  })

  it('clears the live auto-map lab session', () => {
    useAutoMapStore.setState({
      contextText: 'הכנסה 25,000, משכנתא 4,800, חיסכון…',
      result: { sections: [] } as never,
    })

    resetSessionStores()

    expect(useAutoMapStore.getState().contextText).toBe('')
    expect(useAutoMapStore.getState().result).toBeNull()
  })

  // The archive is the advisor's own work, localStorage is its ONLY copy (it is
  // in neither the snapshot nor the cloud backup), and deleting a single draft
  // asks for confirmation in the UI. Wiping it on every sign-out and every
  // "view as client" would be silent, permanent, everyday data loss.
  it('PRESERVES saved drafts — they are a durable archive, not session scratch', () => {
    const draft = { id: 'd1', name: 'יוסי כהן - יוני 2026', contextText: 'x', reportMonths: 1, result: null, at: 1 }
    useAutoMapStore.setState({ drafts: [draft] as never })

    resetSessionStores()

    expect(useAutoMapStore.getState().drafts).toHaveLength(1)
    expect(localStorage.getItem(AUTOMAP_STORAGE_KEY)).not.toBeNull()
  })

  // Account deletion is the one boundary that promises to leave nothing behind.
  it('purges the archive and its storage key ONLY when asked (account deletion)', () => {
    useAutoMapStore.setState({ drafts: [{ id: 'd1', name: 'x' }] as never })
    localStorage.setItem(AUTOMAP_STORAGE_KEY, JSON.stringify({ state: { drafts: [] } }))

    resetSessionStores({ purgeArchive: true })

    expect(useAutoMapStore.getState().drafts).toEqual([])
    expect(localStorage.getItem(AUTOMAP_STORAGE_KEY)).toBeNull()
  })

  it('leaves snapshot data alone — the two resets have separate jobs', () => {
    useMappingStore.setState({ varMonths: 7, creditScore: 720 })

    resetSessionStores()

    expect(useMappingStore.getState().varMonths).toBe(7)
    expect(useMappingStore.getState().creditScore).toBe(720)
  })

  // The regression a naive fix causes: folding these stores into resetAllStores
  // would clear them on every live-sync event too, because applyRemote() calls
  // resetAllStores() + applySnapshot() within ONE identity. A user reviewing a
  // bank statement would watch it vanish the moment the other side saved.
  it('a snapshot round-trip (what live sync does) does NOT touch the bank tab', () => {
    useBankStore.getState().setData([['MID-REVIEW ROW', 250]], 'in-progress.xlsx')
    const remote = collectSnapshot()

    resetAllStores()
    applySnapshot(remote)

    expect(useBankStore.getState().fileName).toBe('in-progress.xlsx')
    expect(useBankStore.getState().rawRows).toHaveLength(1)
  })
})
