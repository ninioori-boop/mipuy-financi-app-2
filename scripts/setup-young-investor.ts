/**
 * One-off TEST setup: "המשקיע הצעיר" as the first branded practice.
 * Advisor: orininio@hotmail.com. Blue accent palette.
 *
 * SAFETY: additive only, scoped to this one email/uid/practice.
 * Prints pre-state checks first, and post-state proof that no other
 * practice carries a brand.
 *
 * Run from the main repo root: npx tsx <this file>
 */
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const EMAIL = "orininio@hotmail.com";
const PRACTICE_NAME = "המשקיע הצעיר";
// Never hardcode a real account password — this file lives in git.
// Pass it in when creating a NEW advisor account:
//   SETUP_TEMP_PASSWORD='...' npx tsx scripts/setup-young-investor.ts
// (Only needed when the Auth user doesn't exist yet; an existing one is reused.)
const TEMP_PASSWORD = process.env.SETUP_TEMP_PASSWORD || "";

const BRAND = {
  nameHe: "המשקיע הצעיר",
  nameEn: "The Young Investor",
  wordmarkShort: "TYI",
  tagline: "המשקיע הצעיר",
  contactEmail: EMAIL,
  colors: { gold: "#60A5FA", goldLight: "#93C5FD", goldDark: "#2563EB" },
};

const keyJson = readFileSync(resolve(process.cwd(), "service-account-key.json"), "utf8");
initializeApp({ credential: cert(JSON.parse(keyJson)) });
const db = getFirestore();

async function main() {
  console.log("=== PRE-STATE CHECKS ===");

  // 1. Does the email already exist anywhere?
  let uid: string | null = null;
  try {
    uid = (await getAuth().getUserByEmail(EMAIL)).uid;
    console.log(`Auth user: EXISTS (uid=${uid})`);
  } catch {
    console.log("Auth user: not registered yet");
  }

  const advisorHits = await db.collection("advisors").where("email", "==", EMAIL).get();
  console.log(`advisors docs with this email: ${advisorHits.size}`);
  const linkHits = await db.collection("clientLinks").where("invitedEmail", "==", EMAIL).get();
  console.log(`clientLinks with this email: ${linkHits.size}${linkHits.size ? "  ⚠️ email is linked as a CLIENT — aborting" : ""}`);
  if (linkHits.size) process.exit(1);

  const practices = await db.collection("practices").get();
  console.log("existing practices (id | name | has brand?):");
  for (const p of practices.docs) {
    console.log(`  ${p.id} | ${p.data().name} | brand: ${p.data().brand ? "YES" : "no"}`);
  }

  console.log("\n=== SETUP (additive, this email only) ===");

  // 2. Create the Auth user if needed (temp password, admin-created).
  if (!uid) {
    if (!TEMP_PASSWORD) {
      console.error("❌ אין סיסמה. הרץ עם: SETUP_TEMP_PASSWORD='...' npx tsx scripts/setup-young-investor.ts");
      process.exit(1);
    }
    const user = await getAuth().createUser({ email: EMAIL, password: TEMP_PASSWORD, emailVerified: true });
    uid = user.uid;
    console.log(`created Auth user uid=${uid} (temp password set)`);
  }

  // 3. Allowlist (signup/access gate).
  await db.collection("allowlist").doc(EMAIL).set(
    { email: EMAIL, addedAt: FieldValue.serverTimestamp(), source: "provisionAdvisor" },
    { merge: true },
  );
  console.log("allowlist: ok");

  // 4. Practice + advisor role — deterministic id, same as provisionAdvisor.
  const practiceId = `p_${uid}`;
  await db.collection("practices").doc(practiceId).set(
    { name: PRACTICE_NAME, ownerUid: uid, advisorUids: [uid], createdAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  await db.collection("advisors").doc(uid).set(
    { email: EMAIL, practiceId, role: "owner", createdAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  console.log(`practice "${PRACTICE_NAME}" (${practiceId}) + advisor role: ok`);

  // 5. The brand — on THIS practice only.
  await db.collection("practices").doc(practiceId).set({ brand: BRAND }, { merge: true });
  console.log("brand set on the new practice");

  console.log("\n=== POST-STATE PROOF ===");
  const after = await db.collection("practices").get();
  for (const p of after.docs) {
    console.log(`  ${p.id} | ${p.data().name} | brand: ${p.data().brand ? JSON.stringify(p.data().brand.nameHe) : "no (default)"}`);
  }
  console.log(`\nDone. Sign in with ${EMAIL} (temp password: ${TEMP_PASSWORD}) on a deployment that has the white-label code.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
