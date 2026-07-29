const { beforeUserCreated, HttpsError } = require("firebase-functions/v2/identity");
const { onCall } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const { getStorage } = require("firebase-admin/storage");
const { BRAND } = require("./brand");

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

// Brand identity (name, app URL, verified Resend sender) lives in functions/brand.js
// so invitations go out under the active brand for this deployment.
const APP_URL = BRAND.appUrl;
const MAIL_FROM = BRAND.mailFrom;

const MAIL_HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

/** HTML-escape untrusted text before interpolating into email markup. */
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Strip header-breaking characters from a mail display name; cap length. */
function cleanMailName(s) {
  return String(s).replace(/[<>"\r\n,]/g, "").trim().slice(0, 60);
}

/** Rough relative luminance (0..1) of a #hex color. */
function hexLum(hex) {
  const h = hex.replace("#", "");
  const full = h.length <= 4 ? h.slice(0, 3).split("").map((c) => c + c).join("") : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Accent for the email button/eyebrow. Emails sit on a white card, so a very
 * light brand accent (e.g. white) would vanish — fall through the practice's
 * palette until something dark enough for white, else the default gold.
 */
function pickEmailAccent(colors) {
  for (const raw of [colors?.gold, colors?.goldDark, colors?.surface, BRAND.gold]) {
    const c = typeof raw === "string" ? raw.trim() : "";
    if (c && MAIL_HEX_RE.test(c) && hexLum(c) < 0.72) return c;
  }
  return BRAND.gold;
}

/**
 * Brand for outbound mail: the inviting advisor's practice brand when set,
 * else the deployment default. The sending ADDRESS stays our verified sender;
 * only the display name changes per practice (their own domain is a later,
 * per-firm Resend verification).
 */
async function mailBrandForPractice(practiceId) {
  const base = {
    nameHe: BRAND.nameHe,
    wordmark: BRAND.wordmarkEn,
    accent: BRAND.gold,
    buttonText: "#1a1a1a",
    from: BRAND.mailFrom,
    practiceId: null,
  };
  if (!practiceId) return base;
  try {
    const snap = await db.collection("practices").doc(practiceId).get();
    const b = snap.exists ? snap.data().brand : null;
    if (!b || typeof b !== "object") return base;
    const nameHe = typeof b.nameHe === "string" && cleanMailName(b.nameHe) ? cleanMailName(b.nameHe) : base.nameHe;
    const accent = pickEmailAccent(b.colors);
    return {
      nameHe,
      wordmark: typeof b.nameEn === "string" && cleanMailName(b.nameEn) ? cleanMailName(b.nameEn) : nameHe,
      accent,
      buttonText: hexLum(accent) > 0.5 ? "#1a1a1a" : "#ffffff",
      from: `${nameHe} <invite@orimipuy.com>`,
      practiceId,
    };
  } catch {
    return base;
  }
}

/** Best-effort send audit into emailLog — a log failure never breaks a send. */
async function logEmail(entry) {
  try {
    await db.collection("emailLog").add({ ...entry, createdAt: FieldValue.serverTimestamp() });
  } catch (e) {
    console.warn("emailLog write failed", e && e.message ? e.message : e);
  }
}

/** Simple RTL Hebrew invitation email. Inline styles only (email-client safe). */
function inviteEmailHtml(email, b) {
  return `<!doctype html><html dir="rtl" lang="he"><body style="margin:0;padding:0;background:#f6f5f2;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:32px 16px;direction:rtl;text-align:right;">
    <div style="background:#ffffff;border:1px solid #e5e0d8;border-radius:12px;padding:28px;">
      <div style="font-size:13px;color:${b.accent};letter-spacing:2px;margin-bottom:6px;">${escapeHtml(b.wordmark)}</div>
      <h1 style="font-size:22px;color:#1a1a1a;margin:0 0 14px;">הוזמנת למערכת ליווי פיננסי</h1>
      <p style="font-size:15px;color:#333;line-height:1.7;margin:0 0 12px;">
        היועץ הפיננסי שלך הזמין אותך למערכת "${escapeHtml(b.nameHe)}": מקום אחד לראות בו את התמונה הפיננסית שלך, לעקוב אחרי תקציב, ולהתקדם ליעדים.
      </p>
      <p style="font-size:15px;color:#333;line-height:1.7;margin:0 0 20px;">
        פשוט נכנסים לקישור ומתחברים (או נרשמים) עם כתובת המייל הזאת בדיוק
        (<span dir="ltr" style="color:#1a1a1a;font-weight:bold;">${escapeHtml(email)}</span>), ובוחרים אם לשתף את הנתונים עם היועץ.
      </p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${APP_URL}/auth?${b.practiceId ? `b=${encodeURIComponent(b.practiceId)}&` : ""}utm_source=email&utm_medium=email&utm_campaign=invite" style="background:${b.accent};color:${b.buttonText};text-decoration:none;font-size:16px;font-weight:bold;padding:12px 32px;border-radius:999px;display:inline-block;">
          להרשמה למערכת
        </a>
      </div>
      <p style="font-size:12px;color:#8a8178;line-height:1.6;margin:0;">
        חשוב: יש להתחבר עם כתובת המייל שאליה נשלחה ההזמנה. אם לא ציפית להזמנה הזאת, אפשר להתעלם מהמייל.
      </p>
    </div>
    <p style="font-size:11px;color:#a8a29a;text-align:center;margin:16px 0 0;">נשלח דרך מערכת ${escapeHtml(b.nameHe)} · ${APP_URL.replace("https://", "")}</p>
  </div>
</body></html>`;
}

/**
 * Best-effort invitation email via Resend. Never throws — an email failure must
 * not break the invite itself (the client is already allowlisted + linked).
 * Returns true when Resend accepted the send.
 */
async function sendInviteEmail(toEmail, b) {
  const key = RESEND_API_KEY.value();
  if (!key) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: b.from,
        to: [toEmail],
        subject: `הוזמנת למערכת הליווי הפיננסי של ${b.nameHe}`,
        html: inviteEmailHtml(toEmail, b),
      }),
    });
    const bodyText = await res.text().catch(() => "");
    let resendId = null;
    try { resendId = JSON.parse(bodyText).id ?? null; } catch { /* non-JSON body */ }
    await logEmail({
      type: "invite", to: toEmail, practiceId: b.practiceId || null, resendId,
      status: res.ok ? "accepted" : "rejected", httpStatus: res.status,
      ...(res.ok ? {} : { error: bodyText.slice(0, 300) }),
    });
    if (!res.ok) {
      console.warn("inviteEmail: resend rejected", res.status, bodyText);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("inviteEmail: send failed", e?.message || e);
    await logEmail({ type: "invite", to: toEmail, practiceId: b.practiceId || null, resendId: null, status: "error", httpStatus: 0, error: String(e?.message || e).slice(0, 300) });
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
  if (!practiceId) {
    throw new HttpsError("failed-precondition", "חשבון היועץ לא משויך למשרד.");
  }

  // 2) Validate email.
  const email = String(request.data?.email ?? "").toLowerCase().trim();
  if (!EMAIL_RE.test(email)) {
    throw new HttpsError("invalid-argument", "כתובת מייל לא תקינה.");
  }

  // 3) Existing accounts may be invited ONLY if the INVITING PRACTICE lists
  //    them explicitly (practices/{id}.existingInviteAllowed, seeded by the
  //    platform owner). Practice-scoped on purpose — a global list would let
  //    any firm re-bind another firm's known users. Everyone else stays
  //    "new clients only". An allowed existing user sees the one-time consent
  //    prompt on next sign-in; declining changes nothing for them.
  const invitingPractice = await db.collection("practices").doc(practiceId).get();
  const EXISTING_INVITE_ALLOWED =
    invitingPractice.exists && Array.isArray(invitingPractice.data().existingInviteAllowed)
      ? invitingPractice.data().existingInviteAllowed.map((e) => String(e).toLowerCase())
      : [];
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
    // Combined view+edit consent: the client approves BOTH viewing and editing
    // in ONE screen at first sign-in, instead of view now + a separate edit
    // request later. Pre-arming the invite with the v2 (edit) consent version +
    // requestedAccess:'write' lets setClientSharing's EXISTING edit-consent path
    // grant write on that single acceptance — no rule/security change. Write is
    // still only ever set BY THE CLIENT, gated on the explicit v2 checkbox.
    consentVersion: EDIT_CONSENT_VERSION,
    requestedAccess: "write",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await batch.commit();

  // Best-effort invitation email — the invite is already recorded either way,
  // branded per the inviting advisor's practice.
  const emailSent = await sendInviteEmail(email, await mailBrandForPractice(practiceId));

  return { ok: true, status: "pending", email, emailSent };
});

/** Advisor-invite email — same shell as the client invite, advisor-flavored copy. */
function advisorInviteEmailHtml(email, b) {
  return `<!doctype html><html dir="rtl" lang="he"><body style="margin:0;padding:0;background:#f6f5f2;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:32px 16px;direction:rtl;text-align:right;">
    <div style="background:#ffffff;border:1px solid #e5e0d8;border-radius:12px;padding:28px;">
      <div style="font-size:13px;color:${b.accent};letter-spacing:2px;margin-bottom:6px;">${escapeHtml(b.wordmark)}</div>
      <h1 style="font-size:22px;color:#1a1a1a;margin:0 0 14px;">הוזמנת להצטרף כיועץ</h1>
      <p style="font-size:15px;color:#333;line-height:1.7;margin:0 0 12px;">
        מנהל המשרד של "${escapeHtml(b.nameHe)}" הזמין אותך להצטרף לצוות היועצים במערכת.
      </p>
      <p style="font-size:15px;color:#333;line-height:1.7;margin:0 0 20px;">
        נכנסים בקישור ומתחברים (או נרשמים) עם כתובת המייל הזאת בדיוק
        (<span dir="ltr" style="color:#1a1a1a;font-weight:bold;">${escapeHtml(email)}</span>), והמערכת תזהה אותך אוטומטית כיועץ.
      </p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${APP_URL}/auth?${b.practiceId ? `b=${encodeURIComponent(b.practiceId)}&` : ""}utm_source=email&utm_medium=email&utm_campaign=advisor-invite" style="background:${b.accent};color:${b.buttonText};text-decoration:none;font-size:16px;font-weight:bold;padding:12px 32px;border-radius:999px;display:inline-block;">
          כניסה למערכת
        </a>
      </div>
      <p style="font-size:12px;color:#8a8178;line-height:1.6;margin:0;">
        אם לא ציפית להזמנה הזאת, אפשר להתעלם מהמייל.
      </p>
    </div>
    <p style="font-size:11px;color:#a8a29a;text-align:center;margin:16px 0 0;">נשלח דרך מערכת ${escapeHtml(b.nameHe)} · ${APP_URL.replace("https://", "")}</p>
  </div>
</body></html>`;
}

/** Best-effort advisor-invite send via Resend (logged like every send). */
async function sendAdvisorInviteEmail(toEmail, b) {
  const key = RESEND_API_KEY.value();
  if (!key) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: b.from,
        to: [toEmail],
        subject: `הוזמנת להצטרף כיועץ ל${b.nameHe}`,
        html: advisorInviteEmailHtml(toEmail, b),
      }),
    });
    const bodyText = await res.text().catch(() => "");
    let resendId = null;
    try { resendId = JSON.parse(bodyText).id ?? null; } catch { /* non-JSON */ }
    await logEmail({
      type: "advisor-invite", to: toEmail, practiceId: b.practiceId || null, resendId,
      status: res.ok ? "accepted" : "rejected", httpStatus: res.status,
      ...(res.ok ? {} : { error: bodyText.slice(0, 300) }),
    });
    return res.ok;
  } catch (e) {
    console.warn("advisorInvite: send failed", e?.message || e);
    return false;
  }
}

/** Grant the advisor role: role doc + firm membership + consume the pending invite. */
async function grantAdvisorRole(uid, email, practiceId) {
  const batch = db.batch();
  batch.set(db.collection("advisors").doc(uid),
    { email, practiceId, role: "member", createdAt: FieldValue.serverTimestamp() },
    { merge: true });
  batch.set(db.collection("practices").doc(practiceId),
    { advisorUids: FieldValue.arrayUnion(uid) }, { merge: true });
  batch.set(db.collection("pendingAdvisors").doc(email),
    { status: "consumed", claimedUid: uid, updatedAt: FieldValue.serverTimestamp() },
    { merge: true });
  await batch.commit();
}

/**
 * inviteAdvisor — the practice OWNER adds an advisor to their firm.
 * Allowlists the email + records a pending advisor invite; the role is granted
 * immediately when the account already exists, otherwise by claimAdvisorRole on
 * first sign-in. Server-only writes — clients can't forge roles.
 */
exports.inviteAdvisor = onCall({ secrets: [RESEND_API_KEY] }, async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) throw new HttpsError("unauthenticated", "נדרשת התחברות.");

  const advisorSnap = await db.collection("advisors").doc(callerUid).get();
  const practiceId = advisorSnap.exists ? advisorSnap.data().practiceId : null;
  if (!practiceId) throw new HttpsError("permission-denied", "רק יועץ יכול להזמין יועצים.");
  const practiceSnap = await db.collection("practices").doc(practiceId).get();
  if (!practiceSnap.exists || practiceSnap.data().ownerUid !== callerUid) {
    throw new HttpsError("permission-denied", "רק מנהל המשרד יכול להזמין יועצים.");
  }

  const email = String(request.data?.email ?? "").toLowerCase().trim();
  if (!EMAIL_RE.test(email)) throw new HttpsError("invalid-argument", "כתובת מייל לא תקינה.");

  let existingUid = null;
  let existingVerified = false;
  try {
    const rec = await getAuth().getUserByEmail(email);
    existingUid = rec.uid;
    existingVerified = !!rec.emailVerified;
  } catch (e) {
    if (e.code !== "auth/user-not-found") throw e;
  }
  if (existingUid) {
    const existingRole = await db.collection("advisors").doc(existingUid).get();
    if (existingRole.exists) {
      throw new HttpsError("already-exists", existingRole.data().practiceId === practiceId
        ? "היועץ כבר חבר במשרד." : "המייל כבר משמש יועץ במשרד אחר.");
    }
  }

  const batch = db.batch();
  batch.set(db.collection("allowlist").doc(email),
    { email, addedAt: FieldValue.serverTimestamp(), source: "inviteAdvisor" }, { merge: true });
  batch.set(db.collection("pendingAdvisors").doc(email), {
    email, practiceId, invitedByUid: callerUid, status: "pending",
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await batch.commit();

  // Immediate grant ONLY for a VERIFIED account — an unverified password
  // account could be a squatter on the invitee's address; it must verify the
  // email first and will be claimed on the next sign-in.
  if (existingUid && existingVerified) {
    await grantAdvisorRole(existingUid, email, practiceId);
    return { ok: true, status: "granted", email, emailSent: false };
  }

  const b = await mailBrandForPractice(practiceId);
  const emailSent = await sendAdvisorInviteEmail(email, b);
  return { ok: true, status: "pending", email, emailSent };
});

/**
 * claimAdvisorRole — an invited advisor's first sign-in turns the pending
 * invite into a real role. Safe to call for anyone: no pending invite → no-op.
 */
exports.claimAdvisorRole = onCall(async (request) => {
  const uid = request.auth?.uid;
  const email = request.auth?.token?.email?.toLowerCase().trim();
  if (!uid || !email) throw new HttpsError("unauthenticated", "נדרשת התחברות.");

  const existing = await db.collection("advisors").doc(uid).get();
  if (existing.exists) return { ok: true, claimed: false };

  const pending = await db.collection("pendingAdvisors").doc(email).get();
  if (!pending.exists || pending.data().status !== "pending") return { ok: true, claimed: false };

  // The ADVISOR role is a privilege — only a VERIFIED email may claim it
  // (blocks squatting on the invitee's address with an unverified password
  // account). Google sign-in is verified by definition.
  if (request.auth?.token?.email_verified !== true) {
    return { ok: true, claimed: false, needVerify: true };
  }

  await grantAdvisorRole(uid, email, pending.data().practiceId);
  return { ok: true, claimed: true };
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

    // Source of the link facts: a FRESH pending invite wins over a stale
    // uid-keyed link — otherwise a client moving firms (revoke → new invite)
    // would see firm B's consent screen but re-bind to firm A's old link.
    const source = (pendingSnap.exists && pendingSnap.data().status === "pending") ? pendingSnap.data()
      : linkSnap.exists ? linkSnap.data()
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
  if (!linkSnap.exists || linkSnap.data().status !== "active"
      || linkSnap.data().invitedByUid !== callerUid) {
    throw new HttpsError("failed-precondition", "אין קשר פעיל ללקוח הזה.");
  }

  const patch = { stage, updatedAt: FieldValue.serverTimestamp() };
  // Terminal stage ends the engagement → edit access expires automatically.
  if (stage === FINAL_STAGE) patch.access = "read";
  await linkRef.set(patch, { merge: true });

  return { ok: true, stage, access: patch.access ?? (linkSnap.data().access || "read") };
});

/* ── Full account deletion ─────────────────────────────────────────────
 * Self-service, immediate and irreversible. Everything runs here (admin SDK)
 * because almost every collection involved is client-write-blocked by rules.
 *
 * ORDER IS LOAD-BEARING. Three server routes authenticate with proofs that
 * outlive an account and write with the admin SDK, so the very first thing we
 * do is publish a tombstone; then we cut the two rule-level write paths
 * (the user's own, then the advisor's) BEFORE deleting any data. Deleting the
 * allowlist entry last (the intuitive order) would leave a window where the
 * user's own tab re-creates everything we just deleted.
 * Every prefix of the sequence is safe to stop at and safe to re-run.
 */
const DELETED_MAIL_PLACEHOLDER = "deleted@removed.local";
const MAX_NOTIFY_CLIENTS = 50;

/** Delete a query's documents in pages — unbounded collections must not OOM. */
async function deleteByQuery(query, pageSize = 300) {
  let removed = 0;
  for (;;) {
    const snap = await query.limit(pageSize).get();
    if (snap.empty) return removed;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    removed += snap.size;
    if (snap.size < pageSize) return removed;
  }
}

/** Record progress so a partial deletion can be finished by hand, never silently. */
async function auditStep(uid, step, ok, detail) {
  try {
    await db.collection("deletionAudit").doc(uid).set({
      steps: { [step]: { ok, ...(detail !== undefined ? { detail } : {}), at: Date.now() } },
    }, { merge: true });
  } catch (e) {
    console.warn(`[deleteMyAccount] audit ${step} failed`, e && e.message);
  }
}

/** Run one step, never let it abort the rest, and remember what happened. */
async function step(uid, name, fn) {
  try {
    const detail = await fn();
    await auditStep(uid, name, true, detail);
    return { ok: true };
  } catch (e) {
    const msg = String(e && e.message ? e.message : e).slice(0, 200);
    console.error(`[deleteMyAccount] step ${name} failed:`, msg);
    await auditStep(uid, name, false, msg);
    return { ok: false };
  }
}

function deletionConfirmHtml(b) {
  return `<!doctype html><html dir="rtl" lang="he"><body style="margin:0;padding:0;background:#f6f5f2;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:32px 16px;direction:rtl;text-align:right;">
    <div style="font-size:20px;font-weight:bold;color:${b.accent};margin-bottom:16px;">${escapeHtml(b.nameHe)}</div>
    <div style="background:#ffffff;border-radius:12px;padding:24px;">
      <h1 style="font-size:18px;margin:0 0 12px;">החשבון שלך נמחק</h1>
      <p style="font-size:15px;line-height:1.7;margin:0 0 12px;">החשבון שלך נמחק לפי בקשתך. הנתונים הפיננסיים, המסמכים שהעלית והיסטוריית הגרסאות נמחקו לצמיתות ואינם ניתנים לשחזור, גם לא על ידינו.</p>
      <p style="font-size:15px;line-height:1.7;margin:0 0 12px;">אם התקנת בטלפון את אפליקציית מעקב ההוצאות, יש להסיר אותה מהמכשיר.</p>
      <p style="font-size:15px;line-height:1.7;margin:0;">אם לא ביקשת את המחיקה, פנה אלינו מיד.</p>
    </div>
  </div></body></html>`;
}

function advisorClientLeftHtml(clientEmail, b) {
  return `<!doctype html><html dir="rtl" lang="he"><body style="margin:0;padding:0;background:#f6f5f2;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:32px 16px;direction:rtl;text-align:right;">
    <div style="font-size:20px;font-weight:bold;color:${b.accent};margin-bottom:16px;">${escapeHtml(b.nameHe)}</div>
    <div style="background:#ffffff;border-radius:12px;padding:24px;">
      <h1 style="font-size:18px;margin:0 0 12px;">לקוח הסיר את חשבונו</h1>
      <p style="font-size:15px;line-height:1.7;margin:0 0 12px;">הלקוח בכתובת <b>${escapeHtml(clientEmail)}</b> מחק את חשבונו מהמערכת ביוזמתו.</p>
      <p style="font-size:15px;line-height:1.7;margin:0 0 12px;">הקישור בינך לבין החשבון הוסר, הגישה שלך לנתונים הופסקה, והלקוח אינו מופיע יותר ברשימת הלקוחות שלך.</p>
      <p style="font-size:15px;line-height:1.7;margin:0 0 12px;">הנתונים הפיננסיים נמחקו לצמיתות ואינם ניתנים לשחזור, גם לא על ידינו. לא נשמר עותק שאפשר להעביר אליך.</p>
      <p style="font-size:13px;color:#666;line-height:1.7;margin:0;">ההודעה נשלחת אוטומטית ואינה דורשת פעולה.</p>
    </div>
  </div></body></html>`;
}

function advisorGoneHtml(b) {
  return `<!doctype html><html dir="rtl" lang="he"><body style="margin:0;padding:0;background:#f6f5f2;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:32px 16px;direction:rtl;text-align:right;">
    <div style="font-size:20px;font-weight:bold;color:${b.accent};margin-bottom:16px;">${escapeHtml(b.nameHe)}</div>
    <div style="background:#ffffff;border-radius:12px;padding:24px;">
      <h1 style="font-size:18px;margin:0 0 12px;">היועץ שלך אינו פעיל יותר במערכת</h1>
      <p style="font-size:15px;line-height:1.7;margin:0 0 12px;">הגישה של היועץ לנתונים שלך הופסקה.</p>
      <p style="font-size:15px;line-height:1.7;margin:0 0 12px;">החשבון והנתונים שלך נשארים שלך ולא השתנו. אפשר להמשיך להשתמש במערכת כרגיל.</p>
      <p style="font-size:15px;line-height:1.7;margin:0;">אם תרצה להתחבר ליועץ אחר, פנה אלינו.</p>
    </div>
  </div></body></html>`;
}


/** Self-contained mail send for the deletion flow: the two function trees have
 *  diverged and only one of them defines a shared sendMail. */
async function deletionSendMail(toEmail, subject, html, from, meta) {
  const key = RESEND_API_KEY.value();
  if (!key || !toEmail) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: from || MAIL_FROM, to: [toEmail], subject, html }),
    });
    let resendId = null;
    try { resendId = JSON.parse(await res.text()).id ?? null; } catch { /* non-JSON */ }
    await logEmail({
      type: (meta && meta.type) || 'generic', to: toEmail,
      practiceId: (meta && meta.practiceId) || null, resendId,
      status: res.ok ? 'accepted' : 'rejected', httpStatus: res.status,
    });
    return res.ok;
  } catch (e) {
    console.warn('deletionSendMail failed', e && e.message);
    return false;
  }
}

exports.deleteMyAccount = onCall(
  { secrets: [RESEND_API_KEY], timeoutSeconds: 540, memory: "512MiB" },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "נדרשת התחברות.");

    // Lowercased + trimmed EVERYWHERE: every write site normalizes, so a
    // mixed-case token email would silently skip half the deletion and leave
    // the allowlist entry alive (anyone knowing the address could re-register).
    const email = String(request.auth?.token?.email ?? "").toLowerCase().trim();
    if (!email || !EMAIL_RE.test(email)) {
      throw new HttpsError("failed-precondition", "לא נמצאה כתובת מייל לחשבון. פנה אלינו ונטפל בבקשה ידנית.");
    }
    if (String(request.data?.confirmEmail ?? "").toLowerCase().trim() !== email) {
      throw new HttpsError("invalid-argument", "כתובת המייל שהוקלדה אינה תואמת לחשבון.");
    }
    // Recent sign-in required: this is irreversible and an unattended session
    // must not be able to trigger it.
    const authTimeMs = Number(request.auth?.token?.auth_time ?? 0) * 1000;
    if (!authTimeMs || Date.now() - authTimeMs > 5 * 60 * 1000) {
      throw new HttpsError("failed-precondition", "מטעמי אבטחה יש להתחבר מחדש ואז לנסות שוב.");
    }

    // ── Blocks (checked BEFORE anything is touched) ──
    if ((await db.collection("platformOwners").doc(uid).get()).exists) {
      throw new HttpsError("failed-precondition", "החשבון הזה מנהל את הפלטפורמה ואי אפשר למחוק אותו מהמערכת.");
    }
    const ownedPractices = await db.collection("practices").where("ownerUid", "==", uid).get();
    for (const p of ownedPractices.docs) {
      const advisorUids = Array.isArray(p.data().advisorUids) ? p.data().advisorUids : [];
      const otherAdvisors = advisorUids.filter((u) => u !== uid);
      const activeSnap = await db.collection("clientLinks")
        .where("practiceId", "==", p.id).where("status", "==", "active").limit(25).get();
      // The deleter's own client link must not block them forever — only OTHER
      // people count. A one-person practice with no clients harms nobody.
      const activeOthers = activeSnap.docs.filter((d) => d.data().clientUid !== uid);
      if (otherAdvisors.length > 0 || activeOthers.length > 0) {
        throw new HttpsError(
          "failed-precondition",
          "החשבון שלך מוגדר כבעל משרד, ומחיקה עצמית תנתק את היועצים והלקוחות המשויכים אליו. כדי להעביר את הבעלות או לסגור את המשרד, פנה אלינו ונלווה אותך בתהליך.",
        );
      }
    }

    // ── Facts we need BEFORE the data is gone ──
    const myLink = await db.collection("clientLinks").doc(uid).get();
    const myAdvisorUid = myLink.exists ? myLink.data().invitedByUid : null;
    const myPracticeId = myLink.exists ? myLink.data().practiceId : null;
    const myAdvisorDoc = await db.collection("advisors").doc(uid).get();
    const myAdvisorPracticeId = myAdvisorDoc.exists ? myAdvisorDoc.data().practiceId : null;
    // Brands are resolved NOW: a solo practice is deleted mid-flow, and a mail
    // built after that would silently fall back to the platform brand.
    const myBrand = await mailBrandForPractice(myPracticeId || myAdvisorPracticeId);
    const advisorGoneBrand = await mailBrandForPractice(myAdvisorPracticeId);

    // 1. Tombstones FIRST — they are what stops /api/transaction,
    //    /api/save-snapshot and /api/app-session from re-creating data (and the
    //    Auth user) with proofs that outlive this account.
    await db.collection("deletionAudit").doc(uid).set(
      { deletedAt: FieldValue.serverTimestamp(), steps: {} }, { merge: true },
    );
    await step(uid, "deviceTokenTombstone", async () => {
      // NOT a delete: deviceTokens is fail-open, so removing the doc would
      // RESTORE the phone's access instead of revoking it.
      await db.collection("deviceTokens").doc(uid).set(
        { minVersion: 2147483647, tombstone: true, at: FieldValue.serverTimestamp() }, { merge: true },
      );
    });

    // 2. Close the door: the allowlist entry gates every users/** rule, so this
    //    stops the user's own client SDK; it also stops silent re-registration.
    const doorClosed = await step(uid, "emailKeys", async () => {
      const batch = db.batch();
      batch.delete(db.collection("allowlist").doc(email));
      batch.delete(db.collection("pendingAdvisors").doc(email));
      batch.delete(db.collection("clientLinks").doc(pendingId(email)));
      await batch.commit();
      // Case-insensitive: the array may hold mixed-case entries (the read path
      // lowercases defensively), and array-contains matches exact bytes only.
      const all = await db.collection("practices").get();
      let cleaned = 0;
      for (const p of all.docs) {
        const arr = p.data().existingInviteAllowed;
        if (!Array.isArray(arr)) continue;
        const kept = arr.filter((e) => String(e).toLowerCase().trim() !== email);
        if (kept.length !== arr.length) { await p.ref.update({ existingInviteAllowed: kept }); cleaned += 1; }
      }
      return { practicesCleaned: cleaned };
    });
    if (!doorClosed.ok) {
      // ABORT — deleting data while the door is open lets the user's own open
      // tab write it all back. Nothing user-visible was deleted yet, so roll
      // the tombstones back too: leaving them would strand a LIVE account
      // behind 410 responses.
      try { await db.collection("deletionAudit").doc(uid).delete(); } catch { /* manual cleanup */ }
      try { await db.collection("deviceTokens").doc(uid).delete(); } catch { /* manual cleanup */ }
      throw new HttpsError("internal", "המחיקה נעצרה לפני שנמחק מידע, ושום נתון לא נמחק. נסה שוב בעוד רגע או פנה אלינו.");
    }

    // 3. Cut the advisor's write path, and revoke refresh tokens.
    await step(uid, "revokeSessions", async () => { await getAuth().revokeRefreshTokens(uid); });

    // 4. Advisor-side links. Links where WE are the advisor belong to OTHER
    //    users and hold their consent record — orphan them, never delete.
    const orphanedClients = [];
    await step(uid, "advisorLinks", async () => {
      const asAdvisor = await db.collection("clientLinks").where("invitedByUid", "==", uid).get();
      for (const d of asAdvisor.docs) {
        const data = d.data();
        // Only ACTIVE, registered clients get the "your advisor left" mail —
        // a declined or never-registered invitee has no advisor to lose.
        if (data.status === "active" && data.clientUid && data.invitedEmail
            && orphanedClients.length < MAX_NOTIFY_CLIENTS) {
          orphanedClients.push(data.invitedEmail);
        }
        await d.ref.update({
          invitedByUid: null,
          status: "orphaned",
          access: "read",
          advisorRemovedAt: FieldValue.serverTimestamp(),
        });
      }
      return { orphaned: asAdvisor.size };
    });

    await step(uid, "ownLinks", async () => {
      await db.collection("clientLinks").doc(uid).delete();
      await db.collection("advisors").doc(uid).delete();
      const member = await db.collection("practices").where("advisorUids", "array-contains", uid).get();
      for (const p of member.docs) await p.ref.update({ advisorUids: FieldValue.arrayRemove(uid) });
      // Solo practices only — RE-READ first: an advisor may have claimed a
      // role (or a client consented) between the pre-check and this step, and
      // deleting the practice would orphan them and their branding.
      let ownedDeleted = 0; let ownedSkipped = 0;
      for (const p of ownedPractices.docs) {
        const fresh = await p.ref.get();
        if (!fresh.exists) continue;
        const uids = Array.isArray(fresh.data().advisorUids) ? fresh.data().advisorUids : [];
        if (uids.some((u) => u !== uid)) { ownedSkipped += 1; continue; }
        await p.ref.delete();
        ownedDeleted += 1;
      }
      return { practices: member.size, ownedDeleted, ownedSkipped };
    });

    // 5. Device / channel bindings.
    await step(uid, "channels", async () => {
      const links = await deleteByQuery(db.collection("whatsappLinks").where("uid", "==", uid));
      const codes = await deleteByQuery(db.collection("whatsappLinkCodes").where("uid", "==", uid));
      await db.collection("pushSubscriptions").doc(uid).delete();
      return { whatsappLinks: links, whatsappCodes: codes };
    });

    // 6. Storage BEFORE the metadata that points at it. Bucket named
    //    explicitly — the default depends on runtime config being present.
    const bucketName = `${process.env.GCLOUD_PROJECT}.firebasestorage.app`;
    await step(uid, "storage", async () => {
      await getStorage().bucket(bucketName).deleteFiles({ prefix: `intake/${uid}/` });
    });

    // 7. The data itself. recursiveDelete covers subcollections (versions,
    //    intake/files, inbox items) AND the parent docs — the inbox parent
    //    holds a merchant name and an amount, so it must go too.
    await step(uid, "userData", async () => {
      await db.recursiveDelete(db.collection("intake").doc(uid));
      await db.recursiveDelete(db.collection("transactionInbox").doc(uid));
      await db.recursiveDelete(db.collection("users").doc(uid));
    });

    // 8. Send audit: keep the row, drop everything identifying — including the
    //    provider id, which points at the provider's own copy.
    await step(uid, "emailLog", async () => {
      const rows = await db.collection("emailLog").where("to", "==", email).get();
      let n = 0;
      for (const d of rows.docs) {
        await d.ref.update({ to: DELETED_MAIL_PLACEHOLDER, error: "", resendId: null, redactedAt: FieldValue.serverTimestamp() });
        n += 1;
      }
      return { redacted: n };
    });

    // 9. Notifications — best effort, never block the deletion, and REPORT
    //    what actually happened rather than what was attempted.
    await step(uid, "notify", async () => {
      // Confirmation to the user. Logged ALREADY redacted, otherwise the last
      // act of deletion would write the address back into the log.
      const key = RESEND_API_KEY.value();
      if (key) {
        try {
          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({ from: myBrand.from, to: [email], subject: "החשבון שלך נמחק", html: deletionConfirmHtml(myBrand) }),
          });
          await logEmail({
            type: "account-deleted", to: DELETED_MAIL_PLACEHOLDER, practiceId: myBrand.practiceId,
            resendId: null, status: res.ok ? "accepted" : "rejected", httpStatus: res.status,
          });
        } catch (e) {
          console.warn("[deleteMyAccount] confirmation mail failed", e && e.message);
        }
      }
      // The advisor who held this client.
      let advisorNotified = false;
      if (myAdvisorUid) {
        const adv = await db.collection("advisors").doc(myAdvisorUid).get();
        const advEmail = adv.exists ? adv.data().email : null;
        if (advEmail) {
          advisorNotified = await deletionSendMail(advEmail, "לקוח הסיר את חשבונו מהמערכת",
            advisorClientLeftHtml(email, myBrand), myBrand.from,
            { type: "client-deleted", practiceId: myBrand.practiceId });
        }
      }
      // Clients who just lost their advisor (this account WAS the advisor).
      // Brand resolved BEFORE the practice was deleted (see top of the flow).
      let clientsNotified = 0;
      for (const clientEmail of orphanedClients) {
        const sent = await deletionSendMail(clientEmail, "היועץ שלך אינו פעיל יותר במערכת",
          advisorGoneHtml(advisorGoneBrand), advisorGoneBrand.from,
          { type: "advisor-deleted", practiceId: advisorGoneBrand.practiceId });
        if (sent) clientsNotified += 1;
      }
      return { advisorNotified, clientsNotified, orphaned: orphanedClients.length };
    });

    // 10. The Auth user LAST — while it exists the user can retry; once it is
    //     gone a callable can no longer authenticate them.
    const authGone = await step(uid, "authUser", async () => { await getAuth().deleteUser(uid); });

    // 11. Prove it: anything that came back during the run is recorded, and the
    //     user is told the truth rather than a blanket "done".
    const leftovers = [];
    await step(uid, "verify", async () => {
      for (const path of [["users", uid], ["transactionInbox", uid], ["intake", uid], ["clientLinks", uid], ["advisors", uid]]) {
        const s = await db.collection(path[0]).doc(path[1]).get();
        if (s.exists) leftovers.push(path[0]);
      }
      const versions = await db.collection("users").doc(uid).collection("versions").limit(1).get();
      const sections = await db.collection("users").doc(uid).collection("sections").limit(1).get();
      if (!sections.empty) leftovers.push("users/sections");
      if (!versions.empty) leftovers.push("users/versions");
      const [remaining] = await getStorage().bucket(bucketName)
        .getFiles({ prefix: `intake/${uid}/`, maxResults: 1 });
      if (remaining.length) leftovers.push("storage");
      if (leftovers.length) {
        // A second pass: whatever re-appeared was written after we deleted it.
        for (const c of ["users", "transactionInbox", "intake"]) {
          await db.recursiveDelete(db.collection(c).doc(uid));
        }
        for (const c of ["clientLinks", "advisors"]) {
          try { await db.collection(c).doc(uid).delete(); } catch { /* recorded above */ }
        }
      }
      return { leftovers };
    });
    // A surviving Auth user is a leftover too — the client must not show a
    // clean success over it.
    if (!authGone.ok) leftovers.push("authUser");

    console.log(`[deleteMyAccount] done uid=${uid} leftovers=${leftovers.length}`);
    return { ok: true, authDeleted: authGone.ok, leftovers };
  },
);
