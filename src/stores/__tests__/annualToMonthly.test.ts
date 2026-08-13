import { describe, it, expect, beforeEach } from 'vitest'
import { useMonthlyStore } from '@/stores/monthlyStore'

// The annual plan feeds the monthly tab (annual ÷ 12), ALONGSIDE the mapping
// sync that was already there. These tests pin the part that is easy to get
// wrong and impossible to notice: two independent syncs writing to the same
// rows, where a mistake shows up as a client's plan quietly changing or a
// category appearing twice.

type Plan = Parameters<ReturnType<typeof useMonthlyStore.getState>['syncFromAnnual']>[0]

const YEAR = 2026

function plan(p: Partial<Plan> = {}): Plan {
  return {
    year: YEAR,
    income: [], fixed: [], variable: [], sub: [], savings: [], debt: [],
    ...p,
  }
}

function syncAnnual(p: Partial<Plan> = {}, monthId?: string) {
  useMonthlyStore.getState().syncFromAnnual(plan(p), monthId)
}

function syncMapping(o: {
  fixed?: { name: string; amount: number }[]
  variable?: { name: string; amount: number }[]
  sav?: { name: string; monthlyContribution: number; accumulated: number }[]
  debt?: { name: string; remainingBalance: number; monthlyPayment: number; remainingMonths: number }[]
} = {}) {
  useMonthlyStore.getState().syncFromMapping(
    o.fixed ?? [], o.variable ?? [], [], [],
    [], o.debt ?? [], o.sav ?? [],
    1,
  )
}

/** A month with no default rows, so a test sees only what a sync put there. */
function emptyMonth(id: string, year = YEAR) {
  useMonthlyStore.getState().initMonth(id)
  useMonthlyStore.setState(s => ({
    months: {
      ...s.months,
      [id]: { ...s.months[id], year, income: [], fixed: [], variable: [], sub: [], ins: [] },
    },
  }))
}

const row = (id: string, name: string) =>
  useMonthlyStore.getState().months[id].variable.find(r => r.name === name)

describe('syncFromAnnual — the annual plan lands in the month divided by 12', () => {
  beforeEach(() => useMonthlyStore.setState({ months: {} }))

  it("Ori's example: 120 a year for אוכל בחוץ ובילויים shows as 10 a month", () => {
    emptyMonth('jan')
    syncAnnual({ variable: [{ name: 'אוכל בחוץ ובילויים', annual: 120 }] })

    const r = row('jan', 'אוכל בחוץ ובילויים')
    expect(r?.plan).toBe(10)
    expect(r?.fromAnnual).toBe(true)
  })

  it('reaches every month of the planned year at once', () => {
    emptyMonth('jan'); emptyMonth('feb'); emptyMonth('mar')
    syncAnnual({ variable: [{ name: 'מזון לבית', annual: 24000 }] })

    for (const mid of ['jan', 'feb', 'mar']) {
      expect(row(mid, 'מזון לבית')?.plan).toBe(2000)
    }
  })

  it('leaves months of a DIFFERENT year alone', () => {
    emptyMonth('jan', 2026)
    emptyMonth('feb', 2027)
    syncAnnual({ variable: [{ name: 'מזון לבית', annual: 24000 }] })   // plan year 2026

    expect(row('jan', 'מזון לבית')?.plan).toBe(2000)
    expect(row('feb', 'מזון לבית')).toBeUndefined()
  })

  it('splits the plan section: insurance lands in ביטוחים, the rest in מנויים', () => {
    emptyMonth('jan')
    syncAnnual({ sub: [
      { name: 'מנויים',      annual: 1200 },
      { name: 'ביטוח רכב',   annual: 2400 },
    ] })

    const m = useMonthlyStore.getState().months.jan
    expect(m.sub.find(r => r.name === 'מנויים')?.plan).toBe(100)
    expect(m.ins.find(r => r.name === 'ביטוח רכב')?.plan).toBe(200)
    expect(m.sub.find(r => r.name === 'ביטוח רכב')).toBeUndefined()
  })

  it('carries income, savings and debt as well as expenses', () => {
    emptyMonth('jan')
    syncAnnual({
      income:  [{ name: 'שכר עבודה (נטו)', annual: 240000 }],
      savings: [{ name: 'קרן חירום', annual: 12000 }],
      debt:    [{ name: 'הלוואת רכב', annual: 24000, balance: 60000 }],
    })

    const m = useMonthlyStore.getState().months.jan
    expect(m.income.find(r => r.name === 'שכר עבודה (נטו)')?.plan).toBe(20000)
    expect(m.savings.find(r => r.name === 'קרן חירום')?.monthly).toBe(1000)
    const debt = m.debts.find(r => r.name === 'הלוואת רכב')
    expect(debt?.monthly).toBe(2000)
    expect(debt?.remaining).toBe(60000)
    // No term is invented from balance ÷ payment: that would ignore interest.
    expect(debt?.months).toBe(0)
  })

  it('updates in place when the plan changes, instead of adding a second line', () => {
    emptyMonth('jan')
    syncAnnual({ variable: [{ name: 'מזון לבית', annual: 12000 }] })
    syncAnnual({ variable: [{ name: 'מזון לבית', annual: 24000 }] })

    const rows = useMonthlyStore.getState().months.jan.variable.filter(r => r.name === 'מזון לבית')
    expect(rows).toHaveLength(1)
    expect(rows[0].plan).toBe(2000)
  })

  it('lands on an existing empty line rather than opening a duplicate', () => {
    useMonthlyStore.getState().initMonth('jan')   // keeps the month's default rows
    const before = useMonthlyStore.getState().months.jan.variable.length
    const name = useMonthlyStore.getState().months.jan.variable[0].name

    syncAnnual({ variable: [{ name, annual: 6000 }] })

    const after = useMonthlyStore.getState().months.jan.variable
    expect(after).toHaveLength(before)
    expect(after.filter(r => r.name === name)).toHaveLength(1)
    expect(row('jan', name)?.plan).toBe(500)
  })

  it('sums two plan lines that share a name instead of letting one win', () => {
    emptyMonth('jan')
    syncAnnual({ variable: [
      { name: 'בריאות', annual: 1200 },
      { name: 'בריאות', annual: 2400 },
    ] })

    expect(row('jan', 'בריאות')?.plan).toBe(300)
  })
})

describe('syncFromAnnual — what it must never overwrite', () => {
  beforeEach(() => useMonthlyStore.setState({ months: {} }))

  it("never touches a number the client typed themselves", () => {
    emptyMonth('jan')
    useMonthlyStore.getState().addRow('jan', 'variable', 'מזון לבית')
    const id = useMonthlyStore.getState().months.jan.variable[0].id
    useMonthlyStore.getState().updateRow('jan', 'variable', id, 'plan', 900)

    syncAnnual({ variable: [{ name: 'מזון לבית', annual: 24000 }] })

    expect(row('jan', 'מזון לבית')?.plan).toBe(900)
  })

  it('stops managing a row the moment the client edits it', () => {
    emptyMonth('jan')
    syncAnnual({ variable: [{ name: 'מזון לבית', annual: 12000 }] })
    const id = row('jan', 'מזון לבית')!.id
    useMonthlyStore.getState().updateRow('jan', 'variable', id, 'plan', 750)

    syncAnnual({ variable: [{ name: 'מזון לבית', annual: 99000 }] })

    expect(row('jan', 'מזון לבית')?.plan).toBe(750)
    expect(row('jan', 'מזון לבית')?.fromAnnual).toBeUndefined()
  })

  it('does not resurrect a row the client deleted', () => {
    emptyMonth('jan')
    syncAnnual({ variable: [{ name: 'מזון לבית', annual: 12000 }] })
    useMonthlyStore.getState().deleteRow('jan', 'variable', row('jan', 'מזון לבית')!.id)

    syncAnnual({ variable: [{ name: 'מזון לבית', annual: 12000 }] })

    expect(row('jan', 'מזון לבית')).toBeUndefined()
  })

  it('keeps a row that still holds ביצוע when the category leaves the plan', () => {
    emptyMonth('jan')
    syncAnnual({ variable: [{ name: 'מזון לבית', annual: 12000 }] })
    useMonthlyStore.setState(s => ({
      months: { ...s.months, jan: {
        ...s.months.jan,
        variable: s.months.jan.variable.map(r => r.name === 'מזון לבית' ? { ...r, actual: 1830 } : r),
      } },
    }))

    syncAnnual({ variable: [] })   // category dropped from the annual plan

    const r = row('jan', 'מזון לבית')
    expect(r).toBeDefined()
    expect(r?.actual).toBe(1830)   // the spending survives
    expect(r?.plan).toBe(0)        // only the plan it owned is cleared
  })

  it('removes a row it created once the plan drops it and nothing was spent', () => {
    emptyMonth('jan')
    syncAnnual({ variable: [{ name: 'מזון לבית', annual: 12000 }] })
    syncAnnual({ variable: [] })

    expect(row('jan', 'מזון לבית')).toBeUndefined()
  })
})

// Every case below is a defect the pre-deploy review found in the first cut of
// this feature. They all passed `tsc`, the build, and the happy-path tests.
describe('rows the sync must not reach (grill findings, 2026-08-13)', () => {
  beforeEach(() => useMonthlyStore.setState({ months: {} }))

  it('does not overwrite a zero the client typed on purpose', () => {
    useMonthlyStore.getState().initMonth('jan')
    const target = useMonthlyStore.getState().months.jan.variable[0]
    // Typing 0 is a decision: "this category is out this month".
    useMonthlyStore.getState().updateRow('jan', 'variable', target.id, 'plan', 0)

    syncAnnual({ variable: [{ name: target.name, annual: 12000 }] })

    expect(row('jan', target.name)?.plan).toBe(0)
    expect(row('jan', target.name)?.fromAnnual).toBeUndefined()
  })

  it('never deletes a row the client added themselves', () => {
    useMonthlyStore.getState().initMonth('jan')
    useMonthlyStore.getState().addRow('jan', 'variable', 'מתנות')   // client's own line, no number yet

    syncAnnual({ variable: [{ name: 'מתנות', annual: 12000 }] })    // client also plans it
    syncAnnual({ variable: [] })                                     // then drops it from the plan

    expect(row('jan', 'מתנות')).toBeDefined()
  })

  it('never writes into a row that already holds spending from an import', () => {
    emptyMonth('jan')
    useMonthlyStore.setState(s => ({
      months: { ...s.months, jan: {
        ...s.months.jan,
        variable: [{ id: 'imported', name: 'מזון לבית', plan: 0, actual: 3200,
                     txns: [{ desc: 'סופר', date: '2026-01-04', amount: 3200 }] }],
      } },
    }))

    syncAnnual({ variable: [{ name: 'מזון לבית', annual: 24000 }] })

    const r = row('jan', 'מזון לבית')
    expect(r?.actual).toBe(3200)
    expect(r?.plan).toBe(0)              // untouched: not a placeholder
    expect(r?.fromAnnual).toBeUndefined()
  })

  it('mapping dropping a category no longer takes its ביצוע with it', () => {
    // The takeover chain that made this reachable: annual owns a row, mapping
    // takes it over, then mapping's source drops the category.
    emptyMonth('jan')
    syncAnnual({ variable: [{ name: 'מזון לבית', annual: 24000 }] })
    useMonthlyStore.setState(s => ({
      months: { ...s.months, jan: {
        ...s.months.jan,
        variable: s.months.jan.variable.map(r => r.name === 'מזון לבית' ? { ...r, actual: 3200 } : r),
      } },
    }))
    syncMapping({ variable: [{ name: 'מזון לבית', amount: 2400 }] })
    syncMapping({ variable: [] })   // category leaves the mapping

    const r = row('jan', 'מזון לבית')
    expect(r, 'the row and its spending must survive').toBeDefined()
    expect(r?.actual).toBe(3200)
    expect(r?.plan).toBe(0)
  })

  it('does not replace a debt balance the client typed', () => {
    emptyMonth('jan')
    useMonthlyStore.getState().addDebtRow('jan')
    const id = useMonthlyStore.getState().months.jan.debts[0].id
    useMonthlyStore.getState().updateDebtRow('jan', id, 'name', 'משכנתא')
    useMonthlyStore.getState().updateDebtRow('jan', id, 'remaining', 850000)

    syncAnnual({ debt: [{ name: 'משכנתא', annual: 60000, balance: 900000 }] })

    const debts = useMonthlyStore.getState().months.jan.debts
    expect(debts).toHaveLength(1)              // no duplicate line
    expect(debts[0].remaining).toBe(850000)    // and the client's figure stands
  })

  it('fills the old placeholder instead of showing two lines for one expense', () => {
    // The month ships with "פנאי ובילויים"; the plan speaks the canonical
    // "אוכל בחוץ ובילויים". Same expense, and the client must see one line.
    useMonthlyStore.getState().initMonth('jan')
    syncAnnual({ variable: [{ name: 'אוכל בחוץ ובילויים', annual: 1200 }] })

    const v = useMonthlyStore.getState().months.jan.variable
    expect(v.filter(r => r.name === 'פנאי ובילויים')).toHaveLength(0)
    const r = v.find(x => x.name === 'אוכל בחוץ ובילויים')
    expect(r?.plan).toBe(100)
    expect(r?.fromAnnual).toBe(true)
  })

  it('leaves the old placeholder alone once the client has put a number on it', () => {
    useMonthlyStore.getState().initMonth('jan')
    const legacy = useMonthlyStore.getState().months.jan.variable
      .find(r => r.name === 'פנאי ובילויים')!
    useMonthlyStore.getState().updateRow('jan', 'variable', legacy.id, 'plan', 640)

    syncAnnual({ variable: [{ name: 'אוכל בחוץ ובילויים', annual: 1200 }] })

    const v = useMonthlyStore.getState().months.jan.variable
    expect(v.find(r => r.name === 'פנאי ובילויים')?.plan).toBe(640)
    // And no second food line opened behind their back.
    expect(v.find(r => r.name === 'אוכל בחוץ ובילויים')).toBeUndefined()
  })

  it('routes an insurance name the canonical list never heard of to ביטוחים', () => {
    emptyMonth('jan')
    syncAnnual({ sub: [{ name: 'ביטוח דירה', annual: 2400 }] })

    const m = useMonthlyStore.getState().months.jan
    expect(m.ins.find(r => r.name === 'ביטוח דירה')?.plan).toBe(200)
    expect(m.sub.find(r => r.name === 'ביטוח דירה')).toBeUndefined()
  })

  it('survives a month saved before the deletion tracker existed', () => {
    emptyMonth('jan')
    useMonthlyStore.setState(s => {
      const m = { ...s.months.jan } as Partial<typeof s.months.jan>
      delete m.deletedFromAnnual
      return { months: { ...s.months, jan: m as typeof s.months.jan } }
    })

    expect(() => syncAnnual({ variable: [{ name: 'מזון לבית', annual: 12000 }] })).not.toThrow()
    expect(row('jan', 'מזון לבית')?.plan).toBe(1000)
  })

  it('remembers a deleted debt and savings row, not just budget rows', () => {
    emptyMonth('jan')
    syncAnnual({
      savings: [{ name: 'קרן חירום', annual: 12000 }],
      debt:    [{ name: 'הלוואה', annual: 24000, balance: 50000 }],
    })
    const m1 = useMonthlyStore.getState().months.jan
    useMonthlyStore.getState().deleteSavingRow('jan', m1.savings[0].id)
    useMonthlyStore.getState().deleteDebtRow('jan', m1.debts[0].id)

    syncAnnual({
      savings: [{ name: 'קרן חירום', annual: 12000 }],
      debt:    [{ name: 'הלוואה', annual: 24000, balance: 50000 }],
    })

    const m2 = useMonthlyStore.getState().months.jan
    expect(m2.savings).toHaveLength(0)
    expect(m2.debts).toHaveLength(0)
  })

  it('an annual row with no usable number never becomes ₪NaN in the month', () => {
    // `NaN <= 0` is false, so an unguarded amount sailed past the skip and put
    // ₪NaN on the plan and on תזרים נטו. Reached production on 2026-08-13.
    emptyMonth('jan')
    syncAnnual({ variable: [
      { name: 'מזון לבית', annual: undefined as unknown as number },
      { name: 'בריאות',    annual: 'לא מספר' as unknown as number },
      { name: 'תחביבים',   annual: 12000 },
    ] })

    expect(row('jan', 'מזון לבית')).toBeUndefined()
    expect(row('jan', 'בריאות')).toBeUndefined()
    expect(row('jan', 'תחביבים')?.plan).toBe(1000)   // the healthy row still lands
    for (const r of useMonthlyStore.getState().months.jan.variable) {
      expect(Number.isFinite(r.plan), `${r.name} has a non-numeric plan`).toBe(true)
    }
  })

  it('repairs a ₪NaN already sitting in a saved month', () => {
    emptyMonth('jan')
    useMonthlyStore.setState(s => ({
      months: { ...s.months, jan: {
        ...s.months.jan,
        variable: [{ id: 'broken', name: 'מזון לבית', plan: NaN, actual: 7000, fromAnnual: true }],
        savings:  [{ id: 'bs', name: 'קרן', monthly: NaN, accumulated: 0 }],
        debts:    [{ id: 'bd', name: 'הלוואה', remaining: NaN, monthly: NaN, months: 0 }],
      } },
    }))

    syncAnnual()   // an empty plan, exactly what a client who never filled the tab has

    const m = useMonthlyStore.getState().months.jan
    expect(m.variable[0].plan).toBe(0)
    expect(m.variable[0].actual).toBe(7000)   // the spending is not collateral
    expect(m.savings[0].monthly).toBe(0)
    expect(m.debts[0].monthly).toBe(0)
    expect(m.debts[0].remaining).toBe(0)
  })

  it('an annual figure too small to reach a shekel a month opens no row at all', () => {
    emptyMonth('jan')
    syncAnnual({ variable: [{ name: 'תרומות', annual: 5 }] })   // 5/12 rounds to 0

    expect(row('jan', 'תרומות')).toBeUndefined()
  })
})

describe('mapping and the annual plan side by side', () => {
  beforeEach(() => useMonthlyStore.setState({ months: {} }))

  it('mapping wins the category both describe, whichever ran first', () => {
    emptyMonth('jan')
    syncAnnual({ variable: [{ name: 'מזון לבית', annual: 12000 }] })   // annual first: 1000
    syncMapping({ variable: [{ name: 'מזון לבית', amount: 2400 }] })

    const rows = useMonthlyStore.getState().months.jan.variable.filter(r => r.name === 'מזון לבית')
    expect(rows).toHaveLength(1)              // one category, one line
    expect(rows[0].plan).toBe(2400)
    expect(rows[0].fromMapping).toBe(true)
    expect(rows[0].fromAnnual).toBeUndefined()

    syncAnnual({ variable: [{ name: 'מזון לבית', annual: 12000 }] })   // annual runs again
    expect(row('jan', 'מזון לבית')?.plan).toBe(2400)                   // and does not take it back
  })

  it('mapping wins when IT ran first too', () => {
    emptyMonth('jan')
    syncMapping({ variable: [{ name: 'מזון לבית', amount: 2400 }] })
    syncAnnual({ variable: [{ name: 'מזון לבית', annual: 12000 }] })

    const rows = useMonthlyStore.getState().months.jan.variable.filter(r => r.name === 'מזון לבית')
    expect(rows).toHaveLength(1)
    expect(rows[0].plan).toBe(2400)
  })

  it('each source keeps the categories the other does not cover', () => {
    emptyMonth('jan')
    syncMapping({ variable: [{ name: 'מזון לבית', amount: 2400 }] })
    syncAnnual({ variable: [{ name: 'חופשה וטיול', annual: 12000 }] })

    // Re-running each must not delete the other's rows — the failure this
    // whole two-tag design exists to prevent.
    syncMapping({ variable: [{ name: 'מזון לבית', amount: 2400 }] })
    syncAnnual({ variable: [{ name: 'חופשה וטיול', annual: 12000 }] })

    expect(row('jan', 'מזון לבית')?.plan).toBe(2400)
    expect(row('jan', 'חופשה וטיול')?.plan).toBe(1000)
  })

  it('mapping takes over an annual-owned savings row and debt row', () => {
    emptyMonth('jan')
    syncAnnual({
      savings: [{ name: 'פנסיה', annual: 12000 }],
      debt:    [{ name: 'הלוואה', annual: 24000, balance: 50000 }],
    })
    syncMapping({
      sav:  [{ name: 'פנסיה', monthlyContribution: 1500, accumulated: 90000 }],
      debt: [{ name: 'הלוואה', remainingBalance: 40000, monthlyPayment: 1800, remainingMonths: 24 }],
    })

    const m = useMonthlyStore.getState().months.jan
    expect(m.savings.filter(r => r.name === 'פנסיה')).toHaveLength(1)
    expect(m.savings[0].monthly).toBe(1500)
    expect(m.savings[0].fromMapping).toBe(true)
    expect(m.debts.filter(r => r.name === 'הלוואה')).toHaveLength(1)
    expect(m.debts[0].monthly).toBe(1800)
    expect(m.debts[0].months).toBe(24)
  })
})
