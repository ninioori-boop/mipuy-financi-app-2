import { describe, it, expect, vi } from 'vitest'

/**
 * The household's own corrections, on the phone-capture path.
 *
 * Until 2026-08-17 this route categorized a captured charge from the SHARED
 * pool alone. Everywhere else in the app the personal dict outranks the shared
 * one (mergedLearnedDB is `{...shared, ...own}`), so this was the single place
 * where the precedence was inverted: a client could correct a merchant, watch
 * every screen respect it, and have the next charge from their phone come back
 * with the old answer — forever, because correcting again changed nothing here.
 *
 * 🔴 The guard worth testing is the rail filter. It is the one thing that, if
 * missed, makes the change WORSE than before: a stale personal
 * "bit → אוכל בחוץ" is neutralized on every screen, and would now win here,
 * where the personal dict outranks the pool, on every captured Bit transfer.
 */

// The route module pulls in the whole admin/AI/push stack at import time.
// Stubbed to nothing: `ownLearned` is pure and touches none of it.
vi.mock('@/lib/firebaseAdmin', () => ({ getAdminDb: () => null, getAdminAuth: () => null }))
vi.mock('@/lib/aiCategorize',  () => ({ aiCategorizeOne: async () => null }))
vi.mock('@/lib/webPush',       () => ({ sendPushToUser: async () => {} }))
vi.mock('@/lib/aiBudget',      () => ({ checkAiBudget: async () => ({ stopped: false }) }))
vi.mock('@/lib/aiQuota',       () => ({ checkAiQuota: async () => ({ allowed: false }) }))

import { ownLearned } from '@/app/api/transaction/route'

const withLearned = (learnedDB: unknown) => ({ credit: { learnedDB } })

describe('ownLearned — the household\'s own corrections', () => {
  it('returns the account\'s corrections', () => {
    expect(ownLearned(withLearned({ 'מגדל/טלפון': 'השקעות' })))
      .toEqual({ 'מגדל/טלפון': 'השקעות' })
  })

  // 🔴 The guard. Rails are dropped from the shared side at read time for the
  // same reason; filtering only one side would be worse than filtering neither.
  it('drops payment rails, which would otherwise now outrank the pool', () => {
    const out = ownLearned(withLearned({
      'bit': 'אוכל בחוץ ובילויים',
      'ביט': 'מתנות',
      'העברה ב ביט': 'מתנות',
      'שופרסל דיל': 'מזון לבית',
    }))
    expect(out).toEqual({ 'שופרסל דיל': 'מזון לבית' })
  })

  // ביטוח contains ביט as a substring. Whole-word matching is what keeps real
  // insurance corrections working, and this pins it on this path too.
  it('keeps an insurance merchant that merely contains the rail letters', () => {
    const out = ownLearned(withLearned({ 'ביטוח הראל': 'ביטוח' }))
    expect(out).toEqual({ 'ביטוח הראל': 'ביטוח' })
  })

  it('is empty rather than throwing on every shape that is not a dict', () => {
    expect(ownLearned(null)).toEqual({})
    expect(ownLearned({})).toEqual({})
    expect(ownLearned({ credit: null } as unknown as Record<string, unknown>)).toEqual({})
    expect(ownLearned(withLearned(undefined))).toEqual({})
    expect(ownLearned(withLearned('not a dict'))).toEqual({})
    expect(ownLearned(withLearned([]))).toEqual({})
  })

  it('ignores entries whose category is not a usable string', () => {
    const out = ownLearned(withLearned({ a: 1, b: null, c: '', d: 'מזון לבית' }))
    expect(out).toEqual({ d: 'מזון לבית' })
  })

  // The precedence the route relies on, stated as a test so a future reorder of
  // the spread cannot silently invert it back.
  it('wins over the shared pool when merged the way the route merges it', () => {
    const shared = { 'מגדל/טלפון': 'ביטוח', 'שופרסל': 'מזון לבית' }
    const own    = ownLearned(withLearned({ 'מגדל/טלפון': 'השקעות' }))
    expect({ ...shared, ...own }).toEqual({
      'מגדל/טלפון': 'השקעות',     // the household's own answer
      'שופרסל':     'מזון לבית',  // the pool still supplies everything else
    })
  })
})
