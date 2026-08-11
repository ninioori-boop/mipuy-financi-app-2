/**
 * Replay a saved automap run and print what the screen would say.
 *
 *   npx tsx scripts/automap-replay.ts [path]
 *
 * Why: every defect in the lab reached Ori first. 600+ tests, all on pure
 * logic, while every bug lived in the seam between the logic and the screen —
 * a row with no drill-down, income collapsed to one line, controls overlapping.
 * Nothing could reproduce what he was looking at, so the loop was twenty
 * minutes and one paid AI call per iteration, with him as the test harness.
 *
 * With a run saved from the lab ("🧪 שמור הרצה לבדיקה") a fix can be checked in
 * seconds, against his real data, with no run and no spend.
 *
 * 🔒 The file holds one household's real transactions. It stays on this machine,
 * is never uploaded, and is gitignored.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { summarizeRun, type AutomapRun } from '../src/lib/automapFixture'

const CANDIDATES = [
  process.argv[2],
  join(process.cwd(), 'scripts', '.automap-run.json'),
  join(homedir(), 'Downloads', 'automap-run.json'),
].filter(Boolean) as string[]

const path = CANDIDATES.find(p => existsSync(p))
if (!path) {
  console.error('לא נמצא קובץ הרצה. חפשתי ב:')
  for (const c of CANDIDATES) console.error('  ' + c)
  console.error('\nבמעבדה: "🧪 שמור הרצה לבדיקה", ואז הרץ שוב.')
  process.exit(1)
}

const run = JSON.parse(readFileSync(path, 'utf8')) as AutomapRun
const { lines, findings } = summarizeRun(run)

console.log(`\n══ ${path} ══\n`)
for (const l of lines) console.log('   ' + l)

if (!findings.length) {
  console.log('\n   ✓ שום דבר לא נראה שבור בהרצה הזאת\n')
} else {
  console.log(`\n── ${findings.length} ממצאים ──`)
  for (const f of findings) console.log(`   ${f.severity === 'gap' ? '⚠️ ' : '·  '}${f.text}`)
  console.log()
}

// Non-zero on a real problem, so this can gate a change the way a test does.
process.exit(findings.some(f => f.severity === 'gap') ? 1 : 0)
