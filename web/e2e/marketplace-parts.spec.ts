import { test, expect, type Route } from '@playwright/test'

/**
 * Parts Marketplace v1 — cards render, and PartSentry governance holds:
 * a "Verified Parts" badge appears ONLY for a public-card-eligible part; a suppressed part renders
 * its card but NOT the verified badge. Backend mocked via page.route.
 */

const PARTS = {
  listing_type: 'part',
  total: 2,
  governed: true,
  listings: [
    {
      id: 'p-eligible', part_name: 'OEM Brake Pads', part_category: 'Brakes', condition: 'new',
      price: 120, currency: 'USD', price_mode: 'fixed', compatibility: ['Toyota Hilux'],
      supplier_label: 'Verified supplier', location: 'Harare',
      partsentry_public_status: 'eligible', verified_parts: true,
    },
    {
      id: 'p-suppressed', part_name: 'Alternator', part_category: 'Electrical', condition: 'used',
      price: null, currency: 'USD', price_mode: 'quote_required', compatibility: [],
      supplier_label: 'Verified supplier', location: 'Bulawayo',
      // watch/flagged provenance -> suppressed; the verified badge MUST NOT render.
      partsentry_public_status: 'suppressed', verified_parts: false,
    },
  ],
}

test('parts marketplace renders cards and suppresses ungoverned PartSentry badges', async ({ page }) => {
  await page.route('**/api/security/csrf-token', (r: Route) => r.fulfill({ json: { csrfToken: 'test-csrf' } }))
  await page.route('**/api/marketplace/parts**', (r: Route) => r.fulfill({ json: PARTS }))

  await page.goto('/marketplace/parts')
  await expect(page.getByTestId('marketplace-parts-page')).toBeVisible()

  const cards = page.getByTestId('marketplace-part-card')
  await expect(cards).toHaveCount(2)
  await expect(page.getByText('OEM Brake Pads')).toBeVisible()
  await expect(page.getByText('Alternator')).toBeVisible()

  // Exactly one verified badge — only the eligible part.
  await expect(page.getByTestId('marketplace-part-verified-badge')).toHaveCount(1)
  // The suppressed part's card has no "Verified Parts" badge.
  const suppressedCard = cards.filter({ hasText: 'Alternator' })
  await expect(suppressedCard.getByTestId('marketplace-part-verified-badge')).toHaveCount(0)
})

test('parts marketplace shows a governed onboarding state when empty', async ({ page }) => {
  await page.route('**/api/security/csrf-token', (r: Route) => r.fulfill({ json: { csrfToken: 'test-csrf' } }))
  await page.route('**/api/marketplace/parts**', (r: Route) => r.fulfill({ json: { listing_type: 'part', total: 0, governed: true, listings: [] } }))

  await page.goto('/marketplace/parts')
  await expect(page.getByTestId('marketplace-category-empty')).toBeVisible()
  await expect(page.getByTestId('marketplace-inquiry-open').first()).toBeVisible()
})
