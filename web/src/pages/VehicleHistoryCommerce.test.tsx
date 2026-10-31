import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const apiRequest = vi.hoisted(() => vi.fn())
const identity = vi.hoisted(() => ({
  user: { id: 'buyer-1' } as { id: string } | null,
  token: 'valid-session' as string | null,
}))
vi.mock('@/lib/apiClient', () => ({ apiRequest, resolveApiBaseUrl: () => '/api' }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => identity }))

import VehicleHistoryCommerce from './VehicleHistoryCommerce'

const vehicle1 = {
  vin: 'WBA3A5C51DF358101',
  make: 'BMW',
  model: '328i',
  generation: 'F30',
  trim: 'M Sport',
  year: 2013,
  color: 'Alpine White',
  mileage: 84200,
  fuelType: 'petrol',
  transmission: 'automatic',
  importSource: 'Japan (USS Tokyo)',
  dutyPaid: true,
  policeVerified: true,
  status: 'active',
  trustScore: 88,
  eligibleForReport: true,
}

const readinessFixture = {
  eligibleForPurchase: true,
  sandboxOnly: true,
  liveCommercialActive: false,
  productCode: 'intel.report.vehicle_history_single',
  productTitle: 'CarUp Vehicle History Report — Single VIN',
  vehicle: vehicle1,
  readiness: {
    reportSchema: 'carup.report.v1',
    completenessState: 'partial',
    lifecycleSourceCoverage: 0.4,
    sourceDiversity: 2,
    classesPresent: ['registration', 'inspection'],
    classesMissing: ['service', 'accident'],
    classesUnavailable: ['theft'],
    timelineEventCount: 2,
    keyAlertCount: 0,
    listingSnapshotCount: 1,
    mileageObservationCount: 2,
    limitations: [
      'Service records were not available from connected sources.',
      'Absence of a record in an unread source is not proof that an event did not occur.',
    ],
    prePurchaseDisclosure:
      'Report generated from real CarUp Vehicle History sources for VIN WBA3A5C51DF358101.',
  },
  commercialTerms: {
    mode: 'SANDBOX_TEST_ONLY',
    authoritative: false,
    checkoutEligible: true,
    merchantOfRecord: 'CarUp Japan Co., Ltd.',
    merchantCode: 'carup_japan',
    legalBeneficiary: 'CarUp Japan Co., Ltd.',
    fundsOwner: 'carup_first_party_revenue',
    sandboxAccountId: 'acct_1UVnGaEjgXqvlsJk',
    currency: 'JPY',
    currencyScale: 0,
    amountMinor: 100,
    formattedPrice: '¥100',
    priceNotice: ' Governed Stripe sandbox charge of JPY 100.',
    refundPolicy: 'Governed sandbox refund revokes report entitlement and share links.',
  },
}

const pendingOrderFixture = {
  orderId: '00000000-0000-4000-8000-000000000301',
  productCode: 'intel.report.vehicle_history_single',
  productVersion: 1,
  productTitle: 'CarUp Vehicle History Report — Single VIN',
  sandboxOnly: true,
  buyerId: 'buyer-1',
  vin: 'WBA3A5C51DF358101',
  vehicleId: '00000000-0000-4000-8000-000000000101',
  quoteId: '00000000-0000-4000-8000-000000000201',
  quoteNumber: 'PAY02-Q-TEST-301',
  quoteStatus: 'checkout_pending',
  paymentReference: 'pay01a_00000000-0000-4000-8000-000000000401',
  paymentStatus: 'pending',
  amountMinor: 100,
  currency: 'JPY',
  currencyScale: 0,
  merchantOfRecord: 'carup_japan',
  legalBeneficiary: 'CarUp Japan Co., Ltd.',
  fundsOwner: 'carup_first_party_revenue',
  sandboxAccountId: 'acct_1UVnGaEjgXqvlsJk',
  checkoutId: 'cs_test_pay03a_301',
  paymentIntentId: null,
  refundId: null,
  entitlementStatus: 'awaiting_payment',
  reportAvailable: false,
  reportVersionId: null,
  reportVersionNumber: null,
  reportContentHash: null,
  completenessSummary: null,
  shareToken: null,
  shareExpiresAt: null,
  shareRevoked: false,
  grantedAt: null,
  revokedAt: null,
  createdAt: '2026-10-31T00:00:00Z',
  updatedAt: '2026-10-31T00:00:00Z',
}

const paidOrderFixture = {
  ...pendingOrderFixture,
  quoteStatus: 'paid',
  paymentStatus: 'paid',
  paymentIntentId: 'pi_test_pay03a_301',
  entitlementStatus: 'entitled',
  reportAvailable: true,
  reportVersionId: '00000000-0000-4000-8000-000000000501',
  reportVersionNumber: 1,
  reportContentHash: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  completenessSummary: {
    lifecycle_source_coverage: 0.4,
    source_diversity: 2,
    classes_present: ['registration', 'inspection'],
  },
  grantedAt: '2026-10-31T00:05:00Z',
}

const reportResponseFixture = {
  order: paidOrderFixture,
  reportVersionId: paidOrderFixture.reportVersionId!,
  reportVersion: 1,
  contentHash: paidOrderFixture.reportContentHash!,
  completeness: {
    lifecycle_source_coverage: 0.4,
    source_diversity: 2,
    classes_present: ['registration', 'inspection'],
    classes_missing: ['service', 'accident'],
  },
  provenance: {
    verified: true,
    vin: 'WBA3A5C51DF358101',
    completenessState: 'partial',
    lifecycleSourceCoverage: 0.4,
    sourceDiversity: 2,
    limitationsCount: 2,
  },
  idempotentReplay: true,
  report: {
    schema: 'carup.report.v1',
    vin: 'WBA3A5C51DF358101',
    audience: 'buyer',
    identity: {
      vin: 'WBA3A5C51DF358101',
      make: 'BMW',
      model: '328i',
      year: 2013,
    },
    key_alerts: [],
    timeline: [
      {
        evidence_id: 'ev-1',
        evidence_class: 'inspection',
        evidence_subtype: 'export_inspection',
        date: '2024-06-15',
        source_id: 'src-1',
        source_kind: 'government',
        verification_status: 'verified',
        mileage: 84200,
        mileage_unit: 'km',
      },
    ],
    completeness: {
      lifecycle_source_coverage: 0.4,
      source_diversity: 2,
      classes_present: ['registration', 'inspection'],
    },
    limitations: [
      'Service records were not available from connected sources.',
      'Absence of a record in an unread source is not proof that an event did not occur.',
    ],
  },
}

function mockPay03aApi(orders: unknown[] = [], verifyReturn: unknown = paidOrderFixture) {
  apiRequest.mockImplementation(({ path }: { path: string }) => {
    if (path.startsWith('/pay03a/vehicles') && path.endsWith('/readiness')) {
      return Promise.resolve(readinessFixture)
    }
    if (path.startsWith('/pay03a/vehicles')) {
      return Promise.resolve({
        productCode: 'intel.report.vehicle_history_single',
        vehicles: [vehicle1],
      })
    }
    if (path === '/pay03a/orders') {
      return Promise.resolve({ orders })
    }
    if (path.endsWith('/report')) {
      return Promise.resolve(reportResponseFixture)
    }
    if (path.endsWith('/share')) {
      return Promise.resolve({
        order: { ...paidOrderFixture, shareToken: 'shr_test_token_123' },
        shareToken: 'shr_test_token_123',
        shareExpiresAt: '2026-11-07T00:00:00Z',
        sharePath: '/reports/shared/shr_test_token_123',
      })
    }
    if (path.endsWith('/verify')) {
      return Promise.resolve(verifyReturn)
    }
    return Promise.resolve({})
  })
}

describe('PAY-03A customer-facing real Vehicle History Report commerce', () => {
  beforeEach(() => {
    apiRequest.mockReset()
    identity.user = { id: 'buyer-1' }
    identity.token = 'valid-session'
    sessionStorage.clear()
    window.history.replaceState({}, '', '/vehicle-history')
  })

  it('displays eligible real vehicles, pre-purchase data coverage, mandatory limitations, and JPY 100 sandbox price', async () => {
    mockPay03aApi([])
    render(
      <MemoryRouter>
        <VehicleHistoryCommerce />
      </MemoryRouter>,
    )

    expect(await screen.findByTestId('pay03a-vehicle-WBA3A5C51DF358101')).toBeInTheDocument()
    expect(await screen.findByTestId('pay03a-price')).toHaveTextContent('¥100')
    expect(screen.getByTestId('pay03a-selected-vin')).toHaveTextContent('WBA3A5C51DF358101')
    expect(screen.getByTestId('pay03a-readiness-summary')).toHaveTextContent('40%')
    expect(screen.getByTestId('pay03a-limitations-preview')).toHaveTextContent(
      'Service records were not available from connected sources.',
    )
    expect(screen.getByTestId('pay03a-buy-button')).toBeEnabled()
  })

  it('requires authentication before loading vehicles or orders', async () => {
    identity.user = null
    identity.token = null
    mockPay03aApi([])
    render(
      <MemoryRouter>
        <VehicleHistoryCommerce />
      </MemoryRouter>,
    )

    expect(await screen.findByTestId('pay03a-signin-cta')).toHaveAttribute(
      'href',
      '/login?returnTo=%2Fvehicle-history',
    )
    expect(screen.queryByTestId('pay03a-buy-button')).toBeNull()
    expect(apiRequest).not.toHaveBeenCalled()
  })

  it('never exposes Open Verified Report button while order is awaiting payment', async () => {
    mockPay03aApi([pendingOrderFixture])
    render(
      <MemoryRouter>
        <VehicleHistoryCommerce />
      </MemoryRouter>,
    )

    const orderCard = await screen.findByTestId(`pay03a-order-${pendingOrderFixture.orderId}`)
    expect(within(orderCard).getByText(/Awaiting authoritative Stripe/)).toBeInTheDocument()
    expect(
      within(orderCard).queryByTestId(`pay03a-open-report-${pendingOrderFixture.orderId}`),
    ).toBeNull()
  })

  it('opens the source-backed Vehicle History Report with VIN, timeline, and limitations after verified payment', async () => {
    mockPay03aApi([paidOrderFixture])
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <VehicleHistoryCommerce />
      </MemoryRouter>,
    )

    const openBtn = await screen.findByTestId(`pay03a-open-report-${paidOrderFixture.orderId}`)
    await user.click(openBtn)

    const viewer = await screen.findByTestId('pay03a-report-viewer')
    expect(within(viewer).getByText(/VERIFIED CANONICAL REPORT SNAPSHOT/)).toBeInTheDocument()
    expect(within(viewer).getAllByText(/WBA3A5C51DF358101/).length).toBeGreaterThan(0)
    expect(within(viewer).getByText(/export_inspection/)).toBeInTheDocument()
    expect(within(viewer).getByTestId('pay03a-report-limitations')).toHaveTextContent(
      'Absence of a record in an unread source is not proof that an event did not occur.',
    )
  })

  it('visibly revokes report entitlement and hides report opening when order is refunded', async () => {
    const refundedOrder = {
      ...paidOrderFixture,
      quoteStatus: 'refunded',
      paymentStatus: 'refunded',
      refundId: 're_test_pay03a_301',
      entitlementStatus: 'revoked_refunded',
      reportAvailable: false,
      shareRevoked: true,
      revokedAt: '2026-10-31T01:00:00Z',
    }
    mockPay03aApi([refundedOrder])
    render(
      <MemoryRouter>
        <VehicleHistoryCommerce />
      </MemoryRouter>,
    )

    const orderCard = await screen.findByTestId(`pay03a-order-${refundedOrder.orderId}`)
    expect(within(orderCard).getByText(/revoked_refunded/)).toBeInTheDocument()
    expect(within(orderCard).getByText(/re_test_pay03a_301/)).toBeInTheDocument()
    expect(
      within(orderCard).queryByTestId(`pay03a-open-report-${refundedOrder.orderId}`),
    ).toBeNull()
  })

  it('does not grant report entitlement from browser redirect URL alone when verification fails', async () => {
    sessionStorage.setItem('carup_pay03a_pending_report_order', pendingOrderFixture.orderId)
    window.history.replaceState(
      {},
      '',
      `/vehicle-history?carup_pay03a=returned&order_id=${pendingOrderFixture.orderId}`,
    )
    apiRequest.mockImplementation(({ path }: { path: string }) => {
      if (path.startsWith('/pay03a/vehicles') && path.endsWith('/readiness')) {
        return Promise.resolve(readinessFixture)
      }
      if (path.startsWith('/pay03a/vehicles')) {
        return Promise.resolve({
          productCode: 'intel.report.vehicle_history_single',
          vehicles: [vehicle1],
        })
      }
      if (path === '/pay03a/orders') {
        return Promise.resolve({ orders: [pendingOrderFixture] })
      }
      return Promise.reject(new Error('Stripe sandbox verification unreachable'))
    })

    render(
      <MemoryRouter>
        <VehicleHistoryCommerce />
      </MemoryRouter>,
    )

    expect(
      await screen.findByText(/Browser redirect parameters alone never grant report entitlement/),
    ).toBeInTheDocument()
    expect(
      screen.queryByTestId(`pay03a-open-report-${pendingOrderFixture.orderId}`),
    ).toBeNull()
  })
})
