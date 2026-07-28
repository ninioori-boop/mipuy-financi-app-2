'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { getAuthHeader } from '@/lib/getAuthToken'
import { setActiveBrand } from '@/lib/activeBrand'
import {
  BRAND,
  BRAND_CSS_VARS,
  hexLuminance,
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

// Imperative refresh hook-point: consent acceptance changes the caller's
// practice mid-session, so the consent flow calls refreshBrand() right after
// resolving instead of waiting for the next full page load.
let refreshRef: (() => void) | null = null
export function refreshBrand() {
  refreshRef?.()
}

/** Convenience elements so any component (client or server) can render brand names. */
export function BrandNameHe() { return <>{useBrand().nameHe}</> }
export function BrandNameEn() { return <>{useBrand().nameEn}</> }
export function BrandWordmarkShort() { return <>{useBrand().wordmarkShort}</> }
export function BrandTagline() { return <>{useBrand().tagline}</> }

/** The firm's contact address as a mailto link (legal pages). */
export function BrandContactEmail({ subject, className }: { subject?: string; className?: string }) {
  const email = useBrand().contactEmail
  const href = subject ? `mailto:${email}?subject=${encodeURIComponent(subject)}` : `mailto:${email}`
  return <a href={href} className={className ?? 'text-gold hover:underline'}>{email}</a>
}

/** The brand mark: the firm's logo when set, else the default 🏠. */
export function BrandMark({ className }: { className?: string }) {
  const brand = useBrand()
  if (brand.logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- runtime remote URL
    return <img src={brand.logoUrl} alt={brand.nameHe} className={className ?? 'max-h-12 w-auto inline-block'} />
  }
  return <span className={className}>🏠</span>
}

const CACHE_PREFIX = 'brandCache:'

// Cache entries hold { p: practiceId, brand } (v2); older entries were the
// bare brand object — parse both, sanitize always.
function parseCache(raw: string | null): { p: string | null; brand: PracticeBrand | null } {
  if (!raw) return { p: null, brand: null }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (parsed && typeof parsed === 'object' && 'brand' in parsed) {
      return {
        p: typeof parsed.p === 'string' ? parsed.p : null,
        brand: sanitizePracticeBrand(parsed.brand),
      }
    }
    return { p: null, brand: sanitizePracticeBrand(parsed) }
  } catch {
    return { p: null, brand: null }
  }
}
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
  // Text ON the accent (buttons/badges): dark on a light accent, light on a
  // dark one — the stylesheet default assumes the gold accent.
  const fgVars = ['--primary-foreground', '--accent-foreground']
  if (hasOverrides) {
    const fg = hexLuminance(brand.colors.gold) > 0.5 ? '#0F0F0F' : '#FFFFFF'
    for (const v of fgVars) root.style.setProperty(v, fg)
  } else {
    for (const v of fgVars) root.style.removeProperty(v)
  }
  // The wordmark (firm name in headers) — its own color when the firm sets one.
  if (hasOverrides || brand.wordmarkColor) {
    root.style.setProperty('--wordmark', brand.wordmarkColor ?? brand.colors.gold)
  } else {
    root.style.removeProperty('--wordmark')
  }
}

export function BrandProvider({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user)
  // Start from what the boot script already painted (window.__BRAND_BOOT__),
  // NOT from the deployment default — otherwise hydration would overwrite the
  // pre-paint brand names with the server-rendered defaults, producing exactly
  // the flash the boot script exists to prevent.
  const [brand, setBrand] = useState<Brand>(() => {
    if (typeof window === 'undefined') return BRAND
    const boot = (window as unknown as { __BRAND_BOOT__?: unknown }).__BRAND_BOOT__
    return mergeBrand(BRAND, sanitizePracticeBrand(boot))
  })

  useEffect(() => {
    let cancelled = false

    const apply = (practice: PracticeBrand | null, practiceId: string | null = null) => {
      if (cancelled) return
      const merged = mergeBrand(BRAND, practice)
      // Only inject CSS overrides when the practice actually recolors —
      // otherwise leave the stylesheet untouched.
      applyCssVars(merged, !!practice?.colors)
      setBrand(merged)
      setActiveBrand(merged)
      // Browser chrome follows the brand: tab title + the PWA manifest link
      // (so "add to home screen" installs the FIRM's app).
      document.title = practice ? merged.nameEn : BRAND.nameEn
      const link = document.querySelector('link[rel="manifest"]')
      if (link) {
        link.setAttribute('href', practice && practiceId
          ? `/manifest.webmanifest?b=${encodeURIComponent(practiceId)}`
          : '/manifest.webmanifest')
      }
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
            if (!res.ok || cancelled) return
            const data = (await res.json()) as { brand?: unknown }
            if (cancelled) return
            const practice = sanitizePracticeBrand(data.brand)
            if (practice) {
              try { localStorage.setItem(LAST_KEY, JSON.stringify({ p: pid, brand: practice })) } catch { /* ignore */ }
            }
            apply(practice, pid)
          } catch { /* offline — default stays */ }
        })()
      } else {
        const last = parseCache((() => { try { return localStorage.getItem(LAST_KEY) } catch { return null } })())
        apply(last.brand, last.p)
      }
      return () => { cancelled = true }
    }

    // The uid is captured NOW — the awaits below may resolve after a user
    // switch, and cache writes must never land under another user's key.
    const uid = user.uid

    // 1. Cached brand first — no flash for returning users; an ABSENT cache
    // must reset to the default so a previous user's brand can't carry over.
    {
      const cached = parseCache((() => { try { return localStorage.getItem(CACHE_PREFIX + uid) } catch { return null } })())
      apply(cached.brand, cached.p)
    }

    // 2. Fresh lookup — also re-run via refreshBrand() after consent changes.
    const fetchAuthedBrand = async () => {
      try {
        const res = await fetch('/api/brand', {
          headers: { Authorization: await getAuthHeader() },
        })
        if (cancelled) return
        if (!res.ok) {
          // Definitive "no brand for you" answers reset; transient errors keep
          // whatever is already applied (cache or default).
          if (res.status === 401 || res.status === 503) apply(null)
          return
        }
        const data = (await res.json()) as { brand?: unknown; practiceId?: unknown }
        if (cancelled) return
        const practice = sanitizePracticeBrand(data.brand)
        const pid = typeof data.practiceId === 'string' ? data.practiceId : null
        try {
          if (practice) {
            const entry = JSON.stringify({ p: pid, brand: practice })
            localStorage.setItem(CACHE_PREFIX + uid, entry)
            localStorage.setItem(LAST_KEY, entry)
          } else {
            localStorage.removeItem(CACHE_PREFIX + uid)
            localStorage.removeItem(LAST_KEY)
          }
        } catch { /* storage full — branding still applies this session */ }
        apply(practice, pid)
      } catch { /* offline — cached/default brand stays */ }
    }
    refreshRef = fetchAuthedBrand
    fetchAuthedBrand()

    return () => { cancelled = true; refreshRef = null }
  }, [user])

  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>
}
