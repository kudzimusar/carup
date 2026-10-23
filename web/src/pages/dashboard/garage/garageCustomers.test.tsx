import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const fetchGarageCustomers = vi.fn()
const createGarageProspect = vi.fn()
const fetchGarageCustomerDetail = vi.fn()
const updateGarageCustomerRelationship = vi.fn()
const listGarageSites = vi.fn()
const listGarageWorkforce = vi.fn()
const useAuth = vi.fn()
vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({ fetchGarageCustomers, createGarageProspect, fetchGarageCustomerDetail,
    updateGarageCustomerRelationship, listGarageSites, listGarageWorkforce }),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => useAuth() }))
const { default: GarageCustomers } = await import('./GarageCustomers')
const { default: GarageCustomerDetail } = await import('./GarageCustomerDetail')

const realCustomer = {
  customer_id: 'registered:customer-a', user_id: 'customer-a', party_kind: 'registered',
  display_name: 'Actual Service Requester', vehicle_count: 2, case_count: 3,
  completed_count: 1, last_service_at: '2026-10-22T10:00:00Z',
  spend_by_currency: { USD: 150, ZAR: 900 }, conversation_thread_id: 'thread-1',
  relationship: null,
}
const relationship = {
  id: 'rel-a', customer_reference_code: 'CUS-A1B2C3D4E5F6', relationship_status: 'active',
  customer_category: null, preferred_branch_id: null, assigned_staff_user_id: null,
  internal_notes: null, notes_available: true, tags: [], first_relationship_at: '2026-10-01T00:00:00Z',
  follow_up_at: null, follow_up_status: null,
}
const detail = {
  customer: { customer_id: realCustomer.customer_id, party_kind: 'registered', display_name: realCustomer.display_name,
    identity_status: 'CarUp account', relationship, spend_by_currency: realCustomer.spend_by_currency,
    conversation_thread_id: 'thread-1' },
  vehicles: [
    { vin: 'VIN-1', make: 'Toyota', model: 'Corolla', year: 2019,
      relationship_basis: 'service_requester', canonical_owner_recorded: true, canonical_owner_is_customer: false,
      case_count: 2, last_service_at: '2026-10-22T10:00:00Z', open_case_count: 0 },
    { vin: 'VIN-2', make: 'Honda', model: 'Fit', year: 2020,
      relationship_basis: 'service_requester', canonical_owner_recorded: false, canonical_owner_is_customer: false,
      case_count: 1, last_service_at: null, open_case_count: 1 },
  ],
  cases: [{ id: 'case-1', vin: 'VIN-1', status: 'completed', service_category: 'brakes', requested_at: '2026-10-01T00:00:00Z', completed_at: '2026-10-22T00:00:00Z', branch_id: null }],
  work_orders: [{ id: 'work-1', service_case_id: 'case-1', status: 'Completed', created_at: '2026-10-01T00:00:00Z', completed_at: '2026-10-22T00:00:00Z', cancelled_at: null }],
  service_records: [{ id: 'record-1', service_case_id: 'case-1', work_order_id: 'work-1', vin: 'VIN-1', service_category: 'brakes', total_cost: 150, currency: 'USD', performed_at: null, created_at: '2026-10-22T00:00:00Z' }],
}
function renderList() { return render(<MemoryRouter><GarageCustomers /></MemoryRouter>) }
function renderDetail() { return render(<MemoryRouter initialEntries={['/garage/customers/registered%3Acustomer-a']}><Routes><Route path="/garage/customers/:customerId" element={<GarageCustomerDetail />} /></Routes></MemoryRouter>) }

beforeEach(() => {
  vi.clearAllMocks()
  useAuth.mockReturnValue({ user: { active_tenant: { role: 'admin' } } })
  fetchGarageCustomers.mockResolvedValue({ customers: [realCustomer], prospects: [], total: 1, prospect_total: 0 })
  fetchGarageCustomerDetail.mockResolvedValue(detail)
  createGarageProspect.mockResolvedValue({ customer_id: 'relationship:rel-walk-in' })
  updateGarageCustomerRelationship.mockResolvedValue({ relationship })
  listGarageSites.mockResolvedValue({ sites: [] })
  listGarageWorkforce.mockResolvedValue({ workforce: [] })
})

describe('OPS02 Garage customer list', () => {
  it('keeps load failure distinct from an empty customer book', async () => {
    fetchGarageCustomers.mockRejectedValue(new Error('offline'))
    renderList()
    expect(await screen.findByTestId('customers-error')).toHaveTextContent(/loading problem/i)
    expect(screen.queryByTestId('customers-empty')).toBeNull()
  })
  it('renders only real service projection, unknown metadata and separated currencies', async () => {
    renderList()
    expect(await screen.findByText('Actual Service Requester')).toBeInTheDocument()
    expect(screen.getByTestId('customer-spend')).toHaveTextContent('USD 150 · ZAR 900')
    expect(screen.getByText(/Status: not recorded/)).toBeInTheDocument()
    expect(screen.getByText(/2 related vehicles/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Actual Service Requester' })).toHaveAttribute('href', '/garage/customers/registered%3Acustomer-a')
  })
  it('searches only visible fields and does not turn a filter miss into no customers', async () => {
    renderList()
    await screen.findByText('Actual Service Requester')
    fireEvent.change(screen.getByLabelText('Search by name or reference'), { target: { value: 'private@example.invalid' } })
    expect(screen.getByText('No relationships match these filters.')).toBeInTheDocument()
    expect(screen.queryByTestId('customers-empty')).toBeNull()
  })
  it('records a confirmed walk-in as a prospect without tenant or fabricated user', async () => {
    renderList()
    await screen.findByText('Actual Service Requester')
    fireEvent.change(screen.getByLabelText('Prospect label'), { target: { value: 'Walk-in A' } })
    fireEvent.click(screen.getByLabelText(/I confirm this was a real walk-in/))
    fireEvent.click(screen.getByRole('button', { name: 'Record prospect' }))
    await waitFor(() => expect(createGarageProspect).toHaveBeenCalledWith({ origin: 'walk_in', display_name: 'Walk-in A', walk_in_confirmed: true }))
    expect(createGarageProspect.mock.calls[0][0].tenant_id).toBeUndefined()
    expect(createGarageProspect.mock.calls[0][0].user_id).toBeUndefined()
  })
})

describe('OPS02 Garage customer detail', () => {
  it('shows canonical related vehicles, case and work order history without ownership invention', async () => {
    renderDetail()
    expect(await screen.findByText('Actual Service Requester')).toBeInTheDocument()
    expect(screen.getByText(/Canonical owner: Another recorded owner/)).toBeInTheDocument()
    expect(screen.getByText(/Canonical owner: Not recorded/)).toBeInTheDocument()
    expect(screen.getByText(/Work order work-1/)).toBeInTheDocument()
    expect(screen.getByText(/Service record record-1/)).toBeInTheDocument()
    expect(screen.getByText(/USD 150 · ZAR 900/)).toBeInTheDocument()
    expect(screen.getByText(/not proof of paid revenue/)).toBeInTheDocument()
  })
  it('submits only Garage metadata actually changed, without tenant id or unknown defaults', async () => {
    renderDetail()
    await screen.findByText('Actual Service Requester')
    fireEvent.change(screen.getByLabelText('Private Garage notes'), { target: { value: 'Internal only' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save relationship' }))
    await waitFor(() => expect(updateGarageCustomerRelationship).toHaveBeenCalledTimes(1))
    const body = updateGarageCustomerRelationship.mock.calls[0][1]
    expect(body).toEqual({ internal_notes: 'Internal only' })
    expect(body.tenant_id).toBeUndefined()
    expect(body.customer_category).toBeUndefined()
    expect(body.preferred_branch_id).toBeUndefined()
  })
  it('keeps compact controls reachable and requires both follow-up fields', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    renderDetail()
    await screen.findByText('Actual Service Requester')
    expect(screen.getByLabelText('Preferred site')).toBeInTheDocument()
    expect(screen.getByLabelText('Assigned service advisor')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Follow-up date'), { target: { value: '2026-11-03' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save relationship' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/both a follow-up date and status/)
    expect(updateGarageCustomerRelationship).not.toHaveBeenCalled()
  })
  it('does not render a failed detail read as an empty history', async () => {
    fetchGarageCustomerDetail.mockRejectedValue(new Error('offline'))
    renderDetail()
    expect(await screen.findByTestId('customer-detail-error')).toHaveTextContent(/loading problem/i)
    expect(screen.queryByText('No related vehicles recorded.')).toBeNull()
  })
})
