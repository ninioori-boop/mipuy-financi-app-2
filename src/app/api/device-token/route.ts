import { NextRequest, NextResponse } from 'next/server'
import { verifyFirebaseToken } from '@/lib/verifyFirebaseToken'
import { signDeviceToken } from '@/lib/deviceToken'
import { getCurrentTokenVersion } from '@/lib/deviceTokenRevocation'

// firebase-admin (via the version lookup) needs the Node runtime, not Edge.
export const runtime = 'nodejs'

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

  const version = await getCurrentTokenVersion(uid)
  return NextResponse.json({ token: signDeviceToken(uid, secret, version) })
}
