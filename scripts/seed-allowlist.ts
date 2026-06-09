/**
 * Seed the `allowlist` collection from existing Firebase Auth users, so every
 * CURRENT user is grandfathered into invite-only signup before the gate goes live.
 * Idempotent — safe to re-run.
 *
 * Requires service-account-key.json at project root (gitignored).
 *   npx tsx scripts/seed-allowlist.ts
 */
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const KEY_PATH = resolve(process.cwd(), "service-account-key.json");

async function main() {
  let keyJson: string;
  try {
    keyJson = readFileSync(KEY_PATH, "utf8");
  } catch {
    console.error(`\n❌ לא נמצא service-account-key.json בנתיב:\n   ${KEY_PATH}\n`);
    process.exit(1);
  }

  initializeApp({ credential: cert(JSON.parse(keyJson)) });
  const auth = getAuth();
  const db = getFirestore();

  const emails = new Set<string>();
  let pageToken: string | undefined;
  do {
    const res = await auth.listUsers(1000, pageToken);
    for (const u of res.users) {
      if (u.email) emails.add(u.email.toLowerCase().trim());
    }
    pageToken = res.pageToken;
  } while (pageToken);

  console.log(`🔍 נמצאו ${emails.size} מיילים קיימים. זורע ל-allowlist...`);

  let batch = db.batch();
  let n = 0;
  for (const email of emails) {
    batch.set(
      db.collection("allowlist").doc(email),
      { email, addedAt: new Date().toISOString(), source: "seed-existing" },
      { merge: true },
    );
    if (++n % 400 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }
  await batch.commit();

  console.log(`✅ ${emails.size} מיילים קיימים אושרו (grandfathered). אף משתמש קיים לא ייפגע.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
