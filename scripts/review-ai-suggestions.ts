/**
 * Review AI categorization suggestions accumulated in shared/aiSuggestions
 * (written by /api/transaction via logAiSuggestion) and promote approved ones
 * to shared/learnedDB — instantly improving categorization for every account,
 * no deploy needed.
 *
 *   npx tsx scripts/review-ai-suggestions.ts                            list + classification
 *   npx tsx scripts/review-ai-suggestions.ts promote --auto             DRY RUN of the obvious ones
 *   npx tsx scripts/review-ai-suggestions.ts promote --auto --apply     actually write them
 *   npx tsx scripts/review-ai-suggestions.ts promote "מפתח=קטגוריה" [--apply]
 *   npx tsx scripts/review-ai-suggestions.ts reject "מפתח" [...]
 *
 * promote is DRY-RUN BY DEFAULT (prints exactly what would be written);
 * nothing reaches shared/learnedDB without --apply.
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
import { shareableLearnedEntry } from "../src/lib/learnedSharing";

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
  // THE shared-pool gate — the same one the app's write paths use. Promotion
  // writes to shared/learnedDB, which is consulted before BUSINESS_DB by
  // substring for EVERY account, so this script is a shared-pool write path and
  // must not be the one door that skips the guard. Blocks payment rails
  // (including Hebrew clitic forms), the personal ללא-מעקב categories, and keys
  // under 5 chars — the "play" hijack was 4, which this script's own length
  // check would have let through.
  if (!shareableLearnedEntry(key, topCat)) {
    return { verdict: "exception", category: topCat, reason: "חסום לשיתוף (אמצעי תשלום / קטגוריה אישית / מפתח קצר)" };
  }
  // The prompt tells the model to answer שונות when it CANNOT identify a
  // business. In learnedDB — consulted first — that stops being a fallback and
  // becomes an override that also re-triggers the paid AI forever.
  if (topCat === "שונות") {
    return { verdict: "exception", category: topCat, reason: 'סיווג "לא ידוע" — לעולם לא לקדם' };
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
  const collision = substringCollision(key, topCat, learned);
  if (collision) {
    return { verdict: "exception", category: topCat, reason: collision };
  }
  return { verdict: "obvious", category: topCat, reason: "" };
}

/** Substring collision vs BUSINESS_DB + learnedDB with a DIFFERENT category —
 *  shared by classify() and the write gate, so the manual `promote "key=cat"`
 *  form (which never runs classify) cannot slip a hijacking key past it. */
function substringCollision(
  key: string,
  cat: string,
  learned: Record<string, string>,
): string | null {
  for (const [exKey, exCat] of [...Object.entries(BUSINESS_DB), ...Object.entries(learned)]) {
    const ex = exKey.toLowerCase();
    if (exCat === cat) continue;
    if (ex.includes(key) || key.includes(ex)) {
      return `התנגשות substring עם "${exKey}" (${exCat})`;
    }
  }
  return null;
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
    const apply = args.includes("--apply");
    const rest = args.filter(a => a !== "--apply");
    const toPromote: Array<[string, string]> = [];
    if (rest[0] === "--auto") {
      for (const key of keys) {
        const c = classify(key, sug[key], learned);
        if (c.verdict === "obvious") toPromote.push([key, c.category]);
      }
    } else {
      for (const a of rest) {
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

    // Final gate at the WRITE, not just in classify(): the manual
    // `promote "key=category"` form never calls classify at all, so guarding
    // only there would leave the door this script is meant to close standing
    // open. Everything below writes to shared/learnedDB, which is consulted
    // before BUSINESS_DB by substring for EVERY account.
    const blocked = toPromote.filter(([k, c]) => !shareableLearnedEntry(k, c) || c === "שונות");
    if (blocked.length) {
      console.error(`\n❌ ${blocked.length} רשומות חסומות לשיתוף ולא יקודמו:`);
      for (const [k, c] of blocked) console.error(`   "${k}" → ${c}`);
      console.error(
        `\nהסיבה: אמצעי תשלום (ביט/פייבוקס/מזומן), קטגוריה אישית ("ללא מעקב"),\n` +
        `מפתח קצר מ-5 תווים, או הסיווג "שונות" שמשמעותו "לא ידוע".\n` +
        `רשומות כאלה מזהמות את כל הלקוחות — זו תקלת הביט מ-29/07.\n` +
        `אם באמת צריך רשומה כזאת, מקומה ב-businessDB.ts (קוד מבוקר), לא במאגר המשותף.`,
      );
      process.exit(1);
    }

    // Collision gate at the WRITE too — the manual form never ran classify(),
    // and a colliding key hijacks an existing merchant for every account.
    const colliding = toPromote
      .map(([k, c]) => [k, c, substringCollision(k, c, learned)] as const)
      .filter(([, , why]) => why !== null);
    if (colliding.length) {
      console.error(`\n❌ ${colliding.length} רשומות מתנגשות עם מפתחות קיימים ולא יקודמו:`);
      for (const [k, c, why] of colliding) console.error(`   "${k}" → ${c}: ${why}`);
      process.exit(1);
    }

    if (Object.keys(learned).length + toPromote.length > LEARNED_SOFT_CAP) {
      console.error(`❌ learnedDB יעבור את תקרת ${LEARNED_SOFT_CAP} — צריך קודם לקפל רשומות ל-businessDB.ts`);
      process.exit(1);
    }

    if (!apply) {
      console.log(`\n🔎 DRY RUN — ${toPromote.length} רשומות עברו את כל השערים והיו נכתבות:`);
      for (const [key, cat] of toPromote) console.log(`   "${key}" → ${cat}`);
      console.log(`\nשום דבר לא נכתב. להרצה אמיתית הוסף --apply.`);
      return;
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

// setTimeout before exit — a hard exit while the admin SDK is closing its
// connections trips a libuv assertion on Windows (see the probe skill).
main().then(() => setTimeout(() => process.exit(0), 150))
  .catch((e) => { console.error(e); process.exit(1); });
