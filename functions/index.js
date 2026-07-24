const { beforeUserCreated, HttpsError } = require("firebase-functions/v2/identity");
const { onCall } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
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

// Anthropic key for the weekly digest's AI action-suggestions. Optional: if the
// secret is unset or the call fails, the digest gracefully falls back to the
// rule-based flags, so it never breaks. Same key/model family the app already
// uses (src/app/api/analyze/route.ts).
// NOTE: the Secret Manager secret is named "mail" (Ori created it under that
// name); it holds the CLAUDE/Anthropic API key, NOT a mail/Resend key.
const ANTHROPIC_API_KEY = defineSecret("mail");

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

// ── Weekly advisor digest ─────────────────────────────────────────────────────
// Every Sunday 08:00 (Asia/Jerusalem) each ADVISOR gets ONE email summarising
// THEIR clients — a meeting-prep briefing (status + this-week activity + rule-
// based action flags). CLIENTS receive nothing. Best-effort: one client's or one
// advisor's failure never blocks the rest. A Claude-written variant can layer on
// later (would add the ANTHROPIC_API_KEY secret).

const num = (v) => (typeof v === "number" && isFinite(v) ? v : 0);
const ils = (n) => "₪" + Math.round(num(n)).toLocaleString("he-IL");
const sumAmt = (rows) => (Array.isArray(rows) ? rows.reduce((s, r) => s + num(r && r.amount), 0) : 0);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function ymNowUTC() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function nameFromEmail(email) {
  const local = String(email || "").split("@")[0] || String(email || "");
  return local.replace(/[._]/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/** Monthly income/expenses/cashflow from a client snapshot (mirrors advisorMock.clientTotals). */
function clientTotals(data) {
  const m = (data && data.mapping) || {};
  const varMonths = Math.max(1, num(m.varMonths) || 1);
  const income = sumAmt(m.income);
  const varMo = sumAmt(m.variable) / varMonths;
  const annMo = (Array.isArray(m.annual) ? m.annual.reduce((s, r) => s + num(r && r.annualAmount), 0) : 0) / 12;
  const debtMo = Array.isArray(m.debts) ? m.debts.reduce((s, r) => s + num(r && r.monthlyPayment), 0) : 0;
  const instMo = Array.isArray(m.installments) ? m.installments.reduce((s, r) => s + num(r && r.monthlyPayment), 0) : 0;
  const expenses = sumAmt(m.fixed) + sumAmt(m.sub) + sumAmt(m.ins) + varMo + annMo + debtMo + instMo;
  return { income: Math.round(income), expenses: Math.round(expenses), cashflow: Math.round(income - expenses) };
}

/** This-month budget standing + this-week activity from the expense log. */
function budgetActivity(data) {
  const ym = ymNowUTC();
  const entries = (data && data.expenseLog && Array.isArray(data.expenseLog.entries)) ? data.expenseLog.entries : [];
  const budgets = (data && data.categoryBudgets && data.categoryBudgets.budgets) || {};
  const weekAgoMs = Date.now() - 7 * 86400000;

  let monthSpent = 0, weekCount = 0, weekSpent = 0;
  const spentByCat = {};
  for (const e of entries) {
    if (!e || typeof e.date !== "string") continue;
    const amt = num(e.amount);
    if (e.date.slice(0, 7) === ym) {
      monthSpent += amt;
      spentByCat[e.category] = (spentByCat[e.category] || 0) + amt;
    }
    const t = Date.parse(e.date);
    if (isFinite(t) && t >= weekAgoMs) { weekCount++; weekSpent += amt; }
  }
  const overCats = [];
  for (const cat of Object.keys(spentByCat)) {
    const cap = num(budgets[cat]);
    if (cap > 0 && spentByCat[cat] > cap) overCats.push({ cat, spent: Math.round(spentByCat[cat]), cap: Math.round(cap) });
  }
  const totalBudget = Object.keys(budgets).reduce((s, k) => s + num(budgets[k]), 0);
  return { monthSpent: Math.round(monthSpent), totalBudget: Math.round(totalBudget), overCats, weekCount, weekSpent: Math.round(weekSpent), hasBudget: totalBudget > 0 };
}

/** Assigned-task completion across ALL the client's meetings (the checklist the
 *  advisor assigns and the client ticks off). Snapshot path: data.meetings.meetings[].tasks[]. */
function taskStats(data) {
  const meetings = (data && data.meetings && Array.isArray(data.meetings.meetings)) ? data.meetings.meetings : [];
  let done = 0, total = 0;
  for (const mtg of meetings) {
    const tasks = mtg && Array.isArray(mtg.tasks) ? mtg.tasks : [];
    for (const t of tasks) { if (t && t.text) { total++; if (t.done) done++; } }
  }
  return { done, total, open: total - done };
}

/** "What changed since the last meeting" — the meeting-prep delta. Reliable:
 *  uses meeting/expense DATES only (no dependency on version-history retention).
 *  Returns null when the client has no recorded meeting yet. */
function sinceLastMeeting(data) {
  const meetings = (data && data.meetings && Array.isArray(data.meetings.meetings)) ? data.meetings.meetings : [];
  const dates = meetings.map((m) => m && m.date).filter((d) => typeof d === "string" && d);
  if (!dates.length) return null;
  const lastDate = dates.reduce((a, b) => (a > b ? a : b));
  const lastMs = Date.parse(lastDate);
  if (!isFinite(lastMs)) return null;
  const daysAgo = Math.max(0, Math.floor((Date.now() - lastMs) / 86400000));
  const entries = (data && data.expenseLog && Array.isArray(data.expenseLog.entries)) ? data.expenseLog.entries : [];
  let newCount = 0, newSum = 0;
  for (const e of entries) {
    if (e && typeof e.date === "string" && e.date >= lastDate) { newCount++; newSum += num(e.amount); }
  }
  return { lastDate, daysAgo, newCount, newSum: Math.round(newSum) };
}

/** Rule-based action flags — the meeting talking-points. Each item: {tone, text}. */
function actionFlags(data, totals, ba, updatedMs, tstats, since) {
  const flags = [];
  if (totals.cashflow < 0) flags.push({ tone: "red", text: `תזרים שלילי של ${ils(-totals.cashflow)} — ההוצאות גבוהות מההכנסות.` });
  for (const o of ba.overCats.slice(0, 3)) flags.push({ tone: "orange", text: `חריגה בקטגוריית "${o.cat}": ${ils(o.spent)} מתוך ${ils(o.cap)} החודש.` });
  if (tstats && tstats.open > 0) flags.push({ tone: "orange", text: `נותרו ${tstats.open} משימות פתוחות שהוקצו ללקוח (מתוך ${tstats.total}).` });
  const sinceDisconnect = since && since.daysAgo >= 14 && since.newCount === 0;
  if (sinceDisconnect) flags.push({ tone: "orange", text: `מאז הפגישה האחרונה (לפני ${since.daysAgo} ימים) הלקוח לא תיעד אף הוצאה — ייתכן ניתוק.` });
  // Expense-logging lapse — mirrors the dashboard's TRACKING_STALE_DAYS=5 pill
  // (src/lib/advisorMock.ts trackingStatus). Skipped when the stronger
  // since-meeting disconnect flag above already fired.
  if (!sinceDisconnect) {
    const entries = data && data.expenseLog && Array.isArray(data.expenseLog.entries) ? data.expenseLog.entries : [];
    let lastLog = 0;
    for (const e of entries) {
      const t = num(e && e.createdAt) || Date.parse((e && e.date) || "") || 0;
      if (t > lastLog) lastLog = t;
    }
    if (lastLog) {
      const staleDays = Math.floor((Date.now() - lastLog) / 86400000);
      if (staleDays >= 5) flags.push({ tone: "orange", text: `הלקוח לא תיעד הוצאות כבר ${staleDays} ימים.` });
    }
  }
  const m = (data && data.mapping) || {};
  const savingsMo = Array.isArray(m.savings) ? m.savings.reduce((s, r) => s + num(r && r.monthlyContribution), 0) : 0;
  if (totals.cashflow > 1000 && savingsMo < totals.cashflow * 0.5) {
    flags.push({ tone: "green", text: `עודף תזרים של ${ils(totals.cashflow)} שלא מוקצה במלואו לחיסכון — הזדמנות להפניה ליעד.` });
  }
  const overdraft = Array.isArray(m.bankAccounts) ? m.bankAccounts.find((b) => num(b && b.balance) < 0) : null;
  if (overdraft) flags.push({ tone: "red", text: `מינוס בעו״ש: ${ils(overdraft.balance)} (${overdraft.name || "חשבון"}).` });
  if (!ba.hasBudget) flags.push({ tone: "gray", text: "עדיין לא הוגדר תקציב חודשי — כדאי לבנות יחד בפגישה." });
  if (updatedMs && Date.now() - updatedMs > 30 * 86400000) flags.push({ tone: "gray", text: "הלקוח לא עדכן נתונים מעל 30 יום." });
  return flags;
}

/** Compact Hebrew data summary for the AI prompt — AGGREGATES only (no raw
 *  transactions / merchant names), keeping the client's exposure minimal. */
function clientSummaryText(c, data) {
  const m = (data && data.mapping) || {};
  const L = [];
  L.push(`לקוח: ${c.name} · שלב ליווי: ${c.stage}`);
  L.push(`הכנסה חודשית: ${ils(c.totals.income)} · הוצאות חודשיות: ${ils(c.totals.expenses)} · תזרים: ${ils(c.totals.cashflow)}`);
  L.push(c.ba.hasBudget ? `תקציב חודשי כולל: ${ils(c.ba.totalBudget)} · הוצאת החודש: ${ils(c.ba.monthSpent)}` : "לא הוגדר תקציב חודשי.");
  if (c.ba.overCats.length) L.push(`חריגות תקציב: ${c.ba.overCats.map((o) => `${o.cat} (${ils(o.spent)}/${ils(o.cap)})`).join(", ")}`);
  const savingsMo = Array.isArray(m.savings) ? m.savings.reduce((s, r) => s + num(r && r.monthlyContribution), 0) : 0;
  const savingsBal = Array.isArray(m.savings) ? m.savings.reduce((s, r) => s + num(r && r.accumulated), 0) : 0;
  if (savingsMo || savingsBal) L.push(`חיסכון חודשי: ${ils(savingsMo)} · נצבר: ${ils(savingsBal)}`);
  const debtMo = Array.isArray(m.debts) ? m.debts.reduce((s, r) => s + num(r && r.monthlyPayment), 0) : 0;
  if (debtMo) L.push(`החזרי חוב חודשיים: ${ils(debtMo)}`);
  const bank = Array.isArray(m.bankAccounts) ? m.bankAccounts.map((b) => `${(b && b.name) || "חשבון"}: ${ils(b && b.balance)}`).join(", ") : "";
  if (bank) L.push(`יתרות עו״ש: ${bank}`);
  const goals = [];
  const g = (data && data.goals) || {};
  for (const h of ["short", "medium", "long"]) {
    if (Array.isArray(g[h])) for (const goal of g[h]) {
      if (goal && (goal.name || num(goal.required) > 0)) goals.push(`${goal.name || "יעד"} (${ils(goal.current)}/${ils(goal.required)})`);
    }
  }
  if (goals.length) L.push(`יעדים: ${goals.join(", ")}`);
  if (c.since) L.push(`מאז הפגישה האחרונה (${c.since.lastDate}, לפני ${c.since.daysAgo} ימים): ${c.since.newCount} הוצאות חדשות בסך ${ils(c.since.newSum)}.`);
  if (c.tasks && c.tasks.total > 0) L.push(`משימות שהוקצו: ${c.tasks.done} מתוך ${c.tasks.total} הושלמו (${c.tasks.open} פתוחות).`);
  if (c.flags.length) L.push(`דגלים שזוהו אוטומטית: ${c.flags.map((f) => f.text).join(" | ")}`);
  return L.join("\n");
}

const DIGEST_AI_SYSTEM = [
  "אתה עוזר של יועץ פיננסי (מאמן כלכלי). המשימה: להכין את היועץ לפגישה הקרובה עם הלקוח.",
  "בהינתן תמונת המצב הפיננסית של הלקוח, כתוב 2 עד 4 נקודות קצרות וממוקדות לשולחן הפגישה:",
  "דגלים לבדוק, הזדמנויות לפעולה, ותזכורות. פנה אל היועץ (לא אל הלקוח).",
  "כל נקודה בשורה נפרדת, משפט אחד, בלי מספור ובלי כוכביות, בלי מבוא ובלי סיכום.",
  "התבסס אך ורק על הנתונים שניתנו — אל תמציא מספרים או עובדות. עברית בלבד.",
].join(" ");

/** AI-written meeting talking-points for one client. Returns string[] or null on
 *  ANY failure (missing secret, API error, empty) — caller falls back to flags. */
async function aiActionSuggestions(c, data) {
  const key = ANTHROPIC_API_KEY.value();
  if (!key) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 400,
        system: DIGEST_AI_SYSTEM,
        messages: [{ role: "user", content: clientSummaryText(c, data) }],
      }),
    });
    if (!res.ok) { console.warn("digest AI: rejected", res.status); return null; }
    const json = await res.json();
    const text = (json && json.content && json.content[0] && json.content[0].text) || "";
    const items = text.split("\n").map((s) => s.replace(/^[\s\-*•\d.)]+/, "").trim()).filter(Boolean).slice(0, 4);
    return items.length ? items : null;
  } catch (e) { console.warn("digest AI: failed", e && e.message ? e.message : e); return null; }
}

const TONE_COLOR = { red: "#c0392b", orange: "#c47f17", green: "#2f7d4f", gray: "#8a8178" };
const STAGE_DEFAULT = ENGAGEMENT_STAGES[0];

/** One client's meeting-prep card (inline styles — email-client safe). */
function clientCardHtml(c) {
  const cf = c.totals.cashflow;
  const cfColor = cf >= 0 ? "#2f7d4f" : "#c0392b";
  const cfText = (cf >= 0 ? "+" : "−") + ils(Math.abs(cf));
  const budgetLine = c.ba.hasBudget
    ? `תקציב החודש: הוצאת <b>${ils(c.ba.monthSpent)}</b> מתוך ${ils(c.ba.totalBudget)}`
    : `לא הוגדר תקציב חודשי`;
  let flagsHtml;
  if (c.aiSuggestions && c.aiSuggestions.length) {
    // AI-written meeting talking-points (preferred when available).
    flagsHtml = `<div style="font-size:11px;color:#a8894c;font-weight:bold;margin:10px 0 4px;">🤖 המלצות לפגישה</div>` +
      `<ul style="margin:0;padding:0 18px 0 0;list-style:none;">` +
      c.aiSuggestions.map((t) => `<li style="font-size:13px;line-height:1.6;color:#333;margin:0 0 4px;">
        <span style="color:#C9A86C;font-weight:bold;">•</span> ${esc(t)}</li>`).join("") +
      `</ul>`;
  } else if (c.flags.length) {
    // Deterministic rule-based flags (fallback when AI is off/unavailable).
    flagsHtml = `<ul style="margin:10px 0 0;padding:0 18px 0 0;list-style:none;">` +
      c.flags.map((f) => `<li style="font-size:13px;line-height:1.6;color:#333;margin:0 0 4px;">
        <span style="color:${TONE_COLOR[f.tone] || "#333"};font-weight:bold;">•</span> ${esc(f.text)}</li>`).join("") +
      `</ul>`;
  } else {
    flagsHtml = `<div style="font-size:13px;color:#2f7d4f;margin-top:8px;">אין דגלים — הלקוח יציב החודש. ✓</div>`;
  }
  const border = c.attention ? "#c0392b" : "#e5e0d8";
  return `<div style="background:#ffffff;border:1px solid #e5e0d8;border-right:4px solid ${border};border-radius:10px;padding:16px 18px;margin:0 0 12px;">
    <div style="display:flex;justify-content:space-between;">
      <div style="font-size:16px;font-weight:bold;color:#1a1a1a;">${esc(c.name)}</div>
      <div style="font-size:12px;color:#a8894c;">${esc(c.stage)}</div>
    </div>
    <div style="font-size:13px;color:#333;margin-top:6px;">
      תזרים חודשי: <b style="color:${cfColor};">${cfText}</b> &nbsp;·&nbsp; ${budgetLine}
    </div>
    <div style="font-size:12px;color:#8a8178;margin-top:4px;">השבוע: ${c.ba.weekCount} הוצאות (${ils(c.ba.weekSpent)})${c.tasks && c.tasks.total > 0 ? ` &nbsp;·&nbsp; ✅ משימות: ${c.tasks.done}/${c.tasks.total} הושלמו` : ""}</div>
    ${c.since ? `<div style="font-size:12px;color:#8a8178;margin-top:2px;">🗓️ מאז הפגישה (${esc(c.since.lastDate)} · לפני ${c.since.daysAgo} ימים): ${c.since.newCount} הוצאות חדשות${c.since.newSum ? ` (${ils(c.since.newSum)})` : ""}</div>` : ""}
    ${flagsHtml}
  </div>`;
}

/** The full weekly digest email for one advisor. */
function digestEmailHtml(advisorName, clients) {
  const today = new Date().toLocaleDateString("he-IL", { day: "numeric", month: "long", year: "numeric" });
  const attentionCount = clients.filter((c) => c.attention).length;
  const cards = clients.map(clientCardHtml).join("");
  const summary = attentionCount > 0
    ? `<b style="color:#c0392b;">${attentionCount}</b> מהלקוחות דורשים תשומת לב השבוע.`
    : `כל הלקוחות יציבים השבוע. 👌`;
  return `<!doctype html><html dir="rtl" lang="he"><body style="margin:0;padding:0;background:#f6f5f2;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:28px 16px;direction:rtl;text-align:right;">
    <div style="font-size:13px;color:#a8894c;letter-spacing:2px;margin-bottom:6px;">THE HOME ECONOMIST</div>
    <h1 style="font-size:21px;color:#1a1a1a;margin:0 0 4px;">הסיכום השבועי שלך</h1>
    <div style="font-size:13px;color:#8a8178;margin:0 0 4px;">${esc(today)}</div>
    <p style="font-size:14px;color:#333;line-height:1.7;margin:0 0 18px;">שלום ${esc(advisorName)}, הנה מצב הלקוחות שלך לקראת השבוע. ${summary}</p>
    ${cards}
    <div style="text-align:center;margin:22px 0 6px;">
      <a href="${APP_URL}/app/advisor" style="background:#C9A86C;color:#1a1a1a;text-decoration:none;font-size:15px;font-weight:bold;padding:11px 30px;border-radius:999px;display:inline-block;">כניסה לדשבורד</a>
    </div>
    <p style="font-size:11px;color:#a8a29a;text-align:center;margin:14px 0 0;">סיכום שבועי אוטומטי · הכלכלן של הבית · ${APP_URL.replace("https://", "")}</p>
  </div>
</body></html>`;
}

/** Generic Resend send. Best-effort — returns true only when accepted. */
async function sendMail(toEmail, subject, html) {
  const key = RESEND_API_KEY.value();
  if (!key || !toEmail) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: MAIL_FROM, to: [toEmail], subject, html }),
    });
    if (!res.ok) { console.warn("sendMail: resend rejected", res.status, await res.text().catch(() => "")); return false; }
    return true;
  } catch (e) { console.warn("sendMail: send failed", e && e.message ? e.message : e); return false; }
}

/** Build + send the weekly digest for ONE advisor. Returns {sent, clientCount}. */
async function sendAdvisorDigest(advisorUid, advisorEmail, advisorName) {
  const linksSnap = await db.collection("clientLinks")
    .where("invitedByUid", "==", advisorUid).where("status", "==", "active").get();

  const clients = [];
  for (const linkDoc of linksSnap.docs) {
    const link = linkDoc.data();
    const clientUid = link.clientUid;
    if (!clientUid) continue;
    try {
      const uDoc = await db.collection("users").doc(clientUid).get();
      const data = uDoc.exists ? uDoc.data().data : null;
      const updatedMs = uDoc.exists && uDoc.data().updatedAt && typeof uDoc.data().updatedAt.toMillis === "function"
        ? uDoc.data().updatedAt.toMillis() : 0;
      const totals = clientTotals(data);
      const ba = budgetActivity(data);
      const tstats = taskStats(data);
      const since = sinceLastMeeting(data);
      const flags = actionFlags(data, totals, ba, updatedMs, tstats, since);
      const attention = totals.cashflow < 0 || ba.overCats.length > 0 || flags.some((f) => f.tone === "red");
      const c = { name: nameFromEmail(link.invitedEmail), stage: link.stage || STAGE_DEFAULT, totals, ba, tasks: tstats, since, flags, attention };
      c.aiSuggestions = await aiActionSuggestions(c, data);   // null → card falls back to flags
      clients.push(c);
    } catch (e) { console.warn("digest: client load failed", clientUid, e && e.message ? e.message : e); }
  }
  if (clients.length === 0) return { sent: false, clientCount: 0 };
  clients.sort((a, b) => (b.attention === a.attention ? 0 : b.attention ? 1 : -1));
  const sent = await sendMail(advisorEmail, "הסיכום השבועי שלך — מצב הלקוחות", digestEmailHtml(advisorName, clients));
  return { sent, clientCount: clients.length };
}

function advisorDisplayName(advData) {
  return (advData && (advData.name || advData.displayName)) || nameFromEmail(advData && advData.email) || "יועץ";
}

// Scheduled: every Sunday 08:00 Asia/Jerusalem, to every advisor.
exports.weeklyAdvisorDigest = onSchedule(
  { schedule: "0 8 * * 0", timeZone: "Asia/Jerusalem", secrets: [RESEND_API_KEY, ANTHROPIC_API_KEY] },
  async () => {
    const advisors = await db.collection("advisors").get();
    for (const a of advisors.docs) {
      const email = a.data().email;
      if (!email) continue;
      try { await sendAdvisorDigest(a.id, email, advisorDisplayName(a.data())); }
      catch (e) { console.warn("weeklyAdvisorDigest: advisor failed", a.id, e && e.message ? e.message : e); }
    }
  },
);

// On-demand: an advisor sends THEIR OWN digest to THEIR OWN email (for testing /
// "send me now"). Never targets a client. Gated on the advisors/{uid} role.
exports.sendDigestNow = onCall({ secrets: [RESEND_API_KEY, ANTHROPIC_API_KEY] }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "נדרשת התחברות.");
  const adv = await db.collection("advisors").doc(uid).get();
  if (!adv.exists) throw new HttpsError("permission-denied", "רק יועץ יכול לשלוח סיכום.");
  const email = adv.data().email;
  if (!email) throw new HttpsError("failed-precondition", "אין כתובת מייל ליועץ.");
  const { sent, clientCount } = await sendAdvisorDigest(uid, email, advisorDisplayName(adv.data()));
  return { ok: true, sent, clientCount, email };
});

/**
 * getFirmOverview — a firm MANAGER (the practice owner) reads their firm's
 * advisors and the clients each brought in. The middle tier between the platform
 * owner (/app/admin, all firms) and a single advisor (/app/advisor, own clients).
 * Authorized here (caller must be practices/{id}.ownerUid) so no client-side rule
 * change is needed. Returns statuses + dates only — NEVER a client's financial data.
 */
exports.getFirmOverview = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "נדרשת התחברות.");

  const advSnap = await db.collection("advisors").doc(uid).get();
  if (!advSnap.exists) throw new HttpsError("permission-denied", "רק יועץ יכול לצפות.");
  const practiceId = advSnap.data().practiceId;
  if (!practiceId) throw new HttpsError("failed-precondition", "לא משויך משרד.");

  const practiceSnap = await db.collection("practices").doc(practiceId).get();
  if (!practiceSnap.exists) throw new HttpsError("failed-precondition", "המשרד לא נמצא.");
  const practice = practiceSnap.data();
  if (practice.ownerUid !== uid) throw new HttpsError("permission-denied", "רק מנהל המשרד יכול לצפות במשרד.");

  const advisorsSnap = await db.collection("advisors").where("practiceId", "==", practiceId).get();
  const advisors = [];
  for (const a of advisorsSnap.docs) {
    const linksSnap = await db.collection("clientLinks").where("invitedByUid", "==", a.id).get();
    const clients = [];
    let activeCount = 0;
    linksSnap.forEach((l) => {
      const d = l.data();
      if (d.status === "consumed") return;
      const ts = d.statusChangedAt || d.createdAt;
      const dateMs = ts && typeof ts.toMillis === "function" ? ts.toMillis() : 0;
      clients.push({ email: d.invitedEmail, status: d.status, dateMs });
      if (d.status === "active") activeCount++;
    });
    clients.sort((x, y) => y.dateMs - x.dateMs);
    advisors.push({
      uid: a.id,
      email: a.data().email || a.id,
      role: a.data().role || "member",
      clients,
      activeCount,
    });
  }
  advisors.sort((x, y) => y.clients.length - x.clients.length);

  return { practiceName: practice.name || practiceId, advisorCount: advisors.length, advisors };
});

// ── Personal WhatsApp goal bot ───────────────────────────────────────────────
// Isolated module (functions/goalBot.js). Additive only — does not touch the
// signup gate or advisor functions above. See docs/whatsapp-goal-bot-setup.md.
const goalBot = require("./goalBot");
exports.goalBotEvening = goalBot.goalBotEvening;
exports.goalBotMidday = goalBot.goalBotMidday;
exports.goalBotWebhook = goalBot.goalBotWebhook;
