import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { getAdminDb } from '@/lib/firebaseAdmin'
import { verifyFirebaseToken } from '@/lib/verifyFirebaseToken'

// firebase-admin needs the Node runtime.
export const runtime = 'nodejs'

// Beacon-friendly snapshot save.
//
// Used by DataSync's pagehide/beforeunload handler to flush the current
// snapshot before the tab closes — the client-side Firestore SDK's
// async writes get destroyed with the tab, so a debounced save that
// fired 1900ms after the last edit would silently drop.
//
// The client posts via navigator.sendBeacon (or fetch keepalive), which
// keeps the request alive across tab close. Token travels in the body
// because sendBeacon can't set custom headers.
//
// Hard cap on payload — same as DataSync's debounced-save guard —
// so a runaway snapshot can't get sneaked past the client's size check.
const MAX_BYTES = 900_000

export async function POST(req: NextRequest) {
  const db = getAdminDb()
  if (!db) {
    return NextResponse.json({ error: 'admin not configured' }, { status: 503 })
  }

  // sendBeacon posts as `text/plain` or `application/json` depending on Blob
  // type — the client sends the raw JSON body, we parse defensively.
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'bad body' }, { status: 400 })
  }
  const { token, snapshot } = body as Record<string, unknown>
  if (typeof token !== 'string' || !token) {
    return NextResponse.json({ error: 'missing token' }, { status: 401 })
  }
  if (!snapshot || typeof snapshot !== 'object') {
    return NextResponse.json({ error: 'missing snapshot' }, { status: 400 })
  }

  // Size guard — the snapshot came from the client, don't trust it blindly.
  const size = JSON.stringify(snapshot).length
  if (size > MAX_BYTES) {
    return NextResponse.json({ error: `snapshot too large (${size} bytes)` }, { status: 413 })
  }

  let uid: string
  try {
    const v = await verifyFirebaseToken(token)
    uid = v.uid
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    await db.collection('users').doc(uid).set(
      { data: snapshot, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    )
  } catch (err) {
    console.error(`[save-snapshot] uid=${uid}`, err)
    return NextResponse.json({ error: 'save failed' }, { status: 500 })
  }

  // uid + bytes only — never log snapshot contents (financial data).
  console.log(`[save-snapshot] uid=${uid} bytes=${size}`)
  return NextResponse.json({ ok: true })
}
