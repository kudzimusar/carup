import { expect, test, type Page, type Route } from '@playwright/test'

/**
 * Trade OS T3 — Logistics RFQ / "Ship something" mocked comprehension tests.
 *
 * These pin the customer mental model and the provider commercial flow. They do not replace the
 * deployed staging gate: the real DB/RPC/container-capacity path must still be certified there.
 */

type TestUser = { id: string; name: string; email: string; role: string; active_tenant_id?: string; tenant_role?: string }
const customer: TestUser = { id: 'customer-1', name: 'Tariro M', email: 'customer@carup.test', role: 'owner' }
const provider: TestUser = { id: 'provider-1', name: 'Hikari Operator', email: 'operator@carup.test', role: 'owner', active_tenant_id: 'tenant-hikari', tenant_role: 'admin' }

async function fulfillJson(route: Route, body: unknown, status = 200) {
  const origin = route.request().headers().origin || '*'
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
  }
  if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return }
  await route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) })
}

async function loginAs(page: Page, user: TestUser) {
  await page.addInitScript(({ user }) => {
    window.localStorage.setItem('carup_user', JSON.stringify(user))
    window.localStorage.setItem('carup_token', 'mock-token')
  }, { user })
}

/** A mock row the fake API serves back to the app. Only `id` is read by this spec. */
type MockRow = { id: string; [key: string]: unknown }

/** The cargo item as the app actually posts it — the fields these tests assert on. */
interface CapturedItem {
  description?: string
  quantity?: number
  estimated_volume_cbm?: number | null
  length_value?: number
  width_value?: number
  height_value?: number
  dimension_unit?: string
  [key: string]: unknown
}

interface CapturedRequestPayload {
  items: CapturedItem[]
  [key: string]: unknown
}

interface CapturedQuotePayload {
  compatible_container_id?: string | null
  freight_amount?: number
  handling_amount?: number
  total_amount?: number
  submit?: boolean
  [key: string]: unknown
}

interface State {
  requests: MockRow[]
  opportunities: MockRow[]
  myQuotes: Array<{ quote: MockRow; request: MockRow | null }>
  createdRequestPayloads: CapturedRequestPayload[]
  quotePayloads: CapturedQuotePayload[]
}

function baseState(): State {
  return { requests: [], opportunities: [], myQuotes: [], createdRequestPayloads: [], quotePayloads: [] }
}

const openOpportunity = {
  id: 'ship-1', reference: 'SHIP-ABCD1234', origin_country: 'Japan', origin_city: 'Yokohama',
  destination_country: 'Zimbabwe', destination_city: 'Harare', service_preference: 'flexible',
  needed_by: '2026-10-30', quote_count: 1,
  items: [
    { id: 'i1', line_number: 1, cargo_category: 'boxes', description: '14 household cartons', quantity: 14, estimated_volume_cbm: 1.512, estimated_weight_kg: 180, measurement_basis: 'CALCULATED', has_linked_vehicle: false },
  ],
}

/** The requester's own CarUp vehicles, or 'unreadable' to make that read fail. */
type OwnedVehicles = MockRow[] | 'unreadable'

async function mockApi(
  page: Page,
  state: State,
  user: TestUser,
  isProvider = false,
  ownedVehicles: OwnedVehicles = [],
) {
  await page.context().route('**/api/auth/me', (route) => fulfillJson(route, { user }))
  await page.context().route('**/api/vehicles/me', (route) =>
    ownedVehicles === 'unreadable'
      ? fulfillJson(route, { error: 'vehicle read failed' }, 500)
      : fulfillJson(route, ownedVehicles))
  await page.context().route('**/api/security/csrf-token', (route) => fulfillJson(route, { csrfToken: 'mock-csrf' }))
  await page.context().route('**/api/diaspora/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()

    if (path.endsWith('/container-marketplace/trade-context')) {
      return fulfillJson(route, { data: isProvider ? {
        user: { id: user.id, name: user.name },
        organisation: { id: 'tenant-hikari', name: 'Hikari Co-Load Logistics' },
        tenant_role: 'admin', is_organisation_admin: true,
        account_kind: 'business', business_type: 'logistics_provider', organization_name: 'Hikari Co-Load Logistics',
        market_relationship: 'international_trade', country_of_residence: 'Japan', city: 'Yokohama',
      } : {
        user: { id: user.id, name: user.name }, organisation: null, tenant_role: null, is_organisation_admin: false,
        account_kind: 'individual', business_type: null, organization_name: null,
        market_relationship: 'diaspora', country_of_residence: 'United Kingdom', city: 'London',
      } })
    }

    if (method === 'GET' && path.endsWith('/logistics-requests/mine')) return fulfillJson(route, { data: state.requests })
    if (method === 'POST' && path.endsWith('/logistics-requests')) {
      const payload = JSON.parse(route.request().postData() || '{}')
      state.createdRequestPayloads.push(payload)
      const request = {
        id: 'ship-new', reference: 'SHIP-NEW12345', requester_id: user.id,
        origin_country: payload.origin_country, origin_city: payload.origin_city || null,
        destination_country: payload.destination_country, destination_city: payload.destination_city || null,
        service_preference: payload.service_preference || 'flexible', status: 'DRAFT', accepted_quote_id: null, metadata: {},
        items: (payload.items || []).map((item: Record<string, unknown>, index: number) => ({
          id: `item-${index + 1}`, line_number: index + 1, measurement_basis: item.length_value ? 'CALCULATED' : item.estimated_volume_cbm ? 'PROVIDED' : 'UNKNOWN',
          estimated_volume_cbm: item.length_value
            ? Number((((Number(item.length_value) / 100) * (Number(item.width_value) / 100) * (Number(item.height_value) / 100) * Number(item.quantity || 1))).toFixed(3))
            : item.estimated_volume_cbm || null,
          ...item,
        })),
        quotes: [],
      }
      state.requests.push(request)
      return fulfillJson(route, { data: request }, 201)
    }

    const requestMatch = path.match(/\/logistics-requests\/([^/]+)$/)
    if (method === 'GET' && requestMatch) {
      const request = state.requests.find((row) => row.id === requestMatch[1])
      return request ? fulfillJson(route, { data: request }) : fulfillJson(route, { error: 'not found' }, 404)
    }
    const publishMatch = path.match(/\/logistics-requests\/([^/]+)\/publish$/)
    if (method === 'POST' && publishMatch) {
      const request = state.requests.find((row) => row.id === publishMatch[1])
      if (request) request.status = 'OPEN_FOR_QUOTES'
      return fulfillJson(route, { data: request })
    }
    if (method === 'GET' && /\/logistics-requests\/[^/]+\/sailing-matches$/.test(path)) return fulfillJson(route, { data: [] })

    if (method === 'GET' && path.endsWith('/logistics-opportunities')) return fulfillJson(route, { data: state.opportunities })
    if (method === 'GET' && path.endsWith('/logistics-quotes/mine')) return fulfillJson(route, { data: state.myQuotes })
    if (method === 'GET' && path.endsWith('/container-marketplace/containers')) {
      return fulfillJson(route, { data: [{
        id: 'container-hikari', tenant_id: 'tenant-hikari', coordinator_id: user.id, status: 'BOOKING_OPEN',
        origin_country: 'Japan', origin_city: 'Yokohama', destination_country: 'Zimbabwe', destination_city: 'Harare',
        container_type: '40HC', departure_date: '2026-10-15T00:00:00Z',
      }] })
    }
    const quoteCreateMatch = path.match(/\/logistics-opportunities\/([^/]+)\/quotes$/)
    if (method === 'POST' && quoteCreateMatch) {
      const payload = JSON.parse(route.request().postData() || '{}')
      state.quotePayloads.push(payload)
      const quote = { id: 'lq-new', logistics_request_id: quoteCreateMatch[1], provider_id: user.id, status: payload.submit ? 'SUBMITTED' : 'DRAFT', ...payload }
      state.myQuotes.push({ quote, request: state.opportunities.find((row) => row.id === quoteCreateMatch[1]) || null })
      return fulfillJson(route, { data: quote }, 201)
    }
    return fulfillJson(route, { data: [] })
  })
}

test.describe('Trade OS T3 — Shipping requests', () => {
  test('ordinary customer can describe cargo without knowing CBM and understands the states', async ({ page }) => {
    const state = baseState()
    await loginAs(page, customer)
    await mockApi(page, state, customer)
    await page.goto('/diaspora/containers', { waitUntil: 'domcontentloaded' })

    await expect(page.getByTestId('trade-my-shipping')).toBeVisible()
    await expect(page.getByText(/Move goods you already own or bought/i)).toBeVisible()
    await page.getByRole('button', { name: /New shipping request/i }).click()

    await page.getByTestId('logistics-cargo-description').fill('14 household cartons')
    await page.locator('input[type="number"]').first().fill('14')
    await page.getByRole('button', { name: /^Continue/i }).click()

    await expect(page.getByText(/CBM means cubic metres/i)).toBeVisible()
    await page.getByLabel("I don’t know yet").check()
    await expect(page.getByText(/That is okay/i)).toBeVisible()
    await page.getByRole('button', { name: /^Continue/i }).click()
    await page.getByRole('button', { name: /^Continue/i }).click()

    await expect(page.getByText(/Publishing does not book or approve container space/i)).toBeVisible()
    await expect(page.getByText(/Not shown in the opportunity/i)).toBeVisible()
    await page.getByRole('button', { name: /Publish shipping request/i }).click()

    await expect(page.getByTestId('logistics-request-detail')).toBeVisible()
    expect(state.createdRequestPayloads).toHaveLength(1)
    expect(state.createdRequestPayloads[0].items[0].description).toBe('14 household cartons')
    expect(state.createdRequestPayloads[0].items[0].estimated_volume_cbm).toBeUndefined()
    await expect(page.getByText(/Volume not recorded/i)).toBeVisible()
  })

  test('guided dimensions produce an estimate rather than requiring freight knowledge', async ({ page }) => {
    const state = baseState()
    await loginAs(page, customer)
    await mockApi(page, state, customer)
    await page.goto('/diaspora/containers', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: /New shipping request/i }).click()
    await page.getByTestId('logistics-cargo-description').fill('14 cartons')
    await page.locator('input[type="number"]').first().fill('14')
    await page.getByRole('button', { name: /^Continue/i }).click()
    await page.getByLabel(/Help me calculate it/i).check()

    const numbers = page.locator('[data-testid="logistics-request-wizard"] input[type="number"]')
    await numbers.nth(0).fill('60')
    await numbers.nth(1).fill('45')
    await numbers.nth(2).fill('40')
    await page.getByRole('button', { name: /^Continue/i }).click()
    await page.getByRole('button', { name: /^Continue/i }).click()
    await page.getByRole('button', { name: /Publish shipping request/i }).click()

    // Wait for the request to actually reach the API before reading what was captured: click()
    // returns when the click is dispatched, not when the POST has been served, so asserting on
    // `state` straight after it is a race that fails whenever the round trip has not completed.
    await expect(page.getByTestId('logistics-request-detail')).toBeVisible()

    const payload = state.createdRequestPayloads[0]
    expect(payload.items[0].length_value).toBe(60)
    expect(payload.items[0].width_value).toBe(45)
    expect(payload.items[0].height_value).toBe(40)
    expect(payload.items[0].dimension_unit).toBe('cm')
  })

  test('a vehicle cargo group reuses a CarUp vehicle instead of asking for it again', async ({ page }) => {
    const state = baseState()
    await loginAs(page, customer)
    await mockApi(page, state, customer, false, [
      { id: 'v1', vin: 'JTDKN3DU0A1234567', make: 'Toyota', model: 'Aqua', year: 2018, trim: 'S' },
      { id: 'v2', vin: 'JHMGE8H599S000111', make: 'Honda', model: 'Fit', year: 2016 },
    ])
    await page.goto('/diaspora/containers', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: /New shipping request/i }).click()

    const group = page.getByTestId('logistics-cargo-item').first()
    await group.locator('select').first().selectOption('vehicle')

    // Linking reuses the identity CarUp already holds — the person does not retype year/make/model.
    await page.getByTestId('logistics-vehicle-select').selectOption('JTDKN3DU0A1234567')
    await expect(page.getByTestId('logistics-cargo-description')).toHaveValue('2018 Toyota Aqua S')
    await expect(page.getByTestId('logistics-vehicle-linked')).toBeVisible()

    await page.getByRole('button', { name: /^Continue/i }).click()
    await page.getByRole('button', { name: /^Continue/i }).click()
    await page.getByRole('button', { name: /^Continue/i }).click()
    await page.getByRole('button', { name: /Publish shipping request/i }).click()
    await expect(page.getByTestId('logistics-request-detail')).toBeVisible()

    const item = state.createdRequestPayloads[0].items[0]
    expect(item.linked_vehicle_vin).toBe('JTDKN3DU0A1234567')
    expect(item.description).toBe('2018 Toyota Aqua S')
  })

  test('a vehicle can still be described manually, and an unreadable vehicle list never blocks that', async ({ page }) => {
    const state = baseState()
    await loginAs(page, customer)
    await mockApi(page, state, customer, false, 'unreadable')
    await page.goto('/diaspora/containers', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: /New shipping request/i }).click()

    const group = page.getByTestId('logistics-cargo-item').first()
    await group.locator('select').first().selectOption('vehicle')

    // A failed read is stated as a failed read — never as "you have no vehicles" (DESIGN.md §8).
    await expect(page.getByTestId('logistics-vehicle-unreadable')).toBeVisible()

    // …and manual capture still works, so the person is not blocked by CarUp's own outage.
    await page.getByTestId('logistics-cargo-description').fill('2004 Nissan Caravan van')
    await page.getByRole('button', { name: /^Continue/i }).click()
    await page.getByRole('button', { name: /^Continue/i }).click()
    await page.getByRole('button', { name: /^Continue/i }).click()
    await page.getByRole('button', { name: /Publish shipping request/i }).click()
    await expect(page.getByTestId('logistics-request-detail')).toBeVisible()

    const item = state.createdRequestPayloads[0].items[0]
    expect(item.description).toBe('2004 Nissan Caravan van')
    expect(item.linked_vehicle_vin).toBeUndefined()
  })

  test('logistics provider gets a provider workspace and reviews a transparent offer before submit', async ({ page }) => {
    const state = baseState()
    state.opportunities = [openOpportunity]
    await loginAs(page, provider)
    await mockApi(page, state, provider, true)
    await page.goto('/diaspora/containers', { waitUntil: 'domcontentloaded' })

    await page.getByTestId('shipping-tab-provider').click()
    await expect(page.getByTestId('logistics-provider-workspace')).toBeVisible()
    const card = page.getByTestId('logistics-opportunity')
    await expect(card).toContainText('14 household cartons')
    await expect(card).toContainText(/Yokohama, Japan.*Harare, Zimbabwe/)
    // The safe projection contains no customer identity/contact display.
    await expect(card).not.toContainText(customer.name)
    await expect(card).not.toContainText(customer.email)

    await card.getByRole('button', { name: /Prepare offer/i }).click()
    const composer = page.getByTestId('logistics-quote-composer')
    await composer.getByLabel(/CarUp sailing/i).selectOption('container-hikari')
    await composer.getByLabel(/Freight charge/i).fill('700')
    await composer.getByLabel(/Handling/i).fill('100')
    await composer.getByLabel(/Offer total/i).fill('800')
    await composer.getByLabel('Included (comma separated)', { exact: true }).fill('export handling, port delivery')
    await composer.getByLabel('Excluded (comma separated)', { exact: true }).fill('customs duty')
    await composer.getByRole('button', { name: /Review offer/i }).click()

    await expect(composer).toContainText(/Exactly what the customer will compare/i)
    await expect(composer).toContainText('Hikari Co-Load Logistics')
    await expect(composer).toContainText('800 USD')
    await composer.getByRole('button', { name: /Submit offer/i }).click()

    // Submitting closes the composer and moves the provider to My offers; wait for that before
    // reading the captured payload, for the same reason as above.
    await expect(composer).toBeHidden()

    expect(state.quotePayloads).toHaveLength(1)
    expect(state.quotePayloads[0].compatible_container_id).toBe('container-hikari')
    expect(state.quotePayloads[0].freight_amount).toBe(700)
    expect(state.quotePayloads[0].handling_amount).toBe(100)
    expect(state.quotePayloads[0].total_amount).toBe(800)
    expect(state.quotePayloads[0].submit).toBe(true)
  })
})
