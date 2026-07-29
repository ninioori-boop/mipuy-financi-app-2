// Daily credit-split drift check (phase A safety net).
//
// Compares users/{uid}.data.credit against the shadow at
// users/{uid}/sections/credit for every account, writes the result to
// creditSplitChecks/{date}, and emails the operator ONLY on drift (plus a
// weekly Sunday "all clean" heartbeat so silence is provably not a crash).
// This is the gate for phase B: the read switch is allowed only after days
// of zero drift here. Isolated module — additive, touches nothing else.
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { createHash } = require("node:crypto");

const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const OPERATOR_EMAIL = "ninioori@gmail.com";
const FROM = "הכלכלן של הבית <invite@orimipuy.com>";

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

  for (const d of users.docs) {
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
  const summary = { day, total: users.size, match, missing, drift, driftUids, at: FieldValue.serverTimestamp() };
  await db.collection("creditSplitChecks").doc(day).set(summary);
  return summary;
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
    const s = await runCheck();
    console.log("creditSplitDailyCheck", JSON.stringify(s));
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
        `היום: תואמים ${s.match} · צל טרם נכתב ${s.missing} · ללא אשראי ${s.noCredit}.\n` +
        `כשמצטברים מספיק ימים נקיים, אפשר לבקש מקלוד להתחיל את שלב ב'.`,
      );
    }
  },
);
