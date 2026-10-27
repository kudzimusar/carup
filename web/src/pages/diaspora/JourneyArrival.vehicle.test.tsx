/**
 * T11-CAP-LR01-R1 — the Journey page is for ANY vehicle, and says only what that vehicle's records say.
 *
 * Two real DATA SHAPES drive it here, the way two real vehicles will in production:
 *
 *   · a vehicle that is mid-journey with PLAN-ONLY evidence (a declared vessel, planned dates, an estimate,
 *     nothing observed, no documents, no customs) — it must not read as departed, arrived or cleared;
 *   · a vehicle that has NO Trade OS history at all — it must not crash, must not look empty-but-fine,
 *     and must not borrow anybody's shipment.
 *
 * Fixtures are synthetic structural shapes, not UAT evidence.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import React from 'react'

const state = vi.hoisted(() => ({ view: null as unknown }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ loading: false, user: { id: 'u1' } }) }))
vi.mock('@/hooks/useTradeLogisticsApi', () => ({
  useTradeLogisticsApi: () => ({
    getJourney: vi.fn(async () => state.view),
    // R3: the page also asks which vehicle the order carries (to offer the Vehicle Passport). These R2 tests are about the journey's content, so: none.
    getOrderVehicle: vi.fn(async () => null),
  }),
}))

import JourneyArrival from './JourneyArrival'

const NOT_YET = (owner: string) => ({ availability: 'not_yet_composed', owner })
const NA = { availability: 'not_applicable' }
const NOTE = 'This is a composition of records owned elsewhere. It records nothing and decides nothing.'
const VIN_A = 'VIN-PLAN-ONLY-1'
const VIN_B = 'VIN-NO-HISTORY-2'
const ORDER = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

const planOnly = () => ({
  subject: { type: 'vehicle', id: VIN_A, order_id: ORDER },
  viewer: { kind: 'OWNER' },
  state: 'SHIPMENT_CREATED',
  sentence: 'A shipment has been set up. Nothing has been recorded as moving yet.',
  asset: { make: 'AlphaMake', model: 'AlphaModel', year: 2018, color: 'Pearl', mileage: 134741, source: 'vehicles', chassis_number: 'CH-ALPHA', engine_number: 'EN-ALPHA' },
  transaction: { order_id: ORDER, status: 'IMPORT_REQUESTED', origin_country: 'Origin', origin_city: null, destination_country: 'Dest', destination_city: null },
  shipping: {
    association: 'order',
    reference: 'SHPM-ABCD1234',
    dates: {
      planned_departure: '2026-08-29T00:00:00Z', planned_departure_source: 'stated_at_creation', observed_departure: null,
      estimated_arrival: '2026-09-18T00:00:00Z', observed_arrival: null, note: 'plan vs record',
    },
    references: { carrier: 'Carrier Alpha', tracking_reference: null, origin_port: 'Port Origin', destination_port: 'Port Discharge', note: 'x' },
    legs: {
      availability: 'composed',
      items: [{
        sequence: 1, carrier_name: 'Carrier Alpha', vessel_name: 'VESSEL ALPHA (V-1)', voyage_ref: null, imo: null, mmsi: null,
        port_of_loading: 'Port Origin', port_of_discharge: 'Port Discharge', planned_departure: '2026-08-29T00:00:00Z', estimated_arrival: '2026-09-18T00:00:00Z',
        source: 'OPERATOR_DECLARED', source_reference: 'x',
      }],
      note: 'Vessel and voyage details are declared, not observed. They do not record that the vessel sailed or arrived.',
    },
    eta: {
      availability: 'composed', basis: 'shipment_record', original: '2026-09-18T00:00:00Z', current: '2026-09-18T00:00:00Z',
      change_days: null, revision_count: 0, last_revised_at: null, revisions: [], note: 'n',
    },
  },
  timeline: [],
  exceptions: [],
  contacts: { consignee: { recorded: false, kind: null, name: null, phone: null }, agents: NA },
  sections: {
    documents: { availability: 'composed', summary: { total: 6, missing: 6 }, items: [], disclaimer: 'd', note: 'n' },
    customs: { availability: 'composed', state: 'NOT_STARTED', checklist: [], timeline: [], note: 'n' },
    payments: NOT_YET('T13'), notifications: NOT_YET('T7'),
    actions: { availability: 'composed', items: [], note: 'Steps are listed only where a record says someone must act. An empty list does not mean nothing is needed.' },
    intelligence: NA,
  },
  provenance: { asset: { authority: 'vehicles' }, shipping: { authority: 'T11', association: 'order' } },
  generated_at: '2026-10-25T00:00:00Z',
  note: NOTE,
})

const noHistory = () => ({
  subject: { type: 'vehicle', id: VIN_B, order_id: null },
  viewer: { kind: 'OWNER' },
  state: 'NO_TRANSACTION',
  sentence: 'No import order or shipment is recorded for this vehicle that you can view, so there is no journey to show yet.',
  asset: { make: 'BravoMake', model: 'BravoModel Highway', year: 2016, color: 'Maroon', mileage: 63000, source: 'vehicles', chassis_number: 'CH-BRAVO', engine_number: 'EN-BRAVO' },
  transaction: null,
  shipping: null,
  timeline: [],
  exceptions: [],
  contacts: null,
  sections: { payments: NOT_YET('T13'), notifications: NOT_YET('T7'), documents: NA, actions: NA, customs: NA, intelligence: NA },
  provenance: { asset: { authority: 'vehicles' } },
  note: NOTE,
})

const open = async (path: string) => {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/diaspora/journey/:subjectType/:subjectId" element={<JourneyArrival />} /></Routes>
    </MemoryRouter>,
  )
  await waitFor(() => expect(screen.getByTestId('journey-page')).toBeInTheDocument())
}

beforeEach(() => { state.view = planOnly() })

describe('a vehicle with plan-only evidence is not made to look further along than its records', () => {
  it('shows the vehicle, the route, and says nothing has been recorded as moving', async () => {
    await open(`/diaspora/journey/vehicle/${VIN_A}`)
    expect(screen.getByTestId('journey-title')).toHaveTextContent('2018 AlphaMake AlphaModel')
    expect(screen.getByTestId('journey-route')).toHaveTextContent('Port Origin → Port Discharge')
    expect(screen.getByTestId('journey-badge')).toHaveTextContent(/nothing moving yet/i)
  })

  it('words the plan as a plan, the estimate as an estimate, and an unobserved arrival as unobserved', async () => {
    await open(`/diaspora/journey/vehicle/${VIN_A}`)
    expect(screen.getByTestId('journey-departure-headline')).toHaveTextContent('Not recorded as departed')
    expect(screen.getByTestId('journey-departure-detail')).toHaveTextContent(/plan, not a record that it left/i)
    expect(screen.getByTestId('journey-arrival-headline')).toHaveTextContent('Not recorded as arrived')
    const page = screen.getByTestId('journey-page').textContent || ''
    expect(page).not.toMatch(/\bDeparted\b/)
    expect(page).not.toMatch(/\bArrived\b(?! at)/)
    expect(page).not.toMatch(/\bcleared\b|\breleased\b|\bdelivered\b/i)
  })

  it('says plainly that NO estimate revision exists — it does not hide the section or invent a history', async () => {
    await open(`/diaspora/journey/vehicle/${VIN_A}`)
    expect(screen.getByTestId('journey-eta-no-revisions')).toHaveTextContent(/no change to this estimate has been recorded/i)
    expect(screen.queryByTestId('journey-eta')).toBeNull()
  })

  it('does not call a missing estimate "the estimate on the shipment record"', async () => {
    const v = planOnly() as unknown as { shipping: { dates: { estimated_arrival: string | null }; eta: unknown } }
    v.shipping.dates.estimated_arrival = null
    v.shipping.eta = { availability: 'composed', basis: 'none', original: null, current: null, change_days: null, revision_count: 0, last_revised_at: null, revisions: [], note: 'n' }
    state.view = v
    await open(`/diaspora/journey/vehicle/${VIN_A}`)
    expect(screen.queryByTestId('journey-eta-no-revisions')).toBeNull()
  })

  it('shows the declared vessel as declared, with no extra leg', async () => {
    await open(`/diaspora/journey/vehicle/${VIN_A}`)
    const legs = screen.getByTestId('journey-legs')
    expect(legs).toHaveTextContent('VESSEL ALPHA (V-1)')
    expect(screen.getByTestId('journey-legs-note')).toHaveTextContent(/declared, not observed/i)
    expect(legs.querySelectorAll('ol > li')).toHaveLength(1)
  })

  it('names the vehicle’s order only by a short reference, never the full id or the VIN as a reference', async () => {
    await open(`/diaspora/journey/vehicle/${VIN_A}`)
    expect(screen.getByTestId('journey-page')).not.toHaveTextContent(ORDER)
    expect(screen.getByTestId('journey-page')).toHaveTextContent('Journey & arrival · A1B2C3D4')
  })
})

describe('a vehicle with no Trade OS history is shown honestly and without borrowing', () => {
  beforeEach(() => { state.view = noHistory() })

  it('identifies the vehicle, says there is no journey, and does not crash', async () => {
    await open(`/diaspora/journey/vehicle/${VIN_B}`)
    expect(screen.getByTestId('journey-title')).toHaveTextContent('2016 BravoMake BravoModel Highway')
    expect(screen.getByTestId('journey-badge')).toHaveTextContent(/no journey yet/i)
    expect(screen.getByTestId('journey-sentence')).toHaveTextContent(/no import order or shipment is recorded/i)
  })

  it('says "not connected" in words — never an empty list that reads as "nothing to report"', async () => {
    await open(`/diaspora/journey/vehicle/${VIN_B}`)
    expect(screen.getByTestId('journey-nothing-connected')).toHaveTextContent(/nothing has been recorded/i)
    expect(screen.getByTestId('journey-nothing-connected')).toHaveTextContent(/not a report that nothing has happened/i)
  })

  it('renders no shipment, vessel, estimate, references or statistics at all', async () => {
    await open(`/diaspora/journey/vehicle/${VIN_B}`)
    for (const id of ['journey-departure', 'journey-arrival', 'journey-legs', 'journey-references', 'journey-eta', 'journey-eta-no-revisions', 'journey-statistics']) {
      expect(screen.queryByTestId(id), `${id} appeared for a vehicle with no shipment`).toBeNull()
    }
  })

  it('has no order reference in the header, and does not print the vehicle identifier as one', async () => {
    await open(`/diaspora/journey/vehicle/${VIN_B}`)
    const eyebrow = screen.getByTestId('journey-page').querySelector('header p')?.textContent || ''
    expect(eyebrow).toBe('Journey & arrival')
    expect(eyebrow).not.toMatch(/VIN-NO/i)
  })

  it('the Customs tab says there is no order — it does not say customs "could not be shown" or print an empty destination', async () => {
    await open(`/diaspora/journey/vehicle/${VIN_B}`)
    fireEvent.click(screen.getByRole('tab', { name: 'Customs' }))
    expect(screen.getByTestId('journey-destination-no-order')).toHaveTextContent(/no import order here yet/i)
    expect(screen.getByTestId('journey-destination-no-order')).toHaveTextContent(/not a report that nothing has happened/i)
    const panel = screen.getByRole('tabpanel')
    expect(panel).not.toHaveTextContent(/could not be shown/i)
    expect(panel).not.toHaveTextContent(/Destination \(on the order\)/i)
    expect(screen.queryByTestId('journey-destination-note')).toBeNull()
  })

  it('the Documents tab says nothing here has an order yet — not "this booking"', async () => {
    await open(`/diaspora/journey/vehicle/${VIN_B}`)
    fireEvent.click(screen.getByRole('tab', { name: 'Documents' }))
    expect(screen.getByTestId('journey-documents-not-applicable')).toHaveTextContent(/belong to an import order, and nothing here has one yet/i)
    expect(screen.getByTestId('journey-documents-not-applicable')).not.toHaveTextContent(/booking/i)
  })

  it('every tab opens without throwing, and none shows another vehicle’s facts', async () => {
    await open(`/diaspora/journey/vehicle/${VIN_B}`)
    for (const name of ['Journey', 'Documents', 'Vehicle', 'Customs', 'Contacts', 'Payments', 'Messages']) {
      const tab = screen.queryByRole('tab', { name })
      if (!tab) continue
      fireEvent.click(tab)
      const page = screen.getByTestId('journey-page').textContent || ''
      expect(page, `${name} tab shows facts from a different vehicle`).not.toMatch(/AlphaMake|VESSEL ALPHA|Carrier Alpha|Port Discharge/)
    }
  })
})

describe('a vehicle with several orders is never resolved by guessing', () => {
  it('offers each order as a link and shows no shipment', async () => {
    state.view = {
      ...noHistory(),
      state: 'ORDER_AMBIGUOUS',
      sentence: 'More than one import order is recorded for this vehicle, so no single journey is shown. Choose the one you want to follow.',
      candidates: [
        { order_id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901', status: 'IMPORT_REQUESTED', created_at: '2026-10-01T00:00:00Z' },
        { order_id: 'c3d4e5f6-a7b8-9012-cdef-123456789012', status: 'QUOTE_ISSUED', created_at: '2026-09-01T00:00:00Z' },
      ],
    }
    await open(`/diaspora/journey/vehicle/${VIN_B}`)
    expect(screen.getByTestId('journey-badge')).toHaveTextContent(/more than one order/i)
    const first = screen.getByTestId('journey-candidate-b2c3d4e5-f6a7-8901-bcde-f12345678901')
    expect(first.getAttribute('href')).toBe('/diaspora/journey/import_order/b2c3d4e5-f6a7-8901-bcde-f12345678901')
    expect(first).toHaveTextContent('Order B2C3D4E5')
    expect(screen.getByTestId('journey-candidates')).not.toHaveTextContent('b2c3d4e5-f6a7')
    expect(screen.queryByTestId('journey-legs')).toBeNull()
  })

  it('shows no choice list when there is nothing to choose', async () => {
    state.view = noHistory()
    await open(`/diaspora/journey/vehicle/${VIN_B}`)
    expect(screen.queryByTestId('journey-candidates')).toBeNull()
  })
})
