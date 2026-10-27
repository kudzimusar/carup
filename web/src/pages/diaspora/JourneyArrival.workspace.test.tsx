/**
 * T11-CAP-LR01-R3 (Step G) — the import journey (CAP) knows where it sits and how to leave.
 *
 * R2 froze what the journey SAYS; R3 adds only where it is and the ways out: the workspace, a trail, an explicit
 * way up, and — for the vehicle's own owner — the way to the Vehicle Passport. Nothing here reads or asserts the
 * journey's content (the R2 tests do that and are unchanged apart from a no-vehicle stub in their mock).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent, cleanup } from '@testing-library/react'
import { Link, MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

vi.setConfig({ testTimeout: 30_000 })

const h = vi.hoisted(() => {
  const state = {
    views: {} as Record<string, unknown>,
    role: 'owner' as string,
    vehicle: null as { vin: string; title: string | null } | null,
    vehicleError: null as Error | null,
    vehicleGate: null as Promise<void> | null,
    /** Per-order overrides: an answer, and a gate that holds that order's lookup open. */
    vehicleFor: {} as Record<string, { vin: string; title: string | null } | null>,
    gates: {} as Record<string, Promise<void>>,
    /** Hand the page a NEW fetcher function on every render, the way an unmemoised hook (or a per-render mock) would. */
    unstableFetcher: false,
    asked: [] as string[],
  }
  return {
    state,
    getJourney: vi.fn(async (type: string, id: string) => {
      const view = state.views[`${type}:${id}`]
      if (!view) throw new Error('This could not be read.')
      return view
    }),
    getOrderVehicle: vi.fn(async (orderId: string) => {
      state.asked.push(orderId)
      if (state.vehicleGate) await state.vehicleGate
      if (state.gates[orderId]) await state.gates[orderId]
      if (state.vehicleError) throw state.vehicleError
      return orderId in state.vehicleFor ? state.vehicleFor[orderId] : state.vehicle
    }),
  }
})
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ loading: false, user: { id: 'u1', name: 'Kingston Musarurwa', role: h.state.role } }),
}))
vi.mock('@/hooks/useTradeLogisticsApi', () => ({
  useTradeLogisticsApi: () => ({
    getJourney: h.getJourney,
    getOrderVehicle: h.state.unstableFetcher ? (orderId: string) => h.getOrderVehicle(orderId) : h.getOrderVehicle,
    getDocumentAccess: vi.fn(),
  }),
}))

import JourneyArrival from './JourneyArrival'
import { shortRef } from './journeyDisplay'
import { WorkspaceBarProvidedContext } from '@/components/workspace'

const ORDER = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const OTHER = 'b2c3d4e5-f6a7-8901-bcde-f12345678901'
const VIN = 'RU3-1316558'
const NOT_COMPOSED = (owner: string) => ({ availability: 'not_yet_composed', owner })

const journeyFor = (orderId: string | null, over: Record<string, unknown> = {}) => ({
  subject: { type: orderId ? 'import_order' : 'vehicle', id: orderId ?? VIN, order_id: orderId },
  viewer: { kind: 'OWNER' },
  state: 'SHIPMENT_CREATED',
  sentence: 'A shipment has been set up. Nothing has been recorded as moving yet.',
  asset: { make: 'Honda', model: 'Vezel', year: 2018, color: 'Pearl', mileage: 1000, source: 'vehicles' },
  transaction: orderId
    ? { order_id: orderId, status: 'DOCUMENTS_PENDING', origin_country: 'Japan', origin_city: null, destination_country: 'Zimbabwe', destination_city: null }
    : null,
  shipping: null,
  timeline: [],
  exceptions: [],
  contacts: null,
  sections: {
    documents: { availability: 'composed', summary: { total: 1, missing: 1 }, items: [], disclaimer: 'd', note: 'n' },
    customs: NOT_COMPOSED('T12'), payments: NOT_COMPOSED('T13'), notifications: NOT_COMPOSED('T7'), actions: NOT_COMPOSED('derived'),
  },
  provenance: { asset: { authority: 'vehicles' } },
  generated_at: '2026-10-27T00:00:00Z',
  note: 'This is a composition of records owned elsewhere. It records nothing and decides nothing.',
  ...over,
})

function Probe() {
  const location = useLocation()
  return <span data-testid="location">{location.pathname}</span>
}

const mount = (path: string, { shell = false }: { shell?: boolean } = {}) => {
  const page = <JourneyArrival />
  render(
    <MemoryRouter initialEntries={[path]}>
      <Probe />
      <Link to={`/diaspora/journey/import_order/${OTHER}`} data-testid="go-other">go to the other order</Link>
      <Routes>
        <Route path="/diaspora/journey/:subjectType/:subjectId" element={shell ? <WorkspaceBarProvidedContext.Provider value={true}>{page}</WorkspaceBarProvidedContext.Provider> : page} />
        <Route path="/diaspora/imports" element={<p>IMPORT ORDERS LIST</p>} />
        <Route path="/diaspora/imports/:id" element={<p>IMPORT ORDER PAGE</p>} />
        <Route path="/dashboard/garage/:id" element={<p>VEHICLE PASSPORT PAGE</p>} />
        <Route path="/diaspora/documents/:subjectType/:subjectId" element={<p>DOCUMENT WORKSPACE</p>} />
      </Routes>
    </MemoryRouter>,
  )
}
const open = async (path = `/diaspora/journey/import_order/${ORDER}`, options?: { shell?: boolean }) => {
  mount(path, options)
  await waitFor(() => expect(screen.getByTestId('journey-page')).toBeInTheDocument())
}
const trail = () => screen.getByRole('navigation', { name: 'Breadcrumb' })
const location = () => screen.getByTestId('location').textContent

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  h.state.role = 'owner'
  h.state.vehicle = null
  h.state.vehicleError = null
  h.state.vehicleGate = null
  h.state.vehicleFor = {}
  h.state.gates = {}
  h.state.unstableFetcher = false
  h.state.asked = []
  h.state.views = {
    [`import_order:${ORDER}`]: journeyFor(ORDER),
    [`import_order:${OTHER}`]: journeyFor(OTHER, { asset: { make: 'Nissan', model: 'Serena', year: 2016, color: null, mileage: null, source: 'vehicles' } }),
  }
})

describe('where the import journey sits', () => {
  it('names the workspace, shows the trail down to this page, and offers the way up', async () => {
    await open()
    expect(screen.getByTestId('workspace-bar')).toHaveAttribute('data-active-workspace', 'trade')
    const links = within(trail()).getAllByRole('link')
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Trade & Imports', '/diaspora/imports'],
      ['Import Orders', '/diaspora/imports'],
      ['2018 Honda Vezel', `/diaspora/imports/${ORDER}`],
    ])
    const current = within(trail()).getByTestId('workspace-crumb-current')
    expect(current).toHaveTextContent('Journey & arrival')
    expect(current).toHaveAttribute('aria-current', 'page')
    expect(current.closest('a')).toBeNull()
    expect(screen.getByRole('link', { name: 'Back to import order' })).toHaveAttribute('href', `/diaspora/imports/${ORDER}`)
  })

  it('keeps the page’s own heading: one h1, the vehicle, and the R2 header exactly as it was', async () => {
    await open()
    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0]).toHaveTextContent('2018 Honda Vezel')
    expect(screen.getByTestId('journey-title')).toBe(headings[0])
    expect(screen.getByText(`Journey & arrival · ${shortRef(ORDER)}`)).toBeInTheDocument()
  })

  it('prints no order id: the trail and the way up name the vehicle, and the id lives only in the address', async () => {
    await open()
    const chrome = (screen.getByTestId('workspace-chrome').textContent ?? '').toLowerCase()
    expect(chrome).not.toContain(ORDER.toLowerCase())
    expect(chrome).not.toContain(shortRef(ORDER).toLowerCase())
  })

  it('draws ONE workspace bar on its own and none inside a shell that already drew it', async () => {
    await open()
    expect(screen.getAllByTestId('workspace-bar')).toHaveLength(1)
    cleanup()
    await open(undefined, { shell: true })
    expect(screen.queryByTestId('workspace-bar')).toBeNull()
    // The trail and the way up are the page's, so they stay.
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument()
    expect(screen.getByTestId('workspace-parent-link')).toBeInTheDocument()
  })
})

describe('a vehicle with several import orders (the chooser)', () => {
  const chooser = () => journeyFor(null, {
    candidates: [
      { order_id: ORDER, status: 'DOCUMENTS_PENDING', created_at: '2026-10-25T04:16:30Z' },
      { order_id: OTHER, status: 'IMPORT_REQUESTED', created_at: '2026-10-26T04:16:30Z' },
    ],
  })

  beforeEach(() => { h.state.views[`vehicle:${VIN}`] = chooser() })

  it('has no single order to link to: the vehicle is a plain step in the trail and the way up is the list', async () => {
    await open(`/diaspora/journey/vehicle/${VIN}`)
    expect(within(trail()).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/diaspora/imports', '/diaspora/imports'])
    expect(within(trail()).getByText('2018 Honda Vezel').closest('a')).toBeNull()
    expect(screen.getByRole('link', { name: 'Back to import orders' })).toHaveAttribute('href', '/diaspora/imports')
    expect(screen.queryByRole('link', { name: 'Back to import order' })).toBeNull()
  })

  it('still offers the choice, untouched, and looks no vehicle up (there is no order to ask about)', async () => {
    await open(`/diaspora/journey/vehicle/${VIN}`)
    const candidates = screen.getByTestId('journey-candidates')
    expect(within(candidates).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      `/diaspora/journey/import_order/${ORDER}`,
      `/diaspora/journey/import_order/${OTHER}`,
    ])
    expect(h.getOrderVehicle).not.toHaveBeenCalled()
    expect(screen.queryByTestId('cap-vehicle-passport-link')).toBeNull()
  })
})

describe('the Vehicle Passport exit — offered only on proof the viewer owns the vehicle', () => {
  it('is offered when the order endpoint names the vehicle, and goes to that vehicle’s Passport', async () => {
    h.state.vehicle = { vin: VIN, title: '2018 Honda Vezel' }
    await open()
    const link = await screen.findByTestId('cap-vehicle-passport-link')
    expect(link).toHaveTextContent('View Vehicle Passport')
    expect(link).toHaveAttribute('href', `/dashboard/garage/${VIN}`)
    expect(link.closest('nav')).toHaveAccessibleName('Elsewhere for this vehicle')
    expect(h.getOrderVehicle).toHaveBeenCalledTimes(1)
    expect(h.getOrderVehicle).toHaveBeenCalledWith(ORDER)
  })

  it('is absent while the lookup is pending and appears only when it resolves', async () => {
    let release!: () => void
    h.state.vehicleGate = new Promise<void>((resolve) => { release = resolve })
    h.state.vehicle = { vin: VIN, title: null }
    await open()
    expect(screen.queryByTestId('cap-vehicle-passport-link')).toBeNull()
    release()
    expect(await screen.findByTestId('cap-vehicle-passport-link')).toBeInTheDocument()
  })

  it('is absent for a viewer the order endpoint does not name the vehicle to — and says nothing about it', async () => {
    h.state.vehicle = null
    await open()
    await waitFor(() => expect(h.getOrderVehicle).toHaveBeenCalled())
    expect(screen.queryByTestId('cap-vehicle-passport-link')).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Elsewhere for this vehicle' })).toBeNull()
    expect(screen.queryByText(/passport/i)).toBeNull()
  })

  it('is absent when the lookup fails, and the journey is unaffected', async () => {
    h.state.vehicleError = new Error('Forbidden')
    await open()
    await waitFor(() => expect(h.getOrderVehicle).toHaveBeenCalled())
    expect(screen.queryByTestId('cap-vehicle-passport-link')).toBeNull()
    expect(screen.getByTestId('journey-title')).toHaveTextContent('2018 Honda Vezel')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('encodes the vehicle identifier into the address', async () => {
    h.state.vehicle = { vin: 'A B/1?x', title: null }
    await open()
    expect(await screen.findByTestId('cap-vehicle-passport-link')).toHaveAttribute('href', '/dashboard/garage/A%20B%2F1%3Fx')
  })

  it('never shows one order’s vehicle on another order', async () => {
    h.state.vehicle = { vin: VIN, title: null }
    await open()
    expect(await screen.findByTestId('cap-vehicle-passport-link')).toBeInTheDocument()
    // The second order's lookup never settles: the first order's answer must not be shown beside it.
    h.state.vehicleGate = new Promise<void>(() => { /* never */ })
    fireEvent.click(screen.getByTestId('go-other'))
    await waitFor(() => expect(h.getOrderVehicle).toHaveBeenCalledWith(OTHER))
    await waitFor(() => expect(screen.getByTestId('journey-title')).toHaveTextContent('2016 Nissan Serena'))
    expect(h.state.asked).toEqual([ORDER, OTHER])
    expect(screen.queryByTestId('cap-vehicle-passport-link')).toBeNull()
  })
})

describe('the Vehicle Passport lookup is well-behaved', () => {
  it('a slow answer for the order you LEFT cannot replace the answer for the order you are on', async () => {
    let releaseFirst!: () => void
    h.state.gates[ORDER] = new Promise<void>((resolve) => { releaseFirst = resolve })
    h.state.vehicleFor[ORDER] = { vin: 'FIRST-VIN', title: null }
    h.state.vehicleFor[OTHER] = { vin: 'SECOND-VIN', title: null }
    await open()
    fireEvent.click(screen.getByTestId('go-other'))
    await waitFor(() => expect(screen.getByTestId('journey-title')).toHaveTextContent('2016 Nissan Serena'))
    expect(await screen.findByTestId('cap-vehicle-passport-link')).toHaveAttribute('href', '/dashboard/garage/SECOND-VIN')
    releaseFirst()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.getByTestId('cap-vehicle-passport-link')).toHaveAttribute('href', '/dashboard/garage/SECOND-VIN')
  })

  it('does not hammer the endpoint when the hook hands over a new fetcher every render', async () => {
    h.state.unstableFetcher = true
    h.state.vehicle = { vin: VIN, title: null }
    await open()
    expect(await screen.findByTestId('cap-vehicle-passport-link')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 100))
    const settled = h.state.asked.length
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(h.state.asked.length).toBe(settled)
    expect(settled).toBeLessThanOrEqual(3)
  })
})

describe('a role that may read the journey but cannot open the owner pages', () => {
  it('is handed no link to a page it would be turned away from — the trail stays complete as text', async () => {
    h.state.role = 'dealer'
    h.state.vehicle = { vin: VIN, title: '2018 Honda Vezel' }
    await open()
    await waitFor(() => expect(h.getOrderVehicle).toHaveBeenCalled())
    expect(within(trail()).queryAllByRole('link')).toHaveLength(0)
    expect(within(trail()).getByText('Trade & Imports')).toBeInTheDocument()
    expect(within(trail()).getByText('Import Orders')).toBeInTheDocument()
    expect(within(trail()).getByText('2018 Honda Vezel')).toBeInTheDocument()
    expect(screen.queryByTestId('workspace-parent-link')).toBeNull()
    expect(screen.queryByTestId('cap-vehicle-passport-link')).toBeNull()
    // The page itself, and its own links, are unaffected.
    expect(screen.getByTestId('cap-documents-link')).toBeInTheDocument()
  })
})

describe('a journey that could not be read', () => {
  it('still says where you are and how to leave, names no vehicle or order, and still says what it says', async () => {
    h.state.views = {}
    mount(`/diaspora/journey/import_order/${ORDER}`)
    await waitFor(() => expect(screen.getByTestId('journey-unreadable')).toBeInTheDocument())
    expect(within(trail()).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/diaspora/imports', '/diaspora/imports'])
    expect(within(trail()).getByTestId('workspace-crumb-current')).toHaveTextContent('Journey & arrival')
    expect(screen.getByRole('link', { name: 'Back to import orders' })).toHaveAttribute('href', '/diaspora/imports')
    expect(screen.getByTestId('journey-unreadable')).toHaveTextContent('That is not a report that nothing has happened.')
    expect(screen.getByTestId('journey-unreadable')).not.toHaveTextContent(/honda|vezel/i)
    expect(h.getOrderVehicle).not.toHaveBeenCalled()
    expect(screen.queryByTestId('cap-vehicle-passport-link')).toBeNull()
  })
})

describe('leaving the journey with explicit controls (no browser Back)', () => {
  it('CAP → Import Order, by the way up', async () => {
    await open()
    fireEvent.click(screen.getByRole('link', { name: 'Back to import order' }))
    expect(await screen.findByText('IMPORT ORDER PAGE')).toBeInTheDocument()
    expect(location()).toBe(`/diaspora/imports/${ORDER}`)
  })

  it('CAP → Import Order, by the vehicle’s step in the trail', async () => {
    await open()
    fireEvent.click(within(trail()).getByRole('link', { name: '2018 Honda Vezel' }))
    expect(await screen.findByText('IMPORT ORDER PAGE')).toBeInTheDocument()
    expect(location()).toBe(`/diaspora/imports/${ORDER}`)
  })

  it('CAP → Import Orders, by the trail (and by the workspace)', async () => {
    await open()
    fireEvent.click(within(trail()).getByRole('link', { name: 'Import Orders' }))
    expect(await screen.findByText('IMPORT ORDERS LIST')).toBeInTheDocument()
    expect(location()).toBe('/diaspora/imports')
    cleanup()
    await open()
    fireEvent.click(screen.getByTestId('workspace-trade'))
    expect(await screen.findByText('IMPORT ORDERS LIST')).toBeInTheDocument()
  })

  it('CAP → Vehicle Passport, for the owner', async () => {
    h.state.vehicle = { vin: VIN, title: null }
    await open()
    fireEvent.click(await screen.findByTestId('cap-vehicle-passport-link'))
    expect(await screen.findByText('VEHICLE PASSPORT PAGE')).toBeInTheDocument()
    expect(location()).toBe(`/dashboard/garage/${VIN}`)
  })

  it('CAP → Documents, by the R2 link inside the journey (unchanged)', async () => {
    await open()
    fireEvent.click(screen.getByTestId('cap-documents-link'))
    expect(await screen.findByText('DOCUMENT WORKSPACE')).toBeInTheDocument()
    expect(location()).toBe(`/diaspora/documents/import_order/${ORDER}`)
  })

  it('CAP → My Vehicles and Marketplace, by the workspace bar', async () => {
    await open()
    expect(screen.getByTestId('workspace-vehicles')).toHaveAttribute('href', '/dashboard/garage')
    expect(screen.getByTestId('workspace-marketplace')).toHaveAttribute('href', '/dashboard/listings')
  })
})
