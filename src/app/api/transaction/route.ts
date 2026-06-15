import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { getAdminDb } from '@/lib/firebaseAdmin'
import { verifyDeviceToken } from '@/lib/deviceToken'
import { categorize } from '@/lib/categorize'

// firebase-admin needs the Node runtime (not Edge).
export const runtime = 'nodejs'

const MAX_MERCHANT = 200
const MAX_AMOUNT   = 1_000_000

// Receives a single externally-pushed transaction (from an iOS Shortcut / Android
// automation), auto-categorizes it, and drops it into the user's private inbox
// (transactionInbox/{uid}/items) via the admin SDK. The client drains the inbox
// into the expense log. Auth is the per-user HMAC device token — NOT a browser
// session — so a phone automation can call it without a logged-in webview.
//
// 503 until both TRANSACTION_SECRET and FIREBASE_SERVICE_ACCOUNT are set, so this
// route is inert (and harmless) until the backend is explicitly enabled.
export async function POST(req: NextRequest) {
  const secret = process.env.TRANSACTION_SECRET
  const db = getAdminDb()
  if (!secret || !db) {
    return NextResponse.json({ error: 'service not configured' }, { status: 503 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'bad request body' }, { status: 400 })
  }
  const { token, merchant, amount, date, ref } = body as Record<string, unknown>

  const uid = typeof token === 'string' ? verifyDeviceToken(token, secret) : null
  if (!uid) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  if (typeof merchant !== 'string' || !merchant.trim() || merchant.length > MAX_MERCHANT) {
    return NextResponse.json({ error: 'bad merchant' }, { status: 400 })
  }
  const amt = typeof amount === 'number' ? amount : parseFloat(String(amount))
  if (!Number.isFinite(amt) || amt <= 0 || amt > MAX_AMOUNT) {
    return NextResponse.json({ error: 'bad amount' }, { status: 400 })
  }
  const dateStr = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date
    : new Date().toISOString().slice(0, 10)
  const refStr = typeof ref === 'string' ? ref.slice(0, 64) : null

  const cleanMerchant = merchant.trim()
  const category = categorize(cleanMerchant)

  await db
    .collection('transactionInbox').doc(uid)
    .collection('items').add({
      merchant:  cleanMerchant,
      amount:    Math.round(amt * 100) / 100,
      date:      dateStr,
      category,
      ref:       refStr,
      createdAt: FieldValue.serverTimestamp(),
    })

  // uid + bucket only — no merchant/amount detail logged.
  console.log(`[transaction] uid=${uid} cat=${category}`)

  return NextResponse.json({ ok: true, category })
}
