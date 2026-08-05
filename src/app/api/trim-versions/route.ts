import { NextRequest, NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/firebaseAdmin'
import { verifyFirebaseToken } from '@/lib/verifyFirebaseToken'
import { isAccountDeleted } from '@/lib/deletionTombstone'
import { checkRateLimit } from '@/lib/rateLimit'

// firebase-admin needs the Node runtime (not Edge).
export const runtime = 'nodejs'

/** Keep in sync with MAX_VERSIONS in src/lib/firestoreService.ts — that is a
 *  client module ('use client' imports), so importing the const here would
 *  drag the client SDK into a server route. */
const KEEP = 20

// Deletes version snapshots beyond the newest KEEP, with the admin SDK:
// ids-only listing (select()), zero payload reads. This replaced the
// client-side trimVersions() on 2026-08-05 because the browser could not do
// the job from either side: an ADVISOR session may only CREATE versions
// (rules — deletable history would defeat its purpose as the client's undo of
// advisor edits), so its trim failed silently and an advisor-managed client
// accumulated ~12 versions per editing hour; and the web SDK has no field
// masks, so the CLIENT's eventual trim downloaded every full snapshot
// (potentially hundreds × 200-400KB, on a phone) just to learn their ids.
export async function POST(req: NextRequest) {
  const db = getAdminDb()
  if (!db) {
    return NextResponse.json({ error: 'service not configured' }, { status: 503 })
  }

  const authHeader = req.headers.get('authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  let callerUid: string
  try {
    callerUid = (await verifyFirebaseToken(authHeader.slice(7))).uid
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (await isAccountDeleted(callerUid)) {
    return NextResponse.json({ error: 'account deleted' }, { status: 410 })
  }

  const body = await req.json().catch(() => null)
  const rawUid = body && typeof (body as Record<string, unknown>).uid === 'string'
    ? ((body as Record<string, unknown>).uid as string)
    : ''
  const target = rawUid || callerUid
  if (target !== callerUid) {
    // Mirror of the rules' advisor clause on versions: an active WRITE-consent
    // link. The advisor session CREATES versions for the client, so it must be
    // able to trigger the trim too — the deletion itself runs here with admin
    // credentials, never with the advisor's own.
    const link = await db.collection('clientLinks').doc(target).get()
    const l = (link.exists ? link.data() : null) ?? {}
    if (l.status !== 'active' || l.invitedByUid !== callerUid || l.access !== 'write') {
      return NextResponse.json({ error: 'not allowed' }, { status: 403 })
    }
  }

  // Version creation is throttled to ~one per 5 minutes per session, so even
  // an advisor+client editing simultaneously stays far under this.
  const rl = await checkRateLimit({ key: 'trimver:' + callerUid, limit: 60, windowMs: 3_600_000 })
  if (!rl.allowed) {
    return NextResponse.json({ error: 'rate limited' }, { status: 429 })
  }

  // select() with no fields = document refs only, ordered server-side.
  const snap = await db.collection('users').doc(target).collection('versions')
    .orderBy('savedAt', 'desc').select().get()
  const excess = snap.docs.slice(KEEP)
  if (excess.length) {
    const bw = db.bulkWriter()
    // Per-delete .catch: a delete that exhausts BulkWriter's retries rejects
    // its own promise, and with no handler that surfaces as an unhandled
    // rejection inside the invocation. Trim is best-effort — the next save
    // retries whatever survived.
    const results = excess.map(d => bw.delete(d.ref).catch(() => null))
    await bw.close()
    await Promise.all(results)
  }
  return NextResponse.json({ ok: true, deleted: excess.length })
}
