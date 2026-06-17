import { test, expect, type Route, type Page } from '@playwright/test'

/**
 * QA Round 4 (defect 1) — marketplace listing media must never show an unrelated stock vehicle.
 * A listing WITH real media shows that image; a listing WITHOUT media shows the neutral branded
 * "Image unavailable" placeholder (no Unsplash fallback, no other vehicle's photo).
 */

const base = {
  year: 2020,
  currency: 'USD',
  mileage: 30000,
  fuel_type: 'Petrol',
  transmission: 'Automatic',
  status: 'Available',
  condition_category: 'second_hand',
  marketplace_tags: ['cid_clear'],
  trust_score: 80,
  plate_number: null,
  normalized_plate_number: null,
  chassis_number: null,
  plate_verified: false,
  plate_status: null,
  passport_verified: false,
  evidence_count: 0,
  partsentry_checked: false,
  repair_history_count: 0,
  verified_parts_count: 0,
  duty_cleared: false,
  zimra_verified: false,
  cid_clear: true,
  seller_type: 'private',
  seller_display_label: 'Private seller',
  seller_public_profile_enabled: false,
  location: 'Harare',
  created_at: '2026-05-18T00:00:00.000Z',
}

const listings = [
  { ...base, vin: 'MR0HA8CDX0M111111', make: 'Toyota', model: 'Corolla', price: 12000, primary_image_url: 'https://cdn.carup.test/real/corolla.jpg' },
  { ...base, vin: 'JHMGK5860LS222222', make: 'Honda', model: 'Fit', price: 9800, primary_image_url: null },
]

async function mockApi(page: Page) {
  await page.route('**/api/security/csrf-token', (r: Route) => r.fulfill({ json: { csrfToken: 'test-csrf' } }))
  await page.route('**/api/marketplace/nav-coverage', (r: Route) => r.fulfill({ json: { threshold: 3, categories: {}, tags: {}, governed_deferred: [] } }))
  await page.route(/\/api\/marketplace\/listings(\?|$)/, (r: Route) =>
    r.fulfill({ json: { listings, total: listings.length, limit: 48 } }))
}

test('a listing with media shows its real image; one without shows the neutral placeholder', async ({ page }) => {
  await mockApi(page)
  await page.goto('/marketplace')

  await expect(page.locator('[data-testid="marketplace-vehicle-card"]')).toHaveCount(2)

  // Exactly one real image (the Corolla) and one branded placeholder (the Fit, which has no media).
  const realImg = page.locator('[data-testid="marketplace-vehicle-card"] [data-testid="listing-image"] img')
  await expect(realImg).toHaveCount(1)
  await expect(realImg).toHaveAttribute('src', 'https://cdn.carup.test/real/corolla.jpg')

  const placeholder = page.locator('[data-testid="marketplace-vehicle-card"] [data-testid="listing-image-placeholder"]')
  await expect(placeholder).toHaveCount(1)
  await expect(placeholder).toContainText('Image unavailable')
})

test('no listing card renders an unrelated stock fallback image', async ({ page }) => {
  await mockApi(page)
  await page.goto('/marketplace')
  // The previous misleading Unsplash fallback must be gone everywhere on the grid.
  await expect(page.locator('[data-testid="marketplace-vehicle-card"] img[src*="unsplash"]')).toHaveCount(0)
})
