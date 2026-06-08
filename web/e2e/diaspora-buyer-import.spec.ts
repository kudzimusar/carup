import { expect, test, type Page, type Route } from '@playwright/test'

const buyerUser = {
  id: 'buyer-1',
  name: 'Diaspora Buyer',
  email: 'buyer@carup.test',
  role: 'owner',
}

const createdOrder = {
  id: 'dio-1001',
  buyer_id: 'buyer-1',
  order_type: 'vehicle',
  origin_country: 'Japan',
  origin_city: 'Yokohama',
  destination_country: 'Zimbabwe',
  destination_city: 'Harare',
  requested_make: 'Toyota',
  requested_model: 'Aqua',
  requested_year_min: 2021,
  requested_year_max: 2021,
  budget_amount: 8500,
  budget_currency: 'USD',
  status: 'IMPORT_REQUESTED',
  diaspora_trade_documents: [],
  created_at: '2026-06-08T08:00:00.000Z',
}

async function loginAsBuyer(page: Page) {
  await page.addInitScript((user) => {
    window.localStorage.setItem('carup_user', JSON.stringify(user))
    window.localStorage.setItem('carup_token', 'mock-buyer-token')
  }, buyerUser)
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  }

  if (route.request().method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers })
    return
  }

  await route.fulfill({
    status,
    contentType: 'application/json',
    headers,
    body: JSON.stringify(body),
  })
}

async function mockDiasporaApi(page: Page) {
  await page.context().route('**/api/diaspora/**', async route => {
    const url = new URL(route.request().url())
    const path = url.pathname

    if (route.request().method() === 'POST' && path.endsWith('/diaspora/import-orders')) {
      await fulfillJson(route, createdOrder, 201)
      return
    }

    if (route.request().method() === 'GET' && path.endsWith('/diaspora/import-orders/dio-1001')) {
      await fulfillJson(route, createdOrder)
      return
    }

    if (route.request().method() === 'GET' && path.endsWith('/diaspora/import-orders')) {
      await fulfillJson(route, { data: [createdOrder] })
      return
    }

    if (route.request().method() === 'GET' && path.endsWith('/documents')) {
      await fulfillJson(route, { data: [] })
      return
    }

    if (route.request().method() === 'GET' && path.endsWith('/diaspora/compliance')) {
      await fulfillJson(route, { data: [] })
      return
    }

    await fulfillJson(route, {})
  })
}

test.describe('Diaspora buyer import order UI', () => {
  test('Diaspora landing page renders', async ({ page }) => {
    await page.goto('/diaspora')

    await expect(page.locator('[data-testid="diaspora-landing-route"]')).toBeVisible()
    await expect(page.locator('[data-testid="diaspora-start-import-button"]')).toBeVisible()
    await expect(page.locator('[data-testid="diaspora-landing-workflow-item"]')).toHaveCount(3)
  })

  test('buyer can open new import order form', async ({ page }) => {
    await loginAsBuyer(page)
    await mockDiasporaApi(page)

    await page.goto('/diaspora')
    await page.locator('[data-testid="diaspora-start-import-button"]').click()

    await expect(page).toHaveURL(/\/diaspora\/imports\/new$/)
    await expect(page.locator('[data-testid="diaspora-new-import-route"]')).toBeVisible()
    await expect(page.locator('[data-testid="diaspora-origin-country-input"]')).toBeVisible()
  })

  test('required validation prevents empty submit', async ({ page }) => {
    await loginAsBuyer(page)
    await mockDiasporaApi(page)
    let postCount = 0
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().includes('/api/diaspora/import-orders')) postCount += 1
    })

    await page.goto('/diaspora/imports/new')
    await page.locator('[data-testid="diaspora-submit-import-button"]').click()

    await expect(page.locator('[data-testid="diaspora-import-validation-error"]')).toBeVisible()
    expect(postCount).toBe(0)
  })

  test('successful submit shows created order detail', async ({ page }) => {
    await loginAsBuyer(page)
    await mockDiasporaApi(page)

    await page.goto('/diaspora/imports/new')
    await page.locator('[data-testid="diaspora-order-type-vehicle"]').click()
    await page.locator('[data-testid="diaspora-origin-country-input"]').fill('Japan')
    await page.locator('[data-testid="diaspora-origin-city-input"]').fill('Yokohama')
    await page.locator('[data-testid="diaspora-destination-city-input"]').fill('Harare')
    await page.locator('[data-testid="diaspora-make-input"]').fill('Toyota')
    await page.locator('[data-testid="diaspora-model-input"]').fill('Aqua')
    await page.locator('[data-testid="diaspora-year-input"]').fill('2021')
    await page.locator('[data-testid="diaspora-budget-input"]').fill('8500')
    await page.locator('[data-testid="diaspora-submit-import-button"]').click()

    await expect(page).toHaveURL(/\/diaspora\/imports\/dio-1001$/)
    await expect(page.locator('[data-testid="diaspora-import-detail-route"]')).toBeVisible()
    await expect(page.locator('[data-testid="diaspora-status-badge"]')).toContainText('Import Requested')
    await expect(page.locator('[data-testid="diaspora-timeline-item"]').first()).toContainText('Import Requested')
    await expect(page.locator('[data-testid="diaspora-document-row"]')).toHaveCount(5)
  })

  test('unauthenticated user is redirected away from protected import form', async ({ page }) => {
    await page.goto('/diaspora/imports/new')

    await expect(page).toHaveURL(/\/login$/)
  })

  test('normal buyer cannot see admin compliance dashboard', async ({ page }) => {
    await loginAsBuyer(page)
    let complianceCalls = 0
    await page.route('**/api/diaspora/compliance**', async route => {
      complianceCalls += 1
      await fulfillJson(route, { data: [] })
    })

    await page.goto('/admin/diaspora/compliance')

    await expect(page.locator('[data-testid="diaspora-compliance-unauthorized"]')).toBeVisible()
    await expect(page.locator('[data-testid="diaspora-compliance-admin-route"]')).toHaveCount(0)
    expect(complianceCalls).toBe(0)
  })
})
