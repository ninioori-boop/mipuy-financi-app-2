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
import { useCategoryBudgetStore } from '@/stores/categoryBudgetStore'
import { useClientProfileStore } from '@/stores/clientProfileStore'
import { useRecurringStore } from '@/stores/recurringStore'
import { useBusinessStore } from '@/stores/businessStore'
import { useBusinessAnnualStore } from '@/stores/businessAnnualStore'
import { useBusinessRosterStore, PRIMARY_BUSINESS_ID } from '@/stores/businessRosterStore'
import { useBankStore } from '@/stores/bankStore'
import { firestoreViolation } from './firestoreShape'
import { duplicateBusiness, addBusiness, removeBusiness } from '@/lib/businessProfiles'

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
        // fromLog = spending carried in from the expense-log journal. It rides
        // the snapshot like any other row; `logged` is the retired form of it.
        variable:     [{ id: 'v1', name: 'food',    plan: 1500,  actual: 1612 },
                       { id: 'v2', name: 'מזון לבית', plan: 0,   actual: 320, fromLog: true }],
        sub:          [{ id: 's1', name: 'netflix', plan: 30,    actual: 30 }],
        ins:          [{ id: 'n1', name: 'car-ins', plan: 200,   actual: 200 }],
        installments: [{ id: 'inst1', name: 'TV',   total: 6000, monthly: 500, current: 1, totalPay: 12 }],
        debts:        [{ id: 'd1',   name: 'loan',  remaining: 5000, monthly: 250, months: 20 }],
        savings:      [{ id: 'sv1',  name: 'emergency', monthly: 500, accumulated: 6000 }],
        osh:          { d2: 1200, d10: 800, d15: 1500, d20: 600, d30: 2000 },
        logged:       [],
        deletedFromMapping: {
          fixed: ['old-fixed-row'], variable: [], sub: [], ins: [],
          installments: ['stale-installment'], debts: [], savings: [],
        },
        deletedFromAnnual: {
          income: [], fixed: [], variable: ['dropped-from-plan'], sub: [], ins: [], debts: [], savings: [],
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
    creditCards:   [{ id: 'mcc', name: 'ויזה לאומי', limit: 15000, chargeDay: 2 }],
    bankAccounts:  [{ id: 'mba', name: 'עו"ש לאומי', balance: 4200, overdraftLimit: 5000 }],
    varMonths:     6,
    creditImported: true,
    bufferPct:     0.5,
    incomeOverride: 15000,
    expensesOverride: 8000,
    creditScore:   720,
  })

  useGoalsStore.setState({
    short:  [{ id: 'gs', name: 'phone',  required: 3000,    current: 1000, monthly: 200, targetDate: '2026-12', product: 'savings', liquidAllocated: 500 }],
    medium: [{ id: 'gm', name: 'car',    required: 50000,   current: 5000, monthly: 500, targetDate: '2028-06', product: 'fund' }],
    long:   [{ id: 'gl', name: 'house',  required: 1500000, current: 0,    monthly: 3000, targetDate: '2040-01', product: 'mortgage' }],
    liquidTotal: 20000,
    liquidSources: ['sav:s1', 'bank:b2'],
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
      actionItems: 'review docs', nextSteps: 'budget plan', tasks: [],
      prepNotes: 'prep points', createdAt: 1717200000000, updatedAt: 1717200000000,
    }],
  })

  useExpenseLogStore.setState({
    entries: [
      { id: 'e1', date: '2026-06-03', amount: 45,  category: 'מזון לבית',          note: 'מכולת',  createdAt: 1717400000000 },
      { id: 'e2', date: '2026-06-05', amount: 120, category: 'אוכל בחוץ ובילויים', note: '',        createdAt: 1717500000000 },
    ],
  })

  useCategoryBudgetStore.setState({
    budgets: { 'מזון לבית': 2500, 'אוכל בחוץ ובילויים': 800 },
  })

  useClientProfileStore.setState({ hasBusiness: true })

  useRecurringStore.setState({
    rules: [
      { id: 'rec1', name: 'שכר דירה', amount: 4500, category: 'שכר דירה', dayOfMonth: 1,  active: true },
      { id: 'rec2', name: 'נטפליקס',  amount: 63,   category: 'מנויים',    dayOfMonth: 15, active: false },
    ],
    posted: { rec1: '2026-06' },
  })

  // Two businesses — the "both spouses are עצמאים" case.
  useBusinessRosterStore.setState({
    list: [
      { id: PRIMARY_BUSINESS_ID, name: 'העסק שלי' },
      { id: 'biz_spouse',        name: 'העסק של רותי' },
    ],
    activeId: 'biz_spouse',
  })

  useBusinessStore.setState({
    byId: {
      [PRIMARY_BUSINESS_ID]: {
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
      },
      biz_spouse: {
        businessType: 'osek_patur',
        revenue: [{ id: 'r2',  name: 'studio', amount: 6000, vatDeductible: false }],
        cogs:    [],
        opex:    [{ id: 'op2', name: 'חומרים', amount: 900, vatDeductible: false }],
        ownerSalary: 4000,
        taxPoints: 2.75,
        vatRate: 0.18,
        incomeTaxOverride: null,
        bituachLeumiOverride: null,
        companyTaxOverride: null,
        vatOverride: null,
      },
    },
  })

  useBusinessAnnualStore.setState({
    year: 2026,
    byId: {
      [PRIMARY_BUSINESS_ID]: {
        businessType: 'company',
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
      },
      biz_spouse: {
        businessType: 'osek_patur',
        revenue: [{ id: 'ar2', name: 'studio', amount: 72000, vatDeductible: false }],
        cogs:    [],
        opex:    [{ id: 'aop2', name: 'חומרים', amount: 10800, vatDeductible: false }],
        ownerSalary: 48000,
        taxPoints: 2.75,
        vatRate: 0.18,
        incomeTaxOverride: null,
        bituachLeumiOverride: null,
        companyTaxOverride: null,
        vatOverride: null,
      },
    },
  })

  // The bank tab's grid. Persisted since 2026-08-09; the shape it is persisted
  // IN is covered in bankGridPersist.test.ts (Firestore refuses nested arrays).
  useBankStore.setState({
    rawRows: [
      ['תאריך', 'תיאור', 'חובה'],
      [new Date(2026, 6, 14), 'סופר ברקת', 312.9],
    ],
    fileName: 'osh.xlsx',
    sentRows: [1],
    reportMonths: 2,
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

  it('a month still holding the retired `logged` list is carried over to real rows', () => {
    // Months saved before the expense-log summary counted in ביצוע kept it in a
    // display-only `logged` array. Loading such a portfolio must rebuild it as
    // fromLog rows — dropping it would blank that money out of the month.
    applySnapshot({
      monthly: {
        months: {
          jan: {
            year: 2026,
            income: [], fixed: [], variable: [], sub: [], ins: [],
            installments: [], debts: [], savings: [],
            logged: [{ name: 'מזון לבית', amount: 320 }, { name: 'חשמל', amount: 210 }],
          },
        },
      },
    })

    const jan = useMonthlyStore.getState().months['jan']
    expect(jan.variable.find(r => r.name === 'מזון לבית')?.actual).toBe(320)
    expect(jan.variable.find(r => r.name === 'מזון לבית')?.fromLog).toBe(true)
    expect(jan.fixed.find(r => r.name === 'חשמל')?.actual).toBe(210)
    // Emptied on the way out, so the conversion cannot run a second time and
    // double the money on the next load.
    expect(jan.logged).toEqual([])

    const roundTripped = JSON.parse(JSON.stringify(collectSnapshot()))
    applySnapshot(roundTripped)
    const again = useMonthlyStore.getState().months['jan']
    expect(again.variable.filter(r => r.fromLog)).toHaveLength(1)
    expect(again.fixed.filter(r => r.fromLog)).toHaveLength(1)
  })

  it('a fully populated portfolio is a legal Firestore document', () => {
    // 2026-08-12: the bank tab's raw grid was a nested array, which Firestore
    // rejects — and it rejects the ENTIRE write, so one tab's payload silently
    // took down saving for the mapping, the monthly plan and the expense log
    // too. This walks every field the way Firestore does, so the next field
    // with an illegal shape fails here instead of in a client's face.
    populateAllStores()

    expect(firestoreViolation(collectSnapshot())).toBeNull()
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

describe('Businesses — multi-business roster', () => {
  beforeEach(() => resetAllStores())

  it('migrates a pre-multi-business snapshot into the primary business', () => {
    // Exactly what a client who used the business tab before this feature has
    // stored: flat fields, no byId, no roster.
    applySnapshot({
      business: {
        businessType: 'osek_murshe',
        revenue: [{ id: 'r1', name: 'consulting', amount: 20000, vatDeductible: false }],
        cogs: [], opex: [{ id: 'op1', name: 'office', amount: 2000, vatDeductible: true }],
        ownerSalary: 12000, taxPoints: 2.25, vatRate: 0.17,
        incomeTaxOverride: 5000, bituachLeumiOverride: null,
        companyTaxOverride: null, vatOverride: null,
      },
      businessAnnual: {
        businessType: 'company', year: 2026,
        revenue: [{ id: 'ar1', name: 'main', amount: 240000, vatDeductible: false }],
        cogs: [], opex: [],
        ownerSalary: 144000, taxPoints: 2.25, vatRate: 0.17,
        incomeTaxOverride: null, bituachLeumiOverride: null,
        companyTaxOverride: 28000, vatOverride: null,
      },
    })

    const roster = useBusinessRosterStore.getState()
    expect(roster.list).toHaveLength(1)
    expect(roster.list[0].id).toBe(PRIMARY_BUSINESS_ID)
    expect(roster.activeId).toBe(PRIMARY_BUSINESS_ID)

    const monthly = useBusinessStore.getState().byId[PRIMARY_BUSINESS_ID]
    expect(monthly.ownerSalary).toBe(12000)
    expect(monthly.incomeTaxOverride).toBe(5000)
    expect(monthly.revenue[0].amount).toBe(20000)

    const annual = useBusinessAnnualStore.getState().byId[PRIMARY_BUSINESS_ID]
    expect(annual.businessType).toBe('company')
    expect(annual.companyTaxOverride).toBe(28000)
    expect(useBusinessAnnualStore.getState().year).toBe(2026)
  })

  it('still writes the legacy flat mirror so an older open tab is not blanked', () => {
    populateAllStores()
    const snap = collectSnapshot()
    // Mirror = the PRIMARY business, even though 'biz_spouse' is the active one.
    expect(snap.business.ownerSalary).toBe(12000)
    expect(snap.business.revenue[0].name).toBe('consulting')
    expect(snap.businessAnnual.companyTaxOverride).toBe(28000)
  })

  it('duplicate copies the numbers but shares no row identity with the source', () => {
    populateAllStores()
    const newId = duplicateBusiness(PRIMARY_BUSINESS_ID)

    const monthly = useBusinessStore.getState().byId
    const copy = monthly[newId]
    const src = monthly[PRIMARY_BUSINESS_ID]

    expect(copy.ownerSalary).toBe(src.ownerSalary)
    expect(copy.revenue.map(r => r.name)).toEqual(src.revenue.map(r => r.name))
    // fresh row ids — the aliasing bug the v1 app was full of
    expect(copy.revenue[0].id).not.toBe(src.revenue[0].id)
    expect(copy.revenue).not.toBe(src.revenue)

    // editing the copy must not touch the source
    useBusinessStore.getState().updateRow(newId, 'revenue', copy.revenue[0].id, 'amount', 999)
    expect(useBusinessStore.getState().byId[PRIMARY_BUSINESS_ID].revenue[0].amount).toBe(20000)

    // and the annual plan got its own copy too
    expect(useBusinessAnnualStore.getState().byId[newId]).toBeTruthy()
    expect(useBusinessRosterStore.getState().activeId).toBe(newId)
  })

  it('removing a business clears it from both tabs, and the last one can never go', () => {
    populateAllStores()
    expect(removeBusiness('biz_spouse')).toBe(true)
    expect(useBusinessStore.getState().byId.biz_spouse).toBeUndefined()
    expect(useBusinessAnnualStore.getState().byId.biz_spouse).toBeUndefined()
    expect(useBusinessRosterStore.getState().activeId).toBe(PRIMARY_BUSINESS_ID)

    expect(removeBusiness(PRIMARY_BUSINESS_ID)).toBe(false)
    expect(useBusinessRosterStore.getState().list).toHaveLength(1)
  })

  it('adopts business data whose roster entry went missing instead of hiding it', () => {
    applySnapshot({
      businessRoster: { list: [{ id: PRIMARY_BUSINESS_ID, name: 'העסק שלי' }], activeId: PRIMARY_BUSINESS_ID },
      business: {
        byId: {
          [PRIMARY_BUSINESS_ID]: { revenue: [], cogs: [], opex: [], ownerSalary: 1000 },
          orphan: { revenue: [{ id: 'x', name: 'lost', amount: 500, vatDeductible: true }], cogs: [], opex: [], ownerSalary: 0 },
        },
      },
    })

    const roster = useBusinessRosterStore.getState()
    expect(roster.list.map(p => p.id)).toContain('orphan')
    expect(useBusinessStore.getState().byId.orphan.revenue[0].amount).toBe(500)
    // and the annual side got a slot for it, so the tab renders
    expect(useBusinessAnnualStore.getState().byId.orphan).toBeTruthy()
  })

  it('NO DATA LOSS: an existing client\'s stored business survives load → save untouched', () => {
    // The exact document an existing business-tab client has in Firestore today.
    const legacyBusiness = {
      businessType: 'osek_murshe',
      revenue: [{ id: 'r1', name: 'ייעוץ', amount: 32000, vatDeductible: false }],
      cogs:    [{ id: 'c1', name: 'קבלני משנה', amount: 4000, vatDeductible: true }],
      opex:    [{ id: 'o1', name: 'שכירות', amount: 3500, vatDeductible: true },
                { id: 'o2', name: 'משכורות עובדים', amount: 9000, vatDeductible: false }],
      ownerSalary: 14000,
      taxPoints: 2.25,
      vatRate: 0.18,
      incomeTaxOverride: 4100,
      bituachLeumiOverride: null,
      companyTaxOverride: null,
      vatOverride: 250,
    }
    const legacyAnnual = {
      businessType: 'osek_patur',
      year: 2027,
      revenue: [{ id: 'ar1', name: 'ייעוץ', amount: 384000, vatDeductible: false }],
      cogs: [], opex: [{ id: 'ao1', name: 'שכירות', amount: 42000, vatDeductible: true }],
      ownerSalary: 168000,
      taxPoints: 2.25,
      vatRate: 0.18,
      incomeTaxOverride: null,
      bituachLeumiOverride: 9000,
      companyTaxOverride: null,
      vatOverride: null,
    }

    applySnapshot({ business: legacyBusiness, businessAnnual: legacyAnnual })
    const saved = collectSnapshot()

    // 1. What we write back still contains the OLD flat shape, field for field.
    //    An old open tab reading this document sees exactly what it wrote.
    const { byId: _b, ...flatBusiness } = saved.business
    expect(flatBusiness).toEqual(legacyBusiness)
    const { byId: _a, ...flatAnnual } = saved.businessAnnual
    expect(flatAnnual).toEqual(legacyAnnual)

    // 2. And the new keyed shape carries the same values.
    expect(saved.business.byId[PRIMARY_BUSINESS_ID]).toEqual(legacyBusiness)
    const { year: _y, ...annualNoYear } = legacyAnnual
    expect(saved.businessAnnual.byId[PRIMARY_BUSINESS_ID]).toEqual(annualNoYear)

    // 3. Re-loading what we just saved changes nothing (idempotent).
    applySnapshot(JSON.parse(JSON.stringify(saved)))
    expect(collectSnapshot()).toEqual(saved)
  })

  it('a snapshot with no business key at all leaves the stores alone', () => {
    populateAllStores()
    const before = collectSnapshot()
    applySnapshot({ mapping: { variable: [] } })   // unrelated partial snapshot
    const after = collectSnapshot()
    expect(after.business).toEqual(before.business)
    expect(after.businessAnnual).toEqual(before.businessAnnual)
    expect(after.businessRoster).toEqual(before.businessRoster)
  })

  it('a new business starts from the default rows, not a copy', () => {
    populateAllStores()
    const id = addBusiness('עסק שני')
    const fresh = useBusinessStore.getState().byId[id]
    expect(fresh.revenue.every(r => r.amount === 0)).toBe(true)
    expect(fresh.ownerSalary).toBe(0)
    expect(useBusinessRosterStore.getState().list.find(p => p.id === id)?.name).toBe('עסק שני')
  })
})
