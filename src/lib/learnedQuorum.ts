// Corroboration before a correction becomes everyone's truth.
//
// Ori approved this on 2026-08-12, after the automap lab started learning from
// category corrections. The recommendation he took, in full: a correction is
// promoted to shared/learnedDB only when it is (1) the full exact normalized
// description, and (2) the SAME correction made on two DIFFERENT households.
// Payment rails stay blocked entirely, as they have been since the Bit incident.
//
// Why corroboration and not a stricter filter: every filter we have is a guess
// about the TEXT ("is this key too short", "does it look like a rail"). Two
// households arriving at the same merchant→category answer is evidence about
// the WORLD, which no amount of string inspection can provide.
//
// 🔴 What this does NOT guarantee, stated plainly because the honest version is
// weaker than it first reads: the two votes are two HOUSEHOLDS, not two
// independent judgements. One advisor doing the initial mapping for two of
// their own clients supplies both — and that is deliberate, it is the rule Ori
// approved ("שני לקוחות שונים", not two different advisors). So a mistake an
// advisor makes CONSISTENTLY across two clients still reaches everyone. What is
// removed is the single-charge, single-household promotion that caused the Bit
// incident. Do not read this module as protection against a confident expert
// being wrong; read it as protection against one household's quirk becoming a
// fact about the world.
//
// 🔴 The trade-off, stated because it is real: an entry already in the pool now
// takes two households to CHANGE, where before one sufficed. The route's old
// comment called single-correction updates "how a full pool self-corrects", and
// that gets slower. It is the right side to err on — overwriting a corroborated
// value for every client is a wider blast radius than adding a new key — and
// the correcting client is never affected either way, because their own
// learnedDB always outranks the shared pool at read time.

/** How many distinct households must agree before the pool is written. */
export const LEARN_QUORUM = 2

/**
 * Distinct households kept per (key, category). Only "did we reach 2" matters,
 * so this exists purely to stop one proposal document growing without bound.
 */
export const MAX_PROPOSAL_UIDS = 8

export interface ProposalDoc {
  /** The normalized key, stored for humans reading the collection. */
  key?: string
  /**
   * category → the HASHED ids of the households that proposed it.
   *
   * 🔴 Hashed, never raw uids. Account deletion enumerates and verifies every
   * collection that holds a uid, and a uid sitting inside an array under an
   * arbitrary category key across an unbounded collection cannot be reached by
   * any query — it would be residue that no verification step could find, in a
   * flow whose whole claim is zero residue. Nothing here ever reads an id back;
   * only DISTINCTNESS is ever needed, and a hash carries that perfectly.
   */
  byCategory?: Record<string, string[]>
}

export interface ProposalOutcome {
  /** The document to write back. */
  next: { key: string; byCategory: Record<string, string[]> }
  /** How many distinct households now back this (key, category). */
  votes: number
  /** How many back the best-supported COMPETING category for the same key. */
  rival: number
  /** Whether it crossed the bar on THIS call. */
  promote: boolean
  /** True when this household had already proposed it — a repeat, not a vote. */
  duplicate: boolean
}

/**
 * Fold one proposal into the stored document.
 *
 * Pure, so the whole promotion rule is testable without Firestore — the part
 * of this feature that can silently teach 40 clients something false is the
 * part that must not need an emulator to check.
 *
 * ⚠️ Competing categories are kept side by side rather than overwriting each
 * other. Two households disagreeing about a merchant is a real thing, and the
 * first to reach two wins; collapsing them to "the latest answer" would hand a
 * single household the veto the quorum exists to remove.
 */
export function foldProposal(
  doc: ProposalDoc | undefined,
  key: string,
  category: string,
  voter: string,
): ProposalOutcome {
  const byCategory: Record<string, string[]> = {}
  for (const [cat, ids] of Object.entries(doc?.byCategory ?? {})) {
    if (Array.isArray(ids)) byCategory[cat] = ids.filter(u => typeof u === 'string')
  }

  const current = byCategory[category] ?? []
  const duplicate = current.includes(voter)
  // Cap by dropping the OLDEST, not by refusing the newest: a proposal that has
  // not reached quorum in eight households is stale, and the newest evidence is
  // the evidence worth keeping.
  const ids = duplicate ? current : [...current, voter].slice(-MAX_PROPOSAL_UIDS)
  byCategory[category] = ids

  const votes = ids.length
  // The best-supported RIVAL answer for the same merchant.
  let rival = 0
  for (const [cat, list] of Object.entries(byCategory)) {
    if (cat !== category) rival = Math.max(rival, list.length)
  }

  return {
    next: { key, byCategory },
    votes,
    rival,
    // 🔴 Two conditions, and the second one is not decoration.
    //
    // `votes >= LEARN_QUORUM` is the corroboration bar.
    //
    // `votes > rival` stops the pool flip-flopping. Without it, once two
    // categories each hold two backers, EVERY further vote on either side
    // re-fires promotion and overwrites the other — רמי לוי would swing between
    // מזון לבית and אוכל בחוץ for all 40 clients on every correction, forever. A
    // tie leaves the pool where it is; only being strictly ahead moves it.
    //
    // ⚠️ `duplicate` is deliberately NOT a condition. The route returns early
    // when the pool already holds this exact answer, so reaching here proves it
    // does not — which happens when the pool write FAILED after the votes were
    // durably recorded. Gating on !duplicate stranded that entry permanently:
    // every retry by the same two households was a repeat, and only a third
    // household could ever rescue it.
    promote: votes >= LEARN_QUORUM && votes > rival,
    duplicate,
  }
}

/**
 * The stored identity of a household: a hash, never the uid.
 *
 * See the ProposalDoc comment — this exists so account deletion has nothing to
 * clean up here. Truncated to 16 hex chars (64 bits): collisions across a few
 * thousand households are vanishingly unlikely, and the only cost of one would
 * be a single vote not counting.
 */
export async function voterId(uid: string): Promise<string> {
  return (await sha256Hex(uid)).slice(0, 16)
}

/**
 * A Firestore document id for a normalized merchant key.
 *
 * The key cannot be the id: `normalizeForLookup` does not strip slashes, and
 * "מגדל/טלפון" — the very key that started this round — would be read as a
 * subcollection path. A hash sidesteps every id rule at once (no slashes, no
 * "." or "..", no __reserved__, no length limit), and the readable key is
 * stored inside the document.
 */
export async function proposalDocId(key: string): Promise<string> {
  return (await sha256Hex(key)).slice(0, 40)
}

async function sha256Hex(text: string): Promise<string> {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(text, 'utf8').digest('hex')
}
