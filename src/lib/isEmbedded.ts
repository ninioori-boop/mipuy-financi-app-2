// Detects whether we're running inside an embedded browser where Google's
// OAuth flow is BLOCKED ("disallowed_useragent", 403): the Android in-app
// WebView, or an installed standalone PWA (iOS "Add to Home Screen").
//
// Google refuses OAuth in these environments for ALL apps — popup AND redirect
// alike — so there is no code path that makes "Sign in with Google" work here.
// The correct product move is to steer the user to email+password (which works
// everywhere) instead of showing a broken button. Client-only (touches
// navigator / sessionStorage); guard every call behind a mounted check.
export type EmbeddedKind = 'android-app' | 'pwa' | null

/**
 * Which embedded context are we in?
 *  - 'android-app': our Kotlin WebView shell — can bridge Google sign-in out to
 *    the real browser via the `mipuytracker://reauth` scheme it intercepts.
 *  - 'pwa': an installed standalone PWA (iOS "Add to Home Screen" / Android PWA)
 *    — no native bridge, so Google OAuth truly can't run; use email+password.
 *  - null: a normal browser tab — Google popup works.
 */
export function embeddedKind(): EmbeddedKind {
  if (typeof window === 'undefined') return null
  try {
    const ua = navigator.userAgent || ''
    if (/;\s*wv\)|\bwv\b/.test(ua)) return 'android-app'
    if (sessionStorage.getItem('embedMode') === '1') return 'android-app'
    if (window.matchMedia?.('(display-mode: standalone)').matches) return 'pwa'
    if ((navigator as { standalone?: boolean }).standalone === true) return 'pwa'
  } catch {
    /* defensive — never let detection throw on the login screen */
  }
  return null
}

export function isEmbeddedBrowser(): boolean {
  return embeddedKind() !== null
}

/**
 * Can this shell hand a non-http link (whatsapp:, tel:, mailto:) to the app that
 * owns it? A raw WebView cannot: it dies with ERR_UNKNOWN_URL_SCHEME, which is
 * what a client hit when the WhatsApp connect button tried to reach wa.me and
 * wa.me redirected to `whatsapp://`. The Kotlin shell gained the handler in 3.18
 * and stamps `ExtSchemes/1` on its user agent to say so.
 *
 * Ask this — never the app version — before offering a link that leaves the app.
 * The web ships continuously and the installed app does not, so both builds are
 * always in the wild at once, and only the app can declare what it supports.
 * A plain browser answers true: it has always handled these schemes.
 */
export function canOpenExternalSchemes(): boolean {
  if (typeof window === 'undefined') return false
  if (embeddedKind() !== 'android-app') return true
  try {
    return /\bExtSchemes\/1\b/.test(navigator.userAgent || '')
  } catch {
    return false
  }
}
