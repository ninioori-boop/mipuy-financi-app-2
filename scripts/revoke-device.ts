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
import { getAuth } from "firebase-admin/auth";
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

    // Bumping minVersion only blocks FUTURE token→session exchanges. The phone
    // may already hold a Firebase session minted via /api/app-session (the WebView
    // signs in with a custom token and Firebase refresh tokens never expire), so
    // without this the thief keeps full read/write on the client's financial file
    // forever — which is precisely what this script exists to prevent.
    await getAuth().revokeRefreshTokens(uid);

    console.log(`✅ הטוקן של ${uid} בוטל (minVersion=${next}).`);
    console.log(`   • טוקן המכשיר הישן נדחה מיד.`);
    console.log(`   • הסשן שכבר קיים במכשיר בוטל (refresh tokens).`);
    console.log(`   ⚠️  טוקן הזיהוי הנוכחי עשוי להישאר תקף עד שעה — זו מגבלת Firebase.`);
    console.log(`   • המשתמש יפיק טוקן חדש ע"י פתיחת האפליקציה.`);
    console.log(`   • חיבור וואטסאפ, אם קיים, דורש קוד קישור חדש.`);
    process.exit(0);
  })
  .catch((e) => { console.error(e); process.exit(1); });
