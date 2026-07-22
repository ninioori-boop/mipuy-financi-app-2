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
  // There is deliberately NO stop(): the only safe exit from act-as-client is a
  // full page navigation (window.location.assign), which wipes this in-memory
  // store while the DataSync guards stay up through the unload. Clearing the
  // flag in-place would let the pagehide flush persist the client's data into
  // the advisor's account (real bug caught 2026-07-21) — and in edit mode it
  // would flush with the advisor's token/uid. Full reload is the only exit.
}

export const useImpersonationStore = create<ImpersonationState>(set => ({
  client: null,
  mode: 'view',
  clientUpdatedAt: 0,
  startedAt: 0,
  start: (client, mode, clientUpdatedAt = 0) =>
    set({ client, mode, clientUpdatedAt, startedAt: Date.now() }),
}))
