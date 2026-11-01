// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Pay02CommercialFoundation from './Pay02CommercialFoundation'

const mockApiRequest = vi.fn()
let mockAuthUser = { id: 'admin-user-1', role: 'admin' }

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: mockAuthUser,
    token: 'session-token-admin-1',
  }),
}))

vi.mock('@/lib/apiClient', () => ({
  resolveApiBaseUrl: () => 'http://127.0.0.1:4000/api',
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}))

const SAMPLE_CATALOGUE = {
  summary: {
    totalProducts: 66,
    filteredCount: 2,
    byCategory: {
      category_a_first_party: 23,
      category_b_third_party: 32,
      category_c_corporate_treasury: 11,
    },
    byActivationState: {
      draft: 15,
      blocked: 49,
      provider_eligible: 1,
      sandbox_certified: 1,
    },
    liveActiveCount: 0,
    pilotCandidateCode: 'intel.report.vehicle_history_single',
    persistenceStatus: 'database_reconciled',
    persistedDatabaseCount: 66,
  },
  providers: [
    {
      providerKey: 'stripe_carup_japan_sandbox',
      providerClass: 'direct_merchant_gateway',
      displayName: 'Stripe Japan (CarUp Sandbox Direct Merchant)',
      accountId: 'acct_1UVnGaEjgXqvlsJk',
      merchantIdentity: 'carup_japan',
      supportedCountries: ['JP'],
      supportedCurrencies: ['JPY'],
      callableInTest: true,
      liveAuthorized: false,
    },
    {
      providerKey: 'paynow_zimbabwe',
      providerClass: 'local_collection_candidate',
      displayName: 'Paynow Zimbabwe (Candidate — Merchant Authority Pending)',
      accountId: null,
      merchantIdentity: 'carup_zimbabwe_pending',
      supportedCountries: ['ZW'],
      supportedCurrencies: ['USD', 'ZWG'],
      callableInTest: false,
      liveAuthorized: false,
      blockedReason: 'PAY02_PROVIDER_MERCHANT_AUTHORITY_PENDING',
    },
  ],
  products: [
    {
      productCode: 'intel.report.vehicle_history_single',
      version: 1,
      family: 'intelligence',
      title: 'CarUp Canonical Vehicle History & Provenance Report (Single VIN)',
      commercialEvent: 'buyer_vehicle_history_report_purchase',
      commercialCategory: 'category_a_first_party',
      owningSubsystem: 'vehicle_history_reports',
      sourceObjectType: 'vehicles',
      payerRole: 'buyer',
      contractualSeller: 'carup_japan',
      legalBeneficiary: 'carup_japan',
      merchantOfRecord: 'carup_japan',
      fundsOwner: 'carup_japan',
      revenueBeneficiary: 'carup_japan',
      jurisdiction: 'JP',
      permittedCurrencies: ['JPY'],
      priceAuthorityType: 'fixed_catalogue',
      approvedAmountMinor: 100,
      approvedCurrency: 'JPY',
      currencyScale: 0,
      eligibleProviders: ['stripe_carup_japan_sandbox'],
      prohibitedProviders: ['garage_recorded_external'],
      fulfillmentContract: 'pay02_grant_vehicle_report_entitlement',
      mobileChannelPolicy: 'digital_web_only_until_iap',
      checkoutProhibited: false,
      activationState: 'provider_eligible',
      certificationState: 'SANDBOX READY',
      blockerClass: 'COMMERCIAL',
      blockerReason: 'Selected PAY-02-PILOT candidate; commercial retail price awaits Owner approval.',
      implementationOwner: 'PAY-02',
      priority: 'P0',
      persistenceOrigin: 'database_reconciled',
      validation: { valid: true, errors: [] },
    },
    {
      productCode: 'sub.diaspora.buyer_pro',
      version: 1,
      family: 'subscriptions',
      title: 'Diaspora Buyer Plan Subscription',
      commercialEvent: 'diaspora_buyer_subscription_renewal',
      commercialCategory: 'category_a_first_party',
      owningSubsystem: 'diaspora_billing',
      sourceObjectType: 'diaspora_subscriptions',
      payerRole: 'diaspora_buyer',
      contractualSeller: 'carup',
      legalBeneficiary: 'carup',
      merchantOfRecord: 'carup_japan',
      fundsOwner: 'carup',
      revenueBeneficiary: 'carup',
      jurisdiction: 'JP',
      permittedCurrencies: ['JPY', 'USD'],
      priceAuthorityType: 'unapproved_missing',
      approvedAmountMinor: null,
      approvedCurrency: null,
      currencyScale: 0,
      eligibleProviders: [],
      prohibitedProviders: ['garage_recorded_external'],
      fulfillmentContract: 'syncSubscriptionFromSnapshot',
      mobileChannelPolicy: 'digital_web_only_until_iap',
      checkoutProhibited: false,
      activationState: 'draft',
      certificationState: 'COMMERCIAL TERMS MISSING',
      blockerClass: 'COMMERCIAL',
      blockerReason: 'Recurring tariff awaits Owner approval.',
      implementationOwner: 'PAY-03',
      priority: 'P1',
      persistenceOrigin: 'database_reconciled',
      validation: { valid: true, errors: [] },
    },
  ],
}

describe('Pay02CommercialFoundation admin console', () => {
  beforeEach(() => {
    mockApiRequest.mockReset()
    mockAuthUser = { id: 'admin-user-1', role: 'admin' }
    mockApiRequest.mockImplementation(({ path }: { path?: string } = {}) => {
      if (path === '/pay03a/admin/orders') {
        return Promise.resolve({ orders: [] })
      }
      return Promise.resolve(SAMPLE_CATALOGUE)
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the 66-item commercial catalogue summary, zero live active count, authority surfaces, provider profiles, and products', async () => {
    mockApiRequest.mockResolvedValueOnce(SAMPLE_CATALOGUE)
    render(
      <MemoryRouter>
        <Pay02CommercialFoundation />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('pay02-summary-cards')).toBeTruthy()
    })
    expect(screen.getByTestId('pay02-live-active-count').textContent).toBe('0')
    expect(screen.getByTestId('pay02-authority-badge').textContent).toContain(
      'Persisted Commercial Authority (66 DB rows)',
    )
    expect(screen.getByTestId('pay02-authority-surfaces')).toBeTruthy()
    expect(screen.getByTestId('pay02-provider-stripe_carup_japan_sandbox')).toBeTruthy()
    expect(screen.getByTestId('pay02-provider-paynow_zimbabwe')).toBeTruthy()
    expect(screen.getByTestId('pay02-product-intel.report.vehicle_history_single')).toBeTruthy()
    expect(screen.getByTestId('pay02-product-sub.diaspora.buyer_pro')).toBeTruthy()
  })

  it('submits a governed architecture review proposal and surfaces persisted DB status without auto-activating the product', async () => {
    mockApiRequest.mockImplementation(({ path }: { path?: string } = {}) => {
      if (path === '/pay03a/admin/orders') return Promise.resolve({ orders: [] })
      if (path === '/pay02/admin/proposals') {
        return Promise.resolve({
          proposal: {
            id: 'prop-db-uuid-01',
            product_code: 'sub.diaspora.buyer_pro',
            proposed_state: 'reviewed',
            status: 'pending_review',
            proposer_id: 'admin-user-1',
          },
        })
      }
      return Promise.resolve(SAMPLE_CATALOGUE)
    })

    render(
      <MemoryRouter>
        <Pay02CommercialFoundation />
      </MemoryRouter>,
    )

    const proposeBtn = await screen.findByTestId('pay02-propose-sub.diaspora.buyer_pro')
    fireEvent.click(proposeBtn)

    await waitFor(() => {
      expect(screen.getByTestId('pay02-proposal-status').textContent).toContain(
        'Persisted DB proposal prop-db-uuid-01 recorded (pending_review)',
      )
    })
  })

  it('surfaces an explicit error alert and never fabricates success when proposal persistence fails', async () => {
    mockApiRequest.mockImplementation(({ path }: { path?: string } = {}) => {
      if (path === '/pay03a/admin/orders') return Promise.resolve({ orders: [] })
      if (path === '/pay02/admin/proposals') {
        return Promise.reject(new Error('PAY02_PROPOSAL_PERSISTENCE_UNAVAILABLE'))
      }
      return Promise.resolve(SAMPLE_CATALOGUE)
    })

    render(
      <MemoryRouter>
        <Pay02CommercialFoundation />
      </MemoryRouter>,
    )

    const proposeBtn = await screen.findByTestId('pay02-propose-sub.diaspora.buyer_pro')
    fireEvent.click(proposeBtn)

    await waitFor(() => {
      expect(screen.getByTestId('pay02-error-alert').textContent).toContain(
        'PAY02_PROPOSAL_PERSISTENCE_UNAVAILABLE',
      )
    })
    expect(screen.queryByTestId('pay02-proposal-status')).toBeNull()
  })

  it('supports inspecting version history and reviewing a proposal with a distinct admin identity to advance persisted version', async () => {
    mockAuthUser = { id: 'admin-reviewer-2', role: 'admin' }
    let approved = false
    mockApiRequest.mockImplementation(({ path }: { path?: string } = {}) => {
      if (path === '/pay03a/admin/orders') return Promise.resolve({ orders: [] })
      if (path === '/pay02/admin/catalogue/sub.diaspora.buyer_pro') {
        if (!approved) {
          return Promise.resolve({
            product: SAMPLE_CATALOGUE.products[1],
            persistenceStatus: 'database_reconciled',
            versions: [
              {
                version: 1,
                activation_state: 'draft',
                approved_currency: null,
                approved_amount_minor: null,
                approval_evidence_ref: 'ISSUE-247:INITIAL-SEED',
              },
            ],
            proposals: [
              {
                id: 'prop-db-uuid-02',
                product_code: 'sub.diaspora.buyer_pro',
                base_version: 1,
                proposed_state: 'reviewed',
                rationale: 'Architecture review complete',
                status: 'pending_review',
                proposer_id: 'admin-user-1',
              },
            ],
          })
        }
        return Promise.resolve({
          product: { ...SAMPLE_CATALOGUE.products[1], version: 2, activationState: 'reviewed' },
          persistenceStatus: 'database_reconciled',
          versions: [
            {
              version: 2,
              activation_state: 'reviewed',
              approved_currency: null,
              approved_amount_minor: null,
              approval_evidence_ref: 'ISSUE-247:SANDBOX-REVIEW-APPROVAL',
            },
            {
              version: 1,
              activation_state: 'draft',
              approved_currency: null,
              approved_amount_minor: null,
              approval_evidence_ref: 'ISSUE-247:INITIAL-SEED',
            },
          ],
          proposals: [
            {
              id: 'prop-db-uuid-02',
              product_code: 'sub.diaspora.buyer_pro',
              base_version: 1,
              proposed_state: 'reviewed',
              rationale: 'Architecture review complete',
              status: 'approved',
              proposer_id: 'admin-user-1',
              reviewer_id: 'admin-reviewer-2',
              effect_status: 'effective_in_sandbox_catalogue',
            },
          ],
        })
      }
      if (path?.includes('/pay02/admin/proposals/prop-db-uuid-02/review')) {
        approved = true
        return Promise.resolve({
          proposal: {
            id: 'prop-db-uuid-02',
            product_code: 'sub.diaspora.buyer_pro',
            proposed_state: 'reviewed',
            status: 'approved',
            proposer_id: 'admin-user-1',
            reviewer_id: 'admin-reviewer-2',
            effect_status: 'effective_in_sandbox_catalogue',
          },
          newVersion: {
            version: 2,
            activation_state: 'reviewed',
            approved_currency: null,
            approved_amount_minor: null,
            approval_evidence_ref: 'ISSUE-247:SANDBOX-REVIEW-APPROVAL',
          },
        })
      }
      return Promise.resolve(SAMPLE_CATALOGUE)
    })

    render(
      <MemoryRouter>
        <Pay02CommercialFoundation />
      </MemoryRouter>,
    )

    const historyBtn = await screen.findByTestId('pay02-history-sub.diaspora.buyer_pro')
    fireEvent.click(historyBtn)

    await waitFor(() => {
      expect(screen.getByTestId('pay02-version-history-panel')).toBeTruthy()
      expect(screen.getByTestId('pay02-version-row-1')).toBeTruthy()
      expect(screen.getByTestId('pay02-proposal-row-prop-db-uuid-02')).toBeTruthy()
    })

    const approveBtn = screen.getByTestId('pay02-approve-proposal-prop-db-uuid-02')
    fireEvent.click(approveBtn)

    await waitFor(() => {
      expect(screen.getByTestId('pay02-proposal-status').textContent).toContain(
        'Persisted product version advanced to v2 (reviewed)',
      )
      expect(screen.getByTestId('pay02-version-row-2')).toBeTruthy()
    })
  })

  it('clearly distinguishes Authoritative Database Reconciliation from Test Simulation output', async () => {
    mockApiRequest.mockImplementation(({ path }: { path?: string } = {}) => {
      if (path === '/pay03a/admin/orders') return Promise.resolve({ orders: [] })
      if (path?.startsWith('/pay02/admin/reporting/reconcile')) {
        return Promise.resolve({
          report: {
            authorityMode: 'authoritative_database_reconciliation',
            authorityBanner: 'AUTHORITATIVE DATABASE RECONCILIATION — POSTGRESQL',
            currency: 'JPY',
            grossAuthorizedMinor: 200,
            providerCapturedMinor: 200,
            providerSettledMinor: 0,
            bankSettledMinor: 0,
            refundedMinor: 0,
            disputedMinor: 0,
            carUpRecognizedRevenueMinor: 100,
            carUpDeferredCustomerLiabilityMinor: 100,
            thirdPartyBeneficiaryPayableMinor: 0,
            platformServiceFeeMinor: 0,
            unverifiedTaxTreatmentCount: 2,
            exceptionsCount: 0,
            reconciledClean: true,
            exceptions: [],
          },
        })
      }
      if (path === '/pay02/admin/reporting/simulate') {
        return Promise.resolve({
          report: {
            authorityMode: 'simulation',
            authorityBanner: 'SIMULATED INPUT — NOT AUTHORITATIVE FINANCIAL REPORTING',
            currency: 'JPY',
            grossAuthorizedMinor: 0,
            providerCapturedMinor: 0,
            providerSettledMinor: 0,
            bankSettledMinor: 0,
            refundedMinor: 0,
            disputedMinor: 0,
            carUpRecognizedRevenueMinor: 0,
            carUpDeferredCustomerLiabilityMinor: 0,
            thirdPartyBeneficiaryPayableMinor: 0,
            platformServiceFeeMinor: 0,
            unverifiedTaxTreatmentCount: 0,
            exceptionsCount: 0,
            reconciledClean: true,
            exceptions: [],
          },
        })
      }
      return Promise.resolve(SAMPLE_CATALOGUE)
    })

    render(
      <MemoryRouter>
        <Pay02CommercialFoundation />
      </MemoryRouter>,
    )

    const reconcileBtn = await screen.findByTestId('pay02-run-authoritative-reconcile')
    fireEvent.click(reconcileBtn)

    await waitFor(() => {
      expect(screen.getByTestId('pay02-reconciliation-mode-badge').textContent).toBe(
        'AUTHORITATIVE DATABASE RECONCILIATION — POSTGRESQL',
      )
    })

    const simBtn = screen.getByTestId('pay02-run-simulation')
    fireEvent.click(simBtn)

    await waitFor(() => {
      expect(screen.getByTestId('pay02-reconciliation-mode-badge').textContent).toBe(
        'SIMULATED INPUT — NOT AUTHORITATIVE FINANCIAL REPORTING',
      )
    })
  })

  it('lists PAY-03A Vehicle History Report orders and executes governed admin refunds', async () => {
    let refunded = false
    mockApiRequest.mockImplementation(({ path }: { path?: string } = {}) => {
      if (path === '/pay03a/admin/orders') {
        return Promise.resolve({
          orders: [
            {
              orderId: 'ord-03a-admin-1',
              productCode: 'intel.report.vehicle_history_single',
              productVersion: 1,
              buyerId: 'buyer-03a-1',
              vin: 'WBA3A5C51DF358101',
              quoteId: 'quote-03a-1',
              quoteNumber: 'QT-PAY02-03A0000000000001',
              quoteStatus: refunded ? 'refunded' : 'fulfilled',
              paymentReference: 'pay01a_03a_admin_ref_1',
              paymentStatus: refunded ? 'refunded' : 'paid',
              amountMinor: 100,
              currency: 'JPY',
              entitlementStatus: refunded ? 'revoked_refunded' : 'entitled',
              reportAvailable: !refunded,
              reportVersionId: 'rep-ver-03a-1',
              reportVersionNumber: 1,
              reportContentHash: 'sha256_hash_1',
              refundId: refunded ? 're_test_03a_1' : null,
            },
          ],
        })
      }
      if (path === '/pay03a/admin/orders/ord-03a-admin-1/refund') {
        refunded = true
        return Promise.resolve({
          orderId: 'ord-03a-admin-1',
          vin: 'WBA3A5C51DF358101',
          paymentStatus: 'refunded',
          entitlementStatus: 'revoked_refunded',
        })
      }
      return Promise.resolve(SAMPLE_CATALOGUE)
    })

    render(
      <MemoryRouter>
        <Pay02CommercialFoundation />
      </MemoryRouter>,
    )

    const orderRow = await screen.findByTestId('pay03a-admin-order-ord-03a-admin-1')
    expect(orderRow.textContent).toContain('WBA3A5C51DF358101')

    const refundBtn = screen.getByTestId('pay03a-admin-refund-ord-03a-admin-1')
    fireEvent.click(refundBtn)

    await waitFor(() => {
      expect(screen.getByTestId('pay02-proposal-status').textContent).toContain(
        'revoked_refunded',
      )
    })
  })

  it('never presents a failed PAY-03A order read as an empty order book (STG01-FINAL D-UI-1)', async () => {
    mockApiRequest.mockImplementation(({ path }: { path?: string } = {}) => {
      if (path === '/pay03a/admin/orders') {
        return Promise.reject(new Error('PAY03A_ADMIN_ORDER_READ_UNAVAILABLE'))
      }
      return Promise.resolve(SAMPLE_CATALOGUE)
    })
    render(
      <MemoryRouter>
        <Pay02CommercialFoundation />
      </MemoryRouter>,
    )
    const alert = await screen.findByTestId('pay03a-admin-orders-error')
    expect(alert.getAttribute('role')).toBe('alert')
    expect(alert.textContent).toContain('PAY03A_ADMIN_ORDER_READ_UNAVAILABLE')
    expect(alert.textContent).toContain('not an empty order book')
    expect(screen.queryByTestId('pay03a-admin-empty-orders')).toBeNull()
  })

  it('keeps previously loaded PAY-03A orders visible but flags them as possibly stale when a refresh fails (STG01-FINAL D-UI-1)', async () => {
    let failReads = false
    mockApiRequest.mockImplementation(({ path }: { path?: string } = {}) => {
      if (path === '/pay03a/admin/orders') {
        if (failReads) return Promise.reject(new Error('PAY03A_ADMIN_ORDER_READ_UNAVAILABLE'))
        return Promise.resolve({
          orders: [
            {
              orderId: 'ord-03a-stale-1',
              productCode: 'intel.report.vehicle_history_single',
              buyerId: 'buyer-03a-1',
              vin: 'WBA3A5C51DF358101',
              paymentReference: 'pay01a_03a_stale_ref_1',
              paymentStatus: 'paid',
              amountMinor: 100,
              currency: 'JPY',
              entitlementStatus: 'entitled',
              reportAvailable: true,
              reportVersionId: 'rep-ver-stale-1',
              reportVersionNumber: 1,
            },
          ],
        })
      }
      return Promise.resolve(SAMPLE_CATALOGUE)
    })
    render(
      <MemoryRouter>
        <Pay02CommercialFoundation />
      </MemoryRouter>,
    )
    await screen.findByTestId('pay03a-admin-order-ord-03a-stale-1')
    failReads = true
    fireEvent.click(screen.getByTestId('pay03a-admin-refresh-orders'))
    const alert = await screen.findByTestId('pay03a-admin-orders-error')
    expect(alert.textContent).toContain('may be stale')
    expect(screen.getByTestId('pay03a-admin-order-ord-03a-stale-1')).toBeTruthy()
  })

  it('remains usable and accessible across desktop (1280px), tablet (768px), and narrow mobile (375px) viewports', async () => {
    for (const width of [1280, 768, 375]) {
      window.innerWidth = width
      window.dispatchEvent(new Event('resize'))
      mockApiRequest.mockResolvedValueOnce(SAMPLE_CATALOGUE)

      const { unmount } = render(
        <MemoryRouter>
          <Pay02CommercialFoundation />
        </MemoryRouter>,
      )

      await waitFor(() => {
        expect(screen.getByTestId('pay02-admin-console')).toBeTruthy()
        expect(screen.getByTestId('pay02-summary-cards')).toBeTruthy()
        expect(screen.getByLabelText('Filter by service family')).toBeTruthy()
        expect(screen.getByLabelText('Filter by commercial category')).toBeTruthy()
      })

      unmount()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// CARUP-PAY-03B — Business subscriptions, plan governance and F5 reconciliation exceptions
// ─────────────────────────────────────────────────────────────────────────────────────────────────

type MockCall = { path?: string; options?: RequestInit; authHeaders?: Record<string, string | undefined> }

const CAPACITY_KEY = 'dealer.inventory.published_listing_capacity'
const EXCEPTION_ID = '0f0e0d0c-0b0a-4908-8706-050403020100'
const IDEMPOTENCY_PATTERN = /^pay03b_[A-Za-z0-9_-]{9,89}$/

const OPEN_EXCEPTION = {
  id: EXCEPTION_ID,
  paymentReference: 'pay03b_inv_0001',
  exceptionType: 'refund_outside_carup',
  status: 'open',
  severity: 'high',
  gateway: 'pay03b_local_provider_simulator',
  paymentAmountMinor: 3000,
  currency: 'JPY',
  mismatch: 'partial_refund',
  detectedRefundedMinor: 1000,
  detectedPendingRefundMinor: 0,
  detectedRefundIds: ['sim_re_0001'],
  detectedVia: 'signed_webhook',
  firstDetectedAt: '2026-11-01T01:00:00.000Z',
  observationCount: 2,
  lastObservedStatus: 'partially_refunded',
  lastObservedRefundedMinor: 1000,
  acknowledgedBy: null,
  acknowledgedAt: null,
  resolution: null,
  resolvedBy: null,
  resolutionNote: null,
  resolvedAt: null,
}

const EXCEPTIONS = { exceptions: [OPEN_EXCEPTION], openCount: 1, sourceOfFinancialTruth: 'Money state: public.payment_transactions' }

const SUBSCRIPTION = {
  id: 'sub-1',
  subscriptionReference: 'pay03b_sub_0001',
  ownerTenantId: 'tenant-1',
  ownerOrganizationId: 'org-1',
  status: 'active',
  providerStatus: 'active',
  gateway: 'pay03b_local_provider_simulator',
  simulated: true,
  planId: 'plan-std',
  planCode: 'dealer_sandbox_std',
  paidPlanId: 'plan-std',
  paidPlanCode: 'dealer_sandbox_std',
  scheduledPlanChange: false,
  currentPeriodStart: '2026-11-01T00:00:00.000Z',
  currentPeriodEnd: '2026-12-01T00:00:00.000Z',
  paidThrough: '2026-12-01T00:00:00.000Z',
  graceUntil: null,
  cancelAtPeriodEnd: false,
  cancellationMode: null,
  canceledAt: null,
  endedAt: null,
  suspendedReason: null,
  providerSubscriptionId: 'sim_sub_0001',
}

const SUBSCRIPTIONS = {
  subscriptions: [{ ...SUBSCRIPTION, organizationName: 'Harare Premium Motors', access: true, accessReason: 'paid_period' }],
  sourceOfTruth: 'Money: public.payment_transactions (one canonical row per invoice).',
}

const PAID_INVOICE = {
  id: 'inv-1', providerInvoiceId: 'sim_in_0001', billingReason: 'subscription_create',
  periodStart: '2026-11-01T00:00:00.000Z', periodEnd: '2026-12-01T00:00:00.000Z', currency: 'JPY',
  amountDueMinor: 3000, amountPaidMinor: 3000, providerStatus: 'paid', anomaly: null, attemptCount: 1,
  paymentReference: 'pay03b_inv_0001', paymentStatus: 'paid',
}
const OPEN_INVOICE = {
  ...PAID_INVOICE, id: 'inv-2', providerInvoiceId: 'sim_in_0002', billingReason: 'subscription_cycle',
  periodStart: '2026-12-01T00:00:00.000Z', periodEnd: '2027-01-01T00:00:00.000Z', amountPaidMinor: 0,
  providerStatus: 'open', paymentReference: null, paymentStatus: null,
}

const DETAIL = {
  subscription: SUBSCRIPTION,
  invoices: [OPEN_INVOICE, PAID_INVOICE],
  transitions: [
    { id: 2, subscription_id: 'sub-1', from_status: 'incomplete', to_status: 'active', from_plan_id: 'plan-std', to_plan_id: 'plan-std', paid_through: '2026-12-01T00:00:00.000Z', cause: 'invoice_paid', actor_id: null, event_id: 'sim_evt_2', recorded_at: '2026-11-01T00:05:00.000Z' },
    { id: 1, subscription_id: 'sub-1', from_status: null, to_status: 'incomplete', from_plan_id: null, to_plan_id: 'plan-std', paid_through: null, cause: 'checkout_claimed', actor_id: 'dealer-user-1', event_id: null, recorded_at: '2026-11-01T00:00:00.000Z' },
  ],
  changeRequests: [
    { id: 'cr-1', subscription_id: 'sub-1', change_type: 'cancel_at_period_end', target_plan_id: null, invoice_id: null, requested_by: 'dealer-user-1', requested_role: 'admin', request_key: 'pay03b_key', reason: 'Seasonal closure', status: 'provider_confirmed', outcome_code: 'provider_accepted', requested_at: '2026-11-02T00:00:00.000Z', completed_at: '2026-11-02T00:00:01.000Z' },
  ],
  entitlements: {
    access: true, reason: 'paid_period', status: 'active', planCode: 'dealer_sandbox_std', paidThrough: '2026-12-01T00:00:00.000Z',
    graceUntil: null, baselineEntitlements: {}, subscriptionEntitlements: { [CAPACITY_KEY]: 10 }, effective: { [CAPACITY_KEY]: 10 },
  },
  sourceOfTruth: 'canonical',
}

const ADMIN_PLAN_BASE = {
  currencyScale: 0, billingInterval: 'month', intervalCount: 1, entitlements: {}, trialDays: null, graceDays: null,
  changePolicy: { upgrade: 'period_end', downgrade: 'period_end', proration: 'none' },
  cancellationPolicy: { period_end: true, immediate: false }, refundPolicy: 'governed_admin_refund', effectiveTo: null,
}
const ADMIN_CATALOGUE = {
  plans: [
    { ...ADMIN_PLAN_BASE, id: 'plan-gov', planCode: 'dealer_storefront_package', planVersion: 1, productCode: 'mkt.dealer.storefront_package', displayName: 'Dealership Verified Storefront & Inventory Package', tierRank: 10, pricingKind: 'unpriced', activationStatus: 'commercially_blocked', commercialStatus: 'not_available', amountMinor: null, currency: null, blockerClass: 'COMMERCIAL', blockerReason: 'No approved tariff, merchant of record or collection provider.', simulated: false, purchasable: false },
    { ...ADMIN_PLAN_BASE, id: 'plan-std', planCode: 'dealer_sandbox_std', planVersion: 2, productCode: 'mkt.dealer.storefront_package', displayName: 'Sandbox Standard', tierRank: 15, pricingKind: 'sandbox_fixture', activationStatus: 'sandbox_only', commercialStatus: 'sandbox_test_only_not_a_commercial_offer', amountMinor: 3000, currency: 'JPY', blockerClass: null, blockerReason: null, simulated: true, purchasable: true },
    { ...ADMIN_PLAN_BASE, id: 'plan-std-v1', planCode: 'dealer_sandbox_std', planVersion: 1, productCode: 'mkt.dealer.storefront_package', displayName: 'Sandbox Standard', tierRank: 15, pricingKind: 'sandbox_fixture', activationStatus: 'retired', commercialStatus: 'sandbox_test_only_not_a_commercial_offer', amountMinor: 2500, currency: 'JPY', blockerClass: null, blockerReason: null, simulated: true, purchasable: false, effectiveTo: '2026-10-31T00:00:00.000Z' },
    { ...ADMIN_PLAN_BASE, id: 'plan-free', planCode: 'diaspora_free', planVersion: 1, productCode: 'sub.diaspora.free', displayName: 'Diaspora Trade OS — Free Tier', tierRank: 0, pricingKind: 'free', activationStatus: 'approved', commercialStatus: 'free', amountMinor: null, currency: null, billingInterval: null, intervalCount: null, refundPolicy: 'no_charge_tier', blockerClass: null, blockerReason: null, simulated: false, purchasable: false },
  ],
  sourceOfTruth: 'canonical',
}

type Handler = [(path: string, call: MockCall) => boolean, (call: MockCall) => unknown]

/** Routes every console read; PAY-03B paths get documented fixtures unless a test overrides them. */
function routeConsole(handlers: Handler[] = []) {
  return (call: MockCall = {}) => {
    const path = call.path ?? ''
    for (const [match, respond] of handlers) {
      if (match(path, call)) return Promise.resolve().then(() => respond(call))
    }
    if (path === '/pay03a/admin/orders') return Promise.resolve({ orders: [] })
    if (path.startsWith('/pay03b/admin/reconciliation-exceptions?')) return Promise.resolve(EXCEPTIONS)
    if (path === '/pay03b/admin/subscriptions') return Promise.resolve(SUBSCRIPTIONS)
    if (path === '/pay03b/admin/catalogue') return Promise.resolve(ADMIN_CATALOGUE)
    if (path === '/pay03b/admin/subscriptions/sub-1') return Promise.resolve(DETAIL)
    return Promise.resolve(SAMPLE_CATALOGUE)
  }
}

const recordedCalls = (): MockCall[] => mockApiRequest.mock.calls.map((args) => (args[0] ?? {}) as MockCall)
const postsTo = (suffix: string) => recordedCalls().filter((c) => c.options?.method === 'POST' && (c.path ?? '').endsWith(suffix))

function renderConsole() {
  return render(
    <MemoryRouter>
      <Pay02CommercialFoundation />
    </MemoryRouter>,
  )
}

describe('Pay02CommercialFoundation — PAY-03B business subscriptions & F5 reconciliation', () => {
  beforeEach(() => {
    mockApiRequest.mockReset()
    mockAuthUser = { id: 'admin-user-1', role: 'admin' }
    mockApiRequest.mockImplementation(routeConsole())
  })

  afterEach(() => {
    cleanup()
  })

  it('raises a prominent alert for open reconciliation exceptions and lists their evidence', async () => {
    renderConsole()
    const banner = await screen.findByTestId('pay03b-admin-f5-open-banner')
    expect(banner.getAttribute('role')).toBe('alert')
    expect(banner.textContent).toContain('1 open payment reconciliation exception')
    expect(banner.textContent).not.toContain('reconciliation exceptions')
    expect(within(banner).getByText('Review exceptions').getAttribute('href')).toBe('#pay03b-admin-f5')

    const row = await screen.findByTestId(`pay03b-admin-exception-${EXCEPTION_ID}`)
    expect(row.textContent).toContain('pay03b_inv_0001')
    expect(row.textContent).toContain('¥3,000')
    expect(row.textContent).toContain('¥1,000')
    expect(row.textContent).toContain('sim_re_0001')
    expect(screen.getByTestId('pay03b-admin-f5-open-count').textContent).toBe('Open exceptions: 1')
    // Reads carry the console's own administrator session.
    const read = recordedCalls().find((c) => (c.path ?? '').startsWith('/pay03b/admin/reconciliation-exceptions?status=open'))
    expect(read?.authHeaders?.['x-session-token']).toBe('session-token-admin-1')
  })

  it('verifies an exception with a fresh provider read and acknowledges it', async () => {
    mockApiRequest.mockImplementation(routeConsole([
      [(p) => p === `/pay03b/admin/reconciliation-exceptions/${EXCEPTION_ID}?verify=1`, () => ({
        exception: OPEN_EXCEPTION,
        providerTruth: { status: 'partially_refunded', refundedMinor: 1000, pendingRefundMinor: 0, refundIds: ['sim_re_0001'], verifiedAt: '2026-11-01T02:00:00.000Z' },
      })],
      [(p) => p.endsWith('/acknowledge'), () => ({ exception: { ...OPEN_EXCEPTION, acknowledgedBy: 'admin-user-1', acknowledgedAt: '2026-11-01T02:01:00.000Z' } })],
    ]))
    renderConsole()
    fireEvent.click(await screen.findByTestId(`pay03b-admin-verify-${EXCEPTION_ID}`))
    const truth = await screen.findByTestId(`pay03b-admin-exception-truth-${EXCEPTION_ID}`)
    expect(truth.textContent).toContain('Provider now reports Partially refunded')
    expect(truth.textContent).toContain('refunded ¥1,000')

    fireEvent.click(screen.getByTestId(`pay03b-admin-acknowledge-${EXCEPTION_ID}`))
    expect((await screen.findByTestId('pay03b-admin-f5-status')).textContent).toContain('acknowledged')
    expect(postsTo('/acknowledge')).toHaveLength(1)
    await waitFor(() => expect(screen.queryByTestId(`pay03b-admin-acknowledge-${EXCEPTION_ID}`)).toBeNull())
  })

  it('resolves only with an explicit resolution and an audited note of 10+ characters, then re-reads the queue', async () => {
    let resolved = false
    mockApiRequest.mockImplementation(routeConsole([
      [(p) => p.startsWith('/pay03b/admin/reconciliation-exceptions?'), () => (resolved
        ? { exceptions: [], openCount: 0, sourceOfFinancialTruth: 'x' }
        : EXCEPTIONS)],
      [(p) => p.endsWith('/resolve'), () => {
        resolved = true
        return {
          exception: { ...OPEN_EXCEPTION, status: 'resolved', resolution: 'revoke_access_partial_refund_final', resolvedBy: 'admin-user-1', resolvedAt: '2026-11-01T03:00:00.000Z' },
          paymentStatus: 'refunded', entitlementStatus: 'revoked',
          providerTruth: { status: 'partially_refunded', refundedMinor: 1000, pendingRefundMinor: 0, refundIds: ['sim_re_0001'], verifiedAt: '2026-11-01T03:00:00.000Z' },
          sourceOfFinancialTruth: 'x',
        }
      }],
    ]))
    renderConsole()
    await screen.findByTestId('pay03b-admin-f5-open-banner')
    fireEvent.click(await screen.findByTestId(`pay03b-admin-resolve-${EXCEPTION_ID}`))
    const dialog = await screen.findByTestId('pay03b-admin-resolve-dialog')
    const confirm = within(dialog).getByTestId('pay03b-admin-resolve-confirm') as HTMLButtonElement
    expect(confirm.disabled).toBe(true)

    fireEvent.click(within(dialog).getByTestId('pay03b-admin-resolution-revoke_access_partial_refund_final'))
    fireEvent.change(within(dialog).getByTestId('pay03b-admin-resolve-note'), { target: { value: 'too short' } })
    expect(confirm.disabled).toBe(true)
    fireEvent.change(within(dialog).getByTestId('pay03b-admin-resolve-note'), { target: { value: 'Partial refund confirmed final with the dealer.' } })
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)

    expect((await screen.findByTestId('pay03b-admin-f5-status')).textContent).toContain('resolved (Revoke access partial refund final)')
    const [post] = postsTo('/resolve')
    expect(JSON.parse(String(post.options?.body))).toEqual({
      resolution: 'revoke_access_partial_refund_final',
      note: 'Partial refund confirmed final with the dealer.',
    })
    await waitFor(() => expect(screen.queryByTestId('pay03b-admin-f5-open-banner')).toBeNull())
  })

  it('a failed exception read is a read failure — never an empty queue — and the open count is unknown, not zero', async () => {
    mockApiRequest.mockImplementation(routeConsole([
      [(p) => p.startsWith('/pay03b/admin/reconciliation-exceptions?'), () => { throw new Error('PAY03B_RECONCILIATION_READ_UNAVAILABLE') }],
    ]))
    renderConsole()
    const alert = await screen.findByTestId('pay03b-admin-f5-error')
    expect(alert.getAttribute('role')).toBe('alert')
    expect(alert.textContent).toContain('Reconciliation exceptions could not be read.')
    expect(alert.textContent).toContain('not an empty queue')
    expect(screen.queryByTestId('pay03b-admin-f5-empty')).toBeNull()
    expect(screen.queryByTestId('pay03b-admin-f5-open-banner')).toBeNull()
    const unknown = screen.getByTestId('pay03b-admin-f5-unknown-banner')
    expect(unknown.getAttribute('role')).toBe('alert')
    expect(unknown.textContent).toContain('do not assume there are none')
  })

  it('lists business subscriptions and inspects one: invoices with payment status, transitions, change requests, entitlements', async () => {
    renderConsole()
    const row = await screen.findByTestId('pay03b-admin-subscription-sub-1')
    expect(row.textContent).toContain('Harare Premium Motors')
    expect(screen.getByTestId('pay03b-admin-subscription-access-sub-1').textContent).toBe('Paid access')
    expect(within(row).getByTestId('pay03b-admin-simulated-label').textContent).toBe('Simulated provider (local test) — not Stripe')

    fireEvent.click(screen.getByTestId('pay03b-admin-inspect-sub-1'))
    const detail = await screen.findByTestId('pay03b-admin-subscription-detail')
    await within(detail).findByTestId('pay03b-admin-invoice-sim_in_0001')
    expect(within(detail).getByTestId('pay03b-admin-invoice-payment-sim_in_0001').textContent).toBe('Payment confirmed')
    expect(within(detail).getByTestId('pay03b-admin-invoice-payment-sim_in_0002').textContent).toBe('No payment recorded')
    expect(within(detail).getByTestId('pay03b-admin-transition-1').textContent).toContain('Checkout claimed')
    expect(within(detail).getByTestId('pay03b-admin-transition-2').textContent).toContain('Incomplete → Active')
    expect(within(detail).getByTestId('pay03b-admin-change-request-cr-1').textContent).toContain('Cancel at period end')
    expect(within(detail).getByTestId('pay03b-admin-entitlements').textContent).toContain('Paid access: active')
    expect(within(detail).getByTestId('pay03b-admin-entitlements').textContent).toContain('listing capacity 10')
    // Only a paid invoice with a paid canonical payment is refundable.
    expect(within(detail).getByTestId('pay03b-admin-refund-sim_in_0001')).toBeTruthy()
    expect(within(detail).queryByTestId('pay03b-admin-refund-sim_in_0002')).toBeNull()
  })

  it('reconciles with the provider, and suspends only with a 10+ character reason and an idempotency key', async () => {
    mockApiRequest.mockImplementation(routeConsole([
      [(p) => p.endsWith('/reconcile'), () => ({ ...DETAIL, result: { state: 'synchronized', invoicesSynced: 2 } })],
      [(p) => p.endsWith('/suspension'), () => ({ ...DETAIL, subscription: { ...SUBSCRIPTION, status: 'suspended', suspendedReason: 'admin_suspension' } })],
    ]))
    renderConsole()
    fireEvent.click(await screen.findByTestId('pay03b-admin-inspect-sub-1'))
    fireEvent.click(await screen.findByTestId('pay03b-admin-reconcile'))
    expect((await screen.findByTestId('pay03b-admin-subscription-status')).textContent).toContain('Synchronized (2 invoices synchronised)')
    expect(postsTo('/pay03b/admin/subscriptions/sub-1/reconcile')).toHaveLength(1)

    fireEvent.click(screen.getByTestId('pay03b-admin-suspend'))
    const dialog = await screen.findByTestId('pay03b-admin-suspension-dialog')
    const confirm = within(dialog).getByTestId('pay03b-admin-suspension-confirm') as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.change(within(dialog).getByTestId('pay03b-admin-suspension-reason'), { target: { value: 'Chargeback opened by the card issuer.' } })
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)

    expect((await screen.findByTestId('pay03b-admin-subscription-status')).textContent).toContain('Subscription suspended by an administrator')
    const [post] = postsTo('/pay03b/admin/subscriptions/sub-1/suspension')
    expect(JSON.parse(String(post.options?.body))).toEqual({ action: 'suspend', reason: 'Chargeback opened by the card issuer.' })
    expect((post.options?.headers as Record<string, string>)['Idempotency-Key']).toMatch(IDEMPOTENCY_PATTERN)
    expect(await screen.findByTestId('pay03b-admin-resume')).toBeTruthy()
  })

  it('refunds an invoice only after a reason AND an explicit acknowledgement of the effect', async () => {
    mockApiRequest.mockImplementation(routeConsole([
      [(p) => p.endsWith('/invoices/inv-1/refund'), () => ({ ...DETAIL, invoices: [OPEN_INVOICE, { ...PAID_INVOICE, paymentStatus: 'refunded' }] })],
    ]))
    renderConsole()
    fireEvent.click(await screen.findByTestId('pay03b-admin-inspect-sub-1'))
    fireEvent.click(await screen.findByTestId('pay03b-admin-refund-sim_in_0001'))
    const dialog = await screen.findByTestId('pay03b-admin-refund-dialog')
    const effect = within(dialog).getByTestId('pay03b-admin-refund-effect').textContent || ''
    expect(effect).toContain('governed FULL refund of ¥3,000')
    expect(effect).toContain('paid coverage of its period')
    const confirm = within(dialog).getByTestId('pay03b-admin-refund-confirm') as HTMLButtonElement
    fireEvent.change(within(dialog).getByTestId('pay03b-admin-refund-reason'), { target: { value: 'Dealer charged twice for November.' } })
    expect(confirm.disabled).toBe(true)
    fireEvent.click(within(dialog).getByTestId('pay03b-admin-refund-understood'))
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)

    expect((await screen.findByTestId('pay03b-admin-subscription-status')).textContent).toContain('CarUp payment record: Refunded')
    const [post] = postsTo('/pay03b/admin/subscriptions/sub-1/invoices/inv-1/refund')
    expect(JSON.parse(String(post.options?.body))).toEqual({ reason: 'Dealer charged twice for November.' })
  })

  it('shows a refused administrator action inside its dialog, with the backend code', async () => {
    mockApiRequest.mockImplementation(routeConsole([
      [(p) => p.endsWith('/invoices/inv-1/refund'), () => { throw Object.assign(new Error('PAY03B_INVOICE_NOT_REFUNDABLE'), { status: 409, code: 'PAY03B_INVOICE_NOT_REFUNDABLE' }) }],
    ]))
    renderConsole()
    fireEvent.click(await screen.findByTestId('pay03b-admin-inspect-sub-1'))
    fireEvent.click(await screen.findByTestId('pay03b-admin-refund-sim_in_0001'))
    const dialog = await screen.findByTestId('pay03b-admin-refund-dialog')
    fireEvent.change(within(dialog).getByTestId('pay03b-admin-refund-reason'), { target: { value: 'Dealer charged twice for November.' } })
    fireEvent.click(within(dialog).getByTestId('pay03b-admin-refund-understood'))
    fireEvent.click(within(dialog).getByTestId('pay03b-admin-refund-confirm'))
    const error = await within(dialog).findByTestId('pay03b-admin-refund-error')
    expect(error.getAttribute('role')).toBe('alert')
    expect(error.textContent).toContain('Only a fully paid invoice whose canonical payment is paid can be refunded.')
    expect(error.textContent).toContain('PAY03B_INVOICE_NOT_REFUNDABLE')
  })

  it('failed subscription reads are alerts, never an empty subscription book', async () => {
    mockApiRequest.mockImplementation(routeConsole([
      [(p) => p === '/pay03b/admin/subscriptions', () => { throw Object.assign(new Error('PAY03B_READ_UNAVAILABLE'), { status: 503, code: 'PAY03B_READ_UNAVAILABLE' }) }],
    ]))
    renderConsole()
    const alert = await screen.findByTestId('pay03b-admin-subscriptions-error')
    expect(alert.getAttribute('role')).toBe('alert')
    expect(alert.textContent).toContain('Billing records could not be read.')
    expect(alert.textContent).toContain('not an empty subscription book')
    expect(screen.queryByTestId('pay03b-admin-subscriptions-empty')).toBeNull()
  })

  it('a malformed subscription detail is reported as an error, not rendered as an empty history', async () => {
    mockApiRequest.mockImplementation(routeConsole([
      [(p) => p === '/pay03b/admin/subscriptions/sub-1', () => ({ subscription: SUBSCRIPTION })],
    ]))
    renderConsole()
    fireEvent.click(await screen.findByTestId('pay03b-admin-inspect-sub-1'))
    const error = await screen.findByTestId('pay03b-admin-detail-error')
    expect(error.getAttribute('role')).toBe('alert')
    expect(error.textContent).toContain('PAY03B_ADMIN_SUBSCRIPTION_RESPONSE_INVALID')
    expect(screen.queryByTestId('pay03b-admin-transitions')).toBeNull()
  })

  it('shows plan governance for every plan version: pricing kind, activation, blocker; sandbox fixtures labelled', async () => {
    renderConsole()
    const governed = await screen.findByTestId('pay03b-admin-plan-dealer_storefront_package-v1')
    expect(governed.textContent).toContain('Unpriced')
    expect(governed.textContent).toContain('Commercially blocked')
    expect(screen.getByTestId('pay03b-admin-plan-commercial-dealer_storefront_package-v1').textContent).toBe('Not yet available')
    expect(governed.textContent).toContain('COMMERCIAL:')
    expect(governed.textContent).not.toMatch(/[$¥]\s?\d/)

    const sandbox = screen.getByTestId('pay03b-admin-plan-dealer_sandbox_std-v2')
    expect(within(sandbox).getByTestId('pay03b-admin-plan-sandbox-dealer_sandbox_std-v2').textContent).toBe('Sandbox test plan — not a commercial offer')
    expect(sandbox.textContent).toContain('¥3,000 per month')
    expect(screen.getByTestId('pay03b-admin-plan-dealer_sandbox_std-v1').textContent).toContain('Retired')
    expect(screen.getByTestId('pay03b-admin-plan-commercial-diaspora_free-v1').textContent).toBe('Free')
  })

  it('a failed plan-governance read is an alert, never an empty registry', async () => {
    mockApiRequest.mockImplementation(routeConsole([
      [(p) => p === '/pay03b/admin/catalogue', () => { throw Object.assign(new Error('PAY03B_CATALOGUE_UNAVAILABLE'), { status: 503, code: 'PAY03B_CATALOGUE_UNAVAILABLE' }) }],
    ]))
    renderConsole()
    const alert = await screen.findByTestId('pay03b-admin-plans-error')
    expect(alert.getAttribute('role')).toBe('alert')
    expect(alert.textContent).toContain('not an empty registry')
    expect(screen.queryByTestId('pay03b-admin-plans-empty')).toBeNull()
  })

  it('PAY-03B sections stay available when the PAY-02 catalogue read fails', async () => {
    mockApiRequest.mockImplementation(routeConsole([
      [(p) => p.startsWith('/pay02/admin/catalogue'), () => { throw new Error('PAY02_CATALOGUE_UNAVAILABLE') }],
    ]))
    renderConsole()
    expect((await screen.findByTestId('pay02-error-alert')).textContent).toContain('PAY02_CATALOGUE_UNAVAILABLE')
    expect(await screen.findByTestId('pay03b-admin-subscription-sub-1')).toBeTruthy()
    expect(screen.getByTestId('pay03b-admin-f5-open-banner')).toBeTruthy()
  })
})
