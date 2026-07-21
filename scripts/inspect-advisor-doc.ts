/**
 * Inspect WHAT is inside the test advisor's users doc — client data (a leak)
 * or empty defaults (legitimate own-account save after exiting view mode).
 * Read-only.
 */
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const keyJson = readFileSync(resolve(process.cwd(), "service-account-key.json"), "utf8");
initializeApp({ credential: cert(JSON.parse(keyJson)) });

async function main() {
  const advisorUid = (await getAuth().getUserByEmail("e2e-advisor@orimipuy.com")).uid;
  const doc = await getFirestore().collection("users").doc(advisorUid).get();
  if (!doc.exists) { console.log("doc gone"); return; }
  const m = doc.get("data")?.mapping ?? {};
  const income = m.income ?? [];
  console.log("updatedAt:", doc.get("updatedAt")?.toDate?.()?.toISOString());
  console.log("income rows:", income.length, JSON.stringify(income).slice(0, 200));
  console.log("fixed rows:", (m.fixed ?? []).length);
  console.log("bankAccounts:", JSON.stringify(m.bankAccounts ?? []).slice(0, 150));
  const leak = JSON.stringify(doc.get("data") ?? {}).includes("בדיקה");
  console.log(leak ? "❌ CONTAINS CLIENT FIXTURE DATA — LEAK" : "✅ no client data — own empty defaults (legitimate)");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
