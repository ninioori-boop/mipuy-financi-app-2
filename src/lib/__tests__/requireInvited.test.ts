import { describe, it, expect, vi, beforeEach } from 'vitest'

// The AI routes are the one authenticated surface firestore.rules does not
// cover, and the only one that spends money per call. gateSignup was meant to
// stop an uninvited account from existing and has never run once, so this
// helper is the actual gate. It must fail CLOSED.

const h = vi.hoisted(() => ({
  allow: new Set<string>(),
  noDb: false,
  noAuth: false,
  throwOnRead: false,
  accountEmail: undefined as string | undefined,
  lastDocId: '',
  lastCollection: '',
}))

vi.mock('@/lib/firebaseAdmin', () => ({
  getAdminDb: () => h.noDb ? null : {
    collection: (c: string) => {
      h.lastCollection = c
      return {
        doc: (id: string) => {
          h.lastDocId = id
          return {
            get: async () => {
              if (h.throwOnRead) throw new Error('firestore unavailable')
              return { exists: h.allow.has(id) }
            },
          }
        },
      }
    },
  },
  getAdminAuth: () => h.noAuth ? null : {
    getUser: async () => {
      // undefined = the lookup itself fails; '' = a real record with no address.
      if (h.accountEmail === undefined) throw new Error('auth/user-not-found')
      return { email: h.accountEmail }
    },
  },
}))

import { isInvited, invitedStatus } from '@/lib/requireInvited'

beforeEach(() => {
  h.allow = new Set(['client@gmail.com'])
  h.noDb = false; h.noAuth = false; h.throwOnRead = false
  h.accountEmail = undefined
  h.lastDocId = ''; h.lastCollection = ''
})

describe('isInvited', () => {
  it('admits an allowlisted address', async () => {
    expect(await isInvited('U1', 'client@gmail.com')).toBe(true)
    expect(h.lastCollection).toBe('allowlist')
    expect(h.lastDocId).toBe('client@gmail.com')
  })

  it('refuses an address that was never invited', async () => {
    // The exact production case: a typo produced a real account nobody invited.
    expect(await isInvited('U1', 'client@gmail.con')).toBe(false)
  })

  it('normalises case and whitespace like the allowlist doc ids', async () => {
    expect(await isInvited('U1', '  CLIENT@Gmail.COM ')).toBe(true)
  })

  it('resolves the address from the account when the token carries no email', async () => {
    // Custom-token sessions (the Android WebView bridge) need not carry the
    // claim; denying them would break phone users who ARE invited.
    h.accountEmail = 'client@gmail.com'
    expect(await isInvited('U1', null)).toBe(true)
  })

  it('refuses when neither the token nor the account has an address', async () => {
    expect(await isInvited('U1', undefined)).toBe(false)
  })

  it('fails CLOSED when the allowlist read throws', async () => {
    h.throwOnRead = true
    expect(await isInvited('U1', 'client@gmail.com')).toBe(false)
  })

  it('fails CLOSED when the admin SDK is unavailable', async () => {
    h.noDb = true
    expect(await isInvited('U1', 'client@gmail.com')).toBe(false)
  })

  it('fails CLOSED when the account lookup is needed but unavailable', async () => {
    h.noAuth = true
    expect(await isInvited('U1', null)).toBe(false)
  })
})

// The three-way answer is what keeps one bad env var from telling every paying
// client they were never invited. "Could not check" must stay distinguishable
// from "checked, and no" all the way out to the UI.
describe('invitedStatus keeps "unknown" separate from "no"', () => {
  it('answers null when the admin SDK is missing', async () => {
    h.noDb = true
    expect(await invitedStatus('U1', 'client@gmail.com')).toBeNull()
  })

  it('answers null when the allowlist read throws', async () => {
    h.throwOnRead = true
    expect(await invitedStatus('U1', 'client@gmail.com')).toBeNull()
  })

  it('answers null when the address lookup is needed but unavailable', async () => {
    h.noAuth = true
    expect(await invitedStatus('U1', null)).toBeNull()
  })

  it('answers a definite false only after a completed lookup', async () => {
    expect(await invitedStatus('U1', 'stranger@gmail.com')).toBe(false)
  })

  it('answers false for an account that genuinely has no address — that IS an answer', async () => {
    h.accountEmail = ''
    expect(await invitedStatus('U1', undefined)).toBe(false)
  })

  it('answers null when the address lookup itself fails', async () => {
    // A throw is not evidence of "not invited"; it is evidence of nothing.
    expect(await invitedStatus('U1', undefined)).toBeNull()
  })

  it('answers true for an allowlisted address', async () => {
    expect(await invitedStatus('U1', 'client@gmail.com')).toBe(true)
  })
})
