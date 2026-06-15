// Auto-mapping sandbox: the home-economist methodology prompt, the generated
// mapping schema (matching mappingStore row shapes, minus ids), and a safe parser.
// Framework-free so the API route (server) and the page (client) can both import it.
// This is the file we TUNE over time to improve mapping quality.

import {
  ALL_CATEGORIES,
  FIXED_CATEGORIES, VAR_CATEGORIES, ANNUAL_CATEGORIES,
  INSURANCE_CATEGORIES, SUB_CATEGORIES, SKIP_CATEGORIES,
} from '@/lib/constants'

export interface GenSimpleRow { name: string; amount: number }
export interface GenAnnualRow { name: string; annualAmount: number }
export interface GenDebtRow {
  name: string; originalBalance: number; remainingBalance: number
  interestRate: number; remainingMonths: number; monthlyPayment: number
}
export interface GenInstallmentRow {
  name: string; totalAmount: number; monthlyPayment: number
  paidCount: number; totalCount: number
}
export interface GenSavingRow {
  name: string; monthlyContribution: number; accumulated: number
  feeBalance: number; feeDeposit: number
}

export interface GeneratedMapping {
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

// ── "כללי המיפוי של הכלכלן של הבית" (v1) — server-owned, tuned over time ──
export const AUTOMAP_SYSTEM_PROMPT = `אתה "הכלכלן של הבית" — יועץ פיננסי מומחה לשוק הישראלי. תפקידך: לקבל את כל נתוני הלקוח (עסקאות אשראי, תנועות עו"ש, הלוואות, תשלומים, נכסים, חיסכון, וטקסט חופשי) ולבנות **מיפוי חודשי שלם** — חלוקה מסודרת של ההכנסות וההוצאות לסעיפים.

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

השתמש אך ורק בשמות קטגוריות מתוך הרשימה הבאה כשמתאים: ${ALL_CATEGORIES.join(', ')}. אל תמציא קטגוריות.

## כללי חישוב
- כל הסכומים ב‑income/fixed/sub/ins/variable הם **חודשיים** (ממוצע). אם הנתונים מכסים כמה חודשים — חלק במספר החודשים שצויין.
- annual: סכום **שנתי** (הסכום בפועל לשנה, לא ×12 של חד‑פעמי).
- מספרים בלבד (ללא ₪ וללא פסיקים).

## כללי אנטי‑כפילות (קריטי)
- שורת "תשלום כרטיס אשראי" / "פירעון אשראי" בעו"ש היא **סיכום** של דוח האשראי — **אל תספור אותה כהוצאה**. ההוצאות האמיתיות הן הפירוט בדוח האשראי.
- התעלם מ: העברות בין חשבונות, משיכות מזומן ללא פירוט (אלא אם צוין), והחזרים (זיכויים).
- קטגוריות שאינן הוצאה (${list(SKIP_CATEGORIES)}) — אל תכניס כהוצאה; הכנסות לך ל‑income.

## פירוט הוצאות משתנות (variable)
שבר כל קטגוריה גדולה של variable למספר שורות מפורטות לפי תת‑סוג / סוג ספק / הקשר — לא שורה אחת כללית. זה נותן ליועץ תמונה ברורה של איפה הכסף הולך בפועל.

דוגמאות:
- במקום "מזון לבית 2500" → "סופרמרקטים 1800", "פירות וירקות 400", "מאפיות 300".
- במקום "אוכל בחוץ ובילויים 1200" → "מסעדות 600", "משלוחים 350", "בתי קפה 150", "בילויים 100".
- במקום "דלק וחניה 900" → "תדלוק 700", "חניונים 200".
- במקום "תחביבים 600" → אם ניתן, לזהות את הסוג: "ספרים 200", "מנוי לקולנוע 50", "חוגים 350".

חוקי שבירה:
- שייך כל שורה לאותה קטגוריה ראשית (השם בעמודת ה‑name יכול להיות תיאורי, אבל הסיווג נשאר משתנה).
- שמור על סך הקטגוריה: סכום השורות המפורטות של "מזון לבית" שווה לסכום המקורי של "מזון לבית".
- אם אין מספיק נתונים להפרדה אמינה — שורה אחת ברמת הקטגוריה זה בסדר. אל תמציא תת‑סוגים.
- ההפרדה רלוונטית בעיקר ל‑variable. הסעיפים fixed/sub/ins/annual נשארים שורה אחת לקטגוריה (חיובים מובהקים).

## פלט
החזר **JSON תקין בלבד**, ללא טקסט נוסף, במבנה המדויק הזה (מערך ריק אם אין):
{
  "income":[{"name":"","amount":0}],
  "fixed":[{"name":"","amount":0}],
  "sub":[{"name":"","amount":0}],
  "ins":[{"name":"","amount":0}],
  "variable":[{"name":"","amount":0}],
  "annual":[{"name":"","annualAmount":0}],
  "debts":[{"name":"","originalBalance":0,"remainingBalance":0,"interestRate":0,"remainingMonths":0,"monthlyPayment":0}],
  "installments":[{"name":"","totalAmount":0,"monthlyPayment":0,"paidCount":0,"totalCount":0}],
  "savings":[{"name":"","monthlyContribution":0,"accumulated":0,"feeBalance":0,"feeDeposit":0}],
  "assessment":"סיכום קצר בעברית: תזרים משוער, דגלים אדומים, והמלצות מרכזיות."
}`

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

const simple = (rows: unknown[]): GenSimpleRow[] =>
  rows.map(obj).map(r => ({ name: str(r.name), amount: num(r.amount) })).filter(r => r.name || r.amount)

/** Extract + coerce the model's JSON into a GeneratedMapping. Throws on no JSON. */
export function parseGeneratedMapping(text: string): GeneratedMapping {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('לא התקבל JSON תקין מה‑AI')
  const raw = obj(JSON.parse(match[0].replace(/,\s*([}\]])/g, '$1')))

  return {
    income:   simple(arr(raw.income)),
    fixed:    simple(arr(raw.fixed)),
    sub:      simple(arr(raw.sub)),
    ins:      simple(arr(raw.ins)),
    variable: simple(arr(raw.variable)),
    annual:   arr(raw.annual).map(obj).map(r => ({ name: str(r.name), annualAmount: num(r.annualAmount) })).filter(r => r.name || r.annualAmount),
    debts:    arr(raw.debts).map(obj).map(r => ({
      name: str(r.name), originalBalance: num(r.originalBalance), remainingBalance: num(r.remainingBalance),
      interestRate: num(r.interestRate), remainingMonths: num(r.remainingMonths), monthlyPayment: num(r.monthlyPayment),
    })).filter(r => r.name || r.monthlyPayment || r.remainingBalance),
    installments: arr(raw.installments).map(obj).map(r => ({
      name: str(r.name), totalAmount: num(r.totalAmount), monthlyPayment: num(r.monthlyPayment),
      paidCount: num(r.paidCount), totalCount: num(r.totalCount),
    })).filter(r => r.name || r.monthlyPayment || r.totalAmount),
    savings: arr(raw.savings).map(obj).map(r => ({
      name: str(r.name), monthlyContribution: num(r.monthlyContribution), accumulated: num(r.accumulated),
      feeBalance: num(r.feeBalance), feeDeposit: num(r.feeDeposit),
    })).filter(r => r.name || r.monthlyContribution || r.accumulated),
    assessment: str(raw.assessment),
  }
}

export function emptyGeneratedMapping(): GeneratedMapping {
  return { income: [], fixed: [], sub: [], ins: [], variable: [], annual: [], debts: [], installments: [], savings: [], assessment: '' }
}
