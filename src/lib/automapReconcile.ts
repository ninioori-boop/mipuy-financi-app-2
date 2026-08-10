// Does the mapping match the money that actually moved?
//
// This is the check the lab never had. Everything else asks whether the mapping
// is internally consistent — whether its own numbers add up, whether a row has
// a category, whether a total matches the block it came from. All of that can be
// perfectly clean on a mapping built from two thirds of a client's life, because
// the third that is missing is missing from BOTH sides of every comparison.
//
// The bank account cannot be argued with. Over the uploaded window, money went
// in and money went out, and the difference is a fact. The mapping makes a claim
// about that same difference: income minus everything it says the household
// spends. When those two disagree by a meaningful amount, something real is
// missing or invented, and until now nothing said so.
//
// This is what would have caught 2026-08-07's worst bug in one second: a salary
// deposit parsed as an expense moves the two sides in OPPOSITE directions, so a
// ₪14,000 error shows up as a ₪28,000 gap.
//
// Deterministic. No AI call, no cost.

import type { GeneratedMapping } from './autoMap'

export interface ReconcileInput {
  /** Bank rows for the whole window. Card settlements must already be removed. */
  bankIn:  number   // total deposits
  bankOut: number   // total withdrawals, EXCLUDING credit-card settlements
  /**
   * Every credit charge in the window, netted for refunds — including
   * installments and one-offs. This is cash that left, whatever the mapping
   * later decided to do with it.
   */
  cardCharges: number
  months: number
}

export type ReconcileVerdict = 'ok' | 'expenses-missing' | 'income-missing' | 'no-bank-data'

export interface ReconcileResult {
  verdict: ReconcileVerdict
  /** What the account actually did, per month. Negative = the account shrank. */
  actualPerMonth: number
  /** What the mapping claims is left over each month. */
  mappingPerMonth: number
  /** mapping − actual, per month. Positive = the mapping is too optimistic. */
  gapPerMonth: number
  /** The gap as a share of monthly income, 0-1. Used to decide materiality. */
  gapShare: number
  title:  string
  detail: string
}

/** Below this, a monthly gap is noise: timing of a charge, a rounding, a lag. */
const MIN_GAP = 400
/** …unless it is also this share of income, which makes even a small one real. */
const MIN_SHARE = 0.05

const sum = <T,>(rows: T[], pick: (r: T) => number) => rows.reduce((s, r) => s + (pick(r) || 0), 0)

/**
 * The mapping's own claim about monthly surplus.
 *
 * Business rows are included on both sides: they are real money moving through
 * the same account, and leaving them out would open a gap the advisor cannot
 * act on. Annual expenses are spread over twelve months, which is what they are.
 */
export function mappingSurplus(r: GeneratedMapping): number {
  const income =
    sum(r.income, x => x.amount) +
    sum(r.businessIncome, x => x.amount)

  const outflow =
    sum(r.fixed,        x => x.amount) +
    sum(r.sub,          x => x.amount) +
    sum(r.ins,          x => x.amount) +
    sum(r.variable,     x => x.amount) +
    sum(r.businessExpenses, x => x.amount) +
    sum(r.annual,       x => x.annualAmount) / 12 +
    sum(r.debts,        x => x.monthlyPayment) +
    sum(r.installments, x => x.monthlyPayment) +
    sum(r.savings,      x => x.monthlyContribution)

  return income - outflow
}

/** Monthly income the mapping claims, used only to scale the gap. */
export function mappingIncome(r: GeneratedMapping): number {
  return sum(r.income, x => x.amount) + sum(r.businessIncome, x => x.amount)
}

export function reconcile(r: GeneratedMapping, input: ReconcileInput): ReconcileResult {
  const months = Math.max(1, input.months)
  const hasBank = input.bankIn > 0 || input.bankOut > 0

  const actualPerMonth  = (input.bankIn - input.bankOut - input.cardCharges) / months
  const mappingPerMonth = mappingSurplus(r)
  const gapPerMonth     = mappingPerMonth - actualPerMonth
  const income          = mappingIncome(r)
  const gapShare        = income > 0 ? Math.abs(gapPerMonth) / income : 0

  // Without a bank statement there is nothing to reconcile against. Saying so is
  // the point: it names the one upload that turns the whole mapping from
  // plausible into checkable.
  if (!hasBank) {
    return {
      verdict: 'no-bank-data', actualPerMonth: 0, mappingPerMonth, gapPerMonth: 0, gapShare: 0,
      title: 'אין דוח עו"ש, אז אין מול מה להצליב',
      detail: 'זו הבדיקה החזקה ביותר על המיפוי: מה שנכנס לחשבון פחות מה שיצא ממנו חייב להסתדר עם העודף שהמיפוי מציג. בלי דוח עו"ש אי אפשר להריץ אותה.',
    }
  }

  const material = Math.abs(gapPerMonth) >= MIN_GAP || (income > 0 && gapShare >= MIN_SHARE)
  if (!material) {
    return {
      verdict: 'ok', actualPerMonth, mappingPerMonth, gapPerMonth, gapShare,
      title: 'המיפוי מסתדר עם התנועה בחשבון',
      detail: `החשבון נע ב‑${money(actualPerMonth)} לחודש, והמיפוי מציג ${money(mappingPerMonth)}. הפער ${money(gapPerMonth)} בגבול הרעש.`,
    }
  }

  // A mapping that is more optimistic than the account means money left and the
  // mapping does not know where. That is the common direction, and it is almost
  // always a whole source of spending that was never uploaded.
  if (gapPerMonth > 0) {
    return {
      verdict: 'expenses-missing', actualPerMonth, mappingPerMonth, gapPerMonth, gapShare,
      title: `חסרות הוצאות של ${money(gapPerMonth)} בחודש`,
      detail: `המיפוי מציג עודף של ${money(mappingPerMonth)} לחודש, אבל בפועל החשבון נע ב‑${money(actualPerMonth)}. ההפרש הוא כסף שיצא ואין לו שורה: כרטיס אשראי שלא הועלה, חשבון בנק נוסף, או מזומן.`,
    }
  }

  // The other direction: the mapping spends more than the account did. Usually
  // double counting, or income that was never captured.
  return {
    verdict: 'income-missing', actualPerMonth, mappingPerMonth, gapPerMonth, gapShare,
    title: `המיפוי "מוציא" ${money(-gapPerMonth)} בחודש יותר מהחשבון`,
    detail: `בפועל החשבון נע ב‑${money(actualPerMonth)} לחודש, והמיפוי מציג ${money(mappingPerMonth)}. או שהכנסה לא נתפסה, או שהוצאה נספרה פעמיים (למשל חיוב שמופיע גם בעו"ש וגם באשראי).`,
  }
}

/** ₪ with a sign, because the direction is the whole message. */
function money(n: number): string {
  const v = Math.round(n)
  return (v < 0 ? '-₪' : '₪') + Math.abs(v).toLocaleString('he-IL')
}
