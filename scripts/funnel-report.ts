/**
 * AARRR funnel report — the pirate metrics computed from live Firebase (READ-ONLY).
 *
 * Acquisition / Activation / Retention / Revenue / Referral, derived from:
 *   - Firebase Auth (creationTime / lastSignInTime — the only true signup source)
 *   - advisors, clientLinks, allowlist collections
 *   - users/{uid}.data + maps/{uid}.data (stage derivation + expenseLog)
 *
 * Usage:
 *   1. service-account-key.json at project root (same key as export-clients).
 *   2. npx tsx scripts/funnel-report.ts
 *   Output: funnel-report.md + funnel-report.json (both gitignored) + console.
 */

import { cert, initializeApp } from "firebase-admin/app";
import { getAuth, type UserRecord } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const KEY_PATH = resolve(process.cwd(), "service-account-key.json");
const OUT_MD = resolve(process.cwd(), "funnel-report.md");
const OUT_JSON = resolve(process.cwd(), "funnel-report.json");

const DAY = 86_400_000;
const STALE_DAYS = 5; // mirrors TRACKING_STALE_DAYS in src/lib/advisorMock.ts
const ACTIVATION_WINDOW_DAYS = 7;
const PRICE_PER_CLIENT_YEAR = 240; // ₪, hatzaa-saas-lakoach

/* ---------------------------------------------------------------- *
 * Stage derivation — copied from scripts/export-clients.ts so this
 * script stays self-contained (export-clients runs main() on import).
 * Same 0-5 scale: 2 = credit loaded, 3 = manual mapping complete.
 * ---------------------------------------------------------------- */

type ClientRow = { name?: string };
type ManualBucket = ClientRow[] | undefined;

type MapData = {
  meta?: { name?: string; phone?: string; notes?: string };
  manual?: Record<string, ManualBucket>;
  monthly?: Record<string, Record<string, ClientRow[] | string | undefined>>;
  annual?: Record<string, ClientRow[] | undefined>;
  credit?: { transactions?: unknown[]; autoRows?: Record<string, number> };
};

type NewSnapshot = {
  version?: number;
  monthly?: { months?: Record<string, Record<string, ClientRow[] | undefined>> };
  annual?: Record<string, ClientRow[] | undefined>;
  mapping?: Record<string, ClientRow[] | boolean | undefined> & { creditImported?: boolean };
  goals?: Record<string, ClientRow[] | undefined>;
  credit?: { learnedDB?: Record<string, string> };
  meetings?: { meetings?: unknown[] };
  business?: Record<string, ClientRow[] | undefined>;
  expenseLog?: { entries?: { createdAt?: number; date?: string }[] };
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

function pct(part: number, whole: number): string {
  if (!whole) return "—";
  return `${Math.round((part / whole) * 100)}%`;
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
  const d = new Date();
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const monthLabel = `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;

  console.log("🔍 שולף משתמשים, יועצים, קישורים ו-allowlist…");
  const [users, advisorsSnap, linksSnap, allowSnap] = await Promise.all([
    listAllAuthUsers(),
    db.collection("advisors").get(),
    db.collection("clientLinks").get(),
    db.collection("allowlist").get(),
  ]);

  const advisorUids = new Set(advisorsSnap.docs.map((doc) => doc.id));
  const authUids = new Set(users.map((u) => u.uid));

  type LinkDoc = {
    id: string;
    status?: string;
    invitedByUid?: string;
    practiceId?: string;
    createdAt?: Timestamp;
  };
  const pendingInvites: LinkDoc[] = [];
  const activeLinks: LinkDoc[] = [];
  let demoOrOrphanLinks = 0;
  for (const doc of linksSnap.docs) {
    const data = doc.data() as LinkDoc;
    if (doc.id.startsWith("pending_")) {
      if (data.status === "pending") pendingInvites.push({ ...data, id: doc.id });
    } else if (data.status === "active") {
      // demo-firm fixtures (demo_link_*) and any uid with no Auth account are
      // synthetic — they must not inflate billing/referral numbers
      if (authUids.has(doc.id)) activeLinks.push({ ...data, id: doc.id });
      else demoOrOrphanLinks++;
    }
  }
  const activeLinkUids = new Set(activeLinks.map((l) => l.id));
  // advisor accounts linked as a client of another advisor = internal testing
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
      const dataA = usersDoc.exists ? (usersDoc.data()?.data as NewSnapshot | undefined) : undefined;
      const dataB = mapsDoc.exists ? (mapsDoc.data()?.data as MapData | undefined) : undefined;
      const stage = Math.max(deriveStage(dataA), deriveStage(dataB));

      // expense log only exists in the new app's snapshot (users/{uid}.data)
      const entries = dataA?.expenseLog?.entries ?? [];
      let firstMs = 0;
      let lastMs = 0;
      let last7 = 0;
      for (const e of entries) {
        const t = e.createdAt || (e.date ? new Date(e.date).getTime() : 0) || 0;
        if (!t) continue;
        if (!firstMs || t < firstMs) firstMs = t;
        if (t > lastMs) lastMs = t;
        if (t >= now - 7 * DAY) last7++;
      }

      const createdMs = u.metadata.creationTime ? Date.parse(u.metadata.creationTime) : 0;
      const lastSignInMs = u.metadata.lastSignInTime ? Date.parse(u.metadata.lastSignInTime) : 0;

      return {
        uid: u.uid,
        email: u.email ?? "",
        createdMs,
        lastSignInMs,
        stage,
        entriesCount: entries.length,
        firstMs,
        lastMs,
        last7,
        invited: activeLinkUids.has(u.uid),
      };
    }),
  );

  /* ---- ACQUISITION ---- */
  const newClientsThisMonth = perClient.filter((c) => c.createdMs >= monthStart);
  const newAdvisorsThisMonth = advisors.filter(
    (u) => u.metadata.creationTime && Date.parse(u.metadata.creationTime) >= monthStart,
  );
  const invitedClients = perClient.filter((c) => c.invited);

  /* ---- ACTIVATION ---- */
  const creditLoaded = perClient.filter((c) => c.stage >= 2);
  const mappedFully = perClient.filter((c) => c.stage >= 3);
  const everLogged = perClient.filter((c) => c.firstMs > 0);
  const activatedIn7 = everLogged.filter(
    (c) => c.createdMs > 0 && c.firstMs - c.createdMs <= ACTIVATION_WINDOW_DAYS * DAY,
  );

  /* ---- RETENTION ---- */
  const loggedLast7 = perClient.filter((c) => c.lastMs >= now - 7 * DAY);
  const dormant = perClient.filter((c) => c.firstMs > 0 && c.lastMs < now - STALE_DAYS * DAY);
  const signedInLast30 = perClient.filter((c) => c.lastSignInMs >= now - 30 * DAY);

  /* ---- REVENUE ---- */
  const billableClients = activeLinks.length;
  const practices = new Set(activeLinks.map((l) => l.practiceId).filter(Boolean));
  const annualPotential = billableClients * PRICE_PER_CLIENT_YEAR;

  /* ---- REFERRAL ---- */
  const converted = activeLinks.filter((l) => l.invitedByUid).length;
  const invitesSent = converted + pendingInvites.length;

  const report = {
    generatedAt: new Date(now).toISOString(),
    month: monthLabel,
    totals: {
      users: users.length,
      advisors: advisors.length,
      clients: clients.length,
    },
    acquisition: {
      newAdvisorsThisMonth: newAdvisorsThisMonth.length,
      newClientsThisMonth: newClientsThisMonth.length,
      clientsViaAdvisorInvite: invitedClients.length,
      allowlistSources: Object.fromEntries(allowSources),
    },
    activation: {
      creditLoaded: creditLoaded.length,
      mappedFully: mappedFully.length,
      everLoggedExpense: everLogged.length,
      firstExpenseWithin7Days: activatedIn7.length,
    },
    retention: {
      loggedLast7Days: loggedLast7.length,
      dormant5PlusDays: dormant.length,
      signedInLast30Days: signedInLast30.length,
    },
    revenue: {
      billableClients,
      internalTestLinks,
      demoOrOrphanLinks,
      practices: practices.size,
      pricePerClientYear: PRICE_PER_CLIENT_YEAR,
      annualPotentialILS: annualPotential,
      payingAdvisors: 0, // manual billing — no paying advisor yet
    },
    referral: {
      invitesPending: pendingInvites.length,
      invitesConverted: converted,
      inviteConversion: invitesSent ? Math.round((converted / invitesSent) * 100) : null,
    },
  };

  const C = clients.length;
  const lines: string[] = [];
  lines.push(`# דוח משפך AARRR — The Home Economist`);
  lines.push("");
  lines.push(`_הופק: ${new Date(now).toISOString().replace("T", " ").slice(0, 16)} · חודש ${monthLabel}_`);
  lines.push("");
  lines.push(`**סה"כ במערכת:** ${users.length} משתמשים = ${advisors.length} יועצים + ${C} לקוחות`);
  lines.push("");
  lines.push(`## 1. גיוס (Acquisition)`);
  lines.push(`- יועצים חדשים החודש: **${newAdvisorsThisMonth.length}**`);
  lines.push(`- לקוחות חדשים החודש: **${newClientsThisMonth.length}**`);
  lines.push(`- לקוחות שהגיעו דרך הזמנת יועץ: **${invitedClients.length}** מתוך ${C} (${pct(invitedClients.length, C)})`);
  lines.push(
    `- מקורות ב-allowlist: ${[...allowSources.entries()].map(([s, n]) => `${s}: ${n}`).join(" · ") || "—"}`,
  );
  lines.push("");
  lines.push(`## 2. הפעלה (Activation)`);
  lines.push(`- טענו דוח אשראי (שלב 2+): **${creditLoaded.length}** מתוך ${C} (${pct(creditLoaded.length, C)})`);
  lines.push(`- מיפוי מלא (שלב 3+): **${mappedFully.length}** מתוך ${C} (${pct(mappedFully.length, C)})`);
  lines.push(`- תיעדו הוצאה אי-פעם: **${everLogged.length}** מתוך ${C} (${pct(everLogged.length, C)})`);
  lines.push(
    `- הוצאה ראשונה תוך ${ACTIVATION_WINDOW_DAYS} ימים מההרשמה: **${activatedIn7.length}** מתוך ${everLogged.length} מתעדים (${pct(activatedIn7.length, everLogged.length)})`,
  );
  lines.push("");
  lines.push(`## 3. שימור (Retention)`);
  lines.push(`- תיעדו הוצאה ב-7 הימים האחרונים: **${loggedLast7.length}** מתוך ${everLogged.length} מתעדים (${pct(loggedLast7.length, everLogged.length)})`);
  lines.push(`- רדומים ${STALE_DAYS}+ ימים (תיעדו בעבר והפסיקו): **${dormant.length}**`);
  lines.push(`- התחברו ב-30 הימים האחרונים: **${signedInLast30.length}** מתוך ${C} (${pct(signedInLast30.length, C)})`);
  lines.push("");
  lines.push(`## 4. הכנסה (Revenue)`);
  lines.push(`- לקוחות פעילים מקושרים ליועץ (יחידת החיוב): **${billableClients}** ב-${practices.size} משרדים`);
  lines.push(`  - מתוכם קישורי בדיקה פנימיים (חשבון יועץ שמקושר כלקוח): **${internalTestLinks}**`);
  lines.push(`  - קישורי דמו/רפאים שסוננו מהספירה: **${demoOrOrphanLinks}**`);
  lines.push(`- פוטנציאל שנתי לפי ${PRICE_PER_CLIENT_YEAR} ₪ ללקוח: **${annualPotential.toLocaleString("he-IL")} ₪**`);
  lines.push(`- יועצים משלמים בפועל: **0** (החיוב עדיין ידני, אין עדיין יועץ משלם חיצוני)`);
  lines.push("");
  lines.push(`## 5. הפניה (Referral)`);
  lines.push(`- הזמנות שממתינות: **${pendingInvites.length}**`);
  lines.push(`- הזמנות שהבשילו ללקוח פעיל: **${converted}**`);
  lines.push(
    `- שיעור המרה של הזמנות: **${invitesSent ? pct(converted, invitesSent) : "—"}** (${converted} מתוך ${invitesSent})`,
  );
  lines.push("");
  lines.push(`---`);
  lines.push(`_מקורות: Firebase Auth (הרשמה/התחברות), advisors, clientLinks, allowlist, users/{uid}.data (כולל expenseLog), maps/{uid}.data. קריאה בלבד._`);

  writeFileSync(OUT_MD, lines.join("\n"));
  writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));

  console.log("");
  console.log(lines.join("\n"));
  console.log("");
  console.log(`✅ נכתב: ${OUT_MD}`);
  console.log(`✅ נכתב: ${OUT_JSON}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
