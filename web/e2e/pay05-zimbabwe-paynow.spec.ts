/**
 * CARUP-PAY-05-LR01 — physical browser UAT of Zimbabwe collections through the garage's OWN Paynow merchant: the garage
 * connects its Paynow account, a CarUp operator verifies it, the customer pays on the (simulated) Paynow page, by EcoCash,
 * InnBucks and O'mari, the garage reads its Paynow payments and the operator handles held requests — at desktop, tablet
 * and mobile widths, with axe on every surface.
 *
 * Runs ONLY against the isolated local runtime of scripts/uat/pay05-local-runtime.sh (web 127.0.0.1:5203, backend
 * 127.0.0.1:5051, LOCAL PAYNOW PROTOCOL SIMULATOR 127.0.0.1:5071, dedicated carup-pay04-supabase stack) after
 * scripts/uat/pay05-qa-seed.mjs and scripts/uat/pay05-http-matrix.mjs (which connects garages A and B; garage C is
 * connected here, in the browser). No real money moves. It never mocks the API.
 *
 *   PAY05_EXPECTED_SHA=<candidate> PAY05_EVIDENCE_DIR=$HOME/carup-launch-evidence/pay05 \
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:5203 \
 *   npx playwright test e2e/pay05-zimbabwe-paynow.spec.ts --project=chromium --headed --retries=0
 */
import { test, expect, type Locator, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const EVIDENCE_DIR = process.env.PAY05_EVIDENCE_DIR
const EXPECTED_SHA = process.env.PAY05_EXPECTED_SHA
const API = 'http://127.0.0.1:5051'
const SIM = 'http://127.0.0.1:5071'
const PGURL = 'postgresql://postgres:postgres@127.0.0.1:56322/postgres'

test.skip(!EVIDENCE_DIR || !EXPECTED_SHA, 'PAY-05 physical UAT runs only against the isolated local runtime (scripts/uat/pay05-local-runtime.sh).')
test.describe.configure({ mode: 'serial', timeout: 300_000 })

type Account = { email: string; password: string; userId: string; role: string }
const accounts: Record<string, Account | string> = EVIDENCE_DIR ? JSON.parse(readFileSync(`${EVIDENCE_DIR}/uat-accounts.json`, 'utf8')) : {}
const integrations: Record<string, { integration_id: string; integration_key: string; methods: string[] }> = EVIDENCE_DIR
  ? JSON.parse(readFileSync(`${EVIDENCE_DIR}/runtime/simulated-integrations.json`, 'utf8')).integrations : {}
const controlToken = EVIDENCE_DIR ? readFileSync(`${EVIDENCE_DIR}/runtime/simulator-control-token`, 'utf8').trim() : ''
const acct = (k: string) => accounts[k] as Account
const SCREENS = `${EVIDENCE_DIR}/screens`
if (EVIDENCE_DIR) mkdirSync(`${EVIDENCE_DIR}/uat`, { recursive: true })
if (EVIDENCE_DIR) mkdirSync(SCREENS, { recursive: true })
const sql = (q: string) => execFileSync('psql', [PGURL, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8' }).trim()
const lit = (v: string) => `'${String(v).replace(/'/g, "''")}'`
const journal: Array<Record<string, unknown>> = []
const note = (step: string, detail: Record<string, unknown> = {}) => journal.push({ step, at: new Date().toISOString(), ...detail })
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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
type ApiJson = { [key: string]: ApiJson } & string
async function api(who: string, method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
  const token = await apiLogin(who)
  const tenant = who === 'adminC' || who === 'mechC' ? (accounts.garageC as string) : null
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
/** The local Paynow protocol simulator's TEST controls (never part of Paynow's merchant API). */
async function sim(method: string, route: string, body?: unknown) {
  const r = await fetch(`${SIM}/__control${route}`, { method, headers: { 'x-simulator-control-token': controlToken, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) })
  return r.json()
}
const simTxFor = async (collectionId: string) => {
  const ref = sql(`select payment_reference from pay04_garage_collections where id = ${lit(collectionId)}`)
  return ((await sim('GET', '/transactions')) as Array<{ guid: string; reference: string }>).find((t) => t.reference === ref)
}
const payStatus = (collectionId: string) => sql(`select p.status from pay04_garage_collections c join payment_transactions p on p.reference = c.payment_reference where c.id = ${lit(collectionId)}`)
async function waitFor(fn: () => boolean, ms = 30_000) {
  const until = Date.now() + ms
  while (Date.now() < until) { if (fn()) return true; await pause(500) }
  return fn()
}

/** A completed, authorized job at garage C with recorded parts, invoiced (the PAY-04 product path). */
async function invoiceAtGarageC(cost = '40.00', sellPrice = '10.00') {
  const c = await api('customer', 'POST', '/api/service-cases', { vin: accounts.vinCustomer, garage_tenant_id: accounts.garageC, branch_id: accounts.branchC,
    service_category: 'brakes', request_summary: 'Browser UAT job (PAY-05 QA)' })
  const caseId = c.case.id
  await api('adminC', 'POST', `/api/service-cases/${caseId}/accept`, { branch_id: accounts.branchC })
  const wo = (await api('adminC', 'POST', `/api/service-cases/${caseId}/work-order`, {})).workOrder.id
  const est = (await api('adminC', 'POST', `/api/garage/cases/${caseId}/estimates`, { currency: 'USD', lines: [
    { category: 'labour', description: 'Brake service', quantity: 1, unit_price: cost },
    { category: 'part', description: 'Brake pads', quantity: 1, unit_price: sellPrice }] })).estimate.id
  await api('adminC', 'POST', `/api/garage/estimates/${est}/send`, {})
  await api('customer', 'POST', `/api/service-estimates/${est}/decision`, { decision: 'accept' })
  await api('adminC', 'POST', `/api/service-work-orders/${wo}/assign`, { mechanic_user_id: acct('mechC').userId })
  await api('adminC', 'POST', `/api/service-cases/${caseId}/start`, {})
  const rec = (await api('mechC', 'POST', `/api/service-work-orders/${wo}/records`, { work_performed: 'Replaced pads', total_cost: cost, currency: 'USD' })).record.id
  const part = (await api('adminC', 'POST', '/api/garage/stock', { name: 'Brake pads (browser QA)', sku: `P5QA-BR-${randomUUID().slice(0, 8)}`, opening_quantity: 5,
    unit_cost: '4.00', sell_price: sellPrice, price_currency: 'USD', idempotency_key: `p5br-part-${randomUUID()}` })).part.id
  await api('mechC', 'POST', `/api/garage/service-records/${rec}/parts`, { part_id: part, quantity: 1, idempotency_key: `p5br-use-${randomUUID()}` })
  await api('mechC', 'POST', `/api/service-cases/${caseId}/complete-job`, {})
  const lines = (await api('adminC', 'GET', `/api/garage/cases/${caseId}/closeout`)).suggested_invoice.lines
  const inv = (await api('adminC', 'POST', `/api/garage/cases/${caseId}/invoice`, { currency: 'USD', lines })).invoice
  return { caseId, invoiceId: inv.id as string, number: inv.invoice_number as string }
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
/** Act for garage C through the product's own organisation switcher (PUT /api/auth/active-tenant). */
async function actForGarageC(page: Page) {
  await page.goto('/dashboard')
  const badge = page.getByTestId('organisation-badge')
  await expect(badge).toBeVisible({ timeout: 30_000 })
  if (/Acting for .*PAY05 QA Garage C/.test((await badge.getAttribute('aria-label')) ?? '')) return
  const prompt = page.getByTestId('organisation-prompt')
  let control = prompt.getByRole('button', { name: /Act for .*PAY05 QA Garage C/ })
  if (!(await control.isVisible().catch(() => false))) {
    await badge.click()
    control = page.getByRole('menuitem', { name: /Act for .*PAY05 QA Garage C/ })
  }
  const selection = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/auth\/active-tenant/.test(r.url()))
  await control.click()
  expect((await selection).ok()).toBe(true)
  await expect(badge).toHaveAttribute('aria-label', /Acting for .*PAY05 QA Garage C/, { timeout: 30_000 })
}
async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, 'no lateral page overflow').toBeLessThanOrEqual(1)
}
async function axeClean(page: Page, include: string) {
  // the RESTING state: a click leaves the pointer over whatever renders next, and the shared Button fades 0.5 → 1 over
  // 150 ms after it is enabled (PAY-03B finding) — measure after both settle
  await page.mouse.move(0, 0)
  await page.waitForTimeout(400)
  const results = await new AxeBuilder({ page }).include(include).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  const found = results.violations.flatMap((v) => v.nodes.map((n) => `${v.id} @ ${n.target.join(' ')}: ${(n.any[0]?.message ?? n.failureSummary ?? '').replace(/\s+/g, ' ').slice(0, 180)}`))
  expect(found, `no WCAG 2.2 A/AA violations in ${include}`).toEqual([])
}
/** Element screenshots only (full-page captures of long pages repeat the top); sticky chrome hidden during capture only. */
async function shot(page: Page, target: string | Locator, name: string) {
  const locator = typeof target === 'string' ? page.locator(target).first() : target
  await locator.screenshot({ path: `${SCREENS}/${name}.png`,
    style: '.sticky.top-0, .fixed.bottom-0 { opacity: 0 !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }' })
}
/** The customer's invoice card for one invoice, with its "how to pay" opened. */
/** Garage C's invoice <number>: numbers repeat across garages and "INV-000001" is a prefix of "INV-000010", so the card
 *  is found inside garage C's request card by its exact heading. */
const invoiceCard = (page: Page, number: string) => page.getByTestId('service-request-card')
  .filter({ has: page.getByTestId('request-garage').filter({ hasText: 'PAY05 QA Garage C' }) })
  .getByTestId('invoice-card')
  .filter({ has: page.getByRole('heading', { name: `Invoice ${number}`, exact: true }) })
async function openHowToPay(page: Page, number: string, { checkout = true } = {}) {
  await page.goto('/dashboard/service-requests')
  const card = invoiceCard(page, number)
  await expect(card).toBeVisible({ timeout: 30_000 })
  const toggle = card.getByTestId('how-to-pay-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  // a payment in progress for the whole balance offers "continue this payment", not a second checkout
  if (checkout) await expect(card.getByTestId('paynow-checkout')).toBeVisible({ timeout: 30_000 })
  else await expect(card.getByTestId('my-provider-payments')).toBeVisible({ timeout: 30_000 })
  return card
}

// Every actor here shares 127.0.0.1, and every sensitive route (login, checkout, Paynow's own status updates) shares ONE
// per-IP counter: pace the journey, and start each test in a fresh global window (the PAY-04 spec's measured approach).
test.afterEach(async () => { await pause(15_000) })
async function freshGlobalWindow(minRemaining = 85) {
  for (let i = 0; i < 3; i += 1) {
    const r = await fetch(`${API}/api/security/csrf-token`)
    const remaining = Number(r.headers.get('ratelimit-remaining'))
    const reset = Number(r.headers.get('ratelimit-reset'))
    if (!Number.isFinite(remaining) || remaining >= minRemaining) return
    await pause((Math.max(Number.isFinite(reset) ? reset : 60, 1) + 1) * 1000)
  }
}
test.beforeEach(async () => { await freshGlobalWindow() })
test.afterAll(() => {
  if (EVIDENCE_DIR) writeFileSync(`${EVIDENCE_DIR}/uat/browser-journal-${String(EXPECTED_SHA).slice(0, 8)}.json`, JSON.stringify(journal, null, 2), { mode: 0o600 })
})

test('runtime provenance: the web build and the backend are the candidate; Paynow is the local protocol simulator, real Paynow off', async ({ request, baseURL }) => {
  const web = await (await request.get(`${baseURL}/carup-provenance.json`)).json()
  expect(web.commit_sha).toBe(EXPECTED_SHA)
  const health = await (await request.get(`${API}/api/health`)).json()
  expect(health.build.commit_sha).toBe(EXPECTED_SHA)
  expect(sql('select paynow_simulator_enabled::text || paynow_real_enabled::text from public.pay05_runtime_guard')).toBe('truefalse')
  note('provenance', { web: web.commit_sha, backend: health.build.commit_sha })
})

test('C (browser, desktop): the garage connects ITS OWN Paynow merchant — field errors where they belong, the key never shown again', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page, 'adminC')
  await actForGarageC(page)
  await page.goto('/garage/payments')
  const section = page.getByTestId('garage-paynow-section')
  await expect(section).toBeVisible({ timeout: 30_000 })
  const usd = integrations.C_USD
  for (const [name, value] of [['display_name', 'PAY05 QA Garage C (Paynow)'], ['legal_entity_name', 'PAY05 QA Garage C (Pvt) Ltd'],
    ['registration_number', 'C5/2026'], ['settlement_bank_name', 'QA Bank (synthetic)'], ['settlement_account_last4', '4321'],
    ['settlement_account_holder', 'PAY05 QA Garage C (Pvt) Ltd']] as const) {
    await section.getByTestId(`paynow-connect-${name}`).fill(value)
  }
  const usdEnabled = section.getByTestId('paynow-connect-USD-enabled')
  if (!(await usdEnabled.isChecked())) await usdEnabled.check()
  // an integration ID that is not Paynow's shape: refused next to the field, nothing sent, the typed key kept
  await section.getByTestId('paynow-connect-USD-id').fill('ID 12345')
  await section.getByTestId('paynow-connect-USD-key').fill(usd.integration_key)
  for (const m of usd.methods) {
    const box = section.getByTestId(`paynow-connect-USD-method-${m}`)
    if (!(await box.isChecked())) await box.check()
  }
  await section.getByTestId('paynow-connect-attest').check()
  await section.getByTestId('paynow-connect-submit').click()
  const idField = section.getByTestId('paynow-connect-USD-id')
  await expect(idField).toHaveAttribute('aria-invalid', 'true')
  await expect(section.getByTestId('paynow-connect-USD-id-error')).toBeVisible()
  await expect(section.getByTestId('paynow-connect-USD-key')).toHaveValue(usd.integration_key)
  await expect(section.getByTestId('paynow-connect-USD-key')).not.toHaveAttribute('type', 'password')
  await axeClean(page, '[data-testid="garage-paynow-section"]')
  await shot(page, '[data-testid="garage-paynow-section"]', '01-garage-connect-field-error-desktop')
  await idField.fill(usd.integration_id)
  await section.getByTestId('paynow-connect-submit').click()
  await expect(section.getByTestId('garage-paynow-status')).toContainText(/pending|verif/i, { timeout: 30_000 })
  await expect(section.getByTestId('garage-paynow-integrations')).toContainText(usd.integration_id)
  expect(await section.innerText()).not.toContain(usd.integration_key)
  await axeClean(page, '[data-testid="garage-paynow-section"]')
  await shot(page, '[data-testid="garage-paynow-section"]', '02-garage-connected-pending-desktop')
  const merchant = sql(`select status from pay04_garage_merchant_accounts where tenant_id = ${lit(accounts.garageC as string)} and gateway = 'paynow_zimbabwe' order by registered_at desc limit 1`)
  expect(merchant).toBe('pending_verification')
  expect(Number(sql(`select count(*) from pay05_merchant_integrations i join pay04_garage_merchant_accounts m on m.id = i.merchant_account_id where m.tenant_id = ${lit(accounts.garageC as string)} and position(${lit(usd.integration_key)} in i::text) > 0`))).toBe(0)
  note('garage-connected', { merchant_status: merchant })
})

test('C (browser, desktop): an independent operator verifies — three reviews and a note; the server proves the key with Paynow', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page, 'ops')
  await page.goto('/admin/garage-payments')
  const panel = page.getByTestId('paynow-operator')
  await expect(panel).toBeVisible({ timeout: 30_000 })
  const card = panel.getByTestId('paynow-op-merchant').filter({ hasText: 'PAY05 QA Garage C' }).first()
  await expect(card).toBeVisible({ timeout: 30_000 })
  const verify = card.getByTestId('paynow-op-verify')
  await expect(verify).toBeDisabled()
  await card.getByTestId('paynow-op-legal').check()
  await card.getByTestId('paynow-op-settlement').check()
  await expect(verify).toBeDisabled()
  await card.getByTestId('paynow-op-currency').check()
  await card.getByTestId('paynow-op-note').fill('Legal name, settlement account and the USD integration\'s currency checked (PAY-05 browser QA).')
  await expect(verify).toBeEnabled()
  await axeClean(page, '[data-testid="paynow-operator"]')
  await shot(page, '[data-testid="paynow-op-merchant"]:has-text("PAY05 QA Garage C")', '03-operator-verify-ready-desktop')
  await verify.click()
  await expect(panel.getByTestId('paynow-op-message')).not.toBeEmpty({ timeout: 60_000 })
  await expect.poll(() => sql(`select status from pay04_garage_merchant_accounts where tenant_id = ${lit(accounts.garageC as string)} and gateway = 'paynow_zimbabwe' order by registered_at desc limit 1`), { timeout: 30_000 }).toBe('verified')
  const probe = sql(`select string_agg(verification_evidence->'credential_probe'->>'result', ',') from pay05_merchant_integrations i join pay04_garage_merchant_accounts m on m.id = i.merchant_account_id where m.tenant_id = ${lit(accounts.garageC as string)} and i.status = 'verified'`)
  expect(probe).toBe('authenticated')
  const verifiedCard = panel.getByTestId('paynow-op-merchant').filter({ hasText: 'PAY05 QA Garage C' }).first()
  await expect(verifiedCard.getByTestId('paynow-op-history')).toBeVisible({ timeout: 30_000 })
  await shot(page, '[data-testid="paynow-op-merchant"]:has-text("PAY05 QA Garage C")', '04-operator-verified-history-desktop')
  note('operator-verified', { probe })
})

const state: { web?: { caseId: string; invoiceId: string; number: string; collectionId?: string } } = {}

test('D/E (browser, desktop): the customer pays on Paynow\'s (simulated) page; coming back proves nothing until CarUp reads Paynow', async ({ page }) => {
  state.web = await invoiceAtGarageC('40.00', '10.00')
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page, 'customer')
  const card = await openHowToPay(page, state.web.number)
  await expect(card.getByTestId('paynow-simulated')).toBeVisible()
  await expect(card.getByTestId('paynow-no-redirect-proof')).toBeVisible()
  await card.getByTestId('paynow-method-web').check()
  await axeClean(page, '[data-testid="invoice-card"]')
  await shot(page, invoiceCard(page, state.web.number), '05-customer-paynow-methods-desktop')
  await card.getByTestId('paynow-start').click()
  await page.waitForURL(/127\.0\.0\.1:5071\/Payment\/ConfirmPayment\//i, { timeout: 60_000 })
  await expect(page.getByTestId('simulated-paynow-status')).toHaveText('Created')
  await page.screenshot({ path: `${SCREENS}/06-simulated-paynow-hosted-page.png` })
  await page.getByRole('button', { name: /Pay \(simulated card\)/ }).click()
  await page.waitForURL(/127\.0\.0\.1:5203\/dashboard\/service-requests\?.*pay05=returned/, { timeout: 60_000 })
  state.web.collectionId = new URL(page.url()).searchParams.get('collection') || undefined
  const outcome = page.getByTestId('payment-return-outcome')
  await expect(outcome).toHaveAttribute('data-tone', 'ok', { timeout: 60_000 })
  await expect.poll(() => payStatus(state.web!.collectionId!), { timeout: 30_000 }).toBe('paid')
  const ledger = sql(`select concat_ws('|', p.gateway, p.status, p.pay02_funds_owner, p.pay02_legal_beneficiary) from pay04_garage_collections c join payment_transactions p on p.reference = c.payment_reference where c.id = ${lit(state.web.collectionId!)}`)
  expect(ledger).toBe(`paynow_zimbabwe|paid|garage_business_tenant|tenant:${accounts.garageC}`)
  await axeClean(page, '[data-testid="payment-return-outcome"]')
  await shot(page, '[data-testid="payment-return-outcome"]', '07-customer-return-confirmed-desktop')
  note('customer-paid-on-paynow-page', { collection: state.web.collectionId, ledger })
})

test('D/E (browser, tablet): EcoCash — "approve on your phone" is pending, never paid, until Paynow confirms', async ({ page }) => {
  const inv = await invoiceAtGarageC('30.00', '5.00')
  await page.setViewportSize({ width: 768, height: 1024 })
  await login(page, 'customer')
  const card = await openHowToPay(page, inv.number)
  await card.getByTestId('paynow-method-ecocash').check()
  await expect(card.getByTestId('paynow-start')).toBeDisabled()
  await expect(card.getByTestId('paynow-phone-hint')).toBeVisible()
  await card.getByTestId('paynow-phone').fill('0771111111') // Paynow's documented test number: approved after ~5 s
  await card.getByTestId('paynow-start').click()
  await expect(card.getByTestId('paynow-pending')).toBeVisible({ timeout: 60_000 })
  await expect(card.getByTestId('paynow-status-badge')).not.toContainText(/^Paid/)
  await axeClean(page, '[data-testid="invoice-card"]')
  await shot(page, invoiceCard(page, inv.number), '08-customer-ecocash-pending-tablet')
  const collectionId = sql(`select id from pay04_garage_collections where invoice_id = ${lit(inv.invoiceId)} order by initiated_at desc limit 1`)
  await expect.poll(() => payStatus(collectionId), { timeout: 60_000 }).toBe('paid')
  await card.getByTestId('paynow-check').click()
  await expect(card.getByTestId('paynow-outcome')).not.toBeEmpty({ timeout: 60_000 })
  await shot(page, invoiceCard(page, inv.number), '09-customer-ecocash-confirmed-tablet')
  note('customer-ecocash', { collection: collectionId, status: payStatus(collectionId) })
})

test('D/E (browser, mobile): InnBucks — the code stays on screen, survives a reload in "continue this payment", and counts only when Paynow says Paid', async ({ page }) => {
  const inv = await invoiceAtGarageC('25.00', '5.00')
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page, 'customer')
  const card = await openHowToPay(page, inv.number)
  await card.getByTestId('paynow-method-innbucks').check()
  await card.getByTestId('paynow-phone').fill('0779000201')
  await card.getByTestId('paynow-start').click()
  const code = card.getByTestId('paynow-innbucks-code')
  await expect(code).toBeVisible({ timeout: 60_000 })
  const shown = (await code.innerText()).trim()
  await page.waitForTimeout(1500) // the invoice refreshes in place behind the panel (independent review W1)
  await expect(code).toBeVisible()
  await noHorizontalOverflow(page)
  await axeClean(page, '[data-testid="invoice-card"]')
  await shot(page, invoiceCard(page, inv.number), '10-customer-innbucks-code-mobile')
  // a reload: the existing request can be continued, with the same code (independent review W2)
  const again = await openHowToPay(page, inv.number, { checkout: false })
  await expect(again.getByTestId('paynow-checkout')).toHaveCount(0)
  await expect(again.getByTestId('paynow-innbucks-code').first()).toHaveText(shown, { timeout: 30_000 })
  await shot(page, invoiceCard(page, inv.number), '11-customer-innbucks-continue-mobile')
  const collectionId = sql(`select id from pay04_garage_collections where invoice_id = ${lit(inv.invoiceId)} order by initiated_at desc limit 1`)
  const tx = await simTxFor(collectionId)
  await sim('POST', `/transactions/${tx!.guid}/status`, { status: 'Paid' })
  await expect.poll(() => payStatus(collectionId), { timeout: 60_000 }).toBe('paid')
  note('customer-innbucks', { collection: collectionId, status: payStatus(collectionId) })
})

test('D/E (browser, mobile): O\'mari — a wrong code is refused in words; the right one completes an authenticated payment', async ({ page }) => {
  const inv = await invoiceAtGarageC('35.00', '5.00')
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page, 'customer')
  const card = await openHowToPay(page, inv.number)
  await card.getByTestId('paynow-method-omari').check()
  await card.getByTestId('paynow-phone').fill('0779000202')
  await card.getByTestId('paynow-start').click()
  await expect(card.getByTestId('paynow-otp')).toBeVisible({ timeout: 60_000 })
  await card.getByTestId('paynow-otp-input').fill('000000')
  await card.getByTestId('paynow-otp-submit').click()
  await expect(card.getByText(/code/i).first()).toBeVisible()
  await shot(page, invoiceCard(page, inv.number), '12-customer-omari-wrong-code-mobile')
  const outbox = (await sim('GET', '/otp')) as Array<{ phone: string; otp: string }>
  const otp = outbox.filter((o) => o.phone === '0779000202').pop()!.otp
  await card.getByTestId('paynow-otp-input').fill(otp)
  await card.getByTestId('paynow-otp-submit').click()
  const collectionId = sql(`select id from pay04_garage_collections where invoice_id = ${lit(inv.invoiceId)} order by initiated_at desc limit 1`)
  await expect.poll(() => payStatus(collectionId), { timeout: 60_000 }).toBe('paid')
  await noHorizontalOverflow(page)
  await axeClean(page, '[data-testid="invoice-card"]')
  await shot(page, invoiceCard(page, inv.number), '13-customer-omari-confirmed-mobile')
  note('customer-omari', { collection: collectionId, status: payStatus(collectionId) })
})

test('E (browser, tablet): the garage reads its Paynow payments in its own words; refunds are guided to the Paynow dashboard', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 })
  await login(page, 'adminC')
  await actForGarageC(page)
  const caseId = state.web!.caseId
  await page.goto(`/garage/cases/${caseId}`)
  const panel = page.getByTestId('provider-payments')
  await expect(panel).toBeVisible({ timeout: 30_000 })
  await expect(panel.getByTestId('provider-payment-paynow-refund-guidance').first()).toBeVisible()
  await expect(panel.getByTestId('provider-payment-refund')).toHaveCount(0)
  await axeClean(page, '[data-testid="provider-payments"]')
  await shot(page, '[data-testid="provider-payments"]', '14-garage-paynow-payments-tablet')
  note('garage-paynow-payments', { case: caseId })
})

test('E (browser, desktop): a stopped request stays HELD — the operator sees it with CarUp\'s time and cannot release it early', async ({ page }) => {
  const inv = await invoiceAtGarageC('20.00', '5.00')
  const started = await api('customer', 'POST', `/api/pay04/garage-invoices/${inv.invoiceId}/payments`, { method: 'ecocash', phone: '0779000203' },
    { 'Idempotency-Key': `p5br-held-${randomUUID()}` })
  await api('customer', 'POST', `/api/pay04/garage-payments/${started.collection_id}/cancel`, { reason: 'Customer will pay at the counter' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page, 'ops')
  await page.goto('/admin/garage-payments')
  // one row per held request: garage C's, for exactly this invoice number (numbers repeat across garages)
  const held = page.getByTestId('paynow-op-held').filter({ hasText: new RegExp(`PAY05 QA Garage C.* · invoice ${inv.number} · `) })
  await expect(held).toBeVisible({ timeout: 30_000 })
  await expect(held.getByTestId('paynow-op-release-wait')).toBeVisible()
  await expect(held.getByTestId('paynow-op-release')).toBeDisabled()
  await axeClean(page, '[data-testid="paynow-operator"]')
  await shot(page, held, '15-operator-held-request-desktop')
  note('operator-held', { collection: started.collection_id })
})

for (const vp of VIEWPORTS) {
  test(`E/F: Paynow checkout, garage connection and operator panel at ${vp.name} — accessible, no overflow`, async ({ page }) => {
    const inv = await invoiceAtGarageC('15.00', '5.00')
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await login(page, 'customer')
    await openHowToPay(page, inv.number)
    await noHorizontalOverflow(page)
    await axeClean(page, '[data-testid="invoice-card"]')
    await shot(page, invoiceCard(page, inv.number), `16-customer-paynow-checkout-${vp.name}`)

    await login(page, 'adminC')
    await actForGarageC(page)
    await page.goto('/garage/payments')
    await expect(page.getByTestId('garage-paynow-section')).toBeVisible({ timeout: 30_000 })
    await noHorizontalOverflow(page)
    await axeClean(page, '[data-testid="garage-paynow-section"]')
    await shot(page, '[data-testid="garage-paynow-section"]', `17-garage-paynow-connection-${vp.name}`)

    await login(page, 'ops')
    await page.goto('/admin/garage-payments')
    await expect(page.getByTestId('paynow-operator')).toBeVisible({ timeout: 30_000 })
    await noHorizontalOverflow(page)
    await axeClean(page, '[data-testid="paynow-operator"]')
    await shot(page, '[data-testid="paynow-operator"]', `18-operator-paynow-panel-${vp.name}`)
    note(`viewport-${vp.name}`, { ok: true })
  })
}
