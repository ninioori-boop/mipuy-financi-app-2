/**
 * Grant ONE email access to invite-only signup (adds it to the `allowlist`).
 * Idempotent — safe to re-run.
 *
 * Requires service-account-key.json at project root (gitignored).
 *   npx tsx scripts/allow-email.ts someone@example.com
 */
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const email = process.argv[2]?.toLowerCase().trim();
if (!email || !email.includes("@")) {
  console.error("שימוש: npx tsx scripts/allow-email.ts someone@example.com");
  process.exit(1);
}

const keyJson = readFileSync(resolve(process.cwd(), "service-account-key.json"), "utf8");
initializeApp({ credential: cert(JSON.parse(keyJson)) });

getFirestore()
  .collection("allowlist")
  .doc(email)
  .set({ email, addedAt: new Date().toISOString(), source: "manual" }, { merge: true })
  .then(() => {
    console.log(`✅ ${email} אושר/ה לגישה. עכשיו אפשר להירשם עם המייל הזה.`);
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
