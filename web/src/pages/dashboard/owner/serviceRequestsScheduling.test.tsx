
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const fetchMyServiceRequests = vi.fn()
const cancelServiceRequest = vi.fn()
const fetchMyServiceAppointments = vi.fn()
const fetchServiceAppointmentAvailability = vi.fn()
const requestServiceAppointment = vi.fn()
const cancelMyServiceAppointment = vi.fn()

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchMyServiceRequests,
    cancelServiceRequest,
    fetchMyServiceAppointments,
    fetchServiceAppointmentAvailability,
    requestServiceAppointment,
    cancelMyServiceAppointment,
  }),
}))

const { default: ServiceRequests } = await import('./ServiceRequests')

const request = {
  id: 'case-1',
  vin: 'VIN-1',
  status: 'accepted',
  service_category: 'inspection',
  request_summary: null,
  garage_display_name: 'Garage One',
  garage_slug: 'garage-one',
  branch_id: 'site-1',
  requested_at: '2026-10-23T00:00:00Z',
  accepted_at: '2026-10-23T01:00:00Z',
  declined_at: null,
  started_at: null,
  completed_at: null,
  cancelled_at: null,
}

function renderPage() {
  return render(<MemoryRouter><ServiceRequests /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchMyServiceRequests.mockResolvedValue([request])
  fetchMyServiceAppointments.mockResolvedValue([])
  fetchServiceAppointmentAvailability.mockResolvedValue({
    configured: true,
    enabled: true,
    branch: { id: 'site-1', name: 'Central', timezone: 'Africa/Harare' },
    date: '2026-10-26',
    duration_minutes: 60,
    slot_interval_minutes: 30,
    capacity: 2,
    slots: [{
      starts_at: '2026-10-26T08:00:00Z',
      ends_at: '2026-10-26T09:00:00Z',
      appointment_timezone: 'Africa/Harare',
      branch_capacity: 2,
      booked_count: 1,
      available_count: 1,
      bookable: true,
    }],
  })
  requestServiceAppointment.mockResolvedValue({})
  cancelMyServiceAppointment.mockResolvedValue({})
  cancelServiceRequest.mockResolvedValue({})
})

describe('OPS03 requester scheduling integration', () => {
  it('keeps a requested appointment visibly distinct from a confirmed appointment', async () => {
    fetchMyServiceAppointments.mockResolvedValue([{
      id: 'appt-1', service_case_id: 'case-1', branch_id: 'site-1', status: 'requested',
      starts_at: '2026-10-26T08:00:00Z', ends_at: '2026-10-26T09:00:00Z',
      appointment_timezone: 'Africa/Harare', planned_workforce_profile_id: null,
      requested_by_user_id: 'customer-1', confirmed_at: null,
      created_at: '2026-10-23T02:00:00Z', updated_at: '2026-10-23T02:00:00Z',
    }])
    renderPage()
    expect(await screen.findByTestId('appointment-status')).toHaveTextContent('Requested appointment')
    expect(screen.getByText(/Garage has not confirmed this requested time yet/i)).toBeInTheDocument()
    expect(screen.queryByText('Confirmed appointment')).toBeNull()
  })

  it('labels only a real confirmed state as confirmed', async () => {
    fetchMyServiceAppointments.mockResolvedValue([{
      id: 'appt-1', service_case_id: 'case-1', branch_id: 'site-1', status: 'confirmed',
      starts_at: '2026-10-26T08:00:00Z', ends_at: '2026-10-26T09:00:00Z',
      appointment_timezone: 'Africa/Harare', planned_workforce_profile_id: 'profile-1',
      requested_by_user_id: 'customer-1', confirmed_at: '2026-10-23T03:00:00Z',
      created_at: '2026-10-23T02:00:00Z', updated_at: '2026-10-23T03:00:00Z',
    }])
    renderPage()
    expect(await screen.findByTestId('appointment-status')).toHaveTextContent('Confirmed appointment')
    expect(screen.getByText(/Garage has confirmed this appointment/i)).toBeInTheDocument()
  })

  it('starts date and duration blank and sends no tenant authority when requesting a real slot', async () => {
    renderPage()
    await screen.findByText('No appointment recorded')
    fireEvent.click(screen.getByRole('button', { name: 'Find appointment times' }))
    const date = screen.getByLabelText('Appointment date case-1')
    const duration = screen.getByLabelText('Appointment duration case-1')
    expect(date).toHaveValue('')
    expect(duration).toHaveValue(null)

    fireEvent.change(date, { target: { value: '2026-10-26' } })
    fireEvent.change(duration, { target: { value: '60' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check available times' }))

    await waitFor(() => expect(fetchServiceAppointmentAvailability).toHaveBeenCalledWith('case-1', {
      branch_id: 'site-1', date: '2026-10-26', duration_minutes: 60,
    }))
    expect(fetchServiceAppointmentAvailability.mock.calls[0][1].tenant_id).toBeUndefined()

    const slotButton = await screen.findByRole('button', { name: 'Request this time' })
    fireEvent.click(slotButton)
    await waitFor(() => expect(requestServiceAppointment).toHaveBeenCalledWith('case-1', {
      branch_id: 'site-1',
      starts_at: '2026-10-26T08:00:00Z',
      ends_at: '2026-10-26T09:00:00Z',
    }))
    expect(requestServiceAppointment.mock.calls[0][1].tenant_id).toBeUndefined()
  })

  it('shows truthful scheduling-not-configured state rather than fake zero slots', async () => {
    fetchServiceAppointmentAvailability.mockResolvedValue({
      configured: false,
      reason: 'Scheduling not configured',
      branch: { id: 'site-1', name: 'Central', timezone: 'Africa/Harare' },
      date: '2026-10-26',
      duration_minutes: 60,
      slots: [],
    })
    renderPage()
    await screen.findByText('No appointment recorded')
    fireEvent.click(screen.getByRole('button', { name: 'Find appointment times' }))
    fireEvent.change(screen.getByLabelText('Appointment date case-1'), { target: { value: '2026-10-26' } })
    fireEvent.change(screen.getByLabelText('Appointment duration case-1'), { target: { value: '60' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check available times' }))
    expect(await screen.findByText('Scheduling not configured')).toBeInTheDocument()
    expect(screen.queryByText(/0 available/)).toBeNull()
  })

  it('does not invent a branch when the Service Case has none', async () => {
    fetchMyServiceRequests.mockResolvedValue([{ ...request, branch_id: null }])
    renderPage()
    expect(await screen.findByText(/branch is not recorded on this Service Case/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Find appointment times' })).toBeNull()
  })
})
