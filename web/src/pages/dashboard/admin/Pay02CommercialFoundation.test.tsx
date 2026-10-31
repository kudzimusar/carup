// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Pay02CommercialFoundation from './Pay02CommercialFoundation'

const mockApiRequest = vi.fn()

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'admin-user-1', role: 'admin' },
    token: 'session-token-admin-1',
  }),
}))

vi.mock('@/lib/apiClient', () => ({
  resolveApiBaseUrl: () => 'http://127.0.0.1:4000/api',
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}))

const SAMPLE_CATALOGUE = {
  summary: {
    totalProducts: 41,
    filteredCount: 2,
    byCategory: {
      category_a_first_party: 15,
      category_b_third_party: 19,
      category_c_corporate_treasury: 7,
    },
    byActivationState: {
      draft: 11,
      blocked: 28,
      provider_eligible: 1,
      sandbox_certified: 1,
    },
    liveActiveCount: 0,
    pilotCandidateCode: 'intel.report.vehicle_history_single',
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
      sourceObjectType: 'vehicle_report_versions',
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
      validation: { valid: true, errors: [] },
    },
  ],
}

describe('Pay02CommercialFoundation admin console', () => {
  beforeEach(() => {
    mockApiRequest.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the commercial catalogue summary, zero live active count, provider profiles, and products', async () => {
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
    expect(screen.getByTestId('pay02-provider-stripe_carup_japan_sandbox')).toBeTruthy()
    expect(screen.getByTestId('pay02-provider-paynow_zimbabwe')).toBeTruthy()
    expect(screen.getByTestId('pay02-product-intel.report.vehicle_history_single')).toBeTruthy()
    expect(screen.getByTestId('pay02-product-sub.diaspora.buyer_pro')).toBeTruthy()
  })

  it('submits a governed architecture review proposal without auto-activating the product', async () => {
    mockApiRequest
      .mockResolvedValueOnce(SAMPLE_CATALOGUE)
      .mockResolvedValueOnce({
        proposal: {
          id: 'prop-test-01',
          proposed_state: 'reviewed',
          status: 'pending_review',
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
      expect(screen.getByRole('status').textContent).toContain('Proposal prop-test-01 recorded (pending_review)')
    })
  })
})
