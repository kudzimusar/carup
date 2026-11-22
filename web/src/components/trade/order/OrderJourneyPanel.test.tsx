/**
 * RX06-LR04 CAP S1 — "Journey & arrival" on the Import Order's Shipping tab. Proves the truth rules carried from
 * CAP R2/R3: a plan is a plan, an estimate is an estimate, a sender's report is the sender's (CarUp's own record
 * printed beneath it, verbatim), a part not read is never an empty list, and the five read states stay distinct.
 * Fictional data only.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Journey, JourneyProgress } from '../journey/journeyTypes'
import { OrderJourneyPanel } from './OrderJourneyPanel'
import type { Read } from './orderModel'

const ORDER_ID = 'fx000001-0000-4000-8000-000000000001'
const ready = <T,>(data: T): Read<T> => ({ state: 'ready', data })

const PROGRESS: JourneyProgress = {
  availability: 'composed',
  groups: [
    {
      code: 'BOOKING', title: 'Booking', state: 'reported_completed', reported_count: 2, carup_count: 0,
      rows: [
        { sequence: 1, action_taker: { label: 'exporter', kind: 'exporter', display_label: 'Example Exporter' }, text: 'Space booked on the vessel', status: 'completed', status_label: 'Completed', time: { value: '2026-11-10T00:00:00Z', basis: 'reported' }, time_note: null, origin: 'external_report', source_label: 'Example Exporter', verification: 'reported' },
        { sequence: 2, action_taker: { label: 'exporter', kind: 'exporter', display_label: 'Example Exporter' }, text: 'Booking confirmed', status: 'completed', status_label: 'Completed', time: null, time_note: 'The source did not supply a date for this step', origin: 'external_report', source_label: 'Example Exporter', verification: 'reported' },
      ],
    },
    { code: 'DEPARTURE', title: 'Departure', state: 'not_recorded', reported_count: 0, carup_count: 0, rows: [] },
    {
      code: 'DISPATCH', title: 'Dispatch', state: 'carup_recorded', reported_count: 0, carup_count: 1,
      rows: [{ sequence: 1, action_taker: { label: 'carup', kind: 'carup', display_label: 'CarUp' }, text: 'Dispatch recorded', status: 'recorded', status_label: 'Recorded', time: { value: '2026-11-12T00:00:00Z', basis: 'recorded' }, time_note: null, origin: 'carup', source_label: 'CarUp', verification: 'recorded' }],
    },
  ],
  totals: { reported_rows: 2, carup_rows: 1 },
  sources: [{ origin: 'external_report', source_label: 'Example Exporter', observed_at: '2026-11-20T00:00:00Z', row_count: 2 }],
  note: '"Completed" on a reported step is the sender\'s statement about its own work.',
}

function journey(patch: Partial<Journey> = {}): Journey {
  return {
    subject: { type: 'import_order', id: ORDER_ID, order_id: ORDER_ID },
    viewer: { kind: 'OWNER' },
    state: 'SHIPMENT_CREATED',
    sentence: 'A shipment has been set up. Nothing has been recorded as moving yet.',
    asset: null,
    transaction: null,
    shipping: {
      association: 'order',
      reference: 'SHPM-FX000001',
      dates: { planned_departure: '2026-11-25T00:00:00Z', planned_departure_source: 'stated_at_creation', observed_departure: null, estimated_arrival: '2026-12-23T00:00:00Z', observed_arrival: null, note: 'A planned departure is an intention.' },
      references: { carrier: 'Example Line (fictional)', tracking_reference: 'FXTRK-000001', origin_port: 'Yokohama', destination_port: 'Durban', note: 'A reference is paperwork.' },
      legs: {
        availability: 'composed',
        items: [{ sequence: 1, carrier_name: 'Example Line (fictional)', vessel_name: 'SAMPLE VESSEL', voyage_ref: 'V001', imo: null, mmsi: null, port_of_loading: 'Yokohama', port_of_discharge: 'Durban', planned_departure: '2026-11-25T00:00:00Z', estimated_arrival: '2026-12-23T00:00:00Z', source: 'organiser' }],
        note: 'Vessel and voyage details are declared, not observed. They do not record that the vessel sailed or arrived.',
      },
      eta: {
        availability: 'composed', basis: 'revision', original: '2026-12-23T00:00:00Z', current: '2026-12-26T00:00:00Z', change_days: 3, revision_count: 1, last_revised_at: '2026-11-21T00:00:00Z',
        revisions: [{ estimated_arrival: '2026-12-26T00:00:00Z', observed_at: '2026-11-21T00:00:00Z', reason: 'PORT_CONGESTION', source: 'organiser', superseded: false }],
        note: 'An estimate can move. A revised estimate is still an estimate.',
      },
    },
    timeline: [],
    exceptions: [],
    contacts: null,
    sections: { progress: PROGRESS, documents: { availability: 'not_yet_composed', owner: 'T8' }, customs: { availability: 'not_yet_composed', owner: 'T12' } } as Journey['sections'],
    provenance: {},
    generated_at: '2026-11-22T08:33:43.104Z',
    note: 'This is a composition of records owned elsewhere. It records nothing and decides nothing.',
    ...patch,
  }
}

function mount(read: Read<Journey>) {
  return render(<MemoryRouter><OrderJourneyPanel orderId={ORDER_ID} journey={read} /></MemoryRouter>)
}

describe('CAP S1 — Journey & arrival', () => {
  it('headlines a sender\'s report as the sender\'s, with CarUp\'s own movement record beneath it, verbatim', () => {
    mount(ready(journey()))
    const panel = screen.getByTestId('trade-journey')
    expect(within(panel).getByRole('heading', { level: 2, name: 'Journey & arrival' })).toBeInTheDocument()
    expect(screen.getByTestId('journey-badge')).toHaveTextContent('1 of 3 steps reported complete')
    expect(screen.getByTestId('journey-badge')).toHaveAttribute('data-tone', 'info')
    expect(screen.getByTestId('journey-sentence')).toHaveTextContent('Example Exporter reports 1 of 3 steps as completed')
    expect(screen.getByTestId('journey-sentence')).toHaveTextContent('not CarUp\'s own observation')
    expect(screen.getByTestId('journey-carup-record')).toHaveTextContent('CarUp’s own movement record: Shipment set up — nothing moving yet. A shipment has been set up. Nothing has been recorded as moving yet.')
    expect(screen.getByTestId('journey-last-update')).toHaveTextContent('Last update recorded by CarUp')
  })

  it('without a report, shows only CarUp\'s own state, and an unknown state is never read as arrived', () => {
    const { unmount } = mount(ready(journey({ sections: {} as Journey['sections'] })))
    expect(screen.getByTestId('journey-badge')).toHaveTextContent('Shipment set up — nothing moving yet')
    expect(screen.getByTestId('journey-badge')).toHaveAttribute('data-tone', 'neutral')
    expect(screen.queryByTestId('journey-carup-record')).not.toBeInTheDocument()
    unmount()
    mount(ready(journey({ state: 'TELEPORTED', sections: {} as Journey['sections'] })))
    expect(screen.getByTestId('journey-badge')).toHaveTextContent('Status unavailable')
    expect(screen.getByTestId('journey-badge')).toHaveAttribute('data-tone', 'neutral')
  })

  it('words a planned departure as a plan and an estimate as an estimate — never an event', () => {
    mount(ready(journey()))
    expect(screen.getByTestId('journey-departure-headline')).toHaveTextContent('Not recorded as departed')
    expect(screen.getByTestId('journey-departure-detail')).toHaveTextContent('That is a plan, not a record that it left.')
    expect(screen.getByTestId('journey-departure-provenance')).toHaveTextContent('A plan, not a departure')
    expect(screen.getByTestId('journey-arrival-headline')).toHaveTextContent('Not recorded as arrived')
    expect(screen.getByTestId('journey-arrival-provenance')).toHaveTextContent('An estimate, not an arrival')
    expect(screen.getByTestId('journey-arrival-provenance')).toHaveAttribute('data-provenance', 'unverified')
    expect(screen.getByTestId('journey-eta-basis')).toHaveTextContent('Latest revised estimate')
    const body = screen.getByTestId('journey-body').textContent ?? ''
    expect(body).not.toMatch(/\b(sailed on|has departed|arrived on|has arrived)\b/i)
  })

  it('an observed departure and arrival are recorded events', () => {
    const j = journey()
    j.shipping!.dates = { ...j.shipping!.dates!, observed_departure: '2026-11-26T00:00:00Z', observed_arrival: '2026-12-27T00:00:00Z' }
    mount(ready(j))
    expect(screen.getByTestId('journey-departure-headline')).toHaveTextContent(/^Departed /)
    expect(screen.getByTestId('journey-departure-provenance')).toHaveAttribute('data-provenance', 'record')
    expect(screen.getByTestId('journey-arrival-headline')).toHaveTextContent(/^Arrived /)
    expect(screen.getByTestId('journey-arrival-provenance')).toHaveTextContent('Recorded as an actual arrival')
  })

  it('keeps the revised estimate BESIDE the original, never over it', () => {
    mount(ready(journey()))
    const eta = screen.getByTestId('journey-eta')
    expect(within(eta).getByTestId('journey-eta-current')).toHaveTextContent(/26/)
    expect(within(eta).getByTestId('journey-eta-original')).toHaveTextContent(/23/)
    expect(within(eta).getAllByTestId('journey-eta-revision')).toHaveLength(1)
    expect(eta).toHaveTextContent('An estimate can move')
  })

  it('declares vessel legs as declared, not observed', () => {
    mount(ready(journey()))
    expect(screen.getByTestId('journey-legs-provenance')).toHaveTextContent('Declared, not observed')
    expect(screen.getAllByTestId('journey-leg')).toHaveLength(1)
    expect(screen.getByTestId('journey-legs-note')).toHaveTextContent('declared, not observed')
  })

  it('a failed read of the legs or of the estimate says so — never "none declared" and never an empty list', () => {
    const j = journey()
    j.shipping!.legs = { availability: 'unavailable', note: 'The vessel details could not be read just now. This is not a report that none are declared.' }
    j.shipping!.eta = { availability: 'unavailable', note: 'The arrival estimate could not be read just now. Nothing is shown in its place.' }
    mount(ready(j))
    expect(screen.getByTestId('journey-legs-unavailable')).toHaveTextContent('could not be read just now')
    expect(screen.getByTestId('journey-legs-unavailable')).toHaveAttribute('role', 'alert')
    expect(screen.queryByTestId('journey-legs')).not.toBeInTheDocument()
    expect(screen.getByTestId('journey-eta-unavailable')).toHaveTextContent('could not be read just now')
    expect(screen.queryByTestId('journey-eta')).not.toBeInTheDocument()
    expect(screen.getByTestId('journey-arrival-provenance')).toHaveTextContent('An estimate, not an arrival')
  })

  it('legs not connected yet say so rather than imply there are none', () => {
    const j = journey()
    j.shipping!.legs = { availability: 'not_yet_composed', owner: 'CAP-04' }
    mount(ready(j))
    expect(screen.getByTestId('journey-legs-note')).toHaveTextContent('Vessel and route:')
    expect(screen.queryByTestId('journey-leg')).not.toBeInTheDocument()
  })

  it('with no shipment, says nothing is connected — not that nothing has happened', () => {
    mount(ready(journey({ shipping: null, state: 'NO_SHIPMENT' })))
    expect(screen.getByTestId('journey-nothing-connected')).toHaveTextContent('That is not a report that nothing has happened')
    expect(screen.queryByTestId('journey-dates')).not.toBeInTheDocument()
  })

  it('progress keeps the sender\'s report apart from CarUp\'s record, and an empty stage is not "not started"', () => {
    mount(ready(journey()))
    expect(screen.getByTestId('journey-progress-state-BOOKING')).toHaveTextContent('Completed (reported)')
    expect(screen.getByTestId('journey-progress-BOOKING')).toHaveTextContent('2 steps reported')
    expect(screen.getByTestId('journey-progress-row-BOOKING-external_report-2')).toHaveTextContent('The source did not supply a date for this step')
    expect(screen.getByTestId('journey-progress-row-BOOKING-external_report-1')).toHaveTextContent('Reported by Example Exporter')
    const carupRow = screen.getByTestId('journey-progress-row-DISPATCH-carup-1')
    expect(carupRow).toHaveTextContent('Recorded by CarUp')
    expect(carupRow).toHaveAttribute('data-origin', 'carup')
    expect(screen.getByTestId('journey-progress-DISPATCH')).toHaveTextContent('1 step recorded by CarUp')
    expect(screen.getByTestId('journey-progress-empty-DEPARTURE')).toHaveTextContent('That does not mean it has not happened.')
  })

  it('progress withheld from this viewer, or unread, is said as what it is', () => {
    const { unmount } = mount(ready(journey({ viewer: { kind: 'PARTICIPANT' }, sections: { progress: { availability: 'withheld', note: 'Progress is not available to you here.' } } as Journey['sections'] })))
    expect(screen.getByTestId('journey-progress-unshown')).toHaveTextContent('not available to you here')
    expect(screen.queryByTestId('journey-progress-BOOKING')).not.toBeInTheDocument()
    unmount()
    mount(ready(journey({ sections: { progress: { availability: 'unavailable', note: '' } } as Journey['sections'] })))
    expect(screen.getByTestId('journey-progress-unshown')).toHaveTextContent('could not be read right now')
    expect(screen.getByTestId('journey-progress-unshown')).toHaveAttribute('role', 'alert')
  })

  it('shows exceptions in the projection\'s words, as warnings', () => {
    mount(ready(journey({ exceptions: [{ code: 'LEG_PORT_MISMATCH', note: 'The vessel details name different ports than the shipment record. The records disagree.' }] })))
    expect(screen.getByTestId('journey-exception-LEG_PORT_MISMATCH')).toHaveTextContent('The records disagree')
  })

  it('an empty movement record says no movement is recorded; documents, customs and payments link to their own tabs', () => {
    mount(ready(journey()))
    expect(screen.getByTestId('journey-timeline-empty')).toHaveTextContent('No movement has been recorded.')
    expect(screen.getByTestId('journey-link-documents')).toHaveAttribute('href', `/diaspora/imports/${ORDER_ID}/documents`)
    expect(screen.getByTestId('journey-link-customs')).toHaveAttribute('href', `/diaspora/imports/${ORDER_ID}?tab=customs`)
    expect(screen.getByTestId('journey-link-payments')).toHaveAttribute('href', `/diaspora/imports/${ORDER_ID}?tab=payments`)
    expect(screen.getByTestId('journey-disclaimer')).toHaveTextContent('It records nothing and decides nothing.')
  })

  it('never draws the vehicle\'s private identifiers (the vehicle card is S2)', () => {
    mount(ready(journey({ asset: { make: 'Toyota', model: 'Fielder', year: 2017, color: 'Silver', mileage: 0, source: 'vehicles', chassis_number: 'FX-PRIVATE-0001', engine_number: 'FX-ENGINE-0001' } })))
    const text = screen.getByTestId('trade-journey').textContent ?? ''
    expect(text).not.toContain('FX-PRIVATE-0001')
    expect(text).not.toContain('FX-ENGINE-0001')
  })

  it('loading, failed (with retry), denied and not deployed are four different statements', () => {
    const onRetry = vi.fn()
    const states: Array<[Read<Journey>, string]> = [
      [{ state: 'loading' }, 'trade-journey-read-loading'],
      [{ state: 'failed', message: 'Network down', onRetry }, 'trade-journey-read-failed'],
      [{ state: 'denied', message: 'Forbidden' }, 'trade-journey-read-denied'],
      [{ state: 'unavailable', message: 'Not found' }, 'trade-journey-read-unavailable'],
    ]
    for (const [read, testId] of states) {
      const { unmount } = mount(read)
      expect(screen.getByTestId(testId)).toBeInTheDocument()
      expect(screen.queryByTestId('journey-body')).not.toBeInTheDocument()
      unmount()
    }
    mount({ state: 'failed', message: 'Network down', onRetry })
    screen.getByRole('button', { name: /try again/i }).click()
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
