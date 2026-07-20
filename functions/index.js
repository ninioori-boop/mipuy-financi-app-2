const { beforeUserCreated, HttpsError } = require("firebase-functions/v2/identity");
const { onCall } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

initializeApp();
const db = getFirestore();

const CONSENT_VERSION = "v1";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Invite-only signup gate.
 *
 * Runs ONLY when a brand-new account is being created (beforeUserCreated). It
 * NEVER runs on sign-in, so EXISTING USERS ARE COMPLETELY UNAFFECTED. Applies to
 * every provider (Email/Password and Google).
 *
 * An account is allowed only if its lower-cased email exists as a document id in
 * the `allowlist` collection. The advisor grants access by adding that email
 * (see scripts/allow-email.ts or the Firestore console). The allowlist is read
 * here with admin privileges and is never exposed to clients.
 *
 * UNCHANGED by the advisor-management feature: an advisor inviting a client just
 * adds that email to `allowlist` (via inviteClient), so this gate then lets the
 * client register normally. Email→uid resolution + linking happens later, in
 * setClientSharing, which runs with a fully-formed auth context.
 */
exports.gateSignup = beforeUserCreated(async (event) => {
  const email = event.data?.email?.toLowerCase().trim();

  if (!email) {
    throw new HttpsError("permission-denied", "נדרשת כתובת מייל כדי להירשם.");
  }

  const allowed = await db.collection("allowlist").doc(email).get();
  if (!allowed.exists) {
    throw new HttpsError(
      "permission-denied",
      "ההרשמה לאפליקציה היא בהזמנה בלבד. פנה/י ליועץ כדי לקבל גישה.",
    );
  }

  // Approved — returning nothing permits the account to be created.
  return;
});

// ── Advisor management ──────────────────────────────────────────────────────

/** Doc id for a still-pending (pre-registration) invite, keyed by email. */
const pendingId = (email) => `pending_${email}`;

/**
 * inviteClient — an advisor invites a new client by email.
 *
 * Additive and self-service: any provisioned advisor calls this from their
 * dashboard. It (a) allowlists the email so the client can register through the
 * existing gateSignup, and (b) records a pending advisor↔client link. New
 * clients only — an email that already has an account is rejected.
 */
exports.inviteClient = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "נדרשת התחברות.");
  }

  // 1) Caller must be a provisioned advisor; read their practice.
  const advisorSnap = await db.collection("advisors").doc(callerUid).get();
  if (!advisorSnap.exists) {
    throw new HttpsError("permission-denied", "רק יועץ יכול להזמין לקוחות.");
  }
  const practiceId = advisorSnap.data().practiceId;

  // 2) Validate email.
  const email = String(request.data?.email ?? "").toLowerCase().trim();
  if (!EMAIL_RE.test(email)) {
    throw new HttpsError("invalid-argument", "כתובת מייל לא תקינה.");
  }

  // 3) New clients only — reject an email that already has an account.
  try {
    await getAuth().getUserByEmail(email);
    throw new HttpsError("already-exists", "למשתמש הזה כבר קיים חשבון במערכת.");
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    if (e.code !== "auth/user-not-found") throw e; // real error — surface it
    // not-found = good, continue.
  }

  // 4) Exclusivity — one practice at a time. If a pending invite from a
  //    DIFFERENT practice exists, block; same practice is idempotent.
  const pendingRef = db.collection("clientLinks").doc(pendingId(email));
  const pendingSnap = await pendingRef.get();
  if (pendingSnap.exists && pendingSnap.data().practiceId !== practiceId
      && pendingSnap.data().status === "pending") {
    throw new HttpsError("already-exists", "הלקוח כבר הוזמן על ידי יועץ אחר.");
  }

  // 5) Atomic: allowlist the email + write the pending link.
  const batch = db.batch();
  batch.set(
    db.collection("allowlist").doc(email),
    { email, addedAt: FieldValue.serverTimestamp(), source: "inviteClient" },
    { merge: true },
  );
  batch.set(pendingRef, {
    status: "pending",
    invitedEmail: email,
    invitedByUid: callerUid,
    practiceId,
    clientUid: null,
    consentVersion: CONSENT_VERSION,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await batch.commit();

  return { ok: true, status: "pending", email };
});

/**
 * setClientSharing — the client sets whether they share with their advisor.
 *
 * Handles the first-time decision (accept / decline) AND later changes
 * (revoke / re-grant) — the decision is reversible in both directions. Consent
 * is stamped server-side (consentAt), so a client can neither forge a link to
 * an arbitrary advisor nor backdate consent. The advisor gains read access only
 * while status === 'active' (enforced by the users/{uid} rule).
 */
exports.setClientSharing = onCall(async (request) => {
  const uid = request.auth?.uid;
  const email = request.auth?.token?.email?.toLowerCase().trim();
  if (!uid || !email) {
    throw new HttpsError("unauthenticated", "נדרשת התחברות.");
  }

  const status = String(request.data?.status ?? "");
  if (!["active", "declined", "revoked"].includes(status)) {
    throw new HttpsError("invalid-argument", "סטטוס שיתוף לא תקין.");
  }

  const pendingRef = db.collection("clientLinks").doc(pendingId(email));
  const linkRef = db.collection("clientLinks").doc(uid);

  return await db.runTransaction(async (tx) => {
    const [pendingSnap, linkSnap] = await Promise.all([tx.get(pendingRef), tx.get(linkRef)]);

    // Source of the link facts: an existing uid-keyed link, else the pending invite.
    const source = linkSnap.exists ? linkSnap.data()
      : pendingSnap.exists ? pendingSnap.data()
      : null;
    if (!source) {
      throw new HttpsError("failed-precondition", "לא נמצאה הזמנה פעילה.");
    }

    // Activating requires matching the invite's consent version.
    if (status === "active") {
      const cv = String(request.data?.consentVersion ?? "");
      if (cv !== (source.consentVersion || CONSENT_VERSION)) {
        throw new HttpsError("failed-precondition", "גרסת הסכמה לא תואמת.");
      }
    }

    const now = FieldValue.serverTimestamp();
    const linkDoc = {
      status,
      clientUid: uid,
      invitedEmail: source.invitedEmail || email,
      invitedByUid: source.invitedByUid,
      practiceId: source.practiceId,
      access: "read",
      consentVersion: source.consentVersion || CONSENT_VERSION,
      invitedAt: source.createdAt || now,
      statusChangedAt: now,
      updatedAt: now,
    };
    if (!linkSnap.exists) linkDoc.createdAt = now;
    if (status === "active") linkDoc.consentAt = now;

    tx.set(linkRef, linkDoc, { merge: true });

    // Consume the pending invite (keeps the roster query clean).
    if (pendingSnap.exists && pendingSnap.data().status === "pending") {
      tx.set(pendingRef, { status: "consumed", clientUid: uid, updatedAt: now }, { merge: true });
    }

    return { ok: true, status };
  });
});
