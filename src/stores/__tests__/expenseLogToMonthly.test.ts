import { describe, it, expect, beforeEach } from 'vitest'
import { useMonthlyStore, applyLogRows } from '@/stores/monthlyStore'

// The expense-log (תיעוד הוצאות) journal now feeds ביצוע in the monthly tab.
// The rule the whole feature rests on:
//
//   ONE category holds ONE number. An imported report always wins. The journal
//   fills only what the report left empty.
//
// That rule is not a preference — the phone app auto-captures Apple/Google Pay
// charges into the journal, and those same charges arrive again in the credit
// statement. Summing the two sources would count real purchases twice, every
// month, without anyone doing anything wrong.

const CAT = 'אוכל בחוץ ובילויים'   // variable
const SECTIONS = ['fixed', 'variable', 'sub', 'ins'] as const
const s = () => useMonthlyStore.getState()

/** Every row of one category, across the section it belongs to. */
function rowsFor(monthId: string, name: string, section: typeof SECTIONS[number] = 'variable') {
  return s().months[monthId][section].filter(r => r.name === name)
}
function actualFor(monthId: string, name: string, section: typeof SECTIONS[number] = 'variable') {
  return rowsFor(monthId, name, section).reduce((t, r) => t + r.actual, 0)
}
function journalRows(monthId: string) {
  const m = s().months[monthId]
  return SECTIONS.flatMap(sec => m[sec].filter(r => r.fromLog || r.logFilled))
}

describe('one category, one number', () => {
  beforeEach(() => useMonthlyStore.setState({ months: {} }))

  it('the journal fills an empty planned row instead of opening a second one', () => {
    s().initMonth('m')
    s().syncFromMapping([], [{ name: CAT, amount: 328 }], [], [], [], [], [], 1, 'm')
    s().applyExpenseLog('m', [{ name: CAT, amount: 525 }])

    const rows = rowsFor('m', CAT)
    expect(rows).toHaveLength(1)
    expect(rows[0].plan).toBe(328)
    expect(rows[0].actual).toBe(525)
    expect(rows[0].logFilled).toBe(true)
  })

  it('a category with no row at all gets one created for it', () => {
    s().initMonth('m')
    s().applyExpenseLog('m', [{ name: 'ציוד עסקי/משרדי', amount: 324 }])
    const rows = rowsFor('m', 'ציוד עסקי/משרדי')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ plan: 0, actual: 324, fromLog: true })
  })

  it('the report wins, whichever way round the two transfers happen', () => {
    const both = (order: 'import-first' | 'journal-first') => {
      useMonthlyStore.setState({ months: {} })
      s().initMonth('m')
      s().syncFromMapping([], [{ name: CAT, amount: 328 }], [], [], [], [], [], 1, 'm')
      const imp = () => s().applyImport('m', { [CAT]: 500 }, [], [], [], [], [], [], [], 1)
      const log = () => s().applyExpenseLog('m', [{ name: CAT, amount: 525 }])
      if (order === 'import-first') { imp(); log() } else { log(); imp() }
      return rowsFor('m', CAT).map(r => ({ plan: r.plan, actual: r.actual, journal: !!(r.fromLog || r.logFilled) }))
    }
    // 500, not 1025. One row, holding the report's figure.
    const expected = [{ plan: 328, actual: 500, journal: false }]
    expect(both('import-first')).toEqual(expected)
    expect(both('journal-first')).toEqual(expected)
  })

  it('a category the report never mentions keeps its journal number', () => {
    s().initMonth('m')
    s().applyExpenseLog('m', [{ name: CAT, amount: 525 }, { name: 'ביט ללא מעקב', amount: 386 }])
    // The report covers only one of the two categories.
    s().applyImport('m', { [CAT]: 500 }, [], [], [], [], [], [], [], 1)

    expect(actualFor('m', CAT)).toBe(500)
    expect(actualFor('m', 'ביט ללא מעקב')).toBe(386)   // cash/Bit survives untouched
  })

  it('a report that reports ZERO for a category does not blank the journal', () => {
    s().initMonth('m')
    s().applyExpenseLog('m', [{ name: CAT, amount: 525 }])
    s().applyImport('m', { [CAT]: 0 }, [], [], [], [], [], [], [], 1)
    expect(actualFor('m', CAT)).toBe(525)
  })

  it('an advisor figure typed by hand is not overwritten by the journal', () => {
    s().initMonth('m')
    s().syncFromMapping([], [{ name: CAT, amount: 328 }], [], [], [], [], [], 1, 'm')
    const row = rowsFor('m', CAT)[0]
    s().updateRow('m', 'variable', row.id, 'actual', 900)
    s().applyExpenseLog('m', [{ name: CAT, amount: 525 }])

    expect(rowsFor('m', CAT)).toHaveLength(1)
    expect(actualFor('m', CAT)).toBe(900)
  })
})

describe('transferring again recomputes, never accumulates', () => {
  beforeEach(() => useMonthlyStore.setState({ months: {} }))

  it('a created row is replaced, not stacked', () => {
    s().initMonth('m')
    s().applyExpenseLog('m', [{ name: CAT, amount: 525 }])
    s().applyExpenseLog('m', [{ name: CAT, amount: 700 }])
    expect(rowsFor('m', CAT)).toHaveLength(1)
    expect(actualFor('m', CAT)).toBe(700)
  })

  it('a filled planned row is re-filled, and keeps its plan', () => {
    s().initMonth('m')
    s().syncFromMapping([], [{ name: CAT, amount: 328 }], [], [], [], [], [], 1, 'm')
    s().applyExpenseLog('m', [{ name: CAT, amount: 525 }])
    s().applyExpenseLog('m', [{ name: CAT, amount: 700 }])
    expect(rowsFor('m', CAT)).toEqual([expect.objectContaining({ plan: 328, actual: 700 })])
  })

  it('a planned row the journal no longer covers is emptied, never deleted', () => {
    s().initMonth('m')
    s().syncFromMapping([], [{ name: CAT, amount: 328 }], [], [], [], [], [], 1, 'm')
    s().applyExpenseLog('m', [{ name: CAT, amount: 525 }])
    // Next month's transfer has nothing in this category.
    s().applyExpenseLog('m', [{ name: 'פארם', amount: 60 }])

    const rows = rowsFor('m', CAT)
    expect(rows).toHaveLength(1)          // the client's planned line survives
    expect(rows[0].plan).toBe(328)        // with its plan intact
    expect(rows[0].actual).toBe(0)        // and no stale journal money left on it
    expect(rows[0].logFilled).toBeUndefined()
  })

  it('a hand edit makes the row manual, so the next transfer leaves it alone', () => {
    s().initMonth('m')
    s().applyExpenseLog('m', [{ name: CAT, amount: 525 }])
    const row = rowsFor('m', CAT)[0]
    s().updateRow('m', 'variable', row.id, 'actual', 480)
    expect(rowsFor('m', CAT)[0].fromLog).toBeUndefined()

    s().applyExpenseLog('m', [{ name: CAT, amount: 700 }])
    expect(rowsFor('m', CAT)).toHaveLength(1)
    expect(actualFor('m', CAT)).toBe(480)
  })
})

describe('routing and totals', () => {
  beforeEach(() => useMonthlyStore.setState({ months: {} }))

  const JOURNAL = [
    { name: CAT,             amount: 525 },   // variable
    { name: 'חופשה וטיול',   amount: 296 },   // annual → variable
    { name: 'גז',            amount: 340 },   // fixed
    { name: 'מנויים',        amount: 60 },    // sub
    { name: 'ביטוח רכב',     amount: 210 },   // ins
  ]

  it('each category lands in the section the import would have used', () => {
    s().initMonth('m')
    s().applyExpenseLog('m', JOURNAL)
    expect(actualFor('m', CAT, 'variable')).toBe(525)
    expect(actualFor('m', 'חופשה וטיול', 'variable')).toBe(296)
    expect(actualFor('m', 'גז', 'fixed')).toBe(340)
    expect(actualFor('m', 'מנויים', 'sub')).toBe(60)
    expect(actualFor('m', 'ביטוח רכב', 'ins')).toBe(210)
  })

  it('the whole journal total reaches the month when nothing else claims it', () => {
    s().initMonth('m')
    s().applyExpenseLog('m', JOURNAL)
    expect(journalRows('m').reduce((t, r) => t + r.actual, 0))
      .toBe(JOURNAL.reduce((t, i) => t + i.amount, 0))
  })

  it('income, savings and transfers are not spending and never become expense rows', () => {
    s().initMonth('m')
    s().applyExpenseLog('m', [
      { name: 'הכנסות',        amount: 9000 },
      { name: 'חסכונות',       amount: 500 },
      { name: 'העברות ואשראי', amount: 300 },
      { name: 'מזון לבית',     amount: 100 },
    ])
    expect(journalRows('m').map(r => r.name)).toEqual(['מזון לבית'])
  })

  it('an unrecognised label still carries its money in, as a variable expense', () => {
    s().initMonth('m')
    s().applyExpenseLog('m', [{ name: 'קטגוריה שהומצאה', amount: 77 }])
    expect(actualFor('m', 'קטגוריה שהומצאה')).toBe(77)
  })

  it('zero and negative amounts produce no row', () => {
    s().initMonth('m')
    s().applyExpenseLog('m', [{ name: 'מזון לבית', amount: 0 }, { name: 'פארם', amount: -50 }])
    expect(journalRows('m')).toHaveLength(0)
  })
})

describe('mapping still reaches a category the journal is holding', () => {
  beforeEach(() => useMonthlyStore.setState({ months: {} }))

  it('syncFromMapping puts the plan into the journal row rather than beside it', () => {
    s().initMonth('m')
    s().applyExpenseLog('m', [{ name: 'גז', amount: 340 }])
    const sync = () => s().syncFromMapping(
      [{ name: 'גז', amount: 300 }], [], [], [], [], [], [], 1, 'm',
    )
    sync()
    expect(rowsFor('m', 'גז', 'fixed')).toEqual([
      expect.objectContaining({ plan: 300, actual: 340, fromLog: true }),
    ])
    sync()   // rerunning the sync must not clone the row
    expect(rowsFor('m', 'גז', 'fixed')).toHaveLength(1)
  })

  it('an import carrying a mapping plan does the same', () => {
    s().initMonth('m')
    s().applyExpenseLog('m', [{ name: 'ציוד עסקי/משרדי', amount: 324 }])
    s().applyImport('m', {}, [], [{ name: 'ציוד עסקי/משרדי', amount: 400 }], [], [], [], [], [], 1)
    expect(rowsFor('m', 'ציוד עסקי/משרדי')).toEqual([
      expect.objectContaining({ plan: 400, actual: 324 }),
    ])
  })

  it('a per-business import still fills its named row beside an untouched journal row', () => {
    s().initMonth('m')
    s().applyExpenseLog('m', [{ name: 'ביטוח רכב', amount: 210 }])
    s().applyImport(
      'm', { 'ביטוח חיים': 800 }, [], [], [], [{ name: 'הראל', amount: 800 }], [], [], [], 1,
      [{ name: 'הראל', amount: 800, category: 'ביטוח חיים' }],
    )
    const ins = s().months['m'].ins
    expect(ins.find(r => r.name === 'הראל')?.actual).toBe(800)
    // A different category — the report said nothing about car insurance.
    expect(actualFor('m', 'ביטוח רכב', 'ins')).toBe(210)
  })
})

describe('applyLogRows — the legacy carry-over is safe to run more than once', () => {
  it('re-converting the same legacy month never doubles the money', () => {
    useMonthlyStore.setState({ months: {} })
    s().initMonth('legacy')
    const legacy = {
      ...s().months['legacy'],
      logged: [{ name: 'מזון לבית', amount: 250 }],
    }

    const once = applyLogRows(legacy, legacy.logged)
    expect(once.variable.filter(r => r.fromLog || r.logFilled).map(r => r.actual)).toEqual([250])
    expect(once.logged).toEqual([])

    // The path a stale remote doc takes: it still carries the old `logged` list,
    // so the conversion runs again over an already-converted month.
    const again = applyLogRows(once, legacy.logged)
    expect(again.variable.filter(r => r.fromLog || r.logFilled).map(r => r.actual)).toEqual([250])
  })
})
