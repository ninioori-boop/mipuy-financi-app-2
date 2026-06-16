// Auto-mapping sandbox: the home-economist methodology prompt, the generated
// mapping schema (matching mappingStore row shapes, minus ids), and a safe parser.
// Framework-free so the API route (server) and the page (client) can both import it.
// This is the file we TUNE over time to improve mapping quality.

import {
  ALL_CATEGORIES,
  FIXED_CATEGORIES, VAR_CATEGORIES, ANNUAL_CATEGORIES,
  INSURANCE_CATEGORIES, SUB_CATEGORIES, SKIP_CATEGORIES,
} from '@/lib/constants'

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
      if (t.isRefund) continue
      txnByCat.set(t.category, (txnByCat.get(t.category) ?? 0) + t.amount)
    }
    const aiByCat = new Map<string, number>()
    for (const row of r.variable) {
      if (!row.category) continue
      aiByCat.set(row.category, (aiByCat.get(row.category) ?? 0) + row.amount)
    }
    for (const [cat, txnSum] of txnByCat) {
      if (!VAR_CATEGORIES.has(cat)) continue   // only check variable txns
      const aiSum = aiByCat.get(cat) ?? 0
      if (aiSum === 0) continue                 // AI didn't cover it; not a "diff" issue
      const diff = Math.abs(aiSum - txnSum)
      const tol  = Math.max(50, txnSum * 0.10)
      if (diff > tol) {
        const pct = txnSum > 0 ? Math.round((diff / txnSum) * 100) : 0
        issues.push({
          severity: 'warning', section: 'variable',
          message: `משתנות: "${cat}" — AI חישב ${Math.round(aiSum)}₪, סכום העסקאות בפועל ${Math.round(txnSum)}₪ (פער ${pct}%)`,
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
  return { income: [], fixed: [], sub: [], ins: [], variable: [], annual: [], debts: [], installments: [], savings: [], assessment: '' }
}
