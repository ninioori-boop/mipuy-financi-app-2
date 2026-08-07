// Annual expenses FOR THE AUTOMAP LAB ONLY.
//
// The problem this solves: an annual expense is, by definition, one that does
// not appear in a three-month window. Car insurance, ארנונה, school fees and
// the family holiday are simply absent from the files the advisor uploads —
// and the absence is invisible, because everything that IS there reconciles
// perfectly. The mapping looks complete while missing tens of thousands a year.
//
// The obvious fix — upload twelve months — was rejected, correctly: it is not a
// realistic ask of a client and it inflates cost. So there are two cheap paths
// instead, and they are deliberately NON-OVERLAPPING:
//
//   1. CHECKLIST  — for annual expenses that are NOT in the data. Ninety
//      seconds of tickboxes instead of a year of statements.
//   2. DETECTION  — for annual expenses that ARE in the data and are being
//      quietly divided by the month count. A ₪3,600 yearly car-insurance charge
//      inside a 3-month window becomes ₪1,200/month: wrong in both directions,
//      and nothing downstream can catch it.
//
// Both are deterministic. Neither costs an AI call.

import type { CategoryBreakdown } from './autoMap'

export interface AnnualChecklistItem {
  key:      string
  label:    string
  group:    string
  /** Parent category, so a confirmed amount lands in the right place. */
  category: string
}

/**
 * The four groups Ori picked (2026-08-07). Kept SHORT on purpose — a checklist
 * long enough to feel like work is a checklist nobody fills in. Each entry is
 * something a client can answer from memory in a few seconds.
 */
// ⚠️ `category` must be a member of ALL_CATEGORIES — the prompt forbids the
// model from inventing categories, so handing it one that isn't on that list
// would be the same self-contradiction the 2026-08-07 round removed. Note
// ALL_CATEGORIES carries only the generic 'ביטוח'; the per-type insurance names
// live in INSURANCE_CATEGORIES and are NOT valid row categories.
export const ANNUAL_CHECKLIST: AnnualChecklistItem[] = [
  // ביטוחים
  { key: 'ins_car',     label: 'ביטוח רכב (חובה + מקיף)', group: 'ביטוחים',          category: 'ביטוח' },
  { key: 'ins_home',    label: 'ביטוח מבנה ותכולה',        group: 'ביטוחים',          category: 'ביטוח' },
  { key: 'ins_health',  label: 'ביטוח בריאות / חיים',      group: 'ביטוחים',          category: 'ביטוח' },
  // רכב ואגרות
  { key: 'car_test',    label: 'טסט וטיפולים שנתיים',      group: 'רכב ואגרות',       category: 'תיקוני רכב' },
  { key: 'car_license', label: 'אגרת רישוי רכב',           group: 'רכב ואגרות',       category: 'תיקוני רכב' },
  { key: 'municipal',   label: 'ארנונה (אם לא חודשית)',    group: 'רכב ואגרות',       category: 'ארנונה' },
  // ילדים וחינוך
  { key: 'edu_fee',     label: 'אגרת חינוך / ועד הורים',   group: 'ילדים וחינוך',     category: 'חינוך וקייטנות' },
  { key: 'edu_camp',    label: 'קייטנות',                  group: 'ילדים וחינוך',     category: 'חינוך וקייטנות' },
  { key: 'edu_classes', label: 'חוגים שנתיים',             group: 'ילדים וחינוך',     category: 'חינוך וקייטנות' },
  { key: 'edu_supply',  label: 'ציוד לשנת לימודים',        group: 'ילדים וחינוך',     category: 'חינוך וקייטנות' },
  // אירועים וחופשות
  { key: 'vacation',    label: 'חופשה שנתית',              group: 'אירועים וחופשות',  category: 'חופשה וטיול' },
  { key: 'gifts',       label: 'מתנות לאירועים',           group: 'אירועים וחופשות',  category: 'מתנות' },
  { key: 'holidays',    label: 'הוצאות חגים',              group: 'אירועים וחופשות',  category: 'מתנות' },
]

/**
 * A charge below this is not worth interrupting the advisor for. Ori chose
 * ₪2,000 (2026-08-07) over ₪500/₪1,000 — deliberately a short, high-signal
 * list. A report that cries wolf is a report that stops being read.
 */
export const ONE_OFF_MIN = 2000

export interface OneOffCandidate {
  /** Stable identity for dismiss/confirm — the merchant's normalized name. */
  key:      string
  name:     string
  category: string
  amount:   number
}

/**
 * Charges that appeared exactly ONCE across a multi-month period and are large
 * enough to matter. Suspicious for annual, never assumed to be — a new sofa
 * looks identical to a yearly insurance premium from the data alone, so this
 * only ever raises the question for the advisor to answer.
 *
 * Requires months >= 2: in a single-month window every charge appears once, so
 * the signal carries no information and the list would be pure noise.
 */
export function detectOneOffCharges(
  breakdown: CategoryBreakdown[],
  months: number,
  dismissed: Set<string> = new Set(),
  confirmed: Set<string> = new Set(),
): OneOffCandidate[] {
  if (months < 2) return []
  const out: OneOffCandidate[] = []
  for (const cat of breakdown) {
    for (const m of cat.merchants) {
      if (m.count !== 1 || m.sum < ONE_OFF_MIN) continue
      const key = oneOffKey(cat.category, m.key)
      if (dismissed.has(key) || confirmed.has(key)) continue
      out.push({ key, name: m.name, category: cat.category, amount: m.sum })
    }
  }
  return out.sort((a, b) => b.amount - a.amount)
}

export interface AnnualItem {
  key:          string
  name:         string
  annualAmount: number
  category:     string
  /** 'checklist' = not in the data. 'detected' = in the data, so it must be excluded from the monthly breakdown. */
  source:       'checklist' | 'detected'
}

/** Renders the confirmed annual expenses as the block the model receives. */
export function formatAnnualItems(items: AnnualItem[]): string[] {
  if (!items.length) return []
  const out = ['(סכומים שנתיים שהיועץ אישר. זה המקור לסעיף annual — אל תחלק אותם ב‑12 ואל תספור אותם שוב במקום אחר)']
  for (const i of items) {
    const note = i.source === 'detected' ? ' — כבר הוסר מבלוק ההוצאות' : ''
    out.push(`  - ${i.name} (${i.category}): ${Math.round(i.annualAmount)} לשנה${note}`)
  }
  return out
}

/**
 * Stable identity for a merchant within a category, built from the NORMALIZED
 * merchant key (MerchantLine.key), not its display name. Used both to build the
 * detection list and to drop a confirmed charge from the expense set, so the
 * two can never disagree about which transaction they mean.
 */
export function oneOffKey(category: string, merchantKey: string): string {
  return `${category}::${merchantKey}`
}
