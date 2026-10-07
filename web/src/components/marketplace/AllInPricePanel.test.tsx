/**
 * SJO-4 — the all-in price panel must not invent a currency.
 *
 * `marketplacePricingService` publishes a PROVENANCE-GATED currency: null unless `currency_source`
 * names who asserted it, with `currency_state` saying which case applies. The migration that
 * dropped the fabricating column DEFAULT, the `attestedValue` gate, and the service's own removal
 * of `currency || 'USD'` all exist to stop a currency nobody stated being published as fact.
 *
 * This panel then re-created it one layer out, so a listing whose currency is NOT recorded rendered
 * "USD 25,000" directly above the service's own warning that the currency is unknown and the total
 * cannot be reconciled. These tests pin that it cannot come back.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AllInPricePanel } from './AllInPricePanel'
import type { MarketplacePricingSummary } from '@/types'

const base: MarketplacePricingSummary = {
  asking_price: 25000,
  price_confidence: 'medium',
  estimate_basis: 'deterministic',
  price_warnings: [],
  estimated_total: 27500,
}

describe('AllInPricePanel currency truthfulness', () => {
  it('prints NO currency token when the listing currency is not recorded', () => {
    const { container } = render(
      <AllInPricePanel pricing={{ ...base, currency: null, currency_state: 'not_recorded' }} />,
    )
    const text = container.textContent || ''
    expect(text).not.toContain('USD 25,000')
    expect(text).not.toMatch(/USD\s*25/)
    // The amount is still shown — unlabelled, which is the honest form.
    expect(text).toContain('25,000')
    expect(screen.getByTestId('marketplace-allin-currency-unrecorded').textContent)
      .toMatch(/currency is not recorded/i)
  })

  it('a withheld currency is also never substituted', () => {
    const { container } = render(
      <AllInPricePanel pricing={{ ...base, currency: null, currency_state: 'withheld' }} />,
    )
    expect(container.textContent || '').not.toMatch(/USD\s*25/)
    expect(screen.getByTestId('marketplace-allin-currency-unrecorded')).toBeTruthy()
  })

  it('names the estimate denomination as a fact about the ESTIMATE, not the listing', () => {
    render(
      <AllInPricePanel
        pricing={{ ...base, currency: null, currency_state: 'not_recorded', estimate_denomination: 'USD' }}
      />,
    )
    // Saying the fixed components are denominated in USD is true and useful; saying THIS LISTING is
    // priced in USD is not. The distinction has to survive.
    expect(screen.getByTestId('marketplace-allin-currency-unrecorded').textContent)
      .toMatch(/denominated in USD/i)
  })

  it('ANTI-VACUITY: a RECORDED currency is printed normally', () => {
    const { container } = render(
      <AllInPricePanel pricing={{ ...base, currency: 'ZWG', currency_state: 'recorded', currency_source: 'seller_declared' }} />,
    )
    expect(container.textContent || '').toContain('ZWG 25,000')
    expect(screen.queryByTestId('marketplace-allin-currency-unrecorded')).toBeNull()
  })

  it('a currency present WITHOUT a state is still honoured, so older payloads do not regress', () => {
    // The state fields are additive on the wire; a payload that predates them and carries a real
    // currency must keep rendering it rather than being treated as unrecorded.
    const { container } = render(<AllInPricePanel pricing={{ ...base, currency: 'USD' }} />)
    expect(container.textContent || '').toContain('USD 25,000')
  })

  it('the service’s own reconciliation warning still reaches the buyer', () => {
    render(
      <AllInPricePanel
        pricing={{
          ...base,
          currency: null,
          currency_state: 'not_recorded',
          price_warnings: ["This listing's currency is not recorded, so the total cannot be reconciled to the asking price."],
        }}
      />,
    )
    expect(screen.getByText(/cannot be reconciled/i)).toBeTruthy()
  })
})

/**
 * OC-5R-REL-01 — no valuation is manufactured. CarUp has no approved valuation provider, so the
 * panel shows no fair-price band, market range or value, and says so. The band used to be the
 * asking price ±12% (estimated_fair_min / estimated_fair_max) — a valuation made from nothing.
 */
describe('AllInPricePanel publishes no valuation', () => {
  it('states that no market valuation exists', () => {
    render(<AllInPricePanel pricing={{ ...base, currency: 'USD', currency_state: 'recorded', valuation_status: 'not_configured' }} />)
    expect(screen.getByTestId('marketplace-allin-no-valuation').textContent)
      .toMatch(/no approved valuation provider/i)
  })

  it('never renders a fair band, even from an older payload that still carries one', () => {
    const legacy = { ...base, currency: 'USD', currency_state: 'recorded', estimated_fair_min: 22000, estimated_fair_max: 28000 } as unknown as MarketplacePricingSummary
    const { container } = render(<AllInPricePanel pricing={legacy} />)
    const text = container.textContent || ''
    expect(text).not.toMatch(/fair price band/i)
    expect(text).not.toContain('22,000')
    expect(text).not.toContain('28,000')
  })

  it('never labels the estimate AI-assisted', () => {
    const legacy = { ...base, estimate_basis: 'ai_assisted', price_confidence: 'high' } as unknown as MarketplacePricingSummary
    const { container } = render(<AllInPricePanel pricing={legacy} />)
    expect(container.textContent || '').not.toMatch(/AI-assisted/i)
  })
})
