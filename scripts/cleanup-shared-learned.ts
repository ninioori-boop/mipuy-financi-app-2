/**
 * Cleanup of shared/learnedDB — remove entries that should never have been
 * global (the Bit incident, 2026-07-29): payment rails (bit/paypal/paybox),
 * personal "untracked" categories, and wildcard-short keys like "play" that
 * substring-match into Google Play / PlayStation for every client.
 *
 *   npx tsx scripts/cleanup-shared-learned.ts            # dry-run (default)
 *   npx tsx scripts/cleanup-shared-learned.ts --apply    # delete + backup
 *
 * Mirrors src/lib/learnedSharing.ts in the web app (keep the rules in sync).
 * Safety: dry-run first; --apply backs up every removed pair to the doc
 * shared/learnedDBRemoved before deleting; per-key it reports which accounts
 * hold the same key privately (they lose nothing — personal wins) and whether
 * BUSINESS_DB still covers the key afterwards.
 */
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, FieldPath } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── same rules as src/lib/learnedSharing.ts ─────────────────────────────────
const NEVER_SHARE_WORDS = new Set([
  "bit", "ביט", "paybox", "פייבוקס", "paypal", "פייפאל",
  "מזומן", "cash", "העברה", "העברת", "transfer", "משיכה", "משיכת",
]);
const NEVER_SHARE_CATEGORIES = new Set(["ביט ללא מעקב", "מזומן ללא מעקב"]);
const MIN_SHARED_KEY_LENGTH = 5;
const HEBREW_PREFIXES = new Set(["ב", "ל", "מ", "ו", "ה", "כ", "ש"]);
function wordForms(key: string): string[] {
  const out: string[] = [];
  for (const raw of key.split(/[^a-z0-9א-ת'"׳״]+/i)) {
    let w = raw.replace(/['"׳״]/g, "");
    if (!w) continue;
    out.push(w);
    for (let i = 0; i < 2 && w.length > 2 && HEBREW_PREFIXES.has(w[0]); i++) {
      w = w.slice(1);
      out.push(w);
    }
  }
  return out;
}
function shareable(key: string, category: string): boolean {
  const k = (key || "").trim().toLowerCase();
  if (k.length < MIN_SHARED_KEY_LENGTH) return false;
  if (NEVER_SHARE_CATEGORIES.has(category)) return false;
  if (wordForms(k).some(w => NEVER_SHARE_WORDS.has(w))) return false;
  return true;
}

const APPLY = process.argv.includes("--apply");

initializeApp({ credential: cert(JSON.parse(readFileSync(resolve(process.cwd(), "service-account-key.json"), "utf8"))) });
const db = getFirestore();

async function main() {
  const ref = db.collection("shared").doc("learnedDB");
  const snap = await ref.get();
  const dict = ((snap.exists ? snap.data()?.db : {}) ?? {}) as Record<string, string>;
  const keys = Object.keys(dict);
  console.log(`shared/learnedDB: ${keys.length} entries`);

  const remove = keys.filter(k => !shareable(k, dict[k]));
  if (!remove.length) { console.log("✅ אין מה לנקות — כל הרשומות עומדות בכללים."); return; }

  // Who holds each key PRIVATELY (their categorization is unaffected by the
  // deletion — personal dict wins), and does BUSINESS_DB still cover it?
  const businessSrc = readFileSync(resolve(process.cwd(), "src/lib/businessDB.ts"), "utf8");
  const users = await db.collection("users").get();
  const privateHolders: Record<string, string[]> = {};
  for (const u of users.docs) {
    const ldb = (u.data()?.data?.credit?.learnedDB ?? {}) as Record<string, string>;
    for (const k of remove) if (k in ldb) (privateHolders[k] ??= []).push(u.id.slice(0, 10));
  }

  console.log(`\n${APPLY ? "🗑️  מוחק" : "🔍 dry-run — היו נמחקות"} ${remove.length} רשומות:`);
  for (const k of remove) {
    const inBusiness = businessSrc.includes(`["${k}"`);
    console.log(`  "${k}" → ${dict[k]}`);
    console.log(`      מוחזק אישית אצל: ${privateHolders[k]?.join(", ") || "(אף אחד)"} | קיים ב-BUSINESS_DB: ${inBusiness ? "כן ✓" : "לא"}`);
  }

  if (!APPLY) { console.log("\n(להרצה אמיתית: --apply)"); return; }

  // Backup first — restoring is a one-line merge from this doc.
  await db.collection("shared").doc("learnedDBRemoved").set(
    { removed: remove.reduce((a, k) => ({ ...a, [k]: dict[k] }), {} as Record<string, string>), at: FieldValue.serverTimestamp() },
    { merge: true },
  );
  console.log("\n📦 גיבוי נכתב ל-shared/learnedDBRemoved");

  // FieldPath segments — keys contain *, spaces and quotes, so no dotted strings.
  const updates: [FieldPath, unknown][] = remove.map(k => [new FieldPath("db", k), FieldValue.delete()]);
  const flat = updates.flat();
  await ref.update(flat[0] as FieldPath, flat[1], ...flat.slice(2));

  const after = await ref.get();
  const left = Object.keys((after.data()?.db ?? {}) as Record<string, string>);
  const stillThere = remove.filter(k => left.includes(k));
  console.log(`\n✅ נמחקו. המאגר ירד ל-${left.length} רשומות.`);
  if (stillThere.length) { console.error(`❌ עדיין קיימות: ${stillThere.join(", ")}`); process.exitCode = 1; }
}
main().then(() => setTimeout(() => process.exit(process.exitCode ?? 0), 150))
  .catch(e => { console.error(e); setTimeout(() => process.exit(1), 150); });
