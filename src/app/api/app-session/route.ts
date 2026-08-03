import { isAccountDeleted } from '@/lib/deletionTombstone'
import { NextRequest, NextResponse } from 'next/server'
import { verifyDeviceToken } from '@/lib/deviceToken'
import { isDeviceTokenRevoked } from '@/lib/deviceTokenRevocation'
import { getAdminAuth } from '@/lib/firebaseAdmin'

// Exchanges a device token (the same HMAC token the Android app already holds
// for POSTing expenses) for a short-lived Firebase **custom token**. The app's
// in-app WebView signs in with it (signInWithCustomToken) so it can show the
// user's real "תיעוד הוצאות" tab 1:1 — no in-WebView login (Google blocks OAuth
// in embedded WebViews), no password.
//
// Security: the device token is a per-user bearer credential stored only on the
// user's own phone; this widens its scope from "post expenses" to "full session"
// for that same uid. 503 until the backend (TRANSACTION_SECRET + service account)
// is configured, so it's safe to ship dark.
export async function POST(req: NextRequest) {
  let body: { token?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'בקשה לא תקינה' }, { status: 400 })
  }

  const token = body.token?.trim()
  if (!token) {
    return NextResponse.json({ error: 'חסר טוקן' }, { status: 400 })
  }

  const secret = process.env.TRANSACTION_SECRET
  const adminAuth = getAdminAuth()
  if (!secret || !adminAuth) {
    return NextResponse.json(
      { error: 'השירות עוד לא הופעל (חסר TRANSACTION_SECRET / service account)' },
      { status: 503 },
    )
  }

  const verified = verifyDeviceToken(token, secret)
  if (!verified) {
    return NextResponse.json({ error: 'טוקן לא תקין' }, { status: 401 })
  }
  const { uid, version } = verified

  // Per-user revocation: a stolen/lost phone is cut off by bumping this user's
  // minVersion, instead of rotating TRANSACTION_SECRET (which kills EVERY
  // client's token at once). This route is the most sensitive of the five — it
  // exchanges the device token for a full Firebase session.
  if (await isDeviceTokenRevoked(uid, version)) {
    return NextResponse.json({ error: 'הטוקן בוטל — צור חיבור חדש מהאפליקציה' }, { status: 401 })
  }

  // Signing in with a custom token RE-CREATES the Auth user when none exists,
  // and the signup gate (a beforeUserCreated blocking function) does not run on
  // that path. So a deleted account could resurrect itself from the phone app.
  // Both guards are needed: the tombstone, and proof the user still exists.
  if (await isAccountDeleted(uid)) {
    return NextResponse.json({ error: 'החשבון נמחק' }, { status: 410 })
  }
  try {
    await adminAuth.getUser(uid)
  } catch {
    return NextResponse.json({ error: 'החשבון לא קיים' }, { status: 401 })
  }

  try {
    const customToken = await adminAuth.createCustomToken(uid)
    return NextResponse.json({ customToken })
  } catch {
    return NextResponse.json({ error: 'יצירת הסשן נכשלה' }, { status: 500 })
  }
}
