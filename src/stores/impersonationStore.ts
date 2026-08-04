import { create } from 'zustand'

// Advisor "act as client" session state. DELIBERATELY not persisted and NOT
// part of the dataSync Snapshot: it exists only in memory for the current tab.
//
// Two modes:
//  - 'view'  → read-only. DataSync HARD-BLOCKS every save path.
//  - 'edit'  → the advisor edits the client's data. DataSync REDIRECTS saves to
//              the CLIENT's uid (never the advisor's own), and only in this mode.
// While `client` is set the inbox/recurring hooks pause in BOTH modes.

export interface ImpersonatedClient {
  uid:   string
  name:  string
  email: string
}

interface ImpersonationState {
  client: ImpersonatedClient | null
  mode:   'view' | 'edit'
  /** The client doc's `updatedAt` (epoch ms) at entry — baseline for the
   *  concurrent-edit warning in edit mode. */
  clientUpdatedAt: number
  /** Entry timestamp — lets DataSync ignore the programmatic store changes of
   *  the entry itself (reset + applySnapshot) when deciding warnings/saves. */
  startedAt: number
  start: (client: ImpersonatedClient, mode: 'view' | 'edit', clientUpdatedAt?: number) => void
  // There is deliberately NO general stop(): the only safe exit from
  // act-as-client is a full page navigation (window.location.assign), which
  // wipes this in-memory store while the DataSync guards stay up through the
  // unload. Clearing the flag in-place would let the pagehide flush persist the
  // client's data into the advisor's account (real bug caught 2026-07-21) — and
  // in edit mode it would flush with the advisor's token/uid.
  //
  // The ONE exception is below, and it is named after the only place allowed to
  // call it.
  /** TEARDOWN-ONLY — never a user-facing exit. Clears the act-as-client flag
   *  at an IDENTITY BOUNDARY: DataSync's sign-out branch and its userA→userB
   *  teardown branch. Without this the flag outlives a sign-out, and when the
   *  advisor signs back in, saveTarget() redirects their OWN portfolio into
   *  the CLIENT's document (the security rules permit that write). It is safe
   *  there and ONLY there because both branches run after resetAllStores() —
   *  the stores are already empty, so no flush has anything left to leak —
   *  and after React has detached the previous session's save/pagehide
   *  effects. Everywhere else the full-reload rule above stands. */
  clearOnIdentityTeardown: () => void
}

export const useImpersonationStore = create<ImpersonationState>(set => ({
  client: null,
  mode: 'view',
  clientUpdatedAt: 0,
  startedAt: 0,
  start: (client, mode, clientUpdatedAt = 0) =>
    set({ client, mode, clientUpdatedAt, startedAt: Date.now() }),
  clearOnIdentityTeardown: () =>
    set({ client: null, mode: 'view', clientUpdatedAt: 0, startedAt: 0 }),
}))
