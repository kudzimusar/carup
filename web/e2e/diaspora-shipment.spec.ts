import { expect, test, type Page, type Route } from '@playwright/test'

// MOCKED coverage for the Diaspora container reservation + shipment tracking UI.
// API responses (auth/me, csrf, diaspora endpoints) are stubbed via page.route.

const ORDER_ID = 'dio-1001'

const buyerUser = { id: 'buyer-1', name: 'Diaspora Buyer', email: 'buyer@carup.test', role: 'owner' }
const adminUser = { id: 'admin-1', name: 'Diaspora Admin', email: 'admin@carup.test', role: 'admin' }

const order = {
  id: ORDER_ID,
  buyer_id: 'buyer-1',
  order_type: 'vehicle',
  origin_country: 'Japan',
  origin_city: 'Yokohama',
  destination_country: 'Zimbabwe',
  destination_city: 'Harare',
  status: 'DOCUMENTS_VERIFIED',
}

const openContainer = {
  id: 'cont-1',
  origin_country: 'Japan',
  origin_city: 'Yokohama',
  destination_country: 'Zimbabwe',
  destination_city: 'Harare',
  departure_date: '2026-07-01T00:00:00.000Z',
  estimated_arrival_date: '2026-08-15T00:00:00.000Z',
  container_type: '40ft',
  available_capacity_volume: 20,
  status: 'BOOKING_OPEN',
}

const requestedReservation = {
  id: 'res-1',
  container_id: 'cont-1',
  import_order_id: ORDER_ID,
  buyer_id: 'buyer-1',
  cargo_type: 'vehicle',
  estimated_volume: 5,
  reservation_status: 'REQUESTED',
}

async function loginAs(page: Page, user = buyerUser, token = 'mock-token') {
  await page.addInitScript(({ user, token }) => {
    window.localStorage.setItem('carup_user', JSON.stringify(user))
    window.localStorage.setItem('carup_token', token)
  }, { user, token })
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }
  if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return }
  await route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) })
}

async function mockShipmentApi(page: Page, opts: { reservations?: unknown[]; shipments?: unknown[]; containers?: unknown[] } = {}) {
  const reservations = opts.reservations ?? []
  const shipments = opts.shipments ?? []
  const containers = opts.containers ?? [openContainer]

  await page.context().route('**/api/auth/me', route => fulfillJson(route, { user: { id: 'buyer-1', role: 'owner' } }))
  await page.context().route('**/security/csrf-token', route => fulfillJson(route, { csrfToken: 'mock-csrf-token' }))

  await page.context().route('**/api/diaspora/**', async route => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()

    if (method === 'GET' && path.endsWith(`/diaspora/import-orders/${ORDER_ID}`)) return fulfillJson(route, order)
    if (method === 'GET' && path.endsWith('/diaspora/reservations')) return fulfillJson(route, { data: reservations })
    if (method === 'GET' && path.endsWith('/diaspora/shipments')) return fulfillJson(route, { data: shipments })
    if (method === 'GET' && path.endsWith('/diaspora/containers')) return fulfillJson(route, { data: containers })
    if (method === 'POST' && path.endsWith('/diaspora/reservations')) return fulfillJson(route, requestedReservation, 201)
    if (method === 'POST' && (path.includes('/approve') || path.includes('/reject'))) return fulfillJson(route, { ...requestedReservation, reservation_status: path.includes('/approve') ? 'APPROVED' : 'REJECTED' })
    return fulfillJson(route, { data: [] })
  })
}

test.describe('Diaspora container reservation + shipment UI (mocked)', () => {
  test('unauthenticated user is redirected to login with returnTo', async ({ page }) => {
    await page.goto(`/diaspora/imports/${ORDER_ID}/shipment`)
    await expect(page).toHaveURL(/\/login\?returnTo=/)
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe(`/diaspora/imports/${ORDER_ID}/shipment`)
  })

  test('buyer can open the shipment page and it is no longer placeholder-only', async ({ page }) => {
    await loginAs(page, buyerUser)
    await mockShipmentApi(page)
    await page.goto(`/diaspora/imports/${ORDER_ID}/shipment`)

    await expect(page.locator('[data-testid="diaspora-import-shipment-route"]')).toBeVisible()
    await expect(page.locator('[data-testid="diaspora-shipment-coordination-note"]')).toContainText('CarUp coordinates shipment facilitation')
    await expect(page.locator('[data-testid="diaspora-shipment-status"]')).toBeVisible()
    await expect(page.locator('[data-testid="diaspora-shipment-origin"]')).toContainText('Yokohama')
  })

  test('buyer sees clear no-shipment and no-reservation empty states', async ({ page }) => {
    await loginAs(page, buyerUser)
    await mockShipmentApi(page, { reservations: [], shipments: [] })
    await page.goto(`/diaspora/imports/${ORDER_ID}/shipment`)

    await expect(page.locator('[data-testid="diaspora-shipment-empty"]')).toBeVisible()
    await expect(page.locator('[data-testid="diaspora-reservation-empty"]')).toBeVisible()
  })

  test('buyer can request a container reservation', async ({ page }) => {
    await loginAs(page, buyerUser)
    await mockShipmentApi(page, { reservations: [], containers: [openContainer] })
    await page.goto(`/diaspora/imports/${ORDER_ID}/shipment`)

    await page.locator('[data-testid="diaspora-reservation-container-select"]').selectOption('cont-1')
    await page.locator('[data-testid="diaspora-reservation-volume-input"]').fill('5')

    const reservationRequest = page.waitForRequest(req => req.method() === 'POST' && req.url().includes('/diaspora/reservations'))
    await page.locator('[data-testid="diaspora-request-reservation-button"]').click()
    await reservationRequest
  })

  test('buyer cannot see admin/logistics controls (approve/reject)', async ({ page }) => {
    await loginAs(page, buyerUser)
    await mockShipmentApi(page, { reservations: [requestedReservation] })
    await page.goto(`/diaspora/imports/${ORDER_ID}/shipment`)

    await expect(page.locator('[data-testid="diaspora-reservation-row"]').first()).toBeVisible()
    await expect(page.locator('[data-testid="diaspora-shipment-admin-controls"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="diaspora-reservation-approve-button"]')).toHaveCount(0)
  })

  test('admin/logistics user can see reservation controls', async ({ page }) => {
    await loginAs(page, adminUser, 'mock-admin-token')
    await mockShipmentApi(page, { reservations: [requestedReservation] })
    await page.goto(`/diaspora/imports/${ORDER_ID}/shipment`)

    await expect(page.locator('[data-testid="diaspora-shipment-admin-controls"]').first()).toBeVisible()
    await expect(page.locator('[data-testid="diaspora-reservation-approve-button"]').first()).toBeVisible()
    await expect(page.locator('[data-testid="diaspora-reservation-reject-button"]').first()).toBeVisible()
  })

  test('hard reload / deep link to shipment page does not log out a valid user', async ({ page }) => {
    await loginAs(page, buyerUser)
    await mockShipmentApi(page, { reservations: [], shipments: [] })

    // Deep-link straight to the shipment page (hard load) — must NOT bounce to /login.
    await page.goto(`/diaspora/imports/${ORDER_ID}/shipment`)
    await expect(page.locator('[data-testid="diaspora-import-shipment-route"]')).toBeVisible()
    await expect(page).not.toHaveURL(/\/login/)
  })
})
