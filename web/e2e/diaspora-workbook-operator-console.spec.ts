import { expect, test, type Page, type Route } from '@playwright/test'
import { getDashboardItems } from '../src/config/featureRegistry'

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

const batch = {
  batchId: 'batch-1',
  templateType: 'DIASPORA_TRADE_OS',
  importStatus: 'READY_FOR_REVIEW',
  uploadedBy: 'admin-1',
  tenantId: 'tenant-1',
  createdAt: '2026-06-12T01:00:00.000Z',
  updatedAt: '2026-06-12T01:05:00.000Z',
  totalRows: 12,
  acceptedRows: 10,
  warningRows: 2,
  rejectedRows: 0,
  errorCount: 0,
  warningCount: 2,
  draftImportExecuted: true,
  liveImportExecuted: false,
  aiExecuted: false,
  needsReview: true,
  hasFailures: true,
  hasRetryableRows: true,
  hasBlockedRows: false,
  held: false,
  holdReason: null,
  nextRecommendedAction: 'VIEW_RETRY_PLAN',
  riskLevel: 'HIGH',
  summaryBadges: ['READY_FOR_REVIEW', 'HAS_WARNINGS', 'RETRY_REVIEW_NEEDED'],
}

interface MockState {
  held: boolean
  holdReason: string | null
  notes: { id: string; note: string; createdAt: string; role: string }[]
  noteCalls: number
  holdCalls: number
  clearHoldCalls: number
  dashboardCalls: number
  summaryCalls: number
  forbiddenCalls: string[]
}

interface MockOperatorApiOptions {
  dashboardDelay?: number
  summaryDelay?: number
  mutationDelay?: number
  dashboardStatus?: number
  dashboardBody?: unknown
  summaryStatus?: number
  summaryBody?: unknown
  holdStatus?: number
}

function delay(ms = 0) {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve()
}

function makeSummary(state: MockState): unknown {
  return {
    batch: {
      id: 'batch-1',
      importStatus: 'PARTIALLY_IMPORTED_DRAFTS',
      templateType: 'DIASPORA_TRADE_OS',
      totalRows: 12,
      acceptedRows: 10,
      rejectedRows: 0,
      warningCount: 2,
      errorCount: 0,
      createdAt: '2026-06-12T01:00:00.000Z',
      updatedAt: '2026-06-12T01:05:00.000Z',
      metadata: {},
    },
    plan: {
      canProceedToExecution: false,
      blockedReason: 'PHASE_1E_PLANNING_ONLY',
      totals: {
        plannedActions: 9,
        blockedActions: 3,
        requiresReview: 5,
        requiresApproval: 1,
      },
    },
    audit: {
      batchId: 'batch-1',
      draftImportExecuted: true,
      liveImportExecuted: false,
      aiExecuted: false,
      totals: {
        createdRows: 8,
        failedRows: 2,
        blockedRows: 1,
        retryableRows: 2,
      },
    },
    retryPlan: {
      canRetry: false,
      reason: 'RETRY_REQUIRES_SEPARATE_APPROVAL',
      totals: {
        retryableRows: 2,
        blockedRows: 1,
        failedRows: 2,
      },
    },
    operator: {
      held: state.held,
      holdReason: state.holdReason,
      notes: state.notes,
      nextActions: ['VIEW_DRY_RUN', 'VIEW_ROWS', 'VIEW_RETRY_PLAN', 'ADD_OPERATOR_NOTE', 'PLACE_HOLD'],
      forbiddenActions: [
        'EXECUTE_LIVE_IMPORT',
        'EXECUTE_AI',
        'RELEASE_PAYMENT',
        'OVERWRITE_STOCK',
        'ROLLBACK_DRAFTS',
        'RETRY_DRAFT_IMPORT',
      ],
      warnings: ['Retry execution remains disabled.'],
      statusTimeline: [],
    },
  }
}

async function loginAs(page: Page, user = adminUser, token = 'mock-admin-token') {
  await page.addInitScript(({ user, token }) => {
    window.localStorage.setItem('carup_user', JSON.stringify(user))
    window.localStorage.setItem('carup_token', token)
  }, { user, token })
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

async function mockOperatorApi(page: Page, user = adminUser, state: MockState, options: MockOperatorApiOptions = {}) {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString()
      if (url.includes('csrf-token')) {
        return new Response(JSON.stringify({ csrfToken: 'mock-csrf-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return originalFetch(input, init)
    }
  })

  await page.context().route('**/api/auth/me', async route => {
    await fulfillJson(route, { user })
  })

  await page.context().route('**/api/diaspora/workbook/**', async route => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()

    if (path.includes('execute-drafts') || path.includes('retry') || path.includes('rollback') || path.includes('ai')) {
      state.forbiddenCalls.push(`${method} ${path}`)
    }

    if (method === 'GET' && path.endsWith('/diaspora/workbook/operator-dashboard')) {
      state.dashboardCalls += 1
      await delay(options.dashboardDelay)
      await fulfillJson(route, options.dashboardBody ?? {
        items: [{ ...batch, held: state.held, holdReason: state.holdReason }],
        pagination: { limit: 50, offset: 0, count: 1 },
        totals: { totalBatches: 1, readyForReview: 1, failedDraftImports: 0, held: state.held ? 1 : 0 },
      }, options.dashboardStatus ?? 200)
      return
    }

    if (method === 'GET' && path.endsWith('/diaspora/workbook/import-batches/batch-1/operator-summary')) {
      state.summaryCalls += 1
      await delay(options.summaryDelay)
      await fulfillJson(route, { data: options.summaryBody ?? makeSummary(state) }, options.summaryStatus ?? 200)
      return
    }

    if (method === 'GET' && path.endsWith('/diaspora/workbook/import-batches/batch-1/next-actions')) {
      await fulfillJson(route, { data: makeSummary(state).operator })
      return
    }

    if (method === 'POST' && path.endsWith('/diaspora/workbook/import-batches/batch-1/operator-notes')) {
      const payload = JSON.parse(route.request().postData() || '{}') as { note?: string }
      await delay(options.mutationDelay)
      state.noteCalls += 1
      state.notes.push({ id: `note-${state.noteCalls}`, note: payload.note || '', createdAt: '2026-06-12T01:10:00.000Z', role: 'admin' })
      await fulfillJson(route, { data: {}, note: state.notes[state.notes.length - 1] })
      return
    }

    if (method === 'POST' && path.endsWith('/diaspora/workbook/import-batches/batch-1/operator-hold')) {
      const payload = JSON.parse(route.request().postData() || '{}') as { reason?: string }
      await delay(options.mutationDelay)
      state.holdCalls += 1
      state.held = true
      state.holdReason = payload.reason || null
      await fulfillJson(route, { data: { active: true, reason: state.holdReason } }, options.holdStatus ?? 200)
      return
    }

    if (method === 'DELETE' && path.endsWith('/diaspora/workbook/import-batches/batch-1/operator-hold')) {
      await delay(options.mutationDelay)
      state.clearHoldCalls += 1
      state.held = false
      state.holdReason = null
      await fulfillJson(route, { data: { active: false, reason: null } })
      return
    }

    await fulfillJson(route, {})
  })

  await page.context().route('**/*', async route => {
    if (route.request().url().includes('csrf-token')) {
      await fulfillJson(route, { csrfToken: 'mock-csrf-token' })
      return
    }
    await route.fallback()
  })
}

function initialState(): MockState {
  return {
    held: false,
    holdReason: null,
    notes: [{ id: 'note-0', note: 'Initial review note', createdAt: '2026-06-12T01:08:00.000Z', role: 'admin' }],
    noteCalls: 0,
    holdCalls: 0,
    clearHoldCalls: 0,
    dashboardCalls: 0,
    summaryCalls: 0,
    forbiddenCalls: [],
  }
}

test.describe('Diaspora workbook operator console UI', () => {
  test('shows workbook console navigation only in guarded dashboard contexts', () => {
    const workbookRoute = '/admin/diaspora/workbooks'
    const adminItems = getDashboardItems('admin')
    const governmentItems = getDashboardItems('government')
    const nonOperatorRoles = ['owner', 'dealer', 'mechanic', 'insurance', 'bank'] as const

    expect(adminItems.some(item => item.route === workbookRoute && item.label === 'Workbook Console')).toBe(true)
    expect(governmentItems.some(item => item.route === workbookRoute && item.label === 'Workbook Console')).toBe(true)
    for (const role of nonOperatorRoles) {
      expect(getDashboardItems(role).some(item => item.route === workbookRoute)).toBe(false)
    }
  })

  test('unauthorized users see access denied and do not load operator dashboard data', async ({ page }) => {
    const state = initialState()
    await loginAs(page, ownerUser, 'owner-token')
    await mockOperatorApi(page, ownerUser, state)

    await page.goto('/admin/diaspora/workbooks', { waitUntil: 'domcontentloaded' })

    await expect(page.locator('[data-testid="diaspora-workbook-console-access-denied"]')).toBeVisible()
    await expect(page.locator('[data-testid="diaspora-workbook-dashboard-table"]')).toHaveCount(0)
  })

  test('renders loading state, dashboard rows, batch summary, audit, retry plan, and blocked action indicators', async ({ page }) => {
    const state = initialState()
    await loginAs(page)
    await mockOperatorApi(page, adminUser, state, { dashboardDelay: 300 })

    await page.goto('/admin/diaspora/workbooks', { waitUntil: 'domcontentloaded' })

    await expect(page.locator('[data-testid="diaspora-workbook-console-page"]')).toBeVisible()
    await expect(page.locator('[data-testid="diaspora-workbook-dashboard-loading"]')).toBeVisible()
    await expect(page.locator('[data-testid="diaspora-workbook-dashboard-table"]')).toBeVisible()
    await expect(page.locator('[data-testid="diaspora-workbook-dashboard-row"]')).toHaveCount(1)
    await expect(page.locator('[data-testid="diaspora-workbook-status-badge"]').first()).toContainText(/ready for review|partially imported drafts/i)
    await expect(page.locator('[data-testid="diaspora-workbook-risk-level"]').first()).toContainText(/high risk/i)

    await page.locator('[data-testid="diaspora-workbook-batch-select"]').click()

    await expect(page.locator('[data-testid="diaspora-workbook-batch-summary"]')).toContainText('Batch summary')
    await expect(page.locator('[data-testid="diaspora-workbook-plan-summary"]')).toContainText('Planned actions')
    await expect(page.locator('[data-testid="diaspora-workbook-audit-summary"]')).toContainText('Execution audit')
    await expect(page.locator('[data-testid="diaspora-workbook-retry-plan"]')).toContainText('Retry plan')
    await expect(page.locator('[data-testid="diaspora-workbook-next-actions"]')).toContainText('View Retry Plan')
    await expect(page.locator('[data-testid="diaspora-workbook-live-import-blocked"]')).toContainText('Live import is not available.')
    await expect(page.locator('[data-testid="diaspora-workbook-retry-execution-blocked"]')).toContainText('Retry execution is not available.')
    await expect(page.locator('[data-testid="diaspora-workbook-rollback-blocked"]')).toContainText('Rollback execution is not available.')
    await expect(page.locator('[data-testid="diaspora-workbook-ai-execution-blocked"]')).toContainText('AI execution is not available.')
    await expect(page.locator('[data-testid="diaspora-workbook-drive-blocked"]')).toContainText('Drive/OAuth is not available.')

    await expect(page.getByRole('button', { name: /execute live import/i })).toHaveCount(0)
    await expect(page.getByTestId('execute-live-import')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /retry draft import/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /rollback drafts/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /execute ai/i })).toHaveCount(0)
    expect(state.forbiddenCalls).toEqual([])
  })

  test('renders dashboard empty and error states', async ({ page }) => {
    const emptyState = initialState()
    await loginAs(page)
    await mockOperatorApi(page, adminUser, emptyState, {
      dashboardBody: { items: [], totals: { totalBatches: 0 } },
    })

    await page.goto('/admin/diaspora/workbooks', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('[data-testid="diaspora-workbook-dashboard-empty"]')).toBeVisible()
    await expect(page.locator('[data-testid="diaspora-workbook-dashboard-reset-filters"]')).toBeVisible()

    const errorPage = await page.context().newPage()
    const errorState = initialState()
    await loginAs(errorPage)
    await mockOperatorApi(errorPage, adminUser, errorState, {
      dashboardStatus: 500,
      dashboardBody: { error: 'dashboard unavailable' },
    })

    await errorPage.goto('/admin/diaspora/workbooks', { waitUntil: 'domcontentloaded' })
    await expect(errorPage.locator('[data-testid="diaspora-workbook-dashboard-error"]')).toBeVisible()
    await errorPage.close()
  })

  test('selecting a batch shows summary loading and selected batch error states', async ({ page }) => {
    const state = initialState()
    await loginAs(page)
    await mockOperatorApi(page, adminUser, state, { summaryDelay: 3000 })

    await page.goto('/admin/diaspora/workbooks', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('[data-testid="diaspora-workbook-dashboard-row"]')).toHaveCount(1)

    await expect(page.locator('[data-testid="diaspora-workbook-batch-summary-loading"]')).toBeVisible()
    await expect(page.locator('[data-testid="diaspora-workbook-batch-summary"]')).toContainText('Batch summary')

    const errorPage = await page.context().newPage()
    const errorState = initialState()
    await loginAs(errorPage)
    await mockOperatorApi(errorPage, adminUser, errorState, {
      summaryStatus: 500,
      summaryBody: { error: 'summary unavailable' },
    })

    await errorPage.goto('/admin/diaspora/workbooks', { waitUntil: 'domcontentloaded' })
    await expect(errorPage.locator('[data-testid="diaspora-workbook-batch-summary-error"]')).toBeVisible()
    await errorPage.close()
  })

  test('missing and malformed summary fields render safe fallbacks', async ({ page }) => {
    const state = initialState()
    await loginAs(page)
    await mockOperatorApi(page, adminUser, state, {
      summaryBody: {
        batch: {
          id: 'batch-1',
          importStatus: 'UNKNOWN_BACKEND_ACTION',
        },
        plan: {},
        audit: null,
        retryPlan: null,
        operator: {
          held: true,
          holdReason: null,
          notes: 'not-a-list',
          nextActions: 'not-a-list',
          forbiddenActions: ['UNRECOGNIZED_ACTION'],
          warnings: 'not-a-list',
        },
      },
    })

    await page.goto('/admin/diaspora/workbooks', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('[data-testid="diaspora-workbook-batch-summary"]')).toContainText('Batch summary')
    await expect(page.locator('[data-testid="diaspora-workbook-audit-summary"]')).toContainText('No draft execution audit is attached')
    await expect(page.locator('[data-testid="diaspora-workbook-retry-plan"]')).toContainText('No retry plan is available')
    await expect(page.locator('[data-testid="diaspora-workbook-notes-panel"]')).toContainText('No operator notes recorded')
    await expect(page.locator('[data-testid="diaspora-workbook-active-hold-warning"]')).toContainText('No hold reason recorded.')
    await expect(page.locator('[data-testid="diaspora-workbook-forbidden-actions"]')).toContainText('Unrecognized Action')
  })

  test('validates and submits operator notes', async ({ page }) => {
    const state = initialState()
    await loginAs(page)
    await mockOperatorApi(page, adminUser, state)

    await page.goto('/admin/diaspora/workbooks', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('[data-testid="diaspora-workbook-note-row"]')).toContainText('Initial review note')

    await page.locator('[data-testid="diaspora-workbook-note-submit"]').click()
    await expect(page.locator('[data-testid="diaspora-workbook-note-error"]')).toContainText('Operator note text is required.')
    expect(state.noteCalls).toBe(0)

    await page.locator('[data-testid="diaspora-workbook-note-input"]').fill('Check source workbook warnings before review.')
    await page.locator('[data-testid="diaspora-workbook-note-submit"]').click()

    await expect(page.locator('[data-testid="diaspora-workbook-note-row"]').filter({ hasText: 'Check source workbook warnings before review.' })).toBeVisible()
    expect(state.noteCalls).toBe(1)
    await expect.poll(() => state.dashboardCalls).toBeGreaterThan(1)
  })

  test('prevents note double-submit while saving', async ({ page }) => {
    const state = initialState()
    await loginAs(page)
    await mockOperatorApi(page, adminUser, state, { mutationDelay: 800 })

    await page.goto('/admin/diaspora/workbooks', { waitUntil: 'domcontentloaded' })
    await page.locator('[data-testid="diaspora-workbook-note-input"]').fill('One guarded note.')

    const submit = page.locator('[data-testid="diaspora-workbook-note-submit"]')
    await submit.click()
    await submit.click({ force: true })

    await expect.poll(() => state.noteCalls).toBe(1)
    await expect(page.locator('[data-testid="diaspora-workbook-note-row"]').filter({ hasText: 'One guarded note.' })).toBeVisible()
  })

  test('places and clears operator hold through safe metadata endpoints', async ({ page }) => {
    const state = initialState()
    await loginAs(page)
    await mockOperatorApi(page, adminUser, state)

    await page.goto('/admin/diaspora/workbooks', { waitUntil: 'domcontentloaded' })

    await page.locator('[data-testid="diaspora-workbook-place-hold"]').click()
    await expect(page.getByText('Hold reason is required.')).toBeVisible()
    expect(state.holdCalls).toBe(0)

    await page.locator('[data-testid="diaspora-workbook-hold-reason"]').fill('Awaiting compliance reviewer.')
    await page.locator('[data-testid="diaspora-workbook-place-hold"]').click()
    await expect(page.locator('[data-testid="diaspora-workbook-active-hold-warning"]')).toContainText('Awaiting compliance reviewer.')
    await expect(page.locator('[data-testid="diaspora-workbook-held-badge"]')).toBeVisible()
    expect(state.holdCalls).toBe(1)
    await expect.poll(() => state.dashboardCalls).toBeGreaterThan(1)

    await page.locator('[data-testid="diaspora-workbook-clear-hold"]').click()
    await expect(page.locator('[data-testid="diaspora-workbook-active-hold-warning"]')).toHaveCount(0)
    expect(state.clearHoldCalls).toBe(1)
    await expect.poll(() => state.dashboardCalls).toBeGreaterThan(2)
  })

  test('prevents hold double-submit and renders hold API errors', async ({ page }) => {
    const state = initialState()
    await loginAs(page)
    await mockOperatorApi(page, adminUser, state, { mutationDelay: 300 })

    await page.goto('/admin/diaspora/workbooks', { waitUntil: 'domcontentloaded' })
    await page.locator('[data-testid="diaspora-workbook-hold-reason"]').fill('Awaiting reviewer assignment.')

    const holdButton = page.locator('[data-testid="diaspora-workbook-place-hold"]')
    await holdButton.click()
    await holdButton.click({ force: true })

    await expect(page.locator('[data-testid="diaspora-workbook-active-hold-warning"]')).toContainText('Awaiting reviewer assignment.')
    expect(state.holdCalls).toBe(1)

    const errorPage = await page.context().newPage()
    const errorState = initialState()
    await loginAs(errorPage)
    await mockOperatorApi(errorPage, adminUser, errorState, { holdStatus: 500 })

    await errorPage.goto('/admin/diaspora/workbooks', { waitUntil: 'domcontentloaded' })
    await errorPage.locator('[data-testid="diaspora-workbook-hold-reason"]').fill('Needs error handling.')
    await errorPage.locator('[data-testid="diaspora-workbook-place-hold"]').click()
    await expect(errorPage.locator('[data-testid="diaspora-workbook-hold-error"]')).toBeVisible()
    await errorPage.close()
  })
})
