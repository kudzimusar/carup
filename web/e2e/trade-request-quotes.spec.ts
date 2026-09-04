import { expect, test, type Page, type Route } from '@playwright/test'

/**
 * Trade OS T2 — Request Quotes buyer + supplier journeys (mocked).
 *
 * These are comprehension regressions, not just element checks: they fail if a first-time buyer
 * cannot get through the wizard without a part number, if the privacy preview stops telling the
 * buyer what suppliers see, if a supplier's opportunity stops explaining why it may suit them, or
 * if a missing commercial term starts rendering as anything other than "Not provided".
 */

type TestUser = { id: string; name: string; email: string; role: string; active_tenant_id?: string; tenant_role?: string }

const buyer: TestUser = { id: 'b-1', name: 'Tendai M', email: 'b@carup.test', role: 'owner' }
const seller: TestUser = { id: 's-1', name: 'Tokyo Auto Parts', email: 's@carup.test', role: 'dealer' }

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

interface State {
  orders: Array<Record<string, unknown>>
  opportunities: Array<Record<string, unknown>>
  myQuotes: Array<Record<string, unknown>>
  createdPayloads: Array<Record<string, unknown>>
  quotePayloads: Array<Record<string, unknown>>
  published: string[]
}

function initial(): State {
  return { orders: [], opportunities: [], myQuotes: [], createdPayloads: [], quotePayloads: [], published: [] }
}

async function mockApi(page: Page, state: State, user: TestUser) {
  await page.context().route('**/api/auth/me', (r) => fulfillJson(r, { user }))
  await page.context().route('**/api/security/csrf-token', (r) => fulfillJson(r, { csrfToken: 'mock-csrf' }))
  await page.context().route('**/api/vehicles**', (r) => fulfillJson(r, { data: [] }))
  await page.context().route('**/api/diaspora/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()

    if (path.endsWith('/container-marketplace/trade-context')) {
      return fulfillJson(route, { data: { user: { id: user.id, name: user.name }, organisation: null, tenant_role: null, is_organisation_admin: false, account_kind: 'individual', business_type: null, organization_name: null, market_relationship: 'diaspora', country_of_residence: 'United Kingdom', city: 'London' } })
    }
    if (method === 'GET' && path.endsWith('/diaspora/buyer-orders')) return fulfillJson(route, { data: state.orders })
    if (method === 'POST' && path.endsWith('/diaspora/buyer-orders')) {
      const payload = JSON.parse(route.request().postData() || '{}')
      state.createdPayloads.push(payload)
      const order = { id: 'order-new', status: 'IMPORT_REQUESTED', metadata: { rfq: { published: false } }, request_lines: (payload.lines || []).map((l: Record<string, unknown>, i: number) => ({ ...l, id: `l${i}`, line_number: i + 1 })), quotes: [], rfq_lifecycle: 'DRAFT', ...payload }
      state.orders.push(order)
      return fulfillJson(route, { data: order }, 201)
    }
    const publishMatch = path.match(/\/buyer-orders\/([^/]+)\/publish-rfq$/)
    if (method === 'POST' && publishMatch) {
      state.published.push(publishMatch[1])
      const order = state.orders.find((o) => o.id === publishMatch[1])
      if (order) { order.metadata = { rfq: { published: true } }; order.rfq_lifecycle = 'OPEN_FOR_QUOTES' }
      return fulfillJson(route, { data: order })
    }
    const detailMatch = path.match(/\/diaspora\/buyer-orders\/([^/]+)$/)
    if (method === 'PATCH' && detailMatch) {
      const payload = JSON.parse(route.request().postData() || '{}')
      state.createdPayloads.push(payload)
      const order = state.orders.find((o) => o.id === detailMatch[1])
      if (order) Object.assign(order, payload)
      return fulfillJson(route, { data: order || { id: detailMatch[1], ...payload } })
    }
    if (method === 'PATCH' && /\/diaspora\/quotes\/[^/]+$/.test(path)) {
      state.quotePayloads.push(JSON.parse(route.request().postData() || '{}'))
      return fulfillJson(route, { data: { id: 'q-draft' } })
    }
    if (method === 'GET' && detailMatch) {
      const order = state.orders.find((o) => o.id === detailMatch[1])
      return order ? fulfillJson(route, { data: order }) : fulfillJson(route, { error: 'not found' }, 404)
    }
    if (method === 'GET' && path.endsWith('/diaspora/rfqs')) return fulfillJson(route, { data: state.opportunities })
    if (method === 'GET' && path.endsWith('/diaspora/my-quotes')) return fulfillJson(route, { data: state.myQuotes })
    const quoteMatch = path.match(/\/buyer-orders\/([^/]+)\/quotes$/)
    if (method === 'POST' && quoteMatch) {
      const payload = JSON.parse(route.request().postData() || '{}')
      state.quotePayloads.push(payload)
      return fulfillJson(route, { data: { quote: { id: 'q-new', import_order_id: quoteMatch[1], ...payload } } }, 201)
    }
    return fulfillJson(route, { data: [] })
  })
}

/** The safe marketplace projection — exactly the shape the backend returns to a supplier. */
function opportunity(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    reference: 'RFQ-ABC12345',
    order_type: 'parts',
    requested_make: 'Honda',
    requested_model: 'Fit',
    requested_year_min: null,
    requested_year_max: null,
    origin_country: 'Japan',
    destination_country: 'Zimbabwe',
    destination_city: 'Harare',
    budget_amount: null,
    budget_currency: null,
    budget_disclosed: false,
    needed_by: '2026-10-30',
    urgency: 'HIGH',
    buyer_notes: null,
    published_at: '2026-09-04T00:00:00.000Z',
    quote_deadline: null,
    quote_count: 3,
    supplier_match: null,
    lines: [
      { id: 'l1', line_number: 1, item_description: 'Front shocks', item_kind: 'part', quantity: 20, vehicle_make: 'Honda', vehicle_model: 'Fit', part_number: null, part_number_known: false, condition_preference: 'new', notes: null },
    ],
    ...overrides,
  }
}

test.describe('Trade OS T2 — Request Quotes', () => {
  // ── Buyer ────────────────────────────────────────────────────────────────

  test('buyer chooses an intention in plain language, not a feature name', async ({ page }) => {
    const state = initial()
    await loginAs(page, buyer)
    await mockApi(page, state, buyer)
    await page.goto('/diaspora/request-quotes', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('trade-request-intent')).toBeVisible()
    await expect(page.getByTestId('trade-intent-buy')).toContainText(/Buy something/i)
    await expect(page.getByTestId('trade-intent-ship')).toContainText(/Ship something/i)
    // The internal domain term must not be the primary label a customer reads.
    await expect(page.getByText('Reverse RFQ', { exact: true })).toHaveCount(0)
  })

  test('a buyer with NO part number can complete the whole parts request (owner UAT comprehension)', async ({ page }) => {
    const state = initial()
    await loginAs(page, buyer)
    await mockApi(page, state, buyer)
    await page.goto('/diaspora/request-quotes', { waitUntil: 'domcontentloaded' })

    await page.getByTestId('trade-intent-buy').click()
    await page.getByTestId('trade-kind-parts').click()

    // "I don't know it" is preselected and explicitly reassuring.
    await expect(page.getByTestId('trade-part-number-reassurance')).toContainText(/most buyers don't/i)
    await page.getByTestId('trade-part-description').fill('Front shocks')
    await page.getByTestId('trade-part-quantity').fill('20')
    await page.getByTestId('trade-part-vehicle-make').selectOption('Honda')
    await page.getByTestId('trade-request-next').click()

    await page.getByTestId('trade-destination-city').fill('Harare')
    await page.getByTestId('trade-request-next').click()
    await page.getByTestId('trade-request-next').click()

    // Review states, in words, what was asked for.
    await expect(page.getByTestId('trade-review-title')).toContainText('Front shocks')
    await page.getByTestId('trade-request-publish').click()

    await expect(page).toHaveURL(/\/diaspora\/requests\/order-new/)
    const payload = state.createdPayloads[0]
    expect(payload.order_type).toBe('parts')
    expect(payload.destination_city).toBe('Harare')
    const lines = payload.lines as Array<Record<string, unknown>>
    expect(lines[0].item_description).toBe('Front shocks')
    expect(lines[0].quantity).toBe(20)
    // Not knowing the part number is recorded as a real answer.
    expect(lines[0].part_number_known).toBe(false)
    // Publishing is a SEPARATE governed step, never implied by saving.
    expect(state.published).toEqual(['order-new'])
  })

  test('the review step tells the buyer exactly what suppliers will and will not see', async ({ page }) => {
    const state = initial()
    await loginAs(page, buyer)
    await mockApi(page, state, buyer)
    await page.goto('/diaspora/request-quotes', { waitUntil: 'domcontentloaded' })
    await page.getByTestId('trade-intent-buy').click()
    await page.getByTestId('trade-kind-vehicle').click()
    await page.getByTestId('trade-vehicle-make').selectOption('Toyota')
    await page.getByTestId('trade-request-next').click()
    await page.getByTestId('trade-request-next').click()
    await page.getByTestId('trade-budget-amount').fill('7000')
    await page.getByTestId('trade-request-next').click()

    const preview = page.getByTestId('trade-privacy-preview')
    await expect(preview).toContainText(/What suppliers will see/i)
    await expect(preview).toContainText(/Never shared/i)
    await expect(preview).toContainText(/name, email and phone/i)
    // Budget is private unless the buyer opts in — so it appears under "Never shared".
    await expect(preview).toContainText(/Your budget/i)
  })

  test('budget is only shared when the buyer explicitly opts in', async ({ page }) => {
    const state = initial()
    await loginAs(page, buyer)
    await mockApi(page, state, buyer)
    await page.goto('/diaspora/request-quotes', { waitUntil: 'domcontentloaded' })
    await page.getByTestId('trade-intent-buy').click()
    await page.getByTestId('trade-kind-vehicle').click()
    await page.getByTestId('trade-vehicle-make').selectOption('Toyota')
    await page.getByTestId('trade-request-next').click()
    await page.getByTestId('trade-request-next').click()
    await page.getByTestId('trade-budget-amount').fill('7000')
    await page.getByTestId('trade-disclose-budget').check()
    await page.getByTestId('trade-request-next').click()
    await page.getByTestId('trade-request-publish').click()
    await expect(page).toHaveURL(/\/diaspora\/requests\/order-new/)
    expect(state.createdPayloads[0].disclose_budget).toBe(true)
    expect(state.createdPayloads[0].budget_amount).toBe(7000)
  })

  test('a multi-item request is ONE request with several lines', async ({ page }) => {
    const state = initial()
    await loginAs(page, buyer)
    await mockApi(page, state, buyer)
    await page.goto('/diaspora/request-quotes', { waitUntil: 'domcontentloaded' })
    await page.getByTestId('trade-intent-buy').click()
    await page.getByTestId('trade-kind-mixed').click()
    await page.getByTestId('trade-part-description').first().fill('Front shocks')
    await page.getByTestId('trade-add-item').click()
    await page.getByTestId('trade-part-description').nth(1).fill('Brake pads')
    await page.getByTestId('trade-request-next').click()
    await page.getByTestId('trade-request-next').click()
    await page.getByTestId('trade-request-next').click()
    await page.getByTestId('trade-request-publish').click()
    await expect(page).toHaveURL(/\/diaspora\/requests\/order-new/)
    const lines = state.createdPayloads[0].lines as Array<Record<string, unknown>>
    expect(lines).toHaveLength(2)
    expect(state.createdPayloads[0].order_type).toBe('mixed')
    expect(state.createdPayloads).toHaveLength(1)
  })

  test('the Ship path is honest about what is and is not available yet', async ({ page }) => {
    const state = initial()
    await loginAs(page, buyer)
    await mockApi(page, state, buyer)
    await page.goto('/diaspora/request-quotes', { waitUntil: 'domcontentloaded' })
    await page.getByTestId('trade-intent-ship').click()
    await expect(page.getByTestId('trade-ship-containers')).toBeVisible()
    await expect(page.getByText(/is not available yet/i)).toBeVisible()
  })

  // ── Buyer: offers and the decision ───────────────────────────────────────

  test('offers compare on real terms and a missing term reads "Not provided"', async ({ page }) => {
    const state = initial()
    state.orders.push({
      id: 'order-1', status: 'QUOTE_ISSUED', order_type: 'parts',
      destination_country: 'Zimbabwe', destination_city: 'Harare', origin_country: 'Japan',
      metadata: { rfq: { published: true } }, rfq_lifecycle: 'QUOTES_RECEIVED',
      request_lines: [{ id: 'l1', line_number: 1, item_description: 'Front shocks', quantity: 20, part_number_known: false }],
      quotes: [
        { id: 'q1', import_order_id: 'order-1', quote_amount: 900, quote_currency: 'USD', status: 'ISSUED', offered_quantity: 20, lead_time_days: 5, shipping_included: true },
        // q2 states nothing about shipping or dispatch — those must not be assumed.
        { id: 'q2', import_order_id: 'order-1', quote_amount: 700, quote_currency: 'USD', status: 'ISSUED' },
      ],
    })
    await loginAs(page, buyer)
    await mockApi(page, state, buyer)
    await page.goto('/diaspora/requests/order-1', { waitUntil: 'domcontentloaded' })

    await expect(page.getByTestId('trade-offer-card')).toHaveCount(2)
    const cheapest = page.getByTestId('trade-offer-card').filter({ hasText: '700' })
    await expect(cheapest).toContainText('Not provided')
    // Deterministic, fact-based highlights only.
    await expect(cheapest.getByTestId('trade-offer-highlights')).toContainText('Lowest recorded total')
    const better = page.getByTestId('trade-offer-card').filter({ hasText: '900' })
    await expect(better.getByTestId('trade-offer-highlights')).toContainText('Shipping included')
    // Only ONE supplier stated a dispatch time, so there is nothing to be "fastest" against and
    // CarUp makes no such claim. A comparative highlight requires something to compare.
    await expect(page.getByText('Fastest stated dispatch')).toHaveCount(0)
    // No invented score or recommendation.
    await expect(page.getByText(/best deal|recommended|%/i)).toHaveCount(0)
  })

  test('offers in different currencies are never silently compared', async ({ page }) => {
    const state = initial()
    state.orders.push({
      id: 'order-1', status: 'QUOTE_ISSUED', metadata: { rfq: { published: true } }, rfq_lifecycle: 'QUOTES_RECEIVED',
      request_lines: [], destination_country: 'Zimbabwe',
      quotes: [
        { id: 'q1', import_order_id: 'order-1', quote_amount: 900, quote_currency: 'USD', status: 'ISSUED' },
        { id: 'q2', import_order_id: 'order-1', quote_amount: 100000, quote_currency: 'JPY', status: 'ISSUED' },
      ],
    })
    await loginAs(page, buyer)
    await mockApi(page, state, buyer)
    await page.goto('/diaspora/requests/order-1', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('trade-mixed-currency-note')).toContainText(/does not convert/i)
    // With no comparable basis, no "lowest" claim is made.
    await expect(page.getByText('Lowest recorded total')).toHaveCount(0)
  })

  test('after choosing a supplier the user is shown the trade, not left in the marketplace', async ({ page }) => {
    const state = initial()
    state.orders.push({
      id: 'order-1', status: 'SELLER_ASSIGNED', rfq_lifecycle: 'AWARDED', request_lines: [],
      destination_country: 'Zimbabwe',
      metadata: { rfq: { published: true, acceptedQuoteId: 'q1' } },
      quotes: [{ id: 'q1', import_order_id: 'order-1', quote_amount: 900, quote_currency: 'USD', status: 'ACCEPTED' }],
    })
    await loginAs(page, buyer)
    await mockApi(page, state, buyer)
    await page.goto('/diaspora/requests/order-1', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('trade-request-status')).toContainText('Supplier selected')
    const next = page.getByTestId('trade-next-step')
    await expect(next).toContainText(/What happens next/i)
    // Unstarted downstream stages are shown truthfully, not as progress.
    await expect(next).toContainText(/Shipping — not arranged/i)
    await expect(next).toContainText(/Documents — not started/i)
    await expect(page.getByTestId('trade-open-order')).toBeVisible()
  })

  test('an unreadable request never renders as "you have no requests"', async ({ page }) => {
    const state = initial()
    await loginAs(page, buyer)
    await mockApi(page, state, buyer)
    await page.goto('/diaspora/requests/missing-order', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('trade-request-unreadable')).toContainText(/not a report that it does not exist/i)
  })

  test('the buyer empty state teaches the product instead of reporting zero', async ({ page }) => {
    const state = initial()
    await loginAs(page, buyer)
    await mockApi(page, state, buyer)
    await page.goto('/diaspora/requests', { waitUntil: 'domcontentloaded' })
    const empty = page.getByTestId('trade-requests-empty')
    await expect(empty).toContainText(/haven't requested any quotes yet/i)
    await expect(empty).toContainText(/do not need a part number/i)
  })

  // ── Supplier ─────────────────────────────────────────────────────────────

  test('supplier opportunity explains the need and why it may suit them', async ({ page }) => {
    const state = initial()
    state.opportunities.push(opportunity())
    await loginAs(page, seller)
    await mockApi(page, state, seller)
    await page.goto('/diaspora/buyer-requests', { waitUntil: 'domcontentloaded' })

    const card = page.getByTestId('trade-opportunity-card')
    await expect(card).toHaveCount(1)
    await expect(card.getByTestId('trade-opportunity-title')).toContainText('Front shocks')
    await expect(card.getByTestId('trade-opportunity-lines')).toContainText('20 ×')
    await expect(card.getByTestId('trade-opportunity-lines')).toContainText(/does not know the part number/i)
    // With no matching stock the supplier is told so plainly rather than shown request facts
    // dressed up as a reason (owner audit item 3).
    await expect(card.getByTestId('trade-no-match')).toContainText(/No stock match confirmed yet/i)
    await expect(card.getByTestId('trade-opportunity-quote-count')).toContainText('3 offers sent')
    // Buyer identity must never appear on a supplier surface.
    await expect(page.getByText(/Tendai/i)).toHaveCount(0)
  })

  test('supplier builds a real commercial offer, not just an amount', async ({ page }) => {
    const state = initial()
    state.opportunities.push(opportunity())
    await loginAs(page, seller)
    await mockApi(page, state, seller)
    await page.goto('/diaspora/buyer-requests', { waitUntil: 'domcontentloaded' })
    await page.getByTestId('trade-prepare-offer').click()

    // Quantity is prefilled from what the buyer asked for.
    await expect(page.getByTestId('trade-offer-quantity')).toHaveValue('20')
    await page.getByTestId('trade-offer-description').fill('New KYB front shocks')
    await page.getByTestId('trade-offer-unit-price').fill('45')
    await page.getByTestId('trade-offer-amount').fill('900')
    await page.getByTestId('trade-offer-lead-time').fill('5')
    await page.getByTestId('trade-offer-shipping').selectOption('included')
    await page.getByTestId('trade-offer-exclusions').fill('customs duty, delivery')
    await expect(page.getByTestId('trade-offer-subtotal')).toContainText('900')
    // An offer is reviewed before it becomes irrevocable (owner audit item 7).
    await page.getByTestId('trade-offer-review').click()
    await expect(page.getByTestId('trade-offer-review-panel')).toContainText('900')
    await page.getByTestId('trade-offer-submit').click()
    await expect(page.getByTestId('trade-my-offers')).toBeVisible()

    const sent = state.quotePayloads[0]
    expect(sent.quote_amount).toBe(900)
    expect(sent.offered_quantity).toBe(20)
    expect(sent.unit_price).toBe(45)
    expect(sent.lead_time_days).toBe(5)
    expect(sent.shipping_included).toBe(true)
    expect(sent.exclusions).toEqual(['customs duty', 'delivery'])
    expect(sent.submit).toBe(true)
  })

  test('a supplier who says nothing about shipping sends NULL, not false', async ({ page }) => {
    const state = initial()
    state.opportunities.push(opportunity())
    await loginAs(page, seller)
    await mockApi(page, state, seller)
    await page.goto('/diaspora/buyer-requests', { waitUntil: 'domcontentloaded' })
    await page.getByTestId('trade-prepare-offer').click()
    await page.getByTestId('trade-offer-amount').fill('700')
    await page.getByTestId('trade-offer-review').click()
    await page.getByTestId('trade-offer-submit').click()
    await expect(page.getByTestId('trade-my-offers')).toBeVisible()
    // Absent terms must be absent — never coerced into a commercial claim.
    expect(state.quotePayloads[0]).not.toHaveProperty('shipping_included')
    expect(state.quotePayloads[0]).not.toHaveProperty('lead_time_days')
  })

  test('supplier can save a draft offer instead of submitting', async ({ page }) => {
    const state = initial()
    state.opportunities.push(opportunity())
    await loginAs(page, seller)
    await mockApi(page, state, seller)
    await page.goto('/diaspora/buyer-requests', { waitUntil: 'domcontentloaded' })
    await page.getByTestId('trade-prepare-offer').click()
    await page.getByTestId('trade-offer-amount').fill('700')
    await page.getByTestId('trade-offer-save-draft').click()
    await expect(page.getByTestId('trade-my-offers')).toBeVisible()
    expect(state.quotePayloads[0].submit).toBe(false)
  })

  test('"Ask a question" creates a real canonical conversation, not a dead button', async ({ page }) => {
    const state = initial()
    state.opportunities.push(opportunity())
    let conversationCalls = 0
    await loginAs(page, seller)
    await mockApi(page, state, seller)
    await page.context().route('**/buyer-orders/*/conversation', async (route) => {
      conversationCalls += 1
      await fulfillJson(route, { data: { threadId: 'thread-1', role: 'seller', rfqId: 'order-1' } })
    })
    await page.goto('/diaspora/buyer-requests', { waitUntil: 'domcontentloaded' })
    const ask = page.getByTestId('trade-ask-question')
    await expect(ask).toBeVisible()
    // The feed refetches once after its first paint. A click that lands during that
    // re-render is dropped and the assertion below then fails on a button that was
    // never really pressed, so settle the network first and drive the click and its
    // POST together rather than asserting on state the click may not have reached.
    await page.waitForLoadState('networkidle')
    await Promise.all([
      page.waitForResponse((r) => /\/buyer-orders\/[^/]+\/conversation/.test(r.url())),
      ask.click(),
    ])
    // It reaches the canonical Communications surface, where questions are actually read/answered.
    await expect(page).toHaveURL(/\/diaspora\/messages/)
    expect(conversationCalls).toBe(1)
  })

  test('supplier match shows REAL own-stock evidence when it exists (owner audit item 3)', async ({ page }) => {
    const state = initial()
    state.opportunities.push(opportunity({
      supplier_match: {
        score: 75, stock_item_id: 's1', stock_name: 'Front shocks (KYB)',
        available_quantity: 24, export_ready: true,
        reasons: ['Make matches Honda', 'Model matches Fit'],
      },
    }))
    await loginAs(page, seller)
    await mockApi(page, state, seller)
    await page.goto('/diaspora/buyer-requests', { waitUntil: 'domcontentloaded' })
    const reasons = page.getByTestId('trade-match-reasons')
    await expect(reasons).toContainText(/Strong match/i)
    await expect(reasons).toContainText('You have 24 available')
    await expect(reasons).toContainText('Make matches Honda')
    await expect(reasons).toContainText(/export-ready/i)
    // The raw score is never shown as a bare number.
    await expect(page.getByText('75', { exact: true })).toHaveCount(0)
  })

  test('no unfounded "Verified CarUp buyer" claim appears (owner audit item 2)', async ({ page }) => {
    const state = initial()
    state.opportunities.push(opportunity())
    await loginAs(page, seller)
    await mockApi(page, state, seller)
    await page.goto('/diaspora/buyer-requests', { waitUntil: 'domcontentloaded' })
    await expect(page.getByText(/Verified CarUp buyer/i)).toHaveCount(0)
  })

  test('supplier can EDIT a draft offer instead of retyping it (owner audit item 6)', async ({ page }) => {
    const state = initial()
    state.opportunities.push(opportunity())
    state.myQuotes.push({
      quote: { id: 'q-draft', import_order_id: 'order-1', quote_amount: 700, quote_currency: 'USD', status: 'DRAFT', offered_quantity: 20, lead_time_days: 3, offered_description: 'Saved draft text' },
      outcome: 'DRAFT',
      request: opportunity(),
    })
    await loginAs(page, seller)
    await mockApi(page, state, seller)
    await page.goto('/diaspora/buyer-requests', { waitUntil: 'domcontentloaded' })
    await page.getByTestId('trade-tab-mine').click()
    await page.getByTestId('trade-my-offer-edit').click()
    // The saved values are reloaded — nothing is retyped.
    await expect(page.getByTestId('trade-offer-amount')).toHaveValue('700')
    await expect(page.getByTestId('trade-offer-quantity')).toHaveValue('20')
    await expect(page.getByTestId('trade-offer-description')).toHaveValue('Saved draft text')
  })

  test('buyer sees WHO each offer is from before choosing (owner audit item 4)', async ({ page }) => {
    const state = initial()
    state.orders.push({
      id: 'order-1', status: 'QUOTE_ISSUED', metadata: { rfq: { published: true } },
      rfq_lifecycle: 'QUOTES_RECEIVED', request_lines: [], destination_country: 'Zimbabwe',
      quotes: [{
        id: 'q1', import_order_id: 'order-1', quote_amount: 900, quote_currency: 'USD', status: 'ISSUED',
        supplier: { display_name: 'Tokyo Auto Parts Ltd', business_type: 'parts_seller', account_kind: 'business', country: 'Japan', verified: false },
      }],
    })
    await loginAs(page, buyer)
    await mockApi(page, state, buyer)
    await page.goto('/diaspora/requests/order-1', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('trade-offer-supplier')).toContainText('Tokyo Auto Parts Ltd')
    await expect(page.getByTestId('trade-offer-supplier-context')).toContainText(/parts seller/i)
    await expect(page.getByTestId('trade-offer-supplier-context')).toContainText(/not verified by CarUp/i)
  })

  test('buyer can EDIT a draft request instead of recreating it (owner audit item 5)', async ({ page }) => {
    const state = initial()
    state.orders.push({
      id: 'order-draft', status: 'IMPORT_REQUESTED', order_type: 'parts',
      origin_country: 'Japan', destination_country: 'Zimbabwe', destination_city: 'Harare',
      metadata: { rfq: { published: false } }, rfq_lifecycle: 'DRAFT', quotes: [],
      request_lines: [{ id: 'l1', line_number: 1, item_description: 'Saved shocks', quantity: 6, part_number_known: false }],
    })
    await loginAs(page, buyer)
    await mockApi(page, state, buyer)
    await page.goto('/diaspora/requests/order-draft', { waitUntil: 'domcontentloaded' })
    await page.getByTestId('trade-request-edit').click()
    await expect(page).toHaveURL(/edit=order-draft/)
    // The wizard opens populated with the saved draft.
    await expect(page.getByTestId('trade-part-description')).toHaveValue('Saved shocks')
    await expect(page.getByTestId('trade-part-quantity')).toHaveValue('6')
  })

  test('multi-part wording matches what is actually written (owner audit item 8)', async ({ page }) => {
    const state = initial()
    await loginAs(page, buyer)
    await mockApi(page, state, buyer)
    await page.goto('/diaspora/request-quotes', { waitUntil: 'domcontentloaded' })
    await page.getByTestId('trade-intent-buy').click()
    // Every non-vehicle line is written as a PART, so the copy says parts, not "items".
    await expect(page.getByTestId('trade-kind-mixed')).toContainText(/Several parts/i)
    await page.getByTestId('trade-kind-mixed').click()
    await expect(page.getByText(/What parts do you need/i)).toBeVisible()
  })

  test('supplier empty state explains how opportunities arrive', async ({ page }) => {
    const state = initial()
    await loginAs(page, seller)
    await mockApi(page, state, seller)
    await page.goto('/diaspora/buyer-requests', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('trade-opportunities-empty')).toContainText(/When customers publish requests/i)
  })

  test('supplier sees won / not-selected outcomes on their own offers', async ({ page }) => {
    const state = initial()
    state.myQuotes.push(
      { quote: { id: 'q1', import_order_id: 'order-1', quote_amount: 900, quote_currency: 'USD', status: 'ACCEPTED' }, outcome: 'won', request: opportunity() },
      { quote: { id: 'q2', import_order_id: 'order-2', quote_amount: 500, quote_currency: 'USD', status: 'REJECTED' }, outcome: 'not_selected', request: opportunity({ id: 'order-2', reference: 'RFQ-ZZZ99999' }) },
    )
    await loginAs(page, seller)
    await mockApi(page, state, seller)
    await page.goto('/diaspora/buyer-requests', { waitUntil: 'domcontentloaded' })
    await page.getByTestId('trade-tab-mine').click()
    await expect(page.getByTestId('trade-my-offer-card')).toHaveCount(2)
    await expect(page.getByTestId('trade-my-offer-status').first()).toContainText('Won')
    await expect(page.getByTestId('trade-my-offer-status').nth(1)).toContainText('Not selected')
  })

  // ── Geometry ─────────────────────────────────────────────────────────────

  test('no horizontal overflow across desktop classes and phone', async ({ page }) => {
    const state = initial()
    state.opportunities.push(opportunity())
    await loginAs(page, seller)
    await mockApi(page, state, seller)
    for (const [width, height] of [[393, 852], [1024, 768], [1280, 800], [1440, 900]] as Array<[number, number]>) {
      await page.setViewportSize({ width, height })
      await page.goto('/diaspora/buyer-requests', { waitUntil: 'domcontentloaded' })
      await page.getByTestId('trade-prepare-offer').click()
      await expect(page.getByTestId('trade-quote-composer')).toBeVisible()
      const overflow = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth - window.innerWidth,
        body: document.body.scrollWidth - window.innerWidth,
      }))
      expect(overflow.doc, `document overflows by ${overflow.doc}px at ${width}`).toBeLessThanOrEqual(1)
      expect(overflow.body, `body overflows by ${overflow.body}px at ${width}`).toBeLessThanOrEqual(1)
    }
  })
})
