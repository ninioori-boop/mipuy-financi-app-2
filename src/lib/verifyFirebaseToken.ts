import { createVerify } from 'crypto'

const PROJECT_ID = 'finance-machine-a36e9'

let keysCache: Record<string, string> | null = null
let keysCacheAt = 0

export async function verifyFirebaseToken(idToken: string): Promise<{ uid: string; email?: string }> {
  const now = Date.now()

  if (!keysCache || now - keysCacheAt > 3_600_000) {
    const r = await fetch(
      'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com',
    )
    keysCache = (await r.json()) as Record<string, string>
    keysCacheAt = now
  }

  const parts = idToken.split('.')
  if (parts.length !== 3) throw new Error('Invalid token format')

  const [h64, p64, s64] = parts
  const header  = JSON.parse(Buffer.from(h64, 'base64url').toString()) as { kid: string }
  const payload = JSON.parse(Buffer.from(p64, 'base64url').toString()) as {
    uid?: string; sub?: string; email?: string; email_verified?: boolean; exp: number; aud: string; iss: string
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

  // Only expose the email when it's verified — callers use it for authorization
  // (advisor exemption). An unverified email/password account could otherwise claim
  // someone else's address and inherit their privileges. Google sign-in is always
  // verified, so this is transparent for the real advisor accounts.
  return {
    uid: (payload.uid ?? payload.sub)!,
    email: payload.email_verified ? payload.email : undefined,
  }
}
