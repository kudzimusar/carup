import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * CARUP-PAY-03B — Dealer "Plan & Billing". These tests pin the truth rules:
 *  - paid catalogue plans are "Not yet available" (with the blocker), never priced; only sandbox fixtures
 *    carry an amount, always labelled as a sandbox test plan, and the simulator is labelled as not Stripe;
 *  - reviewed terms ≠ provider payment ≠ access: access is read from entitlements, and a return from the
 *    provider is verified, never trusted;
 *  - every write carries one idempotency key per reviewed intent, reused on retry, never auto re-sent;
 *  - a failed read is an alert, never an empty plan or invoice list.
 */

const api = {
  fetchPay03bDealerOverview: vi.fn(),
  verifyPay03bDealerSubscription: vi.fn(),
  createPay03bDealerCheckout: vi.fn(),
  previewPay03bPlanChange: vi.fn(),
  changePay03bDealerPlan: vi.fn(),
  cancelPay03bDealerSubscription: vi.fn(),
  createPay03bPaymentMethodUpdate: vi.fn(),
  getPay03bInvoicePaymentLink: vi.fn(),
  abandonPay03bDealerCheckout: vi.fn(),
}
const redirect = vi.fn()

// A fresh object per render, like the real hook: the page must depend on functions, not the object.
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => ({ ...api }) }))
vi.mock('@/lib/pay03bRedirect', () => ({ redirectToPay03bProvider: (url: string) => redirect(url) }))

const DealerSubscription = (await import('./Subscription')).default

const KEY_PATTERN = /^pay03b_[A-Za-z0-9_-]{9,89}$/
const CAPACITY = 'dealer.inventory.published_listing_capacity'

const ORG = { id: 'org-dealer-1', name: 'Harare Premium Motors', type: 'dealership', status: 'active' }
const GOVERNED = {
  id: 'plan-gov', planCode: 'dealer_storefront_package', planVersion: 1,
  displayName: 'Dealership Verified Storefront & Inventory Package', tierRank: 10, pricingKind: 'unpriced',
  activationStatus: 'commercially_blocked', commercialStatus: 'not_available', amountMinor: null, currency: null,
  currencyScale: 2, billingInterval: 'month', intervalCount: 1, entitlements: {}, trialDays: null, graceDays: null,
  changePolicy: { upgrade: 'period_end', downgrade: 'period_end', proration: 'none' },
  cancellationPolicy: { period_end: true, immediate: false }, refundPolicy: 'pro_rata_or_period_end_cancellation_pending_terms',
  blockerClass: 'COMMERCIAL', blockerReason: 'No approved tariff, merchant of record or Zimbabwe collection provider.',
  simulated: false, purchasable: false,
}
const STANDARD = {
  id: 'plan-std', planCode: 'dealer_sandbox_std', planVersion: 1, displayName: 'Sandbox Standard', tierRank: 15,
  pricingKind: 'sandbox_fixture', activationStatus: 'sandbox_only', commercialStatus: 'sandbox_test_only_not_a_commercial_offer',
  amountMinor: 3000, currency: 'JPY', currencyScale: 0, billingInterval: 'month', intervalCount: 1,
  entitlements: { [CAPACITY]: 10 }, trialDays: null, graceDays: 3,
  changePolicy: { upgrade: 'immediate_prorated', downgrade: 'period_end', proration: 'always_invoice' },
  cancellationPolicy: { period_end: true, immediate: false }, refundPolicy: 'governed_admin_refund',
  blockerClass: null, blockerReason: null, simulated: true, purchasable: true,
}
const PREMIUM = {
  ...STANDARD, id: 'plan-prem', planCode: 'dealer_sandbox_prem', displayName: 'Sandbox Premium', tierRank: 20,
  amountMinor: 6000, entitlements: { [CAPACITY]: 50 }, cancellationPolicy: { period_end: true, immediate: true },
}
const NO_ACCESS = {
  access: false, reason: 'no_subscription', status: null, planCode: null, paidThrough: null, graceUntil: null,
  baselineEntitlements: {}, subscriptionEntitlements: {}, effective: { [CAPACITY]: null },
}
const ACTIVE_SUB = {
  id: 'sub-1', subscriptionReference: 'pay03b_sub_1', status: 'active', providerStatus: 'active',
  gateway: 'pay03b_local_provider_simulator', simulated: true, planId: 'plan-std', planCode: 'dealer_sandbox_std',
  paidPlanId: 'plan-std', paidPlanCode: 'dealer_sandbox_std', scheduledPlanChange: false,
  currentPeriodStart: '2026-11-01T00:00:00.000Z', currentPeriodEnd: '2026-12-01T00:00:00.000Z',
  paidThrough: '2026-12-01T00:00:00.000Z', graceUntil: null, cancelAtPeriodEnd: false, cancellationMode: null,
  canceledAt: null, endedAt: null, suspendedReason: null, providerSubscriptionId: 'sim_sub_1',
  createdAt: '2026-11-01T00:00:00.000Z',
}
const ACTIVE_ACCESS = {
  access: true, reason: 'paid_period', status: 'active', planCode: 'dealer_sandbox_std',
  paidThrough: '2026-12-01T00:00:00.000Z', graceUntil: null, baselineEntitlements: {},
  subscriptionEntitlements: { [CAPACITY]: 10 }, effective: { [CAPACITY]: 10 },
}
const PAID_INVOICE = {
  id: 'inv-1', providerInvoiceId: 'sim_in_paid1', billingReason: 'subscription_create',
  periodStart: '2026-11-01T00:00:00.000Z', periodEnd: '2026-12-01T00:00:00.000Z', currency: 'JPY',
  amountDueMinor: 3000, amountPaidMinor: 3000, providerStatus: 'paid', anomaly: null, attemptCount: 1,
  paymentReference: 'pay03b_inv_1', paymentStatus: 'paid',
}
const OPEN_INVOICE = {
  ...PAID_INVOICE, id: 'inv-2', providerInvoiceId: 'sim_in_open2', billingReason: 'subscription_cycle',
  periodStart: '2026-12-01T00:00:00.000Z', periodEnd: '2027-01-01T00:00:00.000Z', amountPaidMinor: 0,
  providerStatus: 'open', attemptCount: 2, paymentReference: null, paymentStatus: null,
}

function overview(overrides: Record<string, unknown> = {}) {
  return {
    organization: ORG, tenantRole: 'admin', billingAuthority: true, plans: [GOVERNED, STANDARD, PREMIUM],
    subscription: null, history: [], entitlements: NO_ACCESS, invoices: [], enforcementActive: false,
    providerMode: 'local_simulator', sourceOfTruth: 'canonical', ...overrides,
  }
}

const activeOverview = (overrides: Record<string, unknown> = {}) =>
  overview({ subscription: ACTIVE_SUB, entitlements: ACTIVE_ACCESS, invoices: [PAID_INVOICE], ...overrides })

function renderPage(path = '/dealer/subscription') {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={[path]}>
        <DealerSubscription />
      </MemoryRouter>
    </StrictMode>,
  )
}

const apiError = (status: number, code: string) => Object.assign(new Error(code), { status, code, data: { error: code, code } })

beforeEach(() => {
  vi.clearAllMocks()
  api.fetchPay03bDealerOverview.mockResolvedValue(overview())
  api.verifyPay03bDealerSubscription.mockResolvedValue(overview())
})

describe('Plan & Billing — catalogue truth', () => {
  it('shows organization, role and billing authority, and each plan with its governed status', async () => {
    renderPage()
    expect(screen.getByTestId('pay03b-loading').getAttribute('role')).toBe('status')
    await screen.findByTestId('pay03b-plans')

    expect(screen.getByTestId('pay03b-organization-name').textContent).toBe('Harare Premium Motors')
    expect(screen.getByTestId('pay03b-tenant-role').textContent).toContain('Admin')
    expect(screen.getByTestId('pay03b-billing-authority')).toBeTruthy()

    const governed = screen.getByTestId('pay03b-plan-dealer_storefront_package')
    expect(within(governed).getByTestId('pay03b-plan-status-dealer_storefront_package').textContent).toContain('Not yet available')
    expect(within(governed).getByTestId('pay03b-plan-blocker-dealer_storefront_package').textContent).toContain('No approved tariff')
    expect(governed.textContent).not.toContain('Free')
    expect(governed.textContent).not.toMatch(/[$¥]\s?\d/)
    expect(within(governed).queryByTestId('pay03b-subscribe-dealer_storefront_package')).toBeNull()

    const standard = screen.getByTestId('pay03b-plan-dealer_sandbox_std')
    expect(within(standard).getByTestId('pay03b-sandbox-label').textContent).toBe('Sandbox test plan — not a commercial offer')
    expect(within(standard).getByTestId('pay03b-simulated-label').textContent).toBe('Simulated provider (local test) — not Stripe')
    expect(within(standard).getByTestId('pay03b-plan-amount-dealer_sandbox_std').textContent).toBe('¥3,000per month')
    expect(within(standard).getByTestId('pay03b-subscribe-dealer_sandbox_std')).toBeTruthy()
  })

  it('shows access from entitlements: none, with the reason, and an honest capacity / paid-through state', async () => {
    renderPage()
    await screen.findByTestId('pay03b-current')
    expect(screen.getByTestId('pay03b-access-value').textContent).toBe('No paid access')
    expect(screen.getByTestId('pay03b-access-reason').textContent).toBe('This organization has no subscription.')
    expect(screen.getByTestId('pay03b-paid-through-value').textContent).toBe('No paid period yet')
    expect(screen.getByTestId('pay03b-capacity').textContent).toContain('No capacity set by any plan')
    expect(screen.getByTestId('pay03b-capacity').textContent).toContain('Not enforced in this environment')
    expect(screen.getByTestId('pay03b-invoices-empty').textContent).toBe('No invoices yet.')
  })

  it('a production-like overview (governed plan only, no subscription) shows no amount at all', async () => {
    api.fetchPay03bDealerOverview.mockResolvedValue(overview({ plans: [GOVERNED], providerMode: 'stripe_sandbox' }))
    const { container } = renderPage()
    await screen.findByTestId('pay03b-plans')
    expect(container.textContent).not.toMatch(/[$¥€£]\s?\d/)
    expect(screen.queryByTestId('pay03b-sandbox-label')).toBeNull()
    expect(screen.queryByTestId('pay03b-subscribe-dealer_storefront_package')).toBeNull()
  })

  it('staff without billing authority get a read-only view with an explanation and no billing actions', async () => {
    api.fetchPay03bDealerOverview.mockResolvedValue(activeOverview({
      billingAuthority: false, tenantRole: 'dealer', invoices: [PAID_INVOICE, OPEN_INVOICE],
    }))
    renderPage()
    const readOnly = await screen.findByTestId('pay03b-read-only')
    expect(readOnly.textContent).toContain('Only a billing administrator of Harare Premium Motors')
    expect(screen.queryByTestId('pay03b-billing-authority')).toBeNull()
    expect(screen.queryByTestId('pay03b-subscription-actions')).toBeNull()
    expect(screen.queryByTestId('pay03b-cancel-period-end')).toBeNull()
    expect(screen.queryByTestId('pay03b-update-payment-method')).toBeNull()
    expect(screen.queryByTestId('pay03b-change-plan-dealer_sandbox_prem')).toBeNull()
    expect(screen.queryByTestId('pay03b-pay-invoice-sim_in_open2')).toBeNull()
    // …but the plan, access and invoices remain visible.
    expect(screen.getByTestId('pay03b-access-value').textContent).toBe('Active')
    expect(screen.getByTestId('pay03b-invoice-sim_in_open2')).toBeTruthy()
  })
})

describe('Plan & Billing — failed reads', () => {
  it('a failed overview read is an alert with the mapped reason, never an empty plan or invoice list', async () => {
    api.fetchPay03bDealerOverview.mockRejectedValue(apiError(400, 'PAY03B_TENANT_CONTEXT_REQUIRED'))
    renderPage()
    const alert = await screen.findByTestId('pay03b-error')
    expect(alert.getAttribute('role')).toBe('alert')
    expect(alert.textContent).toContain('Select your dealership organization first.')
    expect(alert.textContent).toContain('this is not an empty plan or invoice list')
    expect(screen.queryByTestId('pay03b-plans')).toBeNull()
    expect(screen.queryByTestId('pay03b-invoices')).toBeNull()
    expect(screen.queryByTestId('pay03b-access-status')).toBeNull()
  })

  it('explains a missing legal organization binding, and recovers on retry', async () => {
    api.fetchPay03bDealerOverview.mockRejectedValueOnce(apiError(409, 'PAY03B_NO_LEGAL_ORGANIZATION_BOUND'))
    api.fetchPay03bDealerOverview.mockRejectedValueOnce(apiError(409, 'PAY03B_NO_LEGAL_ORGANIZATION_BOUND'))
    renderPage()
    expect((await screen.findByTestId('pay03b-error')).textContent).toContain('No active dealership organization is bound')
    fireEvent.click(screen.getByTestId('pay03b-retry'))
    await screen.findByTestId('pay03b-plans')
    expect(screen.queryByTestId('pay03b-error')).toBeNull()
  })
})

describe('Plan & Billing — terms review and checkout', () => {
  it('reviews the full terms, sends exactly them with one key, and redirects to the provider', async () => {
    api.createPay03bDealerCheckout.mockResolvedValue({
      subscriptionId: 'sub-new', checkoutId: 'sim_cs_1', checkoutUrl: 'http://127.0.0.1:5017/api/pay03b/simulator/checkout/sim_cs_1',
      checkoutStatus: 'open', idempotentReplay: false, gateway: 'pay03b_local_provider_simulator', simulated: true,
      amountMinor: 3000, currency: 'JPY', live: false,
    })
    renderPage()
    fireEvent.click(await screen.findByTestId('pay03b-subscribe-dealer_sandbox_std'))

    const dialog = await screen.findByTestId('pay03b-terms-dialog')
    expect(within(dialog).getByTestId('pay03b-terms-amount').textContent).toBe('¥3,000')
    expect(within(dialog).getByTestId('pay03b-terms-currency').textContent).toBe('JPY')
    expect(within(dialog).getByTestId('pay03b-terms-interval').textContent).toBe('Charged per month')
    expect(within(dialog).getByTestId('pay03b-terms-provider').textContent).toBe('Simulated provider (local test) — not Stripe')
    expect(within(dialog).getByTestId('pay03b-terms-sandbox-label').textContent).toBe('Sandbox test plan — not a commercial offer')
    expect(within(dialog).getByTestId('pay03b-terms-cancellation').textContent).toContain('access continues until the paid-through date')
    expect(within(dialog).getByTestId('pay03b-terms-cancellation').textContent).toContain('Immediate cancellation is not offered')
    expect(within(dialog).getByTestId('pay03b-terms-refund').textContent).toContain('only by a CarUp administrator')
    expect(within(dialog).getByTestId('pay03b-terms-redirect-notice').textContent).toBe(
      'You will be redirected to the provider; CarUp confirms payment with the provider before granting access.',
    )
    expect(api.createPay03bDealerCheckout).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByTestId('pay03b-terms-confirm'))
    await waitFor(() => expect(redirect).toHaveBeenCalledWith('http://127.0.0.1:5017/api/pay03b/simulator/checkout/sim_cs_1'))
    expect(api.createPay03bDealerCheckout).toHaveBeenCalledTimes(1)
    const [body, key] = api.createPay03bDealerCheckout.mock.calls[0]
    expect(body).toEqual({
      planId: 'plan-std',
      acknowledgedTerms: { planVersion: 1, amountMinor: 3000, currency: 'JPY', billingInterval: 'month', intervalCount: 1 },
    })
    expect(key).toMatch(KEY_PATTERN)
  })

  it('a failed attempt is never re-sent automatically; a manual retry (even after re-opening) reuses the same key', async () => {
    api.createPay03bDealerCheckout
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ subscriptionId: 's', checkoutId: 'sim_cs_9', checkoutUrl: 'http://127.0.0.1:5017/x', checkoutStatus: 'open', idempotentReplay: true, gateway: 'g', simulated: true, amountMinor: 3000, currency: 'JPY', live: false })
    renderPage()
    fireEvent.click(await screen.findByTestId('pay03b-subscribe-dealer_sandbox_std'))
    fireEvent.click(await screen.findByTestId('pay03b-terms-confirm'))
    expect((await screen.findByTestId('pay03b-terms-error')).textContent).toContain('Failed to fetch')
    await new Promise((r) => setTimeout(r, 50))
    expect(api.createPay03bDealerCheckout).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('pay03b-terms-confirm').textContent).toContain('Try again')

    fireEvent.click(screen.getByTestId('pay03b-terms-confirm'))
    await waitFor(() => expect(api.createPay03bDealerCheckout).toHaveBeenCalledTimes(2))
    await screen.findByTestId('pay03b-terms-error')

    // Close and re-open the same plan's review: the earlier attempt may have reached the server.
    fireEvent.click(screen.getByTestId('pay03b-terms-cancel'))
    await waitFor(() => expect(screen.queryByTestId('pay03b-terms-dialog')).toBeNull())
    fireEvent.click(screen.getByTestId('pay03b-subscribe-dealer_sandbox_std'))
    fireEvent.click(await screen.findByTestId('pay03b-terms-confirm'))
    await waitFor(() => expect(redirect).toHaveBeenCalledWith('http://127.0.0.1:5017/x'))

    const keys = api.createPay03bDealerCheckout.mock.calls.map((call) => call[1])
    expect(keys).toHaveLength(3)
    expect(new Set(keys).size).toBe(1)
  })

  it('changed terms reload the plans, close the review and explain why', async () => {
    api.createPay03bDealerCheckout.mockRejectedValue(apiError(409, 'PAY03B_TERMS_CHANGED'))
    renderPage()
    fireEvent.click(await screen.findByTestId('pay03b-subscribe-dealer_sandbox_std'))
    const before = api.fetchPay03bDealerOverview.mock.calls.length
    fireEvent.click(await screen.findByTestId('pay03b-terms-confirm'))
    await waitFor(() => expect(screen.queryByTestId('pay03b-terms-dialog')).toBeNull())
    expect((await screen.findByTestId('pay03b-action-error')).textContent).toContain('The plan terms changed since you opened this review')
    await waitFor(() => expect(api.fetchPay03bDealerOverview.mock.calls.length).toBe(before + 1))
    expect(redirect).not.toHaveBeenCalled()
  })

  it('explains a billing-authority refusal inside the review', async () => {
    api.createPay03bDealerCheckout.mockRejectedValue(apiError(403, 'PAY03B_BILLING_AUTHORITY_REFUSED'))
    renderPage()
    fireEvent.click(await screen.findByTestId('pay03b-subscribe-dealer_sandbox_std'))
    fireEvent.click(await screen.findByTestId('pay03b-terms-confirm'))
    const error = await screen.findByTestId('pay03b-terms-error')
    expect(error.getAttribute('role')).toBe('alert')
    expect(error.textContent).toContain('Only a billing administrator of this organization can change billing.')
    expect(redirect).not.toHaveBeenCalled()
  })

  it('a live subscription hides "subscribe" (one live agreement per organization)', async () => {
    api.fetchPay03bDealerOverview.mockResolvedValue(activeOverview())
    renderPage()
    await screen.findByTestId('pay03b-plans')
    expect(screen.queryByTestId('pay03b-subscribe-dealer_sandbox_std')).toBeNull()
    expect(screen.queryByTestId('pay03b-subscribe-dealer_sandbox_prem')).toBeNull()
    expect(screen.getByTestId('pay03b-plan-current-dealer_sandbox_std')).toBeTruthy()
  })
})

describe('Plan & Billing — return from the provider', () => {
  it('verifies with the provider first and shows "confirmation pending" until the overview shows access', async () => {
    api.verifyPay03bDealerSubscription
      .mockResolvedValueOnce(overview({ subscription: { ...ACTIVE_SUB, status: 'incomplete', providerSubscriptionId: null }, entitlements: { ...NO_ACCESS, reason: 'status_incomplete' } }))
      .mockResolvedValueOnce(overview({ subscription: { ...ACTIVE_SUB, status: 'incomplete', providerSubscriptionId: null }, entitlements: { ...NO_ACCESS, reason: 'status_incomplete' } }))
      .mockResolvedValue(activeOverview())
    renderPage('/dealer/subscription?pay03b=returned')

    const pending = await screen.findByTestId('pay03b-confirmation-pending')
    expect(pending.textContent).toContain('Payment confirmation pending')
    expect(pending.textContent).toContain('Returning from the provider is not proof of payment')
    expect(screen.getByTestId('pay03b-access-value').textContent).toBe('No paid access')
    expect(api.fetchPay03bDealerOverview).not.toHaveBeenCalled()
    expect(screen.queryByTestId('pay03b-confirmation-confirmed')).toBeNull()

    fireEvent.click(screen.getByTestId('pay03b-verify'))
    const confirmed = await screen.findByTestId('pay03b-confirmation-confirmed')
    expect(confirmed.textContent).toContain('CarUp confirmed a paid period with the provider')
    expect(screen.queryByTestId('pay03b-confirmation-pending')).toBeNull()
    expect(screen.getByTestId('pay03b-access-value').textContent).toBe('Active')
  })

  it('if the provider re-check fails, shows the recorded state and keeps confirmation pending', async () => {
    api.verifyPay03bDealerSubscription.mockRejectedValue(apiError(503, 'PAY03B_SUBSCRIPTION_PROVIDER_UNAVAILABLE'))
    renderPage('/dealer/subscription?pay03b=returned')
    const pending = await screen.findByTestId('pay03b-confirmation-pending')
    expect(within(pending).getByTestId('pay03b-verify-error').textContent).toContain('The payment provider did not respond')
    expect(api.fetchPay03bDealerOverview).toHaveBeenCalled()
    expect(screen.getByTestId('pay03b-plans')).toBeTruthy()
  })

  it('a cancelled checkout return reads (does not verify) and says no payment was recorded', async () => {
    renderPage('/dealer/subscription?pay03b=cancelled')
    expect((await screen.findByTestId('pay03b-checkout-cancelled')).textContent).toContain('CarUp has not recorded a payment')
    await screen.findByTestId('pay03b-plans')
    expect(api.verifyPay03bDealerSubscription).not.toHaveBeenCalled()
  })
})

describe('Plan & Billing — live subscription', () => {
  it('shows paid-through, renewal and capacity, and cancels at period end with an idempotency key', async () => {
    api.fetchPay03bDealerOverview.mockResolvedValue(activeOverview({ enforcementActive: true }))
    api.cancelPay03bDealerSubscription.mockResolvedValue({
      requestId: 'req-1', status: 'provider_confirmed',
      overview: activeOverview({ subscription: { ...ACTIVE_SUB, cancelAtPeriodEnd: true } }),
    })
    renderPage()
    await screen.findByTestId('pay03b-subscription-actions')
    expect(screen.getByTestId('pay03b-access-value').textContent).toBe('Active')
    expect(screen.getByTestId('pay03b-paid-through-value').textContent).toContain('2026')
    expect(screen.getByTestId('pay03b-renewal').textContent).toContain('Next renewal (provider schedule)')
    expect(screen.getByTestId('pay03b-capacity-value').textContent).toBe('Up to 10 published listings')
    expect(screen.getByTestId('pay03b-capacity').textContent).toContain('Enforced')
    expect(screen.queryByTestId('pay03b-cancel-immediate')).toBeNull()
    expect(screen.queryByTestId('pay03b-resume')).toBeNull()

    fireEvent.click(screen.getByTestId('pay03b-cancel-period-end'))
    const dialog = await screen.findByTestId('pay03b-confirm-dialog')
    expect(within(dialog).getByTestId('pay03b-confirm-body').textContent).toContain('Paid access continues until')
    fireEvent.change(within(dialog).getByTestId('pay03b-cancel-reason'), { target: { value: 'Seasonal closure' } })
    fireEvent.click(within(dialog).getByTestId('pay03b-confirm-action'))

    expect((await screen.findByTestId('pay03b-action-status')).textContent).toContain('Renewal cancelled. Paid access continues until')
    const [body, key] = api.cancelPay03bDealerSubscription.mock.calls[0]
    expect(body).toEqual({ mode: 'period_end', reason: 'Seasonal closure' })
    expect(key).toMatch(KEY_PATTERN)
    expect(screen.getByTestId('pay03b-resume')).toBeTruthy()
    expect(screen.queryByTestId('pay03b-cancel-period-end')).toBeNull()
    expect(screen.getByTestId('pay03b-renewal').textContent).toContain('Renewal cancelled')
  })

  it('resume states the renewal charge; a later, separate cancel gets a FRESH key (a completed key would be replayed as a no-op)', async () => {
    const cancelled = activeOverview({ subscription: { ...ACTIVE_SUB, cancelAtPeriodEnd: true } })
    api.fetchPay03bDealerOverview.mockResolvedValue(activeOverview())
    api.cancelPay03bDealerSubscription
      .mockResolvedValueOnce({ requestId: 'req-a', status: 'provider_confirmed', overview: cancelled })
      .mockResolvedValueOnce({ requestId: 'req-b', status: 'provider_confirmed', overview: activeOverview() })
      .mockResolvedValueOnce({ requestId: 'req-c', status: 'provider_confirmed', overview: cancelled })
    renderPage()

    fireEvent.click(await screen.findByTestId('pay03b-cancel-period-end'))
    fireEvent.click(await screen.findByTestId('pay03b-confirm-action'))
    fireEvent.click(await screen.findByTestId('pay03b-resume'))
    expect((await screen.findByTestId('pay03b-confirm-body')).textContent).toContain('the provider will charge ¥3,000 per month')
    fireEvent.click(screen.getByTestId('pay03b-confirm-action'))
    expect((await screen.findByTestId('pay03b-action-status')).textContent).toContain('Renewal resumed')
    fireEvent.click(await screen.findByTestId('pay03b-cancel-period-end'))
    fireEvent.click(await screen.findByTestId('pay03b-confirm-action'))
    await screen.findByTestId('pay03b-resume')

    const calls = api.cancelPay03bDealerSubscription.mock.calls
    expect(calls.map((call) => call[0].mode)).toEqual(['period_end', 'resume', 'period_end'])
    expect(calls[1][0]).toEqual({ mode: 'resume', reason: null })
    for (const call of calls) expect(call[1]).toMatch(KEY_PATTERN)
    expect(calls[2][1]).not.toBe(calls[0][1])
  })

  it('offers immediate cancellation only when the current plan’s terms allow it, and says access ends', async () => {
    api.fetchPay03bDealerOverview.mockResolvedValue(activeOverview({
      subscription: { ...ACTIVE_SUB, planId: 'plan-prem', planCode: 'dealer_sandbox_prem', paidPlanId: 'plan-prem', paidPlanCode: 'dealer_sandbox_prem' },
    }))
    renderPage()
    fireEvent.click(await screen.findByTestId('pay03b-cancel-immediate'))
    expect((await screen.findByTestId('pay03b-confirm-body')).textContent).toContain('Access to paid features ends immediately')
  })

  it('explains an unconfigured payment-method update honestly and does not navigate', async () => {
    api.fetchPay03bDealerOverview.mockResolvedValue(activeOverview())
    api.createPay03bPaymentMethodUpdate.mockRejectedValue(apiError(503, 'PAY03B_PAYMENT_METHOD_UPDATE_NOT_CONFIGURED'))
    renderPage()
    fireEvent.click(await screen.findByTestId('pay03b-update-payment-method'))
    const error = await screen.findByTestId('pay03b-action-error')
    expect(error.getAttribute('role')).toBe('alert')
    expect(error.textContent).toContain('Updating the payment method is not configured for this provider in this environment.')
    expect(redirect).not.toHaveBeenCalled()
  })

  it('previews a plan change with the provider, then confirms the chosen mode with a key', async () => {
    api.fetchPay03bDealerOverview.mockResolvedValue(activeOverview())
    api.previewPay03bPlanChange.mockImplementation(async (_target: string, mode: string) => ({
      mode, targetPlanCode: 'dealer_sandbox_prem', chargeNowMinor: mode === 'immediate' ? 1500 : 0, currency: 'JPY',
      effectiveFrom: mode === 'immediate' ? 'on_successful_payment' : '2026-12-01T00:00:00.000Z',
      lines: [], providerBacked: true, simulated: true,
    }))
    api.changePay03bDealerPlan.mockResolvedValue({ requestId: 'req-3', status: 'provider_confirmed', overview: activeOverview() })
    renderPage()
    await screen.findByTestId('pay03b-plans')
    expect(screen.queryByTestId('pay03b-change-plan-dealer_storefront_package')).toBeNull()
    fireEvent.click(screen.getByTestId('pay03b-change-plan-dealer_sandbox_prem'))

    await screen.findByTestId('pay03b-change-dialog')
    expect((await screen.findByTestId('pay03b-change-charge-now')).textContent).toBe('¥0')
    expect(api.previewPay03bPlanChange).toHaveBeenLastCalledWith('plan-prem', 'period_end')

    fireEvent.click(screen.getByTestId('pay03b-change-mode-immediate'))
    await waitFor(() => expect(screen.getByTestId('pay03b-change-charge-now').textContent).toBe('¥1,500'))
    expect(api.previewPay03bPlanChange).toHaveBeenLastCalledWith('plan-prem', 'immediate')
    expect(screen.getByTestId('pay03b-change-effective').textContent).toContain('After the prorated invoice is paid')

    fireEvent.click(screen.getByTestId('pay03b-change-confirm'))
    expect((await screen.findByTestId('pay03b-action-status')).textContent).toContain('Plan change confirmed by the provider')
    const [body, key] = api.changePay03bDealerPlan.mock.calls[0]
    expect(body).toEqual({ targetPlanId: 'plan-prem', mode: 'immediate' })
    expect(key).toMatch(KEY_PATTERN)
  })

  it('when the current plan version is no longer listed, no plan change or immediate cancel is offered (terms unknown)', async () => {
    api.fetchPay03bDealerOverview.mockResolvedValue(activeOverview({
      subscription: { ...ACTIVE_SUB, planId: 'plan-std-retired-v0' },
    }))
    renderPage()
    await screen.findByTestId('pay03b-subscription-actions')
    expect(screen.queryByTestId('pay03b-change-plan-dealer_sandbox_prem')).toBeNull()
    expect(screen.queryByTestId('pay03b-change-not-allowed-dealer_sandbox_prem')).toBeNull()
    expect(screen.queryByTestId('pay03b-cancel-immediate')).toBeNull()
    expect(screen.getByTestId('pay03b-cancel-period-end')).toBeTruthy()
  })

  it('a failed preview blocks confirmation (the charge must be seen first)', async () => {
    api.fetchPay03bDealerOverview.mockResolvedValue(activeOverview())
    api.previewPay03bPlanChange.mockRejectedValue(apiError(503, 'PAY03B_PREVIEW_PROVIDER_UNAVAILABLE'))
    renderPage()
    fireEvent.click(await screen.findByTestId('pay03b-change-plan-dealer_sandbox_prem'))
    expect((await screen.findByTestId('pay03b-change-preview-error')).textContent).toContain('Nothing was changed')
    expect((screen.getByTestId('pay03b-change-confirm') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('Plan & Billing — invoices and notices', () => {
  it('shows the provider invoice and CarUp payment record separately, and pays an open invoice via the provider', async () => {
    api.fetchPay03bDealerOverview.mockResolvedValue(activeOverview({
      subscription: { ...ACTIVE_SUB, status: 'past_due', graceUntil: '2026-12-04T00:00:00.000Z' },
      entitlements: { ...ACTIVE_ACCESS, reason: 'approved_grace_period', status: 'past_due', graceUntil: '2026-12-04T00:00:00.000Z' },
      invoices: [OPEN_INVOICE, PAID_INVOICE],
    }))
    api.getPay03bInvoicePaymentLink.mockResolvedValue({ url: 'http://127.0.0.1:5017/api/pay03b/simulator/invoice/sim_in_open2' })
    renderPage()

    expect((await screen.findByTestId('pay03b-grace-notice')).textContent).toContain('approved grace period')
    const paid = screen.getByTestId('pay03b-invoice-sim_in_paid1')
    expect(paid.textContent).toContain('¥3,000')
    expect(within(paid).getByTestId('pay03b-invoice-payment-sim_in_paid1').textContent).toBe('Payment confirmed')
    expect(within(paid).queryByTestId('pay03b-pay-invoice-sim_in_paid1')).toBeNull()

    const open = screen.getByTestId('pay03b-invoice-sim_in_open2')
    expect(open.textContent).toContain('Open — awaiting payment')
    expect(within(open).getByTestId('pay03b-invoice-payment-sim_in_open2').textContent).toBe('No payment recorded')
    fireEvent.click(within(open).getByTestId('pay03b-pay-invoice-sim_in_open2'))
    await waitFor(() => expect(redirect).toHaveBeenCalledWith('http://127.0.0.1:5017/api/pay03b/simulator/invoice/sim_in_open2'))
    expect(api.getPay03bInvoicePaymentLink).toHaveBeenCalledWith('inv-2')
  })

  it('a reconciliation hold suspends paid features and says so', async () => {
    api.fetchPay03bDealerOverview.mockResolvedValue(activeOverview({
      entitlements: { ...ACTIVE_ACCESS, access: false, reason: 'payment_reconciliation_hold', effective: { [CAPACITY]: null } },
    }))
    renderPage()
    expect((await screen.findByTestId('pay03b-hold-notice')).textContent).toContain(
      'A payment on this subscription is under reconciliation; paid features are suspended until it is resolved',
    )
    expect(screen.getByTestId('pay03b-access-value').textContent).toBe('No paid access')
  })

  it('an administrator suspension and a scheduled plan change are explained', async () => {
    api.fetchPay03bDealerOverview.mockResolvedValue(activeOverview({
      subscription: {
        ...ACTIVE_SUB, status: 'suspended', suspendedReason: 'admin_suspension', scheduledPlanChange: true,
        planId: 'plan-prem', planCode: 'dealer_sandbox_prem', paidPlanCode: 'dealer_sandbox_std',
      },
      entitlements: { ...ACTIVE_ACCESS, access: false, reason: 'admin_suspension' },
    }))
    renderPage()
    expect((await screen.findByTestId('pay03b-suspension-notice')).textContent).toContain('Suspended by a CarUp administrator')
    const scheduled = screen.getByTestId('pay03b-scheduled-change')
    expect(scheduled.textContent).toContain('Sandbox Standard')
    expect(scheduled.textContent).toContain('Sandbox Premium applies from the next billing period')
  })

  it('an unfinished checkout is explained, with a way to check the payment status', async () => {
    api.fetchPay03bDealerOverview.mockResolvedValue(overview({
      subscription: { ...ACTIVE_SUB, status: 'incomplete', providerSubscriptionId: null },
      entitlements: { ...NO_ACCESS, reason: 'status_incomplete' },
    }))
    renderPage()
    const notice = await screen.findByTestId('pay03b-incomplete-notice')
    expect(notice.textContent).toContain('CarUp has not confirmed a payment')
    expect(screen.queryByTestId('pay03b-subscribe-dealer_sandbox_std')).toBeNull()
    expect(screen.queryByTestId('pay03b-subscription-actions')).toBeNull()
    fireEvent.click(within(notice).getByTestId('pay03b-verify'))
    await waitFor(() => expect(api.verifyPay03bDealerSubscription).toHaveBeenCalledTimes(1))
  })

  it('a billing administrator can resume the unfinished checkout (re-review the same plan) or abandon it after confirming', async () => {
    const incomplete = overview({
      subscription: { ...ACTIVE_SUB, status: 'incomplete', providerSubscriptionId: null },
      entitlements: { ...NO_ACCESS, reason: 'status_incomplete' },
    })
    api.fetchPay03bDealerOverview.mockResolvedValue(incomplete)
    api.abandonPay03bDealerCheckout.mockResolvedValue(overview({ subscription: null, history: [{ ...ACTIVE_SUB, status: 'incomplete_expired' }] }))
    renderPage()
    const notice = await screen.findByTestId('pay03b-incomplete-notice')
    fireEvent.click(within(notice).getByTestId('pay03b-resume-checkout'))
    const dialog = await screen.findByTestId('pay03b-terms-dialog')
    expect(dialog.textContent).toContain('Sandbox Standard')
    fireEvent.click(within(dialog).getByTestId('pay03b-terms-cancel'))
    fireEvent.click(within(notice).getByTestId('pay03b-abandon-checkout'))
    expect(api.abandonPay03bDealerCheckout).not.toHaveBeenCalled()
    fireEvent.click(await within(notice).findByTestId('pay03b-abandon-confirm'))
    await waitFor(() => expect(api.abandonPay03bDealerCheckout).toHaveBeenCalledTimes(1))
    expect((await screen.findByTestId('pay03b-action-status')).textContent).toContain('abandoned')
  })

  it('staff without billing authority see the unfinished checkout but cannot resume or abandon it', async () => {
    api.fetchPay03bDealerOverview.mockResolvedValue(overview({
      billingAuthority: false, tenantRole: 'dealer',
      subscription: { ...ACTIVE_SUB, status: 'incomplete', providerSubscriptionId: null },
      entitlements: { ...NO_ACCESS, reason: 'status_incomplete' },
    }))
    renderPage()
    const notice = await screen.findByTestId('pay03b-incomplete-notice')
    expect(within(notice).queryByTestId('pay03b-resume-checkout')).toBeNull()
    expect(within(notice).queryByTestId('pay03b-abandon-checkout')).toBeNull()
  })
})
