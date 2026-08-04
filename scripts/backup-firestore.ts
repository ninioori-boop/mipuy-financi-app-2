/**
 * backup-firestore.ts — READ-ONLY local dump of the entire Firestore database.
 *
 * Writes one JSON file per top-level collection (subcollections nested inside
 * their parent doc, discovered recursively — nothing is silently skipped) plus
 * a manifest with counts, to a dated folder OUTSIDE the repo:
 *
 *     ../firestore-backups/<YYYY-MM-DD_HHmm>/
 *
 * The dumps contain real client data — they must stay on this machine and must
 * never be committed or uploaded. The folder lives outside the git tree on
 * purpose.
 *
 * Run (from the repo root, where service-account-key.json lives):
 *     npx tsx scripts/backup-firestore.ts
 *
 * Restore: surgical, per document, via a dedicated script at need — the JSON
 * encodes Firestore types with __type markers (timestamp/ref/bytes) so values
 * can be reconstructed exactly. Full-disaster restore comes from the native
 * scheduled backups, not from these files.
 */
import { cert, initializeApp } from "firebase-admin/app";
import {
  getFirestore, Timestamp, GeoPoint,
  type DocumentReference, type CollectionReference,
} from "firebase-admin/firestore";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

initializeApp({ credential: cert(JSON.parse(
  readFileSync(resolve(process.cwd(), "service-account-key.json"), "utf8"))) });
const db = getFirestore();

// ── Firestore-type-safe serialization ────────────────────────────────────────
let unknownTypeWarnings = 0;

function encode(v: unknown): unknown {
  if (v === null || v === undefined) return v ?? null;
  if (v instanceof Timestamp) return { __type: "timestamp", ms: v.toMillis() };
  if (v instanceof Date)      return { __type: "date", ms: v.getTime() };
  if (v instanceof GeoPoint)  return { __type: "geopoint", lat: v.latitude, lng: v.longitude };
  if (Buffer.isBuffer(v))     return { __type: "bytes", base64: v.toString("base64") };
  if (Array.isArray(v))       return v.map(encode);
  if (typeof v === "object") {
    // DocumentReference has a string `path` and a `firestore` handle.
    const maybeRef = v as { path?: unknown; firestore?: unknown };
    if (typeof maybeRef.path === "string" && maybeRef.firestore) {
      return { __type: "ref", path: maybeRef.path };
    }
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) {
      // Unknown class instance — keep its enumerable fields, but count it so
      // the summary can surface that fidelity may be imperfect.
      unknownTypeWarnings++;
    }
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>)) {
      out[k] = encode((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

// ── Recursive dump ───────────────────────────────────────────────────────────
interface DumpedDoc {
  data: unknown;
  subcollections?: Record<string, Record<string, DumpedDoc>>;
}

const totals = { docs: 0, bytes: 0 };
const perCollection: Record<string, number> = {};

// Small concurrency pool — listCollections() per doc is the slow part.
async function mapPool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }));
  return out;
}

async function dumpDoc(ref: DocumentReference, data: unknown, topName: string): Promise<DumpedDoc> {
  totals.docs++;
  perCollection[topName] = (perCollection[topName] ?? 0) + 1;
  const doc: DumpedDoc = { data: encode(data) };
  const subs = await ref.listCollections();
  if (subs.length) {
    doc.subcollections = {};
    for (const sub of subs) {
      doc.subcollections[sub.id] = await dumpCollection(sub, `${topName}/${sub.id}`);
    }
  }
  return doc;
}

async function dumpCollection(col: CollectionReference, topName: string): Promise<Record<string, DumpedDoc>> {
  const snap = await col.get();
  const entries = await mapPool(snap.docs, 8, async d =>
    [d.id, await dumpDoc(d.ref, d.data(), topName)] as const);
  return Object.fromEntries(entries);
}

// ── Main ─────────────────────────────────────────────────────────────────────
function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

async function main() {
  const outDir = resolve(process.cwd(), "..", "firestore-backups", stamp());
  mkdirSync(outDir, { recursive: true });

  const tops = await db.listCollections();
  console.log(`dumping ${tops.length} top-level collections → ${outDir}\n`);

  for (const col of tops) {
    const dumped = await dumpCollection(col, col.id);
    const json = JSON.stringify(dumped);
    totals.bytes += json.length;
    writeFileSync(resolve(outDir, `${col.id}.json`), json);
    const subDocs = Object.keys(perCollection)
      .filter(k => k.startsWith(col.id + "/"))
      .reduce((a, k) => a + perCollection[k], 0);
    console.log(`${col.id.padEnd(26)} docs=${String(perCollection[col.id] ?? 0).padStart(5)}`
      + (subDocs ? `  (+${subDocs} in subcollections)` : ""));
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    project: "finance-machine-a36e9",
    totals: { ...totals, mb: +(totals.bytes / 1024 / 1024).toFixed(2) },
    perCollection,
    unknownTypeWarnings,
    format: "one file per top-level collection; { docId: { data, subcollections? } }; __type markers for timestamp/date/geopoint/bytes/ref",
  };
  writeFileSync(resolve(outDir, "_manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(`\nDONE: ${totals.docs} docs, ${manifest.totals.mb} MB → ${outDir}`);
  if (unknownTypeWarnings) {
    console.warn(`⚠️ ${unknownTypeWarnings} values of unrecognized class types were serialized field-by-field — inspect before relying on them for restore.`);
  }

  // Self-verification: every file written must parse back, and the total doc
  // count must match what we just walked.
  let reparsedDocs = 0;
  const countDocs = (m: Record<string, DumpedDoc>): number =>
    Object.values(m).reduce((a, d) => a + 1 + Object.values(d.subcollections ?? {}).reduce((b, s) => b + countDocs(s), 0), 0);
  for (const col of tops) {
    const back = JSON.parse(readFileSync(resolve(outDir, `${col.id}.json`), "utf8"));
    reparsedDocs += countDocs(back);
  }
  if (reparsedDocs !== totals.docs) {
    console.error(`❌ VERIFY FAILED: walked ${totals.docs} docs but files contain ${reparsedDocs}.`);
    process.exit(1);
  }
  console.log(`VERIFIED: all files re-parse; ${reparsedDocs}/${totals.docs} docs accounted for.`);
}

main().then(() => setTimeout(() => process.exit(0), 150))
  .catch(e => { console.error(e); process.exit(1); });
