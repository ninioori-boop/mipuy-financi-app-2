import { test, expect } from '@playwright/test'

// Authenticated client-flow smoke: email+password sign-in against the real
// Firebase backend, then verify we actually enter the app shell.
//
// Credentials come ONLY from env (never hardcode a password here):
//   E2E_EMAIL / E2E_PASSWORD — an allowlisted account (e.g. the Play-review
//   demo account). The spec skips itself when they're absent, so the public
//   smoke can run anywhere without secrets.

const EMAIL = process.env.E2E_EMAIL
const PASSWORD = process.env.E2E_PASSWORD

test('email sign-in reaches the app', async ({ page }) => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_EMAIL / E2E_PASSWORD not set')

  await page.goto('/auth')
  await page.getByPlaceholder('כתובת מייל').fill(EMAIL!)
  await page.getByPlaceholder('סיסמה', { exact: true }).fill(PASSWORD!)
  await page.getByRole('button', { name: 'כניסה', exact: true }).click()

  // Success = we leave /auth. First-ever login may land on the consent screen
  // instead of a tab — both prove authentication + allowlist admission worked.
  await page.waitForURL(u => !u.pathname.startsWith('/auth'), { timeout: 30_000 })
  expect(new URL(page.url()).pathname).not.toBe('/auth')

  // And no hard crash: the page rendered something substantial.
  await expect(page.locator('body')).not.toContainText('Application error')
})
