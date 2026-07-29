/**
 * דוח נתונים מלא — everything the system knows, in one local HTML file (READ-ONLY).
 *
 * Sections: AARRR summary, signups trend, stage distribution, expense-logging
 * activity (incl. per-client table + dormant list), sign-in freshness,
 * advisor/links status, allowlist sources.
 *
 * Contains client names/emails — output stays LOCAL (gitignored), never publish.
 *
 * Usage:
 *   1. service-account-key.json at project root (same key as export-clients).
 *   2. npm run report:data
 *   Output: data-report.html (project root, gitignored).
 */

import { cert, initializeApp } from "firebase-admin/app";
import { getAuth, type UserRecord } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const KEY_PATH = resolve(process.cwd(), "service-account-key.json");
const OUT_HTML = resolve(process.cwd(), "data-report.html");

const DAY = 86_400_000;
const STALE_DAYS = 5; // mirrors TRACKING_STALE_DAYS in src/lib/advisorMock.ts
const PRICE_PER_CLIENT_YEAR = 240; // ₪

/* ---- stage derivation — copied from export-clients.ts (repo convention:
 * scripts stay self-contained; export-clients runs main() on import) ---- */

type ClientRow = { name?: string };
type ManualBucket = ClientRow[] | undefined;

type MapData = {
  meta?: { name?: string; phone?: string; notes?: string };
  manual?: Record<string, ManualBucket>;
  monthly?: Record<string, Record<string, ClientRow[] | string | undefined>>;
  annual?: Record<string, ClientRow[] | undefined>;
  credit?: { transactions?: unknown[]; autoRows?: Record<string, number> };
};

type ExpenseEntry = { date?: string; amount?: number; category?: string; createdAt?: number };

type NewSnapshot = {
  version?: number;
  monthly?: { months?: Record<string, Record<string, ClientRow[] | undefined>> };
  annual?: Record<string, ClientRow[] | undefined>;
  mapping?: Record<string, ClientRow[] | boolean | undefined> & { creditImported?: boolean };
  goals?: Record<string, ClientRow[] | undefined>;
  credit?: { learnedDB?: Record<string, string> };
  meetings?: { meetings?: unknown[] };
  business?: Record<string, ClientRow[] | undefined>;
  expenseLog?: { entries?: ExpenseEntry[] };
};

function hasRows(bucket: ManualBucket): boolean {
  return Array.isArray(bucket) && bucket.some((r) => (r?.name ?? "").trim() !== "");
}

function deriveStageOld(data: MapData | undefined): number {
  if (!data) return 0;
  const annual = data.annual ?? {};
  if (["income", "fixed", "var", "sub", "debt", "sav"].some((k) => hasRows(annual[k]))) return 5;
  const monthly = data.monthly ?? {};
  const monthlyHasRows = Object.values(monthly).some((m) => {
    if (!m) return false;
    return ["income", "fixed", "variable"].some((sec) => {
      const arr = m[sec];
      return Array.isArray(arr) && arr.some((r) => (r?.name ?? "").trim() !== "");
    });
  });
  if (monthlyHasRows) return 4;
  const manual = data.manual ?? {};
  if (["income", "fixed", "variable", "subs", "insurance", "debts"].some((k) => hasRows(manual[k]))) return 3;
  const credit = data.credit ?? {};
  if (
    (Array.isArray(credit.transactions) && credit.transactions.length > 0) ||
    (credit.autoRows && Object.keys(credit.autoRows).length > 0)
  ) {
    return 2;
  }
  const meta = data.meta;
  if (meta && [meta.name, meta.phone, meta.notes].some((v) => (v ?? "").trim() !== "")) return 1;
  return 0;
}

function deriveStageNew(data: NewSnapshot | undefined): number {
  if (!data) return 0;
  const annual = data.annual ?? {};
  if (["income", "fixed", "variable", "sub", "savings", "debt"].some((k) => hasRows(annual[k]))) return 5;
  const months = data.monthly?.months ?? {};
  const MONTH_SECTIONS = ["income", "fixed", "variable", "sub", "ins", "installments", "debts", "savings"];
  const monthlyHasRows = Object.values(months).some((m) => {
    if (!m || typeof m !== "object") return false;
    return MONTH_SECTIONS.some((sec) => hasRows((m as Record<string, ClientRow[] | undefined>)[sec]));
  });
  if (monthlyHasRows) return 4;
  const mapping = (data.mapping ?? {}) as Record<string, ManualBucket>;
  if (
    ["income", "fixed", "variable", "sub", "ins", "annual", "debts", "installments", "savings"].some((k) =>
      hasRows(mapping[k]),
    )
  ) {
    return 3;
  }
  if (
    data.mapping?.creditImported === true ||
    (data.credit?.learnedDB && Object.keys(data.credit.learnedDB).length > 0)
  ) {
    return 2;
  }
  const goals = data.goals ?? {};
  const hasGoals = ["short", "medium", "long"].some((k) => hasRows(goals[k]));
  const hasMeetings = Array.isArray(data.meetings?.meetings) && data.meetings.meetings.length > 0;
  const business = data.business ?? {};
  const hasBusiness = ["revenue", "cogs", "opex"].some((k) => hasRows(business[k]));
  if (hasGoals || hasMeetings || hasBusiness) return 1;
  return 0;
}

function isNewSnapshot(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.version === "number" ||
    (typeof d.mapping === "object" && d.mapping !== null) ||
    (typeof d.monthly === "object" && d.monthly !== null && "months" in (d.monthly as object))
  );
}

function deriveStage(data: MapData | NewSnapshot | undefined): number {
  if (isNewSnapshot(data)) return deriveStageNew(data as NewSnapshot);
  return deriveStageOld(data as MapData | undefined);
}

const STAGE_LABELS: Record<number, string> = {
  0: "נרשם, אין נתונים",
  1: "מיפוי התחיל",
  2: "אשראי נטען",
  3: "מיפוי ידני הושלם",
  4: "תכנון חודשי פעיל",
  5: "תכנון שנתי הושלם",
};

/* ---------------------------------------------------------------- */

async function listAllAuthUsers(): Promise<UserRecord[]> {
  const all: UserRecord[] = [];
  const auth = getAuth();
  let nextPageToken: string | undefined;
  do {
    const result = await auth.listUsers(1000, nextPageToken);
    all.push(...result.users);
    nextPageToken = result.pageToken;
  } while (nextPageToken);
  return all;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ils = (n: number) => `${Math.round(n).toLocaleString("he-IL")} ₪`;
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");

function daysAgoLabel(ms: number, now: number): string {
  if (!ms) return "—";
  const d = Math.floor((now - ms) / DAY);
  if (d <= 0) return "היום";
  if (d === 1) return "אתמול";
  return `לפני ${d} ימים`;
}

function bar(widthPct: number): string {
  const w = Math.max(1, Math.min(100, Math.round(widthPct)));
  return `<div class="track"><div class="fill" style="width:${w}%"></div></div>`;
}

async function main() {
  let keyJson: string;
  try {
    keyJson = readFileSync(KEY_PATH, "utf8");
  } catch {
    console.error(`❌ לא נמצא service-account-key.json בנתיב: ${KEY_PATH}`);
    process.exit(1);
  }
  initializeApp({ credential: cert(JSON.parse(keyJson)) });
  const db = getFirestore();

  const now = Date.now();
  const d0 = new Date();
  const monthStart = new Date(d0.getFullYear(), d0.getMonth(), 1).getTime();
  const ym = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, "0")}`;
  const monthLabel = `${String(d0.getMonth() + 1).padStart(2, "0")}/${d0.getFullYear()}`;

  console.log("🔍 שולף משתמשים, יועצים, קישורים ו-allowlist…");
  const [users, advisorsSnap, linksSnap, allowSnap] = await Promise.all([
    listAllAuthUsers(),
    db.collection("advisors").get(),
    db.collection("clientLinks").get(),
    db.collection("allowlist").get(),
  ]);

  const advisorUids = new Set(advisorsSnap.docs.map((doc) => doc.id));
  const authUids = new Set(users.map((u) => u.uid));

  type LinkDoc = { id: string; status?: string; invitedByUid?: string; practiceId?: string; stage?: string };
  const pendingInvites: { email: string }[] = [];
  const activeLinks: LinkDoc[] = [];
  let demoOrOrphanLinks = 0;
  for (const doc of linksSnap.docs) {
    const data = doc.data() as LinkDoc & { invitedEmail?: string };
    if (doc.id.startsWith("pending_")) {
      if (data.status === "pending") pendingInvites.push({ email: data.invitedEmail ?? doc.id.slice("pending_".length) });
    } else if (data.status === "active") {
      if (authUids.has(doc.id)) activeLinks.push({ ...data, id: doc.id });
      else demoOrOrphanLinks++;
    }
  }
  const activeLinkUids = new Set(activeLinks.map((l) => l.id));
  const internalTestLinks = activeLinks.filter((l) => advisorUids.has(l.id)).length;

  const allowSources = new Map<string, number>();
  for (const doc of allowSnap.docs) {
    const source = (doc.data().source as string | undefined) ?? "(ללא מקור)";
    allowSources.set(source, (allowSources.get(source) ?? 0) + 1);
  }

  const advisors = users.filter((u) => advisorUids.has(u.uid));
  const clients = users.filter((u) => !advisorUids.has(u.uid));
  console.log(`   ${users.length} משתמשים (${advisors.length} יועצים, ${clients.length} לקוחות). שולף נתונים לכל לקוח…`);

  const perClient = await Promise.all(
    clients.map(async (u) => {
      const [usersDoc, mapsDoc] = await Promise.all([
        db.collection("users").doc(u.uid).get(),
        db.collection("maps").doc(u.uid).get(),
      ]);
      const usersData = usersDoc.exists ? usersDoc.data() : null;
      const mapsData = mapsDoc.exists ? mapsDoc.data() : null;
      const dataA = usersData?.data as NewSnapshot | undefined;
      const dataB = mapsData?.data as MapData | undefined;
      const stage = Math.max(deriveStage(dataA), deriveStage(dataB));

      const name =
        (dataB?.meta?.name ?? "").trim() ||
        (mapsData?.clientName ?? "").toString().trim() ||
        (usersData?.name ?? "").toString().trim() ||
        (u.displayName ?? "").trim() ||
        u.email ||
        "(ללא שם)";

      const entries = dataA?.expenseLog?.entries ?? [];
      let firstMs = 0, lastMs = 0, last7 = 0, last7Sum = 0, last30 = 0, last30Sum = 0, monthSum = 0;
      const catMonth = new Map<string, number>();
      for (const e of entries) {
        const amt = Number(e?.amount) || 0;
        const t = e?.createdAt || (e?.date ? Date.parse(e.date) : 0) || 0;
        if (t) {
          if (!firstMs || t < firstMs) firstMs = t;
          if (t > lastMs) lastMs = t;
          if (t >= now - 7 * DAY) { last7++; last7Sum += amt; }
          if (t >= now - 30 * DAY) { last30++; last30Sum += amt; }
        }
        if (typeof e?.date === "string" && e.date.slice(0, 7) === ym) {
          monthSum += amt;
          const cat = (e.category ?? "ללא קטגוריה").trim() || "ללא קטגוריה";
          catMonth.set(cat, (catMonth.get(cat) ?? 0) + amt);
        }
      }

      const usersUpd = (usersData?.updatedAt as Timestamp | undefined)?.toDate()?.getTime() ?? 0;
      const mapsUpd = (mapsData?.updatedAt as Timestamp | undefined)?.toDate()?.getTime() ?? 0;

      return {
        uid: u.uid,
        email: u.email ?? "—",
        name,
        createdMs: u.metadata.creationTime ? Date.parse(u.metadata.creationTime) : 0,
        lastSignInMs: u.metadata.lastSignInTime ? Date.parse(u.metadata.lastSignInTime) : 0,
        stage,
        entriesCount: entries.length,
        firstMs, lastMs, last7, last7Sum, last30, last30Sum, monthSum,
        catMonth,
        entries,
        updatedMs: Math.max(usersUpd, mapsUpd),
        invited: activeLinkUids.has(u.uid),
      };
    }),
  );

  const C = clients.length;

  /* ---- aggregates ---- */

  // signups per month, last 12
  const signupMonths: { label: string; count: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const dt = new Date(d0.getFullYear(), d0.getMonth() - i, 1);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
    const next = new Date(d0.getFullYear(), d0.getMonth() - i + 1, 1).getTime();
    const count = perClient.filter((c) => c.createdMs >= dt.getTime() && c.createdMs < next).length;
    signupMonths.push({ label: `${String(dt.getMonth() + 1).padStart(2, "0")}/${String(dt.getFullYear()).slice(2)}`, count });
    void key;
  }
  const maxSignups = Math.max(1, ...signupMonths.map((m) => m.count));

  // stage distribution
  const stageCounts = new Map<number, number>();
  for (const c of perClient) stageCounts.set(c.stage, (stageCounts.get(c.stage) ?? 0) + 1);

  // expense entries per week, last 8 weeks
  const allEntryTimes: number[] = [];
  for (const c of perClient) {
    for (const e of c.entries) {
      const t = e?.createdAt || (e?.date ? Date.parse(e.date) : 0) || 0;
      if (t) allEntryTimes.push(t);
    }
  }
  const weeks: { label: string; count: number }[] = [];
  for (let i = 7; i >= 0; i--) {
    const start = now - (i + 1) * 7 * DAY;
    const end = now - i * 7 * DAY;
    const s = new Date(start);
    weeks.push({
      label: `${s.getDate()}.${s.getMonth() + 1}`,
      count: allEntryTimes.filter((t) => t >= start && t < end).length,
    });
  }
  const maxWeek = Math.max(1, ...weeks.map((w) => w.count));

  // spend by category this month (all clients)
  const catTotals = new Map<string, number>();
  for (const c of perClient) for (const [k, v] of c.catMonth) catTotals.set(k, (catTotals.get(k) ?? 0) + v);
  const catSorted = [...catTotals.entries()].sort((a, b) => b[1] - a[1]);
  const catTop = catSorted.slice(0, 8);
  const catRest = catSorted.slice(8).reduce((s, [, v]) => s + v, 0);
  const maxCat = Math.max(1, ...catTop.map(([, v]) => v));
  const monthTotalSpent = [...catTotals.values()].reduce((s, v) => s + v, 0);

  // sign-in freshness buckets
  const buckets = { w1: 0, m1: 0, q1: 0, older: 0, never: 0 };
  for (const c of perClient) {
    if (!c.lastSignInMs) buckets.never++;
    else if (c.lastSignInMs >= now - 7 * DAY) buckets.w1++;
    else if (c.lastSignInMs >= now - 30 * DAY) buckets.m1++;
    else if (c.lastSignInMs >= now - 90 * DAY) buckets.q1++;
    else buckets.older++;
  }

  // AARRR core numbers (same definitions as funnel-report)
  const newClientsThisMonth = perClient.filter((c) => c.createdMs >= monthStart).length;
  const newAdvisorsThisMonth = advisors.filter(
    (u) => u.metadata.creationTime && Date.parse(u.metadata.creationTime) >= monthStart,
  ).length;
  const mappedFully = perClient.filter((c) => c.stage >= 3).length;
  const everLogged = perClient.filter((c) => c.firstMs > 0);
  const activatedIn7 = everLogged.filter((c) => c.createdMs > 0 && c.firstMs - c.createdMs <= 7 * DAY).length;
  const loggedLast7 = perClient.filter((c) => c.lastMs >= now - 7 * DAY).length;
  const dormant = perClient.filter((c) => c.firstMs > 0 && c.lastMs < now - STALE_DAYS * DAY);
  const converted = activeLinks.filter((l) => l.invitedByUid).length;
  const invitesSent = converted + pendingInvites.length;
  const totalEntries = perClient.reduce((s, c) => s + c.entriesCount, 0);
  const last7Entries = perClient.reduce((s, c) => s + c.last7, 0);
  const last7Spent = perClient.reduce((s, c) => s + c.last7Sum, 0);
  const last30Entries = perClient.reduce((s, c) => s + c.last30, 0);
  const last30Spent = perClient.reduce((s, c) => s + c.last30Sum, 0);

  const loggers = perClient
    .filter((c) => c.entriesCount > 0)
    .sort((a, b) => b.lastMs - a.lastMs);

  const linkedRows = activeLinks.map((l) => {
    const c = perClient.find((p) => p.uid === l.id);
    const u = users.find((x) => x.uid === l.id);
    return {
      name: c?.name ?? u?.displayName ?? u?.email ?? l.id,
      stage: l.stage ?? "—",
      internal: advisorUids.has(l.id),
    };
  });

  const nowStr = new Date(now).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });

  /* ---- HTML ---- */

  const stageRows = [5, 4, 3, 2, 1, 0]
    .map((s) => {
      const count = stageCounts.get(s) ?? 0;
      return `<div class="brow"><span class="bl">שלב ${s} · ${esc(STAGE_LABELS[s])}</span>${bar((count / C) * 100)}<span class="bv">${count}</span></div>`;
    })
    .join("\n");

  const signupRows = signupMonths
    .map((m) => `<div class="brow"><span class="bl mono">${m.label}</span>${bar((m.count / maxSignups) * 100)}<span class="bv">${m.count}</span></div>`)
    .join("\n");

  const weekRows = weeks
    .map((w) => `<div class="brow"><span class="bl mono">שבוע ${w.label}</span>${bar((w.count / maxWeek) * 100)}<span class="bv">${w.count}</span></div>`)
    .join("\n");

  const catRows =
    catTop.map(([k, v]) => `<div class="brow"><span class="bl">${esc(k)}</span>${bar((v / maxCat) * 100)}<span class="bv">${ils(v)}</span></div>`).join("\n") +
    (catRest > 0 ? `\n<div class="brow"><span class="bl muted">שאר הקטגוריות</span>${bar((catRest / maxCat) * 100)}<span class="bv">${ils(catRest)}</span></div>` : "");

  const loggerRows = loggers
    .map(
      (c) => `<tr>
        <td>${esc(c.name)}<div class="sub">${esc(c.email)}</div></td>
        <td class="mono">${c.entriesCount}</td>
        <td class="mono">${c.last7}</td>
        <td class="mono">${c.monthSum ? ils(c.monthSum) : "—"}</td>
        <td>${daysAgoLabel(c.lastMs, now)}${c.firstMs > 0 && c.lastMs < now - STALE_DAYS * DAY ? ' <span class="tag warn">רדום</span>' : ""}</td>
      </tr>`,
    )
    .join("\n");

  const linkedRowsHtml = linkedRows
    .map((r) => `<tr><td>${esc(String(r.name))}${r.internal ? ' <span class="tag">בדיקה פנימית</span>' : ""}</td><td>${esc(String(r.stage))}</td></tr>`)
    .join("\n");

  const pendingHtml = pendingInvites.map((p) => `<li>${esc(p.email)}</li>`).join("\n") || "<li class='muted'>אין</li>";

  const allowHtml = [...allowSources.entries()].map(([s, n]) => `<span class="chip">${esc(s)}: <b>${n}</b></span>`).join(" ");

  const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>דוח נתונים מלא · The Home Economist</title>
<style>
  :root {
    --gold:#C9A86C; --gold-light:#E0C896; --surface:#0F0F0F; --surface2:#1A1A1A;
    --surface3:#242424; --line:#2A2A2A; --txt:#F0EDEA; --muted:#8A8178;
    --good:#4ADE80; --warn:#F87171;
  }
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  html,body{background:var(--surface);color:var(--txt);font-family:'Segoe UI','Rubik',Arial,sans-serif;-webkit-font-smoothing:antialiased}
  body{padding:32px 16px 64px;line-height:1.65}
  .wrap{max-width:880px;margin:0 auto;display:flex;flex-direction:column;gap:28px}
  h1{font-size:26px;font-weight:650;letter-spacing:-0.01em}
  h1 .accent{color:var(--gold)}
  h2{font-size:17px;font-weight:650;margin-bottom:2px}
  .subtitle{color:var(--muted);font-size:13px;margin-top:4px}
  .card{background:var(--surface2);border:1px solid var(--line);border-radius:12px;padding:18px 20px;display:flex;flex-direction:column;gap:10px}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
  .kpi{background:var(--surface2);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
  .kpi .v{font-size:26px;font-weight:700;color:var(--gold);font-variant-numeric:tabular-nums;line-height:1.15}
  .kpi .v small{font-size:14px;color:var(--muted);font-weight:500}
  .kpi .l{font-size:12px;color:var(--muted);margin-top:4px;line-height:1.45}
  .brow{display:grid;grid-template-columns:200px 1fr 88px;gap:10px;align-items:center}
  .bl{font-size:13px}
  .bv{font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums;text-align:left;direction:ltr;white-space:nowrap}
  .track{background:var(--surface3);border-radius:4px;height:13px}
  .fill{background:var(--gold);border-radius:4px;height:13px;min-width:2px}
  .mono{font-variant-numeric:tabular-nums}
  .muted{color:var(--muted)}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{text-align:right;padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
  tr:last-child td{border-bottom:none}
  th{color:var(--muted);font-size:11px;font-weight:600;white-space:nowrap}
  td .sub{color:var(--muted);font-size:11px}
  .tablewrap{overflow-x:auto}
  .tag{display:inline-block;background:rgba(201,168,108,0.15);color:var(--gold);font-size:10px;padding:1px 7px;border-radius:999px;vertical-align:middle}
  .tag.warn{background:rgba(248,113,113,0.13);color:var(--warn)}
  .chip{display:inline-block;background:var(--surface3);border:1px solid var(--line);border-radius:999px;padding:3px 11px;font-size:12px;color:var(--muted);margin:2px 0}
  .chip b{color:var(--txt)}
  .note{color:var(--muted);font-size:12px;line-height:1.6}
  ul{padding-inline-start:20px;font-size:13px}
  .aarrr{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
  @media(max-width:640px){ .brow{grid-template-columns:1fr;gap:3px} .bv{text-align:right;direction:rtl} h1{font-size:21px} }
</style>
</head>
<body>
<div class="wrap">

  <header>
    <h1>דוח נתונים מלא <span class="accent">· The Home Economist</span></h1>
    <div class="subtitle">הופק ${esc(nowStr)} · קריאה בלבד מ-Firebase · נתוני דמו מסוננים · הקובץ מקומי ולא נכנס ל-git · להרצה מחדש: npm run report:data</div>
  </header>

  <div class="kpis">
    <div class="kpi"><div class="v">${users.length}</div><div class="l">משתמשים רשומים (${advisors.length} יועצים + ${C} לקוחות)</div></div>
    <div class="kpi"><div class="v">${newClientsThisMonth}</div><div class="l">לקוחות חדשים החודש (${monthLabel})</div></div>
    <div class="kpi"><div class="v">${mappedFully}<small> · ${pct(mappedFully, C)}</small></div><div class="l">הגיעו למיפוי מלא (שלב 3+)</div></div>
    <div class="kpi"><div class="v">${everLogged.length}<small> · ${pct(everLogged.length, C)}</small></div><div class="l">תיעדו הוצאה אי-פעם</div></div>
    <div class="kpi"><div class="v">${loggedLast7}</div><div class="l">תיעדו ב-7 הימים האחרונים</div></div>
    <div class="kpi"><div class="v">${ils(monthTotalSpent)}</div><div class="l">סך הוצאות שתועדו החודש, כל הלקוחות</div></div>
  </div>

  <div class="card">
    <h2>משפך ה-AARRR בקצרה</h2>
    <div class="aarrr">
      <div class="kpi"><div class="v">${newClientsThisMonth}</div><div class="l">גיוס: לקוחות חדשים החודש (יועצים: ${newAdvisorsThisMonth}, דרך הזמנה במערכת: 0)</div></div>
      <div class="kpi"><div class="v">${pct(mappedFully, C)}</div><div class="l">הפעלה: מיפוי מלא · הוצאה ראשונה תוך 7 ימים: ${activatedIn7} מתוך ${everLogged.length}</div></div>
      <div class="kpi"><div class="v">${pct(loggedLast7, everLogged.length)}</div><div class="l">שימור: פעילים שבועית מבין המתעדים (${loggedLast7} מתוך ${everLogged.length}) · רדומים: ${dormant.length}</div></div>
      <div class="kpi"><div class="v">0</div><div class="l">הכנסה: יועצים משלמים · קישורים פעילים: ${activeLinks.length} (בדיקות: ${internalTestLinks}, דמו סונן: ${demoOrOrphanLinks}) · פוטנציאל: ${ils(activeLinks.length * PRICE_PER_CLIENT_YEAR)}</div></div>
      <div class="kpi"><div class="v">${invitesSent ? pct(converted, invitesSent) : "—"}</div><div class="l">הפניה: המרת הזמנות (${converted} מתוך ${invitesSent}) · ממתינות: ${pendingInvites.length}</div></div>
    </div>
  </div>

  <div class="card">
    <h2>הרשמות לקוחות, 12 חודשים אחרונים</h2>
    ${signupRows}
  </div>

  <div class="card">
    <h2>פילוח לקוחות לפי שלב (0-5)</h2>
    ${stageRows}
    <p class="note">השלב נגזר מהנתונים בפועל: מה הלקוח כבר עשה במערכת (ישן + חדש), אותו סולם כמו רשימת הלקוחות.</p>
  </div>

  <div class="card">
    <h2>פעילות תיעוד הוצאות</h2>
    <div class="kpis">
      <div class="kpi"><div class="v">${totalEntries.toLocaleString("he-IL")}</div><div class="l">רשומות הוצאה סה"כ, כל הזמנים</div></div>
      <div class="kpi"><div class="v">${last7Entries}</div><div class="l">רשומות ב-7 ימים (${ils(last7Spent)})</div></div>
      <div class="kpi"><div class="v">${last30Entries}</div><div class="l">רשומות ב-30 יום (${ils(last30Spent)})</div></div>
    </div>
    <h2 style="margin-top:8px">רשומות לפי שבוע, 8 שבועות אחרונים</h2>
    ${weekRows}
  </div>

  <div class="card">
    <h2>הוצאות החודש לפי קטגוריה (${monthLabel}, כל הלקוחות)</h2>
    ${catRows || '<p class="muted">אין הוצאות מתועדות החודש.</p>'}
  </div>

  <div class="card">
    <h2>המתעדים (${loggers.length} לקוחות)</h2>
    <div class="tablewrap">
      <table>
        <thead><tr><th>לקוח</th><th>רשומות</th><th>השבוע</th><th>הוצאות החודש</th><th>תיעוד אחרון</th></tr></thead>
        <tbody>${loggerRows || '<tr><td colspan="5" class="muted">אין עדיין מתעדים</td></tr>'}</tbody>
      </table>
    </div>
    <p class="note">רדום = תיעד בעבר ולא תיעד ${STALE_DAYS}+ ימים (אותה הגדרה כמו בדשבורד ובדוח השבועי).</p>
  </div>

  <div class="card">
    <h2>טריות התחברות (כל ${C} הלקוחות)</h2>
    <div class="brow"><span class="bl">התחברו ב-7 הימים האחרונים</span>${bar((buckets.w1 / C) * 100)}<span class="bv">${buckets.w1}</span></div>
    <div class="brow"><span class="bl">לפני 8-30 ימים</span>${bar((buckets.m1 / C) * 100)}<span class="bv">${buckets.m1}</span></div>
    <div class="brow"><span class="bl">לפני 31-90 ימים</span>${bar((buckets.q1 / C) * 100)}<span class="bv">${buckets.q1}</span></div>
    <div class="brow"><span class="bl">לפני יותר מ-90 ימים</span>${bar((buckets.older / C) * 100)}<span class="bv">${buckets.older}</span></div>
    <div class="brow"><span class="bl">מעולם לא התחברו</span>${bar((buckets.never / C) * 100)}<span class="bv">${buckets.never}</span></div>
  </div>

  <div class="card">
    <h2>צד היועץ: קישורים והזמנות</h2>
    <div class="tablewrap">
      <table>
        <thead><tr><th>לקוח מקושר (פעיל)</th><th>שלב ליווי</th></tr></thead>
        <tbody>${linkedRowsHtml || '<tr><td colspan="2" class="muted">אין קישורים פעילים</td></tr>'}</tbody>
      </table>
    </div>
    <p class="note">קישורי דמו/רפאים שסוננו: ${demoOrOrphanLinks} · הזמנות שממתינות:</p>
    <ul>${pendingHtml}</ul>
  </div>

  <div class="card">
    <h2>allowlist: מי מורשה להיכנס, לפי מקור</h2>
    <div>${allowHtml}</div>
  </div>

  <p class="note">מקורות: Firebase Auth (הרשמה/התחברות), אוספי advisors, clientLinks, allowlist, users/{uid}.data (כולל יומן הוצאות), maps/{uid}.data. הדוח לא משנה שום נתון. הקובץ מכיל שמות ופרטי לקוחות, ולכן נשאר מקומי בלבד (מוחרג מ-git) ואסור לפרסם אותו.</p>

</div>
</body>
</html>`;

  writeFileSync(OUT_HTML, html);
  console.log(`✅ נכתב: ${OUT_HTML}`);
  console.log(
    `   ${C} לקוחות · ${totalEntries} רשומות הוצאה · ${loggers.length} מתעדים · ${dormant.length} רדומים · ${activeLinks.length} קישורים פעילים`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
