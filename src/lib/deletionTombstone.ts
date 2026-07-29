import { getAdminDb } from './firebaseAdmin'

/**
 * Deleted-account tombstone.
 *
 * Deleting an account is not enough on its own: three server paths write with
 * the ADMIN SDK (which bypasses Firestore rules) and authenticate with
 * credentials that outlive the account —
 *   • /api/transaction     — a stateless HMAC device token that never expires,
 *                            so the phone would keep creating inbox documents
 *                            that no one can ever read or delete again;
 *   • /api/save-snapshot   — an ID token stays valid up to an hour, so a tab
 *                            closing after deletion re-creates the whole file;
 *   • /api/app-session     — mints a custom token, and signing in with one
 *                            RE-CREATES the Auth user for that uid.
 * Each of those checks this tombstone and refuses.
 *
 * The document is `deletionAudit/{uid}` — the raw uid and nothing else that
 * identifies anyone. It must OUTLIVE the deletion (that is the entire point),
 * so it is deliberately not cleaned up.
 */
export async function isAccountDeleted(uid: string): Promise<boolean> {
  if (!uid) return false
  const db = getAdminDb()
  if (!db) return false          // admin SDK unavailable: fail open, as elsewhere
  try {
    const snap = await db.collection('deletionAudit').doc(uid).get()
    return snap.exists
  } catch {
    // A transient read failure must not break live users' saves.
    return false
  }
}

/** Standard refusal for a credential that belongs to a deleted account. */
export const DELETED_ACCOUNT_RESPONSE = {
  body: { error: 'account deleted' },
  status: 410,
} as const
