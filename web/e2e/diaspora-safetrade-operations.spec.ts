/**
 * SafeTrade Operations console — real-Chromium e2e (ST-3 #1/#2/#3, Issue #127).
 *
 * Run the dev server with the SafeTrade UI flag on:
 *   VITE_DIASPORA_SAFETRADE_UI_ENABLED=true npm run dev --workspace=web
 *
 * Focused on the three things that make the ST-3 mechanisms real rather than theoretical: an operator
 * can SEE the queues, cannot approve their own request, and is never shown an unconfirmed money
 * operation as if it had settled.
 */
import { expect, test, type Page, type Route } from '@playwright/test'

const DESKTOP = { width: 1280, height: 900 }
const MOBILE = { width: 390, height: 844 }

const reviewer = { id: 'rev-1', name: 'Reviewer', email: 'r@carup.test', role: 'reviewer', active_tenant_id: 'tenant-1' }
const platformAdmin = { id: 'admin-1', name: 'Admin', email: 'a@carup.test', role: 'platform_admin', active_tenant_id: 'tenant-1' }
const owner = { id: 'own-1', name: 'Owner', email: 'o@carup.test', role: 'owner', active_tenant_id: 'tenant-1' }

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

async function loginAs(page: Page, user: unknown) {
  await page.addInitScript((u) => {
    window.localStorage.setItem('carup_user', JSON.stringify(u))
    window.localStorage.setItem('carup_token', 'mock-token')
  }, user)
  // Catch-all registered FIRST so specific routes (last-registered wins) take precedence. Keeps
  // unrelated app-wide fetches from polluting the console-error assertion below.
  await page.route('**/api/**', (r) => fulfillJson(r, { data: [] }))
  await page.route('**/api/auth/me', (r) => fulfillJson(r, { user }))
  await page.route('**/api/security/csrf-token', (r) => fulfillJson(r, { csrfToken: 'mock-csrf' }))
}

const OWN_APPROVAL = {
  id: 'ap-own', transaction_id: 't1', milestone_id: null, decision_type: 'release', risk_level: 'HIGH',
  amount: 5000, currency: 'USD', requested_by: 'rev-1', requested_at: '2026-07-28T09:00:00.000Z',
  requested_reason: 'High-risk release evaluation requires a second approver',
  expires_at: '2026-07-28T10:00:00.000Z', state: 'pending', canApprove: false, selfApprovalBlocked: true,
}
const OTHER_APPROVAL = {
  ...OWN_APPROVAL, id: 'ap-other', requested_by: 'rev-2', canApprove: true, selfApprovalBlocked: false,
}
const RECONCILING_OP = {
  id: 'op-1', tenant_id: 'tenant-1', transaction_id: 't1', milestone_id: null, operation: 'release',
  state: 'reconciling', provider: 'sandbox', provider_ref: null, provider_status: null,
  amount: 5000, currency: 'USD', attempts: 2, next_attempt_at: null,
  last_error_code: 'PROVIDER_RESULT_UNKNOWN', last_error: 'gateway timeout',
  requested_at: '2026-07-28T09:00:00.000Z', dispatched_at: '2026-07-28T09:00:01.000Z', confirmed_at: null,
  userState: {
    state: 'reconciling',
    userMessage: 'Awaiting confirmation from the payment provider. Our team is reconciling this — do not retry.',
    settled: false,
  },
}
const DEAD_LETTER = {
  id: 'dl-1', tenant_id: 'tenant-1', transaction_id: 't1', milestone_id: null,
  event_type: 'SAFETRADE_REPUTATION_ELIGIBLE', status: 'dead_lettered', attempts: 5,
  last_error: 'handler threw', created_at: '2026-07-28T09:00:00.000Z', next_attempt_at: null,
  payloadWithheld: true,
  payloadWithheldReason: 'Outbox payloads may reference participant data and are never returned to the console.',
}

async function mockOps(page: Page, opts: {
  approvals?: unknown[]; queue?: unknown[]; backlog?: unknown; deadLetters?: unknown[];
} = {}) {
  await page.route('**/api/diaspora/safetrade/approvals', (r) => fulfillJson(r, { data: opts.approvals ?? [] }))
  await page.route('**/api/diaspora/safetrade/reconciliation', (r) => fulfillJson(r, { data: opts.queue ?? [] }))
  await page.route('**/api/diaspora/safetrade/outbox', (r) => fulfillJson(r, {
    data: opts.backlog ?? { pending: 0, retrying: 0, deadLettered: 0, oldestPendingAgeSeconds: null },
  }))
  await page.route('**/api/diaspora/safetrade/outbox/dead-letters', (r) => fulfillJson(r, { data: opts.deadLetters ?? [] }))
}

async function requireFlagOn(page: Page) {
  if (await page.getByTestId('safetrade-ops-unavailable').isVisible().catch(() => false)) {
    test.skip(true, 'VITE_DIASPORA_SAFETRADE_UI_ENABLED is not set on the dev server')
  }
}

test.describe('ST-3 · operator visibility', () => {
  test('a reviewer sees all three queues', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, reviewer)
    await mockOps(page, {
      approvals: [OTHER_APPROVAL],
      queue: [RECONCILING_OP],
      backlog: { pending: 2, retrying: 1, deadLettered: 0, oldestPendingAgeSeconds: 30 },
    })
    await page.goto('/diaspora/safetrade/operations')
    await requireFlagOn(page)

    await expect(page.getByTestId('safetrade-ops-page')).toBeVisible()
    await expect(page.getByTestId('approvals-list')).toBeVisible()
    await expect(page.getByTestId('recon-list')).toBeVisible()
    await expect(page.getByTestId('outbox-backlog')).toBeVisible()
    await expect(page.getByTestId('outbox-pending')).toHaveText('2')
  })

  test('an ordinary member is refused', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, owner)
    await mockOps(page)
    await page.goto('/diaspora/safetrade/operations')
    await requireFlagOn(page)
    await expect(page.getByTestId('safetrade-ops-forbidden')).toBeVisible()
    await expect(page.getByTestId('safetrade-ops-page')).toHaveCount(0)
  })

  test('a stalled drainer is called out in words, not left to be inferred', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, reviewer)
    // The signature of a stall: a SMALL count with a very OLD head. A count alone looks harmless.
    await mockOps(page, { backlog: { pending: 3, retrying: 0, deadLettered: 0, oldestPendingAgeSeconds: 14400 } })
    await page.goto('/diaspora/safetrade/operations')
    await requireFlagOn(page)

    await expect(page.getByTestId('outbox-stalled')).toBeVisible()
    await expect(page.getByTestId('outbox-stalled')).toContainText('not being delivered')
    await expect(page.getByTestId('outbox-oldest')).toHaveText('4 hr')
  })

  test('a fresh queue does not warn even when it is long', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, reviewer)
    await mockOps(page, { backlog: { pending: 250, retrying: 0, deadLettered: 0, oldestPendingAgeSeconds: 4 } })
    await page.goto('/diaspora/safetrade/operations')
    await requireFlagOn(page)
    await expect(page.getByTestId('outbox-backlog')).toBeVisible()
    await expect(page.getByTestId('outbox-stalled')).toHaveCount(0)
  })
})

test.describe('ST-3 #2 · maker-checker in the browser', () => {
  test('a reviewer cannot approve their own request, and is told why', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, reviewer)
    await mockOps(page, { approvals: [OWN_APPROVAL] })
    await page.goto('/diaspora/safetrade/operations')
    await requireFlagOn(page)

    await expect(page.getByTestId('approval-self-blocked-ap-own'))
      .toContainText('a different reviewer must approve it')
    // No control at all, rather than a control that fails on click.
    await expect(page.getByTestId('approve-ap-own')).toHaveCount(0)
  })

  test('a reviewer can approve someone else\'s request', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, reviewer)
    await mockOps(page, { approvals: [OTHER_APPROVAL] })
    let approveCalled = false
    await page.route('**/api/diaspora/safetrade/approvals/ap-other/approve', async (r) => {
      approveCalled = true
      await fulfillJson(r, { data: { ...OTHER_APPROVAL, state: 'approved' } })
    })
    await page.goto('/diaspora/safetrade/operations')
    await requireFlagOn(page)

    await page.getByTestId('approve-ap-other').click()
    await expect(page.getByTestId('safetrade-ops-notice')).toBeVisible()
    expect(approveCalled).toBe(true)
  })
})

test.describe('ST-3 #3 · unconfirmed money is never shown as settled', () => {
  test('a reconciling operation reads as awaiting confirmation, never as success', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, reviewer)
    await mockOps(page, { queue: [RECONCILING_OP] })
    await page.goto('/diaspora/safetrade/operations')
    await requireFlagOn(page)

    await expect(page.getByTestId('recon-message-op-1')).toContainText('Awaiting confirmation')
    await expect(page.getByTestId('recon-message-op-1')).toContainText('do not retry')

    const body = await page.locator('[data-testid="safetrade-ops-page"]').innerText()
    expect(body).not.toMatch(/\bCompleted and recorded\b/)
    expect(body).not.toMatch(/\bSucceeded\b/)
  })
})

test.describe('ST-3 · operator actions are admin-scoped', () => {
  test('drain and replay are hidden from a plain reviewer', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, reviewer)
    await mockOps(page, { deadLetters: [DEAD_LETTER] })
    await page.goto('/diaspora/safetrade/operations')
    await requireFlagOn(page)

    await expect(page.getByTestId('outbox-dead-list')).toBeVisible()
    await expect(page.getByTestId('outbox-drain')).toHaveCount(0)
    await expect(page.getByTestId('outbox-replay-dl-1')).toHaveCount(0)
  })

  test('a platform admin can drain and replay', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, platformAdmin)
    await mockOps(page, { deadLetters: [DEAD_LETTER] })
    let drained = false; let replayed = false
    await page.route('**/api/diaspora/safetrade/outbox/drain', async (r) => {
      drained = true
      await fulfillJson(r, { data: { claimed: 1, dispatched: 1, failed: 0, deadLettered: 0, noHandler: 0, results: [] } })
    })
    await page.route('**/api/diaspora/safetrade/outbox/dead-letters/dl-1/replay', async (r) => {
      replayed = true
      await fulfillJson(r, { data: { id: 'dl-1', status: 'pending' } })
    })

    await page.goto('/diaspora/safetrade/operations')
    await requireFlagOn(page)

    await page.getByTestId('outbox-drain').click()
    await expect(page.getByTestId('safetrade-ops-notice')).toBeVisible()
    expect(drained).toBe(true)

    await page.getByTestId('outbox-replay-dl-1').click()
    await expect(page.getByTestId('safetrade-ops-notice')).toBeVisible()
    expect(replayed).toBe(true)
  })
})

test.describe('ST-3 · containment and resilience', () => {
  test('participant data injected by the API never reaches the operator screen', async ({ page }) => {
    const POISON = {
      email: 'victim@example.com', phone: '+263771234567',
      participantId: 'participant-7f3a91', statement: 'free text a participant typed',
    }
    await page.setViewportSize(DESKTOP)
    await loginAs(page, platformAdmin)
    await mockOps(page, {
      approvals: [{ ...OTHER_APPROVAL, ...POISON }],
      queue: [{ ...RECONCILING_OP, ...POISON }],
      deadLetters: [{ ...DEAD_LETTER, payload: POISON }],
    })
    await page.goto('/diaspora/safetrade/operations')
    await requireFlagOn(page)
    await expect(page.getByTestId('outbox-dead-list')).toBeVisible()

    const body = await page.locator('body').innerText()
    for (const [field, value] of Object.entries(POISON)) {
      expect(body, `${field} must not be rendered`).not.toContain(value)
    }
  })

  test('one failing read leaves the other queues usable', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, reviewer)
    await mockOps(page, { backlog: { pending: 1, retrying: 0, deadLettered: 0, oldestPendingAgeSeconds: 5 } })
    await page.route('**/api/diaspora/safetrade/approvals', (r) => fulfillJson(r, { error: 'boom' }, 500))
    await page.goto('/diaspora/safetrade/operations')
    await requireFlagOn(page)

    await expect(page.getByTestId('safetrade-ops-partial')).toBeVisible()
    await expect(page.getByTestId('outbox-backlog')).toBeVisible()
  })

  test('no console errors and no unexpected 4xx/5xx on the happy path', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, reviewer)
    await mockOps(page, { approvals: [OTHER_APPROVAL] })

    const errors: string[] = []
    const bad: string[] = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`) })

    await page.goto('/diaspora/safetrade/operations')
    await requireFlagOn(page)
    await expect(page.getByTestId('safetrade-ops-page')).toBeVisible()
    await page.waitForTimeout(400)

    expect(errors).toEqual([])
    expect(bad).toEqual([])
  })

  test('mobile: usable, and the page never scrolls horizontally', async ({ page }) => {
    await page.setViewportSize(MOBILE)
    await loginAs(page, reviewer)
    await mockOps(page, { approvals: [OTHER_APPROVAL], queue: [RECONCILING_OP] })
    await page.goto('/diaspora/safetrade/operations')
    await requireFlagOn(page)

    await expect(page.getByTestId('approvals-list')).toBeVisible()
    const overflows = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
    expect(overflows).toBe(false)
  })

  test('the non-custodial notice is present verbatim', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, reviewer)
    await mockOps(page)
    await page.goto('/diaspora/safetrade/operations')
    await requireFlagOn(page)
    await expect(page.getByTestId('safetrade-ops-notice-noncustodial'))
      .toContainText('CarUp does not hold, receive or automatically release real customer funds')
  })
})
