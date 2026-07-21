/**
 * Removes everything setup-impersonation-test.ts created: the two test auth
 * accounts and all their Firestore docs. Idempotent.
 *   npx tsx scripts/cleanup-impersonation-test.ts
 */
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ADVISOR_EMAIL = "e2e-advisor@orimipuy.com";
const CLIENT_EMAIL  = "e2e-client@orimipuy.com";

const keyJson = readFileSync(resolve(process.cwd(), "service-account-key.json"), "utf8");
initializeApp({ credential: cert(JSON.parse(keyJson)) });
const db = getFirestore();
const auth = getAuth();

async function uidOf(email: string): Promise<string | null> {
  try { return (await auth.getUserByEmail(email)).uid; } catch { return null; }
}

async function main() {
  const advisorUid = await uidOf(ADVISOR_EMAIL);
  const clientUid  = await uidOf(CLIENT_EMAIL);

  const dels: Promise<unknown>[] = [];
  for (const email of [ADVISOR_EMAIL, CLIENT_EMAIL]) {
    dels.push(db.collection("allowlist").doc(email).delete());
    dels.push(db.collection("clientLinks").doc(`pending_${email}`).delete());
  }
  if (advisorUid) {
    dels.push(db.collection("advisors").doc(advisorUid).delete());
    dels.push(db.collection("practices").doc(`p_${advisorUid}`).delete());
    dels.push(db.collection("users").doc(advisorUid).delete());
    dels.push(db.collection("clientLinks").doc(advisorUid).delete());
  }
  if (clientUid) {
    dels.push(db.collection("users").doc(clientUid).delete());
    dels.push(db.collection("clientLinks").doc(clientUid).delete());
  }
  await Promise.allSettled(dels);
  if (advisorUid) await auth.deleteUser(advisorUid).catch(() => {});
  if (clientUid)  await auth.deleteUser(clientUid).catch(() => {});
  console.log("✅ e2e fixture removed");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
