import { expect, test, type Page, type Route } from '@playwright/test'

const adminUser = {
  id: 'admin-1',
  name: 'Diaspora Admin',
  email: 'admin@carup.test',
  role: 'admin',
}

const ownerUser = {
  id: 'owner-1',
  name: 'Diaspora Buyer',
  email: 'owner@carup.test',
  role: 'owner',
}

const enterpriseSchema = {
  version: '2026.06.phase1a',
  templateType: 'enterprise',
  sourceOfTruth: 'CarUp database. Workbook rows are offline staging records.',
  safetyRules: ['Dry-run validation must never write to live trade tables.'],
  statusLists: {},
  sheets: [
    {
      sheetName: 'TRADE_PROFILES',
      description: 'Diaspora buyer, seller, supplier, logistics, and enterprise trade profiles.',
      primaryKey: 'TRADE_PROFILE_ID',
      apiTable: 'diaspora_trade_profiles',
      requiredColumns: ['TRADE_PROFILE_ID', 'USER_ID', 'COUNTRY', 'CITY', 'ROLE_TYPE', 'VERIFICATION_STATUS'],
      optionalColumns: ['NOTES'],
      statusColumns: {},
    },
    {
      sheetName: 'DIASPORA_IMPORT_ORDERS',
      description: 'Buyer demand, import/export orders, and workbook-staged active order documents.',
      primaryKey: 'IMPORT_ORDER_ID',
      apiTable: 'diaspora_import_orders',
      requiredColumns: ['IMPORT_ORDER_ID', 'BUYER_TRADE_PROFILE_ID', 'ORDER_TYPE', 'ORIGIN_COUNTRY', 'DESTINATION_COUNTRY', 'STATUS', 'BUDGET_CURRENCY'],
      optionalColumns: ['NOTES'],
      statusColumns: {},
    },
  ],
}

const supportedTemplates = [
  { templateType: 'buyer', sheets: ['DIASPORA_IMPORT_ORDERS'] },
  { templateType: 'seller', sheets: ['TRADE_PROFILES'] },
  { templateType: 'enterprise', sheets: ['TRADE_PROFILES', 'DIASPORA_IMPORT_ORDERS'] },
]

const validWorkbook = {
  sheets: {
    TRADE_PROFILES: [
      {
        TRADE_PROFILE_ID: 'tp-1',
        USER_ID: 'user-1',
        COUNTRY: 'Japan',
        CITY: 'Tokyo',
        ROLE_TYPE: 'buyer',
        VERIFICATION_STATUS: 'VERIFIED',
      },
    ],
    DIASPORA_IMPORT_ORDERS: [
      {
        IMPORT_ORDER_ID: 'order-1',
        BUYER_TRADE_PROFILE_ID: 'tp-1',
        ORDER_TYPE: 'vehicle_import',
        ORIGIN_COUNTRY: 'Japan',
        DESTINATION_COUNTRY: 'Zimbabwe',
        STATUS: 'DRAFT',
        BUDGET_CURRENCY: 'USD',
      },
    ],
  },
}

interface MockState {
  dryRunCalls: number
  dryRunPayloads: unknown[]
  forbiddenCalls: string[]
}

function delay(ms = 0) {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve()
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  const origin = route.request().headers().origin || '*'
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
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

async function loginAs(page: Page, user = adminUser, token = 'mock-admin-token') {
  await page.addInitScript(({ user, token }) => {
    window.localStorage.setItem('carup_user', JSON.stringify(user))
    window.localStorage.setItem('carup_token', token)
  }, { user, token })
}

async function mockDryRunApi(page: Page, state: MockState, user = adminUser, dryRunDelay = 0) {
  await page.context().route('**/api/auth/me', async route => {
    await fulfillJson(route, { user })
  })

  await page.context().route('**/api/security/csrf-token', async route => {
    await fulfillJson(route, { csrfToken: 'mock-csrf-token' })
  })

  await page.context().route('**/api/diaspora/workbook/**', async route => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()

    if (
      path.includes('execute-drafts') ||
      path.includes('retry') ||
      path.includes('rollback') ||
      path.includes('ai') ||
      path.includes('save-to-drive') ||
      path.includes('import')
    ) {
      if (!path.includes('dry-run')) state.forbiddenCalls.push(`${method} ${path}`)
    }

    if (method === 'GET' && path.endsWith('/diaspora/workbook/template-schema')) {
      await fulfillJson(route, { data: enterpriseSchema, supportedTemplates })
      return
    }

    if (method === 'GET' && path.endsWith('/diaspora/workbook/download-template')) {
      await fulfillJson(route, {
        data: enterpriseSchema,
        downloadReady: false,
        message: 'Binary XLSX template generation is scheduled for a later phase.',
      })
      return
    }

    if (method === 'POST' && path.endsWith('/diaspora/workbook/dry-run')) {
      state.dryRunCalls += 1
      state.dryRunPayloads.push(JSON.parse(route.request().postData() || '{}'))
      await delay(dryRunDelay)
      await fulfillJson(route, {
        data: {
          dryRunId: 'dryrun-1',
          dryRunOnly: true,
          wroteToDatabase: false,
          canImport: false,
          templateType: 'enterprise',
          totals: {
            totalRows: 2,
            acceptedRows: 1,
            errorCount: 1,
            warningCount: 1,
            sheetCount: 2,
          },
          summaries: [
            {
              sheetName: 'TRADE_PROFILES',
              apiTable: 'diaspora_trade_profiles',
              primaryKey: 'TRADE_PROFILE_ID',
              totalRows: 1,
              acceptedRows: 1,
              warningRows: 0,
              rejectedRows: 0,
            },
            {
              sheetName: 'DIASPORA_IMPORT_ORDERS',
              apiTable: 'diaspora_import_orders',
              primaryKey: 'IMPORT_ORDER_ID',
              totalRows: 1,
              acceptedRows: 0,
              warningRows: 1,
              rejectedRows: 1,
            },
          ],
          errors: [
            {
              sheetName: 'DIASPORA_IMPORT_ORDERS',
              rowIndex: 2,
              column: 'STATUS',
              code: 'INVALID_STATUS_VALUE',
              message: 'Invalid order status.',
            },
          ],
          warnings: [
            {
              sheetName: 'TRADE_PROFILES',
              rowIndex: 2,
              column: 'NOTES',
              code: 'REVIEW_NOTE',
              message: 'Manual review recommended.',
            },
          ],
          persistence: {
            batchId: 'batch-dry-run-1',
            rowDiagnosticsPersisted: 2,
            acceptedRows: 1,
            warningRows: 1,
            rejectedRows: 1,
            importStatus: 'BLOCKED',
            persisted: true,
          },
        },
      })
      return
    }

    await fulfillJson(route, {})
  })
}

function initialState(): MockState {
  return {
    dryRunCalls: 0,
    dryRunPayloads: [],
    forbiddenCalls: [],
  }
}

test.describe('Diaspora workbook dry-run UI', () => {
  test('authorized operator can open the route, load schema, and see unavailable template download', async ({ page }) => {
    const state = initialState()
    await loginAs(page)
    await mockDryRunApi(page, state)

    await page.goto('/admin/diaspora/workbooks/new', { waitUntil: 'domcontentloaded' })

    await expect(page.locator('[data-testid="diaspora-workbook-dry-run-page"]')).toBeVisible()
    await expect(page.locator('[data-testid="diaspora-workbook-template-select"]')).toHaveValue('enterprise')
    await expect(page.locator('[data-testid="diaspora-workbook-template-schema"]')).toContainText('TRADE_PROFILES')
    await expect(page.locator('[data-testid="diaspora-workbook-template-schema"]')).toContainText('DIASPORA_IMPORT_ORDERS')
    await expect(page.locator('[data-testid="diaspora-workbook-template-schema"]')).toContainText('TRADE_PROFILE_ID')
    await expect(page.locator('[data-testid="diaspora-workbook-template-schema"]')).toContainText('diaspora_import_orders')
    await expect(page.locator('[data-testid="diaspora-workbook-template-download-status"]')).toContainText('Binary XLSX template download is not yet available')
    await expect(page.locator('[data-testid="diaspora-workbook-template-download-disabled"]')).toBeDisabled()
  })

  test('unauthorized role is denied and does not load workbook APIs', async ({ page }) => {
    const state = initialState()
    await loginAs(page, ownerUser, 'owner-token')
    await mockDryRunApi(page, state, ownerUser)

    await page.goto('/admin/diaspora/workbooks/new', { waitUntil: 'domcontentloaded' })

    await expect(page.locator('[data-testid="diaspora-workbook-dry-run-access-denied"]')).toBeVisible()
    await expect(page.locator('[data-testid="diaspora-workbook-template-schema"]')).toHaveCount(0)
    expect(state.dryRunCalls).toBe(0)
  })

  test('valid JSON file parses and preview row totals render', async ({ page }) => {
    const state = initialState()
    await loginAs(page)
    await mockDryRunApi(page, state)

    await page.goto('/admin/diaspora/workbooks/new', { waitUntil: 'domcontentloaded' })
    await page.locator('[data-testid="diaspora-workbook-json-file-input"]').setInputFiles({
      name: 'workbook.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(validWorkbook)),
    })

    await expect(page.locator('[data-testid="diaspora-workbook-json-file-name"]')).toContainText('workbook.json')
    await expect(page.locator('[data-testid="diaspora-workbook-preview-sheet"]')).toHaveCount(2)
    await expect(page.locator('[data-testid="diaspora-workbook-preview-total-rows"]')).toContainText('2')
    await expect(page.locator('[data-testid="diaspora-workbook-preview-missing-sheets"]')).toContainText('No required sheets are missing.')
  })

  test('valid pasted JSON parses and missing required sheets render', async ({ page }) => {
    const state = initialState()
    await loginAs(page)
    await mockDryRunApi(page, state)

    await page.goto('/admin/diaspora/workbooks/new', { waitUntil: 'domcontentloaded' })
    await page.locator('[data-testid="diaspora-workbook-json-input"]').fill(JSON.stringify({
      workbook: {
        TRADE_PROFILES: validWorkbook.sheets.TRADE_PROFILES,
      },
    }))
    await page.locator('[data-testid="diaspora-workbook-json-parse"]').click()

    await expect(page.locator('[data-testid="diaspora-workbook-preview-sheet"]')).toHaveCount(1)
    await expect(page.locator('[data-testid="diaspora-workbook-preview-missing-sheets"]')).toContainText('DIASPORA_IMPORT_ORDERS')
  })

  test('invalid JSON, missing sheets object, and non-array sheet values show errors', async ({ page }) => {
    const state = initialState()
    await loginAs(page)
    await mockDryRunApi(page, state)

    await page.goto('/admin/diaspora/workbooks/new', { waitUntil: 'domcontentloaded' })
    await page.locator('[data-testid="diaspora-workbook-json-input"]').fill('{bad')
    await page.locator('[data-testid="diaspora-workbook-json-parse"]').click()
    await expect(page.locator('[data-testid="diaspora-workbook-json-error"]')).toContainText('Invalid JSON')

    await page.locator('[data-testid="diaspora-workbook-json-input"]').fill(JSON.stringify({ rows: [] }))
    await page.locator('[data-testid="diaspora-workbook-json-parse"]').click()
    await expect(page.locator('[data-testid="diaspora-workbook-json-error"]')).toContainText('sheets object or workbook object')

    await page.locator('[data-testid="diaspora-workbook-json-input"]').fill(JSON.stringify({ sheets: { TRADE_PROFILES: {} } }))
    await page.locator('[data-testid="diaspora-workbook-json-parse"]').click()
    await expect(page.locator('[data-testid="diaspora-workbook-json-error"]')).toContainText('TRADE_PROFILES must be an array')
  })

  test('submit is disabled with invalid input and double-submit is prevented', async ({ page }) => {
    const state = initialState()
    await loginAs(page)
    await mockDryRunApi(page, state, adminUser, 800)

    await page.goto('/admin/diaspora/workbooks/new', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('[data-testid="diaspora-workbook-dry-run-submit"]')).toBeDisabled()

    await page.locator('[data-testid="diaspora-workbook-json-input"]').fill(JSON.stringify(validWorkbook))
    await page.locator('[data-testid="diaspora-workbook-json-parse"]').click()
    const submit = page.locator('[data-testid="diaspora-workbook-dry-run-submit"]')
    await expect(submit).toBeEnabled()
    await submit.click()
    await submit.click({ force: true })

    await expect(page.locator('[data-testid="diaspora-workbook-dry-run-loading"]')).toBeVisible()
    await expect.poll(() => state.dryRunCalls).toBe(1)
    await expect(page.locator('[data-testid="diaspora-workbook-dry-run-batch-id"]')).toContainText('batch-dry-run-1')
  })

  test('dry-run POST uses contract payload and success result renders diagnostics', async ({ page }) => {
    const state = initialState()
    await loginAs(page)
    await mockDryRunApi(page, state)

    await page.goto('/admin/diaspora/workbooks/new', { waitUntil: 'domcontentloaded' })
    await page.locator('[data-testid="diaspora-workbook-json-input"]').fill(JSON.stringify(validWorkbook))
    await page.locator('[data-testid="diaspora-workbook-json-parse"]').click()
    await page.locator('[data-testid="diaspora-workbook-dry-run-submit"]').click()

    await expect(page.locator('[data-testid="diaspora-workbook-dry-run-result"]')).toBeVisible()
    await expect(page.locator('[data-testid="diaspora-workbook-dry-run-batch-id"]')).toContainText('batch-dry-run-1')
    await expect(page.locator('[data-testid="diaspora-workbook-dry-run-status"]')).toContainText('Blocked by validation errors')
    await expect(page.locator('[data-testid="diaspora-workbook-dry-run-totals"]')).toContainText('Total rows')
    await expect(page.locator('[data-testid="diaspora-workbook-dry-run-sheet-summary"]')).toHaveCount(2)
    await expect(page.locator('[data-testid="diaspora-workbook-dry-run-errors"]')).toContainText('INVALID_STATUS_VALUE')
    await expect(page.locator('[data-testid="diaspora-workbook-dry-run-warnings"]')).toContainText('REVIEW_NOTE')
    await expect(page.locator('[data-testid="diaspora-workbook-dry-run-persisted"]')).toContainText('Persisted')

    const payload = state.dryRunPayloads[0] as {
      templateType?: string
      idempotencyKey?: string
      source?: { filename?: string | null; mimeType?: string | null; sizeBytes?: number | null }
      sheets?: Record<string, unknown[]>
    }

    expect(payload.templateType).toBe('enterprise')
    expect(typeof payload.idempotencyKey).toBe('string')
    expect(payload.idempotencyKey?.length).toBeGreaterThan(8)
    expect(payload.source).toEqual({ filename: null, mimeType: 'application/json', sizeBytes: expect.any(Number) })
    expect(Object.keys(payload.sheets || {})).toEqual(['TRADE_PROFILES', 'DIASPORA_IMPORT_ORDERS'])
  })

  test('blocked execution controls are absent and console navigation works', async ({ page }) => {
    const state = initialState()
    await loginAs(page)
    await mockDryRunApi(page, state)

    await page.goto('/admin/diaspora/workbooks/new', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('button', { name: /execute live import/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /execute drafts/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /retry import/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /rollback import/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /execute ai/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /save to drive/i })).toHaveCount(0)

    await page.locator('[data-testid="diaspora-workbook-json-input"]').fill(JSON.stringify(validWorkbook))
    await page.locator('[data-testid="diaspora-workbook-json-parse"]').click()
    await page.locator('[data-testid="diaspora-workbook-dry-run-submit"]').click()
    await page.locator('[data-testid="diaspora-workbook-view-console"]').click()

    await expect(page).toHaveURL(/\/admin\/diaspora\/workbooks\?batchId=batch-dry-run-1/)
    expect(state.forbiddenCalls).toEqual([])
  })
})
