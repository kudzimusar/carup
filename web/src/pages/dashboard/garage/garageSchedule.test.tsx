
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { evaluateRouteAccess } from '@/lib/routeAccess'
import { getFeatureByRoute } from '@/config/featureRegistry'
import { garageDateTimeLocalToInstant, instantToGarageDateTimeLocal } from '@/lib/garageSchedulingTime'

const fetchGarageSchedule = vi.fn()
const fetchGarageSchedulingConfiguration = vi.fn()
const fetchGarageAppointmentAvailability = vi.fn()
const saveGarageSchedulingSettings = vi.fn()
const addGarageWorkforceSchedule = vi.fn()
const addGarageWorkforceUnavailability = vi.fn()
const confirmGarageAppointment = vi.fn()
const rescheduleGarageAppointment = vi.fn()
const changeGarageAppointmentStatus = vi.fn()
let activeTenantRole = 'admin'

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', active_tenant: { type: 'garage', role: activeTenantRole } } }),
}))

vi.mock('@/hooks/useCarUpApi', () => ({
  useCarUpApi: () => ({
    fetchGarageSchedule,
    fetchGarageSchedulingConfiguration,
    fetchGarageAppointmentAvailability,
    saveGarageSchedulingSettings,
    addGarageWorkforceSchedule,
    addGarageWorkforceUnavailability,
    confirmGarageAppointment,
    rescheduleGarageAppointment,
    changeGarageAppointmentStatus,
  }),
}))

const { default: GarageSchedule } = await import('./GarageSchedule')

const schedule = {
  appointments: [{
    id: 'appt-1',
    service_case_id: 'case-1',
    branch_id: 'site-1',
    status: 'requested',
    starts_at: '2026-10-26T06:00:00.000Z',
    ends_at: '2026-10-26T07:00:00.000Z',
    appointment_timezone: 'Africa/Harare',
    planned_workforce_profile_id: null,
    requested_by_user_id: 'customer-1',
    confirmed_at: null,
    created_at: '2026-10-23T00:00:00Z',
    updated_at: '2026-10-23T00:00:00Z',
    service_case: { id: 'case-1', status: 'accepted', vin: 'VIN-1', service_category: 'inspection', requester_name: 'Customer One' },
    vehicle: { vin: 'VIN-1', make: 'Toyota', model: 'Corolla', year: 2020 },
    branch: { id: 'site-1', name: 'Central', branch_code: 'CENTRAL', timezone: 'Africa/Harare' },
    planned_workforce: null,
  }],
  unscheduled_cases: [{ id: 'case-2', vin: 'VIN-2', status: 'accepted', service_category: 'repair', branch_id: 'site-1', requester_user_id: 'customer-2', requested_at: '2026-10-23T00:00:00Z' }],
  total: 1,
  scope: 'garage',
}
const configuration = {
  sites: [
    { id: 'site-1', name: 'Central', branch_code: 'CENTRAL', timezone: 'Africa/Harare', is_active: true, settings: null },
    { id: 'site-2', name: 'Tokyo', branch_code: 'TOKYO', timezone: 'Asia/Tokyo', is_active: true, settings: null },
  ],
  workforce: [{
    id: 'profile-1', user_id: 'mech-1', staff_code: 'M-1', employment_status: 'active',
    display_name: 'Mechanic One', tenant_role: 'mechanic', live_branch_ids: ['site-1','site-2'],
    schedules: [], unavailability: [],
  }],
}

function renderPage() {
  return render(<MemoryRouter><GarageSchedule /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  activeTenantRole = 'admin'
  fetchGarageSchedule.mockResolvedValue(structuredClone(schedule))
  fetchGarageSchedulingConfiguration.mockResolvedValue(structuredClone(configuration))
  fetchGarageAppointmentAvailability.mockResolvedValue({
    configured: true, enabled: true,
    branch: { id: 'site-1', name: 'Central', timezone: 'Africa/Harare' },
    date: '2026-10-26', duration_minutes: 60, slot_interval_minutes: 30, capacity: 3,
    slots: [{ starts_at: '2026-10-26T08:00:00Z', ends_at: '2026-10-26T09:00:00Z', appointment_timezone: 'Africa/Harare', branch_capacity: 3, booked_count: 2, available_count: 1, bookable: true }],
  })
  saveGarageSchedulingSettings.mockResolvedValue({})
  addGarageWorkforceSchedule.mockResolvedValue({})
  addGarageWorkforceUnavailability.mockResolvedValue({})
  confirmGarageAppointment.mockResolvedValue({})
  rescheduleGarageAppointment.mockResolvedValue({})
  changeGarageAppointmentStatus.mockResolvedValue({})
})

describe('GARAGE-1.0 OPS03 schedule product truth', () => {
  it('does not render a failed schedule read as an empty workshop', async () => {
    fetchGarageSchedule.mockRejectedValue(new Error('network'))
    renderPage()
    expect(await screen.findByTestId('schedule-load-error')).toHaveTextContent(/loading problem/i)
    expect(screen.queryByTestId('schedule-empty')).toBeNull()
  })

  it('shows a requested appointment as requested, not confirmed', async () => {
    renderPage()
    const card = await screen.findByTestId('appointment-card')
    expect(card).toHaveTextContent('requested')
    expect(card).toHaveTextContent('Planned mechanic: Not recorded')
    expect(screen.getByRole('button', { name: 'Review and confirm' })).toBeInTheDocument()
  })

  it('renders the requested appointment in branch-local time and submits the unchanged absolute instant', async () => {
    renderPage()
    await screen.findByText('Capacity not configured')
    fireEvent.click(screen.getByRole('button', { name: 'Review and confirm' }))

    expect(screen.getByLabelText('Appointment start appt-1')).toHaveValue('2026-10-26T08:00')
    expect(screen.getByLabelText('Appointment end appt-1')).toHaveValue('2026-10-26T09:00')
    expect(screen.getByTestId('appointment-timezone-appt-1')).toHaveTextContent('Africa/Harare')

    fireEvent.change(screen.getByLabelText('Appointment planned mechanic appt-1'), { target: { value: 'profile-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm appointment' }))

    await waitFor(() => expect(confirmGarageAppointment).toHaveBeenCalledTimes(1))
    expect(confirmGarageAppointment).toHaveBeenCalledWith('appt-1', {
      branch_id: 'site-1',
      starts_at: '2026-10-26T06:00:00.000Z',
      ends_at: '2026-10-26T07:00:00.000Z',
      planned_workforce_profile_id: 'profile-1',
    })
  })

  it('uses identical branch-timezone truth for rescheduling', async () => {
    const confirmed = structuredClone(schedule)
    confirmed.appointments[0].status = 'confirmed'
    confirmed.appointments[0].planned_workforce_profile_id = 'profile-1'
    fetchGarageSchedule.mockResolvedValue(confirmed)

    renderPage()
    await screen.findByText('Capacity not configured')
    fireEvent.click(screen.getByRole('button', { name: 'Reschedule' }))
    expect(screen.getByLabelText('Appointment start appt-1')).toHaveValue('2026-10-26T08:00')
    expect(screen.getByLabelText('Appointment end appt-1')).toHaveValue('2026-10-26T09:00')

    fireEvent.change(screen.getByLabelText('Appointment start appt-1'), { target: { value: '2026-10-26T09:00' } })
    fireEvent.change(screen.getByLabelText('Appointment end appt-1'), { target: { value: '2026-10-26T10:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save reschedule' }))

    await waitFor(() => expect(rescheduleGarageAppointment).toHaveBeenCalledTimes(1))
    expect(rescheduleGarageAppointment).toHaveBeenCalledWith('appt-1', {
      branch_id: 'site-1',
      starts_at: '2026-10-26T07:00:00.000Z',
      ends_at: '2026-10-26T08:00:00.000Z',
      planned_workforce_profile_id: 'profile-1',
    })
  })

  it('preserves the visible wall clock on branch change and serializes with the selected branch timezone', async () => {
    renderPage()
    await screen.findByText('Capacity not configured')
    fireEvent.click(screen.getByRole('button', { name: 'Review and confirm' }))

    fireEvent.change(screen.getByLabelText('Appointment site appt-1'), { target: { value: 'site-2' } })
    expect(screen.getByLabelText('Appointment start appt-1')).toHaveValue('2026-10-26T08:00')
    expect(screen.getByLabelText('Appointment end appt-1')).toHaveValue('2026-10-26T09:00')
    expect(screen.getByTestId('appointment-timezone-appt-1')).toHaveTextContent('Asia/Tokyo')

    fireEvent.change(screen.getByLabelText('Appointment planned mechanic appt-1'), { target: { value: 'profile-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm appointment' }))

    await waitFor(() => expect(confirmGarageAppointment).toHaveBeenCalledTimes(1))
    expect(confirmGarageAppointment).toHaveBeenCalledWith('appt-1', {
      branch_id: 'site-2',
      starts_at: '2026-10-25T23:00:00.000Z',
      ends_at: '2026-10-26T00:00:00.000Z',
      planned_workforce_profile_id: 'profile-1',
    })
  })

  it('rejects an invalid selected branch timezone instead of falling back to browser time', async () => {
    const invalidConfig = structuredClone(configuration)
    invalidConfig.sites[0].timezone = null
    fetchGarageSchedulingConfiguration.mockResolvedValue(invalidConfig)

    renderPage()
    await screen.findByText('Capacity not configured')
    fireEvent.click(screen.getByRole('button', { name: 'Review and confirm' }))
    fireEvent.change(screen.getByLabelText('Appointment planned mechanic appt-1'), { target: { value: 'profile-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm appointment' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Selected site timezone is not configured')
    expect(confirmGarageAppointment).not.toHaveBeenCalled()
  })

  it('keeps unconfigured capacity distinct from zero or fully booked', async () => {
    renderPage()
    expect(await screen.findByText('Capacity not configured')).toBeInTheDocument()
    expect(screen.getByLabelText('Maximum concurrent appointments')).toHaveValue(null)
    expect(screen.getByLabelText('Slot interval minutes')).toHaveValue(null)
    expect(screen.getByLabelText('Scheduling enabled')).toHaveValue('')
  })

  it('presents only backend-calculated capacity numbers', async () => {
    renderPage()
    await screen.findByText('Capacity not configured')
    fireEvent.change(screen.getByLabelText('Capacity Service Case'), { target: { value: 'case-2' } })
    fireEvent.change(screen.getByLabelText('Capacity site'), { target: { value: 'site-1' } })
    fireEvent.change(screen.getByLabelText('Capacity date'), { target: { value: '2026-10-26' } })
    fireEvent.change(screen.getByLabelText('Capacity duration minutes'), { target: { value: '60' } })
    fireEvent.click(screen.getByRole('button', { name: 'Calculate capacity' }))
    expect(await screen.findByTestId('capacity-results')).toHaveTextContent('3 capacity · 2 booked · 1 available')
    expect(fetchGarageAppointmentAvailability).toHaveBeenCalledWith({
      service_case_id: 'case-2', branch_id: 'site-1', date: '2026-10-26', duration_minutes: 60,
    })
  })

  it('does not send tenant_id when saving explicit scheduling settings', async () => {
    renderPage()
    await screen.findByText('Capacity not configured')
    fireEvent.change(screen.getByLabelText('Scheduling settings site'), { target: { value: 'site-1' } })
    fireEvent.change(screen.getByLabelText('Scheduling enabled'), { target: { value: 'true' } })
    fireEvent.change(screen.getByLabelText('Maximum concurrent appointments'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('Slot interval minutes'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save scheduling settings' }))
    await waitFor(() => expect(saveGarageSchedulingSettings).toHaveBeenCalledTimes(1))
    expect(saveGarageSchedulingSettings.mock.calls[0][1]).toEqual({
      scheduling_enabled: true, max_concurrent_appointments: 3, slot_interval_minutes: 30,
    })
    expect(saveGarageSchedulingSettings.mock.calls[0][1].tenant_id).toBeUndefined()
  })

  it('mechanic scope is read-only and still exposes the agenda on compact viewport', async () => {
    activeTenantRole = 'mechanic'
    fetchGarageSchedule.mockResolvedValue({ ...structuredClone(schedule), scope: 'planned_for_me' })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    renderPage()
    expect(await screen.findByText('Appointments currently planned for you')).toBeInTheDocument()
    expect(screen.getByLabelText('Appointment status filter')).toBeInTheDocument()
    expect(screen.getByTestId('appointment-card')).toBeInTheDocument()
    expect(screen.queryByText('Branch scheduling settings')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Review and confirm' })).toBeNull()
  })
})

describe('OPS03 appointment IANA timezone conversion', () => {
  it.each(['Africa/Harare', 'Asia/Tokyo', 'UTC'])(
    'keeps Harare appointment truth invariant when the browser environment is %s',
    (browserTimezone) => {
      const previous = process.env.TZ
      process.env.TZ = browserTimezone
      try {
        expect(instantToGarageDateTimeLocal('2026-10-26T06:00:00.000Z', 'Africa/Harare')).toBe('2026-10-26T08:00')
        expect(instantToGarageDateTimeLocal('2026-10-26T07:00:00.000Z', 'Africa/Harare')).toBe('2026-10-26T09:00')
        expect(garageDateTimeLocalToInstant('2026-10-26T08:00', 'Africa/Harare')).toBe('2026-10-26T06:00:00.000Z')
        expect(garageDateTimeLocalToInstant('2026-10-26T09:00', 'Africa/Harare')).toBe('2026-10-26T07:00:00.000Z')
      } finally {
        if (previous === undefined) delete process.env.TZ
        else process.env.TZ = previous
      }
    },
  )

  it('uses IANA daylight-saving offsets rather than fixed timezone offsets', () => {
    expect(garageDateTimeLocalToInstant('2026-07-01T09:00', 'America/New_York')).toBe('2026-07-01T13:00:00.000Z')
    expect(garageDateTimeLocalToInstant('2026-01-15T09:00', 'America/New_York')).toBe('2026-01-15T14:00:00.000Z')
  })

  it('rejects nonexistent and ambiguous DST wall-clock values instead of inventing an instant', () => {
    expect(() => garageDateTimeLocalToInstant('2026-03-08T02:30', 'America/New_York')).toThrow(/does not exist/i)
    expect(() => garageDateTimeLocalToInstant('2026-11-01T01:30', 'America/New_York')).toThrow(/ambiguous/i)
  })
})

describe('OPS03 schedule route authority', () => {
  it('is a selected-Garage admin/mechanic feature, never a platform-role feature', () => {
    const feature = getFeatureByRoute('/garage/schedule')
    expect(feature?.roles).toEqual([])
    expect(feature?.tenantTypes).toEqual(['garage'])
    expect(feature?.tenantRoles).toEqual(['admin','mechanic'])
    const base = { isBootstrapping: false, isAuthenticated: true, effectiveStates: undefined }
    expect(evaluateRouteAccess({ ...base, route: '/garage/schedule', role: 'owner', activeTenant: { type: 'garage', role: 'admin' } }).kind).toBe('render')
    expect(evaluateRouteAccess({ ...base, route: '/garage/schedule', role: 'owner', activeTenant: { type: 'garage', role: 'mechanic' } }).kind).toBe('render')
    expect(evaluateRouteAccess({ ...base, route: '/garage/schedule', role: 'admin', activeTenant: null }).kind).toBe('redirect')
  })
})
