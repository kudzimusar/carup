/**
 * T11-CAP-LR01-R3 (Step H) — Trade & Imports → Import Orders → Import Order → CAP, and back, with explicit controls.
 *
 * Before: the list titled each unnamed order "Import <uuid>", the order called itself "Vehicle request", the journey was the
 * third of three equal outline buttons, nothing on any of these pages said which workspace it belonged to, and no page had a
 * way up but the browser's Back. These tests pin what replaces that: orders are named by what the viewer may know, the
 * journey leads, the Vehicle Passport appears only when the order endpoint proved ownership, and every page has a labelled way up.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent, cleanup, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

vi.setConfig({ testTimeout: 30_000 })

const h = vi.hoisted(() => ({
  role: 'owner' as string,
  orders: [] as unknown[],
  order: null as unknown,
  orderError: null as Error | null,
  vehicle: null as { vin: string; title: string | null } | null,
  api: {
    fetchDiasporaImportOrders: vi.fn(),
    fetchDiasporaImportOrder: vi.fn(),
    fetchDiasporaTradeDocuments: vi.fn(),
    fetchDiasporaReservations: vi.fn(),
    fetchDiasporaShipments: vi.fn(),
    fetchDiasporaOpenContainers: vi.fn(),
  },
  getOrderVehicle: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true, loading: false, user: { id: 'u1', name: 'Kingston Musarurwa', role: h.role } }),
}))
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => h.api }))
vi.mock('@/hooks/useTradeLogisticsApi', () => ({ useTradeLogisticsApi: () => ({ getOrderVehicle: h.getOrderVehicle }) }))
vi.mock('@/components/diaspora/PaymentMilestonesCard', () => ({ default: () => <div data-testid="milestones-stub" /> }))
vi.mock('@/components/intelligence/TradeIntelligence', () => ({ default: () => <div data-testid="intelligence-stub" /> }))

import { DiasporaImportList, DiasporaImportDetail, DiasporaImportDocuments, DiasporaImportShipment } from './DiasporaTrade'
import { WorkspaceBarProvidedContext } from '@/components/workspace'

const ORDER = '3e2b66a0-1e8b-43c9-bd48-507f88016f71'
const OTHER = '921d09ed-0000-4000-8000-000000000002'
const VIN = 'RU3-1316558'

const order = (over: Record<string, unknown> = {}) => ({
  id: ORDER, order_type: 'vehicle', origin_country: 'Japan', destination_country: 'Zimbabwe', status: 'DOCUMENTS_PENDING',
  requested_make: null, requested_model: null, diaspora_trade_documents: [], diaspora_payment_milestones: [], diaspora_import_quotes: [],
  ...over,
})
const owned = (over: Record<string, unknown> = {}) => order({ linked_vehicle: { vin: VIN, title: '2018 Honda Vezel' }, ...over })

function Probe() {
  const location = useLocation()
  return <span data-testid="location">{location.pathname}</span>
}

const mount = (path: string, { shell = false }: { shell?: boolean } = {}) => {
  const wrap = (node: React.ReactNode) => (shell ? <WorkspaceBarProvidedContext.Provider value={true}>{node}</WorkspaceBarProvidedContext.Provider> : node)
  render(
    <MemoryRouter initialEntries={[path]}>
      <Probe />
      <Routes>
        <Route path="/diaspora/imports" element={wrap(<DiasporaImportList />)} />
        <Route path="/diaspora/imports/:id" element={wrap(<DiasporaImportDetail />)} />
        <Route path="/diaspora/imports/:id/documents" element={wrap(<DiasporaImportDocuments />)} />
        <Route path="/diaspora/imports/:id/shipment" element={wrap(<DiasporaImportShipment />)} />
        <Route path="/diaspora/imports/:id/passport" element={<p>ORDER DETAILS PAGE</p>} />
        <Route path="/diaspora/journey/:subjectType/:subjectId" element={<p>JOURNEY PAGE</p>} />
        <Route path="/dashboard/garage/:id" element={<p>VEHICLE PASSPORT PAGE</p>} />
        <Route path="/dashboard" element={<p>DASHBOARD PAGE</p>} />
      </Routes>
    </MemoryRouter>,
  )
}
const location = () => screen.getByTestId('location').textContent
const trail = () => screen.getByRole('navigation', { name: 'Breadcrumb' })
const crumbs = () => within(trail()).queryAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])

beforeEach(() => {
  vi.clearAllMocks()
  h.role = 'owner'
  h.orders = []
  h.order = owned()
  h.orderError = null
  h.vehicle = null
  h.api.fetchDiasporaImportOrders.mockImplementation(async () => h.orders)
  h.api.fetchDiasporaImportOrder.mockImplementation(async () => { if (h.orderError) throw h.orderError; return h.order })
  h.api.fetchDiasporaTradeDocuments.mockResolvedValue([])
  h.api.fetchDiasporaReservations.mockResolvedValue([])
  h.api.fetchDiasporaShipments.mockResolvedValue([])
  h.api.fetchDiasporaOpenContainers.mockResolvedValue([])
  h.getOrderVehicle.mockImplementation(async () => h.vehicle)
})
afterEach(cleanup)

describe('Import Orders — the root of Trade & Imports', () => {
  it('names each order by what the viewer may know, and never by a UUID', async () => {
    h.orders = [owned(), order({ id: OTHER, requested_make: 'Toyota', requested_model: 'Hilux' }), order({ id: 'abcdef12-0000-4000-8000-00000000000a' })]
    mount('/diaspora/imports')
    await waitFor(() => expect(screen.getAllByTestId('diaspora-import-row')).toHaveLength(3))
    expect(screen.getAllByTestId('diaspora-import-row-title').map((el) => el.textContent)).toEqual([
      '2018 Honda Vezel', 'Toyota Hilux', 'Import order ABCDEF12',
    ])
    const text = screen.getByTestId('diaspora-import-list').textContent ?? ''
    expect(text).not.toContain(ORDER)
    expect(text).not.toContain('507f88016f71')
    expect(text).not.toMatch(/Import [0-9a-f]{8}-/)
    expect(screen.getAllByTestId('diaspora-import-row').map((a) => a.getAttribute('href'))).toEqual([
      `/diaspora/imports/${ORDER}`, `/diaspora/imports/${OTHER}`, '/diaspora/imports/abcdef12-0000-4000-8000-00000000000a',
    ])
  })

  it('says which workspace it is, and offers the dashboard as the way up', async () => {
    mount('/diaspora/imports')
    await waitFor(() => expect(screen.getByTestId('diaspora-import-list')).toBeInTheDocument())
    expect(screen.getByTestId('workspace-bar')).toHaveAttribute('data-active-workspace', 'trade')
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/dashboard')
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull()
  })

  it('offers the dashboard as the way up only to a role that can open it', async () => {
    h.role = 'dealer'
    mount('/diaspora/imports')
    await waitFor(() => expect(screen.getByTestId('diaspora-import-list')).toBeInTheDocument())
    expect(screen.queryByRole('link', { name: 'Back to dashboard' })).toBeNull()
    expect(screen.getByTestId('workspace-bar')).toHaveAttribute('data-active-workspace', 'trade')
  })

  it('keeps its chrome when the list cannot be loaded', async () => {
    h.api.fetchDiasporaImportOrders.mockRejectedValue(new Error('Server unavailable'))
    mount('/diaspora/imports')
    await waitFor(() => expect(screen.getByTestId('diaspora-import-list-error')).toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toBeInTheDocument()
  })

  it('draws no second workspace bar inside the Trade shell', async () => {
    mount('/diaspora/imports', { shell: true })
    await waitFor(() => expect(screen.getByTestId('diaspora-import-list')).toBeInTheDocument())
    expect(screen.queryByTestId('workspace-bar')).toBeNull()
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toBeInTheDocument()
  })

  it('Import Orders → Import Order, by the row', async () => {
    h.orders = [owned()]
    mount('/diaspora/imports')
    fireEvent.click(await screen.findByTestId('diaspora-import-row'))
    await waitFor(() => expect(location()).toBe(`/diaspora/imports/${ORDER}`))
    expect(await screen.findByTestId('diaspora-order-summary')).toBeInTheDocument()
  })
})

describe('Import Order — named by its vehicle, with the journey first', () => {
  it('is titled by the vehicle for its owner, with the trail down to it and the list as its parent', async () => {
    mount(`/diaspora/imports/${ORDER}`)
    expect(await screen.findByTestId('diaspora-order-title')).toHaveTextContent('2018 Honda Vezel')
    expect(crumbs()).toEqual([['Trade & Imports', '/diaspora/imports'], ['Import Orders', '/diaspora/imports']])
    expect(within(trail()).getByTestId('workspace-crumb-current')).toHaveTextContent('2018 Honda Vezel')
    expect(screen.getByRole('link', { name: 'Back to import orders' })).toHaveAttribute('href', '/diaspora/imports')
    expect(screen.queryByText('Vehicle request')).toBeNull()
  })

  it('falls back to what was requested, then to a short reference — never "Vehicle request"', async () => {
    h.order = order({ requested_make: 'Toyota', requested_model: 'Hilux' })
    mount(`/diaspora/imports/${ORDER}`)
    expect(await screen.findByTestId('diaspora-order-title')).toHaveTextContent('Toyota Hilux')
    cleanup()
    h.order = order()
    mount(`/diaspora/imports/${ORDER}`)
    expect(await screen.findByTestId('diaspora-order-title')).toHaveTextContent('Import order 3E2B66A0')
    expect(screen.getByTestId('diaspora-order-title').textContent).not.toContain(ORDER)
  })

  it('leads with the journey (CAP), then its working pages, then the order’s details and the vehicle', async () => {
    mount(`/diaspora/imports/${ORDER}`)
    const actions = await screen.findByTestId('diaspora-order-actions')
    expect(within(actions).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Journey & arrival', `/diaspora/journey/import_order/${ORDER}`],
      ['Documents', `/diaspora/imports/${ORDER}/documents`],
      ['Shipment', `/diaspora/imports/${ORDER}/shipment`],
      ['Order details', `/diaspora/imports/${ORDER}/passport`],
      ['View Vehicle Passport', `/dashboard/garage/${VIN}`],
    ])
    expect(screen.getByTestId('diaspora-open-journey-button').className).toContain('bg-orange-600')
    expect(screen.getByTestId('diaspora-open-documents-button').className).not.toContain('bg-orange-600')
  })

  it('offers the Vehicle Passport only when the order endpoint named the vehicle to this viewer', async () => {
    h.order = order({ requested_make: 'Toyota' })
    mount(`/diaspora/imports/${ORDER}`)
    const actions = await screen.findByTestId('diaspora-order-actions')
    expect(within(actions).queryByRole('link', { name: 'View Vehicle Passport' })).toBeNull()
    expect(screen.queryByTestId('diaspora-open-vehicle-passport-button')).toBeNull()
  })

  it('does not set an "Import order passport" beside the "Vehicle Passport"', async () => {
    mount(`/diaspora/imports/${ORDER}`)
    await screen.findByTestId('diaspora-order-actions')
    expect(screen.getByTestId('diaspora-import-detail-route').textContent).not.toMatch(/order passport/i)
  })

  it('keeps its trail and way up when the order cannot be read, naming nothing it was not shown', async () => {
    h.orderError = new Error('You do not have access to this import order')
    mount(`/diaspora/imports/${ORDER}`)
    expect(await screen.findByTestId('diaspora-import-detail-error')).toBeInTheDocument()
    expect(within(trail()).getByTestId('workspace-crumb-current')).toHaveTextContent('Import order 3E2B66A0')
    expect(screen.queryByTestId('diaspora-order-actions')).toBeNull()
    expect(screen.getByRole('link', { name: 'Back to import orders' })).toBeInTheDocument()
  })

  it.each([
    ['the journey', 'diaspora-open-journey-button', `/diaspora/journey/import_order/${ORDER}`],
    ['the order’s details', 'diaspora-open-order-details-button', `/diaspora/imports/${ORDER}/passport`],
    ['the Vehicle Passport', 'diaspora-open-vehicle-passport-button', `/dashboard/garage/${VIN}`],
    ['the order’s documents', 'diaspora-open-documents-button', `/diaspora/imports/${ORDER}/documents`],
    ['the order’s shipment', 'diaspora-open-shipment-button', `/diaspora/imports/${ORDER}/shipment`],
  ])('Import Order → %s, by its button', async (_name, testId, expected) => {
    mount(`/diaspora/imports/${ORDER}`)
    // `Button asChild` puts the test id on the link itself.
    const target = await screen.findByTestId(testId)
    expect(target.tagName).toBe('A')
    expect(target).toHaveAttribute('href', expected)
    fireEvent.click(target)
    await waitFor(() => expect(location()).toBe(expected))
  })

  it('Import Order → Import Orders, by the way up', async () => {
    mount(`/diaspora/imports/${ORDER}`)
    fireEvent.click(await screen.findByRole('link', { name: 'Back to import orders' }))
    await waitFor(() => expect(location()).toBe('/diaspora/imports'))
  })
})

describe('Trade documents (a page of the order)', () => {
  it('sits under the order and goes back to it', async () => {
    mount(`/diaspora/imports/${ORDER}/documents`)
    await waitFor(() => expect(screen.getByTestId('diaspora-import-documents-route')).toBeInTheDocument())
    // No vehicle to name: the short reference, once the vehicle read has ANSWERED ("Import order" until then).
    await waitFor(() => expect(crumbs()).toEqual([
      ['Trade & Imports', '/diaspora/imports'],
      ['Import Orders', '/diaspora/imports'],
      ['Import order 3E2B66A0', `/diaspora/imports/${ORDER}`],
    ]))
    expect(within(trail()).getByTestId('workspace-crumb-current')).toHaveTextContent('Trade documents')
    expect(screen.getByRole('link', { name: 'Back to import order' })).toHaveAttribute('href', `/diaspora/imports/${ORDER}`)
  })

  it('names the order by its vehicle once the order endpoint shows the viewer owns it', async () => {
    h.vehicle = { vin: VIN, title: '2018 Honda Vezel' }
    mount(`/diaspora/imports/${ORDER}/documents`)
    expect(await within(await screen.findByTestId('diaspora-import-documents-route')).findByRole('link', { name: '2018 Honda Vezel' })).toHaveAttribute('href', `/diaspora/imports/${ORDER}`)
    expect(h.getOrderVehicle).toHaveBeenCalledWith(ORDER)
  })

  it('Trade documents → Import Order, by the way up', async () => {
    mount(`/diaspora/imports/${ORDER}/documents`)
    fireEvent.click(await screen.findByRole('link', { name: 'Back to import order' }))
    await waitFor(() => expect(location()).toBe(`/diaspora/imports/${ORDER}`))
  })
})

describe('Container & shipment (a page of the order)', () => {
  it('names the order from the order it loads, and goes back to it', async () => {
    mount(`/diaspora/imports/${ORDER}/shipment`)
    await waitFor(() => expect(screen.getByTestId('diaspora-import-shipment-route')).toBeInTheDocument())
    await waitFor(() => expect(crumbs().map(([text]) => text)).toContain('2018 Honda Vezel'))
    expect(crumbs()).toEqual([
      ['Trade & Imports', '/diaspora/imports'],
      ['Import Orders', '/diaspora/imports'],
      ['2018 Honda Vezel', `/diaspora/imports/${ORDER}`],
    ])
    expect(within(trail()).getByTestId('workspace-crumb-current')).toHaveTextContent('Container & shipment')
    expect(screen.getByRole('link', { name: 'Back to import order' })).toHaveAttribute('href', `/diaspora/imports/${ORDER}`)
  })

  it('Container & shipment → Import Order, by the way up', async () => {
    mount(`/diaspora/imports/${ORDER}/shipment`)
    fireEvent.click(await screen.findByRole('link', { name: 'Back to import order' }))
    await waitFor(() => expect(location()).toBe(`/diaspora/imports/${ORDER}`))
  })
})

/** A promise the test settles by hand, so a page can be looked at while its read is still out. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('an order still being read is called "Import order" — never its reference (physical UAT finding)', () => {
  // On the deployed candidate the trail read "Import order 3E2B66A0" for two to three seconds on every visit to these pages and then
  // changed to "2018 Honda Vezel": the same order, two names. The short reference is the name of an order nothing else is known about,
  // so it may appear only once the read that would name the order has ANSWERED.
  it('Import Order: "Import order" while the order loads, then the vehicle', async () => {
    const read = deferred<unknown>()
    h.api.fetchDiasporaImportOrder.mockImplementation(() => read.promise)
    mount(`/diaspora/imports/${ORDER}`)
    await waitFor(() => expect(within(trail()).getByTestId('workspace-crumb-current')).toHaveTextContent(/^Import order$/))
    expect(trail().textContent).not.toMatch(/3E2B66A0/i)
    await act(async () => { read.resolve(owned()) })
    await waitFor(() => expect(within(trail()).getByTestId('workspace-crumb-current')).toHaveTextContent('2018 Honda Vezel'))
  })

  it('Trade documents: the order link says "Import order" until the vehicle read answers, then names the vehicle', async () => {
    const read = deferred<{ vin: string; title: string | null } | null>()
    h.getOrderVehicle.mockImplementation(() => read.promise)
    mount(`/diaspora/imports/${ORDER}/documents`)
    await waitFor(() => expect(screen.getByTestId('diaspora-import-documents-route')).toBeInTheDocument())
    expect(crumbs()[2]).toEqual(['Import order', `/diaspora/imports/${ORDER}`])
    expect(trail().textContent).not.toMatch(/3E2B66A0/i)
    await act(async () => { read.resolve({ vin: VIN, title: '2018 Honda Vezel' }) })
    await waitFor(() => expect(crumbs()[2]).toEqual(['2018 Honda Vezel', `/diaspora/imports/${ORDER}`]))
  })

  it('Trade documents: a vehicle read that FAILED has answered — the order then gets its short reference', async () => {
    const read = deferred<{ vin: string; title: string | null } | null>()
    h.getOrderVehicle.mockImplementation(() => read.promise)
    mount(`/diaspora/imports/${ORDER}/documents`)
    await waitFor(() => expect(crumbs()[2]).toEqual(['Import order', `/diaspora/imports/${ORDER}`]))
    await act(async () => { read.reject(new Error('Server unavailable')) })
    await waitFor(() => expect(crumbs()[2]).toEqual(['Import order 3E2B66A0', `/diaspora/imports/${ORDER}`]))
  })

  it('Container & shipment: "Import order" while the order loads, then the vehicle', async () => {
    const read = deferred<unknown>()
    h.api.fetchDiasporaImportOrder.mockImplementation(() => read.promise)
    mount(`/diaspora/imports/${ORDER}/shipment`)
    await waitFor(() => expect(screen.getByTestId('diaspora-import-shipment-route')).toBeInTheDocument())
    expect(crumbs()[2]).toEqual(['Import order', `/diaspora/imports/${ORDER}`])
    expect(trail().textContent).not.toMatch(/3E2B66A0/i)
    await act(async () => { read.resolve(owned()) })
    await waitFor(() => expect(crumbs()[2]).toEqual(['2018 Honda Vezel', `/diaspora/imports/${ORDER}`]))
  })
})
