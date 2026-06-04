import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the Firebase chain so the store loads without real credentials.
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

function resetMapping() {
  useMappingStore.setState({
    income: [], fixed: [], sub: [], ins: [], variable: [], annual: [],
    debts: [], installments: [], savings: [],
    varMonths: 1, creditImported: false, bufferPct: 0.4,
    incomeOverride: null, expensesOverride: null, creditScore: 0,
  })
}

describe('importFromCredit — one row per category (no per-merchant split)', () => {
  beforeEach(resetMapping)

  it('subscription-category transactions aggregate into a SINGLE category row', () => {
    // Three different merchants, same category. The mapping must show one
    // consolidated row "תקשורת 153" — splitting happens manually via
    // SmartPatterns, not automatically here.
    const txns: Transaction[] = [
      makeTxn('Netflix',  50, 'תקשורת'),
      makeTxn('ChatGPT',  73, 'תקשורת'),
      makeTxn('Spotify',  30, 'תקשורת'),
    ]
    useMappingStore.getState().importFromCredit(txns, 1)

    const sub = useMappingStore.getState().sub
    const fromCredit = sub.filter(r => r.fromCredit && !r.fromBank)
    expect(fromCredit).toHaveLength(1)
    expect(fromCredit[0].name).toBe('תקשורת')
    expect(fromCredit[0].amount).toBe(153)
  })
})

describe('importFromBank — subtractFrom carves a merchant out of its source category', () => {
  beforeEach(resetMapping)

  it('Cellcom example: תקשורת 1400 → 500 after sending Cellcom (3×300) to subs', () => {
    // Seed an existing category row to mimic the post-credit-import state
    useMappingStore.setState(s => ({
      sub: [...s.sub, {
        id: 'cat-row',
        name: 'תקשורת',
        amount: 1400,
        fromCredit: true,
      }],
    }))

    // User clicks "→ מנויים" on Cellcom in SmartPatterns (single charge 300,
    // appears 3 times = 900 historical contribution to תקשורת).
    useMappingStore.getState().importFromBank([{
      name: 'סלקום',
      amount: 300,             // monthly cost-basis added to subs
      section: 'sub',
      subtractFrom: { category: 'תקשורת', amount: 900 }, // 300 × 3 removed from source
    }])

    const sub = useMappingStore.getState().sub
    const tikshoret = sub.find(r => r.name === 'תקשורת')
    const cellcom   = sub.find(r => r.name === 'סלקום')
    expect(tikshoret, 'תקשורת row must still exist with the reduced amount').toBeDefined()
    expect(tikshoret!.amount).toBe(500)                  // 1400 - 900 = 500
    expect(cellcom, 'Cellcom must be added as its own row').toBeDefined()
    expect(cellcom!.amount).toBe(300)
    expect(cellcom!.fromBank).toBe(true)                 // protected from credit re-imports
  })

  it('cross-section subtract: sending a sub-category item to fixed reduces the sub row, adds a fixed row', () => {
    useMappingStore.setState(s => ({
      sub: [...s.sub, {
        id: 'sub-cat-row',
        name: 'תקשורת',
        amount: 500,
        fromCredit: true,
      }],
    }))

    useMappingStore.getState().importFromBank([{
      name: 'אינטרנט ביתי',
      amount: 100,
      section: 'fixed',
      subtractFrom: { category: 'תקשורת', amount: 300 },
    }])

    const sub   = useMappingStore.getState().sub
    const fixed = useMappingStore.getState().fixed
    expect(sub.find(r => r.name === 'תקשורת')!.amount).toBe(200)    // 500 - 300
    expect(fixed.find(r => r.name === 'אינטרנט ביתי')!.amount).toBe(100)
  })

  it('removes the source row entirely when the subtraction would zero it out', () => {
    useMappingStore.setState(s => ({
      sub: [...s.sub, {
        id: 'cat-row',
        name: 'תקשורת',
        amount: 300,
        fromCredit: true,
      }],
    }))

    useMappingStore.getState().importFromBank([{
      name: 'סלקום',
      amount: 300,
      section: 'sub',
      subtractFrom: { category: 'תקשורת', amount: 300 },   // exactly equal — wipes the row
    }])

    const sub = useMappingStore.getState().sub
    expect(sub.find(r => r.name === 'תקשורת'), 'category row gone after full carve-out').toBeUndefined()
    expect(sub.find(r => r.name === 'סלקום')!.amount).toBe(300)
  })

  it('subtractFrom is a silent no-op when no matching category row exists', () => {
    // mapping.sub starts empty — no תקשורת row to subtract from
    useMappingStore.getState().importFromBank([{
      name: 'סלקום',
      amount: 300,
      section: 'sub',
      subtractFrom: { category: 'תקשורת', amount: 900 },
    }])

    const sub = useMappingStore.getState().sub
    expect(sub.filter(r => r.name === 'סלקום')).toHaveLength(1)
    // No row was created or destroyed — just the new Cellcom row exists
    expect(sub.filter(r => r.fromBank).length).toBe(1)
  })

  it('rows without subtractFrom behave like a plain add (bank-tab flow unchanged)', () => {
    useMappingStore.getState().importFromBank([
      { name: 'Netflix', amount: 50, section: 'sub' },
      { name: 'משכנתא',   amount: 4500, section: 'fixed' },
    ])

    expect(useMappingStore.getState().sub.find(r => r.name === 'Netflix')!.amount).toBe(50)
    expect(useMappingStore.getState().fixed.find(r => r.name === 'משכנתא')!.amount).toBe(4500)
  })
})
