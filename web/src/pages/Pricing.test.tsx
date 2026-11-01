import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * CARUP-PAY-03B — the public Pricing page renders the governed catalogue only. It previously imported
 * `subscriptionPlans` from mockData ($9.99 Premium, "Save 20%") and hard-coded "Dealers $99/mo" and
 * "Mechanics $49/mo"; none of those prices was ever approved.
 */

const fetchPay03bCatalogue = vi.fn()

// A fresh object per render, like the real hook: the page must depend on the function, not the object.
vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({ fetchPay03bCatalogue }),
}))

const Pricing = (await import('./Pricing')).default
const SRC = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'Pricing.tsx'), 'utf8')

const CATALOGUE = {
  products: [
    {
      productCode: 'mkt.dealer.storefront_package',
      title: 'Dealership Verified Storefront & Inventory Package',
      plans: [{
        planCode: 'dealer_storefront_package', displayName: 'Dealership Verified Storefront & Inventory Package',
        pricingKind: 'unpriced', commercialStatus: 'not_available', billingInterval: 'month', blockerClass: 'COMMERCIAL',
        blockerReason: 'No approved tariff, merchant of record, Zimbabwe collection provider, tax authority or approved entitlement set.',
        amountMinor: null, currency: null,
      }],
    },
    {
      productCode: 'sub.garage.os_plan',
      title: 'Garage Business Operating System',
      plans: [{
        planCode: 'garage_os_plan', displayName: 'Garage Business Operating System', pricingKind: 'unpriced',
        commercialStatus: 'not_available', billingInterval: 'month', blockerClass: 'COMMERCIAL',
        blockerReason: 'No approved SaaS tariff.', amountMinor: null, currency: null,
      }],
    },
    {
      productCode: 'sub.diaspora.free',
      title: 'Diaspora Trade OS — Free Tier',
      plans: [{
        planCode: 'diaspora_free', displayName: 'Diaspora Trade OS — Free Tier', pricingKind: 'free', commercialStatus: 'free',
        billingInterval: null, blockerClass: null, blockerReason: null, amountMinor: null, currency: null,
      }],
    },
    {
      productCode: 'sub.diaspora.buyer_pro',
      title: 'Diaspora Buyer Plan',
      plans: [{
        planCode: 'diaspora_buyer_pro', displayName: 'Diaspora Buyer Plan', pricingKind: 'unpriced',
        commercialStatus: 'not_available', billingInterval: 'month', blockerClass: 'COMMERCIAL',
        blockerReason: 'Recurring tariff not approved.', amountMinor: null, currency: null,
      }],
    },
    {
      productCode: 'sub.diaspora.enterprise_partner',
      title: 'Diaspora Enterprise Partner',
      plans: [{
        planCode: 'diaspora_enterprise_partner', displayName: 'Diaspora Enterprise Partner', pricingKind: 'contract_quotation',
        commercialStatus: 'request_quote', billingInterval: null, blockerClass: 'OWNER AUTHORITY',
        blockerReason: 'Contract-governed: requires an Owner-approved enterprise quotation.', amountMinor: null, currency: null,
      }],
    },
  ],
  pricingAuthority: 'pay03b_subscription_plans (governed registry). No paid plan is commercially approved.',
}

function renderPricing() {
  return render(<MemoryRouter><Pricing /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchPay03bCatalogue.mockResolvedValue(CATALOGUE)
})

describe('Pricing — governed catalogue, no mock prices', () => {
  it('no longer imports mock subscription plans or hard-codes stakeholder prices', () => {
    expect(SRC).not.toContain('subscriptionPlans')
    expect(SRC).not.toContain('@/data/mockData')
    expect(SRC).not.toContain('$99/mo')
    expect(SRC).not.toContain('$49/mo')
    expect(SRC).not.toContain('Save 20%')
  })

  it('shows a loading state, then each plan with its governed commercial status', async () => {
    renderPricing()
    expect(screen.getByTestId('pay03b-pricing-loading').getAttribute('role')).toBe('status')

    await screen.findByTestId('pay03b-pricing-catalogue')
    expect(fetchPay03bCatalogue).toHaveBeenCalled()
    expect(screen.getByTestId('pay03b-pricing-status-dealer_storefront_package').textContent).toBe('Not yet available')
    expect(screen.getByTestId('pay03b-pricing-blocker-dealer_storefront_package').textContent).toContain('No approved tariff')
    expect(screen.getByTestId('pay03b-pricing-status-garage_os_plan').textContent).toBe('Not yet available')
    expect(screen.getByTestId('pay03b-pricing-status-diaspora_free').textContent).toBe('Free')
    expect(screen.getByTestId('pay03b-pricing-status-diaspora_buyer_pro').textContent).toBe('Not yet available')
    expect(screen.getByTestId('pay03b-pricing-status-diaspora_enterprise_partner').textContent).toBe('Request a quote')
    expect(screen.getByTestId('pay03b-pricing-authority').textContent).toContain('No paid plan is commercially approved')
  })

  it('renders no currency amount anywhere on the page', async () => {
    const { container } = renderPricing()
    await screen.findByTestId('pay03b-pricing-catalogue')
    const text = container.textContent || ''
    expect(text).not.toMatch(/[$¥€£]\s?\d/)
    expect(text).not.toMatch(/\b(USD|JPY|ZWG)\s?\d/)
    expect(text).not.toContain('/mo')
  })

  it('never shows a sandbox fixture on the public page, even if one were returned', async () => {
    fetchPay03bCatalogue.mockResolvedValue({
      ...CATALOGUE,
      products: [{
        productCode: 'mkt.dealer.storefront_package',
        title: 'Dealership package',
        plans: [
          CATALOGUE.products[0].plans[0],
          { planCode: 'dealer_sandbox_std', displayName: 'Sandbox Standard', pricingKind: 'sandbox_fixture', commercialStatus: 'sandbox_test_only_not_a_commercial_offer', billingInterval: 'month', blockerClass: null, blockerReason: null, amountMinor: null, currency: null },
        ],
      }],
    })
    renderPricing()
    await screen.findByTestId('pay03b-pricing-catalogue')
    expect(screen.queryByTestId('pay03b-pricing-plan-dealer_sandbox_std')).toBeNull()
    expect(screen.getByTestId('pay03b-pricing-plan-dealer_storefront_package')).toBeTruthy()
  })

  it('a failed read is an error (role="alert"), never an empty or invented price list — and can be retried', async () => {
    fetchPay03bCatalogue.mockRejectedValueOnce(Object.assign(new Error('PAY03B_CATALOGUE_UNAVAILABLE'), { status: 503, code: 'PAY03B_CATALOGUE_UNAVAILABLE' }))
    renderPricing()
    const alert = await screen.findByTestId('pay03b-pricing-error')
    expect(alert.getAttribute('role')).toBe('alert')
    expect(alert.textContent).toContain('The plan catalogue could not be read.')
    expect(alert.textContent).toContain('No prices are shown')
    expect(screen.queryByTestId('pay03b-pricing-catalogue')).toBeNull()
    expect(screen.queryByTestId('pay03b-pricing-empty')).toBeNull()

    fireEvent.click(screen.getByTestId('pay03b-pricing-retry'))
    await screen.findByTestId('pay03b-pricing-catalogue')
    await waitFor(() => expect(fetchPay03bCatalogue).toHaveBeenCalledTimes(2))
  })

  it('an empty catalogue says so explicitly', async () => {
    fetchPay03bCatalogue.mockResolvedValue({ products: [], pricingAuthority: 'registry' })
    renderPricing()
    expect((await screen.findByTestId('pay03b-pricing-empty')).textContent).toContain('No plans are published yet')
  })
})
