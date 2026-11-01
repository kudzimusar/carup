/**
 * CARUP-PAY-03A-STG01-FINAL — Stage 6 ONE-SHOT authorized sandbox purchase (QA-only rehearsal).
 *
 * Authority: the Owner's explicit Stage 6 authorization for exactly ONE Stripe TEST-mode Checkout session
 * (acct_1UVnGaEjgXqvlsJk, JPY 100, intel.report.vehicle_history_single, QA vehicle QA-PAY03A-0001, buyer
 * pay03a.buyer.a@carup-uat.invalid), paid with Stripe test card 4242 4242 4242 4242 in a visible browser.
 *
 * Guards (all fail closed, before any Checkout is created):
 *  - runs only with PAY03A_STAGE6_AUTHORIZATION=<recorded owner-decisions file> and the candidate SHA;
 *  - the isolated database must hold ZERO PAY-03A report orders, so a re-run can never create a second
 *    session;
 *  - on Stripe's hosted page it asserts a cs_test_ session, the TEST-mode marker and JPY 100 BEFORE
 *    entering the test card, and it clicks Pay exactly once (no retry on a stall).
 */
import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const AUTH = process.env.PAY03A_STAGE6_AUTHORIZATION
const ACCOUNTS_FILE = process.env.PAY03A_UAT_ACCOUNTS_FILE
const EVIDENCE_DIR = process.env.PAY03A_EVIDENCE_DIR
const EXPECTED_SHA = process.env.PAY03A_EXPECTED_SHA
const PGURL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

test.skip(
  !AUTH || !ACCOUNTS_FILE || !EVIDENCE_DIR || !EXPECTED_SHA,
  'Stage 6 purchase runs only once, with the recorded Owner authorization, against the isolated runtime.',
)

function sql(statement: string) {
  return execFileSync('psql', [PGURL, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', statement], { encoding: 'utf8' }).trim()
}

test('Stage 6: one authorized QA-only JPY 100 Stripe test purchase of a vehicle history report', async ({ page, request, baseURL }) => {
  test.setTimeout(240_000)
  expect(existsSync(AUTH!), 'recorded Owner authorization file').toBe(true)
  const authorization = JSON.parse(readFileSync(AUTH!, 'utf8'))
  expect(authorization.decisions.stage6_payment).toMatch(/^Authorize; Claude pays/)
  const accounts = JSON.parse(readFileSync(ACCOUNTS_FILE!, 'utf8'))
  const screens = `${EVIDENCE_DIR}/screens/stage6`
  mkdirSync(screens, { recursive: true })

  // Provenance: the exact candidate on both tiers.
  const web = await (await request.get(`${baseURL}/carup-provenance.json`)).json()
  expect(web.commit_sha).toBe(EXPECTED_SHA)
  const health = await (await request.get('http://127.0.0.1:5031/api/health')).json()
  expect(health.build.commit_sha).toBe(EXPECTED_SHA)

  // One-session guard.
  expect(sql('select count(*) from public.pay02_report_orders'), 'no prior PAY-03A order may exist').toBe('0')

  // Buyer signs in through the product.
  await page.goto('/login')
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
  await page.reload()
  await page.getByTestId('email-input').fill(accounts.buyerA.email)
  await page.getByTestId('password-input').fill(accounts.buyerA.password)
  await page.getByTestId('login-button').click()
  await page.waitForFunction(() => Boolean(localStorage.getItem('carup_token')))

  await page.goto('/vehicle-history')
  await page.getByTestId('pay03a-vehicle-QA-PAY03A-0001').click()
  await expect(page.getByTestId('pay03a-price')).toContainText('100')
  await expect(page.getByTestId('pay03a-provenance-classification')).toContainText(/QA/i)
  await expect(page.getByTestId('pay03a-buy-button')).toBeEnabled()
  await page.screenshot({ path: `${screens}/01-pre-purchase.png`, fullPage: true })

  const checkoutResponse = page.waitForResponse((r) => r.url().endsWith('/api/pay03a/orders/checkout') && r.request().method() === 'POST')
  await page.getByTestId('pay03a-buy-button').click()
  const checkout = await (await checkoutResponse).json()
  expect(checkout.live).toBe(false)
  expect(checkout.sandboxAccountId).toBe('acct_1UVnGaEjgXqvlsJk')
  expect(checkout.amountMinor).toBe(100)
  expect(checkout.currency).toBe('JPY')
  expect(String(checkout.checkoutId)).toMatch(/^cs_test_/)
  writeFileSync(`${EVIDENCE_DIR}/stage6-checkout.json`, JSON.stringify({
    recorded_at: new Date().toISOString(),
    orderId: checkout.orderId, quoteId: checkout.quoteId, quoteNumber: checkout.quoteNumber,
    paymentReference: checkout.paymentReference, checkoutId: checkout.checkoutId,
    amountMinor: checkout.amountMinor, currency: checkout.currency, sandboxAccountId: checkout.sandboxAccountId,
    buyerId: checkout.buyerId, vin: checkout.vin, live: checkout.live, paymentStatus: checkout.paymentStatus,
  }, null, 2))

  // Stripe hosted Checkout: verify TEST mode, session and amount BEFORE entering anything.
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 })
  expect(page.url()).toContain('cs_test_')
  // Stripe labels sandbox accounts with a 'Sandbox' badge (classic test mode shows 'Test mode').
  await expect(page.getByText(/^(sandbox|test mode)$/i).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/¥\s?100|JPY\s?100/).first()).toBeVisible()
  await page.screenshot({ path: `${screens}/02-stripe-checkout-test-mode.png`, fullPage: true })

  const cardNumber = page.locator('input#cardNumber')
  if (!(await cardNumber.isVisible().catch(() => false))) {
    const cardOption = page.locator('[data-testid="card-accordion-item-button"], button:has-text("Card"), [aria-label*="Card" i]').first()
    if (await cardOption.isVisible().catch(() => false)) await cardOption.click()
  }
  const email = page.locator('input#email')
  if (await email.isVisible().catch(() => false)) await email.fill('pay03a-uat-buyer-a@example.com')
  await cardNumber.fill('4242 4242 4242 4242')
  await page.locator('input#cardExpiry').fill('12 / 34')
  await page.locator('input#cardCvc').fill('123')
  const name = page.locator('input#billingName')
  if (await name.isVisible().catch(() => false)) await name.fill('PAY03A UAT Buyer A')
  const postal = page.locator('input#billingPostalCode')
  if (await postal.isVisible().catch(() => false)) await postal.fill('1000001')
  await page.screenshot({ path: `${screens}/03-stripe-test-card-entered.png`, fullPage: true })

  // Exactly one Pay click; no retry.
  await page.locator('[data-testid="hosted-payment-submit-button"], button.SubmitButton, button[type="submit"]').first().click()
  await page.waitForURL(/127\.0\.0\.1:5183\/vehicle-history/, { timeout: 120_000 })

  // The browser return is NOT payment proof: the page must verify with the backend.
  await expect(page.getByTestId(`pay03a-order-${checkout.orderId}`)).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId(`pay03a-open-report-${checkout.orderId}`)).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId(`pay03a-order-entitlement-${checkout.orderId}`)).toContainText('entitled')
  await page.screenshot({ path: `${screens}/04-returned-paid-entitled.png`, fullPage: true })

  await page.getByTestId(`pay03a-open-report-${checkout.orderId}`).click()
  await expect(page.getByTestId('pay03a-report-viewer')).toBeVisible()
  await expect(page.getByTestId('pay03a-report-viewer')).toContainText('QA-PAY03A-0001')
  await page.screenshot({ path: `${screens}/05-verified-report-snapshot.png`, fullPage: true })

  await page.getByTestId(`pay03a-share-report-${checkout.orderId}`).click()
  await expect(page.getByTestId(`pay03a-share-banner-${checkout.orderId}`)).toBeVisible()
  await page.screenshot({ path: `${screens}/06-share-link-created.png`, fullPage: true })

  expect(sql('select count(*) from public.pay02_report_orders')).toBe('1')
})
