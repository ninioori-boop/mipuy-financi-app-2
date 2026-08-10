// What the mapping is MISSING — the automap lab's completeness report.
//
// The problem: a mapping built from 60% of a client's financial life looks
// exactly like one built from 95%. Every number that IS present reconciles, the
// validation panel is clean, and nothing anywhere says "there is no source for
// this client's debts". The advisor has no way to know when to stop gathering.
//
// This is the other half of the existing validation panel, and the distinction
// is worth keeping straight:
//   validateMapping  → "is what's here WRONG?"   (needs a result)
//   this file        → "what ISN'T here at all?" (mostly needs only the inputs)
//
// Because most checks need no result, the report is shown BEFORE generation
// too — which is when the advisor can still do something about it. Everything
// here is deterministic; it costs no AI call.
//
// Design rule: a report that fires on everything is a report that stops being
// read. Every check below must stay silent when there is nothing to say, and
// the tests assert both directions.

import type { AnnualItem } from './automapAnnual'

export type CompletenessSeverity = 'gap' | 'info'

export interface CompletenessItem {
  key:      string
  severity: CompletenessSeverity
  title:    string
  detail?:  string
}

export interface CompletenessInput {
  /** Categorized expenses, after every dedicated-block exclusion. */
  expenseTxns:  { amount: number; category: string; isRefund: boolean; date: string }[]
  incomeRows:   { amount: number }[]
  /** Attached PDFs/images — the AI reads these, we can't. */
  docs:         { name: string }[]
  contextText:  string
  reportMonths: number
  detectedMonths: number
  annualItems:  AnnualItem[]
  installments: unknown[]
  settlements:  unknown[]
  /**
   * The questionnaire answers — filled in the lab, or loaded from what the
   * client themself answered. `null` when nothing at all has been answered,
   * which is a different statement from "answered and left these blank"; the
   * checks below keep the two apart so this stays silent on an empty run.
   */
  intakeAnswers?: Record<string, string> | null
  /**
   * How many files are attached to each question, by question id. This is what
   * makes "you said three cards and gave me one report" answerable at all: a
   * plain file count cannot tell a payslip from a statement, but a file sitting
   * in a question's own slot names itself.
   */
  intakeFiles?: Record<string, number>
}

/**
 * The number a person wrote, in digits or in Hebrew words. Returns null when
 * there is no countable answer — "כמה שצריך" is not a number, and guessing one
 * would invent a gap that does not exist.
 */
export function parseCount(text?: string): number | null {
  const s = (text ?? '').trim()
  if (!s) return null
  const digits = s.match(/\d+/)
  if (digits) {
    const n = Number(digits[0])
    return Number.isFinite(n) ? n : null
  }
  const words: Record<string, number> = {
    'אחד': 1, 'אחת': 1, 'שניים': 2, 'שתיים': 2, 'שני': 2, 'שתי': 2,
    'שלושה': 3, 'שלוש': 3, 'ארבעה': 4, 'ארבע': 4, 'חמישה': 5, 'חמש': 5,
    'שישה': 6, 'שש': 6, 'שבעה': 7, 'שבע': 7, 'שמונה': 8, 'תשעה': 9, 'תשע': 9, 'עשרה': 10, 'עשר': 10,
  }
  for (const [w, n] of Object.entries(words)) if (s.includes(w)) return n
  return null
}

/** Categories whose spend is real but whose detail was never captured. */
const UNTRACKED = ['מזומן ללא מעקב', 'ביט ללא מעקב']

/** Below this a gap is not worth an advisor's attention. */
const MIN_MATERIAL = 200

const sumOf = (
  txns: CompletenessInput['expenseTxns'],
  pred: (t: CompletenessInput['expenseTxns'][number]) => boolean,
) => txns.reduce((s, t) => s + (pred(t) ? (t.isRefund ? -t.amount : t.amount) : 0), 0)

/** Months present in the data, sorted. Only ISO dates count. */
function monthsPresent(txns: { date: string }[]): string[] {
  const set = new Set<string>()
  for (const t of txns) if (/^\d{4}-\d{2}-\d{2}$/.test(t.date)) set.add(t.date.slice(0, 7))
  return [...set].sort()
}

/** Calendar months between first and last that have no transactions at all. */
export function missingMonths(txns: { date: string }[]): string[] {
  const present = monthsPresent(txns)
  if (present.length < 2) return []
  const out: string[] = []
  const [fy, fm] = present[0].split('-').map(Number)
  const [ly, lm] = present[present.length - 1].split('-').map(Number)
  const have = new Set(present)
  for (let y = fy, m = fm; y < ly || (y === ly && m <= lm); m === 12 ? (m = 1, y++) : m++) {
    const key = `${y}-${String(m).padStart(2, '0')}`
    if (!have.has(key)) out.push(key)
  }
  return out
}

/** Cheap "did the advisor already tell us about this" check on the free text. */
const mentions = (text: string, words: string[]) =>
  words.some(w => text.includes(w))

export function buildCompletenessReport(input: CompletenessInput): CompletenessItem[] {
  const {
    expenseTxns, incomeRows, docs, contextText, reportMonths, detectedMonths,
    annualItems, installments, settlements,
  } = input

  const items: CompletenessItem[] = []
  const hasData = expenseTxns.length > 0 || incomeRows.length > 0 || docs.length > 0
  if (!hasData) return items          // nothing uploaded yet — nothing to report on

  const months = detectedMonths || reportMonths
  const text = contextText.trim()

  // 1. Coverage of the period.
  const gaps = missingMonths(expenseTxns)
  if (gaps.length) {
    items.push({
      key: 'month-gap', severity: 'gap',
      title: `חסרים נתונים ל${gaps.length === 1 ? 'חודש' : `-${gaps.length} חודשים`}`,
      detail: `${gaps.join(', ')} — יש עסקאות לפני ואחרי, אבל לא בהם.`,
    })
  }
  if (months > 0 && months < 3) {
    items.push({
      key: 'short-window', severity: 'gap',
      title: `החלון קצר: ${months} ${months === 1 ? 'חודש' : 'חודשים'}`,
      detail: 'הוצאות שנתיות ועונתיות כנראה לא מופיעות בו כלל.',
    })
  }

  // 2. Income. The bank deposits are the primary source; a payslip or a note
  //    from the advisor also counts.
  if (!incomeRows.length && !docs.length && !mentions(text, ['משכורת', 'הכנסה', 'שכר', 'קצבה'])) {
    items.push({
      key: 'no-income', severity: 'gap',
      title: 'אין מקור להכנסות',
      detail: 'לא זוהו הפקדות בעו"ש, לא צורף תלוש, ואין אזכור בטקסט החופשי.',
    })
  }

  // 3-4. Debts and savings — a recurring OUTFLOW is visible, but the balance,
  //      interest and remaining term never are. No file shows them; only a
  //      report or the client can.
  const loanRepayment = sumOf(expenseTxns, t => t.category === 'החזר הלוואות')
  if (loanRepayment >= MIN_MATERIAL && !docs.length && !mentions(text, ['הלוואה', 'הלוואות', 'יתרה', 'ריבית'])) {
    items.push({
      key: 'debt-no-detail', severity: 'gap',
      title: 'חוב בלי פרטים',
      detail: `זוהה החזר הלוואות של ${Math.round(loanRepayment / Math.max(1, months))} ש"ח לחודש, אבל אין יתרה, ריבית או מספר תשלומים שנותרו.`,
    })
  }
  const savings = sumOf(expenseTxns, t => t.category === 'חסכונות' || t.category === 'השקעות')
  if (savings >= MIN_MATERIAL && !docs.length && !mentions(text, ['חיסכון', 'חסכון', 'פנסיה', 'קרן', 'צבירה'])) {
    items.push({
      key: 'savings-no-detail', severity: 'gap',
      title: 'חיסכון בלי פרטים',
      detail: `מופקדים ${Math.round(savings / Math.max(1, months))} ש"ח לחודש, אבל אין צבירה, דמי ניהול או סוג המוצר.`,
    })
  }

  // 5. Money that moved with no record of where it went.
  const untracked = sumOf(expenseTxns, t => UNTRACKED.includes(t.category))
  if (untracked >= MIN_MATERIAL) {
    items.push({
      key: 'untracked-cash', severity: 'gap',
      title: `${Math.round(untracked)} ש"ח יצאו בלי מעקב`,
      detail: 'מזומן והעברות ביט שאין להם פירוט. הכסף אמיתי, הקטגוריה לא.',
    })
  }

  // 6. Annual expenses. Only worth raising while the window is too short to
  //    contain them on its own.
  if (!annualItems.length && months < 12) {
    items.push({
      key: 'no-annual', severity: 'gap',
      title: 'לא הוזנו הוצאות שנתיות',
      detail: 'ביטוחים, ארנונה, אגרות חינוך וחופשות לא יופיעו בחלון קצר. מלא את הצ\'קליסט או סמן חיובים חשודים.',
    })
  }

  // 6b. What the client was ASKED and left blank. This is the half a document
  //     can never supply, and the questionnaire turns it from an unknown into a
  //     follow-up: the advisor can go back and ask. Only runs when there IS a
  //     questionnaire — a client who was never sent one has not "skipped" it.
  const ans = input.intakeAnswers
  if (ans) {
    const has = (id: string) => (ans[id] ?? '').trim().length > 0
    const unanswered: string[] = []
    if (!has('bankAccounts'))  unanswered.push('באילו בנקים מתנהלים החשבונות')
    if (!has('oshBalance'))    unanswered.push('יתרות העו"ש')
    if (!has('creditLimits'))  unanswered.push('מסגרות האשראי')
    if (unanswered.length) {
      items.push({
        // Worded for whoever filled it — the advisor types into the same form
        // the client answers, so "הלקוח לא ענה" would be wrong half the time.
        key: 'intake-blank', severity: 'gap',
        title: 'בשאלון עדיין חסר:',
        detail: `${unanswered.join(' · ')} — אלה דברים שהדוחות לא מכילים, אז אין מאיפה להשלים אותם.`,
      })
    }
    // A loan he confirmed having, with no schedule attached, is the single most
    // common hole: the repayment shows in the bank, the balance and rate never do.
    // Once files sit in their own question, "was a schedule attached" is a fact
    // rather than the old guess of "was any document attached at all".
    const files = input.intakeFiles
    const hasSchedule = files ? (files.loanSchedules ?? 0) > 0 : docs.length > 0
    if (ans.hasLoans === 'כן' && !hasSchedule) {
      items.push({
        key: 'loans-no-schedule', severity: 'gap',
        title: 'צוין שיש הלוואות, אבל לא צורף לוח סילוקין',
        detail: 'ההחזר החודשי נראה בעו"ש; היתרה, הריבית ומספר התשלומים שנותרו לא.',
      })
    }

    // ── "you said N, you gave me M" ──
    //
    // The most dangerous gap in the whole tool, because it is invisible: a
    // mapping built from one of three credit cards balances perfectly, reads
    // perfectly, and understates the household's spending by two thirds. The
    // questionnaire is the only place that knows how many there should be.
    if (files) {
      const cardsSaid  = parseCount(ans.creditCardsCount)
      const cardsGot   = files.creditReports ?? 0
      if (cardsSaid !== null && cardsSaid > cardsGot) {
        items.push({
          key: 'cards-missing', severity: 'gap',
          title: `${cardsSaid} כרטיסי אשראי, ${cardsGot === 0 ? 'ולא צורף אף דוח' : `אבל צורפו ${cardsGot} דוחות`}`,
          detail: 'הוצאות של כרטיס שלא הועלה פשוט לא קיימות במיפוי, והוא ייראה תקין בלעדיהן.',
        })
      }

      const banksSaid = parseCount(ans.bankAccounts)
      const banksGot  = files.oshReports ?? 0
      if (banksSaid !== null && banksSaid > banksGot) {
        items.push({
          key: 'accounts-missing', severity: 'gap',
          title: `${banksSaid} חשבונות בנק, ${banksGot === 0 ? 'ולא צורף אף דוח עו"ש' : `אבל צורפו ${banksGot} דוחות`}`,
          detail: 'חשבון חסר מסתיר גם הכנסות וגם הוצאות, ומבטל את ההצלבה מול התנועה בחשבון.',
        })
      }

      // Income has two legal shapes: a payslip, or a self-employed client
      // stating the figure. Neither present means the mapping's income is a
      // guess from deposits, which is exactly where gross/net goes wrong.
      if (!(files.payslips ?? 0) && !(ans.selfEmployedIncome ?? '').trim()) {
        items.push({
          key: 'no-payslip', severity: 'gap',
          title: 'לא צורף תלוש ולא פורטה הכנסה של עצמאי',
          detail: 'בלי אחד מהם ההכנסה נגזרת מהפקדות בלבד, ואין דרך לדעת אם היא ברוטו, נטו, או שתי משכורות שהתערבבו.',
        })
      }
    }
  }

  // 7. What was deliberately moved out of the monthly picture. Informational —
  //    the advisor should be able to see it, not be alarmed by it.
  const moved: string[] = []
  if (settlements.length)  moved.push(`${settlements.length} תשלומי ריכוז אשראי`)
  if (installments.length) moved.push(`${installments.length} עסקאות בתשלומים`)
  const detected = annualItems.filter(a => a.source === 'detected').length
  if (detected)            moved.push(`${detected} חיובים שסומנו כשנתיים`)
  if (moved.length) {
    items.push({
      key: 'moved-out', severity: 'info',
      title: 'הוצאו מההוצאות החודשיות',
      detail: `${moved.join(' · ')} — כל אחד מהם נשלח בבלוק נפרד, כדי שלא ייספר פעמיים.`,
    })
  }

  return items
}
