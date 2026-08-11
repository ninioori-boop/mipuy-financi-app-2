// Recurring charges, and which of them are really subscriptions.
//
// A mapping collapses every subscription into one row: on Ori's first real run
// the whole מנויים section was a single "מנויים ₪421", while the underlying
// charges were 217ACADEMY ₪400, פרטנר ₪113, גוגל בוסו ₪32 and ספוטיפיי ₪24 —
// four decisions a household could actually make, presented as one number
// nobody can act on. And a barber charged ₪100 every month for four months sat
// in משתנות, where nothing marks it as a standing commitment at all.
//
// So this finds what repeats, and separates the two questions Ori asked for:
// what IS already filed as a subscription, and what merely LOOKS like one and
// is filed somewhere else. The second list is the one with a button on it.
//
// 🔒 Lab-owned. The credit tab has its own SmartPatterns panel with its own
// rules, and it is live for every client — it is not touched, not extracted
// from, and not shared with this.

import { normalizeForLookup } from './normalizeForLookup'
import { isPaymentRailKey } from './learnedSharing'
import {
  SUB_CATEGORIES, FIXED_CATEGORIES, INSURANCE_CATEGORIES,
  ANNUAL_CATEGORIES, SKIP_CATEGORIES,
} from './constants'

/** The category a confirmed subscription moves to. */
export const SUB_TARGET = 'מנויים'

export interface RecurringInput {
  desc:      string
  amount:    number
  category:  string
  date:      string
  isRefund:  boolean
  isStandingOrder?: boolean
}

export interface RecurringItem {
  key:        string
  name:       string
  category:   string
  /** Average across the months it actually appeared in. */
  monthly:    number
  /** Distinct calendar months it appeared in. */
  months:     number
  charges:    number
  /** (max − min) / avg across those months. 0 = the same amount every time. */
  spread:     number
  stable:     boolean
  standingOrder: boolean
  /** Already filed as a subscription, or only looks like one. */
  status:     'known' | 'suspect'
  confidence: 'high' | 'medium'
  reason:     string
  perMonth:   { month: string; amount: number }[]
}

/**
 * The month a charge belongs to, from either date format in play.
 *
 * ⚠️ Credit rows arrive as DD-MM-YYYY and bank rows as YYYY-MM-DD, in the same
 * list. Reading a fixed slice of the string gets one of them right and quietly
 * scatters the other across twelve imaginary months, which would make every
 * merchant look like it appeared once and kill the detector outright.
 */
export function monthKeyOf(date: string): string | null {
  const s = String(date ?? '').trim()
  let m = s.match(/^(\d{4})-(\d{2})-\d{2}$/)
  if (m) return `${m[1]}-${m[2]}`
  m = s.match(/^\d{1,2}[-/](\d{1,2})[-/](\d{4})$/)
  if (m) return `${m[2]}-${m[1].padStart(2, '0')}`
  return null
}

/** Sections where a repeating charge is already where it belongs. */
const SETTLED = (c: string) =>
  FIXED_CATEGORIES.has(c) || INSURANCE_CATEGORIES.has(c) || ANNUAL_CATEGORIES.has(c)

/** Same amount, near enough. A telco that rounds differently is still a telco. */
const STABLE_SPREAD = 0.2

/**
 * What repeats, and how confident we are that it is a subscription.
 *
 * The discriminator is NOT "appears every month" — food and fuel do that too,
 * and so does every household's supermarket. It is **one charge per month, for
 * about the same amount**. That is what separates ספוטיפיי from שופרסל, and it
 * is why the charge COUNT matters as much as the month count.
 *
 * Three exclusions, each for its own reason:
 *  - payment rails (ביט, פייבוקס): the same rail carries a different payee every
 *    month, so "BIT appears in all four months" says nothing. On the real run
 *    BIT was the largest repeating "merchant" in the file, at ₪1,655 a month.
 *  - savings and transfers: a monthly transfer to a fund is a commitment, but
 *    calling it a subscription and moving it to מנויים would book saving as
 *    spending.
 *  - anything already in קבועות / ביטוחים / שנתיות: it repeats, it is already
 *    filed as repeating, and there is no decision left to offer.
 */
export function detectRecurring(txns: RecurringInput[], windowMonths: number): RecurringItem[] {
  const window = Math.max(1, Math.round(windowMonths) || 1)
  const groups = new Map<string, {
    name: string; category: string; months: Map<string, number>
    charges: number; standingOrder: boolean
  }>()

  for (const t of txns) {
    if (t.isRefund) continue
    if (SKIP_CATEGORIES.has(t.category) || SETTLED(t.category)) continue
    const key = normalizeForLookup(t.desc) || t.desc.trim()
    if (!key || isPaymentRailKey(key)) continue
    const month = monthKeyOf(t.date)
    if (!month) continue

    const g = groups.get(key) ?? {
      name: t.desc.trim() || key, category: t.category,
      months: new Map<string, number>(), charges: 0, standingOrder: false,
    }
    g.months.set(month, (g.months.get(month) ?? 0) + t.amount)
    g.charges++
    if (t.isStandingOrder) g.standingOrder = true
    groups.set(key, g)
  }

  const out: RecurringItem[] = []
  // Present in most of the window, not just twice at the edges.
  const minMonths = Math.max(2, Math.ceil(window * 0.6))

  for (const [key, g] of groups) {
    const months = g.months.size
    if (months < minMonths) continue
    // Roughly one charge a month. A supermarket visited nine times in three
    // months repeats, but nobody would call it a subscription.
    if (g.charges > months * 1.5 + 0.5) continue

    const values = [...g.months.values()]
    const total  = values.reduce((s, n) => s + n, 0)
    const avg    = total / months
    if (avg <= 0) continue
    const spread = (Math.max(...values) - Math.min(...values)) / avg
    const stable = spread <= STABLE_SPREAD
    if (!stable && !g.standingOrder && months < window) continue

    const known = SUB_CATEGORIES.has(g.category)
    out.push({
      key, name: g.name, category: g.category,
      monthly: avg, months, charges: g.charges, spread, stable,
      standingOrder: g.standingOrder,
      status: known ? 'known' : 'suspect',
      confidence: stable && months >= window ? 'high' : 'medium',
      reason: reasonFor({ stable, months, window, standingOrder: g.standingOrder }),
      perMonth: [...g.months.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([month, amount]) => ({ month, amount })),
    })
  }

  return out.sort((a, b) => b.monthly - a.monthly)
}

function reasonFor(x: { stable: boolean; months: number; window: number; standingOrder: boolean }): string {
  if (x.standingOrder) return 'הוראת קבע'
  const every = x.months >= x.window
  if (x.stable && every) return `אותו סכום בכל ${x.months} החודשים`
  if (x.stable) return `אותו סכום, ב‑${x.months} מתוך ${x.window} חודשים`
  return `חיוב אחד בחודש ב‑${x.months} חודשים, בסכום משתנה`
}

/** What the panel shows: the two lists Ori asked for, already split. */
export function splitRecurring(items: RecurringItem[]) {
  return {
    known:    items.filter(i => i.status === 'known'),
    suspects: items.filter(i => i.status === 'suspect'),
  }
}
