import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock firebase chain so the test loads creditStore without real credentials.
// applyAiCategoryById fires-and-forgets to firestore via the (also-mocked)
// learnedDB write — both paths must return resolved promises.
vi.mock('@/lib/firebase', () => ({ auth: {}, db: {} }))
vi.mock('@/lib/firestoreService', () => ({
  saveLearnedEntry:    vi.fn().mockResolvedValue(undefined),
  loadSharedLearnedDB: vi.fn().mockResolvedValue({}),
}))

import { useCreditStore } from '@/stores/creditStore'
import type { Transaction } from '@/types/transaction'

function makeTxn(id: string, desc: string): Transaction {
  return {
    id, desc, amount: 100, originalAmount: null, category: 'שונות',
    source: 'test', notes: '', date: '2026-01-01',
    installment: null, isStandingOrder: false, isRefund: false,
  }
}

describe('applyAiCategoryById — stale-delete protection', () => {
  beforeEach(() => {
    useCreditStore.setState({
      transactions: [],
      uploadedFileNames: [],
      learnedDB: {},
      sharedLearnedDB: {},
      isLoading: false,
      loadingMessage: '',
    })
  })

  it('updates the transaction with the given id, not the one at a numeric index', () => {
    const store = useCreditStore.getState()
    store.setTransactions([
      makeTxn('a', 'shufersal'),
      makeTxn('b', 'paz'),
      makeTxn('c', 'aroma'),
    ], ['test.xlsx'])

    store.applyAiCategoryById('b', 'דלק וחניה')

    const txns = useCreditStore.getState().transactions
    expect(txns.find(t => t.id === 'b')?.category).toBe('דלק וחניה')
    expect(txns.find(t => t.id === 'a')?.category).toBe('שונות')
    expect(txns.find(t => t.id === 'c')?.category).toBe('שונות')
  })

  it('if a row was deleted mid-AI-run, applying the AI result is a silent no-op (no wrong row updated)', () => {
    const store = useCreditStore.getState()
    store.setTransactions([
      makeTxn('a', 'shufersal'),
      makeTxn('b', 'paz'),
      makeTxn('c', 'aroma'),
    ], ['test.xlsx'])

    // Capture batch refs (id-based) for later application
    const batchIds = useCreditStore.getState().transactions.map(t => t.id!)

    // User deletes index 0 ('a') while the AI is "thinking"
    store.deleteTransaction(0)
    expect(useCreditStore.getState().transactions.map(t => t.id)).toEqual(['b', 'c'])

    // AI returns. Apply category to id 'b' — must land on 'b' (paz), NOT on 'c'
    // which would be the wrong row if we used the original index 1.
    store.applyAiCategoryById(batchIds[1], 'דלק וחניה')
    expect(useCreditStore.getState().transactions.find(t => t.id === 'b')?.category).toBe('דלק וחניה')
    expect(useCreditStore.getState().transactions.find(t => t.id === 'c')?.category).toBe('שונות')

    // Trying to apply to the deleted id is a no-op — no throw, no wrong row touched.
    store.applyAiCategoryById(batchIds[0], 'מזון לבית')
    expect(useCreditStore.getState().transactions.find(t => t.id === 'b')?.category).toBe('דלק וחניה')
    expect(useCreditStore.getState().transactions.find(t => t.id === 'c')?.category).toBe('שונות')
  })

  it('learns the category into learnedDB so future uploads skip re-asking the AI', () => {
    const store = useCreditStore.getState()
    store.setTransactions([makeTxn('a', 'Cofix')], ['test.xlsx'])

    store.applyAiCategoryById('a', 'אוכל בחוץ ובילויים')

    const { learnedDB } = useCreditStore.getState()
    expect(Object.values(learnedDB)).toContain('אוכל בחוץ ובילויים')
  })
})
