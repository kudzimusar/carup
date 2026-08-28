import { test, expect, type Page, type Route } from '@playwright/test'

const VIN_A = 'UATMARKETPLACE00001'
const VIN_B = 'UATMARKETPLACE00002'

function listing(vin: string, overrides: Record<string, unknown> = {}) {
  return {
    vin,
    make: 'Toyota',
    model: 'Hilux',
    year: 2018,
    price: 21500,
    currency: 'USD',
    mileage: 89000,
    fuel_type: 'Diesel',
    transmission: 'Automatic',
    status: 'Available',
    condition_category: 'second_hand',
    marketplace_tags: [],
    trust_score: 91.2,
    trust: {
      score: 50,
      band: 'moderate',
      evaluation_state: 'evaluated',
      confidence: 'low',
      calculation_version: 'trust-decision-1.0.0',
      evaluated_at: '2026-08-26T01:38:21.347Z',
      evidence_basis: {},
      known_limitations: ['insufficient_evidence'],
      source: 'canonical_trust',
    },
    primary_image_url: null,
    primary_image_state: 'none',
    primary_image_unpublishable_count: 0,
    plate_verified: false,
    plate_status: null,
    passport_verified: false,
    evidence_count: 0,
    partsentry_checked: false,
    repair_history_count: 0,
    verified_parts_count: 0,
    duty_cleared: false,
    zimra_verified: false,
    cid_clear: false,
    seller_type: 'private',
    seller_display_label: 'UAT seller',
    seller_public_profile_enabled: false,
    location: 'Harare',
    location_state: 'recorded',
    reservation_summary: { state: 'none', reserved: false, reserved_at: null, expires_at: null, reason: null },
    created_at: '2026-08-20T00:00:00Z',
    ...overrides,
  }
}

async function commonMocks(page: Page) {
  await page.route('**/api/security/csrf-token', (route: Route) => route.fulfill({ json: { csrfToken: 'test-csrf' } }))
  await page.route('**/api/marketplace/nav-coverage', (route: Route) => route.fulfill({ json: { threshold: 3, categories: {}, tags: {}, governed_deferred: [] } }))
}

test('listing card renders canonical Trust and never republishes the legacy cached score', async ({ page }) => {
  await commonMocks(page)
  await page.route(/\/api\/marketplace\/listings(\?|$)/, (route: Route) => route.fulfill({
    json: { total: 1, limit: 48, listings: [listing(VIN_A)] },
  }))

  await page.goto('/marketplace')

  const card = page.getByTestId('marketplace-vehicle-card').first()
  await expect(card).toBeVisible()
  await expect(card.getByTestId('marketplace-card-trust')).toContainText('Moderate')
  await expect(card.getByTestId('marketplace-card-trust')).toContainText('50/100')
  await expect(card.getByTestId('marketplace-card-trust')).toContainText('Low')
  await expect(card).not.toContainText('91.2')
  await expect(card).not.toContainText('91/100')
})

test('not-evaluated listing shows an honest state and no numerical legacy score', async ({ page }) => {
  await commonMocks(page)
  await page.route(/\/api\/marketplace\/listings(\?|$)/, (route: Route) => route.fulfill({
    json: {
      total: 1,
      limit: 48,
      listings: [listing(VIN_A, {
        trust_score: 84.5,
        trust: {
          score: null,
          band: null,
          evaluation_state: 'not_evaluated',
          confidence: null,
          calculation_version: null,
          known_limitations: [],
        },
      })],
    },
  }))

  await page.goto('/marketplace')
  const trust = page.getByTestId('marketplace-card-trust').first()
  await expect(trust).toContainText('Not evaluated yet')
  await expect(trust).toContainText('No legacy score is substituted')
  await expect(page.getByTestId('marketplace-vehicle-card').first()).not.toContainText('84.5')
})

test('search commits q to the backend after debounce so discovery is not limited to the first loaded page', async ({ page }) => {
  await commonMocks(page)
  const observedQueries: string[] = []

  await page.route(/\/api\/marketplace\/listings(\?|$)/, (route: Route) => {
    const requestUrl = new URL(route.request().url())
    const q = requestUrl.searchParams.get('q') || ''
    observedQueries.push(q)
    const listings = q.toLowerCase() === 'honda'
      ? [listing(VIN_B, { make: 'Honda', model: 'Fit', price: 7800, trust_score: 95, trust: { score: null, evaluation_state: 'not_evaluated' } })]
      : [listing(VIN_A)]
    return route.fulfill({ json: { total: listings.length, limit: 48, listings } })
  })

  await page.goto('/marketplace')
  await expect(page.getByTestId('marketplace-results-grid').getByText('Toyota Hilux')).toBeVisible()

  const search = page.getByTestId('marketplace-search-input')
  await search.fill('Honda')

  await expect(page).toHaveURL(/q=Honda/)
  await expect(page.getByTestId('marketplace-results-grid').getByText('Honda Fit')).toBeVisible()
  expect(observedQueries).toContain('Honda')
})

test('default price range keeps high-value inventory visible because Any max is unbounded', async ({ page }) => {
  await commonMocks(page)
  await page.route(/\/api\/marketplace\/listings(\?|$)/, (route: Route) => route.fulfill({
    json: {
      total: 1,
      limit: 48,
      listings: [listing(VIN_A, { make: 'Mercedes-Benz', model: 'G-Class', price: 175000 })],
    },
  }))

  await page.goto('/marketplace')
  const card = page.getByTestId('marketplace-vehicle-card').first()
  await expect(card).toBeVisible()
  await expect(card).toContainText('Mercedes-Benz G-Class')
  await expect(card.getByTestId('marketplace-card-price')).toContainText('175,000')
  await expect(page.getByTestId('marketplace-showroom-spotlight')).toContainText('Mercedes-Benz G-Class')
})

test('card action buttons do not navigate the buyer away from marketplace', async ({ page }) => {
  await commonMocks(page)
  await page.route(/\/api\/marketplace\/listings(\?|$)/, (route: Route) => route.fulfill({
    json: { total: 1, limit: 48, listings: [listing(VIN_A)] },
  }))

  await page.goto('/marketplace')
  await page.getByTestId('marketplace-compare-toggle').first().click()
  await expect(page).toHaveURL(/\/marketplace(?:\?|$)/)
  await expect(page.getByTestId('marketplace-compare-bar')).toBeVisible()

  await page.getByTestId('marketplace-save-toggle').first().click()
  await expect(page).toHaveURL(/\/marketplace(?:\?|$)/)
})

test('mobile exposes the same filter system through an explicit drawer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await commonMocks(page)
  await page.route(/\/api\/marketplace\/listings(\?|$)/, (route: Route) => route.fulfill({
    json: { total: 1, limit: 48, listings: [listing(VIN_A)] },
  }))

  await page.goto('/marketplace')
  await page.getByTestId('marketplace-compare-toggle').first().click()
  await expect(page.getByTestId('marketplace-compare-bar')).toBeVisible()

  await page.getByTestId('marketplace-mobile-filter-button').click()
  await expect(page.getByTestId('marketplace-mobile-filter-drawer')).toBeVisible()
  await expect(page.getByTestId('marketplace-make-filter')).toBeVisible()
  await expect(page.getByTestId('marketplace-trust-group')).toBeVisible()
  await expect(page.getByTestId('marketplace-compare-bar')).toHaveCount(0)

  await page.getByTestId('marketplace-mobile-filter-close').click()
  await expect(page.getByTestId('marketplace-mobile-filter-drawer')).toBeHidden()
  await expect(page.getByTestId('marketplace-compare-bar')).toBeVisible()
})


test('comparison renders only server-owned Trust vocabulary with no client score tier', async ({ page }) => {
  await commonMocks(page)
  await page.route('**/api/marketplace/compare', (route: Route) => route.fulfill({
    json: {
      total: 2,
      listings: [
        listing(VIN_A, {
          trust: {
            score: 96,
            band: 'high',
            evaluation_state: 'evaluated',
            confidence: 'high',
            calculation_version: 'trust-decision-1.0.0',
            known_limitations: [],
          },
        }),
        listing(VIN_B, {
          make: 'Honda',
          model: 'Fit',
          trust: {
            score: 74,
            band: 'moderate',
            evaluation_state: 'evaluated',
            confidence: 'medium',
            calculation_version: 'trust-decision-1.0.0',
            known_limitations: [],
          },
        }),
      ],
    },
  }))

  await page.goto(`/marketplace/compare?vins=${VIN_A},${VIN_B}`)
  const compare = page.getByTestId('marketplace-compare-page')
  await expect(compare).toContainText('High · 96/100')
  await expect(compare).toContainText('Moderate · 74/100')
  await expect(compare).not.toContainText('Strong canonical Trust')
})

test('Home popular shortcuts deep-link to governed Marketplace facets instead of free-text guesses', async ({ page }) => {
  await commonMocks(page)
  await page.route(/\/api\/marketplace\/listings(\?|$)/, (route: Route) => route.fulfill({
    json: { total: 1, limit: 6, listings: [listing(VIN_A)] },
  }))

  await page.goto('/')
  const shortcut = (label: string) => page.getByTestId('popular-search-chip').filter({ hasText: label })

  await expect(shortcut('Brand New')).toHaveAttribute('href', '/marketplace?category=brand_new')
  await expect(shortcut('Fresh Imports')).toHaveAttribute('href', '/marketplace?tag=fresh_import')
  await expect(shortcut('Under $5,000')).toHaveAttribute('href', '/marketplace?maxPrice=5000')
  await expect(shortcut('Harare')).toHaveAttribute('href', '/marketplace?location=Harare')
  await expect(shortcut('Diesel')).toHaveAttribute('href', '/marketplace?fuel=Diesel')
  await expect(shortcut('Automatic')).toHaveAttribute('href', '/marketplace?transmission=Automatic')
  await expect(shortcut('Parts & Accessories')).toHaveAttribute('href', '/marketplace/parts')
  await expect(shortcut('Passport Verified')).toHaveAttribute('href', '/marketplace?tag=passport_verified')
})

test('shared Home vehicle cards reuse governed plate status presentation', async ({ page }) => {
  await commonMocks(page)
  await page.route(/\/api\/marketplace\/listings(\?|$)/, (route: Route) => route.fulfill({
    json: {
      total: 1,
      limit: 6,
      listings: [listing(VIN_A, { plate_verified: true, plate_status: 'Active' })],
    },
  }))

  await page.goto('/')
  const card = page.getByTestId('featured-verified-car').first()
  await expect(card).toBeVisible()
  await expect(card.getByTestId('marketplace-plate-status')).toHaveText('Plate confirmed')
  await expect(card.getByTestId('marketplace-plate-confirmed-badge')).toBeVisible()
  await expect(card).not.toContainText('Plate active')
})

test('stale/unavailable trust, missing price, media-state mismatch and adverse plate status fail closed', async ({ page }) => {
  await commonMocks(page)
  await page.route(/\/api\/marketplace\/listings(\?|$)/, (route: Route) => route.fulfill({
    json: {
      total: 2,
      limit: 48,
      listings: [
        listing(VIN_A, {
          price: null,
          currency: null,
          trust_score: 99,
          trust: { score: null, band: null, evaluation_state: 'stale', confidence: 'low', calculation_version: 'old', known_limitations: [] },
          primary_image_url: 'https://cdn.carup.dev/should-not-render.jpg',
          primary_image_state: 'not_loaded',
          plate_verified: true,
          plate_status: 'Flagged',
        }),
        listing(VIN_B, {
          make: 'Honda', model: 'Fit', trust_score: 97,
          trust: { score: null, band: null, evaluation_state: 'unavailable', confidence: 'not_evaluated', calculation_version: null, known_limitations: [] },
        }),
      ],
    },
  }))

  await page.goto('/marketplace')
  const cards = page.getByTestId('marketplace-vehicle-card')
  const first = cards.nth(0)
  const second = cards.nth(1)
  await expect(first.getByTestId('marketplace-card-price')).toContainText('Price not recorded')
  await expect(first.getByTestId('marketplace-card-trust')).toContainText('Evaluation update pending')
  await expect(second.getByTestId('marketplace-card-trust')).toContainText('Trust temporarily unavailable')
  await expect(first).not.toContainText('99')
  await expect(second).not.toContainText('97')
  await expect(first.locator('img[src*="should-not-render"]')).toHaveCount(0)
  await expect(first.getByTestId('marketplace-plate-status')).toHaveText('Plate flagged')
  await expect(first.getByTestId('marketplace-plate-confirmed-badge')).toHaveCount(0)
})

test('location, fuel and transmission facets are forwarded to the canonical backend', async ({ page }) => {
  await commonMocks(page)
  const observed: string[] = []
  await page.route(/\/api\/marketplace\/listings(\?|$)/, (route: Route) => {
    const url = new URL(route.request().url())
    observed.push(url.search)
    return route.fulfill({ json: { total: 1, limit: 48, listings: [listing(VIN_A)] } })
  })

  await page.goto('/marketplace?location=Harare&fuel=Diesel&transmission=Automatic')
  await expect(page.getByTestId('marketplace-vehicle-card').first()).toBeVisible()
  await expect.poll(() => observed.some(search => {
    const params = new URLSearchParams(search)
    return params.get('location') === 'Harare'
      && params.get('fuel') === 'Diesel'
      && params.get('transmission') === 'Automatic'
  })).toBe(true)
})
