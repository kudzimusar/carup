/**
 * CARUP-PAY-03A-STG01-FINAL — physical browser UAT of the real vehicle-history purchase surfaces.
 *
 * Runs ONLY against the isolated local runtime started by scripts/uat/pay03a-stg01-local-runtime.sh
 * (production web build on 127.0.0.1:5183, backend on 127.0.0.1:5031, local Supabase). It never mocks
 * the API. It skips unless the operator points it at that runtime:
 *
 *   PAY03A_EXPECTED_SHA=<candidate> PAY03A_UAT_ACCOUNTS_FILE=<…/uat-accounts.json> \
 *   PAY03A_EVIDENCE_DIR=<protected dir> PLAYWRIGHT_BASE_URL=http://127.0.0.1:5183 \
 *   npx playwright test e2e/pay03a-real-report-purchase.spec.ts --project=chromium --headed --retries=0
 *
 * Stage 5 (pre-financial-authorization) only: the runtime has no provider access, so no Stripe
 * Checkout session can exist. Paid-lifecycle surfaces are exercised in Stage 6 after the Owner's
 * separate authorization. All vehicles used are QA fixtures (QA-PAY03A-*), never genuine data.
 */
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mkdirSync, readFileSync } from 'node:fs'

const ACCOUNTS_FILE = process.env.PAY03A_UAT_ACCOUNTS_FILE
const EVIDENCE_DIR = process.env.PAY03A_EVIDENCE_DIR
const EXPECTED_SHA = process.env.PAY03A_EXPECTED_SHA

test.skip(
  !ACCOUNTS_FILE || !EVIDENCE_DIR || !EXPECTED_SHA,
  'PAY-03A physical UAT runs only against the isolated local runtime (scripts/uat/pay03a-stg01-local-runtime.sh).',
)
test.describe.configure({ mode: 'serial', timeout: 120_000 })

type Account = { email: string; password: string; userId: string }
const accounts: Record<string, Account> = ACCOUNTS_FILE ? JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf8')) : {}
const SCREENS = `${EVIDENCE_DIR}/screens`
if (EVIDENCE_DIR) mkdirSync(SCREENS, { recursive: true })

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
] as const

// Every request comes from 127.0.0.1, and the backend's global limiter allows 100 requests/min per IP
// (securityMiddleware). Each account therefore logs in ONCE through the real UI login form; later tests
// restore that session onto a static same-origin page (no API calls), and tests are spaced out below.
const sessionCache: Record<string, { token: string; user: string }> = {}

async function login(page: Page, who: string) {
  const cached = sessionCache[who]
  if (cached) {
    await page.goto('/carup-provenance.json')
    await page.evaluate(({ token, user }) => {
      localStorage.clear()
      sessionStorage.clear()
      localStorage.setItem('carup_token', token)
      localStorage.setItem('carup_user', user)
    }, cached)
    return
  }
  await page.goto('/login')
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
  await page.reload()
  await page.getByTestId('email-input').fill(accounts[who].email)
  await page.getByTestId('password-input').fill(accounts[who].password)
  await page.getByTestId('login-button').click()
  await page.waitForFunction(() => Boolean(localStorage.getItem('carup_token')))
  sessionCache[who] = await page.evaluate(() => ({
    token: localStorage.getItem('carup_token') || '',
    user: localStorage.getItem('carup_user') || '',
  }))
}

test.afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 20_000))
})

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${SCREENS}/${name}.png`, fullPage: true })
}

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
}

async function seriousViolations(page: Page, selector: string) {
  const results = await new AxeBuilder({ page }).include(selector).withTags(['wcag2a', 'wcag2aa']).analyze()
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.length} node(s)`)
}

async function apiAs(page: Page, path: string) {
  return page.evaluate(async (p) => {
    const user = JSON.parse(localStorage.getItem('carup_user') || '{}')
    const res = await fetch(`http://127.0.0.1:5031${p}`, {
      headers: { 'x-session-token': localStorage.getItem('carup_token') || '', 'x-user-id': user.id || '' },
    })
    return { status: res.status, body: await res.text() }
  }, path)
}

test('runtime provenance: the UI under test is the candidate build, paired to the isolated backend', async ({ request, baseURL }) => {
  const web = await (await request.get(`${baseURL}/carup-provenance.json`)).json()
  expect(web.commit_sha).toBe(EXPECTED_SHA)
  expect(web.api_base_url).toBe('http://127.0.0.1:5031')
  const health = await (await request.get('http://127.0.0.1:5031/api/health')).json()
  expect(health.status).toBe('UP')
  expect(health.build.commit_sha).toBe(EXPECTED_SHA)
})

test('signed-out visitor sees the sign-in requirement and no commerce data', async ({ page }) => {
  await page.goto('/vehicle-history')
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
  await page.reload()
  await expect(page.getByTestId('pay03a-signin-cta')).toBeVisible()
  await expect(page.getByTestId('pay03a-buy-button')).toHaveCount(0)
  await shot(page, 'desktop-signed-out')
})

for (const vp of VIEWPORTS) {
  test(`buyer pre-purchase journey @${vp.name} ${vp.width}x${vp.height}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await login(page, 'buyerA')
    await page.goto('/vehicle-history')
    await expect(page.getByTestId('pay03a-commerce-page')).toBeVisible()
    await expect(page.getByTestId('pay03a-sandbox-badge')).toContainText('TEST ONLY')

    // Metadata-only QA control: refused before charging, buy disabled.
    await page.getByTestId('pay03a-vehicle-QA-PAY03A-0002').click()
    await expect(page.getByTestId('pay03a-ineligible-banner')).toBeVisible()
    await expect(page.getByTestId('pay03a-buy-button')).toBeDisabled()
    await shot(page, `${vp.name}-ineligible-metadata-only`)

    // Registration-only ledger QA control (D-ELIG-2): also refused.
    await page.getByTestId('pay03a-vehicle-QA-PAY03A-0003').click()
    await expect(page.getByTestId('pay03a-ineligible-banner')).toBeVisible()
    await expect(page.getByTestId('pay03a-buy-button')).toBeDisabled()

    // Evidence-backed QA rehearsal vehicle: eligible, sandbox price, QA classification, disclosures.
    await page.getByTestId('pay03a-vehicle-QA-PAY03A-0001').click()
    await expect(page.getByTestId('pay03a-selected-vin')).toContainText('QA-PAY03A-0001')
    await expect(page.getByTestId('pay03a-price')).toContainText('100')
    await expect(page.getByTestId('pay03a-provenance-classification')).toContainText(/QA/i)
    await expect(page.getByTestId('pay03a-limitations-preview')).toBeVisible()
    await expect(page.getByTestId('pay03a-deliverable-comparison')).toBeVisible()
    await expect(page.getByTestId('pay03a-buy-button')).toBeEnabled()
    await expect(page.getByTestId('pay03a-empty-orders')).toBeVisible()

    expect(await horizontalOverflow(page), 'no horizontal overflow').toBeLessThanOrEqual(1)
    expect(await seriousViolations(page, '[data-testid="pay03a-commerce-page"]')).toEqual([])
    await shot(page, `${vp.name}-eligible-qa-rehearsal-vehicle`)

    const html = await page.content()
    for (const forbidden of ['sk_test_', 'sk_live_', 'whsec_', 'service_role', 'ocr-documents', accounts.buyerA.password]) {
      expect(html, `buyer DOM must not contain ${forbidden.slice(0, 8)}…`).not.toContain(forbidden)
    }
  })
}

test('checkout without provider access fails closed: no Stripe redirect, no order, the error is visible', async ({ page }) => {
  await login(page, 'buyerA')
  await page.goto('/vehicle-history')
  await page.getByTestId('pay03a-vehicle-QA-PAY03A-0001').click()
  await expect(page.getByTestId('pay03a-buy-button')).toBeEnabled()
  const stripeNavigations: string[] = []
  page.on('framenavigated', (frame) => { if (frame.url().includes('stripe.com')) stripeNavigations.push(frame.url()) })
  await page.getByTestId('pay03a-buy-button').click()
  await expect(page.getByTestId('pay03a-error')).toBeVisible()
  await shot(page, 'desktop-checkout-provider-unavailable')
  expect(stripeNavigations).toEqual([])
  expect(new URL(page.url()).pathname).toBe('/vehicle-history')
  await expect(page.getByTestId('pay03a-empty-orders')).toBeVisible()
})

test('a stale or forged Stripe return URL never grants entitlement', async ({ page }) => {
  await login(page, 'buyerA')
  await page.goto('/vehicle-history?carup_pay03a=returned&order_id=00000000-0000-4000-8000-000000000000&session_id=cs_test_forged')
  await expect(page.getByTestId('pay03a-commerce-page')).toBeVisible()
  await expect(page.getByTestId('pay03a-report-viewer')).toHaveCount(0)
  await expect(page.getByTestId('pay03a-empty-orders')).toBeVisible()
  await expect.poll(() => new URL(page.url()).search).not.toContain('session_id')
  await shot(page, 'desktop-forged-return-url')
})

test('administrator commercial console reads PAY-03A orders (successful empty read, not an error)', async ({ page }) => {
  for (const vp of [VIEWPORTS[0], VIEWPORTS[2]]) {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await login(page, 'commerce')
    await page.goto('/admin/commercial-foundation')
    await expect(page.getByTestId('pay02-admin-console')).toBeVisible()
    await expect(page.getByTestId('pay03a-admin-orders-panel')).toBeVisible()
    await expect(page.getByTestId('pay03a-admin-empty-orders')).toBeVisible()
    await expect(page.getByTestId('pay03a-admin-orders-error')).toHaveCount(0)
    expect(await horizontalOverflow(page), 'no horizontal overflow').toBeLessThanOrEqual(1)
    await shot(page, `${vp.name}-admin-commercial-foundation`)
  }
})

test('a buyer cannot open the administrator consoles', async ({ page }) => {
  await login(page, 'buyerB')
  await page.goto('/admin/commercial-foundation')
  await expect.poll(() => new URL(page.url()).pathname).not.toMatch(/^\/admin\//)
  await expect(page.getByTestId('pay02-admin-console')).toHaveCount(0)
})

test('independent evidence review surface and private-media governance', async ({ page }) => {
  await login(page, 'reviewer')
  await page.goto('/admin/vehicles/QA-PAY03A-0001/review')
  await expect(page.getByTestId('vehicle-operations-review')).toBeVisible()
  await expect(page.getByTestId('ops-evidence-groups')).toBeVisible()
  await shot(page, 'desktop-admin-evidence-review-qa')
  expect(await seriousViolations(page, '[data-testid="vehicle-operations-review"]')).toEqual([])

  // The genuine T11 CAP Vezel exists only on shared staging; the isolated runtime must not invent it.
  await page.goto('/admin/vehicles/RU3-1316558/review')
  await expect(page.getByTestId('ops-review-error')).toBeVisible()
  await shot(page, 'desktop-admin-review-vezel-absent-locally')

  // Private export-certificate evidence: the uploader sees it; an unrelated buyer gets no path/URL.
  await login(page, 'buyerB')
  const outsider = await apiAs(page, '/api/vehicles/QA-PAY03A-0001/governed-media')
  expect(outsider.body).not.toContain('e746f9dd-ad90-4941-abf8-5ebaa1cf768c')
  expect(outsider.body).not.toContain('ocr-documents')
  await login(page, 'seller')
  const owner = await apiAs(page, '/api/vehicles/QA-PAY03A-0001/governed-media')
  expect(owner.status).toBe(200)
})
