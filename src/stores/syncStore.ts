'use client'

import { create } from 'zustand'

export type SyncStatus = 'idle' | 'loading' | 'saving' | 'saved' | 'error' | 'offline'

interface SyncState {
  status:        SyncStatus
  lastSavedAt:   number | null   // epoch ms
  hydrated:      boolean         // true once initial load from Firestore completed
  errorMessage:  string | null
  // True when the live in-memory snapshot differs from the last successfully
  // saved snapshot. Kept orthogonal to `status` so an error/offline banner
  // and a "there are unsaved changes" pill can co-exist.
  isDirty:       boolean
  // Live sync: the last write we saw on the document from SOMEONE ELSE
  // (another device, the advisor, the client). Derived purely from writes —
  // there is no presence heartbeat and no extra Firestore traffic.
  // `at` is the SERVER timestamp of that write; `seenAt` is our local clock
  // when it arrived. UI compares against lastSavedAt (also local), so it must
  // use seenAt — mixing the two hides the signal entirely on a skewed clock.
  remoteActivity: { at: number; seenAt: number; byAdvisor: boolean } | null

  setStatus:     (s: SyncStatus, err?: string | null) => void
  setHydrated:   (h: boolean) => void
  markSaved:     () => void
  setDirty:      (d: boolean) => void
  setRemoteActivity: (a: { at: number; seenAt: number; byAdvisor: boolean } | null) => void
}

export const useSyncStore = create<SyncState>((set) => ({
  status:       'idle',
  lastSavedAt:  null,
  hydrated:     false,
  errorMessage: null,
  isDirty:      false,
  remoteActivity: null,

  setStatus: (status, err = null) =>
    set({ status, errorMessage: status === 'error' ? err : null }),

  setHydrated: (hydrated) => set({ hydrated }),

  // markSaved leaves isDirty alone — DataSync decides whether the just-saved
  // snapshot still matches the current in-memory state (it doesn't when the
  // user typed more during the save round-trip).
  markSaved: () =>
    set({ status: 'saved', lastSavedAt: Date.now(), errorMessage: null }),

  setDirty: (isDirty) => set({ isDirty }),

  setRemoteActivity: (remoteActivity) => set({ remoteActivity }),
}))
