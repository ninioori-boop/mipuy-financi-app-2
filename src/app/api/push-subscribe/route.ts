import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { getAdminDb } from '@/lib/firebaseAdmin'
import { verifyFirebaseToken } from '@/lib/verifyFirebaseToken'
import { isPushConfigured } from '@/lib/webPush'

// firebase-admin needs the Node runtime (not Edge).
export const runtime = 'nodejs'

// Registers (POST) / removes (DELETE) a Web-Push subscription for the signed-in
// user. Called by the "הפעל התראות" card after the browser grants notification
// permission. Subscriptions are stored under pushSubscriptions/{uid}.subs.{id}
// via the admin SDK — browser clients can't touch the collection directly.
//
// 503 until the VAPID keys + service account are configured, so the route is
// inert (and harmless) until push is explicitly enabled.

const MAX_ENDPOINT = 1024
const MAX_KEY = 256
const MAX_SUBS_PER_USER = 10

function subId(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex').slice(0, 24)
}

async function authedUid(req: NextRequest): Promise<string | null> {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return null
  try {
    return (await verifyFirebaseToken(auth.slice(7))).uid
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  const db = getAdminDb()
  if (!db || !isPushConfigured()) {
    return NextResponse.json({ error: 'push not configured' }, { status: 503 })
  }
  const uid = await authedUid(req)
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const sub = (body as { subscription?: unknown } | null)?.subscription as
    | { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }
    | undefined
  const endpoint = typeof sub?.endpoint === 'string' ? sub.endpoint : ''
  const p256dh = typeof sub?.keys?.p256dh === 'string' ? sub.keys.p256dh : ''
  const authKey = typeof sub?.keys?.auth === 'string' ? sub.keys.auth : ''
  if (
    !endpoint.startsWith('https://') || endpoint.length > MAX_ENDPOINT ||
    !p256dh || p256dh.length > MAX_KEY || !authKey || authKey.length > MAX_KEY
  ) {
    return NextResponse.json({ error: 'bad subscription' }, { status: 400 })
  }

  const ref = db.collection('pushSubscriptions').doc(uid)
  const snap = await ref.get()
  const existing = snap.exists ? (snap.data()?.subs as Record<string, unknown> | undefined) : undefined
  const id = subId(endpoint)
  if (existing && !(id in existing) && Object.keys(existing).length >= MAX_SUBS_PER_USER) {
    return NextResponse.json({ error: 'too many devices' }, { status: 400 })
  }

  await ref.set(
    {
      subs: {
        [id]: {
          endpoint,
          keys: { p256dh, auth: authKey },
          createdAt: FieldValue.serverTimestamp(),
        },
      },
    },
    { merge: true },
  )
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const db = getAdminDb()
  if (!db) return NextResponse.json({ error: 'not configured' }, { status: 503 })
  const uid = await authedUid(req)
  if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const endpoint = (body as { endpoint?: unknown } | null)?.endpoint
  if (typeof endpoint !== 'string' || !endpoint) {
    return NextResponse.json({ error: 'bad endpoint' }, { status: 400 })
  }
  await db.collection('pushSubscriptions').doc(uid).update({
    [`subs.${subId(endpoint)}`]: FieldValue.delete(),
  }).catch(() => { /* doc may not exist — nothing to remove */ })
  return NextResponse.json({ ok: true })
}
