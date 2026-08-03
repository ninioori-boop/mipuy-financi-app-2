// Daily credit-split drift check (phase A safety net) + portfolio-size alarm.
//
// Compares users/{uid}.data.credit against the shadow at
// users/{uid}/sections/credit for every account, writes the result to
// creditSplitChecks/{date}, and emails the operator ONLY on drift (plus a
// weekly Sunday "all clean" heartbeat so silence is provably not a crash).
// This is the gate for phase B: the read switch is allowed only after days
// of zero drift here. Isolated module — additive, touches nothing else.
//
// SIZE ALARM (2026-07-31): the app blocks saving a portfolio over 900KB
// (MAX_BYTES in DataSync.tsx). Phase B — pulling credit transactions out of the
// portfolio — is what fixes that, but measured 2026-07-31 the biggest account is
// 163KB = 19% of the cap and NOTHING is over 50%, so phase B's real risk isn't
// justified yet. Instead this loop (which already reads every account) measures
// each portfolio and emails when one first crosses 60%, turning "when do we need
// phase B?" from a guess into something the system answers months ahead.
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { createHash } = require("node:crypto");

const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const OPERATOR_EMAIL = "ninioori@gmail.com";
const FROM = "הכלכלן של הבית <invite@orimipuy.com>";

// Must stay in sync with MAX_BYTES in src/components/layout/DataSync.tsx — the
// value the app actually refuses to save above.
const MAX_BYTES = 900_000;
const WARN_BYTES = Math.round(MAX_BYTES * 0.6);   // 540KB — a tripwire, not a nag
const pct = (bytes) => Math.round((bytes / MAX_BYTES) * 100);
const kb = (bytes) => Math.round(bytes / 1024);

const canon = (v) => {
  const s = (x) => {
    if (x === null || typeof x !== "object") return JSON.stringify(x) ?? "null";
    if (Array.isArray(x)) return `[${x.map(s).join(",")}]`;
    return `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${s(x[k])}`).join(",")}}`;
  };
  return createHash("sha256").update(s(v)).digest("hex").slice(0, 12);
};

async function runCheck() {
  const db = getFirestore();
  const users = await db.collection("users").get();
  let match = 0, missing = 0, drift = 0, noCredit = 0;
  const driftUids = [];
  let maxBytes = 0, maxUid = null;
  const overWarn = [];

  for (const d of users.docs) {
    // Size first, so it is measured for EVERY account — including the ones the
    // drift check skips below (no credit data, or shadow not written yet).
    // Measures `data` only, not the whole document: that is exactly what the
    // app's own save guard measures (snapshotSize in src/lib/dataSync.ts, whose
    // result is what gets written to users/{uid}.data). Measuring the wrapper
    // too would make the alarm disagree with the real failure.
    const bytes = Buffer.byteLength(JSON.stringify(d.data()?.data ?? {}), "utf8");
    if (bytes > maxBytes) { maxBytes = bytes; maxUid = d.id; }
    if (bytes >= WARN_BYTES) overWarn.push({ uid: d.id, kb: kb(bytes), pct: pct(bytes) });

    const credit = d.data()?.data?.credit;
    // An EMPTY list is still compared — "deleted all rows" must never resurrect.
    if (!credit || !Array.isArray(credit.transactions)) { noCredit += 1; continue; }
    const shadow = await d.ref.collection("sections").doc("credit").get();
    if (!shadow.exists) { missing += 1; continue; }
    const a = canon({ t: credit.transactions, f: credit.uploadedFileNames ?? [] });
    const b = canon({ t: shadow.data()?.transactions ?? [], f: shadow.data()?.uploadedFileNames ?? [] });
    if (a === b) match += 1;
    else { drift += 1; driftUids.push(d.id.slice(0, 8)); }
  }

  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
  const summary = {
    day, total: users.size, match, missing, drift, driftUids,
    noCredit,                                   // was referenced by both emails but never stored → printed "undefined"
    maxKb: kb(maxBytes), maxPct: pct(maxBytes), maxUid,
    overWarn,
    at: FieldValue.serverTimestamp(),
  };
  await db.collection("creditSplitChecks").doc(day).set(summary);
  return summary;
}

/** Yesterday's over-threshold uids, so the alarm fires on CROSSING, not daily. */
async function previouslyOverWarn(db, today) {
  try {
    // The most recent check BEFORE today — robust to a skipped day (a run that
    // failed, or the function being paused), unlike hardcoding "yesterday".
    const prev = await db.collection("creditSplitChecks")
      .where("day", "<", today).orderBy("day", "desc").limit(1).get();
    if (prev.empty) return null;                // no history yet
    const list = prev.docs[0].data()?.overWarn;
    return new Set(Array.isArray(list) ? list.map((x) => (typeof x === "string" ? x : x?.uid)) : []);
  } catch (e) {
    console.warn("creditSplitCheck: previous check unreadable", e && e.message);
    return null;
  }
}

async function mail(subject, text) {
  const key = RESEND_API_KEY.value();
  if (!key) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM, to: [OPERATOR_EMAIL], subject,
        html: `<div dir="rtl" style="font-family:Arial;white-space:pre-line">${text}</div>`,
      }),
    });
  } catch (e) { console.warn("creditSplitCheck mail failed", e && e.message); }
}

exports.creditSplitDailyCheck = onSchedule(
  { schedule: "30 7 * * *", timeZone: "Asia/Jerusalem", secrets: [RESEND_API_KEY] },
  async () => {
    const db = getFirestore();
    const s = await runCheck();
    console.log("creditSplitDailyCheck", JSON.stringify(s));

    // ── Size alarm — deliberately BEFORE and independent of the drift mail:
    // a portfolio approaching the save ceiling matters just as much on a day
    // that also has drift, and an early `return` in that branch must never be
    // able to swallow it.
    const prevOver = await previouslyOverWarn(db, s.day);
    const crossed = prevOver === null
      ? s.overWarn                                   // no history — report whatever is over
      : s.overWarn.filter((x) => !prevOver.has(x.uid));
    if (crossed.length > 0) {
      await mail(
        "🟠 תיק לקוח מתקרב לתקרת השמירה",
        `${crossed.length} תיקים חצו היום ${Math.round(WARN_BYTES / 1024)}KB — 60% מהתקרה שמעליה האפליקציה חוסמת שמירה.\n\n` +
        crossed.map((x) => `· ${x.uid.slice(0, 10)} — ${x.kb}KB (${x.pct}% מהתקרה)`).join("\n") +
        `\n\nהתיק הגדול ביותר כרגע: ${s.maxKb}KB (${s.maxPct}% מהתקרה).\n\n` +
        `זו לא תקלה ואף אחד לא חסום — זו התראה מוקדמת. כשזה קורה, הפתרון המתוכנן הוא ` +
        `שלב ב' של פיצול האשראי (הוצאת העסקאות למסמך נפרד), שנדחה בכוונה עד שיהיה בו צורך.\n` +
        `אפשר לכתוב לקלוד: "תיק מתקרב לתקרה, בוא נתחיל את שלב ב'".`,
      );
    }

    if (s.drift > 0) {
      await mail(
        "⚠️ סטייה בפיצול האשראי, נדרשת בדיקה",
        `בדיקת הצל היומית מצאה ${s.drift} חשבונות עם סטייה בין העותק הראשי לעותק הצל.\n` +
        `חשבונות: ${s.driftUids.join(", ")}\n` +
        `תואמים: ${s.match} · צל טרם נכתב: ${s.missing} · ללא אשראי: ${s.noCredit}\n\n` +
        `לא לעבור לשלב ב' עד שזה מוסבר. אפשר לכתוב לקלוד: "יש סטייה בפיצול, תבדוק".`,
      );
    } else if (new Date().getDay() === 0) {
      // Sunday heartbeat — proves the check itself is alive.
      await mail(
        "✅ פיצול האשראי: שבוע נקי",
        `בדיקת הצל רצה כל יום השבוע ללא סטיות.\n` +
        `היום: תואמים ${s.match} · צל טרם נכתב ${s.missing} · ללא אשראי ${s.noCredit}.\n\n` +
        // Trend line: visible every week even when no alarm fires, so a sudden
        // jump is noticed BEFORE the threshold rather than at it.
        `📦 התיק הגדול ביותר: ${s.maxKb}KB — ${s.maxPct}% מתקרת השמירה.\n` +
        `${s.overWarn.length > 0 ? `⚠️ ${s.overWarn.length} תיקים מעל 60% מהתקרה.` : `אין תיקים מעל 60% מהתקרה.`}`,
      );
    }
  },
);
