/**
 * Review AI categorization suggestions accumulated in shared/aiSuggestions
 * (written by /api/transaction via logAiSuggestion) and promote approved ones
 * to shared/learnedDB — instantly improving categorization for every account,
 * no deploy needed.
 *
 *   npx tsx scripts/review-ai-suggestions.ts                    list + classification
 *   npx tsx scripts/review-ai-suggestions.ts promote --auto     promote all "obvious" ones
 *   npx tsx scripts/review-ai-suggestions.ts promote "מפתח=קטגוריה" [...]
 *   npx tsx scripts/review-ai-suggestions.ts reject "מפתח" [...]
 *
 * Requires service-account-key.json at project root (gitignored).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cert, initializeApp } from "firebase-admin/app";
import { FieldPath, FieldValue, getFirestore } from "firebase-admin/firestore";
import { BUSINESS_DB } from "../src/lib/businessDB";
import { categorize } from "../src/lib/categorize";
import { ALL_CATEGORIES } from "../src/lib/constants";

interface Suggestion {
  cats: Record<string, number>;
  n: number;
  last: string;
  raw: string;
}

const keyJson = readFileSync(resolve(process.cwd(), "service-account-key.json"), "utf8");
initializeApp({ credential: cert(JSON.parse(keyJson)) });
const db = getFirestore();

const sugRef = db.collection("shared").doc("aiSuggestions");
const learnedRef = db.collection("shared").doc("learnedDB");

// Keep learnedDB safely under the 20k-key cap enforced by firestore.rules for
// client writes (admin bypasses it, but client corrections must keep working).
const LEARNED_SOFT_CAP = 18_000;

function classify(
  key: string,
  s: Suggestion,
  learned: Record<string, string>,
): { verdict: "obvious" | "exception"; category: string; reason: string } {
  const entries = Object.entries(s.cats).sort((a, b) => b[1] - a[1]);
  const [topCat, topCount] = entries[0];
  const total = entries.reduce((sum, [, c]) => sum + c, 0);

  if (!ALL_CATEGORIES.includes(topCat)) {
    return { verdict: "exception", category: topCat, reason: "קטגוריה לא חוקית" };
  }
  if (topCount / total < 0.8) {
    return {
      verdict: "exception", category: topCat,
      reason: `ה-AI לא עקבי: ${entries.map(([c, n]) => `${c}×${n}`).join(", ")}`,
    };
  }
  if (s.n < 2) {
    return { verdict: "exception", category: topCat, reason: "נראה רק פעם אחת — אין אימות" };
  }
  if (key.length < 4) {
    return { verdict: "exception", category: topCat, reason: "מפתח קצר — סכנת התאמת-יתר" };
  }
  if (categorize(key, learned) !== "שונות") {
    return {
      verdict: "exception", category: topCat,
      reason: `כבר מקוטלג היום כ"${categorize(key, learned)}" — אין צורך, או שיש סתירה`,
    };
  }
  // substring collision vs BUSINESS_DB + learnedDB with a different category
  for (const [exKey, exCat] of [...Object.entries(BUSINESS_DB), ...Object.entries(learned)]) {
    const ex = exKey.toLowerCase();
    if (exCat === topCat) continue;
    if (ex.includes(key) || key.includes(ex)) {
      return {
        verdict: "exception", category: topCat,
        reason: `התנגשות substring עם "${exKey}" (${exCat})`,
      };
    }
  }
  return { verdict: "obvious", category: topCat, reason: "" };
}

async function main() {
  const [cmd = "list", ...args] = process.argv.slice(2);

  const [sugDoc, learnedDoc] = await Promise.all([sugRef.get(), learnedRef.get()]);
  const sug = (sugDoc.data()?.sug ?? {}) as Record<string, Suggestion>;
  const learned = (learnedDoc.data()?.db ?? {}) as Record<string, string>;
  const keys = Object.keys(sug);

  if (cmd === "list") {
    if (keys.length === 0) {
      console.log("אין הצעות AI שהצטברו עדיין.");
      return;
    }
    console.log(`\n══ ${keys.length} הצעות AI ממתינות ══\n`);
    let obvious = 0;
    for (const key of keys.sort((a, b) => sug[b].n - sug[a].n)) {
      const s = sug[key];
      const c = classify(key, s, learned);
      const tag = c.verdict === "obvious" ? "✅ ברור " : "⚠️ חריג ";
      console.log(`${tag} "${key}" → ${c.category}  (נראה ${s.n}×, לאחרונה ${s.last})`);
      if (c.reason) console.log(`         ${c.reason}`);
      if (c.verdict === "obvious") obvious++;
    }
    console.log(`\nסה"כ: ${obvious} ברורים (promote --auto), ${keys.length - obvious} חריגים לבדיקה`);
    return;
  }

  if (cmd === "promote") {
    const toPromote: Array<[string, string]> = [];
    if (args[0] === "--auto") {
      for (const key of keys) {
        const c = classify(key, sug[key], learned);
        if (c.verdict === "obvious") toPromote.push([key, c.category]);
      }
    } else {
      for (const a of args) {
        const eq = a.lastIndexOf("=");
        if (eq === -1) { console.error(`פורמט: "מפתח=קטגוריה" (קיבלתי: ${a})`); process.exit(1); }
        const key = a.slice(0, eq).trim();
        const cat = a.slice(eq + 1).trim();
        if (!ALL_CATEGORIES.includes(cat)) { console.error(`קטגוריה לא חוקית: ${cat}`); process.exit(1); }
        if (!sug[key]) console.warn(`⚠️ "${key}" לא נמצא בהצעות — מקדם בכל זאת`);
        toPromote.push([key, cat]);
      }
    }
    if (toPromote.length === 0) { console.log("אין מה לקדם."); return; }
    if (Object.keys(learned).length + toPromote.length > LEARNED_SOFT_CAP) {
      console.error(`❌ learnedDB יעבור את תקרת ${LEARNED_SOFT_CAP} — צריך קודם לקפל רשומות ל-businessDB.ts`);
      process.exit(1);
    }
    for (const [key, cat] of toPromote) {
      await learnedRef.set({ db: { [key]: cat } }, { merge: true });
      if (sug[key]) await sugRef.update(new FieldPath("sug", key), FieldValue.delete());
      console.log(`✅ "${key}" → ${cat}`);
    }
    console.log(`\nקודמו ${toPromote.length} רשומות ל-shared/learnedDB — פעיל מיידית לכל המשתמשים.`);
    return;
  }

  if (cmd === "reject") {
    for (const key of args) {
      if (!sug[key]) { console.warn(`⚠️ "${key}" לא נמצא`); continue; }
      await sugRef.update(new FieldPath("sug", key), FieldValue.delete());
      console.log(`🗑️ "${key}" נדחה`);
    }
    return;
  }

  console.error("פקודות: list | promote --auto | promote \"מפתח=קטגוריה\" | reject \"מפתח\"");
  process.exit(1);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
