import { createVerify } from 'crypto'

const PROJECT_ID = 'finance-machine-a36e9'

let keysCache: Record<string, string> | null = null
let keysCacheAt = 0

export async function verifyFirebaseToken(idToken: string): Promise<{ uid: string; email?: string }> {
  const now = Date.now()

  if (!keysCache || now - keysCacheAt > 3_600_000) {
    // Build in a LOCAL first and only publish a result that actually looks like
    // a key set. Assigning the parsed body straight into the cache meant a
    // single 5xx from Google (whose error envelope is still valid JSON) was
    // stored as "the keys" and stamped fresh — every authenticated route then
    // returned 401 "פג תוקף הסשן" for a full hour, and signing in again did not
    // help. On failure we keep serving the previous keys, which stay valid for
    // days; only a cold instance with no cache at all is allowed to throw.
    try {
      // Bounded: without a timeout a hanging endpoint blocks the request until
      // the serverless function times out, which stalls the whole app — a worse
      // outage than the one this block exists to prevent.
      const r = await fetch(
        'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com',
        { signal: AbortSignal.timeout(5_000) },
      )
      if (!r.ok) throw new Error(`JWKS fetch failed: ${r.status}`)
      const next = (await r.json()) as Record<string, string>
      if (!next || typeof next !== 'object' || Object.keys(next).length === 0) {
        throw new Error('JWKS response empty or malformed')
      }
      keysCache = next
      keysCacheAt = now
    } catch (err) {
      if (!keysCache) throw err
      // Back off ~1 minute instead of retrying on EVERY request: leaving
      // keysCacheAt untouched would keep the refresh gate open and turn a Google
      // blip into an outbound request storm (and likely rate-limiting, which
      // prolongs the very outage we are riding out). Google's keys stay valid for
      // days, so serving the cached set meanwhile is safe.
      keysCacheAt = now - 3_600_000 + 60_000
      console.warn('[verifyFirebaseToken] JWKS refresh failed, serving cached keys:', err)
    }
  }

  const parts = idToken.split('.')
  if (parts.length !== 3) throw new Error('Invalid token format')

  const [h64, p64, s64] = parts
  const header  = JSON.parse(Buffer.from(h64, 'base64url').toString()) as { kid: string }
  const payload = JSON.parse(Buffer.from(p64, 'base64url').toString()) as {
    uid?: string; sub?: string; exp: number; aud: string; iss: string; email?: string
  }

  const pubKey = keysCache[header.kid]
  if (!pubKey) throw new Error('Unknown key id')

  const verifier = createVerify('RSA-SHA256')
  verifier.update(`${h64}.${p64}`)
  if (!verifier.verify(pubKey, Buffer.from(s64, 'base64url'))) throw new Error('Bad signature')

  const t = Math.floor(now / 1000)
  if (payload.exp < t) throw new Error('Token expired')
  if (payload.aud !== PROJECT_ID) throw new Error('Wrong audience')
  if (payload.iss !== `https://securetoken.google.com/${PROJECT_ID}`) throw new Error('Wrong issuer')

  return { uid: (payload.uid ?? payload.sub)!, email: payload.email }
}
