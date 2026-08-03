// Predeploy guard for `firebase deploy --only functions` (wired in firebase.json).
//
// Why this exists: the Firebase CLI deletes every deployed function it cannot
// find in the local source tree. Six live functions (the WhatsApp client bot,
// the goal bot, the weekly advisor digest, the credit-split daily check and
// their helpers) were at one point committed on a side branch only — so a
// routine deploy from a `main` checkout would have silently deleted all of
// them from production. The repo already documents a real incident of exactly
// this. Prose warnings don't stop a deploy; this script does.
//
// It fails the deploy unless every module the live function set depends on is
// present. If it ever blocks you wrongly (e.g. a module was deliberately
// retired), update EXPECTED in the same commit that removes the module.
"use strict";
const fs = require("fs");
const path = require("path");

const EXPECTED = [
  "clientBot.js",
  "goalBot.js",
  "creditSplitCheck.js",
  "waSignature.js",
  "clientSelectors.js",
  "brand.js",
  "index.js",
];

const root = path.resolve(__dirname, "..", "functions");
const missing = EXPECTED.filter((f) => !fs.existsSync(path.join(root, f)));

if (missing.length) {
  console.error("");
  console.error("❌ REFUSING TO DEPLOY FUNCTIONS — WRONG TREE");
  console.error("");
  console.error("   Missing from functions/: " + missing.join(", "));
  console.error("");
  console.error("   Deploying from this tree would DELETE live production functions");
  console.error("   (the Firebase CLI removes anything not present in local source).");
  console.error("   Deploy only from a tree that carries the FULL functions/ set.");
  console.error("");
  console.error("   פריסה מהעץ הזה תמחק פונקציות חיות מהפרודקשן. עצור.");
  console.error("");
  process.exit(1);
}

console.log("✓ functions tree complete (" + EXPECTED.length + " modules) — safe to deploy");
