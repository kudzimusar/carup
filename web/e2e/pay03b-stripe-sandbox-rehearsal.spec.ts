/**
 * CARUP-PAY-03B-LR01 — Level 2 ONE-SHOT Stripe SANDBOX subscription rehearsal (Owner-authorized exact scope).
 *
 * Authority: the Owner's recorded decision (owner-decision-level2.json): exactly ONE subscription Checkout on test
 * account acct_1UVnGaEjgXqvlsJk for the sandbox test plan dealer_storefront_stripe_sandbox_l2 (JPY 500/month, not a
 * tariff), paid by Claude with Stripe test card 4242 in a visible browser; then (separate steps, API) one test-clock
 * advance, cancel at period end, and one governed refund of the renewal invoice.
 *
 * Guards (all fail closed, before any Checkout is created):
 *  - runs only with the recorded authorization and the candidate SHA on both tiers, against the Stripe-sandbox runtime;
 *  - the Level-2 dealer organization must have ZERO subscriptions, so a re-run can never create a second session;
 *  - on Stripe's hosted page it asserts a cs_test_ session, the Sandbox/Test-mode badge and JPY 500 BEFORE typing the
 *    test card, and it clicks Subscribe exactly once (no retry on a stall).
 *
 *   PAY03B_EXPECTED_SHA=<candidate> PAY03B_EVIDENCE_DIR=$HOME/carup-launch-evidence/pay03b \
 *   PAY03B_LEVEL2_AUTHORIZATION=$HOME/carup-launch-evidence/pay03b/owner-decision-level2.json \
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:5193 \
 *   npx playwright test e2e/pay03b-stripe-sandbox-rehearsal.spec.ts --project=chromium --headed --retries=0
 */
import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const AUTH = process.env.PAY03B_LEVEL2_AUTHORIZATION
const EVIDENCE_DIR = process.env.PAY03B_EVIDENCE_DIR
const EXPECTED_SHA = process.env.PAY03B_EXPECTED_SHA
const PGURL = 'postgresql://postgres:postgres@127.0.0.1:55422/postgres'

test.skip(!AUTH || !EVIDENCE_DIR || !EXPECTED_SHA, 'Level 2 rehearsal runs only once, with the recorded Owner authorization, against the Stripe-sandbox runtime.')

const sql = (statement: string) => execFileSync('psql', [PGURL, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', statement], { encoding: 'utf8' }).trim()

test('Level 2: one Owner-authorized JPY 500 Stripe sandbox subscription checkout, server-confirmed', async ({ page, request, baseURL }) => {
  test.setTimeout(300_000)
  expect(existsSync(AUTH!), 'recorded Owner authorization file').toBe(true)
  const authorization = JSON.parse(readFileSync(AUTH!, 'utf8'))
  expect(authorization.decisions.level2_stripe_sandbox_rehearsal).toBe('Authorize exact scope (Recommended)')
  expect(authorization.decisions.checkout_payer).toBe('Claude pays (Recommended)')
  const accounts = JSON.parse(readFileSync(`${EVIDENCE_DIR}/uat-accounts.json`, 'utf8'))
  const screens = `${EVIDENCE_DIR}/screens/level2`
  mkdirSync(screens, { recursive: true })

  const web = await (await request.get(`${baseURL}/carup-provenance.json`)).json()
  expect(web.commit_sha).toBe(EXPECTED_SHA)
  const health = await (await request.get('http://127.0.0.1:5041/api/health')).json()
  expect(health.build.commit_sha).toBe(EXPECTED_SHA)
  // One-session guard + Stripe-sandbox runtime (the L2 plan exists only after Owner-run provisioning).
  expect(sql(`select count(*) from public.pay03b_business_subscriptions where owner_tenant_id = '${accounts.tenantC}'`),
    'the Level-2 organization must have no prior subscription').toBe('0')
  expect(sql(`select count(*) from public.pay03b_subscription_plans where plan_code = 'dealer_storefront_stripe_sandbox_l2' and effective_to is null and provider_price_ref like 'price\\_%'`)).toBe('1')

  await page.goto('/login')
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
  await page.reload()
  await page.getByTestId('email-input').fill(accounts.dealerC.email)
  await page.getByTestId('password-input').fill(accounts.dealerC.password)
  await page.getByTestId('login-button').click()
  await page.waitForFunction(() => Boolean(localStorage.getItem('carup_token')))
  await page.goto('/dealer/subscription')
  await expect(page.getByTestId('pay03b-dealer-subscription')).toBeVisible({ timeout: 30_000 })
  await page.screenshot({ path: `${screens}/01-before.png`, fullPage: true })
  await page.getByTestId('pay03b-subscribe-dealer_storefront_stripe_sandbox_l2').click()
  const dialog = page.getByTestId('pay03b-terms-dialog')
  await expect(dialog).toContainText(/500/)
  await page.screenshot({ path: `${screens}/02-terms.png`, fullPage: true })

  const checkoutResponse = page.waitForResponse((r) => r.url().endsWith('/api/pay03b/dealer/subscription/checkout') && r.request().method() === 'POST')
  await page.getByTestId('pay03b-terms-confirm').click()
  const response = await checkoutResponse
  let checkout: any = null
  try { checkout = await response.json() } catch { /* the page navigates to Stripe immediately; read the canonical record below */ }
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 })
  expect(page.url()).toContain('cs_test_')
  // Stripe labels sandbox accounts with a 'Sandbox' badge (classic test mode shows 'Test mode').
  await expect(page.getByText(/^(sandbox|test mode)$/i).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/¥\s?500|JPY\s?500/).first()).toBeVisible()
  await page.screenshot({ path: `${screens}/03-stripe-checkout-sandbox.png`, fullPage: true })
  const canonical = JSON.parse(sql(`select json_build_object('subscriptionId', id, 'checkoutId', provider_checkout_id, 'gateway', gateway, 'status', status)
    from public.pay03b_business_subscriptions where owner_tenant_id = '${accounts.tenantC}'`))
  expect(canonical.gateway).toBe('stripe_carup_japan_sandbox')
  expect(page.url()).toContain(canonical.checkoutId)
  writeFileSync(`${EVIDENCE_DIR}/level2-checkout.json`, JSON.stringify({ recorded_at: new Date().toISOString(), ...canonical,
    amountMinor: checkout?.amountMinor ?? 500, currency: checkout?.currency ?? 'JPY', live: false }, null, 2))

  const cardNumber = page.locator('input#cardNumber')
  if (!(await cardNumber.isVisible().catch(() => false))) {
    const cardOption = page.locator('[data-testid="card-accordion-item-button"], button:has-text("Card"), [aria-label*="Card" i]').first()
    if (await cardOption.isVisible().catch(() => false)) await cardOption.click()
  }
  const email = page.locator('input#email')
  if (await email.isVisible().catch(() => false)) await email.fill('pay03b-level2-dealer-c@example.com')
  await cardNumber.fill('4242 4242 4242 4242')
  await page.locator('input#cardExpiry').fill('12 / 34')
  await page.locator('input#cardCvc').fill('123')
  const name = page.locator('input#billingName')
  if (await name.isVisible().catch(() => false)) await name.fill('PAY03B Level 2 Dealer C')
  const postal = page.locator('input#billingPostalCode')
  if (await postal.isVisible().catch(() => false)) await postal.fill('1000001')
  await page.screenshot({ path: `${screens}/04-test-card-entered.png`, fullPage: true })
  // Exactly one Subscribe click; no retry.
  await page.locator('[data-testid="hosted-payment-submit-button"], button.SubmitButton, button[type="submit"]').first().click()
  await page.waitForURL(/127\.0\.0\.1:5193\/dealer\/subscription/, { timeout: 120_000 })
  // The redirect is not payment proof: the page asks the server, which re-reads Stripe.
  await expect(page.getByTestId('pay03b-access-value')).toHaveText('Active', { timeout: 90_000 })
  await expect(page.getByTestId('pay03b-capacity-value')).toHaveText('Up to 10 published listings')
  await page.screenshot({ path: `${screens}/05-returned-entitled.png`, fullPage: true })
  expect(sql(`select count(*) from public.pay03b_business_subscriptions where owner_tenant_id = '${accounts.tenantC}'`)).toBe('1')
})
