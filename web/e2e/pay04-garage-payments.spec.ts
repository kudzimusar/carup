/**
 * CARUP-PAY-04-LR01 — physical browser UAT of garage invoices and payments: the Garage Hub (admin), the customer's
 * My Service Requests, the simulated garage payment-provider page, the garage's Invoices and Payments page and the
 * operator's garage-payments page — at desktop, tablet and mobile widths.
 *
 * Runs ONLY against the isolated local runtime started by scripts/uat/pay04-local-runtime.sh (production web build on
 * 127.0.0.1:5203, backend on 127.0.0.1:5051, dedicated carup-pay04-supabase stack) after scripts/uat/pay04-qa-seed.mjs.
 * The provider is the clearly-labelled LOCAL GARAGE PAYMENT-PROVIDER SIMULATOR; no money moves. It never mocks the API.
 *
 *   PAY04_EXPECTED_SHA=<candidate> PAY04_EVIDENCE_DIR=$HOME/carup-launch-evidence/pay04 \
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:5203 \
 *   npx playwright test e2e/pay04-garage-payments.spec.ts --project=chromium --headed --retries=0
 */
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const EVIDENCE_DIR = process.env.PAY04_EVIDENCE_DIR
const EXPECTED_SHA = process.env.PAY04_EXPECTED_SHA
const API = 'http://127.0.0.1:5051'
const PGURL = 'postgresql://postgres:postgres@127.0.0.1:56322/postgres'

test.skip(!EVIDENCE_DIR || !EXPECTED_SHA, 'PAY-04 physical UAT runs only against the isolated local runtime (scripts/uat/pay04-local-runtime.sh).')
test.describe.configure({ mode: 'serial', timeout: 240_000 })

type Account = { email: string; password: string; userId: string; role: string }
const accounts: Record<string, Account | string> = EVIDENCE_DIR ? JSON.parse(readFileSync(`${EVIDENCE_DIR}/uat-accounts.json`, 'utf8')) : {}
const acct = (k: string) => accounts[k] as Account
const SCREENS = `${EVIDENCE_DIR}/screens`
if (EVIDENCE_DIR) mkdirSync(SCREENS, { recursive: true })
const sql = (q: string) => execFileSync('psql', [PGURL, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8' }).trim()
const lit = (v: string) => `'${String(v).replace(/'/g, "''")}'`
const journal: Array<Record<string, unknown>> = []
const note = (step: string, detail: Record<string, unknown> = {}) => journal.push({ step, at: new Date().toISOString(), ...detail })

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
] as const

// ── API helpers (the job before the invoice runs on the product endpoints with real sessions; see the HTTP matrix) ──
const tokens: Record<string, string> = {}
async function apiLogin(who: string) {
  if (tokens[who]) return tokens[who]
  const csrf = await (await fetch(`${API}/api/security/csrf-token`)).json()
  const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf.csrfToken },
    body: JSON.stringify({ email: acct(who).email, password: acct(who).password }) })
  const j = await r.json()
  if (r.status !== 200 || !j.token) throw new Error(`api login ${who}: ${r.status}`)
  tokens[who] = j.token
  return j.token
}
/** API JSON as this harness reads it: a loose tree of fields. Every value the journey relies on is asserted downstream. */
type ApiJson = { [key: string]: ApiJson } & string
async function api(who: string, method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
  const token = await apiLogin(who)
  const tenant = who === 'adminA' || who === 'mechA' ? (accounts.garageA as string) : null
  const identity: Record<string, string> = { 'x-session-token': token, 'x-user-id': acct(who).userId, 'x-stakeholder-role': acct(who).role,
    ...(tenant ? { 'x-tenant-id': tenant } : {}) }
  const headers: Record<string, string> = { ...identity, 'content-type': 'application/json', ...extra }
  if (method !== 'GET') headers['x-csrf-token'] = (await (await fetch(`${API}/api/security/csrf-token`, { headers: identity })).json()).csrfToken
  const r = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  let json: ApiJson | null = null
  try { json = await r.json() } catch { /* non-JSON */ }
  if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(json).slice(0, 200)}`)
  return json as ApiJson
}
/** A completed, authorized job with recorded parts consumption, ready to invoice (directive cases 1–5). */
async function completedJob(cost = '110.00', partQty = 1, sellPrice = '25.00') {
  const c = await api('customer', 'POST', '/api/service-cases', { vin: accounts.vinCustomer, garage_tenant_id: accounts.garageA, branch_id: accounts.branchA,
    service_category: 'brakes', request_summary: 'Browser UAT job (PAY-04 QA)' })
  const caseId = c.case.id
  await api('adminA', 'POST', `/api/service-cases/${caseId}/accept`, { branch_id: accounts.branchA })
  const wo = (await api('adminA', 'POST', `/api/service-cases/${caseId}/work-order`, {})).workOrder.id
  const est = (await api('adminA', 'POST', `/api/garage/cases/${caseId}/estimates`, { currency: 'USD', lines: [
    { category: 'labour', description: 'Brake service', quantity: 1, unit_price: cost },
    { category: 'part', description: 'Brake pads', quantity: partQty, unit_price: sellPrice }] })).estimate.id
  await api('adminA', 'POST', `/api/garage/estimates/${est}/send`, {})
  await api('customer', 'POST', `/api/service-estimates/${est}/decision`, { decision: 'accept' })
  await api('adminA', 'POST', `/api/service-work-orders/${wo}/assign`, { mechanic_user_id: acct('mechA').userId })
  await api('adminA', 'POST', `/api/service-cases/${caseId}/start`, {})
  const rec = (await api('mechA', 'POST', `/api/service-work-orders/${wo}/records`, { work_performed: 'Replaced pads', total_cost: cost, currency: 'USD' })).record.id
  const part = (await api('adminA', 'POST', '/api/garage/stock', { name: 'Brake pads (browser QA)', sku: `P4QA-BR-${randomUUID().slice(0, 8)}`, opening_quantity: 5,
    unit_cost: '12.00', sell_price: sellPrice, price_currency: 'USD', idempotency_key: `p4br-part-${randomUUID()}` })).part.id
  await api('mechA', 'POST', `/api/garage/service-records/${rec}/parts`, { part_id: part, quantity: partQty, idempotency_key: `p4br-use-${randomUUID()}` })
  await api('mechA', 'POST', `/api/service-cases/${caseId}/complete-job`, {})
  return { caseId, workOrderId: wo }
}

// ── browser helpers ──
async function login(page: Page, who: string) {
  await page.goto('/login')
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
  await page.reload()
  await page.getByTestId('email-input').fill(acct(who).email)
  await page.getByTestId('password-input').fill(acct(who).password)
  await page.getByTestId('login-button').click()
  await page.waitForFunction(() => Boolean(localStorage.getItem('carup_token')))
}
/** Act for garage A through the product's own organisation switcher (PUT /api/auth/active-tenant). */
async function actForGarageA(page: Page) {
  await page.goto('/dashboard')
  const badge = page.getByTestId('organisation-badge')
  await expect(badge).toBeVisible({ timeout: 30_000 })
  if (/Acting for .*PAY04 QA Garage A/.test((await badge.getAttribute('aria-label')) ?? '')) return
  const prompt = page.getByTestId('organisation-prompt')
  let control = prompt.getByRole('button', { name: /Act for .*PAY04 QA Garage A/ })
  if (!(await control.isVisible().catch(() => false))) {
    await badge.click()
    control = page.getByRole('menuitem', { name: /Act for .*PAY04 QA Garage A/ })
  }
  const selection = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/auth\/active-tenant/.test(r.url()))
  await control.click()
  expect((await selection).ok()).toBe(true)
  await expect(badge).toHaveAttribute('aria-label', /Acting for .*PAY04 QA Garage A/, { timeout: 30_000 })
}
async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, 'no lateral page overflow').toBeLessThanOrEqual(1)
}
async function axeClean(page: Page, include: string) {
  // Measure the RESTING state. A click leaves the pointer over whatever renders next, so axe would otherwise measure a
  // hover colour mid-transition. The shared outline Button's hover state (white on the CarUp-orange accent, 2.8:1) is a
  // pre-existing, app-wide design-system finding recorded in the PAY-04 certification, not hidden by this step.
  await page.mouse.move(0, 0)
  await page.waitForTimeout(400) // the Button's colour and opacity transitions are 150 ms
  const results = await new AxeBuilder({ page }).include(include).withTags(['wcag2a', 'wcag2aa']).analyze()
  const found = results.violations.flatMap((v) => v.nodes.map((n) => `${v.id} @ ${n.target.join(' ')}: ${(n.any[0]?.message ?? n.failureSummary ?? '').replace(/\s+/g, ' ').slice(0, 180)}`))
  expect(found, `no WCAG 2 A/AA violations in ${include}`).toEqual([])
}
/** Element screenshots only: full-page captures of long consoles repeat the page top (PAY-03B finding). */
async function shot(page: Page, selector: string, name: string) {
  await page.locator(selector).first().screenshot({ path: `${SCREENS}/${name}.png` })
}

// The shared sensitive limiter (login, checkout, provider re-reads) is one per-IP counter: pace the journey.
test.afterEach(async () => { await new Promise((resolve) => setTimeout(resolve, 15_000)) })
test.afterAll(() => {
  if (EVIDENCE_DIR) writeFileSync(`${EVIDENCE_DIR}/uat/browser-journal-${String(EXPECTED_SHA).slice(0, 8)}.json`, JSON.stringify(journal, null, 2), { mode: 0o600 })
})

const state: { caseId?: string; invoiceId?: string; invoiceNumber?: string; collectionId?: string } = {}

test('runtime provenance: the web build and the backend are the candidate; the provider is the local simulator', async ({ request, baseURL }) => {
  const web = await (await request.get(`${baseURL}/carup-provenance.json`)).json()
  expect(web.commit_sha).toBe(EXPECTED_SHA)
  const health = await (await request.get(`${API}/api/health`)).json()
  expect(health.build.commit_sha).toBe(EXPECTED_SHA)
  expect(sql("select garage_simulator_enabled from public.pay04_runtime_guard")).toBe('t')
  note('provenance', { web: web.commit_sha, backend: health.build.commit_sha })
})

test('case 6 (browser): the garage issues the invoice from the job’s real record and parts, and an untrue part line is refused', async ({ page }) => {
  const job = await completedJob()
  state.caseId = job.caseId
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page, 'adminA')
  await actForGarageA(page)
  await page.goto(`/garage/cases/${job.caseId}`)
  const form = page.getByTestId('invoice-form')
  await expect(form).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('closeout-part')).toContainText('Brake pads')
  // an untrue line: a part typed by hand, not recorded as used — the server refuses it, the form says why
  await page.getByTestId('add-invoice-line').click()
  const extra = page.getByTestId('invoice-line').last()
  await extra.getByLabel('Kind of line').selectOption('part')
  await extra.getByLabel('Description').fill('Pads typed by hand')
  await extra.getByLabel('Quantity').fill('1')
  await extra.getByLabel('Unit price').fill('25.00')
  await page.getByTestId('submit-invoice').click()
  await expect(page.getByTestId('case-action-error')).toContainText('A part can only be invoiced from a part recorded as used on this job', { timeout: 30_000 })
  await expect(page.getByTestId('invoice')).toHaveCount(0)
  await shot(page, '[data-testid="closeout-section"], [data-testid="invoice-form"]', '01-invoice-untrue-part-line-refused-desktop')
  // the real invoice, from the suggested lines (labour from the service record, the part from recorded consumption)
  await page.reload()
  await expect(page.getByTestId('invoice-form')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('submit-invoice').click()
  const invoice = page.getByTestId('invoice')
  await expect(invoice).toBeVisible({ timeout: 30_000 })
  await expect(invoice.getByTestId('invoice-total')).toContainText('135.00')
  await expect(invoice.getByTestId('invoice-lines')).toContainText('Brake pads')
  state.invoiceNumber = (await invoice.getByTestId('invoice-number').innerText()).replace(/^Invoice\s+/, '').trim()
  state.invoiceId = sql(`select id from garage_invoices where tenant_id = ${lit(accounts.garageA as string)} and invoice_number = ${lit(state.invoiceNumber)}`)
  await axeClean(page, '[data-testid="invoice"]')
  await shot(page, '[data-testid="invoice"]', '02-garage-invoice-issued-desktop')
  note('invoice-issued', { invoice: state.invoiceNumber, total: '135.00' })
})

test('cases 7, 19 (browser): the customer sees the invoice and the garage’s instructions, pays on the SIMULATED provider page, and CarUp confirms only from a provider read', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page, 'customer')
  await page.goto('/dashboard/service-requests')
  const card = page.getByTestId('invoice-card').filter({ hasText: `Invoice ${state.invoiceNumber}` })
  await expect(card).toBeVisible({ timeout: 30_000 })
  await expect(card.getByTestId('invoice-total')).toContainText('135.00')
  await card.getByTestId('how-to-pay-toggle').click()
  await expect(card.getByTestId('instructions-text')).toContainText('Pay at the front desk')
  await expect(card.getByTestId('instructions-disclosure')).toContainText('CarUp does not receive, hold or verify this money')
  await expect(card.getByTestId('online-payment-simulated')).toContainText('No real money moves')
  await expect(card.getByTestId('online-payment-amount')).toHaveValue('135.00')
  await card.getByTestId('online-payment-amount').fill('100.00')
  await axeClean(page, `[data-testid="invoice-card"]:has-text("Invoice ${state.invoiceNumber}")`)
  await shot(page, `[data-testid="invoice-card"]:has-text("Invoice ${state.invoiceNumber}")`, '03-customer-invoice-how-to-pay-desktop')
  await card.getByTestId('online-payment-start').click()
  await page.waitForURL(/127\.0\.0\.1:5051\/api\/pay04\/simulator\/checkout\/gsim_co_/, { timeout: 60_000 })
  await expect(page.getByTestId('pay04-simulator-banner')).toContainText('SIMULATED GARAGE PAYMENT PROVIDER')
  await expect(page.getByTestId('pay04-simulator-merchant')).toHaveText('gsim_merchant_pay04_qa_garage_a')
  await expect(page.getByTestId('pay04-simulator-amount')).toHaveText('USD 100.00')
  await page.screenshot({ path: `${SCREENS}/04-simulated-garage-provider-checkout.png` })
  await page.getByTestId('pay04-simulator-pay').click()
  await page.waitForURL(/127\.0\.0\.1:5203\/dashboard\/service-requests\?.*pay04=returned/, { timeout: 60_000 })
  state.collectionId = new URL(page.url()).searchParams.get('collection') || undefined
  const outcome = page.getByTestId('payment-return-outcome')
  await expect(outcome).toHaveAttribute('data-tone', 'ok', { timeout: 60_000 })
  await expect(outcome).toContainText('confirmed your payment')
  const after = page.getByTestId('invoice-card').filter({ hasText: `Invoice ${state.invoiceNumber}` })
  await expect(after.getByTestId('invoice-provider-amount')).toContainText('100.00', { timeout: 30_000 })
  await expect(after.getByTestId('invoice-recorded-amount')).toContainText('0.00')
  await expect(after.getByTestId('invoice-balance')).toContainText('35.00')
  await expect(after.getByTestId('invoice-provider-receipt')).toContainText(/Receipt RCT-\d{6}/)
  await expect(after.getByTestId('invoice-payment-status')).toHaveText(/Partly paid \(confirmed by the garage’s payment provider\)/)
  await axeClean(page, '[data-testid="payment-return-outcome"]')
  await shot(page, '[data-testid="payment-return-outcome"]', '05-customer-return-confirmed-desktop')
  await shot(page, `[data-testid="invoice-card"]:has-text("Invoice ${state.invoiceNumber}")`, '06-customer-invoice-provider-confirmed-desktop')
  const tx = sql(`select concat_ws('|', p.status, p.pay02_funds_owner, p.pay02_legal_beneficiary) from pay04_garage_collections c join payment_transactions p on p.reference = c.payment_reference where c.id = ${lit(state.collectionId || '')}`)
  expect(tx).toBe(`paid|garage_business_tenant|tenant:${accounts.garageA}`)
  note('customer-paid-online', { collection: state.collectionId, canonical: tx })
})

test('cases 8–12 (browser): the garage sees the provider payment beside its own records, records the cash remainder, and both provenances stay separate', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page, 'adminA')
  await actForGarageA(page)
  await page.goto(`/garage/cases/${state.caseId}`)
  const invoice = page.getByTestId('invoice')
  await expect(invoice).toBeVisible({ timeout: 30_000 })
  await expect(invoice.getByTestId('money-provider')).toContainText('100.00')
  await expect(invoice.getByTestId('money-declared')).toContainText('0.00')
  await expect(invoice.getByTestId('provider-payment-state').first()).toHaveText('Confirmed by the provider')
  await expect(invoice.getByTestId('provider-receipt-row').first()).toContainText(/Receipt RCT-\d{6}: 100\.00 USD/)
  await invoice.getByTestId('provider-activity').locator('summary').click()
  await expect(invoice.getByTestId('provider-activity-row').first()).toContainText('Customer started a payment through the provider')
  await invoice.getByTestId('record-payment').click()
  const form = page.getByTestId('payment-form')
  await expect(form.getByTestId('payment-unverified-note')).toBeVisible()
  await form.getByTestId('payment-amount').fill('35.00')
  await form.getByTestId('payment-method').selectOption('cash')
  await form.getByTestId('payment-reference').fill('Till 1')
  await form.getByTestId('submit-payment').click()
  await expect(invoice.getByTestId('invoice-balance')).toHaveText(/^\s*0\.00 USD\s*$/, { timeout: 30_000 })
  await expect(invoice.getByTestId('invoice-payment-status')).toHaveText('Paid in full (recorded by the garage and confirmed by its payment provider)')
  await expect(invoice.getByTestId('payment-source').first()).toHaveText('Recorded by the garage. CarUp has not processed or verified this payment.')
  await axeClean(page, '[data-testid="invoice"]')
  await shot(page, '[data-testid="invoice"]', '07-garage-invoice-mixed-provenance-desktop')
  note('garage-recorded-remainder', { invoice: state.invoiceNumber })
})

test('the garage refunds the provider payment with a reason; it stops counting at once and the customer sees it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  // the garage's own cash record (35.00) is untouched by a provider refund; only the provider's 100.00 stops counting
  await login(page, 'adminA')
  await actForGarageA(page)
  await page.goto(`/garage/cases/${state.caseId}`)
  const invoice = page.getByTestId('invoice')
  await expect(invoice).toBeVisible({ timeout: 30_000 })
  await invoice.getByTestId('provider-payment-refund').click()
  await page.getByTestId('provider-refund-form-reason').fill('short')
  await page.getByTestId('provider-refund-form-submit').click()
  await expect(page.getByTestId('provider-refund-form-error')).toContainText('at least 10 characters')
  await page.getByTestId('provider-refund-form-reason').fill('Customer prefers to pay the whole invoice in cash')
  await page.getByTestId('provider-refund-form-submit').click()
  await expect(invoice.getByTestId('provider-payment-state').first()).toHaveText('Refunded to the customer', { timeout: 60_000 })
  await expect(invoice.getByTestId('money-provider')).toContainText('0.00')
  await expect(invoice.getByTestId('invoice-balance')).toHaveText(/^\s*100\.00 USD\s*$/)
  await shot(page, '[data-testid="provider-payments"]', '08-garage-refund-done-desktop')
  const customer = await page.context().browser()!.newPage()
  await customer.setViewportSize({ width: 1440, height: 900 })
  await login(customer, 'customer')
  await customer.goto('/dashboard/service-requests')
  const card = customer.getByTestId('invoice-card').filter({ hasText: `Invoice ${state.invoiceNumber}` })
  await expect(card.getByTestId('invoice-provider-payment').first()).toHaveAttribute('data-state', 'refunded', { timeout: 30_000 })
  await expect(card.getByTestId('invoice-provider-amount')).toContainText('0.00')
  await shot(customer, `[data-testid="invoice-card"]:has-text("Invoice ${state.invoiceNumber}")`, '09-customer-sees-refund-desktop')
  await customer.close()
  note('garage-refund', { collection: state.collectionId, status: sql(`select p.status from pay04_garage_collections c join payment_transactions p on p.reference = c.payment_reference where c.id = ${lit(state.collectionId || '')}`) })
})

test('operator: a provider that misreports an amount is reviewed with its evidence and closed with a written note', async ({ page }) => {
  // a fresh online payment on a new invoice, with the simulator told to misreport the amount (UAT fault injection)
  const job = await completedJob('50.00', 1, '10.00')
  const inv = (await api('adminA', 'POST', `/api/garage/cases/${job.caseId}/invoice`, { currency: 'USD', lines: (await api('adminA', 'GET', `/api/garage/cases/${job.caseId}/closeout`)).suggested_invoice.lines })).invoice
  const started = await api('customer', 'POST', `/api/pay04/garage-invoices/${inv.id}/payments`, {}, { 'Idempotency-Key': `p4br-op-${randomUUID()}` })
  const paymentId = sql(`select provider_payment_id from pay04_garage_collections where id = ${lit(started.collection_id)}`)
  await api('ops', 'POST', `/api/pay04/simulator/payments/${paymentId}/misreport`, { amountMinor: 5900 })
  const checkoutId = new URL(started.checkout_url).pathname.split('/').pop()
  await fetch(`${API}/api/pay04/simulator/checkout/${checkoutId}/complete`, { method: 'POST', body: new URLSearchParams({ outcome: 'success' }), redirect: 'manual' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page, 'ops')
  await page.goto('/admin/garage-payments')
  const row = page.getByTestId('operator-discrepancy').filter({ hasText: 'Provider reported a different amount' }).first()
  await expect(row).toBeVisible({ timeout: 30_000 })
  await expect(row.getByTestId('operator-discrepancy-evidence')).toContainText('"observed_amount_minor": 5900')
  await row.getByTestId('operator-trail').locator('summary').click()
  await expect(row.getByTestId('operator-trail')).toContainText('Discrepancy opened')
  await axeClean(page, '[data-testid="operator-exceptions"]')
  await shot(page, '[data-testid="operator-exceptions"]', '10-operator-discrepancy-desktop')
  await api('ops', 'POST', `/api/pay04/simulator/payments/${paymentId}/misreport`, {})
  await row.getByTestId('operator-resolve').click()
  await page.getByTestId('operator-resolution-note').fill('Provider support confirmed the correct amount (USD 60.00); report corrected')
  await page.getByTestId('operator-resolve-submit').click()
  await expect(page.getByTestId('operator-message')).toHaveText('Exception closed.', { timeout: 30_000 })
  note('operator-closed-discrepancy', { collection: started.collection_id })
})

for (const vp of VIEWPORTS) {
  test(`case 24: customer, garage, overview and operator surfaces at ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await login(page, 'customer')
    await page.goto('/dashboard/service-requests')
    const card = page.getByTestId('invoice-card').filter({ hasText: `Invoice ${state.invoiceNumber}` })
    await expect(card).toBeVisible({ timeout: 30_000 })
    await card.getByTestId('how-to-pay-toggle').click()
    await expect(card.getByTestId('how-to-pay-instructions')).toBeVisible({ timeout: 30_000 })
    await noHorizontalOverflow(page)
    await axeClean(page, `[data-testid="invoice-card"]:has-text("Invoice ${state.invoiceNumber}")`)
    await shot(page, `[data-testid="invoice-card"]:has-text("Invoice ${state.invoiceNumber}")`, `11-customer-invoice-${vp.name}`)

    await login(page, 'adminA')
    await actForGarageA(page)
    await page.goto(`/garage/cases/${state.caseId}`)
    await expect(page.getByTestId('invoice')).toBeVisible({ timeout: 30_000 })
    await noHorizontalOverflow(page)
    await axeClean(page, '[data-testid="invoice"]')
    await shot(page, '[data-testid="invoice"]', `12-garage-invoice-${vp.name}`)
    await page.goto('/garage/payments')
    await expect(page.getByTestId('garage-money-currency').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('garage-money-owner-note')).toContainText('CarUp is not paid any of this money')
    await noHorizontalOverflow(page)
    await axeClean(page, '[data-testid="garage-payments-page"]')
    await shot(page, '[data-testid="garage-money-section"]', `13-garage-money-${vp.name}`)
    await shot(page, '[data-testid="garage-instructions-section"]', `14-garage-instructions-${vp.name}`)

    await login(page, 'ops')
    await page.goto('/admin/garage-payments')
    await expect(page.getByTestId('garage-payments-operator')).toBeVisible({ timeout: 30_000 })
    await noHorizontalOverflow(page)
    await axeClean(page, '[data-testid="garage-payments-operator"]')
    await shot(page, '[data-testid="operator-merchants"]', `15-operator-merchants-${vp.name}`)
    note(`viewport-${vp.name}`, { ok: true })
  })
}
