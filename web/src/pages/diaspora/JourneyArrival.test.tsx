/**
 * T11-CAP-03 — what the Journey & Arrival page is allowed to CLAIM.
 *
 * Same discipline as the T11 tracking page: every failure guarded here is a customer reading a date,
 * a reference, an empty section or a missing field and concluding something nobody recorded.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import React from 'react'

const state = vi.hoisted(() => ({ view: null as unknown, err: null as Error | null }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ loading: false, user: { id: 'u1' } }) }))
vi.mock('@/hooks/useTradeLogisticsApi', () => ({
  useTradeLogisticsApi: () => ({
    getJourney: vi.fn(async () => { if (state.err) throw state.err; return state.view }),
  }),
}))

import JourneyArrival from './JourneyArrival'

const ORDER = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const NOT_COMPOSED = (owner: string) => ({ availability: 'not_yet_composed', owner })

const dates = (over = {}) => ({
  planned_departure: '2026-09-20T00:00:00Z',
  planned_departure_source: 'stated_at_creation',
  observed_departure: null,
  estimated_arrival: '2026-10-01T00:00:00Z',
  observed_arrival: null,
  note: 'A planned departure is an intention. An estimated arrival is an estimate. Only the observed dates are records of something that happened.',
  ...over,
})

const journey = (over: Record<string, unknown> = {}) => ({
  subject: { type: 'import_order', id: ORDER, order_id: ORDER },
  viewer: { kind: 'OWNER' },
  state: 'SHIPMENT_CREATED',
  sentence: 'A shipment has been set up. Nothing has been recorded as moving yet.',
  asset: { make: 'Make', model: 'Model', year: 2018, color: 'Pearl', mileage: 1000, source: 'vehicles', chassis_number: 'CH-A', engine_number: 'ENG-A' },
  transaction: { order_id: ORDER, status: 'SHIPPED', origin_country: 'Japan', origin_city: null, destination_country: 'Zimbabwe', destination_city: null },
  shipping: {
    association: 'order',
    reference: 'SHPM-ABCD1234',
    dates: dates(),
    references: {
      carrier: 'Carrier X', tracking_reference: 'TRK-1', origin_port: 'Origin Port', destination_port: 'Dest Port',
      note: 'A carrier or tracking reference means the paperwork exists. It is not a record that anything has moved.',
    },
    legs: NOT_COMPOSED('T11'),
  },
  timeline: [],
  exceptions: [],
  contacts: { consignee: { recorded: true, kind: 'another_person', name: 'Consignee Name', phone: '+000' }, agents: NOT_COMPOSED('T12') },
  sections: {
    documents: NOT_COMPOSED('T8'), customs: NOT_COMPOSED('T12'), payments: NOT_COMPOSED('T13'),
    notifications: NOT_COMPOSED('T7'), actions: NOT_COMPOSED('derived'),
  },
  provenance: {
    asset: { authority: 'vehicles' }, transaction: { authority: 'T4' }, journey: { authority: 'T11 + T10 (derived, read-only)' },
    shipping: { authority: 'T11', association: 'order' }, timeline: { authority: 'T11 + T10' }, contacts: { authority: 'intake (T3)' },
  },
  generated_at: '2026-10-25T00:00:00Z',
  note: 'This is a composition of records owned elsewhere. It records nothing and decides nothing.',
  ...over,
})

const open = async () => {
  render(
    <MemoryRouter initialEntries={[`/diaspora/journey/import_order/${ORDER}`]}>
      <Routes><Route path="/diaspora/journey/:subjectType/:subjectId" element={<JourneyArrival />} /></Routes>
    </MemoryRouter>,
  )
  await waitFor(() => expect(screen.getByTestId('journey-page')).toBeInTheDocument())
}

beforeEach(() => { state.err = null; state.view = journey() })

describe('the header says what is known and no more', () => {
  it('shows the recorded vehicle, the route and the truthful state', async () => {
    await open()
    expect(screen.getByTestId('journey-title')).toHaveTextContent('2018 Make Model')
    expect(screen.getByTestId('journey-route')).toHaveTextContent('Origin Port → Dest Port')
    expect(screen.getByTestId('journey-sentence')).toHaveTextContent('Nothing has been recorded as moving yet')
    expect(screen.getByTestId('journey-badge')).toHaveTextContent(/nothing moving yet/i)
  })

  it('says "Your vehicle" when no vehicle is recorded, and does not show a request as one', async () => {
    state.view = journey({ asset: { make: null, model: null, year: null, color: null, mileage: null, source: 'unknown' } })
    await open()
    expect(screen.getByTestId('journey-title')).toHaveTextContent('Your vehicle')
  })

  it('shows only a short reference, never the full order id', async () => {
    await open()
    expect(screen.getByTestId('journey-page')).not.toHaveTextContent(ORDER)
  })

  it('states when nothing has been recorded as moving', async () => {
    await open()
    expect(screen.getByTestId('journey-last-update')).toHaveTextContent(/no movement has been recorded/i)
  })
})

describe('a plan is not a departure, and an estimate is not an arrival', () => {
  it('does not say departed when only a planned date exists', async () => {
    await open()
    expect(screen.getByTestId('journey-departure-headline')).toHaveTextContent('Not recorded as departed')
    expect(screen.getByTestId('journey-departure-detail')).toHaveTextContent('That is a plan, not a record that it left')
  })

  it('does not say arrived for a past estimate', async () => {
    state.view = journey({ shipping: { ...journey().shipping, dates: dates({ estimated_arrival: '2020-01-01T00:00:00Z' }) } })
    await open()
    expect(screen.getByTestId('journey-arrival-headline')).toHaveTextContent('Not recorded as arrived')
    expect(screen.getByTestId('journey-arrival-detail')).toHaveTextContent(/not a record that anything arrived/i)
  })

  it('says departed once a departure was observed', async () => {
    state.view = journey({ state: 'IN_TRANSIT', sentence: 'The shipment has left and is on its way.',
      shipping: { ...journey().shipping, dates: dates({ observed_departure: '2026-09-21T08:00:00Z' }) } })
    await open()
    expect(screen.getByTestId('journey-departure-headline')).toHaveTextContent(/^Departed/)
  })

  it('labels a carrier reference as paperwork, not movement', async () => {
    await open()
    expect(screen.getByTestId('journey-reference-note')).toHaveTextContent(/not a record that anything has moved/i)
  })

  it('shows "Not recorded" for a missing reference instead of a dash or a zero', async () => {
    state.view = journey({ shipping: { ...journey().shipping, references: { ...journey().shipping.references, carrier: null, tracking_reference: null } } })
    await open()
    expect(within(screen.getByTestId('journey-references')).getAllByText('Not recorded').length).toBeGreaterThanOrEqual(2)
  })
})

describe('exceptions and ambiguity are stated, not hidden', () => {
  it('fails closed and says so when more than one shipment could match', async () => {
    state.view = journey({
      state: 'SHIPMENT_AMBIGUOUS', sentence: 'More than one shipment could match this order, so no movement is shown until that is resolved.',
      shipping: { association: 'ambiguous', candidate_count: 2, dates: null, references: null, legs: NOT_COMPOSED('T11') },
      exceptions: [{ code: 'SHIPMENT_AMBIGUOUS', note: 'More than one shipment could match this order. No movement is shown until that is resolved.' }],
    })
    await open()
    expect(screen.getByTestId('journey-exception-SHIPMENT_AMBIGUOUS')).toBeInTheDocument()
    expect(screen.queryByTestId('journey-departure')).toBeNull()
    expect(screen.queryByTestId('journey-references')).toBeNull()
  })

  it('does not turn a customs hold into a customs decision', async () => {
    state.view = journey({ state: 'EXCEPTION', sentence: 'Something has happened.', exceptions: [{ code: 'SHIPMENT_EXCEPTION', stage: 'CUSTOMS_HOLD', recorded_at: '2026-09-25T00:00:00Z', note: 'This is what the organiser recorded about this shipment. It is not a customs decision.' }] })
    await open()
    expect(screen.getByTestId('journey-exception-SHIPMENT_EXCEPTION')).toHaveTextContent(/not a customs decision/i)
  })

  it('explains a container association without naming another order', async () => {
    state.view = journey({ shipping: { ...journey().shipping, association: 'container' } })
    await open()
    expect(screen.getByTestId('journey-association')).toHaveTextContent(/container/i)
  })
})

describe('the timeline carries its source', () => {
  it('lists events with a plain-language source and no raw ids', async () => {
    state.view = journey({ timeline: [
      { kind: 'LOAD', stage: 'LOADED', event_time: '2026-09-12T10:00:00Z', location: null, source: 'T10' },
      { kind: 'MOVEMENT', stage: 'IN_TRANSIT', event_time: '2026-09-21T08:00:00Z', location: 'Port', source: null },
    ] })
    await open()
    const items = within(screen.getByTestId('journey-timeline')).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent(/loading/i)
    expect(items[1]).toHaveTextContent(/source not stated/i)
    expect(screen.getByTestId('journey-last-update')).toHaveTextContent(/on its way/i)
  })
})

describe('vessel legs are not claimed', () => {
  it('says vessel and voyage details are not available instead of showing an empty list', async () => {
    await open()
    expect(screen.getByTestId('journey-legs-note')).toHaveTextContent(/not (yet )?(shown|available|connected)/i)
  })
})

describe('sections that are not yet composed do not read as complete', () => {
  it.each([['documents', /documents/i], ['payments', /payments/i], ['customs', /customs/i], ['messages', /messages|updates/i]])(
    'the %s tab says it is not connected, not that it is empty', async (tab, word) => {
      await open()
      fireEvent.click(screen.getByRole('tab', { name: new RegExp(`^${tab}$`, 'i') }))
      const panel = screen.getByTestId('journey-section-note')
      expect(panel).toHaveTextContent(word)
      expect(panel).toHaveTextContent(/not (yet )?(shown|connected|available|listed)/i)
      expect(panel).not.toHaveTextContent(/\bno (documents|payments|messages)\b/i)
    })

  it('says an empty next-steps list is not an all-clear', async () => {
    await open()
    expect(screen.getByTestId('journey-actions-note')).toHaveTextContent(/does not mean/i)
  })
})

describe('the vehicle tab respects who is looking', () => {
  it('shows recorded fields, and "Not recorded" for the rest', async () => {
    state.view = journey({ asset: { make: 'Make', model: 'Model', year: 2018, color: null, mileage: null, source: 'vehicles', chassis_number: 'CH-A', engine_number: null } })
    await open()
    fireEvent.click(screen.getByRole('tab', { name: /^vehicle$/i }))
    const panel = screen.getByTestId('journey-vehicle')
    expect(panel).toHaveTextContent('Make')
    expect(panel).toHaveTextContent('CH-A')
    expect(within(panel).getAllByText('Not recorded').length).toBeGreaterThanOrEqual(2)
  })

  it('does not render chassis or engine rows when the service did not send them', async () => {
    state.view = journey({ viewer: { kind: 'PARTICIPANT' }, asset: { make: 'Make', model: 'Model', year: 2018, color: 'Pearl', mileage: 1, source: 'vehicles' }, contacts: { consignee: null, agents: NOT_COMPOSED('T12') } })
    await open()
    fireEvent.click(screen.getByRole('tab', { name: /^vehicle$/i }))
    expect(screen.queryByText(/chassis/i)).toBeNull()
    expect(screen.queryByTestId('journey-consignee')).toBeNull()
  })

  it('shows the consignee, labelled private, only when the service sent it', async () => {
    await open()
    fireEvent.click(screen.getByRole('tab', { name: /^vehicle$/i }))
    expect(screen.getByTestId('journey-consignee')).toHaveTextContent('Consignee Name')
    expect(screen.getByTestId('journey-consignee')).toHaveTextContent(/only you/i)
  })
})

describe('provenance is shown in words', () => {
  it('lists where each part comes from, without engineer codes', async () => {
    await open()
    const box = screen.getByTestId('journey-provenance')
    expect(box).toHaveTextContent(/shipment record/i)
    expect(box).not.toHaveTextContent(/\bT11\b|\bT10\b|\bT4\b/)
  })
})

describe('when it cannot be read', () => {
  it('says so, and that this is not a report that nothing has happened', async () => {
    state.err = new Error('You do not have access to this journey')
    render(
      <MemoryRouter initialEntries={[`/diaspora/journey/import_order/${ORDER}`]}>
        <Routes><Route path="/diaspora/journey/:subjectType/:subjectId" element={<JourneyArrival />} /></Routes>
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByTestId('journey-unreadable')).toBeInTheDocument())
    expect(screen.getByTestId('journey-unreadable')).toHaveTextContent('That is not a report that nothing has happened.')
  })
})

describe('accessibility', () => {
  it('exposes the tabs as a tablist with one selected tab', async () => {
    await open()
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    const selected = screen.getAllByRole('tab').filter((t) => t.getAttribute('aria-selected') === 'true')
    expect(selected).toHaveLength(1)
    expect(selected[0]).toHaveTextContent('Journey')
  })
})

describe('CAP-04: declared vessel legs', () => {
  const legsComposed = (items: unknown[]) => ({
    availability: 'composed', items,
    note: items.length
      ? 'Vessel and voyage details are declared, not observed. They do not record that the vessel sailed or arrived.'
      : 'No vessel or voyage has been declared for this shipment.',
  })
  const L = (over = {}) => ({
    sequence: 1, carrier_name: 'Declared Carrier', vessel_name: 'DECLARED VESSEL', voyage_ref: 'V-9', imo: '9074729', mmsi: null,
    port_of_loading: 'Port A', port_of_discharge: 'Port B', planned_departure: '2026-08-29T00:00:00Z', estimated_arrival: '2026-09-18T00:00:00Z',
    source: 'OPERATOR_DECLARED', ...over,
  })
  const withLegs = (legs: unknown) => journey({ shipping: { ...journey().shipping, legs } })

  it('lists declared legs in order, with plan and estimate worded as such', async () => {
    state.view = withLegs(legsComposed([L(), L({ sequence: 2, vessel_name: 'FEEDER VESSEL', voyage_ref: null, port_of_loading: 'Port B', port_of_discharge: 'Port C' })]))
    await open()
    const items = within(screen.getByTestId('journey-legs')).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Leg 1 · DECLARED VESSEL · voyage V-9')
    expect(items[0]).toHaveTextContent('Port A → Port B')
    expect(items[0]).toHaveTextContent(/Planned departure /)
    expect(items[0]).toHaveTextContent(/Estimated arrival /)
    expect(items[1]).toHaveTextContent('Leg 2 · FEEDER VESSEL')
  })

  it('labels the vessel details as declared, and never words a leg as a departure', async () => {
    state.view = withLegs(legsComposed([L()]))
    await open()
    expect(screen.getByTestId('journey-legs-note')).toHaveTextContent(/declared, not observed/i)
    // The explanatory note legitimately says a leg does NOT record that a vessel sailed or arrived, so
    // the guard is on the leg entries themselves.
    for (const entry of within(screen.getByTestId('journey-legs')).getAllByRole('listitem')) {
      expect(entry).not.toHaveTextContent(/\bdeparted\b|\barrived\b|\bsailed\b/i)
    }
  })

  it('says no vessel has been declared when it looked and found none — not that it is unavailable', async () => {
    state.view = withLegs(legsComposed([]))
    await open()
    expect(screen.getByTestId('journey-legs-note')).toHaveTextContent(/no vessel or voyage has been declared/i)
    expect(screen.getByTestId('journey-legs-note')).not.toHaveTextContent(/not (yet )?(available|connected)/i)
  })

  it('shows no legs card at all where legs are not applicable', async () => {
    state.view = withLegs({ availability: 'not_applicable' })
    await open()
    expect(screen.queryByTestId('journey-legs')).toBeNull()
    expect(screen.queryByTestId('journey-legs-note')).toBeNull()
  })

  it('shows an MMSI without inventing an IMO beside it', async () => {
    state.view = withLegs(legsComposed([L({ imo: null, mmsi: '123456789' })]))
    await open()
    const legs = screen.getByTestId('journey-legs')
    expect(legs).toHaveTextContent('MMSI 123456789')
    expect(legs).not.toHaveTextContent(/IMO/)
    expect(legs).not.toHaveTextContent(/null|undefined/)
  })

  it('shows an IMO number only when it was recorded', async () => {
    state.view = withLegs(legsComposed([L({ imo: null })]))
    await open()
    expect(screen.getByTestId('journey-legs')).not.toHaveTextContent(/IMO/)
    state.view = withLegs(legsComposed([L()]))
    await open()
  })

  it('surfaces a port disagreement as an alert in words', async () => {
    state.view = journey({
      shipping: { ...journey().shipping, legs: legsComposed([L()]) },
      exceptions: [{ code: 'LEG_PORT_MISMATCH', note: 'The vessel details name different ports than the shipment record. The records disagree.' }],
    })
    await open()
    expect(screen.getByTestId('journey-exception-LEG_PORT_MISMATCH')).toHaveTextContent(/disagree/i)
  })
})
