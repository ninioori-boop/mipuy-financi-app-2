/**
 * Stage-3 probe: after an advisor edits the E2E client through the UI (edit
 * mode), confirm the write landed in the RIGHT place and NOWHERE else.
 *
 * Pass criteria (advisor made an edit that inserts the marker string "עריכת יועץ"
 * into any mapping row while in edit mode):
 *   ✅ client users doc contains the advisor's edit
 *   ✅ client doc has the top-level lastAdvisorEditAt marker (transparency)
 *   ✅ client has ≥1 version snapshot (client can rewind)
 *   ✅ advisor's OWN doc still shows income 99999 and NO client/edit fixture data
 *
 * Read-only. Requires service-account-key.json at project root (gitignored).
 *   npx tsx scripts/check-client-write.ts
 */
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const keyJson = readFileSync(resolve(process.cwd(), "service-account-key.json"), "utf8");
initializeApp({ credential: cert(JSON.parse(keyJson)) });
const db = getFirestore();

// The marker an operator should type into a mapping row while editing as advisor.
const EDIT_MARKER = "עריכת יועץ";

async function main() {
  const advisorUid = (await getAuth().getUserByEmail("e2e-advisor@orimipuy.com")).uid;
  const clientUid  = (await getAuth().getUserByEmail("e2e-client@orimipuy.com")).uid;

  const clientDoc = await db.collection("users").doc(clientUid).get();
  const advisorDoc = await db.collection("users").doc(advisorUid).get();
  const versions = await db.collection("users").doc(clientUid).collection("versions").limit(1).get();

  const clientData = JSON.stringify(clientDoc.get("data") ?? {});
  const advisorData = JSON.stringify(advisorDoc.get("data") ?? {});

  const clientHasEdit   = clientData.includes(EDIT_MARKER);
  const hasEditMarker   = !!clientDoc.get("lastAdvisorEditAt");
  const editByMatches   = clientDoc.get("lastAdvisorEditByUid") === advisorUid;
  const clientHasVersion = !versions.empty;
  const advisorClean    = advisorData.includes("99999")
    && !advisorData.includes(EDIT_MARKER) && !advisorData.includes("בדיקה");

  const line = (ok: boolean, msg: string) => console.log(`${ok ? "✅" : "❌"} ${msg}`);
  line(clientHasEdit,    `client doc contains the advisor edit ("${EDIT_MARKER}")`);
  line(hasEditMarker,    `client doc has lastAdvisorEditAt marker`);
  line(editByMatches,    `lastAdvisorEditByUid == advisor`);
  line(clientHasVersion, `client has ≥1 version snapshot`);
  line(advisorClean,     `advisor's own doc untouched (income 99999, no edit/client data)`);

  const allPass = clientHasEdit && hasEditMarker && editByMatches && clientHasVersion && advisorClean;
  console.log(allPass ? "\n🎉 ALL CHECKS PASS" : "\n⚠️  one or more checks failed — see above");
  process.exit(allPass ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
