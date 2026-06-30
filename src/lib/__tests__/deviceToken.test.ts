import { describe, it, expect } from 'vitest'
import { signDeviceToken, verifyDeviceToken } from '@/lib/deviceToken'

// Guards the device-token HMAC + the versioning back-compat. The critical
// invariant: tokens already pasted into users' phones (legacy 2-part, v0) must
// keep verifying after the versioning change, while new per-user revocation
// (v >= 1, 3-part) works too.

const SECRET = 'test-secret-value'

describe('deviceToken — sign/verify', () => {
  it('round-trips a v0 token (legacy 2-part) and returns version 0', () => {
    const uid = 'user_abc123'
    const token = signDeviceToken(uid, SECRET)
    expect(token.split('.')).toHaveLength(2)
    expect(verifyDeviceToken(token, SECRET)).toEqual({ uid, version: 0 })
  })

  it('round-trips a versioned (v>=1) token as 3 parts', () => {
    const uid = 'user_xyz'
    const token = signDeviceToken(uid, SECRET, 2)
    expect(token.split('.')).toHaveLength(3)
    expect(verifyDeviceToken(token, SECRET)).toEqual({ uid, version: 2 })
  })

  it('v0 output is byte-identical to a legacy token (no forced reissue)', () => {
    const uid = 'legacy_user'
    expect(signDeviceToken(uid, SECRET, 0)).toBe(signDeviceToken(uid, SECRET))
  })

  it('rejects a forged/tampered HMAC', () => {
    const token = signDeviceToken('victim', SECRET)
    const [u] = token.split('.')
    expect(verifyDeviceToken(`${u}.deadbeef`, SECRET)).toBeNull()
  })

  it('rejects a token signed with a different secret', () => {
    const token = signDeviceToken('user', SECRET)
    expect(verifyDeviceToken(token, 'other-secret')).toBeNull()
  })

  it('rejects malformed tokens', () => {
    expect(verifyDeviceToken('', SECRET)).toBeNull()
    expect(verifyDeviceToken('onlyonepart', SECRET)).toBeNull()
    expect(verifyDeviceToken('a.b.c.d', SECRET)).toBeNull()
  })

  it('rejects a 3-part token with a non-positive/non-integer version', () => {
    const uidB64 = Buffer.from('user').toString('base64url')
    expect(verifyDeviceToken(`${uidB64}.0.whatever`, SECRET)).toBeNull()
    expect(verifyDeviceToken(`${uidB64}.x.whatever`, SECRET)).toBeNull()
  })

  it('different versions produce different tokens (revocation actually changes the credential)', () => {
    const uid = 'rotating'
    expect(signDeviceToken(uid, SECRET, 1)).not.toBe(signDeviceToken(uid, SECRET, 2))
    expect(verifyDeviceToken(signDeviceToken(uid, SECRET, 1), SECRET)?.version).toBe(1)
  })
})
