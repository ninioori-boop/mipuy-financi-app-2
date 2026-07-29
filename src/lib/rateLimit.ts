import { FieldValue } from 'firebase-admin/firestore'
import { getAdminDb } from './firebaseAdmin'

// Shared, serverless-resilient rate limiter. Replaces the per-route in-memory
// `Map` counters, which reset on every cold start / new instance on Vercel and
// were therefore trivially bypassed by spreading requests across instances.
//
// Counter model: fixed window with a deterministic doc id (`<key>_<bucket>`), so
// each window is a fresh doc — no manual reset, and the previous window's doc is
// abandoned (TTL-cleaned). A transaction (1 read + 1 write) closes the race where
// two instances both believe they're under the limit. Volume is tiny, so the
// extra read is free.
//
// Deploy-dark: if the admin SDK isn't configured yet (`getAdminDb()` → null) or a
// Firestore op throws, it falls back to a per-instance in-memory Map — i.e. exactly
// today's behavior — and never blocks on infra failure. A rate limiter must never
// 5xx the request; the global kill-switch (aiBudget.ts) and the Anthropic
// spend-limit are the hard backstops.
//
// Additive: writes only to the top-level `rateLimits` collection, which the old
// live app (orimipuy.com) never touches — zero risk to it.

export interface RateLimitResult {
  allowed: boolean
  /** Approximate remaining allowance in the current window (>= 0). */
  remaining: number
}

const COLLECTION = 'rateLimits'

// Per-instance fallback bucket store (degraded mode only).
const memBuckets = new Map<string, { count: number; windowStart: number }>()

function checkInMemory(key: string, limit: number, windowMs: number): RateLimitResult {
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs
  const entry = memBuckets.get(key)
  if (!entry || entry.windowStart !== windowStart) {
    memBuckets.set(key, { count: 1, windowStart })
    return { allowed: true, remaining: Math.max(0, limit - 1) }
  }
  if (entry.count >= limit) return { allowed: false, remaining: 0 }
  entry.count++
  return { allowed: true, remaining: Math.max(0, limit - entry.count) }
}

/**
 * Atomically consumes one unit against `key` for the current time window.
 * Returns `{ allowed:false }` once `limit` is reached **without** further
 * incrementing (so a blocked caller doesn't keep bumping the doc). Never throws.
 */
export async function checkRateLimit(opts: {
  key: string
  limit: number
  windowMs: number
}): Promise<RateLimitResult> {
  const { key, limit, windowMs } = opts
  const db = getAdminDb()
  if (!db) return checkInMemory(key, limit, windowMs)

  const bucket = Math.floor(Date.now() / windowMs)
  const docId = `${key}_${bucket}`.replace(/\//g, '_')
  const ref = db.collection(COLLECTION).doc(docId)

  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      const count = snap.exists ? Number(snap.data()?.count ?? 0) : 0
      if (count >= limit) return { allowed: false, remaining: 0 }
      // Window end + 1m grace — the field a Firestore TTL policy on
      // `rateLimits.expireAt` reaps. Until that policy is enabled, stale docs are
      // harmless (a new bucket id is used each window).
      const expireAt = new Date((bucket + 1) * windowMs + 60_000)
      tx.set(ref, { count: FieldValue.increment(1), expireAt }, { merge: true })
      return { allowed: true, remaining: Math.max(0, limit - count - 1) }
    })
  } catch {
    // Firestore unavailable → fail-open via the in-memory fallback.
    return checkInMemory(key, limit, windowMs)
  }
}
