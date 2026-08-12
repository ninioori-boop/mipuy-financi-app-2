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

  // Present in most of the window, and about one deposit a month. Same
  // discriminator as the subscription detector, and for the same reason: a
  // trading account funded nine times in three months is being traded in, not
  // contributed to on a schedule.
  const minMonths = Math.max(2, Math.ceil(window * 0.6))

  const deposits: SavingsDeposit[] = []
  for (const [key, g] of groups) {
    const months = g.months.size
    const recurring = months >= minMonths && g.charges <= months * 1.5 + 0.5
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
  /** Monthly total of the unexplained recurring ones. */
  unexplainedMonthly: number
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

  const explained: DepositLine[] = [], unexplained: DepositLine[] = [], oneOff: DepositLine[] = []
  for (const c of pool) {
    if (c.claimed) explained.push(c.line)
    else if (c.months >= minMonths) unexplained.push(c.line)
    else oneOff.push(c.line)
  }

  return {
    explained, unexplained, oneOff,
    unexplainedMonthly: unexplained.reduce((s, l) => s + l.monthly, 0),
  }
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
    '🔴 ההכנסה של המיפוי נמסרה בשאלון. הרשימה כאן היא ההפקדות שנצפו בפועל בעו"ש, והיא כבר מחולקת לשלוש.',
    `(כל הסכומים כאן הם ממוצע חודשי — סך ההפקדות חולק ב‑${m}. אל תחלק שוב.)`,
  ]

  if (split.explained.length) {
    out.push('הפקדות שתואמות את מה שנמסר בשאלון. **זה אותו כסף.** אל תוסיף אותן ל‑income ואל תסכם אותן עם המוצהר:')
    for (const l of split.explained) out.push(`  - ${l.name}: ${Math.round(l.monthly)} לחודש (${l.count} הפקדות ב‑${l.months} חודשים)`)
  }

  if (split.unexplained.length) {
    out.push(`🔴 הכנסה שנכנסה לחשבון ואינה מוסברת על ידי השאלון, ${Math.round(split.unexplainedMonthly)} לחודש. **הוסף כל שורה כאן ל‑income**, בנוסף למה שנמסר. זו לא כפילות: המספר שנמסר בשאלון לא כלל אותה.`)
    for (const l of split.unexplained) out.push(`  - ${l.name}: ${Math.round(l.monthly)} לחודש (${l.count} הפקדות ב‑${l.months} מתוך ${m} חודשים)`)
  }

  if (split.oneOff.length) {
    out.push('הפקדות שהופיעו בחודש אחד בלבד. כנראה חד־פעמיות ולא הכנסה חודשית. הזכר אותן ב‑assessment ואל תכניס אותן ל‑income בלי סיבה:')
    for (const l of split.oneOff) out.push(`  - ${l.name}: ${Math.round(l.sum)} בסך הכל (${l.count} הפקדות)`)
  }

  return out
}
