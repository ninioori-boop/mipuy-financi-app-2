/**
 * Point Firebase's email ACTION HANDLER at the app's own page.
 *
 * Every link in a Firebase-sent mail (verify your address, reset your password,
 * undo an email change) lands on ONE url, `notification.sendEmail.callbackUri`.
 * It was set to `https://orimipuy.com/reset.html` — a page in the OLD app that
 * begins `if (mode !== 'resetPassword') { showError('קישור לא תקין…') }`, so
 * every verification link ever sent was answered with a message about password
 * resets. Password sign-ups could not verify at all; the workaround was signing
 * in with Google, which needs no link. (Found 2026-08-11, two clients hit it.)
 *
 * ⚠️ SHARED INFRASTRUCTURE. This one setting serves BOTH apps on this Firebase
 * project, so flipping it also routes the OLD app's password-reset links to the
 * target page. Do not run this until that page is deployed and a real reset link
 * has been walked end to end.
 *
 * Read-only by default. Prints the current value and what would change.
 *   npx tsx scripts/set-auth-action-handler.ts            # dry run
 *   npx tsx scripts/set-auth-action-handler.ts --apply    # write
 */
import { cert, initializeApp } from "firebase-admin/app";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TARGET = "https://app.orimipuy.com/auth/action";

const key = JSON.parse(readFileSync(resolve(process.cwd(), "service-account-key.json"), "utf8"));
const app = initializeApp({ credential: cert(key) });
const PROJECT = key.project_id;
const APPLY = process.argv.includes("--apply");

async function token(): Promise<string> {
  return (await (app.options.credential as {
    getAccessToken(): Promise<{ access_token: string }>
  }).getAccessToken()).access_token;
}

const CONFIG = `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/config`;

async function main() {
  const t = await token();

  const before = await (await fetch(CONFIG, { headers: { Authorization: `Bearer ${t}` } })).json();
  const current = before?.notification?.sendEmail?.callbackUri ?? "(ברירת המחדל של Firebase)";
  console.log(`\nפרויקט: ${PROJECT}`);
  console.log(`עכשיו:  ${current}`);
  console.log(`אחרי:   ${TARGET}`);

  if (current === TARGET) {
    console.log("\n✅ כבר מוגדר נכון. לא נדרש שינוי.\n");
    return;
  }

  if (!APPLY) {
    console.log("\n🔍 הרצה יבשה. לא נכתב דבר. להחלה: --apply\n");
    console.log("⚠️  זכור: ההגדרה הזאת משרתת גם את האפליקציה הישנה. קישורי איפוס סיסמה");
    console.log("    משתי המערכות ינחתו מעכשיו בדף החדש.\n");
    return;
  }

  const res = await fetch(`${CONFIG}?updateMask=notification.sendEmail.callbackUri`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify({ notification: { sendEmail: { callbackUri: TARGET } } }),
  });
  if (!res.ok) {
    console.error(`\n❌ העדכון נכשל: HTTP ${res.status}\n${(await res.text()).slice(0, 400)}\n`);
    process.exitCode = 1;
    return;
  }

  // Prove it, from the server, not from the response we just sent.
  const after = await (await fetch(CONFIG, { headers: { Authorization: `Bearer ${t}` } })).json();
  const now = after?.notification?.sendEmail?.callbackUri ?? "(ברירת מחדל)";
  console.log(`\n${now === TARGET ? "✅" : "❌"} הערך בשרת עכשיו: ${now}\n`);
  if (now !== TARGET) process.exitCode = 1;
}

main().then(() => setTimeout(() => process.exit(process.exitCode ?? 0), 150))
  .catch((e) => { console.error(e); process.exit(1); });
