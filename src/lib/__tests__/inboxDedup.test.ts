import { describe, it, expect } from 'vitest'
import { alreadyDrained } from '../inboxDedup'
import type { ExpenseEntry } from '@/stores/expenseLogStore'

/**
 * The re-drain double-log guard (2026-08-05 audit, A5): most captures carry no
 * ref (the route writes ref:null for the iOS shortcut), so the old ref-only
 * check could not recognise an inbox item that survived a tab killed between
 * save-ack and the inbox deleteDoc — next session re-drained it and the charge
 * appeared TWICE in the client's expense log.
 */

const entry = (over: Partial<ExpenseEntry>): ExpenseEntry => ({
  id: 'e1', date: '2026-08-05', amount: 14, category: 'תחבורה', note: 'רב קו',
  createdAt: 1, ...over,
})

describe('alreadyDrained', () => {
  it('catches a re-drain by inbox id even when the capture carried no ref (the iOS case)', () => {
    expect(alreadyDrained([entry({ src: 'inbox123' })], 'inbox123', '')).toBe(true)
  })

  it('still catches entries drained before src existed, by their #ref note suffix', () => {
    expect(alreadyDrained([entry({ note: 'רב קו #r9' })], 'newInboxId', 'r9')).toBe(true)
  })

  it('does NOT swallow a genuine identical purchase — different inbox item, same merchant+amount+day', () => {
    expect(alreadyDrained([entry({ src: 'inboxAAA' })], 'inboxBBB', '')).toBe(false)
  })

  it('an empty ref matches nothing', () => {
    expect(alreadyDrained([entry({ note: 'רב קו #' })], 'freshId', '')).toBe(false)
  })
})
