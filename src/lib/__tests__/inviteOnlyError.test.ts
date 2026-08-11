import { describe, it, expect } from 'vitest'
import { inviteOnlyMessage, INVITE_ONLY_MARKER, INVITE_ONLY_MESSAGE } from '../inviteOnlyError'

/** The shape the Firebase client SDK actually throws for a blocking-function denial. */
const blockingError = (serverText: string) =>
  Object.assign(new Error(`Firebase: ${serverText} (auth/internal-error).`), {
    code: 'auth/internal-error',
  })

describe('inviteOnlyMessage', () => {
  it('recognises the marker our gate sends', () => {
    expect(inviteOnlyMessage(blockingError(`${INVITE_ONLY_MARKER}: not on the allowlist`)))
      .toBe(INVITE_ONLY_MESSAGE)
  })

  it('survives the JSON wrapping Identity Platform adds', () => {
    // Hebrew comes back \u-escaped, which is exactly why we match on ASCII.
    const wrapped = 'HTTP Cloud Function returned an error: {"error":{"message":' +
      `"${INVITE_ONLY_MARKER}: \\u05d4\\u05e8\\u05e9\\u05de\\u05d4","status":"PERMISSION_DENIED"}}`
    expect(inviteOnlyMessage(blockingError(wrapped))).toBe(INVITE_ONLY_MESSAGE)
  })

  it('also catches a bare BLOCKING_FUNCTION response with no marker', () => {
    expect(inviteOnlyMessage(blockingError('BLOCKING_FUNCTION_ERROR_RESPONSE')))
      .toBe(INVITE_ONLY_MESSAGE)
  })

  it('stays out of the way of every other auth error', () => {
    for (const code of ['auth/wrong-password', 'auth/invalid-email', 'auth/network-request-failed']) {
      expect(inviteOnlyMessage(Object.assign(new Error('x'), { code }))).toBeNull()
    }
  })

  it('does not claim a generic internal error', () => {
    // A real internal error must keep saying "try again" — retrying CAN help there.
    expect(inviteOnlyMessage(blockingError('something else went wrong'))).toBeNull()
  })

  it('is safe on junk input', () => {
    for (const junk of [null, undefined, 'string', 42, {}, { code: 'auth/internal-error' }]) {
      expect(inviteOnlyMessage(junk)).toBeNull()
    }
  })
})
