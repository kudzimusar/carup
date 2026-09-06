/**
 * Trade OS T6 — what the customer's screen is allowed to say about money.
 *
 * These assert on RENDERED TEXT, because the failures they guard against are all things that look
 * fine in a data structure and become lies on a screen: a missing cost rendered as $0, an exclusion
 * folded into a total, a USD figure standing where the original currency should be, or a "cheapest"
 * badge on two offers that are not the same purchase.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { LandedEstimatePanel, QuoteBreakdown, ComparisonVerdict } from './TradeQuoteComparison'
import type { ComparableQuote, LandedEstimate } from './TradeQuoteComparison'
import { MoneyWithReference } from './commercialDisplay'
import { formatMoney } from './commercialFormat'

const usd = (n: number) => ({ amount: n, currency: 'USD' })
const fxOk = { status: 'AVAILABLE' as const, rate: 0.0063991, rate_date: '2026-09-04', source: 'ECB' }
const fxNone = { status: 'UNAVAILABLE' as const, reason: 'ZWG/USD is not published by ECB.' }

const component = (over: Partial<ComparableQuote['components'][number]> = {}) => ({
  id: 'c1', cost_stage: 'MAIN_CARRIAGE', stage_label: 'Main transport', label: 'Ocean freight',
  original: usd(1800), reference_usd: usd(1800), fx: fxOk,
  inclusion: 'INCLUDED', commercial_status: 'QUOTED', provenance: 'PROVIDER_STATED',
  revenue_class: 'PASS_THROUGH_COST', is_carup_revenue: false, ...over,
})

const estimate = (over: Partial<LandedEstimate> = {}): LandedEstimate => ({
  known_included_by_currency: { USD: 1800 },
  known_included_reference_usd: 1800,
  reference_usd_incomplete: false,
  excluded: [], contingent: [], unpriced: [], missing_material_stages: [],
  is_complete: false, carup_charges: [],
  customs_note: 'Import taxes and duties: not calculated yet.', ...over,
})

describe('money is never misrepresented', () => {
  it('shows the SOURCE currency, with USD only as a labelled reference', () => {
    render(<MoneyWithReference source={{ amount: 78500, currency: 'JPY' }} reference={usd(502.33)} fx={fxOk} />)
    expect(screen.getByTestId('money-source').textContent).toContain('JPY 78,500')
    expect(screen.getByTestId('money-reference').textContent).toContain('USD 502.33')
    // The original must never be replaced by its conversion.
    expect(screen.getByTestId('money-source').textContent).not.toContain('USD')
  })

  it('names the reference rate, its source and ITS OWN date', () => {
    render(<MoneyWithReference source={{ amount: 78500, currency: 'JPY' }} reference={usd(502.33)} fx={fxOk} />)
    const text = document.body.textContent || ''
    expect(text).toContain('Reference rate')
    expect(text).toContain('ECB')
    expect(text).toContain('2026-09-04')
  })

  it('says the comparison is unavailable rather than showing a number', () => {
    render(<MoneyWithReference source={{ amount: 78500, currency: 'ZWG' }} reference={null} fx={fxNone} />)
    expect(screen.getByTestId('money-source').textContent).toContain('ZWG 78,500')
    const unavailable = screen.getByTestId('money-reference-unavailable').textContent || ''
    expect(unavailable).toContain('USD comparison unavailable')
    expect(unavailable).not.toMatch(/USD\s*0/)
    expect(document.body.textContent).not.toMatch(/≈\s*USD\s*0/)
  })

  it('an unpriced amount says so — it never formats as a currency zero', () => {
    render(<MoneyWithReference source={{ amount: null, currency: null }} />)
    expect(screen.getByTestId('money-unpriced').textContent).toBe('Not priced yet')
    expect(document.body.textContent).not.toMatch(/0\.00|USD 0|\$0/)
  })

  /**
   * Found by reading the deployed buyer screen: an EXCLUDED customs line and a NOT_APPLICABLE
   * inspection line both rendered "Not priced yet" — the same words as an included charge the
   * provider had simply not quoted. Three different facts were being told as one, and the one they
   * were told as is the one that makes a customer wait for a price that is never coming.
   */
  it('distinguishes not-yet-priced from does-not-apply from excluded-and-unstated', () => {
    const { unmount } = render(<MoneyWithReference source={{ amount: null, currency: null }} inclusion="INCLUDED" />)
    expect(screen.getByTestId('money-unpriced').textContent).toBe('Not priced yet')
    unmount()

    const notApplicable = render(<MoneyWithReference source={{ amount: null, currency: null }} inclusion="NOT_APPLICABLE" />)
    expect(screen.getByTestId('money-not-applicable').textContent).toBe('Does not apply to this shipment')
    expect(screen.queryByTestId('money-unpriced')).toBeNull()
    notApplicable.unmount()

    render(<MoneyWithReference source={{ amount: null, currency: null }} inclusion="EXCLUDED" />)
    expect(screen.getByTestId('money-excluded-unstated').textContent).toBe('Amount not stated — you arrange this')
    expect(screen.queryByTestId('money-unpriced')).toBeNull()
  })

  it('formatMoney refuses to invent a figure', () => {
    expect(formatMoney({ amount: null, currency: 'USD' })).toBeNull()
    expect(formatMoney({ amount: 100, currency: null })).toBeNull()
    expect(formatMoney({ amount: 0, currency: 'USD' })).toBe('USD 0')   // a REAL zero is fine
  })
})

describe('the landed estimate refuses to overstate itself', () => {
  it('does NOT call itself a landed cost while material stages are unknown', () => {
    render(<LandedEstimatePanel estimate={estimate({
      is_complete: false,
      missing_material_stages: [{ stage: 'CLEARING', stage_label: 'Customs clearing' }, { stage: 'INLAND', stage_label: 'Inland transport' }],
    })} />)
    const text = document.body.textContent || ''
    expect(text).toContain('Known estimated costs so far')
    expect(text).not.toContain('Estimated landed cost')
    expect(screen.getByTestId('estimate-incomplete')).toBeInTheDocument()
    expect(screen.getByTestId('estimate-missing-stages').textContent).toContain('Customs clearing')
    expect(screen.getByTestId('estimate-missing-stages').textContent).toContain('Inland transport')
  })

  it('calls it a landed cost only when everything material is priced', () => {
    render(<LandedEstimatePanel estimate={estimate({ is_complete: true })} />)
    expect(document.body.textContent).toContain('Estimated landed cost')
    expect(screen.queryByTestId('estimate-incomplete')).toBeNull()
  })

  it('shows an exclusion as a cost the customer still meets, never as zero', () => {
    render(<LandedEstimatePanel estimate={estimate({
      excluded: [{ stage: 'CLEARING', stage_label: 'Customs clearing', label: 'Destination clearing', original: { amount: null, currency: null } }],
    })} />)
    const excluded = screen.getByTestId('estimate-excluded').textContent || ''
    expect(excluded).toContain('you arrange these separately')
    expect(excluded).toContain('amount not stated')
    expect(excluded).not.toMatch(/USD 0|\$0|0\.00/)
  })

  it('shows nothing rather than a zero when nothing is priced', () => {
    render(<LandedEstimatePanel estimate={estimate({ known_included_by_currency: {}, known_included_reference_usd: null })} />)
    expect(screen.getByTestId('estimate-nothing-priced').textContent).toContain('Nothing is priced yet')
    expect(document.body.textContent).not.toMatch(/USD 0|\$0/)
  })

  it('groups currencies instead of summing them', () => {
    render(<LandedEstimatePanel estimate={estimate({
      known_included_by_currency: { JPY: 2400000, USD: 1800 }, known_included_reference_usd: null, reference_usd_incomplete: true,
    })} />)
    const totals = screen.getByTestId('estimate-totals').textContent || ''
    expect(totals).toContain('JPY 2,400,000')
    expect(totals).toContain('USD 1,800')
    expect(screen.getByTestId('estimate-reference-incomplete')).toBeInTheDocument()
  })

  it('always states that customs is not calculated, and that this is not an invoice', () => {
    render(<LandedEstimatePanel estimate={estimate()} />)
    expect(screen.getByTestId('estimate-customs-note').textContent).toContain('not calculated yet')
    expect(document.body.textContent).toContain('not an invoice')
  })

  it('reports a CarUp charge separately and as CarUp\'s own', () => {
    render(<LandedEstimatePanel estimate={estimate({
      carup_charges: [{ label: 'CarUp coordination fee', original: usd(50), revenue_class: 'CARUP_SERVICE_FEE' }],
    })} />)
    const carup = screen.getByTestId('estimate-carup-charges').textContent || ''
    expect(carup).toContain('CarUp charges')
    expect(carup).toContain('CarUp coordination fee')
    expect(carup).toContain('USD 50')
  })
})

describe('the comparison names no winner it has not earned', () => {
  const q = (id: string, label: string): ComparableQuote => ({ id, label, components: [component()], estimate: estimate() })

  it('shows the reasons and NO winner when scopes differ', () => {
    render(<ComparisonVerdict
      result={{ comparable: false, verdict: 'PARTIALLY_COMPARABLE', cheapest: null,
        reasons: ['Offer B prices Inland transport; Offer A does not.'] }}
      quotes={[q('a', 'Offer A'), q('b', 'Offer B')]} />)
    expect(screen.getByTestId('comparison-not-comparable').textContent).toContain('not calling one of these cheaper')
    expect(screen.getByTestId('comparison-reasons').textContent).toContain('Inland transport')
    expect(screen.queryByTestId('comparison-lowest')).toBeNull()
    // No winner styling of any kind.
    expect(document.body.textContent).not.toMatch(/Best value|Recommended|Cheapest option/i)
  })

  it('names the lowest total ONLY when the offers cover the same scope', () => {
    render(<ComparisonVerdict
      result={{ comparable: true, verdict: 'COMPARABLE', cheapest: 'b', reasons: [] }}
      quotes={[q('a', 'Offer A'), q('b', 'Offer B')]} />)
    expect(screen.getByTestId('comparison-lowest').textContent).toContain('Offer B')
    expect(document.body.textContent).toContain('same scope')
  })
})

describe('the breakdown shows scope beside every number', () => {
  it('labels provenance so a provider figure is not mistaken for a verified one', () => {
    render(<QuoteBreakdown quote={{ id: 'q', label: 'Offer', components: [component()], estimate: estimate() }} />)
    expect(document.body.textContent).toContain('Provider-stated, not verified by CarUp')
  })

  it('marks an excluded component on the line itself', () => {
    render(<QuoteBreakdown quote={{ id: 'q', label: 'Offer',
      components: [component({ id: 'x', inclusion: 'EXCLUDED', original: { amount: null, currency: null }, reference_usd: null, fx: fxNone })],
      estimate: estimate() }} />)
    expect(screen.getByTestId('inclusion-EXCLUDED').textContent).toContain('you arrange this separately')
    // NOT "Not priced yet": the provider is not going to price this one, so saying a price is
    // still coming would be the wrong promise.
    expect(screen.getByTestId('money-excluded-unstated').textContent).toBe('Amount not stated — you arrange this')
    expect(screen.queryByTestId('money-unpriced')).toBeNull()
    expect(document.body.textContent).not.toMatch(/0\.00|USD 0|\$0/)
  })
})
