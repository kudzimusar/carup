/**
 * CARUP-PAY-03A-STG01-FINAL — Stage 6 resume of the ONE authorized Checkout session (no new session).
 *
 * Used when the purchase step created the authorized session but lost the checkout response (the page
 * navigated to Stripe before the response body could be read). The product's own recovery path is an
 * idempotent replay: the same Idempotency-Key converges on the same quote, canonical payment and Stripe
 * Checkout session (Stripe idempotency key derived from the payment reference).
 *
 * Hard gates (fail closed, nothing is paid unless all hold):
 *  - exactly one PAY-03A order/quote/PAY-02 payment exists, pending, with a cs_test_ session;
 *  - the replay uses the request key recorded in the canonical ledger;
 *  - the replay returns the IDENTICAL cs_test_ id and order id, and ledger counts stay 1/1/1;
 *  - Stripe's page shows test mode and JPY 100 before the test card is entered; Pay is clicked once.
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
  'Stage 6 resume runs only with the recorded Owner authorization against the isolated runtime.',
)

function sql(statement: string) {
  return execFileSync('psql', [PGURL, '-X', '-A', '-t', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-c', statement], { encoding: 'utf8' }).trim()
}

test('Stage 6: resume the single authorized Checkout session and pay it once with test card 4242', async ({ page, request, baseURL }) => {
  test.setTimeout(240_000)
  expect(existsSync(AUTH!)).toBe(true)
  expect(JSON.parse(readFileSync(AUTH!, 'utf8')).decisions.stage6_payment).toMatch(/^Authorize; Claude pays/)
  const accounts = JSON.parse(readFileSync(ACCOUNTS_FILE!, 'utf8'))
  const screens = `${EVIDENCE_DIR}/screens/stage6`
  mkdirSync(screens, { recursive: true })

  const web = await (await request.get(`${baseURL}/carup-provenance.json`)).json()
  expect(web.commit_sha).toBe(EXPECTED_SHA)
  const health = await (await request.get('http://127.0.0.1:5031/api/health')).json()
  expect(health.build.commit_sha).toBe(EXPECTED_SHA)

  // Gate 1: exactly one pending authorized session in the canonical ledger.
  const counts = () => sql(`select (select count(*) from public.pay02_report_orders) || '/' || (select count(*) from public.pay02_commercial_quotes)
    || '/' || (select count(*) from public.payment_transactions where pay02_quote_id is not null)`)
  expect(counts()).toBe('1/1/1')
  const [orderId, reference, status, checkoutId, requestKey, buyer] = sql(`select o.id, p.reference, p.status, p.pay01a_checkout_id, p.pay01a_request_key, p.pay01a_actor_id
    from public.pay02_report_orders o join public.payment_transactions p on p.reference = o.payment_reference`).split('|')
  expect(status).toBe('pending')
  expect(checkoutId).toMatch(/^cs_test_/)
  expect(buyer).toBe(accounts.buyerA.userId)

  // Buyer signs in through the product.
  await page.goto('/login')
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
  await page.reload()
  await page.getByTestId('email-input').fill(accounts.buyerA.email)
  await page.getByTestId('password-input').fill(accounts.buyerA.password)
  await page.getByTestId('login-button').click()
  await page.waitForFunction(() => Boolean(localStorage.getItem('carup_token')))

  // Gate 2: idempotent replay with the recorded key must return the IDENTICAL session.
  const replay = await page.evaluate(async ({ key }) => {
    const user = JSON.parse(localStorage.getItem('carup_user') || '{}')
    const identity = { 'x-session-token': localStorage.getItem('carup_token') || '', 'x-user-id': user.id || '' }
    const csrf = (await (await fetch('http://127.0.0.1:5031/api/security/csrf-token', { headers: identity })).json()).csrfToken
    const res = await fetch('http://127.0.0.1:5031/api/pay03a/orders/checkout', {
      method: 'POST',
      headers: { ...identity, 'content-type': 'application/json', 'x-csrf-token': csrf, 'idempotency-key': key },
      body: JSON.stringify({ vin: 'QA-PAY03A-0001' }),
    })
    return { status: res.status, body: await res.json() }
  }, { key: requestKey })
  expect(replay.status).toBe(201)
  expect(replay.body.checkoutId, 'idempotent replay must return the SAME Checkout session').toBe(checkoutId)
  expect(replay.body.orderId).toBe(orderId)
  expect(replay.body.paymentReference).toBe(reference)
  expect(replay.body.live).toBe(false)
  expect(String(replay.body.checkoutUrl)).toMatch(/^https:\/\/checkout\.stripe\.com\//)
  expect(counts(), 'no second quote, order or payment').toBe('1/1/1')
  writeFileSync(`${EVIDENCE_DIR}/stage6-checkout.json`, JSON.stringify({
    recorded_at: new Date().toISOString(), recovered_via: 'idempotent replay (same Idempotency-Key, same session)',
    orderId: replay.body.orderId, quoteId: replay.body.quoteId, quoteNumber: replay.body.quoteNumber,
    paymentReference: replay.body.paymentReference, checkoutId: replay.body.checkoutId,
    amountMinor: replay.body.amountMinor, currency: replay.body.currency, sandboxAccountId: replay.body.sandboxAccountId,
    buyerId: replay.body.buyerId, vin: replay.body.vin, live: replay.body.live, paymentStatus: replay.body.paymentStatus,
  }, null, 2))

  // Gate 3: Stripe hosted Checkout for THAT session, verified before anything is entered.
  await page.goto(replay.body.checkoutUrl)
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 })
  expect(page.url()).toContain(checkoutId)
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

  await page.locator('[data-testid="hosted-payment-submit-button"], button.SubmitButton, button[type="submit"]').first().click()
  await page.waitForURL(/127\.0\.0\.1:5183\/vehicle-history/, { timeout: 120_000 })

  // The redirect is not payment proof: the page verifies with the backend.
  await expect(page.getByTestId(`pay03a-order-${orderId}`)).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId(`pay03a-open-report-${orderId}`)).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId(`pay03a-order-entitlement-${orderId}`)).toContainText('entitled')
  await page.screenshot({ path: `${screens}/04-returned-paid-entitled.png`, fullPage: true })

  await page.getByTestId(`pay03a-open-report-${orderId}`).click()
  await expect(page.getByTestId('pay03a-report-viewer')).toBeVisible()
  await expect(page.getByTestId('pay03a-report-viewer')).toContainText('QA-PAY03A-0001')
  await page.screenshot({ path: `${screens}/05-verified-report-snapshot.png`, fullPage: true })

  await page.getByTestId(`pay03a-share-report-${orderId}`).click()
  await expect(page.getByTestId(`pay03a-share-banner-${orderId}`)).toBeVisible()
  await page.screenshot({ path: `${screens}/06-share-link-created.png`, fullPage: true })

  expect(counts()).toBe('1/1/1')
})
