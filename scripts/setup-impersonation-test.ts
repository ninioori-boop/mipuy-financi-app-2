/**
 * TEST FIXTURE for the advisor view-as-client feature. Creates two throwaway
 * accounts (test advisor + test client), links them (active, consented), and
 * seeds the client with a small snapshot — so the impersonation flow can be
 * verified end-to-end without touching any real account.
 *
 * Cleanup afterwards with: npx tsx scripts/cleanup-impersonation-test.ts
 *
 * Requires service-account-key.json at project root (gitignored).
 *   npx tsx scripts/setup-impersonation-test.ts          # view tier (access:'read')
 *   npx tsx scripts/setup-impersonation-test.ts --write   # edit tier (access:'write', v2)
 *
 * The --write variant seeds the link at the WRITE tier (as if the client had
 * accepted an edit request) so the Stage-3 advisor-edit path can be verified:
 * an advisor edit must land in the CLIENT's doc + version history, and the
 * advisor's own doc (income 99999) must stay untouched. Probe: check-client-write.ts.
 */
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ADVISOR_EMAIL = "e2e-advisor@orimipuy.com";
const CLIENT_EMAIL  = "e2e-client@orimipuy.com";
// Throwaway test password — these accounts hold fake data and are deleted
// right after the verification run.
const PASSWORD = "E2eTest2026!";

const keyJson = readFileSync(resolve(process.cwd(), "service-account-key.json"), "utf8");
initializeApp({ credential: cert(JSON.parse(keyJson)) });
const db = getFirestore();
const auth = getAuth();

async function ensureUser(email: string): Promise<string> {
  try {
    return (await auth.getUserByEmail(email)).uid;
  } catch {
    // Admin creation does NOT trigger the beforeUserCreated gate — fine for a fixture.
    return (await auth.createUser({ email, password: PASSWORD, emailVerified: true })).uid;
  }
}

async function main() {
  const advisorUid = await ensureUser(ADVISOR_EMAIL);
  const clientUid  = await ensureUser(CLIENT_EMAIL);

  // Allowlist both (users/{uid} rule requires it for the owner's own access).
  for (const email of [ADVISOR_EMAIL, CLIENT_EMAIL]) {
    await db.collection("allowlist").doc(email).set(
      { email, addedAt: FieldValue.serverTimestamp(), source: "e2e-impersonation-test" }, { merge: true });
  }

  // Advisor role + practice.
  const practiceId = `p_${advisorUid}`;
  await db.collection("practices").doc(practiceId).set(
    { name: "משרד בדיקות E2E", ownerUid: advisorUid, advisorUids: [advisorUid], createdAt: FieldValue.serverTimestamp() }, { merge: true });
  await db.collection("advisors").doc(advisorUid).set(
    { email: ADVISOR_EMAIL, practiceId, role: "owner", createdAt: FieldValue.serverTimestamp() }, { merge: true });

  // Active consented link advisor→client. --write seeds the WRITE tier.
  const writeTier = process.argv.includes("--write");
  await db.collection("clientLinks").doc(clientUid).set({
    status: "active", clientUid, invitedEmail: CLIENT_EMAIL, invitedByUid: advisorUid,
    practiceId,
    access: writeTier ? "write" : "read",
    consentVersion: writeTier ? "v2" : "v1",
    ...(writeTier ? { editConsentAt: FieldValue.serverTimestamp() } : {}),
    stage: "מיפוי",
    consentAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp(),
    statusChangedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  // Distinctive client snapshot — values that are unmistakably the CLIENT's
  // when seen in the tabs (income 77,777 etc.).
  const snapshot = {
    version: 1,
    mapping: {
      income:   [{ id: "e2e-i1", name: "משכורת לקוח בדיקה", amount: 77777 }],
      fixed:    [{ id: "e2e-f1", name: "שכר דירה בדיקה", amount: 5555 }],
      sub:      [], ins: [],
      variable: [{ id: "e2e-v1", name: "סופר בדיקה", amount: 3333 }],
      annual:   [], debts: [], installments: [],
      savings:  [], creditCards: [], bankAccounts: [{ id: "e2e-b1", name: "עו״ש בדיקה", balance: 12345, overdraftLimit: 10000 }],
      varMonths: 1, creditImported: false, bufferPct: 10,
      incomeOverride: null, expensesOverride: null, creditScore: 0,
    },
    goals: {
      short: [{ id: "e2e-g1", name: "יעד בדיקה", required: 10000, current: 2500, monthly: 500, targetDate: "2027-01", product: "" }],
      medium: [], long: [], isUSCitizen: null,
    },
  };
  await db.collection("users").doc(clientUid).set(
    { data: snapshot, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

  // The ADVISOR gets distinctive data of their OWN (income 99999 + a budget
  // month) so the bleed-through check is possible: while viewing the client,
  // no tab may show 99999 / the advisor's month.
  const advisorSnapshot = {
    version: 1,
    mapping: {
      income:   [{ id: "adv-i1", name: "הכנסה של היועץ עצמו", amount: 99999 }],
      fixed: [], sub: [], ins: [], variable: [], annual: [], debts: [],
      installments: [], savings: [], creditCards: [], bankAccounts: [],
      varMonths: 1, creditImported: false, bufferPct: 10,
      incomeOverride: null, expensesOverride: null, creditScore: 0,
    },
    monthly: {
      months: {
        jan: {
          income: [{ id: "adv-m1", name: "תקציב היועץ עצמו", planned: 99999, actual: 0, fromMapping: false }],
          fixed: [], variable: [], sub: [], ins: [], installments: [], debts: [], savings: [], deletedRows: [],
        },
      },
    },
  };
  await db.collection("users").doc(advisorUid).set(
    { data: advisorSnapshot, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

  console.log("✅ fixture ready" + (writeTier ? " (WRITE tier — advisor may edit)" : " (view tier)"));
  console.log("advisorUid=" + advisorUid);
  console.log("clientUid=" + clientUid);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
