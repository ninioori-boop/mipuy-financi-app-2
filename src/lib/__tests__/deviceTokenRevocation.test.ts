import { describe, it, expect, vi, beforeEach } from 'vitest'

const docGet = vi.fn()
// The mock RECORDS its arguments on purpose. The collection name is the only
// coupling between this module and scripts/revoke-device.ts — two files with no
// shared constant. If either drifts, revocation becomes a permanent no-op that
// still prints success, and a mock that ignored its arguments would stay green.
const docFn = vi.fn(() => ({ get: docGet }))
const collectionFn = vi.fn(() => ({ doc: docFn }))
let adminDb: unknown = { collection: collectionFn }
vi.mock('../firebaseAdmin', () => ({ getAdminDb: () => adminDb }))

import { isDeviceTokenRevoked, getCurrentTokenVersion } from '../deviceTokenRevocation'

/**
 * Per-user device-token revocation. Two properties matter and they pull in
 * opposite directions: a revoked token must really stop working, and a healthy
 * token must NEVER be refused because a lookup broke — a false lockout means a
 * client's expense capture dies silently with no way for them to tell.
 */
describe('isDeviceTokenRevoked', () => {
  beforeEach(() => {
    docGet.mockReset(); docFn.mockClear(); collectionFn.mockClear()
    adminDb = { collection: collectionFn }
  })

  it('reads deviceTokens/{uid} — the exact path revoke-device.ts writes', async () => {
    docGet.mockResolvedValue({ exists: false })
    await isDeviceTokenRevoked('u1', 0)
    expect(collectionFn).toHaveBeenCalledWith('deviceTokens')
    expect(docFn).toHaveBeenCalledWith('u1')
  })

  it('accepts every token when the user has never been revoked (no doc)', async () => {
    docGet.mockResolvedValue({ exists: false })
    expect(await isDeviceTokenRevoked('u1', 0)).toBe(false)
    expect(await isDeviceTokenRevoked('u1', 5)).toBe(false)
  })

  it('revokes tokens below minVersion and keeps the reissued one working', async () => {
    docGet.mockResolvedValue({ exists: true, data: () => ({ minVersion: 2 }) })
    expect(await isDeviceTokenRevoked('u1', 0)).toBe(true)   // the stolen phone's legacy token
    expect(await isDeviceTokenRevoked('u1', 1)).toBe(true)
    expect(await isDeviceTokenRevoked('u1', 2)).toBe(false)  // freshly minted
    expect(await isDeviceTokenRevoked('u1', 3)).toBe(false)
  })

  it('fails OPEN when Firestore throws — never locks a client out on infra trouble', async () => {
    docGet.mockRejectedValue(new Error('firestore unavailable'))
    expect(await isDeviceTokenRevoked('u1', 0)).toBe(false)
  })

  it('fails OPEN when the admin SDK is not configured', async () => {
    adminDb = null
    expect(await isDeviceTokenRevoked('u1', 0)).toBe(false)
  })
})

describe('getCurrentTokenVersion', () => {
  beforeEach(() => {
    docGet.mockReset(); docFn.mockClear(); collectionFn.mockClear()
    adminDb = { collection: collectionFn }
  })

  it('reads deviceTokens/{uid} — the exact path revoke-device.ts writes', async () => {
    docGet.mockResolvedValue({ exists: false })
    await isDeviceTokenRevoked('u1', 0)
    expect(collectionFn).toHaveBeenCalledWith('deviceTokens')
    expect(docFn).toHaveBeenCalledWith('u1')
  })

  it('mints at 0 for a user who was never revoked — the legacy token format', async () => {
    docGet.mockResolvedValue({ exists: false })
    expect(await getCurrentTokenVersion('u1')).toBe(0)
  })

  it('mints at the current minVersion after a revocation', async () => {
    docGet.mockResolvedValue({ exists: true, data: () => ({ minVersion: 3 }) })
    expect(await getCurrentTokenVersion('u1')).toBe(3)
  })

  // Opposite direction from the verify path, deliberately. Guessing 0 here would
  // mint a token that isDeviceTokenRevoked rejects on its next call — a dead
  // credential handed over with HTTP 200 and no error anywhere.
  it('returns null (fail CLOSED) on error, so callers can 503 instead of minting a dead token', async () => {
    docGet.mockRejectedValue(new Error('boom'))
    expect(await getCurrentTokenVersion('u1')).toBeNull()
    adminDb = null
    expect(await getCurrentTokenVersion('u1')).toBeNull()
  })
})
