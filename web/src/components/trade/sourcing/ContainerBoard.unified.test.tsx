/**
 * RX-06 — /diaspora/containers unified board: capacity only as recorded (approved space), a pending
 * request shown apart and never counted, a participant sees only their own requests and is told so,
 * reviewer decisions behind the same handlers, and honest empty / failed / rate-limited / denied states.
 * Flag OFF keeps the legacy page. Fictional data only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const auth = vi.hoisted(() => ({ user: { id: 'fictional-buyer', role: 'owner' } as { id: string; role: string }, isAuthenticated: true, loading: false }))
const api = vi.hoisted(() => ({
  fetchDiasporaMarketplaceContainers: vi.fn(),
  fetchDiasporaContainerReservations: vi.fn(),
  fetchDiasporaContainerCapacity: vi.fn(),
  requestDiasporaReservation: vi.fn(),
  approveDiasporaMarketplaceReservation: vi.fn(),
  rejectDiasporaMarketplaceReservation: vi.fn(),
  closeDiasporaContainerBooking: vi.fn(),
}))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('@/hooks/useCarUpApi', () => ({ useCarUpApi: () => api }))

const container = {
  id: 'ctr-fictional-0001', origin_country: 'Japan', origin_city: 'Yokohama', destination_country: 'Zimbabwe', destination_city: 'Harare',
  departure_date: '2026-12-10T00:00:00Z', booking_deadline: '2026-12-01T00:00:00Z', container_type: '40HC',
  total_capacity_volume: 60, used_capacity_volume: 30, available_capacity_volume: 30, status: 'BOOKING_OPEN',
}
const mine = { id: 'res-fictional-1', container_id: container.id, estimated_volume: 2.5, reservation_status: 'REQUESTED', cargo_type: 'parts', created_at: '2026-11-20T08:00:00Z' }
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status })

async function mount(unified = true) {
  vi.resetModules()
  ;(globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = unified ? true : undefined
  const { default: Page } = await import('@/pages/diaspora/DiasporaContainerMarketplace')
  return render(<MemoryRouter><Page /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.user = { id: 'fictional-buyer', role: 'owner' }
  api.fetchDiasporaMarketplaceContainers.mockResolvedValue([container])
  api.fetchDiasporaContainerReservations.mockResolvedValue([mine])
  api.fetchDiasporaContainerCapacity.mockResolvedValue({ container, capacity: {} })
  api.requestDiasporaReservation.mockResolvedValue({})
  api.approveDiasporaMarketplaceReservation.mockResolvedValue({})
  api.rejectDiasporaMarketplaceReservation.mockResolvedValue({})
  api.closeDiasporaContainerBooking.mockResolvedValue({})
})
afterEach(() => { (globalThis as { __CARUP_UNIFIED_UI__?: unknown }).__CARUP_UNIFIED_UI__ = undefined })

describe('Shared containers — unified board', () => {
  it('flag OFF keeps the legacy page', async () => {
    await mount(false)
    expect(await screen.findByTestId('diaspora-container-page')).toBeInTheDocument()
    expect(screen.queryByTestId('trade-containers')).toBeNull()
  })

  it('the empty board says what creates a container — with editorial art, never behind data', async () => {
    api.fetchDiasporaMarketplaceContainers.mockResolvedValue([])
    await mount()
    expect(await screen.findByTestId('trade-containers-empty')).toHaveTextContent('when CarUp logistics opens one for booking')
    expect(screen.getByTestId('trade-still-containerYard')).toBeInTheDocument()
    expect(screen.getByTestId('trade-still-disclosure')).toHaveTextContent('AI-generated illustration')
    expect(screen.queryByTestId('trade-containers-board')).toBeNull()
  })

  it('failed, rate-limited and denied reads are distinct and never "no containers"', async () => {
    api.fetchDiasporaMarketplaceContainers.mockRejectedValueOnce(httpError(500, 'boom'))
    const a = await mount()
    const failed = await screen.findByTestId('trade-containers-failed')
    expect(failed).toHaveAttribute('data-state', 'failed')
    expect(failed).toHaveTextContent('This is not a report that no containers are open')
    fireEvent.click(within(failed).getByRole('button', { name: /Try again/ }))
    expect(await screen.findByTestId('trade-containers-board')).toBeInTheDocument()
    a.unmount()

    api.fetchDiasporaMarketplaceContainers.mockRejectedValueOnce(httpError(429, 'Too many requests. Please try again later.'))
    const b = await mount()
    expect(await screen.findByTestId('trade-containers-failed')).toHaveAttribute('data-state', 'limited')
    b.unmount()

    api.fetchDiasporaMarketplaceContainers.mockRejectedValueOnce(httpError(403, 'Forbidden'))
    await mount()
    expect(await screen.findByTestId('trade-containers-failed')).toHaveAttribute('data-state', 'denied')
    expect(screen.queryByTestId('trade-containers-empty')).toBeNull()
  })

  it('shows recorded capacity only, and a pending request apart from it', async () => {
    await mount()
    const card = await screen.findByTestId('trade-containers-card')
    expect(card).toHaveTextContent('30 CBM approved of 60 CBM')
    expect(card).toHaveTextContent('30 CBM free')
    expect(card).toHaveTextContent('40HC')
    expect(card).toHaveTextContent('10 Dec 2026')
    fireEvent.click(within(card).getByTestId('trade-containers-open'))
    const detail = await screen.findByTestId('trade-containers-detail')
    await waitFor(() => expect(within(detail).getByTestId('trade-containers-pending-legend')).toHaveTextContent('2.5 CBM requested · not counted until approved'))
    expect(within(detail).getByTestId('trade-containers-capacity')).toHaveTextContent('30 CBM approved of 60 CBM')
    expect(detail).toHaveTextContent('No arrival estimate is recorded. CarUp does not estimate one.')
    expect(within(detail).getByTestId('trade-containers-reservations')).toHaveTextContent('Only your own requests are shown')
    expect(within(detail).getByTestId('trade-containers-detail-next')).toHaveTextContent('Your request for 2.5 CBM is awaiting review')
    expect(within(detail).queryByTestId('trade-containers-approve')).toBeNull() // participants cannot decide
    expect(within(detail).queryByTestId('trade-containers-close')).toBeNull()
  })

  it('a failed reservation read is never shown as "no requests"', async () => {
    api.fetchDiasporaContainerReservations.mockRejectedValueOnce(httpError(500, 'boom'))
    await mount()
    fireEvent.click(await screen.findByTestId('trade-containers-open'))
    expect(await screen.findByTestId('trade-containers-reservations-failed')).toHaveTextContent('This is not a report that none exist')
    expect(screen.queryByTestId('trade-containers-reservations-empty')).toBeNull()
  })

  it('requests space through the same handler', async () => {
    api.fetchDiasporaContainerReservations.mockResolvedValue([])
    await mount()
    fireEvent.click(await screen.findByTestId('trade-containers-open'))
    const form = await screen.findByTestId('trade-containers-request')
    fireEvent.change(within(form).getByTestId('trade-containers-volume'), { target: { value: '3' } })
    fireEvent.click(within(form).getByTestId('trade-containers-request-submit'))
    await waitFor(() => expect(api.requestDiasporaReservation).toHaveBeenCalledWith(container.id, { estimated_volume: 3, source: 'ui' }))
    expect(await screen.findByTestId('trade-containers-notice')).toHaveTextContent('counts against capacity only once a CarUp logistics reviewer approves it')
  })

  it('a reviewer approves, rejects (after confirming) and closes booking (after confirming) through the same handlers', async () => {
    auth.user = { id: 'fictional-operator', role: 'admin' }
    await mount()
    fireEvent.click(await screen.findByTestId('trade-containers-open'))
    const detail = await screen.findByTestId('trade-containers-detail')
    expect(await within(detail).findByTestId('trade-containers-reservations')).toHaveTextContent('All space requests')
    fireEvent.click(await within(detail).findByTestId('trade-containers-approve'))
    await waitFor(() => expect(api.approveDiasporaMarketplaceReservation).toHaveBeenCalledWith(mine.id))

    fireEvent.click(await within(detail).findByTestId('trade-containers-reject'))
    expect(api.rejectDiasporaMarketplaceReservation).not.toHaveBeenCalled()
    fireEvent.click(await within(detail).findByTestId('trade-containers-reject-confirm'))
    await waitFor(() => expect(api.rejectDiasporaMarketplaceReservation).toHaveBeenCalledWith(mine.id))

    fireEvent.click(within(detail).getByTestId('trade-containers-close-booking'))
    const confirm = await within(detail).findByTestId('trade-containers-close-confirm')
    expect(confirm).toHaveTextContent('No new space can be requested')
    expect(api.closeDiasporaContainerBooking).not.toHaveBeenCalled()
    fireEvent.click(within(confirm).getByTestId('trade-containers-close-confirm-yes'))
    await waitFor(() => expect(api.closeDiasporaContainerBooking).toHaveBeenCalledWith(container.id))
  })

  it('a role without container access is denied without a read', async () => {
    auth.user = { id: 'fictional-member', role: 'member' }
    await mount()
    expect(await screen.findByTestId('trade-containers-denied')).toBeInTheDocument()
    expect(api.fetchDiasporaMarketplaceContainers).not.toHaveBeenCalled()
  })
})
