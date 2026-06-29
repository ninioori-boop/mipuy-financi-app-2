import { NextRequest, NextResponse } from 'next/server'
import { verifyDeviceToken } from '@/lib/deviceToken'
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

  const uid = verifyDeviceToken(token, secret)
  if (!uid) {
    return NextResponse.json({ error: 'טוקן לא תקין' }, { status: 401 })
  }

  try {
    const customToken = await adminAuth.createCustomToken(uid)
    return NextResponse.json({ customToken })
  } catch {
    return NextResponse.json({ error: 'יצירת הסשן נכשלה' }, { status: 500 })
  }
}
