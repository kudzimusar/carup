/**
 * Trade OS T6 — the customer actually SEES the commercial breakdown.
 *
 * The T6 breakdown, landed estimate and comparability verdict were written and unit-tested as
 * components before any product screen imported them. Nothing rendered `QuoteBreakdown`,
 * `LandedEstimatePanel` or `ComparisonVerdict`, so a provider could record a complete component
 * breakdown and their customer would still only see the five legacy columns. Correct is not the
 * same as wired, and only a test that mounts the real page can tell the difference.
 *
 * These tests mount TradeShippingRequests — the real requester surface — and assert the section is
 * present, reads its data from the real hook, and keeps the three states distinct:
 * unreadable ≠ no breakdown ≠ nothing priced.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'

const state = vi.hoisted(() => ({
  requests: [] as unknown[],
  detail: null as unknown,
  commercials: null as unknown,
  commercialsError: null as Error | null,
  comparison: null as unknown,
  readCalls: [] as unknown[],
  compareCalls: [] as unknown[],
}))

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ loading: false, user: { id: 'req-1' } }) }))
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => ({ fetchOwnedVehicles: vi.fn(async () => []) }) }))
vi.mock('@/hooks/useTradeLogisticsApi', () => ({
  useTradeLogisticsApi: () => ({
    listMyRequests: vi.fn(async () => state.requests),
    getRequest: vi.fn(async () => state.detail),
    findSailingMatches: vi.fn(async () => []),
    readChargeComponents: vi.fn(async (kind: string, id: string) => {
      state.readCalls.push({ kind, id })
      if (state.commercialsError) throw state.commercialsError
      return state.commercials
    }),
    compareQuotes: vi.fn(async (targets: unknown) => { state.compareCalls.push(targets); return state.comparison }),
    createRequest: vi.fn(), updateRequest: vi.fn(), publishRequest: vi.fn(),
    acceptQuote: vi.fn(), requestContainerSpace: vi.fn(), ensureConversation: vi.fn(),
  }),
}))

import TradeShippingRequests from './TradeShippingRequests'

const QUOTE = (id: string, provider: string) => ({
  id, provider_id: `p-${id}`, status: 'SUBMITTED', service_mode: 'shared_container',
  total_amount: 2400000, currency: 'JPY', freight_amount: null, handling_amount: null,
  origin_charges: null, destination_charges: null, documentation_fees: null,
  transit_days: 35, valid_until: null, pickup_included: null, delivery_included: null,
  inclusions: [], exclusions: [], conditions: null,
  provider: { display_name: provider, city: 'Yokohama', country: 'Japan' },
})

const REQUEST = {
  id: 'r1', reference: 'SHIP-T6-01', status: 'OPEN_FOR_QUOTES',
  origin_country: 'Japan', origin_city: 'Yokohama',
  destination_country: 'Zimbabwe', destination_city: 'Harare',
  service_preference: 'flexible', needed_by: null, accepted_quote_id: null, metadata: {},
  items: [{ id: 'i1', line_number: 1, cargo_category: 'vehicle', description: 'Toyota Alphard',
            quantity: 1, estimated_volume_cbm: 18, estimated_weight_kg: 2100 }],
  quotes: [QUOTE('q1', 'Kaizen Shipping')],
}

const COMMERCIALS = {
  components: [{
    id: 'c1', cost_stage: 'MAIN_CARRIAGE', stage_label: 'Ocean freight', label: 'Yokohama to Beira',
    original: { amount: 2400000, currency: 'JPY' },
    reference_usd: { amount: 15800, currency: 'USD' },
    fx: { status: 'AVAILABLE', rate_date: '2026-09-05', source: 'ECB' },
    inclusion: 'INCLUDED', commercial_status: 'FIRM', provenance: 'PROVIDER_STATED',
    revenue_class: 'PASS_THROUGH', is_carup_revenue: false,
  }],
  estimate: {
    known_included_by_currency: { JPY: 2400000 },
    known_included_reference_usd: 15800, reference_usd_incomplete: false,
    excluded: [], contingent: [], unpriced: [],
    missing_material_stages: [{ stage: 'DESTINATION_CLEARANCE', stage_label: 'Customs clearance in Zimbabwe' }],
    is_complete: false, carup_charges: [],
    customs_note: 'CarUp does not calculate duty or tax.',
  },
  breakdown: { computable: true, total: 2400000, currency: 'JPY', itemised: 2400000, not_itemised: 0,
               complete: true, note: 'The itemised charges account for the whole stated total.' },
}

const openDetail = async () => {
  render(<MemoryRouter><TradeShippingRequests /></MemoryRouter>)
  await waitFor(() => expect(screen.getByText('SHIP-T6-01')).toBeInTheDocument())
  screen.getByRole('button', { name: /Toyota Alphard/ }).click()
  await waitFor(() => expect(screen.getAllByTestId('logistics-offer-card').length).toBeGreaterThan(0))
}

beforeEach(() => {
  state.requests = [structuredClone(REQUEST)]
  state.detail = structuredClone(REQUEST)
  state.commercials = structuredClone(COMMERCIALS)
  state.commercialsError = null
  state.comparison = null
  state.readCalls = []
  state.compareCalls = []
})

describe('the requester sees what the offer actually covers', () => {
  it('renders the recorded breakdown inside the offer card', async () => {
    await openDetail()
    await waitFor(() => expect(screen.getByTestId('offer-commercials')).toBeInTheDocument())
    expect(screen.getByTestId('quote-breakdown')).toBeInTheDocument()
    expect(screen.getAllByTestId('quote-component')).toHaveLength(1)
    // Source money leads; USD is present only as a stated comparison.
    const text = screen.getByTestId('offer-commercials').textContent || ''
    expect(text).toContain('Ocean freight')
    expect(text).toContain('JPY')
  })

  it('reads the breakdown for the RIGHT quote, as a logistics quote', async () => {
    await openDetail()
    await waitFor(() => expect(screen.getByTestId('offer-commercials')).toBeInTheDocument())
    expect(state.readCalls).toEqual([{ kind: 'logistics-quotes', id: 'q1' }])
  })

  it('never calls a partly-priced offer a landed cost', async () => {
    await openDetail()
    await waitFor(() => expect(screen.getByTestId('landed-estimate')).toBeInTheDocument())
    const panel = screen.getByTestId('landed-estimate').textContent || ''
    expect(panel).toContain('Known estimated costs so far')
    expect(panel).not.toContain('Estimated landed cost')
    expect(screen.getByTestId('estimate-incomplete')).toBeInTheDocument()
    expect(screen.getByTestId('estimate-missing-stages').textContent).toContain('Customs clearance in Zimbabwe')
  })

  it('says an unreadable breakdown is unreadable — not that there is none', async () => {
    state.commercialsError = new Error('network')
    await openDetail()
    await waitFor(() => expect(screen.getByTestId('offer-commercials-unreadable')).toBeInTheDocument())
    const text = screen.getByTestId('offer-commercials-unreadable').textContent || ''
    expect(text).toContain('could not be read')
    expect(text).toContain('not a report that the provider gave none')
    expect(screen.queryByTestId('landed-estimate')).toBeNull()
  })

  it('says plainly when a provider recorded no breakdown at all, and shows no figure', async () => {
    state.commercials = { ...structuredClone(COMMERCIALS), components: [] }
    await openDetail()
    await waitFor(() => expect(screen.getByTestId('offer-commercials-none')).toBeInTheDocument())
    expect(screen.getByTestId('offer-commercials-none').textContent)
      .toContain('has not broken their price down')
    // No empty estimate panel implying zero.
    expect(screen.queryByTestId('landed-estimate')).toBeNull()
  })

  it('shows no cross-offer verdict for a single offer, and does not even ask', async () => {
    // Asking the server to compare one offer returned 400 on every single-offer request detail —
    // a failed request the customer paid for and nobody could see.
    await openDetail()
    await waitFor(() => expect(screen.getByTestId('offer-commercials')).toBeInTheDocument())
    expect(screen.queryByTestId('offer-comparison')).toBeNull()
    expect(screen.queryByTestId('offer-comparison-loading')).toBeNull()
    expect(screen.queryByTestId('offer-comparison-unreadable')).toBeNull()
    expect(state.compareCalls).toEqual([])
  })

  it('refuses to name a cheapest when two offers are not the same purchase', async () => {
    const two = structuredClone(REQUEST)
    two.quotes = [QUOTE('q1', 'Kaizen Shipping'), QUOTE('q2', 'Beira Lines')]
    state.requests = [two]; state.detail = two
    state.comparison = {
      quotes: [{ id: 'q1', label: 'Kaizen Shipping' }, { id: 'q2', label: 'Beira Lines' }],
      comparison: {
        comparable: false, verdict: 'NOT_COMPARABLE', cheapest: null,
        reasons: ['Beira Lines does not price customs clearance in Zimbabwe'],
      },
    }
    await openDetail()
    await waitFor(() => expect(screen.getByTestId('offer-comparison')).toBeInTheDocument())
    expect(screen.getByTestId('comparison-not-comparable').textContent)
      .toContain('not calling one of these cheaper')
    expect(screen.getByTestId('comparison-reasons').textContent)
      .toContain('does not price customs clearance')
    expect(screen.queryByTestId('comparison-lowest')).toBeNull()
  })
})
