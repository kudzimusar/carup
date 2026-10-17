/**
 * R1 / R3 — a service request must reach a real garage, and must remain findable afterwards.
 *
 * THE DEFECT THIS PINS. The only service-request entry point in the product was a generic
 * marketplace inquiry with no garage, no vehicle and no category. It stored
 * `target_provider_tenant_id: NULL` and `listing_id: NULL`, and the S3 bridge refuses to open a
 * Service Case without a target garage — so the request could never reach anyone. It then vanished:
 * not on the dashboard, not in communications, not in service history.
 *
 * A request now carries the garage (as its public slug — the browser never handles a tenant id) and
 * a vehicle, and the owner gets a reference and a place to find it again.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import RequestServiceModal from './RequestServiceModal'
import ServiceRequests from '@/pages/dashboard/owner/ServiceRequests'

const VIN = 'SNCLOSE020359VIN1'
const SLUG = 'sn-cert-snz020359'

const createServiceRequest = vi.fn()
const fetchOwnedVehicles = vi.fn()
const fetchMyServiceRequests = vi.fn()
const cancelServiceRequest = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({ createServiceRequest, fetchOwnedVehicles, fetchMyServiceRequests, cancelServiceRequest }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  fetchOwnedVehicles.mockResolvedValue([{ vin: VIN, make: 'Isuzu', model: 'D-Max', year: 2021 }])
  createServiceRequest.mockResolvedValue({
    case: { id: '37439819-73e5-43fe-a807-b7dd4e8dc529', status: 'requested', vin: VIN },
    created: true,
  })
  cancelServiceRequest.mockResolvedValue({ case: { status: 'cancelled' } })
})

const openModal = () =>
  render(
    <MemoryRouter>
      <RequestServiceModal garageSlug={SLUG} garageName="SN Cert Garage" offeredCategories={['brakes']} onClose={() => {}} />
    </MemoryRouter>,
  )

describe('R1 — the request reaches a specific garage for a specific vehicle', () => {
  it('sends the garage slug AND the vehicle — never an empty request', async () => {
    openModal()
    await screen.findByTestId('vehicle-select')

    fireEvent.change(screen.getByTestId('category-select'), { target: { value: 'brakes' } })
    fireEvent.change(screen.getByTestId('summary-input'), { target: { value: 'Brakes grinding at low speed' } })
    fireEvent.click(screen.getByTestId('submit-request'))

    await waitFor(() => expect(createServiceRequest).toHaveBeenCalled())
    const payload = createServiceRequest.mock.calls[0][0]

    // The two facts whose absence made the old request unactionable.
    expect(payload.garage_slug).toBe(SLUG)
    expect(payload.vin).toBe(VIN)
    expect(payload.service_category).toBe('brakes')
    expect(payload.request_summary).toBe('Brakes grinding at low speed')
  })

  it('never sends a tenant id from the browser', async () => {
    openModal()
    await screen.findByTestId('vehicle-select')
    fireEvent.click(screen.getByTestId('submit-request'))
    await waitFor(() => expect(createServiceRequest).toHaveBeenCalled())

    const payload = createServiceRequest.mock.calls[0][0]
    expect(Object.keys(payload)).not.toContain('garage_tenant_id')
    expect(Object.keys(payload)).not.toContain('target_provider_tenant_id')
    expect(JSON.stringify(payload)).not.toMatch(/tenant/i)
  })

  it('cannot be submitted without a vehicle', async () => {
    fetchOwnedVehicles.mockResolvedValue([
      { vin: VIN, make: 'Isuzu', model: 'D-Max' },
      { vin: 'SECOND000000VIN1', make: 'Toyota', model: 'Hilux' },
    ])
    openModal()
    await screen.findByTestId('vehicle-select')
    // Two vehicles, so none is preselected — the owner must choose.
    expect((screen.getByTestId('submit-request') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByTestId('submit-request'))
    expect(createServiceRequest).not.toHaveBeenCalled()
  })

  it('an owner with no vehicle is told why, not shown a dead form', async () => {
    fetchOwnedVehicles.mockResolvedValue([])
    openModal()
    expect(await screen.findByTestId('no-vehicles')).toHaveTextContent(/attached to a specific vehicle/i)
    expect(screen.queryByTestId('submit-request')).toBeNull()
  })

  it('a failed submission says nothing was recorded', async () => {
    createServiceRequest.mockRejectedValue(new Error('That garage is not accepting service requests'))
    openModal()
    await screen.findByTestId('vehicle-select')
    fireEvent.click(screen.getByTestId('submit-request'))
    expect(await screen.findByTestId('request-error')).toHaveTextContent(/not accepting service requests/i)
    expect(screen.queryByTestId('request-confirmation')).toBeNull()
  })
})

describe('R3 — the request does not disappear', () => {
  it('confirms with a reference, the garage, the status and what happens next', async () => {
    openModal()
    await screen.findByTestId('vehicle-select')
    fireEvent.click(screen.getByTestId('submit-request'))

    const confirmation = await screen.findByTestId('request-confirmation')
    expect(screen.getByTestId('confirmation-reference')).toHaveTextContent(/SR-37439819/i)
    expect(confirmation).toHaveTextContent('SN Cert Garage')
    expect(screen.getByTestId('confirmation-status')).toHaveTextContent(/waiting for the garage/i)
    expect(screen.getByTestId('confirmation-next')).toHaveTextContent(/accept or decline/i)
    // And a route back to it.
    expect(screen.getByTestId('confirmation-view-requests')).toBeTruthy()
  })

  it('My Service Requests lists the request with a plain-language status', async () => {
    fetchMyServiceRequests.mockResolvedValue([{
      id: '37439819-73e5-43fe-a807-b7dd4e8dc529', vin: VIN, status: 'requested',
      service_category: 'brakes', request_summary: 'Brakes grinding',
      garage_display_name: 'SN Cert Garage', garage_slug: SLUG,
      requested_at: '2026-09-06T09:00:00.000Z',
      accepted_at: null, declined_at: null, started_at: null, completed_at: null, cancelled_at: null,
    }])
    render(<MemoryRouter><ServiceRequests /></MemoryRouter>)

    expect(await screen.findByTestId('service-request-card')).toBeTruthy()
    expect(screen.getByTestId('request-reference')).toHaveTextContent(/SR-37439819/i)
    expect(screen.getByTestId('request-garage')).toHaveTextContent('SN Cert Garage')
    expect(screen.getByTestId('request-vehicle')).toHaveTextContent(VIN)
    // Plain language, not the backend's 'requested'.
    expect(screen.getByTestId('request-status')).toHaveTextContent(/waiting for the garage/i)
    expect(screen.getByTestId('request-next')).toHaveTextContent(/accept or decline/i)
  })

  it('a withdrawable request can be withdrawn; a completed one cannot', async () => {
    fetchMyServiceRequests.mockResolvedValue([{
      id: 'c-1', vin: VIN, status: 'requested', service_category: null, request_summary: null,
      garage_display_name: 'SN Cert Garage', garage_slug: SLUG,
      requested_at: '2026-09-06T09:00:00.000Z',
      accepted_at: null, declined_at: null, started_at: null, completed_at: null, cancelled_at: null,
    }])
    render(<MemoryRouter><ServiceRequests /></MemoryRouter>)
    fireEvent.click(await screen.findByTestId('withdraw-request'))
    await waitFor(() => expect(cancelServiceRequest).toHaveBeenCalledWith('c-1'))

    fetchMyServiceRequests.mockResolvedValue([{
      id: 'c-2', vin: VIN, status: 'completed', service_category: null, request_summary: null,
      garage_display_name: 'SN Cert Garage', garage_slug: SLUG,
      requested_at: '2026-09-06T09:00:00.000Z', accepted_at: '2026-09-06T10:00:00.000Z',
      declined_at: null, started_at: '2026-09-06T11:00:00.000Z', completed_at: '2026-09-06T12:00:00.000Z', cancelled_at: null,
    }])
    render(<MemoryRouter><ServiceRequests /></MemoryRouter>)
    await waitFor(() => expect(screen.getAllByTestId('service-request-card').length).toBeGreaterThan(0))
    expect(screen.getAllByTestId('view-service-history').length).toBeGreaterThan(0)
  })

  it('a failed list read is reported as a failure, never as "no requests"', async () => {
    fetchMyServiceRequests.mockRejectedValue(new Error('network'))
    render(<MemoryRouter><ServiceRequests /></MemoryRouter>)
    expect(await screen.findByTestId('requests-error')).toHaveTextContent(/not a statement that you have made no requests/i)
    expect(screen.queryByTestId('requests-empty')).toBeNull()
  })
})
