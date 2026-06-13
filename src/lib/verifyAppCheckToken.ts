import { createPublicKey, createVerify } from 'crypto'

// The Firebase messagingSenderId IS the GCP project number that App Check tokens
// are issued for (used in their iss/aud claims). It's a NEXT_PUBLIC_ var, so it's
// available here on the server too — no extra config needed.
const PROJECT_NUMBER = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?.trim()
const JWKS_URL = 'https://firebaseappcheck.googleapis.com/v1/jwks'

let keysCache: Record<string, string> | null = null // kid -> PEM
let keysCacheAt = 0

/**
 * Verifies a Firebase App Check token (an RS256 JWT signed by Firebase App Check).
 * Mirrors verifyFirebaseToken.ts, but against the App Check JWKS and claims.
 * Resolves on success; throws on any failure (fail-closed).
 */
export async function verifyAppCheckToken(appCheckToken: string): Promise<void> {
  if (!appCheckToken) throw new Error('Missing App Check token')
  if (!PROJECT_NUMBER) throw new Error('Project number not configured')

  const now = Date.now()
  if (!keysCache || now - keysCacheAt > 3_600_000) {
    const r = await fetch(JWKS_URL)
    const { keys } = (await r.json()) as { keys: Array<Record<string, string>> }
    const next: Record<string, string> = {}
    for (const jwk of keys) {
      next[jwk.kid] = createPublicKey({ key: jwk, format: 'jwk' } as Parameters<typeof createPublicKey>[0])
        .export({ type: 'spki', format: 'pem' })
        .toString()
    }
    keysCache = next
    keysCacheAt = now
  }

  const parts = appCheckToken.split('.')
  if (parts.length !== 3) throw new Error('Invalid App Check token format')
  const [h64, p64, s64] = parts
  const header = JSON.parse(Buffer.from(h64, 'base64url').toString()) as { kid: string; alg: string }
  const payload = JSON.parse(Buffer.from(p64, 'base64url').toString()) as {
    exp: number
    aud: string | string[]
    iss: string
  }

  if (header.alg !== 'RS256') throw new Error('Bad App Check alg')

  const pubKey = keysCache[header.kid]
  if (!pubKey) throw new Error('Unknown App Check key id')

  const verifier = createVerify('RSA-SHA256')
  verifier.update(`${h64}.${p64}`)
  if (!verifier.verify(pubKey, Buffer.from(s64, 'base64url'))) {
    throw new Error('Bad App Check signature')
  }

  const t = Math.floor(now / 1000)
  if (payload.exp < t) throw new Error('App Check token expired')

  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
  if (!aud.includes(`projects/${PROJECT_NUMBER}`)) throw new Error('Wrong App Check audience')

  if (payload.iss !== `https://firebaseappcheck.googleapis.com/${PROJECT_NUMBER}`) {
    throw new Error('Wrong App Check issuer')
  }
}
