/**
 * CARUP-PAY-05-R1 — what each person reads and can do for the states R1 made truthful: money held at Paynow, a released request,
 * a settlement outside CarUp, a dispute, late money and reversed money, at desktop, tablet and phone widths, with axe; and the
 * same screens by keyboard alone (customer, garage and operator). Every row shows Paynow's word, CarUp's count, any review and
 * the next step separately.
 *
 * Runs ONLY against the isolated local runtime of scripts/uat/pay05-local-runtime.sh, AFTER e2e/pay05-zimbabwe-paynow.spec.ts
 * (garage C is connected and verified by then). No real money moves. It never mocks the API; rows reach their states through the
 * product's endpoints, the local Paynow protocol simulator and, for CarUp's own clock only, one UPDATE on the disposable database.
 *
 *   PAY05_EXPECTED_SHA=<candidate> PAY05_EVIDENCE_DIR=$HOME/carup-launch-evidence/pay05 PLAYWRIGHT_BASE_URL=http://127.0.0.1:5203 \
 *   npx playwright test e2e/pay05-r1-state-truth.spec.ts --project=chromium --headed --retries=0
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

test.skip(!EVIDENCE_DIR || !EXPECTED_SHA, 'PAY-05-R1 physical UAT runs only against the isolated local runtime (scripts/uat/pay05-local-runtime.sh).')
test.describe.configure({ mode: 'serial', timeout: 420_000 })

type Account = { email: string; password: string; userId: string; role: string }
const accounts: Record<string, Account | string> = EVIDENCE_DIR ? JSON.parse(readFileSync(`${EVIDENCE_DIR}/uat-accounts.json`, 'utf8')) : {}
const controlToken = EVIDENCE_DIR ? readFileSync(`${EVIDENCE_DIR}/runtime/simulator-control-token`, 'utf8').trim() : ''
const acct = (k: string) => accounts[k] as Account
const SCREENS = `${EVIDENCE_DIR}/screens-r1`
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
/**
 * Every visible control holds its own words at this width. A button whose label wraps must grow with it: the shared
 * Button keeps a fixed small-screen height unless told otherwise, and the final rehearsal at ea0511ff showed "Pay … on
 * Paynow's page" cut off at 390 px. A radio or checkbox must keep its size when the words beside it wrap (InnBucks at 768 px).
 */
async function noClippedControls(page: Page, include: string) {
  const problems = await page.locator(include).evaluateAll((roots) => {
    const out: string[] = []
    const name = (el: HTMLElement) => el.dataset.testid ?? el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 48)
    const shown = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
    for (const root of roots) {
      for (const el of Array.from(root.querySelectorAll<HTMLElement>('button, [role="button"]'))) {
        if (shown(el) && el.scrollHeight - el.clientHeight > 1) out.push(`${name(el)}: ${el.scrollHeight}px of words in a ${el.clientHeight}px button`)
      }
      for (const el of Array.from(root.querySelectorAll<HTMLElement>('input[type="radio"], input[type="checkbox"]'))) {
        const r = el.getBoundingClientRect()
        if (shown(el) && Math.abs(r.width - r.height) > 1) out.push(`${name(el)}: squeezed to ${Math.round(r.width)}×${Math.round(r.height)} px`)
      }
    }
    return out
  })
  expect(problems, `every control in ${include} holds its words and keeps its size`).toEqual([])
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


// Every actor here shares 127.0.0.1 and one per-IP limiter: pace the journey and start each test in a fresh window.
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
test.afterEach(async () => { await pause(15_000) })
test.afterAll(() => {
  if (EVIDENCE_DIR) writeFileSync(`${EVIDENCE_DIR}/uat/r1-browser-journal-${String(EXPECTED_SHA).slice(0, 8)}.json`, JSON.stringify(journal, null, 2), { mode: 0o600 })
})

// ── rows in each state, through the product's own endpoints and the simulator's controls ──
type Row = { invoiceId: string; number: string; caseId: string; collection: string; guid: string }
const rows: Record<string, Row> = {}
let phone = 300
async function request(cost = '20.00', sellPrice = '5.00'): Promise<Row> {
  const inv = await invoiceAtGarageC(cost, sellPrice)
  phone += 1
  const started = await api('customer', 'POST', `/api/pay04/garage-invoices/${inv.invoiceId}/payments`, { method: 'ecocash', phone: `0779000${phone}` },
    { 'Idempotency-Key': `r1br-${randomUUID()}` })
  const collection = String(started.collection_id)
  return { invoiceId: inv.invoiceId, number: inv.number, caseId: inv.caseId, collection, guid: String((await simTxFor(collection))!.guid) }
}
const setStatus = (row: Row, status: string, extra: Record<string, unknown> = {}) => sim('POST', `/transactions/${row.guid}/status`, { status, ...extra })
const check = (row: Row) => api('customer', 'POST', `/api/pay04/garage-payments/${row.collection}/verify`, {})
const resolve = (row: Row, type: string, resolution: string) => api('ops', 'POST',
  `/api/pay04/admin/discrepancies/${sql(`select id from pay04_garage_payment_discrepancies where collection_id = ${lit(row.collection)} and discrepancy_type = ${lit(type)} and status = 'open' limit 1`)}/resolve`,
  { resolution, note: 'Reviewed in the garage’s Paynow records (PAY-05 R1 browser QA).' })
/** CarUp's own clock, on the disposable database: Paynow is not involved. */
const pastCarUpsTime = (row: Row) => sql(`set session_replication_role = replica; update pay04_garage_collections set initiated_at = now() - interval '2 hours', expires_at = now() - interval '1 minute' where id = ${lit(row.collection)}; set session_replication_role = origin; select 1`)

const FALSE_NOTHING = /nothing (was|is) (paid|charged)/i
const FALSE_PAID = /confirmed by paynow|^paid —/i
const WAITING = /waiting for you|still counts/i
const EXPECT: Record<string, { state: string; provider: RegExp; counted: boolean; review: RegExp | null; next: RegExp }> = {
  escrow: { state: 'at_paynow', provider: /Paid into Paynow/, counted: false, review: null, next: /Do not pay again/ },
  released: { state: 'released', provider: /Waiting for approval/, counted: false, review: null, next: /Do not approve the old request/ },
  settled: { state: 'settled_outside', provider: /Paid/, counted: false, review: /settled outside CarUp/, next: /tell the garage/ },
  disputed: { state: 'under_review', provider: /Disputed/, counted: false, review: /reviewing/, next: /Do not pay again/ },
  lateOpen: { state: 'under_review', provider: /Paid/, counted: false, review: /reviewing/, next: /Do not pay again/ },
  lateClosed: { state: 'closed_not_counted', provider: /Paid/, counted: false, review: /does not count/, next: /how it was settled/ },
  reversed: { state: 'not_counted', provider: /A status CarUp does not recognise/, counted: false, review: /only if Paynow reports it paid/, next: /Ask the garage/ },
  counted: { state: 'confirmed', provider: /Paid/, counted: true, review: null, next: /./ },
}

test('runtime provenance: the candidate is serving, on the local simulator, with garage C verified', async ({ request: http, baseURL }) => {
  expect(baseURL).toBe('http://127.0.0.1:5203')
  const health = await (await http.get(`${API}/api/health`)).json()
  expect(health?.build?.commit_sha).toBe(EXPECTED_SHA)
  expect(sql(`select status from pay04_garage_merchant_accounts where tenant_id = ${lit(accounts.garageC as string)} and gateway = 'paynow_zimbabwe' order by registered_at desc limit 1`)).toBe('verified')
  expect(sql(`select paynow_real_enabled::text from pay05_runtime_guard`)).toBe('false')
})

test('fixtures: a real row in each state', async () => {
  rows.escrow = await request()
  await setStatus(rows.escrow, 'Delivered')
  await check(rows.escrow)
  pastCarUpsTime(rows.escrow)

  await pause(61_000)
  rows.released = await request()
  await check(rows.released)
  pastCarUpsTime(rows.released)
  await api('ops', 'POST', `/api/pay05/admin/collections/${rows.released.collection}/release-hold`, { reason: 'Customer abandoned the EcoCash prompt (R1 browser QA).' })

  rows.settled = await request()
  await setStatus(rows.settled, 'Paid', { amount: '24.00' })
  await resolve(rows.settled, 'amount_mismatch', 'settled_off_platform')

  await pause(61_000)
  rows.disputed = await request()
  await setStatus(rows.disputed, 'Paid')
  await setStatus(rows.disputed, 'Disputed')

  rows.lateOpen = await request()
  await setStatus(rows.lateOpen, 'Cancelled')
  await setStatus(rows.lateOpen, 'Paid')

  await pause(61_000)
  rows.lateClosed = await request()
  await setStatus(rows.lateClosed, 'Cancelled')
  await setStatus(rows.lateClosed, 'Paid')
  await resolve(rows.lateClosed, 'provider_paid_after_close', 'acknowledged')

  rows.reversed = await request()
  await setStatus(rows.reversed, 'Paid')
  await setStatus(rows.reversed, 'Reversed')
  await resolve(rows.reversed, 'provider_status_unrecognized', 'acknowledged')

  await pause(61_000)
  rows.counted = await request()
  await setStatus(rows.counted, 'Paid')
  // a request still waiting, for the keyboard walk, and one past CarUp's time with its means of payment
  rows.waiting = await request()
  rows.waitingPast = await request()
  pastCarUpsTime(rows.waitingPast)
  note('fixtures', Object.fromEntries(Object.entries(rows).map(([k, r]) => [k, { invoice: r.number, status: sql(`select p.status from pay04_garage_collections c join payment_transactions p on p.reference = c.payment_reference where c.id = ${lit(r.collection)}`) }])))
})

const readRow = async (row: Locator) => ({
  provider: (await row.getByTestId('paynow-fact-provider').innerText()).trim(),
  allocation: (await row.getByTestId('paynow-fact-allocation').innerText()).trim(),
  review: (await row.getByTestId('paynow-fact-review').innerText()).trim(),
  next: (await row.getByTestId('paynow-fact-next').count()) ? (await row.getByTestId('paynow-fact-next').innerText()).trim() : '',
  text: await row.innerText(),
})

for (const vp of VIEWPORTS) {
  test(`customer at ${vp.name}: each state reads truthfully, in its separate parts`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await login(page, 'customer')
    for (const [name, expected] of Object.entries(EXPECT)) {
      await freshGlobalWindow(40)
      const card = await openHowToPay(page, rows[name].number, { checkout: false })
      const row = card.getByTestId('my-provider-payment').filter({ has: page.getByTestId('paynow-facts') }).first()
      await expect(row).toHaveAttribute('data-state', expected.state, { timeout: 30_000 })
      const said = await readRow(row)
      expect(said.provider, name).toMatch(expected.provider)
      expect(said.allocation, name).toMatch(expected.counted ? /^Counted on this invoice/ : /^Not counted on this invoice/)
      if (expected.review) expect(said.review, name).toMatch(expected.review)
      else expect(said.review, name).toBe('None')
      expect(said.next, name).toMatch(expected.next)
      expect(said.text, name).not.toMatch(FALSE_NOTHING)
      expect(said.text, name).not.toMatch(WAITING)
      if (!expected.counted) expect(await row.getByTestId('my-provider-payment-paynow').innerText(), name).not.toMatch(FALSE_PAID)
      if (name !== 'waiting') {
        await expect(row.getByTestId('paynow-continue-link'), name).toHaveCount(0)
        await expect(row.getByTestId('paynow-otp'), name).toHaveCount(0)
      }
      await noHorizontalOverflow(page)
      await noClippedControls(page, '[data-testid="invoice-card"]')
      await axeClean(page, '[data-testid="invoice-card"]')
      await shot(page, row, `r1-customer-${name}-${vp.name}`)
      note(`customer-${name}-${vp.name}`, { state: expected.state, facts: { provider: said.provider, allocation: said.allocation, review: said.review, next: said.next } })
    }
  })

  test(`garage at ${vp.name}: the same rows, in the garage's words, with no action the money does not allow`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await login(page, 'adminC')
    await actForGarageC(page)
    for (const name of ['escrow', 'released', 'settled', 'disputed', 'lateClosed', 'reversed', 'counted']) {
      await freshGlobalWindow(40)
      await page.goto(`/garage/cases/${rows[name].caseId}`)
      const panel = page.getByTestId('provider-payments')
      await expect(panel).toBeVisible({ timeout: 30_000 })
      const row = panel.getByTestId('provider-payment-row').first()
      await expect(row).toHaveAttribute('data-state', EXPECT[name].state, { timeout: 30_000 })
      const said = await readRow(row)
      expect(said.allocation, name).toMatch(EXPECT[name].counted ? /^Counted on this invoice/ : /^Not counted on this invoice/)
      expect(said.text, name).not.toMatch(FALSE_NOTHING)
      expect(said.text, name).not.toMatch(/Waiting for the customer|still counts/)
      if (EXPECT[name].state !== 'confirmed') await expect(row.getByTestId('provider-payment-paynow-refund-guidance'), name).toHaveCount(0)
      await expect(row.getByTestId('provider-payment-refund'), name).toHaveCount(0)
      await noHorizontalOverflow(page)
      await noClippedControls(page, '[data-testid="provider-payments"]')
      await axeClean(page, '[data-testid="provider-payments"]')
      await shot(page, row, `r1-garage-${name}-${vp.name}`)
    }
    // the merchant truly verified reads as connected
    await page.goto('/garage/payments')
    await expect(page.getByTestId('garage-provider-status')).toContainText('Connected', { timeout: 30_000 })
    note(`garage-${vp.name}`, { ok: true })
  })

  test(`operator at ${vp.name}: held, released and settled rows; a release only where the database would allow it`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await login(page, 'ops')
    await page.goto('/admin/garage-payments')
    const panel = page.getByTestId('paynow-operator')
    await expect(panel).toBeVisible({ timeout: 30_000 })
    const rowFor = (name: string) => panel.getByTestId('paynow-op-held').filter({ hasText: new RegExp(`PAY05 QA Garage C.* · invoice ${rows[name].number} · `) })
    for (const name of ['released', 'settled']) {
      await expect(rowFor(name), name).toBeVisible({ timeout: 30_000 })
      await expect(rowFor(name).getByTestId('paynow-op-held-check'), name).toBeEnabled()
      await expect(rowFor(name).getByTestId('paynow-op-release'), name).toHaveCount(0)
      await expect(rowFor(name).getByTestId('paynow-op-release-blocked'), name).toBeVisible()
    }
    // money at Paynow past CarUp's time: visible, readable, never releasable
    await expect(rowFor('escrow').getByTestId('paynow-op-release')).toHaveCount(0)
    await expect(rowFor('escrow').getByTestId('paynow-op-release-blocked')).toContainText('money')
    // an unpaid request past its time keeps the release
    await expect(rowFor('waitingPast').getByTestId('paynow-op-release')).toHaveCount(1)
    await noHorizontalOverflow(page)
    await noClippedControls(page, '[data-testid="paynow-operator"]')
    await axeClean(page, '[data-testid="paynow-operator"]')
    for (const name of ['escrow', 'released', 'settled', 'waitingPast']) await shot(page, rowFor(name), `r1-operator-${name}-${vp.name}`)
    note(`operator-${vp.name}`, { ok: true })
  })
}

// ── by keyboard alone ──
async function focused(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el || el === document.body) return { id: 'body', visible: false, label: '' }
    const cs = getComputedStyle(el)
    const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0
    const ring = Boolean(cs.boxShadow) && cs.boxShadow !== 'none'
    const label = (el.getAttribute('aria-label') || el.textContent || (el as HTMLInputElement).name || '').trim().slice(0, 60)
    return { id: el.dataset.testid || `${el.tagName.toLowerCase()}`, visible: outline || ring, label }
  })
}
const noFocusRing: Array<Record<string, unknown>> = []
async function tabTo(page: Page, want: (f: { id: string; label: string }) => boolean, max = 120, shift = false) {
  for (let i = 1; i <= max; i += 1) {
    await page.keyboard.press(shift ? 'Shift+Tab' : 'Tab')
    const f = await focused(page)
    if (f.id !== 'body' && !f.visible) noFocusRing.push({ stop: f.id, label: f.label })
    if (want(f)) return i
  }
  throw new Error(`could not reach the wanted control by keyboard within ${max} tabs`)
}
/** Tab from the top of the page to one element, marked first so the walk finds that element and no other like it. */
async function tabToMarked(page: Page, target: Locator) {
  await target.evaluate((el) => el.setAttribute('data-r1-target', 'yes'))
  await page.locator('body').focus()
  for (let i = 0; i < 400; i += 1) {
    await page.keyboard.press('Tab')
    if (await page.evaluate(() => document.activeElement?.getAttribute('data-r1-target') === 'yes')) return i + 1
  }
  throw new Error('the control is not reachable by Tab')
}
const expectFocus = (page: Page, id: string) => expect.poll(async () => (await focused(page)).id, { timeout: 20_000 }).toBe(id)

for (const vp of [{ name: 'mobile', width: 390, height: 844 }, { name: 'desktop', width: 1440, height: 900 }] as const) {
  test(`keyboard, customer at ${vp.name}: stop, keep it, stop again: focus follows the words; the amount stays reserved`, async ({ page }) => {
    const row = await request()
    await pause(65_000)
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await login(page, 'customer')
    await page.goto('/dashboard/service-requests')
    const card = invoiceCard(page, row.number)
    await expect(card).toBeVisible({ timeout: 30_000 })
    await tabToMarked(page, card.getByTestId('how-to-pay-toggle'))
    await page.keyboard.press('Enter')
    await expect(card.getByTestId('my-provider-payments')).toBeVisible({ timeout: 30_000 })
    await tabTo(page, (f) => f.id === 'my-provider-payment-stop')
    await page.keyboard.press('Enter')
    await expectFocus(page, 'my-provider-payment-stop-ask')
    await expect(card.getByTestId('my-provider-payment-stop-ask')).toContainText('stays reserved')
    await tabTo(page, (f) => f.id === 'my-provider-payment-stop-keep', 6)
    await page.keyboard.press('Enter')
    await expectFocus(page, 'my-provider-payment-stop')
    await page.keyboard.press('Enter')
    await expectFocus(page, 'my-provider-payment-stop-ask')
    await tabTo(page, (f) => f.id === 'my-provider-payment-stop-confirm', 6)
    await page.keyboard.press('Enter')
    await expectFocus(page, 'my-provider-payment-outcome')
    await expect(card.getByTestId('my-provider-payment-outcome')).toContainText('stays reserved', { timeout: 30_000 })
    await expect(card.getByTestId('my-provider-payment')).toHaveAttribute('data-state', 'stopping')
    await expect(card.getByTestId('my-provider-payment')).not.toContainText(FALSE_NOTHING)
    note(`keyboard-customer-stop-${vp.name}`, { invoice: row.number })
  })

  test(`keyboard, customer at ${vp.name}: past CarUp's time the means of payment stay reachable; a released request offers none`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await login(page, 'customer')
    await page.goto('/dashboard/service-requests')
    const past = invoiceCard(page, rows.waitingPast.number)
    await expect(past).toBeVisible({ timeout: 30_000 })
    await tabToMarked(page, past.getByTestId('how-to-pay-toggle'))
    await page.keyboard.press('Enter')
    await expect(past.getByTestId('my-provider-payment')).toHaveAttribute('data-state', 'expired', { timeout: 30_000 })
    await tabTo(page, (f) => f.id === 'my-provider-payment-check')
    await page.keyboard.press('Enter')
    await expect(past.getByTestId('my-provider-payment-outcome')).not.toBeEmpty({ timeout: 60_000 })
    const released = invoiceCard(page, rows.released.number)
    await tabToMarked(page, released.getByTestId('how-to-pay-toggle'))
    await page.keyboard.press('Enter')
    await expect(released.getByTestId('my-provider-payment')).toHaveAttribute('data-state', 'released', { timeout: 30_000 })
    await tabTo(page, (f) => f.id === 'my-provider-payment-check')
    await expect(released.getByTestId('my-provider-payment-stop')).toHaveCount(0)
    note(`keyboard-customer-states-${vp.name}`, { ok: true })
  })
}

test('keyboard, garage: the stop form takes the focus, Keep gives it back; Disconnect moves to its reason and Keep returns', async ({ page }) => {
  const row = await request()
  await pause(65_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page, 'adminC')
  await actForGarageC(page)
  await page.goto(`/garage/cases/${row.caseId}`)
  const panel = page.getByTestId('provider-payments')
  await expect(panel).toBeVisible({ timeout: 30_000 })
  await tabToMarked(page, panel.getByTestId('provider-payment-stop').first())
  await page.keyboard.press('Enter')
  await expectFocus(page, 'provider-stop-form-reason')
  await tabTo(page, (f) => f.label === 'Keep it as it is', 6)
  await page.keyboard.press('Enter')
  await expectFocus(page, 'provider-payment-row')
  await page.goto('/garage/payments')
  const section = page.getByTestId('garage-paynow-section')
  await expect(section).toBeVisible({ timeout: 30_000 })
  await tabToMarked(page, section.getByTestId('garage-paynow-disconnect'))
  await page.keyboard.press('Enter')
  await expectFocus(page, 'garage-paynow-disconnect-reason')
  await tabTo(page, (f) => f.label === 'Keep it connected', 6)
  await page.keyboard.press('Enter')
  await expectFocus(page, 'garage-paynow-disconnect')
  note('keyboard-garage', { invoice: row.number })
})

test('keyboard, operator: a review closes by keyboard and the result takes the focus; a release works by keyboard', async ({ page }) => {
  const review = await request()
  await setStatus(review, 'Paid')
  await setStatus(review, 'Disputed')
  await pause(65_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page, 'ops')
  await page.goto('/admin/garage-payments')
  const row = page.getByTestId('operator-discrepancy').filter({ hasText: 'Paynow holds this payment in a dispute' }).first()
  await expect(row).toBeVisible({ timeout: 30_000 })
  await tabToMarked(page, row.getByTestId('operator-resolve'))
  await page.keyboard.press('Enter')
  await expectFocus(page, 'operator-resolution')
  // the first closure is Paynow's; the exit for a dispute Paynow never speaks of again is the second
  await page.keyboard.press('ArrowDown')
  await expect(page.getByTestId('operator-resolution')).toHaveValue('settled_off_platform')
  await tabTo(page, (f) => f.id === 'operator-resolution-note', 4)
  await page.keyboard.type('The garage settled this dispute with the customer (keyboard QA).')
  await tabTo(page, (f) => f.id === 'operator-resolve-submit', 4)
  await page.keyboard.press('Enter')
  await expectFocus(page, 'operator-message')
  await expect(page.getByTestId('operator-message')).toHaveText('Exception closed.', { timeout: 30_000 })
  const panel = page.getByTestId('paynow-operator')
  const held = panel.getByTestId('paynow-op-held').filter({ hasText: new RegExp(`PAY05 QA Garage C.* · invoice ${rows.waitingPast.number} · `) })
  await expect(held).toBeVisible({ timeout: 30_000 })
  await tabToMarked(page, held.getByTestId(`paynow-op-reason-release-${rows.waitingPast.collection}`))
  await page.keyboard.type('Customer abandoned the EcoCash prompt (keyboard QA).')
  await tabTo(page, (f) => f.id === 'paynow-op-release', 6)
  await page.keyboard.press('Enter')
  await expectFocus(page, 'paynow-op-message')
  await expect(page.getByTestId('paynow-op-message')).toContainText('Released after a fresh check', { timeout: 60_000 })
  note('keyboard-operator', { no_focus_ring_stops: noFocusRing.length })
})

test('every stop on the keyboard walks showed a focus indicator', async () => {
  // a programmatic focus target (tabIndex -1) is not a Tab stop, so this list holds only what a keyboard user lands on
  const stops = noFocusRing.filter((s) => s.stop !== 'body')
  note('focus-indicator-gaps', { count: stops.length, stops: stops.slice(0, 40) })
  expect(stops, 'every Tab stop shows where the focus is').toEqual([])
})
