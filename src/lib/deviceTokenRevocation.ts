import { getAdminDb } from './firebaseAdmin'

// Per-user device-token revocation, backed by an additive admin-only collection
// `deviceTokens/{uid}` → { minVersion: number }. Lets the advisor revoke ONE
// user's token (stolen phone) by bumping that user's minVersion, instead of
// rotating the global TRANSACTION_SECRET (which kills every user's token).
//
// `verifyDeviceToken` checks the HMAC; this checks the version. Kept separate so
// the token verify stays pure/sync. Deploy-dark + fail-open: with no version doc
// (or admin SDK unconfigured / Firestore error) tokens are accepted — i.e. exactly
// today's behavior — since the HMAC is already verified; this avoids false
// lockouts. Revocation is opt-in per user, the moment a minVersion doc is written.

const COLLECTION = 'deviceTokens'

/** True only when a minVersion doc exists for the uid AND the token is below it. */
export async function isDeviceTokenRevoked(uid: string, version: number): Promise<boolean> {
  const db = getAdminDb()
  if (!db) return false
  try {
    const snap = await db.collection(COLLECTION).doc(uid).get()
    if (!snap.exists) return false
    const minVersion = Number(snap.data()?.minVersion ?? 0)
    return version < minVersion
  } catch {
    return false
  }
}

/** The version a freshly-issued token for this uid should carry (default 0). */
export async function getCurrentTokenVersion(uid: string): Promise<number> {
  const db = getAdminDb()
  if (!db) return 0
  try {
    const snap = await db.collection(COLLECTION).doc(uid).get()
    return snap.exists ? Number(snap.data()?.minVersion ?? 0) : 0
  } catch {
    return 0
  }
}
