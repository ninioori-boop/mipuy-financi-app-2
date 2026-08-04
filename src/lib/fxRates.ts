/**
 * Daily foreign-exchange rates to ILS, cached in Firestore.
 *
 * Used by /api/transaction to turn a charge captured abroad (£45) into the
 * shekel figure the rest of the app is built on. Everything downstream —
 * budgets, category totals, the monthly tabs — assumes ILS, so the conversion
 * happens once here, at ingest, and the original is stored alongside it.
 *
 * THE OVERRIDING RULE: capturing the charge matters more than pricing it
 * exactly. Every failure path (API down, no cache, malformed response) still
 * returns a usable rate and flags itself stale, because the alternative is
 * recording £45 as ₪45 — the bug this module exists to fix.
 *
 * Accuracy note: the card issuer converts at its own rate and adds a foreign-
 * transaction fee, so this figure is always an estimate — the UI marks it with
 * "~". The credit-card statement remains the source of truth, and the mapping
 * tab already reads the issuer's own ILS column (see parsing.ts).
 */

import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import type { CurrencyCode } from './currency'

export type Foreign = Exclude<CurrencyCode, 'ILS'>

const DOC = { collection: 'config', doc: 'fxRates' }

// Rates move by fractions of a percent a day; refreshing twice daily keeps the
// estimate honest without putting a network call on more than a couple of
// captures per day.
const TTL_MS = 12 * 60 * 60 * 1000

// The capture path must stay fast — this route is what makes a phone
// notification appear. Prefer a stale rate over a slow one.
const FETCH_TIMEOUT_MS = 4_000

// Last-resort rates, used only when the API is unreachable AND Firestore holds
// no cached rate at all (i.e. the very first foreign charge during an outage).
// Approximate mid-2026 levels — deliberately rough, and always reported as
// stale so the UI can say so.
const FALLBACK: Record<Foreign, number> = { USD: 3.7, GBP: 4.7, EUR: 4.0 }

// ECB reference rates. Free, no API key, no registration — which matters
// because a key would be one more secret to rotate for a non-critical lookup.
const API = 'https://api.frankfurter.app/latest?base=ILS&symbols=USD,GBP,EUR'

type CacheDoc = { rates?: Partial<Record<Foreign, number>>; at?: number }

/** Sanity bound — catches an inverted or garbage rate before it multiplies a charge. */
function plausible(r: unknown): r is number {
  return typeof r === 'number' && Number.isFinite(r) && r > 0.5 && r < 100
}

/**
 * Frankfurter returns how much foreign currency one shekel buys
 * (base=ILS → {"GBP": 0.21}). We want the inverse: shekels per unit.
 */
async function fetchRates(): Promise<Record<Foreign, number> | null> {
  try {
    const res = await fetch(API, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      // Next.js would otherwise cache this at the framework layer too; the
      // Firestore doc is our cache, and it is the one we can inspect.
      cache: 'no-store',
    })
    if (!res.ok) return null
    const json = await res.json() as { rates?: Record<string, unknown> }
    const out = {} as Record<Foreign, number>
    for (const cur of ['USD', 'GBP', 'EUR'] as Foreign[]) {
      const perIls = json.rates?.[cur]
      if (typeof perIls !== 'number' || !Number.isFinite(perIls) || perIls <= 0) return null
      const toIls = 1 / perIls
      if (!plausible(toIls)) return null
      out[cur] = Math.round(toIls * 10000) / 10000
    }
    return out
  } catch {
    return null   // timeout / offline / malformed — caller falls back
  }
}

/**
 * Shekels per one unit of `currency`, plus whether the figure is stale (cache
 * older than the TTL with no fresh fetch, or the hardcoded fallback).
 * Never throws.
 */
export async function getIlsRate(
  db: Firestore,
  currency: Foreign,
): Promise<{ rate: number; stale: boolean }> {
  let cached: CacheDoc | null = null
  try {
    const snap = await db.collection(DOC.collection).doc(DOC.doc).get()
    cached = snap.exists ? (snap.data() as CacheDoc) : null
  } catch {
    // Firestore unavailable — fall through to a live fetch.
  }

  const cachedRate = cached?.rates?.[currency]
  const fresh = typeof cached?.at === 'number' && Date.now() - cached.at < TTL_MS
  if (fresh && plausible(cachedRate)) return { rate: cachedRate, stale: false }

  const fetched = await fetchRates()
  if (fetched) {
    // Best-effort write-back: a failure here just means the next capture
    // re-fetches. Never blocks the response.
    db.collection(DOC.collection).doc(DOC.doc)
      .set({ rates: fetched, at: Date.now(), source: 'frankfurter', updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      .catch(() => { /* cache is an optimization, not a requirement */ })
    return { rate: fetched[currency], stale: false }
  }

  // API unreachable. A stale cached rate is far better than the fallback.
  if (plausible(cachedRate)) return { rate: cachedRate, stale: true }
  return { rate: FALLBACK[currency], stale: true }
}

/**
 * Converts to ILS. Returns null only for a rate that failed the sanity check,
 * which callers treat as "capture it as-is" rather than dropping the charge.
 */
export function toIls(amount: number, rate: number): number | null {
  if (!plausible(rate)) return null
  const ils = amount * rate
  return Number.isFinite(ils) && ils > 0 ? Math.round(ils * 100) / 100 : null
}
