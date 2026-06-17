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

// QA Round 4 (defect 3) — Parts/Garages nav links must reach the CANONICAL marketplace pages,
// not the legacy /garages directory.
async function mockCategoryPages(page: Page) {
  await page.route('**/api/marketplace/parts**', (r: Route) => r.fulfill({ json: { listing_type: 'part', total: 0, governed: true, listings: [] } }))
  await page.route('**/api/marketplace/services**', (r: Route) => r.fulfill({ json: { listing_type: 'service', total: 0, governed: true, listings: [] } }))
}

test('desktop Parts mega-menu links go to /marketplace/parts (not /garages)', async ({ page }) => {
  await mockCommon(page)
  await mockCategoryPages(page)
  await page.goto('/')
  await page.locator('[data-testid="nav-parts"]').click()
  const partsMenu = page.locator('[data-testid="nav-parts-menu"]')
  await expect(partsMenu).toBeVisible()
  await expect(partsMenu.getByRole('menuitem', { name: 'Browse Car Parts', exact: true })).toHaveAttribute('href', '/marketplace/parts')
  await partsMenu.getByRole('menuitem', { name: 'Browse Car Parts', exact: true }).click()
  await expect(page).toHaveURL(/\/marketplace\/parts$/)
  await expect(page.getByTestId('marketplace-parts-page')).toBeVisible()
})

test('mobile drawer Parts + Garages & Services reach the canonical pages', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockCommon(page)
  await mockCategoryPages(page)

  const drawer = page.getByRole('banner')

  await page.goto('/')
  await page.locator('[data-testid="mobile-menu-button"]').click()
  await drawer.getByRole('link', { name: 'Parts', exact: true }).click()
  await expect(page).toHaveURL(/\/marketplace\/parts$/)
  await expect(page.getByTestId('marketplace-parts-page')).toBeVisible()

  await page.goto('/')
  await page.locator('[data-testid="mobile-menu-button"]').click()
  await drawer.getByRole('link', { name: 'Garages & Services', exact: true }).click()
  await expect(page).toHaveURL(/\/marketplace\/services$/)
  await expect(page.getByTestId('marketplace-services-page')).toBeVisible()
})

test('marketplace header Parts/Services buttons use canonical routes', async ({ page }) => {
  await mockCommon(page)
  await mockCategoryPages(page)
  await page.goto('/marketplace')
  // shadcn Button(asChild) merges the testid onto the rendered <a> itself.
  await expect(page.getByTestId('marketplace-parts-link')).toHaveAttribute('href', '/marketplace/parts')
  await expect(page.getByTestId('marketplace-services-link')).toHaveAttribute('href', '/marketplace/services')
})
