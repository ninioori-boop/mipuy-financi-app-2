/**
 * verify-legacy-emails.ts — one-time migration for the email_verified gates.
 *
 * Sets emailVerified=true on LEGACY password accounts: accounts created before
 * the invite-squatting fix required a verified email claim (clientLinks read
 * rule + setClientSharing). These are personally-onboarded, allowlisted
 * clients — the gate exists to block FUTURE squatter accounts, not them.
 * Without this migration, 22 of 51 live accounts would hit the new
 * VerifyEmailScreen on their next visit and any future advisor invite to them
 * would be invisible until they clicked a verification mail.
 *
 * Safety: dry-run by default (prints the exact list, writes nothing);
 * `--apply` to write. Only accounts that are BOTH password-provider-unverified
 * AND present in the allowlist are touched — an account outside the allowlist
 * cannot use the app at all and stays untouched. Reversible per-account with
 * updateUser(uid, { emailVerified: false }).
 *
 * Run from the repo root:  npx tsx scripts/verify-legacy-emails.ts [--apply]
 */
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

initializeApp({ credential: cert(JSON.parse(
  readFileSync(resolve(process.cwd(), "service-account-key.json"), "utf8"))) });

const APPLY = process.argv.includes("--apply");
const mask = (em: string) => em.slice(0, 2) + "***@" + (em.split("@")[1] ?? "?");

async function main() {
  const auth = getAuth();
  const db = getFirestore();

  const allow = new Set((await db.collection("allowlist").get()).docs.map(d => d.id));
  console.log(`allowlist: ${allow.size} entries`);

  const candidates: { uid: string; email: string }[] = [];
  const skippedNotAllowlisted: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const u of page.users) {
      if (!u.providerData.some(p => p.providerId === "password")) continue;
      if (u.emailVerified || !u.email) continue;
      const email = u.email.toLowerCase();
      if (allow.has(email)) candidates.push({ uid: u.uid, email });
      else skippedNotAllowlisted.push(mask(email));
    }
    pageToken = page.pageToken;
  } while (pageToken);

  console.log(`\n${APPLY ? "APPLYING to" : "DRY RUN —"} ${candidates.length} legacy account(s):`);
  for (const c of candidates) console.log(`  ${c.uid.slice(0, 8)}…  ${mask(c.email)}`);
  if (skippedNotAllowlisted.length) {
    console.log(`\nskipped (unverified but NOT allowlisted — cannot use the app anyway): ${skippedNotAllowlisted.join(", ")}`);
  }

  if (!APPLY) {
    console.log("\nno writes performed. Re-run with --apply to migrate.");
    return;
  }

  let ok = 0;
  for (const c of candidates) {
    await auth.updateUser(c.uid, { emailVerified: true });
    ok++;
  }
  console.log(`\nupdated ${ok}/${candidates.length}.`);

  // Verify: re-read every migrated account.
  let confirmed = 0;
  for (const c of candidates) {
    if ((await auth.getUser(c.uid)).emailVerified) confirmed++;
  }
  console.log(`verified after write: ${confirmed}/${candidates.length} now emailVerified=true`);
  if (confirmed !== candidates.length) process.exit(1);
}

main().then(() => setTimeout(() => process.exit(0), 150))
  .catch(e => { console.error(e); process.exit(1); });
