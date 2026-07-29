import { describe, it, expect, vi, beforeEach } from 'vitest'

const getMock = vi.fn()
const dbMock = { collection: () => ({ doc: () => ({ get: getMock }) }) }
let adminDb: unknown = dbMock
vi.mock('../firebaseAdmin', () => ({ getAdminDb: () => adminDb }))

import { isAccountDeleted } from '../deletionTombstone'

/**
 * The tombstone is what makes deletion stick: three server routes authenticate
 * with credentials that outlive the account (a never-expiring device HMAC, an
 * ID token good for an hour, a custom token that can re-create the Auth user),
 * and they all write with the admin SDK, which ignores Firestore rules.
 */
describe('isAccountDeleted', () => {
  beforeEach(() => { getMock.mockReset(); adminDb = dbMock })

  it('is true once a tombstone exists', async () => {
    getMock.mockResolvedValue({ exists: true })
    expect(await isAccountDeleted('u1')).toBe(true)
  })

  it('is false for a live account', async () => {
    getMock.mockResolvedValue({ exists: false })
    expect(await isAccountDeleted('u1')).toBe(false)
  })

  it('fails OPEN on a read error — a transient failure must not block live saves', async () => {
    getMock.mockRejectedValue(new Error('network'))
    expect(await isAccountDeleted('u1')).toBe(false)
  })

  it('fails open when the admin SDK is unavailable', async () => {
    adminDb = null
    expect(await isAccountDeleted('u1')).toBe(false)
  })

  it('never queries for an empty uid', async () => {
    expect(await isAccountDeleted('')).toBe(false)
    expect(getMock).not.toHaveBeenCalled()
  })
})
