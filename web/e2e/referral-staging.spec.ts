import { test, expect } from '@playwright/test'

// Referral Engine browser UAT.
//
// Run against staging with:
//   PLAYWRIGHT_BASE_URL=https://<carup-staging-host> \
//   E2E_UAT_ADMIN_EMAIL=uat-admin@carup.local E2E_UAT_ADMIN_PASSWORD=... \
//   E2E_UAT_OWNER_EMAIL=uat-owner@carup.local E2E_UAT_OWNER_PASSWORD=... \
//   npx playwright test web/e2e/referral-staging.spec.ts
//
// The public login/alert journey always runs (no secrets). The authenticated
// admin/owner journeys are skipped unless the UAT credentials are supplied, so
// the spec never embeds or requires secrets to be checked in.

const ADMIN_EMAIL = process.env.E2E_UAT_ADMIN_EMAIL
const ADMIN_PASSWORD = process.env.E2E_UAT_ADMIN_PASSWORD
const OWNER_EMAIL = process.env.E2E_UAT_OWNER_EMAIL
const OWNER_PASSWORD = process.env.E2E_UAT_OWNER_PASSWORD

async function login(page, email: string, password: string) {
  await page.goto('/login')
  await page.locator('[data-testid="email-input"]').fill(email)
  await page.locator('[data-testid="password-input"]').fill(password)
  await page.locator('[data-testid="login-button"]').click()
}

test.describe('Referral Engine — login & readable errors (public)', () => {
  test('login page renders the form', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('[data-testid="email-input"]')).toBeVisible()
    await expect(page.locator('[data-testid="password-input"]')).toBeVisible()
    await expect(page.locator('[data-testid="login-button"]')).toBeVisible()
  })

  test('invalid credentials surface a readable, accessible inline alert', async ({ page }) => {
    await login(page, 'uat-admin@carup.local', 'definitely-the-wrong-password')
    const alert = page.locator('[data-testid="login-error-alert"]')
    await expect(alert).toBeVisible({ timeout: 15000 })
    await expect(alert).toHaveAttribute('role', 'alert')
    // A safe, non-enumerating message (invalid credentials OR server/backend issue).
    await expect(alert).toContainText(/invalid|try again|unreachable|something went wrong/i)
  })
})

test.describe('Referral Engine — authenticated journeys (staging credentials required)', () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'set E2E_UAT_ADMIN_* to run admin journeys')

  test('admin logs in and reaches the referral admin area', async ({ page }) => {
    await login(page, ADMIN_EMAIL as string, ADMIN_PASSWORD as string)
    await page.waitForURL(/\/(admin|dashboard)/, { timeout: 20000 })
    await page.goto('/admin/referrals')
    await expect(page).toHaveURL(/\/admin\/referrals/)
  })
})

test.describe('Referral Engine — owner Refer & Earn (staging credentials required)', () => {
  test.skip(!OWNER_EMAIL || !OWNER_PASSWORD, 'set E2E_UAT_OWNER_* to run owner journeys')

  test('owner logs in and sees the Refer & Earn wallet page', async ({ page }) => {
    await login(page, OWNER_EMAIL as string, OWNER_PASSWORD as string)
    await page.waitForURL(/\/dashboard/, { timeout: 20000 })
    await page.goto('/dashboard/referrals')
    await expect(page).toHaveURL(/\/dashboard\/referrals/)
  })
})
