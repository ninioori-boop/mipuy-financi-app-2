import { describe, it, expect } from 'vitest'
import { checkRateLimit } from '@/lib/rateLimit'

// In the test env FIREBASE_SERVICE_ACCOUNT is unset, so getAdminDb() returns null
// and checkRateLimit uses its in-memory fallback — the exact path production runs
// before the service account is configured (deploy-dark). This verifies that
// degraded path still enforces the limit and isolates keys.

const WINDOW = 1_000_000 // large window so every call in a test lands in one bucket

describe('rateLimit — in-memory fallback', () => {
  it('allows up to `limit`, then blocks further calls in the same window', async () => {
    const key = 'unit:block'
    const limit = 3
    const allowed: boolean[] = []
    for (let i = 0; i < 4; i++) {
      allowed.push((await checkRateLimit({ key, limit, windowMs: WINDOW })).allowed)
    }
    expect(allowed).toEqual([true, true, true, false])
  })

  it('tracks independent counters per key', async () => {
    const a1 = await checkRateLimit({ key: 'unit:a', limit: 1, windowMs: WINDOW })
    const a2 = await checkRateLimit({ key: 'unit:a', limit: 1, windowMs: WINDOW })
    const b1 = await checkRateLimit({ key: 'unit:b', limit: 1, windowMs: WINDOW })
    expect(a1.allowed).toBe(true)
    expect(a2.allowed).toBe(false) // same key exhausted
    expect(b1.allowed).toBe(true)  // different key unaffected
  })

  it('reports remaining allowance', async () => {
    const r = await checkRateLimit({ key: 'unit:remain', limit: 5, windowMs: WINDOW })
    expect(r.allowed).toBe(true)
    expect(r.remaining).toBe(4)
  })
})
