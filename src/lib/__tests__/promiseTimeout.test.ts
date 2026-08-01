import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { raceWithTimeout, TIMED_OUT } from '../promiseTimeout'

/**
 * Guards the deadline that keeps ConsentGate from stranding a signed-in user on
 * "טוען…". That gate renders above the entire app, so a Firestore read that
 * never settles used to leave the only escape as a manual reload the user has
 * no reason to guess at.
 */
describe('raceWithTimeout', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('resolves with the value when the promise settles in time', async () => {
    await expect(raceWithTimeout(Promise.resolve('ok'), 8000)).resolves.toBe('ok')
  })

  // THE production case: a request that neither resolves nor rejects.
  it('resolves with TIMED_OUT when the promise never settles', async () => {
    const stranded = new Promise<string>(() => { /* never settles */ })
    const raced = raceWithTimeout(stranded, 8000)
    await vi.advanceTimersByTimeAsync(8000)
    await expect(raced).resolves.toBe(TIMED_OUT)
  })

  it('does not give up before the deadline', async () => {
    const stranded = new Promise<string>(() => { /* never settles */ })
    let settled = false
    raceWithTimeout(stranded, 8000).then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(7999)
    expect(settled).toBe(false)
  })

  // A read that FAILS must behave exactly as it did before the deadline
  // existed, so ConsentGate's own catch keeps handling it.
  it('propagates rejection instead of swallowing it', async () => {
    await expect(raceWithTimeout(Promise.reject(new Error('boom')), 8000)).rejects.toThrow('boom')
  })

  it('leaves no pending timer once the promise wins the race', async () => {
    await raceWithTimeout(Promise.resolve(1), 8000)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('leaves no pending timer when the promise rejects', async () => {
    await expect(raceWithTimeout(Promise.reject(new Error('x')), 8000)).rejects.toThrow()
    expect(vi.getTimerCount()).toBe(0)
  })
})
