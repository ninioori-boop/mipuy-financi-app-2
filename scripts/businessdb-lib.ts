/**
 * Shared validation logic for growing BUSINESS_DB.
 * Used by validate-businessdb.ts and merge-businessdb.ts — not part of the app bundle.
 */
import { BUSINESS_DB } from "../src/lib/businessDB";
import { normalizeForLookup } from "../src/lib/categorize";
import { ALL_CATEGORIES } from "../src/lib/constants";

export interface CandidateFile {
  category: string;
  entries: Array<string | [string, string]>;
}

export type Entry = [key: string, category: string];

export interface Exception {
  key: string;
  category: string;
  reason: string;
}

export interface ValidationResult {
  clean: Entry[];
  /** Mergeable but noteworthy: new key is LONGER and contains an existing key of
   *  another category — longest-key-wins makes this safe by construction. */
  warnings: Exception[];
  exceptions: Exception[];
  rejected: Exception[];
  droppedDuplicates: number;
}

// Single generic words that would hijack unrelated merchants via substring match
const GENERIC_BLOCKLIST = new Set([
  "בר", "קפה", "מרקט", "חנות", "בית", "מסעדה", "פיצה", "סושי", "בורגר",
  "מאפיה", "מאפייה", "קיוסק", "מזנון", "דוכן", "שוק", "מכולת", "סופר",
  "bar", "cafe", "coffee", "shop", "store", "market", "pizza", "sushi",
  "burger", "grill", "bakery", "food", "restaurant", "kitchen", "house",
]);

const hasHebrew = (s: string) => /[֐-׿]/.test(s);

export function normalizeCandidate(raw: string): string {
  return raw.toLowerCase().trim().replace(/\s{2,}/g, " ");
}

export function loadCandidateEntries(file: CandidateFile): Entry[] {
  return file.entries.map((e) =>
    typeof e === "string"
      ? [normalizeCandidate(e), file.category]
      : [normalizeCandidate(e[0]), e[1]],
  );
}

/**
 * Validate a batch of candidate entries against BUSINESS_DB and against itself.
 * Buckets: clean (mergeable), exceptions (owner review), rejected (hard invalid),
 * droppedDuplicates (exact dup, same category — silently skipped).
 */
export function validateBatch(candidates: Entry[]): ValidationResult {
  const existing = Object.entries(BUSINESS_DB).map(
    ([k, c]) => [k.toLowerCase(), c] as Entry,
  );
  const existingMap = new Map(existing);

  const clean: Entry[] = [];
  const warnings: Exception[] = [];
  const exceptions: Exception[] = [];
  const rejected: Exception[] = [];
  let droppedDuplicates = 0;

  const seenInBatch = new Map<string, string>();

  for (const [key, category] of candidates) {
    // --- hard rejects ---
    if (!key) {
      rejected.push({ key, category, reason: "מפתח ריק" });
      continue;
    }
    if (!ALL_CATEGORIES.includes(category)) {
      rejected.push({ key, category, reason: `קטגוריה לא חוקית: "${category}"` });
      continue;
    }
    if (category === "שונות") {
      rejected.push({ key, category, reason: '"שונות" היא ברירת המחדל — אין טעם ברשומה' });
      continue;
    }

    // --- silent drops (exact duplicate, same category) ---
    const existingCat = existingMap.get(key);
    if (existingCat === category) {
      droppedDuplicates++;
      continue;
    }
    const batchCat = seenInBatch.get(key);
    if (batchCat === category) {
      droppedDuplicates++;
      continue;
    }

    // --- exceptions (owner review) ---
    const problems: string[] = [];

    const minLen = hasHebrew(key) ? 3 : 4;
    if (key.length < minLen) {
      problems.push(`מפתח קצר מדי (${key.length} תווים, מינימום ${minLen}) — סכנת התאמת-יתר`);
    }

    if (GENERIC_BLOCKLIST.has(key)) {
      problems.push("מילה גנרית — תתפוס עסקים לא קשורים");
    }

    const normalized = normalizeForLookup(key);
    if (normalized !== key) {
      problems.push(
        `המפתח משתנה בנרמול ("${normalized}") — כנראה מכיל שם עיר/בע"מ; יש להזין את הצורה המנורמלת`,
      );
    }

    if (existingCat !== undefined && existingCat !== category) {
      // Appended entries come LAST in Object.fromEntries → last-value-wins would
      // silently FLIP the live categorization. Always an owner decision.
      problems.push(`קיים כבר במאגר עם קטגוריה אחרת: "${existingCat}" — מיזוג ידרוס את הקיים`);
    }
    if (batchCat !== undefined && batchCat !== category) {
      problems.push(`מופיע באצווה פעמיים עם קטגוריות שונות: "${batchCat}" ו-"${category}"`);
    }

    // Substring collisions with a DIFFERENT category:
    //  - new key CONTAINED IN a longer existing key → the short new key may hijack
    //    unrelated merchants → real exception.
    //  - new key CONTAINS a shorter existing key → longest-key-wins makes the new,
    //    more specific key take precedence only on its own matches → safe warning.
    const softNotes: string[] = [];
    for (const [exKey, exCat] of existing) {
      if (exCat === category) continue;
      if (exKey.includes(key)) {
        problems.push(`המפתח מוכל בתוך "${exKey}" (${exCat}) הקיים — עלול לחטוף אותו`);
        break;
      }
      if (key.includes(exKey)) {
        softNotes.push(`מכיל את "${exKey}" (${exCat}) הקיים — בטוח: הארוך מנצח`);
        break;
      }
    }

    // Same logic within the batch
    for (const [bKey, bCat] of seenInBatch) {
      if (bCat === category || bKey === key) continue;
      if (bKey.includes(key)) {
        problems.push(`מוכל בתוך "${bKey}" (${bCat}) מאותה אצווה — עלול לחטוף אותו`);
        break;
      }
      if (key.includes(bKey)) {
        softNotes.push(`מכיל את "${bKey}" (${bCat}) מאותה אצווה — בטוח: הארוך מנצח`);
        break;
      }
    }

    seenInBatch.set(key, category);

    if (problems.length > 0) {
      exceptions.push({ key, category, reason: problems.join(" | ") });
    } else {
      clean.push([key, category]);
      if (softNotes.length > 0) {
        warnings.push({ key, category, reason: softNotes.join(" | ") });
      }
    }
  }

  return { clean, warnings, exceptions, rejected, droppedDuplicates };
}
