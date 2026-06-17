import { test, expect, type Page } from '@playwright/test'

/**
 * Defect 3 (buyer QA): "Add to compare" must be discoverable WITHOUT hover — including on seeded
 * no-image placeholder cards and on touch/mobile viewports — while preserving compareVins,
 * MAX_COMPARE, the floating compare bar, the /marketplace/compare route, and aria-label/aria-pressed.
 */

const listings = [
  { vin: 'VINAAA0000000001', make: 'Toyota', model: 'Corolla', year: 2018, price: 9500, currency: 'USD', mileage: 68000, fuel_type: 'Petrol', transmission: 'Manual', status: 'Available', condition_category: 'locally_used', marketplace_tags: [], trust_score: 74, primary_image_url: null, plate_number: null, normalized_plate_number: null, chassis_number: null, seller_type: 'private', seller_display_label: 'Private seller', seller_public_profile_enabled: false, location: 'Harare', created_at: '2026-06-17T00:00:00.000Z' },
  { vin: 'VINBBB0000000002', make: 'BMW', model: '320i', year: 2020, price: 24000, currency: 'USD', mileage: 41000, fuel_type: 'Petrol', transmission: 'Automatic', status: 'Available', condition_category: 'recently_imported', marketplace_tags: [], trust_score: 90, primary_image_url: null, plate_number: null, normalized_plate_number: null, chassis_number: null, seller_type: 'private', seller_display_label: 'Private seller', seller_public_profile_enabled: false, location: 'Bulawayo', created_at: '2026-06-16T00:00:00.000Z' },
]

async function mockListings(page: Page) {
  await page.route('**/api/marketplace/listings*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ listings, total: listings.length, limit: 48 }) }))
  await page.route('**/api/vehicles*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(listings) }))
}

const compareBtn = (page: Page, i: number) =>
  page.locator('[data-testid="marketplace-vehicle-card"]').nth(i).locator('[data-testid="marketplace-compare-toggle"]')

test('compare toggle is visible without hover (computed opacity is 1)', async ({ page }) => {
  await mockListings(page)
  await page.goto('/marketplace')
  const btn = compareBtn(page, 0)
  await expect(btn).toBeVisible()
  // No hover/mouse move performed — it must already be fully opaque (not hover-revealed).
  const opacity = await btn.evaluate(el => getComputedStyle(el).opacity)
  expect(opacity).toBe('1')
  // Governed contract preserved.
  await expect(btn).toHaveAttribute('aria-label', 'Add to compare')
  await expect(btn).toHaveAttribute('aria-pressed', 'false')
})

test('compare toggle remains visible for a no-image (placeholder) listing', async ({ page }) => {
  await mockListings(page)
  await page.goto('/marketplace')
  const firstCard = page.locator('[data-testid="marketplace-vehicle-card"]').first()
  // The seeded listing has no media -> the neutral placeholder renders.
  await expect(firstCard.locator('[data-testid="listing-image-placeholder"]')).toBeVisible()
  const opacity = await compareBtn(page, 0).evaluate(el => getComputedStyle(el).opacity)
  expect(opacity).toBe('1')
})

test('compare toggle works at a mobile/touch viewport (no hover available)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await mockListings(page)
  await page.goto('/marketplace')
  const btn = compareBtn(page, 0)
  const opacity = await btn.evaluate(el => getComputedStyle(el).opacity)
  expect(opacity).toBe('1')
  await btn.click() // tap
  await expect(btn).toHaveAttribute('aria-pressed', 'true') // compareVins state preserved
})
