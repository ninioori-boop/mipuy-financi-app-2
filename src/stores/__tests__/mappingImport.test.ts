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
      makeTxn('Netflix',  50, 'חדר כושר'),
      makeTxn('ChatGPT',  73, 'חדר כושר'),
      makeTxn('Spotify',  30, 'חדר כושר'),
    ]
    useMappingStore.getState().importFromCredit(txns, 1)

    const sub = useMappingStore.getState().sub
    const fromCredit = sub.filter(r => r.fromCredit && !r.fromBank)
    expect(fromCredit).toHaveLength(1)
    expect(fromCredit[0].name).toBe('חדר כושר')
    expect(fromCredit[0].amount).toBe(153)
  })

  it('refunds are NEVER added to a category total (locking regression for credit + import)', () => {
    // 300 of real spend in מזון לבית, plus a 100 refund tagged to the same
    // category. The mapping row must reflect 300 — refunds should not be
    // summed in as expenses, nor subtracted as if they reduced the expense.
    // (CategoryBreakdown / import sendToBudget / mappingStore all skip refunds
    // entirely so the breakdown matches the mapping.)
    const refund: Transaction = { ...makeTxn('החזר Shufersal', 100, 'מזון לבית'), isRefund: true }
    const txns: Transaction[] = [
      makeTxn('Shufersal', 200, 'מזון לבית'),
      makeTxn('Rami Levi', 100, 'מזון לבית'),
      refund,
    ]
    useMappingStore.getState().importFromCredit(txns, 1)

    const variable = useMappingStore.getState().variable
    const fromCredit = variable.filter(r => r.fromCredit && !r.fromBank)
    expect(fromCredit).toHaveLength(1)
    expect(fromCredit[0].name).toBe('מזון לבית')
    expect(fromCredit[0].amount).toBe(300)   // 200 + 100, refund excluded entirely
  })
})

describe('importFromBank — subtractFrom carves a merchant out of its source category', () => {
  beforeEach(resetMapping)

  it('Cellcom example: תקשורת 1400 → 500 after sending Cellcom (3×300) to subs', () => {
    // Seed an existing category row to mimic the post-credit-import state
    useMappingStore.setState(s => ({
      sub: [...s.sub, {
        id: 'cat-row',
        name: 'חדר כושר',
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
      subtractFrom: { category: 'חדר כושר', amount: 900 }, // 300 × 3 removed from source
    }])

    const sub = useMappingStore.getState().sub
    const tikshoret = sub.find(r => r.name === 'חדר כושר')
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
        name: 'חדר כושר',
        amount: 500,
        fromCredit: true,
      }],
    }))

    useMappingStore.getState().importFromBank([{
      name: 'אינטרנט ביתי',
      amount: 100,
      section: 'fixed',
      subtractFrom: { category: 'חדר כושר', amount: 300 },
    }])

    const sub   = useMappingStore.getState().sub
    const fixed = useMappingStore.getState().fixed
    expect(sub.find(r => r.name === 'חדר כושר')!.amount).toBe(200)    // 500 - 300
    expect(fixed.find(r => r.name === 'אינטרנט ביתי')!.amount).toBe(100)
  })

  it('removes the source row entirely when the subtraction would zero it out', () => {
    useMappingStore.setState(s => ({
      sub: [...s.sub, {
        id: 'cat-row',
        name: 'חדר כושר',
        amount: 300,
        fromCredit: true,
      }],
    }))

    useMappingStore.getState().importFromBank([{
      name: 'סלקום',
      amount: 300,
      section: 'sub',
      subtractFrom: { category: 'חדר כושר', amount: 300 },   // exactly equal — wipes the row
    }])

    const sub = useMappingStore.getState().sub
    expect(sub.find(r => r.name === 'חדר כושר'), 'category row gone after full carve-out').toBeUndefined()
    expect(sub.find(r => r.name === 'סלקום')!.amount).toBe(300)
  })

  it('subtractFrom is a silent no-op when no matching category row exists', () => {
    // mapping.sub starts empty — no תקשורת row to subtract from
    useMappingStore.getState().importFromBank([{
      name: 'סלקום',
      amount: 300,
      section: 'sub',
      subtractFrom: { category: 'חדר כושר', amount: 900 },
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

  it('3-month report: subtractFrom scales the raw period total to monthly avg for sub/fixed/ins', () => {
    // Real-world scenario: user uploaded a 3-month credit report. importFromCredit
    // stored the אופנה sub category as monthly avg (period total / 3). When
    // SmartPatterns sends Netflix (3 × 50 = 150 period total) it must scale
    // that 150 → 50/mo to hit the row at the right magnitude. Without the fix
    // 100/mo - 150 = -50 → the whole row gets deleted, wiping Spotify too.
    useMappingStore.setState({
      varMonths: 3,
      sub: [{ id: 'cat-row', name: 'חדר כושר', amount: 100, fromCredit: true }],
    })

    useMappingStore.getState().importFromBank([{
      name: 'Netflix',
      amount: 50,                                              // monthly cost basis for the new row
      section: 'sub',
      subtractFrom: { category: 'חדר כושר', amount: 150 },      // period-total for the source
    }])

    const sub = useMappingStore.getState().sub
    const gym = sub.find(r => r.name === 'חדר כושר')
    expect(gym, 'gym row must survive — Netflix is only PART of the category').toBeDefined()
    expect(gym!.amount).toBe(50)                               // 100/mo - (150/3)=50 → 50/mo remaining
  })

  it('variable section keeps raw period totals: subtractFrom does NOT scale', () => {
    // Sanity check on the sibling case: variable rows store raw period totals
    // (VariablePanel displays ÷months for the monthly view), so subtractFrom
    // must NOT divide there. Fix must ONLY scale fixed/sub/ins.
    useMappingStore.setState({
      varMonths: 3,
      variable: [{ id: 'v-row', name: 'מזון לבית', amount: 1500, fromCredit: true }],
    })

    useMappingStore.getState().importFromBank([{
      name: 'Shufersal',
      amount: 200,
      section: 'variable',
      subtractFrom: { category: 'מזון לבית', amount: 600 },   // raw period total, not per-month
    }])

    const v = useMappingStore.getState().variable
    const food = v.find(r => r.name === 'מזון לבית')
    expect(food, 'food row must survive').toBeDefined()
    expect(food!.amount).toBe(900)                             // 1500 - 600 = 900 raw
  })
})

describe('importFromCredit — excludes merchants already carved out into their own rows', () => {
  beforeEach(resetMapping)

  it('re-running credit import after a SmartPatterns carve-out does NOT double-count', () => {
    // Step 1: user carved Netflix out via SmartPatterns → its own fromBank row.
    useMappingStore.setState({
      varMonths: 1,
      sub: [{ id: 'netflix', name: 'Netflix', amount: 50, fromCredit: true, fromBank: true }],
    })

    // Step 2: user re-runs "🗂️ עדכן מיפוי" (importFromCredit) with fresh txns
    // that INCLUDE the Netflix charges the carve-out was based on.
    const txns: Transaction[] = [
      makeTxn('Netflix',  50, 'חדר כושר'),
      makeTxn('Spotify',  30, 'חדר כושר'),
      makeTxn('ChatGPT',  73, 'חדר כושר'),
    ]
    useMappingStore.getState().importFromCredit(txns, 1)

    // Netflix's own row must survive AND the aggregated חדר כושר row must
    // EXCLUDE Netflix's 50 (otherwise Netflix is counted twice: once in its
    // own row and once inside the aggregated total).
    const sub = useMappingStore.getState().sub
    const netflix = sub.find(r => r.name === 'Netflix')
    const gym     = sub.find(r => r.name === 'חדר כושר')
    expect(netflix, 'carved-out Netflix row must survive re-import').toBeDefined()
    expect(netflix!.amount).toBe(50)
    expect(gym,     'aggregated חדר כושר row must be re-created').toBeDefined()
    expect(gym!.amount).toBe(103)                              // Spotify 30 + ChatGPT 73, Netflix excluded
  })
})
