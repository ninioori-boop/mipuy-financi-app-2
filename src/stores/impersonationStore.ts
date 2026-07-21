import { create } from 'zustand'

// Advisor "view as client" session state. DELIBERATELY not persisted and NOT
// part of the dataSync Snapshot: it exists only in memory for the current tab.
// While `client` is set, DataSync hard-blocks every save path (Firestore save,
// localStorage backup, tab-close beacon) and the inbox/recurring hooks pause —
// the advisor is looking at the client's data through their own session, and
// nothing they see or touch may be written anywhere.

export interface ImpersonatedClient {
  uid:   string
  name:  string
  email: string
}

interface ImpersonationState {
  client: ImpersonatedClient | null
  start: (client: ImpersonatedClient) => void
  stop:  () => void
}

export const useImpersonationStore = create<ImpersonationState>(set => ({
  client: null,
  start: client => set({ client }),
  stop:  () => set({ client: null }),
}))
