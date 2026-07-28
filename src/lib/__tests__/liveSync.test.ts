import { describe, it, expect } from 'vitest'
import { stableStringify, deriveByAdvisor, tsToMillis } from '../liveSync'

// Shaped like a real snapshot (nested maps + row arrays), without importing the
// store graph — this suite must stay free of Firebase initialization.
const SNAPSHOT_FIXTURE = {
  version: 1,
  monthly: { months: { '2026-07': { fixed: [{ id: 'r1', name: 'שכר דירה', amount: 4200 }], logged: {} } } },
  categoryBudgets: { budgets: { 'מזון': 1000, 'דלק': 500 } },
  subscriptionPrefs: { dismissed: { 'netflix': true } },
  recurring: { rules: [], posted: {} },
  mapping: { fixed: [], variable: [], installments: [] },
}

describe('stableStringify', () => {
  it('is independent of key order (Firestore does not preserve it)', () => {
    const a = { b: 1, a: { z: [1, 2], y: 'x' } }
    const b = { a: { y: 'x', z: [1, 2] }, b: 1 }
    expect(stableStringify(a)).toBe(stableStringify(b))
  })

  it('keeps array order (rows are ordered data)', () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]))
  })

  it('survives a JSON round-trip of a snapshot-shaped document', () => {
    const roundTripped = JSON.parse(JSON.stringify(SNAPSHOT_FIXTURE))
    expect(stableStringify(roundTripped)).toBe(stableStringify(SNAPSHOT_FIXTURE))
  })

  it('matches a snapshot whose nested map keys came back reordered', () => {
    const reordered = JSON.parse(JSON.stringify(SNAPSHOT_FIXTURE))
    reordered.categoryBudgets.budgets = { 'דלק': 500, 'מזון': 1000 }   // Firestore order
    expect(stableStringify(reordered)).toBe(stableStringify(SNAPSHOT_FIXTURE))
  })

  it('does NOT match when a key was actually deleted', () => {
    const withDeletion = JSON.parse(JSON.stringify(SNAPSHOT_FIXTURE))
    delete withDeletion.categoryBudgets.budgets['מזון']
    expect(stableStringify(withDeletion)).not.toBe(stableStringify(SNAPSHOT_FIXTURE))
  })

  it('treats undefined values like JSON.stringify does (dropped)', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }))
  })

  it('handles null, empty containers and non-finite numbers', () => {
    expect(stableStringify(null)).toBe('null')
    expect(stableStringify({ a: [], b: {} })).toBe('{"a":[],"b":{}}')
    expect(stableStringify(NaN)).toBe('null')          // matches JSON.stringify
    expect(stableStringify(-0)).toBe('0')
  })
})

describe('deriveByAdvisor', () => {
  const base = { lastAdvisorEditByUid: 'advisor1', knownAdvisorEditAt: 1000, myUid: 'client1' }

  it('true when the advisor marker ADVANCED', () => {
    expect(deriveByAdvisor({ ...base, lastAdvisorEditAt: 2000 })).toBe(true)
  })

  it('false for the client own save after an old advisor edit (the marker persists)', () => {
    // This is the trap: markers stay on the doc forever, so a time window
    // would label the client's own later save as an advisor edit.
    expect(deriveByAdvisor({ ...base, lastAdvisorEditAt: 1000 })).toBe(false)
  })

  it('false when the advisor is us (our own edit echoing back)', () => {
    expect(deriveByAdvisor({ ...base, lastAdvisorEditAt: 2000, myUid: 'advisor1' })).toBe(false)
  })

  it('false when no advisor ever edited', () => {
    expect(deriveByAdvisor({ lastAdvisorEditAt: 0, lastAdvisorEditByUid: '', knownAdvisorEditAt: 0, myUid: 'c' })).toBe(false)
  })
})

describe('tsToMillis', () => {
  it('reads a Firestore Timestamp and tolerates anything else', () => {
    expect(tsToMillis({ toMillis: () => 42 })).toBe(42)
    expect(tsToMillis(undefined)).toBe(0)
    expect(tsToMillis('nope')).toBe(0)
  })
})
