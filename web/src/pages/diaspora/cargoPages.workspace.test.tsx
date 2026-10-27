/**
 * T11-CAP-LR01-R3 (Step H) — a cargo booking’s tracking and customs pages hang off its import journey.
 *
 * Their content is T11’s and T12’s and is untouched (those test files are unchanged). What is added is only where the page
 * sits and the way back up: the booking’s journey, offered when the role can open it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

vi.setConfig({ testTimeout: 30_000 })

const h = vi.hoisted(() => ({
  role: 'owner' as string,
  tracking: null as unknown,
  customs: null as unknown,
  err: null as Error | null,
  getMyTracking: vi.fn(),
  getMyCustoms: vi.fn(),
  loading: null as unknown,
  cargo: null as unknown,
  getMyLoadStatus: vi.fn(),
  getMyCargo: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ loading: false, user: { id: 'u1', name: 'Kingston Musarurwa', role: h.role } }),
}))
vi.mock('@/hooks/useTradeLogisticsApi', () => ({
  useTradeLogisticsApi: () => ({ getMyTracking: h.getMyTracking, getMyCustoms: h.getMyCustoms, getMyLoadStatus: h.getMyLoadStatus, getMyCargo: h.getMyCargo }),
}))

import MyShipmentTracking from './MyShipmentTracking'
import MyCustomsDestination from './MyCustomsDestination'
import MyCargoLoading from './MyCargoLoading'
import MyCargoIntake from './MyCargoIntake'

const BOOKING = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

const tracking = () => ({
  subject: { type: 'cargo_reservation', id: BOOKING },
  state: 'SHIPMENT_CREATED',
  sentence: 'A shipment has been set up for your container. Nothing has been recorded as moving yet.',
  left_behind_reason: null,
  dates: {
    planned_departure: '2026-09-20T00:00:00Z', planned_departure_source: 'stated_at_creation', observed_departure: null,
    estimated_arrival: '2026-10-01T00:00:00Z', observed_arrival: null, note: 'plan vs record',
  },
  references: { carrier: 'Maersk', tracking_reference: 'TRK-999', origin_port: 'Durban', destination_port: 'Beira', container_number: null, seal_number: null, note: 'n' },
  timeline: [],
  exception: null,
  note: 'Customs, duties and release are recorded separately and are not shown here.',
})

const customs = () => ({
  subject: { type: 'cargo_reservation', id: BOOKING },
  state: 'IN_PROGRESS',
  reference: 'CUST-A1B2C3D4',
  sentence: 'Your cargo is going through customs.',
  agent: { display_name: 'Nyati Clearing (Pvt) Ltd', note: 'n' },
  agent_note: null,
  checklist: [{ key: 'DOCUMENTS', label: 'Documents', state: 'NOT_RECORDED', at: null, needed: 'The documents the clearing agent asked for.' }],
  assessment: { assessed: false, amount: null, currency: null, headline: 'Not yet assessed', detail: 'No assessment has been received.', source: null, source_strength: null, assessment_date: null, customs_rate: null },
  payment: { evidence_received: false, headline: 'No payment evidence', detail: 'd', amount: null, currency: null, source_strength: null },
  release: { evidence_received: false, headline: 'No release evidence', detail: 'd', source_strength: null },
  handoffs: {
    gateway: { port: 'Beira', country: 'Mozambique', arrived_at: null, observed: false },
    transit_started_at: null,
    destination: { country: 'Zimbabwe', city: 'Harare', final_destination: 'Harare depot', arrived_at: null, observed: false },
    collected_at: null, delivered_at: null, note: 'n',
  },
  timeline: [],
  next_action: 'Next: The clearing agent lodges the declaration.',
  note: 'CarUp coordinates customs. It is not ZIMRA.',
  unknown_note: 'Anything not shown has not been recorded.',
})

const loading = () => ({
  subject: { type: 'cargo_reservation', id: BOOKING },
  state: 'LOADED', sentence: 'Your cargo has been loaded into the container.', left_behind_reason: null,
  loaded_volume_cbm: 3.6, loaded_at: '2026-09-12T14:00:00Z', note: 'Loaded means your cargo is inside the container.',
})

const cargo = () => ({
  subject: { type: 'cargo_reservation', id: BOOKING },
  intake: null,
  estimate: { volume_cbm: 3, weight_kg: 800, completeness: 'COMPLETE', items_total: 1, items_with_volume: 1, source: 'The volume this booking was approved against' },
  status_sentence: 'No warehouse has booked this cargo in yet.',
  eligible_for_intake: true, eligibility_note: null,
})

function Probe() {
  const location = useLocation()
  return <span data-testid="location">{location.pathname}</span>
}
const open = async (path: string, expected: string) => {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Probe />
      <Routes>
        <Route path="/diaspora/tracking/:subjectType/:subjectId" element={<MyShipmentTracking />} />
        <Route path="/diaspora/my-customs/:subjectType/:subjectId" element={<MyCustomsDestination />} />
        <Route path="/diaspora/cargo-loading/:subjectType/:subjectId" element={<MyCargoLoading />} />
        <Route path="/diaspora/cargo/:subjectType/:subjectId" element={<MyCargoIntake />} />
        <Route path="/diaspora/journey/:subjectType/:subjectId" element={<p>JOURNEY PAGE</p>} />
        <Route path="/diaspora/imports" element={<p>IMPORT ORDERS LIST</p>} />
      </Routes>
    </MemoryRouter>,
  )
  await waitFor(() => expect(screen.getByTestId(expected)).toBeInTheDocument())
}
const trail = () => screen.getByRole('navigation', { name: 'Breadcrumb' })
const crumbs = () => within(trail()).queryAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])
const location = () => screen.getByTestId('location').textContent
const JOURNEY = `/diaspora/journey/cargo_reservation/${BOOKING}`

beforeEach(() => {
  vi.clearAllMocks()
  h.role = 'owner'
  h.err = null
  h.tracking = tracking()
  h.customs = customs()
  h.loading = loading()
  h.cargo = cargo()
  h.getMyLoadStatus.mockImplementation(async () => { if (h.err) throw h.err; return h.loading })
  h.getMyCargo.mockImplementation(async () => { if (h.err) throw h.err; return h.cargo })
  h.getMyTracking.mockImplementation(async () => { if (h.err) throw h.err; return h.tracking })
  h.getMyCustoms.mockImplementation(async () => { if (h.err) throw h.err; return h.customs })
})
afterEach(cleanup)

describe.each([
  ['Where your cargo is', `/diaspora/tracking/cargo_reservation/${BOOKING}`, 'my-shipment-tracking', 'tracking-unreadable'],
  ['Your cargo & customs', `/diaspora/my-customs/cargo_reservation/${BOOKING}`, 'my-customs-destination', 'my-customs-unreadable'],
  ['Your cargo and the container', `/diaspora/cargo-loading/cargo_reservation/${BOOKING}`, 'my-cargo-loading', 'my-loading-unreadable'],
  ['Your cargo', `/diaspora/cargo/cargo_reservation/${BOOKING}`, 'my-cargo', 'cargo-unreadable'],
])('%s', (page, path, readyId, unreadableId) => {
  it('sits under the booking’s journey, in Trade & Imports, and goes up to it', async () => {
    await open(path, readyId)
    expect(screen.getByTestId('workspace-bar')).toHaveAttribute('data-active-workspace', 'trade')
    expect(crumbs()).toEqual([['Trade & Imports', '/diaspora/imports'], ['Journey & arrival', JOURNEY]])
    expect(within(trail()).getByTestId('workspace-crumb-current')).toHaveTextContent(page)
    expect(screen.getByRole('link', { name: 'Back to journey & arrival' })).toHaveAttribute('href', JOURNEY)
  })

  it('names no order and builds no order address (it does not know the order, and does not go and find it)', async () => {
    await open(path, readyId)
    expect(screen.getByTestId('workspace-chrome').innerHTML).not.toContain('/diaspora/imports/')
  })

  it('Journey is one explicit control away', async () => {
    await open(path, readyId)
    fireEvent.click(screen.getByRole('link', { name: 'Back to journey & arrival' }))
    await waitFor(() => expect(location()).toBe(JOURNEY))
    expect(await screen.findByText('JOURNEY PAGE')).toBeInTheDocument()
  })

  it('keeps the trail and the way up when the page cannot be read, and still says what it says', async () => {
    h.err = new Error('This could not be read.')
    await open(path, unreadableId)
    expect(crumbs()).toEqual([['Trade & Imports', '/diaspora/imports'], ['Journey & arrival', JOURNEY]])
    expect(screen.getByRole('link', { name: 'Back to journey & arrival' })).toHaveAttribute('href', JOURNEY)
    expect(screen.getByTestId(unreadableId).textContent).toMatch(/not a report that/i)
  })

  it('offers a role that cannot open the owner workspace the journey, and shows the workspace as text', async () => {
    h.role = 'dealer'
    await open(path, readyId)
    expect(crumbs()).toEqual([['Journey & arrival', JOURNEY]])
    expect(within(trail()).getByText('Trade & Imports').closest('a')).toBeNull()
  })
})

describe('the pages’ own links are untouched', () => {
  it('tracking still offers whether the cargo was loaded', async () => {
    await open(`/diaspora/tracking/cargo_reservation/${BOOKING}`, 'my-shipment-tracking')
    expect(screen.getByTestId('tracking-loading-link')).toHaveAttribute('href', `/diaspora/cargo-loading/cargo_reservation/${BOOKING}`)
  })

  it('customs still offers the shipment itself', async () => {
    await open(`/diaspora/my-customs/cargo_reservation/${BOOKING}`, 'my-customs-destination')
    expect(screen.getByTestId('my-customs-tracking-link')).toHaveAttribute('href', `/diaspora/tracking/cargo_reservation/${BOOKING}`)
  })
})
