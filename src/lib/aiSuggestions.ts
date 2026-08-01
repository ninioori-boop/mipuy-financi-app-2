import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { normalizeForLookup } from './normalizeForLookup'
import { shareableLearnedEntry } from './learnedSharing'

// Best-effort log of AI-resolved categorizations into shared/aiSuggestions, so
// repeated AI guesses can later be reviewed and promoted to shared/learnedDB
// (see scripts/review-ai-suggestions.ts). Server-only (admin SDK); the
// collection is denied to clients by the catch-all rule.
//
// Contract: NEVER throws — a logging failure must not affect transaction capture.

// Everything logged here is a CANDIDATE for shared/learnedDB, which is consulted
// before the curated BUSINESS_DB, by substring, for every account. So the entry
// bar here must be the shared-pool bar, not a looser one.
const MAX_KEY_LEN = 40   // beyond this it's a free-text descriptor, not a merchant

export async function logAiSuggestion(
  db: Firestore,
  merchant: string,
  category: string,
): Promise<void> {
  try {
    // 'שונות' is what the prompt tells the model to answer when it CANNOT
    // identify the business — it means "unknown", not a categorization. Logging
    // it would let the reviewer promote `merchant → שונות` into learnedDB,
    // where (being consulted first) it stops being a fallback and becomes an
    // override that also re-triggers the paid AI on every future upload.
    if (category === 'שונות') return

    const key = normalizeForLookup(merchant)

    // Same gate as every other shared-pool write path (learnedSharing.ts's own
    // rule: "a guard on only one is no guard"). Covers payment rails, the
    // personal ללא-מעקב categories, and keys too short to be anything but a
    // substring wildcard — the "play" hijack was a 4-char key.
    if (!shareableLearnedEntry(key, category)) return

    // Free-text captures (the Shortcut can send a whole notification as the
    // merchant) would otherwise add unbounded one-off keys to a single document
    // that has a hard size ceiling and no expiry.
    if (key.length > MAX_KEY_LEN) return

    await db.collection('shared').doc('aiSuggestions').set({
      sug: {
        // Map keys may contain dots ("מ.תחבורה") — object-literal merge keeps
        // them literal (same pattern as /api/learn); never update() with a
        // string field path here.
        [key]: {
          cats: { [category]: FieldValue.increment(1) },
          n:    FieldValue.increment(1),
          last: new Date().toISOString().slice(0, 10),
          raw:  merchant.slice(0, 80),
        },
      },
    }, { merge: true })
  } catch (e) {
    // Swallow — capture must never depend on this. But SAY so: this document
    // grows without expiry toward Firestore's per-document ceiling, and a
    // silent failure would freeze the funnel with no signal that it had.
    console.warn('[aiSuggestions] log failed', e instanceof Error ? e.message : e)
  }
}
