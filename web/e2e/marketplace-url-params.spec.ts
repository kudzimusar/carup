import { test, expect, type Page } from '@playwright/test'

/**
 * Phase 1 — Marketplace URL Intelligence.
 * The mocked listings endpoint returns the same two vehicles regardless of query, so these tests
 * assert (a) the URL params reach the API, (b) the UI reflects the URL state, and (c) state changes
 * are written back to the URL with working refresh + back/forward. Result counts rely on the
 * existing client-side filtering of the two fixtures.
 */

const vehicles = [
  {
    vin: 'MR0HA8CDX0M123456',
    make: 'Toyota',
    model: 'Hilux Double Cab',
    year: 2021,
    price: 42000,
    currency: 'USD',
    mileage: 28000,
    transmission: 'Automatic',
    fuel_type: 'Diesel',
    condition: 'Used',
    category: 'Pickup',
    location: 'Harare',
    images: ['/images/vehicles/pickup-hilux.jpg'],
    police_verified: true,
    trust_score: 95,
    status: 'Available',
    created_at: '2026-05-18T00:00:00.000Z',
    plate_number: 'AE-9999',
    normalized_plate_number: 'AE9999',
    chassis_number: 'CHASSIS-HILUX-001',
    sellerType: 'Dealership',
    sellerName: 'Trusted Dealer Zimbabwe',
    partsentry_checked: true,
  },
  {
    vin: 'JHMGK5860LS000001',
    make: 'Honda',
    model: 'Fit',
    year: 2024,
    price: 9800,
    currency: 'USD',
    mileage: 12000,
    transmission: 'Automatic',
    fuel_type: 'Petrol',
    condition: 'New',
    category: 'Hatchback',
    location: 'Bulawayo',
    images: ['/images/vehicles/hatchback-fit.jpg'],
    police_verified: false,
    trust_score: 76,
    status: 'Available',
    created_at: '2026-05-12T00:00:00.000Z',
    sellerType: 'Private Owner',
    sellerName: 'Tendai Moyo',
  },
]

const listings = vehicles.map(vehicle => ({
  vin: vehicle.vin,
  make: vehicle.make,
  model: vehicle.model,
  year: vehicle.year,
  price: vehicle.price,
  currency: vehicle.currency,
  mileage: vehicle.mileage,
  fuel_type: vehicle.fuel_type,
  transmission: vehicle.transmission,
  status: vehicle.status,
  condition_category: vehicle.condition === 'New' ? 'brand_new' : 'second_hand',
  marketplace_tags: [
    ...(vehicle.police_verified ? ['cid_clear'] : []),
    ...(vehicle.partsentry_checked ? ['partsentry_checked', 'repair_history_available'] : []),
    ...(vehicle.mileage <= 50000 ? ['low_mileage'] : []),
    vehicle.sellerType === 'Dealership' ? 'dealer_verified' : 'private_sale',
  ],
  trust_score: vehicle.trust_score,
  primary_image_url: vehicle.images[0],
  plate_number: vehicle.plate_number || null,
  normalized_plate_number: vehicle.normalized_plate_number || null,
  chassis_number: vehicle.chassis_number || null,
  plate_verified: false,
  plate_status: vehicle.plate_number ? 'Active' : null,
  passport_verified: false,
  evidence_count: 0,
  partsentry_checked: Boolean(vehicle.partsentry_checked),
  repair_history_count: vehicle.partsentry_checked ? 1 : 0,
  verified_parts_count: 0,
  duty_cleared: false,
  zimra_verified: false,
  cid_clear: vehicle.police_verified,
  seller_type: vehicle.sellerType === 'Dealership' ? 'dealer' : 'private',
  seller_display_label: vehicle.sellerType === 'Dealership' ? 'Trusted Dealer Zimbabwe' : 'Private seller',
  seller_public_profile_enabled: vehicle.sellerType === 'Dealership',
  location: vehicle.location,
  created_at: vehicle.created_at,
}))

async function mockApi(page: Page) {
  await page.route('**/api/marketplace/listings*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ listings, total: listings.length, limit: 48 }),
    })
  })
  await page.route('**/api/vehicles*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(vehicles),
    })
  })
}

test.describe('Marketplace URL intelligence — desktop', () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page)
  })

  test('seeds the make filter from the URL and sends it to the listings API', async ({ page }) => {
    const requestPromise = page.waitForRequest(/\/api\/marketplace\/listings/)
    await page.goto('/marketplace?make=Toyota')

    const request = await requestPromise
    expect(new URL(request.url()).searchParams.get('make')).toBe('Toyota')

    await expect(page.locator('[data-testid="marketplace-active-filter-chip"]').filter({ hasText: 'Toyota' })).toBeVisible()
    // Honda is filtered out client-side, leaving only the Toyota listing.
    await expect(page.locator('[data-testid="marketplace-vehicle-card"]')).toHaveCount(1)
  })

  test('q in the URL drives search', async ({ page }) => {
    await page.goto('/marketplace?q=Honda')
    await expect(page.locator('[data-testid="marketplace-search-input"]')).toHaveValue('Honda')
    await expect(page.locator('[data-testid="marketplace-vehicle-card"]')).toHaveCount(1)
  })

  test('a condition category from the URL activates the matching chip', async ({ page }) => {
    await page.goto('/marketplace?category=brand_new')
    await expect(page.locator('[data-testid="marketplace-active-filter-chip"]').filter({ hasText: 'Brand New' })).toBeVisible()
    // Honda (brand_new) matches; Toyota (second_hand) is filtered out.
    await expect(page.locator('[data-testid="marketplace-vehicle-card"]')).toHaveCount(1)
  })

  test('a trust tag from the URL activates the quick filter and is sent to the API', async ({ page }) => {
    const requestPromise = page.waitForRequest(/\/api\/marketplace\/listings/)
    await page.goto('/marketplace?tag=partsentry_checked')

    expect(new URL((await requestPromise).url()).searchParams.get('tag')).toBe('partsentry_checked')
    await expect(page.locator('[data-testid="marketplace-filter-partsentry-checked"]')).toHaveAttribute('aria-pressed', 'true')
    // Only the Toyota fixture is PartSentry checked.
    await expect(page.locator('[data-testid="marketplace-vehicle-card"]')).toHaveCount(1)
  })

  test('maxPrice from the URL reflects as a budget chip and filters results', async ({ page }) => {
    await page.goto('/marketplace?maxPrice=10000')
    await expect(page.locator('[data-testid="marketplace-active-filter-chip"]').filter({ hasText: 'Under $10,000' })).toBeVisible()
    // Only the Honda ($9,800) is under $10,000.
    await expect(page.locator('[data-testid="marketplace-vehicle-card"]')).toHaveCount(1)
  })

  test('a combined URL preserves every filter (state + API)', async ({ page }) => {
    const requestPromise = page.waitForRequest(/\/api\/marketplace\/listings/)
    await page.goto('/marketplace?make=Toyota&tag=partsentry_checked&maxPrice=50000&sort=trust')

    const params = new URL((await requestPromise).url()).searchParams
    expect(params.get('make')).toBe('Toyota')
    expect(params.get('tag')).toBe('partsentry_checked')
    expect(params.get('maxPrice')).toBe('50000')
    expect(params.get('sort')).toBe('trust')

    const active = page.locator('[data-testid="marketplace-active-filter-chip"]')
    await expect(active.filter({ hasText: 'Toyota' })).toBeVisible()
    await expect(active.filter({ hasText: 'PartSentry Checked' })).toBeVisible()
    await expect(active.filter({ hasText: 'Under $50,000' })).toBeVisible()
    await expect(active.filter({ hasText: 'Sorted by Trust' })).toBeVisible()
    await expect(page.locator('[data-testid="marketplace-vehicle-card"]')).toHaveCount(1)
  })

  test('clicking a trust quick filter writes the URL', async ({ page }) => {
    await page.goto('/marketplace')
    await page.locator('[data-testid="marketplace-filter-passport-verified"]').click()
    await expect(page).toHaveURL(/[?&]tag=passport_verified/)
    await expect(page.locator('[data-testid="marketplace-filter-passport-verified"]')).toHaveAttribute('aria-pressed', 'true')
  })

  test('removing an active filter chip clears it from the URL', async ({ page }) => {
    await page.goto('/marketplace?make=Toyota')
    await page.locator('[data-testid="marketplace-active-filter-chip"]').filter({ hasText: 'Toyota' }).click()
    await expect(page).toHaveURL(/\/marketplace$/)
  })

  test('clear all returns to a pristine /marketplace', async ({ page }) => {
    await page.goto('/marketplace?make=Toyota&sort=trust')
    await expect(page.locator('[data-testid="marketplace-active-filters"]')).toBeVisible()
    await page.locator('[data-testid="marketplace-clear-filters"]').click()
    await expect(page).toHaveURL(/\/marketplace$/)
    await expect(page.locator('[data-testid="marketplace-active-filters"]')).toHaveCount(0)
  })

  test('refresh preserves filter state', async ({ page }) => {
    await page.goto('/marketplace?make=Toyota')
    await expect(page.locator('[data-testid="marketplace-active-filter-chip"]').filter({ hasText: 'Toyota' })).toBeVisible()
    await page.reload()
    await expect(page.locator('[data-testid="marketplace-active-filter-chip"]').filter({ hasText: 'Toyota' })).toBeVisible()
  })

  test('browser back/forward moves between filter states', async ({ page }) => {
    await page.goto('/marketplace')
    await page.locator('[data-testid="marketplace-filter-passport-verified"]').click()
    await expect(page).toHaveURL(/[?&]tag=passport_verified/)

    await page.goBack()
    await expect(page).toHaveURL(/\/marketplace$/)
    await expect(page.locator('[data-testid="marketplace-filter-passport-verified"]')).toHaveAttribute('aria-pressed', 'false')

    await page.goForward()
    await expect(page).toHaveURL(/[?&]tag=passport_verified/)
    await expect(page.locator('[data-testid="marketplace-filter-passport-verified"]')).toHaveAttribute('aria-pressed', 'true')
  })

  test('no-query /marketplace shows all fixtures (no regression)', async ({ page }) => {
    await page.goto('/marketplace')
    await expect(page.locator('[data-testid="marketplace-vehicle-card"]')).toHaveCount(2)
    await expect(page.locator('[data-testid="marketplace-active-filters"]')).toHaveCount(0)
  })
})

test.describe('Marketplace URL intelligence — mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test.beforeEach(async ({ page }) => {
    await mockApi(page)
  })

  test('search is visible without opening the drawer and there is no horizontal overflow', async ({ page }) => {
    await page.goto('/marketplace')
    await expect(page.locator('[data-testid="marketplace-search-input"]')).toBeVisible()

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  })

  test('filter button opens the drawer and a drawer filter updates the URL', async ({ page }) => {
    await page.goto('/marketplace')
    await page.locator('[data-testid="marketplace-mobile-filter-button"]').click()
    await expect(page.locator('[data-testid="marketplace-mobile-filter-drawer"]')).toBeVisible()

    await page.locator('[data-testid="marketplace-price-min-filter"]').fill('5000')
    await page.locator('[data-testid="marketplace-mobile-filter-close"]').click()

    await expect(page).toHaveURL(/[?&]minPrice=5000/)
    await expect(page.locator('[data-testid="marketplace-active-filter-chip"]').filter({ hasText: 'From $5,000' })).toBeVisible()
  })

  test('deep-linked URL state is preserved on mobile after refresh', async ({ page }) => {
    await page.goto('/marketplace?make=Toyota')
    await expect(page.locator('[data-testid="marketplace-active-filter-chip"]').filter({ hasText: 'Toyota' })).toBeVisible()
    await expect(page.locator('[data-testid="marketplace-vehicle-card"]')).toHaveCount(1)
    await page.reload()
    await expect(page.locator('[data-testid="marketplace-active-filter-chip"]').filter({ hasText: 'Toyota' })).toBeVisible()
  })
})
