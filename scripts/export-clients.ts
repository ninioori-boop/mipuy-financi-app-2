/**
 * Export users list from Firebase Auth + Firestore → clients.md
 *
 * Lists every account in Firebase Auth (all signed-up users), then for each
 * one tries to derive their progress stage from Firestore data living at
 * either `users/{uid}.data` (solo users) or `maps/{uid}.data` (advisor-managed clients).
 *
 * Usage:
 *   1. Save Service Account JSON at project root as `service-account-key.json` (gitignored).
 *      https://console.firebase.google.com/project/finance-machine-a36e9/settings/serviceaccounts/adminsdk
 *   2. Run: npm run export:clients
 *      Output: clients.md (gitignored) in project root.
 */

import { cert, initializeApp } from "firebase-admin/app";
import { getAuth, type UserRecord } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const KEY_PATH = resolve(process.cwd(), "service-account-key.json");
const OUTPUT_PATH = resolve(process.cwd(), "clients.md");
const OUTPUT_HTML_PATH = resolve(process.cwd(), "clients.html");

const STAGE_COLORS: Record<number, { bg: string; fg: string; label: string }> = {
  0: { bg: "rgba(138,129,120,0.15)", fg: "#8A8178", label: "נרשם, אין נתונים" },
  1: { bg: "rgba(96,165,250,0.15)", fg: "#60A5FA", label: "מיפוי התחיל" },
  2: { bg: "rgba(34,211,238,0.15)", fg: "#22D3EE", label: "אשראי נטען" },
  3: { bg: "rgba(167,139,250,0.18)", fg: "#A78BFA", label: "מיפוי ידני הושלם" },
  4: { bg: "rgba(201,168,108,0.20)", fg: "#E0C896", label: "תכנון חודשי פעיל" },
  5: { bg: "rgba(74,222,128,0.18)", fg: "#4ADE80", label: "תכנון שנתי הושלם" },
};

type ClientRow = { name?: string; plan?: string; actual?: string; monthly?: string };
type ManualBucket = ClientRow[] | undefined;

type MapData = {
  meta?: { name?: string; advisor?: string; phone?: string; notes?: string };
  manual?: {
    income?: ManualBucket;
    fixed?: ManualBucket;
    variable?: ManualBucket;
    subs?: ManualBucket;
    insurance?: ManualBucket;
    annual?: ManualBucket;
    debts?: ManualBucket;
    assets?: ManualBucket;
  };
  monthly?: Record<string, Record<string, ClientRow[] | string | undefined>>;
  annual?: {
    income?: ClientRow[];
    fixed?: ClientRow[];
    var?: ClientRow[];
    sub?: ClientRow[];
    debt?: ClientRow[];
    sav?: ClientRow[];
  };
  credit?: {
    transactions?: unknown[];
    autoRows?: Record<string, number>;
  };
};

const STAGE_LABELS: Record<number, string> = {
  0: "0 — נרשם, אין נתונים",
  1: "1 — מיפוי התחיל",
  2: "2 — אשראי נטען",
  3: "3 — מיפוי ידני הושלם",
  4: "4 — תכנון חודשי פעיל",
  5: "5 — תכנון שנתי הושלם",
};

const NEXT_ACTION: Record<number, string> = {
  0: "לפנות, להבין צורך",
  1: "להעלות דוח אשראי",
  2: "להשלים מיפוי ידני (קטגוריזציה)",
  3: "לבנות תכנון חודשי",
  4: "להשלים תכנון שנתי",
  5: "מעקב שוטף — לקבוע פגישה הבאה",
};

function hasRows(bucket: ManualBucket): boolean {
  return Array.isArray(bucket) && bucket.some((r) => (r?.name ?? "").trim() !== "");
}

/**
 * Stage derivation for the OLD system (orimipuy.com / client.js serialization):
 * `meta` + `manual` + flat `monthly[monthId]` + `annual.var/sav` + `credit.transactions`.
 */
function deriveStageOld(data: MapData | undefined): number {
  if (!data) return 0;

  const annual = data.annual;
  if (
    annual &&
    [annual.income, annual.fixed, annual.var, annual.sub, annual.debt, annual.sav].some(
      (b) => Array.isArray(b) && b.some((r) => (r?.name ?? "").trim() !== ""),
    )
  ) {
    return 5;
  }

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
  if (
    hasRows(manual.income) ||
    hasRows(manual.fixed) ||
    hasRows(manual.variable) ||
    hasRows(manual.subs) ||
    hasRows(manual.insurance) ||
    hasRows(manual.debts)
  ) {
    return 3;
  }

  const credit = data.credit ?? {};
  if (
    (Array.isArray(credit.transactions) && credit.transactions.length > 0) ||
    (credit.autoRows && Object.keys(credit.autoRows).length > 0)
  ) {
    return 2;
  }

  // If any meta exists (name/phone/notes filled in), they at least started
  const meta = data.meta;
  if (meta && [meta.name, meta.phone, meta.notes].some((v) => (v ?? "").trim() !== "")) {
    return 1;
  }

  return 0;
}

/**
 * Snapshot shape produced by the NEW app (this project — src/lib/dataSync.ts).
 * Different keys from the old format: `mapping` (not `manual`), nested
 * `monthly.months`, `annual.variable/savings` (not `var/sav`), and `credit`
 * holds only learnedDB/reportMonths (no `transactions`).
 */
type NewSnapshot = {
  version?: number;
  monthly?: { months?: Record<string, Record<string, ClientRow[] | undefined>> };
  annual?: {
    income?: ClientRow[]; fixed?: ClientRow[]; variable?: ClientRow[];
    sub?: ClientRow[]; savings?: ClientRow[]; debt?: ClientRow[];
  };
  mapping?: {
    income?: ClientRow[]; fixed?: ClientRow[]; sub?: ClientRow[]; ins?: ClientRow[];
    variable?: ClientRow[]; annual?: ClientRow[]; debts?: ClientRow[];
    installments?: ClientRow[]; savings?: ClientRow[];
    creditImported?: boolean;
  };
  goals?: { short?: ClientRow[]; medium?: ClientRow[]; long?: ClientRow[] };
  credit?: { learnedDB?: Record<string, string>; reportMonths?: number };
  meetings?: { meetings?: unknown[] };
  business?: { revenue?: ClientRow[]; cogs?: ClientRow[]; opex?: ClientRow[] };
};

/**
 * Stage derivation for the NEW app. Same 0–5 scale as the old one so the two
 * systems share one dashboard. Stage 2 ("אשראי נטען") maps to the new flow via
 * `mapping.creditImported` / a non-empty learnedDB, since credit transactions
 * are ephemeral and never persisted.
 */
function deriveStageNew(data: NewSnapshot | undefined): number {
  if (!data) return 0;

  const annual = data.annual;
  if (
    annual &&
    [annual.income, annual.fixed, annual.variable, annual.sub, annual.savings, annual.debt].some(
      (b) => hasRows(b),
    )
  ) {
    return 5;
  }

  const months = data.monthly?.months ?? {};
  const MONTH_SECTIONS = ["income", "fixed", "variable", "sub", "ins", "installments", "debts", "savings"];
  const monthlyHasRows = Object.values(months).some((m) => {
    if (!m || typeof m !== "object") return false;
    return MONTH_SECTIONS.some((sec) => hasRows((m as Record<string, ClientRow[] | undefined>)[sec]));
  });
  if (monthlyHasRows) return 4;

  const mapping = data.mapping ?? {};
  if (
    [
      mapping.income, mapping.fixed, mapping.variable, mapping.sub, mapping.ins,
      mapping.annual, mapping.debts, mapping.installments, mapping.savings,
    ].some((b) => hasRows(b))
  ) {
    return 3;
  }

  if (
    mapping.creditImported === true ||
    (data.credit?.learnedDB && Object.keys(data.credit.learnedDB).length > 0)
  ) {
    return 2;
  }

  const goals = data.goals ?? {};
  const hasGoals = [goals.short, goals.medium, goals.long].some((b) => hasRows(b));
  const hasMeetings = Array.isArray(data.meetings?.meetings) && data.meetings.meetings.length > 0;
  const business = data.business ?? {};
  const hasBusiness = [business.revenue, business.cogs, business.opex].some((b) => hasRows(b));
  if (hasGoals || hasMeetings || hasBusiness) return 1;

  return 0;
}

/** True if the Firestore `data` blob is the new app's snapshot, not the old format. */
function isNewSnapshot(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.version === "number" ||
    (typeof d.mapping === "object" && d.mapping !== null) ||
    (typeof d.monthly === "object" && d.monthly !== null && "months" in (d.monthly as object))
  );
}

/** Dispatch to the right derivation based on the document's serialization format. */
function deriveStage(data: MapData | undefined): number {
  if (isNewSnapshot(data)) return deriveStageNew(data as unknown as NewSnapshot);
  return deriveStageOld(data);
}

function formatRelative(date: Date | undefined): { iso: string; rel: string } {
  if (!date || isNaN(date.getTime())) return { iso: "—", rel: "—" };
  const iso = date.toISOString().slice(0, 10);
  const diffMs = Date.now() - date.getTime();
  const days = Math.floor(diffMs / 86_400_000);
  let rel: string;
  if (days <= 0) rel = "היום";
  else if (days === 1) rel = "אתמול";
  else if (days < 7) rel = `לפני ${days} ימים`;
  else if (days < 30) rel = `לפני ${Math.floor(days / 7)} שבועות`;
  else if (days < 365) rel = `לפני ${Math.floor(days / 30)} חודשים`;
  else rel = `לפני ${Math.floor(days / 365)} שנים`;
  return { iso, rel };
}

function escapeCell(s: string | undefined): string {
  return (s ?? "—").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function escapeHtml(s: string | undefined): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type Row = {
  uid: string;
  email: string;
  name: string;
  phone: string;
  notes: string;
  stage: number;
  stageLabel: string;
  nextAction: string;
  dataUpdatedIso: string;
  dataUpdatedRel: string;
  dataUpdatedMs: number;
  lastSignInIso: string;
  lastSignInRel: string;
  createdIso: string;
  disabled: boolean;
};

function generateHtml(rows: Row[], now: string, stageCounts: Record<number, number>): string {
  const cards = [5, 4, 3, 2, 1, 0]
    .map((s) => {
      const color = STAGE_COLORS[s];
      const count = stageCounts[s] ?? 0;
      return `<button class="stat-card" data-filter-stage="${s}" style="--card-fg:${color.fg};--card-bg:${color.bg}">
        <div class="stat-count">${count}</div>
        <div class="stat-label">שלב ${s} · ${escapeHtml(color.label)}</div>
      </button>`;
    })
    .join("");

  const tbody = rows
    .map((r) => {
      const color = STAGE_COLORS[r.stage];
      const initials = r.name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0])
        .join("")
        .toUpperCase() || "?";
      const phoneCell =
        r.phone && r.phone !== "—"
          ? `<a href="tel:${escapeHtml(r.phone)}">${escapeHtml(r.phone)}</a>`
          : `<span class="muted">—</span>`;
      const emailCell =
        r.email && r.email !== "—"
          ? `<a href="mailto:${escapeHtml(r.email)}">${escapeHtml(r.email)}</a>`
          : `<span class="muted">—</span>`;
      return `<tr data-stage="${r.stage}" data-search="${escapeHtml((r.name + " " + r.email + " " + r.phone).toLowerCase())}">
        <td class="name-cell">
          <div class="avatar">${escapeHtml(initials)}</div>
          <div class="name-inner">
            <div class="name-main">${escapeHtml(r.name)}${r.disabled ? ' <span class="disabled-tag">disabled</span>' : ""}</div>
            <div class="name-sub">${emailCell}</div>
          </div>
        </td>
        <td><span class="stage-badge" style="--badge-fg:${color.fg};--badge-bg:${color.bg}">שלב ${r.stage}<span class="stage-text"> · ${escapeHtml(color.label)}</span></span></td>
        <td class="next-action">${escapeHtml(r.nextAction)}</td>
        <td>${phoneCell}</td>
        <td><div class="rel">${escapeHtml(r.dataUpdatedRel)}</div><div class="iso">${escapeHtml(r.dataUpdatedIso)}</div></td>
        <td><div class="rel">${escapeHtml(r.lastSignInRel)}</div><div class="iso">${escapeHtml(r.lastSignInIso)}</div></td>
      </tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="refresh" content="900">
  <title>רשימת לקוחות · The Home Economist</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Rubik:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --gold:#C9A86C; --gold-light:#E0C896; --gold-dark:#A88844;
      --surface:#0F0F0F; --surface2:#1A1A1A; --surface3:#242424;
      --line:#2A2A2A; --txt:#F0EDEA; --muted:#8A8178;
    }
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    html,body{background:var(--surface);color:var(--txt);font-family:'Rubik','Segoe UI',Arial,sans-serif;min-height:100vh;-webkit-font-smoothing:antialiased}
    body{padding:32px 20px 64px}
    .container{max-width:1280px;margin:0 auto}
    header{margin-bottom:32px}
    h1{font-size:28px;font-weight:600;letter-spacing:-0.02em}
    h1 .accent{color:var(--gold)}
    .subtitle{color:var(--muted);font-size:14px;margin-top:6px}
    .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:24px 0 28px}
    .stat-card{cursor:pointer;text-align:right;background:var(--surface2);border:1px solid var(--line);border-radius:12px;padding:16px;transition:transform 0.15s,border-color 0.15s;font-family:inherit;color:inherit}
    .stat-card:hover{transform:translateY(-2px);border-color:var(--card-fg)}
    .stat-card.active{background:var(--card-bg);border-color:var(--card-fg)}
    .stat-count{font-size:32px;font-weight:700;color:var(--card-fg);line-height:1}
    .stat-label{font-size:12px;color:var(--muted);margin-top:6px}
    .toolbar{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:16px}
    .search{flex:1;min-width:220px;background:var(--surface2);border:1px solid var(--line);color:var(--txt);padding:10px 14px;border-radius:10px;font-family:inherit;font-size:14px;outline:none}
    .search:focus{border-color:var(--gold)}
    .clear-btn{background:transparent;border:1px solid var(--line);color:var(--muted);padding:10px 16px;border-radius:10px;cursor:pointer;font-family:inherit;font-size:13px}
    .clear-btn:hover{color:var(--txt);border-color:var(--gold)}
    .table-wrap{background:var(--surface2);border:1px solid var(--line);border-radius:14px;overflow:hidden}
    table{width:100%;border-collapse:collapse}
    thead th{background:var(--surface3);color:var(--muted);font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.08em;padding:14px 16px;text-align:right;border-bottom:1px solid var(--line)}
    tbody td{padding:14px 16px;border-bottom:1px solid var(--line);font-size:14px;vertical-align:middle}
    tbody tr:last-child td{border-bottom:none}
    tbody tr{transition:background 0.1s}
    tbody tr:hover{background:rgba(201,168,108,0.04)}
    .name-cell{display:flex;align-items:center;gap:12px;min-width:240px}
    .avatar{width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,var(--gold-dark),var(--gold));color:var(--surface);display:flex;align-items:center;justify-content:center;font-weight:600;font-size:13px;flex-shrink:0}
    .name-inner{display:flex;flex-direction:column;gap:2px;min-width:0}
    .name-main{font-weight:500;color:var(--txt)}
    .name-sub{font-size:12px;color:var(--muted)}
    .name-sub a{color:var(--muted);text-decoration:none}
    .name-sub a:hover{color:var(--gold)}
    .disabled-tag{display:inline-block;background:rgba(248,113,113,0.15);color:#F87171;font-size:10px;padding:2px 6px;border-radius:4px;margin-inline-start:6px;vertical-align:middle}
    .stage-badge{display:inline-flex;align-items:center;gap:6px;background:var(--badge-bg);color:var(--badge-fg);padding:6px 10px;border-radius:8px;font-size:12px;font-weight:500;white-space:nowrap}
    .stage-text{color:var(--muted);font-weight:400}
    .next-action{color:var(--txt);font-size:13px}
    .rel{font-size:13px;color:var(--txt)}
    .iso{font-size:11px;color:var(--muted);margin-top:2px}
    .muted{color:var(--muted)}
    a{color:var(--gold);text-decoration:none}
    a:hover{color:var(--gold-light)}
    .empty{padding:48px 24px;text-align:center;color:var(--muted)}
    @media (max-width:768px){
      body{padding:20px 12px 48px}
      h1{font-size:22px}
      .stat-count{font-size:24px}
      thead th{font-size:10px;padding:10px 12px}
      tbody td{padding:12px;font-size:13px}
      .stage-text{display:none}
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>רשימת לקוחות <span class="accent">· The Home Economist</span></h1>
      <div class="subtitle">${escapeHtml(now)} · ${rows.length} משתמשים רשומים · רענון אוטומטי כל 15 דקות</div>
    </header>

    <div class="stats">
      ${cards}
    </div>

    <div class="toolbar">
      <input class="search" type="search" placeholder="חיפוש לפי שם, אימייל או טלפון…">
      <button class="clear-btn" id="clear-filter">נקה סינון</button>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>לקוח</th>
            <th>שלב</th>
            <th>פעולה הבאה</th>
            <th>טלפון</th>
            <th>עדכון נתונים</th>
            <th>התחברות אחרונה</th>
          </tr>
        </thead>
        <tbody>
          ${tbody}
        </tbody>
      </table>
      <div class="empty" id="empty-state" style="display:none">לא נמצאו תוצאות</div>
    </div>
  </div>

  <script>
    (function(){
      var search = document.querySelector('.search');
      var rows = Array.from(document.querySelectorAll('tbody tr'));
      var cards = Array.from(document.querySelectorAll('.stat-card'));
      var clearBtn = document.getElementById('clear-filter');
      var empty = document.getElementById('empty-state');
      var activeStage = null;
      var query = '';

      function apply(){
        var visible = 0;
        rows.forEach(function(r){
          var matchStage = activeStage === null || r.dataset.stage === activeStage;
          var matchQuery = !query || r.dataset.search.indexOf(query) !== -1;
          var show = matchStage && matchQuery;
          r.style.display = show ? '' : 'none';
          if (show) visible++;
        });
        empty.style.display = visible === 0 ? 'block' : 'none';
      }

      cards.forEach(function(c){
        c.addEventListener('click', function(){
          var s = c.dataset.filterStage;
          if (activeStage === s){
            activeStage = null;
            cards.forEach(function(x){x.classList.remove('active')});
          } else {
            activeStage = s;
            cards.forEach(function(x){x.classList.toggle('active', x === c)});
          }
          apply();
        });
      });

      search.addEventListener('input', function(){
        query = search.value.trim().toLowerCase();
        apply();
      });

      clearBtn.addEventListener('click', function(){
        activeStage = null;
        query = '';
        search.value = '';
        cards.forEach(function(x){x.classList.remove('active')});
        apply();
      });
    })();
  </script>
</body>
</html>`;
}

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

async function main() {
  let keyJson: string;
  try {
    keyJson = readFileSync(KEY_PATH, "utf8");
  } catch {
    console.error(
      `\n❌ לא נמצא service-account-key.json בנתיב:\n   ${KEY_PATH}\n\n` +
        `הוראות:\n` +
        `  1. Firebase Console: https://console.firebase.google.com/project/finance-machine-a36e9/settings/serviceaccounts/adminsdk\n` +
        `  2. "Generate new private key" → "Generate key"\n` +
        `  3. שמור בשם service-account-key.json בשורש הפרויקט.\n`,
    );
    process.exit(1);
  }

  initializeApp({ credential: cert(JSON.parse(keyJson)) });
  const db = getFirestore();

  console.log("🔍 שולף את כל המשתמשים מ-Firebase Auth…");
  const users = await listAllAuthUsers();
  console.log(`   נמצאו ${users.length} משתמשים.`);

  console.log("📥 שולף נתוני Firestore לכל משתמש…");
  const rows = await Promise.all(
    users.map(async (u) => {
      const [usersDoc, mapsDoc] = await Promise.all([
        db.collection("users").doc(u.uid).get(),
        db.collection("maps").doc(u.uid).get(),
      ]);

      const usersData = usersDoc.exists ? usersDoc.data() : null;
      const mapsData = mapsDoc.exists ? mapsDoc.data() : null;

      // Solo users save under users/{uid}.data; advisor-managed clients under maps/{uid}.data
      const dataA = (usersData?.data as MapData | undefined) ?? undefined;
      const dataB = (mapsData?.data as MapData | undefined) ?? undefined;
      const stageA = deriveStage(dataA);
      const stageB = deriveStage(dataB);
      const stage = Math.max(stageA, stageB);
      const data = stageA >= stageB ? dataA : dataB;

      const usersUpdatedAt = (usersData?.updatedAt as Timestamp | undefined)?.toDate();
      const mapsUpdatedAt = (mapsData?.updatedAt as Timestamp | undefined)?.toDate();
      const dataUpdatedAt =
        usersUpdatedAt && mapsUpdatedAt
          ? usersUpdatedAt > mapsUpdatedAt
            ? usersUpdatedAt
            : mapsUpdatedAt
          : (usersUpdatedAt ?? mapsUpdatedAt);

      const lastSignIn = u.metadata.lastSignInTime ? new Date(u.metadata.lastSignInTime) : undefined;
      const createdAt = u.metadata.creationTime ? new Date(u.metadata.creationTime) : undefined;

      const displayName =
        data?.meta?.name?.trim() ||
        mapsData?.clientName?.toString().trim() ||
        usersData?.name?.toString().trim() ||
        u.displayName?.trim() ||
        "(ללא שם)";

      const phone =
        data?.meta?.phone?.trim() || u.phoneNumber?.trim() || "—";

      const notes = data?.meta?.notes?.trim() || "";

      const updated = formatRelative(dataUpdatedAt);
      const signIn = formatRelative(lastSignIn);
      const created = formatRelative(createdAt);

      return {
        uid: u.uid,
        email: u.email ?? "—",
        name: displayName,
        phone,
        notes,
        stage,
        stageLabel: STAGE_LABELS[stage],
        nextAction: NEXT_ACTION[stage],
        dataUpdatedIso: updated.iso,
        dataUpdatedRel: updated.rel,
        dataUpdatedMs: dataUpdatedAt ? dataUpdatedAt.getTime() : 0,
        lastSignInIso: signIn.iso,
        lastSignInRel: signIn.rel,
        createdIso: created.iso,
        disabled: u.disabled,
      };
    }),
  );

  rows.sort((a, b) => b.stage - a.stage || b.dataUpdatedMs - a.dataUpdatedMs);

  const now = new Date().toISOString().replace("T", " ").slice(0, 16);
  const stageCounts = rows.reduce<Record<number, number>>((acc, r) => {
    acc[r.stage] = (acc[r.stage] ?? 0) + 1;
    return acc;
  }, {});

  const lines: string[] = [];
  lines.push(`# רשימת לקוחות — The Home Economist`);
  lines.push("");
  lines.push(`_מעודכן: ${now} · ${rows.length} משתמשים רשומים_`);
  lines.push("");
  lines.push(`## פילוח לפי שלב`);
  lines.push("");
  for (let s = 5; s >= 0; s--) {
    const count = stageCounts[s] ?? 0;
    if (count > 0) lines.push(`- **${STAGE_LABELS[s]}** — ${count}`);
  }
  lines.push("");
  lines.push(`## סיכום מהיר`);
  lines.push("");
  lines.push(`| לקוח | אימייל | שלב | פעולה הבאה | עדכון אחרון | התחברות אחרונה |`);
  lines.push(`|------|--------|-----|------------|-------------|------------------|`);
  for (const r of rows) {
    lines.push(
      `| ${escapeCell(r.name)} | ${escapeCell(r.email)} | ${escapeCell(r.stageLabel)} | ${escapeCell(r.nextAction)} | ${escapeCell(r.dataUpdatedRel)} | ${escapeCell(r.lastSignInRel)} |`,
    );
  }
  lines.push("");
  lines.push(`---`);
  lines.push("");
  lines.push(`## פירוט מלא`);
  lines.push("");
  for (const r of rows) {
    lines.push(`### ${r.name}${r.disabled ? " 🚫 _(disabled)_" : ""}`);
    lines.push(`- **אימייל:** ${r.email}`);
    lines.push(`- **שלב:** ${r.stageLabel}`);
    lines.push(`- **פעולה הבאה:** ${r.nextAction}`);
    lines.push(`- **טלפון:** ${r.phone}`);
    lines.push(`- **עדכון נתונים אחרון:** ${r.dataUpdatedIso} (${r.dataUpdatedRel})`);
    lines.push(`- **התחברות אחרונה:** ${r.lastSignInIso} (${r.lastSignInRel})`);
    lines.push(`- **נרשם:** ${r.createdIso}`);
    if (r.notes) lines.push(`- **הערות:** ${r.notes}`);
    lines.push(`- **UID:** \`${r.uid}\``);
    lines.push("");
  }

  writeFileSync(OUTPUT_PATH, lines.join("\n"));
  writeFileSync(OUTPUT_HTML_PATH, generateHtml(rows, now, stageCounts));
  console.log(`✅ נכתבו ${rows.length} משתמשים:`);
  console.log(`   📄 ${OUTPUT_PATH}`);
  console.log(`   🌐 ${OUTPUT_HTML_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
