import { test, expect } from '@playwright/test'

const marketplaceVehicles = [
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
    sellerPhone: '+263 773 345 678',
  },
]

const marketplaceListings = marketplaceVehicles.map(vehicle => ({
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

test.describe('Marketplace verified listing cards', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/marketplace/listings*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          listings: marketplaceListings,
          total: marketplaceListings.length,
          limit: 48,
        }),
      })
    })

    await page.route('**/api/vehicles*', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(marketplaceVehicles),
      })
    })
  })

  test('marketplace page loads listing cards with trust and VIN Passport links', async ({ page }) => {
    await page.goto('/marketplace')

    await expect(page.getByRole('heading', { name: /Vehicle Marketplace/i })).toBeVisible()
    await expect(page.locator('[data-testid="marketplace-vehicle-card"]')).toHaveCount(2)
    await expect(page.locator('[data-testid="marketplace-trust-score"]').first()).toContainText('Trust 95')
    await expect(page.locator('[data-testid="marketplace-verified-badge"]').first()).toBeVisible()
    await expect(page.locator('[data-testid="marketplace-plate-status"]').first()).toContainText('Plate on file')

    const passportHref = await page.locator('[data-testid="marketplace-view-passport"]').first().getAttribute('href')
    expect(passportHref).toBe('/marketplace/MR0HA8CDX0M123456')
    expect(passportHref).not.toMatch(/\/marketplace\/v\d+$/)
  })

  test('category chips render and safe chip selection does not crash', async ({ page }) => {
    await page.goto('/marketplace')

    // QA Round 4 separated single-select Condition/category chips from the multi-select Trust
    // filters. The condition group is All + 4 categories + Parts & Accessories = 6.
    await expect(page.locator('[data-testid="marketplace-category-chip"]')).toHaveCount(6)
    await expect(page.locator('[data-testid="marketplace-category-chip"]').filter({ hasText: 'Parts & Accessories' })).toBeVisible()

    // "Low Mileage" is now a stackable Trust filter, not a condition chip; both mock vehicles match.
    await page.locator('[data-testid="marketplace-trust-chip"]').filter({ hasText: 'Low Mileage' }).click()

    await expect(page.getByText(/vehicles found/i)).toBeVisible()
    await expect(page.locator('[data-testid="marketplace-vehicle-card"]')).toHaveCount(2)
  })

  test('search matches make, model, location, VIN, plate, and chassis', async ({ page }) => {
    await page.goto('/marketplace')

    const search = page.locator('[data-testid="marketplace-search-input"]')

    await search.fill('Toyota Hilux')
    await expect(page.locator('[data-testid="marketplace-vehicle-card"]')).toHaveCount(1)

    await search.fill('Harare')
    await expect(page.locator('[data-testid="marketplace-vehicle-card"]')).toHaveCount(1)

    await search.fill('MR0HA8CDX0M123456')
    await expect(page.locator('[data-testid="marketplace-vehicle-card"]')).toHaveCount(1)

    await search.fill('AE-9999')
    await expect(page.locator('[data-testid="marketplace-vehicle-card"]')).toHaveCount(1)

    await search.fill('CHASSIS-HILUX-001')
    await expect(page.locator('[data-testid="marketplace-vehicle-card"]')).toHaveCount(1)
  })

  test('PartSentry and evidence labels render only when supported by data', async ({ page }) => {
    await page.goto('/marketplace')

    // "PartSentry Checked" is a governed Trust filter (multi-select trust group, not a condition chip).
    await expect(page.locator('[data-testid="marketplace-trust-chip"]').filter({ hasText: 'PartSentry Checked' })).toBeVisible()
    // Governance invariant: the badge renders only for the one mock vehicle whose data carries a
    // PartSentry signal; the no-signal vehicle shows neither the badge nor an Evidence Available label.
    await expect(page.locator('[data-testid="marketplace-partsentry-badge"]')).toHaveCount(1)
    await expect(page.locator('[data-testid="marketplace-vehicle-card"]').filter({ hasText: 'Evidence Available' })).toHaveCount(0)
  })

  test('listing cards do not expose private owner names or phone numbers', async ({ page }) => {
    await page.goto('/marketplace')

    const cardText = await page.locator('[data-testid="marketplace-vehicle-card"]').allInnerTexts()
    const joined = cardText.join('\n')

    expect(joined).not.toContain('Tendai Moyo')
    expect(joined).not.toContain('+263 773 345 678')
    expect(joined).toContain('Private seller')
  })
})
