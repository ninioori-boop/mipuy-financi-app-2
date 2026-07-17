// Short-term (up to 3 years) goal analysis — "כיוון חשיבה", NOT investment advice.
//
// DETERMINISTIC BY DESIGN. Every sentence below is authored and approved by the
// advisor; nothing is generated at runtime by a language model. That is the whole
// point: the rules here encode hard constraints that must NEVER be violated —
// most critically the PFIC rule (a US citizen must never be pointed at an Israeli
// fund, which would expose them to punitive US taxation). A model that "usually"
// remembers is not good enough for a rule whose violation causes real tax damage
// to a client, so the product set is a closed union and the copy is fixed.
//
// The agreed rules (short term, up to 3 years):
//   Principles: solid, preserves value against inflation, no volatility, ILS only.
//   Product set is CLOSED — these four and nothing else:
//
//                    | needs liquidity            | can lock
//     non-US citizen | money market fund          | bank deposit (1y+)
//     US citizen     | liquid deposit             | locked deposit / with terms
//     (US citizens: deposits only — never funds, per PFIC.)
//
// Allowed commentary: timing that doesn't add up, and a goal that is unrealistic
// given the return. Never a recommendation, never a product outside the set.

/** The only products this analysis may ever point at. */
export type ShortTermProduct = 'money-market' | 'bank-deposit' | 'liquid-deposit' | 'locked-deposit'

/** Whether the money must stay reachable, or can be locked until the target date. */
export type Liquidity = 'liquid' | 'lockable'

/** Precomputed facts for one goal — keeps this module pure and testable. */
export interface GoalFacts {
  id:         string
  name:       string
  required:   number
  current:    number
  /** Months until the target date; null when no target date is set. */
  months:     number | null
  liquidity?: Liquidity
}

export interface AnalysisContext {
  isUSCitizen:   boolean
  /** Monthly savings budget from the checking tab; 0 = unknown. */
  monthlyBudget: number
}

export interface GoalAnalysis {
  id:    string
  name:  string
  /** One-line facts header: horizon, time left, progress. */
  facts: string
  /** The direction paragraph. Null when we can't pick a branch yet. */
  opinion: string | null
  /** True when the advisor still has to say liquid vs lockable. */
  needsLiquidityChoice: boolean
  /** Direct, factual commentary: timing, realism, overdue, reached. */
  notes: string[]
  /** Which product the direction points at, or null. Useful for tests/telemetry. */
  product: ShortTermProduct | null
}

export const ANALYSIS_DISCLAIMER =
  'זה לא ייעוץ השקעות ולא המלצה. זה כיוון חשיבה שנועד לעזור לך לשאול את השאלות הנכונות. לפני כל החלטה התייעץ עם בעל רישיון.'

/** Shown once above the results — the principles that govern every short-term goal. */
export const SHORT_TERM_PRINCIPLES =
  'בטווח קצר המטרה היא לשמור על ערך הכסף מול האינפלציה בלי תנודתיות, ובשקלים בלבד, כדי להימנע גם מתנודות מטבע.'

const fmt = (n: number) => '₪' + Math.round(n).toLocaleString('he-IL')

// The PFIC heads-up. Prepended to the direction for US citizens so they
// understand WHY funds are off the table for them.
const PFIC_NOTE =
  'חשוב שתדע: בגלל האזרחות האמריקאית, קרן כספית וקרנות ישראליות אחרות לא מתאימות לך. חוק PFIC בארה"ב עלול ליצור עליהן חבות מס כבדה.'

// The four approved directions. Nothing outside this map can ever be emitted.
const DIRECTIONS: Record<ShortTermProduct, string> = {
  'money-market':
    'הדעה שלי: המטרה הזו צריכה להישאר נזילה, כי אתה עלול להזדקק לכסף בכל רגע או שהתזמון לא ברור. במצב כזה המטרה היא לא להרוויח, אלא לשמור על ערך הכסף מול האינפלציה בלי לקחת סיכון. כיוון לחשוב עליו: קרן כספית שקלית. היא שואפת לתשואה בהתאם לריבית בנק ישראל, ומאפשרת למשוך את הכסף מתי שצריך.',
  'bank-deposit':
    'הדעה שלי: אם אתה באמת יכול לנעול את הכסף עד התאריך, יש לך אפשרות לקבל קצת יותר. כיוון לחשוב עליו: פיקדון בנקאי שקלי. בנעילה לשנה ומעלה לפעמים אפשר לקבל ריבית גבוהה יותר מקרן כספית. המחיר: הכסף נעול, ואם תצטרך אותו באמצע זה עלול לעלות לך. אם אתה לא בטוח שתוכל לנעול, קרן כספית תשאיר אותך גמיש.',
  'liquid-deposit':
    'הדעה שלי: המטרה הזו צריכה להישאר נזילה, ולכן צריך פתרון שמשאיר את הכסף זמין. כיוון לחשוב עליו: פיקדון נזיל שקלי, שמאפשר למשוך את הכסף מתי שצריך.',
  'locked-deposit':
    'הדעה שלי: אם אתה יכול לנעול את הכסף עד התאריך, אפשר לשפר את התנאים. כיוון לחשוב עליו: פיקדון נעול שקלי, או פיקדון עם תנאים ותחנות יציאה שמתאימים למטרה.',
}

/** The 2x2: citizenship gates the family, liquidity picks within it. */
function pickProduct(isUSCitizen: boolean, liquidity: Liquidity): ShortTermProduct {
  if (isUSCitizen) return liquidity === 'liquid' ? 'liquid-deposit' : 'locked-deposit'
  return liquidity === 'liquid' ? 'money-market' : 'bank-deposit'
}

/** Monthly contribution needed to close the gap by the target date. */
export function requiredMonthly(g: GoalFacts): number {
  const remaining = Math.max(0, g.required - g.current)
  if (remaining === 0) return 0
  if (g.months === null) return 0        // no date — can't pace it
  if (g.months <= 0) return remaining    // due now / overdue
  return Math.ceil(remaining / g.months)
}

export function analyzeShortTermGoal(g: GoalFacts, ctx: AnalysisContext): GoalAnalysis {
  const pct       = g.required > 0 ? Math.round((g.current / g.required) * 100) : 0
  const done      = g.required > 0 && g.current >= g.required
  const overdue   = !done && g.months !== null && g.months <= 0 && g.required > 0
  const perMonth  = requiredMonthly(g)
  const notes: string[] = []

  // ── facts header ──
  const timePart =
    g.months === null ? 'בלי תאריך יעד'
    : g.months <= 0   ? 'התאריך עבר'
    : `${g.months} חודשים`
  const progressPart = g.required > 0
    ? `${fmt(g.current)} מתוך ${fmt(g.required)} (${pct}%)`
    : 'לא הוגדר סכום'
  const facts = `טווח קצר · ${timePart} · ${progressPart}`

  // ── the goal is already funded ──
  if (done) {
    notes.push('הכסף כבר שם. מכאן העניין הוא לא לאבד אותו עד שתשתמש בו.')
    // Still worth pointing at where funded short-term money should sit.
    if (g.liquidity) {
      const product = pickProduct(ctx.isUSCitizen, g.liquidity)
      return {
        id: g.id, name: g.name, facts, product,
        opinion: (ctx.isUSCitizen ? PFIC_NOTE + ' ' : '') + DIRECTIONS[product],
        needsLiquidityChoice: false, notes,
      }
    }
    return { id: g.id, name: g.name, facts, product: null, opinion: null, needsLiquidityChoice: true, notes }
  }

  // ── we can't pick a branch without knowing the liquidity need ──
  if (!g.liquidity) {
    return {
      id: g.id, name: g.name, facts, product: null, opinion: null,
      needsLiquidityChoice: true,
      notes: ['כדי לתת כיוון מדויק צריך לדעת אם הכסף חייב להישאר נזיל או שאפשר לנעול אותו עד התאריך.'],
    }
  }

  const product = pickProduct(ctx.isUSCitizen, g.liquidity)
  const opinion = (ctx.isUSCitizen ? PFIC_NOTE + ' ' : '') + DIRECTIONS[product]

  // ── commentary: timing and realism (the only two the advisor allows) ──
  if (overdue) {
    notes.push('התאריך עבר והמטרה לא הושגה. צריך לעדכן את התאריך או את הסכום.')
  } else if (g.months === null) {
    notes.push('אין תאריך יעד, אז אי אפשר לחשב קצב. קבע תאריך כדי לדעת כמה צריך להפריש בחודש.')
  } else if (perMonth > 0) {
    if (ctx.monthlyBudget > 0 && perMonth > ctx.monthlyBudget) {
      notes.push(
        `כדי להגיע ליעד בזמן צריך ${fmt(perMonth)} בחודש, ותקציב החיסכון שלך הוא ${fmt(ctx.monthlyBudget)}. ` +
        'המטרה לא ריאלית בקצב הזה. צריך לדחות את התאריך או להקטין את הסכום.',
      )
    } else {
      notes.push(`כדי להגיע ליעד בזמן צריך ${fmt(perMonth)} בחודש.`)
    }
  }

  // The core short-term principle: the product preserves, it doesn't grow.
  notes.push('חשוב להבין: בטווח קצר המוצר לא מביא אותך ליעד, ההפקדה החודשית כן. התשואה כאן נועדה לשמור על ערך הכסף, לא להצמיח אותו.')

  return { id: g.id, name: g.name, facts, product, opinion, needsLiquidityChoice: false, notes }
}

/** Analyze every short-term goal that has something in it. */
export function analyzeShortTerm(goals: GoalFacts[], ctx: AnalysisContext): GoalAnalysis[] {
  return goals
    .filter(g => g.name.trim() || g.required > 0)
    .map(g => analyzeShortTermGoal(g, ctx))
}
