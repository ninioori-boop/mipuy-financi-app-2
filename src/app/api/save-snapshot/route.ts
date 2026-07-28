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
// Anti-clobber skew buffer — matches the client's CONFLICT_SKEW_MS (the
// baseline mixes client clocks with server timestamps).
const SKEW_MS = 15_000

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
  const { token, snapshot, baseline } = body as Record<string, unknown>
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
    const ref = db.collection('users').doc(uid)
    if (typeof baseline === 'number' && baseline > 0) {
      // Anti-clobber: refuse a STALE tab-close flush when the doc is
      // meaningfully newer than what the sending tab last saw. A rejected
      // flush is recoverable from the device's localStorage mirror; a clobber
      // of newer data is silent and permanent. Transaction = read+write atomic.
      const stale = await db.runTransaction(async (tx) => {
        const cur = await tx.get(ref)
        const ts = cur.data()?.updatedAt as { toMillis?: () => number } | undefined
        const curTs = typeof ts?.toMillis === 'function' ? ts.toMillis() : 0
        if (curTs > baseline + SKEW_MS) return true
        // mergeFields, not merge:true — see saveUserData: a deep map merge
        // resurrects keys the user deleted locally.
        tx.set(ref, { data: snapshot, updatedAt: FieldValue.serverTimestamp() },
          { mergeFields: ['data', 'updatedAt'] })
        return false
      })
      if (stale) {
        console.log(`[save-snapshot] uid=${uid} stale flush rejected`)
        return NextResponse.json({ error: 'stale' }, { status: 409 })
      }
    } else {
      // No baseline (older cached bundle) — original unconditional behavior.
      await ref.set(
        { data: snapshot, updatedAt: FieldValue.serverTimestamp() },
        { mergeFields: ['data', 'updatedAt'] },
      )
    }
  } catch (err) {
    console.error(`[save-snapshot] uid=${uid}`, err)
    return NextResponse.json({ error: 'save failed' }, { status: 500 })
  }

  // uid + bytes only — never log snapshot contents (financial data).
  console.log(`[save-snapshot] uid=${uid} bytes=${size}`)
  return NextResponse.json({ ok: true })
}
