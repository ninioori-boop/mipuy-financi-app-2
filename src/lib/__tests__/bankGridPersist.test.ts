import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/firebase', () => ({ auth: {}, db: {} }))
vi.mock('@/lib/firestoreService', () => ({
  saveLearnedEntry:    vi.fn().mockResolvedValue(undefined),
  loadSharedLearnedDB: vi.fn().mockResolvedValue({}),
}))

import {
  collectSnapshot, applySnapshot, resetAllStores,
  encodeBankRows, decodeBankRows, BANK_PERSIST_MAX_BYTES,
  keepOversizeGrid, restoreOversizeGrid,
} from '@/lib/dataSync'
import { useBankStore } from '@/stores/bankStore'
import { firestoreViolation } from './firestoreShape'

/**
 * 2026-08-12 incident. Firestore rejects an array nested inside an array, and
 * rejects the WHOLE document write for it. The bank tab's grid went in raw from
 * 2026-08-09, so a client who loaded a statement stopped being able to save
 * ANYTHING — mapping, monthly, expense log — and saw Firebase's raw English
 * error on screen. These tests hold the shape contract at the boundary.
 */

const GRID: unknown[][] = [
  ['תאריך', 'תיאור', 'חובה', 'זכות'],
  [new Date(2026, 6, 14), 'סופר ברקת', 312.9, ''],
  [new Date(2026, 6, 15), 'הוראת קבע חשמל', 289, ''],
  [],                                    // sheet separator row
  [new Date(2026, 6, 16), 'משכורת', '', 14200],
]

describe('bank grid — Firestore shape', () => {
  beforeEach(() => resetAllStores())

  it('a loaded statement leaves nothing Firestore would reject in the snapshot', () => {
    useBankStore.setState({ rawRows: GRID, fileName: 'osh.xlsx', sentRows: [1], reportMonths: 2 })

    expect(firestoreViolation(collectSnapshot())).toBeNull()
  })

  it('sparse rows do not smuggle undefined into the payload', () => {
    const sparse: unknown[][] = [[]]
    sparse[0][3] = 'ערך אחרון'          // indices 0..2 are holes
    useBankStore.setState({ rawRows: sparse, fileName: 'sparse.xlsx', sentRows: [], reportMonths: 1 })

    const snap = collectSnapshot()
    expect(firestoreViolation(snap)).toBeNull()
    expect(snap.bank.rawRows[0].c).toEqual([null, null, null, 'ערך אחרון'])
  })

  it('a hole in the OUTER array becomes an empty row, not undefined', () => {
    // .map would preserve the hole and hand Firestore an undefined element —
    // the same class of rejection as the nested array. No current caller builds
    // a sparse outer array, which is precisely why it would slip through.
    const holed: unknown[][] = []
    holed[2] = ['שורה שלישית']          // indices 0 and 1 are holes

    expect(encodeBankRows(holed)).toEqual([{ c: [] }, { c: [] }, { c: ['שורה שלישית'] }])
    expect(firestoreViolation(encodeBankRows(holed))).toBeNull()
  })

  it('date cells come back as real Dates, not strings or Timestamps', () => {
    // The whole bank flow keys off `instanceof Date` — pickDate, and
    // looksLikeTransaction, which decides whether a row is a charge at all.
    useBankStore.setState({ rawRows: GRID, fileName: 'osh.xlsx', sentRows: [1], reportMonths: 2 })

    const wire = JSON.parse(JSON.stringify(collectSnapshot()))   // what Firestore hands back
    resetAllStores()
    applySnapshot(wire)

    const restored = useBankStore.getState().rawRows
    expect(restored[1][0]).toBeInstanceOf(Date)
    expect((restored[1][0] as Date).getTime()).toBe(new Date(2026, 6, 14).getTime())
    expect(restored[1][1]).toBe('סופר ברקת')
    expect(restored[1][2]).toBe(312.9)
    expect(restored[3]).toEqual([])
    expect(useBankStore.getState().fileName).toBe('osh.xlsx')
    expect(useBankStore.getState().sentRows).toEqual([1])
    expect(useBankStore.getState().reportMonths).toBe(2)
  })

  it('re-encoding a restored grid is stable (no drift across saves)', () => {
    // Byte-identical, not just deep-equal: DataSync skips a save when the
    // serialized snapshot matches the last one, so drift here would mean the
    // bank tab alone re-writes the whole portfolio on every debounce.
    useBankStore.setState({ rawRows: GRID, fileName: 'osh.xlsx', sentRows: [1], reportMonths: 2 })
    const first = JSON.stringify(collectSnapshot().bank)

    applySnapshot(JSON.parse(JSON.stringify(collectSnapshot())))
    expect(JSON.stringify(collectSnapshot().bank)).toBe(first)
  })
})

describe('bank grid — legacy backups', () => {
  beforeEach(() => resetAllStores())

  it('restores a localStorage backup written in the pre-fix plain-array shape', () => {
    // JSON kept what Firestore refused, so these backups exist on real devices.
    const legacy = {
      bank: {
        rawRows: [
          ['תאריך', 'תיאור', 'סכום'],
          [new Date(2026, 6, 14).toISOString(), 'סופר ברקת', 312.9],
        ],
        fileName: 'legacy.xlsx',
        sentRows: [],
        reportMonths: 1,
      },
    }

    applySnapshot(JSON.parse(JSON.stringify(legacy)))

    const rows = useBankStore.getState().rawRows
    expect(rows[0]).toEqual(['תאריך', 'תיאור', 'סכום'])
    expect(rows[1][0]).toBeInstanceOf(Date)          // revived, so dates still show
    expect(rows[1][1]).toBe('סופר ברקת')

    // …and the next save is a legal document again.
    expect(firestoreViolation(collectSnapshot())).toBeNull()
  })

  it('leaves ordinary text alone when reviving a legacy grid', () => {
    applySnapshot({
      bank: { rawRows: [['14/07/2026', '2026-07-14', 'ISO-ish? no']], fileName: 'x', sentRows: [], reportMonths: 1 },
    })
    expect(useBankStore.getState().rawRows[0]).toEqual(['14/07/2026', '2026-07-14', 'ISO-ish? no'])
  })

  it('a garbage grid is skipped, not thrown on', () => {
    expect(() => applySnapshot({ bank: { rawRows: 'not a grid' } })).not.toThrow()
    expect(useBankStore.getState().rawRows).toEqual([])
    expect(decodeBankRows(undefined)).toBeNull()
    expect(decodeBankRows([null, 7, { c: 'not an array' }])).toEqual([[], [], []])
  })
})

describe('bank grid — size ceiling', () => {
  beforeEach(() => resetAllStores())

  it('drops an oversized grid from the snapshot instead of eating the 900KB budget', () => {
    const huge: unknown[][] = Array.from({ length: 4000 }, (_, i) => [
      new Date(2026, 0, 1), `תנועה מספר ${i} בחשבון העובר ושב`, i * 1.5, '',
    ])
    useBankStore.setState({ rawRows: huge, fileName: 'huge.xlsx', sentRows: [3], reportMonths: 1 })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const snap = collectSnapshot()

    expect(new TextEncoder().encode(JSON.stringify(huge)).length).toBeGreaterThan(BANK_PERSIST_MAX_BYTES)
    expect(snap.bank.rawRows).toEqual([])
    // fileName goes too: kept alone, the tab would tell the user the FILE was
    // unreadable ("לא זוהו עסקאות בקובץ") for a call we made about size.
    expect(snap.bank.fileName).toBe('')
    expect(snap.bank.reportMonths).toBe(1)
    expect(warn).toHaveBeenCalled()
    // The open session still has every row.
    expect(useBankStore.getState().rawRows).toHaveLength(4000)

    // Stable between calls. DataSync skips the write when the serialized
    // snapshot equals the last one, so a dropped grid that looked different
    // every time would re-write the whole portfolio every 2 seconds, forever.
    expect(JSON.stringify(collectSnapshot())).toBe(JSON.stringify(snap))
    warn.mockRestore()
  })

  it('picks up a new grid after the store swaps it (the encode cache invalidates)', () => {
    useBankStore.setState({ rawRows: GRID, fileName: 'a.xlsx', sentRows: [], reportMonths: 1 })
    expect(collectSnapshot().bank.rawRows).toHaveLength(GRID.length)

    useBankStore.getState().setData([['שורה אחת']], 'b.xlsx')
    const after = collectSnapshot().bank
    expect(after.rawRows).toEqual([{ c: ['שורה אחת'] }])
    expect(after.fileName).toBe('b.xlsx')

    useBankStore.getState().reset()
    expect(collectSnapshot().bank.rawRows).toEqual([])
  })

  it('an unsaveable grid survives the live-sync apply that would erase it', () => {
    // applyRemote() = resetAllStores() + applySnapshot(remote), within ONE
    // identity. For a grid the cloud never accepted, that reset is destruction:
    // the advisor saving, or the user's own phone, would wipe a statement out
    // from under someone reviewing it. Recovery costs another paid extraction.
    const huge: unknown[][] = Array.from({ length: 4000 }, (_, i) => [
      new Date(2026, 0, 1), `תנועה מספר ${i} בחשבון העובר ושב`, i * 1.5, '',
    ])
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    useBankStore.setState({ rawRows: huge, fileName: 'huge.xlsx', sentRows: [7], reportMonths: 3 })
    const remote = JSON.parse(JSON.stringify(collectSnapshot()))   // grid absent, by design

    const kept = keepOversizeGrid()
    resetAllStores()
    applySnapshot(remote)
    restoreOversizeGrid(kept)

    expect(useBankStore.getState().rawRows).toHaveLength(4000)
    expect(useBankStore.getState().fileName).toBe('huge.xlsx')
    expect(useBankStore.getState().sentRows).toEqual([7])
    expect(useBankStore.getState().reportMonths).toBe(3)
    vi.mocked(console.warn).mockRestore()
  })

  it('a saveable grid is NOT carried over — an empty one from the cloud means "cleared elsewhere"', () => {
    useBankStore.setState({ rawRows: GRID, fileName: 'small.xlsx', sentRows: [], reportMonths: 1 })
    expect(keepOversizeGrid()).toBeNull()

    // The other device pressed "נקה והתחל מחדש"; that must stick.
    const kept = keepOversizeGrid()
    resetAllStores()
    applySnapshot({ bank: { rawRows: [], fileName: '', sentRows: [], reportMonths: 1 } })
    restoreOversizeGrid(kept)

    expect(useBankStore.getState().rawRows).toEqual([])
    expect(useBankStore.getState().fileName).toBe('')
  })

  it('a normal statement is well under the ceiling', () => {
    const typical: unknown[][] = Array.from({ length: 300 }, (_, i) => [
      new Date(2026, 0, 1), `בית קפה ${i}`, 42.5, '',
    ])
    const bytes = new TextEncoder().encode(JSON.stringify(encodeBankRows(typical))).length
    expect(bytes).toBeLessThan(BANK_PERSIST_MAX_BYTES)
  })
})
