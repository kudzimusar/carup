import { test, expect } from '@playwright/test'

const owner = { id: 'owner1', name: 'QA Staging Buyer', email: 'qa-buyer@x.test', role: 'owner' }
const savedListing = {
  vin: 'VINAAA0000000001',
  make: 'Toyota',
  model: 'Corolla',
  year: 2018,
  price: 9500,
  currency: 'USD',
  mileage: 68000,
  fuel_type: 'Petrol',
  transmission: 'Manual',
  status: 'Available',
  condition_category: 'locally_used',
  marketplace_tags: [],
  trust_score: 74,
  primary_image_url: null,
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
  cid_clear: false,
  seller_type: 'private',
  seller_display_label: 'Private seller',
  seller_public_profile_enabled: false,
  location: 'Harare',
  created_at: '2026-06-18T00:00:00.000Z',
}

test('Saved Cars uses marketplace saved APIs and removes with marketplace DELETE', async ({ page }) => {
  let savedLoadHit = false
  let removeMethod = ''
  let removeUrl = ''
  let legacySavedHit = false

  await page.route('**/api/auth/me', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: owner }) }))
  await page.route('**/api/security/csrf-token', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ csrfToken: 'csrf' }) }))
  await page.route('**/api/vehicles/saved*', r => {
    legacySavedHit = true
    return r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'legacy route should not be used' }) })
  })
  await page.route('**/api/marketplace/saved**', r => {
    savedLoadHit = true
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ listings: [savedListing], total: 1, limit: 48 }),
    })
  })
  await page.route('**/api/marketplace/listings/*/save', r => {
    removeMethod = r.request().method()
    removeUrl = r.request().url()
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ saved: false, vin: savedListing.vin }),
    })
  })

  await page.addInitScript(([u, t]) => {
    localStorage.setItem('carup_user', u)
    localStorage.setItem('carup_token', t)
  }, [JSON.stringify(owner), 'owner-token'])

  await page.goto('/dashboard/saved')

  await expect(page.getByRole('heading', { name: 'Saved Cars', exact: true })).toBeVisible()
  await expect.poll(() => savedLoadHit).toBe(true)
  await expect(page.getByText('2018 Toyota Corolla')).toBeVisible()
  expect(legacySavedHit).toBe(false)

  await page.getByRole('button', { name: 'Remove', exact: true }).click()

  await expect(page.getByText('No Saved Vehicles')).toBeVisible()
  expect(removeMethod).toBe('DELETE')
  expect(removeUrl).toContain('/api/marketplace/listings/VINAAA0000000001/save')
})
