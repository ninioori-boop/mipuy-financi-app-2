import { describe, it, expect, beforeEach, vi } from 'vitest'

// Payment-rail one-time edits (Ori's call, 2026-07-29): a Bit transfer can be
// rent, lunch or a hobby even within ONE account, so editing a rail row's
// category must touch only that row and teach nothing — while ordinary
// merchants keep the bulk-apply + learn behavior.
vi.mock('@/lib/firebase', () => ({ auth: {}, db: {} }))
vi.mock('@/lib/firestoreService', () => ({
  saveLearnedEntry:    vi.fn().mockResolvedValue(undefined),
  loadSharedLearnedDB: vi.fn().mockResolvedValue({}),
}))

import { useCreditStore } from '@/stores/creditStore'
import { saveLearnedEntry } from '@/lib/firestoreService'
import type { Transaction } from '@/types/transaction'

function makeTxn(id: string, desc: string, category = 'ביט ללא מעקב'): Transaction {
  return {
    id, desc, amount: 100, originalAmount: null, category,
    source: 'test', notes: '', date: '2026-01-01',
    installment: null, isStandingOrder: false, isRefund: false,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useCreditStore.setState({
    transactions: [], uploadedFileNames: [],
    learnedDB: {}, sharedLearnedDB: {},
    isLoading: false, loadingMessage: '',
  })
})

describe('payment-rail one-time edits', () => {
  it('updateCategory on a Bit row changes ONLY that row and learns nothing', () => {
    const store = useCreditStore.getState()
    store.setTransactions([makeTxn('a', 'BIT'), makeTxn('b', 'BIT'), makeTxn('c', 'BIT')], ['t.xlsx'])

    store.updateCategory(1, 'אוכל בחוץ ובילויים')

    const txns = useCreditStore.getState().transactions
    expect(txns[0].category).toBe('ביט ללא מעקב')
    expect(txns[1].category).toBe('אוכל בחוץ ובילויים')
    expect(txns[2].category).toBe('ביט ללא מעקב')
    expect(useCreditStore.getState().learnedDB).toEqual({})
    expect(saveLearnedEntry).not.toHaveBeenCalled()
  })

  it('ordinary merchants keep bulk-apply + local learn + shared share', () => {
    const store = useCreditStore.getState()
    store.setTransactions([makeTxn('a', 'שופרסל דיל רמת גן', 'שונות'), makeTxn('b', 'שופרסל דיל רמת גן', 'שונות')], ['t.xlsx'])

    store.updateCategory(0, 'מזון לבית')

    const txns = useCreditStore.getState().transactions
    expect(txns[0].category).toBe('מזון לבית')
    expect(txns[1].category).toBe('מזון לבית')
    // normalizeForLookup strips the city — the learned key is the bare merchant.
    expect(useCreditStore.getState().learnedDB['שופרסל דיל']).toBe('מזון לבית')
    expect(saveLearnedEntry).toHaveBeenCalledWith('שופרסל דיל', 'מזון לבית')
  })

  it('learn() refuses rail descriptors outright (covers the expenses-page path)', () => {
    useCreditStore.getState().learn('העברה ב BIT בנה"פ', 'מתנות')
    expect(useCreditStore.getState().learnedDB).toEqual({})
    expect(saveLearnedEntry).not.toHaveBeenCalled()
  })

  it('applyAiCategoryById sets a rail row but does not remember it', () => {
    const store = useCreditStore.getState()
    store.setTransactions([makeTxn('a', 'משיכת מזומן', 'שונות')], ['t.xlsx'])

    store.applyAiCategoryById('a', 'אוכל בחוץ ובילויים')

    expect(useCreditStore.getState().transactions[0].category).toBe('אוכל בחוץ ובילויים')
    expect(useCreditStore.getState().learnedDB).toEqual({})
  })

  it('mergedLearnedDB drops rail keys from both dicts (neutralizes pre-guard pollution)', () => {
    useCreditStore.setState({
      learnedDB:       { bit: 'אוכל בחוץ ובילויים', 'שופרסל דיל': 'מזון לבית' },
      sharedLearnedDB: { 'העברה בביט': 'מתנות', 'וולט תל אביב': 'אוכל בחוץ ובילויים' },
    })
    const merged = useCreditStore.getState().mergedLearnedDB()
    expect(merged).toEqual({ 'שופרסל דיל': 'מזון לבית', 'וולט תל אביב': 'אוכל בחוץ ובילויים' })
  })
})
