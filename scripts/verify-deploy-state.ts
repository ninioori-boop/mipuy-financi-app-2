/**
 * Read-only deploy-state verification: e2e fixture fully removed, and the real
 * advisor/link records intact (Ori advisor role, Rotem's active link).
 *   npx tsx scripts/verify-deploy-state.ts
 */
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const keyJson = readFileSync(resolve(process.cwd(), "service-account-key.json"), "utf8");
initializeApp({ credential: cert(JSON.parse(keyJson)) });
const db = getFirestore();

async function main() {
  for (const e of ["e2e-advisor@orimipuy.com", "e2e-client@orimipuy.com"]) {
    const exists = await getAuth().getUserByEmail(e).then(() => true).catch(() => false);
    console.log(`fixture ${e}: ${exists ? "❌ STILL EXISTS" : "gone ✅"}`);
  }
  const oriUid = (await getAuth().getUserByEmail("ninioori@gmail.com")).uid;
  console.log("Ori advisor role:", (await db.collection("advisors").doc(oriUid).get()).exists ? "✅" : "❌ missing");
  console.log("Ori owner role:", (await db.collection("platformOwners").doc(oriUid).get()).exists ? "✅" : "❌ missing");
  const links = await db.collection("clientLinks").where("invitedByUid", "==", oriUid).get();
  links.forEach(d => {
    const x = d.data();
    console.log(`link ${x.invitedEmail}: status=${x.status}`);
  });
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
