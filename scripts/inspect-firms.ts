/**
 * Read-only: list every practice (firm) and advisor, so we can see the current
 * firm structure before provisioning. Requires service-account-key.json.
 *   npx tsx scripts/inspect-firms.ts
 */
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const keyJson = readFileSync(resolve(process.cwd(), "service-account-key.json"), "utf8");
initializeApp({ credential: cert(JSON.parse(keyJson)) });
const db = getFirestore();

async function main() {
  const [practices, advisors] = await Promise.all([
    db.collection("practices").get(),
    db.collection("advisors").get(),
  ]);

  console.log("=== PRACTICES (firms) ===");
  practices.forEach((p) => {
    const d = p.data();
    console.log(`- id=${p.id} | name="${d.name}" | ownerUid=${d.ownerUid} | advisorUids=${JSON.stringify(d.advisorUids || [])}`);
  });

  console.log("\n=== ADVISORS ===");
  advisors.forEach((a) => {
    const d = a.data();
    console.log(`- uid=${a.id} | email=${d.email} | practiceId=${d.practiceId} | role=${d.role || "member"}`);
  });
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
