/**
 * email-report.ts — how well are the emails actually working?
 *
 * Email sending is fire-and-forget (Resend REST, nothing persisted), so the only
 * hard signal in Firestore is invite outcomes: clientLinks/pending_{email} docs
 * that flipped to "active" (client consented) vs ones still pending.
 * Also lists digest recipients (advisors with an email) and their active-client
 * counts, since 0-client advisors are silently skipped by weeklyAdvisorDigest.
 *
 * Read-only. Run: npx tsx scripts/email-report.ts
 */
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const KEY_PATH = resolve(process.cwd(), "service-account-key.json");
const DEMO_EMAILS = new Set(["demo@orimipuy.com"]);
const isDemoEmail = (e: string) => DEMO_EMAILS.has(e) || e.endsWith("@example.com");

function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  const anyV = v as { toDate?: () => Date };
  if (typeof anyV.toDate === "function") return anyV.toDate();
  return null;
}

function fmt(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "?";
}

function daysBetween(a: Date | null, b: Date | null): number | null {
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

async function main() {
  let keyJson: string;
  try {
    keyJson = readFileSync(KEY_PATH, "utf8");
  } catch {
    console.error("service-account-key.json not found at project root");
    process.exit(1);
  }
  initializeApp({ credential: cert(JSON.parse(keyJson)) });
  const db = getFirestore();

  const [linksSnap, advisorsSnap] = await Promise.all([
    db.collection("clientLinks").get(),
    db.collection("advisors").get(),
  ]);

  const now = new Date();
  type Link = {
    id: string;
    email: string;
    status: string;
    invitedByUid: string;
    createdAt: Date | null;
    consentAt: Date | null;
    updatedAt: Date | null;
    demo: boolean;
  };
  const links: Link[] = linksSnap.docs.map((d) => {
    const x = d.data();
    const email = String(x.invitedEmail ?? "").toLowerCase();
    return {
      id: d.id,
      email,
      status: String(x.status ?? "?"),
      invitedByUid: String(x.invitedByUid ?? "?"),
      createdAt: toDate(x.createdAt),
      consentAt: toDate(x.consentAt),
      updatedAt: toDate(x.updatedAt),
      demo: isDemoEmail(email),
    };
  });

  const real = links.filter((l) => !l.demo);
  const active = real.filter((l) => l.status === "active");
  const pending = real.filter((l) => l.status === "pending");
  const other = real.filter((l) => l.status !== "active" && l.status !== "pending");

  console.log("=== INVITE EMAIL FUNNEL (clientLinks) ===");
  console.log(`total invites: ${real.length}  (+${links.length - real.length} demo, excluded)`);
  console.log(`active (consented): ${active.length}`);
  console.log(`pending (never converted): ${pending.length}`);
  if (other.length) console.log(`other statuses: ${other.map((l) => `${l.id}=${l.status}`).join(", ")}`);
  if (real.length) {
    console.log(`conversion: ${Math.round((100 * active.length) / real.length)}%`);
  }

  console.log("\n--- active: invite -> consent lag ---");
  for (const l of active.sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0))) {
    const lag = daysBetween(l.createdAt, l.consentAt);
    console.log(`  ${l.email}  invited ${fmt(l.createdAt)}  consented ${fmt(l.consentAt)}  (${lag ?? "?"}d)`);
  }

  console.log("\n--- pending: age since invite ---");
  for (const l of pending.sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0))) {
    console.log(`  ${l.email}  invited ${fmt(l.createdAt)}  (${daysBetween(l.createdAt, now) ?? "?"}d ago)`);
  }

  console.log("\n=== WEEKLY DIGEST RECIPIENTS (advisors) ===");
  for (const d of advisorsSnap.docs) {
    const x = d.data();
    const email = x.email ? String(x.email) : null;
    const activeClients = links.filter(
      (l) => l.invitedByUid === d.id && l.status === "active" && !l.demo
    ).length;
    const gets =
      email && activeClients > 0 ? "GETS digest" : email ? "SKIPPED (0 active clients)" : "SKIPPED (no email)";
    console.log(`  ${d.id}  email=${email ?? "-"}  activeClients=${activeClients}  -> ${gets}`);
  }

  // ── emailLog: send audit written by the functions (last 30 days) ──
  const since = new Date(Date.now() - 30 * 86_400_000);
  const logSnap = await db.collection("emailLog").where("createdAt", ">=", since).get();
  console.log(`\n=== EMAIL LOG (last 30 days, ${logSnap.size} sends) ===`);
  const byKey = new Map<string, number>();
  const failures: string[] = [];
  for (const d of logSnap.docs) {
    const x = d.data();
    const key = `${x.type ?? "?"} / ${x.status ?? "?"}`;
    byKey.set(key, (byKey.get(key) ?? 0) + 1);
    if (x.status !== "accepted") {
      failures.push(`  ${fmt(toDate(x.createdAt))}  ${x.type}  to=${x.to}  http=${x.httpStatus}  ${String(x.error ?? "").slice(0, 80)}`);
    }
  }
  for (const [k, n] of [...byKey.entries()].sort()) console.log(`  ${k}: ${n}`);
  if (failures.length) {
    console.log("--- failures ---");
    for (const f of failures.slice(-10)) console.log(f);
  }

  console.log("\n--- lastDigestAt per advisor ---");
  for (const d of advisorsSnap.docs) {
    const last = toDate(d.data().lastDigestAt);
    console.log(`  ${d.data().email ?? d.id}: ${last ? fmt(last) : "never"}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
