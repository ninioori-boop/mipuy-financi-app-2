import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The kill switch is the documented hard backstop for AI spend: rateLimit.ts
// deliberately fails open and names this module as the control that does not.
// It used to reset its cache to `false` whenever the Firestore read threw, so a
// blip during an incident silently un-pressed the panic button — the control
// went quiet at exactly the moment it was needed. These tests pin that down.

const h = vi.hoisted(() => ({
  noDb: false,
  throwOnRead: false,
  killSwitch: false,
  docExists: true,
  reads: 0,
}))

vi.mock('@/lib/firebaseAdmin', () => ({
  getAdminDb: () =>
    h.noDb
      ? null
      : {
          collection: () => ({
            doc: () => ({
              get: async () => {
                h.reads++
                if (h.throwOnRead) throw new Error('firestore unavailable')
                return { exists: h.docExists, data: () => ({ killSwitch: h.killSwitch }) }
              },
            }),
          }),
        },
}))

// The daily cap is a separate control with its own (intentional) fail-open
// behaviour; stub it so these tests speak only about the switch.
vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: async () => ({ allowed: true, remaining: 1 }),
}))

const T0 = new Date('2026-08-12T10:00:00Z')
/** Past the module's 60s cache window, so the next call actually re-reads. */
const afterCacheExpiry = () => vi.setSystemTime(new Date(T0.getTime() + 61_000))

beforeEach(() => {
  vi.resetModules() // fresh module-level killCache per test
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  h.noDb = false
  h.throwOnRead = false
  h.killSwitch = false
  h.docExists = true
  h.reads = 0
  delete process.env.AI_KILL_SWITCH
  delete process.env.AI_DAILY_LIMIT
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('checkAiBudget — the Firestore kill switch', () => {
  it('stops when the switch is on', async () => {
    const { checkAiBudget } = await import('@/lib/aiBudget')
    h.killSwitch = true
    expect((await checkAiBudget()).stopped).toBe(true)
  })

  it('allows when the switch is off', async () => {
    const { checkAiBudget } = await import('@/lib/aiBudget')
    expect((await checkAiBudget()).stopped).toBe(false)
  })

  // THE regression: pressed, then the infra it lives on falls over.
  it('keeps stopping when Firestore starts failing after the switch was read as on', async () => {
    const { checkAiBudget } = await import('@/lib/aiBudget')
    h.killSwitch = true
    expect((await checkAiBudget()).stopped).toBe(true)

    h.throwOnRead = true
    afterCacheExpiry()
    expect((await checkAiBudget()).stopped).toBe(true)

    // Still holding several windows later — not a one-off grace period.
    vi.setSystemTime(new Date(T0.getTime() + 10 * 60_000))
    expect((await checkAiBudget()).stopped).toBe(true)
  })

  it('does not invent a stop when the last known state was off', async () => {
    const { checkAiBudget } = await import('@/lib/aiBudget')
    expect((await checkAiBudget()).stopped).toBe(false)

    h.throwOnRead = true
    afterCacheExpiry()
    expect((await checkAiBudget()).stopped).toBe(false)
  })

  // A deploy that has never reached Firestore must not black out the AI for
  // everyone; that would be a self-inflicted outage, not a safety measure.
  it('fails open when the switch has never been read successfully', async () => {
    const { checkAiBudget } = await import('@/lib/aiBudget')
    h.throwOnRead = true
    expect((await checkAiBudget()).stopped).toBe(false)
  })

  it('logs a warning so the degraded read is visible in the Vercel logs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { checkAiBudget } = await import('@/lib/aiBudget')
    h.killSwitch = true
    await checkAiBudget()

    h.throwOnRead = true
    afterCacheExpiry()
    await checkAiBudget()

    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('killSwitch=true')
  })

  it('caches, so a failing read is retried once a minute and not once a call', async () => {
    const { checkAiBudget } = await import('@/lib/aiBudget')
    h.throwOnRead = true
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await checkAiBudget()
    await checkAiBudget()
    await checkAiBudget()
    expect(h.reads).toBe(1)

    afterCacheExpiry()
    await checkAiBudget()
    expect(h.reads).toBe(2)
  })

  it('lets the env panic flag stop everything without consulting Firestore', async () => {
    const { checkAiBudget } = await import('@/lib/aiBudget')
    process.env.AI_KILL_SWITCH = 'true'
    expect((await checkAiBudget({ exempt: true })).stopped).toBe(true)
    expect(h.reads).toBe(0)
  })

  it('allows when the admin SDK is not configured at all', async () => {
    const { checkAiBudget } = await import('@/lib/aiBudget')
    h.noDb = true
    expect((await checkAiBudget()).stopped).toBe(false)
  })
})
