import { createHmac, timingSafeEqual } from 'crypto'

// A long-lived, per-user token the user pastes once into their iOS Shortcut /
// Android automation. Format: <base64url(uid)>.<base64url(hmac-sha256(uid, SECRET))>.
// Stateless — no DB storage; the server re-derives the HMAC and compares it in
// constant time. Rotating TRANSACTION_SECRET invalidates all device tokens.

export function signDeviceToken(uid: string, secret: string): string {
  const mac = createHmac('sha256', secret).update(uid).digest('base64url')
  return `${Buffer.from(uid).toString('base64url')}.${mac}`
}

export function verifyDeviceToken(token: string, secret: string): string | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [uidB64, mac] = parts

  let uid: string
  try {
    uid = Buffer.from(uidB64, 'base64url').toString()
  } catch {
    return null
  }
  if (!uid) return null

  const expected = createHmac('sha256', secret).update(uid).digest('base64url')
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return null
  if (!timingSafeEqual(a, b)) return null
  return uid
}
