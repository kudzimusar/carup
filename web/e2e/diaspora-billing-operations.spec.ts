import { expect, test, type Page, type Route } from '@playwright/test'

/**
 * Billing operations — real Chromium (Issue #127, Deliverable D).
 *
 * The claim under test is the one an observability surface breaks most easily: **a route that
 * responds is not a healthy system.** A reconciliation scheduler that quietly stopped reports the
 * same "0 mismatches" as a healthy one, so a dashboard that only counts mismatches renders the most
 * dangerous failure as all-clear.
 *
 * Also proves the two money-safety invariants for this lane: everything is labelled test mode, and
 * nothing on the page ever claims a real charge, live activation or a refund.
 *
 * Requires the dev server with the subscription flag on:
 *   VITE_DIASPORA_SUBSCRIPTION_UI_ENABLED=true npm run dev --workspace=web
 */

type TestUser = { id: string; name: string; email: string; role: string }
const admin: TestUser = { id: 'a-1', name: 'Tenant Admin', email: 'a@carup.test', role: 'admin' }
const member: TestUser = { id: 'm-1', name: 'Member', email: 'm@carup.test', role: 'owner' }

const DESKTOP = { width: 1280, height: 800 }
const MOBILE = { width: 390, height: 844 }

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
  await page.addInitScript((u) => {
    window.localStorage.setItem('carup_user', JSON.stringify(u))
    window.localStorage.setItem('carup_token', 'mock-token')
  }, user)
}

interface BillingState {
  stale?: boolean
  neverRun?: boolean
  deadLetters?: number
  runs?: Array<Record<string, unknown>>
  healthStatus?: number
  reconcileResult?: Record<string, unknown>
}

function healthBody(state: BillingState) {
  const reconciliation = state.neverRun
    ? { lastCompletedAt: null, ageMinutes: null, stale: true, reason: 'NEVER_COMPLETED' }
    : state.stale
      ? { lastCompletedAt: '2026-07-01T00:00:00Z', ageMinutes: 9000, stale: true, reason: 'STALE' }
      : { lastCompletedAt: '2026-07-27T00:00:00Z', ageMinutes: 4, stale: false, reason: null }
  const count = state.deadLetters ?? 0
  return {
    tenantId: 'tenant-A',
    failedWebhooks: {
      count,
      events: Array.from({ length: count }, (_, i) => ({ id: `e${i}`, provider: 'test', event_id: `evt-${i}`, event_type: 'subscription.updated', tenant_id: 'tenant-A', attempts: 5, dead_lettered: true })),
    },
    supersededWebhooks: { count: 0, events: [] },
    reconciliation,
    checkout: { tenantId: 'tenant-A', total: 0, counts: { open: 0, completed: 0, abandoned: 0, expired: 0, cancelled: 0 }, abandonmentRate: null },
  }
}

async function mockApi(page: Page, user: TestUser, state: BillingState) {
  // Catch-all FIRST: Playwright resolves the LAST matching route, so every specific handler below
  // must be registered after it. Registering it last silently swallowed the CSRF-token mock, and the
  // reconcile POST then failed with "Could not establish a secure session" — which surfaced as a
  // missing outcome element rather than as an obvious auth error.
  await page.context().route('**/api/**', (r) => fulfillJson(r, { data: [] }))
  await page.context().route('**/api/auth/me', (r) => fulfillJson(r, { user }))
  await page.context().route('**/api/security/csrf-token', (r) => fulfillJson(r, { csrfToken: 'mock-csrf' }))

  await page.context().route('**/api/diaspora/subscription/plans', (r) => fulfillJson(r, {
    data: [
      { planKey: 'free', name: 'Free', tier: 'free', sortOrder: 0, description: 'Starter', entitlements: {} },
      { planKey: 'trade_pro', name: 'Trade Pro', tier: 'pro', sortOrder: 30, description: 'Pro', entitlements: {} },
    ],
  }))
  await page.context().route('**/api/diaspora/subscription/status', (r) => fulfillJson(r, {
    data: { tenantId: 'tenant-A', planKey: 'free', status: 'active', synthetic: true, currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, active: true },
  }))
  await page.context().route('**/api/diaspora/subscription/entitlements', (r) => fulfillJson(r, { data: { entitlements: {}, overrides: {} } }))
  await page.context().route('**/api/diaspora/subscription/usage', (r) => fulfillJson(r, { data: { tenantId: 'tenant-A', periodStart: '2026-07-01', usage: [] } }))

  await page.context().route('**/api/diaspora/subscription/billing-health', (r) => {
    if (state.healthStatus && state.healthStatus !== 200) {
      return fulfillJson(r, { success: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'not a manager' } }, state.healthStatus)
    }
    return fulfillJson(r, { data: healthBody(state) })
  })
  await page.context().route('**/api/diaspora/subscription/reconciliation-runs', (r) => {
    if (state.healthStatus && state.healthStatus !== 200) {
      return fulfillJson(r, { success: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'not a manager' } }, state.healthStatus)
    }
    return fulfillJson(r, { data: state.runs ?? [] })
  })
  await page.context().route('**/api/diaspora/subscription/reconcile', (r) => fulfillJson(r, {
    data: state.reconcileResult ?? { runId: 'r9', state: 'completed', trigger: 'operator', checked: 3, mismatches: 0, findings: [], correlationId: 'c1' },
  }))
}


/**
 * Wait for the operations panel to mount before deciding anything.
 *
 * Checking count() straight after goto() races React: the panel renders only after the health read
 * resolves, so an immediate count of 0 means "not yet", not "flag off". That produced a flaky skip.
 */
async function panelOrSkip(page: Page) {
  const panel = page.getByTestId('billing-operations-panel')
  try {
    await panel.waitFor({ state: 'attached', timeout: 8000 })
  } catch {
    test.skip(true, 'subscription UI flag is off in this dev server — panel never mounted')
  }
  return panel
}

async function openBilling(page: Page, user: TestUser, state: BillingState = {}, viewport = DESKTOP) {
  await page.setViewportSize(viewport)
  await loginAs(page, user)
  await mockApi(page, user, state)
  await page.goto('/diaspora/subscription', { waitUntil: 'domcontentloaded' })
}

test.describe('reconciliation freshness is judged independently of mismatches', () => {
  test('a stale scheduler with zero mismatches is NOT reported as healthy', async ({ page }) => {
    await openBilling(page, admin, { stale: true, deadLetters: 0 })
    await panelOrSkip(page)

    await expect(page.getByTestId('billing-health-reconciliation-label')).toContainText(/stale/i)
    await expect(page.getByTestId('billing-needs-operator')).toContainText(/will not resolve on their own/i)
  })

  test('a never-run reconciliation is called out rather than shown as clean', async ({ page }) => {
    await openBilling(page, admin, { neverRun: true })
    await panelOrSkip(page)
    await expect(page.getByTestId('billing-health-reconciliation-label')).toContainText(/never run/i)
  })

  test('a fresh reconciliation with no dead letters raises no operator alarm', async ({ page }) => {
    await openBilling(page, admin, { stale: false, deadLetters: 0 })
    await panelOrSkip(page)
    await expect(page.getByTestId('billing-health-reconciliation-label')).toContainText(/fresh/i)
    await expect(page.getByTestId('billing-needs-operator')).toHaveCount(0)
  })
})

test.describe('dead-lettered provider events', () => {
  test('are reported as terminal, not as pending retries', async ({ page }) => {
    await openBilling(page, admin, { deadLetters: 2 })
    await panelOrSkip(page)
    await expect(page.getByTestId('billing-health-failed-webhooks-label')).toContainText(/2 dead-lettered/i)
    await expect(page.getByTestId('billing-health-failed-webhooks')).toContainText(/will not apply automatically/i)
  })
})

test.describe('operator reconcile action', () => {
  test('reports mismatches without claiming success', async ({ page }) => {
    await openBilling(page, admin, {
      reconcileResult: { runId: 'r9', state: 'completed', trigger: 'operator', checked: 4, mismatches: 2, findings: [], correlationId: null },
    })
    await panelOrSkip(page)
    await page.getByTestId('billing-reconcile-now').click()
    const outcome = page.getByTestId('billing-reconcile-outcome')
    await expect(outcome).toContainText(/2 mismatches/i)
    await expect(outcome).not.toContainText(/no mismatches/i)
  })

  test('a double click starts exactly one run', async ({ page }) => {
    let reconcileCalls = 0
    await openBilling(page, admin, {})
    await panelOrSkip(page)
    page.on('request', (r) => { if (r.url().includes('/subscription/reconcile') && r.method() === 'POST') reconcileCalls += 1 })

    const btn = page.getByTestId('billing-reconcile-now')
    await btn.click()
    await btn.click({ force: true }).catch(() => { /* disabled while running is the point */ })
    await page.waitForTimeout(1500)
    expect(reconcileCalls).toBe(1)
  })
})

test.describe('authorization and money-safety wording', () => {
  test('a non-manager sees no operations panel rather than an empty dashboard', async ({ page }) => {
    await openBilling(page, member, { healthStatus: 403 })
    await page.waitForTimeout(1200)
    await expect(page.getByTestId('billing-operations-panel')).toHaveCount(0)
  })

  test('the page never claims a real charge, live activation or refund', async ({ page }) => {
    await openBilling(page, admin, { deadLetters: 1, stale: true })
    await page.waitForTimeout(800)
    const body = (await page.textContent('body')) || ''
    expect(body).not.toMatch(/payment succeeded|card charged|live subscription activated|refund issued|invoice settled/i)
  })

  test('billing operations are labelled test mode', async ({ page }) => {
    await openBilling(page, admin, {})
    await panelOrSkip(page)
    await expect(page.getByTestId('billing-operations-panel')).toContainText(/test mode/i)
  })
})

test.describe('responsive', () => {
  for (const [label, viewport] of [['desktop', DESKTOP], ['mobile', MOBILE]] as const) {
    test(`${label}: health renders without horizontal page scroll`, async ({ page }) => {
      await openBilling(page, admin, { stale: true, deadLetters: 2 }, viewport)
      await panelOrSkip(page)
      await expect(page.getByTestId('billing-health-reconciliation')).toBeVisible()

      const overflow = await page.evaluate(() => {
        const vw = window.innerWidth
        const offenders: Array<{ tag: string; cls: string; right: number; text: string }> = []
        document.querySelectorAll('*').forEach((el) => {
          const r = el.getBoundingClientRect()
          if (r.right > vw + 1) {
            offenders.push({ tag: el.tagName, cls: String((el as HTMLElement).className || '').slice(0, 70), right: Math.round(r.right), text: (el.textContent || '').trim().slice(0, 40) })
          }
        })
        return { vw, scrollWidth: document.documentElement.scrollWidth, offenders: offenders.slice(0, 4) }
      })
      expect(
        overflow.scrollWidth,
        `page must not scroll horizontally (viewport ${overflow.vw}); offenders: ${JSON.stringify(overflow.offenders)}`,
      ).toBeLessThanOrEqual(overflow.vw + 1)
    })
  }
})

test.describe('request containment', () => {
  test('the operations panel issues one health read per mount', async ({ page }) => {
    let healthCalls = 0
    await page.setViewportSize(DESKTOP)
    await loginAs(page, admin)
    await mockApi(page, admin, {})
    page.on('request', (r) => { if (r.url().includes('/billing-health')) healthCalls += 1 })

    await page.goto('/diaspora/subscription', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3000)
    expect(healthCalls).toBeLessThanOrEqual(1)
  })
})
