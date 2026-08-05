/**
 * Credit-split drift check: compares the credit transactions inside every
 * users/{uid}.data against the shadow copy at users/{uid}/sections/credit.
 *
 *   npx tsx scripts/verify-credit-split.ts
 *
 * During phase A (shadow write) a MISSING shadow is fine — it appears on the
 * user's first save after the deploy. A DIFFERENT shadow is the alarm.
 * The phase B read-switch is allowed only after days of zero drift here.
 */
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const canon = (v: unknown): string => {
  const s = (x: unknown): string => {
    if (x === null || typeof x !== "object") return JSON.stringify(x) ?? "null";
    if (Array.isArray(x)) return `[${x.map(s).join(",")}]`;
    return `{${Object.keys(x as object).sort().map(k => `${JSON.stringify(k)}:${s((x as Record<string, unknown>)[k])}`).join(",")}}`;
  };
  return createHash("sha256").update(s(v)).digest("hex").slice(0, 12);
};

async function main() {
  initializeApp({ credential: cert(JSON.parse(readFileSync(resolve(process.cwd(), "service-account-key.json"), "utf8"))) });
  const db = getFirestore();
  const users = await db.collection("users").get();

  let match = 0, missing = 0, drift = 0, noCredit = 0;
  const driftUids: string[] = [];

  for (const d of users.docs) {
    const credit = (d.data()?.data as Record<string, unknown> | undefined)?.credit as
      { transactions?: unknown[]; uploadedFileNames?: unknown[] } | undefined;
    // Skip only when the credit key is entirely absent. An EMPTY list still
    // gets compared — "user deleted all rows" is exactly the resurrection case
    // the split must never reintroduce, so a stale shadow there must be drift.
    if (!credit || !Array.isArray(credit.transactions)) { noCredit += 1; continue; }

    const shadow = await d.ref.collection("sections").doc("credit").get();
    if (!shadow.exists) { missing += 1; continue; }

    const mainHash = canon({ t: credit.transactions, f: credit.uploadedFileNames ?? [] });
    const shadowHash = canon({ t: shadow.data()?.transactions ?? [], f: shadow.data()?.uploadedFileNames ?? [] });
    if (mainHash === shadowHash) match += 1;
    else { drift += 1; driftUids.push(d.id); }
  }

  console.log(`\n=== אימות פיצול האשראי (${users.size} חשבונות) ===`);
  console.log(`ללא נתוני אשראי: ${noCredit}`);
  console.log(`צל תואם:         ${match} ✅`);
  console.log(`צל עוד לא נכתב:  ${missing}  (תקין בשלב א', מופיע בשמירה הראשונה)`);
  console.log(`סטייה:           ${drift} ${drift ? "❌ " + driftUids.map(u => u.slice(0, 8)).join(", ") : "✅"}`);
  if (drift) {
    console.log("\n⛔ יש סטייה בין העותקים. לא לעבור לשלב ב' עד שזה מוסבר ומתוקן.");
    process.exitCode = 1;
  }
}

main().then(() => setTimeout(() => process.exit(process.exitCode ?? 0), 150))
  .catch(e => { console.error(e); setTimeout(() => process.exit(1), 150); });
