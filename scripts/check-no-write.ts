/**
 * Verification probe for the view-as-client save guards: asserts that the
 * TEST ADVISOR's users/{uid} doc does NOT exist (nothing was persisted while
 * impersonating) and prints the TEST CLIENT doc's updatedAt (must be the
 * fixture seed time, unchanged). Read-only.
 *   npx tsx scripts/check-no-write.ts
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
  const advisorUid = (await getAuth().getUserByEmail("e2e-advisor@orimipuy.com")).uid;
  const clientUid  = (await getAuth().getUserByEmail("e2e-client@orimipuy.com")).uid;

  const adv = await db.collection("users").doc(advisorUid).get();
  const cli = await db.collection("users").doc(clientUid).get();

  console.log("advisor users doc exists:", adv.exists, adv.exists ? "❌ GUARD FAILED — data was written!" : "✅ nothing written");
  console.log("client updatedAt:", cli.get("updatedAt")?.toDate?.()?.toISOString() ?? "n/a");
  const income = cli.get("data")?.mapping?.income;
  console.log("client income rows:", Array.isArray(income) ? income.length : "n/a", "(must be 1 — the seeded row)");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
