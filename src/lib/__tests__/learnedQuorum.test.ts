import { describe, it, expect } from 'vitest'
import {
  foldProposal, proposalDocId, voterId, LEARN_QUORUM, MAX_PROPOSAL_UIDS,
  type ProposalDoc,
} from '@/lib/learnedQuorum'

/**
 * The rule that decides whether ~40 households get a new merchant→category
 * mapping. It is pure precisely so this file can hold it to account without an
 * emulator: the failure mode here is not a crash, it is every client quietly
 * learning something one person got wrong.
 */

describe('foldProposal', () => {
  it('records the first household without writing anything shared', () => {
    const r = foldProposal(undefined, 'מגדל/טלפון', 'השקעות', 'uidA')
    expect(r.votes).toBe(1)
    expect(r.promote).toBe(false)
    expect(r.next.byCategory['השקעות']).toEqual(['uidA'])
  })

  it('promotes on the call that brings the second household', () => {
    const first = foldProposal(undefined, 'מגדל/טלפון', 'השקעות', 'uidA')
    const r = foldProposal(first.next, 'מגדל/טלפון', 'השקעות', 'uidB')
    expect(r.votes).toBe(LEARN_QUORUM)
    expect(r.promote).toBe(true)
  })

  // 🔴 The hole the whole mechanism exists to close. One account re-sending the
  // same correction must never look like agreement.
  it('never lets one household vote twice', () => {
    let doc: ProposalDoc | undefined
    for (let i = 0; i < 5; i++) {
      const r = foldProposal(doc, 'שופרסל דיל', 'מזון לבית', 'uidA')
      expect(r.votes).toBe(1)
      expect(r.promote).toBe(false)
      expect(r.duplicate).toBe(i > 0)
      doc = r.next
    }
  })

  // 🔴 Grill finding, and the reason `duplicate` is NOT part of the promote
  // condition. The votes commit in a transaction and the pool write happens
  // after it; if that write fails, the entry sits at quorum with nothing in the
  // pool. When promotion required a NEW voter, every retry by the same two
  // households was a repeat, and only a third household could ever rescue it.
  // The route returns early when the pool already holds this answer, so
  // reaching the fold at all means it does not.
  it('lets a repeat re-promote, so a failed pool write can be retried', () => {
    const a = foldProposal(undefined, 'k', 'מזון לבית', 'uidA')
    const b = foldProposal(a.next, 'k', 'מזון לבית', 'uidB')
    expect(b.promote).toBe(true)

    const retry = foldProposal(b.next, 'k', 'מזון לבית', 'uidA')
    expect(retry.duplicate).toBe(true)
    expect(retry.votes).toBe(2)
    expect(retry.promote).toBe(true)
  })

  // Two households disagreeing is a real thing. Whoever reaches two first wins;
  // collapsing to "the latest answer" would restore the single-voice veto.
  it('keeps competing categories side by side', () => {
    const a = foldProposal(undefined, 'k', 'מזון לבית', 'uidA')
    const b = foldProposal(a.next, 'k', 'אוכל בחוץ ובילויים', 'uidB')
    expect(b.promote).toBe(false)
    expect(b.next.byCategory['מזון לבית']).toEqual(['uidA'])
    expect(b.next.byCategory['אוכל בחוץ ובילויים']).toEqual(['uidB'])

    const c = foldProposal(b.next, 'k', 'אוכל בחוץ ובילויים', 'uidC')
    expect(c.promote).toBe(true)
    // The losing category's evidence survives — it may yet reach two itself.
    expect(c.next.byCategory['מזון לבית']).toEqual(['uidA'])
  })

  // 🔴 Grill finding. Without the rival check, once two categories each hold
  // two backers EVERY further vote on either side re-fires promotion — רמי לוי
  // would swing between מזון לבית and אוכל בחוץ for all 40 clients, forever, on
  // every correction anyone makes.
  it('does not flip the pool on a tie, and only moves it on being strictly ahead', () => {
    let doc = foldProposal(undefined, 'רמי לוי', 'מזון לבית', 'uidA').next
    const promoted = foldProposal(doc, 'רמי לוי', 'מזון לבית', 'uidB')
    expect(promoted.promote).toBe(true)          // 2 vs 0
    doc = promoted.next

    doc = foldProposal(doc, 'רמי לוי', 'אוכל בחוץ ובילויים', 'uidC').next
    const tie = foldProposal(doc, 'רמי לוי', 'אוכל בחוץ ובילויים', 'uidD')
    expect(tie.votes).toBe(2)
    expect(tie.rival).toBe(2)
    expect(tie.promote).toBe(false)              // 2 vs 2 — the pool stays put
    doc = tie.next

    const ahead = foldProposal(doc, 'רמי לוי', 'אוכל בחוץ ובילויים', 'uidE')
    expect(ahead.votes).toBe(3)
    expect(ahead.promote).toBe(true)             // 3 vs 2 — now it moves
  })

  it('reports the rival count so the log can explain a refusal', () => {
    const a = foldProposal(undefined, 'k', 'מזון לבית', 'uidA')
    expect(a.rival).toBe(0)
    const b = foldProposal(a.next, 'k', 'אוכל בחוץ ובילויים', 'uidB')
    expect(b.rival).toBe(1)
  })

  // 🔴 The cap drops the OLDEST uid. It must never drop the count below quorum
  // on the very call that would have promoted.
  it('caps the stored voters without ever lowering the vote below quorum', () => {
    let doc: ProposalDoc | undefined
    for (let i = 0; i < MAX_PROPOSAL_UIDS + 4; i++) {
      const r = foldProposal(doc, 'k', 'מזון לבית', `uid${i}`)
      expect(r.votes).toBeGreaterThanOrEqual(Math.min(i + 1, LEARN_QUORUM))
      doc = r.next
    }
    expect(doc!.byCategory!['מזון לבית']).toHaveLength(MAX_PROPOSAL_UIDS)
    // The newest evidence is what survives the cap.
    expect(doc!.byCategory!['מזון לבית']).toContain(`uid${MAX_PROPOSAL_UIDS + 3}`)
    expect(doc!.byCategory!['מזון לבית']).not.toContain('uid0')
  })

  // A stored document is data from a collection nobody validates on write. It
  // must not be able to fake a vote.
  it('survives a malformed stored document without inventing votes', () => {
    const junk = { byCategory: { 'מזון לבית': 'uidA' } } as unknown as ProposalDoc
    const r = foldProposal(junk, 'k', 'מזון לבית', 'uidB')
    expect(r.votes).toBe(1)
    expect(r.promote).toBe(false)

    const nulls = { byCategory: { 'מזון לבית': [null, 7, 'uidA'] } } as unknown as ProposalDoc
    const r2 = foldProposal(nulls, 'k', 'מזון לבית', 'uidB')
    expect(r2.votes).toBe(2)          // only uidA survived the filter, plus uidB
    expect(r2.next.byCategory['מזון לבית']).toEqual(['uidA', 'uidB'])

    expect(foldProposal({} as ProposalDoc, 'k', 'מזון לבית', 'uidA').votes).toBe(1)
    expect(foldProposal({ byCategory: null } as unknown as ProposalDoc, 'k', 'c', 'u').votes).toBe(1)
  })

  it('treats two spellings of the same uid as two households only if they differ', () => {
    const a = foldProposal(undefined, 'k', 'מזון לבית', 'uidA')
    expect(foldProposal(a.next, 'k', 'מזון לבית', 'uidA').promote).toBe(false)
    expect(foldProposal(a.next, 'k', 'מזון לבית', 'UIDA').promote).toBe(true)  // Firestore uids are case-sensitive
  })

  it('carries the readable key through, for anyone reading the collection', () => {
    expect(foldProposal(undefined, 'מגדל/טלפון', 'השקעות', 'u').next.key).toBe('מגדל/טלפון')
  })
})

describe('proposalDocId', () => {
  // 🔴 normalizeForLookup does not strip slashes, and "מגדל/טלפון" — the key
  // that started this whole round — would be read as a subcollection path.
  it('produces an id with no character Firestore treats as a path', async () => {
    const id = await proposalDocId('מגדל/טלפון')
    expect(id).toMatch(/^[0-9a-f]{40}$/)
    expect(id).not.toContain('/')
  })

  it('is stable, so the same key always finds its own proposals', async () => {
    expect(await proposalDocId('שופרסל')).toBe(await proposalDocId('שופרסל'))
  })

  it('separates keys that differ', async () => {
    expect(await proposalDocId('שופרסל')).not.toBe(await proposalDocId('רמי לוי'))
    expect(await proposalDocId('מגדל/טלפון')).not.toBe(await proposalDocId('מגדל'))
  })

  it('handles an empty key without throwing', async () => {
    expect(await proposalDocId('')).toMatch(/^[0-9a-f]{40}$/)
  })
})

// 🔴 Grill finding. A raw uid stored inside an array, under an arbitrary
// category key, across an unbounded collection cannot be reached by any query —
// it would be residue that account deletion could neither find nor verify, in a
// flow whose entire claim is zero residue. Nothing ever reads an id back; only
// distinctness is needed.
describe('voterId', () => {
  it('never stores anything resembling the uid', async () => {
    const id = await voterId('SomeFirebaseUid123456789')
    expect(id).toMatch(/^[0-9a-f]{16}$/)
    expect(id).not.toContain('Some')
  })

  it('is stable, so the same household is recognised as itself', async () => {
    expect(await voterId('uidA')).toBe(await voterId('uidA'))
  })

  it('separates two households', async () => {
    expect(await voterId('uidA')).not.toBe(await voterId('uidB'))
  })

  // Firebase uids are case-sensitive; two spellings are two accounts.
  it('does not fold case', async () => {
    expect(await voterId('uidA')).not.toBe(await voterId('uida'))
  })
})
