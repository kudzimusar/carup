import { test, expect, type Route, type Page } from '@playwright/test'

/**
 * QA Round 2 — prove the frontend routes/actions work (the staging "Route not found" was the BACKEND
 * 404 from calling the wrong backend, not a missing frontend route). These pass purely on the SPA.
 */

async function mockCommon(page: Page) {
  await page.route('**/api/security/csrf-token', (r: Route) => r.fulfill({ json: { csrfToken: 'test-csrf' } }))
  await page.route('**/api/marketplace/nav-coverage', (r: Route) => r.fulfill({ json: { threshold: 3, categories: {}, tags: {}, governed_deferred: [] } }))
  await page.route(/\/api\/marketplace\/listings(\?|$)/, (r: Route) => r.fulfill({ json: { listings: [], total: 0, limit: 48 } }))
}

test('/marketplace/services renders the garage/service gated page', async ({ page }) => {
  await mockCommon(page)
  await page.route('**/api/marketplace/services**', (r: Route) => r.fulfill({ json: { listing_type: 'service', total: 0, governed: true, listings: [] } }))
  await page.goto('/marketplace/services')
  await expect(page.getByTestId('marketplace-services-page')).toBeVisible()
  await expect(page.getByTestId('marketplace-category-empty')).toBeVisible()
})

test('/marketplace/parts renders the parts gated page (deep link)', async ({ page }) => {
  await mockCommon(page)
  await page.route('**/api/marketplace/parts**', (r: Route) => r.fulfill({ json: { listing_type: 'part', total: 0, governed: true, listings: [] } }))
  await page.goto('/marketplace/parts')
  await expect(page.getByTestId('marketplace-parts-page')).toBeVisible()
})

test('"Import to Zimbabwe" opens the inquiry modal (no navigation, no route)', async ({ page }) => {
  await mockCommon(page)
  await page.goto('/marketplace')
  await page.getByRole('button', { name: 'Import to Zimbabwe' }).click()
  await expect(page.getByTestId('marketplace-inquiry-modal')).toBeVisible()
  // The modal is a dialog with the import inquiry type — it does not navigate to a route.
  await expect(page).toHaveURL(/\/marketplace$/)
})
