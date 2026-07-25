import { expect, test, type Page, type Route } from '@playwright/test'

type TestUser = { id: string; name: string; email: string; role: string }

const buyerUser: TestUser = { id: 'buyer-1', name: 'Buyer', email: 'buyer@carup.test', role: 'owner' }
const sellerUser: TestUser = { id: 'seller-1', name: 'Seller', email: 'seller@carup.test', role: 'dealer' }
const mechanicUser: TestUser = { id: 'mech-1', name: 'Mech', email: 'mech@carup.test', role: 'mechanic' }

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

async function loginAs(page: Page, user: TestUser, token = 'mock-token') {
  await page.addInitScript(({ user, token }) => {
    window.localStorage.setItem('carup_user', JSON.stringify(user))
    window.localStorage.setItem('carup_token', token)
  }, { user, token })
}

interface Rfq { published: boolean; publishedAt?: string; acceptedQuoteId?: string }
interface Order {
  id: string
  order_type: string
  origin_country: string
  requested_make?: string | null
  requested_model?: string | null
  status: string
  metadata: { rfq: Rfq }
}
interface Quote {
  id: string
  import_order_id: string
  seller_id?: string
  quote_amount: number
  quote_currency: string
  status: string
}
interface QuotePayload { quote_amount: number; submit?: boolean; idempotencyKey?: string }
interface RfqState { orders: Order[]; quotes: Quote[]; acceptPayloads: unknown[]; quotePayloads: QuotePayload[]; seq: number }
function initialState(): RfqState { return { orders: [], quotes: [], acceptPayloads: [], quotePayloads: [], seq: 0 } }

async function mockRfqApi(page: Page, state: RfqState, user: TestUser) {
  await page.context().route('**/api/auth/me', (r) => fulfillJson(r, { user }))
  await page.context().route('**/api/security/csrf-token', (r) => fulfillJson(r, { csrfToken: 'mock-csrf' }))

  await page.context().route('**/api/diaspora/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()

    if (method === 'GET' && path.endsWith('/diaspora/buyer-orders')) { await fulfillJson(route, { data: state.orders }); return }
    if (method === 'POST' && path.endsWith('/diaspora/buyer-orders')) {
      const p = JSON.parse(route.request().postData() || '{}')
      const order = { id: `ord-${++state.seq}`, order_type: p.order_type, origin_country: p.origin_country, requested_make: p.requested_make || null, requested_model: p.requested_model || null, status: 'IMPORT_REQUESTED', metadata: { rfq: { published: false } } }
      state.orders.push(order)
      await fulfillJson(route, { data: order }, 201); return
    }
    const detailMatch = path.match(/\/diaspora\/buyer-orders\/([^/]+)$/)
    if (method === 'GET' && detailMatch) {
      const order = state.orders.find((o) => o.id === detailMatch[1])
      await fulfillJson(route, { data: { ...order, quotes: state.quotes.filter((q) => q.import_order_id === order.id) } }); return
    }
    const publishMatch = path.match(/\/diaspora\/buyer-orders\/([^/]+)\/publish-rfq$/)
    if (method === 'POST' && publishMatch) {
      const order = state.orders.find((o) => o.id === publishMatch[1])
      order.metadata = { rfq: { published: true, publishedAt: '2026-06-20T00:00:00Z' } }
      order.status = 'QUOTE_ISSUED'
      await fulfillJson(route, { data: order }); return
    }
    const matchesMatch = path.match(/\/diaspora\/buyer-orders\/([^/]+)\/matches$/)
    if (method === 'GET' && matchesMatch) {
      await fulfillJson(route, { data: [{ stockItemId: 'stk-1', partName: 'Camry bumper', score: 50, available: 4, reasons: ['Make matches Toyota', 'Available quantity 4'] }] }); return
    }
    const acceptMatch = path.match(/\/diaspora\/buyer-orders\/([^/]+)\/accept-quote$/)
    if (method === 'POST' && acceptMatch) {
      const p = JSON.parse(route.request().postData() || '{}')
      state.acceptPayloads.push(p)
      const order = state.orders.find((o) => o.id === acceptMatch[1])
      order.metadata = { rfq: { ...order.metadata.rfq, acceptedQuoteId: p.quoteId } }
      state.quotes.forEach((q) => { if (q.import_order_id === order.id) q.status = q.id === p.quoteId ? 'ACCEPTED' : 'REJECTED' })
      await fulfillJson(route, { data: { order, acceptedQuote: state.quotes.find((q) => q.id === p.quoteId), idempotentReplay: false } }); return
    }
    const quoteCreateMatch = path.match(/\/diaspora\/buyer-orders\/([^/]+)\/quotes$/)
    if (method === 'POST' && quoteCreateMatch) {
      const p = JSON.parse(route.request().postData() || '{}')
      state.quotePayloads.push(p)
      const quote = { id: `q-${++state.seq}`, import_order_id: quoteCreateMatch[1], seller_id: user.id, quote_amount: p.quote_amount, quote_currency: p.quote_currency || 'USD', status: p.submit ? 'ISSUED' : 'DRAFT' }
      state.quotes.push(quote)
      await fulfillJson(route, { data: { quote, idempotentReplay: false } }, 201); return
    }
    if (method === 'GET' && path.endsWith('/diaspora/rfqs')) {
      await fulfillJson(route, { data: state.orders.filter((o) => o.metadata?.rfq?.published && !o.metadata?.rfq?.acceptedQuoteId) }); return
    }
    await fulfillJson(route, { data: [] })
  })
}

test.describe('Diaspora Reverse RFQ (Phase 4)', () => {
  test('unauthorized role is denied', async ({ page }) => {
    const state = initialState()
    await loginAs(page, mechanicUser, 'mech-token')
    await mockRfqApi(page, state, mechanicUser)
    await page.goto('/diaspora/rfq', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('diaspora-rfq-access-denied')).toBeVisible()
  })

  test('buyer creates demand, publishes RFQ, sees matches', async ({ page }) => {
    const state = initialState()
    await loginAs(page, buyerUser, 'buyer-token')
    await mockRfqApi(page, state, buyerUser)
    await page.goto('/diaspora/rfq', { waitUntil: 'domcontentloaded' })

    await expect(page.getByTestId('diaspora-rfq-page')).toBeVisible()
    await page.getByTestId('diaspora-buyer-order-origin').fill('Japan')
    await page.getByTestId('diaspora-buyer-order-make').fill('Toyota')
    await page.getByTestId('diaspora-buyer-order-submit').click()

    await expect(page.getByTestId('diaspora-buyer-order-row')).toHaveCount(1)
    await page.getByTestId('diaspora-buyer-order-publish').click()
    await expect(page.getByTestId('diaspora-buyer-order-row').getByText('RFQ open')).toBeVisible()

    await page.getByTestId('diaspora-buyer-order-select').click()
    await expect(page.getByTestId('diaspora-rfq-match-row')).toHaveCount(1)
    await expect(page.getByTestId('diaspora-rfq-matches')).toContainText('Make matches Toyota')
  })

  test('seller sees published RFQ and submits a quote (contract payload)', async ({ page }) => {
    const state = initialState()
    state.orders.push({ id: 'ord-x', order_type: 'parts', origin_country: 'Japan', requested_make: 'Toyota', status: 'QUOTE_ISSUED', metadata: { rfq: { published: true } } })
    await loginAs(page, sellerUser, 'seller-token')
    await mockRfqApi(page, state, sellerUser)
    await page.goto('/diaspora/rfq', { waitUntil: 'domcontentloaded' })

    await expect(page.getByTestId('diaspora-rfq-open-row')).toHaveCount(1)
    await page.getByTestId('diaspora-rfq-quote-amount').fill('450')
    await page.getByTestId('diaspora-rfq-quote-submit').click()

    await expect.poll(() => state.quotePayloads.length).toBe(1)
    expect(state.quotePayloads[0].quote_amount).toBe(450)
    expect(state.quotePayloads[0].submit).toBe(true)
    expect(typeof state.quotePayloads[0].idempotencyKey).toBe('string')
  })

  test('buyer accepts a single quote', async ({ page }) => {
    const state = initialState()
    state.orders.push({ id: 'ord-y', order_type: 'parts', origin_country: 'Japan', status: 'QUOTE_ISSUED', metadata: { rfq: { published: true } } })
    state.quotes.push({ id: 'q-a', import_order_id: 'ord-y', quote_amount: 500, quote_currency: 'USD', status: 'ISSUED' })
    state.quotes.push({ id: 'q-b', import_order_id: 'ord-y', quote_amount: 480, quote_currency: 'USD', status: 'ISSUED' })
    await loginAs(page, buyerUser, 'buyer-token')
    await mockRfqApi(page, state, buyerUser)
    await page.goto('/diaspora/rfq', { waitUntil: 'domcontentloaded' })

    await page.getByTestId('diaspora-buyer-order-select').click()
    await expect(page.getByTestId('diaspora-rfq-quote-row')).toHaveCount(2)
    await page.getByTestId('diaspora-rfq-accept').first().click()

    await expect.poll(() => state.acceptPayloads.length).toBe(1)
    await expect(page.getByTestId('diaspora-rfq-accepted-badge')).toBeVisible()
    // no payment-release control anywhere on the page
    await expect(page.getByRole('button', { name: /release payment/i })).toHaveCount(0)
  })
})
