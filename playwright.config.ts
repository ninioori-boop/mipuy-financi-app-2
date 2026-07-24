import { defineConfig, devices } from '@playwright/test'

// E2E smoke suite — runs against a PRODUCTION build on port 3100.
//
// Why not `npm run dev`: the turbopack dev server doesn't hydrate reliably in
// headless Chromium (client JS never attaches → the login form falls back to a
// native GET submit), so specs must target `next build && next start`.
// Why `localhost` and not 127.0.0.1: the Firebase web API key is
// HTTP-referrer-restricted; localhost is allowlisted, the bare IP is not
// (signInWithPassword returns 403 from a 127.0.0.1 origin).
// Port 3100 keeps clear of a dev server already running on 3000.
//
// The authenticated client-flow spec needs credentials via env:
//   E2E_EMAIL / E2E_PASSWORD — an allowlisted (invite-only) account.
// Without them the auth spec skips itself and only the public smoke runs.
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:3100',
    locale: 'he-IL',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npx next start -p 3100',
    url: 'http://localhost:3100',
    reuseExistingServer: true,
    timeout: 300_000,
  },
})
