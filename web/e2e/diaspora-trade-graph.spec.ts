/**
 * UI-10 — Diaspora Trade Graph dashboard, real-Chromium e2e (Issue #127).
 *
 * Run the dev server with the flag on:
 *   VITE_DIASPORA_TRADE_GRAPH_UI_ENABLED=true npm run dev --workspace=web
 *
 * The API is mocked at the network boundary so every state — including ones that are hard to
 * manufacture against a live backend (a stalled projection, a dead-letter backlog, a cross-tenant
 * denial) — is exercised in a real browser rather than only in jsdom.
 *
 * What each block is actually for:
 *   · states        — every landing state renders something truthful, at desktop AND mobile widths
 *   · authorization — operator tools appear only for operators, and a denial reads as a denial
 *   · containment   — with the API returning hostile data, no PII reaches page text, console, or an
 *                     outbound request; and the client never attempts a graph write
 *   · a11y          — keyboard reachability, focus visibility, live-region announcement, and health
 *                     conveyed by text rather than colour alone
 */
import { expect, test, type Page, type Route, type ConsoleMessage } from '@playwright/test'

const DESKTOP = { width: 1280, height: 900 }
const TABLET = { width: 834, height: 1112 }
const MOBILE = { width: 390, height: 844 }

const member = { id: 'u-member', name: 'Member', email: 'm@carup.test', role: 'owner', active_tenant_id: 'tenant-1' }
const operator = { id: 'u-admin', name: 'Operator', email: 'o@carup.test', role: 'platform_admin', active_tenant_id: 'tenant-1' }

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

  // Catch-all for API calls this suite does not care about. Registered FIRST so every specific route
  // below (last-registered wins in Playwright) takes precedence.
  //
  // Without it, app-wide fetches unrelated to UI-10 — nav coverage, feature governance — hit the Vite
  // dev server, receive the index.html shell, and fail to parse as JSON. Those become console errors
  // that have nothing to do with this page, which would make the "no console errors" assertion below
  // measure the fixture rather than the feature. The assertion itself stays strict: zero errors.
  await page.route('**/api/**', (r) => fulfillJson(r, { data: [] }))

  await page.route('**/api/auth/me', (r) => fulfillJson(r, { user }))
  await page.route('**/api/security/csrf-token', (r) => fulfillJson(r, { csrfToken: 'mock-csrf' }))
}

const HEALTHY_SUMMARY = {
  counts: {
    nodes: [{ type: 'BUYER_ORDER', count: 12 }, { type: 'SHIPMENT', count: 3 }, { type: 'SAFETRADE_TRANSACTION', count: 2 }],
    edges: [{ type: 'INITIATED_ORDER', count: 12 }, { type: 'SHIPPED_IN', count: 3 }],
    totalNodes: 17,
    totalEdges: 15,
  },
  projection: {
    hasCheckpoint: true, health: 'HEALTHY', lastEventId: 'evt-1',
    lastEventAt: '2026-07-27T10:00:00.000Z', lagSeconds: 12, deadLetterCount: 0,
    replayCount: 0, replayRequired: false, projectionVersion: 'trade-graph-projection-v1',
    updatedAt: '2026-07-27T10:00:05.000Z',
  },
  lastRebuild: null, health: 'HEALTHY', stale: false,
}

const STALLED_SUMMARY = {
  ...HEALTHY_SUMMARY,
  projection: { ...HEALTHY_SUMMARY.projection, health: 'STALLED', lagSeconds: 7200, deadLetterCount: 4, replayRequired: true },
  health: 'STALLED', stale: true,
}

const EMPTY_SUMMARY = {
  counts: { nodes: [], edges: [], totalNodes: 0, totalEdges: 0 },
  projection: { ...HEALTHY_SUMMARY.projection, deadLetterCount: 0 },
  lastRebuild: null, health: 'EMPTY', stale: false,
}

async function mockSummary(page: Page, summary: unknown, status = 200) {
  await page.route('**/api/diaspora/trade-graph/summary', (r) => fulfillJson(r, summary, status))
}
async function mockDeadLetters(page: Page, rows: unknown[], status = 200) {
  await page.route('**/api/diaspora/trade-graph/dead-letters*', (r) => fulfillJson(r, { data: rows }, status))
}

/** Skip the whole file cleanly when the dev server was started without the UI flag. */
async function requireFlagOn(page: Page) {
  const unavailable = page.getByTestId('trade-graph-unavailable')
  if (await unavailable.isVisible().catch(() => false)) {
    test.skip(true, 'VITE_DIASPORA_TRADE_GRAPH_UI_ENABLED is not set on the dev server')
  }
}

test.describe('UI-10 · dashboard states', () => {
  test('desktop: renders totals, per-type counts and a healthy badge', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, member)
    await mockSummary(page, HEALTHY_SUMMARY)
    await page.goto('/diaspora/trade-graph')
    await requireFlagOn(page)

    await expect(page.getByTestId('trade-graph-page')).toBeVisible()
    await expect(page.getByTestId('total-nodes')).toHaveText('17')
    await expect(page.getByTestId('total-edges')).toHaveText('15')
    await expect(page.getByTestId('trade-graph-health-badge')).toHaveAttribute('data-health', 'HEALTHY')
    await expect(page.getByTestId('node-counts')).toContainText('Buyer orders')
    await expect(page.getByTestId('trade-graph-stale')).toHaveCount(0)
  })

  test('mobile: the dashboard is usable and never scrolls the page horizontally', async ({ page }) => {
    await page.setViewportSize(MOBILE)
    await loginAs(page, member)
    await mockSummary(page, HEALTHY_SUMMARY)
    await page.goto('/diaspora/trade-graph')
    await requireFlagOn(page)

    await expect(page.getByTestId('trade-graph-page')).toBeVisible()
    await expect(page.getByTestId('total-nodes')).toBeVisible()
    const overflows = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
    expect(overflows, 'the page body must not scroll horizontally on a phone').toBe(false)
  })

  test('tablet: the layout still presents both count panels', async ({ page }) => {
    await page.setViewportSize(TABLET)
    await loginAs(page, member)
    await mockSummary(page, HEALTHY_SUMMARY)
    await page.goto('/diaspora/trade-graph')
    await requireFlagOn(page)
    await expect(page.getByTestId('node-counts')).toBeVisible()
    await expect(page.getByTestId('edge-counts')).toBeVisible()
  })

  test('a stalled projection warns ABOVE the figures and states the lag in words', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, member)
    await mockSummary(page, STALLED_SUMMARY)
    await page.goto('/diaspora/trade-graph')
    await requireFlagOn(page)

    const stale = page.getByTestId('trade-graph-stale')
    await expect(stale).toBeVisible()
    await expect(stale).toContainText('2 hours')

    // The warning must precede the numbers in document order — a user scanning top-down sees the
    // caveat before the figure it qualifies.
    const order = await page.evaluate(() => {
      const warn = document.querySelector('[data-testid="trade-graph-stale"]')
      const totals = document.querySelector('[data-testid="trade-graph-totals"]')
      if (!warn || !totals) return -1
      return warn.compareDocumentPosition(totals) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : 0
    })
    expect(order, 'the staleness warning must render before the totals').toBe(1)
  })

  test('an empty graph renders a distinct empty state, not a wall of zeroes', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, member)
    await mockSummary(page, EMPTY_SUMMARY)
    await page.goto('/diaspora/trade-graph')
    await requireFlagOn(page)
    await expect(page.getByTestId('trade-graph-empty')).toBeVisible()
  })

  test('a failed load offers a retry rather than an empty page', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, member)
    await mockSummary(page, { error: 'boom' }, 500)
    await page.goto('/diaspora/trade-graph')
    await requireFlagOn(page)
    await expect(page.getByTestId('trade-graph-error')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  })
})

test.describe('UI-10 · authorization', () => {
  test('an ordinary member sees no operator tools and never requests dead letters', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, member)
    await mockSummary(page, HEALTHY_SUMMARY)
    const deadLetterRequests: string[] = []
    page.on('request', (r) => { if (r.url().includes('/dead-letters')) deadLetterRequests.push(r.url()) })

    await page.goto('/diaspora/trade-graph')
    await requireFlagOn(page)
    await expect(page.getByTestId('trade-graph-page')).toBeVisible()
    await expect(page.getByTestId('trade-graph-operator')).toHaveCount(0)
    await expect(page.getByTestId('trade-graph-rebuild')).toHaveCount(0)
    expect(deadLetterRequests, 'a member must not even ask for the operator feed').toEqual([])
  })

  test('an operator sees the rebuild control and the dead-letter panel', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, operator)
    await mockSummary(page, HEALTHY_SUMMARY)
    await mockDeadLetters(page, [{
      id: 'dl1', eventId: 'evt-9', eventType: 'ORDER_CREATED', retryCount: 2,
      createdAt: '2026-07-27T09:00:00.000Z', lastRetryAt: null, errorMessage: 'projection handler threw',
      payloadWithheld: true,
      payloadWithheldReason: 'Raw event payloads may contain participant data and are never returned to the console.',
    }])
    await page.goto('/diaspora/trade-graph')
    await requireFlagOn(page)

    await expect(page.getByTestId('trade-graph-operator')).toBeVisible()
    await expect(page.getByTestId('dead-letters')).toContainText('ORDER_CREATED')
    await expect(page.getByTestId('dead-letters')).toContainText('never returned to the console')
  })

  test('a cross-tenant denial reads as a denial, not as an empty graph', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, member)
    await mockSummary(page, { error: 'Forbidden: a tenant context is required' }, 403)
    await page.goto('/diaspora/trade-graph')
    await requireFlagOn(page)
    await expect(page.getByTestId('trade-graph-forbidden')).toBeVisible()
    // "You have no data" and "you may not see this data" are different statements; conflating them
    // would quietly hide an authorization problem.
    await expect(page.getByTestId('trade-graph-empty')).toHaveCount(0)
  })

  test('the rebuild request is server-addressed and carries an idempotency key', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, operator)
    await mockSummary(page, HEALTHY_SUMMARY)
    await mockDeadLetters(page, [])
    let rebuildRequest: { method: string; headers: Record<string, string> } | null = null
    await page.route('**/api/diaspora/trade-graph/rebuild', async (r) => {
      rebuildRequest = { method: r.request().method(), headers: r.request().headers() }
      await fulfillJson(r, { status: 'COMPLETED', eventsProcessed: 10 })
    })

    await page.goto('/diaspora/trade-graph')
    await requireFlagOn(page)
    await page.getByTestId('trade-graph-rebuild').click()
    await expect(page.getByTestId('trade-graph-rebuild-notice')).toBeVisible()

    expect(rebuildRequest).not.toBeNull()
    expect(rebuildRequest!.method).toBe('POST')
    expect(rebuildRequest!.headers['x-idempotency-key'], 'a double-click must be one rebuild').toBeTruthy()
  })
})

test.describe('UI-10 · containment (adversarial)', () => {
  const POISON = {
    email: 'victim@example.com',
    phone: '+263771234567',
    participantId: 'participant-7f3a91',
    documentId: 'doc-secret-4412',
    address: '14 Samora Machel Ave, Harare',
    token: 'ya29.a0ExAmPlEnOtReAl',
  }

  test('hostile API data never reaches page text, the console, or an outbound request', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, operator)

    // Inject participant data at every level the API could plausibly regress into returning.
    await mockSummary(page, {
      ...HEALTHY_SUMMARY,
      participants: [POISON],
      counts: {
        nodes: [{ type: 'BUYER_ORDER', count: 3, entityId: POISON.participantId, email: POISON.email }],
        edges: [{ type: 'INITIATED_ORDER', count: 3, data: POISON }],
        totalNodes: 3, totalEdges: 3,
      },
      projection: { ...HEALTHY_SUMMARY.projection, notes: `${POISON.address} ${POISON.token}` },
    })
    await mockDeadLetters(page, [{
      id: 'dl1', eventId: 'evt-9', eventType: 'ORDER_CREATED', retryCount: 1,
      createdAt: '2026-07-27T09:00:00.000Z', lastRetryAt: null, errorMessage: 'handler threw',
      payloadWithheld: true, payloadWithheldReason: 'Raw event payloads are never returned to the console.',
      payload: POISON,
    }])

    const consoleText: string[] = []
    const pageErrors: string[] = []
    const outboundBodies: string[] = []
    page.on('console', (m: ConsoleMessage) => consoleText.push(m.text()))
    page.on('pageerror', (e) => pageErrors.push(String(e)))
    page.on('request', (r) => { const b = r.postData(); if (b) outboundBodies.push(b) })

    await page.goto('/diaspora/trade-graph')
    await requireFlagOn(page)
    await expect(page.getByTestId('trade-graph-page')).toBeVisible()
    await expect(page.getByTestId('dead-letters')).toBeVisible()

    const bodyText = await page.locator('body').innerText()
    const consoleJoined = consoleText.join('\n')
    const outboundJoined = outboundBodies.join('\n')

    for (const [field, value] of Object.entries(POISON)) {
      expect(bodyText, `${field} must not be rendered`).not.toContain(value)
      expect(consoleJoined, `${field} must not be logged to the console`).not.toContain(value)
      expect(outboundJoined, `${field} must not be sent back out`).not.toContain(value)
    }
    expect(pageErrors, 'no uncaught page errors').toEqual([])
  })

  test('the client never attempts to write a graph node or edge', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, operator)
    await mockSummary(page, HEALTHY_SUMMARY)
    await mockDeadLetters(page, [])

    const mutations: string[] = []
    page.on('request', (r) => {
      const url = r.url()
      if (!url.includes('/trade-graph')) return
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method())) mutations.push(`${r.method()} ${url}`)
    })

    await page.goto('/diaspora/trade-graph')
    await requireFlagOn(page)
    await expect(page.getByTestId('trade-graph-page')).toBeVisible()

    // The only mutation the surface may ever make is /rebuild, which re-derives from the outbox.
    for (const m of mutations) {
      expect(m, 'the only permitted graph mutation is a server-side rebuild').toContain('/trade-graph/rebuild')
    }
  })

  test('the page produces no console errors and no unexpected 4xx/5xx', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, member)
    await mockSummary(page, HEALTHY_SUMMARY)

    const errors: string[] = []
    const badResponses: string[] = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('response', (r) => { if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`) })

    await page.goto('/diaspora/trade-graph')
    await requireFlagOn(page)
    await expect(page.getByTestId('trade-graph-page')).toBeVisible()
    await page.waitForTimeout(500)

    expect(errors).toEqual([])
    expect(badResponses).toEqual([])
  })
})

test.describe('UI-10 · accessibility', () => {
  test('health is conveyed by a text label, not by colour alone', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, member)
    await mockSummary(page, STALLED_SUMMARY)
    await page.goto('/diaspora/trade-graph')
    await requireFlagOn(page)

    const badge = page.getByTestId('trade-graph-health-badge')
    await expect(badge).toHaveText('Stalled')
    await expect(badge).toHaveAttribute('data-health', 'STALLED')
  })

  test('status changes are announced through a polite live region', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, member)
    await mockSummary(page, HEALTHY_SUMMARY)
    await page.goto('/diaspora/trade-graph')
    await requireFlagOn(page)

    const announcer = page.getByTestId('trade-graph-status-announcer')
    await expect(announcer).toHaveAttribute('role', 'status')
    await expect(announcer).toHaveAttribute('aria-live', 'polite')
  })

  test('every interactive control is keyboard reachable and shows focus', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, operator)
    await mockSummary(page, HEALTHY_SUMMARY)
    await mockDeadLetters(page, [])
    await page.goto('/diaspora/trade-graph')
    await requireFlagOn(page)
    await expect(page.getByTestId('trade-graph-operator')).toBeVisible()

    const reachable = new Set<string>()
    for (let i = 0; i < 60; i += 1) {
      await page.keyboard.press('Tab')
      const id = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') || '')
      if (id) reachable.add(id)
      if (reachable.has('trade-graph-refresh') && reachable.has('trade-graph-rebuild')) break
    }
    expect(reachable.has('trade-graph-refresh'), 'Refresh must be reachable by keyboard').toBe(true)
    expect(reachable.has('trade-graph-rebuild'), 'Rebuild must be reachable by keyboard').toBe(true)

    await page.getByTestId('trade-graph-refresh').focus()
    const hasVisibleFocus = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      if (!el) return false
      const s = getComputedStyle(el)
      return s.outlineStyle !== 'none' || s.boxShadow !== 'none'
    })
    expect(hasVisibleFocus, 'the focused control must be visibly focused').toBe(true)
  })

  test('each panel is a landmark-labelled section with a heading', async ({ page }) => {
    await page.setViewportSize(DESKTOP)
    await loginAs(page, member)
    await mockSummary(page, HEALTHY_SUMMARY)
    await page.goto('/diaspora/trade-graph')
    await requireFlagOn(page)

    await expect(page.getByRole('heading', { name: 'Trade Graph', level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Entities by type' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Relationships by type' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Projection status' })).toBeVisible()
  })
})
