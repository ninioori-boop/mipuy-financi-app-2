import { NextRequest, NextResponse } from 'next/server'
import { verifyFirebaseToken } from '@/lib/verifyFirebaseToken'
import { invitedStatus } from '@/lib/requireInvited'
import { checkRateLimit } from '@/lib/rateLimit'

// firebase-admin needs the Node runtime (not Edge).
export const runtime = 'nodejs'

/**
 * "Is the signed-in account invited?" — the one question the browser cannot
 * answer for itself, because `allowlist` is deliberately unreadable by clients
 * (firestore.rules denies it, and it is consulted only through exists() with
 * rule privileges).
 *
 * Exists so the app can tell somebody the truth at the moment they arrive
 * instead of showing them an app where nothing loads and nothing saves. A
 * client who mistyped her address (`...@gmail.con`, 2026-08-11) sat in exactly
 * that state for 90 minutes.
 *
 * This is a COURTESY, not the control: the enforcement is firestore.rules on
 * the client-facing data paths and `isInvited()` on the paid AI routes. Anyone
 * can skip a client-side check; there is (almost) nothing behind it to reach —
 * `/api/save-snapshot` is the one admin-SDK write that does not check the
 * allowlist, so an uninvited account can still POST a portfolio it will never
 * be allowed to read back.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    const { uid, email } = await verifyFirebaseToken(auth.slice(7))

    // Generous — the app asks once per sign-in — but this is an admin-SDK route
    // and account creation is not gated, so it must not be a free oracle.
    const rl = await checkRateLimit({ key: 'invite-status:' + uid, limit: 60, windowMs: 3_600_000 })
    if (!rl.allowed) return NextResponse.json({ error: 'rate limited' }, { status: 429 })

    const status = await invitedStatus(uid, email ?? null)
    // "I could not check" must NEVER be reported as "not invited". This answer
    // drives a full-screen block; a missing service account or a Firestore blip
    // returning a confident `false` would tell every paying client they were
    // never invited, with sign-out as their only option. 503 → the client
    // treats it as unknown and carries on.
    if (status === null) {
      return NextResponse.json({ error: 'invite status unavailable' }, { status: 503 })
    }
    return NextResponse.json({ invited: status })
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
}
