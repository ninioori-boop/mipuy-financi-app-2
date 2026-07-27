'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { getAuthHeader } from '@/lib/getAuthToken'
import { setActiveBrand } from '@/lib/activeBrand'
import {
  BRAND,
  BRAND_CSS_VARS,
  mergeBrand,
  sanitizePracticeBrand,
  type Brand,
  type PracticeBrand,
} from '@/lib/brand'

// Runtime branding ("directions" strategy): after login we resolve the user's
// practice brand via /api/brand and re-skin the whole app — CSS custom
// properties cover every token-based screen at once, the context covers the
// few spots that render the brand NAME. Users without a practice brand keep
// the deployment default, byte-for-byte.
//
// The last-seen brand is cached per uid in localStorage and applied
// synchronously on mount, so returning users don't see a default-brand flash.

const BrandContext = createContext<Brand>(BRAND)

export function useBrand(): Brand {
  return useContext(BrandContext)
}

/** Convenience elements so any component (client or server) can render brand names. */
export function BrandNameHe() { return <>{useBrand().nameHe}</> }
export function BrandNameEn() { return <>{useBrand().nameEn}</> }
export function BrandWordmarkShort() { return <>{useBrand().wordmarkShort}</> }
export function BrandTagline() { return <>{useBrand().tagline}</> }

const CACHE_PREFIX = 'brandCache:'
// Device-level "last seen brand" — keeps the LOGIN page in the firm's brand:
// set when an invite link (?b=practiceId) or a practice member's login resolves
// a brand, cleared when a default-brand user signs in.
const LAST_KEY = 'brandCache:last'

function applyCssVars(brand: Brand, hasOverrides: boolean) {
  const root = document.documentElement
  for (const [key, vars] of Object.entries(BRAND_CSS_VARS)) {
    const value = brand.colors[key as keyof Brand['colors']]
    for (const v of vars) {
      if (hasOverrides) root.style.setProperty(v, value)
      else root.style.removeProperty(v)
    }
  }
}

export function BrandProvider({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user)
  const [brand, setBrand] = useState<Brand>(BRAND)

  useEffect(() => {
    let cancelled = false

    const apply = (practice: PracticeBrand | null) => {
      if (cancelled) return
      const merged = mergeBrand(BRAND, practice)
      // Only inject CSS overrides when the practice actually recolors —
      // otherwise leave the stylesheet untouched.
      applyCssVars(merged, !!practice?.colors)
      setBrand(merged)
      setActiveBrand(merged)
    }

    if (!user) {
      // Pre-login: an invite link's ?b=practiceId wins; otherwise the device's
      // last-seen brand keeps the login page in the firm's look.
      let pid: string | null = null
      try { pid = new URLSearchParams(window.location.search).get('b') } catch { /* SSR-safe */ }
      if (pid) {
        ;(async () => {
          try {
            const res = await fetch(`/api/brand?practiceId=${encodeURIComponent(pid)}`)
            if (!res.ok) return
            const data = (await res.json()) as { brand?: unknown }
            const practice = sanitizePracticeBrand(data.brand)
            if (practice) {
              try { localStorage.setItem(LAST_KEY, JSON.stringify(practice)) } catch { /* ignore */ }
            }
            apply(practice)
          } catch { /* offline — default stays */ }
        })()
      } else {
        try {
          const last = localStorage.getItem(LAST_KEY)
          apply(last ? sanitizePracticeBrand(JSON.parse(last)) : null)
        } catch { apply(null) }
      }
      return () => { cancelled = true }
    }

    // 1. Cached brand first — no flash for returning users.
    try {
      const cached = localStorage.getItem(CACHE_PREFIX + user.uid)
      if (cached) apply(sanitizePracticeBrand(JSON.parse(cached)))
    } catch { /* corrupt cache — ignore */ }

    // 2. Fresh lookup.
    ;(async () => {
      try {
        const res = await fetch('/api/brand', {
          headers: { Authorization: await getAuthHeader() },
        })
        if (!res.ok) return
        const data = (await res.json()) as { brand?: unknown }
        const practice = sanitizePracticeBrand(data.brand)
        try {
          if (practice) {
            localStorage.setItem(CACHE_PREFIX + user.uid, JSON.stringify(practice))
            localStorage.setItem(LAST_KEY, JSON.stringify(practice))
          } else {
            localStorage.removeItem(CACHE_PREFIX + user.uid)
            localStorage.removeItem(LAST_KEY)
          }
        } catch { /* storage full — branding still applies this session */ }
        apply(practice)
      } catch { /* offline — cached/default brand stays */ }
    })()

    return () => { cancelled = true }
  }, [user])

  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>
}
