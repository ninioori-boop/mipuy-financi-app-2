/** TEST-ONLY: inspect the WhatsApp link state after Ori texts the code. Read-only. */
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const keyJson = readFileSync(resolve(process.cwd(), "service-account-key.json"), "utf8");
initializeApp({ credential: cert(JSON.parse(keyJson)) });
const db = getFirestore();

async function main() {
  const uid = (await getAuth().getUserByEmail("ninioori@gmail.com")).uid;

  const code = await db.collection("whatsappLinkCodes").doc("TESTWA").get();
  const c = code.data() || {};
  console.log("CODE TESTWA:", code.exists
    ? { consumed: c.consumed, consumedByPhone: c.consumedByPhone || null, deviceTokenStripped: !("deviceToken" in c) }
    : "MISSING");

  const links = await db.collection("whatsappLinks").where("uid", "==", uid).get();
  console.log(`whatsappLinks for uid (${links.size}):`);
  links.forEach((d) => {
    const v = d.data();
    console.log("  phone:", d.id, "| deviceToken:", v.deviceToken === null ? "null(expected)" : (v.deviceToken ? "present" : "missing"), "| linkedAt:", v.linkedAt ? "set" : "—");
  });

  const seen = await db.collection("clientBot").listDocuments();
  console.log("clientBot dedup markers:", seen.filter((d) => d.id.startsWith("_seen_")).length);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
