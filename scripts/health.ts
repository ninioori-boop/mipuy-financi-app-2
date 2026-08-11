/**
 * npm run health — one command that answers "is the system OK right now?"
 *
 * STRICTLY READ-ONLY. Writes nothing, anywhere. Safe to run at any time,
 * including while clients are working.
 *
 * Exit code 1 if any check FAILS, so it can gate a deploy or run in CI.
 *
 * Deliberate non-goals — this proves structure and integrity, NOT that the app
 * behaves correctly for a user. It cannot catch a wrong category, a broken
 * screen, or a bad UX. Those need `npm run test:e2e` and a human.
 */
import { cert, initializeApp, type ServiceAccount } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const MAX_BYTES = 900_000;
const WARN_PCT = 0.6;
const LEARNED_CAP = 20_000;      // the cap enforced in firestore.rules

let failures = 0;
let warnings = 0;
const ok   = (m: string) => console.log(`  ✅ ${m}`);
const warn = (m: string) => { warnings++; console.log(`  ⚠️  ${m}`); };
const fail = (m: string) => { failures++; console.log(`  ❌ ${m}`); };
const head = (m: string) => console.log(`\n\x1b[1m${m}\x1b[0m`);

/** Same canonical hash the daily Cloud Function uses: key order must not matter. */
const canon = (v: unknown): string => {
  const s = (x: unknown): string => {
    if (x === null || typeof x !== "object") return JSON.stringify(x) ?? "null";
    if (Array.isArray(x)) return `[${x.map(s).join(",")}]`;
    return `{${Object.keys(x as object).sort().map(k => `${JSON.stringify(k)}:${s((x as Record<string, unknown>)[k])}`).join(",")}}`;
  };
  return createHash("sha256").update(s(v)).digest("hex").slice(0, 12);
};

// Mirrors src/lib/learnedSharing.ts. Kept in sync by hand — if that file's rules
// change, change these too (this check is what would catch the drift anyway).
const RAIL = new Set(["bit", "ביט", "paybox", "פייבוקס", "מזומן", "מזומנים", "cash", "כספומט", "atm"]);
const NEVER = new Set([...RAIL, "paypal", "פייפאל", "העברה", "העברת", "transfer", "משיכה", "משיכת"]);
const NEVER_CATS = new Set(["ביט ללא מעקב", "מזומן ללא מעקב"]);
const PFX = new Set(["ב", "ל", "מ", "ו", "ה", "כ", "ש"]);
function wordForms(key: string): string[] {
  const out: string[] = [];
  for (const raw of key.split(/[^a-z0-9א-ת'"׳״]+/i)) {
    let w = raw.replace(/['"׳״]/g, "");
    if (!w) continue;
    out.push(w);
    for (let i = 0; i < 2 && w.length > 2 && PFX.has(w[0]); i++) { w = w.slice(1); out.push(w); }
  }
  return out;
}

async function main() {
  let key: string;
  try {
    key = readFileSync(resolve(process.cwd(), "service-account-key.json"), "utf8");
  } catch {
    console.error("❌ service-account-key.json לא נמצא בשורש הפרויקט — הרץ מתיקיית הפרויקט הראשית.");
    process.exit(1);
  }
  // The key file is snake_case on disk; ServiceAccount is camelCase in types.
  const svc = JSON.parse(key) as ServiceAccount & { project_id: string };
  const app = initializeApp({ credential: cert(svc) });
  const db = getFirestore();

  console.log("\x1b[1m\n═══ בדיקת מצב המערכת ═══\x1b[0m");
  console.log("קריאה בלבד — לא נכתב דבר.");

  const users = await db.collection("users").get();

  // ── 1. Portfolio sizes vs the save ceiling ────────────────────────────────
  head(`【1】 גדלי תיקים  (${users.size} חשבונות)`);
  let maxB = 0, maxUid = "", over = 0, blocked = 0;
  for (const d of users.docs) {
    const b = Buffer.byteLength(JSON.stringify(d.data()?.data ?? {}), "utf8");
    if (b > maxB) { maxB = b; maxUid = d.id; }
    if (b >= MAX_BYTES * WARN_PCT) over++;
    if (b > MAX_BYTES) blocked++;
  }
  const maxPct = Math.round((maxB / MAX_BYTES) * 100);
  console.log(`     הגדול ביותר: ${Math.round(maxB / 1024)}KB (${maxPct}% מהתקרה) — ${maxUid.slice(0, 10)}`);
  if (blocked) fail(`${blocked} תיקים חורגים מהתקרה — שמירה חסומה עבורם!`);
  else if (over) warn(`${over} תיקים מעל ${WARN_PCT * 100}% — הגיע הזמן לשקול את שלב ב' של פיצול האשראי`);
  else ok(`אף תיק לא מתקרב לתקרה`);

  // ── 2. Shared learned pool ────────────────────────────────────────────────
  head("【2】 המילון המשותף");
  const learnedSnap = await db.collection("shared").doc("learnedDB").get();
  const dict = ((learnedSnap.exists ? learnedSnap.data()?.db : {}) ?? {}) as Record<string, string>;
  const dictKeys = Object.keys(dict);
  console.log(`     ${dictKeys.length} רשומות (תקרת החוקים: ${LEARNED_CAP.toLocaleString()})`);
  const bad = dictKeys.filter(k =>
    k.length < 5 ||
    NEVER_CATS.has(dict[k]) ||
    wordForms(k.toLowerCase()).some(w => NEVER.has(w)));
  if (bad.length) fail(`${bad.length} רשומות מפרות את כללי השיתוף: ${bad.slice(0, 6).map(k => `"${k}"`).join(", ")}`);
  else ok("אין רשומות מזהמות (אמצעי תשלום / מפתחות קצרים / קטגוריות אישיות)");
  if (dictKeys.length > LEARNED_CAP * 0.8) warn(`מתקרב לתקרת ה-${LEARNED_CAP.toLocaleString()} של החוקים`);

  // ── 3. Credit-split shadow ────────────────────────────────────────────────
  head("【3】 פיצול האשראי (שלב א' — כתיבת צל)");
  let match = 0, missing = 0, drift = 0, noCredit = 0;
  const driftUids: string[] = [];
  for (const d of users.docs) {
    const c = d.data()?.data?.credit;
    if (!c || !Array.isArray(c.transactions)) { noCredit++; continue; }
    const sh = await d.ref.collection("sections").doc("credit").get();
    if (!sh.exists) { missing++; continue; }
    const a = canon({ t: c.transactions, f: c.uploadedFileNames ?? [] });
    const b = canon({ t: sh.data()?.transactions ?? [], f: sh.data()?.uploadedFileNames ?? [] });
    if (a === b) match++; else { drift++; driftUids.push(d.id.slice(0, 8)); }
  }
  console.log(`     תואם ${match} · צל טרם נכתב ${missing} · ללא אשראי ${noCredit}`);
  if (drift) fail(`סטייה ב-${drift} חשבונות: ${driftUids.join(", ")} — לא לעבור לשלב ב'`);
  else ok("אפס סטייה בין העותק הראשי לצל");

  // ── 4. Is the daily watchdog actually alive? ──────────────────────────────
  head("【4】 הבדיקה היומית האוטומטית");
  const checks = await db.collection("creditSplitChecks").orderBy("day", "desc").limit(1).get();
  if (checks.empty) fail("לא נמצאה אף בדיקה יומית — האם הפונקציה פרוסה?");
  else {
    const last = checks.docs[0];
    const day = last.id;
    const ageDays = Math.floor((Date.now() - new Date(day + "T00:00:00Z").getTime()) / 86_400_000);
    console.log(`     אחרונה: ${day} (לפני ${ageDays} ימים)`);
    if (ageDays > 2) fail(`הבדיקה לא רצה ${ageDays} ימים — התזמון כנראה מת`);
    else ok("רצה בזמן");
    if (last.data()?.maxKb === undefined) warn("שדות התראת הגודל טרם נכתבו (יופיעו בהרצה הבאה)");
    else ok(`התראת הגודל פעילה (רשמה ${last.data()?.maxKb}KB)`);
  }

  // ── 5. AI review funnel ───────────────────────────────────────────────────
  head("【5】 מחזור הלמידה");
  const sug = await db.collection("shared").doc("aiSuggestions").get();
  const n = Object.keys(((sug.exists ? sug.data()?.sug : {}) ?? {}) as object).length;
  console.log(`     ${n} הצעות ממתינות לסקירה`);
  if (n === 0) console.log(`     (אוסף מ-01/08/2026. אם אחרי שבועיים עדיין 0 — כדאי לבדוק שהרישום עובד)`);
  else if (n > 300) warn(`הצטברו הרבה — שווה להריץ "תבדוק הצעות AI"`);
  else ok("אוסף כרגיל");

  // ── 6. Firms and clients ──────────────────────────────────────────────────
  head("【6】 משרדים ולקוחות");
  const [practices, links] = await Promise.all([
    db.collection("practices").get(),
    db.collection("clientLinks").get(),
  ]);
  const active = links.docs.filter(d => d.data()?.status === "active").length;
  const pending = links.docs.filter(d => d.id.startsWith("pending_") && d.data()?.status === "pending").length;
  console.log(`     ${practices.size} משרדים · ${active} לקוחות פעילים · ${pending} הזמנות ממתינות`);
  const orphan = links.docs.filter(d => !d.id.startsWith("pending_") && !d.data()?.practiceId).length;
  if (orphan) warn(`${orphan} קישורי לקוח ללא משרד`);
  else ok("כל קישורי הלקוח משויכים למשרד");

  // ── 7. Deletion tombstones ────────────────────────────────────────────────
  head("【7】 חשבונות שנמחקו");
  const audit = await db.collection("deletionAudit").get();
  console.log(`     ${audit.size} מחיקות מתועדות`);
  let resurrected = 0;
  for (const d of audit.docs) {
    if ((await db.collection("users").doc(d.id).get()).exists) resurrected++;
  }
  if (resurrected) fail(`${resurrected} חשבונות מחוקים חזרו לחיים — כשל במנגנון המצבה!`);
  else ok("אף חשבון מחוק לא שוחזר");

  // ── 8. Invite-only signup gate ────────────────────────────────────────────
  // A blocking function can be DEPLOYED and still never run: Firebase Auth calls
  // it only if the trigger is REGISTERED in the Identity Platform config, which
  // is a separate fact from the deployment. On 2026-08-11 gateSignup was in the
  // code, green in CI, listed by `firebase functions:list` — and had zero
  // invocations in its entire life, so invite-only was not enforced at all and
  // a client's typo'd address sailed straight through. `functions:list` proves
  // deployment; only the config below proves registration.
  head("【8】 שער ההרשמה (בהזמנה בלבד)");
  // Addresses are masked on purpose: this output gets pasted into chats and
  // screenshots. Same rule scripts/list-allowlist.ts states for itself.
  const mask = (e: string) => {
    const at = e.indexOf("@");
    return at < 1 ? "???" : `${e.slice(0, Math.min(3, at))}***${e.slice(at)}`;
  };
  try {
    const accessToken = (await (app.options.credential as {
      getAccessToken(): Promise<{ access_token: string }>
    }).getAccessToken()).access_token;
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/admin/v2/projects/${svc.project_id}/config`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      // NOT a warning. This check exists because a control died silently and
      // nobody noticed for its entire life; "I could not verify the gate" must
      // never be indistinguishable from "the gate is fine" and exit 0.
      fail(`לא ניתן לקרוא את הקונפיג של Identity Platform (HTTP ${res.status}) — מצב השער אינו ידוע`);
    } else {
      const cfg = await res.json() as {
        blockingFunctions?: { triggers?: Record<string, { functionUri?: string }> }
      };
      const trigger = cfg.blockingFunctions?.triggers?.beforeCreate;
      if (!trigger) {
        fail("beforeCreate לא רשום — gateSignup פרוס אך לא נקרא, וכל אחד יכול להירשם!");
      } else if (!(trigger.functionUri ?? "").includes("gateSignup")) {
        // A registered trigger pointing at the wrong function enforces nothing,
        // and would otherwise report a cheerful ✅.
        fail(`beforeCreate רשום אך מצביע על פונקציה אחרת: ${trigger.functionUri ?? "לא ידוע"}`);
      } else {
        ok("השער רשום ומחובר ל-gateSignup");
      }
    }
  } catch (e) {
    fail(`בדיקת רישום השער נכשלה: ${(e as Error).message}`);
  }

  // The same failure seen from the data side: an account that exists without an
  // invitation. This alarm already existed in scripts/list-allowlist.ts and was
  // correct for two months — it simply was not part of any command anyone runs.
  //
  // Wrapped: listUsers is a NEW dependency for this script (the Auth Admin API),
  // and an uncaught rejection here would abort the run before the verdict prints,
  // throwing away the seven checks that already passed.
  try {
    const allowSnap = await db.collection("allowlist").get();
    const allow = new Set(allowSnap.docs.map(d => d.id));
    const uninvited: { uid: string; email: string }[] = [];
    let authCount = 0;
    let pageToken: string | undefined;
    do {
      const page = await getAuth().listUsers(1000, pageToken);
      for (const u of page.users) {
        const mail = (u.email ?? "").toLowerCase().trim();
        if (!mail) continue;
        authCount++;
        if (!allow.has(mail)) uninvited.push({ uid: u.uid, email: mail });
      }
      pageToken = page.pageToken;
    } while (pageToken);
    console.log(`     ${authCount} חשבונות · ${allow.size} רשומות ב-allowlist`);

    // Two very different stories share one symptom. /revoke deliberately deletes
    // the allowlist doc and LEAVES the account alive, so an ex-client is
    // expected to show up here forever — failing on that would train everyone to
    // ignore this line, which is how the gate rotted unnoticed in the first
    // place. A never-invited stranger, by contrast, cannot have a portfolio: the
    // rules block users/{uid} without an allowlist entry. So data present ⇒
    // access was withdrawn; no data ⇒ the account should never have existed.
    const withData: string[] = [];
    const strangers: string[] = [];
    for (const acct of uninvited) {
      const has = (await db.collection("users").doc(acct.uid).get()).exists;
      (has ? withData : strangers).push(mask(acct.email));
    }
    if (strangers.length) {
      fail(`${strangers.length} חשבונות נרשמו בלי הזמנה מעולם: ${strangers.slice(0, 5).join(", ")}`);
      console.log(`     (ה-rules חוסמים מהם כל נתון, אבל הם לא היו אמורים להיווצר)`);
    } else {
      ok("אף חשבון לא נוצר ללא הזמנה");
    }
    if (withData.length) {
      warn(`${withData.length} חשבונות עם נתונים שהגישה שלהם בוטלה (/revoke): ${withData.slice(0, 5).join(", ")}`);
    }
  } catch (e) {
    fail(`הצלבת החשבונות מול ה-allowlist נכשלה: ${(e as Error).message}`);
  }

  // ── verdict ───────────────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(46));
  if (failures) {
    console.log(`\x1b[31m\x1b[1m❌ ${failures} כשלים\x1b[0m${warnings ? ` · ${warnings} אזהרות` : ""}`);
    process.exitCode = 1;
  } else if (warnings) {
    console.log(`\x1b[33m\x1b[1m⚠️  ${warnings} אזהרות, אין כשלים\x1b[0m`);
  } else {
    console.log(`\x1b[32m\x1b[1m✅ הכל תקין\x1b[0m`);
  }
  console.log("\nמה זה לא בודק: שהאפליקציה עובדת בפועל, נכונות ויזואלית,");
  console.log("או נכונות הסיווג. לזה — npm run test:e2e ובן אדם.\n");
}

main()
  .then(() => setTimeout(() => process.exit(process.exitCode ?? 0), 200))
  .catch(e => { console.error("\n❌ הבדיקה נכשלה:", e); setTimeout(() => process.exit(1), 200); });
