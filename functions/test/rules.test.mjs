// Firestore security-rules unit tests for the advisor↔client management feature.
//
// These are the SAFETY NET for the additive rules change. They run entirely in
// the local Firestore emulator — they never touch the real project.
//
// Prerequisites to run (not yet installed in this environment):
//   1. Java (JRE) — required by the Firestore emulator.
//   2. `npm i -D @firebase/rules-unit-testing vitest` (vitest is already present).
//
// Run:
//   firebase emulators:exec --only firestore "npx vitest run functions/test/rules.test.mjs"
//
// Coverage: the existing owner path is unbroken; an advisor reads a client ONLY
// with an active link they own; every negative case (cross-client, non-active
// link, direct client writes, advisor writes, cross-advisor reads) is denied.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { beforeAll, afterAll, beforeEach, test } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, query, where } from "firebase/firestore";

const here = dirname(fileURLToPath(import.meta.url));
let testEnv;

const ADVISOR = "advisorA";
const ADVISOR_EMAIL = "advisora@example.com";
const OTHER_ADVISOR = "advisorB";
const CLIENT = "clientX";
const CLIENT_EMAIL = "clientx@example.com";
const OTHER_CLIENT = "clientY";
const OWNER = "ownerO";

const authed = (uid, email) => testEnv.authenticatedContext(uid, email ? { email } : {}).firestore();

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    // demo-* project ids run the CLI fully offline — anything else makes
    // firebase-tools look for a real project, which CI has no access to.
    projectId: "demo-rules-test",
    firestore: { rules: readFileSync(join(here, "..", "..", "firestore.rules"), "utf8") },
  });
});

afterAll(async () => { await testEnv.cleanup(); });

beforeEach(async () => {
  await testEnv.clearFirestore();
  // Seed baseline data with rules disabled (admin-equivalent).
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "allowlist", ADVISOR_EMAIL), { email: ADVISOR_EMAIL });
    await setDoc(doc(db, "allowlist", CLIENT_EMAIL), { email: CLIENT_EMAIL });
    await setDoc(doc(db, "platformOwners", OWNER), { addedAt: 1 });
    await setDoc(doc(db, "advisors", ADVISOR), { email: ADVISOR_EMAIL, practiceId: "p1", role: "owner" });
    await setDoc(doc(db, "practices", "p1"), { name: "Practice 1", ownerUid: ADVISOR, advisorUids: [ADVISOR] });
    await setDoc(doc(db, "users", CLIENT), { data: { any: true }, updatedAt: 1 });
  });
});

async function setLink(status, access = "read") {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "clientLinks", CLIENT), {
      status, clientUid: CLIENT, invitedEmail: CLIENT_EMAIL,
      invitedByUid: ADVISOR, practiceId: "p1", access,
    });
  });
}

// ── Existing behaviour is unbroken ─────────────────────────────────────────
test("owner reads own user doc (allowlisted) — still allowed", async () => {
  await assertSucceeds(getDoc(doc(authed(CLIENT, CLIENT_EMAIL), "users", CLIENT)));
});

test("allowlisted user with NO link reads/writes own doc exactly as before", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "allowlist", "solo@example.com"), { email: "solo@example.com" });
  });
  const db = authed("soloUid", "solo@example.com");
  await assertSucceeds(setDoc(doc(db, "users", "soloUid"), { data: {}, updatedAt: 1 }));
  await assertSucceeds(getDoc(doc(db, "users", "soloUid")));
});

// ── Advisor read of client financial data ──────────────────────────────────
test("advisor reads client ONLY with an active link they own", async () => {
  await setLink("active");
  await assertSucceeds(getDoc(doc(authed(ADVISOR, ADVISOR_EMAIL), "users", CLIENT)));
});

test("advisor CANNOT read client when link is pending/declined/revoked", async () => {
  for (const s of ["pending", "declined", "revoked"]) {
    await setLink(s);
    await assertFails(getDoc(doc(authed(ADVISOR, ADVISOR_EMAIL), "users", CLIENT)));
  }
});

test("a DIFFERENT advisor cannot read the client even when active", async () => {
  await setLink("active");
  await assertFails(getDoc(doc(authed(OTHER_ADVISOR, "b@example.com"), "users", CLIENT)));
});

test("advisor CANNOT write the client doc at READ tier", async () => {
  await setLink("active", "read");
  await assertFails(setDoc(doc(authed(ADVISOR, ADVISOR_EMAIL), "users", CLIENT), { data: { hacked: 1 } }, { merge: true }));
});

// ── Advisor WRITE tier (Stage 3) ────────────────────────────────────────────
test("advisor WRITES client doc + versions when active link is access:'write'", async () => {
  await setLink("active", "write");
  const advDb = authed(ADVISOR, ADVISOR_EMAIL);
  await assertSucceeds(setDoc(doc(advDb, "users", CLIENT), { data: { edited: 1 } }, { merge: true }));
  await assertSucceeds(setDoc(doc(advDb, "users", CLIENT, "versions", "v1"), { savedAt: 1, snapshot: {}, size: 2 }));
  // still reads it too
  await assertSucceeds(getDoc(doc(advDb, "users", CLIENT)));
});

test("advisor with write tier but NON-active link cannot write", async () => {
  for (const s of ["pending", "declined", "revoked"]) {
    await setLink(s, "write");
    await assertFails(setDoc(doc(authed(ADVISOR, ADVISOR_EMAIL), "users", CLIENT), { data: { x: 1 } }, { merge: true }));
  }
});

test("a DIFFERENT advisor cannot write even at write tier", async () => {
  await setLink("active", "write");
  await assertFails(setDoc(doc(authed(OTHER_ADVISOR, "b@example.com"), "users", CLIENT), { data: { x: 1 } }, { merge: true }));
});

test("owner still writes own doc + versions at write-tier-enabled rules", async () => {
  await setLink("active", "write");
  const clientDb = authed(CLIENT, CLIENT_EMAIL);
  await assertSucceeds(setDoc(doc(clientDb, "users", CLIENT), { data: { mine: 1 }, updatedAt: 2 }, { merge: true }));
  await assertSucceeds(setDoc(doc(clientDb, "users", CLIENT, "versions", "own1"), { savedAt: 2, snapshot: {}, size: 1 }));
});

test("advisor cannot write an unrelated random user's doc", async () => {
  await setLink("active", "write");
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users", "randomUser"), { data: {}, updatedAt: 1 });
  });
  await assertFails(setDoc(doc(authed(ADVISOR, ADVISOR_EMAIL), "users", "randomUser"), { data: { x: 1 } }, { merge: true }));
});

test("client A cannot read client B", async () => {
  await assertFails(getDoc(doc(authed(OTHER_CLIENT, "y@example.com"), "users", CLIENT)));
});

// ── clientLinks access ─────────────────────────────────────────────────────
test("advisor lists own links; client reads own; direct writes denied", async () => {
  await setLink("active");
  const advDb = authed(ADVISOR, ADVISOR_EMAIL);
  await assertSucceeds(getDocs(query(collection(advDb, "clientLinks"), where("invitedByUid", "==", ADVISOR))));
  await assertSucceeds(getDoc(doc(authed(CLIENT, CLIENT_EMAIL), "clientLinks", CLIENT)));
  await assertFails(setDoc(doc(authed(CLIENT, CLIENT_EMAIL), "clientLinks", CLIENT), { status: "active" }, { merge: true }));
});

test("owner reads all links; a stranger cannot read someone else's advisor doc", async () => {
  await setLink("active");
  await assertSucceeds(getDocs(collection(authed(OWNER, "o@example.com"), "clientLinks")));
  await assertFails(getDoc(doc(authed(OTHER_CLIENT, "y@example.com"), "advisors", ADVISOR)));
});

// ── 2026-08-05 hardening round (the rules that shipped with db05dee) ────────

test("invite-only: an owner NOT on the allowlist cannot touch even their own doc", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users", "ghostUid"), { data: {}, updatedAt: 1 });
  });
  const ghost = authed("ghostUid", "ghost@example.com");
  await assertFails(getDoc(doc(ghost, "users", "ghostUid")));
  await assertFails(setDoc(doc(ghost, "users", "ghostUid"), { data: { x: 1 } }, { merge: true }));
});

test("shared/learnedDB: allowlisted reads; a revoked account cannot; NOBODY writes from a browser", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "shared", "learnedDB"), { db: { shop: "מזון לבית" } });
  });
  await assertSucceeds(getDoc(doc(authed(CLIENT, CLIENT_EMAIL), "shared", "learnedDB")));
  await assertFails(getDoc(doc(authed("revokedUid", "revoked@example.com"), "shared", "learnedDB")));
  // Write closed even for a legitimate allowlisted session — the poison/DoS door.
  await assertFails(setDoc(doc(authed(CLIENT, CLIENT_EMAIL), "shared", "learnedDB"), { db: { x: "y" } }, { merge: true }));
});

test("versions: WRITE-tier advisor may CREATE but never UPDATE or DELETE; the owner still deletes", async () => {
  await setLink("active", "write");
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users", CLIENT, "versions", "v0"), { savedAt: 1, snapshot: {}, size: 1 });
  });
  const advDb = authed(ADVISOR, ADVISOR_EMAIL);
  await assertSucceeds(setDoc(doc(advDb, "users", CLIENT, "versions", "vNew"), { savedAt: 2, snapshot: {}, size: 1 }));
  await assertFails(setDoc(doc(advDb, "users", CLIENT, "versions", "v0"), { savedAt: 9 }, { merge: true }));
  await assertFails(deleteDoc(doc(advDb, "users", CLIENT, "versions", "v0")));
  await assertSucceeds(deleteDoc(doc(authed(CLIENT, CLIENT_EMAIL), "users", CLIENT, "versions", "v0")));
});

test("intake: allowlisted owner reads/writes; the consented advisor reads; a REVOKED owner is fully cut off", async () => {
  await setLink("active");
  const clientDb = authed(CLIENT, CLIENT_EMAIL);
  await assertSucceeds(setDoc(doc(clientDb, "intake", CLIENT), { answers: { q1: "כן" } }, { merge: true }));
  await assertSucceeds(getDoc(doc(authed(ADVISOR, ADVISOR_EMAIL), "intake", CLIENT)));
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await deleteDoc(doc(ctx.firestore(), "allowlist", CLIENT_EMAIL));
  });
  await assertFails(getDoc(doc(clientDb, "intake", CLIENT)));
  await assertFails(setDoc(doc(clientDb, "intake", CLIENT), { answers: { q2: "לא" } }, { merge: true }));
});

test("clientLinks by invitedEmail: readable only with a VERIFIED email claim (invite-squatting)", async () => {
  await setLink("pending");
  const verified = testEnv.authenticatedContext("newUid", { email: CLIENT_EMAIL, email_verified: true }).firestore();
  const squatter = testEnv.authenticatedContext("squatterUid", { email: CLIENT_EMAIL, email_verified: false }).firestore();
  const noClaim  = testEnv.authenticatedContext("noClaimUid", { email: CLIENT_EMAIL }).firestore();
  await assertSucceeds(getDoc(doc(verified, "clientLinks", CLIENT)));
  await assertFails(getDoc(doc(squatter, "clientLinks", CLIENT)));
  await assertFails(getDoc(doc(noClaim, "clientLinks", CLIENT)));
});

test("sections subcollection mirrors the parent doc: advisor write-tier create/update but never delete", async () => {
  await setLink("active", "write");
  const clientDb = authed(CLIENT, CLIENT_EMAIL);
  await assertSucceeds(setDoc(doc(clientDb, "users", CLIENT, "sections", "credit"), { transactions: [] }));
  const advDb = authed(ADVISOR, ADVISOR_EMAIL);
  await assertSucceeds(getDoc(doc(advDb, "users", CLIENT, "sections", "credit")));
  await assertSucceeds(setDoc(doc(advDb, "users", CLIENT, "sections", "credit"), { transactions: [1] }, { merge: true }));
  await assertFails(deleteDoc(doc(advDb, "users", CLIENT, "sections", "credit")));
});

test("transactionInbox: owner reads+deletes own items, cannot forge one, stranger fully blocked", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "transactionInbox", CLIENT, "items", "i1"), { merchant: "קפה", amount: 12 });
  });
  const clientDb = authed(CLIENT, CLIENT_EMAIL);
  await assertSucceeds(getDoc(doc(clientDb, "transactionInbox", CLIENT, "items", "i1")));
  await assertFails(setDoc(doc(clientDb, "transactionInbox", CLIENT, "items", "forged"), { merchant: "x", amount: 1 }));
  await assertFails(getDoc(doc(authed(OTHER_CLIENT, "y@example.com"), "transactionInbox", CLIENT, "items", "i1")));
  await assertSucceeds(deleteDoc(doc(clientDb, "transactionInbox", CLIENT, "items", "i1")));
});
