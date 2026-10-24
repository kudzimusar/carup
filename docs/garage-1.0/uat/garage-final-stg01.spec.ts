/**
 * GARAGE-1.0-FINAL — physical staging UAT (golden + negative journey, desktop + mobile).
 *
 * Runs against an exact-SHA Preview pair on the STAGING project. Three real, signed-in actors in three separate
 * browser contexts: the Garage admin, the Garage mechanic and the customer (vehicle owner). Every business step
 * is driven through the product UI. The only calls made outside the UI are:
 *   - the customer's service request (the public POST /api/service-cases contract), and
 *   - CSRF'd contract probes that a UI deliberately does not offer (refusals the database must enforce).
 *
 * Passwords are read from a local 0600 file; the CI window holds only their scrypt hashes.
 */
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { ensureActingForOrganisation } from '../../../tests/agents/staging-helpers'

const SHA = process.env.GARAGE_FINAL_SHA || ''
const WEB = (process.env.GARAGE_FINAL_WEB || '').replace(/\/$/, '')
const API = (process.env.GARAGE_FINAL_API || '').replace(/\/$/, '')
const DIR = path.resolve(process.env.GARAGE_FINAL_EVIDENCE_DIR || 'cert-results/garage-final-stg01-uat')
const RUN = process.env.GARAGE_FINAL_RUN || `GF${new Date().toISOString().replace(/\D/g, '').slice(0, 12)}`
const CREDS = JSON.parse(fs.readFileSync(process.env.GARAGE_FINAL_CREDS || '', 'utf8')) as Record<'admin' | 'mechanic' | 'customer', string>
const BACKEND_HOST = new URL(API).host

const ID = {
  admin: { id: 'uat_ops01_owner_20261022a', email: 'ops01.owner.20261022a@carup-staging.test' },
  mechanic: { id: 'uat_ops01_mech01_20261022a', email: 'ops01.mechanic.01.20261022a@carup-staging.test' },
  customer: { id: 'uat_final_customer_20261024a', email: 'final.customer.20261024a@carup-staging.test' },
} as const
type Who = keyof typeof ID

const GARAGE_NAME = /SYNTHETIC \/ UAT OPS01 GARAGE 20261022A/i
const SLUG = 'synthetic-uat-ops01-garage-20261022a'
const VIN = 'UATFINAL202610241'
const HARARE_SITE = 'b1000000-0000-4000-8000-000000000001'
const PART_NAME = `UAT FINAL Brake pad set ${RUN}`
const PART_SKU = `UATF-${RUN}`
const GOLDEN_SUMMARY = `SYNTHETIC / UAT GARAGE-1.0-FINAL ${RUN} GOLDEN`
const DECLINE_SUMMARY = `SYNTHETIC / UAT GARAGE-1.0-FINAL ${RUN} DECLINE`

const evidence: Record<string, unknown> = { run: RUN, sha: SHA, web: WEB, api: API, steps: [] as unknown[] }
const state: { appointmentDate?: string; goldenCase?: string; goldenWo?: string; declineCase?: string; declineWo?: string; estimateId?: string; invoiceNumber?: string } = {}
const hostsByActor: Record<string, Set<string>> = {}

fs.mkdirSync(path.join(DIR, 'screens'), { recursive: true })
const note = (key: string, value: unknown) => { evidence[key] = value }
function step(name: string, detail?: unknown) { (evidence.steps as unknown[]).push({ at: new Date().toISOString(), name, detail }) }
async function shot(page: Page, name: string) { await page.screenshot({ path: path.join(DIR, 'screens', `${name}.png`), fullPage: true }) }
const reference = (caseId: string) => `SR-${caseId.replace(/-/g, '').toUpperCase().slice(0, 8)}`

const actors: Partial<Record<Who, { ctx: BrowserContext; page: Page }>> = {}

async function login(browser: Browser, who: Who): Promise<Page> {
  if (actors[who]) return actors[who]!.page
  const ctx = await browser.newContext({ baseURL: WEB, viewport: { width: 1440, height: 1000 }, timezoneId: 'Africa/Harare' })
  const page = await ctx.newPage()
  hostsByActor[who] = new Set()
  page.on('request', (req) => { const u = new URL(req.url()); if (u.pathname.startsWith('/api/')) hostsByActor[who].add(u.host) })
  await page.goto('/login', { waitUntil: 'networkidle' })
  await page.getByLabel('Email or Phone').fill(ID[who].email)
  await page.getByTestId('password-input').fill(CREDS[who])
  const rr = page.waitForResponse((r) => r.url().includes('/api/auth/login') && r.request().method() === 'POST')
  await page.getByRole('button', { name: /sign in/i }).click()
  expect((await rr).status(), `${who} login`).toBe(200)
  if (who !== 'customer') {
    const sel = await ensureActingForOrganisation(page, GARAGE_NAME)
    expect(sel.badge).toContain('SYNTHETIC / UAT OPS01 GARAGE 20261022A')
  }
  actors[who] = { ctx, page }
  step(`login:${who}`)
  return page
}

/** A CSRF'd call with the signed-in actor's own session, from inside the page (same origin rules as the app). */
async function api(page: Page, method: string, route: string, payload?: unknown) {
  return page.evaluate(async (x) => {
    const u = JSON.parse(localStorage.getItem('carup_user') || 'null')
    const token = localStorage.getItem('carup_token')
    const h: Record<string, string> = { 'x-user-id': String(u?.id || ''), 'x-session-token': String(token || '') }
    if (x.payload !== undefined) h['content-type'] = 'application/json'
    if (x.method !== 'GET') {
      const cr = await fetch(x.api + '/security/csrf-token', { credentials: 'include', headers: h })
      if (!cr.ok) return { status: cr.status, text: await cr.text() }
      h['x-csrf-token'] = (await cr.json()).csrfToken
    }
    const r = await fetch(x.api + x.route, { method: x.method, credentials: 'include', headers: h, body: x.payload === undefined ? undefined : JSON.stringify(x.payload) })
    return { status: r.status, text: await r.text() }
  }, { api: API, method, route, payload })
}
const json = (r: { text: string }) => { try { return JSON.parse(r.text) } catch { return { raw: r.text.slice(0, 400) } } }

async function noHorizontalOverflow(page: Page, label: string) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
  expect(o.sw, `${label}: horizontal overflow (scrollWidth ${o.sw} > innerWidth ${o.iw})`).toBeLessThanOrEqual(o.iw + 1)
}

async function openHub(page: Page, caseId: string) {
  await page.goto(`/garage/cases/${caseId}`, { waitUntil: 'networkidle' })
  await expect(page.getByTestId('case-header')).toBeVisible({ timeout: 30_000 })
}

async function fillEstimateLine(page: Page, index: number, v: { category: 'labour' | 'part' | 'fee' | 'other'; qty: string; desc: string; price: string }) {
  const line = page.getByTestId('estimate-line').nth(index)
  await line.getByLabel('Kind of line').selectOption(v.category)
  await line.getByLabel('Quantity').fill(v.qty)
  await line.getByLabel('Description').fill(v.desc)
  await line.getByLabel('Unit price').fill(v.price)
}

async function requestService(page: Page, summary: string) {
  const res = await api(page, 'POST', '/service-cases', {
    garage_slug: SLUG, vin: VIN, service_category: 'general_service', request_summary: summary, source_channel: 'directory',
  })
  expect([200, 201], `service request: ${res.text.slice(0, 300)}`).toContain(res.status)
  const body = json(res)
  expect(body.case?.id).toBeTruthy()
  return body.case.id as string
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(8 * 60_000)

test.afterAll(async () => {
  note('api_hosts_by_actor', Object.fromEntries(Object.entries(hostsByActor).map(([k, v]) => [k, [...v]])))
  note('finished_at', new Date().toISOString())
  fs.writeFileSync(path.join(DIR, 'journey-evidence.json'), JSON.stringify(evidence, null, 2) + '\n')
  for (const a of Object.values(actors)) await a?.ctx.close().catch(() => undefined)
})

test('00 runtime provenance: exact SHA, paired, staging database only', async () => {
  const [p, h] = await Promise.all([fetch(`${WEB}/carup-provenance.json?x=${Date.now()}`), fetch(`${API}/health?x=${Date.now()}`)])
  expect(p.ok && h.ok).toBe(true)
  const prov: any = await p.json(); const health: any = await h.json()
  expect(prov.commit_sha).toBe(SHA)
  expect(prov.unpaired).toBe(false)
  expect(new URL(prov.api_base_url).host).toBe(BACKEND_HOST)
  expect(health.status).toBe('UP')
  expect(health.build.commit_sha).toBe(SHA)
  expect(health.database.supabase_project_ref).toBe('eoyenigwevnxwwhyhaer')
  expect(health.database.consistent).toBe(true)
  expect(health.communications.outbound.external_sends).toBe('disabled')
  note('runtime', { provenance: prov, health_build: health.build, health_db: health.database, external_sends: health.communications.outbound.external_sends })
})

test('01 customer signs in and requests the garage (public contract)', async ({ browser }) => {
  const customer = await login(browser, 'customer')
  state.goldenCase = await requestService(customer, GOLDEN_SUMMARY)
  await customer.goto('/dashboard/service-requests', { waitUntil: 'networkidle' })
  const card = customer.getByTestId('service-request-card').filter({ hasText: reference(state.goldenCase) })
  await expect(card).toBeVisible({ timeout: 30_000 })
  await expect(card.getByTestId('request-status')).toContainText(/request|sent|waiting|pending/i)
  await shot(customer, '01-customer-request-created')
  step('customer-request', { caseId: state.goldenCase })
})

test('02 admin accepts the job from the hub', async ({ browser }) => {
  const admin = await login(browser, 'admin')
  await openHub(admin, state.goldenCase!)
  await expect(admin.getByTestId('case-summary')).toContainText(GOLDEN_SUMMARY)
  await expect(admin.getByTestId('case-next-action')).toBeVisible()
  await shot(admin, '02a-admin-hub-requested')
  // two or more active sites: the garage must say which one does the job, and accept is held back until it does
  await expect(admin.getByTestId('accept-site')).toBeVisible({ timeout: 30_000 })
  await expect(admin.getByTestId('accept-case')).toBeDisabled()
  await expect(admin.getByTestId('site-required')).toBeVisible()
  await admin.getByTestId('accept-site').selectOption(HARARE_SITE)
  await expect(admin.getByTestId('accept-case')).toBeEnabled()
  await shot(admin, '02a2-site-chosen')
  await admin.getByTestId('accept-case').click()
  await expect(admin.getByTestId('case-status')).toContainText(/accepted/i, { timeout: 30_000 })
  await expect(admin.getByTestId('prepare-estimate')).toBeVisible()
  await expect(admin.getByTestId('case-site')).toContainText('Harare')
  await shot(admin, '02b-admin-hub-accepted')
  const hub = json(await api(admin, 'GET', `/garage/cases/${state.goldenCase}/hub`))
  // the product creates the work order when the first estimate is prepared, not on acceptance
  expect(hub.site?.id, 'the chosen site is recorded on the job').toBe(HARARE_SITE)
  expect(hub.work_order ?? null, 'no work order exists before an estimate is prepared').toBeNull()
  step('admin-accepted', { workOrder: null })
})

test('02c appointment: the customer requests a time, the garage confirms it with a planned mechanic, the hub shows it', async ({ browser }) => {
  const customer = await login(browser, 'customer')
  const admin = await login(browser, 'admin')
  await customer.goto('/dashboard/service-requests', { waitUntil: 'networkidle' })
  const card = customer.getByTestId('service-request-card').filter({ hasText: reference(state.goldenCase!) })
  await card.getByRole('button', { name: 'Find appointment times' }).click()
  let booked = false
  for (const date of ['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30']) {
    await card.getByLabel(`Appointment date ${state.goldenCase}`).fill(date)
    await card.getByLabel(`Appointment duration ${state.goldenCase}`).fill('60')
    await card.getByRole('button', { name: 'Check available times' }).click()
    const first = card.getByTestId('appointment-slots').getByRole('button', { name: 'Request this time' }).first()
    await customer.waitForTimeout(2500)
    if (await first.count()) {
      await shot(customer, '02c1-customer-available-times')
      await first.click()
      booked = true; state.appointmentDate = date
      break
    }
  }
  expect(booked, 'one of the next Mondays has bookable capacity at the chosen site').toBe(true)
  await expect(card).toContainText('has not confirmed this requested time yet', { timeout: 30_000 })
  await shot(customer, '02c2-customer-time-requested')

  await admin.goto('/garage/schedule', { waitUntil: 'networkidle' })
  const appt = admin.getByTestId('appointment-card').filter({ hasText: state.goldenCase! })
  await expect(appt).toBeVisible({ timeout: 30_000 })
  await appt.getByRole('button', { name: 'Review and confirm' }).click()
  const worker = appt.getByLabel(/Appointment planned mechanic/)
  const options = await worker.locator('option:not([value=""])').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))
  expect(options.length, 'the site offers at least one planned mechanic').toBeGreaterThan(0)
  const tried: string[] = []
  let confirmed = false
  for (const value of options.slice(0, 6)) {
    await worker.selectOption(value)
    await appt.getByRole('button', { name: 'Confirm appointment' }).click()
    tried.push(value)
    try { await expect(appt).toContainText(/confirmed/i, { timeout: 12_000 }); confirmed = true; break } catch { /* that mechanic is not free then: try the next */ }
  }
  expect(confirmed, `a planned mechanic could be confirmed (tried ${tried.join(', ')})`).toBe(true)
  await shot(admin, '02c3-garage-appointment-confirmed')

  await customer.reload({ waitUntil: 'networkidle' })
  await expect(customer.getByTestId('service-request-card').filter({ hasText: reference(state.goldenCase!) })).toContainText('has confirmed this appointment', { timeout: 30_000 })
  await shot(customer, '02c4-customer-appointment-confirmed')

  await openHub(admin, state.goldenCase!)
  await expect(admin.getByTestId('case-appointment')).toContainText(/confirmed/i)
  await shot(admin, '02c5-hub-shows-appointment')
  step('appointment-confirmed', { date: state.appointmentDate, plannedMechanicOptionsTried: tried })
})

test('03 admin prepares and sends an estimate (explicit currency, server-derived total)', async ({ browser }) => {
  const admin = await login(browser, 'admin')
  await admin.getByTestId('prepare-estimate').click()
  await expect(admin.getByTestId('estimate-form')).toBeVisible()
  await shot(admin, '03a-estimate-form-empty')

  // the form must refuse to guess a currency
  await admin.getByTestId('estimate-line').first().getByLabel('Description').fill('x')
  await admin.getByTestId('submit-estimate').click()
  await expect(admin.getByTestId('estimate-form-error')).toContainText(/currency/i)

  await admin.getByTestId('estimate-currency').fill('USD')
  await fillEstimateLine(admin, 0, { category: 'labour', qty: '2', desc: 'Brake service labour', price: '45.50' })
  await admin.getByTestId('add-line').click()
  await fillEstimateLine(admin, 1, { category: 'part', qty: '4', desc: 'Brake pad set, fitted', price: '22.25' })
  await admin.getByTestId('estimate-customer-note').fill('UAT golden journey estimate.')
  await admin.getByTestId('estimate-internal-note').fill('INTERNAL-ONLY-MARKER ' + RUN)
  await shot(admin, '03b-estimate-form-filled')
  await admin.getByTestId('submit-estimate').click()

  const latest = admin.getByTestId('estimate-latest')
  await expect(latest).toBeVisible({ timeout: 30_000 })
  await expect(latest.getByTestId('estimate-status')).toContainText(/draft/i)
  await expect(latest.getByTestId('estimate-total')).toContainText('180.00')
  await shot(admin, '03c-estimate-draft')
  await admin.getByTestId('send-estimate').click()
  await expect(admin.getByTestId('estimate-latest').getByTestId('estimate-status')).toContainText(/sent|waiting/i, { timeout: 30_000 })
  await expect(admin.getByTestId('owner-authorization')).toHaveAttribute('data-authorization', 'pending')
  await shot(admin, '03d-estimate-sent')

  const hubAfter = json(await api(admin, 'GET', `/garage/cases/${state.goldenCase}/hub`))
  const est = hubAfter.estimates.latest
  state.goldenWo = hubAfter.work_order?.id
  expect(state.goldenWo, 'preparing the first estimate creates the work order').toBeTruthy()
  expect(hubAfter.work_order.owner_authorization).toBe('pending')
  state.estimateId = est.id
  expect(est.total_amount).toBe('180.00')
  step('estimate-sent', { estimate: est.id, total: est.total_amount, currency: est.currency })
})

test('04 the customer is the only one who can decide: no bypass while an estimate is out', async ({ browser }) => {
  const customer = await login(browser, 'customer')
  const bypass = await api(customer, 'POST', `/vehicles/${VIN}/work-orders/${state.goldenWo}/authorization`, { decision: 'authorized' })
  note('bypass_attempt_customer_direct_authorization', { status: bypass.status, body: json(bypass) })
  expect(bypass.status).toBe(409)
  expect(json(bypass).reason).toBe('decision_via_estimate')

  const admin = await login(browser, 'admin')
  const selfAuthorize = await api(admin, 'POST', `/vehicles/${VIN}/work-orders/${state.goldenWo}/authorization`, { decision: 'authorized' })
  note('bypass_attempt_garage_admin_authorizes_own_job', { status: selfAuthorize.status, body: json(selfAuthorize) })
  expect([401, 403, 404, 409], 'a garage admin must not authorize their own estimate').toContain(selfAuthorize.status)
  const woNow = json(await api(admin, 'GET', `/garage/cases/${state.goldenCase}/hub`)).work_order
  expect(woNow.owner_authorization).toBe('pending')
})

test('05 customer reviews the estimate and accepts it', async ({ browser }) => {
  const customer = await login(browser, 'customer')
  await customer.goto('/dashboard/service-requests', { waitUntil: 'networkidle' })
  const card = customer.getByTestId('service-request-card').filter({ hasText: reference(state.goldenCase!) })
  await expect(card).toBeVisible({ timeout: 30_000 })
  const estimate = card.getByTestId('estimate-card').first()
  await expect(estimate).toBeVisible({ timeout: 30_000 })
  await expect(estimate).toHaveAttribute('data-status', 'sent')
  await expect(estimate.getByTestId('estimate-total')).toContainText('180.00')
  await expect(estimate).not.toContainText('INTERNAL-ONLY-MARKER')
  await shot(customer, '05a-customer-estimate-pending')
  await estimate.getByRole('button', { name: 'Accept', exact: true }).click()
  await expect(card.getByTestId('estimate-card').first()).toHaveAttribute('data-status', 'accepted', { timeout: 30_000 })
  await expect(card.getByTestId('estimate-authorization').first()).toHaveAttribute('data-authorization', 'authorized')
  await shot(customer, '05b-customer-estimate-accepted')
  step('customer-accepted-estimate')
})

test('06 admin sets up stock, assigns the mechanic and starts the work', async ({ browser }) => {
  const admin = await login(browser, 'admin')

  // stock first: a part with a counted opening quantity (never defaulted) and a later receipt
  await admin.goto('/garage/stock', { waitUntil: 'networkidle' })
  await admin.getByRole('button', { name: /add a part/i }).click()
  const create = admin.getByTestId('create-part-form')
  await create.getByLabel('Part name').fill(PART_NAME)
  await create.getByLabel('SKU').fill(PART_SKU)
  await create.getByLabel('Opening quantity').fill('10')
  await create.getByLabel('Supplier (optional)').fill('Free-text supplier (not verified)')
  await create.getByLabel('Unit cost (optional)').fill('15.00')
  await create.getByLabel('Sell price (optional)').fill('22.25')
  await create.getByLabel('Currency of the prices').fill('USD')
  await shot(admin, '06a-stock-add-part')
  await create.getByRole('button', { name: 'Add part', exact: true }).click()
  const row = admin.getByTestId('stock-part').filter({ hasText: PART_NAME })
  await expect(row).toBeVisible({ timeout: 30_000 })
  // the page opens the new part's detail itself after a create; open it only if it is not already showing
  const detail = admin.getByTestId('part-detail')
  if (!(await detail.isVisible().catch(() => false))) await row.getByRole('button', { name: new RegExp(`stock history for ${PART_NAME}`, 'i') }).click()
  await expect(detail).toBeVisible({ timeout: 30_000 })
  await shot(admin, '06a2-stock-part-created')
  await admin.getByTestId('part-admin-controls').getByRole('button', { name: /receive stock/i }).click()
  const receive = admin.getByTestId('receive-stock-form')
  await receive.getByLabel('Quantity received').fill('5')
  await receive.getByLabel('Reason (optional)').fill('UAT delivery')
  await receive.getByRole('button', { name: /record received stock/i }).click()
  await expect(admin.getByTestId('stock-notice')).toBeVisible({ timeout: 30_000 })
  await shot(admin, '06b-stock-received')

  // assign + start
  await openHub(admin, state.goldenCase!)
  await expect(admin.getByTestId('owner-authorization')).toHaveAttribute('data-authorization', 'authorized')
  await admin.getByTestId('mechanic-select').selectOption(ID.mechanic.id)
  await expect(admin.getByTestId('assigned-mechanic')).toBeVisible({ timeout: 30_000 })
  await shot(admin, '06c-mechanic-assigned')
  await admin.getByTestId('start-work').click()
  await expect(admin.getByTestId('case-status')).toContainText(/active|in progress|work/i, { timeout: 30_000 })
  await shot(admin, '06d-work-started')
  step('assigned-and-started')
})

test('07 mechanic records the work and parts, sees no prices, completes the job', async ({ browser }) => {
  const mech = await login(browser, 'mechanic')
  await openHub(mech, state.goldenCase!)
  // money is the garage admin's: a mechanic reads what was done, not what it cost
  const body = await mech.locator('body').innerText()
  for (const price of ['180.00', '45.50', '22.25']) expect(body, `mechanic must not see ${price}`).not.toContain(price)
  await shot(mech, '07a-mechanic-hub-no-prices')

  await mech.getByTestId('work-performed').fill('Replaced front brake pads; bled brake fluid. UAT ' + RUN)
  await mech.getByTestId('record-mileage').fill('15420')
  await mech.getByTestId('submit-record').click()
  await expect(mech.getByTestId('service-record').first()).toBeVisible({ timeout: 30_000 })
  await shot(mech, '07b-mechanic-work-recorded')

  await mech.getByTestId('use-part').click()
  const recordSelect = mech.getByTestId('part-record')
  const recordValue = await recordSelect.locator('option:not([value=""])').first().getAttribute('value')
  await recordSelect.selectOption(recordValue!)
  const partSelect = mech.getByTestId('part-select')
  const partValue = await partSelect.locator('option', { hasText: PART_NAME }).first().getAttribute('value')
  expect(partValue, 'the stocked part is offered').toBeTruthy()
  await partSelect.selectOption(partValue!)
  await mech.getByTestId('part-quantity').fill('4')
  await mech.getByTestId('submit-part').click()
  await expect(mech.getByTestId('part-usage').first()).toBeVisible({ timeout: 30_000 })
  await shot(mech, '07c-mechanic-part-used')

  await mech.getByTestId('complete-case').click()
  await expect(mech.getByTestId('case-status')).toContainText(/completed/i, { timeout: 30_000 })
  await shot(mech, '07d-mechanic-job-completed')
  step('work-recorded-and-completed')
})

test('08 admin issues the invoice, records a partial then the final payment, receipts follow payments', async ({ browser }) => {
  const admin = await login(browser, 'admin')
  await openHub(admin, state.goldenCase!)
  await expect(admin.getByTestId('closeout-facts')).toBeVisible({ timeout: 30_000 })
  await shot(admin, '08a-closeout')
  await expect(admin.getByTestId('invoice-form')).toBeVisible()
  await shot(admin, '08b-invoice-form-suggested')

  // the form must NOT let an unpriced line through: a missing cost is not zero
  await admin.getByTestId('submit-invoice').click()
  await expect(admin.getByRole('alert').filter({ hasText: /needs a price/i })).toBeVisible()
  await shot(admin, '08b2-invoice-refuses-unpriced-line')

  // the service record carried no cost, so the admin prices the labour themselves (same as the estimate)
  const line1 = admin.getByTestId('invoice-line').first()
  await line1.getByLabel('Quantity').fill('2')
  await line1.getByLabel('Description').fill('Brake service labour')
  await line1.getByLabel('Unit price').fill('45.50')
  await shot(admin, '08b3-invoice-form-priced')
  await admin.getByTestId('submit-invoice').click()
  const invoice = admin.getByTestId('invoice')
  await expect(invoice).toBeVisible({ timeout: 30_000 })
  await expect(invoice.getByTestId('invoice-total')).toContainText('180.00')
  await expect(invoice.getByTestId('invoice-balance')).toContainText('180.00')
  state.invoiceNumber = (await invoice.getByTestId('invoice-number').innerText()).replace(/^Invoice\s+/, '').trim()
  await expect(invoice.getByTestId('receipts')).toHaveCount(0)   // no payment, no receipt
  await shot(admin, '08c-invoice-issued')

  await admin.getByTestId('record-payment').click()
  await expect(admin.getByTestId('payment-unverified-note')).toContainText(/not (processed|verified)|outside CarUp|recorded by/i)
  await admin.getByTestId('payment-amount').fill('100.00')
  await admin.getByTestId('payment-method').selectOption('cash')
  await admin.getByTestId('payment-reference').fill('UAT-CASH-' + RUN)
  await shot(admin, '08d-payment-form')
  await admin.getByTestId('submit-payment').click()
  await expect(admin.getByTestId('invoice-balance')).toHaveText(/^\s*80\.00 USD\s*$/, { timeout: 30_000 })
  await expect(admin.getByTestId('invoice-payment-status')).toHaveText(/^\s*Partly paid/i)
  await expect(admin.getByTestId('receipt-row')).toHaveCount(1)
  await shot(admin, '08e-partially-paid')

  const overpay = await api(admin, 'POST', `/garage/invoices/${await invoiceId(admin)}/payments`, { amount: '500.00', currency: 'USD', method: 'cash', idempotency_key: 'over-' + RUN })
  note('overpayment_attempt', { status: overpay.status, body: json(overpay) })
  expect(overpay.status, 'a payment larger than the balance is refused').toBeGreaterThanOrEqual(400)
  expect(overpay.text, 'refused for the RIGHT reason, not a malformed body').toMatch(/more than the invoice balance/i)

  await admin.getByTestId('record-payment').click()
  await admin.getByTestId('payment-amount').fill('80.00')
  await admin.getByTestId('payment-method').selectOption('bank_transfer')
  await admin.getByTestId('payment-reference').fill('UAT-BANK-' + RUN)
  await admin.getByTestId('submit-payment').click()
  await expect(admin.getByTestId('invoice-balance')).toHaveText(/^\s*0\.00 USD\s*$/, { timeout: 30_000 })
  await expect(admin.getByTestId('invoice-payment-status')).toHaveText(/^\s*Paid\b(?!.*partly)/i)
  await expect(admin.getByTestId('receipt-row')).toHaveCount(2)
  await expect(admin.getByTestId('payment-source-label')).toContainText(/Recorded by the garage/i)
  await shot(admin, '08f-fully-paid')
  step('invoice-paid', { invoice: state.invoiceNumber })
})

async function invoiceId(admin: Page) {
  const inv = json(await api(admin, 'GET', `/garage/cases/${state.goldenCase}/closeout`)).invoice
  return inv.id as string
}

test('09 customer sees the invoice, the recorded payments and the receipts with honest labels', async ({ browser }) => {
  const customer = await login(browser, 'customer')
  await customer.goto('/dashboard/service-requests', { waitUntil: 'networkidle' })
  const card = customer.getByTestId('service-request-card').filter({ hasText: reference(state.goldenCase!) })
  await expect(card.getByTestId('invoice-card')).toBeVisible({ timeout: 30_000 })
  await expect(card.getByTestId('invoice-card')).toHaveAttribute('data-payment-status', 'paid')
  await expect(card.getByTestId('invoice-payment')).toHaveCount(2)
  await expect(card.getByTestId('invoice-receipt')).toHaveCount(2)
  await expect(card.getByTestId('invoice-source-label')).toContainText(/has not processed or verified/i)
  await shot(customer, '09-customer-invoice-paid')
  step('customer-sees-invoice')
})

test('09b the visit is marked fulfilled once the job is done', async ({ browser }) => {
  const admin = await login(browser, 'admin')
  await admin.goto('/garage/schedule', { waitUntil: 'networkidle' })
  const appt = admin.getByTestId('appointment-card').filter({ hasText: state.goldenCase! })
  await expect(appt).toBeVisible({ timeout: 30_000 })
  await appt.getByRole('button', { name: 'Mark visit fulfilled' }).click()
  await expect(appt).toContainText(/fulfilled/i, { timeout: 30_000 })
  await shot(admin, '09b-visit-fulfilled')
  step('visit-fulfilled')
})

test('10 stock moved by the job and the operations view tells the truth', async ({ browser }) => {
  const admin = await login(browser, 'admin')
  await admin.goto('/garage/stock', { waitUntil: 'networkidle' })
  const row = admin.getByTestId('stock-part').filter({ hasText: PART_NAME })
  await expect(row).toBeVisible()
  await expect(row).toContainText('11')   // 10 opening + 5 received - 4 used
  await row.getByRole('button', { name: new RegExp(`stock history for ${PART_NAME}`, 'i') }).click()
  await shot(admin, '10a-stock-ledger')
  await admin.goto('/garage/operations', { waitUntil: 'networkidle' })
  await expect(admin.locator('main')).toBeVisible()
  await shot(admin, '10b-operations')
  const summary = json(await api(admin, 'GET', '/garage/operations/summary'))
  note('operations_summary_after_golden', summary)
  step('stock-and-operations')
})

test('11 NEGATIVE: a declined estimate authorizes nothing and every downstream door stays shut', async ({ browser }) => {
  const customer = await login(browser, 'customer')
  const admin = await login(browser, 'admin')
  const mech = await login(browser, 'mechanic')
  state.declineCase = await requestService(customer, DECLINE_SUMMARY)

  await openHub(admin, state.declineCase)
  await admin.getByTestId('accept-site').selectOption(HARARE_SITE)
  await admin.getByTestId('accept-case').click()
  await expect(admin.getByTestId('case-status')).toContainText(/accepted/i, { timeout: 30_000 })
  await admin.getByTestId('prepare-estimate').click()
  await admin.getByTestId('estimate-currency').fill('USD')
  await fillEstimateLine(admin, 0, { category: 'labour', qty: '1', desc: 'Diagnostic', price: '30.00' })
  await admin.getByTestId('submit-estimate').click()
  await expect(admin.getByTestId('estimate-latest')).toBeVisible({ timeout: 30_000 })
  await admin.getByTestId('send-estimate').click()
  await expect(admin.getByTestId('estimate-latest').getByTestId('estimate-status')).toContainText(/sent|waiting/i, { timeout: 30_000 })
  state.declineWo = json(await api(admin, 'GET', `/garage/cases/${state.declineCase}/hub`)).work_order.id

  await customer.goto('/dashboard/service-requests', { waitUntil: 'networkidle' })
  const card = customer.getByTestId('service-request-card').filter({ hasText: reference(state.declineCase) })
  const estimate = card.getByTestId('estimate-card').first()
  await expect(estimate).toHaveAttribute('data-status', 'sent', { timeout: 30_000 })
  await estimate.getByRole('button', { name: 'Decline', exact: true }).click()
  await customer.getByLabel('Reason for declining (optional)').fill('UAT decline path ' + RUN)
  await shot(customer, '11a-customer-declining')
  await customer.getByRole('button', { name: 'Confirm decline' }).click()
  await expect(card.getByTestId('estimate-card').first()).toHaveAttribute('data-status', 'declined', { timeout: 30_000 })
  await expect(card.getByTestId('estimate-decision').first()).toContainText(/Declined/)
  await expect(card.getByTestId('estimate-decision').first()).toContainText('UAT decline path ' + RUN)
  await expect(card.getByTestId('estimate-authorization')).toHaveCount(0)   // a declined estimate offers no authorization
  await shot(customer, '11b-customer-declined')

  await openHub(admin, state.declineCase)
  await expect(admin.getByTestId('owner-authorization')).toHaveAttribute('data-authorization', 'declined')
  await expect(admin.getByTestId('start-work')).toHaveCount(0)
  await expect(admin.getByTestId('record-form')).toHaveCount(0)
  await shot(admin, '11c-admin-sees-decline')

  // the database, not the UI, must hold the line: probe every downstream door directly
  const doors: Record<string, { status: number; body: unknown }> = {}
  const probe = async (name: string, page: Page, reason: RegExp, method: string, route: string, payload?: unknown) => {
    const r = await api(page, method, route, payload); doors[name] = { status: r.status, body: json(r) }
    expect(r.status, `${name} must be refused (got ${r.status}: ${r.text.slice(0, 160)})`).toBeGreaterThanOrEqual(400)
    expect(r.text, `${name} must be refused for the RIGHT reason`).toMatch(reason)
  }
  await probe('start_after_decline', admin, /customer declined this work/i, 'POST', `/service-cases/${state.declineCase}/start`)
  await probe('record_service_without_authorization', mech, /has not authorized this work order/i, 'POST', `/service-work-orders/${state.declineWo}/records`, { work_performed: 'must not exist', service_category: 'general_service' })
  await probe('complete_job_without_work', admin, /Start the work first/i, 'POST', `/service-cases/${state.declineCase}/complete-job`)
  await probe('invoice_without_completion', admin, /once the job is complete/i, 'POST', `/garage/cases/${state.declineCase}/invoice`, { currency: 'USD', lines: [{ category: 'labour', description: 'x', quantity: '1', unit_price: '30.00' }] })
  note('negative_journey_doors', doors)
  step('decline-journey-verified', doors)
})

test('12 MOBILE 390x844: the same journeys render without horizontal overflow', async ({ browser }) => {
  const state0 = await Promise.all((['admin', 'mechanic', 'customer'] as Who[]).map(async (w) => [w, await actors[w]!.ctx.storageState()] as const))
  const mobile = async (who: Who, route: string, name: string, ready: (p: Page) => Promise<void>) => {
    const ctx = await browser.newContext({
      baseURL: WEB, storageState: Object.fromEntries(state0)[who], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
      isMobile: true, hasTouch: true, timezoneId: 'Africa/Harare',
    })
    const page = await ctx.newPage()
    await page.goto(route, { waitUntil: 'networkidle' })
    await ready(page)
    await shot(page, name)
    await noHorizontalOverflow(page, name)
    await ctx.close()
  }
  await mobile('admin', `/garage/cases/${state.goldenCase}`, '12a-mobile-admin-hub-completed', async (p) => { await expect(p.getByTestId('invoice')).toBeVisible({ timeout: 30_000 }) })
  await mobile('mechanic', `/garage/cases/${state.goldenCase}`, '12b-mobile-mechanic-hub', async (p) => { await expect(p.getByTestId('case-header')).toBeVisible({ timeout: 30_000 }) })
  await mobile('customer', '/dashboard/service-requests', '12c-mobile-customer-requests', async (p) => { await expect(p.getByTestId('service-request-card').first()).toBeVisible({ timeout: 30_000 }) })
  await mobile('admin', '/garage/stock', '12d-mobile-admin-stock', async (p) => { await expect(p.getByTestId('stock-part').first()).toBeVisible({ timeout: 30_000 }) })
  await mobile('admin', '/garage/operations', '12e-mobile-admin-operations', async (p) => { await expect(p.locator('main')).toBeVisible({ timeout: 30_000 }) })
  step('mobile-verified')
})

test('13 history convergence: the customer service history carries the record the mechanic wrote', async ({ browser }) => {
  const customer = await login(browser, 'customer')
  await customer.goto('/dashboard/service-history', { waitUntil: 'networkidle' })
  await expect(customer.getByTestId('service-count')).toBeVisible({ timeout: 30_000 })
  const body = await customer.locator('main').innerText()
  expect(body, 'the recorded work reaches the customer own history').toContain('UAT ' + RUN)
  expect(body.replace(/,/g, ''), 'the odometer reading the mechanic recorded').toContain('15420')
  await shot(customer, '13-customer-service-history')
  step('history-convergence')
})

test('14 SECURITY: roles, tenancy and money are enforced by the server, not just hidden by the screen', async ({ browser }) => {
  const customer = await login(browser, 'customer')
  const mech = await login(browser, 'mechanic')
  const refused: Record<string, { status: number; body: unknown }> = {}
  const mustRefuse = async (name: string, page: Page, method: string, route: string, payload?: unknown) => {
    const r = await api(page, method, route, payload); refused[name] = { status: r.status, body: json(r) }
    expect([401, 403, 404], `${name} must be refused (got ${r.status}: ${r.text.slice(0, 160)})`).toContain(r.status)
  }
  await mustRefuse('customer_cannot_open_the_garage_hub', customer, 'GET', `/garage/cases/${state.goldenCase}/hub`)
  await mustRefuse('customer_cannot_read_operations', customer, 'GET', '/garage/operations/summary')
  await mustRefuse('customer_cannot_list_garage_invoices', customer, 'GET', '/garage/invoices')
  await mustRefuse('mechanic_cannot_read_operations', mech, 'GET', '/garage/operations/summary')
  await mustRefuse('mechanic_cannot_read_closeout', mech, 'GET', `/garage/cases/${state.goldenCase}/closeout`)
  await mustRefuse('mechanic_cannot_list_invoices', mech, 'GET', '/garage/invoices')
  await mustRefuse('mechanic_cannot_record_payment', mech, 'POST', `/garage/invoices/${await invoiceId(await login(browser, 'admin'))}/payments`, { amount: '1.00', currency: 'USD', method: 'cash', idempotency_key: 'sec-' + RUN })

  // money redaction is the SERVER's job: the mechanic's hub PAYLOAD must contain no price at all
  const hubRes = await api(mech, 'GET', `/garage/cases/${state.goldenCase}/hub`)
  expect(hubRes.status).toBe(200)
  const payload = json(hubRes)
  expect(payload.money_visible).toBe(false)
  expect(payload.closeout ?? null).toBeNull()
  for (const price of ['180.00', '45.50', '22.25', '91.00', '89.00']) expect(hubRes.text, `mechanic payload must not contain ${price}`).not.toContain(price)
  expect(hubRes.text).not.toContain('INTERNAL-ONLY-MARKER')
  note('security_refusals', refused)
  step('security-verified', refused)
})

test('15 REGRESSION: OPS01 sites and workforce, OPS02 customers, OPS03 schedule and retained cases still work', async ({ browser }) => {
  const admin = await login(browser, 'admin')
  const pages: Array<[string, string, RegExp[]]> = [
    ['15a-ops01-sites', '/garage/sites', [/Harare Site/, /Bulawayo Site/]],
    ['15b-ops01-workforce', '/garage/workforce', [/Mechanic 01/, /Mechanic 10/]],
    ['15c-ops02-customers', '/garage/customers', [/UAT FINAL CUSTOMER 20261024A/]],
    ['15d-ops03-schedule', '/garage/schedule', [/Harare/]],
  ]
  for (const [name, route, expected] of pages) {
    await admin.goto(route, { waitUntil: 'networkidle' })
    await expect(admin.locator('main')).toBeVisible({ timeout: 30_000 })
    const text = await admin.locator('main').innerText()
    for (const pattern of expected) expect(text, `${route} shows ${pattern}`).toMatch(pattern)
    expect(text, `${route} must not be an error page`).not.toMatch(/could not be loaded|something went wrong/i)
    await shot(admin, name)
  }
  // the accepted OPS03 cases (certified before this programme) open in the new hub and offer the new first step
  for (const [index, id] of ['cae87212-0dbc-4e93-8827-f22f6bc8bbf8', '3cb79649-60af-4291-9459-394de45e3a9a', 'a0b0d92d-fa46-4922-bf99-4b84ce9e0a25'].entries()) {
    await openHub(admin, id)
    await expect(admin.getByTestId('case-status')).toContainText(/accepted/i)
    await expect(admin.getByTestId('case-error')).toHaveCount(0)
    await expect(admin.getByTestId('prepare-estimate')).toBeVisible()
    if (index === 0) await shot(admin, '15e-ops03-retained-case-in-new-hub')
  }
  step('regression-verified')
})

test('17 COMMUNICATIONS: what each person is actually told, in-app only, and no external send', async ({ browser }) => {
  const seen: Record<string, unknown> = {}
  for (const who of ['customer', 'admin'] as Who[]) {
    const page = await login(browser, who)
    await page.goto('/dashboard', { waitUntil: 'networkidle' })
    const bell = page.getByRole('button', { name: /^Notifications/ })
    await expect(bell).toBeVisible({ timeout: 30_000 })
    const label = (await bell.getAttribute('aria-label')) ?? ''
    await bell.click()
    await page.waitForTimeout(1500)
    const panel = page.locator('[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper]').last()
    const text = (await panel.innerText().catch(() => '')) || (await page.locator('body').innerText())
    seen[who] = { bell: label, panel_text: text.slice(0, 2500) }
    await shot(page, `17-${who}-notifications`)
    await page.keyboard.press('Escape')
  }
  note('notifications_seen', seen)
  const health: any = await (await fetch(`${API}/health?x=${Date.now()}`)).json()
  note('external_sends_state', health.communications.outbound.external_sends)
  expect(health.communications.outbound.external_sends).toBe('disabled')
  step('communications-observed', seen)
})

test('18 pairing: every API request from every actor went to the immutable backend host', async () => {
  const seen = Object.fromEntries(Object.entries(hostsByActor).map(([k, v]) => [k, [...v]]))
  note('api_hosts_by_actor', seen)
  for (const [who, hosts] of Object.entries(seen)) expect(hosts, `${who} API hosts`).toEqual([BACKEND_HOST])
})
