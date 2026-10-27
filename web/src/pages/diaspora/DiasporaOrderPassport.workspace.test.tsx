/**
 * T11-CAP-LR01-R3 (Step H) — the order's compliance record is "Order details", a page of the order.
 *
 * Before: it called itself "Import order passport" — a second "passport" beside the Vehicle Passport — and its only way out went
 * to the order list. Now it is named for what it is, sits under the order (named by its vehicle for the vehicle's owner), keeps
 * its one labelled control back to the order, and offers the journey and the Vehicle Passport beside it. Its content is unchanged.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

vi.setConfig({ testTimeout: 30_000 })

const h = vi.hoisted(() => ({
  order: null as unknown,
  orderError: null as unknown,
  api: {
    fetchDiasporaImportOrder: vi.fn(),
    fetchDiasporaGovernmentFootprint: vi.fn(),
    fetchDiasporaOrderAudit: vi.fn(),
    fetchDiasporaOwnershipHandoffStatus: vi.fn(),
    fetchDiasporaShipmentTimeline: vi.fn(),
  },
}))
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true, loading: false, user: { id: 'u1', name: 'Kingston Musarurwa', role: 'owner' } }),
}))
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => h.api }))
vi.mock('@/components/diaspora/PaymentMilestonesCard', () => ({ default: () => <div data-testid="milestones-stub" /> }))

import DiasporaOrderPassport from './DiasporaOrderPassport'

const ORDER = '3e2b66a0-1e8b-43c9-bd48-507f88016f71'
const VIN = 'RU3-1316558'

const order = (over: Record<string, unknown> = {}) => ({
  id: ORDER, order_type: 'vehicle', status: 'DOCUMENTS_PENDING', origin_country: 'Japan', destination_country: 'Zimbabwe', buyer_id: 'u1',
  requested_make: null, requested_model: null, diaspora_import_order_participants: [], diaspora_import_quotes: [], diaspora_trade_documents: [],
  diaspora_payment_milestones: [], diaspora_cargo_reservations: [], diaspora_shipments: [], diaspora_compliance_reviews: [],
  ...over,
})

function Probe() {
  const location = useLocation()
  return <span data-testid="location">{location.pathname}</span>
}
const open = async (expected = 'order-passport-page') => {
  render(
    <MemoryRouter initialEntries={[`/diaspora/imports/${ORDER}/passport`]}>
      <Probe />
      <Routes>
        <Route path="/diaspora/imports/:id/passport" element={<DiasporaOrderPassport />} />
        <Route path="/diaspora/imports" element={<p>IMPORT ORDERS LIST</p>} />
        <Route path="/diaspora/imports/:id" element={<p>IMPORT ORDER PAGE</p>} />
        <Route path="/diaspora/journey/:subjectType/:subjectId" element={<p>JOURNEY PAGE</p>} />
        <Route path="/dashboard/garage/:id" element={<p>VEHICLE PASSPORT PAGE</p>} />
      </Routes>
    </MemoryRouter>,
  )
  await waitFor(() => expect(screen.getByTestId(expected)).toBeInTheDocument())
}
const trail = () => screen.getByRole('navigation', { name: 'Breadcrumb' })
const crumbs = () => within(trail()).queryAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])
const location = () => screen.getByTestId('location').textContent

beforeEach(() => {
  vi.clearAllMocks()
  h.order = order({ linked_vehicle: { vin: VIN, title: '2018 Honda Vezel' } })
  h.orderError = null
  h.api.fetchDiasporaImportOrder.mockImplementation(async () => { if (h.orderError) throw h.orderError; return h.order })
  h.api.fetchDiasporaGovernmentFootprint.mockResolvedValue([])
  h.api.fetchDiasporaOrderAudit.mockResolvedValue([])
  h.api.fetchDiasporaOwnershipHandoffStatus.mockResolvedValue(null)
  h.api.fetchDiasporaShipmentTimeline.mockResolvedValue([])
})
afterEach(cleanup)

describe('Order details', () => {
  it('is called Order details — one h1 — and does not set an "order passport" beside the Vehicle Passport', async () => {
    await open()
    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0]).toHaveTextContent('Order details')
    expect(screen.getByTestId('order-passport-page').textContent).not.toMatch(/order passport/i)
  })

  it('sits under the order, named by its vehicle for the vehicle’s owner', async () => {
    await open()
    expect(crumbs()).toEqual([
      ['Trade & Imports', '/diaspora/imports'],
      ['Import Orders', '/diaspora/imports'],
      ['2018 Honda Vezel', `/diaspora/imports/${ORDER}`],
    ])
    expect(within(trail()).getByTestId('workspace-crumb-current')).toHaveTextContent('Order details')
  })

  it('is named by a short reference, never the whole id, for a viewer not told the vehicle', async () => {
    h.order = order()
    await open()
    expect(crumbs().map(([text]) => text)).toContain('Import order 3E2B66A0')
    expect(screen.getByTestId('workspace-chrome').textContent).not.toContain(ORDER)
  })

  it('has ONE labelled way back to the order — its own button — and not a second from the chrome', async () => {
    await open()
    const back = screen.getByTestId('order-passport-back')
    expect(back).toHaveTextContent('Back to import order')
    expect(back).toHaveAttribute('href', `/diaspora/imports/${ORDER}`)
    expect(screen.queryByTestId('workspace-parent-link')).toBeNull()
    // It IS the page's way up, so it keeps the way up's 44px touch target at every width (physical UAT: 32px from 768px up).
    expect(back.className).toContain('min-h-11')
  })

  it('offers the journey, and the Vehicle Passport only when the order named the vehicle to this viewer', async () => {
    await open()
    const exits = screen.getByRole('navigation', { name: 'Elsewhere for this order' })
    expect(within(exits).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Journey & arrival', `/diaspora/journey/import_order/${ORDER}`],
      ['View Vehicle Passport', `/dashboard/garage/${VIN}`],
    ])
    cleanup()
    h.order = order()
    await open()
    const plain = screen.getByRole('navigation', { name: 'Elsewhere for this order' })
    expect(within(plain).getAllByRole('link').map((a) => a.textContent)).toEqual(['Journey & arrival'])
  })

  it('keeps the compliance content and the pointer to the transaction view', async () => {
    await open()
    expect(screen.getByTestId('order-passport-identity')).toBeInTheDocument()
    expect(screen.getByTestId('order-passport-operating-link')).toHaveTextContent('compliance record')
  })

  it.each([
    ['Order details → Import Order, by the page’s own button', 'order-passport-back', `/diaspora/imports/${ORDER}`],
    ['Order details → Journey, by the exit', 'order-passport-journey-link', `/diaspora/journey/import_order/${ORDER}`],
    ['Order details → Vehicle Passport, by the exit', 'order-passport-vehicle-passport-link', `/dashboard/garage/${VIN}`],
  ])('%s', async (_name, testId, expected) => {
    await open()
    fireEvent.click(screen.getByTestId(testId))
    await waitFor(() => expect(location()).toBe(expected))
  })
})

describe('Order details that cannot be opened', () => {
  it('says so in its own words and goes back to the list — it knows no order to go back to', async () => {
    h.orderError = Object.assign(new Error('Forbidden'), { status: 403 })
    await open('order-passport-forbidden')
    expect(screen.getByText('Unable to open order details')).toBeInTheDocument()
    expect(screen.getByTestId('order-passport-back')).toHaveTextContent('Back to import orders')
    expect(screen.getByTestId('order-passport-back')).toHaveAttribute('href', '/diaspora/imports')
    expect(screen.getByTestId('order-passport-back').className).toContain('min-h-11')
    expect(screen.getByTestId('order-passport-forbidden').textContent).not.toMatch(/passport/i)
  })
})
