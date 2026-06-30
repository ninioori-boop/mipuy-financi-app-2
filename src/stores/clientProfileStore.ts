'use client'

import { create } from 'zustand'

// Tiny per-user profile flags for the in-app (mobile/embed) client view.
// `hasBusiness` is null until the client answers the one-time "יש לך עסק?"
// question; it gates the business tabs in the client-mode nav. Persisted via
// dataSync so the answer follows the user across devices (and the web knows it).
interface ClientProfileState {
  hasBusiness: boolean | null
  setHasBusiness: (v: boolean) => void
}

export const useClientProfileStore = create<ClientProfileState>((set) => ({
  hasBusiness: null,
  setHasBusiness: (v) => set({ hasBusiness: v }),
}))
