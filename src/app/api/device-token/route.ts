import { NextRequest, NextResponse } from 'next/server'
import { verifyFirebaseToken } from '@/lib/verifyFirebaseToken'
import { signDeviceToken } from '@/lib/deviceToken'
import { getCurrentTokenVersion } from '@/lib/deviceTokenRevocation'

// Returns the caller's personal device token (for pasting into an iOS Shortcut /
// Android automation). Authenticated with the normal Firebase ID token, exactly
// like the AI routes. 503 until TRANSACTION_SECRET is configured, so it's safe
// to ship before the backend is enabled.
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'נדרשת התחברות' }, { status: 401 })
  }

  let uid: string
  try {
    uid = (await verifyFirebaseToken(auth.slice(7))).uid
  } catch {
    return NextResponse.json({ error: 'פג תוקף הסשן — התחבר מחדש' }, { status: 401 })
  }

  const secret = process.env.TRANSACTION_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: 'קליטת העסקאות האוטומטית עוד לא הופעלה (חסר TRANSACTION_SECRET)' },
      { status: 503 },
    )
  }

  // Mint at the user's CURRENT version, so a token issued after a revocation is
  // immediately valid while the revoked one stays dead. Version 0 (nobody has
  // been revoked) produces the legacy 2-part token, byte-identical to what this
  // route returned before — already-distributed tokens keep working untouched.
  const version = await getCurrentTokenVersion(uid)
  if (version === null) {
    // Fail closed: minting at a guessed version could hand back a token that is
    // already revoked, which fails silently on every later use.
    return NextResponse.json({ error: 'שגיאה זמנית — נסה שוב בעוד רגע' }, { status: 503 })
  }
  return NextResponse.json({ token: signDeviceToken(uid, secret, version) })
}
