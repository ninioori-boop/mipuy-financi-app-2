/** TEST-ONLY: trace the WhatsApp expense — inbox (undrained) or expenseLog (drained). Read-only. */
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

  const items = await db.collection("transactionInbox").doc(uid).collection("items").get();
  console.log(`INBOX items (undrained): ${items.size}`);
  items.forEach((d) => { const v = d.data(); console.log("  ", v.ref || d.id, "|", v.merchant, "|", v.amount, "|", v.category || "?", "| source:", v.source || "?"); });

  const snap = await db.collection("users").doc(uid).get();
  const entries = (((snap.data() || {}).data || {}).expenseLog || {}).entries || [];
  const wa = entries.filter((e: any) => e && (String(e.ref || "").startsWith("wa:") || e.source === "whatsapp"));
  console.log(`\nexpenseLog entries total: ${entries.length} | from WhatsApp: ${wa.length}`);
  wa.slice(-5).forEach((e: any) => console.log("  ", e.ref || "", "|", e.merchant || e.desc, "|", e.amount, "|", e.category, "|", e.date));
  console.log("\nlast 3 expenseLog entries (any source):");
  entries.slice(-3).forEach((e: any) => console.log("  ", e.merchant || e.desc, "|", e.amount, "|", e.category, "|", e.date, "| ref:", e.ref || "-", "| source:", e.source || "-"));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
