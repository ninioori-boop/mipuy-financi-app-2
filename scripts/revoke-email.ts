/**
 * Revoke an email from invite-only access (removes it from the `allowlist`).
 * Because access is gated by Firestore rules on every read/write, removing the
 * email blocks that person's data access within ~a minute — even an active one.
 * The auth account still exists; to delete it fully use Firebase Auth → Users.
 *
 * Requires service-account-key.json at project root.
 *   npx tsx scripts/revoke-email.ts someone@example.com
 */
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const email = process.argv[2]?.toLowerCase().trim();
if (!email || !email.includes("@")) {
  console.error("שימוש: npx tsx scripts/revoke-email.ts someone@example.com");
  process.exit(1);
}

const keyJson = readFileSync(resolve(process.cwd(), "service-account-key.json"), "utf8");
initializeApp({ credential: cert(JSON.parse(keyJson)) });

const ref = getFirestore().collection("allowlist").doc(email);
ref.get()
  .then(async (snap) => {
    if (!snap.exists) {
      console.log(`ℹ️ ${email} לא היה ברשימה ממילא — אין מה למחוק.`);
      process.exit(0);
    }
    await ref.delete();
    console.log(`✅ ${email} הוסר/ה מהרשימה — הגישה שלו/ה לנתונים נחסמת תוך כדקה.`);
    console.log(`   (למחיקת החשבון לגמרי: Authentication → Users → Delete.)`);
    process.exit(0);
  })
  .catch((e) => { console.error(e); process.exit(1); });
