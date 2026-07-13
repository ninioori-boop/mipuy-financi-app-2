import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { normalizeForLookup } from './categorize'

// Best-effort log of AI-resolved categorizations into shared/aiSuggestions, so
// repeated AI guesses can later be reviewed and promoted to shared/learnedDB
// (see scripts/review-ai-suggestions.ts). Server-only (admin SDK).
//
// Contract: NEVER throws — a logging failure must not affect transaction capture.
export async function logAiSuggestion(
  db: Firestore,
  merchant: string,
  category: string,
): Promise<void> {
  try {
    const key = normalizeForLookup(merchant)
    if (key.length < 3) return
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
  } catch {
    // swallow — capture flow must never depend on suggestion logging
  }
}
