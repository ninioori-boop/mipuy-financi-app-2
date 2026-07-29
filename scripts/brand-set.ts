/**
 * brand-set.ts — the ONE way to change a practice's white-label branding.
 *
 * Writes the brand to Firestore, then VERIFIES what the live site actually
 * serves (past bug: a long CDN TTL made edits look like they never landed).
 * Also runs sanity checks that mirror the app's own validation, so an invalid
 * value is caught here instead of silently ignored at runtime.
 *
 *   npx tsx scripts/brand-set.ts <practiceId|slug> <brand.json>   # set/merge
 *   npx tsx scripts/brand-set.ts <practiceId|slug> --show         # current brand
 *   npx tsx scripts/brand-set.ts --list                           # all practices
 *   npx tsx scripts/brand-set.ts <practiceId|slug> --verify       # live check only
 *
 * Accepted brand.json keys (everything optional, merged onto what exists):
 *   nameHe, nameEn, wordmarkShort, tagline, contactEmail
 *   wordmarkColor (#hex — the firm name's color in headers)
 *   logoUrl (https:// only)
 *   slug (a-z0-9-, 2-32 — powers the short link /go/{slug})
 *   colors: { gold, goldLight, goldDark, surface, surface2, surface3,
 *             line, txt, mutedTxt, income, expense }   // all #hex
 */
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SITE = process.env.BRAND_SITE?.trim() || "https://mipuy-financi-app-2-3nay.vercel.app";
const KEY_PATH = resolve(process.cwd(), "service-account-key.json");

// Mirrors src/lib/brand.ts — keep in sync.
const STRING_KEYS = ["nameHe", "nameEn", "wordmarkShort", "tagline", "logoUrl", "contactEmail", "wordmarkColor", "slug"];
const COLOR_KEYS = ["gold", "goldLight", "goldDark", "surface", "surface2", "surface3", "line", "txt", "mutedTxt", "income", "expense"];
const HEX_RE = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const SLUG_RE = /^[a-z0-9-]{2,32}$/;

function lum(hex: string): number {
  const h = hex.replace("#", "");
  const f = h.length <= 4 ? h.slice(0, 3).split("").map((c) => c + c).join("") : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a) + 0.05, lum(b) + 0.05].sort((x, y) => y - x);
  return hi / lo;
};

function sanitize(raw: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  const rejected: string[] = [];
  for (const [k, v] of Object.entries(raw)) {
    if (k === "colors" && v && typeof v === "object") {
      const colors: Record<string, string> = {};
      for (const [ck, cv] of Object.entries(v as Record<string, unknown>)) {
        if (COLOR_KEYS.includes(ck) && typeof cv === "string" && HEX_RE.test(cv.trim())) colors[ck] = cv.trim();
        else rejected.push(`colors.${ck}${typeof cv === "string" && !HEX_RE.test(String(cv).trim()) ? " (not a valid #hex)" : ""}`);
      }
      if (Object.keys(colors).length) out.colors = colors;
      continue;
    }
    if (!STRING_KEYS.includes(k) || typeof v !== "string" || !v.trim()) { rejected.push(k); continue; }
    const val = v.trim();
    if (k === "wordmarkColor" && !HEX_RE.test(val)) { rejected.push("wordmarkColor (not a valid #hex)"); continue; }
    if (k === "slug" && !SLUG_RE.test(val)) { rejected.push("slug (use a-z, 0-9, dashes; 2-32 chars)"); continue; }
    if (k === "logoUrl") {
      try { if (new URL(val).protocol !== "https:") { rejected.push("logoUrl (https only)"); continue; } }
      catch { rejected.push("logoUrl (not a valid URL)"); continue; }
    }
    out[k] = val;
  }
  return { out, rejected };
}

/** Readability warnings — the app derives some of this, but a heads-up beats a surprise. */
function warnContrast(merged: Record<string, string>) {
  const warns: string[] = [];
  const surface = merged.surface, txt = merged.txt, gold = merged.gold;
  if (surface && txt && contrast(surface, txt) < 4.5) warns.push(`טקסט על הרקע: ניגודיות ${contrast(surface, txt).toFixed(1)}:1 (מומלץ 4.5+)`);
  if (surface && gold && contrast(surface, gold) < 3) warns.push(`צבע ההדגשה על הרקע: ניגודיות ${contrast(surface, gold).toFixed(1)}:1 (מומלץ 3+)`);
  if (surface && merged.income && contrast(surface, merged.income) < 3) warns.push(`ירוק ההכנסות חלש על הרקע (${contrast(surface, merged.income).toFixed(1)}:1)`);
  if (surface && merged.expense && contrast(surface, merged.expense) < 3) warns.push(`אדום ההוצאות חלש על הרקע (${contrast(surface, merged.expense).toFixed(1)}:1)`);
  return warns;
}

async function main() {
  const [target, arg2] = process.argv.slice(2);
  if (!target) {
    console.error("usage: npx tsx scripts/brand-set.ts <practiceId|slug|--list> <brand.json | --show | --verify | --clear>");
    process.exit(1);
  }

  let keyJson: string;
  try { keyJson = readFileSync(KEY_PATH, "utf8"); }
  catch { console.error("❌ service-account-key.json לא נמצא בשורש הפרויקט"); process.exit(1); }
  initializeApp({ credential: cert(JSON.parse(keyJson)) });
  const db = getFirestore();

  if (target === "--list") {
    const all = await db.collection("practices").get();
    console.log(`practices (${all.size}):`);
    for (const d of all.docs) {
      const b = d.data().brand;
      console.log(`  ${d.id}\n    name=${d.data().name}  brand=${b ? `"${b.nameHe}"` : "— (ברירת מחדל)"}  slug=${b?.slug ?? "—"}`);
    }
    return;
  }

  // Resolve a slug to its practice id, so either identifier works.
  let practiceId = target;
  let snap = await db.collection("practices").doc(practiceId).get();
  if (!snap.exists) {
    const bySlug = await db.collection("practices").where("brand.slug", "==", target).limit(1).get();
    if (bySlug.empty) { console.error(`❌ לא נמצא עסק בשם "${target}" (נסה --list)`); process.exit(1); }
    snap = bySlug.docs[0];
    practiceId = snap.id;
  }
  const current = (snap.data()?.brand ?? {}) as Record<string, never>;
  console.log(`🏢 ${snap.data()?.name} (${practiceId})`);

  if (arg2 === "--show") { console.log(JSON.stringify(current, null, 2)); return; }

  if (arg2 === "--clear") {
    await db.collection("practices").doc(practiceId).update({ brand: FieldValue.delete() });
    console.log("✅ המיתוג הוסר — העסק חזר לברירת המחדל");
    await verifyLive(practiceId, {});
    return;
  }

  if (arg2 && arg2 !== "--verify") {
    let raw: Record<string, unknown>;
    try { raw = JSON.parse(readFileSync(resolve(process.cwd(), arg2), "utf8")); }
    catch (e) { console.error(`❌ קובץ המיתוג לא נקרא: ${(e as Error).message}`); process.exit(1); }

    const { out, rejected } = sanitize(raw);
    if (rejected.length) console.warn(`⚠️  שדות שנפסלו ולא נשמרו: ${rejected.join(", ")}`);
    if (!Object.keys(out).length) { console.error("❌ אין שום שדה תקין לשמירה"); process.exit(1); }

    // merge:true is per-map — merge colors manually so a partial palette
    // doesn't wipe the rest.
    const mergedColors = { ...(current as { colors?: Record<string, string> }).colors, ...(out.colors as Record<string, string> | undefined) };
    const payload = { ...out, ...(Object.keys(mergedColors).length ? { colors: mergedColors } : {}) };
    await db.collection("practices").doc(practiceId).set({ brand: payload }, { merge: true });
    console.log("✅ נשמר במסד:");
    console.log(JSON.stringify(payload, null, 2));

    const warns = warnContrast(mergedColors);
    if (warns.length) { console.warn("⚠️  בדיקת קריאוּת:"); warns.forEach((w) => console.warn(`   · ${w}`)); }
  }

  await verifyLive(practiceId, (await db.collection("practices").doc(practiceId).get()).data()?.brand ?? {});
}

/** Ask the LIVE site what it serves — catches CDN staleness and deploy gaps. */
async function verifyLive(practiceId: string, expected: Record<string, unknown>) {
  const url = `${SITE}/api/brand?practiceId=${encodeURIComponent(practiceId)}`;
  console.log(`\n🔎 בודק מול האתר החי: ${url}`);
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const res = await fetch(url, { headers: { "Cache-Control": "no-cache" } });
      if (!res.ok) { console.warn(`   ניסיון ${attempt}: השרת החזיר ${res.status}`); }
      else {
        const live = ((await res.json()) as { brand?: Record<string, unknown> }).brand ?? {};
        // Compare by CONTENT, not key order — Firestore returns map keys in an
        // arbitrary order, and a naive JSON.stringify compare cried wolf.
        const sameColors = (a: unknown, b: unknown) => {
          const A = (a ?? {}) as Record<string, string>, B = (b ?? {}) as Record<string, string>;
          const keys = new Set([...Object.keys(A), ...Object.keys(B)]);
          for (const k of keys) if ((A[k] ?? "").toLowerCase() !== (B[k] ?? "").toLowerCase()) return false;
          return true;
        };
        const diffs = Object.keys(expected).filter((k) => {
          if (k === "colors") return !sameColors(live.colors, expected.colors);
          return live[k] !== expected[k];
        });
        if (!diffs.length) {
          console.log("✅ האתר החי מגיש בדיוק את המיתוג המעודכן.");
          const slug = expected.slug as string | undefined;
          console.log(`\n🔗 קישור ממותג לשיתוף:\n   ${slug ? `${SITE}/go/${slug}` : `${SITE}/auth?b=${practiceId}`}`);
          if (!slug) console.log("   (טיפ: הגדר slug בקובץ המיתוג כדי לקבל קישור קצר שלא נשבר בהעתקה)");
          return;
        }
        console.log(`   ניסיון ${attempt}: עדיין גרסה ישנה בשדות: ${diffs.join(", ")} — ממתין ל-CDN…`);
      }
    } catch (e) { console.warn(`   ניסיון ${attempt}: שגיאת רשת (${(e as Error).message})`); }
    if (attempt < 6) await new Promise((r) => setTimeout(r, 20_000));
  }
  console.warn("⚠️  אחרי ~2 דקות האתר עדיין מגיש גרסה ישנה. המסד מעודכן; זו שכבת ההאצה.");
  console.warn("    מה לעשות: לחכות עוד דקה ולרענן חזק (Ctrl+F5), או לבדוק שאין פריסה תקועה ב-Vercel.");
}

// Flush stdout before exiting — an abrupt process.exit() while the admin SDK's
// handles are closing trips a libuv assertion on Windows.
main()
  .then(() => { setTimeout(() => process.exit(0), 150) })
  .catch((e) => { console.error("❌", e); setTimeout(() => process.exit(1), 150) });
