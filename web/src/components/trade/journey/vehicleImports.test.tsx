/**
 * RX06-LR04 CAP S1c — "Trade & imports" on the owner's Vehicle Passport. Proves: one order → its order and journey;
 * several → offered, never chosen; none → no section; a FAILED read → "unavailable", never "none"; refused or not
 * served → nothing; and the headline reads exactly as the order's own Journey & arrival badge. Fictional data only.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Read } from '../order/orderModel'
import type { Journey, JourneyProgress } from './journeyTypes'
import { describeVehicleImports } from './vehicleImports'
import { VehicleImportsSection } from './VehicleImportsSection'

const VIN = 'FXVIN-0000001'
const ORDER = 'fx000001-0000-4000-8000-000000000001'
const ready = <T,>(data: T): Read<T> => ({ state: 'ready', data })

function journey(patch: Partial<Journey> = {}): Journey {
  return {
    subject: { type: 'vehicle', id: VIN, order_id: ORDER },
    viewer: { kind: 'OWNER' },
    state: 'SHIPMENT_CREATED',
    sentence: 'A shipment has been set up. Nothing has been recorded as moving yet.',
    asset: null, transaction: null, shipping: null, timeline: [], exceptions: [], contacts: null,
    sections: {} as Journey['sections'], provenance: {}, note: 'A composition of records owned elsewhere.',
    ...patch,
  }
}
const REPORTED: JourneyProgress = {
  availability: 'composed',
  groups: [
    { code: 'BOOKING', title: 'Booking', state: 'reported_completed', reported_count: 1, carup_count: 0, rows: [] },
    { code: 'DEPARTURE', title: 'Departure', state: 'not_recorded', reported_count: 0, carup_count: 0, rows: [] },
  ],
  totals: { reported_rows: 1, carup_rows: 0 },
  sources: [{ origin: 'external_report', source_label: 'Example Exporter', observed_at: null, row_count: 1 }],
  note: 'Reported.',
}

describe('describeVehicleImports', () => {
  it('one readable order → its order and its Journey & arrival, worded as CarUp\'s own state', () => {
    const view = describeVehicleImports(ready(journey()))
    expect(view).toEqual({
      kind: 'single', orderId: ORDER, headline: 'Shipment set up — nothing moving yet', tone: 'neutral',
      orderHref: `/diaspora/imports/${ORDER}`, journeyHref: `/diaspora/imports/${ORDER}/shipment`, reportedLine: null,
    })
  })

  it('RX06-LR05: a sender\'s report never becomes the headline — CarUp\'s own state does; the report is a line apart', () => {
    const view = describeVehicleImports(ready(journey({ sections: { progress: REPORTED } as Journey['sections'] })))
    expect(view).toMatchObject({
      kind: 'single', headline: 'Shipment set up — nothing moving yet', tone: 'neutral',
      reportedLine: 'Example Exporter reports 1 of 2 stages complete. CarUp has not confirmed them.',
    })
  })

  it('several orders are offered, never chosen', () => {
    const view = describeVehicleImports(ready(journey({
      subject: { type: 'vehicle', id: VIN, order_id: null }, state: 'ORDER_AMBIGUOUS',
      candidates: [
        { order_id: 'fx000002-0000-4000-8000-000000000002', status: 'IMPORT_REQUESTED', created_at: '2026-11-20T00:00:00Z' },
        { order_id: ORDER, status: 'DOCUMENTS_PENDING', created_at: '2026-11-10T00:00:00Z' },
        { order_id: '', status: null, created_at: null },
      ],
    })))
    expect(view?.kind).toBe('multiple')
    if (view?.kind !== 'multiple') throw new Error('expected multiple')
    expect(view.candidates.map(c => c.href)).toEqual(['/diaspora/imports/fx000002-0000-4000-8000-000000000002', `/diaspora/imports/${ORDER}`])
  })

  it('a candidate list stays a list even with one entry: the client never turns an offer into a choice', () => {
    const view = describeVehicleImports(ready(journey({
      subject: { type: 'vehicle', id: VIN, order_id: null }, state: 'ORDER_AMBIGUOUS',
      candidates: [{ order_id: ORDER, status: 'DOCUMENTS_PENDING', created_at: '2026-11-10T00:00:00Z' }],
    })))
    expect(view?.kind).toBe('multiple')
  })

  it('no import order → no section (nothing implies a journey is missing)', () => {
    expect(describeVehicleImports(ready(journey({ subject: { type: 'vehicle', id: VIN, order_id: null }, state: 'NO_TRANSACTION' })))).toBeNull()
  })

  it('a failed read is "unavailable" with a retry — never "none"', () => {
    const onRetry = vi.fn()
    expect(describeVehicleImports({ state: 'failed', message: 'Network down', onRetry })).toEqual({ kind: 'unavailable', message: 'Network down', onRetry })
  })

  it('loading, refused and not served render nothing', () => {
    expect(describeVehicleImports({ state: 'loading' })).toBeNull()
    expect(describeVehicleImports({ state: 'denied', message: 'Forbidden' })).toBeNull()
    expect(describeVehicleImports({ state: 'unavailable', message: 'Not found' })).toBeNull()
  })

  it('an unknown state is never read as arrived', () => {
    expect(describeVehicleImports(ready(journey({ state: 'TELEPORTED' })))).toMatchObject({ headline: 'Status unavailable', tone: 'neutral' })
  })
})

function mount(read: Read<Journey>) {
  return render(<MemoryRouter><VehicleImportsSection read={read} /></MemoryRouter>)
}

describe('VehicleImportsSection', () => {
  it('a report is shown as a separate line that says CarUp has not confirmed it', () => {
    mount(ready(journey({ sections: { progress: REPORTED } as Journey['sections'] })))
    expect(screen.getByTestId('passport-imports-state')).toHaveTextContent('Shipment set up — nothing moving yet')
    expect(screen.getByTestId('passport-imports-reported')).toHaveTextContent('CarUp has not confirmed them.')
  })

  it('one order: the state, then links to its Journey & arrival and to the order', () => {
    mount(ready(journey()))
    const section = screen.getByTestId('passport-imports')
    expect(within(section).getByRole('heading', { level: 2, name: 'Trade & imports' })).toBeInTheDocument()
    expect(screen.getByTestId('passport-imports-state')).toHaveTextContent('Shipment set up — nothing moving yet')
    expect(screen.getByTestId('passport-imports-journey')).toHaveAttribute('href', `/diaspora/imports/${ORDER}/shipment`)
    expect(screen.getByTestId('passport-imports-order')).toHaveAttribute('href', `/diaspora/imports/${ORDER}`)
  })

  it('several orders: a list to choose from, each to its own order', () => {
    mount(ready(journey({
      subject: { type: 'vehicle', id: VIN, order_id: null }, state: 'ORDER_AMBIGUOUS',
      candidates: [
        { order_id: 'fx000002-0000-4000-8000-000000000002', status: 'IMPORT_REQUESTED', created_at: '2026-11-20T00:00:00Z' },
        { order_id: ORDER, status: 'DOCUMENTS_PENDING', created_at: '2026-11-10T00:00:00Z' },
      ],
    })))
    expect(screen.getAllByTestId('passport-imports-candidate')).toHaveLength(2)
    expect(screen.queryByTestId('passport-imports-journey')).not.toBeInTheDocument()
    expect(screen.getByTestId('passport-imports')).toHaveTextContent('Choose the one you want to open.')
  })

  it('no order: nothing at all', () => {
    const { container } = mount(ready(journey({ subject: { type: 'vehicle', id: VIN, order_id: null }, state: 'NO_TRANSACTION' })))
    expect(container).toBeEmptyDOMElement()
  })

  it('a failed check says so, says it is not "none", and can be retried', () => {
    const onRetry = vi.fn()
    mount({ state: 'failed', message: 'Network down', onRetry })
    const box = screen.getByTestId('passport-imports-unavailable')
    expect(box).toHaveTextContent('Import status unavailable')
    expect(box).toHaveTextContent('This is not a report that there are none.')
    fireEvent.click(screen.getByTestId('passport-imports-retry'))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
