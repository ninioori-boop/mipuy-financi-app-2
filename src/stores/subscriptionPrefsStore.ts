'use client'

import { create } from 'zustand'

// Why a detected subscription was removed from the active list:
//   'cancelled' — a real subscription the client stopped paying
//   'not-sub'   — a false positive; never treat this merchant as a subscription
export type DismissReason = 'cancelled' | 'not-sub'

export interface DismissedSub {
  reason: DismissReason
  name:   string        // display name kept so the "hidden" list reads nicely
}

interface SubscriptionPrefsState {
  // Keyed by the normalized merchant key (same key detectSubscriptions groups on).
  dismissed: Record<string, DismissedSub>
  dismiss: (key: string, name: string, reason: DismissReason) => void
  restore: (key: string) => void
}

export const useSubscriptionPrefsStore = create<SubscriptionPrefsState>((set) => ({
  dismissed: {},

  dismiss: (key, name, reason) =>
    set(s => ({ dismissed: { ...s.dismissed, [key]: { reason, name } } })),

  restore: (key) =>
    set(s => {
      const next = { ...s.dismissed }
      delete next[key]
      return { dismissed: next }
    }),
}))
