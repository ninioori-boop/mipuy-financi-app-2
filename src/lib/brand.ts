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
