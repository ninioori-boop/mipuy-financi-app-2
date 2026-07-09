// Detects whether we're running inside an embedded browser where Google's
// OAuth flow is BLOCKED ("disallowed_useragent", 403): the Android in-app
// WebView, or an installed standalone PWA (iOS "Add to Home Screen").
//
// Google refuses OAuth in these environments for ALL apps — popup AND redirect
// alike — so there is no code path that makes "Sign in with Google" work here.
// The correct product move is to steer the user to email+password (which works
// everywhere) instead of showing a broken button. Client-only (touches
// navigator / sessionStorage); guard every call behind a mounted check.
export function isEmbeddedBrowser(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const ua = navigator.userAgent || ''
    // Android System WebView reports "; wv)" in its UA.
    if (/;\s*wv\)|\bwv\b/.test(ua)) return true
    // Our Android app also flags embed mode via /connect/expenses bootstrap.
    if (sessionStorage.getItem('embedMode') === '1') return true
    // Installed PWA (standalone display) — iOS Safari legacy + the standard.
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true
    if ((navigator as { standalone?: boolean }).standalone === true) return true
  } catch {
    /* defensive — never let detection throw on the login screen */
  }
  return false
}
