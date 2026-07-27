/**
 * set-practice-brand.ts — attach (or show) a firm's white-label branding.
 *
 * Usage:
 *   npx tsx scripts/set-practice-brand.ts <practiceId> <brand.json>   # set/merge
 *   npx tsx scripts/set-practice-brand.ts <practiceId> --show         # print current
 *   npx tsx scripts/set-practice-brand.ts <practiceId> --clear       # remove brand
 *
 * brand.json example:
 * {
 *   "nameHe": "השקעות לצעירים",
 *   "nameEn": "Young Investments",
 *   "tagline": "מיפוי פיננסי חכם",
 *   "contactEmail": "office@example.co.il",
 *   "colors": { "gold": "#3B82F6", "goldLight": "#93C5FD", "goldDark": "#1D4ED8" }
 * }
 * Only the keys you provide are stored; everything else falls back to the
 * default brand at runtime. Colors must be #hex.
 */
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const KEY_PATH = resolve(process.cwd(), "service-account-key.json");

// Keep in sync with src/lib/brand.ts (scripts stay self-contained by repo convention).
const STRING_KEYS = ["nameHe", "nameEn", "wordmarkShort", "tagline", "logoUrl", "contactEmail", "wordmarkColor"];
const COLOR_KEYS = ["gold", "goldLight", "goldDark", "surface", "surface2", "surface3", "line", "txt", "mutedTxt", "income", "expense"];
const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

function sanitize(raw: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  const rejected: string[] = [];
  for (const [k, v] of Object.entries(raw)) {
    if (STRING_KEYS.includes(k) && typeof v === "string" && v.trim()) out[k] = v.trim();
    else if (k === "colors" && v && typeof v === "object") {
      const colors: Record<string, string> = {};
      for (const [ck, cv] of Object.entries(v as Record<string, unknown>)) {
        if (COLOR_KEYS.includes(ck) && typeof cv === "string" && HEX_RE.test(cv.trim())) colors[ck] = cv.trim();
        else rejected.push(`colors.${ck}`);
      }
      if (Object.keys(colors).length) out.colors = colors;
    } else rejected.push(k);
  }
  return { out, rejected };
}

async function main() {
  const [practiceId, arg2] = process.argv.slice(2);
  if (!practiceId || !arg2) {
    console.error("usage: npx tsx scripts/set-practice-brand.ts <practiceId> <brand.json | --show | --clear>");
    process.exit(1);
  }

  let keyJson: string;
  try {
    keyJson = readFileSync(KEY_PATH, "utf8");
  } catch {
    console.error("service-account-key.json not found at project root");
    process.exit(1);
  }
  initializeApp({ credential: cert(JSON.parse(keyJson)) });
  const db = getFirestore();

  const ref = db.collection("practices").doc(practiceId);
  const snap = await ref.get();
  if (!snap.exists) {
    console.error(`practice "${practiceId}" does not exist — run provisionAdvisor first`);
    process.exit(1);
  }
  console.log(`practice: ${practiceId} (${snap.data()?.name ?? "no name"})`);

  if (arg2 === "--show") {
    console.log(JSON.stringify(snap.data()?.brand ?? null, null, 2));
    return;
  }

  if (arg2 === "--clear") {
    await ref.update({ brand: FieldValue.delete() });
    console.log("brand cleared — practice is back on the default brand");
    return;
  }

  const raw = JSON.parse(readFileSync(resolve(process.cwd(), arg2), "utf8"));
  const { out, rejected } = sanitize(raw);
  if (rejected.length) console.warn(`ignored keys: ${rejected.join(", ")}`);
  if (!Object.keys(out).length) {
    console.error("nothing valid to set");
    process.exit(1);
  }

  await ref.set({ brand: out }, { merge: true });
  console.log("brand set:");
  console.log(JSON.stringify(out, null, 2));
  console.log("\nNote: users of this practice will see it on their next app load.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
