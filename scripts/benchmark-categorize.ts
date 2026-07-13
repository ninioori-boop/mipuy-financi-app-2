/**
 * Benchmark categorize() coverage against real, human-labeled merchant strings
 * (the keys of shared/learnedDB in Firestore).
 *
 *   npx tsx scripts/benchmark-categorize.ts --snapshot
 *       Download shared/learnedDB to scripts/businessdb-candidates/.learned-snapshot.json
 *       (requires service-account-key.json at project root, gitignored)
 *
 *   npx tsx scripts/benchmark-categorize.ts
 *       Run categorize() over the snapshot; report coverage + agreement.
 *
 *   npx tsx scripts/benchmark-categorize.ts --baseline
 *       Also save per-key results to .benchmark-baseline.json
 *
 *   npx tsx scripts/benchmark-categorize.ts --compare
 *       Compare current results to the saved baseline; report improvements and
 *       REGRESSIONS (keys that were correct or שונות and are now wrongly categorized).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { categorize } from "../src/lib/categorize";

const SNAPSHOT = resolve(process.cwd(), "scripts/businessdb-candidates/.learned-snapshot.json");
const BASELINE = resolve(process.cwd(), "scripts/businessdb-candidates/.benchmark-baseline.json");

const mode = process.argv[2] ?? "";

async function snapshot() {
  const { cert, initializeApp } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const keyJson = readFileSync(resolve(process.cwd(), "service-account-key.json"), "utf8");
  initializeApp({ credential: cert(JSON.parse(keyJson)) });
  const doc = await getFirestore().collection("shared").doc("learnedDB").get();
  const db = (doc.data()?.db ?? {}) as Record<string, string>;
  writeFileSync(SNAPSHOT, JSON.stringify(db, null, 2), "utf8");
  console.log(`✅ נשמרו ${Object.keys(db).length} מרצ'נטים מתויגים ל-.learned-snapshot.json`);
}

function run() {
  if (!existsSync(SNAPSHOT)) {
    console.error("אין snapshot — הרץ קודם: npx tsx scripts/benchmark-categorize.ts --snapshot");
    process.exit(1);
  }
  const labeled = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Record<string, string>;
  const keys = Object.keys(labeled);

  const results: Record<string, string> = {};
  let covered = 0;
  let agree = 0;
  const disagreements: Array<{ key: string; human: string; got: string }> = [];

  for (const key of keys) {
    const got = categorize(key, {}); // empty learnedDB → pure BUSINESS_DB measurement
    results[key] = got;
    if (got !== "שונות") covered++;
    if (got === labeled[key]) agree++;
    else if (got !== "שונות") disagreements.push({ key, human: labeled[key], got });
  }

  const pct = (n: number) => `${((n / keys.length) * 100).toFixed(1)}%`;
  console.log(`\n══ בנצ'מרק על ${keys.length} מרצ'נטים אמיתיים ══`);
  console.log(`   כיסוי (לא-שונות): ${covered} (${pct(covered)})`);
  console.log(`   הסכמה עם תיוג אנושי: ${agree} (${pct(agree)})`);
  console.log(`   אי-הסכמות (קוטלג אחרת מהאדם): ${disagreements.length}`);

  if (mode === "--baseline") {
    writeFileSync(BASELINE, JSON.stringify(results, null, 2), "utf8");
    console.log(`\n💾 baseline נשמר (${keys.length} תוצאות)`);
  }

  if (mode === "--compare") {
    if (!existsSync(BASELINE)) {
      console.error("אין baseline — הרץ קודם עם --baseline לפני שינוי המאגר");
      process.exit(1);
    }
    const base = JSON.parse(readFileSync(BASELINE, "utf8")) as Record<string, string>;
    const improvements: string[] = [];
    const regressions: Array<{ key: string; was: string; now: string; human: string }> = [];

    for (const key of keys) {
      const was = base[key];
      const now = results[key];
      if (was === now || was === undefined) continue;
      const human = labeled[key];
      // regression: was fine (correct or unmatched) → now a WRONG category
      const wasFine = was === human || was === "שונות";
      if (wasFine && now !== human && now !== "שונות") {
        regressions.push({ key, was, now, human });
      } else if (now === human || (was === "שונות" && now !== "שונות")) {
        improvements.push(key);
      }
    }

    console.log(`\n══ השוואה מול baseline ══`);
    console.log(`   ✅ שיפורים: ${improvements.length}`);
    console.log(`   ❌ רגרסיות: ${regressions.length}`);
    for (const r of regressions) {
      console.log(`      ❌ "${r.key}": היה "${r.was}" → עכשיו "${r.now}" (אדם: "${r.human}")`);
    }
    if (regressions.length > 0) process.exit(1);
  }
}

if (mode === "--snapshot") {
  snapshot().catch((e) => { console.error(e); process.exit(1); });
} else {
  run();
}
