// A saved run, and the text-mode picture of the screen it produces.
//
// Why this exists: every defect in this feature reached Ori first. There are
// 600+ tests and all of them are on pure logic, while every bug of 2026-08-11
// lived in the seam between the logic and the screen — a row with no
// drill-down, income collapsed to one line, categories frozen in localStorage,
// controls overlapping. A logic test cannot see any of those, and nothing could
// reproduce what he was looking at, so he was the test harness and the loop was
// twenty minutes and one paid AI call per iteration.
//
// A fixture is the whole answer. One button writes the run to a local JSON;
// `summarizeRun` turns it back into what the screen would say. From then on a
// fix can be made and checked in seconds, against HIS data, with no run and no
// spend — and the checks below become assertions instead of screenshots.
//
// 🔒 The file holds one household's real transactions. It is written to disk
// locally, is never uploaded anywhere, and must stay out of git.

import {
  reconcile, checkIncomeAgainstDeposits, checkSavingsAgainstDeposits,
  mappingIncome, mappingSurplus,
} from './automapReconcile'
import {
  findAnnualDuplicates, resolveRowTxns, sectionOfCategory, groupByName,
  type GeneratedMapping,
} from './autoMap'
import { detectSavingsDeposits, classifyDeposits } from './automapFlows'
import { cleanDesc } from './automapText'
import { normalizeForLookup } from './normalizeForLookup'
import { isCardSettlement } from './automapBank'
import { declaredMonthlyIncome, declaredIncomeRows, type IntakeRow } from './automapQuestions'
import { categorize } from './categorize'
import type { Transaction } from '@/types/transaction'
import type { BankRow } from './automapBank'
import type { AnnualItem } from './automapAnnual'

export const FIXTURE_VERSION = 1

export interface AutomapRun {
  version:  number
  savedAt:  string
  months:   number
  txns:     Transaction[]
  bankRows: BankRow[]
  fileNames:    string[]
  attachedByQ:  Record<string, string[]>
  txnOverrides: Record<string, string>
  docNames:     string[]
  intakeForm:   Record<string, string>
  intakeRows:   Record<string, IntakeRow[]>
  contextText:  string
  annualItems:  AnnualItem[]
  result:  GeneratedMapping | null
}

/** Everything needed to redraw the screen, minus document bytes. */
export function buildRun(input: Omit<AutomapRun, 'version' | 'savedAt'>): AutomapRun {
  return { version: FIXTURE_VERSION, savedAt: new Date().toISOString(), ...input }
}

export interface RunFinding {
  severity: 'gap' | 'info'
  text: string
}

export interface RunSummary {
  lines:    string[]
  findings: RunFinding[]
}

const money = (n: number) => '₪' + Math.round(n).toLocaleString('he-IL')

/**
 * What the screen would say, as text.
 *
 * Every line here corresponds to something that went wrong at least once, so
 * the summary doubles as the regression list: row counts per section (income
 * collapsed to one), rows without a drill-down (the empty-category bug), rows
 * with no category at all, duplicate charges, duplicate annuals, and the two
 * cross-checks.
 */
export function summarizeRun(run: AutomapRun): RunSummary {
  const lines: string[] = []
  const findings: RunFinding[] = []
  const months = Math.max(1, run.months)

  // A settlement is only a duplicate when the charges behind it were uploaded.
  // With no credit detail it is the household's only record of that spending.
  const hasCreditDetail = run.txns.length > 0

  const overridden = (t: Transaction) => run.txnOverrides[normalizeKey(t.desc)] ?? t.category
  // 🔴 cleanDesc, exactly where the page applies it. A run saved BEFORE the bidi
  // fix still holds the raw descriptions, so without this the replay keeps
  // reproducing the old categorisation and the fix looks like it did nothing.
  const all: Transaction[] = [
    ...run.txns.map(t => ({ ...t, desc: cleanDesc(t.desc), category: overridden(t) })),
    // Bank rows are categorised here exactly as the page does. Defaulting them
    // to 'שונות' instead would report rows as having no detail when the screen
    // shows them perfectly — a summary that lies in the safe direction is still
    // a summary of a screen nobody is looking at.
    ...run.bankRows.filter(b => b.dir === 'out').map(b => {
      const desc = cleanDesc(b.desc)
      return {
        desc, amount: b.amount, originalAmount: null,
        category: run.txnOverrides[normalizeKey(desc)] ?? categorize(desc),
        source: 'עו"ש', notes: '', date: b.date,
        installment: null, isStandingOrder: false, isRefund: false,
      } as Transaction
    }),
  ]
  const deposits = run.bankRows.filter(b => b.dir === 'in').reduce((s, b) => s + b.amount, 0)

  lines.push(`הרצה מ‑${run.savedAt.slice(0, 16).replace('T', ' ')} · ${months} חודשים`)
  lines.push(`${run.txns.length} עסקאות אשראי · ${run.bankRows.length} תנועות עו"ש · ${run.fileNames.length} קבצים`)
  lines.push(`שאלון: ${Object.values(run.intakeForm).filter(v => v.trim()).length} תשובות · ${Object.values(run.attachedByQ).flat().length} קבצים מצורפים`)
  if (run.docNames.length) lines.push(`מסמכים (לא נשמרים): ${run.docNames.join(', ')}`)

  // Duplicate CHARGES — same description, date and amount.
  const byCharge = new Map<string, number>()
  for (const t of all) {
    if (t.isRefund) continue
    const k = `${t.desc}|${t.date}|${t.amount}`
    byCharge.set(k, (byCharge.get(k) ?? 0) + 1)
  }
  const dupCharges = [...byCharge.values()].reduce((s, n) => s + Math.max(0, n - 1), 0)
  if (dupCharges >= 3) {
    findings.push({ severity: 'gap', text: `${dupCharges} חיובים כפולים (אותו תיאור, תאריך וסכום)` })
  }

  if (!run.result) {
    lines.push('אין תוצאה שמורה — רק הקלט נשמר')
    return { lines, findings }
  }
  const r = run.result

  // Sections: how many rows, and can every one of them be opened.
  const sections: { key: 'income' | 'fixed' | 'sub' | 'ins' | 'variable'; label: string }[] = [
    { key: 'income',   label: 'הכנסות' },
    { key: 'fixed',    label: 'קבועות' },
    { key: 'variable', label: 'משתנות' },
    { key: 'sub',      label: 'מנויים' },
    { key: 'ins',      label: 'ביטוחים' },
  ]
  for (const { key, label } of sections) {
    const rows = r[key]
    const total = rows.reduce((s, x) => s + x.amount, 0)
    lines.push(`${label}: ${rows.length} שורות · ${money(total)}`)

    const noCategory = rows.filter(x => !x.category?.trim()).length
    if (noCategory) {
      findings.push({ severity: 'info', text: `${label}: ${noCategory} שורות בלי קטגוריה` })
    }
    if (key === 'fixed' || key === 'sub' || key === 'ins') {
      const blind = rows.filter((_, i) => resolveRowTxns(key, rows, i, all).length === 0).length
      if (blind) {
        findings.push({ severity: 'gap', text: `${label}: ${blind} שורות בלי פירוט שנפתח` })
      }
    }
    if (key === 'income' && rows.length === 1 && deposits > 0) {
      findings.push({ severity: 'gap', text: 'ההכנסות שורה אחת — הפירוט לפי משלם נעלם' })
    }
    if (rows.some(x => x.amount === 0)) {
      findings.push({ severity: 'gap', text: `${label}: יש שורה בלי סכום` })
    }
  }

  lines.push(`שנתיות: ${r.annual.length} שורות · ${money(r.annual.reduce((s, x) => s + x.annualAmount, 0))} לשנה`)
  lines.push(`הלוואות: ${r.debts.length} · תשלומים: ${r.installments.length} · חסכונות ונכסים: ${r.savings.length}`)
  lines.push(`עסקי: ${r.businessIncome.length} הכנסה / ${r.businessExpenses.length} הוצאה`)

  const annualDupes = findAnnualDuplicates(r.annual)
  if (annualDupes.length) {
    findings.push({
      severity: 'gap',
      text: `${annualDupes.length} הוצאות שנתיות כפולות: ` +
        annualDupes.map(g => g.map(i => r.annual[i]?.name).join(' ↔ ')).join(' · '),
    })
  }
  if (r.debts.some(d => d.monthlyPayment > 0 && d.remainingBalance === 0)) {
    findings.push({ severity: 'info', text: 'הלוואה עם החזר ובלי יתרה — לוח סילוקין לא צורף' })
  }

  // The two cross-checks the advisor reads first.
  //
  // 🔴 Settlements are excluded, exactly as the page excludes them. Counting a
  // ₪8,799 card settlement as an expense while the same ₪8,799 is already
  // itemised in the credit report double-counts it — and on a real run that
  // turned a ₪4,105 monthly surplus into a ₪3,127 deficit and reported
  // "₪5,333 of expenses are missing" when nothing was missing at all.
  // A summary that lies about the screen is worse than no summary.
  const bankOut = run.bankRows
    .filter(b => b.dir === 'out' && !(hasCreditDetail && isCardSettlement(b.desc)))
    .reduce((s, b) => s + b.amount, 0)
  const cardCharges = run.txns.reduce((s, t) => s + (t.isRefund ? -t.amount : t.amount), 0)
  const rec = reconcile(r, { bankIn: deposits, bankOut, cardCharges, months })
  lines.push(`הצלבה: ${rec.verdict} · בפועל ${money(rec.actualPerMonth)} מול ${money(rec.mappingPerMonth)} במיפוי`)
  if (rec.verdict !== 'ok') findings.push({ severity: 'gap', text: rec.title })

  const declared = declaredMonthlyIncome(run.intakeRows ?? {})
  const inc = checkIncomeAgainstDeposits(r, {
    deposits, months,
    hasDeclaredIncome: declared > 0 || (run.attachedByQ.payslips ?? []).length > 0,
  })
  if (inc) findings.push({ severity: 'gap', text: inc.title })

  // Declared income that the mapping simply did not carry. A number a person
  // typed and that appears nowhere in the result is the failure the typed tables
  // were built to end, and it is invisible in every total — the mapping just
  // reconciles to a smaller life.
  if (declared > 0) {
    const carried = mappingIncome(r)
    if (carried < declared * 0.85) {
      findings.push({
        severity: 'gap',
        text: `נמסרה הכנסה של ${money(declared)} לחודש, ובמיפוי יש ${money(carried)}`,
      })
    }
  }

  // ── the two flows, replayed against the saved data ──
  //
  // These are computed from the run's own transactions, not read out of the
  // saved result, so the replay says what the CURRENT code would produce. That
  // is the whole point: it is how a fix is checked against Ori's real household
  // without a run and without spend.
  const savings = detectSavingsDeposits(all, months)
  if (savings.deposits.length) {
    lines.push(
      `הפקדות לחיסכון: ${money(savings.monthlyRecurring)} לחודש קבוע` +
      (savings.oneOffTotal > 0 ? ` · ${money(savings.oneOffTotal)} חד־פעמי` : ''),
    )
    const sav = checkSavingsAgainstDeposits(r, { detectedPerMonth: savings.monthlyRecurring })
    if (sav) findings.push({ severity: 'gap', text: sav.title })
  }

  if (declared > 0) {
    const split = classifyDeposits(
      groupByName(run.bankRows.filter(b => b.dir === 'in').map(b => ({
        desc: cleanDesc(b.desc), amount: b.amount, date: b.date,
      }))),
      declaredIncomeRows(run.intakeRows?.incomeMonths),
      months,
    )
    if (split.unexplained.length) {
      findings.push({
        severity: 'gap',
        text: `${money(split.unexplainedMonthly)} לחודש נכנסים לחשבון ואינם מוסברים בשאלון: ` +
          split.unexplained.map(l => l.name).join(', '),
      })
    }
  }

  lines.push(`הכנסה ${money(mappingIncome(r))} · עודף ${money(mappingSurplus(r))} לחודש`)
  return { lines, findings }
}

/**
 * The key the lab stores corrections under. Must stay the same function the
 * page uses — a summary that resolved overrides differently from the screen
 * would report a screen nobody is looking at.
 */
function normalizeKey(desc: string): string {
  return normalizeForLookup(desc) || desc.trim()
}

/** Categories present in the run, for spotting a whole section that vanished. */
export function sectionsPresent(txns: { category: string }[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const t of txns) {
    const s = sectionOfCategory(t.category) ?? 'ללא'
    out[s] = (out[s] ?? 0) + 1
  }
  return out
}
