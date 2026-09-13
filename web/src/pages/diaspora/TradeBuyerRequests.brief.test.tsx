/**
 * Intake 2.0 — the supplier-facing request brief.
 *
 * This test exists because of a defect the deployed product had and every unit test missed:
 * the backend allow-list published the buyer's richer intake answers, the API returned them,
 * and the supplier card rendered NONE of them. A module being correct is not the same as a
 * module being wired, so the assertions below are deliberately about RENDERED TEXT.
 *
 * Two directions are proven, and both matter:
 *   1. the allow-listed facts a supplier needs in order to quote accurately DO reach the screen;
 *   2. adversarially — when the API is made to return the private facts as well, none of them
 *      can reach the screen. The projection is the boundary, but the UI must never be the thing
 *      that reintroduces what the projection withheld.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'

const state = vi.hoisted(() => ({ rfqs: [] as unknown[] }))

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ loading: false, user: { id: 'sup-1' } }) }))
vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchDiasporaRfqs: vi.fn(async () => state.rfqs),
    fetchDiasporaMyQuotes: vi.fn(async () => []),
    createDiasporaQuote: vi.fn(), updateDiasporaQuote: vi.fn(),
    submitDiasporaQuote: vi.fn(), withdrawDiasporaQuote: vi.fn(),
    ensureDiasporaRfqConversation: vi.fn(),
  }),
}))

import TradeBuyerRequests from './TradeBuyerRequests'

const SAFE_RFQ = {
  id: 'r1', reference: 'RFQ-TEST01', order_type: 'vehicle',
  requested_make: 'Toyota', requested_model: 'Alphard',
  requested_year_min: 2019, requested_year_max: 2022,
  origin_country: 'Japan', destination_country: 'Zimbabwe', destination_city: 'Harare',
  budget_amount: null, budget_currency: null, budget_disclosed: false,
  needed_by: null, urgency: null, buyer_notes: null,
  published_at: '2026-09-01T00:00:00Z', quote_deadline: null,
  destination_outcome: 'door_delivery', preferred_port: 'Beira',
  shipping_objective: 'lowest_cost', shipping_mode_preference: 'roro',
  alternatives_policy: 'supplier_may_propose', timing_flexibility: 'somewhat_flexible',
  requested_quote_components: ['item_price', 'ocean_freight', 'destination_clearing'],
  lines: [{
    id: 'l1', line_number: 1, item_kind: 'vehicle', item_description: 'Toyota Alphard',
    quantity: 1, vehicle_make: 'Toyota', vehicle_model: 'Alphard',
    part_number: null, part_number_known: false, condition_preference: 'any',
    vehicle_steering: 'rhd', vehicle_transmission: 'automatic', vehicle_drivetrain: '4wd_awd',
    vehicle_mileage_max_km: 80000, vehicle_seats_min: 7,
    accident_repair_tolerance: 'none', intended_use: 'personal_family',
    alternative_models: ['Toyota Vellfire'],
  }],
}

const renderPage = async () => {
  render(<MemoryRouter><TradeBuyerRequests /></MemoryRouter>)
  await waitFor(() => expect(screen.getByTestId('trade-opportunity-card')).toBeInTheDocument())
  return document.body.textContent || ''
}

beforeEach(() => { state.rfqs = [structuredClone(SAFE_RFQ)] })

describe('supplier request brief — the allow-listed facts reach the screen', () => {
  it('renders the buyer preferences a supplier quotes against', async () => {
    const text = await renderPage()
    expect(screen.getByTestId('trade-opportunity-brief')).toBeInTheDocument()
    for (const shown of ['Right-hand drive', 'Automatic', '4WD / AWD', '80,000 km', '7+',
                         'No accident repairs', 'Personal / family', 'Toyota Vellfire',
                         "Deliver to the buyer's address", 'Beira', 'Prioritises lowest reasonable cost',
                         'RoRo', 'You may propose alternatives', 'Somewhat flexible on timing']) {
      expect(text).toContain(shown)
    }
  })

  it('tells the supplier which costs the buyer wants priced', async () => {
    await renderPage()
    const line = screen.getByTestId('trade-opportunity-quote-components').textContent || ''
    expect(line).toContain('item price')
    expect(line).toContain('ocean freight')
    expect(line).toContain('destination clearing')
  })

  it('speaks in the supplier voice, never the buyer\'s own words', async () => {
    const text = await renderPage()
    // The buyer chose "Deliver it to my address"; a supplier reading "my address" would read it
    // as their own. Same fact, correct speaker.
    expect(text).not.toContain('Deliver it to my address')
    expect(text).not.toContain("I'm not sure — recommend options")
  })

  it('renders raw enum values for nothing it displays', async () => {
    const text = await renderPage()
    for (const raw of ['door_delivery', 'lowest_cost', '4wd_awd', 'personal_family',
                       'supplier_may_propose', 'somewhat_flexible', 'item_price']) {
      expect(text).not.toContain(raw)
    }
  })

  it('omits the brief entirely rather than printing an empty-answer wall', async () => {
    state.rfqs = [{ ...structuredClone(SAFE_RFQ),
      destination_outcome: null, preferred_port: null, shipping_objective: null,
      shipping_mode_preference: null, alternatives_policy: null, timing_flexibility: null,
      requested_quote_components: [],
      lines: [{ id: 'l1', line_number: 1, item_kind: 'vehicle', item_description: 'Toyota Alphard',
                quantity: 1, vehicle_make: 'Toyota', vehicle_model: 'Alphard',
                part_number: null, part_number_known: false, condition_preference: 'any' }] }]
    await renderPage()
    expect(screen.queryByTestId('trade-opportunity-brief')).toBeNull()
  })

  it('does not describe a vehicle as having an unknown part number', async () => {
    const text = await renderPage()
    expect(text).not.toContain('buyer does not know the part number')
  })

  it('still tells a parts supplier the part number is unknown', async () => {
    state.rfqs = [{ ...structuredClone(SAFE_RFQ),
      lines: [{ id: 'l1', line_number: 1, item_kind: 'part', item_description: 'Front shock absorber',
                quantity: 2, part_number: null, part_number_known: false,
                part_side: 'front', brand_preference: 'KYB' }] }]
    const text = await renderPage()
    expect(text).toContain('buyer does not know the part number')
    expect(text).toContain('KYB')
  })
})

describe('adversarial — the UI cannot reintroduce what the projection withheld', () => {
  it('renders no private fact even when the API hands them over', async () => {
    state.rfqs = [{ ...structuredClone(SAFE_RFQ),
      // None of these are in MARKETPLACE_SAFE_ORDER_FIELDS. A hostile/regressed backend is
      // simulated here; the card must still not print any of them.
      destination_area: 'LEAK_borrowdale', consignee_kind: 'LEAK_self',
      payment_intent: 'LEAK_financing_needed', clearing_intent: 'LEAK_want_provider',
      insurance_intent: 'LEAK_interested', inspection_intent: 'LEAK_please_arrange',
      budget_max_amount: 999111, budget_basis: 'LEAK_delivered', budget_flexibility: 'LEAK_firm',
      pickup_address: 'LEAK 12 Auction Row', pickup_contact_phone: 'LEAK +81 90 0000',
      delivery_address: 'LEAK 4 Borrowdale', consignee_name: 'LEAK Jane Moyo',
      clearing_agent_name: 'LEAK Agent Ltd', buyer_id: 'u_LEAKBUYERID',
      metadata: { secret: 'LEAK_metadata' },
    }]
    const text = await renderPage()
    expect(text).not.toMatch(/LEAK/)
    expect(text).not.toContain('999111')
  })

  it('keeps an undisclosed budget undisclosed', async () => {
    state.rfqs = [{ ...structuredClone(SAFE_RFQ), budget_amount: 26000, budget_disclosed: false }]
    const text = await renderPage()
    expect(text).not.toContain('26000')
    expect(text).toContain('Not disclosed')
  })
})
