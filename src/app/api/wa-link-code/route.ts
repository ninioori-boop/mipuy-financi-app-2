import { NextRequest, NextResponse } from 'next/server'
import { randomInt } from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { getAdminAuth, getAdminDb } from '@/lib/firebaseAdmin'
import { checkRateLimit } from '@/lib/rateLimit'
import { signDeviceToken } from '@/lib/deviceToken'
import { getCurrentTokenVersion } from '@/lib/deviceTokenRevocation'

// firebase-admin needs the Node runtime (not Edge).
export const runtime = 'nodejs'

// Mints a one-time code that links a client's WhatsApp phone to their account.
// The client (logged into the app) requests a code, then sends it once to the
// product bot; the bot (clientBot.js) consumes it and writes whatsappLinks/{phone}.
//
// We ALSO mint the client's device token here and stash it on the code doc — this
// route (Vercel) already has TRANSACTION_SECRET, whereas the Cloud Function does
// not, so minting here and letting the bot reuse the stored token keeps the secret
// in one place. The bot then POSTs expenses to /api/transaction with it.
// 503 until the backend (TRANSACTION_SECRET + service account) is configured.

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no I, O, 0, 1 (unambiguous)
const CODE_LEN = 6
const CODE_TTL_MS = 15 * 60 * 1000 // 15 minutes
const LIMIT = 20
const WINDOW_MS = 3_600_000 // 1 hour

function makeCode(): string {
  let s = ''
  for (let i = 0; i < CODE_LEN; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return s
}

export async function POST(req: NextRequest) {
  const db = getAdminDb()
  const auth = getAdminAuth()
  const secret = process.env.TRANSACTION_SECRET
  if (!db || !auth || !secret) {
    return NextResponse.json({ error: 'השירות עוד לא הופעל' }, { status: 503 })
  }

  const header = req.headers.get('authorization') || ''
  const idToken = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!idToken) return NextResponse.json({ error: 'חסר אימות' }, { status: 401 })

  let uid: string
  try {
    uid = (await auth.verifyIdToken(idToken)).uid
  } catch {
    return NextResponse.json({ error: 'אימות נכשל' }, { status: 401 })
  }

  const rl = await checkRateLimit({ key: `wa-link:${uid}`, limit: LIMIT, windowMs: WINDOW_MS })
  if (!rl.allowed) {
    return NextResponse.json({ error: 'יותר מדי בקשות — נסה שוב מאוחר יותר' }, { status: 429 })
  }

  // Capture the client's advisor + firm (tenancy) if a link exists — optional
  // metadata for the later advisor cockpit / per-firm (white-label) routing.
  let practiceId: string | null = null
  let invitedByUid: string | null = null
  try {
    const link = await db.collection('clientLinks').doc(uid).get()
    if (link.exists) {
      const d = link.data() || {}
      practiceId = d.practiceId || null
      invitedByUid = d.invitedByUid || null
    }
  } catch {
    /* tenancy is optional metadata; never block linking on it */
  }

  // Mint the client's device token (reused by the bot to POST /api/transaction).
  const deviceToken = signDeviceToken(uid, secret, await getCurrentTokenVersion(uid))

  // Mint a unique short code (retry on the rare collision).
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = makeCode()
    const ref = db.collection('whatsappLinkCodes').doc(candidate)
    if ((await ref.get()).exists) continue
    await ref.set({
      uid,
      practiceId,
      invitedByUid,
      deviceToken,
      consumed: false,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    })
    return NextResponse.json({ code: candidate, expiresInMinutes: 15 })
  }
  return NextResponse.json({ error: 'נסה שוב' }, { status: 500 })
}
