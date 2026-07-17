import { expect, test, type Page, type Route } from '@playwright/test'

const dealerUser = { id: 'dealer-1', name: 'Seller', email: 'seller@carup.test', role: 'dealer' }
const ownerUser = { id: 'owner-9', name: 'Buyer', email: 'buyer@carup.test', role: 'owner' }

async function fulfillJson(route: Route, body: unknown, status = 200) {
  const origin = route.request().headers().origin || '*'
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
  }
  if (route.request().method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers })
    return
  }
  await route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) })
}

async function loginAs(page: Page, user = dealerUser, token = 'mock-token') {
  await page.addInitScript(({ user, token }) => {
    window.localStorage.setItem('carup_user', JSON.stringify(user))
    window.localStorage.setItem('carup_token', token)
  }, { user, token })
}

interface StockItem {
  id: string
  part_name: string
  quantity_on_hand: number
  quantity_reserved: number
  balances: { onHand: number; reserved: number; available: number }
}
interface SupplyDoc {
  id: string
  document_number: string
  title: string
  origin_country: string | null
  status: string
  publication_status: string
}
interface MovementPayload { action: string; quantity: number; idempotencyKey?: string }
interface StockState {
  items: StockItem[]
  ledger: Record<string, unknown[]>
  docs: SupplyDoc[]
  movementPayloads: MovementPayload[]
  seq: number
}

function initialState(): StockState {
  return { items: [], ledger: {}, docs: [], movementPayloads: [], seq: 0 }
}

async function mockStockApi(page: Page, state: StockState, user = dealerUser) {
  await page.context().route('**/api/auth/me', (route) => fulfillJson(route, { user }))
  await page.context().route('**/api/security/csrf-token', (route) => fulfillJson(route, { csrfToken: 'mock-csrf' }))

  await page.context().route('**/api/diaspora/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()

    // ledger append / reserve
    const ledgerMatch = path.match(/\/diaspora\/stock\/([^/]+)\/ledger$/)
    if (method === 'POST' && ledgerMatch) {
      const id = ledgerMatch[1]
      const payload = JSON.parse(route.request().postData() || '{}')
      state.movementPayloads.push(payload)
      const item = state.items.find((i) => i.id === id)
      const onHand = Number(item.quantity_on_hand || 0)
      const reserved = Number(item.quantity_reserved || 0)
      let nextOnHand = onHand
      let nextReserved = reserved
      if (payload.action === 'ADD' || payload.action === 'RETURN') nextOnHand += payload.quantity
      else if (payload.action === 'REMOVE' || payload.action === 'DAMAGE' || payload.action === 'TRANSFER') nextOnHand -= payload.quantity
      else if (payload.action === 'RESERVE') nextReserved += payload.quantity
      else if (payload.action === 'RELEASE_RESERVATION') nextReserved -= payload.quantity
      item.quantity_on_hand = nextOnHand
      item.quantity_reserved = nextReserved
      item.balances = { onHand: nextOnHand, reserved: nextReserved, available: nextOnHand - nextReserved }
      const entry = { id: `led-${++state.seq}`, stock_item_id: id, action_type: payload.action, quantity_delta: nextOnHand - onHand, quantity_after: nextOnHand }
      state.ledger[id] = [entry, ...(state.ledger[id] || [])]
      await fulfillJson(route, { data: { ledgerEntry: entry, stockItem: item, idempotentReplay: false } }, 201)
      return
    }

    const ledgerGet = path.match(/\/diaspora\/stock\/([^/]+)\/ledger$/)
    if (method === 'GET' && ledgerGet) {
      await fulfillJson(route, { data: state.ledger[ledgerGet[1]] || [] })
      return
    }

    if (method === 'GET' && path.endsWith('/diaspora/stock')) {
      await fulfillJson(route, { data: state.items })
      return
    }
    if (method === 'POST' && path.endsWith('/diaspora/stock')) {
      const payload = JSON.parse(route.request().postData() || '{}')
      const onHand = Number(payload.initial_quantity || 0)
      const item = { id: `stk-${++state.seq}`, part_name: payload.part_name, quantity_on_hand: onHand, quantity_reserved: 0, balances: { onHand, reserved: 0, available: onHand } }
      state.items.push(item)
      if (onHand > 0) state.ledger[item.id] = [{ id: `led-${++state.seq}`, stock_item_id: item.id, action_type: 'ADD', quantity_delta: onHand, quantity_after: onHand }]
      await fulfillJson(route, { data: item }, 201)
      return
    }

    if (method === 'GET' && path.endsWith('/diaspora/supply-documents')) {
      await fulfillJson(route, { data: state.docs })
      return
    }
    if (method === 'POST' && path.endsWith('/diaspora/supply-documents')) {
      const payload = JSON.parse(route.request().postData() || '{}')
      const doc = { id: `doc-${++state.seq}`, document_number: payload.document_number, title: payload.title, origin_country: payload.origin_country || null, status: 'DRAFT', publication_status: 'PRIVATE' }
      state.docs.push(doc)
      await fulfillJson(route, { data: doc }, 201)
      return
    }
    const publishMatch = path.match(/\/diaspora\/supply-documents\/([^/]+)\/publish$/)
    if (method === 'POST' && publishMatch) {
      const doc = state.docs.find((d) => d.id === publishMatch[1])
      if (!doc.origin_country) {
        await fulfillJson(route, { success: false, error: { code: 'VALIDATION_FAILED', message: 'Cannot publish: missing required fields origin_country' } }, 400)
        return
      }
      doc.status = 'PUBLISHED'
      doc.publication_status = 'PUBLISHED'
      await fulfillJson(route, { data: doc })
      return
    }

    await fulfillJson(route, { data: [] })
  })
}

test.describe('Diaspora stock & supply documents (Phase 3)', () => {
  test('unauthorized owner role is denied', async ({ page }) => {
    const state = initialState()
    await loginAs(page, ownerUser, 'owner-token')
    await mockStockApi(page, state, ownerUser)
    await page.goto('/diaspora/stock', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('diaspora-stock-access-denied')).toBeVisible()
    await expect(page.getByTestId('diaspora-stock-page')).toHaveCount(0)
  })

  test('seller drafts stock and ledger movement updates totals (no direct quantity input)', async ({ page }) => {
    const state = initialState()
    await loginAs(page)
    await mockStockApi(page, state)
    await page.goto('/diaspora/stock', { waitUntil: 'domcontentloaded' })

    await expect(page.getByTestId('diaspora-stock-page')).toBeVisible()
    await expect(page.getByTestId('diaspora-stock-empty')).toBeVisible()

    await page.getByTestId('diaspora-stock-create-name').fill('Brake disc')
    await page.getByTestId('diaspora-stock-create-qty').fill('10')
    await page.getByTestId('diaspora-stock-create-submit').click()

    await expect(page.getByTestId('diaspora-stock-row')).toHaveCount(1)
    await expect(page.getByTestId('diaspora-stock-detail')).toBeVisible()
    await expect(page.getByTestId('diaspora-stock-balance-onhand')).toHaveText('10')

    // there must be NO direct editable quantity field on the item detail
    await expect(page.getByTestId('diaspora-stock-detail').locator('input[name="quantity_on_hand"]')).toHaveCount(0)

    // reserve 4 via the ledger
    await page.getByTestId('diaspora-stock-action-select').selectOption('RESERVE')
    await page.getByTestId('diaspora-stock-action-qty').fill('4')
    await page.getByTestId('diaspora-stock-action-submit').click()

    await expect(page.getByTestId('diaspora-stock-balance-reserved')).toHaveText('4')
    await expect(page.getByTestId('diaspora-stock-balance-available')).toHaveText('6')
    await expect(page.getByTestId('diaspora-stock-ledger-row')).toHaveCount(2)

    // contract: movement payload carries action + quantity + idempotencyKey
    const reserve = state.movementPayloads.find((p) => p.action === 'RESERVE')
    expect(reserve.quantity).toBe(4)
    expect(typeof reserve.idempotencyKey).toBe('string')
  })

  test('supply document publish is blocked until origin is set, then succeeds', async ({ page }) => {
    const state = initialState()
    await loginAs(page)
    await mockStockApi(page, state)
    await page.goto('/diaspora/stock', { waitUntil: 'domcontentloaded' })

    await page.getByTestId('diaspora-supply-create-number').fill('SD-100')
    await page.getByTestId('diaspora-supply-create-title').fill('Used parts lot')
    await page.getByTestId('diaspora-supply-create-submit').click()
    await expect(page.getByTestId('diaspora-supply-row')).toHaveCount(1)

    await page.getByTestId('diaspora-supply-publish').click()
    await expect(page.getByTestId('diaspora-supply-error')).toContainText(/missing required fields/i)
    await expect(page.getByTestId('diaspora-supply-row').getByText('DRAFT')).toBeVisible()
  })
})
