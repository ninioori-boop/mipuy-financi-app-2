/**
 * Provision an ADVISOR (SaaS onboarding) — the manual, role-driven flow.
 * Idempotent — safe to re-run.
 *
 *   1. Adds the advisor's email to `allowlist` (so they can register).
 *   2. Once they've registered, creates their `practices/{id}` + `advisors/{uid}`
 *      role, which opens the advisor dashboard for them.
 *   3. With `--owner`, also marks them a platform owner (super-admin oversight).
 *
 * If the email hasn't registered yet, step 1 still runs; re-run after they sign
 * up to create the role.
 *
 * Requires service-account-key.json at project root (gitignored).
 *   npx tsx scripts/provisionAdvisor.ts advisor@example.com "שם המשרד"
 *   npx tsx scripts/provisionAdvisor.ts owner@example.com --owner "המשרד שלי"
 */
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const email = process.argv[2]?.toLowerCase().trim();
const rest = process.argv.slice(3);
const asOwner = rest.includes("--owner");
const practiceName = rest.find((a) => !a.startsWith("--")) || `המשרד של ${email}`;

if (!email || !email.includes("@")) {
  console.error('שימוש: npx tsx scripts/provisionAdvisor.ts advisor@example.com "שם המשרד" [--owner]');
  process.exit(1);
}

const keyJson = readFileSync(resolve(process.cwd(), "service-account-key.json"), "utf8");
initializeApp({ credential: cert(JSON.parse(keyJson)) });
const db = getFirestore();

async function main() {
  // 1) Allowlist the email so the advisor can sign up.
  await db.collection("allowlist").doc(email).set(
    { email, addedAt: FieldValue.serverTimestamp(), source: "provisionAdvisor" },
    { merge: true },
  );
  console.log(`✅ ${email} אושר/ה לרשימת המורשים.`);

  // 2) Resolve the uid — only possible once they've registered.
  let uid: string;
  try {
    uid = (await getAuth().getUserByEmail(email)).uid;
  } catch (e) {
    if ((e as { code?: string }).code === "auth/user-not-found") {
      console.log("ℹ️  היועץ עוד לא נרשם. הוא יירשם עם המייל הזה, ואז הרץ שוב את הסקריפט כדי לפתוח לו את הממשק.");
      process.exit(0);
    }
    throw e;
  }

  // 3) Practice + advisor role (deterministic practice id → idempotent).
  const practiceId = `p_${uid}`;
  await db.collection("practices").doc(practiceId).set(
    { name: practiceName, ownerUid: uid, advisorUids: [uid], createdAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  await db.collection("advisors").doc(uid).set(
    { email, practiceId, role: "owner", createdAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  console.log(`✅ נוצר משרד "${practiceName}" והוקצה תפקיד יועץ ל-${email}.`);

  // 4) Optional: platform owner (super-admin oversight).
  if (asOwner) {
    await db.collection("platformOwners").doc(uid).set(
      { email, addedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    console.log(`✅ ${email} סומן/ה כבעלים (super-admin) — גישה למסך הפיקוח.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
