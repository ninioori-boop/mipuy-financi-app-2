const { beforeUserCreated, HttpsError } = require("firebase-functions/v2/identity");
const { onCall } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

initializeApp();
const db = getFirestore();

const CONSENT_VERSION = "v1";          // view-only consent
const EDIT_CONSENT_VERSION = "v2";     // separate consent to let the advisor EDIT
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Advisor-controlled engagement stage. Reaching 'סוף תהליך' auto-expires edit
// access (access→'read'). Order matters (index used by the dashboard).
const ENGAGEMENT_STAGES = ["היכרות", "מיפוי", "תקציב", "בקרה", "תוכנית כלכלית", "סוף תהליך"];
const FINAL_STAGE = "סוף תהליך";

// Resend API key — stored as a Firebase secret (firebase functions:secrets:set
// RESEND_API_KEY). Never in code or env files.
const RESEND_API_KEY = defineSecret("RESEND_API_KEY");

const APP_URL = "https://app.orimipuy.com";
// orimipuy.com is verified in Resend (DKIM/SPF/MX in Route 53, 2026-07-21), so
// invitations go out from the branded sender to any recipient.
const MAIL_FROM = "הכלכלן של הבית <invite@orimipuy.com>";

/** Simple RTL Hebrew invitation email. Inline styles only (email-client safe). */
function inviteEmailHtml(email) {
  return `<!doctype html><html dir="rtl" lang="he"><body style="margin:0;padding:0;background:#f6f5f2;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:32px 16px;direction:rtl;text-align:right;">
    <div style="background:#ffffff;border:1px solid #e5e0d8;border-radius:12px;padding:28px;">
      <div style="font-size:13px;color:#a8894c;letter-spacing:2px;margin-bottom:6px;">THE HOME ECONOMIST</div>
      <h1 style="font-size:22px;color:#1a1a1a;margin:0 0 14px;">הוזמנת למערכת ליווי פיננסי</h1>
      <p style="font-size:15px;color:#333;line-height:1.7;margin:0 0 12px;">
        היועץ הפיננסי שלך הזמין אותך למערכת "הכלכלן של הבית": מקום אחד לראות בו את התמונה הפיננסית שלך, לעקוב אחרי תקציב, ולהתקדם ליעדים.
      </p>
      <p style="font-size:15px;color:#333;line-height:1.7;margin:0 0 20px;">
        פשוט נכנסים לקישור ומתחברים (או נרשמים) עם כתובת המייל הזאת בדיוק
        (<span dir="ltr" style="color:#1a1a1a;font-weight:bold;">${email}</span>), ובוחרים אם לשתף את הנתונים עם היועץ.
      </p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${APP_URL}" style="background:#C9A86C;color:#1a1a1a;text-decoration:none;font-size:16px;font-weight:bold;padding:12px 32px;border-radius:999px;display:inline-block;">
          להרשמה למערכת
        </a>
      </div>
      <p style="font-size:12px;color:#8a8178;line-height:1.6;margin:0;">
        חשוב: יש להתחבר עם כתובת המייל שאליה נשלחה ההזמנה. אם לא ציפית להזמנה הזאת, אפשר להתעלם מהמייל.
      </p>
    </div>
    <p style="font-size:11px;color:#a8a29a;text-align:center;margin:16px 0 0;">נשלח דרך מערכת הכלכלן של הבית · ${APP_URL.replace("https://", "")}</p>
  </div>
</body></html>`;
}

/**
 * Best-effort invitation email via Resend. Never throws — an email failure must
 * not break the invite itself (the client is already allowlisted + linked).
 * Returns true when Resend accepted the send.
 */
async function sendInviteEmail(toEmail) {
  const key = RESEND_API_KEY.value();
  if (!key) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: [toEmail],
        subject: "הוזמנת למערכת הליווי הפיננסי של הכלכלן של הבית",
        html: inviteEmailHtml(toEmail),
      }),
    });
    if (!res.ok) {
      console.warn("inviteEmail: resend rejected", res.status, await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (e) {
    console.warn("inviteEmail: send failed", e?.message || e);
    return false;
  }
}

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
exports.inviteClient = onCall({ secrets: [RESEND_API_KEY] }, async (request) => {
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

  // 3) Existing accounts may be invited ONLY if Ori explicitly listed them
  //    below (family/testing). Any other email that already has an account is
  //    rejected — the system stays "new clients only" for everyone else.
  //    An allowed existing user sees the one-time consent prompt on next
  //    sign-in; declining changes nothing for them.
  const EXISTING_INVITE_ALLOWED = [
    // lowercased emails Ori approves for linking an EXISTING account:
    "rotemgovrin@gmail.com",
    "rotemgovrin1@gmail.com",
    "ninioori@gmail.com",
  ];
  let existingUid = null;
  try {
    existingUid = (await getAuth().getUserByEmail(email)).uid;
  } catch (e) {
    if (e.code !== "auth/user-not-found") throw e; // real error — surface it
  }
  if (existingUid && !EXISTING_INVITE_ALLOWED.includes(email)) {
    throw new HttpsError("already-exists", "למשתמש הזה כבר קיים חשבון במערכת.");
  }

  // 4) Exclusivity — one practice at a time.
  //    (a) A pending invite from a DIFFERENT practice blocks; same practice is
  //        idempotent. (b) For an existing account: an ACTIVE link with a
  //        different practice blocks (declined/revoked don't — the client can
  //        reconsider a new invite).
  const pendingRef = db.collection("clientLinks").doc(pendingId(email));
  const pendingSnap = await pendingRef.get();
  if (pendingSnap.exists && pendingSnap.data().practiceId !== practiceId
      && pendingSnap.data().status === "pending") {
    throw new HttpsError("already-exists", "הלקוח כבר הוזמן על ידי יועץ אחר.");
  }
  if (existingUid) {
    const linkSnap = await db.collection("clientLinks").doc(existingUid).get();
    if (linkSnap.exists && linkSnap.data().status === "active"
        && linkSnap.data().practiceId !== practiceId) {
      throw new HttpsError("already-exists", "הלקוח כבר משתף יועץ אחר.");
    }
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

  // Best-effort invitation email — the invite is already recorded either way.
  const emailSent = await sendInviteEmail(email);

  return { ok: true, status: "pending", email, emailSent };
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

    // ── Resolve the access tier ──────────────────────────────────────────────
    // Default: PRESERVE what the link already had — never silently downgrade a
    // write-tier link on an unrelated status change (the old hardcoded 'read'
    // was a latent bug once write exists).
    let access = source.access || "read";
    let clearRequested = false;
    const wantAccess = request.data?.access;
    if (wantAccess !== undefined) {
      if (!["read", "write"].includes(String(wantAccess))) {
        throw new HttpsError("invalid-argument", "רמת גישה לא תקינה.");
      }
      if (wantAccess === "write") {
        // Granting EDIT: sharing must be active, the advisor must have asked,
        // and the client must echo the v2 edit-consent version. This is the
        // ONLY path that ever sets access:'write' — and only the client (this
        // callable runs as the client, on their own uid-keyed link) can do it.
        if (status !== "active") {
          throw new HttpsError("failed-precondition", "צריך לשתף לפני מתן הרשאת עריכה.");
        }
        if (source.requestedAccess !== "write") {
          throw new HttpsError("failed-precondition", "אין בקשת עריכה פעילה מהיועץ.");
        }
        if (String(request.data?.consentVersion ?? "") !== EDIT_CONSENT_VERSION) {
          throw new HttpsError("failed-precondition", "גרסת הסכמת עריכה לא תואמת.");
        }
        access = "write";
      } else {
        access = "read"; // stop editing / decline the edit request
      }
      clearRequested = true; // the client responded to the edit request
    }
    // Any un-share also drops edit access.
    if (status === "declined" || status === "revoked") { access = "read"; clearRequested = true; }

    const now = FieldValue.serverTimestamp();
    const linkDoc = {
      status,
      clientUid: uid,
      invitedEmail: source.invitedEmail || email,
      invitedByUid: source.invitedByUid,
      practiceId: source.practiceId,
      access,
      consentVersion: source.consentVersion || CONSENT_VERSION,
      invitedAt: source.createdAt || now,
      statusChangedAt: now,
      updatedAt: now,
    };
    if (!linkSnap.exists) linkDoc.createdAt = now;
    if (status === "active") linkDoc.consentAt = now;
    if (access === "write") linkDoc.editConsentAt = now;
    if (clearRequested) linkDoc.requestedAccess = FieldValue.delete();

    tx.set(linkRef, linkDoc, { merge: true });

    // Consume the pending invite (keeps the roster query clean).
    if (pendingSnap.exists && pendingSnap.data().status === "pending") {
      tx.set(pendingRef, { status: "consumed", clientUid: uid, updatedAt: now }, { merge: true });
    }

    return { ok: true, status };
  });
});

/**
 * requestEditAccess — the advisor asks the client for EDIT permission.
 *
 * Sets only `requestedAccess:'write'` + bumps `consentVersion` to v2 on the
 * client's link, so the client's ConsentGate re-prompts on next sign-in. It
 * NEVER grants `access:'write'` itself — only the client can, by accepting
 * (setClientSharing). The advisor must own an active link to this client.
 */
exports.requestEditAccess = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) throw new HttpsError("unauthenticated", "נדרשת התחברות.");

  const advisorSnap = await db.collection("advisors").doc(callerUid).get();
  if (!advisorSnap.exists) throw new HttpsError("permission-denied", "רק יועץ יכול לבקש עריכה.");

  const clientUid = String(request.data?.clientUid ?? "");
  if (!clientUid) throw new HttpsError("invalid-argument", "חסר מזהה לקוח.");

  const linkRef = db.collection("clientLinks").doc(clientUid);
  const linkSnap = await linkRef.get();
  if (!linkSnap.exists || linkSnap.data().status !== "active"
      || linkSnap.data().invitedByUid !== callerUid) {
    throw new HttpsError("failed-precondition", "אין קשר פעיל ללקוח הזה.");
  }

  await linkRef.set({
    requestedAccess: "write",
    consentVersion: EDIT_CONSENT_VERSION,
    editRequestedAt: FieldValue.serverTimestamp(),
    editRequestedByUid: callerUid,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ok: true };
});

/**
 * setClientStage — the advisor records the client's engagement stage (after
 * each meeting). Reaching the FINAL stage ('סוף תהליך') AUTO-EXPIRES edit
 * access (access→'read'), so write permission never lingers past the process.
 * Never grants write. Advisor must own an active link to this client.
 */
exports.setClientStage = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) throw new HttpsError("unauthenticated", "נדרשת התחברות.");

  const advisorSnap = await db.collection("advisors").doc(callerUid).get();
  if (!advisorSnap.exists) throw new HttpsError("permission-denied", "רק יועץ יכול לעדכן שלב.");

  const clientUid = String(request.data?.clientUid ?? "");
  const stage = String(request.data?.stage ?? "");
  if (!clientUid) throw new HttpsError("invalid-argument", "חסר מזהה לקוח.");
  if (!ENGAGEMENT_STAGES.includes(stage)) throw new HttpsError("invalid-argument", "שלב לא תקין.");

  const linkRef = db.collection("clientLinks").doc(clientUid);
  const linkSnap = await linkRef.get();
  if (!linkSnap.exists || linkSnap.data().invitedByUid !== callerUid) {
    throw new HttpsError("failed-precondition", "אין קשר ללקוח הזה.");
  }

  const patch = { stage, updatedAt: FieldValue.serverTimestamp() };
  // Terminal stage ends the engagement → edit access expires automatically.
  if (stage === FINAL_STAGE) patch.access = "read";
  await linkRef.set(patch, { merge: true });

  return { ok: true, stage, access: patch.access ?? (linkSnap.data().access || "read") };
});
