/**
 * Brand configuration — the single source of truth for every place the product
 * names itself, addresses users, or paints outside the CSS token system.
 *
 * White-label: add an entry to BRANDS and set NEXT_PUBLIC_BRAND_ID at build
 * time (one Vercel project per licensee). The CSS design tokens live in
 * globals.css; `colors` here mirrors them for JS-only consumers (Recharts
 * props, react-pdf styles, the PWA manifest) that cannot read Tailwind classes.
 *
 * Server-side mirror for outbound email: functions/brand.js — keep in sync
 * until per-practice mail identity lands.
 */

export interface Brand {
  id: string
  /** Product name in Hebrew UI copy (nav, greetings, legal pages). */
  nameHe: string
  /** Latin wordmark (auth screen, PDF headers, document author). */
  nameEn: string
  /** Ultra-short wordmark for narrow screens (app header on mobile). */
  wordmarkShort: string
  /** Home-screen / PWA short name. */
  appShortName: string
  /** One-line descriptor used in metadata and the auth screen. */
  tagline: string
  /** PWA manifest long description. */
  manifestDescription: string
  /** Deployed app origin, no trailing slash. */
  appUrl: string
  /** Contact address for legal pages, deletion requests and web-push VAPID. */
  contactEmail: string
  /** Android companion-app package name (delete-account page). */
  androidPackage: string
  /**
   * Brand palette for JS-side consumers. Mirrors the CSS tokens in
   * globals.css (@theme inline / .dark) — change both together.
   */
  colors: {
    gold: string
    goldLight: string
    goldDark: string
    surface: string
    surface2: string
    surface3: string
    line: string
    txt: string
    mutedTxt: string
    income: string
    expense: string
  }
  logo: {
    icon192: string
    icon512: string
    appleTouch: string
  }
  /** Optional firm logo (https URL) — rendered where the default brand shows its mark. */
  logoUrl?: string
  /** Optional wordmark color — how the firm's NAME is painted in headers
   *  (defaults to the accent). Lets a logo-like lettering differ from buttons. */
  wordmarkColor?: string
}

const BRANDS: Record<string, Brand> = {
  orimipuy: {
    id: 'orimipuy',
    nameHe: 'הכלכלן של הבית',
    nameEn: 'The Home Economist',
    wordmarkShort: 'THE',
    appShortName: 'מעקב הוצאות',
    tagline: 'מיפוי פיננסי חכם',
    manifestDescription:
      'רישום הוצאות אוטומטי, תקציב, יעדים ומגמות — ניהול פיננסי במקום אחד.',
    appUrl: 'https://app.orimipuy.com',
    contactEmail: 'ninioori@gmail.com',
    androidPackage: 'com.orimipuy.tracker',
    colors: {
      gold: '#C9A86C',
      goldLight: '#E0C896',
      goldDark: '#A88844',
      surface: '#0F0F0F',
      surface2: '#1A1A1A',
      surface3: '#242424',
      line: '#2A2A2A',
      txt: '#F0EDEA',
      mutedTxt: '#8A8178',
      income: '#4ADE80',
      expense: '#F87171',
    },
    logo: {
      icon192: '/icon-192.png',
      icon512: '/icon-512.png',
      appleTouch: '/apple-touch-icon.png',
    },
  },
}

const activeId = process.env.NEXT_PUBLIC_BRAND_ID?.trim() || 'orimipuy'

/** The active brand. Resolved once at build time from NEXT_PUBLIC_BRAND_ID. */
export const BRAND: Brand = BRANDS[activeId] ?? BRANDS.orimipuy

/** Bare domain of the app (e.g. shown in advisor instructions). */
export const BRAND_DOMAIN = BRAND.appUrl.replace(/^https?:\/\//, '')

/**
 * Per-practice brand override — the "directions" strategy: every licensed firm
 * (practice) carries its own branding, stored at practices/{practiceId}.brand
 * and resolved after login via /api/brand. Everything is optional; whatever a
 * firm doesn't set falls back to the deployment default above.
 */
export interface PracticeBrand {
  nameHe?: string
  nameEn?: string
  wordmarkShort?: string
  tagline?: string
  logoUrl?: string
  contactEmail?: string
  wordmarkColor?: string
  /** Short link slug (/go/{slug} → the firm's branded login). Lowercase a-z0-9-. */
  slug?: string
  colors?: Partial<Brand['colors']>
}

/** Keys a PracticeBrand may carry — used to sanitize DB data before use. */
export const PRACTICE_BRAND_STRING_KEYS = [
  'nameHe', 'nameEn', 'wordmarkShort', 'tagline', 'logoUrl', 'contactEmail', 'wordmarkColor', 'slug',
] as const

export const PRACTICE_BRAND_COLOR_KEYS = [
  'gold', 'goldLight', 'goldDark', 'surface', 'surface2', 'surface3',
  'line', 'txt', 'mutedTxt', 'income', 'expense',
] as const

// Only CSS-valid hex lengths (3/4/6/8) — a 5- or 7-digit value would be
// rejected by the CSSOM and silently leave a previous brand's var in place.
const HEX_RE = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

/** Drop unknown keys / non-string values / non-hex colors from raw DB data. */
export function sanitizePracticeBrand(raw: unknown): PracticeBrand | null {
  if (!raw || typeof raw !== 'object') return null
  const src = raw as Record<string, unknown>
  const out: PracticeBrand = {}
  for (const k of PRACTICE_BRAND_STRING_KEYS) {
    const v = src[k]
    if (typeof v !== 'string' || !v.trim()) continue
    // logoUrl feeds <img src> / notification icons — https URLs only.
    if (k === 'logoUrl') {
      try {
        if (new URL(v.trim()).protocol !== 'https:') continue
      } catch { continue }
    }
    // wordmarkColor feeds a CSS var — hex only, like the palette.
    if (k === 'wordmarkColor' && !HEX_RE.test(v.trim())) continue
    // slug feeds a URL path segment — strict shape.
    if (k === 'slug' && !/^[a-z0-9-]{2,32}$/.test(v.trim())) continue
    out[k] = v.trim()
  }
  if (src.colors && typeof src.colors === 'object') {
    const colors: Partial<Brand['colors']> = {}
    for (const k of PRACTICE_BRAND_COLOR_KEYS) {
      const v = (src.colors as Record<string, unknown>)[k]
      if (typeof v === 'string' && HEX_RE.test(v.trim())) colors[k] = v.trim()
    }
    if (Object.keys(colors).length) out.colors = colors
  }
  return Object.keys(out).length ? out : null
}

/** The default brand with a practice's overrides layered on top. */
export function mergeBrand(base: Brand, practice: PracticeBrand | null | undefined): Brand {
  if (!practice) return base
  const colors = { ...base.colors, ...practice.colors }
  // Readability derive: on a LIGHT practice surface the dark-theme
  // income/expense defaults (#4ADE80/#F87171) are unreadable — swap in the
  // print-tuned dark variants unless the practice chose its own.
  if (practice.colors?.surface && hexLuminance(practice.colors.surface) > 0.45) {
    if (!practice.colors.income)  colors.income  = '#138E4F'
    if (!practice.colors.expense) colors.expense = '#B53C3C'
  }
  return {
    ...base,
    nameHe: practice.nameHe ?? base.nameHe,
    // A Hebrew-only practice must NEVER fall back to the vendor's Latin name —
    // its own Hebrew name is the wordmark everywhere.
    nameEn: practice.nameEn ?? practice.nameHe ?? base.nameEn,
    wordmarkShort:
      practice.wordmarkShort
      ?? (practice.nameEn ?? practice.nameHe)?.slice(0, 12)
      ?? base.wordmarkShort,
    tagline: practice.tagline ?? base.tagline,
    contactEmail: practice.contactEmail ?? base.contactEmail,
    logoUrl: practice.logoUrl ?? base.logoUrl,
    wordmarkColor: practice.wordmarkColor ?? base.wordmarkColor,
    colors,
  }
}

/**
 * Which CSS custom properties each brand color drives (globals.css :root/.dark).
 * Inline styles on <html> override both theme blocks, so applying these
 * re-skins every screen that uses the Tailwind tokens — i.e. all of them.
 */
/** Rough relative luminance (0..1) of a #hex color (3/4/6/8-digit forms). */
export function hexLuminance(hex: string): number {
  const h = hex.replace('#', '')
  const full = h.length <= 4
    ? h.slice(0, 3).split('').map((c) => c + c).join('')
    : h.slice(0, 6)
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * Accent for white-background media (PDF, email): a very light UI accent
 * (e.g. white) would vanish on paper, so fall through the palette to the
 * first color dark enough to read on white.
 */
export function pickPrintAccent(colors: Brand['colors']): string {
  // gold first — it is the color the firm actually chose; goldDark is usually
  // just the inherited default. Order matches the email's pickEmailAccent.
  for (const c of [colors.gold, colors.goldDark, colors.surface]) {
    if (hexLuminance(c) < 0.72) return c
  }
  return BRANDS.orimipuy.colors.goldDark
}

export const BRAND_CSS_VARS: Record<keyof Brand['colors'], string[]> = {
  gold:      ['--gold', '--primary', '--accent', '--ring'],
  goldLight: ['--gold-light'],
  goldDark:  ['--gold-dark'],
  surface:   ['--surface', '--background'],
  surface2:  ['--surface2', '--card', '--popover'],
  surface3:  ['--surface3', '--secondary', '--muted'],
  line:      ['--line', '--border', '--input'],
  txt:       ['--txt', '--foreground', '--card-foreground', '--popover-foreground', '--secondary-foreground'],
  mutedTxt:  ['--muted-txt', '--muted-foreground'],
  income:    ['--income'],
  expense:   ['--expense'],
}
