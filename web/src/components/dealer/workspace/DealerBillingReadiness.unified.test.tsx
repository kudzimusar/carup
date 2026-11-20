/**
 * RX05-C — /dealers/billing unified Dealer OS view: a readiness checklist that never implies live
 * payments, no plan/price/checkout control, truthful "records unavailable" and a retry on failure.
 * Fictional data only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const fx = vi.hoisted(() => ({ requests: 0, fail: false }))
const auth = vi.hoisted(() => ({ user: { id: 'fictional-owner', role: 'member' }, token: 'synthetic-session' }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('@/lib/apiClient', () => ({
  resolveApiBaseUrl: () => 'http://127.0.0.1:3001/api',
  apiRequest: async (request: { path: string }) => {
    if (request.path !== '/dealer/commercial-readiness') throw Error('Unexpected ' + request.path)
    fx.requests++
    if (fx.fail) { fx.fail = false; throw Object.assign(new Error('HTTP 503'), { status: 503 }) }
    return { readiness: {
      organization_id: 'o', tenant_id: 't', product_catalogue_authority: 'x',
      canonical_pay03b_billing_readback: { state: 'PAY03B_SCHEMA_OR_CANONICAL_READ_UNAVAILABLE', subscriptions: null, invoices: null, payment_initiation_allowed: false },
      dealer_first_party_pricing: [], selectable_dealer_plans: [], approved_provider_methods: [], billing_transactions: null, receipts: null,
      reconciliation_records: null, payment_initiation_allowed: false, has_approved_subscription_entitlement: false, live_payment_enabled: false,
      finance_status: 'INTEGRATION_AND_EXTERNAL_COMMERCIAL_APPROVAL_REQUIRED',
      external_gates: ['OWNER_APPROVED_DEALER_PRODUCT_TARIFF_AND_JURISDICTION', 'PAY03B_CANONICAL_ENTITLEMENT_AND_FINANCE_CONVERGENCE'],
      flows: [
        { code: 'DEALER_PAYS_CARUP', payer: 'DEALERSHIP_ORGANIZATION', beneficiary: 'INDEPENDENTLY_APPROVED_CARUP_MERCHANT', provider: 'x', status: 'BLOCKED_PENDING_PAY03B_AND_FIRST_PARTY_MERCHANT', paid: false },
        { code: 'GARAGE_CUSTOMER_PAYS_GARAGE', payer: 'GARAGE_CUSTOMER', beneficiary: 'GARAGE_OWN_MERCHANT', provider: 'x', status: 'OUTSIDE_DEALER_BILLING_SCOPE', paid: false },
      ],
    } }
  },
}))

async function mount(unified = true) {
  vi.resetModules()
  ;(globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = unified ? true : undefined
  const { default: Page } = await import('@/pages/DealerBillingReadiness')
  return render(<MemoryRouter><Page /></MemoryRouter>)
}
beforeEach(() => { fx.requests = 0; fx.fail = false })
afterEach(() => { (globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = undefined })

describe('DealerBillingReadiness — unified Dealer OS view', () => {
  it('flag OFF keeps the legacy page', async () => {
    await mount(false)
    expect(await screen.findByRole('heading', { name: 'Dealership plans and billing' })).toBeInTheDocument()
    expect(screen.queryByTestId('dealer-ws-billing')).toBeNull()
  })

  it('never implies live payments and offers no way to pay', async () => {
    await mount()
    const live = await screen.findByTestId('dealer-ws-billing-live')
    expect(live).toHaveTextContent('Live payments not active')
    expect(live).toHaveAttribute('data-tone', 'warning')
    expect(screen.getByTestId('dealer-ws-billing-position')).toHaveTextContent('Dealer subscriptions cannot be purchased yet')
    expect(screen.getByTestId('dealer-ws-billing-position')).toHaveTextContent('Not available — not zero')
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryByRole('link', { name: /pay|checkout|subscribe|plan/i })).toBeNull()
    expect(document.querySelector('[data-tone="success"]')).toBeNull()
  })

  it('lists the recorded activation requirements without claiming any is met', async () => {
    await mount()
    const checklist = await screen.findByTestId('dealer-ws-billing-checklist')
    expect(within(checklist).getByTestId('dealer-ws-billing-gate-0')).toHaveTextContent('Owner approved dealer product tariff and jurisdiction')
    expect(within(checklist).getByTestId('dealer-ws-billing-gate-1')).toHaveTextContent('PAY03B canonical entitlement and finance convergence')
    expect(within(checklist).queryByText(/met|complete|done/i)).toBeNull()
    expect(screen.getByTestId('dealer-ws-billing-records-unavailable')).toHaveTextContent('No invoice or payment total may be inferred')
  })

  it('retries a failed read with the same single request', async () => {
    fx.fail = true
    await mount()
    const denied = await screen.findByTestId('dealer-ws-billing-denied')
    expect(denied).toHaveTextContent('No payment has been initiated.')
    fireEvent.click(within(denied).getByRole('button', { name: /Try again/ }))
    expect(await screen.findByTestId('dealer-ws-billing-checklist')).toBeInTheDocument()
    expect(fx.requests).toBe(2)
  })
})
