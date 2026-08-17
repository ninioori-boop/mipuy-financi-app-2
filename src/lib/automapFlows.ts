// Money that moved, and the mapping never noticed. LAB-ONLY.
//
// Two findings from Ori's first real run, and they are the two largest numbers
// on the whole list — together ₪21,800 a month, against ₪700 for everything
// else that was wrong:
//
//   ₪8,648/mo left the account for savings and investment platforms, and all
//   six savings rows in the generated mapping carried monthlyContribution: 0.
//   The household was shown as saving nothing while saving more than most.
//
//   ₪13,200/mo of מילואים grants arrived and appear nowhere in the mapping.
//   The questionnaire declared ₪12,000 of salary, so the deposits block flipped
//   to verification-only — correct for the salary, and it took the grants down
//   with it.
//
// Both have the same shape: a real, repeating flow that the model could see in
// the data but had no instruction to DO anything with. Neither is fixable by
// asking the model to try harder, because in both cases what it produced was a
// defensible reading of what it was given. So both are computed here, named,
// and handed over as their own block with the arithmetic already done.
//
// 🔒 Lab-owned. Nothing here is imported by a live tab.

import { normalizeForLookup } from './normalizeForLookup'
import { isPaymentRailKey } from './learnedSharing'
import { categorize } from './categorize'
import { monthKeyOf } from './automapRecurring'

// ── money leaving to savings ──

/**
 * Categories that mean "this money is still the client's".
 *
 * 'העברות ואשראי' is deliberately NOT here. It carries card settlements and
 * transfers between the household's own accounts, and calling those a savings
 * deposit would book the same money as saved and as spent.
 */
const SAVINGS_CATEGORIES = new Set(['חסכונות', 'השקעות'])

export interface SavingsDeposit {
  key:      string
  name:     string
  category: string
  /** Average per month across the months it actually appeared in. */
  monthly:  number
  /** Total over the whole window. */
  total:    number
  months:   number
  charges:  number
  /**
   * Repeats like a standing commitment, as opposed to one lump sum that
   * happened to land inside the window. Only these belong in
   * monthlyContribution; a lump sum is accumulated capital, not a rate.
   */
  recurring: boolean
}

export interface SavingsFlow {
  deposits: SavingsDeposit[]
  /** Monthly total of the recurring ones — the figure savings rows should sum to. */
  monthlyRecurring: number
  /** Window total of the one-off ones. */
  oneOffTotal: number
}

export function detectSavingsDeposits(
  txns: { desc: string; amount: number; category: string; date: string; isRefund: boolean }[],
  windowMonths: number,
): SavingsFlow {
  const window = Math.max(1, Math.round(windowMonths) || 1)
  const groups = new Map<string, {
    name: string; category: string; months: Map<string, number>; charges: number; total: number
  }>()

  for (const t of txns) {
    if (t.isRefund || !SAVINGS_CATEGORIES.has(t.category)) continue
    const key = normalizeForLookup(t.desc) || t.desc.trim()
    // A rail can carry a transfer to a savings account, but it carries eight
    // other things too — there is nothing reliable to call a contribution.
    if (!key || isPaymentRailKey(key)) continue
    const g = groups.get(key) ?? {
      name: t.desc.trim() || key, category: t.category,
      months: new Map<string, number>(), charges: 0, total: 0,
    }
    const month = monthKeyOf(t.date)
    if (month) g.months.set(month, (g.months.get(month) ?? 0) + t.amount)
    g.charges++
    g.total += t.amount
    groups.set(key, g)
  }

  // 🔴 Present in most of the window, and that is the WHOLE test.
  //
  // The subscription detector also requires about one charge a month, and
  // copying that rule here was wrong. Replaying the real run exposed it: אקסלנס
  // was funded 6 times in 3 months, אלטשולר 10 times, קסם אקטיב 12 — so all
  // four of the household's largest deposits failed the charge-count test and
  // ₪8,648 a month of saving was reported as ₪506. A person who buys into a
  // fund four times a month is saving monthly; only a SUBSCRIPTION has to be
  // billed exactly once, because that is what makes it a subscription.
  const minMonths = Math.max(2, Math.ceil(window * 0.6))

  const deposits: SavingsDeposit[] = []
  for (const [key, g] of groups) {
    const months = g.months.size
    const recurring = months >= minMonths
    deposits.push({
      key, name: g.name, category: g.category,
      monthly: months > 0 ? g.total / months : g.total,
      total: g.total, months, charges: g.charges, recurring,
    })
  }
  deposits.sort((a, b) => b.total - a.total)

  return {
    deposits,
    monthlyRecurring: deposits.filter(d => d.recurring).reduce((s, d) => s + d.monthly, 0),
    oneOffTotal:      deposits.filter(d => !d.recurring).reduce((s, d) => s + d.total, 0),
  }
}

export function formatSavingsDeposits(flow: SavingsFlow, months: number): string[] {
  if (!flow.deposits.length) return []
  const m = Math.max(1, months)
  const recurring = flow.deposits.filter(d => d.recurring)
  const oneOff    = flow.deposits.filter(d => !d.recurring)

  const out = [
    '🔴 הכסף הזה יצא מהעו"ש אל חיסכון או השקעה. הוא לא הוצאה, והוא גם לא "כלום".',
    'כל שורה כאן חייבת להופיע ב‑savings. הפקדה שחוזרת כל חודש היא monthlyContribution, ואל תשאיר אותו 0 כשיש כאן מספר.',
    'אם השאלון מסר שווי צבור למוצר שמופיע כאן, זו אותה שורה: accumulated מהשאלון, monthlyContribution מכאן. אל תיצור שתי שורות.',
  ]
  if (recurring.length) {
    out.push(`הפקדות חוזרות (סה"כ ${Math.round(flow.monthlyRecurring)} לחודש) — אלה ה‑monthlyContribution:`)
    for (const d of recurring) {
      out.push(`  - ${d.name} [${d.category}]: ${Math.round(d.monthly)} לחודש (${d.charges} הפקדות ב‑${d.months} מתוך ${m} חודשים)`)
    }
  }
  if (oneOff.length) {
    out.push(`הפקדות חד־פעמיות (סה"כ ${Math.round(flow.oneOffTotal)} בתקופה) — הפקדה לצבירה, לא קצב חודשי. אל תחלק אותן במספר החודשים:`)
    for (const d of oneOff) {
      out.push(`  - ${d.name} [${d.category}]: ${Math.round(d.total)} בסך הכל (${d.charges} הפקדות ב‑${d.months} חודשים)`)
    }
  }
  return out
}

// ── linking a deposit to the product it feeds ──

export interface DeclaredProduct {
  name:     string
  provider: string
  /** Accumulated value, as declared. */
  amount:   number
}

export interface ProductLink {
  /** The declared product, or null when the charge matches nothing declared. */
  product:  DeclaredProduct | null
  deposit:  SavingsDeposit
}

/**
 * Which declared product each recurring purchase is feeding.
 *
 * Ori asked exactly the right question (2026-08-17): "אולי אם הייתי רושם איפה
 * נמצא כל נכס המערכת הייתה מצליחה לזהות?" — and the answer is yes, which is why
 * the questionnaire now asks where each product is held.
 *
 * Without it, his run produced eleven savings rows for what is really a handful
 * of products: five rows carrying a monthly contribution and no balance (built
 * from the bank descriptors, which DO name the provider), and six carrying a
 * balance and no contribution (built from the questionnaire, which did not).
 * Nothing could connect "קניה/( קסם אקטיב/טלפון ני" to "קרן השתלמות" because
 * the two strings share nothing.
 *
 * ⚠️ Matched on the PROVIDER, not the product name. A person writes
 * "קרן השתלמות" and the bank writes "קסם אקטיב" — the names never agree and the
 * providers do. A product with no provider written simply does not match, which
 * is the honest outcome: it leaves the advisor the same decision they have today
 * rather than inventing a link.
 */
export function linkDepositsToProducts(
  deposits: SavingsDeposit[],
  products: DeclaredProduct[],
): ProductLink[] {
  const named = products.filter(p => p.provider.trim())
  return deposits.map(deposit => {
    const key = normalizeForLookup(deposit.name) || deposit.name.toLowerCase()
    const product = named.find(p => {
      const prov = normalizeForLookup(p.provider) || p.provider.toLowerCase().trim()
      return prov.length >= 3 && key.includes(prov)
    }) ?? null
    return { product, deposit }
  })
}

export function formatProductLinks(links: ProductLink[]): string[] {
  const matched = links.filter(l => l.product)
  if (!matched.length) return []
  const out = [
    '🔴 ההפקדה והצבירה שלמטה הן **אותו מוצר**, כי הלקוח מסר איפה הוא מנוהל.',
    'שורה אחת ב‑savings לכל זוג: accumulated מהשאלון, monthlyContribution מהעו"ש. אל תיצור שתי שורות.',
  ]
  for (const { product, deposit } of matched) {
    out.push(`  - ${product!.name} (${product!.provider}): צבירה ${Math.round(product!.amount)}, הפקדה ${Math.round(deposit.monthly)} לחודש (מהחיוב "${deposit.name}")`)
  }
  return out
}

// ── money arriving that nobody declared ──

export interface DepositLine {
  name:   string
  /** Already a monthly average over the window. */
  monthly: number
  sum:    number
  count:  number
  months: number
}

export interface DepositSplit {
  /** Deposits that match a declared earner's figure — the same money, twice seen. */
  explained:   DepositLine[]
  /** Deposits that recur and match nothing declared. These belong in income. */
  unexplained: DepositLine[]
  /** One-time arrivals. Real money, but not a monthly income rate. */
  oneOff:      DepositLine[]
  /**
   * The household's own money coming back: a Bit withdrawal to the current
   * account, a transfer from another account of theirs.
   *
   * 🔴 This bucket is why the split is four ways and not three. Replaying the
   * real run with three buckets reported ₪15,022/month of "undeclared income",
   * of which only ₪13,200 was real — the rest was אורי moving his own money
   * back from Bit. Calling that income inflates the household's earnings by the
   * exact amount it already counted as an expense on the way out.
   */
  transfers:   DepositLine[]
  /** Monthly total of the unexplained recurring ones. */
  unexplainedMonthly: number
  /** What the questionnaire declared, per month. */
  declaredMonthly: number
  /** What actually arrived, per month. The ceiling on any income figure. */
  depositsMonthly: number
  /**
   * The deposits already cover the declared figure.
   *
   * 🔴 The correction that matters (Ori, 2026-08-17): "מי שמצהיר על הכנסה
   * כנראה מדווח כבר על ההכנסות שהמערכת תראה בעו״ש". A self-employed client's
   * declared total arrives as MANY irregular client payments, so matching one
   * deposit to one declared figure explains nothing and every payment looks
   * like a new income source. On his run that produced ₪26,132 of monthly
   * income against ₪23,106 of deposits — ₪3,026 a month the account never saw.
   */
  declaredCovered: boolean
}

/** Within this fraction of a declared figure, it is the same salary. */
const MATCH_TOLERANCE = 0.15

/**
 * Split the observed deposits against what the questionnaire declared.
 *
 * The rule that matters: a declared salary and its deposit are ONE income, and
 * adding them is the classic way to double a household's income on paper. But
 * "the deposits are already declared" is only true of the deposits that match
 * a declared figure. On the real run ₪13,200 a month of reserve-duty grants
 * arrived alongside a declared ₪12,000 salary, and treating the whole deposit
 * block as already-declared erased the larger of the two.
 *
 * Matching is on AMOUNT, not on name: a payslip says "מדינת ישראל" and the
 * questionnaire says "בעל" — the names never agree, and the monthly figures do.
 */
export function classifyDeposits(
  lines: { name: string; sum: number; count: number; months: number }[],
  declared: { name: string; monthly: number }[],
  windowMonths: number,
): DepositSplit {
  const m = Math.max(1, Math.round(windowMonths) || 1)
  const minMonths = Math.max(2, Math.ceil(m * 0.6))

  // Two different figures per deposit, on purpose.
  //
  // `perMonth` is the rate WHEN IT ARRIVES — the total over the months it
  // actually appeared in. That is the figure a declared salary is stated at, so
  // it is the one to match against: a ₪12,000 salary that missed a month is
  // still a ₪12,000 salary, and averaging it over the window turns it into
  // ₪8,000 and matches nothing.
  //
  // `monthly` is the window average, the unit every other block in the prompt
  // uses. Mixing the two inside one message is how a mapping ends up
  // self-consistent and wrong.
  const pool = [...lines]
    .sort((a, b) => b.sum - a.sum)
    .map(l => ({
      line: { name: l.name, monthly: l.sum / m, sum: l.sum, count: l.count, months: l.months },
      perMonth: l.months > 0 ? l.sum / l.months : l.sum / m,
      months: l.months,
      claimed: false,
    }))

  // 🔴 Each declared figure takes its CLOSEST deposit, not the first one inside
  // the tolerance. On the real run the reserve-duty grants (₪13,200) and the
  // salary (₪12,000) were both within 15% of the declared ₪12,000, and the
  // grants — being larger — were tested first and claimed it. The salary was
  // then reported as undeclared income and the ₪13,200 disappeared: the exact
  // error this function exists to prevent, with the two sides swapped.
  for (const d of declared.filter(x => x.monthly > 0).sort((a, b) => b.monthly - a.monthly)) {
    let best: typeof pool[number] | null = null
    let bestDiff = Infinity
    for (const c of pool) {
      if (c.claimed) continue
      const diff = Math.abs(c.perMonth - d.monthly)
      if (diff <= d.monthly * MATCH_TOLERANCE && diff < bestDiff) { best = c; bestDiff = diff }
    }
    // Consumed once, so two earners paid the same amount explain two deposits
    // and no more.
    if (best) best.claimed = true
  }

  const explained: DepositLine[] = [], unexplained: DepositLine[] = []
  const oneOff: DepositLine[] = [], transfers: DepositLine[] = []
  for (const c of pool) {
    if (c.claimed) explained.push(c.line)
    else if (isOwnMoney(c.line.name)) transfers.push(c.line)
    else if (c.months >= minMonths) unexplained.push(c.line)
    else oneOff.push(c.line)
  }

  const declaredMonthly = declared.reduce((s, d) => s + Math.max(0, d.monthly), 0)
  const depositsMonthly = lines.reduce((s, l) => s + l.sum, 0) / m

  return {
    explained, unexplained, oneOff, transfers,
    unexplainedMonthly: unexplained.reduce((s, l) => s + l.monthly, 0),
    declaredMonthly,
    depositsMonthly,
    // Deposits at or above the declared figure mean the declared money is
    // already in this list, whatever the individual rows matched. That is the
    // ordinary case for an employee AND for a self-employed client, and it is
    // the case where adding anything on top invents income.
    declaredCovered: declaredMonthly > 0 && depositsMonthly >= declaredMonthly,
  }
}

/**
 * A deposit that is the household's own money returning, not income.
 *
 * Two tests, both reusing machinery that already exists rather than a new list
 * of phrases: the payment-rail detector (a Bit withdrawal back to the current
 * account), and the categorizer landing the description in העברות ואשראי. The
 * curated DB is already the project's answer to "what is a transfer", and a
 * second opinion here would drift from it silently.
 *
 * Checked AFTER the declared-salary matching, deliberately: if a salary is paid
 * by a route that reads as a transfer, the questionnaire's own figure still
 * claims it, and a declared salary is never reclassified as noise.
 */
function isOwnMoney(name: string): boolean {
  const key = normalizeForLookup(name) || name.trim()
  if (!key) return false
  if (isPaymentRailKey(key)) return true
  const cat = categorize(name)
  // Selling a fund is not earning. On the real run four "מכירה/…" and
  // "ביטול העברה/…" lines came back from the same platforms the household had
  // just bought into, and every one of them was money it already owned.
  return cat === 'העברות ואשראי' || SAVINGS_CATEGORIES.has(cat)
}

/**
 * The deposits block, when income was declared in the questionnaire.
 *
 * Replaces the flat "this list is for verification only" header, which was
 * right about the salary and wrong about everything else in the list.
 */
export function formatDepositSplit(split: DepositSplit, months: number): string[] {
  const m = Math.max(1, months)
  const out: string[] = [
    '🔴 **ההכנסה של המיפוי היא המספר שנמסר בשאלון, ותו לא.**',
    `נמסר: ${Math.round(split.declaredMonthly)} לחודש. נכנס בפועל לעו"ש: ${Math.round(split.depositsMonthly)} לחודש.`,
    `🔴 **תקרה מוחלטת: סך ה‑income במיפוי לא יעלה על ${Math.round(split.depositsMonthly)} לחודש.** כסף שלא נכנס לחשבון אינו הכנסה.`,
    `(כל הסכומים כאן הם ממוצע חודשי — סך ההפקדות חולק ב‑${m}. אל תחלק שוב.)`,
  ]

  if (split.declaredCovered) {
    // The rule Ori stated, and the arithmetic that proves it: deposits are at
    // least the declared figure, so the declared money is already inside this
    // list. Adding rows from it counts the same money twice.
    out.push('ההפקדות למטה **גדולות או שוות** למה שנמסר, כלומר הכסף שנמסר כבר נמצא ביניהן. אדם שמוסר הכנסה מוסר את הסך הכול שלו.')
    out.push('לכן: **אל תוסיף אף שורה מהרשימה הזאת ל‑income.** מי שעצמאי מקבל את הכנסתו כהרבה תשלומים לא סדירים מלקוחות שונים, ולכן אף הפקדה בודדת לא "תתאים" למספר המוצהר, וזה לא אומר שהיא הכנסה נוספת.')
  }

  const notable = [...split.unexplained, ...split.oneOff]
    .filter(l => l.monthly >= 500)
    .sort((a, b) => b.monthly - a.monthly)
  if (notable.length) {
    out.push('הפקדות בולטות שנצפו. **הן לרשימה ב‑assessment בלבד, לא לשורות income.** לכל אחת כתוב בהערכה אם היא חלק מההכנסה שנמסרה, מקור נוסף, או תקבול זמני:')
    for (const l of notable) {
      const when = l.months >= Math.ceil(m * 0.6)
        ? `חוזרת ב‑${l.months} מתוך ${m} חודשים`
        : `הופיעה ב‑${l.months} מתוך ${m} חודשים`
      out.push(`  - ${l.name}: ${Math.round(l.monthly)} לחודש, ${when}`)
    }
    out.push('⚠️ הפקדה שחוזרת בדיוק לאורך כל החלון אינה בהכרח קבועה: מילואים, דמי לידה ודמי אבטלה נראים בדיוק כך, והם תקבול זמני שמחליף הכנסה ולא מתווסף לה. אם זה המקרה, אמור זאת ב‑assessment ואל תבנה עליו תקציב.')
  }

  if (split.transfers.length) {
    out.push('כסף של הלקוח שחוזר לחשבון (משיכה מביט, העברה מחשבון אחר שלו). **זו לא הכנסה.** אל תכניס אותן ל‑income בשום מקרה:')
    for (const l of split.transfers) out.push(`  - ${l.name}: ${Math.round(l.monthly)} לחודש`)
  }

  return out
}
