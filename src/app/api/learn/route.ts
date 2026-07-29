import { NextRequest, NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/firebaseAdmin'
import { verifyDeviceToken } from '@/lib/deviceToken'
import { normalizeForLookup } from '@/lib/normalizeForLookup'
import { shareableLearnedEntry } from '@/lib/learnedSharing'
import { ALL_CATEGORIES } from '@/lib/constants'

// firebase-admin needs the Node runtime (not Edge).
export const runtime = 'nodejs'

const MAX_MERCHANT = 200

// Teaches the shared learnedDB from a correction made in the Android tracker app.
// Authed with the per-user HMAC device token (same as /api/transaction) — NOT a
// browser session. Writes merchant→category to shared/learnedDB so future
// ingested charges from that merchant categorize correctly. Additive + isolated:
// 503 until the backend is configured; never touches existing data/routes.
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
  const { token, merchant, category } = body as Record<string, unknown>

  const uid = typeof token === 'string' ? verifyDeviceToken(token, secret) : null
  if (!uid) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  if (typeof merchant !== 'string' || !merchant.trim() || merchant.length > MAX_MERCHANT) {
    return NextResponse.json({ error: 'bad merchant' }, { status: 400 })
  }
  if (typeof category !== 'string' || !ALL_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: 'bad category' }, { status: 400 })
  }

  const key = normalizeForLookup(merchant.trim())
  if (!key) {
    return NextResponse.json({ error: 'bad merchant' }, { status: 400 })
  }

  // Payment rails / personal "untracked" targets / short wildcard keys never
  // enter the shared pool — one person's Bit is another person's rent, and this
  // pool applies to EVERY account. Answer ok (the tracker app fires-and-forgets;
  // the correction still applied to that user's own transaction), just don't
  // let it redefine the merchant for everyone else.
  if (!shareableLearnedEntry(key, category)) {
    console.log(`[learn] uid=${uid} cat=${category} — not shareable, skipped`)
    return NextResponse.json({ ok: true, shared: false })
  }

  // Single-field merge — only adds/updates this one key, never replaces the doc.
  await db.collection('shared').doc('learnedDB').set({ db: { [key]: category } }, { merge: true })

  console.log(`[learn] uid=${uid} cat=${category}`)
  return NextResponse.json({ ok: true })
}
