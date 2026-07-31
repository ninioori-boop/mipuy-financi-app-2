// Provision rgil724@gmail.com: allowlist now; if the account already exists,
// also grant advisor role + firm OWNERSHIP of the branded practice (the
// previous test owner drops to member). Additive + idempotent.
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const EMAIL = "rgil724@gmail.com";
const PRACTICE = "p_XIjWNpyESsM84hUO4OsSjzy6W942"; // השקעות לצעירים בתכל׳ס (branded)
const TEST_ADVISOR_UID = "XIjWNpyESsM84hUO4OsSjzy6W942"; // orininio@hotmail.com

const keyJson = readFileSync(resolve(process.cwd(), "service-account-key.json"), "utf8");
initializeApp({ credential: cert(JSON.parse(keyJson)) });
const db = getFirestore();

async function main() {
  await db.collection("allowlist").doc(EMAIL).set(
    { email: EMAIL, addedAt: FieldValue.serverTimestamp(), source: "provisionAdvisor" },
    { merge: true },
  );
  console.log(`allowlist: ${EMAIL} ok`);

  let uid: string | null = null;
  try { uid = (await getAuth().getUserByEmail(EMAIL)).uid; } catch { /* not registered */ }
  if (!uid) {
    console.log("account: NOT REGISTERED yet — role + ownership will be granted after first sign-in (rerun me).");
    return;
  }

  await db.collection("advisors").doc(uid).set(
    { email: EMAIL, practiceId: PRACTICE, role: "owner", createdAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  await db.collection("practices").doc(PRACTICE).set(
    { ownerUid: uid, advisorUids: FieldValue.arrayUnion(uid) },
    { merge: true },
  );
  await db.collection("advisors").doc(TEST_ADVISOR_UID).set({ role: "member" }, { merge: true });
  console.log(`advisor+owner: ${EMAIL} (uid=${uid}) is now מנהל המשרד; test advisor demoted to member.`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
