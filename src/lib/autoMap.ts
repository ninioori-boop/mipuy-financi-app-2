// Auto-mapping sandbox: the home-economist methodology prompt, the generated
// mapping schema (matching mappingStore row shapes, minus ids), and a safe parser.
// Framework-free so the API route (server) and the page (client) can both import it.
// This is the file we TUNE over time to improve mapping quality.

import {
  ALL_CATEGORIES,
  FIXED_CATEGORIES, VAR_CATEGORIES, ANNUAL_CATEGORIES,
  INSURANCE_CATEGORIES, SUB_CATEGORIES, SKIP_CATEGORIES,
} from '@/lib/constants'
import { BRAND } from '@/lib/brand'
import { normalizeForLookup } from '@/lib/normalizeForLookup'

// Optional per-row meta. confidence quantifies the AI's certainty;
// source is a short free-text label of where the row came from
// (e.g. "אשראי", "PDF: תלוש שכר", "תמונה: ביטוח רכב", "הערה");
// category is the parent ALL_CATEGORIES entry — used by the UI to
// surface the underlying credit transactions under each row group
// (the advisor can drill from "סופרמרקטים 1800" back to the actual
// shufersal/rami-levy lines that summed to it).
// All three are optional so older generated results keep working.
export type GenConfidence = 'high' | 'medium' | 'low'
export interface GenRowMeta {
  confidence?: GenConfidence
  source?:     string
  category?:   string
  /**
   * Set locally when the advisor confirms a row in the review queue — never by
   * the model. Optional, so drafts saved before it existed keep loading.
   */
  reviewed?:   boolean
}

export interface GenSimpleRow extends GenRowMeta { name: string; amount: number }
export interface GenAnnualRow extends GenRowMeta { name: string; annualAmount: number }
export interface GenDebtRow extends GenRowMeta {
  name: string; originalBalance: number; remainingBalance: number
  interestRate: number; remainingMonths: number; monthlyPayment: number
}
export interface GenInstallmentRow extends GenRowMeta {
  name: string; totalAmount: number; monthlyPayment: number
  paidCount: number; totalCount: number
}
export interface GenSavingRow extends GenRowMeta {
  name: string; monthlyContribution: number; accumulated: number
  feeBalance: number; feeDeposit: number
}
// Point-in-time client facts (mirror mappingStore's CreditCardRow / BankAccountRow),
// so the lab opens with the same profile snapshot as the manual mapping tab.
export interface GenCreditCard extends GenRowMeta { name: string; limit: number; chargeDay: number }
export interface GenBankAccount extends GenRowMeta { name: string; balance: number; overdraftLimit: number }

export interface GeneratedMapping {
  creditScore:  number
  creditCards:  GenCreditCard[]
  bankAccounts: GenBankAccount[]
  income:       GenSimpleRow[]
  fixed:        GenSimpleRow[]
  sub:          GenSimpleRow[]
  ins:          GenSimpleRow[]
  variable:     GenSimpleRow[]
  annual:       GenAnnualRow[]
  debts:        GenDebtRow[]
  installments: GenInstallmentRow[]
  savings:      GenSavingRow[]
  assessment:   string
}

const list = (s: Set<string>) => [...s].join(', ')

// ── Which mapping section a category belongs to ──
//
// This split is DETERMINISTIC in constants.ts, yet the prompt used to hand the
// model 44 category names and expect it to remember which are fixed, which are
// variable and which are insurance. Rows landing in the wrong section was the
// most common error the advisor reported. We already know the answer, so we
// state it — in the data block (the [tag] before each category) and in the
// lab's row editor (picking a category moves the row). One source of truth for
// both, so the tag the model reads and the move the advisor makes cannot drift.

export type MappingSection = 'income' | 'fixed' | 'variable' | 'sub' | 'ins' | 'annual' | 'skip'

export const SECTION_LABEL_HE: Record<MappingSection, string> = {
  income:   'הכנסה',
  fixed:    'קבועות',
  variable: 'משתנות',
  sub:      'מנויים',
  ins:      'ביטוחים',
  annual:   'שנתיות',
  skip:     'לא הוצאה',
}

/** The section a category belongs to, or null when it isn't in any group. */
export function sectionOfCategory(cat: string): MappingSection | null {
  if (!cat) return null
  // 'הכנסות' lives in SKIP_CATEGORIES (it is not an expense) but it IS the
  // income section — checked first so a misfiled salary row can be moved there.
  if (cat === 'הכנסות')            return 'income'
  if (FIXED_CATEGORIES.has(cat))    return 'fixed'
  if (VAR_CATEGORIES.has(cat))      return 'variable'
  if (SUB_CATEGORIES.has(cat))      return 'sub'
  if (INSURANCE_CATEGORIES.has(cat)) return 'ins'
  if (ANNUAL_CATEGORIES.has(cat))   return 'annual'
  if (SKIP_CATEGORIES.has(cat))     return 'skip'
  return null
}

// ── Installments and standing orders ──
//
// extractTransactions already parses "3 מתוך 12" out of the notes column into
// `installment`, and flags standing orders — and none of it was ever sent. We
// were meanwhile asking the model to fill an `installments` section with
// paidCount / totalCount / totalAmount, which it had no data for and therefore
// had to invent, exactly like the sub-row splits before 2026-08-07.
//
// A charge in installments is NOT also a variable expense: the mapping keeps
// them in separate buckets and the page's monthlyExpense already adds the two.
// So these transactions leave the expense set (see isInstallment below) — the
// one rule that keeps every block's numbers reconcilable.

export interface InstallmentLine {
  name:           string
  monthlyPayment: number   // the recurring charge
  paidCount:      number   // highest "current" seen in the uploaded period
  totalCount:     number
  totalAmount:    number   // full purchase price, when the file carried it
}

/** True when a transaction is one leg of an installment plan. */
export function isInstallment(t: { installment: { current: number; total: number } | null }): boolean {
  return !!t.installment && t.installment.total > 1
}

/**
 * Group installment legs by merchant. The uploaded window shows only some of
 * the legs, so paidCount is the highest leg number present — that is what the
 * client has actually paid by the end of the period.
 */
export function buildInstallments(
  txns: {
    desc: string; amount: number; originalAmount: number | null; isRefund: boolean
    installment: { current: number; total: number } | null
  }[],
): InstallmentLine[] {
  const map = new Map<string, InstallmentLine>()
  for (const t of txns) {
    if (t.isRefund || !isInstallment(t)) continue
    const key = normalizeForLookup(t.desc) || t.desc.trim()
    if (!key) continue
    const line = map.get(key) ?? {
      name: t.desc.trim() || key, monthlyPayment: 0, paidCount: 0, totalCount: 0, totalAmount: 0,
    }
    line.monthlyPayment = Math.max(line.monthlyPayment, t.amount)
    line.paidCount      = Math.max(line.paidCount, t.installment!.current)
    line.totalCount     = Math.max(line.totalCount, t.installment!.total)
    line.totalAmount    = Math.max(line.totalAmount, t.originalAmount ?? 0)
    map.set(key, line)
  }
  return [...map.values()].sort((a, b) => b.monthlyPayment - a.monthlyPayment)
}

/**
 * Merchants charging by standing order. The strongest signal we have for
 * fixed-vs-variable, and until now we kept it to ourselves.
 */
export function buildStandingOrders(
  txns: { desc: string; isStandingOrder: boolean; isRefund: boolean }[],
): string[] {
  const seen = new Map<string, string>()
  for (const t of txns) {
    if (t.isRefund || !t.isStandingOrder) continue
    const key = normalizeForLookup(t.desc) || t.desc.trim()
    if (key && !seen.has(key)) seen.set(key, t.desc.trim() || key)
  }
  return [...seen.values()]
}

export function formatInstallments(lines: InstallmentLine[]): string[] {
  if (!lines.length) return []
  const out = ['(כבר הוסרו מבלוק ההוצאות — אל תספור אותם שוב שם)']
  for (const l of lines) {
    const total = l.totalAmount > 0 ? `, סכום עסקה מלא ${Math.round(l.totalAmount)}` : ''
    out.push(`  - ${short(l.name)}: ${Math.round(l.monthlyPayment)} לחודש, תשלום ${l.paidCount} מתוך ${l.totalCount}${total}`)
  }
  return out
}

export function formatStandingOrders(names: string[]): string[] {
  if (!names.length) return []
  return [`(חיובים אלה מזוהים כהוראת קבע — סימן חזק שהם קבועים ולא משתנים)`,
    ...names.map(n => `  - ${short(n)}`)]
}

// ── Merchant-level breakdown of the parsed transactions ──
//
// The prompt below asks the model to split a big variable category into named
// sub-rows ("מזון לבית 2500" → "סופרמרקטים 1800, מאפיות 300"). Until 2026-08-07
// we sent it ONLY per-category totals, so it had no merchant data to split on
// and had to invent the division — undetectably, since the parts always summed
// back to the right total. This builds the missing input: within each category,
// the actual merchants and what they cost.
//
// Refunds NET and don't count, exactly as the credit/import tabs and the page's
// own catTotals do, so every number the model sees matches every number the
// advisor sees.

export interface MerchantLine {
  /**
   * Normalized identity — the same key the categorizer groups on. Callers that
   * need to point back at a merchant's transactions (confirming a one-off
   * charge as annual, for instance) must use THIS, not `name`: re-normalizing
   * the display name happens to work today and would break the moment the
   * display name stops being a raw description.
   */
  key:   string
  name:  string   // the merchant as it appeared in the file (first spelling seen)
  sum:   number
  count: number
}
export interface CategoryBreakdown {
  category:  string
  sum:       number
  count:     number
  merchants: MerchantLine[]
  /** Merchants past the per-category cap, folded into one line. null if none. */
  other:     { merchants: number; sum: number; count: number } | null
}

// Per-category merchant cap, tried in order. A long tail of one-off merchants
// adds tokens without adding signal, and the whole message must stay under the
// route's MAX_MESSAGE_LEN (40,000). We step the cap down until the total number
// of merchant lines fits MAX_MERCHANT_LINES.
const MERCHANT_CAPS      = [15, 10, 6, 3]
const MAX_MERCHANT_LINES = 250

export function buildCategoryBreakdown(
  txns: { desc: string; amount: number; category: string; isRefund: boolean }[],
  /**
   * Categories that get a merchant list. Everything else contributes to its
   * category total but is emitted as a single line. Production passes
   * VAR_CATEGORIES: the prompt says fixed/sub/ins/annual stay one row per
   * category, and printing merchants for them invited the model to split those
   * too. Omit to detail every category (tests, future callers).
   */
  detailCategories?: Set<string>,
): CategoryBreakdown[] {
  // category → merchantKey → line
  const byCat = new Map<string, Map<string, MerchantLine>>()
  const totals = new Map<string, { sum: number; count: number }>()

  for (const t of txns) {
    // Group by the same normalized form the categorizer uses, so the two views
    // of a merchant never disagree. Fall back to the raw desc when it
    // normalizes to nothing ("סניף 5" and "- 12" both do).
    const key = normalizeForLookup(t.desc) || t.desc.trim()
    // Resolved BEFORE the totals below: a row we cannot attribute to a merchant
    // must not land in the category total either, or the header would claim an
    // amount that no printed line accounts for — and the prompt tells the model
    // the parts must equal the total. Today extractTransactions never yields an
    // empty desc; this keeps the invariant true for any future producer.
    if (!key) continue

    const signed = t.isRefund ? -t.amount : t.amount

    const tot = totals.get(t.category) ?? { sum: 0, count: 0 }
    tot.sum += signed
    if (!t.isRefund) tot.count++
    totals.set(t.category, tot)

    if (detailCategories && !detailCategories.has(t.category)) continue
    const merchants = byCat.get(t.category) ?? new Map<string, MerchantLine>()
    const line = merchants.get(key) ?? { key, name: t.desc.trim() || key, sum: 0, count: 0 }
    line.sum += signed
    if (!t.isRefund) line.count++
    merchants.set(key, line)
    byCat.set(t.category, merchants)
  }

  // Pick the largest cap whose total line count fits the budget.
  const sizes = [...byCat.values()].map(m => m.size)
  const cap =
    MERCHANT_CAPS.find(c => sizes.reduce((s, n) => s + Math.min(n, c), 0) <= MAX_MERCHANT_LINES)
    ?? MERCHANT_CAPS[MERCHANT_CAPS.length - 1]

  const out: CategoryBreakdown[] = []
  for (const [category, tot] of totals) {
    const all = [...(byCat.get(category)?.values() ?? [])].sort((a, b) => b.sum - a.sum)
    const kept = all.slice(0, cap)
    const rest = all.slice(cap)
    out.push({
      category,
      sum:   tot.sum,
      count: tot.count,
      merchants: kept,
      other: rest.length
        ? {
            merchants: rest.length,
            sum:   rest.reduce((s, m) => s + m.sum, 0),
            count: rest.reduce((s, m) => s + m.count, 0),
          }
        : null,
    })
  }
  return out.sort((a, b) => b.sum - a.sum)
}

// ── Bank deposits (income) and card settlements ──
//
// Kept separate from the category breakdown on purpose. Income has no expense
// category, and formatCategoryBreakdown's header talks about refund netting,
// which is meaningless for a salary. Settlements are shown so the advisor can
// see what was excluded rather than having it vanish silently.

export interface NamedTotal { name: string; sum: number; count: number }

/** Group by merchant (same normalization as everywhere else), biggest first. */
export function groupByName(rows: { desc: string; amount: number }[], cap = 25): NamedTotal[] {
  const map = new Map<string, NamedTotal>()
  for (const r of rows) {
    const key = normalizeForLookup(r.desc) || r.desc.trim()
    if (!key) continue
    const line = map.get(key) ?? { name: r.desc.trim() || key, sum: 0, count: 0 }
    line.sum += r.amount
    line.count++
    map.set(key, line)
  }
  const all = [...map.values()].sort((a, b) => b.sum - a.sum)
  if (all.length <= cap) return all
  const rest = all.slice(cap)
  return [
    ...all.slice(0, cap),
    {
      name:  `שאר ההפקדות (${rest.length})`,
      sum:   rest.reduce((s, m) => s + m.sum, 0),
      count: rest.reduce((s, m) => s + m.count, 0),
    },
  ]
}

/** Renders deposits as the income block. Amounts are PERIOD totals, like everything else. */
export function formatIncomeBreakdown(lines: NamedTotal[], months = 1): string[] {
  if (!lines.length) return []
  const span = months > 1 ? `על פני ${months} חודשים` : 'על פני חודש אחד'
  const out = [`(סך ההפקדות ${span}. חלק במספר החודשים כדי לקבל הכנסה חודשית)`]
  for (const l of lines) out.push(`  - ${short(l.name)}: ${Math.round(l.sum)} (${l.count} הפקדות)`)
  return out
}

/**
 * How many distinct calendar months the uploaded transactions actually cover.
 *
 * The "מספר חודשים" field is a single point of failure: it drives the prompt AND
 * the validation cross-check, it defaults to 1, and the advisor's habitual
 * export is 3 months. Get it wrong and the model returns period totals as
 * monthly figures — a 3× inflated mapping that nothing downstream can detect,
 * because every number is then self-consistent. This lets the UI check the
 * advisor's answer against the files.
 *
 * Returns 0 when the dates are unusable: extractTransactions emits YYYY-MM-DD
 * only when the cell parsed as a real Date, otherwise it passes the raw string
 * through, so anything that isn't ISO is not counted rather than guessed at.
 */
export function detectMonthSpan(txns: { date: string }[]): number {
  const months = new Set<string>()
  for (const t of txns) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(t.date)) months.add(t.date.slice(0, 7))
  }
  return months.size
}

// Merchant descriptions from credit files carry trailing junk (terminal ids,
// addresses) that adds tokens without adding meaning. Truncating also puts a
// hard ceiling on the block: MAX_MERCHANT_LINES × ~60 chars ≈ 15KB, comfortably
// inside the route's 40,000-char MAX_MESSAGE_LEN even with a long advisor note.
const MAX_MERCHANT_NAME = 40
const short = (s: string) => (s.length > MAX_MERCHANT_NAME ? s.slice(0, MAX_MERCHANT_NAME - 1) + '…' : s)

// Refunds net, so a return with no matching charge in the uploaded period makes
// a merchant — or a whole category — go negative, with a transaction count of
// zero. "איקאה: -4500 (0)" is not something a model can reason about, and the
// prompt's "the parts equal the total" rule then pushes it to book a negative
// expense. Every such line is labelled instead of left as a bare number.
const countLabel = (c: number) => (c > 0 ? `${c}` : 'זיכוי בלבד')

/**
 * Renders the breakdown as the Hebrew text block the model receives.
 * `months` is stated on the header because every figure here is a PERIOD total
 * across the uploaded files, while the mapping the model returns is monthly.
 */
export function formatCategoryBreakdown(rows: CategoryBreakdown[], months = 1): string[] {
  const lines: string[] = []
  const span = months > 1 ? `סך הכל על פני ${months} חודשים` : 'סך הכל על פני חודש אחד'
  lines.push(`(כל הסכומים כאן הם ${span}, אחרי קיזוז זיכויים)`)
  for (const r of rows) {
    const neg = r.sum < 0 ? ' — נטו שלילי: הוחזר יותר ממה שחויב בתקופה' : ''
    // The [tag] is the category's section, stated rather than left to memory.
    const sec = sectionOfCategory(r.category)
    const tag = sec ? `[${SECTION_LABEL_HE[sec]}] ` : ''
    lines.push(`${tag}${r.category}: ${Math.round(r.sum)} ש"ח (${r.count} עסקאות)${neg}`)
    for (const m of r.merchants) {
      lines.push(`  - ${short(m.name)}: ${Math.round(m.sum)} (${countLabel(m.count)})`)
    }
    if (r.other) {
      lines.push(`  - שאר בתי העסק (${r.other.merchants}): ${Math.round(r.other.sum)} (${countLabel(r.other.count)})`)
    }
  }
  return lines
}

// ── "כללי המיפוי של הכלכלן של הבית" (v1) — server-owned, tuned over time ──
export const AUTOMAP_SYSTEM_PROMPT = `אתה "${BRAND.nameHe}" — יועץ פיננסי מומחה לשוק הישראלי. תפקידך: לקבל את כל נתוני הלקוח (עסקאות אשראי, תנועות עו"ש, הלוואות, תשלומים, נכסים, חיסכון, וטקסט חופשי) ולבנות **מיפוי חודשי שלם** — חלוקה מסודרת של ההכנסות וההוצאות לסעיפים.

## פורמט התשובה — לפני כל דבר אחר
**התו הראשון בתשובה שלך חייב להיות \`{\`.** אל תכתוב מילת פתיחה, אל תתאר מה אתה עומד לעשות, ואל תסביר את הניתוח. כל טקסט לפני ה‑JSON גוזל מתקציב הפלט ועלול לקטוע את המיפוי באמצע. הניתוח שלך שייך לתוכן ה‑JSON, לא לפתיח שלפניו.

## הסעיפים והסיווג
שייך כל הוצאה לסעיף לפי הקטגוריה:
- **fixed (קבועות)**: ${list(FIXED_CATEGORIES)}
- **variable (משתנות)**: ${list(VAR_CATEGORIES)}
- **sub (מנויים)**: ${list(SUB_CATEGORIES)}
- **ins (ביטוחים)**: ${list(INSURANCE_CATEGORIES)}
- **annual (שנתיות)**: ${list(ANNUAL_CATEGORIES)}
- **income (הכנסות)**: משכורות, קצבאות, הכנסה נוספת.
- **debts (חובות)**: הלוואות עם יתרה והחזר חודשי.
- **installments (תשלומים)**: רכישות בתשלומים (X מתוך Y).
- **savings (חיסכון)**: הפקדות לחיסכון/פנסיה/קרנות.

## תמונת מצב הלקוח (נתונים נקודתיים — לא חודשיים)
אם הנתונים כוללים אותם, חלץ גם:
- **creditScore (ציון דירוג אשראי)**: מספר בודד (בד"כ 0–1000) מתוך דוח נתוני אשראי. אם אין — 0.
- **creditCards (כרטיסי אשראי)**: לכל כרטיס — name (שם/סוג), limit (מסגרת האשראי ב‑₪), chargeDay (יום החיוב בחודש 1–28; אם לא ידוע השאר 2).
- **bankAccounts (חשבונות עו"ש)**: לכל חשבון — name, balance (יתרה נוכחית; שלילי = מינוס/אוברדראפט), overdraftLimit (מסגרת אוברדראפט ב‑₪).
אלה נתוני מצב רגעיים ולא חלק מהתזרים החודשי. אם אין נתונים — החזר מערך ריק / 0.

השתמש אך ורק בשמות קטגוריות מתוך הרשימה הבאה כשמתאים: ${ALL_CATEGORIES.join(', ')}. אל תמציא קטגוריות.

## כללי חישוב
- כל הסכומים ב‑income/fixed/sub/ins/variable הם **חודשיים** (ממוצע). אם הנתונים מכסים כמה חודשים — חלק במספר החודשים שצויין.
- annual: סכום **שנתי** (הסכום בפועל לשנה, לא ×12 של חד‑פעמי).
- מספרים בלבד (ללא ₪ וללא פסיקים).

## מבנה הנתונים שאתה מקבל
- **בלוק ההוצאות** — קטגוריות ובתי עסק. לפני כל קטגוריה מופיע תג בסוגריים מרובעות, למשל \`[קבועות]\` או \`[משתנות]\`. **התג הוא הסעיף שאליו הקטגוריה שייכת. השתמש בו כמו שהוא ואל תחליט לבד** לאיזה סעיף שורה הולכת.
- **בלוק ההכנסות** — הפקדות שזוהו בעו"ש. זה המקור העיקרי לסעיף income. אם הוא קיים, אל תנחש הכנסות ממקום אחר.
- **בלוק תשלומי הריכוז** — תשלומים לחברות האשראי. הם **כבר הוסרו** מבלוק ההוצאות, כי הפירוט האמיתי שלהם נמצא שם. הם מוצגים לידיעה בלבד — **אל תוסיף אותם כהוצאה**.
- **בלוק התשלומים** — עסקאות בתשלומים, עם מספר התשלום מתוך הסך ועם הסכום המלא. זה המקור לסעיף installments. הם **כבר הוסרו** מבלוק ההוצאות — אל תכניס אותם גם ל‑variable או ל‑fixed.
- **בלוק הוראות הקבע** — בתי עסק שמחייבים בהוראת קבע. השתמש בזה כדי להכריע קבוע מול משתנה. הם **כן** נספרים בבלוק ההוצאות, זה רק סימון.
- **בלוק ההוצאות השנתיות** — סכומים **שנתיים** שהיועץ אישר. זה המקור לסעיף annual. אל תחלק אותם ב‑12, ואל תוסיף אותם לשום סעיף חודשי. אלה שמסומנים "כבר הוסר" גם לא נמצאים בבלוק ההוצאות.

## כללי אנטי‑כפילות (קריטי)
- התעלם מ: העברות בין חשבונות, ומשיכות מזומן ללא פירוט (אלא אם צוין).
- **זיכויים כבר מקוזזים בנתונים שקיבלת** — אל תחסיר אותם שוב. שורה עם סכום שלילי או עם "זיכוי בלבד" פירושה שבתקופה הזו הוחזר יותר ממה שחויב. אל תיצור שורת הוצאה שלילית: החזר 0 לאותה שורה, וציין את זה ב‑assessment.
- קטגוריות שאינן הוצאה (${list(SKIP_CATEGORIES)}) — אל תכניס כהוצאה; הכנסות לך ל‑income.

## פירוט הוצאות משתנות (variable)
שבר כל קטגוריה גדולה של variable למספר שורות מפורטות לפי תת‑סוג / סוג ספק / הקשר — לא שורה אחת כללית. זה נותן ליועץ תמונה ברורה של איפה הכסף הולך בפועל.

דוגמאות:
- במקום "מזון לבית 2500" → "סופרמרקטים 1800", "פירות וירקות 400", "מאפיות 300".
- במקום "אוכל בחוץ ובילויים 1200" → "מסעדות 600", "משלוחים 350", "בתי קפה 150", "בילויים 100".
- במקום "דלק וחניה 900" → "תדלוק 700", "חניונים 200".
- במקום "תחביבים 600" → אם ניתן, לזהות את הסוג: "ספרים 200", "מנוי לקולנוע 50", "חוגים 350".

חוקי שבירה:
- **שבור אך ורק קטגוריות של variable.** ל‑fixed/sub/ins/annual החזר תמיד שורה אחת לקטגוריה, גם אם במקרה קיבלת עבורן פירוט (חיובים מובהקים).
- **בסס את השבירה אך ורק על רשימת בתי העסק שקיבלת תחת אותה קטגוריה.** מתחת לכל קטגוריה מופיעות שורות "- שם בית עסק: סכום (מספר עסקאות)" — אלה הנתונים האמיתיים. קבץ אותן לתת‑סוגים הגיוניים (למשל שופרסל + רמי לוי + ויקטורי → "סופרמרקטים") וסכם את הסכומים שלהן.
- **אם לקטגוריה לא מופיעה רשימת בתי עסק — אל תשבור אותה.** החזר שורה אחת ברמת הקטגוריה. אסור להמציא חלוקה שאין לה כיסוי בנתונים, גם אם הסכומים מסתכמים נכון.
- השורה "שאר בתי העסק (N)" מייצגת זנב של בתי עסק קטנים שלא פורטו. שים אותה בשורה כללית של הקטגוריה, אל תנחש מה יש בתוכה.
- שייך כל שורה לאותה קטגוריה ראשית (השם בעמודת ה‑name יכול להיות תיאורי, אבל הסיווג נשאר משתנה).
- **שמור על היחס, לא על המספר.** הסכומים ברשימה הם סך התקופה. סכום השורות המפורטות של "מזון לבית" **חלקי מספר החודשים** הוא הסכום החודשי שאתה מחזיר. אם קיבלת "מזון לבית: 7500" על פני 3 חודשים — השורות שתחזיר חייבות להסתכם ל‑2500, לא ל‑7500.

## אמינות ומקור (confidence + source) — שדות חובה בכל שורה
לכל שורה הוסף שני שדות אופציונליים שעוזרים ליועץ לדעת איפה לבדוק לעומק:

**confidence** (אמינות הנתון) — בחר אחד מ:
- "high" — הסכום נלקח ישירות משורה ברורה בקובץ (תא ב‑Excel, שורה מסומנת בדוח PDF, סיכום שאתה רואה בבירור).
- "medium" — חישוב/ממוצע ממספר עסקאות, או זיהוי מתמונה איכותית. סביר, אך לא ישיר.
- "low" — הסקה מהקשר, מטקסט חופשי של היועץ בלבד, או ניחוש מבוסס‑כלל.

**source** (מקור) — מחרוזת קצרה בעברית שמתארת מאיפה הנתון הגיע. דוגמאות:
- "אשראי" / "עו"ש" / "תלוש שכר" / "דוח הלוואה"
- "PDF: דוח שנתי 2025" / "תמונה: ביטוח רכב"
- "הערה מהיועץ" / "הסקה מהקשר"

**category** (קטגוריה ראשית) — לכל שורת הוצאה/הכנסה: ציין את הקטגוריה הראשית מ‑ALL_CATEGORIES שאליה השורה שייכת. זה קריטי במיוחד ל‑variable: כאשר אתה שובר את "מזון לבית" לשלוש שורות ("סופרמרקטים", "פירות וירקות", "מאפיות") — כל אחת מהן חייבת לקבל category="מזון לבית". זה מאפשר לממשק לקבץ את השורות מאחורי הקטגוריה הראשית ולהציג את העסקאות הגולמיות שהוליכו לסיכום.

החזרה של שלושת השדות **רצויה לכל שורה**. אם באמת אינך יכול לקבוע — דלג עליהם (יופיע בממשק כ‑"לא צוין").

## פלט
החזר **JSON תקין בלבד**, ללא טקסט נוסף, במבנה המדויק הזה (מערך ריק אם אין):
{
  "creditScore":0,
  "creditCards":[{"name":"","limit":0,"chargeDay":2,"confidence":"high","source":""}],
  "bankAccounts":[{"name":"","balance":0,"overdraftLimit":0,"confidence":"high","source":""}],
  "income":[{"name":"","amount":0,"confidence":"high","source":"","category":""}],
  "fixed":[{"name":"","amount":0,"confidence":"high","source":"","category":""}],
  "sub":[{"name":"","amount":0,"confidence":"high","source":"","category":""}],
  "ins":[{"name":"","amount":0,"confidence":"high","source":"","category":""}],
  "variable":[{"name":"","amount":0,"confidence":"high","source":"","category":""}],
  "annual":[{"name":"","annualAmount":0,"confidence":"high","source":"","category":""}],
  "debts":[{"name":"","originalBalance":0,"remainingBalance":0,"interestRate":0,"remainingMonths":0,"monthlyPayment":0,"confidence":"high","source":"","category":""}],
  "installments":[{"name":"","totalAmount":0,"monthlyPayment":0,"paidCount":0,"totalCount":0,"confidence":"high","source":"","category":""}],
  "savings":[{"name":"","monthlyContribution":0,"accumulated":0,"feeBalance":0,"feeDeposit":0,"confidence":"high","source":"","category":""}],
  "assessment":"סיכום קצר בעברית: תזרים משוער, דגלים אדומים, והמלצות מרכזיות."
}`

// ── Local validation — runs after every generation / edit, costs $0 ──
//
// Looks for sanity-check failures the advisor should eye before walking the
// result over to the real mapping: zeroed-out rows, unknown categories,
// installment paid > total, AI category totals that disagree with the raw
// transaction sum, etc. All checks are deterministic; no AI call is made.

export type IssueSeverity = 'warning' | 'error'

export interface ValidationIssue {
  severity:  IssueSeverity
  section:   string                  // 'income' | 'fixed' | 'variable' | 'sub' | 'ins' | 'annual' | 'debts' | 'installments' | 'savings' | 'all'
  message:   string                  // Hebrew, user-facing
  rowIndex?: number                  // index within that section's array
}

// Optional second arg: the local Excel-parsed transactions. When supplied,
// we cross-check the AI's per-category variable totals against the actual
// txn sums — the strongest "did the AI hallucinate" signal we have.
export function validateMapping(
  r:    GeneratedMapping,
  txns: { amount: number; category: string; isRefund: boolean }[] = [],
  /**
   * How many months the uploaded files cover. The AI returns MONTHLY figures
   * while `txns` are the raw period; without this the cross-check compared
   * 2,500/mo against a 3-month sum of 7,500 and warned "פער 67%" on a correct
   * answer — while a model that wrongly echoed 7,500 passed silently. That is
   * the check inverted: it punished the right result and rewarded the wrong one.
   */
  months = 1,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  // Income — a mapping with zero income is almost always wrong.
  if (r.income.length === 0) {
    issues.push({ severity: 'warning', section: 'income', message: 'אין שורות הכנסה — האם זה צפוי?' })
  }

  // Zero-amount rows the AI populated with a name but no number — usually
  // a placeholder that slipped through.
  const simpleSections: { key: 'income' | 'fixed' | 'variable' | 'sub' | 'ins'; label: string }[] = [
    { key: 'income',   label: 'הכנסות' },
    { key: 'fixed',    label: 'קבועות' },
    { key: 'variable', label: 'משתנות' },
    { key: 'sub',      label: 'מנויים' },
    { key: 'ins',      label: 'ביטוחים' },
  ]
  for (const { key, label } of simpleSections) {
    r[key].forEach((row, i) => {
      if (row.name && row.amount === 0) {
        issues.push({
          severity: 'warning', section: key, rowIndex: i,
          message: `${label}: "${row.name}" עם סכום 0 — מילוי חסר?`,
        })
      }
    })
  }
  r.annual.forEach((row, i) => {
    if (row.name && row.annualAmount === 0) {
      issues.push({
        severity: 'warning', section: 'annual', rowIndex: i,
        message: `שנתיות: "${row.name}" עם סכום 0`,
      })
    }
  })

  // Variable: row.category should resolve to a known ALL_CATEGORIES entry —
  // if not, grouping fails silently and the txns drill-down won't work.
  r.variable.forEach((row, i) => {
    if (row.category && !ALL_CATEGORIES.includes(row.category)) {
      issues.push({
        severity: 'warning', section: 'variable', rowIndex: i,
        message: `משתנות: "${row.name}" עם קטגוריה לא מוכרת "${row.category}"`,
      })
    }
  })

  // Confidence summary — flag if the AI was unsure on a meaningful chunk.
  const allTaggedRows = [...r.income, ...r.fixed, ...r.variable, ...r.sub, ...r.ins, ...r.annual]
  const lowConf  = allTaggedRows.filter(x => x.confidence === 'low').length
  if (lowConf >= 3) {
    issues.push({
      severity: 'warning', section: 'all',
      message: `${lowConf} שורות סומנו בביטחון נמוך — סקור לפני העתקה`,
    })
  }

  // Debts — monthly payment without remainingMonths means "ad infinitum"
  // and almost always reflects a missed field in the AI's read.
  r.debts.forEach((d, i) => {
    if (d.monthlyPayment > 0 && d.remainingMonths === 0) {
      issues.push({
        severity: 'warning', section: 'debts', rowIndex: i,
        message: `חובות: "${d.name}" — תשלום חודשי ללא מספר חודשים`,
      })
    }
    if (d.remainingBalance > 0 && d.monthlyPayment === 0) {
      issues.push({
        severity: 'warning', section: 'debts', rowIndex: i,
        message: `חובות: "${d.name}" — יתרה ללא תשלום חודשי`,
      })
    }
  })

  // Installments — paid > total is a clear data error.
  r.installments.forEach((inst, i) => {
    if (inst.totalCount > 0 && inst.paidCount > inst.totalCount) {
      issues.push({
        severity: 'error', section: 'installments', rowIndex: i,
        message: `תשלומים: "${inst.name}" — שולמו ${inst.paidCount} מתוך ${inst.totalCount}?`,
      })
    }
  })

  // Cross-check vs local txns: per ALL_CATEGORIES that has txns, compare
  // the txn sum to the sum of AI variable rows tagged with that category.
  // Tolerance: ±10% OR ±50₪, whichever is larger (rounding / minor edits).
  if (txns.length) {
    const txnByCat = new Map<string, number>()
    for (const t of txns) {
      // Refunds NET their category (2026-08-06, same rule as the main tabs) —
      // otherwise this cross-check compares the AI's netted rows to gross
      // sums and emits phantom warnings.
      txnByCat.set(t.category, (txnByCat.get(t.category) ?? 0) + (t.isRefund ? -t.amount : t.amount))
    }
    const aiByCat = new Map<string, number>()
    for (const row of r.variable) {
      if (!row.category) continue
      aiByCat.set(row.category, (aiByCat.get(row.category) ?? 0) + row.amount)
    }
    const span = Math.max(1, months)
    for (const [cat, periodSum] of txnByCat) {
      if (!VAR_CATEGORIES.has(cat)) continue   // only check variable txns
      const txnSum = periodSum / span          // period → monthly, to match the AI
      const aiSum  = aiByCat.get(cat) ?? 0
      // A category the AI dropped entirely is the exact failure this check
      // exists to catch, and it used to be the one case skipped. Only flag it
      // when there is real money behind it (₪50/mo is the same floor
      // suggestBudgets uses for "worth mentioning").
      if (aiSum === 0) {
        if (txnSum >= 50) {
          issues.push({
            severity: 'warning', section: 'variable',
            message: `משתנות: "${cat}" — ${Math.round(txnSum)}₪ לחודש בעסקאות, אבל אין שורה מתאימה בתוצאה`,
          })
        }
        continue
      }
      const diff = Math.abs(aiSum - txnSum)
      const tol  = Math.max(50, txnSum * 0.10)
      if (diff > tol) {
        const pct = txnSum > 0 ? Math.round((diff / txnSum) * 100) : 0
        issues.push({
          severity: 'warning', section: 'variable',
          message: `משתנות: "${cat}" — AI חישב ${Math.round(aiSum)}₪ לחודש, סכום העסקאות בפועל ${Math.round(txnSum)}₪ לחודש (פער ${pct}%)`,
        })
      }
    }
  }

  return issues
}

// ── Safe parsing of the model's JSON output ──
function num(v: unknown): number {
  if (typeof v === 'number') return isFinite(v) ? v : 0
  const n = parseFloat(String(v ?? '').replace(/[^\d.-]/g, ''))
  return isNaN(n) ? 0 : n
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}
const obj = (v: unknown): Record<string, unknown> =>
  (v && typeof v === 'object' ? v : {}) as Record<string, unknown>

// Pull optional confidence + source out of a raw row. Missing/invalid values
// drop out cleanly — the UI shows "—" / no chip rather than crashing.
function meta(r: Record<string, unknown>): GenRowMeta {
  const c   = r.confidence
  const conf: GenConfidence | undefined =
    c === 'high' || c === 'medium' || c === 'low' ? c : undefined
  const src =
    typeof r.source === 'string' && r.source.trim() ? r.source.trim() : undefined
  const cat =
    typeof r.category === 'string' && r.category.trim() ? r.category.trim() : undefined
  return {
    ...(conf ? { confidence: conf } : {}),
    ...(src  ? { source: src }      : {}),
    ...(cat  ? { category: cat }    : {}),
  }
}

const simple = (rows: unknown[]): GenSimpleRow[] =>
  rows.map(obj).map(r => ({ name: str(r.name), amount: num(r.amount), ...meta(r) })).filter(r => r.name || r.amount)

/**
 * Pull the mapping object out of the model's reply, repairing it when the reply
 * was cut off mid-JSON.
 *
 * Why the repair exists: a run that hits max_tokens returns a JSON object with
 * no closing brace, and the old `/\{[\s\S]*\}/` match then found nothing at all
 * — so an answer that was 90% complete was thrown away whole, and the advisor
 * saw "no valid JSON" with no idea that the real problem was length. (Observed
 * live 2026-08-07: the model wrote an English preamble, which ate into the
 * output budget, and the mapping never closed.)
 *
 * The repair walks the text tracking string/escape state, remembers the last
 * position where a nested value CLOSED cleanly, cuts there, and shuts the
 * remaining open brackets. Everything the model finished is kept; only the
 * half-written tail is dropped.
 */
export function extractJsonObject(text: string): string {
  const start = text.indexOf('{')
  if (start === -1) throw new Error('לא התקבל JSON תקין מה‑AI')

  const stack: string[] = []
  let inString = false, escaped = false
  let lastSafe = -1              // index of the last cleanly-closed nested value
  let lastSafeDepth = 0

  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (escaped) { escaped = false; continue }
    if (c === '\\' && inString) { escaped = true; continue }
    if (c === '"') { inString = !inString; continue }
    if (inString) continue

    if (c === '{' || c === '[') stack.push(c)
    else if (c === '}' || c === ']') {
      stack.pop()
      if (stack.length === 0) return text.slice(start, i + 1)   // complete object
      lastSafe = i
      lastSafeDepth = stack.length
    }
  }

  // Truncated. Salvage everything up to the last value that closed cleanly.
  if (lastSafe === -1) throw new Error('תשובת ה‑AI נקטעה לפני שהתקבל מיפוי')
  const head = text.slice(start, lastSafe + 1)
  const closers: string[] = []
  const openers = stack.slice(0, lastSafeDepth)
  for (let i = openers.length - 1; i >= 0; i--) closers.push(openers[i] === '{' ? '}' : ']')
  return head + closers.join('')
}

/** Extract + coerce the model's JSON into a GeneratedMapping. Throws on no JSON. */
export function parseGeneratedMapping(text: string): GeneratedMapping {
  const json = extractJsonObject(text)
  const raw = obj(JSON.parse(json.replace(/,\s*([}\]])/g, '$1')))

  return {
    creditScore:  num(raw.creditScore),
    creditCards:  arr(raw.creditCards).map(obj).map(r => ({
      name: str(r.name), limit: num(r.limit), chargeDay: num(r.chargeDay) || 2, ...meta(r),
    })).filter(r => r.name || r.limit),
    bankAccounts: arr(raw.bankAccounts).map(obj).map(r => ({
      name: str(r.name), balance: num(r.balance), overdraftLimit: num(r.overdraftLimit), ...meta(r),
    })).filter(r => r.name || r.balance || r.overdraftLimit),
    income:   simple(arr(raw.income)),
    fixed:    simple(arr(raw.fixed)),
    sub:      simple(arr(raw.sub)),
    ins:      simple(arr(raw.ins)),
    variable: simple(arr(raw.variable)),
    annual:   arr(raw.annual).map(obj).map(r => ({ name: str(r.name), annualAmount: num(r.annualAmount), ...meta(r) })).filter(r => r.name || r.annualAmount),
    debts:    arr(raw.debts).map(obj).map(r => ({
      name: str(r.name), originalBalance: num(r.originalBalance), remainingBalance: num(r.remainingBalance),
      interestRate: num(r.interestRate), remainingMonths: num(r.remainingMonths), monthlyPayment: num(r.monthlyPayment),
      ...meta(r),
    })).filter(r => r.name || r.monthlyPayment || r.remainingBalance),
    installments: arr(raw.installments).map(obj).map(r => ({
      name: str(r.name), totalAmount: num(r.totalAmount), monthlyPayment: num(r.monthlyPayment),
      paidCount: num(r.paidCount), totalCount: num(r.totalCount),
      ...meta(r),
    })).filter(r => r.name || r.monthlyPayment || r.totalAmount),
    savings: arr(raw.savings).map(obj).map(r => ({
      name: str(r.name), monthlyContribution: num(r.monthlyContribution), accumulated: num(r.accumulated),
      feeBalance: num(r.feeBalance), feeDeposit: num(r.feeDeposit),
      ...meta(r),
    })).filter(r => r.name || r.monthlyContribution || r.accumulated),
    assessment: str(raw.assessment),
  }
}

export function emptyGeneratedMapping(): GeneratedMapping {
  return { creditScore: 0, creditCards: [], bankAccounts: [], income: [], fixed: [], sub: [], ins: [], variable: [], annual: [], debts: [], installments: [], savings: [], assessment: '' }
}
