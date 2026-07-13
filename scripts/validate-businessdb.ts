/**
 * Validate candidate business entries before merging into BUSINESS_DB.
 *
 * Input: JSON files in the shape
 *   { "category": "אוכל בחוץ ובילויים", "entries": [ "ארומה", "aroma", ["מפתח", "קטגוריה אחרת"] ] }
 *
 * Output next to each input file:
 *   <name>.clean.json      — entries safe to merge
 *   <name>.exceptions.json — entries needing owner review
 *
 *   npx tsx scripts/validate-businessdb.ts scripts/businessdb-candidates/restaurants.json [...more]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type CandidateFile,
  loadCandidateEntries,
  validateBatch,
} from "./businessdb-lib";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("שימוש: npx tsx scripts/validate-businessdb.ts <candidates.json> [...]");
  process.exit(1);
}

let totalClean = 0;
let totalExceptions = 0;
let totalRejected = 0;

for (const f of files) {
  const path = resolve(process.cwd(), f);
  const file = JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, "")) as CandidateFile;
  const candidates = loadCandidateEntries(file);
  const { clean, warnings, exceptions, rejected, droppedDuplicates } = validateBatch(candidates);

  const base = path.replace(/\.json$/, "");
  writeFileSync(`${base}.clean.json`, JSON.stringify({ category: file.category, entries: clean }, null, 2), "utf8");
  writeFileSync(`${base}.exceptions.json`, JSON.stringify({ exceptions, rejected, warnings }, null, 2), "utf8");

  console.log(`\n📄 ${f} — קטגוריה: ${file.category}`);
  console.log(`   סה"כ מועמדים: ${candidates.length}`);
  console.log(`   ✅ נקיים למיזוג: ${clean.length} (מתוכם ${warnings.length} עם הערת "הארוך מנצח")`);
  console.log(`   ⚠️  חריגים לבדיקה: ${exceptions.length}`);
  console.log(`   ❌ נפסלו: ${rejected.length}`);
  console.log(`   ⏭️  כפילויות שהושמטו: ${droppedDuplicates}`);
  for (const e of exceptions.slice(0, 15)) {
    console.log(`      ⚠️ "${e.key}" (${e.category}): ${e.reason}`);
  }
  if (exceptions.length > 15) console.log(`      ... ועוד ${exceptions.length - 15} בקובץ ה-exceptions`);

  totalClean += clean.length;
  totalExceptions += exceptions.length;
  totalRejected += rejected.length;
}

console.log(`\n══ סיכום: ${totalClean} נקיים | ${totalExceptions} חריגים | ${totalRejected} נפסלו ══`);
