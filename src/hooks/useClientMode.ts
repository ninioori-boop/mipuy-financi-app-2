'use client'

import { useEffect, useState } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { hasLabAccess } from '@/lib/labAccess'
import { embeddedKind } from '@/lib/isEmbedded'

// True when the app runs as a CLIENT experience: the Android in-app WebView, OR
// an installed standalone PWA belonging to a non-advisor. Pages use this to
// DECLUTTER the mobile view — hide advisor-only power actions, trim dense
// controls — so a client sees a clean, focused screen, not the desktop tool.
//
// Mirrors the layout's `embed` predicate (src/app/app/layout.tsx): embedMode OR
// (standalone && !advisor). Previously this keyed on embedMode alone, so an iOS
// PWA client got the client NAV but advisor-DENSITY pages — this closes that gap.
//
// Client-only (touches navigator / sessionStorage via embeddedKind), so it
// starts false on the server / first paint and flips after mount — guard layout
// on it, never data.
export function useClientMode(): boolean {
  const email = useAuthStore(s => s.user?.email ?? null)
  const [client, setClient] = useState(false)
  useEffect(() => {
    const kind = embeddedKind()   // 'android-app' | 'pwa' | null
    setClient(kind === 'android-app' || (kind === 'pwa' && !hasLabAccess(email)))
  }, [email])
  return client
}
