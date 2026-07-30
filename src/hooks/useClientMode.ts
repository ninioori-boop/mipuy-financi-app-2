'use client'

import { useEffect, useState } from 'react'
import { useLabAccess } from '@/hooks/useLabAccess'
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
  const { allowed: isAdvisor, ready } = useLabAccess()
  const [client, setClient] = useState(false)
  useEffect(() => {
    const kind = embeddedKind()   // 'android-app' | 'pwa' | null
    // The Android WebView is always a client, whoever is signed in.
    if (kind === 'android-app') { setClient(true); return }
    // A standalone PWA is client mode unless the user is a known advisor.
    // While the role is still unknown we assume CLIENT: the app has many
    // clients and a handful of advisors, and the layout shell already commits
    // to the client chrome immediately — so this keeps chrome and page density
    // consistent, and an advisor's own PWA simply expands once the role lands.
    if (kind === 'pwa') { setClient(!(ready && isAdvisor)); return }
    if (kind === null) setClient(false)
  }, [isAdvisor, ready])
  return client
}
