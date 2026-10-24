import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Wrench, Building2, Calendar, CalendarClock, Car, Loader2 } from 'lucide-react'
import { useCarUpApi, type AppointmentAvailabilityResponse, type GarageAppointment } from '@/hooks/useCarUpApi'
import {
  canCancel,
  requestDate,
  requestReference,
  serviceCategoryLabel,
  statusPresentation,
} from '@/lib/serviceRequests'
import { SN_PAGE } from '@/lib/serviceNetworkLayout'

/**
 * My Service Requests (R3).
 *
 * Owner UAT: a request could be submitted successfully and then be findable NOWHERE — not on the
 * dashboard, not in communications, not in service history. A person who cannot see their own
 * request assumes it failed and phones the garage instead, and CarUp loses the interaction it just
 * captured.
 *
 * This reads the canonical Service Cases the owner already owns (`/api/service-cases/mine`). It is
 * not a second request ledger: there is one, and this is a view of it.
 */

type ServiceRequest = {
  id: string
  vin: string
  status: string
  service_category: string | null
  request_summary: string | null
  garage_display_name?: string | null
  garage_slug?: string | null
  branch_id?: string | null
  requested_at: string | null
  accepted_at: string | null
  declined_at: string | null
  started_at: string | null
  completed_at: string | null
  cancelled_at: string | null
}

const TONE_CLASS: Record<string, string> = {
  waiting: 'bg-amber-500 text-white',
  progress: 'bg-blue-500 text-white',
  done: 'bg-green-500 text-white',
  closed: 'bg-gray-400 text-white',
}

/** The most recent thing that actually happened, so "last update" is a fact and not a guess. */
function lastChange(r: ServiceRequest): string {
  const stamps = [r.cancelled_at, r.completed_at, r.started_at, r.declined_at, r.accepted_at, r.requested_at]
    .filter(Boolean) as string[]
  return stamps.length ? requestDate(stamps[0]) : 'Not recorded'
}

function appointmentWhen(a: GarageAppointment): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: a.appointment_timezone,
    }).format(new Date(a.starts_at)) + ' (' + a.appointment_timezone + ')'
  } catch {
    return a.starts_at
  }
}

const APPOINTMENT_LABEL: Record<GarageAppointment['status'], string> = {
  requested: 'Requested appointment',
  confirmed: 'Confirmed appointment',
  declined: 'Appointment declined',
  cancelled: 'Appointment cancelled',
  fulfilled: 'Visit fulfilled',
  no_show: 'No-show recorded',
}

export default function ServiceRequests() {
  const {
    fetchMyServiceRequests,
    cancelServiceRequest,
    fetchMyServiceAppointments,
    fetchServiceAppointmentAvailability,
    requestServiceAppointment,
    cancelMyServiceAppointment,
  } = useCarUpApi()
  const [requests, setRequests] = useState<ServiceRequest[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [appointments, setAppointments] = useState<GarageAppointment[]>([])
  const [bookingCaseId, setBookingCaseId] = useState<string | null>(null)
  const [bookingDate, setBookingDate] = useState('')
  const [bookingDuration, setBookingDuration] = useState('')
  const [availability, setAvailability] = useState<AppointmentAvailabilityResponse | null>(null)
  const [appointmentError, setAppointmentError] = useState<string | null>(null)
  const [appointmentBusy, setAppointmentBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    setState('loading')
    fetchMyServiceRequests()
      .then((rows) => {
        setRequests((rows || []) as ServiceRequest[])
        setState('ready')
      })
      .catch(() => setState('error'))

    if (typeof fetchMyServiceAppointments !== 'function') {
      setAppointments([])
      return
    }

    fetchMyServiceAppointments()
      .then((appointmentRows) => {
        setAppointments(appointmentRows || [])
        setAppointmentError(null)
      })
      .catch(() => {
        setAppointments([])
        setAppointmentError('Appointment scheduling could not be loaded. Your service requests are still shown.')
      })
  }, [fetchMyServiceAppointments, fetchMyServiceRequests])

  useEffect(() => { load() }, [load])

  async function withdraw(id: string) {
    setBusyId(id)
    try {
      await cancelServiceRequest(id)
      load()
    } catch {
      // The list is reloaded either way; a failed withdrawal leaves the request as it was rather
      // than showing an optimistic state the server never accepted.
      load()
    } finally {
      setBusyId(null)
    }
  }

  function appointmentFor(caseId: string) {
    return appointments.find((a) => a.service_case_id === caseId) || null
  }

  async function findTimes(r: ServiceRequest) {
    if (!r.branch_id || !bookingDate || !bookingDuration) return
    setAppointmentBusy(r.id)
    setAppointmentError(null)
    setAvailability(null)
    try {
      setAvailability(await fetchServiceAppointmentAvailability(r.id, {
        branch_id: r.branch_id,
        date: bookingDate,
        duration_minutes: Number(bookingDuration),
      }))
    } catch (e) {
      setAppointmentError(e instanceof Error ? e.message : 'Appointment availability could not be loaded')
    } finally {
      setAppointmentBusy(null)
    }
  }

  async function requestSlot(r: ServiceRequest, startsAt: string, endsAt: string) {
    if (!r.branch_id) return
    setAppointmentBusy(r.id)
    setAppointmentError(null)
    try {
      await requestServiceAppointment(r.id, {
        branch_id: r.branch_id,
        starts_at: startsAt,
        ends_at: endsAt,
      })
      setBookingCaseId(null)
      setAvailability(null)
      setBookingDate('')
      setBookingDuration('')
      load()
    } catch (e) {
      setAppointmentError(e instanceof Error ? e.message : 'Appointment could not be requested')
    } finally {
      setAppointmentBusy(null)
    }
  }

  async function cancelAppointment(r: ServiceRequest, appointment: GarageAppointment) {
    setAppointmentBusy(r.id)
    setAppointmentError(null)
    try {
      await cancelMyServiceAppointment(r.id, appointment.id)
      load()
    } catch (e) {
      setAppointmentError(e instanceof Error ? e.message : 'Appointment could not be cancelled')
    } finally {
      setAppointmentBusy(null)
    }
  }

  return (
    <div className={SN_PAGE}>
      <div>
        <h1 className="text-2xl font-bold">My Service Requests</h1>
        <p className="text-gray-500">Requests you have sent to garages on CarUp</p>
      </div>

      {state === 'loading' && (
        <div className="flex items-center gap-3 p-8" role="status" aria-live="polite">
          <Loader2 className="w-6 h-6 animate-spin motion-reduce:animate-none text-orange-500" aria-hidden="true" />
          <span className="text-sm text-gray-600">Loading your requests…</span>
        </div>
      )}

      {state === 'error' && (
        <Card className="border-0 card-shadow" data-testid="requests-error">
          <CardContent className="p-6 text-center">
            <p className="font-semibold text-gray-800">Your requests could not be loaded</p>
            <p className="text-sm text-gray-500 mt-1">
              This is a loading problem, not a statement that you have made no requests.
            </p>
            <Button variant="outline" className="mt-4 min-h-11" onClick={() => { setState('loading'); load() }}>
              Try again
            </Button>
          </CardContent>
        </Card>
      )}

      {state === 'ready' && requests.length === 0 && (
        <Card className="border-0 card-shadow" data-testid="requests-empty">
          <CardContent className="p-8 text-center">
            <Wrench className="w-7 h-7 text-gray-300 mx-auto mb-3" aria-hidden="true" />
            <p className="font-semibold text-gray-800">You have not requested service yet</p>
            <p className="text-sm text-gray-500 mt-1">
              Find a garage and ask them to look at your vehicle.
            </p>
            <Link to="/garages"><Button className="mt-4 min-h-11 bg-orange-500 hover:bg-orange-600">Browse garages</Button></Link>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {requests.map((r) => {
          const presentation = statusPresentation(r.status)
          const appointment = appointmentFor(r.id)
          const liveAppointment = appointment && ['requested', 'confirmed'].includes(appointment.status) ? appointment : null
          const canSchedule = ['requested', 'accepted'].includes(String(r.status).toLowerCase())
          return (
            <Card key={r.id} className="border-0 card-shadow" data-testid="service-request-card">
              <CardContent className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold" data-testid="request-reference">{requestReference(r.id)}</p>
                    <p className="text-sm text-gray-600 mt-0.5">{serviceCategoryLabel(r.service_category)}</p>
                  </div>
                  <Badge className={TONE_CLASS[presentation.tone]} data-testid="request-status">
                    {presentation.label}
                  </Badge>
                </div>

                <p className="text-sm text-gray-700 mt-3" data-testid="request-next">{presentation.next}</p>

                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mt-3">
                  <span className="flex items-center gap-1" data-testid="request-garage">
                    <Building2 className="w-3 h-3" aria-hidden="true" />
                    {r.garage_slug && r.garage_display_name
                      ? <Link to={`/garages/${r.garage_slug}`} className="hover:underline">{r.garage_display_name}</Link>
                      : (r.garage_display_name || 'Garage not recorded')}
                  </span>
                  <span className="flex items-center gap-1" data-testid="request-vehicle">
                    <Car className="w-3 h-3" aria-hidden="true" />
                    <Link to={`/dashboard/garage/${r.vin}`} className="hover:underline">{r.vin}</Link>
                  </span>
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" aria-hidden="true" />
                    Requested {requestDate(r.requested_at)}
                  </span>
                  <span data-testid="request-last-change">Last update {lastChange(r)}</span>
                </div>

                {r.request_summary && (
                  <p className="text-sm text-gray-600 mt-3 border-l-2 border-gray-200 pl-3">{r.request_summary}</p>
                )}

                <div className="mt-4 rounded-lg border bg-gray-50 p-4" data-testid="service-appointment">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium flex items-center gap-2"><CalendarClock className="w-4 h-4" aria-hidden="true" />Appointment</p>
                      {appointment ? (
                        <>
                          <p className="text-sm mt-1" data-testid="appointment-status">{APPOINTMENT_LABEL[appointment.status]}</p>
                          <p className="text-xs text-gray-500">{appointmentWhen(appointment)}</p>
                        </>
                      ) : (
                        <p className="text-sm text-gray-500 mt-1">No appointment recorded</p>
                      )}
                    </div>
                    {liveAppointment && (
                      <Badge className={liveAppointment.status === 'confirmed' ? 'bg-blue-600 text-white' : 'bg-amber-500 text-white'}>
                        {liveAppointment.status === 'confirmed' ? 'Confirmed' : 'Requested'}
                      </Badge>
                    )}
                  </div>

                  {liveAppointment && (
                    <div className="mt-3">
                      <p className="text-sm">
                        {liveAppointment.status === 'requested'
                          ? 'The Garage has not confirmed this requested time yet.'
                          : 'The Garage has confirmed this appointment.'}
                      </p>
                      <Button
                        variant="outline"
                        className="mt-3 min-h-11"
                        disabled={appointmentBusy === r.id}
                        onClick={() => void cancelAppointment(r, liveAppointment)}
                      >
                        Cancel appointment
                      </Button>
                    </div>
                  )}

                  {!liveAppointment && canSchedule && (
                    <div className="mt-3">
                      {!r.branch_id ? (
                        <p className="text-sm text-amber-700">A Garage branch is not recorded on this Service Case, so appointment availability cannot be calculated yet.</p>
                      ) : bookingCaseId !== r.id ? (
                        <Button
                          variant="outline"
                          className="min-h-11"
                          onClick={() => {
                            setBookingCaseId(r.id)
                            setBookingDate('')
                            setBookingDuration('')
                            setAvailability(null)
                            setAppointmentError(null)
                          }}
                        >
                          Find appointment times
                        </Button>
                      ) : (
                        <div className="space-y-3">
                          <p className="text-sm text-gray-600">Choose a local date and an explicit duration. A requested time is not confirmed until the Garage accepts it.</p>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <label className="text-sm">Date
                              <input
                                aria-label={'Appointment date ' + r.id}
                                type="date"
                                className="mt-1 w-full min-h-11 rounded-md border bg-white px-3"
                                value={bookingDate}
                                onChange={(e) => setBookingDate(e.target.value)}
                              />
                            </label>
                            <label className="text-sm">Duration (minutes)
                              <input
                                aria-label={'Appointment duration ' + r.id}
                                type="number"
                                min="5"
                                max="720"
                                placeholder="Required"
                                className="mt-1 w-full min-h-11 rounded-md border bg-white px-3"
                                value={bookingDuration}
                                onChange={(e) => setBookingDuration(e.target.value)}
                              />
                            </label>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button className="min-h-11"
                              disabled={!bookingDate || !bookingDuration || appointmentBusy === r.id}
                              onClick={() => void findTimes(r)}
                            >
                              Check available times
                            </Button>
                            <Button className="min-h-11" variant="outline" onClick={() => { setBookingCaseId(null); setAvailability(null); setAppointmentError(null) }}>Close</Button>
                          </div>
                          {appointmentError && <p role="alert" className="text-sm text-red-700">{appointmentError}</p>}
                          {availability && !availability.configured && (
                            <p role="status" className="text-sm text-amber-700">{availability.reason || 'Scheduling not configured'}</p>
                          )}
                          {availability?.configured && availability.enabled === false && (
                            <p role="status" className="text-sm text-amber-700">{availability.reason}</p>
                          )}
                          {availability?.configured && availability.enabled !== false && (
                            <div className="space-y-2" data-testid="appointment-slots">
                              <p className="text-xs text-gray-500">Times shown in {availability.branch.timezone || 'the recorded appointment timezone'}.</p>
                              {availability.slots.filter((slot) => slot.bookable).length === 0 ? (
                                <p className="text-sm text-gray-500">No bookable capacity is available for this date and duration.</p>
                              ) : availability.slots.filter((slot) => slot.bookable).map((slot) => (
                                <div key={slot.starts_at} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-white p-3">
                                  <span className="text-sm">
                                    {new Intl.DateTimeFormat(undefined, { timeStyle: 'short', timeZone: slot.appointment_timezone }).format(new Date(slot.starts_at))}
                                    {' – '}
                                    {new Intl.DateTimeFormat(undefined, { timeStyle: 'short', timeZone: slot.appointment_timezone }).format(new Date(slot.ends_at))}
                                  </span>
                                  <Button className="min-h-11"
                                    size="sm"
                                    disabled={appointmentBusy === r.id}
                                    onClick={() => void requestSlot(r, slot.starts_at, slot.ends_at)}
                                  >
                                    Request this time
                                  </Button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {canCancel(r.status) && (
                  <Button
                    variant="outline" className="mt-4 min-h-11"
                    disabled={busyId === r.id}
                    onClick={() => withdraw(r.id)}
                    data-testid="withdraw-request"
                  >
                    {busyId === r.id ? 'Withdrawing…' : 'Withdraw this request'}
                  </Button>
                )}

                {String(r.status).toLowerCase() === 'completed' && (
                  <Link to="/dashboard/service-history">
                    <Button variant="outline" className="mt-4 min-h-11" data-testid="view-service-history">
                      See what was recorded
                    </Button>
                  </Link>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
