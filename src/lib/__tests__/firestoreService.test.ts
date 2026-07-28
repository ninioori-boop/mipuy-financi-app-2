import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture the options passed to setDoc without touching Firestore.
const setDocSpy = vi.fn()
vi.mock('firebase/firestore', () => ({
  setDoc: (...args: unknown[]) => setDocSpy(...args),
  doc: (...path: unknown[]) => ({ path }),
  serverTimestamp: () => 'SERVER_TS',
  getDoc: vi.fn(), addDoc: vi.fn(), collection: vi.fn(), query: vi.fn(),
  orderBy: vi.fn(), limit: vi.fn(), getDocs: vi.fn(), deleteDoc: vi.fn(),
}))
vi.mock('../firebase', () => ({ db: {} }))

import { saveUserData, saveClientDataAsAdvisor } from '../firestoreService'

/**
 * Regression guard for a bug that shipped to production: with `{ merge: true }`
 * Firestore DEEP-MERGES nested maps, so a key the user deleted locally
 * (a category budget, a dismissed subscription, a removed recurring rule's
 * posted mark) was never removed from the doc and came back on the next load.
 * `mergeFields` replaces `data` as one field path while leaving sibling
 * top-level fields alone. Verified against the live backend on 2026-07-28.
 */
describe('snapshot writes must replace `data`, never deep-merge it', () => {
  beforeEach(() => setDocSpy.mockClear())

  it('saveUserData uses mergeFields, not merge', async () => {
    await saveUserData('u1', { categoryBudgets: { budgets: { fuel: 500 } } })
    const opts = setDocSpy.mock.calls[0][2]
    expect(opts).toEqual({ mergeFields: ['data', 'updatedAt'] })
    expect(opts).not.toHaveProperty('merge')
  })

  it('saveClientDataAsAdvisor uses mergeFields and still stamps the markers', async () => {
    await saveClientDataAsAdvisor('client1', { monthly: {} }, 'advisor1')
    const [, payload, opts] = setDocSpy.mock.calls[0]
    expect(opts).toEqual({
      mergeFields: ['data', 'updatedAt', 'lastAdvisorEditAt', 'lastAdvisorEditByUid'],
    })
    expect(opts).not.toHaveProperty('merge')
    // Every listed field must be present in the payload, or Firestore throws.
    for (const f of (opts as { mergeFields: string[] }).mergeFields) {
      expect(payload).toHaveProperty(f)
    }
    expect((payload as { lastAdvisorEditByUid: string }).lastAdvisorEditByUid).toBe('advisor1')
  })
})
