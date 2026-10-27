/**
 * T11-CAP-LR01-R3 (Step H) — the paperwork knows what it is paperwork FOR, and how to get back.
 *
 * Before: the T8 workspace had no navigation at all and named an import order "PURCHASE 3E2B66A0". Now an import order's
 * paperwork is a page of the order (named by its vehicle for the vehicle's owner, with the order as its parent, and the
 * journey and the Vehicle Passport beside it), while any other kind of transaction — which has no import order above it —
 * gets the workspace and its own name and no parent that would be a guess.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent, cleanup, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

vi.setConfig({ testTimeout: 30_000 })

const h = vi.hoisted(() => ({
  role: 'owner' as string,
  workspace: null as unknown,
  err: null as Error | null,
  vehicle: null as { vin: string; title: string | null } | null,
  fetchDocumentWorkspace: vi.fn(),
  getOrderVehicle: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ loading: false, user: { id: 'u1', name: 'Kingston Musarurwa', role: h.role } }),
}))
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => ({ fetchDocumentWorkspace: h.fetchDocumentWorkspace }) }))
vi.mock('@/hooks/useTradeLogisticsApi', () => ({ useTradeLogisticsApi: () => ({ getOrderVehicle: h.getOrderVehicle }) }))

import TradeDocumentsWorkspace from './TradeDocumentsWorkspace'

const ORDER = '3e2b66a0-1e8b-43c9-bd48-507f88016f71'
const REQUEST = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const VIN = 'RU3-1316558'

const workspace = (type: string, id: string) => ({
  subject: { type, id },
  viewer_role: 'requester',
  items: [{
    document_type: 'commercial_invoice', display_name: 'Commercial Invoice', verification_required: true, state: 'MISSING', note: 'Not supplied yet.', document: null,
  }],
  summary: { total: 1, supplied: 0, verified: 0, awaiting_review: 0, rejected: 0, requested_outstanding: 0 },
  disclaimer: 'A document being present does not mean it has been checked.',
})

function Probe() {
  const location = useLocation()
  return <span data-testid="location">{location.pathname}</span>
}
const open = async (type: string, id: string, expected = 'documents-workspace') => {
  render(
    <MemoryRouter initialEntries={[`/diaspora/documents/${type}/${id}`]}>
      <Probe />
      <Routes>
        <Route path="/diaspora/documents/:subjectType/:subjectId" element={<TradeDocumentsWorkspace />} />
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
  h.role = 'owner'
  h.err = null
  h.vehicle = null
  h.workspace = workspace('import_order', ORDER)
  h.fetchDocumentWorkspace.mockImplementation(async () => { if (h.err) throw h.err; return h.workspace })
  h.getOrderVehicle.mockImplementation(async () => h.vehicle)
})
afterEach(cleanup)

describe('an import order’s paperwork', () => {
  it('is a page of the order: trail, way up, and the journey beside it', async () => {
    await open('import_order', ORDER)
    // An order with no vehicle to name is called by its short reference once the vehicle read has ANSWERED ("Import order" until then).
    await waitFor(() => expect(crumbs()).toEqual([
      ['Trade & Imports', '/diaspora/imports'],
      ['Import Orders', '/diaspora/imports'],
      ['Import order 3E2B66A0', `/diaspora/imports/${ORDER}`],
    ]))
    expect(within(trail()).getByTestId('workspace-crumb-current')).toHaveTextContent('Documents & evidence')
    expect(screen.getByRole('link', { name: 'Back to import order' })).toHaveAttribute('href', `/diaspora/imports/${ORDER}`)
    const exits = screen.getByRole('navigation', { name: 'Elsewhere for this purchase' })
    expect(within(exits).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Journey & arrival', `/diaspora/journey/import_order/${ORDER}`],
    ])
  })

  it('is named by the vehicle, and offers its Passport, only once the order endpoint shows the viewer owns it', async () => {
    h.vehicle = { vin: VIN, title: '2018 Honda Vezel' }
    await open('import_order', ORDER)
    await waitFor(() => expect(crumbs().map(([text]) => text)).toContain('2018 Honda Vezel'))
    expect(h.getOrderVehicle).toHaveBeenCalledWith(ORDER)
    const exits = screen.getByRole('navigation', { name: 'Elsewhere for this purchase' })
    expect(within(exits).getByRole('link', { name: 'View Vehicle Passport' })).toHaveAttribute('href', `/dashboard/garage/${VIN}`)
  })

  it('keeps its own page exactly as it was: heading, reference and rows', async () => {
    await open('import_order', ORDER)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Paperwork for this purchase')
    expect(screen.getByTestId('documents-subject-ref')).toHaveTextContent('PURCHASE 3E2B66A0')
    expect(screen.getAllByTestId('documents-row')).toHaveLength(1)
  })

  it('Documents → Import Order, → Journey and → Vehicle Passport, by explicit controls', async () => {
    h.vehicle = { vin: VIN, title: '2018 Honda Vezel' }
    await open('import_order', ORDER)
    fireEvent.click(screen.getByRole('link', { name: 'Back to import order' }))
    await waitFor(() => expect(location()).toBe(`/diaspora/imports/${ORDER}`))
    cleanup()
    await open('import_order', ORDER)
    fireEvent.click(screen.getByRole('link', { name: 'Journey & arrival' }))
    await waitFor(() => expect(location()).toBe(`/diaspora/journey/import_order/${ORDER}`))
    cleanup()
    await open('import_order', ORDER)
    fireEvent.click(await screen.findByRole('link', { name: 'View Vehicle Passport' }))
    await waitFor(() => expect(location()).toBe(`/dashboard/garage/${VIN}`))
  })

  it('offers a role that cannot open the owner pages only what it can open', async () => {
    h.role = 'dealer'
    h.vehicle = { vin: VIN, title: '2018 Honda Vezel' }
    await open('import_order', ORDER)
    await waitFor(() => expect(h.getOrderVehicle).toHaveBeenCalled())
    expect(screen.queryByTestId('workspace-parent-link')).toBeNull()
    expect(within(trail()).queryAllByRole('link')).toHaveLength(0)
    const exits = screen.getByRole('navigation', { name: 'Elsewhere for this purchase' })
    expect(within(exits).getAllByRole('link').map((a) => a.textContent)).toEqual(['Journey & arrival'])
  })
})

describe('any other kind of transaction', () => {
  it('has no import order above it: the workspace and its own name, no parent, no lookup', async () => {
    h.workspace = workspace('logistics_request', REQUEST)
    await open('logistics_request', REQUEST)
    expect(crumbs()).toEqual([['Trade & Imports', '/diaspora/imports']])
    expect(within(trail()).getByTestId('workspace-crumb-current')).toHaveTextContent('Documents & evidence')
    expect(screen.queryByTestId('workspace-parent-link')).toBeNull()
    expect(screen.queryByTestId('workspace-exit-actions')).toBeNull()
    expect(h.getOrderVehicle).not.toHaveBeenCalled()
    expect(screen.queryByText(/import order/i)).toBeNull()
  })
})

describe('paperwork that could not be opened', () => {
  it('says so, with a generic trail and no link to an order the viewer may have been refused', async () => {
    h.err = new Error('You do not have access to these documents.')
    await open('import_order', ORDER, 'documents-unreadable')
    expect(screen.getByTestId('documents-unreadable')).toHaveTextContent('That is not a report that there are none.')
    expect(crumbs()).toEqual([['Trade & Imports', '/diaspora/imports'], ['Import Orders', '/diaspora/imports']])
    expect(within(trail()).getByTestId('workspace-crumb-current')).toHaveTextContent('Documents & evidence')
    expect(screen.getByRole('link', { name: 'Back to import orders' })).toHaveAttribute('href', '/diaspora/imports')
    expect(screen.queryByRole('link', { name: 'Back to import order' })).toBeNull()
    expect(screen.getByTestId('documents-unreadable').innerHTML).not.toContain(ORDER)
    expect(h.getOrderVehicle).not.toHaveBeenCalled()
  })
})

describe('an order still being read is called "Import order" — never its reference (physical UAT finding)', () => {
  it('the order link says "Import order" until the vehicle read answers, then names the vehicle', async () => {
    let answer!: (vehicle: { vin: string; title: string | null } | null) => void
    h.getOrderVehicle.mockImplementation(() => new Promise((resolve) => { answer = resolve }))
    await open('import_order', ORDER)
    await waitFor(() => expect(crumbs()[2]).toEqual(['Import order', `/diaspora/imports/${ORDER}`]))
    expect(trail().textContent).not.toMatch(/3E2B66A0/i)
    // The page's own reference line is the page's content, not the trail — it is untouched.
    expect(screen.getByTestId('documents-subject-ref')).toHaveTextContent('PURCHASE 3E2B66A0')
    await act(async () => { answer({ vin: VIN, title: '2018 Honda Vezel' }) })
    await waitFor(() => expect(crumbs()[2]).toEqual(['2018 Honda Vezel', `/diaspora/imports/${ORDER}`]))
  })
})
