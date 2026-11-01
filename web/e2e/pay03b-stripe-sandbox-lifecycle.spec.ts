/**
 * CARUP-PAY-03B-LR01 Level 2 — the customer and administrator browser flows of the ONE Owner-authorized Stripe
 * SANDBOX rehearsal, after each lifecycle transition. Real headed Chromium, real sessions and CSRF, no API mocks.
 * Every assertion compares what the page shows with the canonical database of the dedicated PAY-03B stack
 * (127.0.0.1:55422), the authority the UI must match.
 *
 *   PAY03B_LEVEL2_STAGE=<stage> PAY03B_EXPECTED_SHA=<candidate> PAY03B_EVIDENCE_DIR=$HOME/carup-launch-evidence/pay03b \
 *   PAY03B_LEVEL2_AUTHORIZATION=$HOME/carup-launch-evidence/pay03b/owner-decision-level2.json \
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:5193 \
 *   npx playwright test e2e/pay03b-stripe-sandbox-lifecycle.spec.ts --project=chromium --headed --retries=0
 *
 * Stages, in order, each run once (the checkout itself is pay03b-stripe-sandbox-rehearsal.spec.ts, and the single
 * test-clock advance is scripts/uat/pay03b-level2-rehearsal-driver.mjs, an administrator API with no UI):
 *   after-checkout  customer and administrator views after the first paid invoice
 *   after-renewal   views, then the administrator's Reconcile (a fresh provider READ; no provider mutation)
 *   cancel          CUSTOMER FLOW: cancel at the end of the paid period (the authorized cancellation)
 *   refund          ADMINISTRATOR FLOW: the ONE governed full refund of the renewal invoice
 *   after-refund    customer and administrator views after the refund
 *
 * The two provider-mutating stages check the recorded Owner scope against the canonical database and the Level 2
 * ledger BEFORE the click, refuse when the step has already happened, click exactly once and are never retried.
 */
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const STAGES = ['after-checkout', 'after-renewal', 'cancel', 'refund', 'after-refund'] as const
type Stage = (typeof STAGES)[number]
const STAGE = (process.env.PAY03B_LEVEL2_STAGE ?? '') as Stage
const AUTH = process.env.PAY03B_LEVEL2_AUTHORIZATION
const EVIDENCE_DIR = process.env.PAY03B_EVIDENCE_DIR
const EXPECTED_SHA = process.env.PAY03B_EXPECTED_SHA
const API = 'http://127.0.0.1:5041'
const PGURL = 'postgresql://postgres:postgres@127.0.0.1:55422/postgres'

test.skip(!AUTH || !EVIDENCE_DIR || !EXPECTED_SHA || !STAGES.includes(STAGE),
  'Level 2 lifecycle stages run only against the Owner-authorized Stripe-sandbox runtime, one named stage at a time.')
test.describe.configure({ mode: 'serial', timeout: 240_000 })

type Account = { email: string; password: string; userId: string }
const accounts: Record<string, Account | string> = EVIDENCE_DIR && existsSync(`${EVIDENCE_DIR}/uat-accounts.json`)
  ? JSON.parse(readFileSync(`${EVIDENCE_DIR}/uat-accounts.json`, 'utf8')) : {}
const tenantC = String(accounts.tenantC ?? '')
const SCREENS = `${EVIDENCE_DIR}/screens/level2`
const OBSERVATIONS = `${EVIDENCE_DIR}/level2-ui-observations.json`
const sql = (q: string) => execFileSync('psql', [PGURL, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8' }).trim()
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
] as const

// The customer-facing label of each CANONICAL payment status (web/src/lib/pay03bDisplay.ts).
const PAYMENT_LABEL: Record<string, string> = {
  paid: 'Payment confirmed', refunded: 'Refunded', refund_pending: 'Refund pending',
  reconciliation_hold: 'Under reconciliation', failed: 'Failed', pending: 'Pending',
}
const paymentLabel = (status: string | null) => (status ? PAYMENT_LABEL[status] ?? status : 'No payment recorded')

type Invoice = {
  id: string; provider_invoice_id: string; billing_reason: string; provider_status: string
  amount_due_minor: number; amount_paid_minor: number; period_start: string; period_end: string
  payment_reference: string | null; payment_status: string | null; payment_amount: number | null; payment_currency: string | null
}
type Canonical = {
  subscription: {
    id: string; status: string; provider_status: string; gateway: string; provider_subscription_id: string
    cancel_at_period_end: boolean; paid_through: string | null; current_period_start: string; current_period_end: string
  }
  invoices: Invoice[]
  access: { access: boolean; reason: string; paid_through: string | null }
  advances: number
  cancelRequests: number
  refundRequests: number
  openReconciliationExceptions: number
}

/** The canonical record: the one Level 2 subscription of dealer C, its invoices and canonical payments, entitlements. */
function canonical(): Canonical {
  const subscriptions = JSON.parse(sql(`select coalesce(json_agg(row_to_json(s)), '[]') from (select id, status, provider_status,
    gateway, provider_subscription_id, cancel_at_period_end, paid_through, current_period_start, current_period_end
    from public.pay03b_business_subscriptions where owner_tenant_id = ${lit(tenantC)}) s`))
  expect(subscriptions, 'exactly one Level 2 subscription for dealer C').toHaveLength(1)
  const [subscription] = subscriptions
  expect(subscription.gateway, 'the Level 2 subscription is on the Stripe sandbox gateway').toBe('stripe_carup_japan_sandbox')
  const invoices = JSON.parse(sql(`select coalesce(json_agg(row_to_json(i) order by i.period_start), '[]') from (
    select i.id, i.provider_invoice_id, i.billing_reason, i.provider_status, i.amount_due_minor, i.amount_paid_minor, i.period_start,
      i.period_end, i.payment_reference, p.status as payment_status, p.amount as payment_amount, p.currency as payment_currency
    from public.pay03b_subscription_invoices i left join public.payment_transactions p on p.reference = i.payment_reference
    where i.subscription_id = ${lit(subscription.id)}) i`))
  const entitlement = JSON.parse(sql(`select public.pay03b_resolve_tenant_entitlements(${lit(tenantC)}, 'dealer_storefront')::text`))
  const ledgerFile = `${EVIDENCE_DIR}/level2-ledger.json`
  const ledger = existsSync(ledgerFile) ? JSON.parse(readFileSync(ledgerFile, 'utf8')) : { advances: [] }
  const counts = JSON.parse(sql(`select json_build_object(
    'cancel', (select count(*) from public.pay03b_subscription_change_requests where subscription_id = ${lit(subscription.id)}
      and change_type in ('cancel_at_period_end', 'cancel_immediately')),
    'refund', (select count(*) from public.trust_audit_events where event_type = 'PAY03B_ADMIN_INVOICE_REFUND_REQUESTED'),
    'f5', (select count(*) from public.pay03b_payment_reconciliation_exceptions where status = 'open'))`))
  return {
    subscription, invoices,
    access: { access: entitlement.access, reason: entitlement.reason, paid_through: entitlement.paid_through },
    advances: (ledger.advances || []).length,
    cancelRequests: Number(counts.cancel), refundRequests: Number(counts.refund), openReconciliationExceptions: Number(counts.f5),
  }
}

/** Waits (bounded) for the canonical record to satisfy a condition; asynchronous provider events converge into it. */
async function canonicalWhen(predicate: (c: Canonical) => boolean, what: string, timeoutMs = 90_000): Promise<Canonical> {
  const deadline = Date.now() + timeoutMs
  let latest = canonical()
  while (!predicate(latest)) {
    if (Date.now() > deadline) throw new Error(`canonical record never reached: ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    latest = canonical()
  }
  return latest
}

async function login(page: Page, who: 'dealerC' | 'ops') {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/login')
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
  await page.reload()
  await page.getByTestId('email-input').fill((accounts[who] as Account).email)
  await page.getByTestId('password-input').fill((accounts[who] as Account).password)
  await page.getByTestId('login-button').click()
  await page.waitForFunction(() => Boolean(localStorage.getItem('carup_token')))
}

async function axeClean(page: Page, include: string) {
  const results = await new AxeBuilder({ page }).include(include).withTags(['wcag2a', 'wcag2aa']).analyze()
  const found = results.violations.flatMap((v) => v.nodes.map((n) =>
    `${v.id} @ ${n.target.join(' ')}: ${(n.any[0]?.message ?? n.failureSummary ?? '').replace(/\s+/g, ' ').slice(0, 180)}`))
  expect(found, `no WCAG 2 A/AA violations in ${include}`).toEqual([])
}

/** Screenshots one loaded view at the three certified viewports (a resize re-lays out; it does not re-fetch). */
async function capture(page: Page, name: string, root: string) {
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await page.waitForTimeout(400)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, `no lateral page overflow (${name}, ${vp.name})`).toBeLessThanOrEqual(1)
    if (vp.name !== 'tablet') await axeClean(page, root)
    await page.screenshot({ path: `${SCREENS}/${name}-${vp.name}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}

type CustomerObservation = { access: string; accessReason: string; paidThrough: string; renewal: string; invoices: Record<string, string> }

/** Customer view (dealer C's billing administrator): access, paid-through and every invoice, each against canonical. */
async function customerView(page: Page, state: Canonical, name: string): Promise<CustomerObservation> {
  await login(page, 'dealerC')
  await page.goto('/dealer/subscription')
  await expect(page.getByTestId('pay03b-dealer-subscription')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('pay03b-access-value')).toHaveText(state.access.access ? 'Active' : 'No paid access', { timeout: 30_000 })
  await expect(page.locator('[data-testid^="pay03b-invoice-in_"]'), 'every canonical invoice, and only those').toHaveCount(state.invoices.length)
  const invoices: Record<string, string> = {}
  for (const invoice of state.invoices) {
    const badge = page.getByTestId(`pay03b-invoice-payment-${invoice.provider_invoice_id}`)
    await expect(badge).toHaveText(paymentLabel(invoice.payment_status))
    await expect(page.getByTestId(`pay03b-invoice-amount-${invoice.provider_invoice_id}`)).toContainText('500')
    invoices[invoice.provider_invoice_id] = (await badge.textContent())?.trim() ?? ''
  }
  if (state.subscription.cancel_at_period_end) await expect(page.getByTestId('pay03b-resume')).toBeVisible()
  else await expect(page.getByTestId('pay03b-cancel-period-end')).toBeVisible()
  const observation = {
    access: (await page.getByTestId('pay03b-access-value').textContent())?.trim() ?? '',
    accessReason: (await page.getByTestId('pay03b-access-reason').textContent())?.trim() ?? '',
    paidThrough: (await page.getByTestId('pay03b-paid-through-value').textContent())?.trim() ?? '',
    renewal: (await page.getByTestId('pay03b-renewal').textContent())?.trim() ?? '',
    invoices,
  }
  await capture(page, name, '[data-testid="pay03b-dealer-subscription"]')
  return observation
}

/** Administrator view: the subscription row and its detail (invoices, canonical payments, entitlements). */
async function adminView(page: Page, state: Canonical): Promise<Record<string, string>> {
  await login(page, 'ops')
  await page.goto('/admin/commercial-foundation')
  await expect(page.getByTestId('pay03b-admin-subscriptions')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId(`pay03b-admin-subscription-access-${state.subscription.id}`))
    .toHaveText(state.access.access ? 'Paid access' : 'No paid access', { timeout: 30_000 })
  await expect(page.getByTestId('pay03b-admin-f5-open-count')).toHaveText(`Open exceptions: ${state.openReconciliationExceptions}`, { timeout: 30_000 })
  await page.getByTestId(`pay03b-admin-inspect-${state.subscription.id}`).click()
  await expect(page.getByTestId('pay03b-admin-subscription-detail')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('pay03b-admin-entitlements')).toBeVisible({ timeout: 30_000 })
  const invoices: Record<string, string> = {}
  for (const invoice of state.invoices) {
    const badge = page.getByTestId(`pay03b-admin-invoice-payment-${invoice.provider_invoice_id}`)
    await expect(badge).toHaveText(paymentLabel(invoice.payment_status))
    invoices[invoice.provider_invoice_id] = (await badge.textContent())?.trim() ?? ''
    // A refund control exists only while the provider invoice AND the canonical payment are paid.
    const refundable = invoice.provider_status === 'paid' && invoice.payment_status === 'paid' && Boolean(invoice.payment_reference)
    await expect(page.getByTestId(`pay03b-admin-refund-${invoice.provider_invoice_id}`)).toHaveCount(refundable ? 1 : 0)
  }
  return invoices
}

function sanitizedCanonical(state: Canonical) {
  return {
    subscription: { status: state.subscription.status, provider_status: state.subscription.provider_status,
      cancel_at_period_end: state.subscription.cancel_at_period_end, paid_through: state.subscription.paid_through,
      current_period_start: state.subscription.current_period_start, current_period_end: state.subscription.current_period_end },
    invoices: state.invoices.map((i) => ({ provider_invoice_id: i.provider_invoice_id, billing_reason: i.billing_reason,
      provider_status: i.provider_status, amount_paid_minor: i.amount_paid_minor, period_start: i.period_start, period_end: i.period_end,
      payment_reference: i.payment_reference, payment_status: i.payment_status })),
    access: state.access, advances: state.advances, openReconciliationExceptions: state.openReconciliationExceptions,
  }
}

function recordObservation(entry: Record<string, unknown>) {
  const log = existsSync(OBSERVATIONS) ? JSON.parse(readFileSync(OBSERVATIONS, 'utf8')) : []
  log.push({ stage: STAGE, at: new Date().toISOString(), runtime_sha: EXPECTED_SHA, ...entry })
  writeFileSync(OBSERVATIONS, JSON.stringify(log, null, 2), { mode: 0o600 })
}
const earlier = (stage: Stage) => {
  const log = existsSync(OBSERVATIONS) ? JSON.parse(readFileSync(OBSERVATIONS, 'utf8')) : []
  return log.filter((e: { stage: string }) => e.stage === stage).pop() ?? null
}

test(`Level 2 lifecycle stage: ${STAGE}`, async ({ page, request, baseURL }) => {
  mkdirSync(SCREENS, { recursive: true })
  const authorization = JSON.parse(readFileSync(AUTH!, 'utf8'))
  expect(authorization.decisions.level2_stripe_sandbox_rehearsal).toBe('Authorize exact scope (Recommended)')
  const web = await (await request.get(`${baseURL}/carup-provenance.json`)).json()
  expect(web.commit_sha, 'web build is the candidate').toBe(EXPECTED_SHA)
  const health = await (await request.get(`${API}/api/health`)).json()
  expect(health.build.commit_sha, 'backend is the candidate').toBe(EXPECTED_SHA)

  if (STAGE === 'after-checkout') {
    const state = await canonicalWhen((c) => c.invoices.length === 1 && c.invoices[0].payment_status === 'paid', 'first invoice paid')
    expect(state.invoices[0].billing_reason).toBe('subscription_create')
    expect(state.invoices[0].amount_paid_minor).toBe(500)
    expect(state.access.access, 'access only after the provider-confirmed first payment').toBe(true)
    const customer = await customerView(page, state, '10-customer-after-checkout')
    await expect(page.getByTestId('pay03b-capacity-value')).toHaveText('Up to 10 published listings')
    const admin = await adminView(page, state)
    await capture(page, '11-admin-after-checkout', '[data-testid="pay03b-admin-subscription-detail"]')
    recordObservation({ customer, admin, canonical: sanitizedCanonical(state) })
  }

  if (STAGE === 'after-renewal') {
    const state = await canonicalWhen((c) => c.invoices.length === 2 && c.invoices.every((i) => i.payment_status === 'paid'),
      'first and renewal invoices paid')
    const [first, renewal] = state.invoices
    expect([first.billing_reason, renewal.billing_reason]).toEqual(['subscription_create', 'subscription_cycle'])
    expect(renewal.amount_paid_minor).toBe(500)
    expect(new Date(renewal.period_start).getTime(), 'the renewal period starts where the first one ends')
      .toBe(new Date(first.period_end).getTime())
    expect(new Date(state.subscription.paid_through!).getTime(), 'paid through the renewal period').toBe(new Date(renewal.period_end).getTime())
    const customer = await customerView(page, state, '12-customer-after-renewal')
    const atCheckout = earlier('after-checkout')
    if (atCheckout) expect(customer.paidThrough, 'paid-through moved forward with the paid renewal').not.toBe(atCheckout.customer.paidThrough)
    const admin = await adminView(page, state)
    await capture(page, '13-admin-after-renewal', '[data-testid="pay03b-admin-subscription-detail"]')
    // Administrator flow: Reconcile is a fresh provider READ into the canonical authority (no provider mutation).
    const reconcileResponse = page.waitForResponse((r) => r.url().endsWith(`/api/pay03b/admin/subscriptions/${state.subscription.id}/reconcile`)
      && r.request().method() === 'POST')
    await page.getByTestId('pay03b-admin-reconcile').click()
    const response = await reconcileResponse
    expect((await response.request().allHeaders())['x-csrf-token'], 'CSRF token sent').toBeTruthy()
    expect(response.status()).toBe(200)
    await expect(page.getByTestId('pay03b-admin-subscription-status')).toContainText('Provider re-read into the canonical authority',
      { timeout: 60_000 })
    const reconciled = canonical()
    expect(sanitizedCanonical(reconciled).invoices, 'a fresh provider read changes nothing that was already converged')
      .toEqual(sanitizedCanonical(state).invoices)
    await page.screenshot({ path: `${SCREENS}/14-admin-reconciled-desktop.png`, fullPage: true })
    recordObservation({ customer, admin, reconcile: { http: response.status() }, canonical: sanitizedCanonical(reconciled) })
  }

  if (STAGE === 'cancel') {
    const before = canonical()
    // Scope guard, fail closed BEFORE any click.
    expect(before.advances, 'the one authorized test-clock advance precedes the cancellation').toBe(1)
    expect(before.invoices.filter((i) => i.payment_status === 'paid'), 'first and renewal invoices are paid').toHaveLength(2)
    expect(before.subscription.cancel_at_period_end, 'cancel at period end is not already set').toBe(false)
    expect(before.cancelRequests, 'no cancellation was requested before').toBe(0)
    await login(page, 'dealerC')
    await page.goto('/dealer/subscription')
    await expect(page.getByTestId('pay03b-cancel-period-end')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('pay03b-cancel-period-end').click()
    await expect(page.getByTestId('pay03b-confirm-dialog')).toBeVisible()
    await axeClean(page, '[data-testid="pay03b-confirm-dialog"]')
    await page.getByTestId('pay03b-cancel-reason').fill('Level 2 rehearsal: closing the storefront at the end of the paid period (Owner-authorized scope)')
    await page.screenshot({ path: `${SCREENS}/20-cancel-dialog-desktop.png`, fullPage: true })
    const cancelResponse = page.waitForResponse((r) => r.url().endsWith('/api/pay03b/dealer/subscription/cancel') && r.request().method() === 'POST')
    await page.getByTestId('pay03b-confirm-action').click() // exactly once; never retried
    const response = await cancelResponse
    const headers = await response.request().allHeaders()
    expect(headers['x-csrf-token'], 'CSRF token sent').toBeTruthy()
    expect(headers['idempotency-key'], 'idempotency key sent').toBeTruthy()
    expect(response.status(), 'the cancellation was accepted').toBe(200)
    await expect(page.getByTestId('pay03b-resume')).toBeVisible({ timeout: 60_000 })
    const after = await canonicalWhen((c) => c.subscription.cancel_at_period_end, 'cancel at period end recorded')
    expect(after.subscription.status, 'still active until the end of the paid period').toBe('active')
    expect(after.subscription.paid_through, 'paid-through access is preserved').toBe(before.subscription.paid_through)
    expect(after.access.access).toBe(true)
    expect(after.cancelRequests).toBe(1)
    const customer = await customerView(page, after, '21-customer-cancel-at-period-end')
    const admin = await adminView(page, after)
    await expect(page.getByTestId(`pay03b-admin-subscription-${after.subscription.id}`)).toContainText('Cancels at period end')
    await page.screenshot({ path: `${SCREENS}/22-admin-after-cancel-desktop.png`, fullPage: true })
    recordObservation({ cancel: { http: response.status() }, customer, admin, canonical: sanitizedCanonical(after) })
  }

  if (STAGE === 'refund') {
    const before = canonical()
    const renewals = before.invoices.filter((i) => i.billing_reason === 'subscription_cycle')
    // Scope guard, fail closed BEFORE any click: the ONE authorized refund, of the renewal, not made before.
    expect(before.advances).toBe(1)
    expect(before.subscription.cancel_at_period_end, 'the cancellation precedes the refund').toBe(true)
    expect(renewals, 'exactly one renewal invoice').toHaveLength(1)
    const [renewal] = renewals
    expect(renewal.provider_status).toBe('paid')
    expect(renewal.payment_status, 'the renewal payment is paid and refundable').toBe('paid')
    expect(before.invoices.some((i) => ['refund_pending', 'refunded', 'reconciliation_hold', 'partially_refunded'].includes(i.payment_status ?? '')),
      'no refund made or in flight').toBe(false)
    expect(before.refundRequests, 'no refund was requested before').toBe(0)
    await login(page, 'ops')
    await page.goto('/admin/commercial-foundation')
    await expect(page.getByTestId(`pay03b-admin-inspect-${before.subscription.id}`)).toBeVisible({ timeout: 30_000 })
    await page.getByTestId(`pay03b-admin-inspect-${before.subscription.id}`).click()
    await expect(page.getByTestId('pay03b-admin-subscription-detail')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId(`pay03b-admin-refund-${renewal.provider_invoice_id}`).click()
    await expect(page.getByTestId('pay03b-admin-refund-dialog')).toBeVisible()
    await expect(page.getByTestId('pay03b-admin-refund-effect')).toContainText(renewal.provider_invoice_id)
    await expect(page.getByTestId('pay03b-admin-refund-effect')).toContainText('500')
    await page.getByTestId('pay03b-admin-refund-reason').fill('Level 2 rehearsal: the one Owner-authorized governed full refund of the renewal invoice')
    await page.getByTestId('pay03b-admin-refund-understood').check()
    await axeClean(page, '[data-testid="pay03b-admin-refund-dialog"]')
    await page.screenshot({ path: `${SCREENS}/30-refund-dialog-desktop.png`, fullPage: true })
    const refundResponse = page.waitForResponse((r) => r.url().endsWith(`/invoices/${renewal.id}/refund`) && r.request().method() === 'POST')
    await page.getByTestId('pay03b-admin-refund-confirm').click() // exactly once; never retried
    const response = await refundResponse
    expect((await response.request().allHeaders())['x-csrf-token'], 'CSRF token sent').toBeTruthy()
    expect(response.status(), 'the governed refund was accepted').toBe(200)
    await expect(page.getByTestId('pay03b-admin-subscription-status')).toContainText(`Governed refund recorded for invoice ${renewal.provider_invoice_id}`,
      { timeout: 60_000 })
    await page.screenshot({ path: `${SCREENS}/31-admin-refund-recorded-desktop.png`, fullPage: true })
    const after = canonical()
    expect(after.refundRequests).toBe(1)
    expect(after.invoices.find((i) => i.billing_reason === 'subscription_create')?.payment_status, 'the first payment is untouched').toBe('paid')
    expect(['refund_pending', 'refunded']).toContain(after.invoices.find((i) => i.id === renewal.id)?.payment_status)
    recordObservation({ refund: { http: response.status(), invoice: renewal.provider_invoice_id }, canonical: sanitizedCanonical(after) })
  }

  if (STAGE === 'after-refund') {
    const state = await canonicalWhen((c) => c.invoices.some((i) => i.billing_reason === 'subscription_cycle' && i.payment_status === 'refunded'),
      'the renewal payment refunded')
    const first = state.invoices.find((i) => i.billing_reason === 'subscription_create')!
    expect(first.payment_status, 'the first period stays paid').toBe('paid')
    expect(new Date(state.subscription.paid_through!).getTime(), 'the refunded renewal no longer extends access: paid through the first period')
      .toBe(new Date(first.period_end).getTime())
    expect(state.subscription.cancel_at_period_end, 'no reinstatement: the cancellation stands').toBe(true)
    expect(state.openReconciliationExceptions, 'a governed refund opens no reconciliation exception').toBe(0)
    const customer = await customerView(page, state, '32-customer-after-refund')
    const atCheckout = earlier('after-checkout')
    if (atCheckout) expect(customer.paidThrough, 'paid-through is back to the first paid period').toBe(atCheckout.customer.paidThrough)
    const admin = await adminView(page, state)
    await capture(page, '33-admin-after-refund', '[data-testid="pay03b-admin-subscription-detail"]')
    recordObservation({ customer, admin, canonical: sanitizedCanonical(state) })
  }
})
