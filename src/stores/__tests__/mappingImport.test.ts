import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the Firebase chain so creditStore (transitively pulled by mappingStore
// via the snapshot type) loads without real credentials.
vi.mock('@/lib/firebase', () => ({ auth: {}, db: {} }))
vi.mock('@/lib/firestoreService', () => ({
  saveLearnedEntry:    vi.fn().mockResolvedValue(undefined),
  loadSharedLearnedDB: vi.fn().mockResolvedValue({}),
}))

import { useMappingStore } from '@/stores/mappingStore'
import type { Transaction } from '@/types/transaction'

function makeTxn(desc: string, amount: number, category: string): Transaction {
  return {
    id: Math.random().toString(36).slice(2),
    desc, amount, originalAmount: null, category,
    source: 'test', notes: '', date: '2026-06-01',
    installment: null, isStandingOrder: false, isRefund: false,
  }
}

describe('importFromCredit — per-merchant rows for fixed / sub / ins', () => {
  beforeEach(() => {
    // Reset the persisted arrays. We can't easily blank everything (the store
    // has defaults), but importFromCredit's filter drops fromCredit:!fromBank
    // rows, so the assertions below only look at the rows we add.
    useMappingStore.setState({
      income: [], fixed: [], sub: [], ins: [], variable: [], annual: [],
      debts: [], installments: [], savings: [],
      varMonths: 1, creditImported: false, bufferPct: 0.4,
      incomeOverride: null, expensesOverride: null, creditScore: 0,
    })
  })

  it('splits three different sub-category merchants into three rows', () => {
    // Three subscription charges, all categorized as "תקשורת" (a SUB_CATEGORY).
    // The old behaviour created ONE row "תקשורת 153"; the new behaviour must
    // create THREE rows — one per merchant.
    const txns: Transaction[] = [
      makeTxn('Netflix',  50, 'תקשורת'),
      makeTxn('ChatGPT',  73, 'תקשורת'),
      makeTxn('Spotify',  30, 'תקשורת'),
    ]

    useMappingStore.getState().importFromCredit(txns, 1)

    const sub = useMappingStore.getState().sub
    const fromCreditSub = sub.filter(r => r.fromCredit && !r.fromBank)
    expect(fromCreditSub).toHaveLength(3)

    const names = fromCreditSub.map(r => r.name).sort()
    expect(names).toEqual(['ChatGPT', 'Netflix', 'Spotify'])

    expect(fromCreditSub.find(r => r.name === 'Netflix')!.amount).toBe(50)
    expect(fromCreditSub.find(r => r.name === 'ChatGPT')!.amount).toBe(73)
    expect(fromCreditSub.find(r => r.name === 'Spotify')!.amount).toBe(30)

    // No lumped "תקשורת" row exists — the old behaviour is gone
    expect(sub.find(r => r.fromCredit && !r.fromBank && r.name === 'תקשורת')).toBeUndefined()
  })

  it('merges different desc variants of the SAME merchant into one row', () => {
    // Three charges from the same merchant with variations that normalizeForLookup
    // actually collapses: case (NETFLIX vs Netflix), legal suffix (בע"מ), and a
    // trailing branch dash+number. They all share one bucket → one row.
    const txns: Transaction[] = [
      makeTxn('Netflix',          50, 'תקשורת'),
      makeTxn('NETFLIX',          50, 'תקשורת'),       // case-only diff
      makeTxn('Netflix - 12345',  50, 'תקשורת'),       // trailing branch code stripped
    ]

    useMappingStore.getState().importFromCredit(txns, 1)

    const sub = useMappingStore.getState().sub
    const merged = sub.filter(r => r.fromCredit && !r.fromBank)
    expect(merged).toHaveLength(1)
    expect(merged[0].amount).toBe(150)  // 50 + 50 + 50
  })

  it('variable section still aggregates by CATEGORY (per-merchant change does NOT apply there)', () => {
    const txns: Transaction[] = [
      makeTxn('שופרסל',  500, 'מזון לבית'),
      makeTxn('רמי לוי', 300, 'מזון לבית'),
      makeTxn('מגה',     200, 'מזון לבית'),
    ]

    useMappingStore.getState().importFromCredit(txns, 1)

    const variable = useMappingStore.getState().variable
    const fromCreditVar = variable.filter(r => r.fromCredit && !r.fromBank)
    // Variable section: ONE row per category, not per merchant
    expect(fromCreditVar).toHaveLength(1)
    expect(fromCreditVar[0].name).toBe('מזון לבית')
    expect(fromCreditVar[0].amount).toBe(1000) // 500 + 300 + 200
  })

  it('fixed section receives per-merchant rows divided by months', () => {
    // 3-month report with two fixed-cost merchants
    const txns: Transaction[] = [
      makeTxn('כללית', 540, 'קופת חולים'),  // 540 / 3 = 180 monthly
      makeTxn('מכבי',  279, 'קופת חולים'),  // 279 / 3 = 93 monthly
    ]

    useMappingStore.getState().importFromCredit(txns, 3)

    const fixed = useMappingStore.getState().fixed
    const fromCreditFixed = fixed.filter(r => r.fromCredit && !r.fromBank)
    expect(fromCreditFixed).toHaveLength(2)
    expect(fromCreditFixed.find(r => r.name === 'כללית')!.amount).toBe(180)
    expect(fromCreditFixed.find(r => r.name === 'מכבי')!.amount).toBe(93)
  })

  it('a manual (non-fromCredit) row in fixed/sub/ins is NOT touched by re-import', () => {
    // Pre-existing manual row the coach added by hand
    useMappingStore.setState(s => ({
      sub: [
        ...s.sub,
        { id: 'manual-1', name: 'Apple Music ידני', amount: 20 },
      ],
    }))

    const txns: Transaction[] = [makeTxn('Netflix', 50, 'תקשורת')]
    useMappingStore.getState().importFromCredit(txns, 1)

    const sub = useMappingStore.getState().sub
    const manualSurvives = sub.find(r => r.id === 'manual-1')
    expect(manualSurvives, 'manual row must survive credit re-import').toBeDefined()
    expect(manualSurvives!.amount).toBe(20)
    expect(manualSurvives!.fromCredit).toBeFalsy()

    // The new credit row also exists alongside
    expect(sub.find(r => r.fromCredit && r.name === 'Netflix')?.amount).toBe(50)
  })
})
