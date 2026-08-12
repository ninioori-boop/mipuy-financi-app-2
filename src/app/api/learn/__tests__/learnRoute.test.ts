import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * /api/learn — the only door from the app into shared/learnedDB, the map every
 * client reads on every categorization.
 *
 * This route had NO tests until 2026-08-12, which is exactly backwards: it is
 * the one place where a failure is silent for everyone at once. What is proven
 * here is mostly what the route REFUSES — an unauthenticated caller, a uid
 * claiming someone else's household, a single voice trying to teach 40 clients.
 *
 * No emulator: the admin SDK is faked. Java is not installed on this machine
 * and `npm run test:rules` runs in CI, so a test that needed it would simply
 * never run here.
 */

const stores = {
  allowlist:        new Map<string, object>(),
  clientLinks:      new Map<string, object>(),
  shared:           new Map<string, object>(),
  learnedProposals: new Map<string, object>(),
}

/** Records what the route actually wrote, so the assertions can be about effect. */
let poolWriteFails = false

function makeDb() {
  const docRef = (coll: keyof typeof stores, id: string) => ({
    async get() {
      const data = stores[coll].get(id)
      return { exists: data !== undefined, data: () => data }
    },
    async set(value: Record<string, unknown>, opts?: { merge?: boolean }) {
      if (coll === 'shared' && poolWriteFails) throw new Error('write failed')
      const prev = (stores[coll].get(id) ?? {}) as Record<string, unknown>
      if (opts?.merge && coll === 'shared') {
        const prevDb = (prev.db ?? {}) as Record<string, unknown>
        const nextDb = (value.db ?? {}) as Record<string, unknown>
        stores[coll].set(id, { ...prev, ...value, db: { ...prevDb, ...nextDb } })
      } else {
        stores[coll].set(id, opts?.merge ? { ...prev, ...value } : value)
      }
    },
  })

  return {
    collection: (name: keyof typeof stores) => ({ doc: (id: string) => docRef(name, id) }),
    // The proposal fold runs inside a transaction. The fake runs the body once
    // with direct reads — enough to prove the ORDER and the decision, which is
    // what this file is about; atomicity is the SDK's job, not ours.
    async runTransaction<T>(fn: (tx: {
      get: (ref: { get: () => Promise<unknown> }) => Promise<unknown>
      set: (ref: { set: (v: object, o?: object) => Promise<void> }, v: object, o?: object) => void
    }) => Promise<T>): Promise<T> {
      return fn({
        get: ref => ref.get(),
        set: (ref, v, o) => { void ref.set(v, o) },
      })
    },
  }
}

vi.mock('@/lib/firebaseAdmin', () => ({
  getAdminDb:   () => makeDb(),
  getAdminAuth: () => ({ getUser: async () => ({ email: 'client@x.com' }) }),
}))
vi.mock('@/lib/verifyFirebaseToken', () => ({
  verifyFirebaseToken: async (t: string) => {
    if (!t.startsWith('ok:')) throw new Error('bad token')
    const [, uid, email] = t.split(':')
    return { uid, email: email || `${uid}@x.com` }
  },
}))
vi.mock('@/lib/deletionTombstone', () => ({ isAccountDeleted: async () => false }))
vi.mock('@/lib/rateLimit',        () => ({ checkRateLimit: async () => ({ allowed: true }) }))
vi.mock('@/lib/deviceToken',      () => ({ verifyDeviceToken: () => null }))
vi.mock('@/lib/deviceTokenRevocation', () => ({ isDeviceTokenRevoked: async () => false }))

import { POST } from '@/app/api/learn/route'

const MERCHANT = 'ארומה תל אביב'
const CATEGORY = 'אוכל בחוץ ובילויים'

/** A signed-in web caller. `subject` names another household, when given. */
function req(uid: string, body: Record<string, unknown> = {}) {
  return new Request('https://x/api/learn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authorization: `Bearer ok:${uid}` },
    body: JSON.stringify({ merchant: MERCHANT, category: CATEGORY, ...body }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any
}

const pool = () => (stores.shared.get('learnedDB') as { db?: Record<string, string> })?.db ?? {}

beforeEach(() => {
  for (const s of Object.values(stores)) s.clear()
  poolWriteFails = false
  stores.allowlist.set('a@x.com', {})
  stores.allowlist.set('b@x.com', {})
  stores.allowlist.set('advisor@x.com', {})
})

describe('/api/learn — who is refused', () => {
  it('rejects a caller with no credential at all', async () => {
    const res = await POST(new Request('https://x/api/learn', {
      method: 'POST', body: JSON.stringify({ merchant: MERCHANT, category: CATEGORY }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any)
    expect(res.status).toBe(401)
    expect(pool()).toEqual({})
  })

  it('rejects an account that is not on the allowlist', async () => {
    const res = await POST(req('nobody', {}))
    expect(res.status).toBe(403)
    expect(pool()).toEqual({})
  })

  it('rejects a category that is not a real category', async () => {
    const res = await POST(req('a', { category: 'קטגוריה שהמצאתי' }))
    expect(res.status).toBe(400)
  })

  // 🔴 The check that stops one account reaching quorum alone with two invented
  // households. Without it the whole mechanism is decoration.
  it('rejects a subject the caller does not own', async () => {
    stores.clientLinks.set('victim', { invitedByUid: 'someone-else', status: 'active' })
    const res = await POST(req('a', { subjectUid: 'victim' }))
    expect(res.status).toBe(403)
    expect(stores.learnedProposals.size).toBe(0)
  })

  it('rejects a subject whose link is not active', async () => {
    stores.clientLinks.set('c1', { invitedByUid: 'advisor', status: 'pending' })
    const res = await POST(req('advisor', { subjectUid: 'c1' }))
    expect(res.status).toBe(403)
  })

  it('rejects a subject with no link at all', async () => {
    const res = await POST(req('advisor', { subjectUid: 'ghost' }))
    expect(res.status).toBe(403)
  })
})

describe('/api/learn — corroboration', () => {
  it('one household does NOT write the pool', async () => {
    const res = await POST(req('a'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ ok: true, shared: false, votes: 1, needed: 2 })
    expect(pool()).toEqual({})
  })

  it('the same household repeating still does not write the pool', async () => {
    await POST(req('a'))
    const body = await (await POST(req('a'))).json()
    expect(body.votes).toBe(1)
    expect(pool()).toEqual({})
  })

  it('a second household writes it', async () => {
    await POST(req('a'))
    const body = await (await POST(req('b'))).json()
    expect(body).toMatchObject({ shared: true, votes: 2 })
    expect(pool()[MERCHANT]).toBe(CATEGORY)
  })

  // The advisor path, which is the whole reason subjectUid exists: one signed-in
  // advisor, two of his clients, two votes.
  it('counts an advisor\'s two clients as two households', async () => {
    stores.clientLinks.set('c1', { invitedByUid: 'advisor', status: 'active' })
    stores.clientLinks.set('c2', { invitedByUid: 'advisor', status: 'active' })

    const first = await (await POST(req('advisor', { subjectUid: 'c1' }))).json()
    expect(first.shared).toBe(false)

    const second = await (await POST(req('advisor', { subjectUid: 'c2' }))).json()
    expect(second.shared).toBe(true)
    expect(pool()[MERCHANT]).toBe(CATEGORY)
  })

  // 🔴 And the same client twice is still one household, however it is reached —
  // once as the signed-in account and once named as a subject.
  it('does not double-count one household reached two ways', async () => {
    stores.clientLinks.set('a', { invitedByUid: 'advisor', status: 'active' })
    await POST(req('a'))                                   // as themselves
    const again = await (await POST(req('advisor', { subjectUid: 'a' }))).json()
    expect(again.shared).toBe(false)
    expect(again.votes).toBe(1)
    expect(pool()).toEqual({})
  })

  it('never shares a payment rail, however many households agree', async () => {
    const rail = { merchant: 'העברה ב BIT', category: 'מתנות' }
    expect((await (await POST(req('a', rail))).json()).shared).toBe(false)
    expect((await (await POST(req('b', rail))).json()).shared).toBe(false)
    expect(pool()).toEqual({})
    expect(stores.learnedProposals.size).toBe(0)   // not even recorded
  })
})

describe('/api/learn — failure paths', () => {
  // 🔴 The grill finding. The votes commit first; if the pool write throws, the
  // entry used to be stranded forever because every retry was a "repeat".
  it('answers 503 when the pool write fails, and the retry then succeeds', async () => {
    await POST(req('a'))
    poolWriteFails = true
    const failed = await POST(req('b'))
    expect(failed.status).toBe(503)
    expect(pool()).toEqual({})

    poolWriteFails = false
    const retry = await (await POST(req('b'))).json()   // the SAME household retrying
    expect(retry.shared).toBe(true)
    expect(pool()[MERCHANT]).toBe(CATEGORY)
  })

  it('is a no-op once the pool already holds this answer', async () => {
    await POST(req('a'))
    await POST(req('b'))
    const before = stores.learnedProposals.size
    const again = await (await POST(req('a'))).json()
    expect(again).toMatchObject({ ok: true, shared: true })
    expect(stores.learnedProposals.size).toBe(before)
  })
})
