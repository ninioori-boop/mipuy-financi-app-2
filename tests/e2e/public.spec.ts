import { test, expect } from '@playwright/test'

// Public-surface smoke: the pages anyone can reach must render, and an
// unauthenticated visitor must land on the login screen — not on client data.

test('unauthenticated visit lands on the login screen', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'כניסה למערכת' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByPlaceholder('כתובת מייל')).toBeVisible()
  await expect(page.getByPlaceholder('סיסמה', { exact: true })).toBeVisible()
})

test('app routes are guarded — /app/expenses redirects to login', async ({ page }) => {
  await page.goto('/app/expenses')
  await expect(page.getByRole('heading', { name: 'כניסה למערכת' })).toBeVisible({ timeout: 20_000 })
})

for (const path of ['/privacy', '/delete-account', '/welcome']) {
  test(`public page ${path} responds OK`, async ({ request }) => {
    const res = await request.get(path)
    expect(res.status(), `${path} should not error`).toBeLessThan(400)
  })
}
