/**
 * Turns a blocking-function rejection back into a message a human can act on.
 *
 * `gateSignup` is a `beforeUserCreated` blocking function, and the Firebase
 * client SDK does NOT surface its error code: it maps the server's
 * `BLOCKING_FUNCTION_ERROR_RESPONSE` to `auth/internal-error` and buries the
 * function's own text inside `message` (see @firebase/auth's server-error map).
 * So a `switch (err.code)` — which is what both sign-in surfaces do — lands on
 * its default branch and tells an uninvited person "שגיאה, נסו שוב".
 *
 * That default is a trap: retrying can never work, and this is the single most
 * likely error in the product now that the gate is enforced. The whole point of
 * the gate is to say "that address was not the invited one" at the moment of
 * the mistake, so the message has to reach the screen.
 *
 * Matching is on an ASCII marker, deliberately: the server text is wrapped in
 * JSON on its way through Identity Platform, and Hebrew survives that as \uXXXX
 * escapes, so a Hebrew substring match would silently stop working.
 */

/** Prefix on the HttpsError thrown by gateSignup. Must match functions/index.js. */
export const INVITE_ONLY_MARKER = 'INVITE_ONLY'

export const INVITE_ONLY_MESSAGE =
  'הכתובת הזאת לא מופיעה ברשימת המוזמנים. ודאו שזו בדיוק הכתובת שקיבלה את ההזמנה, או פנו ליועץ.'

/**
 * The invite-only message when this error is a gate rejection, else null.
 * Null means "not mine" — the caller keeps its own error mapping.
 */
export function inviteOnlyMessage(err: unknown): string | null {
  const e = err as { code?: unknown; message?: unknown }
  if (e?.code !== 'auth/internal-error') return null
  const text = typeof e.message === 'string' ? e.message : ''
  return text.includes(INVITE_ONLY_MARKER) || text.includes('BLOCKING_FUNCTION')
    ? INVITE_ONLY_MESSAGE
    : null
}
