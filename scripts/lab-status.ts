/**
 * Read-only: where does ONE email stand regarding lab ("מעבדה") access?
 *
 * Answers, in one shot, everything you need before AND after granting access:
 *   - is the email in LAB_EMAILS in the local source?
 *   - is it in the bundle SERVED BY PRODUCTION right now? (source ≠ deployed)
 *   - does an Auth account exist, is it verified, when did they last sign in?
 *   - allowlist / advisors/{uid} / pendingAdvisors state
 *   - near-miss accounts, when the exact email has no account (the classic
 *     "still blocked" cause: they signed up with a different address)
 *
 * Writes nothing. Safe to run against production at any time.
 *
 * Needs service-account-key.json at project root (gitignored) for the Firestore
 * half; without it the live-bundle half still runs.
 *
 *   npx tsx scripts/lab-status.ts someone@example.com
 *   npx tsx scripts/lab-status.ts someone@example.com --skip-live   (no network)
 */
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LAB_EMAILS, hasLabAccess } from "../src/lib/labAccess";

const email = process.argv[2]?.toLowerCase().trim();
const skipLive = process.argv.includes("--skip-live");

if (!email || !email.includes("@")) {
  console.error("שימוש: npx tsx scripts/lab-status.ts someone@example.com [--skip-live]");
  process.exit(1);
}

// The live app. LAB_EMAILS is a BUILD-TIME constant, so the only honest proof
// that a grant took effect is finding the address in the served JS.
const LIVE_ORIGIN = "https://app.orimipuy.com";
const LIVE_PAGE = "/app/automap";

let db: FirebaseFirestore.Firestore | null = null;
try {
  initializeApp({ credential: cert(JSON.parse(
    readFileSync(resolve(process.cwd(), "service-account-key.json"), "utf8"))) });
  db = getFirestore();
} catch {
  console.log("⚠️  service-account-key.json לא נקרא — מדלג על בדיקות Firestore/Auth.\n");
}

/** Is the email baked into the JS chunks production is serving right now? */
async function inLiveBundle(): Promise<boolean | null> {
  try {
    const html = await (await fetch(LIVE_ORIGIN + LIVE_PAGE)).text();
    const chunks = [...new Set(html.match(/\/_next\/static\/chunks\/[^"']+?\.js/g) ?? [])];
    if (!chunks.length) return null;
    const hits = await Promise.all(chunks.map(async c => {
      try {
        return (await (await fetch(LIVE_ORIGIN + c)).text()).toLowerCase().includes(email);
      } catch { return false; }
    }));
    return hits.some(Boolean);
  } catch {
    return null;
  }
}

async function main() {
  console.log(`\n=== מצב גישת מעבדה: ${email} ===\n`);

  // 1) Source list (what main says) vs live bundle (what users actually get).
  const inSource = hasLabAccess(email);
  console.log(`LAB_EMAILS בקוד המקומי : ${inSource ? "✅ כן" : "❌ לא"}  (${LAB_EMAILS.length} כתובות ברשימה)`);

  let live: boolean | null = null;
  if (!skipLive) {
    live = await inLiveBundle();
    console.log(`בבנדל החי בפרודקשן     : ${live === null ? "⚠️  לא ניתן לבדוק (רשת/מבנה עמוד)" : live ? "✅ כן" : "❌ לא"}`);
    if (inSource && live === false) {
      console.log("   🔴 הקוד המקומי מקדים את הפרודקשן — השינוי לא נפרס (או שהפריסה עוד רצה).");
    }
  }

  if (!db) return;

  // 2) The Auth account — no account means nothing else matters yet.
  let uid: string | null = null;
  try {
    const u = await getAuth().getUserByEmail(email);
    uid = u.uid;
    console.log(`\nחשבון Auth             : ✅ קיים  uid=${u.uid.slice(0, 10)}…`);
    console.log(`  מייל מאומת           : ${u.emailVerified ? "✅ כן" : "🔴 לא — התחברות דרך Google מאמתת אוטומטית"}`);
    console.log(`  אמצעי כניסה          : ${u.providerData.map(p => p.providerId).join(", ") || "password"}`);
    console.log(`  נרשם / כניסה אחרונה  : ${u.metadata.creationTime} / ${u.metadata.lastSignInTime ?? "מעולם לא"}`);
  } catch (e) {
    if ((e as { code?: string }).code !== "auth/user-not-found") throw e;
    console.log("\nחשבון Auth             : ❌ אין חשבון עם הכתובת המדויקת הזאת");

    // Only worth the full scan when the exact address came up empty: this is
    // where "עדיין חסום" usually turns out to be a typo or a different address.
    const domain = email.split("@")[1];
    const local = email.split("@")[0];
    const near: string[] = [];
    let pageToken: string | undefined;
    do {
      const page = await getAuth().listUsers(1000, pageToken);
      for (const u of page.users) {
        const e = (u.email ?? "").toLowerCase();
        if (e && e !== email && (e.endsWith("@" + domain) || e.split("@")[0] === local)) {
          near.push(`${e} (כניסה אחרונה: ${u.metadata.lastSignInTime ?? "מעולם"})`);
        }
      }
      pageToken = page.pageToken;
    } while (pageToken);
    console.log(near.length
      ? `  🔍 כתובות דומות שכן קיימות:\n     ${near.join("\n     ")}\n     ← אולי הוא נרשם עם אחת מהן.`
      : "  לא נמצאו כתובות דומות.");
  }

  // 3) Firestore side.
  const allow = await db.collection("allowlist").doc(email).get();
  console.log(`\nallowlist (invite-only): ${allow.exists ? "✅ מאושר" : "❌ לא ברשימה"}`);

  const pending = await db.collection("pendingAdvisors").doc(email).get();
  if (pending.exists) {
    const d = pending.data() ?? {};
    console.log(`pendingAdvisors        : ✅ ממתין  practice=${d.practiceId ?? "?"} status=${d.status ?? "?"}`);
  }

  let hasAdvisorDoc = false;
  if (uid) {
    const adv = await db.collection("advisors").doc(uid).get();
    hasAdvisorDoc = adv.exists;
    const d = adv.data() ?? {};
    console.log(`advisors/{uid}         : ${adv.exists ? `✅ קיים  role=${d.role ?? "?"} practice=${d.practiceId ?? "?"}` : "❌ אין (לא יועץ)"}`);
    const usr = await db.collection("users").doc(uid).get();
    console.log(`תיק אישי באפליקציה     : ${usr.exists ? `✅ קיים (~${Math.round(JSON.stringify(usr.data()?.data ?? {}).length / 1024)}KB)` : "❌ ריק"}`);
  }

  // 4) The bottom line, in the same terms useLabAccess() decides.
  const effective = (live ?? inSource) || hasAdvisorDoc;
  console.log(`\n── שורה תחתונה ──`);
  console.log(effective
    ? `✅ יש גישה למעבדה — דרך ${(live ?? inSource) ? "LAB_EMAILS" : "תפקיד היועץ (advisors/{uid})"}.`
    : "❌ אין גישה למעבדה.");
  if (!effective) {
    console.log("   כדי לפתוח: הוסף את הכתובת ל-src/lib/labAccess.ts ופרוס (skill: lab-access).");
  }
  if (!allow.exists) console.log("   ⚠️  לא ב-allowlist — לפתיחת הרשמה: npx tsx scripts/allow-email.ts " + email);
  if (uid === null) console.log("   ⚠️  אין חשבון — הגישה תחול ברגע שיתחבר עם הכתובת המדויקת הזאת.");
  console.log("");
}

main().then(() => setTimeout(() => process.exit(0), 150))
  .catch(e => { console.error(e); process.exit(1); });
