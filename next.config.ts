import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
    ],
  },
  /**
   * Serve Firebase's own auth handler from OUR origin.
   *
   * Google sign-in sends the browser to `<project>.firebaseapp.com/__/auth/handler`.
   * That is a different origin from app.orimipuy.com, so Safari cuts the two
   * apart: the handler cannot talk back and the tab sits there blank forever.
   * It cost an App Store rejection on 2026-08-17 — the reviewer pressed the
   * Google button, landed on the white page, and filed 2.1(a).
   *
   * Proxying the path makes everything same-origin, which is what lets
   * signInWithRedirect work without a popup, which in turn is what lets sign-in
   * live inside an in-app browser instead of throwing the user out to Safari
   * (guideline 4, the other half of the same rejection).
   *
   * The destination is the project's Firebase-hosted handler. It is a public
   * value — it already ships inside every client bundle — and it is NOT the
   * `authDomain` config, which stays in NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN.
   * `/__/firebase/*` is proxied too: the handler page loads its init script
   * from there, and half a proxy is worse than none.
   */
  async rewrites() {
    return [
      { source: '/__/auth/:path*',     destination: 'https://finance-machine-a36e9.firebaseapp.com/__/auth/:path*' },
      { source: '/__/firebase/:path*', destination: 'https://finance-machine-a36e9.firebaseapp.com/__/firebase/:path*' },
    ]
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options',           value: 'DENY' },
          { key: 'X-Content-Type-Options',     value: 'nosniff' },
          { key: 'Referrer-Policy',            value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy',         value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      {
        /**
         * The one path that must be frameable. Firebase Auth loads
         * `<authDomain>/__/auth/iframe` in a hidden iframe to resolve a redirect
         * sign-in; the site-wide DENY above would block it and the sign-in would
         * simply never complete — silently, with nothing in the console pointing
         * at a header. SAMEORIGIN, not a removal: once authDomain is our own
         * domain the embedding page and the iframe are the same origin, so
         * nothing outside app.orimipuy.com may frame it either.
         *
         * Listed AFTER the site-wide rule on purpose — a later matching header
         * with the same key replaces the earlier one. Verified live after deploy;
         * if DENY ever wins here again, Google sign-in breaks.
         */
        source: '/__/auth/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
      {
        // API routes — only allow same origin
        source: '/api/(.*)',
        headers: [
          { key: 'Access-Control-Allow-Origin',  value: 'same-origin' },
          { key: 'Access-Control-Allow-Methods', value: 'POST' },
        ],
      },
    ]
  },
}

export default nextConfig;
