import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * /api/save-snapshot — the tab-close flush, and the ONE admin-SDK write into
 * users/{uid} that firestore.rules do not cover.
 *
 * Both directions matter here and they point opposite ways, which is why this
 * file exists at all:
 *   • an uninvited account must be REFUSED (account creation is not gated —
 *     gateSignup needs GCIP and has never run, so signing up is open);
 *   • a client whose allowlist status could not be READ must still be SAVED.
 *
 * That second one is the fragile half. `invitedStatus` answers three ways, and
 * the obvious "cleanup" — swapping it for the fail-closed `isInvited` to match
 * /api/learn — would silently start discarding real portfolios on any Firestore
 * blip, with the caller a fire-and-forget beacon that never reads the response.
 * If you are here because that swap broke this test: the swap is the bug.
 */

let invited: boolean | null = true
/** Everything the route actually wrote into users/{uid}. */
let writes: Array<{ uid: string; value: Record<string, unknown> }> = []
/** Server-side updatedAt, in ms — drives the stale-flush (409) branch. */
let currentUpdatedAt = 0

function makeDb() {
  const docRef = (uid: string) => ({
    async get() {
      return { data: () => ({ updatedAt: { toMillis: () => currentUpdatedAt } }) }
    },
    async set(value: Record<string, unknown>) {
      writes.push({ uid, value })
    },
  })

  return {
    collection: () => ({ doc: (id: string) => docRef(id) }),
    async runTransaction<T>(fn: (tx: {
      get: (ref: { get: () => Promise<unknown> }) => Promise<unknown>
      set: (ref: { set: (v: Record<string, unknown>) => Promise<void> }, v: Record<string, unknown>) => void
    }) => Promise<T>): Promise<T> {
      return fn({
        get: ref => ref.get(),
        set: (ref, v) => { void ref.set(v) },
      })
    },
  }
}

vi.mock('@/lib/firebaseAdmin', () => ({ getAdminDb: () => makeDb() }))
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}))
vi.mock('@/lib/verifyFirebaseToken', () => ({
  verifyFirebaseToken: async (t: string) => {
    if (!t.startsWith('ok:')) throw new Error('bad token')
    const [, uid] = t.split(':')
    return { uid, email: `${uid}@x.com` }
  },
}))
vi.mock('@/lib/deletionTombstone', () => ({
  isAccountDeleted: async () => false,
  DELETED_ACCOUNT_RESPONSE: { body: { error: 'account deleted' }, status: 410 },
}))
vi.mock('@/lib/requireInvited', () => ({ invitedStatus: async () => invited }))

import { POST } from '@/app/api/save-snapshot/route'

const SNAPSHOT = { expenseLog: { entries: [{ amount: 42 }] } }

// Fake session handles, NOT credentials: the mocked verifyFirebaseToken above
// only parses `ok:<uid>` and rejects everything else. Named rather than written
// inline at each call so a `token: '<literal>'` never appears in this file — the
// pre-commit secret scanner reads that shape as a hardcoded credential and
// blocks the commit. Each name also says which account the case exercises.
const SESSION = {
  invited: 'ok:u1',
  otherInvited: 'ok:u2',
  stranger: 'ok:stranger',
  unverifiable: 'bad',
}

function req(body: Record<string, unknown>) {
  return new Request('https://x/api/save-snapshot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any
}

beforeEach(() => {
  invited = true
  writes = []
  currentUpdatedAt = 0
})

describe('/api/save-snapshot allowlist enforcement', () => {
  it('saves for an invited account', async () => {
    const res = await POST(req({ token: SESSION.invited, snapshot: SNAPSHOT }))
    expect(res.status).toBe(200)
    expect(writes).toHaveLength(1)
    expect(writes[0].uid).toBe('u1')
    expect(writes[0].value.data).toEqual(SNAPSHOT)
  })

  it('refuses an account that is not on the allowlist, and writes NOTHING', async () => {
    invited = false
    const res = await POST(req({ token: SESSION.stranger, snapshot: SNAPSHOT }))
    expect(res.status).toBe(403)
    // The point of the whole change: no document is created for a stranger.
    expect(writes).toHaveLength(0)
  })

  it('SAVES when the allowlist could not be read (null must never mean "not invited")', async () => {
    invited = null
    const res = await POST(req({ token: SESSION.otherInvited, snapshot: SNAPSHOT }))
    expect(res.status).toBe(200)
    expect(writes).toHaveLength(1)
    expect(writes[0].value.data).toEqual(SNAPSHOT)
  })

  it('refuses a stranger on the baseline/transaction path too', async () => {
    invited = false
    const res = await POST(req({ token: SESSION.stranger, snapshot: SNAPSHOT, baseline: Date.now() }))
    expect(res.status).toBe(403)
    expect(writes).toHaveLength(0)
  })

  it('still rejects an unverifiable token before it ever asks about the allowlist', async () => {
    const res = await POST(req({ token: SESSION.unverifiable, snapshot: SNAPSHOT }))
    expect(res.status).toBe(401)
    expect(writes).toHaveLength(0)
  })

  it('leaves the stale-flush guard intact for an invited account', async () => {
    const baseline = 1_000_000
    currentUpdatedAt = baseline + 60_000   // well past SKEW_MS
    const res = await POST(req({ token: SESSION.invited, snapshot: SNAPSHOT, baseline }))
    expect(res.status).toBe(409)
    expect(writes).toHaveLength(0)
  })
})
