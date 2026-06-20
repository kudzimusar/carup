import { expect, test, type Page } from '@playwright/test'

const seller = { id: 'seller-1', name: 'QA Seller', email: 'seller@x.test', role: 'owner' }
const VIN = 'JTDKARFP0H3000731'

function vehicle(status: string) {
  return {
    vin: VIN,
    year: 2018,
    make: 'Toyota',
    model: 'Corolla',
    price: 9500,
    status,
    trust_score: 74,
    created_at: '2026-06-18T00:00:00.000Z',
    image_url: null,
  }
}

async function seedSeller(page: Page) {
  await page.addInitScript(([u, t]) => {
    localStorage.setItem('carup_user', u)
    localStorage.setItem('carup_token', t)
  }, [JSON.stringify(seller), 'seller-token'])
}

async function routeMyListings(
  page: Page,
  options: { initialStatus: string; statusFails?: boolean },
) {
  let currentStatus = options.initialStatus

  await page.route('**/api/auth/me', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: seller }) }))
  await page.route('**/api/security/csrf-token', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ csrfToken: 'csrf' }) }))
  await page.route('**/api/marketplace/my-listings/inquiries', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ inquiries: [] }) }))
  await page.route('**/api/vehicles/me', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([vehicle(currentStatus)]) }))
  await page.route(`**/api/vehicles/${VIN}/status`, r => {
    if (options.statusFails) {
      return r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'status update failed' }) })
    }
    currentStatus = 'Sold'
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, vin: VIN, status: currentStatus }) })
  })
}

const listingCard = (page: Page) => page.getByTestId(`my-listing-card-${VIN}`)
const markSoldButton = (page: Page) => page.getByTestId(`mark-sold-${VIN}`)

test('backend status "Sold" renders Sale completed after refresh', async ({ page }) => {
  await routeMyListings(page, { initialStatus: 'Sold' })
  await seedSeller(page)

  await page.goto('/dashboard/listings')

  await expect(listingCard(page)).toContainText('Sale completed')
  await expect(listingCard(page)).toContainText('Sold')
  await expect(markSoldButton(page)).toHaveCount(0)
})

test('backend status "sold" also renders Sale completed', async ({ page }) => {
  await routeMyListings(page, { initialStatus: 'sold' })
  await seedSeller(page)

  await page.goto('/dashboard/listings')

  await expect(listingCard(page)).toContainText('Sale completed')
  await expect(listingCard(page)).toContainText('Sold')
  await expect(markSoldButton(page)).toHaveCount(0)
})

test('failed mark-as-sold request does not change UI to sold and shows an error', async ({ page }) => {
  await routeMyListings(page, { initialStatus: 'Available', statusFails: true })
  await seedSeller(page)

  await page.goto('/dashboard/listings')
  await markSoldButton(page).click()

  await expect(listingCard(page)).not.toContainText('Sale completed')
  await expect(listingCard(page)).toContainText('Available')
  await expect(markSoldButton(page)).toBeEnabled()
  await expect(page.getByText('Could not mark this vehicle as sold. Please try again.')).toBeVisible()
})

test('successful mark-as-sold persists and survives refresh', async ({ page }) => {
  await routeMyListings(page, { initialStatus: 'Available' })
  await seedSeller(page)

  await page.goto('/dashboard/listings')
  await markSoldButton(page).click()

  await expect(listingCard(page)).toContainText('Sale completed')
  await expect(listingCard(page)).toContainText('Sold')
  await expect(markSoldButton(page)).toHaveCount(0)
  await expect(listingCard(page)).not.toContainText('Available')

  await page.reload()

  await expect(listingCard(page)).toContainText('Sale completed')
  await expect(listingCard(page)).toContainText('Sold')
  await expect(markSoldButton(page)).toHaveCount(0)
})
