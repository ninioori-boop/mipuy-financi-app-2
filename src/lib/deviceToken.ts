import { createHmac, timingSafeEqual } from 'crypto'

// A long-lived, per-user token the user pastes once into their iOS Shortcut /
// Android automation. Stateless — no DB storage; the server re-derives the HMAC
// and compares it in constant time. Rotating TRANSACTION_SECRET invalidates ALL
// device tokens at once.
//
// Two formats, both supported by verifyDeviceToken:
//   • Legacy (v0): <base64url(uid)>.<hmac(uid, SECRET)>            — 2 parts
//   • Versioned : <base64url(uid)>.<version>.<hmac("uid:version")> — 3 parts
//
// The version lets the advisor revoke a SINGLE user's token (e.g. a stolen phone)
// by bumping that user's minVersion in Firestore (see deviceTokenRevocation.ts) —
// without rotating the global secret and killing everyone. v0 is emitted for
// version 0 so already-distributed tokens stay byte-identical; a 3-part token is
// only issued after a user has been bumped to version >= 1.

export function signDeviceToken(uid: string, secret: string, version = 0): string {
  const uidB64 = Buffer.from(uid).toString('base64url')
  if (version <= 0) {
    const mac = createHmac('sha256', secret).update(uid).digest('base64url')
    return `${uidB64}.${mac}`
  }
  const mac = createHmac('sha256', secret).update(`${uid}:${version}`).digest('base64url')
  return `${uidB64}.${version}.${mac}`
}

/**
 * Verifies a device token's HMAC in constant time and returns its uid + version,
 * or null if malformed/forged. Pure (no I/O) — revocation is checked separately
 * by isDeviceTokenRevoked() so this stays synchronous and easy to test.
 */
export function verifyDeviceToken(token: string, secret: string): { uid: string; version: number } | null {
  // Tokens pasted by hand (iOS Shortcut text box) often pick up stray
  // whitespace/newlines or invisible bidi/zero-width marks along the way —
  // strip them all before verifying, so a visually-correct paste never fails
  // the HMAC. (Escapes: zero-width+LRM/RLM, bidi embeds, bidi isolates, BOM.)
  const parts = token.replace(/[\s\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '').split('.')
  if (parts.length !== 2 && parts.length !== 3) return null

  let uid: string
  try {
    uid = Buffer.from(parts[0], 'base64url').toString()
  } catch {
    return null
  }
  if (!uid) return null

  let version = 0
  let message = uid
  let mac = parts[1]

  if (parts.length === 3) {
    version = Number(parts[1])
    if (!Number.isInteger(version) || version < 1) return null
    message = `${uid}:${version}`
    mac = parts[2]
  }

  const expected = createHmac('sha256', secret).update(message).digest('base64url')
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return null
  if (!timingSafeEqual(a, b)) return null
  return { uid, version }
}
