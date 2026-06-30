/**
 * Revoke ONE user's device token (e.g. a lost/stolen phone) WITHOUT rotating the
 * global TRANSACTION_SECRET — which would kill every user's token at once. Bumps
 * the user's `minVersion` in `deviceTokens/{uid}`; every device token issued below
 * the new version is rejected on its next call (see src/lib/deviceTokenRevocation.ts).
 * The user simply re-opens the app to get a fresh token (signed at the new version
 * automatically by /api/device-token).
 *
 * Requires service-account-key.json at project root (gitignored).
 *   npx tsx scripts/revoke-device.ts <uid>
 *   (the uid is in Firebase Console → Authentication → Users)
 */
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const uid = process.argv[2]?.trim();
if (!uid) {
  console.error("שימוש: npx tsx scripts/revoke-device.ts <uid>");
  console.error("  (ה-uid נמצא ב-Firebase Console → Authentication → Users)");
  process.exit(1);
}

const keyJson = readFileSync(resolve(process.cwd(), "service-account-key.json"), "utf8");
initializeApp({ credential: cert(JSON.parse(keyJson)) });

const ref = getFirestore().collection("deviceTokens").doc(uid);
ref.get()
  .then(async (snap) => {
    const current = snap.exists ? Number(snap.data()?.minVersion ?? 0) : 0;
    const next = current + 1;
    await ref.set({ minVersion: next, updatedAt: new Date().toISOString() }, { merge: true });
    console.log(`✅ הטוקן של ${uid} בוטל (minVersion=${next}). כל טוקן ישן נדחה מיד.`);
    console.log(`   המשתמש יפיק טוקן חדש פשוט ע"י פתיחת האפליקציה.`);
    process.exit(0);
  })
  .catch((e) => { console.error(e); process.exit(1); });
