// Pre-commit guard: refuses a commit whose STAGED content contains a secret.
//
// Why this exists: the `safe-commit` skill already carries these patterns, but it
// only runs when someone remembers to ask for it. The 2026-07-30 functions backup
// caught a live account password by hand — one commit away from being in the repo
// history forever, and once pushed, exposed regardless of any later deletion.
//
// This is also the guard for the other direction: the repo root holds untracked
// commercial documents (quotes, contracts, pricing), so a reflexive `git add -A`
// can commit a client's commercial terms. .gitignore covers the known names; this
// catches secret-shaped CONTENT wherever it appears.
//
// Escape hatch for a false positive: `git commit --no-verify`.
// Run manually over what is currently staged: `npm run check:secrets`.
"use strict";
const { execFileSync } = require("child_process");

const SECRET_PATTERNS = [
  { name: "Anthropic API key", re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "Google / Firebase API key", re: /AIza[A-Za-z0-9_-]{30,}/ },
  { name: "Resend API key", re: /re_[A-Za-z0-9]{20,}/ },
  { name: "Meta / WhatsApp token", re: /EAA[A-Za-z0-9]{40,}/ },
  { name: "private key block", re: /BEGIN [A-Z ]*PRIVATE KEY/ },
  { name: "GitHub token", re: /ghp_[A-Za-z0-9]{30,}/ },
  {
    name: "hardcoded credential",
    re: /(passw[a-z]*|secret|token|api[_-]?key|credential)\s*[:=]\s*["'][^"']{8,}["']/i,
  },
];

// A staged FILENAME that should never enter the repo, even if .gitignore missed it.
const FORBIDDEN_NAMES =
  /(^|\/)\.env|service-account|adminsdk|credentials\.json$|\.pem$|\.key$|^id_rsa/i;

// Paths whose contents are not real secrets:
//   .claude/         — the skills that DEFINE these patterns would match themselves
//   this script      — same reason
//   lockfiles/maps   — long base64-ish blobs produce false positives (a WASM blob
//                      in a built chunk matches the Meta token shape, for one)
const SKIP_PATHS =
  /(^\.claude\/|^scripts\/check-secrets\.js$|^package-lock\.json$|\.min\.js$|\.map$)/;

// Lines that legitimately mention a secret without containing one.
const SAFE_LINE = /(process\.env|defineSecret|\.value\(\)|import\.meta\.env|^\s*(\/\/|\*|#))/;

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

function redact(line, match) {
  const shown = match.slice(0, 6);
  return line.replace(match, `${shown}…<<REDACTED ${match.length} chars>>`).trim().slice(0, 160);
}

const findings = [];

// 1. Forbidden filenames among staged additions.
const staged = git(["diff", "--cached", "--name-only", "--diff-filter=ACM"])
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);

for (const file of staged) {
  if (FORBIDDEN_NAMES.test(file)) {
    findings.push({ file, line: 0, what: "file that must never be committed", detail: file });
  }
}

// 2. Secret-shaped content among ADDED lines only (-U0: no context lines to scan).
const diff = git(["diff", "--cached", "-U0"]);
let file = "";
let lineNo = 0;

for (const raw of diff.split("\n")) {
  if (raw.startsWith("+++ b/")) {
    file = raw.slice(6).trim();
    continue;
  }
  if (raw.startsWith("@@")) {
    const m = /^@@ -\S+ \+(\d+)/.exec(raw);
    lineNo = m ? Number(m[1]) : 0;
    continue;
  }
  if (!raw.startsWith("+") || raw.startsWith("+++")) continue;

  const content = raw.slice(1);
  const here = lineNo++;
  if (!file || SKIP_PATHS.test(file)) continue;
  if (SAFE_LINE.test(content)) continue;

  for (const p of SECRET_PATTERNS) {
    const m = p.re.exec(content);
    if (m) {
      findings.push({ file, line: here, what: p.name, detail: redact(content, m[0]) });
      break;
    }
  }
}

if (findings.length) {
  console.error("");
  console.error("❌ REFUSING TO COMMIT — POSSIBLE SECRET IN STAGED CHANGES");
  console.error("");
  for (const f of findings) {
    console.error(`   ${f.file}${f.line ? ":" + f.line : ""}  — ${f.what}`);
    console.error(`      ${f.detail}`);
  }
  console.error("");
  console.error("   Move the value to an environment variable and fail loudly when it is");
  console.error("   missing. Do not delete the tool — take the secret out of it.");
  console.error("");
  console.error("   נמצא מה שנראה כמו סוד. הוצא אותו למשתנה סביבה לפני הקומיט.");
  console.error("   אם זו אזעקת שווא:  git commit --no-verify");
  console.error("");
  process.exit(1);
}

console.log(`✓ no secrets in staged changes (${staged.length} file(s) scanned)`);
