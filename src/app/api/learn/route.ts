import { NextRequest, NextResponse } from 'next/server'
import { getAdminDb, getAdminAuth } from '@/lib/firebaseAdmin'
import { verifyDeviceToken } from '@/lib/deviceToken'
import { verifyFirebaseToken } from '@/lib/verifyFirebaseToken'
import { isDeviceTokenRevoked } from '@/lib/deviceTokenRevocation'
import { isAccountDeleted } from '@/lib/deletionTombstone'
import { checkRateLimit } from '@/lib/rateLimit'
import { normalizeForLookup } from '@/lib/normalizeForLookup'
import { shareableLearnedEntry } from '@/lib/learnedSharing'
import {
  foldProposal, proposalDocId, voterId, LEARN_QUORUM,
  type ProposalDoc, type ProposalOutcome,
} from '@/lib/learnedQuorum'
import { ALL_CATEGORIES } from '@/lib/constants'

// firebase-admin needs the Node runtime (not Edge).
export const runtime = 'nodejs'

const MAX_MERCHANT = 200
// The normalized KEY is what lands in the shared pool and is substring-scanned
// on every categorize() call for every client, so it is capped much tighter than
// the raw merchant string. Same cap aiSuggestions.ts already applies.
const MAX_KEY_LEN = 40
// This route writes through the admin SDK, which BYPASSES firestore.rules — so
// the 20,000-key ceiling the rules enforce on browsers does not apply here.
const MAX_SHARED_KEYS = 20_000

// Teaches the shared learnedDB from a correction made in the Android tracker app.
// Authed with the per-user HMAC device token (same as /api/transaction) — NOT a
// browser session. Writes merchant→category to shared/learnedDB so future
// ingested charges from that merchant categorize correctly. Additive + isolated:
// 503 until the backend is configured; never touches existing data/routes.
export async function POST(req: NextRequest) {
  const db = getAdminDb()
  if (!db) {
    return NextResponse.json({ error: 'service not configured' }, { status: 503 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'bad request body' }, { status: 400 })
  }
  const { token, merchant, category, subjectUid } = body as Record<string, unknown>

  // Two callers, two credentials:
  //  • Android tracker app — per-user HMAC device token in the body (original path).
  //  • Web app — the signed-in session's Firebase ID token as a Bearer header.
  //    This became the browser's ONLY path when firestore.rules closed direct
  //    writes to shared/learnedDB (any signed-in user could overwrite every
  //    value, and hasAll meant the doc could never shrink).
  let uid: string
  if (typeof token === 'string') {
    // The HMAC secret is only needed on THIS branch — gating the whole route
    // on it meant rotating/removing the Android secret silently killed every
    // browser Bearer learn too (fire-and-forget, no error surfaced anywhere).
    const secret = process.env.TRANSACTION_SECRET
    if (!secret) {
      return NextResponse.json({ error: 'service not configured' }, { status: 503 })
    }
    const verified = verifyDeviceToken(token, secret)
    if (!verified) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    uid = verified.uid

    if (await isDeviceTokenRevoked(uid, verified.version)) {
      return NextResponse.json({ error: 'token revoked' }, { status: 401 })
    }
    // This was the one device-token route that never checked the tombstone: a
    // deleted account's still-installed tracker app kept writing into the SHARED
    // pool — the collection with the widest blast radius — indefinitely.
    if (await isAccountDeleted(uid)) {
      return NextResponse.json({ error: 'account deleted' }, { status: 410 })
    }
    // Same allowlist bar as the Bearer branch below. The documented removal
    // flow (/revoke) deletes the allowlist doc but does NOT bump the device
    // token's minVersion — so without this check, a removed client with the
    // tracker still installed kept teaching the pool that applies to every
    // account. Fail closed: losing a learn write is harmless, an unauthorized
    // one is not.
    const adminAuth = getAdminAuth()
    if (!adminAuth) {
      return NextResponse.json({ error: 'service not configured' }, { status: 503 })
    }
    let deviceEmail: string | undefined
    try {
      deviceEmail = (await adminAuth.getUser(uid)).email
    } catch {
      return NextResponse.json({ error: 'not allowed' }, { status: 403 })
    }
    const deviceEmailKey = deviceEmail?.toLowerCase().trim()
    if (!deviceEmailKey || !(await db.collection('allowlist').doc(deviceEmailKey).get()).exists) {
      return NextResponse.json({ error: 'not allowed' }, { status: 403 })
    }
  } else {
    const authHeader = req.headers.get('authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    let email: string | undefined
    try {
      const v = await verifyFirebaseToken(authHeader.slice(7))
      uid = v.uid
      email = v.email
    } catch {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    // An ID token stays valid up to an hour after account deletion — same
    // reason /api/save-snapshot checks the tombstone on this credential type.
    if (await isAccountDeleted(uid)) {
      return NextResponse.json({ error: 'account deleted' }, { status: 410 })
    }
    // Same bar the browser write cleared at the rules layer before it closed:
    // the session must belong to an invited (allowlisted) account. A revoked
    // client must not keep teaching the pool that applies to every account.
    const emailKey = email?.toLowerCase().trim()
    if (!emailKey || !(await db.collection('allowlist').doc(emailKey).get()).exists) {
      return NextResponse.json({ error: 'not allowed' }, { status: 403 })
    }
  }
  // Unlike the AI routes this had no limiter at all, so one leaked token could
  // grow shared/learnedDB toward the 1MB document ceiling — at which point
  // legitimate learn writes start failing for EVERY client.
  // 250/hr, not 100: the key is the SIGNED-IN uid, which for an advisor doing
  // an initial-mapping marathon is shared across every client they correct in
  // that hour — 100 was reachable by honest work, and the 429 is swallowed
  // client-side so the pool silently stopped learning mid-session.
  const rl = await checkRateLimit({ key: 'learn:' + uid, limit: 250, windowMs: 3_600_000 })
  if (!rl.allowed) {
    return NextResponse.json({ error: 'rate limited' }, { status: 429 })
  }

  if (typeof merchant !== 'string' || !merchant.trim() || merchant.length > MAX_MERCHANT) {
    return NextResponse.json({ error: 'bad merchant' }, { status: 400 })
  }
  if (typeof category !== 'string' || !ALL_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: 'bad category' }, { status: 400 })
  }

  const key = normalizeForLookup(merchant.trim())
  if (!key || key.length > MAX_KEY_LEN) {
    return NextResponse.json({ error: 'bad merchant' }, { status: 400 })
  }

  // ── whose household is this correction evidence about ──
  //
  // The quorum below counts DISTINCT HOUSEHOLDS, and for the automap lab the
  // caller is never the household: Ori works inside a client's account through
  // impersonation. Counting the signed-in uid there would mean every correction
  // he ever makes is one household, and nothing he does could reach quorum.
  //
  // 🔴 So the caller may name a subject — and it is verified, never trusted.
  // Without the link check, one account could reach quorum alone by sending two
  // invented uids, which is precisely the single-voice promotion this whole
  // change exists to stop. Fails CLOSED: this field decides whose evidence
  // counts, and there is no safe default when the lookup is uncertain.
  // Trimmed BEFORE the comparison. Untrimmed, a caller sending their own uid
  // with a stray space fell through to the link lookup, where their own
  // clientLinks doc names their ADVISOR as invitedByUid — so their own vote
  // came back 403.
  let subject = uid
  const wanted = typeof subjectUid === 'string' ? subjectUid.trim() : ''
  if (wanted && wanted !== uid) {
    const target = wanted
    if (target.length > 128) {
      return NextResponse.json({ error: 'bad subject' }, { status: 400 })
    }
    try {
      const link = await db.collection('clientLinks').doc(target).get()
      const data = link.data() as { invitedByUid?: string; status?: string } | undefined
      if (!link.exists || data?.status !== 'active' || data?.invitedByUid !== uid) {
        return NextResponse.json({ error: 'not your client' }, { status: 403 })
      }
    } catch {
      return NextResponse.json({ error: 'not your client' }, { status: 403 })
    }
    subject = target
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

  // Enforce the key ceiling in code, since the admin SDK skips the rule that
  // enforces it for browsers. Updating an EXISTING key is always allowed — only
  // growth past the cap is refused, so a full pool still self-corrects.
  const ref = db.collection('shared').doc('learnedDB')
  // Fail open on a read blip, like every other guard on this route: the tracker
  // app fires-and-forgets, so throwing here would silently discard a correction
  // whose write would have succeeded. An empty map allows the write, which is the
  // safe direction. hasOwnProperty, not `in`, so a merchant normalizing to
  // "constructor"/"toString" isn't mistaken for an existing key.
  let existing: Record<string, string> = {}
  try {
    existing = ((await ref.get()).data()?.db as Record<string, string>) ?? {}
  } catch {
    existing = {}
  }
  if (!Object.prototype.hasOwnProperty.call(existing, key) && Object.keys(existing).length >= MAX_SHARED_KEYS) {
    console.warn(`[learn] shared pool at capacity (${MAX_SHARED_KEYS}) — refused new key`)
    return NextResponse.json({ ok: true, shared: false })
  }

  // Already the pool's answer: nothing to promote, and re-writing it would only
  // reset nothing. Answer ok so the caller sees no difference.
  if (existing[key] === category) {
    return NextResponse.json({ ok: true, shared: true, votes: LEARN_QUORUM })
  }

  // ── corroboration (Ori, 2026-08-12) ──
  //
  // One household's correction no longer redefines a merchant for everyone. It
  // is recorded as a proposal, and the pool is written on the call that brings
  // a SECOND household to the same answer.
  //
  // A transaction, not a merge with arrayUnion: the read and the count decide
  // whether 40 clients get a new mapping, and two advisors correcting the same
  // merchant in the same minute must not each see one vote and promote nothing.
  //
  // ⚠️ Fails CLOSED, unlike every other guard on this route. Elsewhere a read
  // blip costs one lost correction; here it would cost a promotion made without
  // ever counting the votes.
  const proposalRef = db.collection('learnedProposals').doc(await proposalDocId(key))
  const voter = await voterId(subject)
  let outcome: ProposalOutcome
  try {
    outcome = await db.runTransaction(async tx => {
      const snap = await tx.get(proposalRef)
      const folded = foldProposal(snap.data() as ProposalDoc | undefined, key, category, voter)
      tx.set(proposalRef, { ...folded.next, updatedAt: new Date() }, { merge: true })
      return folded
    })
  } catch (err) {
    console.warn('[learn] proposal transaction failed —', err)
    return NextResponse.json({ error: 'try again' }, { status: 503 })
  }

  if (!outcome.promote) {
    console.log(`[learn] uid=${uid} cat=${category} — ${outcome.votes}/${LEARN_QUORUM} votes, rival ${outcome.rival}${outcome.duplicate ? ' (repeat)' : ''}`)
    return NextResponse.json({
      ok: true, shared: false, votes: outcome.votes, needed: LEARN_QUORUM,
    })
  }

  // 🔴 Guarded, unlike before. The votes are already durable at this point, so
  // an unhandled throw here returned a bare 500 with no log line while the
  // proposal sat at quorum with nothing in the pool. A 503 is a signal the
  // caller can retry on, and the retry now works: promotion no longer requires
  // the voter to be new (see foldProposal).
  //
  // Single-field merge — only adds/updates this one key, never replaces the doc.
  try {
    await ref.set({ db: { [key]: category } }, { merge: true })
  } catch (err) {
    console.error(`[learn] PROMOTION WRITE FAILED for "${key}" → ${category} —`, err)
    return NextResponse.json({ error: 'try again' }, { status: 503 })
  }

  console.log(`[learn] uid=${uid} cat=${category} — PROMOTED on ${outcome.votes} households`)
  return NextResponse.json({ ok: true, shared: true, votes: outcome.votes })
}
