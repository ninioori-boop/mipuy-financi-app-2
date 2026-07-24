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
import { doc, getDoc, setDoc, collection, getDocs, query, where } from "firebase/firestore";

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
    projectId: "rules-test",
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
