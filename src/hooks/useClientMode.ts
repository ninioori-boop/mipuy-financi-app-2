'use client'

import { useEffect, useState } from 'react'

// True when running inside the Android app's client WebView (embed mode, set by
// the /connect/expenses bootstrap). Pages use this to DECLUTTER the mobile view:
// hide advisor-only noise (long explanations, power actions) and tighten spacing,
// so a client sees a clean, focused screen — not the dense desktop tool.
//
// Client-only (reads sessionStorage in an effect), so it starts false on the
// server/first paint and flips after mount — guard layout on it, never data.
export function useClientMode(): boolean {
  const [client, setClient] = useState(false)
  useEffect(() => {
    try { setClient(sessionStorage.getItem('embedMode') === '1') } catch {}
  }, [])
  return client
}
