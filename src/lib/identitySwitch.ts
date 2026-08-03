/**
 * Does the in-memory state belong to a DIFFERENT person than the one now signed
 * in — meaning it must be torn down before anything is loaded or saved?
 *
 * The gap this closes:
 *
 * DataSync's auth effect has two branches. The `!user` (sign-out) branch does a
 * full teardown: cancel pending saves, clear every store, drop `hydrated`, reset
 * the saved-snapshot markers and the anti-clobber baselines. The signed-in branch
 * resets only the anti-clobber and live-sync REFS — its comment claims it "covers
 * direct userA→userB switches that never pass through the null branch", but it
 * leaves `hydrated` true, leaves the previous person's data in the stores, and
 * leaves `lastSavedJson` / the baselines pointing at their document.
 *
 * That path is reachable. DataSync is mounted in the root layout, `/connect` is a
 * public route that stays mounted through the whole auth transition, and both its
 * sign-in calls — and `signInWithCustomToken` on `/connect/expenses` — sign a new
 * user in WITHOUT signing the previous one out. Firebase then emits user B
 * directly, with no null in between.
 *
 * Consequence when it fires: the app is still hydrated with person A's portfolio,
 * so the 500ms local-backup timer mirrors A's snapshot into B's backup key, and
 * the 2s debounced save writes A's portfolio into B's Firestore document. If the
 * load then fails, `hydrated` was never cleared, so the blocking error overlay
 * does not render either and B keeps browsing A's data.
 *
 * Deliberately keyed on the AUTH uid only. Entering advisor view/edit-as-client
 * does not change the auth user (saves are redirected by target, and that path
 * does its own reset), so impersonation must not trip this.
 */
export function needsIdentityTeardown(opts: {
  /** The uid whose data is currently hydrated in memory, or '' if none. */
  hydratedUid: string
  /** The uid that just signed in. */
  incomingUid: string
}): boolean {
  const { hydratedUid, incomingUid } = opts
  // Nothing hydrated yet (first sign-in of the session, or post-teardown): the
  // stores are already empty and `hydrated` is already false. Tearing down here
  // would be harmless but pointless — and returning true would make the very
  // first load of every session do redundant work.
  if (!hydratedUid) return false
  // No incoming uid means sign-out, which the dedicated branch handles.
  if (!incomingUid) return false
  return hydratedUid !== incomingUid
}
