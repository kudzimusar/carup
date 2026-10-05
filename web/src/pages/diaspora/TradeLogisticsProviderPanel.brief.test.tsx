/**
 * Intake 2.0 — the provider-facing request brief.
 *
 * Same defect class as the supplier card: the customer answered how the cargo must be handled,
 * whether the vehicle even runs, and what is declared inside it — and the provider's screen
 * showed route and volume only. A provider who cannot see "non-running, keys missing" prices a
 * RoRo sailing for cargo that needs winching into a container.
 *
 * Proven here: the quote-relevant facts render, they render in the PROVIDER's frame, declarations
 * are shown as customer statements rather than as CarUp acceptance, and — adversarially — a
 * payload carrying private facts still cannot put them on screen.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'

const state = vi.hoisted(() => ({ opportunities: [] as unknown[] }))

vi.mock('@/hooks/useTradeLogisticsApi', () => ({
  useTradeLogisticsApi: () => ({
    listOpportunities: vi.fn(async () => state.opportunities),
    listMyQuotes: vi.fn(async () => []),
    listOpenContainers: vi.fn(async () => []),
    createQuote: vi.fn(), updateQuote: vi.fn(), submitQuote: vi.fn(),
    withdrawQuote: vi.fn(), ensureConversation: vi.fn(),
  }),
}))

import TradeLogisticsProviderPanel from './TradeLogisticsProviderPanel'

const BASE = {
  id: 'lr1', reference: 'SHP-TEST01',
  origin_country: 'Japan', origin_city: 'Yokohama',
  destination_country: 'Zimbabwe', destination_city: 'Harare',
  needed_by: null, service_preference: 'flexible', quote_count: 0,
  pickup_required: 'yes', origin_site_type: 'auction',
  destination_outcome: 'door_delivery', shipping_objective: 'non_running',
  timing_flexibility: 'somewhat_flexible', available_from: '2026-10-04',
  items: [{
    id: 'i1', line_number: 1, cargo_category: 'vehicle', description: 'Toyota Alphard',
    quantity: 1, estimated_volume_cbm: 18, estimated_weight_kg: 2100,
    measurement_basis: 'CUSTOMER_ESTIMATED', has_linked_vehicle: false,
    packaging_type: 'loose', goods_nature: 'used',
    handling_flags: ['oversized', 'heavy_lift'], content_declarations: ['batteries'],
    vehicle_running_state: 'non_running', vehicle_keys_state: 'missing',
  }],
}

// The panel fails CLOSED: a caller without logistics_provider business_type renders nothing.
// That guard is deliberate, so the fixture supplies a real provider context.
const PROVIDER_CONTEXT = {
  business_type: 'logistics_provider',
  user: { id: 'prov-1', name: 'Synthetic Provider' },
  organisation: { id: 'org-1', name: 'Synthetic Logistics Ltd' },
} as unknown as Parameters<typeof TradeLogisticsProviderPanel>[0]['context']

const renderPanel = async () => {
  render(<MemoryRouter><TradeLogisticsProviderPanel context={PROVIDER_CONTEXT} /></MemoryRouter>)
  await waitFor(() => expect(screen.getByTestId('logistics-opportunity')).toBeInTheDocument())
  return document.body.textContent || ''
}

beforeEach(() => { state.opportunities = [structuredClone(BASE)] })

describe('provider brief — the facts that actually price the job', () => {
  it('shows the collection, destination and priority shape of the job', async () => {
    const text = await renderPanel()
    expect(screen.getByTestId('logistics-opportunity-brief')).toBeInTheDocument()
    for (const shown of ['Inland collection required', 'Auction house',
                         "Deliver to customer's address", 'Vehicle does not run',
                         'Somewhat flexible', '2026-10-04']) {
      expect(text).toContain(shown)
    }
  })

  it('warns that the vehicle cannot be driven and has no keys', async () => {
    const text = await renderPanel()
    expect(text).toContain('Non-running — needs winching')
    expect(text).toContain('Missing')
  })

  it('lists handling flags and content declarations', async () => {
    await renderPanel()
    expect(screen.getByTestId('logistics-opportunity-handling').textContent).toContain('Oversized')
    expect(screen.getByTestId('logistics-opportunity-handling').textContent).toContain('Heavy lift')
    expect(screen.getByTestId('logistics-opportunity-declarations').textContent).toContain('Batteries')
  })

  it('presents a declaration as a customer statement, never as CarUp acceptance', async () => {
    const decl = (await renderPanel(), screen.getByTestId('logistics-opportunity-declarations').textContent || '')
    expect(decl).toContain('customer-stated, confirm before carriage')
    expect(decl).not.toMatch(/approved|cleared for|certified|CarUp accepts/i)
  })

  it('renders no raw enum value', async () => {
    const text = await renderPanel()
    for (const raw of ['non_running', 'door_delivery', 'heavy_lift', 'origin_site_type',
                       'somewhat_flexible', 'vehicle_keys_state']) {
      expect(text).not.toContain(raw)
    }
  })

  it('omits the brief rather than printing an empty-answer wall', async () => {
    state.opportunities = [{ ...structuredClone(BASE),
      pickup_required: null, origin_site_type: null, destination_outcome: null,
      shipping_objective: null, timing_flexibility: null, available_from: null,
      items: [{ id: 'i1', line_number: 1, cargo_category: 'vehicle', description: 'Toyota Alphard',
                quantity: 1, estimated_volume_cbm: 18, estimated_weight_kg: 2100,
                measurement_basis: 'CUSTOMER_ESTIMATED', has_linked_vehicle: false }] }]
    await renderPanel()
    expect(screen.queryByTestId('logistics-opportunity-brief')).toBeNull()
  })
})

describe('adversarial — the provider panel cannot reintroduce withheld facts', () => {
  it('renders no private fact even when the API hands them over', async () => {
    state.opportunities = [{ ...structuredClone(BASE),
      pickup_address: 'LEAK 12 Auction Row', pickup_contact_name: 'LEAK Kenji',
      pickup_contact_phone: 'LEAK +81 90 0000', delivery_address: 'LEAK 4 Borrowdale',
      delivery_contact_phone: 'LEAK +263 77', consignee_name: 'LEAK Jane Moyo',
      clearing_agent_name: 'LEAK Agent Ltd', requester_id: 'u_LEAKREQUESTER',
      insurance_intent: 'LEAK_interested', payment_intent: 'LEAK_financing',
      items: [{ ...structuredClone(BASE).items[0],
                declared_value: 987654, declared_value_currency: 'LEAKUSD',
                linked_vehicle_vin: 'LEAKVIN123456789' }] }]
    const text = await renderPanel()
    expect(text).not.toMatch(/LEAK/)
    // Cargo value is commercial and useful to a thief — deliberately absent from the allow-list.
    expect(text).not.toContain('987654')
  })
})

describe('the panel fails closed', () => {
  it('renders nothing at all for a caller who is not a logistics provider', () => {
    render(<MemoryRouter><TradeLogisticsProviderPanel context={null} /></MemoryRouter>)
    expect(document.body.textContent).toBe('')
  })
})
