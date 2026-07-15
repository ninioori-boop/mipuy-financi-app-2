import type { ExpenseEntry } from '@/stores/expenseLogStore'

// A recurring, subscription-like charge inferred from the expense log.
export interface Subscription {
  name:          string   // display merchant name (most common spelling)
  category:      string   // most common category among its charges
  monthlyAmount: number   // representative (median) charge, rounded
  months:        number   // distinct calendar months it appeared in
  occurrences:   number   // total charges seen
  lastDate:      string   // YYYY-MM-DD of the most recent charge
  lastAmount:    number   // that charge's amount, rounded
}

// Notes carry source-specific suffixes; strip them to recover the merchant label.
//   captured:   "שופרסל #a1b2c3"        → REF_SUFFIX
//   recurring:  "נטפליקס · הוצאה קבועה ⟳" → RECURRING_SUFFIX
const REF_SUFFIX       = / #\S+$/
const RECURRING_SUFFIX = / · הוצאה קבועה ⟳$/

export function merchantOf(note: string): string {
  return note.replace(REF_SUFFIX, '').replace(RECURRING_SUFFIX, '').trim()
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function mode<T>(items: T[]): T {
  const count = new Map<T, number>()
  let best = items[0]
  let bestN = 0
  for (const it of items) {
    const n = (count.get(it) ?? 0) + 1
    count.set(it, n)
    if (n > bestN) { bestN = n; best = it }
  }
  return best
}

/**
 * Finds recurring, subscription-like charges in the expense log — merchants that
 * bill roughly once a month at a stable amount (streaming, gym, insurance).
 *
 * Deliberately conservative (accuracy > coverage): a false "מנוי" erodes trust.
 * A merchant qualifies only when it (1) recurs across ≥3 distinct months, at
 * (2) a mostly one-per-month cadence — NOT a supermarket you visit weekly — with
 * (3) a stable amount (most charges cluster around the median). Sorted by
 * monthly cost, biggest first, so the eye lands on the money that matters.
 */
export function detectSubscriptions(entries: ExpenseEntry[]): Subscription[] {
  // Group charges by normalized merchant.
  const groups = new Map<string, ExpenseEntry[]>()
  for (const e of entries) {
    if (!(e.amount > 0)) continue
    const name = merchantOf(e.note)
    if (name.length < 2) continue          // no usable merchant label
    const key = name.toLowerCase()
    const arr = groups.get(key) ?? []
    arr.push(e)
    groups.set(key, arr)
  }

  const subs: Subscription[] = []
  for (const arr of groups.values()) {
    const months = new Set(arr.map(e => e.date.slice(0, 7)))
    if (months.size < 3) continue          // not enough recurrence to be sure

    // Cadence: subscriptions bill ~once a month. Far more charges than months
    // (a supermarket) means ongoing spending, not a fixed subscription.
    if (arr.length > months.size * 1.4) continue

    // Amount stability: most charges must cluster near the typical amount.
    const amounts = arr.map(e => e.amount)
    const mid = median(amounts)
    if (mid <= 0) continue
    const withinBand = amounts.filter(a => Math.abs(a - mid) <= mid * 0.20).length
    if (withinBand < amounts.length * 0.6) continue   // too erratic — not a fixed bill

    const newestFirst = [...arr].sort((a, b) => (a.date < b.date ? 1 : -1))
    const last = newestFirst[0]
    subs.push({
      name:          mode(arr.map(e => merchantOf(e.note))),
      category:      mode(arr.map(e => e.category)),
      monthlyAmount: Math.round(mid),
      months:        months.size,
      occurrences:   arr.length,
      lastDate:      last.date,
      lastAmount:    Math.round(last.amount),
    })
  }

  return subs.sort((a, b) => b.monthlyAmount - a.monthlyAmount)
}

export function subscriptionsMonthlyTotal(subs: Subscription[]): number {
  return subs.reduce((sum, s) => sum + s.monthlyAmount, 0)
}
