import { describe, it, expect, vi, beforeEach } from 'vitest'

const rateLimitMock = vi.fn()
const docGet = vi.fn()
const docSet = vi.fn()
let adminDb: unknown = {
  collection: () => ({ doc: () => ({ get: docGet, set: docSet }) }),
}
vi.mock('../rateLimit', () => ({ checkRateLimit: (o: unknown) => rateLimitMock(o) }))
vi.mock('../firebaseAdmin', () => ({ getAdminDb: () => adminDb }))
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { increment: (n: number) => ({ inc: n }), serverTimestamp: () => 'TS' },
}))

import { checkAiQuota, resolvePracticeId } from '../aiQuota'

/**
 * The quota is a runaway guard for a white-label tenant, not conversational
 * rationing — so the tests that matter are: it counts, it blocks a firm that is
 * switched off or over its ceiling, and it NEVER blocks because a lookup broke.
 */
describe('checkAiQuota', () => {
  beforeEach(() => {
    rateLimitMock.mockReset(); docGet.mockReset(); docSet.mockReset()
    rateLimitMock.mockResolvedValue({ allowed: true, remaining: 1 })
    adminDb = { collection: () => ({ doc: () => ({ get: docGet, set: docSet }) }) }
  })

  it('allows and records usage for a practice under its ceiling', async () => {
    docGet.mockResolvedValue({ exists: true, data: () => ({ aiQuota: { dailyLimit: 100 } }) })
    const r = await checkAiQuota({ uid: 'u1', route: 'analyze', practiceId: 'p_1' })
    expect(r.allowed).toBe(true)
    expect(rateLimitMock).toHaveBeenCalledWith(expect.objectContaining({ key: 'ai:practice:p_1', limit: 100 }))
    expect(docSet).toHaveBeenCalled()          // usage rollup written
  })

  it('blocks a practice switched off from Firestore, with no deploy', async () => {
    docGet.mockResolvedValue({ exists: true, data: () => ({ aiQuota: { disabled: true } }) })
    const r = await checkAiQuota({ uid: 'u1', route: 'analyze', practiceId: 'p_1' })
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe('practice-disabled')
    expect(rateLimitMock).not.toHaveBeenCalled()   // no need to count a blocked call
  })

  it('blocks when the daily ceiling is reached', async () => {
    docGet.mockResolvedValue({ exists: true, data: () => ({}) })
    rateLimitMock.mockResolvedValue({ allowed: false, remaining: 0 })
    const r = await checkAiQuota({ uid: 'u1', route: 'automap', practiceId: 'p_1' })
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe('practice-limit')
    expect(docSet).not.toHaveBeenCalled()
  })

  it('still guards a user who belongs to no practice', async () => {
    const r = await checkAiQuota({ uid: 'u1', route: 'analyze', practiceId: null })
    expect(r.allowed).toBe(true)
    // PER-USER, never a shared pool: one heavy self-serve user must not be able
    // to lock out every other practice-less user.
    expect(rateLimitMock).toHaveBeenCalledWith(expect.objectContaining({ key: 'ai:user-day:u1' }))
  })

  it('is a complete no-op when the admin SDK is unavailable (never blocks on infra)', async () => {
    adminDb = null
    const r = await checkAiQuota({ uid: 'u1', route: 'analyze' })
    expect(r.allowed).toBe(true)
  })
})

describe('resolvePracticeId', () => {
  beforeEach(() => { docGet.mockReset() })

  it('returns null (never throws) when a lookup fails', async () => {
    adminDb = { collection: () => ({ doc: () => ({ get: () => Promise.reject(new Error('boom')) }) }) }
    expect(await resolvePracticeId('u1')).toBeNull()
  })
})
