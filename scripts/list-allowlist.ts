/**
 * Verify the `allowlist` collection: counts entries and checks each id is a
 * valid lower-cased email (so it will match request.auth.token.email in rules).
 * Prints only counts — never the addresses themselves.
 *
 * Requires service-account-key.json at project root.
 *   npx tsx scripts/list-allowlist.ts
 */
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const keyJson = readFileSync(resolve(process.cwd(), "service-account-key.json"), "utf8");
initializeApp({ credential: cert(JSON.parse(keyJson)) });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function main() {
  const db = getFirestore();
  const auth = getAuth();

  const snap = await db.collection("allowlist").get();
  const allow = new Set<string>();
  let badFormat = 0;
  for (const d of snap.docs) {
    const id = d.id;
    if (EMAIL.test(id) && id === id.toLowerCase()) allow.add(id);
    else badFormat++;
  }

  // Cross-check: every auth user's email must be present in the allowlist.
  let authCount = 0;
  let missing = 0;
  let pageToken: string | undefined;
  do {
    const res = await auth.listUsers(1000, pageToken);
    for (const u of res.users) {
      if (!u.email) continue;
      authCount++;
      if (!allow.has(u.email.toLowerCase().trim())) missing++;
    }
    pageToken = res.pageToken;
  } while (pageToken);

  console.log(`allowlist entries: ${snap.size} (valid lowercase emails: ${allow.size}, bad format: ${badFormat})`);
  console.log(`auth users with email: ${authCount}`);
  console.log(missing === 0
    ? `✅ every existing user is in the allowlist — none will be locked out.`
    : `🚨 ${missing} existing users are MISSING from the allowlist — they would be locked out!`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
