/**
 * Intake 2.0 — what the requester sees about their OWN shipping request.
 *
 * Two gaps found by walking the deployed product, both fixed here:
 *
 *   1. A request with a submitted offer waiting read "Waiting for offers · Logistics providers can
 *      respond" — identical to a request nobody had answered. The customer could not tell from the
 *      list that anyone had responded.
 *   2. The read-only detail did not echo the customer's own private answers. They had typed a
 *      pickup address and contact; reviewing their own request, they could not see them without
 *      opening the editor. PRIVATE means private from PROVIDERS, never from the person who
 *      answered.
 *
 * The third thing proven here is the one most easily lost: an offer count that could not be READ
 * must stay silent, not render as "no offers".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'

const state = vi.hoisted(() => ({ requests: [] as unknown[], detail: null as unknown }))

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ loading: false, user: { id: 'req-1' } }) }))
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => ({ fetchOwnedVehicles: vi.fn(async () => []) }) }))
vi.mock('@/hooks/useTradeLogisticsApi', () => ({
  useTradeLogisticsApi: () => ({
    listMyRequests: vi.fn(async () => state.requests),
    getRequest: vi.fn(async () => state.detail),
    findSailingMatches: vi.fn(async () => []),
    createRequest: vi.fn(), updateRequest: vi.fn(), publishRequest: vi.fn(),
    acceptQuote: vi.fn(), requestContainerSpace: vi.fn(), ensureConversation: vi.fn(),
  }),
}))

import TradeShippingRequests from './TradeShippingRequests'

const REQUEST = {
  id: 'r1', reference: 'SHIP-TEST01', status: 'OPEN_FOR_QUOTES',
  origin_country: 'Japan', origin_city: 'Yokohama',
  destination_country: 'Zimbabwe', destination_city: 'Harare',
  service_preference: 'flexible', needed_by: null, accepted_quote_id: null, metadata: {},
  items: [{ id: 'i1', line_number: 1, cargo_category: 'vehicle', description: 'Toyota Alphard',
            quantity: 1, estimated_volume_cbm: 18, estimated_weight_kg: 2100 }],
  pickup_required: 'yes', origin_site_type: 'auction',
  destination_outcome: 'door_delivery', shipping_objective: 'non_running',
  timing_flexibility: 'somewhat_flexible', available_from: '2026-10-04',
  pickup_address: '12 Auction Row, Yokohama', pickup_contact_name: 'Kenji Sato',
  pickup_contact_phone: '+81 90 5555 0000', delivery_address: '4 Borrowdale, Harare',
  clearing_agent_name: 'Zambezi Clearing Ltd',
  quotes: [],
}

const renderList = async () => {
  render(<MemoryRouter><TradeShippingRequests /></MemoryRouter>)
  await waitFor(() => expect(screen.getByText('SHIP-TEST01')).toBeInTheDocument())
  return document.body.textContent || ''
}

beforeEach(() => {
  state.requests = [structuredClone(REQUEST)]
  state.detail = structuredClone(REQUEST)
})

describe('the list tells the customer an offer is waiting', () => {
  it('says how many offers there are to compare', async () => {
    state.requests = [{ ...structuredClone(REQUEST), offer_count: 2 }]
    await renderList()
    expect(screen.getByTestId('logistics-row-offer-count').textContent).toBe('2 offers to compare')
  })

  it('reads naturally for a single offer', async () => {
    state.requests = [{ ...structuredClone(REQUEST), offer_count: 1 }]
    await renderList()
    expect(screen.getByTestId('logistics-row-offer-count').textContent).toBe('1 offer to compare')
  })

  it('keeps the status note when nobody has answered yet', async () => {
    state.requests = [{ ...structuredClone(REQUEST), offer_count: 0 }]
    const text = await renderList()
    expect(screen.queryByTestId('logistics-row-offer-count')).toBeNull()
    expect(text).toContain('Logistics providers can respond')
    // A real zero is a real zero — but it is never announced as "0 offers".
    expect(text).not.toContain('0 offers')
  })

  it('stays silent when the count could not be read — unknown is not zero', async () => {
    // offer_count ABSENT means unreadable. Saying "no offers" here would be a claim we cannot make.
    const withoutCount: Record<string, unknown> = { ...structuredClone(REQUEST), offer_count: 1 }
    delete withoutCount.offer_count
    state.requests = [withoutCount]
    const text = await renderList()
    expect(screen.queryByTestId('logistics-row-offer-count')).toBeNull()
    expect(text).not.toContain('offers to compare')
    expect(text).not.toMatch(/no offers|0 offers/i)
  })
})

describe('the detail echoes the customer their own answers', () => {
  const openDetail = async () => {
    await renderList()
    const row = screen.getByRole('button', { name: /Toyota Alphard/ })
    row.click()
    await waitFor(() => expect(screen.getByTestId('logistics-own-answers')).toBeInTheDocument())
    return document.body.textContent || ''
  }

  it('shows the answers providers can see, and says so', async () => {
    const text = await openDetail()
    for (const shown of ['We collect it for you', 'Auction house', 'Delivered to your address',
                         'The vehicle does not run', 'Somewhat flexible', '2026-10-04']) {
      expect(text).toContain(shown)
    }
    expect(text).toContain('Providers see these, so they can price the job')
  })

  it('shows the customer their OWN private answers back', async () => {
    const priv = (await openDetail(), screen.getByTestId('logistics-own-private').textContent || '')
    for (const shown of ['12 Auction Row, Yokohama', 'Kenji Sato', '+81 90 5555 0000',
                         '4 Borrowdale, Harare', 'Zambezi Clearing Ltd']) {
      expect(priv).toContain(shown)
    }
  })

  it('is explicit that the private answers are not shown to browsing providers', async () => {
    await openDetail()
    const priv = screen.getByTestId('logistics-own-private').textContent || ''
    expect(priv).toContain('Kept private')
    expect(priv).toContain('Never shown to providers browsing your request')
    // …and honest that choosing a provider does share them.
    expect(priv).toContain('Shared with the provider you')
  })

  it('renders no raw enum value', async () => {
    const text = await openDetail()
    for (const raw of ['door_delivery', 'non_running', 'somewhat_flexible', 'origin_site_type',
                       'pickup_required', 'auction_house']) {
      expect(text).not.toContain(raw)
    }
  })

  it('omits the panel entirely when nothing was answered', async () => {
    const bare = {
      id: 'r1', reference: 'SHIP-TEST01', status: 'OPEN_FOR_QUOTES',
      origin_country: 'Japan', destination_country: 'Zimbabwe',
      service_preference: 'flexible', needed_by: null, accepted_quote_id: null, metadata: {},
      items: [{ id: 'i1', line_number: 1, cargo_category: 'vehicle', description: 'Toyota Alphard', quantity: 1 }],
      quotes: [],
    }
    state.requests = [bare]; state.detail = bare
    await renderList()
    screen.getByRole('button', { name: /Toyota Alphard/ }).click()
    await waitFor(() => expect(screen.getByTestId('logistics-request-detail')).toBeInTheDocument())
    expect(screen.queryByTestId('logistics-own-answers')).toBeNull()
  })
})
