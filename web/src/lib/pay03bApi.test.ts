import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetCsrfTokenCache, type AuthHeaders } from './apiClient'
import {
  PAY03B_IDEMPOTENCY_KEY_PATTERN,
  acknowledgePay03bReconciliationException,
  cancelPay03bDealerSubscription,
  changePay03bDealerPlan,
  createPay03bDealerCheckout,
  createPay03bIdempotencyKey,
  fetchPay03bAdminSubscriptions,
  fetchPay03bCatalogue,
  fetchPay03bDealerOverview,
  fetchPay03bReconciliationException,
  fetchPay03bReconciliationExceptions,
  previewPay03bPlanChange,
  refundPay03bAdminInvoice,
  resolvePay03bReconciliationException,
  setPay03bAdminSuspension,
  verifyPay03bDealerSubscription,
  type Pay03bClientConfig,
} from './pay03bApi'
import { describePay03bError } from './pay03bDisplay'

/**
 * Wiring tests against the REAL apiRequest (only fetch is faked): what reaches the wire is what the
 * backend contract requires — identity + tenant headers, a CSRF token bound to that identity on every
 * write, the Idempotency-Key header, the documented paths and bodies — and nothing is retried.
 */

const BASE = 'https://api.test/api'
const DEALER: AuthHeaders = {
  'x-user-id': 'dealer-user-1',
  'x-session-token': 'sess-dealer-1',
  'x-stakeholder-role': 'dealer',
  'x-tenant-id': '11111111-2222-4333-8444-555555555555',
}

interface Call { url: string; init: RequestInit }

function json(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

function makeFetch(route: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = []
  const impl = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url)
    calls.push({ url: u, init: init ?? {} })
    if (u.endsWith('/security/csrf-token')) return json({ csrfToken: 'csrf-pay03b' })
    return route(u, init ?? {})
  }) as unknown as typeof fetch
  return { impl, calls }
}

const config = (impl: typeof fetch, authHeaders: AuthHeaders = DEALER): Pay03bClientConfig => ({ baseUrl: BASE, authHeaders, fetchImpl: impl })
const headersOf = (call: Call) => call.init.headers as Record<string, string>
const apiCalls = (calls: Call[]) => calls.filter((c) => !c.url.endsWith('/security/csrf-token'))

const OVERVIEW = {
  organization: { id: 'org-1', name: 'Harare Motors', type: 'dealership', status: 'active' },
  tenantRole: 'admin',
  billingAuthority: true,
  plans: [],
  subscription: null,
  history: [],
  entitlements: { access: false, reason: 'no_subscription', status: null, planCode: null, paidThrough: null, graceUntil: null, baselineEntitlements: {}, subscriptionEntitlements: {}, effective: {} },
  invoices: [],
  enforcementActive: false,
  providerMode: 'local_simulator',
  sourceOfTruth: 'x',
}

const TERMS = { planVersion: 2, amountMinor: 3000, currency: 'JPY', billingInterval: 'month', intervalCount: 1 }

beforeEach(() => {
  resetCsrfTokenCache()
})

describe('createPay03bIdempotencyKey', () => {
  it('produces backend-valid, unique keys with the pay03b_ prefix', () => {
    const keys = new Set(Array.from({ length: 50 }, () => createPay03bIdempotencyKey()))
    expect(keys.size).toBe(50)
    for (const key of keys) {
      expect(key.startsWith('pay03b_')).toBe(true)
      expect(PAY03B_IDEMPOTENCY_KEY_PATTERN.test(key)).toBe(true)
    }
  })
})

describe('PAY-03B public + dealer reads', () => {
  it('reads the public catalogue with a plain GET (no CSRF, no write)', async () => {
    const { impl, calls } = makeFetch(() => json({ products: [{ productCode: 'sub.diaspora.free', title: 'Free', plans: [] }], pricingAuthority: 'registry' }))
    const res = await fetchPay03bCatalogue(config(impl, {}))
    expect(res.products).toHaveLength(1)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${BASE}/pay03b/catalogue`)
    expect((calls[0].init.method ?? 'GET').toUpperCase()).toBe('GET')
  })

  it('treats a malformed catalogue as an ERROR, never as an empty catalogue', async () => {
    const { impl } = makeFetch(() => json({ summary: {} }))
    await expect(fetchPay03bCatalogue(config(impl, {}))).rejects.toMatchObject({ code: 'PAY03B_CATALOGUE_RESPONSE_INVALID' })
  })

  it('sends the dealer identity AND the tenant (x-tenant-id) on the overview read', async () => {
    const { impl, calls } = makeFetch(() => json(OVERVIEW))
    await fetchPay03bDealerOverview(config(impl))
    expect(calls[0].url).toBe(`${BASE}/pay03b/dealer/subscription`)
    expect(headersOf(calls[0])).toMatchObject({
      'x-user-id': 'dealer-user-1',
      'x-session-token': 'sess-dealer-1',
      'x-tenant-id': DEALER['x-tenant-id'],
    })
  })

  it('verify is a CSRF-protected POST that returns the overview', async () => {
    const { impl, calls } = makeFetch(() => json(OVERVIEW))
    const res = await verifyPay03bDealerSubscription(config(impl))
    expect(res.organization.name).toBe('Harare Motors')
    const [post] = apiCalls(calls)
    expect(post.url).toBe(`${BASE}/pay03b/dealer/subscription/verify`)
    expect(post.init.method).toBe('POST')
    expect(headersOf(post)['x-csrf-token']).toBe('csrf-pay03b')
  })

  it('previews a plan change with a GET carrying targetPlanId and mode', async () => {
    const { impl, calls } = makeFetch(() => json({ mode: 'immediate', targetPlanCode: 'p', chargeNowMinor: 1500, currency: 'JPY', effectiveFrom: 'on_successful_payment', lines: [], providerBacked: true, simulated: true }))
    await previewPay03bPlanChange(config(impl), 'plan-uuid-2', 'immediate')
    expect(calls[0].url).toBe(`${BASE}/pay03b/dealer/subscription/change-preview?targetPlanId=plan-uuid-2&mode=immediate`)
  })
})

describe('PAY-03B dealer writes', () => {
  it('checkout: POST with CSRF, identity, tenant, Idempotency-Key and exactly the acknowledged terms', async () => {
    const { impl, calls } = makeFetch(() => json({
      subscriptionId: 'sub-1', checkoutId: 'sim_cs_1', checkoutUrl: 'http://127.0.0.1:5017/api/pay03b/simulator/checkout/sim_cs_1',
      checkoutStatus: 'open', idempotentReplay: false, gateway: 'pay03b_local_provider_simulator', simulated: true,
      amountMinor: 3000, currency: 'JPY', live: false,
    }, 201))
    const key = createPay03bIdempotencyKey()
    const res = await createPay03bDealerCheckout(config(impl), { planId: 'plan-uuid-1', acknowledgedTerms: TERMS }, key)
    expect(res.checkoutUrl).toContain('/simulator/checkout/')

    const [post] = apiCalls(calls)
    expect(post.url).toBe(`${BASE}/pay03b/dealer/subscription/checkout`)
    expect(post.init.method).toBe('POST')
    expect(post.init.credentials).toBe('include')
    expect(headersOf(post)).toMatchObject({
      'x-csrf-token': 'csrf-pay03b',
      'Idempotency-Key': key,
      'x-user-id': 'dealer-user-1',
      'x-session-token': 'sess-dealer-1',
      'x-tenant-id': DEALER['x-tenant-id'],
    })
    // Only identity + intent travel; never a browser-chosen price authority beyond the reviewed terms.
    expect(JSON.parse(String(post.init.body))).toEqual({ planId: 'plan-uuid-1', acknowledgedTerms: TERMS })
    // The CSRF token was requested with the SAME identity the POST carries.
    const csrf = calls.find((c) => c.url.endsWith('/security/csrf-token'))!
    expect(headersOf(csrf)).toMatchObject({ 'x-user-id': 'dealer-user-1', 'x-session-token': 'sess-dealer-1' })
  })

  it('refuses to send a write with an invalid idempotency key (nothing reaches the wire)', async () => {
    const { impl, calls } = makeFetch(() => json({}))
    await expect(createPay03bDealerCheckout(config(impl), { planId: 'p', acknowledgedTerms: TERMS }, 'short'))
      .rejects.toMatchObject({ code: 'PAY03B_IDEMPOTENCY_KEY_INVALID' })
    expect(calls).toHaveLength(0)
  })

  it('never re-POSTs on a network failure (exactly one checkout attempt)', async () => {
    const { impl, calls } = makeFetch(() => { throw new TypeError('Failed to fetch') })
    await expect(createPay03bDealerCheckout(config(impl), { planId: 'p', acknowledgedTerms: TERMS }, createPay03bIdempotencyKey()))
      .rejects.toThrow('Failed to fetch')
    expect(apiCalls(calls)).toHaveLength(1)
  })

  it('surfaces the backend code so the UI can explain it (409 PAY03B_TERMS_CHANGED, 403 billing authority)', async () => {
    const terms = makeFetch(() => json({ error: 'PAY03B_TERMS_CHANGED', code: 'PAY03B_TERMS_CHANGED' }, 409))
    const termsErr = await createPay03bDealerCheckout(config(terms.impl), { planId: 'p', acknowledgedTerms: TERMS }, createPay03bIdempotencyKey())
      .catch((e: unknown) => e)
    expect(describePay03bError(termsErr).code).toBe('PAY03B_TERMS_CHANGED')

    resetCsrfTokenCache()
    // A 403 on a write is retried ONCE by apiRequest with a fresh CSRF token (same Idempotency-Key, so the
    // backend replays rather than duplicates); the billing-authority refusal must still be explained.
    const refused = makeFetch(() => json({ error: 'PAY03B_BILLING_AUTHORITY_REFUSED', code: 'PAY03B_BILLING_AUTHORITY_REFUSED' }, 403))
    const key = createPay03bIdempotencyKey()
    const refusedErr = await createPay03bDealerCheckout(config(refused.impl), { planId: 'p', acknowledgedTerms: TERMS }, key)
      .catch((e: unknown) => e)
    const described = describePay03bError(refusedErr)
    expect(described.code).toBe('PAY03B_BILLING_AUTHORITY_REFUSED')
    expect(described.message).toBe('Only a billing administrator of this organization can change billing.')
    for (const post of apiCalls(refused.calls)) expect(headersOf(post)['Idempotency-Key']).toBe(key)
  })

  it('change and cancel carry the Idempotency-Key and the documented bodies; an empty reason is omitted', async () => {
    const { impl, calls } = makeFetch(() => json({ requestId: 'req-1', status: 'provider_confirmed', overview: OVERVIEW }))
    const changeKey = createPay03bIdempotencyKey()
    await changePay03bDealerPlan(config(impl), { targetPlanId: 'plan-2', mode: 'period_end' }, changeKey)
    const cancelKey = createPay03bIdempotencyKey()
    await cancelPay03bDealerSubscription(config(impl), { mode: 'period_end', reason: '   ' }, cancelKey)
    await cancelPay03bDealerSubscription(config(impl), { mode: 'immediate', reason: ' Closing branch ' }, createPay03bIdempotencyKey())

    const [change, cancel, immediate] = apiCalls(calls)
    expect(change.url).toBe(`${BASE}/pay03b/dealer/subscription/change`)
    expect(JSON.parse(String(change.init.body))).toEqual({ targetPlanId: 'plan-2', mode: 'period_end' })
    expect(headersOf(change)['Idempotency-Key']).toBe(changeKey)
    expect(cancel.url).toBe(`${BASE}/pay03b/dealer/subscription/cancel`)
    expect(JSON.parse(String(cancel.init.body))).toEqual({ mode: 'period_end' })
    expect(headersOf(cancel)['Idempotency-Key']).toBe(cancelKey)
    expect(JSON.parse(String(immediate.init.body))).toEqual({ mode: 'immediate', reason: 'Closing branch' })
  })
})

describe('PAY-03B administrator + F5 operator calls', () => {
  const ADMIN: AuthHeaders = { 'x-user-id': 'admin-1', 'x-session-token': 'sess-admin', 'x-stakeholder-role': 'admin' }
  const DETAIL = { subscription: { id: 'sub-1' }, invoices: [], transitions: [], changeRequests: [], entitlements: { access: false }, sourceOfTruth: 'x' }

  it('lists subscriptions and rejects a malformed list', async () => {
    const ok = makeFetch(() => json({ subscriptions: [{ id: 'sub-1' }], sourceOfTruth: 'x' }))
    await expect(fetchPay03bAdminSubscriptions(config(ok.impl, ADMIN))).resolves.toMatchObject({ subscriptions: [{ id: 'sub-1' }] })
    expect(ok.calls[0].url).toBe(`${BASE}/pay03b/admin/subscriptions`)
    const bad = makeFetch(() => json({ orders: [] }))
    await expect(fetchPay03bAdminSubscriptions(config(bad.impl, ADMIN))).rejects.toMatchObject({ code: 'PAY03B_ADMIN_SUBSCRIPTIONS_RESPONSE_INVALID' })
  })

  it('suspension carries the Idempotency-Key and { action, reason }; refund carries { reason }', async () => {
    const { impl, calls } = makeFetch(() => json(DETAIL))
    const key = createPay03bIdempotencyKey()
    await setPay03bAdminSuspension(config(impl, ADMIN), 'sub-1', { action: 'suspend', reason: ' Chargeback investigation ' }, key)
    await refundPay03bAdminInvoice(config(impl, ADMIN), 'sub-1', 'inv-1', { reason: 'Duplicate period charged' })
    const [suspend, refund] = apiCalls(calls)
    expect(suspend.url).toBe(`${BASE}/pay03b/admin/subscriptions/sub-1/suspension`)
    expect(headersOf(suspend)['Idempotency-Key']).toBe(key)
    expect(JSON.parse(String(suspend.init.body))).toEqual({ action: 'suspend', reason: 'Chargeback investigation' })
    expect(refund.url).toBe(`${BASE}/pay03b/admin/subscriptions/sub-1/invoices/inv-1/refund`)
    expect(JSON.parse(String(refund.init.body))).toEqual({ reason: 'Duplicate period charged' })
  })

  it('F5: lists by status, verifies with ?verify=1, acknowledges and resolves with { resolution, note }', async () => {
    const exception = { id: 'exc-1', paymentReference: 'pay03b_inv_1' }
    const { impl, calls } = makeFetch((url) => {
      if (url.includes('?status=')) return json({ exceptions: [exception], openCount: 1, sourceOfFinancialTruth: 'x' })
      if (url.includes('?verify=1')) return json({ exception, providerTruth: { status: 'partially_refunded', refundedMinor: 500, pendingRefundMinor: 0, refundIds: ['re_1'], verifiedAt: '2026-11-01T00:00:00Z' } })
      return json({ exception })
    })
    await expect(fetchPay03bReconciliationExceptions(config(impl, ADMIN), 'all')).resolves.toMatchObject({ openCount: 1 })
    await expect(fetchPay03bReconciliationException(config(impl, ADMIN), 'exc-1', { verify: true })).resolves.toMatchObject({ providerTruth: { refundedMinor: 500 } })
    await acknowledgePay03bReconciliationException(config(impl, ADMIN), 'exc-1')
    await resolvePay03bReconciliationException(config(impl, ADMIN), 'exc-1', { resolution: 'revoke_access_partial_refund_final', note: ' Partial refund stands ' })
    const urls = apiCalls(calls).map((c) => c.url)
    expect(urls).toEqual([
      `${BASE}/pay03b/admin/reconciliation-exceptions?status=all`,
      `${BASE}/pay03b/admin/reconciliation-exceptions/exc-1?verify=1`,
      `${BASE}/pay03b/admin/reconciliation-exceptions/exc-1/acknowledge`,
      `${BASE}/pay03b/admin/reconciliation-exceptions/exc-1/resolve`,
    ])
    const resolve = apiCalls(calls)[3]
    expect(JSON.parse(String(resolve.init.body))).toEqual({ resolution: 'revoke_access_partial_refund_final', note: 'Partial refund stands' })
  })
})
