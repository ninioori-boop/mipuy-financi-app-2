import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the Firebase module chain so the test runs without real Firebase credentials.
// The round-trip test only exercises pure in-memory store logic; it never touches the network.
vi.mock('@/lib/firebase', () => ({ auth: {}, db: {} }))
vi.mock('@/lib/firestoreService', () => ({
  saveLearnedEntry:    vi.fn().mockResolvedValue(undefined),
  loadSharedLearnedDB: vi.fn().mockResolvedValue({}),
}))

import { collectSnapshot, applySnapshot, resetAllStores } from '@/lib/dataSync'
import { useMonthlyStore } from '@/stores/monthlyStore'
import { useAnnualStore } from '@/stores/annualStore'
import { useMappingStore } from '@/stores/mappingStore'
import { useGoalsStore } from '@/stores/goalsStore'
import { useCreditStore } from '@/stores/creditStore'
import { useMeetingsStore } from '@/stores/meetingsStore'
import { useExpenseLogStore } from '@/stores/expenseLogStore'
import { useBusinessStore } from '@/stores/businessStore'
import { useBusinessAnnualStore } from '@/stores/businessAnnualStore'

// Regression net for the bug-family the user has been hit by twice
// (חופשה drop, fromCredit wipe). If any persisted store field is
// added without wiring it through collectSnapshot/applySnapshot,
// the user's data for that field silently disappears on next reload.
// This test fails the moment such drift is introduced.

function populateAllStores() {
  useMonthlyStore.setState({
    months: {
      jan: {
        year: 2026,
        income:       [{ id: 'i1', name: 'salary',  plan: 10000, actual: 9500 }],
        fixed:        [{ id: 'f1', name: 'rent',    plan: 3000,  actual: 3000 }],
        variable:     [{ id: 'v1', name: 'food',    plan: 1500,  actual: 1612 }],
        sub:          [{ id: 's1', name: 'netflix', plan: 30,    actual: 30 }],
        ins:          [{ id: 'n1', name: 'car-ins', plan: 200,   actual: 200 }],
        installments: [{ id: 'inst1', name: 'TV',   total: 6000, monthly: 500, current: 1, totalPay: 12 }],
        debts:        [{ id: 'd1',   name: 'loan',  remaining: 5000, monthly: 250, months: 20 }],
        savings:      [{ id: 'sv1',  name: 'emergency', monthly: 500, accumulated: 6000 }],
        osh:          { d2: 1200, d10: 800, d15: 1500, d20: 600, d30: 2000 },
        deletedFromMapping: {
          fixed: ['old-fixed-row'], variable: [], sub: [], ins: [],
          installments: ['stale-installment'], debts: [], savings: [],
        },
      },
    },
  })

  useAnnualStore.setState({
    year: 2027,
    income:   [{ id: 'ai1', name: 'job',    annual: 120000 }],
    fixed:    [{ id: 'af1', name: 'rent',   annual: 36000 }],
    variable: [{ id: 'av1', name: 'food',   annual: 18000 }],
    sub:      [{ id: 'as1', name: 'gym',    annual: 600 }],
    savings:  [{ id: 'asv1', name: 'pension', annual: 12000 }],
    debt:     [{ id: 'ad1', name: 'mortgage', annual: 60000, balance: 800000 }],
  })

  useMappingStore.setState({
    income:        [{ id: 'mi',  name: 'salary',  amount: 10000 }],
    fixed:         [{ id: 'mf',  name: 'rent',    amount: 3000 }],
    sub:           [{ id: 'ms',  name: 'netflix', amount: 30 }],
    ins:           [{ id: 'mn',  name: 'car',     amount: 200 }],
    variable:      [{ id: 'mv',  name: 'food',    amount: 1500, fromCredit: true }],
    annual:        [{ id: 'ma',  name: 'vacation', annualAmount: 5000, fromCredit: true }],
    debts:         [{ id: 'md',  name: 'loan', originalBalance: 10000, remainingBalance: 5000, interestRate: 5, remainingMonths: 20, monthlyPayment: 250 }],
    installments:  [{ id: 'mi2', name: 'TV', totalAmount: 6000, monthlyPayment: 500, paidCount: 1, totalCount: 12 }],
    savings:       [{ id: 'mvs', name: 'pension', monthlyContribution: 500, accumulated: 6000, feeBalance: 0.5, feeDeposit: 0.25 }],
    varMonths:     6,
    creditImported: true,
    bufferPct:     0.5,
    incomeOverride: 15000,
    expensesOverride: 8000,
    creditScore:   720,
  })

  useGoalsStore.setState({
    short:  [{ id: 'gs', name: 'phone',  required: 3000,    current: 1000, monthly: 200, targetDate: '2026-12', product: 'savings' }],
    medium: [{ id: 'gm', name: 'car',    required: 50000,   current: 5000, monthly: 500, targetDate: '2028-06', product: 'fund' }],
    long:   [{ id: 'gl', name: 'house',  required: 1500000, current: 0,    monthly: 3000, targetDate: '2040-01', product: 'mortgage' }],
  })

  useCreditStore.setState({
    learnedDB: { 'shufersal': 'מזון לבית', 'paz': 'דלק וחניה' },
    reportMonths: 6,
    transactions: [
      {
        id: 'tx1', desc: 'SHUFERSAL', amount: 412, originalAmount: null,
        category: 'מזון לבית', source: 'visa.xlsx', notes: '', date: '2026-05-12',
        installment: null, isStandingOrder: false, isRefund: false,
      },
      {
        id: 'tx2', desc: 'NETFLIX.COM', amount: 63, originalAmount: null,
        category: 'מנויים', source: 'visa.xlsx', notes: '', date: '2026-05-15',
        installment: null, isStandingOrder: false, isRefund: false,
      },
    ],
    uploadedFileNames: ['visa.xlsx', 'mastercard.xlsx'],
  })

  useMeetingsStore.setState({
    meetings: [{
      id: 'mt1', type: 'mapping', date: '2026-06-01',
      title: 'session 1', summary: 'first meeting',
      actionItems: 'review docs', nextSteps: 'budget plan',
      createdAt: 1717200000000,
    }],
  })

  useExpenseLogStore.setState({
    entries: [
      { id: 'e1', date: '2026-06-03', amount: 45,  category: 'מזון לבית',          note: 'מכולת',  createdAt: 1717400000000 },
      { id: 'e2', date: '2026-06-05', amount: 120, category: 'אוכל בחוץ ובילויים', note: '',        createdAt: 1717500000000 },
    ],
  })

  useBusinessStore.setState({
    businessType: 'osek_murshe',
    revenue: [{ id: 'r1',  name: 'consulting', amount: 20000, vatDeductible: false }],
    cogs:    [{ id: 'cg1', name: 'tools',      amount: 500,   vatDeductible: true }],
    opex:    [{ id: 'op1', name: 'office',     amount: 2000,  vatDeductible: true }],
    ownerSalary: 12000,
    taxPoints: 2.25,
    vatRate: 0.17,
    incomeTaxOverride: 5000,
    bituachLeumiOverride: 700,
    companyTaxOverride: null,
    vatOverride: 0,
  })

  useBusinessAnnualStore.setState({
    businessType: 'company',
    year: 2026,
    revenue: [{ id: 'ar1', name: 'main', amount: 240000, vatDeductible: false }],
    cogs:    [{ id: 'acg1', name: 'cogs', amount: 6000, vatDeductible: true }],
    opex:    [{ id: 'aop1', name: 'rent', amount: 24000, vatDeductible: true }],
    ownerSalary: 144000,
    taxPoints: 2.25,
    vatRate: 0.17,
    incomeTaxOverride: null,
    bituachLeumiOverride: null,
    companyTaxOverride: 28000,
    vatOverride: null,
  })
}

describe('DataSync — snapshot round-trip', () => {
  beforeEach(() => resetAllStores())

  it('every persisted field survives collect → JSON → reset → apply → collect unchanged', () => {
    populateAllStores()

    const before = collectSnapshot()
    const json = JSON.stringify(before)
    const parsed = JSON.parse(json)

    resetAllStores()
    applySnapshot(parsed)

    const after = collectSnapshot()

    expect(after).toEqual(before)
  })

  it('applySnapshot is a no-op on null / non-object / empty input', () => {
    populateAllStores()
    const before = collectSnapshot()

    applySnapshot(null)
    applySnapshot(undefined)
    applySnapshot('not an object')
    applySnapshot(42)
    applySnapshot({})

    // Stores must be unchanged by these no-op calls
    expect(collectSnapshot()).toEqual(before)
  })

  it('applySnapshot silently skips fields with wrong types instead of crashing', () => {
    // resetAllStores() in beforeEach already cleared stores
    expect(() => applySnapshot({
      mapping: { variable: 'not an array', varMonths: 'not a number', bufferPct: null },
      annual:  { year: 'not a number', income: { not: 'array' } },
      monthly: { months: 'not an object' },
      credit:  { learnedDB: 'not an object', reportMonths: 'not a number' },
      business: { businessType: 'invalid-value', revenue: 'not array' },
    })).not.toThrow()

    // Nothing leaked into the stores
    const snap = collectSnapshot()
    expect(snap.mapping.variable).toEqual([])
    expect(snap.mapping.varMonths).toBe(3)            // default
    expect(snap.mapping.bufferPct).toBe(0.4)          // default
    expect(snap.monthly.months).toEqual({})
    expect(snap.credit.reportMonths).toBe(3)          // default
  })

  it('applySnapshot re-issues duplicate mapping row IDs (heals the row-delete-stuck bug)', () => {
    // Simulate an old snapshot saved while the counter-uid was producing
    // colliding ids. Both variable rows share id="r1"; React would render
    // both with the same key, and deleting either via filter(r => r.id !== 'r1')
    // would remove BOTH — appearing to the user as "deleted the wrong row".
    applySnapshot({
      mapping: {
        variable: [
          { id: 'r1', name: 'food',    amount: 1000 },
          { id: 'r1', name: 'transit', amount: 500 },   // duplicate id!
          { id: 'r2', name: 'pharma',  amount: 200 },
        ],
        fixed: [
          { id: 'r1', name: 'rent',    amount: 3000 },  // ALSO 'r1' — different section
          { id: 'r1', name: 'arnona',  amount: 400 },   // duplicate id within fixed too
        ],
      },
    })

    const snap = collectSnapshot()
    const varIds   = snap.mapping.variable.map(r => r.id)
    const fixedIds = snap.mapping.fixed.map(r => r.id)

    // IDs are unique WITHIN each section (sufficient — React keys are scoped
    // to a parent's children list, so the same id appearing in two different
    // section components is fine; collisions within a single list are what
    // cause the row-delete-stuck bug).
    expect(new Set(varIds).size).toBe(varIds.length)
    expect(new Set(fixedIds).size).toBe(fixedIds.length)

    // No row has an empty / missing id
    expect([...varIds, ...fixedIds].every(id => typeof id === 'string' && id.length > 0)).toBe(true)

    // Counts and content preserved — only duplicate IDs are healed
    expect(snap.mapping.variable).toHaveLength(3)
    expect(snap.mapping.fixed).toHaveLength(2)
    expect(snap.mapping.variable.find(r => r.name === 'food')?.amount).toBe(1000)
    expect(snap.mapping.variable.find(r => r.name === 'transit')?.amount).toBe(500)
  })
})
