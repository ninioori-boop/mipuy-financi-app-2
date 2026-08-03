import { describe, it, expect } from 'vitest'
import { createHmac } from 'crypto'
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

  it('the version argument defaults to 0', () => {
    // NOTE: both sides are the current implementation, so this proves the default
    // only. The real back-compat guarantee is the independent test below.
    const uid = 'legacy_user'
    expect(signDeviceToken(uid, SECRET, 0)).toBe(signDeviceToken(uid, SECRET))
  })

  // A versioned token must not be re-interpretable as an unversioned one. v0 signs
  // `uid`; v>=1 signs `uid:version` — so without a guard, the signed message of a
  // v3 token can be re-encoded as the UID of a v0 token, reusing the same MAC with
  // no secret. The forged uid ("realuid:3") has no revocation doc, so a revoked
  // device would sail straight past isDeviceTokenRevoked.
  it('rejects a versioned token downgraded into a v0 token (message-ambiguity forgery)', () => {
    const uid = 'stolen_phone_user'
    const [, , mac] = signDeviceToken(uid, SECRET, 3).split('.')
    const forged = `${Buffer.from(`${uid}:3`).toString('base64url')}.${mac}`

    expect(verifyDeviceToken(forged, SECRET)).toBeNull()
  })

  it('rejects a non-canonical version spelling', () => {
    const uid = 'user'
    const mac = createHmac('sha256', SECRET).update(`${uid}:3`).digest('base64url')
    const uidB64 = Buffer.from(uid).toString('base64url')
    expect(verifyDeviceToken(`${uidB64}.03.${mac}`, SECRET)).toBeNull()
    expect(verifyDeviceToken(`${uidB64}.3e0.${mac}`, SECRET)).toBeNull()
    // ...while the canonical spelling of the same version still works.
    expect(verifyDeviceToken(`${uidB64}.3.${mac}`, SECRET)).toEqual({ uid, version: 3 })
  })

  // THE back-compat guarantee, and the one that decides whether shipping this
  // disconnects ~40 clients' phones. The token above is built by an INDEPENDENT
  // reimplementation of the pre-versioning algorithm — i.e. exactly the string
  // already pasted into users' iOS Shortcuts and Android automations. If this
  // ever fails, every client's expense capture is silently dead.
  it('accepts a token produced by the ORIGINAL pre-versioning algorithm', () => {
    const uid = 'phone_user_42'
    const legacy =
      Buffer.from(uid).toString('base64url') +
      '.' +
      createHmac('sha256', SECRET).update(uid).digest('base64url')

    expect(verifyDeviceToken(legacy, SECRET)).toEqual({ uid, version: 0 })
  })

  it('still tolerates the stray whitespace/bidi marks a hand-paste picks up', () => {
    const uid = 'pasted_user'
    const token = signDeviceToken(uid, SECRET)
    expect(verifyDeviceToken(`‎ ${token}\n`, SECRET)).toEqual({ uid, version: 0 })
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
