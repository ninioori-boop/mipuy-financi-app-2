// Goal analysis — "כיוון חשיבה", NOT investment advice.
//
// DETERMINISTIC BY DESIGN. Every sentence below is authored and approved by the
// advisor; nothing is generated at runtime by a language model. That is the whole
// point: the rules here encode hard constraints that must NEVER be violated —
// most critically the PFIC rule (a US citizen must never be pointed at an Israeli
// fund / provident fund / savings policy, which would expose them to punitive US
// taxation). A model that "usually" remembers is not good enough for a rule whose
// violation causes real tax damage to a client, so the product paths are a closed
// set and the copy is fixed.

export type Liquidity    = 'liquid' | 'lockable'
export type RiskLevel    = 'solid' | 'balanced' | 'growth'
export type InvestorType = 'managed' | 'diy'

/** Precomputed facts for one goal — keeps this module pure and testable. */
export interface GoalFacts {
  id:         string
  name:       string
  required:   number
  current:    number
  /** Months until the target date; null when no target date is set. */
  months:     number | null
  liquidity?:    Liquidity     // short-term input
  riskLevel?:    RiskLevel     // medium-term input
  investorType?: InvestorType  // medium-term input
}

export interface AnalysisContext {
  isUSCitizen:   boolean
  /** Monthly savings budget from the checking tab; 0 = unknown. */
  monthlyBudget: number
}

export interface GoalAnalysis {
  id:    string
  name:  string
  facts: string
  /** The direction paragraph(s). Null when a per-goal choice is still missing. */
  opinion: string | null
  /** When set, the per-goal inputs the advisor still has to mark before the
   *  analysis can pick a branch (short: liquidity; medium: risk + investor). */
  choicePrompt: string | null
  /** Direct, factual commentary: timing, realism, overdue, reached. */
  notes: string[]
}

const fmt = (n: number) => '₪' + Math.round(n).toLocaleString('he-IL')

// ── shared helpers ──────────────────────────────────────────────────────────

/** Monthly contribution needed to close the gap by the target date. */
export function requiredMonthly(g: GoalFacts): number {
  const remaining = Math.max(0, g.required - g.current)
  if (remaining === 0) return 0
  if (g.months === null) return 0        // no date — can't pace it
  if (g.months <= 0) return remaining    // due now / overdue
  return Math.ceil(remaining / g.months)
}

function factsHeader(label: string, g: GoalFacts): string {
  const pct = g.required > 0 ? Math.round((g.current / g.required) * 100) : 0
  const timePart =
    g.months === null ? 'בלי תאריך יעד'
    : g.months <= 0   ? 'התאריך עבר'
    : `${g.months} חודשים`
  const progressPart = g.required > 0
    ? `${fmt(g.current)} מתוך ${fmt(g.required)} (${pct}%)`
    : 'לא הוגדר סכום'
  return `${label} · ${timePart} · ${progressPart}`
}

/** Timing / realism commentary shared by every horizon. */
function timingNotes(g: GoalFacts, ctx: AnalysisContext): string[] {
  const notes: string[] = []
  const done    = g.required > 0 && g.current >= g.required
  const overdue = !done && g.months !== null && g.months <= 0 && g.required > 0
  const perMonth = requiredMonthly(g)

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
  return notes
}

// ── SHORT TERM (up to 3 years) ───────────────────────────────────────────────
//
//                    | needs liquidity            | can lock
//     non-US citizen | money market fund          | bank deposit (1y+)
//     US citizen     | liquid deposit             | locked deposit / with terms
//     (US citizens: deposits only — never funds, per PFIC.)
//   Principles: solid, preserves value against inflation, no volatility, ILS only.

export type ShortTermProduct = 'money-market' | 'bank-deposit' | 'liquid-deposit' | 'locked-deposit'

export const SHORT_TERM_PRINCIPLES =
  'בטווח קצר המטרה היא לשמור על ערך הכסף מול האינפלציה בלי תנודתיות, ובשקלים בלבד, כדי להימנע גם מתנודות מטבע.'

export const SHORT_DISCLAIMER =
  'זה לא ייעוץ השקעות ולא המלצה. זה כיוון חשיבה שנועד לעזור לך לשאול את השאלות הנכונות. לפני כל החלטה התייעץ עם בעל רישיון.'

const SHORT_PFIC_NOTE =
  'חשוב שתדע: בגלל האזרחות האמריקאית, קרן כספית וקרנות ישראליות אחרות לא מתאימות לך. חוק PFIC בארה"ב עלול ליצור עליהן חבות מס כבדה.'

const SHORT_DIRECTIONS: Record<ShortTermProduct, string> = {
  'money-market':
    'הדעה שלי: המטרה הזו צריכה להישאר נזילה, כי אתה עלול להזדקק לכסף בכל רגע או שהתזמון לא ברור. במצב כזה המטרה היא לא להרוויח, אלא לשמור על ערך הכסף מול האינפלציה בלי לקחת סיכון. כיוון לחשוב עליו: קרן כספית שקלית. היא שואפת לתשואה בהתאם לריבית בנק ישראל, ומאפשרת למשוך את הכסף מתי שצריך.',
  'bank-deposit':
    'הדעה שלי: אם אתה באמת יכול לנעול את הכסף עד התאריך, יש לך אפשרות לקבל קצת יותר. כיוון לחשוב עליו: פיקדון בנקאי שקלי. בנעילה לשנה ומעלה לפעמים אפשר לקבל ריבית גבוהה יותר מקרן כספית. המחיר: הכסף נעול, ואם תצטרך אותו באמצע זה עלול לעלות לך. אם אתה לא בטוח שתוכל לנעול, קרן כספית תשאיר אותך גמיש.',
  'liquid-deposit':
    'הדעה שלי: המטרה הזו צריכה להישאר נזילה, ולכן צריך פתרון שמשאיר את הכסף זמין. כיוון לחשוב עליו: פיקדון נזיל שקלי, שמאפשר למשוך את הכסף מתי שצריך.',
  'locked-deposit':
    'הדעה שלי: אם אתה יכול לנעול את הכסף עד התאריך, אפשר לשפר את התנאים. כיוון לחשוב עליו: פיקדון נעול שקלי, או פיקדון עם תנאים ותחנות יציאה שמתאימים למטרה.',
}

function pickShortProduct(isUSCitizen: boolean, liquidity: Liquidity): ShortTermProduct {
  if (isUSCitizen) return liquidity === 'liquid' ? 'liquid-deposit' : 'locked-deposit'
  return liquidity === 'liquid' ? 'money-market' : 'bank-deposit'
}

export function analyzeShortTermGoal(g: GoalFacts, ctx: AnalysisContext): GoalAnalysis {
  const facts = factsHeader('טווח קצר', g)
  const done  = g.required > 0 && g.current >= g.required

  if (done) {
    const notes = ['הכסף כבר שם. מכאן העניין הוא לא לאבד אותו עד שתשתמש בו.']
    if (g.liquidity) {
      const product = pickShortProduct(ctx.isUSCitizen, g.liquidity)
      return { id: g.id, name: g.name, facts, choicePrompt: null, notes,
        opinion: (ctx.isUSCitizen ? SHORT_PFIC_NOTE + ' ' : '') + SHORT_DIRECTIONS[product] }
    }
    return { id: g.id, name: g.name, facts, opinion: null, notes,
      choicePrompt: 'סמן על המטרה אם אתה צריך את הכסף נזיל או שאפשר לנעול אותו, ואז הרץ שוב.' }
  }

  if (!g.liquidity) {
    return {
      id: g.id, name: g.name, facts, opinion: null,
      choicePrompt: 'סמן על המטרה אם אתה צריך את הכסף נזיל בכל רגע או שאפשר לנעול אותו עד התאריך, ואז הרץ שוב.',
      notes: [],
    }
  }

  const product = pickShortProduct(ctx.isUSCitizen, g.liquidity)
  const opinion = (ctx.isUSCitizen ? SHORT_PFIC_NOTE + ' ' : '') + SHORT_DIRECTIONS[product]
  const notes = timingNotes(g, ctx)
  notes.push('חשוב להבין: בטווח קצר המוצר לא מביא אותך ליעד, ההפקדה החודשית כן. התשואה כאן נועדה לשמור על ערך הכסף, לא להצמיח אותו.')

  return { id: g.id, name: g.name, facts, opinion, choicePrompt: null, notes }
}

// ── MEDIUM TERM (3–7 years) ──────────────────────────────────────────────────
//
// The trickiest horizon: not long enough for full risk, not short enough to
// accept a low return — so it's all about balance. Two per-goal inputs: risk
// level (solid/balanced/growth) sets the equity vs solid tilt; investor type
// (managed vs DIY) sets the vehicles. Solid part stays ILS; the equity part may
// carry currency exposure (that's part of it). US citizens: no Israeli packaged
// products or funds (PFIC) — equities via a US broker, solid via deposits / short
// government bonds.

export const MEDIUM_TERM_PRINCIPLES =
  'טווח בינוני (3־7 שנים) הוא הטווח הכי טריקי: לא ארוך מספיק לסיכון מלא, ולא קצר מספיק להסתפק בתשואה נמוכה, אז הכל כאן איזון. סטטיסטית, הסיכוי להפסיד בשוק ההון על פני כ־5 שנים הוא בערך 10%, אבל במשבר גדול מדדים רחבים יכולים לרדת בעשרות אחוזים. השאלה המרכזית: כמה מהכסף הזה אתה מוכן להפסיד זמנית, או לדחות את המטרה בגללו, אם יבוא משבר.'

export const MEDIUM_DISCLAIMER =
  'דווקא בגלל שהטווח טריקי: זה לא ייעוץ השקעות ולא המלצה, זה כיוון חשיבה בלבד. חשוב מאוד להתייעץ עם איש מקצוע לפני כל החלטה, ולחקור את הנושא לעומק.'

const RISK_OPINION: Record<RiskLevel, string> = {
  solid:
    'רמת סיכון סולידית: רוב הכסף בסולידי ששומר על הערך, וחשיפה קטנה בלבד למניות. מתאים אם קשה לך להרשות הפסד זמני על הכסף הזה.',
  balanced:
    'רמת סיכון מאוזנת: איזון בין השניים, בערך חצי סולידי וחצי מניות. פשרה בין שמירה על הכסף לבין פוטנציאל צמיחה.',
  growth:
    'רמת סיכון צמיחה: דגש על מניות עם כרית סולידית. מתאים רק אם אתה יכול לספוג ירידה זמנית או לדחות את המטרה במקרה של משבר.',
}

/** Vehicles by investor type + citizenship. US citizens never get Israeli
 *  packaged products or funds (PFIC). */
function mediumVehicles(investorType: InvestorType, isUSCitizen: boolean): string {
  if (isUSCitizen) {
    let s = 'בגלל האזרחות האמריקאית, קופת גמל להשקעה, פוליסת חיסכון וקרנות ישראליות לא מתאימות לך (PFIC). ' +
      'כיוון מעשי: את החלק המנייתי דרך תיק מסחר בברוקר אמריקאי (למשל אינטראקטיב ברוקרס), ואת החלק הסולידי בשקלים — למי שמבין, חשבון מסחר ישראלי עם אג"ח ממשלתי קצר מועד, או בפשטות פיקדון שקלי.'
    if (investorType === 'managed') {
      s += ' שים לב: מסלול של מוצר מנוהל ישראלי לא פתוח בפניך בגלל PFIC, אז כאן נדרשת גישה עצמאית יותר.'
    }
    return s
  }
  if (investorType === 'managed') {
    return 'אם אתה מעדיף שלא לנהל בעצמך: קופת גמל להשקעה, במסלול שמתאים לרמת הסיכון שבחרת. חלופה נוספת היא פוליסת חיסכון, אבל יש בה חסרונות (דמי ניהול, נזילות), אז כדאי לבדוק אותה לעומק.'
  }
  return 'אם אתה מנהל בעצמך: תיק מאוזן דרך חשבון מסחר. את החלק הסולידי החזק בשקלים (אג"ח ממשלתי קצר, מק"מ, קרן כספית או פיקדון), ואת החלק המנייתי במדדים רחבים. בחלק המנייתי חשיפה מטבעית היא חלק מהעניין, לא צריך לפחד ממנה.'
}

export function analyzeMediumTermGoal(g: GoalFacts, ctx: AnalysisContext): GoalAnalysis {
  const facts = factsHeader('טווח בינוני', g)
  const done  = g.required > 0 && g.current >= g.required

  if (!g.riskLevel || !g.investorType) {
    return {
      id: g.id, name: g.name, facts, opinion: null,
      choicePrompt: 'בחר על המטרה רמת סיכון (סולידי / מאוזן / צמיחה) וסוג משקיע (מוצר מנוהל / משקיע לבד), ואז הרץ שוב.',
      notes: [],
    }
  }

  const opinion = RISK_OPINION[g.riskLevel] + '\n\n' + mediumVehicles(g.investorType, ctx.isUSCitizen)
  const notes = timingNotes(g, ctx)
  if (done) {
    notes.unshift('כבר הגעת ליעד. ככל שאתה מתקרב לשימוש בכסף, שווה לשקול להקטין את הסיכון ולעבור לכיוון סולידי יותר.')
  }

  return { id: g.id, name: g.name, facts, opinion, choicePrompt: null, notes }
}

// ── LONG TERM (7 years and up) ───────────────────────────────────────────────
//
// Time works for you: let compounding accumulate through a broad, passive,
// globally-diversified investment held for years. Same two per-goal inputs as
// the medium term (risk level + investor type), but here risk level means
// VOLATILITY TOLERANCE — how you'd react to a big drop — because over long
// horizons the probability of loss collapses (historically ~0% over 20y, and no
// continuous 15y stretch has lost). The real long-term risk is behavioural: not
// staying the course. Currency matters less (it evens out over years). Pension
// products (pension fund, השתלמות) should sit in an equity track first.
// US citizens: US-domiciled ETFs via a US broker (PFIC) — no Israeli funds.

export const LONG_TERM_PRINCIPLES =
  'טווח ארוך (7 שנים ומעלה) הוא המקום שבו הזמן עובד לטובתך: נותנים לריבית דריבית לצבור הון לאורך שנים, בהשקעה מפוזרת ופאסיבית שמכסה את כל השוק העולמי. ככל שמשקיעים יותר זמן, הסבירות להפסיד קורסת: על פני שנה בערך 25%, על פני 5 שנים בערך 10%, ועל פני 20 שנה קרוב ל‑0%. היסטורית, לא היה מקרה שמישהו שהשקיע במדדים רחבים ברצף של 15 שנה הפסיד. מטבע הוא פחות שיקול כאן, כי הוא מתאזן לאורך שנים. הסיכון האמיתי בטווח ארוך הוא לא השוק, אלא לא להתמיד ולמכור בפאניקה בזמן ירידה.'

export const LONG_DISCLAIMER =
  'זה לא ייעוץ השקעות ולא המלצה, זה כיוון חשיבה. השקעה לטווח ארוך דורשת הבנה בסיסית של השוק, יכולת התמדה, וסיבולת לתנודתיות. חשוב מאוד ללמוד את התחום ולהתייעץ עם איש מקצוע לפני הביצוע.'

// The pension layer — shown for every long-term goal, before the free-money
// direction. The base, per the advisor.
const LONG_PENSION_NOTE =
  'קודם כל, ודא שהמוצרים הפנסיוניים שלך (קרן פנסיה, קרן השתלמות) נמצאים במסלול מנייתי שמתאים לטווח ארוך. זה הבסיס, עוד לפני הכסף הפנוי.'

// Risk level in the long term = volatility tolerance (how you react to a drop).
const LONG_RISK_OPINION: Record<RiskLevel, string> = {
  solid:
    'רמת הסיכון כאן היא סיבולת תנודתיות, כלומר איך תגיב לירידה חדה. סיבולת נמוכה: אם ירידה של עשרות אחוזים תגרום לך למכור בפאניקה, עדיף מסלול שתוכל להחזיק בו. אבל שים לב, בטווח ארוך ישיבה בסולידי מוותרת על חלק גדול מהצמיחה, והיסטורית הזמן תיקן את הירידות.',
  balanced:
    'רמת הסיכון כאן היא סיבולת תנודתיות, כלומר איך תגיב לירידה חדה. סיבולת בינונית: אתה סופג ירידות אבל מעדיף לא את המקסימום. מסלול מנייתי עם ריכוך מסוים יכול להתאים.',
  growth:
    'רמת הסיכון כאן היא סיבולת תנודתיות, כלומר איך תגיב לירידה חדה. סיבולת גבוהה: אתה מבין שירידות הן חלק מהדרך ומסוגל להחזיק דרכן. בטווח ארוך זו בדרך כלל הגישה שממקסמת את פוטנציאל הצמיחה, בתנאי שתתמיד.',
}

function longVehicles(investorType: InvestorType, isUSCitizen: boolean): string {
  if (isUSCitizen) {
    return 'בגלל האזרחות האמריקאית, מוצרים ארוזים וקרנות ישראליות לא מתאימות לך (PFIC). הכיוון: קרנות סל אמריקאיות שעוקבות אחרי מדדים רחבים, דרך ברוקר אמריקאי (למשל אינטראקטיב ברוקרס).'
  }
  if (investorType === 'managed') {
    return 'אם אתה מעדיף שלא לנהל בעצמך: קופת גמל להשקעה או פוליסת חיסכון במסלול מנייתי. שים לב לדמי הניהול, בטווח ארוך יש להם משמעות ענקית על הסכום הסופי.'
  }
  return 'אם אתה מנהל בעצמך: קרנות סל שעוקבות אחרי מדדים רחבים (כל השוק העולמי), דרך ברוקר ישראלי ולא דרך הבנק (עמלות גבוהות).'
}

export function analyzeLongTermGoal(g: GoalFacts, ctx: AnalysisContext): GoalAnalysis {
  const facts = factsHeader('טווח ארוך', g)
  const done  = g.required > 0 && g.current >= g.required

  if (!g.riskLevel || !g.investorType) {
    return {
      id: g.id, name: g.name, facts, opinion: null,
      choicePrompt: 'בחר על המטרה רמת סיכון (סיבולת תנודתיות: סולידי / מאוזן / צמיחה) וסוג משקיע (מוצר מנוהל / משקיע לבד), ואז הרץ שוב.',
      notes: [],
    }
  }

  const opinion = LONG_PENSION_NOTE + '\n\n' + LONG_RISK_OPINION[g.riskLevel] + '\n\n' + longVehicles(g.investorType, ctx.isUSCitizen)
  // No pace/realism notes in the long term: requiredMonthly() assumes the whole
  // gap is filled by contributions alone, ignoring market return + compounding —
  // which do most of the work over 7+ years, so "you need X/month, unrealistic"
  // would be misleading here.
  const notes: string[] = []
  if (done) {
    notes.unshift('כבר הגעת ליעד. ככל שאתה מתקרב לשימוש בכסף, שווה לשקול להתחיל למתן את הסיכון בהדרגה.')
  }

  return { id: g.id, name: g.name, facts, opinion, choicePrompt: null, notes }
}

// ── batch entry points ───────────────────────────────────────────────────────

const hasContent = (g: GoalFacts) => g.name.trim() !== '' || g.required > 0

export function analyzeShortTerm(goals: GoalFacts[], ctx: AnalysisContext): GoalAnalysis[] {
  return goals.filter(hasContent).map(g => analyzeShortTermGoal(g, ctx))
}

export function analyzeMediumTerm(goals: GoalFacts[], ctx: AnalysisContext): GoalAnalysis[] {
  return goals.filter(hasContent).map(g => analyzeMediumTermGoal(g, ctx))
}

export function analyzeLongTerm(goals: GoalFacts[], ctx: AnalysisContext): GoalAnalysis[] {
  return goals.filter(hasContent).map(g => analyzeLongTermGoal(g, ctx))
}
