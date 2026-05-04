'use client'

import { create } from 'zustand'

export type SyncStatus = 'idle' | 'loading' | 'saving' | 'saved' | 'error' | 'offline'

interface SyncState {
  status:        SyncStatus
  lastSavedAt:   number | null   // epoch ms
  hydrated:      boolean         // true once initial load from Firestore completed
  errorMessage:  string | null

  setStatus:     (s: SyncStatus, err?: string | null) => void
  setHydrated:   (h: boolean) => void
  markSaved:     () => void
}

export const useSyncStore = create<SyncState>((set) => ({
  status:       'idle',
  lastSavedAt:  null,
  hydrated:     false,
  errorMessage: null,

  setStatus: (status, err = null) =>
    set({ status, errorMessage: status === 'error' ? err : null }),

  setHydrated: (hydrated) => set({ hydrated }),

  markSaved: () =>
    set({ status: 'saved', lastSavedAt: Date.now(), errorMessage: null }),
}))
