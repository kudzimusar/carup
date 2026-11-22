/**
 * RX06-LR04 CAP S1 — the Import Order view with the Journey wired in: the Shipping tab draws "Journey & arrival"
 * first (only when the page passes a journey read), the client-derived ladder keeps its test ids under its new
 * title, and the linked vehicle titles the order and opens its Vehicle Passport — only when the server sent it,
 * and never on a surface without tool links (the public sample). Fictional data only.
 */
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ImportOrderView } from './ImportOrderView'
import type { ImportOrderViewProps } from './orderViewTypes'
import { buildActivity, orderTitle, requestTitle, type Read, type TradeOrder } from './orderModel'
import { OrderSurfaceContext } from './orderLinks'
import type { Journey } from '../journey/journeyTypes'

const ORDER: TradeOrder = {
  id: 'fx000001-0000-4000-8000-000000000001', order_type: 'vehicle', origin_country: 'Japan', origin_city: 'Yokohama',
  destination_country: 'Zimbabwe', destination_city: 'Harare', requested_make: 'Toyota', requested_model: 'Aqua',
  requested_year_min: 2018, requested_year_max: 2018, budget_amount: 9000, budget_currency: 'USD', status: 'DOCUMENTS_PENDING',
  buyer_id: 'fx-buyer', created_at: '2026-11-17T09:56:36Z', updated_at: '2026-11-17T09:56:36Z',
  diaspora_trade_documents: [], diaspora_import_quotes: [], diaspora_payment_milestones: [],
  diaspora_import_order_participants: [], diaspora_cargo_reservations: [], diaspora_shipments: [], diaspora_compliance_reviews: [],
}
const LINKED: TradeOrder = { ...ORDER, linked_vehicle_vin: 'FXVIN-0000001', linked_vehicle: { vin: 'FXVIN-0000001', title: '2017 Toyota Fielder' } }
const ready = <T,>(data: T): Read<T> => ({ state: 'ready', data })

const JOURNEY: Journey = {
  subject: { type: 'import_order', id: ORDER.id, order_id: ORDER.id },
  viewer: { kind: 'OWNER' },
  state: 'NO_SHIPMENT',
  sentence: 'No shipment has been set up for this order yet.',
  asset: null, transaction: null, shipping: null, timeline: [], exceptions: [], contacts: null,
  sections: {} as Journey['sections'], provenance: {}, note: 'This is a composition of records owned elsewhere.',
}

function mount(props: Partial<ImportOrderViewProps> = {}, toolLinks = true) {
  const all: ImportOrderViewProps = { orderId: ORDER.id, mode: 'shipping', order: ready(ORDER), viewer: { id: 'fx-buyer', role: 'owner' }, ...props }
  return render(
    <MemoryRouter>
      <OrderSurfaceContext.Provider value={{ ledgerHref: '/diaspora/imports', ledgerLabel: 'Import orders', toolLinks }}>
        <ImportOrderView {...all} />
      </OrderSurfaceContext.Provider>
    </MemoryRouter>,
  )
}

describe('CAP S1 — the Shipping tab', () => {
  it('draws "Journey & arrival" first when the page passes a journey read', () => {
    mount({ journey: ready(JOURNEY) })
    const shipping = screen.getByTestId('trade-shipping')
    const journey = within(shipping).getByTestId('trade-journey')
    const ladder = within(shipping).getByTestId('trade-cap-journey')
    expect(journey.compareDocumentPosition(ladder) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(journey).getByTestId('journey-badge')).toHaveTextContent('No shipment set up yet')
  })

  it('without a journey read, draws no journey section at all (no inert or empty panel)', () => {
    mount()
    expect(screen.queryByTestId('trade-journey')).not.toBeInTheDocument()
    expect(screen.getByTestId('trade-cap-journey')).toBeInTheDocument()
  })

  it('the client-derived ladder keeps its test ids under its new title', () => {
    mount({ journey: ready(JOURNEY) })
    const ladder = screen.getByTestId('trade-cap-journey')
    expect(within(ladder).getByRole('heading', { name: 'Order status steps' })).toBeInTheDocument()
    expect(within(ladder).getAllByTestId('trade-cap-step').length).toBeGreaterThan(0)
  })
})

describe('RX06-LR05 — the order\'s read-only record mode is labelled "Order record" (Owner decision D3)', () => {
  it('the mode switch says "Order record" beside the Vehicle Passport link; the route and test id are unchanged', () => {
    mount({ order: ready(LINKED), mode: 'overview' })
    const link = screen.getByTestId('trade-order-passport-link')
    expect(link).toHaveTextContent(/^Order record$/)
    expect(link).toHaveAttribute('href', `/diaspora/imports/${ORDER.id}/passport`)
    expect(screen.getByTestId('trade-order-vehicle-passport')).toHaveTextContent('Vehicle Passport')
    expect(screen.getByTestId('trade-order-mode-switch')).not.toHaveTextContent(/\bPassport\b/)
  })
})

describe('CAP S1 — the linked vehicle', () => {
  it('titles the order with the vehicle the server linked for this viewer, without the requested year range', () => {
    mount({ order: ready(LINKED), mode: 'overview' })
    expect(screen.getByTestId('trade-order-title')).toHaveTextContent(/^2017 Toyota Fielder$/)
    expect(screen.getByTestId('trade-order-vehicle-passport')).toHaveAttribute('href', '/dashboard/garage/FXVIN-0000001')
    expect(screen.getByTestId('trade-order-vehicle-passport')).toHaveTextContent('Vehicle Passport')
  })

  it('offers no Vehicle Passport link when the server sent no linked vehicle (not the owner or current seller)', () => {
    mount({ order: ready({ ...ORDER, linked_vehicle_vin: 'FXVIN-0000001' }), mode: 'overview' })
    expect(screen.queryByTestId('trade-order-vehicle-passport')).not.toBeInTheDocument()
    expect(screen.getByTestId('trade-order-title')).toHaveTextContent('Toyota Aqua2018')
  })

  it('offers no Vehicle Passport link on a surface without tool links (the public sample)', () => {
    mount({ order: ready(LINKED), mode: 'overview' }, false)
    expect(screen.queryByTestId('trade-order-vehicle-passport')).not.toBeInTheDocument()
  })

  it('a linked vehicle without a title falls back to the request', () => {
    const order = { ...ORDER, linked_vehicle: { vin: 'FXVIN-0000001', title: null } }
    expect(orderTitle(order)).toBe('Toyota Aqua')
    expect(orderTitle({ ...order, linked_vehicle: { vin: 'x', title: '   ' } })).toBe('Toyota Aqua')
  })

  it('the activity record still says what was REQUESTED, whatever vehicle the order was linked to later', () => {
    expect(requestTitle(LINKED)).toBe('Toyota Aqua')
    const events = buildActivity({ order: LINKED, audit: [], documents: [] })
    const recorded = events.find(e => e.title === 'Import request recorded')
    expect(recorded?.detail).toBe('Toyota Aqua')
  })
})
