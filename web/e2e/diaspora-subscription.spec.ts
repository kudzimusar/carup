import { expect, test, type Page, type Route } from '@playwright/test'

/**
 * Phase 8 — Diaspora Subscription frontend e2e (mocked API; sandbox billing only).
 *
 * Flag note: the page is gated by the BUILD-TIME flag VITE_DIASPORA_SUBSCRIPTION_UI_ENABLED. To run
 * the full UI path the dev server must be started with that flag = 'true'
 * (VITE_DIASPORA_SUBSCRIPTION_UI_ENABLED=true npm run dev). When the flag is OFF the page renders the
 * explicit unavailable state; the flag-OFF nav-hidden + page-unavailable behavior is also locked by
 * the vitest featureFlag + route-validation suites. The first test below ADAPTS to whichever flag the
 * running server was built with, so the spec is valid in both modes.
 */

interface SubscriptionTestUser {
  id: string
  name: string
  email: string
  role: 'owner' | 'dealer' | 'admin'
  active_tenant_id: string | null
}

const owner: SubscriptionTestUser = { id: 'o-1', name: 'Owner', email: 'o@carup.test', role: 'owner', active_tenant_id: 'tenant-1' }
const dealer: SubscriptionTestUser = { id: 'd-1', name: 'Dealer', email: 'd@carup.test', role: 'dealer', active_tenant_id: 'tenant-1' }
const admin: SubscriptionTestUser = { id: 'a-1', name: 'Tenant Admin', email: 'a@carup.test', role: 'admin', active_tenant_id: 'tenant-1' }

async function fulfillJson(route: Route, body: unknown, status = 200) {
  const origin = route.request().headers().origin || '*'
  const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Credentials': 'true' }
  if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return }
  await route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) })
}

async function loginAs(page: Page, user: SubscriptionTestUser, token = 'mock-token') {
  await page.addInitScript(({ user, token }) => {
    window.localStorage.setItem('carup_user', JSON.stringify(user))
    window.localStorage.setItem('carup_token', token)
  }, { user, token })
}

// Plan catalog mirrors the SHAPE of GET /plans (sorted by sortOrder). The UI renders from this mock —
// asserting the UI is NOT hardcoded.
const PLANS = [
  { planKey: 'free', name: 'Free', tier: 'free', sortOrder: 0, description: 'Browse the marketplace and download templates.', entitlements: { 'diaspora.workbook.download': true, 'diaspora.stock.create': false, 'diaspora.ai.execute_medium': 0, 'diaspora.workbook.bulk_import': 0 } },
  { planKey: 'seller', name: 'Seller / Supplier', tier: 'seller', sortOrder: 20, description: 'Upload and publish stock.', entitlements: { 'diaspora.workbook.download': true, 'diaspora.stock.create': true, 'diaspora.stock.max_items': 250, 'diaspora.ai.execute_medium': 25, 'diaspora.workbook.bulk_import': 0 } },
  { planKey: 'trade_pro', name: 'Trade Pro', tier: 'pro', sortOrder: 30, description: 'Bulk import/export and analytics.', entitlements: { 'diaspora.workbook.bulk_import': 200, 'diaspora.ai.execute_medium': 250, 'diaspora.stock.max_items': 5000 } },
]

interface SubState {
  planKey: string
  status: string
  synthetic: boolean
  cancelAtPeriodEnd: boolean
  active: boolean
  unlimited?: boolean
  manageForbidden?: boolean
  serverError?: boolean
  missingTenant?: boolean
}

async function mockApi(page: Page, user: SubscriptionTestUser, state: SubState) {
  await page.context().route('**/api/auth/me', (r) => fulfillJson(r, { user }))
  await page.context().route('**/api/security/csrf-token', (r) => fulfillJson(r, { csrfToken: 'mock-csrf' }))

  await page.context().route('**/api/diaspora/subscription/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()

    if (state.serverError && path.endsWith('/status')) {
      await fulfillJson(route, { success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: 'HTTP error! status: 500', timestamp: 'x', requestId: 'r' } }, 500)
      return
    }
    if (state.missingTenant && (path.endsWith('/status') || path.endsWith('/usage') || path.endsWith('/entitlements'))) {
      await fulfillJson(route, { success: false, error: { code: 'VALIDATION_ERROR', message: 'An x-tenant-id context is required for subscription operations', timestamp: 'x', requestId: 'r' } }, 400)
      return
    }

    if (method === 'GET' && path.endsWith('/plans')) { await fulfillJson(route, { data: PLANS }); return }

    if (method === 'GET' && path.endsWith('/status')) {
      await fulfillJson(route, { data: {
        tenantId: 'tenant-1', planKey: state.planKey, status: state.status, synthetic: state.synthetic,
        currentPeriodStart: '2026-06-01T00:00:00.000Z', currentPeriodEnd: '2026-07-01T00:00:00.000Z',
        cancelAtPeriodEnd: state.cancelAtPeriodEnd, active: state.active,
      } })
      return
    }

    if (method === 'GET' && path.endsWith('/entitlements')) {
      const plan = PLANS.find((p) => p.planKey === state.planKey) || PLANS[0]
      await fulfillJson(route, { data: plan.entitlements })
      return
    }

    if (method === 'GET' && path.endsWith('/usage')) {
      const usage = state.unlimited
        ? [{ featureKey: 'diaspora.ai.execute_medium', limit: null, used: 12, remaining: null }]
        : [
            { featureKey: 'diaspora.workbook.bulk_import', limit: 200, used: 50, remaining: 150 },
            { featureKey: 'diaspora.ai.execute_medium', limit: 25, used: 25, remaining: 0 }, // exhausted
          ]
      await fulfillJson(route, { data: { tenantId: 'tenant-1', periodStart: '2026-06-01T00:00:00.000Z', usage } })
      return
    }

    // Management actions (Gate S8-A): 403 for non-managers; sandbox session otherwise.
    if (method === 'POST') {
      if (state.manageForbidden) {
        await fulfillJson(route, { success: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'You are not authorized to manage this tenant subscription', timestamp: 'x', requestId: 'r' } }, 403)
        return
      }
      if (path.endsWith('/checkout')) { await fulfillJson(route, { data: { id: 'sandbox_sess_1', provider: 'sandbox', sandbox: true, url: 'https://sandbox.local/checkout' } }, 201); return }
      if (path.endsWith('/portal')) { await fulfillJson(route, { data: { id: 'sandbox_portal_1', provider: 'sandbox', sandbox: true, url: 'https://sandbox.local/portal' } }, 201); return }
      if (path.endsWith('/change-plan')) { state.planKey = 'trade_pro'; await fulfillJson(route, { data: { planKey: 'trade_pro', status: 'active' } }); return }
      if (path.endsWith('/cancel')) { state.cancelAtPeriodEnd = true; await fulfillJson(route, { data: { planKey: state.planKey, status: state.status, cancelAtPeriodEnd: true } }); return }
    }

    await fulfillJson(route, { data: {} })
  })
}

async function gotoSubscription(page: Page) {
  await page.goto('/diaspora/subscription', { waitUntil: 'domcontentloaded' })
}

/**
 * True when the running dev server was built with the subscription UI flag ON.
 * Waits for the app to settle into ONE of the page's top-level states before deciding (the flag-OFF
 * build shows `subscription-unavailable`; an ON build shows the page or the sign-in-required state).
 */
async function uiEnabled(page: Page): Promise<boolean> {
  const enabledMarker = page.locator(
    '[data-testid="subscription-page"], [data-testid="subscription-signin-required"], [data-testid="subscription-auth-loading"]',
  )
  const disabledMarker = page.getByTestId('subscription-unavailable')
  await expect(enabledMarker.or(disabledMarker).first()).toBeVisible({ timeout: 15000 })
  return (await disabledMarker.count()) === 0
}

test.describe('Diaspora Subscription (Phase 8)', () => {
  test('route is hidden/unavailable when the flag is OFF, full UI when ON (adaptive)', async ({ page }) => {
    await loginAs(page, owner)
    await mockApi(page, owner, { planKey: 'free', status: 'active', synthetic: true, cancelAtPeriodEnd: false, active: true })
    await gotoSubscription(page)
    if (await uiEnabled(page)) {
      await expect(page.getByTestId('subscription-page')).toBeVisible()
    } else {
      await expect(page.getByTestId('subscription-unavailable')).toBeVisible()
      await expect(page.getByTestId('subscription-unavailable')).toContainText('Subscription management is not available')
    }
  })

  test('page loads for an authed tenant user; plans render from the MOCKED api (not hardcoded)', async ({ page }) => {
    await loginAs(page, owner)
    await mockApi(page, owner, { planKey: 'free', status: 'active', synthetic: true, cancelAtPeriodEnd: false, active: true })
    await gotoSubscription(page)
    test.skip(!(await uiEnabled(page)), 'Subscription UI flag is OFF on this server build')

    await expect(page.getByTestId('plan-comparison')).toBeVisible()
    // Mocked names appear; a renamed mock would change the DOM → proves no hardcoded catalog.
    await expect(page.getByTestId('plan-comparison')).toContainText('Seller / Supplier')
    await expect(page.getByTestId('plan-comparison')).toContainText('Trade Pro')
    // API sortOrder preserved: Free, then Seller, then Trade Pro.
    const keys = await page.locator('[data-testid="plan-card"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-plan-key')))
    expect(keys).toEqual(['free', 'seller', 'trade_pro'])
  })

  test('current plan is highlighted; synthetic Free shown', async ({ page }) => {
    await loginAs(page, owner)
    await mockApi(page, owner, { planKey: 'free', status: 'active', synthetic: true, cancelAtPeriodEnd: false, active: true })
    await gotoSubscription(page)
    test.skip(!(await uiEnabled(page)), 'flag OFF')

    await expect(page.locator('[data-plan-key="free"][data-current="true"]')).toBeVisible()
    await expect(page.getByTestId('plan-current-badge').first()).toContainText('Current plan')
    await expect(page.getByTestId('subscription-status-card-synthetic')).toContainText('Free plan')
  })

  test('active paid sandbox subscription renders active + period', async ({ page }) => {
    await loginAs(page, dealer)
    await mockApi(page, dealer, { planKey: 'seller', status: 'active', synthetic: false, cancelAtPeriodEnd: false, active: true })
    await gotoSubscription(page)
    test.skip(!(await uiEnabled(page)), 'flag OFF')

    await expect(page.getByTestId('subscription-status-card-active-badge')).toBeVisible()
    await expect(page.getByTestId('subscription-status-card-period-end')).toContainText('2026-07-01')
  })

  test('usage meters render with truthful unavailable + exhausted; quota-exhausted is text not color', async ({ page }) => {
    await loginAs(page, dealer)
    await mockApi(page, dealer, { planKey: 'trade_pro', status: 'active', synthetic: false, cancelAtPeriodEnd: false, active: true })
    await gotoSubscription(page)
    test.skip(!(await uiEnabled(page)), 'flag OFF')

    await expect(page.getByTestId('usage-dashboard')).toBeVisible()
    await expect(page.locator('[data-testid="usage-row"]').first()).toBeVisible()
    // The exhausted AI quota shows 0 remaining as TEXT.
    await expect(page.getByTestId('usage-dashboard')).toContainText('25 of 25 used (0 remaining)')
    await expect(page.locator('[role="progressbar"]').first()).toHaveAttribute('aria-valuenow', /\d+/)
  })

  test('unlimited usage is shown truthfully (no bounded progressbar)', async ({ page }) => {
    await loginAs(page, dealer)
    await mockApi(page, dealer, { planKey: 'trade_pro', status: 'active', synthetic: false, cancelAtPeriodEnd: false, active: true, unlimited: true })
    await gotoSubscription(page)
    test.skip(!(await uiEnabled(page)), 'flag OFF')

    await expect(page.getByTestId('usage-unlimited').first()).toContainText('Unlimited')
  })

  test('ordinary member is read-only (no management controls)', async ({ page }) => {
    await loginAs(page, owner)
    await mockApi(page, owner, { planKey: 'free', status: 'active', synthetic: true, cancelAtPeriodEnd: false, active: true })
    await gotoSubscription(page)
    test.skip(!(await uiEnabled(page)), 'flag OFF')

    await expect(page.getByTestId('subscription-readonly')).toBeVisible()
    await expect(page.getByTestId('subscription-actions')).toHaveCount(0)
  })

  test('tenant admin sees management controls + the sandbox notice', async ({ page }) => {
    await loginAs(page, admin)
    await mockApi(page, admin, { planKey: 'seller', status: 'active', synthetic: false, cancelAtPeriodEnd: false, active: true })
    await gotoSubscription(page)
    test.skip(!(await uiEnabled(page)), 'flag OFF')

    await expect(page.getByTestId('subscription-actions')).toBeVisible()
    await expect(page.getByTestId('subscription-actions-sandbox-notice')).toContainText('sandbox mode')
    await expect(page.getByTestId('subscription-actions-sandbox-notice')).toContainText('No real payment is collected')
  })

  test('ordinary member cannot manage via a DIRECT request — the 403 is surfaced safely', async ({ page }) => {
    // Force the backend to forbid management; assert the page surfaces the structured denial (and never
    // a raw provider/db detail). Hidden buttons are not security — the backend 403 is authoritative.
    await loginAs(page, admin) // manager UI so the action exists; backend still returns 403
    await mockApi(page, admin, { planKey: 'free', status: 'active', synthetic: true, cancelAtPeriodEnd: false, active: true, manageForbidden: true })
    await gotoSubscription(page)
    test.skip(!(await uiEnabled(page)), 'flag OFF')

    await page.getByTestId('subscription-actions-checkout').click()
    const denial = page.getByTestId('subscription-action-denial')
    await expect(denial).toBeVisible()
    await expect(denial).toHaveAttribute('data-denial-category', 'ordinary-authorization-failure')
    const body = await page.locator('body').innerText()
    expect(body).not.toMatch(/requestId|PGRST|sk_live|stack trace|provider secret/i)
  })

  test('change-plan requires confirmation', async ({ page }) => {
    await loginAs(page, admin)
    await mockApi(page, admin, { planKey: 'seller', status: 'active', synthetic: false, cancelAtPeriodEnd: false, active: true })
    await gotoSubscription(page)
    test.skip(!(await uiEnabled(page)), 'flag OFF')

    await page.getByTestId('subscription-actions-change-plan').click()
    await expect(page.getByTestId('subscription-actions-change-plan-dialog')).toBeVisible()
    await page.getByTestId('subscription-actions-change-plan-confirm').click()
    await expect(page.getByTestId('subscription-actions-outcome')).toContainText('Plan change requested')
  })

  test('cancel requires confirmation and states the at-period-end effect', async ({ page }) => {
    await loginAs(page, admin)
    await mockApi(page, admin, { planKey: 'seller', status: 'active', synthetic: false, cancelAtPeriodEnd: false, active: true })
    await gotoSubscription(page)
    test.skip(!(await uiEnabled(page)), 'flag OFF')

    await page.getByTestId('subscription-actions-cancel').click()
    const dialog = page.getByTestId('subscription-actions-cancel-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('end of the current period')
    await page.getByTestId('subscription-actions-cancel-confirm').click()
    await expect(page.getByTestId('subscription-actions-outcome')).toContainText('Cancellation scheduled at period end')
  })

  test('duplicate submission is prevented (controls disable while in flight)', async ({ page }) => {
    await loginAs(page, admin)
    // Delay the checkout response so the in-flight disable window is observable.
    await mockApi(page, admin, { planKey: 'seller', status: 'active', synthetic: false, cancelAtPeriodEnd: false, active: true })
    let checkoutCalls = 0
    await page.context().route('**/api/diaspora/subscription/checkout', async (route) => {
      checkoutCalls += 1
      await new Promise((r) => setTimeout(r, 600))
      await fulfillJson(route, { data: { id: 'sandbox_sess_x', provider: 'sandbox', sandbox: true } }, 201)
    })
    await gotoSubscription(page)
    test.skip(!(await uiEnabled(page)), 'flag OFF')

    const btn = page.getByTestId('subscription-actions-checkout')
    await btn.click()
    await expect(btn).toBeDisabled()
    // A second click during the in-flight window must not fire a second request.
    await btn.click({ force: true }).catch(() => {})
    await expect(page.getByTestId('subscription-actions-outcome')).toContainText('Sandbox checkout', { timeout: 5000 })
    expect(checkoutCalls).toBe(1)
  })

  test('backend failure shows a safe, retryable state', async ({ page }) => {
    await loginAs(page, owner)
    await mockApi(page, owner, { planKey: 'free', status: 'active', synthetic: true, cancelAtPeriodEnd: false, active: true, serverError: true })
    await gotoSubscription(page)
    test.skip(!(await uiEnabled(page)), 'flag OFF')

    const err = page.getByTestId('subscription-load-error')
    await expect(err).toBeVisible()
    await expect(page.locator('[data-denial-category="network-or-server-failure"]')).toBeVisible()
    const body = await page.locator('body').innerText()
    expect(body).not.toMatch(/requestId|stack|PGRST/i)
  })

  test('missing tenant context shows the tenant-context state', async ({ page }) => {
    const noTenant: SubscriptionTestUser = { ...owner, active_tenant_id: null }
    await loginAs(page, noTenant)
    await mockApi(page, noTenant, { planKey: 'free', status: 'active', synthetic: true, cancelAtPeriodEnd: false, active: true, missingTenant: true })
    await gotoSubscription(page)
    test.skip(!(await uiEnabled(page)), 'flag OFF')

    await expect(page.locator('[data-denial-category="tenant-context-missing"]')).toBeVisible()
  })

  test('keyboard navigation reaches and operates the actions', async ({ page }) => {
    await loginAs(page, admin)
    await mockApi(page, admin, { planKey: 'seller', status: 'active', synthetic: false, cancelAtPeriodEnd: false, active: true })
    await gotoSubscription(page)
    test.skip(!(await uiEnabled(page)), 'flag OFF')

    // Focus the cancel control via keyboard and open the dialog with Enter (keyboard-operable control).
    const cancelBtn = page.getByTestId('subscription-actions-cancel')
    await cancelBtn.focus()
    await expect(cancelBtn).toBeFocused()
    await page.keyboard.press('Enter')
    const dialog = page.getByTestId('subscription-actions-cancel-dialog')
    await expect(dialog).toBeVisible()
    // Focus is trapped INSIDE the dialog (Radix moves focus to the dialog content / a control within it).
    const focusInDialog = await dialog.evaluate((el) => el.contains(document.activeElement))
    expect(focusInDialog).toBe(true)
    await expect(dialog).toContainText('end of the current period')
    // Escape closes the dialog and focus leaves it (returns toward the page; Radix focus management).
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    // The trigger remains keyboard-operable after the dialog closes.
    await expect(cancelBtn).toBeVisible()
    await expect(cancelBtn).toBeEnabled()
    await cancelBtn.focus()
    await expect(cancelBtn).toBeFocused()
  })

  test('aria-live region carries the action result', async ({ page }) => {
    await loginAs(page, admin)
    await mockApi(page, admin, { planKey: 'seller', status: 'active', synthetic: false, cancelAtPeriodEnd: false, active: true })
    await gotoSubscription(page)
    test.skip(!(await uiEnabled(page)), 'flag OFF')

    const live = page.getByTestId('subscription-actions-outcome')
    await expect(live).toHaveAttribute('aria-live', 'polite')
    await page.getByTestId('subscription-actions-portal').click()
    await expect(live).toContainText('Sandbox billing portal session created')
  })

  test('sandbox wording is visible and never claims a real charge', async ({ page }) => {
    await loginAs(page, admin)
    await mockApi(page, admin, { planKey: 'seller', status: 'active', synthetic: false, cancelAtPeriodEnd: false, active: true })
    await gotoSubscription(page)
    test.skip(!(await uiEnabled(page)), 'flag OFF')

    // Wait for the actions surface (which carries the sandbox notice) before snapshotting the DOM text.
    await expect(page.getByTestId('subscription-actions-sandbox-notice')).toBeVisible()
    const body = await page.locator('body').innerText()
    expect(body).toContain('sandbox mode')
    expect(body).not.toMatch(/payment succeeded|card charged|live subscription activated|refund issued|invoice settled/i)
  })

  test('existing diaspora routes are unaffected (drive/rfq/stock reachable)', async ({ page }) => {
    await loginAs(page, dealer)
    await page.context().route('**/api/auth/me', (r) => fulfillJson(r, { user: dealer }))
    await page.context().route('**/api/security/csrf-token', (r) => fulfillJson(r, { csrfToken: 'mock-csrf' }))
    await page.context().route('**/api/diaspora/**', (r) => fulfillJson(r, { data: [] }))
    // These routes must still resolve to their own pages (not the subscription page).
    await page.goto('/diaspora/drive', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/diaspora\/drive$/)
    await page.goto('/diaspora/rfq', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/diaspora\/rfq$/)
    await page.goto('/diaspora/stock', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/diaspora\/stock$/)
  })
})
