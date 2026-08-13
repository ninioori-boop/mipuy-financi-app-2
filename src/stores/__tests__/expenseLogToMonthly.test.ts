import { describe, it, expect, beforeEach } from 'vitest'
import { useMonthlyStore, applyLogRows } from '@/stores/monthlyStore'
import { isAutoCaptured } from '@/stores/expenseLogStore'

// The expense-log (תיעוד הוצאות) journal feeds ביצוע in the monthly tab, and
// what a journal entry is worth there depends on WHO produced it:
//
//   typed by a person   → cash and Bit the credit report never sees.  ADDED on
//                         top of whatever the report reports.
//   captured by machine → an Apple/Google Pay charge or a recurring rule. The
//                         report is about to restate it, so the report WINS.
//
// Without that split the app double-counts every card purchase of every client
// who both logs and imports, month after month, with nobody doing anything
// wrong. These tests exist to keep that from coming back.

const CAT = 'אוכל בחוץ ובילויים'   // variable
const SECTIONS = ['fixed', 'variable', 'sub', 'ins'] as const
const s = () => useMonthlyStore.getState()

const manual = (name: string, amount: number) => ({ name, manual: amount, auto: 0 })
const auto   = (name: string, amount: number) => ({ name, manual: 0, auto: amount })

function rowsFor(monthId: string, name: string, section: typeof SECTIONS[number] = 'variable') {
  return s().months[monthId][section].filter(r => r.name === name)
}
function actualFor(monthId: string, name: string, section: typeof SECTIONS[number] = 'variable') {
  return rowsFor(monthId, name, section).reduce((t, r) => t + r.actual, 0)
}
function journalRows(monthId: string) {
  const m = s().months[monthId]
  return SECTIONS.flatMap(sec => m[sec].filter(r => r.logManual || r.logAuto))
}
const importOf = (monthId: string, sums: Record<string, number>) =>
  s().applyImport(monthId, sums, [], [], [], [], [], [], [], 1)

describe('isAutoCaptured — telling a machine entry from a typed one', () => {
  it('an entry drained from the phone inbox is machine-made', () => {
    expect(isAutoCaptured({ note: 'שופרסל', src: 'inbox-1' })).toBe(true)
  })
  it('a deep-link capture is machine-made, by its #ref tag', () => {
    expect(isAutoCaptured({ note: 'רמי לוי #a1b2' })).toBe(true)
  })
  it('a recurring rule is machine-made — the statement will report it too', () => {
    expect(isAutoCaptured({ note: 'שכר דירה · הוצאה קבועה ⟳' })).toBe(true)
  })
  it('a plain typed note is not', () => {
    expect(isAutoCaptured({ note: 'קפה עם דנה' })).toBe(false)
    expect(isAutoCaptured({ note: '' })).toBe(false)
  })

  // The bot posts to /api/transaction just like the phone automation does, so
  // these entries carry BOTH src and a #ref tag. Only the wa: prefix separates
  // "a client texted me what they bought" from "a card charge was captured".
  it('an expense a client sent to the WhatsApp bot is person-made', () => {
    expect(isAutoCaptured({ note: 'סופר #wa:wamid.HBgMOTcy', src: 'inbox-9' })).toBe(false)
  })
  it('a merchant that merely contains "wa" is still machine-made', () => {
    expect(isAutoCaptured({ note: 'ואטסון #a1b2', src: 'inbox-3' })).toBe(true)
  })
})

describe('hand-typed journal money is added on top of the report', () => {
  beforeEach(() => useMonthlyStore.setState({ months: {} }))

  it('cash on top of a reported category, whichever way round', () => {
    const run = (importFirst: boolean) => {
      useMonthlyStore.setState({ months: {} })
      s().initMonth('m')
      s().syncFromMapping([], [{ name: CAT, amount: 328 }], [], [], [], [], [], 1, 'm')
      const imp = () => importOf('m', { [CAT]: 500 })
      const log = () => s().applyExpenseLog('m', [manual(CAT, 200)])
      if (importFirst) { imp(); log() } else { log(); imp() }
      return rowsFor('m', CAT).map(r => ({ plan: r.plan, actual: r.actual, logManual: r.logManual }))
    }
    // 500 reported + 200 cash = 700, on the one planned row.
    const expected = [{ plan: 328, actual: 700, logManual: 200 }]
    expect(run(true)).toEqual(expected)
    expect(run(false)).toEqual(expected)
  })

  it('captured money is dropped in a reported category, whichever way round', () => {
    const run = (importFirst: boolean) => {
      useMonthlyStore.setState({ months: {} })
      s().initMonth('m')
      const imp = () => importOf('m', { [CAT]: 500 })
      const log = () => s().applyExpenseLog('m', [auto(CAT, 500)])
      if (importFirst) { imp(); log() } else { log(); imp() }
      return actualFor('m', CAT)
    }
    expect(run(true)).toBe(500)    // not 1000
    expect(run(false)).toBe(500)
  })

  it('a mixed category keeps the cash and drops the card charges', () => {
    s().initMonth('m')
    s().applyExpenseLog('m', [{ name: CAT, manual: 200, auto: 500 }])
    expect(actualFor('m', CAT)).toBe(700)      // no report yet: everything counts
    importOf('m', { [CAT]: 1200 })
    // The 500 was inside the 1200. The 200 of cash was not.
    expect(actualFor('m', CAT)).toBe(1400)
    expect(rowsFor('m', CAT)[0].logManual).toBe(200)
    expect(rowsFor('m', CAT)[0].logAuto).toBeUndefined()
  })

  it('a category the report never mentions keeps everything the journal had', () => {
    s().initMonth('m')
    s().applyExpenseLog('m', [{ name: 'ביט ללא מעקב', manual: 300, auto: 86 }, auto(CAT, 500)])
    importOf('m', { [CAT]: 500 })
    expect(actualFor('m', 'ביט ללא מעקב')).toBe(386)
    expect(actualFor('m', CAT)).toBe(500)
  })

  it('a report that reports ZERO for a category does not blank the journal', () => {
    s().initMonth('m')
    s().applyExpenseLog('m', [auto(CAT, 525)])
    importOf('m', { [CAT]: 0 })
    expect(actualFor('m', CAT)).toBe(525)
  })

  it('importing twice does not stack the cash a second time', () => {
    s().initMonth('m')
    s().applyExpenseLog('m', [manual(CAT, 200)])
    importOf('m', { [CAT]: 500 })
    importOf('m', { [CAT]: 500 })
    expect(actualFor('m', CAT)).toBe(700)
  })
})

describe('one category, one row', () => {
  beforeEach(() => useMonthlyStore.setState({ months: {} }))

  it('the journal fills an empty planned row instead of opening a second one', () => {
    s().initMonth('m')
    s().syncFromMapping([], [{ name: CAT, amount: 328 }], [], [], [], [], [], 1, 'm')
    s().applyExpenseLog('m', [auto(CAT, 525)])
    expect(rowsFor('m', CAT)).toEqual([
      expect.objectContaining({ plan: 328, actual: 525, logAuto: 525 }),
    ])
  })

  it('a category with no row at all gets one created for it', () => {
    s().initMonth('m')
    s().applyExpenseLog('m', [auto('ציוד עסקי/משרדי', 324)])
    expect(rowsFor('m', 'ציוד עסקי/משרדי')).toEqual([
      expect.objectContaining({ plan: 0, actual: 324, fromLog: true }),
    ])
  })

  it('an advisor figure typed by hand is never overwritten by the journal', () => {
    s().initMonth('m')
    s().syncFromMapping([], [{ name: CAT, amount: 328 }], [], [], [], [], [], 1, 'm')
    const row = rowsFor('m', CAT)[0]
    s().updateRow('m', 'variable', row.id, 'actual', 900)
    s().applyExpenseLog('m', [auto(CAT, 525)])
    expect(rowsFor('m', CAT)).toHaveLength(1)
    expect(actualFor('m', CAT)).toBe(900)
  })
})

describe('transferring again recomputes, never accumulates', () => {
  beforeEach(() => useMonthlyStore.setState({ months: {} }))

  it('a created row is replaced, not stacked', () => {
    s().initMonth('m')
    s().applyExpenseLog('m', [auto(CAT, 525)])
    s().applyExpenseLog('m', [auto(CAT, 700)])
    expect(rowsFor('m', CAT)).toHaveLength(1)
    expect(actualFor('m', CAT)).toBe(700)
  })

  it('the cash sitting on a reported row is replaced, not stacked', () => {
    s().initMonth('m')
    importOf('m', { [CAT]: 500 })
    s().applyExpenseLog('m', [manual(CAT, 200)])
    s().applyExpenseLog('m', [manual(CAT, 300)])
    expect(actualFor('m', CAT)).toBe(800)     // 500 reported + the newer 300
  })

  it('a planned row the journal no longer covers is emptied, never deleted', () => {
    s().initMonth('m')
    s().syncFromMapping([], [{ name: CAT, amount: 328 }], [], [], [], [], [], 1, 'm')
    s().applyExpenseLog('m', [auto(CAT, 525)])
    s().applyExpenseLog('m', [auto('פארם', 60)])

    const rows = rowsFor('m', CAT)
    expect(rows).toHaveLength(1)
    expect(rows[0].plan).toBe(328)     // the client's planned line survives
    expect(rows[0].actual).toBe(0)     // with no stale journal money on it
    expect(rows[0].logAuto).toBeUndefined()
  })

  it('a reported row the journal no longer covers keeps the reported figure', () => {
    s().initMonth('m')
    importOf('m', { [CAT]: 500 })
    s().applyExpenseLog('m', [manual(CAT, 200)])
    s().applyExpenseLog('m', [manual('פארם', 60)])
    expect(actualFor('m', CAT)).toBe(500)
  })

  it('a hand edit makes the row the client’s own, and the next transfer leaves it', () => {
    s().initMonth('m')
    s().applyExpenseLog('m', [auto(CAT, 525)])
    const row = rowsFor('m', CAT)[0]
    s().updateRow('m', 'variable', row.id, 'actual', 480)
    expect(rowsFor('m', CAT)[0].logAuto).toBeUndefined()

    s().applyExpenseLog('m', [auto(CAT, 700)])
    expect(rowsFor('m', CAT)).toHaveLength(1)
    expect(actualFor('m', CAT)).toBe(480)
  })
})

describe('routing and totals', () => {
  beforeEach(() => useMonthlyStore.setState({ months: {} }))

  const JOURNAL = [
    auto(CAT, 525),                 // variable
    auto('חופשה וטיול', 296),       // annual → variable
    auto('גז', 340),                // fixed
    auto('מנויים', 60),             // sub
    auto('ביטוח רכב', 210),         // ins
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
    expect(journalRows('m').reduce((t, r) => t + (r.logManual ?? 0) + (r.logAuto ?? 0), 0))
      .toBe(JOURNAL.reduce((t, i) => t + i.manual + i.auto, 0))
  })

  it('income, savings and transfers are not spending and never become expense rows', () => {
    s().initMonth('m')
    s().applyExpenseLog('m', [
      manual('הכנסות', 9000), manual('חסכונות', 500),
      manual('העברות ואשראי', 300), manual('מזון לבית', 100),
    ])
    expect(journalRows('m').map(r => r.name)).toEqual(['מזון לבית'])
  })

  it('an unrecognised label still carries its money in, as a variable expense', () => {
    s().initMonth('m')
    s().applyExpenseLog('m', [manual('קטגוריה שהומצאה', 77)])
    expect(actualFor('m', 'קטגוריה שהומצאה')).toBe(77)
  })

  it('zero and negative amounts produce no row', () => {
    s().initMonth('m')
    s().applyExpenseLog('m', [manual('מזון לבית', 0), manual('פארם', -50)])
    expect(journalRows('m')).toHaveLength(0)
  })
})

describe('mapping still reaches a category the journal is holding', () => {
  beforeEach(() => useMonthlyStore.setState({ months: {} }))

  it('syncFromMapping puts the plan into the journal row rather than beside it', () => {
    s().initMonth('m')
    s().applyExpenseLog('m', [auto('גז', 340)])
    const sync = () => s().syncFromMapping([{ name: 'גז', amount: 300 }], [], [], [], [], [], [], 1, 'm')
    sync()
    expect(rowsFor('m', 'גז', 'fixed')).toEqual([
      expect.objectContaining({ plan: 300, actual: 340, fromLog: true }),
    ])
    sync()
    expect(rowsFor('m', 'גז', 'fixed')).toHaveLength(1)
  })

  it('an import carrying a mapping plan does the same', () => {
    s().initMonth('m')
    s().applyExpenseLog('m', [auto('ציוד עסקי/משרדי', 324)])
    s().applyImport('m', {}, [], [{ name: 'ציוד עסקי/משרדי', amount: 400 }], [], [], [], [], [], 1)
    expect(rowsFor('m', 'ציוד עסקי/משרדי')).toEqual([
      expect.objectContaining({ plan: 400, actual: 324 }),
    ])
  })

  it('a per-business import still fills its named row beside an untouched journal row', () => {
    s().initMonth('m')
    s().applyExpenseLog('m', [auto('ביטוח רכב', 210)])
    s().applyImport(
      'm', { 'ביטוח חיים': 800 }, [], [], [], [{ name: 'הראל', amount: 800 }], [], [], [], 1,
      [{ name: 'הראל', amount: 800, category: 'ביטוח חיים' }],
    )
    expect(s().months['m'].ins.find(r => r.name === 'הראל')?.actual).toBe(800)
    expect(actualFor('m', 'ביטוח רכב', 'ins')).toBe(210)
  })
})

describe('applyLogRows — the legacy carry-over is safe to run more than once', () => {
  it('re-converting the same legacy month never doubles the money', () => {
    useMonthlyStore.setState({ months: {} })
    s().initMonth('legacy')
    const base = { ...s().months['legacy'], logged: [{ name: 'מזון לבית', amount: 250 }] }
    // dataSync converts the old totals as CAPTURED money, the reading that
    // cannot inflate a client's spending.
    const asItems = base.logged.map(l => ({ name: l.name, manual: 0, auto: l.amount }))

    const once = applyLogRows(base, asItems)
    expect(once.variable.filter(r => r.logAuto).map(r => r.actual)).toEqual([250])
    expect(once.logged).toEqual([])

    // The path a stale remote doc takes: it still carries the old list, so the
    // conversion runs again over an already-converted month.
    const again = applyLogRows(once, asItems)
    expect(again.variable.filter(r => r.logAuto).map(r => r.actual)).toEqual([250])
  })
})

// ── Bit ────────────────────────────────────────────────────────────────────
// A Bit transfer is captured by the phone under the recipient's name, filed as
// "ביט ללא מעקב", and the expenses tab then invites the client to move it to the
// category it really belongs to. The credit report never learns any of that: it
// reports the same shekels as one opaque rail line. So Bit money is ADDED to
// whatever category it now sits in, and the report's rail line is reduced by the
// same amount. Counted once, filed where the client said it belongs.
describe('Bit is reconciled against the report’s rail line', () => {
  const RAIL = 'ביט ללא מעקב'
  const bit = (name: string, amount: number) => ({ name, manual: 0, auto: 0, bit: amount })
  const railOf = (monthId: string) => actualFor(monthId, RAIL)

  beforeEach(() => useMonthlyStore.setState({ months: {} }))

  it('a re-filed transfer keeps the client’s category and empties the rail line', () => {
    const run = (importFirst: boolean) => {
      useMonthlyStore.setState({ months: {} })
      s().initMonth('m')
      const imp = () => importOf('m', { 'מזון לבית': 1200, [RAIL]: 100 })
      const log = () => s().applyExpenseLog('m', [bit('מזון לבית', 100)])
      if (importFirst) { imp(); log() } else { log(); imp() }
      return { food: actualFor('m', 'מזון לבית'), rail: railOf('m') }
    }
    // 1300 total: the report's 1200 of card spending plus 100 of Bit, filed
    // under food rather than left on the rail line. Not 1400, not 1300+100.
    const expected = { food: 1300, rail: 0 }
    expect(run(true)).toEqual(expected)
    expect(run(false)).toEqual(expected)
  })

  it('a transfer the client never re-filed is counted once, not twice', () => {
    s().initMonth('m')
    s().applyExpenseLog('m', [bit(RAIL, 100)])
    expect(railOf('m')).toBe(100)      // before any report
    importOf('m', { [RAIL]: 100 })
    expect(railOf('m')).toBe(100)      // and after one
  })

  it('what the journal could not explain stays on the rail line', () => {
    s().initMonth('m')
    s().applyExpenseLog('m', [bit('מזון לבית', 300)])
    importOf('m', { [RAIL]: 500 })
    expect(actualFor('m', 'מזון לבית')).toBe(300)
    expect(railOf('m')).toBe(200)      // 500 reported − 300 already explained
  })

  it('more Bit than the report shows never drives the rail line negative', () => {
    s().initMonth('m')
    s().applyExpenseLog('m', [bit('מזון לבית', 300)])
    importOf('m', { [RAIL]: 100 })
    expect(railOf('m')).toBe(0)
    expect(actualFor('m', 'מזון לבית')).toBe(300)
  })

  it('importing twice does not shrink the rail line twice', () => {
    s().initMonth('m')
    s().applyExpenseLog('m', [bit('מזון לבית', 300)])
    importOf('m', { [RAIL]: 500 })
    importOf('m', { [RAIL]: 500 })
    expect(railOf('m')).toBe(200)
  })

  it('transferring twice does not shrink the rail line twice', () => {
    s().initMonth('m')
    importOf('m', { [RAIL]: 500 })
    s().applyExpenseLog('m', [bit('מזון לבית', 300)])
    s().applyExpenseLog('m', [bit('מזון לבית', 300)])
    expect(railOf('m')).toBe(200)
    expect(actualFor('m', 'מזון לבית')).toBe(300)
  })

  it('when the Bit entries are gone, the report’s rail money comes back in full', () => {
    s().initMonth('m')
    importOf('m', { [RAIL]: 500 })
    s().applyExpenseLog('m', [bit('מזון לבית', 300)])
    expect(railOf('m')).toBe(200)
    // Next transfer: the client deleted those journal entries.
    s().applyExpenseLog('m', [manual('פארם', 60)])
    expect(railOf('m')).toBe(500)
  })

  it('cash, card and Bit in one category each do their own thing', () => {
    s().initMonth('m')
    s().applyExpenseLog('m', [{ name: 'מזון לבית', manual: 50, auto: 500, bit: 100 }])
    importOf('m', { 'מזון לבית': 1200, [RAIL]: 100 })
    // 1200 reported (contains the 500 captured from the card) + 50 cash + 100 Bit.
    expect(actualFor('m', 'מזון לבית')).toBe(1350)
    expect(railOf('m')).toBe(0)
  })

  it('a report with no rail line at all leaves the Bit money alone', () => {
    s().initMonth('m')
    s().applyExpenseLog('m', [bit('מזון לבית', 100)])
    importOf('m', { 'מזון לבית': 1200 })
    expect(actualFor('m', 'מזון לבית')).toBe(1300)
    expect(railOf('m')).toBe(0)
  })
})
