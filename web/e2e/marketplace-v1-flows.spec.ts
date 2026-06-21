import { test, expect, type Route } from '@playwright/test'

/**
 * Marketplace v1 — inquiry + referral attribution + compare + backend trust rendering.
 * All backend calls are mocked (page.route) so the test runs against the dev server only.
 */

const LISTINGS = {
  listings: [
    {
      vin: '1HGBH41JXMN109186', make: 'Toyota', model: 'Corolla', year: 2018, price: 9500, currency: 'USD',
      mileage: 42000, status: 'Available', condition_category: 'locally_used',
      marketplace_tags: ['private_sale', 'evidence_available'], trust_score: 78, primary_image_url: null,
      plate_number: null, normalized_plate_number: null, chassis_number: null, plate_verified: false, plate_status: null,
      passport_verified: false, evidence_count: 1, partsentry_checked: false, repair_history_count: 0, verified_parts_count: 0,
      duty_cleared: true, zimra_verified: false, cid_clear: true, seller_type: 'private', seller_display_label: 'Private seller',
      seller_public_profile_enabled: false, location: 'Zimbabwe', created_at: '2026-01-01T00:00:00Z',
    },
    {
      vin: '1FMCU0GD9JUA12345', make: 'Ford', model: 'Ranger', year: 2020, price: 28000, currency: 'USD',
      mileage: 80000, status: 'Available', condition_category: 'recently_imported',
      marketplace_tags: ['dealer_verified', 'fresh_import'], trust_score: 80, primary_image_url: null,
      plate_number: null, normalized_plate_number: null, chassis_number: null, plate_verified: false, plate_status: null,
      passport_verified: false, evidence_count: 0, partsentry_checked: false, repair_history_count: 0, verified_parts_count: 0,
      duty_cleared: true, zimra_verified: false, cid_clear: true, seller_type: 'dealer', seller_display_label: 'Verified dealer',
      seller_public_profile_enabled: true, location: 'Zimbabwe', created_at: '2026-01-02T00:00:00Z',
    },
  ],
  total: 2, limit: 48,
}

const COMPARE = {
  listings: [
    {
      vin: '1HGBH41JXMN109186', make: 'Toyota', model: 'Corolla', year: 2018, price: 9500, currency: 'USD', mileage: 42000,
      condition_category: 'locally_used', trust_score: 78, marketplace_tags: ['private_sale'], primary_image_url: null,
      trust_summary: { trust_badges: ['passport_verified'], public_badge_copy: ['Vehicle passport verified'], risk_status: 'clear', partsentry_public_status: 'not_applicable', evidence_status: 'verified' },
      pricing_summary: { estimated_total: 11000, currency: 'USD' },
    },
    {
      vin: '1FMCU0GD9JUA12345', make: 'Ford', model: 'Ranger', year: 2020, price: 28000, currency: 'USD', mileage: 80000,
      condition_category: 'recently_imported', trust_score: 80, marketplace_tags: ['dealer_verified'], primary_image_url: null,
      trust_summary: { trust_badges: ['dealer_verified'], public_badge_copy: ['Registered dealer listing'], risk_status: 'clear', partsentry_public_status: 'not_applicable', evidence_status: 'none' },
      pricing_summary: { estimated_total: 31000, currency: 'USD' },
    },
  ],
  total: 2,
}

async function mockCommon(page: import('@playwright/test').Page) {
  await page.route('**/api/security/csrf-token', (r: Route) => r.fulfill({ json: { csrfToken: 'test-csrf' } }))
  await page.route('**/api/marketplace/nav-coverage', (r: Route) => r.fulfill({ json: { threshold: 3, categories: {}, tags: {}, governed_deferred: [] } }))
  await page.route(/\/api\/marketplace\/listings(\?|$)/, (r: Route) => r.fulfill({ json: LISTINGS }))
}

test('inquiry forwards captured referral attribution and source channel', async ({ page }) => {
  await mockCommon(page)
  let body: Record<string, unknown> | null = null
  await page.route('**/api/marketplace/inquiries', (r: Route) => {
    body = r.request().postDataJSON()
    return r.fulfill({ status: 201, json: { inquiry: { id: 'i1', status: 'new', source_channel: 'web', referral_attributed: true, inquiry_type: 'import_quote_request', created_at: '2026-06-17T00:00:00Z' } } })
  })

  await page.goto('/marketplace?ref=CARUP-TEST&campaign=WINTER')
  await page.getByTestId('marketplace-inquiry-open').click()
  await expect(page.getByTestId('marketplace-inquiry-modal')).toBeVisible()
  await page.getByTestId('marketplace-inquiry-email').fill('buyer@example.com')
  await page.getByTestId('marketplace-inquiry-submit').click()

  await expect.poll(() => body).not.toBeNull()
  expect(body!.referral_code).toBe('CARUP-TEST')
  expect(body!.campaign_code).toBe('WINTER')
  expect(body!.source_channel).toBe('web')
  expect(body!.inquiry_type).toBe('import_quote_request')
  expect(body!.guest_email).toBe('buyer@example.com')
})

test('compare selection navigates to a backend-governed comparison with trust badges', async ({ page }) => {
  await mockCommon(page)
  await page.route('**/api/marketplace/compare', (r: Route) => r.fulfill({ json: COMPARE }))

  await page.goto('/marketplace')
  await expect(page.getByTestId('marketplace-results-grid')).toBeVisible()

  const toggles = page.getByTestId('marketplace-compare-toggle')
  await toggles.nth(0).click()
  await toggles.nth(1).click()

  await expect(page.getByTestId('marketplace-compare-bar')).toBeVisible()
  await page.getByTestId('marketplace-compare-go').click()

  await expect(page).toHaveURL(/\/marketplace\/compare\?vins=/)
  const table = page.getByTestId('marketplace-compare-table')
  await expect(table).toBeVisible()
  // Compare renders backend trust_badges (slugs humanized) per listing.
  await expect(table.getByText('passport verified', { exact: false }).first()).toBeVisible()
  await expect(table.getByText('dealer verified', { exact: false }).first()).toBeVisible()
})
