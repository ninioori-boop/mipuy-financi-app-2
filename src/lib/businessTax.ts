/**
 * Israeli business tax calculations — pure functions, no React/DOM.
 *
 * All constants are for tax year 2025. They are gathered here so a single
 * yearly update keeps every business-budget calculation correct.
 * Every value the UI shows is overridable, so these are estimates.
 */

export const TAX_YEAR = 2025

// ── מע"מ ──
export const VAT_RATE = 0.18 // מ-1.1.2025

// ── מס הכנסה — מדרגות שנתיות (2025) ──
export interface TaxBracket {
  upTo: number
  rate: number
}
export const INCOME_TAX_BRACKETS: TaxBracket[] = [
  { upTo: 84_120, rate: 0.10 },
  { upTo: 120_720, rate: 0.14 },
  { upTo: 193_800, rate: 0.20 },
  { upTo: 269_280, rate: 0.31 },
  { upTo: 560_280, rate: 0.35 },
  { upTo: 721_560, rate: 0.47 },
  { upTo: Infinity, rate: 0.50 }, // כולל מס יסף 3%
]

export const TAX_POINT_ANNUAL = 2_904 // שווי נקודת זיכוי לשנה (242 ₪/חודש)
export const DEFAULT_TAX_POINTS = 2.25 // תושב/ת ישראל — מינימום

// ── מס חברות ──
export const COMPANY_TAX_RATE = 0.23

// ── ביטוח לאומי + מס בריאות — עצמאי (2025) ──
export const AVG_WAGE_MONTHLY = 12_536 // השכר הממוצע במשק
export const BL_REDUCED_CAP = Math.round(AVG_WAGE_MONTHLY * 0.6) // 60% מהשכר הממוצע
export const BL_CEILING_MONTHLY = 49_030 // תקרת הכנסה חודשית לדמי ביטוח
export const BL_REDUCED_RATE = 0.0597 // עד 60% מהשכר הממוצע (ב"ל 2.87% + בריאות 3.10%)
export const BL_FULL_RATE = 0.1783 // מ-60% ועד התקרה (ב"ל 12.83% + בריאות 5.00%)

/** מס הכנסה שנתי לפי מדרגות, פחות זיכוי בגין נקודות זיכוי. לא יורד מתחת ל-0. */
export function calcIncomeTaxAnnual(annualTaxable: number, taxPoints = DEFAULT_TAX_POINTS): number {
  if (annualTaxable <= 0) return 0
  let tax = 0
  let lower = 0
  for (const b of INCOME_TAX_BRACKETS) {
    if (annualTaxable <= lower) break
    const slice = Math.min(annualTaxable, b.upTo) - lower
    tax += slice * b.rate
    lower = b.upTo
  }
  const credit = Math.max(0, taxPoints) * TAX_POINT_ANNUAL
  return Math.max(0, tax - credit)
}

/** מס הכנסה חודשי — מחושב על בסיס הכנסה חודשית מוכפלת ל-12. */
export function calcIncomeTaxMonthly(monthlyTaxable: number, taxPoints = DEFAULT_TAX_POINTS): number {
  return calcIncomeTaxAnnual(monthlyTaxable * 12, taxPoints) / 12
}

/** מס חברות אחיד על הרווח החודשי. */
export function calcCompanyTaxMonthly(monthlyProfit: number): number {
  return Math.max(0, monthlyProfit) * COMPANY_TAX_RATE
}

/** ביטוח לאומי + מס בריאות חודשי לעצמאי — שתי מדרגות עד התקרה. */
export function calcBituachLeumiMonthly(monthlyIncome: number): number {
  if (monthlyIncome <= 0) return 0
  const capped = Math.min(monthlyIncome, BL_CEILING_MONTHLY)
  const tier1 = Math.min(capped, BL_REDUCED_CAP)
  const tier2 = Math.max(0, capped - BL_REDUCED_CAP)
  return tier1 * BL_REDUCED_RATE + tier2 * BL_FULL_RATE
}

/** מע"מ עסקאות, תשומות (על הוצאות מזכות) ולתשלום (output − input). */
export function calcVat(revenueExVat: number, deductibleExpensesExVat: number, rate = VAT_RATE) {
  const output = Math.max(0, revenueExVat) * rate
  const input = Math.max(0, deductibleExpensesExVat) * rate
  return { output, input, payable: output - input }
}
