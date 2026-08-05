/**
 * Operator-side account deletion — for a user who LOST ACCESS and asked by
 * email (the self-service path in the app is the normal route).
 *
 *   npx tsx scripts/delete-account.ts someone@example.com
 *
 * Identity must be verified FIRST: reply to the address on file and get a
 * confirmation from it. This script only automates the deletion itself — the
 * same order as the deployed deleteMyAccount callable.
 */
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as readline from "node:readline/promises";

const BUCKET = "finance-machine-a36e9.firebasestorage.app";

async function main() {
  const email = process.argv[2]?.toLowerCase().trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error("שימוש: npx tsx scripts/delete-account.ts someone@example.com");
    process.exit(1);
  }
  initializeApp({ credential: cert(JSON.parse(readFileSync(resolve(process.cwd(), "service-account-key.json"), "utf8"))) });
  const db = getFirestore();
  const auth = getAuth();

  let uid: string;
  try { uid = (await auth.getUserByEmail(email)).uid; }
  catch { console.error(`אין חשבון עם הכתובת ${email}`); process.exit(1); return; }

  // Show what is about to be destroyed, then require a second confirmation.
  const userDoc = await db.collection("users").doc(uid).get();
  const link = await db.collection("clientLinks").doc(uid).get();
  const advisor = await db.collection("advisors").doc(uid).get();
  const owned = await db.collection("practices").where("ownerUid", "==", uid).get();
  console.log(`\nחשבון: ${email}\nuid: ${uid}`);
  console.log(`תיק נתונים: ${userDoc.exists ? "קיים" : "אין"} · קישור יועץ: ${link.exists ? link.data()?.status : "אין"} · תפקיד יועץ: ${advisor.exists ? "כן" : "לא"} · בעלות על משרד: ${owned.size}`);
  if (owned.size > 0) {
    console.error("\n⛔ בעל משרד. יש להעביר בעלות או לסגור את המשרד לפני מחיקה. עוצר.");
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const typed = await rl.question(`\nלאישור סופי הקלד את הכתובת במלואה: `);
  rl.close();
  if (typed.toLowerCase().trim() !== email) { console.error("לא תואם. בוטל."); process.exit(1); }

  // Same order as the deployed callable: tombstones → door → the rest.
  await db.collection("deletionAudit").doc(uid).set({ deletedAt: FieldValue.serverTimestamp(), via: "operator-script" }, { merge: true });
  await db.collection("deviceTokens").doc(uid).set({ minVersion: 2147483647, tombstone: true }, { merge: true });
  const batch = db.batch();
  batch.delete(db.collection("allowlist").doc(email));
  batch.delete(db.collection("pendingAdvisors").doc(email));
  batch.delete(db.collection("clientLinks").doc(`pending_${email}`));
  await batch.commit();
  await auth.revokeRefreshTokens(uid);

  const asAdvisor = await db.collection("clientLinks").where("invitedByUid", "==", uid).get();
  for (const d of asAdvisor.docs) {
    await d.ref.update({ invitedByUid: null, status: "orphaned", access: "read", advisorRemovedAt: FieldValue.serverTimestamp() });
  }
  await db.collection("clientLinks").doc(uid).delete();
  await db.collection("advisors").doc(uid).delete();
  const member = await db.collection("practices").where("advisorUids", "array-contains", uid).get();
  for (const p of member.docs) await p.ref.update({ advisorUids: FieldValue.arrayRemove(uid) });

  for (const col of ["whatsappLinks", "whatsappLinkCodes"]) {
    const snap = await db.collection(col).where("uid", "==", uid).get();
    for (const d of snap.docs) await d.ref.delete();
  }
  await db.collection("pushSubscriptions").doc(uid).delete().catch(() => {});
  await getStorage().bucket(BUCKET).deleteFiles({ prefix: `intake/${uid}/` });
  await db.recursiveDelete(db.collection("intake").doc(uid));
  await db.recursiveDelete(db.collection("transactionInbox").doc(uid));
  await db.recursiveDelete(db.collection("users").doc(uid));

  const rows = await db.collection("emailLog").where("to", "==", email).get();
  for (const d of rows.docs) await d.ref.update({ to: "deleted@removed.local", error: "", resendId: null });

  await auth.deleteUser(uid);

  const residue: string[] = [];
  for (const c of ["users", "transactionInbox", "intake", "clientLinks", "advisors"]) {
    if ((await db.collection(c).doc(uid).get()).exists) residue.push(c);
  }
  console.log(residue.length ? `⚠️ שאריות: ${residue.join(", ")} — נדרש טיפול ידני` : "\n✅ החשבון נמחק במלואו. אפס שאריות.");
}

main().then(() => setTimeout(() => process.exit(0), 200)).catch(e => { console.error("נכשל:", e); setTimeout(() => process.exit(1), 200); });
