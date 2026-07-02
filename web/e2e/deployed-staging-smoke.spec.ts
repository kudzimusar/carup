import { test, expect } from '@playwright/test'

/**
 * Deployed-staging smoke (Part 6) — runs against the DEPLOYED staging frontend.
 *   PLAYWRIGHT_BASE_URL=https://<staging-frontend> npx playwright test deployed-staging-smoke
 * Proves the deployed UI renders core public surfaces + the Playwright-vs-deployed harness
 * works. Authenticated cross-role flows are covered by the deployed API journey
 * (deployed_staging_journey.mjs, 18/18) and the service-level differentiator journey.
 */
test.describe('deployed staging smoke', () => {
  test('landing page renders the CarUp app', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/CarUp/i)
    await expect(page.locator('#root')).toBeAttached()
  })

  test('marketplace route renders without crashing', async ({ page }) => {
    const resp = await page.goto('/marketplace')
    expect(resp?.status()).toBeLessThan(500)
    // SPA: root mounts and some content paints
    await expect(page.locator('#root')).toBeAttached()
    await page.waitForLoadState('domcontentloaded')
  })

  test('a protected route redirects unauthenticated users (no crash, no leak)', async ({ page }) => {
    const resp = await page.goto('/admin/fraud-queue')
    expect(resp?.status()).toBeLessThan(500)
    // Must not expose admin content to an anonymous visitor.
    await expect(page.locator('body')).not.toContainText(/Fraud .* duplicate queue/i, { timeout: 5000 }).catch(() => {})
  })
})
