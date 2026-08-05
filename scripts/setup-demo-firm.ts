/**
 * DEMO ONLY: populate Ori's firm "הכלכלן של הבית" with 2 demo advisors + a few
 * sample clients each, so /app/firm shows a real multi-advisor firm view. Every
 * doc is tagged { demo: true } for a clean removal.
 *   npx tsx scripts/setup-demo-firm.ts     # add the demo
 * Remove afterwards with: npx tsx scripts/cleanup-demo-firm.ts
 *
 * Nothing here creates auth accounts — these are Firestore docs only (the firm
 * view reads advisor docs + clientLinks, never logs in as them). Requires
 * service-account-key.json.
 */
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const keyJson = readFileSync(resolve(process.cwd(), "service-account-key.json"), "utf8");
initializeApp({ credential: cert(JSON.parse(keyJson)) });
const db = getFirestore();

// Ori's firm (from inspect-firms.ts).
const PRACTICE_ID = "p_TYxUOdf3LcTiyuzunrAf0CEVsQx1";

const day = (iso: string) => Timestamp.fromDate(new Date(iso + "T09:00:00Z"));

const DEMO = [
  {
    uid: "demo_advisor_yael",
    email: "yael.cohen@example.com",
    name: "יעל כהן",
    clients: [
      { email: "michal.bar@example.com",   status: "active",  date: "2026-07-20" },
      { email: "avi.shalom@example.com",    status: "active",  date: "2026-07-14" },
      { email: "noa.peretz@example.com",    status: "pending", date: "2026-07-22" },
    ],
  },
  {
    uid: "demo_advisor_dan",
    email: "dan.levi@example.com",
    name: "דן לוי",
    clients: [
      { email: "yossi.ben@example.com", status: "active",  date: "2026-07-18" },
      { email: "tal.mor@example.com",   status: "active",  date: "2026-07-09" },
      { email: "roni.gil@example.com",  status: "revoked", date: "2026-06-30" },
    ],
  },
];

async function main() {
  let linkN = 0;
  for (const adv of DEMO) {
    await db.collection("advisors").doc(adv.uid).set({
      email: adv.email, name: adv.name, practiceId: PRACTICE_ID, role: "member",
      demo: true, createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    for (const c of adv.clients) {
      await db.collection("clientLinks").doc(`demo_link_${linkN++}`).set({
        invitedByUid: adv.uid, invitedEmail: c.email, status: c.status,
        clientUid: c.status === "active" ? `demo_client_${linkN}` : null,
        practiceId: PRACTICE_ID, consentVersion: "v1",
        createdAt: day(c.date), statusChangedAt: day(c.date), updatedAt: day(c.date),
        demo: true,
      });
    }
    console.log(`+ ${adv.name} (${adv.email}) — ${adv.clients.length} clients`);
  }

  // Add the demo advisors to the practice so the firm nav (>1 advisor) lights up.
  await db.collection("practices").doc(PRACTICE_ID).set({
    advisorUids: FieldValue.arrayUnion(...DEMO.map((d) => d.uid)),
  }, { merge: true });

  console.log(`\n✅ demo firm ready — ${DEMO.length} advisors added to "הכלכלן של הבית".`);
  console.log('Ori (as manager) will now see "ניהול · 🏢 המשרד שלי" → /app/firm.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
