/**
 * Remove everything setup-demo-firm.ts created: the 2 demo advisors, their
 * demo clientLinks, and their membership in Ori's practice. Leaves the real
 * firm + Ori untouched. Requires service-account-key.json.
 *   npx tsx scripts/cleanup-demo-firm.ts
 */
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const keyJson = readFileSync(resolve(process.cwd(), "service-account-key.json"), "utf8");
initializeApp({ credential: cert(JSON.parse(keyJson)) });
const db = getFirestore();

const PRACTICE_ID = "p_TYxUOdf3LcTiyuzunrAf0CEVsQx1";
const DEMO_UIDS = ["demo_advisor_yael", "demo_advisor_dan"];

async function main() {
  // Delete demo clientLinks.
  const links = await db.collection("clientLinks").where("demo", "==", true).get();
  await Promise.all(links.docs.map((d) => d.ref.delete()));
  console.log(`- deleted ${links.size} demo clientLinks`);

  // Delete demo advisor docs.
  await Promise.all(DEMO_UIDS.map((uid) => db.collection("advisors").doc(uid).delete()));
  console.log(`- deleted ${DEMO_UIDS.length} demo advisors`);

  // Remove them from the practice's advisorUids.
  await db.collection("practices").doc(PRACTICE_ID).set({
    advisorUids: FieldValue.arrayRemove(...DEMO_UIDS),
  }, { merge: true });
  console.log("- removed demo advisors from the practice");

  console.log('\n✅ demo firm removed — "הכלכלן של הבית" is back to solo (just Ori).');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
