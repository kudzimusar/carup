/**
 * Trade OS T5 — what the requester's screen says about corridors, and their lifecycle controls.
 *
 * The one sentence this file exists to hold (master plan §40): a gateway sailing NEVER rewrites
 * the customer's destination. The screen must say "Your destination: Harare, Zimbabwe" and
 * "This sailing covers: Yokohama → Beira" — and must state the onward route as REQUIRED, never
 * as arranged. If a regression ever renders the customer's destination as Mozambique, this file
 * is what goes red.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'

const state = vi.hoisted(() => ({
  requests: [] as unknown[],
  detail: null as unknown,
  matches: [] as unknown[],
  calls: { cancel: 0, close: 0, matches: 0 },
  lifecycleError: null as string | null,
  // F1: when set, findSailingMatches hangs on this promise so a test can prove the page is
  // usable BEFORE discovery resolves. resolveMatches()/rejectMatches() release it.
  gate: null as null | { promise: Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void },
}))

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ loading: false, user: { id: 'req-1' } }) }))
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => ({ fetchOwnedVehicles: vi.fn(async () => []) }) }))
vi.mock('@/hooks/useTradeLogisticsApi', () => ({
  useTradeLogisticsApi: () => ({
    listMyRequests: vi.fn(async () => state.requests),
    getRequest: vi.fn(async () => state.detail),
    findSailingMatches: vi.fn(async () => {
      state.calls.matches += 1
      if (state.gate) return state.gate.promise
      return state.matches
    }),
    cancelRequest: vi.fn(async (id: string) => {
      state.calls.cancel += 1
      if (state.lifecycleError) throw new Error(state.lifecycleError)
      return { ...(state.detail as Record<string, unknown>), id, status: 'CANCELLED' }
    }),
    closeRequest: vi.fn(async (id: string) => {
      state.calls.close += 1
      if (state.lifecycleError) throw new Error(state.lifecycleError)
      return { ...(state.detail as Record<string, unknown>), id, status: 'CLOSED' }
    }),
    createRequest: vi.fn(), updateRequest: vi.fn(), publishRequest: vi.fn(),
    acceptQuote: vi.fn(), requestContainerSpace: vi.fn(), ensureConversation: vi.fn(),
    listTradeCorridors: vi.fn(async () => []),
  }),
}))

import TradeShippingRequests from './TradeShippingRequests'

const REQUEST = {
  id: 'r1', reference: 'SHIP-T5', status: 'OPEN_FOR_QUOTES',
  origin_country: 'Japan', origin_city: 'Yokohama',
  destination_country: 'Zimbabwe', destination_city: 'Harare',
  service_preference: 'flexible', needed_by: null, accepted_quote_id: null, metadata: {},
  items: [{ id: 'i1', line_number: 1, cargo_category: 'vehicle', description: 'Toyota Alphard',
            quantity: 1, estimated_volume_cbm: 18 }],
  quotes: [],
}

const GATEWAY_MATCH = {
  id: 'sail-1', organiser_name: 'Hikari Co-Load', origin_country: 'Japan', origin_city: 'Yokohama',
  destination_country: 'Mozambique', destination_city: 'Beira',
  origin_port: 'Yokohama', destination_port: 'Beira',
  departure_date: '2027-03-18T00:00:00Z', booking_deadline: '2027-03-10T00:00:00Z',
  container_type: '40HC', available_capacity_cbm: 42, requested_volume_cbm: 18, capacity_match: true,
  route_kind: 'gateway',
  corridor: { id: 'c1', code: 'JP-BEI-ZW', display_name: 'Japan → Beira → Zimbabwe', planning_status: 'benchmark_candidate' },
  sailing_leg: { sequence: 1, origin_country: 'Japan', origin_locality: 'Yokohama', destination_country: 'Mozambique', destination_locality: 'Beira' },
  onward_legs: [
    { sequence: 2, origin_country: 'Mozambique', origin_locality: 'Beira', destination_country: 'Zimbabwe', destination_locality: 'Forbes/Machipanda' },
    { sequence: 3, origin_country: 'Zimbabwe', origin_locality: 'Forbes/Machipanda', destination_country: 'Zimbabwe', destination_locality: 'Harare' },
  ],
  final_destination: { country: 'Zimbabwe', city: 'Harare' },
  match_reasons: ['Covers the Yokohama → Beira leg of the Japan → Beira → Zimbabwe corridor'],
  requires_operator_confirmation: true,
}

const openDetail = async () => {
  render(<MemoryRouter><TradeShippingRequests /></MemoryRouter>)
  await waitFor(() => expect(screen.getByText('SHIP-T5')).toBeInTheDocument())
  screen.getByRole('button', { name: /Toyota Alphard/ }).click()
  await waitFor(() => expect(screen.getByTestId('logistics-request-detail')).toBeInTheDocument())
  return document.body.textContent || ''
}

beforeEach(() => {
  state.requests = [structuredClone(REQUEST)]
  state.detail = structuredClone(REQUEST)
  state.matches = []
  state.calls = { cancel: 0, close: 0, matches: 0 }
  state.lifecycleError = null
  state.gate = null
})

const openGate = () => {
  let resolve!: (v: unknown) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<unknown>((res, rej) => { resolve = res; reject = rej })
  state.gate = { promise, resolve, reject }
}

describe('T5.9 — the critical UI truth on gateway sailings', () => {
  it('keeps the customer destination and names the leg, the corridor and the onward route', async () => {
    state.matches = [structuredClone(GATEWAY_MATCH)]
    await openDetail()
    const truth = await waitFor(() => screen.getByTestId('logistics-sailing-route-truth'))
    const text = (truth.textContent || '').replace(/\s+/g, ' ')
    expect(text).toContain('Your destination: Harare, Zimbabwe')
    // The sailing's own ports, not the corridor leg's country pair — §T5.9's "Ocean leg:
    // Yokohama → Beira", and it avoids stuttering against the corridor name beside it.
    expect(text).toContain('This sailing covers: Yokohama → Beira')
    expect(text).toContain('Japan → Beira → Zimbabwe corridor')
    expect(text).not.toContain('This sailing covers: Japan → Beira —')
    const onward = screen.getByTestId('logistics-sailing-onward').textContent || ''
    expect(onward).toContain('Then still required: Forbes/Machipanda → Harare')
    expect(onward).toContain('not part of this sailing, not yet arranged')
  })

  it('never presents the gateway country as the customer destination', async () => {
    state.matches = [structuredClone(GATEWAY_MATCH)]
    await openDetail()
    await waitFor(() => screen.getByTestId('logistics-sailing-route-truth'))
    const text = (document.body.textContent || '').replace(/\s+/g, ' ')
    expect(text).not.toMatch(/Your destination: [^H]*Mozambique/)
    expect(text).not.toContain('Destination: Mozambique')
  })

  it('a direct sailing reads as direct, with no corridor block', async () => {
    state.matches = [{ ...structuredClone(GATEWAY_MATCH),
      destination_country: 'Zimbabwe', destination_city: 'Harare', destination_port: null,
      route_kind: 'direct', corridor: null, sailing_leg: null, onward_legs: [],
      match_reasons: ['Origin and destination countries match'] }]
    await openDetail()
    await waitFor(() => screen.getByTestId('logistics-sailing-direct'))
    expect(screen.queryByTestId('logistics-sailing-route-truth')).toBeNull()
    expect(screen.queryByTestId('logistics-sailing-onward')).toBeNull()
  })

  it('a direct and a gateway sailing on the same departure never collapse into one card', async () => {
    state.matches = [
      structuredClone(GATEWAY_MATCH),
      { ...structuredClone(GATEWAY_MATCH), id: 'sail-2',
        destination_country: 'Zimbabwe', destination_city: 'Harare', destination_port: null,
        route_kind: 'direct', corridor: null, sailing_leg: null, onward_legs: [] },
    ]
    await openDetail()
    await waitFor(() => screen.getByTestId('logistics-sailing-route-truth'))
    expect(screen.getByTestId('logistics-sailing-direct')).toBeInTheDocument()
    expect(screen.getByTestId('logistics-sailing-route-truth')).toBeInTheDocument()
  })
})

describe('T5.7 — the lifecycle controls', () => {
  it('cancel is offered on an open request, and takes two clicks', async () => {
    await openDetail()
    const btn = screen.getByTestId('logistics-request-cancel')
    expect(btn.textContent).toContain('Cancel request')
    btn.click()
    await waitFor(() => expect(screen.getByTestId('logistics-request-cancel').textContent).toContain('Confirm — cancel'))
    expect(state.calls.cancel).toBe(0)
    screen.getByTestId('logistics-request-cancel').click()
    await waitFor(() => expect(state.calls.cancel).toBe(1))
  })

  it('after an acceptance the verb is CLOSE, not cancel', async () => {
    const awarded = { ...structuredClone(REQUEST), status: 'AWARDED', accepted_quote_id: 'q1' }
    state.requests = [awarded]; state.detail = awarded
    await openDetail()
    expect(screen.queryByTestId('logistics-request-cancel')).toBeNull()
    expect(screen.getByTestId('logistics-request-close')).toBeInTheDocument()
  })

  it('a concluded request offers neither verb', async () => {
    const closed = { ...structuredClone(REQUEST), status: 'CLOSED', accepted_quote_id: 'q1' }
    state.requests = [closed]; state.detail = closed
    await openDetail()
    expect(screen.queryByTestId('logistics-lifecycle-controls')).toBeNull()
  })

  it("the server's live-reservation refusal reaches the screen verbatim", async () => {
    state.lifecycleError = 'A live container-space booking is attached. Cancel it in Container space first — this request cannot discard capacity state it does not own.'
    await openDetail()
    screen.getByTestId('logistics-request-cancel').click()
    await waitFor(() => expect(screen.getByTestId('logistics-request-cancel').textContent).toContain('Confirm'))
    screen.getByTestId('logistics-request-cancel').click()
    await waitFor(() => expect((document.body.textContent || '')).toContain('Cancel it in Container space first'))
  })
})

describe('F1 — publishing must not wait on sailing discovery', () => {
  it('renders the request detail while matching is still running', async () => {
    openGate()                                   // discovery will not resolve until we say so
    render(<MemoryRouter><TradeShippingRequests /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('SHIP-T5')).toBeInTheDocument())
    screen.getByRole('button', { name: /Toyota Alphard/ }).click()

    // The page is fully usable with discovery still in flight.
    await waitFor(() => expect(screen.getByTestId('logistics-request-detail')).toBeInTheDocument())
    expect(screen.getByTestId('logistics-sailings-loading')).toBeInTheDocument()
    expect(screen.getByTestId('logistics-lifecycle-controls')).toBeInTheDocument()
    expect(document.body.textContent).toContain('Looking for compatible sailings')
  })

  it('never claims "none found" while the read is still pending', async () => {
    openGate()
    render(<MemoryRouter><TradeShippingRequests /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('SHIP-T5')).toBeInTheDocument())
    screen.getByRole('button', { name: /Toyota Alphard/ }).click()
    await waitFor(() => expect(screen.getByTestId('logistics-sailings-loading')).toBeInTheDocument())
    expect(screen.queryByTestId('logistics-sailings-empty')).toBeNull()
    expect(screen.queryByTestId('logistics-sailings-unreadable')).toBeNull()
    expect(document.body.textContent).not.toMatch(/No compatible open CarUp sailings/i)
  })

  it('later fills the SAME page in when matching succeeds', async () => {
    openGate()
    render(<MemoryRouter><TradeShippingRequests /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('SHIP-T5')).toBeInTheDocument())
    screen.getByRole('button', { name: /Toyota Alphard/ }).click()
    await waitFor(() => expect(screen.getByTestId('logistics-sailings-loading')).toBeInTheDocument())

    state.gate!.resolve([structuredClone(GATEWAY_MATCH)])
    await waitFor(() => expect(screen.getByTestId('logistics-sailing-route-truth')).toBeInTheDocument())
    // Same page — not a navigation.
    expect(screen.getByTestId('logistics-request-detail')).toBeInTheDocument()
    expect(screen.queryByTestId('logistics-sailings-loading')).toBeNull()
  })

  it('a FAILED discovery is unreadable-with-retry, never "no sailings"', async () => {
    openGate()
    render(<MemoryRouter><TradeShippingRequests /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('SHIP-T5')).toBeInTheDocument())
    screen.getByRole('button', { name: /Toyota Alphard/ }).click()
    await waitFor(() => expect(screen.getByTestId('logistics-sailings-loading')).toBeInTheDocument())

    state.gate!.reject(new Error('discovery unavailable'))
    await waitFor(() => expect(screen.getByTestId('logistics-sailings-unreadable')).toBeInTheDocument())
    expect(screen.queryByTestId('logistics-sailings-empty')).toBeNull()
    expect(document.body.textContent).toContain('not a report that none are available')
    expect(screen.getByTestId('logistics-sailings-retry')).toBeInTheDocument()
  })

  it('the retry re-runs discovery and can succeed', async () => {
    openGate()
    render(<MemoryRouter><TradeShippingRequests /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('SHIP-T5')).toBeInTheDocument())
    screen.getByRole('button', { name: /Toyota Alphard/ }).click()
    await waitFor(() => expect(screen.getByTestId('logistics-sailings-loading')).toBeInTheDocument())
    state.gate!.reject(new Error('discovery unavailable'))
    await waitFor(() => expect(screen.getByTestId('logistics-sailings-retry')).toBeInTheDocument())

    const before = state.calls.matches
    state.gate = null                                  // next call resolves normally
    state.matches = [structuredClone(GATEWAY_MATCH)]
    screen.getByTestId('logistics-sailings-retry').click()
    await waitFor(() => expect(screen.getByTestId('logistics-sailing-route-truth')).toBeInTheDocument())
    expect(state.calls.matches).toBe(before + 1)
  })

  it('an empty result really is empty — the honest states stay distinct', async () => {
    state.matches = []
    render(<MemoryRouter><TradeShippingRequests /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('SHIP-T5')).toBeInTheDocument())
    screen.getByRole('button', { name: /Toyota Alphard/ }).click()
    await waitFor(() => expect(screen.getByTestId('logistics-sailings-empty')).toBeInTheDocument())
    expect(screen.queryByTestId('logistics-sailings-loading')).toBeNull()
    expect(screen.queryByTestId('logistics-sailings-unreadable')).toBeNull()
  })
})

describe('F3 — both route strategies discoverable, with no ranking', () => {
  const departures = (n: number, kind: 'direct' | 'gateway') =>
    Array.from({ length: n }, (_, i) => kind === 'gateway'
      ? { ...structuredClone(GATEWAY_MATCH), id: `gw-${i}`, departure_date: `2027-0${(i % 9) + 1}-18T00:00:00Z`, origin_port: `Yokohama${i}` }
      : { ...structuredClone(GATEWAY_MATCH), id: `d-${i}`, departure_date: `2026-0${(i % 9) + 1}-18T00:00:00Z`,
          destination_country: 'Zimbabwe', destination_city: 'Harare', destination_port: `Harare${i}`, origin_port: `Yokohama${i}`,
          route_kind: 'direct', corridor: null, sailing_leg: null, onward_legs: [] })

  const open = async () => {
    render(<MemoryRouter><TradeShippingRequests /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('SHIP-T5')).toBeInTheDocument())
    screen.getByRole('button', { name: /Toyota Alphard/ }).click()
    await waitFor(() => expect(screen.getByTestId('logistics-request-detail')).toBeInTheDocument())
  }

  it('shows BOTH sections up front when the gateway option would have been buried', async () => {
    // Five direct sailings all departing before the gateway one: on a single departure-ordered
    // list the gateway option lands 6th, behind "Show more". That is what F3 fixes.
    state.matches = [...departures(5, 'direct'), ...departures(1, 'gateway')]
    await open()
    await waitFor(() => expect(screen.getByTestId('logistics-sailing-section-gateway')).toBeInTheDocument())
    expect(screen.getByTestId('logistics-sailing-section-direct')).toBeInTheDocument()
    // The gateway card itself is visible without expanding anything.
    expect(screen.getByTestId('logistics-sailing-route-truth')).toBeInTheDocument()
    expect(screen.getByTestId('logistics-sailing-disclosure')).toBeInTheDocument()
  })

  it('each category expands independently — opening one never hides the other', async () => {
    state.matches = [...departures(5, 'direct'), ...departures(5, 'gateway')]
    await open()
    await waitFor(() => expect(screen.getByTestId('logistics-sailing-toggle-direct')).toBeInTheDocument())
    expect(screen.getByTestId('logistics-sailing-toggle-gateway')).toBeInTheDocument()
    screen.getByTestId('logistics-sailing-toggle-direct').click()
    await waitFor(() => expect(screen.getByTestId('logistics-sailing-toggle-direct').textContent).toContain('Show fewer'))
    // the gateway section is untouched and still collapsed
    expect(screen.getByTestId('logistics-sailing-toggle-gateway').textContent).toContain('Show 2 more')
  })

  it('adds NO ranking language anywhere', async () => {
    state.matches = [...departures(3, 'direct'), ...departures(3, 'gateway')]
    await open()
    await waitFor(() => expect(screen.getByTestId('logistics-sailing-section-gateway')).toBeInTheDocument())
    const text = (document.body.textContent || '')
    for (const banned of ['Recommended', 'recommended', 'Best', 'Cheapest', 'cheapest', 'Fastest', 'fastest', 'Preferred', 'preferred', 'Top pick']) {
      expect(text).not.toContain(banned)
    }
    expect(text).toContain('CarUp does not rank them')
  })

  it('stays neutral across MULTIPLE gateway corridors — no corridor is elevated', async () => {
    const beira = { ...structuredClone(GATEWAY_MATCH), id: 'gw-bei', departure_date: '2027-03-01T00:00:00Z' }
    const durban = { ...structuredClone(GATEWAY_MATCH), id: 'gw-dur', departure_date: '2027-02-01T00:00:00Z',
      corridor: { id: 'c2', code: 'JP-DUR-ZW', display_name: 'Japan → Durban → Zimbabwe', planning_status: 'benchmark_candidate' },
      sailing_leg: { sequence: 1, origin_country: 'Japan', origin_locality: 'Yokohama', destination_country: 'South Africa', destination_locality: 'Durban' },
      destination_country: 'South Africa', destination_city: 'Durban', destination_port: 'Durban' }
    state.matches = [beira, durban]
    await open()
    await waitFor(() => expect(screen.getByTestId('logistics-sailing-section-gateway')).toBeInTheDocument())
    const section = screen.getByTestId('logistics-sailing-section-gateway').textContent || ''
    expect(section).toContain('Japan → Beira → Zimbabwe corridor')
    expect(section).toContain('Japan → Durban → Zimbabwe corridor')
    // Ordered by DEPARTURE DATE only — Durban (Feb) precedes Beira (Mar) because it sails first,
    // not because any corridor is favoured.
    expect(section.indexOf('Durban')).toBeLessThan(section.indexOf('Beira'))
    // planning_status must never become a display ordering or a badge
    expect(section).not.toContain('benchmark')
    expect(section).not.toContain('research_candidate')
  })

  it('departure ordering inside a category is deterministic', async () => {
    state.matches = [
      { ...structuredClone(GATEWAY_MATCH), id: 'g3', departure_date: '2027-05-01T00:00:00Z', origin_port: 'PortC' },
      { ...structuredClone(GATEWAY_MATCH), id: 'g1', departure_date: '2027-01-01T00:00:00Z', origin_port: 'PortA' },
      { ...structuredClone(GATEWAY_MATCH), id: 'g2', departure_date: '2027-03-01T00:00:00Z', origin_port: 'PortB' },
    ]
    await open()
    await waitFor(() => expect(screen.getByTestId('logistics-sailing-section-gateway')).toBeInTheDocument())
    const t = screen.getByTestId('logistics-sailing-section-gateway').textContent || ''
    expect(t.indexOf('PortA')).toBeLessThan(t.indexOf('PortB'))
    expect(t.indexOf('PortB')).toBeLessThan(t.indexOf('PortC'))
  })

  it('a single-category result needs no headings at all', async () => {
    state.matches = departures(2, 'direct')
    await open()
    await waitFor(() => expect(screen.getByTestId('logistics-sailing-section-direct')).toBeInTheDocument())
    expect(screen.queryByTestId('logistics-sailing-section-gateway')).toBeNull()
    expect(screen.queryByTestId('logistics-sailing-disclosure')).toBeNull()
    expect(document.body.textContent).not.toContain('Gateway corridor sailings')
  })
})
