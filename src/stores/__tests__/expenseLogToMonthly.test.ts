import { describe, it, expect, beforeEach } from 'vitest'
import { useMonthlyStore, applyLogRows } from '@/stores/monthlyStore'

// The expense-log (תיעוד הוצאות) is a standalone journal. Transferring a month
// of it into the monthly tab used to produce a display-only list that counted
// for nothing. It now produces real rows tagged fromLog, so the money shows up
// in ביצוע everywhere a total is computed — the month summary, the annual view,
// trends and both exports all read row.actual and need no separate wiring.
//
// The whole risk of that design is the journal and an imported bank report
// fighting over the same category. These tests pin down that they cannot.

const JOURNAL = [
  { name: 'אוכל בחוץ ובילויים', amount: 525 },   // variable
  { name: 'חופשה וטיול',        amount: 296 },   // annual → variable
  { name: 'חשמל',               amount: 340 },   // fixed
  { name: 'מנויים',             amount: 60 },    // sub
  { name: 'ביטוח רכב',          amount: 210 },   // ins
]

const SECTIONS = ['fixed', 'variable', 'sub', 'ins'] as const

function logRowsOf(monthId: string) {
  const m = useMonthlyStore.getState().months[monthId]
  return SECTIONS.flatMap(sec => m[sec].filter(r => r.fromLog))
}

describe('applyExpenseLog — the journal lands in ביצוע as real rows', () => {
  beforeEach(() => useMonthlyStore.setState({ months: {} }))

  function seed(monthId = 'log') {
    useMonthlyStore.getState().initMonth(monthId)
    useMonthlyStore.getState().applyExpenseLog(monthId, JOURNAL)
    return useMonthlyStore.getState().months[monthId]
  }

  it('each category lands in the same section the import would put it in', () => {
    const m = seed()
    const at = (sec: typeof SECTIONS[number], name: string) =>
      m[sec].find(r => r.name === name && r.fromLog)
    expect(at('variable', 'אוכל בחוץ ובילויים')?.actual).toBe(525)
    expect(at('variable', 'חופשה וטיול')?.actual).toBe(296)
    expect(at('fixed',    'חשמל')?.actual).toBe(340)
    expect(at('sub',      'מנויים')?.actual).toBe(60)
    expect(at('ins',      'ביטוח רכב')?.actual).toBe(210)
  })

  it('journal rows carry spending only, so they never inflate the plan', () => {
    seed()
    const rows = logRowsOf('log')
    expect(rows).toHaveLength(5)
    expect(rows.every(r => r.plan === 0)).toBe(true)
  })

  it('the whole journal total reaches the month, nothing is silently dropped', () => {
    const m = seed()
    const actual = SECTIONS.reduce((s, sec) => s + m[sec].reduce((t, r) => t + r.actual, 0), 0)
    expect(actual).toBe(JOURNAL.reduce((s, i) => s + i.amount, 0))
  })

  it('transferring again replaces the previous transfer instead of stacking on it', () => {
    seed()
    useMonthlyStore.getState().applyExpenseLog('log', [{ name: 'אוכל בחוץ ובילויים', amount: 700 }])
    // A second copy of the same money on every re-transfer would be the single
    // most damaging bug this feature could ship.
    const rows = logRowsOf('log')
    expect(rows).toHaveLength(1)
    expect(rows[0].actual).toBe(700)
  })

  it('income, savings and transfers are not spending and never become expense rows', () => {
    useMonthlyStore.getState().initMonth('skip')
    useMonthlyStore.getState().applyExpenseLog('skip', [
      { name: 'הכנסות',        amount: 9000 },
      { name: 'חסכונות',       amount: 500 },
      { name: 'העברות ואשראי', amount: 300 },
      { name: 'מזון לבית',     amount: 100 },
    ])
    expect(logRowsOf('skip').map(r => r.name)).toEqual(['מזון לבית'])
  })

  it('an unrecognised label still carries its money in, as a variable expense', () => {
    useMonthlyStore.getState().initMonth('unknown')
    useMonthlyStore.getState().applyExpenseLog('unknown', [{ name: 'קטגוריה שהומצאה', amount: 77 }])
    expect(useMonthlyStore.getState().months['unknown'].variable
      .find(r => r.name === 'קטגוריה שהומצאה')?.actual).toBe(77)
  })

  it('zero and negative amounts produce no row', () => {
    useMonthlyStore.getState().initMonth('zero')
    useMonthlyStore.getState().applyExpenseLog('zero', [
      { name: 'מזון לבית', amount: 0 },
      { name: 'פארם',      amount: -50 },
    ])
    expect(logRowsOf('zero')).toHaveLength(0)
  })

  it('editing a journal row makes it manual, so the next transfer cannot wipe the fix', () => {
    seed()
    const row = useMonthlyStore.getState().months['log'].variable
      .find(r => r.name === 'אוכל בחוץ ובילויים')!
    useMonthlyStore.getState().updateRow('log', 'variable', row.id, 'actual', 480)
    expect(useMonthlyStore.getState().months['log'].variable
      .find(r => r.id === row.id)?.fromLog).toBe(false)

    useMonthlyStore.getState().applyExpenseLog('log', [{ name: 'מזון לבית', amount: 100 }])
    expect(useMonthlyStore.getState().months['log'].variable
      .find(r => r.id === row.id)?.actual).toBe(480)
  })

  it('deleting a journal row removes it like any other row', () => {
    seed()
    const row = useMonthlyStore.getState().months['log'].fixed.find(r => r.fromLog)!
    useMonthlyStore.getState().deleteRow('log', 'fixed', row.id)
    expect(useMonthlyStore.getState().months['log'].fixed.some(r => r.id === row.id)).toBe(false)
  })
})

describe('journal rows and imported reports never overwrite each other', () => {
  beforeEach(() => useMonthlyStore.setState({ months: {} }))

  it('an import leaves a journal row alone and still records its own spending', () => {
    useMonthlyStore.getState().initMonth('both')
    useMonthlyStore.getState().applyExpenseLog('both', [{ name: 'מזון לבית', amount: 400 }])
    useMonthlyStore.getState().applyImport('both', { 'מזון לבית': 1200 }, [], [], [], [], [], [], [], 1)

    const rows = useMonthlyStore.getState().months['both'].variable.filter(r => r.name === 'מזון לבית')
    const fromLog  = rows.filter(r => r.fromLog)
    const imported = rows.filter(r => !r.fromLog)
    expect(fromLog).toHaveLength(1)
    expect(fromLog[0].actual).toBe(400)
    // The report's own spending must still be recorded, not swallowed by the
    // mere presence of a journal row carrying the same category name.
    expect(imported.reduce((s, r) => s + r.actual, 0)).toBe(1200)
  })

  it('a mapping plan row is still added when a journal row shares its name', () => {
    useMonthlyStore.getState().initMonth('plan')
    useMonthlyStore.getState().applyExpenseLog('plan', [{ name: 'מזון לבית', amount: 400 }])
    useMonthlyStore.getState().applyImport('plan', {}, [], [{ name: 'מזון לבית', amount: 2000 }], [], [], [], [], [], 1)

    const rows = useMonthlyStore.getState().months['plan'].variable.filter(r => r.name === 'מזון לבית')
    expect(rows.find(r => r.fromLog)?.actual).toBe(400)
    expect(rows.find(r => r.fromMapping)?.plan).toBe(2000)
  })

  // 'גז' is a fixed category that is NOT one of the default month rows, so the
  // only rows carrying that name are the ones this test creates.
  it('syncFromMapping leaves journal rows alone, mirrors the plan, and does not clone on a rerun', () => {
    useMonthlyStore.getState().initMonth('sync')
    useMonthlyStore.getState().applyExpenseLog('sync', [{ name: 'גז', amount: 340 }])
    const sync = () => useMonthlyStore.getState().syncFromMapping(
      [{ name: 'גז', amount: 300 }], [], [], [], [], [], [], 1, 'sync',
    )
    const gasRows = () => useMonthlyStore.getState().months['sync'].fixed.filter(r => r.name === 'גז')
    sync()
    expect(gasRows().find(r => r.fromLog)?.actual).toBe(340)
    expect(gasRows().find(r => r.fromMapping)?.plan).toBe(300)
    sync()
    expect(gasRows()).toHaveLength(2)
  })

  it('a per-business import still fills its named row when a journal row sits in the section', () => {
    useMonthlyStore.getState().initMonth('named')
    useMonthlyStore.getState().applyExpenseLog('named', [{ name: 'ביטוח רכב', amount: 210 }])
    useMonthlyStore.getState().applyImport(
      'named', { 'ביטוח רכב': 800 }, [], [], [], [{ name: 'הראל', amount: 800 }], [], [], [], 1,
      [{ name: 'הראל', amount: 800, category: 'ביטוח רכב' }],
    )
    const ins = useMonthlyStore.getState().months['named'].ins
    expect(ins.find(r => r.name === 'הראל')?.actual).toBe(800)
    expect(ins.find(r => r.fromLog)?.actual).toBe(210)
  })
})

describe('applyLogRows — the legacy carry-over is safe to run more than once', () => {
  it('re-converting the same legacy month never doubles the money', () => {
    useMonthlyStore.setState({ months: {} })
    useMonthlyStore.getState().initMonth('legacy')
    const legacy = {
      ...useMonthlyStore.getState().months['legacy'],
      logged: [{ name: 'מזון לבית', amount: 250 }],
    }

    const once = applyLogRows(legacy, legacy.logged)
    expect(once.variable.filter(r => r.fromLog).map(r => r.actual)).toEqual([250])
    expect(once.logged).toEqual([])

    // The path a stale remote doc takes: it still carries the old `logged`
    // list, so the conversion runs again over an already-converted month.
    const again = applyLogRows(once, legacy.logged)
    expect(again.variable.filter(r => r.fromLog).map(r => r.actual)).toEqual([250])
  })
})
