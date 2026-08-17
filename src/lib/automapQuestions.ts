// The automap lab's questionnaire — the lab's own, and the mapping's schema.
//
// It began as a mirror of the live client form (src/lib/intakeForm.ts, 22
// questions, answered into intake/{uid} with every file tagged by questionId).
// It is no longer a mirror. Ori's rule, 2026-08-11: **a document is only worth
// asking for when nothing else can produce the number.**
//
// Three documents survive that test, and only three:
//   דוח עו"ש · דוחות אשראי · לוחות סילוקין
// Everything else was a report uploaded so a model could read one number off it
// — the salary, the credit score, the portfolio value, the accumulated pension.
// Reading it back was work, it was the part that failed most, and the number was
// always something a person could simply type. So those questions became typed
// fields, and הר הביטוח was dropped altogether: the premiums are already visible
// as charges in the statements.
//
// ⚠️ intakeForm.ts is LIVE and untouched. Clients still see all 22 questions;
// this list is what the ADVISOR fills in the lab. The two ids that route to a
// parser (oshReports, creditReports) are deliberately the live ones, so a file a
// client uploaded through the real form still lands in the right parser — and
// answers a client gave to questions the lab dropped are still forwarded, not
// discarded.
//
// 🔒 Pure by design: no Firebase, no React. The Firestore/Storage side is
// automapIntake.ts, which re-exports everything here. Keep it that way — the
// replay script imports this transitively under Node.

import { INTAKE_QUESTIONS } from './intakeForm'

// ── routing: what IS each file? ──
//
// A file that arrived as the answer to "דוח עו\"ש שלושה חודשים אחורה" IS a bank
// statement — known, not guessed. Guessing produced the worst bug of 2026-08-07:
// every Excel went through the CREDIT parser, and on a bank export a salary
// deposit was counted as an expense.

export type IntakeRoute = 'bank' | 'credit' | 'document'

const ROUTE_BY_QUESTION: Record<string, IntakeRoute> = {
  oshReports:    'bank',
  creditReports: 'credit',
}

/**
 * Where a file should go. Anything not explicitly a statement becomes a document
 * for the model to read — a loan schedule, and whatever a client uploaded to the
 * live form. Unknown ids land there too: a file we cannot place is still worth
 * showing the model, and must never be dropped.
 */
export function routeForQuestion(questionId?: string): IntakeRoute {
  return (questionId && ROUTE_BY_QUESTION[questionId]) || 'document'
}

// ── the lab's question types ──
//
// A superset of the live form's, with one addition: `rows`, a small repeatable
// table. It is what replaced four uploads. "כמה הכנסת בשלושה חודשים" is three
// numbers per earner, and a household has two earners; הר הכסף is a product,
// a balance and two fees, repeated; assets are a name and a value, repeated.
// A single text box would have collapsed each of those into a sentence someone
// then has to parse — which is exactly the step that kept getting it wrong.

export type LabQType = 'phone' | 'text' | 'paragraph' | 'choice' | 'file' | 'rows'

export interface LabColumn {
  key:          string
  label:        string
  /**
   * money/percent render as numeric inputs; the parsing is the same either way.
   * `detail` is free text that gets a full-width box of its own under the row —
   * "מתי נרכש, באיזה מחיר" does not fit in a cell beside a number, and a field
   * too small to write in is a field nobody writes in.
   */
  kind?:        'text' | 'money' | 'percent' | 'detail'
  placeholder?: string
}

export interface LabQuestion {
  id:        string
  type:      LabQType
  label:     string
  hint?:     string
  required?: boolean
  choices?:  string[]
  /** `rows` only — the columns of the little table. */
  columns?:  LabColumn[]
  addLabel?: string
}

/** One row of a `rows` question: column key → what was typed. */
export type IntakeRow = Record<string, string>

export const LAB_QUESTIONS: LabQuestion[] = [
  { id: 'phone',     type: 'phone', label: 'טלפון' },
  { id: 'fullNames', type: 'text',  label: 'השמות המלאים' },

  // No payslip upload. A payslip was uploaded so a model could read the net pay
  // off it — three numbers a person types in ten seconds, read from a picture
  // that also had to be matched against the deposit to avoid counting it twice.
  { id: 'incomeMonths', type: 'rows',
    label:    'הכנסה נטו בשלושת החודשים האחרונים',
    hint:     'שורה לכל מקור: שכר של כל אחד מבני הזוג, קצבה, שכר דירה. המיפוי מקבל את הממוצע, מחושב כאן.',
    addLabel: 'הוסף מקור הכנסה',
    columns: [
      { key: 'name', label: 'מקור ההכנסה', placeholder: 'שכר — שם המעסיק' },
      { key: 'm1',   label: 'חודש א', kind: 'money' },
      { key: 'm2',   label: 'חודש ב', kind: 'money' },
      { key: 'm3',   label: 'חודש ג', kind: 'money' },
    ] },
  { id: 'selfEmployedIncome', type: 'text', label: 'פירוט הכנסה (עצמאים)',
    hint: 'מחזור, משיכת בעלים, וכל מה שמפריד את העסק ממשק הבית' },

  { id: 'bankAccounts', type: 'text', label: 'כמה חשבונות בנק יש, ובאילו בנקים?', required: true },
  { id: 'oshBalance',   type: 'text', label: 'מה היתרה בעו"ש ברגע זה בכל חשבון?' },
  { id: 'oshReports',   type: 'file', label: 'דוח עו"ש שלושה חודשים אחורה, לכל חשבון',
    hint: 'ההפקדות בו נבדקות מול ההכנסה שנמסרה למעלה, ולא נספרות פעמיים. חיובי כרטיס האשראי מוסרים ממנו, כי הפירוט שלהם בדוחות האשראי.' },

  { id: 'creditCardsCount', type: 'text', label: 'כמה כרטיסי אשראי יש?' },
  { id: 'creditLimits',     type: 'text', label: 'מה מסגרת האשראי בכל כרטיס?' },
  { id: 'creditReports',    type: 'file', label: 'דוחות אשראי משלושת החודשים האחרונים, לכל כרטיס' },
  // A screenshot of the score was uploaded so a model could read a three-digit
  // number off it. Typing it makes it certain, and a household has two.
  { id: 'creditScoreSelf',    type: 'text', label: 'ציון דירוג האשראי (מספר)',
    hint: 'מתוך דוח נתוני אשראי, בדרך כלל 0–1000' },
  { id: 'creditScorePartner', type: 'text', label: 'ציון דירוג האשראי של בן/בת הזוג',
    hint: 'אם יש שניים, המיפוי מקבל את הממוצע' },

  { id: 'hasLoans',      type: 'choice', label: 'האם יש הלוואות או משכנתאות פעילות?', choices: ['כן', 'לא'] },
  // The one document with no typed substitute: a balance, a rate and a count of
  // remaining payments, none of which appear anywhere in a bank statement.
  { id: 'loanSchedules', type: 'file', label: 'לוח סילוקין של כל הלוואה ומשכנתה',
    hint: 'המקור היחיד ליתרה, לריבית ולמספר התשלומים שנותרו. אקסל, PDF או צילום.' },

  { id: 'harHaKesefProducts', type: 'rows',
    label:    'קופות וקרנות (הר הכסף)',
    hint:     'שורה לכל מוצר. אין צורך להעלות דוח.',
    addLabel: 'הוסף מוצר',
    columns: [
      { key: 'name',       label: 'שם המוצר',               placeholder: 'קרן השתלמות' },
      // 🔴 The field that turns a guess into a match (Ori, 2026-08-17: "אולי אם
      // הייתי רושם איפה נמצא כל נכס המערכת הייתה מצליחה לזהות?"). She would.
      // On his own run the bank showed five recurring purchases naming their
      // provider — קסם אקטיב, אלטשולר שחם, מגדל, אקסלנס — while the declared
      // products named none, so nothing could be linked: the mapping showed
      // three funds with a balance and no contribution, alongside five
      // contributions with no balance, for the same money.
      { key: 'provider',   label: 'איפה הוא מנוהל?',        placeholder: 'מגדל / אלטשולר שחם / קסם' },
      { key: 'amount',     label: 'כמה צבור בו?',           kind: 'money' },
      // Two fields and not one: הר הכסף states both, the mapping has a column
      // for each, and a single blended number lands in the wrong one about half
      // the time. On a pension the fee that matters is usually the deposit one.
      { key: 'feeDeposit', label: 'דמי ניהול מההפקדה (%)',  kind: 'percent' },
      { key: 'feeBalance', label: 'דמי ניהול מהצבירה (%)',  kind: 'percent' },
    ] },

  // Replaces three uploads at once: the bank securities screenshot, the trading
  // account, and the free-text real-estate note. The note was the worst of them
  // — a value written in a sentence never reached the mapping, which is exactly
  // what Ori reported as "רשמתי שיש לי נדל\"ן, למה זה לא הוסיף את הסכום".
  { id: 'assets', type: 'rows',
    label:    'תיקי השקעות ונכסים',
    hint:     'תיק השקעות בבנק, תיק מסחר עצמאי, קרן כספית, פיקדון, מטבעות דיגיטליים, נדל"ן. סכום אחד לכל נכס, לא פירוט אחזקות.',
    addLabel: 'הוסף נכס',
    columns: [
      { key: 'name',     label: 'שם הנכס',        placeholder: 'תיק השקעות בבנק' },
      { key: 'provider', label: 'איפה הוא מנוהל?', placeholder: 'אקסלנס / קסם אקטיב / בנק הפועלים' },
      { key: 'amount',   label: 'מה השווי?',       kind: 'money' },
      { key: 'detail',   label: 'פירוט',          kind: 'detail',
        placeholder: 'מתי נרכש, באיזה מחיר, אם יש עליו משכנתה' },
    ] },
]

/** The `rows` questions, by id — the ones whose answers live in intakeRows. */
export const ROW_QUESTIONS = LAB_QUESTIONS.filter(q => q.type === 'rows')

/** The two score fields are reported as one averaged line, not two raw ones. */
const SCORE_IDS = new Set(['creditScoreSelf', 'creditScorePartner'])

/** A number as a person types it: "12,500", "₪12500", "0.5%", "1,000". */
export function parseTypedNumber(v?: string): number | null {
  const cleaned = String(v ?? '').replace(/[^\d.,-]/g, '').replace(/,/g, '')
  if (!cleaned || !/\d/.test(cleaned)) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/** A score as a person types it: "720", "720 נקודות", "1,000". */
function parseScore(v?: string): number | null {
  const digits = String(v ?? '').replace(/[^\d]/g, '')
  if (!digits) return null
  const n = Number(digits)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * The one credit score the mapping carries. Two people, two scores, one
 * household — so the average, and the line says so rather than hiding it.
 * Null when neither was given: a made-up score is worse than none.
 */
export function creditScoreLine(answers: Record<string, string>): string | null {
  const self    = parseScore(answers.creditScoreSelf)
  const partner = parseScore(answers.creditScorePartner)
  if (self == null && partner == null) return null
  if (self != null && partner != null) {
    return `  - ציון דירוג אשראי: ${Math.round((self + partner) / 2)} (ממוצע של ${self} ו‑${partner})`
  }
  return `  - ציון דירוג אשראי: ${self ?? partner}`
}

// ── declared income ──
//
// 🔴 The average is computed HERE, in code, over the months that were actually
// filled in. Handing the model three numbers and "take the average" is the same
// class of mistake that produced ₪59,807 of monthly income from a 3-month
// window: arithmetic the code can do is never the model's job.
//
// Dividing by 3 unconditionally would be its own bug — someone who filled one
// month would have their salary cut to a third.

export interface DeclaredIncome {
  name:    string
  monthly: number
  /** The month figures that were actually typed, in order. */
  given:   number[]
}

export function declaredIncomeRows(rows: IntakeRow[] | undefined): DeclaredIncome[] {
  const out: DeclaredIncome[] = []
  for (const r of rows ?? []) {
    const given = ['m1', 'm2', 'm3']
      .map(k => parseTypedNumber(r[k]))
      .filter((n): n is number => n !== null && n > 0)
    if (!given.length) continue
    const name = (r.name ?? '').trim() || 'הכנסה'
    out.push({ name, monthly: given.reduce((s, n) => s + n, 0) / given.length, given })
  }
  return out
}

/** Total monthly income the questionnaire declared. 0 when none was. */
export function declaredMonthlyIncome(rowsById: Record<string, IntakeRow[]>): number {
  return declaredIncomeRows(rowsById?.incomeMonths).reduce((s, r) => s + r.monthly, 0)
}

// ── the questionnaire IS the mapping's schema ──
//
// Every question was written to fill a specific column. Sending "question:
// answer" and leaving the model to work out where it goes is the same guess we
// spent a day replacing with code — so the destination is stated with the answer.
//
// An id with no entry here carries no target line. That is honest: it means the
// answer is context rather than a column, and inventing a destination would be
// worse than leaving it to the model's judgement.

const ANSWER_TARGET: Record<string, string> = {
  bankAccounts:       'bankAccounts[].name — שורה אחת לכל חשבון, עם שם הבנק מהתשובה הזאת ולא מכותרת הדוח',
  oshBalance:         'bankAccounts[].balance — יתרה שלילית = מינוס',
  creditCardsCount:   'creditCards[] — מספר השורות בסעיף',
  creditLimits:       'creditCards[].limit',
  hasLoans:           'debts[] — "לא" פירושו שהסעיף ריק, גם אם יש חיוב שנראה כמו החזר',
  selfEmployedIncome: 'income[] של העצמאי, ואם יש פעילות עסקית — הקלט להפרדת businessIncome ממשק הבית',
  creditScoreSelf:    'creditScore',
  creditScorePartner: 'creditScore (ממוצע בני הזוג, כבר מחושב בשורה שקיבלת)',
  fullNames:          'הקשר בלבד',
  phone:              'הקשר בלבד',
  // Legacy ids — still reachable when a client's LIVE intake is loaded.
  cryptoDetails:      'savings[] — שורה אחת, accumulated = השווי',
  realEstateDetails:  'savings[] — שורה אחת, accumulated = שווי הנכס, monthlyContribution = 0',
}

/** What an attached FILE is for — the section it is the source of. */
const FILE_TARGET: Record<string, string> = {
  oshReports:     'כבר פוענח לבלוקים של ההוצאות וההכנסות; אל תקרא אותו שוב',
  creditReports:  'כבר פוענח לבלוק ההוצאות; אל תקרא אותו שוב',
  loanSchedules:  'debts[].remainingBalance / interestRate / remainingMonths — זה המקור היחיד לשלושתם',
  // Ids the lab no longer asks for, but a client's live intake may still carry.
  payslips:            'אימות בלבד של ההכנסה שנמסרה בשאלון. אל תיצור ממנו שורת income נוספת — התלוש וההפקדה הם אותו כסף',
  securitiesPortfolio: 'savings[] — שורה אחת עם שווי התיק כולו, לא שורה לכל נייר',
  bankId:              'bankAccounts[] ו‑debts[] — תעודת זהות בנקאית מרכזת חשבונות והלוואות',
  harHaKesefReports:   'savings[] — קופות וקרנות, accumulated = הצבירה',
  harHaBituachReport:  'ins[] — הפרמיות החודשיות, שורה אחת לפוליסה',
  otherAssets:         'savings[] — שורה אחת לכל מוצר, accumulated = השווי',
  creditScore:         'creditScore — רק אם אין מספר בשורת "ציון דירוג אשראי"',
}

/** Label for any question id we know of, lab-owned or live-form. */
function questionLabel(id: string): string {
  return LAB_QUESTIONS.find(q => q.id === id)?.label
    ?? INTAKE_QUESTIONS.find(q => q.id === id)?.label
    ?? id
}

/**
 * One line per attached document, naming the question it answered and the
 * column it feeds. The files themselves arrive as images/PDFs with no labels,
 * so without this the model is told "here are four screenshots, good luck".
 */
export function formatIntakeDocs(attachedByQ: Record<string, string[]>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  // Lab order first, then anything only the live form knows about, then ids
  // neither list has ever heard of. Nothing is allowed to disappear.
  const ordered = [...LAB_QUESTIONS.map(q => q.id), ...INTAKE_QUESTIONS.map(q => q.id)]
  for (const id of ordered) {
    if (seen.has(id)) continue
    const names = attachedByQ[id] ?? []
    if (!names.length) continue
    seen.add(id)
    const target = FILE_TARGET[id]
    out.push(`  - ${names.join(', ')} — צורף כתשובה ל"${questionLabel(id)}"${target ? ` → ${target}` : ''}`)
  }
  for (const [id, names] of Object.entries(attachedByQ)) {
    if (seen.has(id) || !names.length) continue
    out.push(`  - ${names.join(', ')} — צורף כתשובה לשאלה "${id}"`)
  }
  return out
}

// ── the answers block the model receives ──

/** One label per answered question, in the questionnaire's own order. */
export function formatIntakeAnswers(answers: Record<string, string>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const q of LAB_QUESTIONS) {
    seen.add(q.id)
    if (q.type === 'file' || q.type === 'rows') continue   // files travel as files, rows have their own block
    if (SCORE_IDS.has(q.id)) continue                      // reported as one averaged line
    const v = (answers[q.id] ?? '').trim()
    if (!v) continue                                       // unanswered says nothing
    const target = ANSWER_TARGET[q.id]
    out.push(`  - ${q.label}: ${v}${target ? `   → ${target}` : ''}`)
  }
  // Answers that came from the client's LIVE intake, to questions the lab
  // stopped asking. They were still answered, and dropping them would lose data
  // the client actually gave us.
  for (const q of INTAKE_QUESTIONS) {
    if (seen.has(q.id) || q.type === 'file') continue
    const v = (answers[q.id] ?? '').trim()
    if (!v) continue
    const target = ANSWER_TARGET[q.id]
    out.push(`  - ${q.label}: ${v}${target ? `   → ${target}` : ''}`)
  }
  const score = creditScoreLine(answers)
  if (score) out.push(`${score}   → ${ANSWER_TARGET.creditScoreSelf}`)
  return out
}

const shekel = (n: number) => Math.round(n).toLocaleString('he-IL')
const pct    = (n: number) => `${n}%`

/**
 * The tables block: income, funds and assets, each already reduced to the
 * number its column wants.
 *
 * 🔴 Every figure here was TYPED by a person. It is not an inference from a
 * document and there is nothing to weigh it against — so each one must appear in
 * the mapping. A number someone bothered to enter and that shows up nowhere is
 * the defect this whole block exists to prevent.
 */
export function formatIntakeRows(rowsById: Record<string, IntakeRow[]>): string[] {
  const out: string[] = []

  const income = declaredIncomeRows(rowsById?.incomeMonths)
  if (income.length) {
    const total = income.reduce((s, r) => s + r.monthly, 0)
    out.push('  הכנסה נטו שנמסרה בשאלון — זהו סעיף income של המיפוי:')
    out.push('  (הממוצע כבר מחושב, לפי החודשים שנמסרו בפועל. אל תחשב מחדש, אל תחלק ואל תכפיל.)')
    for (const r of income) {
      const detail = r.given.length > 1 ? ` (חודשים שנמסרו: ${r.given.map(shekel).join(' · ')})` : ''
      out.push(`  - ${r.name}: ${shekel(r.monthly)} לחודש${detail}   → income[] — שורה בשם המשלם`)
    }
    out.push(`  סה"כ הכנסה חודשית שנמסרה: ${shekel(total)}`)
    out.push('  🔴 ההפקדות שרואים בעו"ש הן אותו כסף. אל תוסיף אותן ואל תיצור שורת הכנסה שנייה לאותו משלם.')
  }

  const funds = (rowsById?.harHaKesefProducts ?? []).filter(r => (r.name ?? '').trim() || parseTypedNumber(r.amount))
  if (funds.length) {
    out.push('  קופות וקרנות שנמסרו (הר הכסף) — כל אחת היא שורה ב‑savings[]:')
    for (const r of funds) {
      const parts: string[] = []
      const amount = parseTypedNumber(r.amount)
      if (amount !== null) parts.push(`צבירה ${shekel(amount)} → accumulated`)
      const fb = parseTypedNumber(r.feeBalance)
      if (fb !== null) parts.push(`דמי ניהול מהצבירה ${pct(fb)} → feeBalance`)
      const fd = parseTypedNumber(r.feeDeposit)
      if (fd !== null) parts.push(`דמי ניהול מהפקדה ${pct(fd)} → feeDeposit`)
      out.push(`  - ${(r.name ?? '').trim() || 'קופה'}: ${parts.join(', ') || 'ללא סכום'}`)
    }
    out.push('  monthlyContribution נשאר 0 אלא אם רואים הפקדה חוזרת בעו"ש לאותה קופה.')
  }

  const assets = (rowsById?.assets ?? []).filter(r => (r.name ?? '').trim() || parseTypedNumber(r.amount))
  if (assets.length) {
    out.push('  תיקי השקעות ונכסים שנמסרו — כל אחד הוא שורה ב‑savings[], accumulated = השווי, monthlyContribution = 0:')
    for (const r of assets) {
      const amount = parseTypedNumber(r.amount)
      // `note` is the pre-2026-08-11 key. A saved run or a half-filled form from
      // before the rename still carries it, and losing what someone wrote about
      // their apartment because a key changed is the exact failure this table
      // was built to end.
      const detail = ((r.detail ?? r.note) ?? '').trim()
      out.push(`  - ${(r.name ?? '').trim() || 'נכס'}: ${amount !== null ? shekel(amount) : 'ללא שווי'}${detail ? ` (${detail})` : ''}`)
    }
    out.push('  🔴 שורה אחת לכל תיק, עם השווי הכולל. אל תפרט אחזקות ואל תיצור שורה לכל נייר ערך.')
  }

  return out
}

/** Rows that carry anything at all — for the meter and the filled-dot. */
export function rowsAnswered(rows: IntakeRow[] | undefined): boolean {
  return (rows ?? []).some(r => Object.values(r).some(v => String(v ?? '').trim()))
}

/** How many questions were actually answered — for the banner and the meter. */
export function countAnswered(
  answers: Record<string, string>,
  rowsById: Record<string, IntakeRow[]> = {},
): number {
  return LAB_QUESTIONS.filter(q =>
    q.type === 'rows' ? rowsAnswered(rowsById[q.id])
    : q.type === 'file' ? false
    : (answers[q.id] ?? '').trim().length > 0,
  ).length
}

// ── the questionnaire as the lab's INPUT surface ──
//
// The lab used to open with one dropzone: drag everything in, and the model
// works out what each file is. That is backwards — it made the format the source
// of truth for what a file MEANS, and the format cannot carry that.
//
// So the input is the questionnaire itself. Each question is its own slot, and a
// file dropped into a slot is tagged with that question before it is parsed.
//
// Grouping is presentation only, and is DELIBERATELY not exhaustive: a question
// added above and not listed here lands in the trailing group rather than
// disappearing from the screen. A silently missing question is the same failure
// class as a silently dropped file.

export interface IntakeGroup {
  title:     string
  questions: LabQuestion[]
}

/** Ordered display groups, by question id. Ids that don't exist are ignored. */
const GROUP_IDS: { title: string; ids: string[] }[] = [
  { title: 'מי הלקוח',       ids: ['fullNames', 'phone'] },
  { title: 'הכנסות',         ids: ['incomeMonths', 'selfEmployedIncome'] },
  { title: 'חשבונות בנק',    ids: ['bankAccounts', 'oshBalance', 'oshReports'] },
  { title: 'אשראי',          ids: ['creditCardsCount', 'creditLimits', 'creditReports', 'creditScoreSelf', 'creditScorePartner'] },
  { title: 'הלוואות',        ids: ['hasLoans', 'loanSchedules'] },
  { title: 'חסכונות ונכסים', ids: ['harHaKesefProducts', 'assets'] },
]

export function groupIntakeQuestions(questions: LabQuestion[] = LAB_QUESTIONS): IntakeGroup[] {
  const byId = new Map(questions.map(q => [q.id, q]))
  const used = new Set<string>()
  const groups: IntakeGroup[] = []

  for (const g of GROUP_IDS) {
    const qs = g.ids.map(id => byId.get(id)).filter((q): q is LabQuestion => !!q)
    for (const q of qs) used.add(q.id)
    if (qs.length) groups.push({ title: g.title, questions: qs })
  }

  const rest = questions.filter(q => !used.has(q.id))
  if (rest.length) groups.push({ title: 'נוסף', questions: rest })

  return groups
}
