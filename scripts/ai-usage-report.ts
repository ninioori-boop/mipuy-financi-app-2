/**
 * AI usage per practice — what each white-label firm actually costs.
 *
 *   npx tsx scripts/ai-usage-report.ts        # last 14 days
 *   npx tsx scripts/ai-usage-report.ts 30     # last 30 days
 *
 * Reads the `aiUsage/{practiceId}_{YYYY-MM-DD}` rollups written by the web AI
 * routes and the WhatsApp bot. Shows the configured ceiling per practice so a
 * cap can be set from real numbers instead of a guess.
 */
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_LIMIT = 500;   // mirrors src/lib/aiQuota.ts

async function main() {
  const days = Math.max(1, Number(process.argv[2] || 14));
  initializeApp({ credential: cert(JSON.parse(readFileSync(resolve(process.cwd(), "service-account-key.json"), "utf8"))) });
  const db = getFirestore();

  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const snap = await db.collection("aiUsage").get();
  const rows = snap.docs
    .map(d => d.data() as { practiceId: string; day: string; total?: number; byRoute?: Record<string, number> })
    .filter(r => r.day >= since);

  if (!rows.length) {
    console.log(`אין נתוני שימוש ב-AI מאז ${since}. (המונים נכתבים מרגע הפריסה של המכסה.)`);
    return;
  }

  // practiceId → name + configured ceiling
  const practices = await db.collection("practices").get();
  const meta = new Map<string, { name: string; limit: number; disabled: boolean }>();
  for (const p of practices.docs) {
    const q = (p.data().aiQuota ?? {}) as { dailyLimit?: number; disabled?: boolean };
    meta.set(p.id, {
      name: p.data().name || p.id,
      limit: Number(q.dailyLimit) > 0 ? Number(q.dailyLimit) : DEFAULT_LIMIT,
      disabled: q.disabled === true,
    });
  }

  const byPractice = new Map<string, { total: number; days: Set<string>; peak: number; routes: Record<string, number> }>();
  for (const r of rows) {
    const cur = byPractice.get(r.practiceId) ?? { total: 0, days: new Set<string>(), peak: 0, routes: {} };
    const dayTotal = Number(r.total || 0);
    cur.total += dayTotal;
    cur.days.add(r.day);
    cur.peak = Math.max(cur.peak, dayTotal);
    for (const [route, n] of Object.entries(r.byRoute ?? {})) cur.routes[route] = (cur.routes[route] ?? 0) + Number(n);
    byPractice.set(r.practiceId, cur);
  }

  console.log(`\n=== שימוש ב-AI לפי עסק (${days} ימים אחרונים, מאז ${since}) ===\n`);
  const sorted = [...byPractice.entries()].sort((a, b) => b[1].total - a[1].total);
  for (const [pid, u] of sorted) {
    const m = meta.get(pid);
    const name = pid === "_none" ? "ללא שיוך לעסק" : (m?.name ?? pid);
    const limit = m?.limit ?? DEFAULT_LIMIT;
    const pct = Math.round((u.peak / limit) * 100);
    console.log(`${name}${m?.disabled ? "  ⛔ מושהה" : ""}`);
    console.log(`  סה"כ ${u.total} קריאות ב-${u.days.size} ימים · ממוצע ${Math.round(u.total / u.days.size)}/יום · שיא ${u.peak}/יום`);
    console.log(`  תקרה יומית: ${limit} (השיא הוא ${pct}% מהתקרה)`);
    const routes = Object.entries(u.routes).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r}=${n}`).join(" · ");
    if (routes) console.log(`  פירוט: ${routes}`);
    console.log("");
  }
  console.log("לשינוי תקרה לעסק מסוים: practices/{id}.aiQuota = { dailyLimit: N }  ·  להשהיה מלאה: { disabled: true }");
}

main().then(() => setTimeout(() => process.exit(0), 150))
  .catch(e => { console.error(e); setTimeout(() => process.exit(1), 150); });
