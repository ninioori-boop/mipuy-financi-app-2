import { describe, it, expect } from 'vitest'
import { trackingStatus, emptyFin, TRACKING_STALE_DAYS, type MockClient } from '@/lib/advisorMock'

const daysAgoIso = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)

function client(over: Partial<MockClient> = {}): MockClient {
  return {
    id: 'c1', name: 'לקוח', email: 'c@x.com',
    lifecycle: 'active', stage: 3, lastActivity: daysAgoIso(1),
    flags: [], fin: emptyFin(),
    ...over,
  }
}

describe('trackingStatus', () => {
  it('is null when engagement data is unknown (mock clients)', () => {
    expect(trackingStatus(client())).toBeNull()
  })

  it('is null for non-active clients even with data', () => {
    expect(trackingStatus(client({ lifecycle: 'pending', expensesLast7: 0 }))).toBeNull()
    expect(trackingStatus(client({ lifecycle: 'graduated', expensesLast7: 3, lastExpenseAt: daysAgoIso(1) }))).toBeNull()
  })

  it('stays quiet for a never-logging client before the תקציב stage', () => {
    expect(trackingStatus(client({ stage: 0, expensesLast7: 0 }))).toBeNull()
    expect(trackingStatus(client({ stage: 1, expensesLast7: 0 }))).toBeNull()
  })

  it('flags "never" from the תקציב stage onward', () => {
    expect(trackingStatus(client({ stage: 2, expensesLast7: 0 }))).toEqual({ kind: 'never' })
    expect(trackingStatus(client({ stage: 4, expensesLast7: 0 }))).toEqual({ kind: 'never' })
  })

  it('reports ok with the weekly count while the client keeps logging', () => {
    const s = trackingStatus(client({ expensesLast7: 4, lastExpenseAt: daysAgoIso(1) }))
    expect(s).toEqual({ kind: 'ok', last7: 4 })
  })

  it(`turns stale after ${TRACKING_STALE_DAYS} quiet days`, () => {
    const s = trackingStatus(client({ expensesLast7: 0, lastExpenseAt: daysAgoIso(TRACKING_STALE_DAYS + 1) }))
    expect(s?.kind).toBe('stale')
    if (s?.kind === 'stale') expect(s.days).toBeGreaterThanOrEqual(TRACKING_STALE_DAYS)
  })

  it('stays ok just under the threshold', () => {
    const s = trackingStatus(client({ expensesLast7: 1, lastExpenseAt: daysAgoIso(TRACKING_STALE_DAYS - 2) }))
    expect(s?.kind).toBe('ok')
  })
})
