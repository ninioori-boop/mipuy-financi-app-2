import { getAdminDb, getAdminAuth } from '@/lib/firebaseAdmin'

/**
 * Is this session an INVITED account? `true` / `false` / **`null` when the
 * question could not be answered at all** (admin SDK missing, Firestore threw).
 *
 * The three-way answer is the whole point. The AI routes verify a token, a
 * tombstone, a rate limit and a quota, but never asked whether the account was
 * ever invited — and they spend real money per call. Until 2026-08-11 the only
 * gate in front of them was `gateSignup`, which turned out to have never run
 * once (blocking functions need GCIP, which this project is not on), so a
 * stranger who signed up could burn the Anthropic budget at automap 3/day +
 * analyze 2/day + categorize 50/hour, every fresh account a fresh set of
 * counters.
 *
 * `firestore.rules` re-check the allowlist on the client-facing data paths
 * (users/**, sections, versions, intake, shared/learnedDB), which is why an
 * uninvited account sees nothing. `/api/save-snapshot` — the one admin-SDK write
 * that rules do not cover — enforces it too since 2026-08-17, but through
 * `invitedStatus` rather than `isInvited`: it is the tab-close flush for every
 * client's portfolio, so it refuses only an explicit `false` and lets a `null`
 * through. See the comment on that route for why the direction is inverted.
 *
 * Same bar `/api/learn` already applies, and the same reason: /revoke removes
 * the allowlist entry and deliberately leaves the account alive.
 */
export async function invitedStatus(uid: string, tokenEmail?: string | null): Promise<boolean | null> {
  const db = getAdminDb()
  if (!db) return null

  try {
    let email = tokenEmail?.toLowerCase().trim()

    // A custom-token session (the Android WebView bridge signs in with one)
    // is not guaranteed to carry an `email` claim. Resolve it from the account
    // record rather than denying a legitimate phone user.
    if (!email) {
      const adminAuth = getAdminAuth()
      if (!adminAuth) return null
      email = (await adminAuth.getUser(uid)).email?.toLowerCase().trim()
    }
    // A session with no address anywhere cannot be matched to an invitation.
    // That is an answer, not a failure.
    if (!email) return false

    return (await db.collection('allowlist').doc(email).get()).exists
  } catch {
    return null
  }
}

/**
 * FAIL-CLOSED form, for the paid AI routes: an unverifiable authorization check
 * is not a pass.
 *
 * Do NOT use this to decide what to show a signed-in person. Collapsing `null`
 * into `false` there would turn one bad env var into "the app tells all ~40
 * paying clients they were never invited", with a sign-out button as the only
 * way forward. That is why the UI path consumes `invitedStatus` directly and
 * treats `null` as "carry on".
 */
export async function isInvited(uid: string, tokenEmail?: string | null): Promise<boolean> {
  return (await invitedStatus(uid, tokenEmail)) === true
}

/** The message an uninvited caller sees. Same wording as the sign-in gate. */
export const NOT_INVITED_MESSAGE =
  'החשבון הזה אינו מורשה לשימוש במערכת. ודאו שנכנסתם עם הכתובת שקיבלה את ההזמנה, או פנו ליועץ.'
