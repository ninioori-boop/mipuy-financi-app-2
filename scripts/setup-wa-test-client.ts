/**
 * TEST-ONLY seed for the WhatsApp client bot (partial test, no web env / no secrets).
 * Writes a one-time link code straight into Firestore so Ori can text it to the bot
 * and exercise tryConsumeCode + linking + Q&A + dedup — WITHOUT the /api/wa-link-code
 * web route (which needs prod secrets we won't move around).
 *
 * deviceToken is intentionally NULL: expense-logging POSTs to prod /api/transaction
 * and needs a token signed with the PROD TRANSACTION_SECRET, which this seed cannot
 * produce. So expense-logging is DEFERRED to the real production deploy; everything
 * else (linking, questions, dedup, bare-input, onboarding) is testable now.
 *
 *   npx tsx scripts/setup-wa-test-client.ts
 *
 * Cleanup after the test:
 *   npx tsx scripts/setup-wa-test-client.ts --clean   (deletes the code + the link)
 *
 * Requires service-account-key.json at project root (gitignored).
 */
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const KEY_FILE = "service-account-key.json";
const EMAIL = "ninioori@gmail.com";
const CODE = "TESTWA"; // fixed, easy to type; matches the bot's [A-Z0-9]{4,10} matcher
const TTL_MS = 2 * 60 * 60 * 1000; // 2h — long enough to not expire mid-test

const keyJson = readFileSync(resolve(process.cwd(), KEY_FILE), "utf8");
initializeApp({ credential: cert(JSON.parse(keyJson)) });
const db = getFirestore();
const auth = getAuth();

async function main() {
  const clean = process.argv.includes("--clean");
  const uid = (await auth.getUserByEmail(EMAIL)).uid;
  console.log(`resolved uid for ${EMAIL}: ${uid}`);

  if (clean) {
    await db.collection("whatsappLinkCodes").doc(CODE).delete().catch(() => {});
    // The link is keyed by PHONE (written by the bot on consume). Find + delete any
    // link that points at this uid so Ori stops being "linked" after the test.
    const links = await db.collection("whatsappLinks").where("uid", "==", uid).get();
    for (const d of links.docs) await d.ref.delete();
    console.log(`cleaned: code ${CODE} + ${links.size} whatsappLinks for uid`);
    return;
  }

  await db.collection("whatsappLinkCodes").doc(CODE).set({
    uid,
    deviceToken: null, // expense-logging deferred (needs prod TRANSACTION_SECRET)
    practiceId: null, // owner-access: no advisor link needed
    invitedByUid: null,
    consumed: false,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + TTL_MS),
    test: true,
  });
  console.log(`\nSEEDED code "${CODE}" -> uid ${uid} (valid ~2h, no device token).`);
  console.log(`Send "${CODE}" from Ori's phone to the bot to link + test.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
