import { test, expect, type Route, type Page } from '@playwright/test'

/**
 * QA Round 1 blockers — regression specs.
 *  - A card opens a REAL detail page (not "Vehicle Not Found") via the marketplace-detail fallback,
 *    and the card link uses the same VIN the detail page resolves (ID contract consistency).
 *  - A failing inquiry shows a readable backend message, never "[object Object]".
 */

const VIN = 'JTDKARFP0H3000731'
const LISTINGS = {
  total: 1, limit: 48,
  listings: [{
    vin: VIN, make: 'Toyota', model: 'Corolla', year: 2018, price: 9500, currency: 'USD', mileage: 68000,
    fuel_type: 'Petrol', transmission: 'Manual', status: 'Available', condition_category: 'locally_used',
    marketplace_tags: ['private_sale'], trust_score: 74, primary_image_url: null, plate_number: null,
    normalized_plate_number: null, chassis_number: null, plate_verified: false, plate_status: null,
    passport_verified: false, evidence_count: 0, partsentry_checked: false, repair_history_count: 0,
    verified_parts_count: 0, duty_cleared: true, zimra_verified: false, cid_clear: true, seller_type: 'private',
    seller_display_label: 'Private seller', seller_public_profile_enabled: false, location: 'Zimbabwe',
    created_at: '2026-01-01T00:00:00Z',
  }],
}
const DETAIL = {
  ...LISTINGS.listings[0],
  listing_type: 'vehicle', public_status: 'public', risk_status: 'clear',
  description: 'QA detail', short_description: '2018 Toyota Corolla', media: [],
  seller_summary: { display_label: 'Private seller', seller_type: 'private', public_profile_enabled: false },
  trust_summary: { trust_badges: [], public_badge_copy: [], evidence_status: 'none', vehicle_passport_available: false, identity_verified: false, dealer_verified: false, partsentry_public_status: 'not_applicable', suspicion_status: 'clear', risk_status: 'clear', risk_reasons: [], safe_public_copy: 'Limited trust signals.' },
  verification_summary: { seller_verified: false, identity_status: 'unverified', vehicle_evidence_verified: false, part_provenance_verified: false, inspection_available: false, inspection_verified: false, verification_notes_public: [] },
  pricing_summary: { asking_price: 9500, currency: 'USD', price_confidence: 'low', estimated_total: 10200, price_warnings: [], estimate_basis: 'deterministic' },
  safety_warnings: ['Do not pay outside CarUp.'],
}

async function baseMocks(page: Page) {
  await page.route('**/api/security/csrf-token', (r: Route) => r.fulfill({ json: { csrfToken: 'test-csrf' } }))
  await page.route('**/api/marketplace/nav-coverage', (r: Route) => r.fulfill({ json: { threshold: 3, categories: {}, tags: {}, governed_deferred: [] } }))
  await page.route(/\/api\/marketplace\/listings(\?|$)/, (r: Route) => r.fulfill({ json: LISTINGS }))
}

test('a marketplace card opens a real detail page (no "Vehicle Not Found") with a consistent VIN', async ({ page }) => {
  await baseMocks(page)
  // Passport paths miss -> the page must fall back to the marketplace detail endpoint.
  await page.route('**/vehicles/passport/lookup/**', (r: Route) => r.fulfill({ status: 404, json: { error: { message: 'not found' } } }))
  await page.route('**/api/vehicles/*/details', (r: Route) => r.fulfill({ status: 404, json: { error: { message: 'not found' } } }))
  await page.route('**/api/vehicles/*/passport', (r: Route) => r.fulfill({ status: 404, json: { error: { message: 'not found' } } }))
  await page.route('**/api/marketplace/listings/**', (r: Route) => r.fulfill({ json: DETAIL }))

  await page.goto('/marketplace')
  const card = page.getByTestId('marketplace-view-passport').first()
  // ID contract: the card links to the same VIN the detail page resolves.
  await expect(card).toHaveAttribute('href', `/marketplace/${VIN}`)
  await card.click()

  await expect(page).toHaveURL(new RegExp(`/marketplace/${VIN}$`))
  await expect(page.getByText('Vehicle Not Found')).toHaveCount(0)
  await expect(page.getByTestId('marketplace-detail-panels')).toBeVisible()
  await expect(page.getByText('Corolla', { exact: false }).first()).toBeVisible()
})

test('a failing inquiry shows a readable backend message, never "[object Object]"', async ({ page }) => {
  await baseMocks(page)
  // Backend errorMiddleware object shape — the symptom that produced "[object Object]".
  await page.route('**/api/marketplace/inquiries', (r: Route) =>
    r.fulfill({ status: 500, json: { success: false, error: { code: 'DATABASE_ERROR', message: 'Failed to record inquiry.' } } })
  )

  await page.goto('/marketplace')
  await page.getByTestId('marketplace-inquiry-open').click()
  await expect(page.getByTestId('marketplace-inquiry-modal')).toBeVisible()
  await page.getByTestId('marketplace-inquiry-email').fill('buyer@example.com')
  await page.getByTestId('marketplace-inquiry-submit').click()

  await expect(page.getByText('Failed to record inquiry.')).toBeVisible()
  await expect(page.getByText('[object Object]')).toHaveCount(0)

  // The toast text must actually contrast with its background (not blend in / invisible).
  const toast = page.locator('[data-sonner-toast]').first()
  await expect(toast).toBeVisible()
  const { bg, fg } = await toast.evaluate((el) => {
    const titleEl = (el.querySelector('[data-title]') as HTMLElement) || (el as HTMLElement)
    return { bg: getComputedStyle(el as HTMLElement).backgroundColor, fg: getComputedStyle(titleEl).color }
  })
  expect(bg).not.toBe('rgba(0, 0, 0, 0)') // toast has a real (non-transparent) background
  expect(bg).not.toBe(fg)                 // text colour differs from the background -> readable
})
