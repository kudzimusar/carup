import { test, expect, type Page, type Request } from '@playwright/test'

/**
 * REAL (un-mocked) production-equivalent buyer journey for Diaspora import-order creation.
 *
 * This spec deliberately does NOT mock /api/auth/login, /api/security/csrf-token, /api/auth/me, or
 * POST /api/diaspora/import-orders. It drives the actual UI and asserts the real backend response,
 * so a failing submit surfaces loudly with full network/auth diagnostics.
 *
 * It is GATED so it never runs in normal CI (it writes real data to whatever backend it targets):
 *   E2E_REAL=1 E2E_BASE_URL=https://carup.vercel.app \
 *     npx playwright test e2e/diaspora-buyer-import-real.spec.ts --config web/playwright.config.ts
 *
 * Default E2E_BASE_URL is production. Point it at a seeded staging environment to avoid prod writes.
 * Login uses the seeded demo buyer (the backend login route authenticates by email).
 */

const RUN_REAL = process.env.E2E_REAL === '1' || process.env.E2E_REAL === 'true'
const BASE = (process.env.E2E_BASE_URL || 'https://carup.vercel.app').replace(/\/$/, '')

interface Captured { status: number; body: string }

function headerPresence(headers: Record<string, string> | undefined, name: string): string {
  if (!headers) return 'unknown'
  return name in headers && headers[name] !== '' ? 'present' : 'MISSING'
}

async function collectDebug(
  page: Page,
  captured: Record<string, Captured>,
  orderReqHeaders: Record<string, string> | undefined,
): Promise<string> {
  const storage = await page.evaluate(() => {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k) keys.push(k)
    }
    return { keys, hasToken: localStorage.getItem('carup_token') !== null }
  }).catch(() => ({ keys: ['<unavailable>'], hasToken: false }))

  const lines = [
    `current URL: ${page.url()}`,
    `localStorage keys: ${JSON.stringify(storage.keys)}`,
    `carup_token exists: ${storage.hasToken}`,
    `GET /auth/me: ${captured.authMe ? `${captured.authMe.status} ${captured.authMe.body}` : '<not observed>'}`,
    `GET /security/csrf-token: ${captured.csrf ? `${captured.csrf.status} <body hidden>` : '<not observed>'}`,
    `POST /auth/login: ${captured.login ? `${captured.login.status} <body hidden>` : '<not observed>'}`,
    'POST /diaspora/import-orders request headers (values hidden):',
    `  x-session-token: ${headerPresence(orderReqHeaders, 'x-session-token')}`,
    `  x-user-id: ${headerPresence(orderReqHeaders, 'x-user-id')}`,
    `  x-csrf-token: ${headerPresence(orderReqHeaders, 'x-csrf-token')}`,
    `  x-stakeholder-role: ${headerPresence(orderReqHeaders, 'x-stakeholder-role')}`,
    `  x-tenant-id: ${headerPresence(orderReqHeaders, 'x-tenant-id')}`,
    `POST /diaspora/import-orders response: ${captured.order ? `${captured.order.status} ${captured.order.body}` : '<not observed>'}`,
  ]
  return lines.join('\n')
}

test.describe('Diaspora buyer import-order REAL flow (no mocks)', () => {
  test.skip(!RUN_REAL, 'Set E2E_REAL=1 to run against a real backend (writes real data). See file header.')

  test('logged out → start import → login → /imports/new → submit → /imports/:id → documents', async ({ page }) => {
    const captured: Record<string, Captured> = {}
    let orderReqHeaders: Record<string, string> | undefined

    page.on('request', (req: Request) => {
      if (req.method() === 'POST' && req.url().includes('/api/diaspora/import-orders')) {
        orderReqHeaders = req.headers()
      }
    })
    page.on('response', async (res) => {
      const url = res.url()
      const method = res.request().method()
      let key: string | null = null
      if (url.includes('/api/auth/me')) key = 'authMe'
      else if (url.includes('/api/security/csrf-token')) key = 'csrf'
      else if (method === 'POST' && url.includes('/api/auth/login')) key = 'login'
      else if (method === 'POST' && url.includes('/api/diaspora/import-orders')) key = 'order'
      if (key) {
        const body = await res.text().catch(() => '<unreadable>')
        captured[key] = { status: res.status(), body: body.slice(0, 600) }
      }
    })

    // 1–4: logged out → /diaspora → Start import order → /login?returnTo=/diaspora/imports/new
    await page.goto(`${BASE}/diaspora`)
    await page.locator('[data-testid="diaspora-start-import-button"]').click()
    await expect(page).toHaveURL(/\/login\?returnTo=/)
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/diaspora/imports/new')

    // 5: log in as the seeded demo buyer via the UI
    await page.getByRole('button', { name: /Browse as Buyer/i }).click()

    // 6: redirect lands back on the originally requested page
    await expect(page).toHaveURL(/\/diaspora\/imports\/new$/, { timeout: 20_000 })
    await expect(page.locator('[data-testid="diaspora-new-import-route"]')).toBeVisible()

    // 7: fill the import-order form
    await page.locator('[data-testid="diaspora-order-type-vehicle"]').click()
    await page.locator('[data-testid="diaspora-origin-country-input"]').fill('Japan')
    await page.locator('[data-testid="diaspora-origin-city-input"]').fill('Yokohama')
    await page.locator('[data-testid="diaspora-destination-city-input"]').fill('Harare')
    await page.locator('[data-testid="diaspora-make-input"]').fill('Toyota')
    await page.locator('[data-testid="diaspora-model-input"]').fill('Aqua')
    await page.locator('[data-testid="diaspora-year-input"]').fill('2021')
    await page.locator('[data-testid="diaspora-budget-input"]').fill('8500')

    // 8–10: submit and assert the REAL order response (fail loudly with diagnostics otherwise)
    const orderResponsePromise = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes('/api/diaspora/import-orders'),
      { timeout: 20_000 },
    )
    await page.locator('[data-testid="diaspora-submit-import-button"]').click()
    const orderResponse = await orderResponsePromise
    const status = orderResponse.status()

    if (status !== 200 && status !== 201) {
      const debug = await collectDebug(page, captured, orderReqHeaders)
      throw new Error(`POST /api/diaspora/import-orders returned ${status} (expected 200/201).\n${debug}`)
    }

    // 11: resulting URL is /diaspora/imports/:id
    await expect(page).toHaveURL(/\/diaspora\/imports\/[^/]+$/, { timeout: 20_000 })
    const id = new URL(page.url()).pathname.split('/').filter(Boolean).pop()
    expect(id && id !== 'new').toBeTruthy()

    // 12–13: documents page shows the upload form
    await page.goto(`${BASE}/diaspora/imports/${id}/documents`)
    await expect(page.locator('[data-testid="diaspora-document-upload-form"]')).toBeVisible({ timeout: 20_000 })
  })
})
