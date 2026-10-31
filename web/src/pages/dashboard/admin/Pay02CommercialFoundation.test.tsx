// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    mockApiRequest
      .mockResolvedValueOnce(SAMPLE_CATALOGUE)
      .mockResolvedValueOnce({
        proposal: {
          id: 'prop-db-uuid-01',
          product_code: 'sub.diaspora.buyer_pro',
          proposed_state: 'reviewed',
          status: 'pending_review',
          proposer_id: 'admin-user-1',
        },
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
    mockApiRequest
      .mockResolvedValueOnce(SAMPLE_CATALOGUE)
      .mockRejectedValueOnce(new Error('PAY02_PROPOSAL_PERSISTENCE_UNAVAILABLE'))

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
    mockApiRequest
      .mockResolvedValueOnce(SAMPLE_CATALOGUE)
      .mockResolvedValueOnce({
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
      .mockResolvedValueOnce({
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
      .mockResolvedValueOnce(SAMPLE_CATALOGUE)
      .mockResolvedValueOnce({
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
    mockApiRequest
      .mockResolvedValueOnce(SAMPLE_CATALOGUE)
      .mockResolvedValueOnce({
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
      .mockResolvedValueOnce({
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
