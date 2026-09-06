/**
 * Trade OS T6 — the BUYER also sees the commercial breakdown.
 *
 * Sibling of TradeShippingRequests.t6.test.tsx. Procurement and logistics are two different
 * screens reading two different quote kinds, and the whole point of a shared commercial contract
 * is that they cannot drift into telling customers different truths about the same money. So the
 * same wiring is asserted here, against the real page, including that this surface asks for
 * `import-quotes` and not the logistics kind.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import React from 'react'

const state = vi.hoisted(() => ({
  order: null as unknown,
  commercials: null as unknown,
  commercialsError: null as Error | null,
  comparison: null as unknown,
  readCalls: [] as unknown[],
  compareCalls: [] as unknown[],
}))

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ loading: false, user: { id: 'buyer-1' } }) }))
vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchDiasporaBuyerOrder: vi.fn(async () => state.order),
    publishDiasporaRfq: vi.fn(),
    acceptDiasporaQuote: vi.fn(),
    readChargeComponents: vi.fn(async (kind: string, id: string) => {
      state.readCalls.push({ kind, id })
      if (state.commercialsError) throw state.commercialsError
      return state.commercials
    }),
    compareQuotes: vi.fn(async (targets: unknown) => { state.compareCalls.push(targets); return state.comparison }),
  }),
}))

import TradeRequestDetail from './TradeRequestDetail'

const QUOTE = (id: string, supplier: string) => ({
  id, status: 'ISSUED', quote_amount: 2400000, quote_currency: 'JPY',
  lead_time_days: 21, shipping_included: false, valid_until: null,
  offered_condition: 'used', offered_quantity: 1, unit_price: 2400000,
  inclusions: [], exclusions: [],
  supplier: { display_name: supplier, business_type: 'exporter', country: 'Japan' },
})

const ORDER = {
  id: 'o1', reference: 'RFQ-T6-01', rfq_lifecycle: 'QUOTED', metadata: { rfq: {} },
  request_lines: [{ id: 'l1', line_number: 1, description: 'Toyota Alphard', quantity: 1 }],
  quotes: [QUOTE('iq1', 'Kaizen Exports')],
}

const COMMERCIALS = {
  components: [{
    id: 'c1', cost_stage: 'GOODS', stage_label: 'The goods', label: 'Toyota Alphard',
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
    missing_material_stages: [{ stage: 'MAIN_CARRIAGE', stage_label: 'Ocean freight' }],
    is_complete: false, carup_charges: [],
    customs_note: 'CarUp does not calculate duty or tax.',
  },
  breakdown: { computable: true, total: 2400000, currency: 'JPY', itemised: 2400000,
               not_itemised: 0, complete: true, note: 'The itemised charges account for the whole stated total.' },
}

const open = async () => {
  render(
    <MemoryRouter initialEntries={['/diaspora/requests/o1']}>
      <Routes><Route path="/diaspora/requests/:id" element={<TradeRequestDetail />} /></Routes>
    </MemoryRouter>,
  )
  await waitFor(() => expect(screen.getAllByTestId('trade-offer-card').length).toBeGreaterThan(0))
}

beforeEach(() => {
  state.order = structuredClone(ORDER)
  state.commercials = structuredClone(COMMERCIALS)
  state.commercialsError = null
  state.comparison = null
  state.readCalls = []
  state.compareCalls = []
})

describe('the buyer sees what the supplier price actually covers', () => {
  it('renders the recorded breakdown inside the offer card', async () => {
    await open()
    await waitFor(() => expect(screen.getByTestId('offer-commercials')).toBeInTheDocument())
    expect(screen.getByTestId('quote-breakdown')).toBeInTheDocument()
    expect(screen.getAllByTestId('quote-component')).toHaveLength(1)
  })

  it('asks for the PROCUREMENT quote kind, not the logistics one', async () => {
    await open()
    await waitFor(() => expect(screen.getByTestId('offer-commercials')).toBeInTheDocument())
    expect(state.readCalls).toEqual([{ kind: 'import-quotes', id: 'iq1' }])
  })

  it('will not call a partly-priced purchase a landed cost', async () => {
    await open()
    await waitFor(() => expect(screen.getByTestId('landed-estimate')).toBeInTheDocument())
    const panel = screen.getByTestId('landed-estimate').textContent || ''
    expect(panel).toContain('Known estimated costs so far')
    expect(panel).not.toContain('Estimated landed cost')
    expect(screen.getByTestId('estimate-missing-stages').textContent).toContain('Ocean freight')
  })

  it('says an unreadable breakdown is unreadable — not that there is none', async () => {
    state.commercialsError = new Error('network')
    await open()
    await waitFor(() => expect(screen.getByTestId('offer-commercials-unreadable')).toBeInTheDocument())
    expect(screen.queryByTestId('landed-estimate')).toBeNull()
  })

  it('names a cheapest only when the offers are genuinely the same purchase', async () => {
    const two = structuredClone(ORDER)
    two.quotes = [QUOTE('iq1', 'Kaizen Exports'), QUOTE('iq2', 'Sakura Motors')]
    state.order = two
    state.comparison = {
      quotes: [{ id: 'iq1', label: 'Kaizen Exports' }, { id: 'iq2', label: 'Sakura Motors' }],
      comparison: { comparable: true, verdict: 'COMPARABLE', cheapest: 'iq2', reasons: [] },
    }
    await open()
    await waitFor(() => expect(screen.getByTestId('offer-comparison')).toBeInTheDocument())
    expect(screen.getByTestId('comparison-lowest').textContent).toContain('Sakura Motors')
    // Both offers are sent for comparison, each labelled by WHO is offering.
    expect(state.compareCalls[0]).toEqual([
      { id: 'iq1', kind: 'import', label: 'Kaizen Exports' },
      { id: 'iq2', kind: 'import', label: 'Sakura Motors' },
    ])
  })
})
