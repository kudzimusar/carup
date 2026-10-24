
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, Clock, Loader2, Settings2, Users, Wrench } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/context/AuthContext'
import { useCarUpApi, type AppointmentAvailabilityResponse, type GarageScheduleResponse, type GarageSchedulingConfiguration } from '@/hooks/useCarUpApi'
import { SN_PAGE } from '@/lib/serviceNetworkLayout'
import { garageDateTimeLocalToInstant, instantToGarageDateTimeLocal } from '@/lib/garageSchedulingTime'

const STATUS_TONE: Record<string, string> = {
  requested: 'bg-amber-500 text-white',
  confirmed: 'bg-blue-600 text-white',
  declined: 'bg-gray-500 text-white',
  cancelled: 'bg-gray-500 text-white',
  fulfilled: 'bg-green-600 text-white',
  no_show: 'bg-rose-600 text-white',
}
const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

function when(value: string, timezone?: string | null) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      ...(timezone ? { timeZone: timezone } : {}),
    }).format(new Date(value))
  } catch {
    return value
  }
}
function vehicleLabel(row: GarageScheduleResponse['appointments'][number]) {
  const v = row.vehicle
  if (!v) return row.service_case?.vin || 'Vehicle not recorded'
  const label = [v.year, v.make, v.model].filter(Boolean).join(' ')
  return label || v.vin
}

type Capacity = AppointmentAvailabilityResponse & {
  slots: Array<AppointmentAvailabilityResponse['slots'][number] & { available_workforce_profile_ids?: string[] }>
}

export default function GarageSchedule() {
  const {
    fetchGarageSchedule,
    fetchGarageSchedulingConfiguration,
    fetchGarageAppointmentAvailability,
    saveGarageSchedulingSettings,
    addGarageWorkforceSchedule,
    addGarageWorkforceUnavailability,
    confirmGarageAppointment,
    rescheduleGarageAppointment,
    changeGarageAppointmentStatus,
  } = useCarUpApi()
  const { user } = useAuth()
  const isAdmin = user?.active_tenant?.role === 'admin'

  const [schedule, setSchedule] = useState<GarageScheduleResponse | null>(null)
  const [config, setConfig] = useState<GarageSchedulingConfiguration | null>(null)
  const [state, setState] = useState<'loading'|'ready'|'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [siteFilter, setSiteFilter] = useState('all')
  const [workerFilter, setWorkerFilter] = useState('all')

  const [settingsSite, setSettingsSite] = useState('')
  const [settingsEnabled, setSettingsEnabled] = useState<boolean | ''>('')
  const [settingsCapacity, setSettingsCapacity] = useState('')
  const [settingsInterval, setSettingsInterval] = useState('')

  const [scheduleUser, setScheduleUser] = useState('')
  const [scheduleSite, setScheduleSite] = useState('')
  const [scheduleDay, setScheduleDay] = useState('')
  const [scheduleStart, setScheduleStart] = useState('')
  const [scheduleEnd, setScheduleEnd] = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [effectiveUntil, setEffectiveUntil] = useState('')

  const [unavailableUser, setUnavailableUser] = useState('')
  const [unavailableStart, setUnavailableStart] = useState('')
  const [unavailableEnd, setUnavailableEnd] = useState('')
  const [unavailableReason, setUnavailableReason] = useState('')

  const [capacityCase, setCapacityCase] = useState('')
  const [capacitySite, setCapacitySite] = useState('')
  const [capacityDate, setCapacityDate] = useState('')
  const [capacityDuration, setCapacityDuration] = useState('')
  const [capacityResult, setCapacityResult] = useState<Capacity | null>(null)
  const [capacityState, setCapacityState] = useState<'idle'|'loading'|'error'>('idle')

  const [editingAppointment, setEditingAppointment] = useState<string | null>(null)
  const [appointmentSite, setAppointmentSite] = useState('')
  const [appointmentStart, setAppointmentStart] = useState('')
  const [appointmentEnd, setAppointmentEnd] = useState('')
  const [appointmentWorker, setAppointmentWorker] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const nextSchedule = await fetchGarageSchedule()
      setSchedule(nextSchedule)
      if (isAdmin) setConfig(await fetchGarageSchedulingConfiguration())
      else setConfig(null)
      setState('ready')
    } catch (e) {
      setState('error')
      setError(e instanceof Error ? e.message : 'Workshop schedule could not be loaded')
    }
  }, [fetchGarageSchedule, fetchGarageSchedulingConfiguration, isAdmin])

  useEffect(() => { void load() }, [load])

  const visible = useMemo(() => (schedule?.appointments || []).filter((a) => {
    if (statusFilter !== 'all' && a.status !== statusFilter) return false
    if (siteFilter !== 'all' && a.branch_id !== siteFilter) return false
    if (workerFilter !== 'all' && a.planned_workforce_profile_id !== workerFilter) return false
    return true
  }), [schedule, statusFilter, siteFilter, workerFilter])

  const activeSites = (config?.sites || []).filter((s) => s.is_active)
  const activeWorkers = (config?.workforce || []).filter((w) => w.employment_status === 'active')
  const appointmentTimezone = config?.sites.find((s) => s.id === appointmentSite)?.timezone || null

  function chooseSettingsSite(siteId: string) {
    setSettingsSite(siteId)
    const site = config?.sites.find((s) => s.id === siteId)
    if (site?.settings) {
      setSettingsEnabled(site.settings.scheduling_enabled)
      setSettingsCapacity(String(site.settings.max_concurrent_appointments))
      setSettingsInterval(String(site.settings.slot_interval_minutes))
    } else {
      setSettingsEnabled('')
      setSettingsCapacity('')
      setSettingsInterval('')
    }
  }

  async function saveSettings() {
    if (!settingsSite || settingsEnabled === '' || !settingsCapacity || !settingsInterval) return
    setBusy('settings'); setError(null)
    try {
      await saveGarageSchedulingSettings(settingsSite, {
        scheduling_enabled: settingsEnabled,
        max_concurrent_appointments: Number(settingsCapacity),
        slot_interval_minutes: Number(settingsInterval),
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scheduling settings could not be saved')
    } finally { setBusy(null) }
  }

  async function saveRecurringSchedule() {
    if (!scheduleUser || !scheduleSite || scheduleDay === '' || !scheduleStart || !scheduleEnd || !effectiveFrom) return
    setBusy('work-schedule'); setError(null)
    try {
      await addGarageWorkforceSchedule(scheduleUser, {
        branch_id: scheduleSite,
        day_of_week: Number(scheduleDay),
        starts_at: scheduleStart,
        ends_at: scheduleEnd,
        effective_from: effectiveFrom,
        effective_until: effectiveUntil || null,
      })
      setScheduleDay(''); setScheduleStart(''); setScheduleEnd(''); setEffectiveFrom(''); setEffectiveUntil('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Workforce schedule could not be saved')
    } finally { setBusy(null) }
  }

  async function saveUnavailability() {
    if (!unavailableUser || !unavailableStart || !unavailableEnd) return
    setBusy('unavailability'); setError(null)
    try {
      await addGarageWorkforceUnavailability(unavailableUser, {
        starts_at: new Date(unavailableStart).toISOString(),
        ends_at: new Date(unavailableEnd).toISOString(),
        reason_code: unavailableReason || null,
      })
      setUnavailableStart(''); setUnavailableEnd(''); setUnavailableReason('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unavailability could not be recorded')
    } finally { setBusy(null) }
  }

  async function inspectCapacity() {
    if (!capacityCase || !capacitySite || !capacityDate || !capacityDuration) return
    setCapacityState('loading'); setCapacityResult(null); setError(null)
    try {
      const result = await fetchGarageAppointmentAvailability({
        service_case_id: capacityCase,
        branch_id: capacitySite,
        date: capacityDate,
        duration_minutes: Number(capacityDuration),
      })
      setCapacityResult(result)
      setCapacityState('idle')
    } catch (e) {
      setCapacityState('error')
      setError(e instanceof Error ? e.message : 'Capacity could not be calculated')
    }
  }

  function openAppointmentEditor(a: GarageScheduleResponse['appointments'][number]) {
    const timezone = a.appointment_timezone || a.branch?.timezone
    if (!timezone) {
      setError('Appointment timezone is not configured')
      return
    }
    try {
      setEditingAppointment(a.id)
      setAppointmentSite(a.branch_id)
      setAppointmentStart(a.starts_at ? instantToGarageDateTimeLocal(a.starts_at, timezone) : '')
      setAppointmentEnd(a.ends_at ? instantToGarageDateTimeLocal(a.ends_at, timezone) : '')
      setAppointmentWorker(a.planned_workforce_profile_id || '')
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Appointment time could not be prepared for editing')
    }
  }

  async function saveAppointment(a: GarageScheduleResponse['appointments'][number]) {
    if (!appointmentSite || !appointmentStart || !appointmentEnd || !appointmentWorker) return
    setBusy(a.id); setError(null)
    try {
      const timezone = config?.sites.find((site) => site.id === appointmentSite)?.timezone
      if (!timezone) throw new Error('Selected site timezone is not configured')
      const body = {
        branch_id: appointmentSite,
        starts_at: garageDateTimeLocalToInstant(appointmentStart, timezone),
        ends_at: garageDateTimeLocalToInstant(appointmentEnd, timezone),
        planned_workforce_profile_id: appointmentWorker,
      }
      if (a.status === 'requested') await confirmGarageAppointment(a.id, body)
      else await rescheduleGarageAppointment(a.id, body)
      setEditingAppointment(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Appointment could not be changed')
    } finally { setBusy(null) }
  }

  async function transition(id: string, status: 'declined'|'cancelled'|'fulfilled'|'no_show') {
    setBusy(id); setError(null)
    try {
      await changeGarageAppointmentStatus(id, status)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Appointment status could not be changed')
    } finally { setBusy(null) }
  }

  if (state === 'loading') return (
    <div className={SN_PAGE}>
      <div className="flex items-center gap-3 p-8" role="status">
        <Loader2 className="w-6 h-6 animate-spin text-orange-500" aria-hidden="true" />
        <span>Loading workshop schedule…</span>
      </div>
    </div>
  )

  if (state === 'error') return (
    <div className={SN_PAGE}>
      <Card data-testid="schedule-load-error"><CardContent className="p-6 text-center">
        <p className="font-semibold">Workshop schedule could not be loaded</p>
        <p className="text-sm text-gray-500 mt-1">This is a loading problem, not a statement that there are no appointments.</p>
        <Button variant="outline" className="mt-4 min-h-11" onClick={() => { setState('loading'); void load() }}>Try again</Button>
      </CardContent></Card>
    </div>
  )

  return (
    <div className={SN_PAGE}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Workshop schedule</h1>
          <p className="text-gray-500">
            {schedule?.scope === 'planned_for_me'
              ? 'Appointments currently planned for you'
              : 'Appointments, explicit capacity and staff availability for this Garage'}
          </p>
        </div>
        <Link to="/garage"><Button variant="outline" className="min-h-11"><Wrench className="w-4 h-4 mr-2" />Workshop</Button></Link>
      </div>

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      <Card>
        <CardHeader><CardTitle className="text-base">Agenda filters</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">Status
            <select aria-label="Appointment status filter" className="mt-1 w-full min-h-11 rounded-md border px-3" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All statuses</option>
              {['requested','confirmed','declined','cancelled','fulfilled','no_show'].map((s) => <option key={s} value={s}>{s.replace('_',' ')}</option>)}
            </select>
          </label>
          <label className="text-sm">Site
            <select aria-label="Appointment site filter" className="mt-1 w-full min-h-11 rounded-md border px-3" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)}>
              <option value="all">All sites</option>
              {activeSites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="text-sm">Planned mechanic
            <select aria-label="Planned mechanic filter" className="mt-1 w-full min-h-11 rounded-md border px-3" value={workerFilter} onChange={(e) => setWorkerFilter(e.target.value)}>
              <option value="all">All planned mechanics</option>
              {activeWorkers.map((w) => <option key={w.id} value={w.id}>{w.display_name || w.staff_code}</option>)}
            </select>
          </label>
        </CardContent>
      </Card>

      <section aria-labelledby="agenda-heading">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 id="agenda-heading" className="text-lg font-semibold">Appointments</h2>
          <span className="text-sm text-gray-500">{visible.length} shown</span>
        </div>
        {visible.length === 0 ? (
          <Card data-testid="schedule-empty"><CardContent className="p-8 text-center">
            <CalendarDays className="w-7 h-7 text-gray-300 mx-auto mb-2" />
            <p className="font-medium">No appointments match these filters</p>
            <p className="text-sm text-gray-500">This reflects the successfully loaded schedule.</p>
          </CardContent></Card>
        ) : (
          <div className="space-y-3">
            {visible.map((a) => (
              <Card key={a.id} data-testid="appointment-card">
                <CardContent className="p-4 sm:p-5">
                  <div className="flex flex-wrap justify-between gap-3">
                    <div>
                      <p className="font-semibold">{a.service_case?.requester_name || 'Customer name not recorded'}</p>
                      <p className="text-sm text-gray-700">{vehicleLabel(a)}</p>
                      <p className="text-xs text-gray-500 break-all">Service Case {a.service_case_id}</p>
                    </div>
                    <Badge className={STATUS_TONE[a.status]}>{a.status.replace('_',' ')}</Badge>
                  </div>
                  <div className="grid gap-2 mt-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                    <p><Clock className="inline w-4 h-4 mr-1" />{when(a.starts_at, a.appointment_timezone)} – {when(a.ends_at, a.appointment_timezone)}</p>
                    <p>Site: {a.branch?.name || 'Not recorded'}</p>
                    <p>Service: {a.service_case?.service_category || 'Not recorded'}</p>
                    <p>Planned mechanic: {a.planned_workforce?.display_name || a.planned_workforce?.staff_code || 'Not recorded'}</p>
                  </div>

                  {isAdmin && ['requested','confirmed'].includes(a.status) && (
                    <div className="mt-4 border-t pt-4">
                      {editingAppointment === a.id ? (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="text-sm">Site
                            <select aria-label={'Appointment site ' + a.id} className="mt-1 w-full min-h-11 rounded-md border px-3" value={appointmentSite} onChange={(e) => setAppointmentSite(e.target.value)}>
                              <option value="">Select site</option>
                              {activeSites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                          </label>
                          <label className="text-sm">Planned mechanic
                            <select aria-label={'Appointment planned mechanic ' + a.id} className="mt-1 w-full min-h-11 rounded-md border px-3" value={appointmentWorker} onChange={(e) => setAppointmentWorker(e.target.value)}>
                              <option value="">Select planned mechanic</option>
                              {activeWorkers.filter((w) => w.live_branch_ids.includes(appointmentSite)).map((w) => <option key={w.id} value={w.id}>{w.display_name || w.staff_code}</option>)}
                            </select>
                          </label>
                          <label className="text-sm">Starts
                            <input aria-label={'Appointment start ' + a.id} type="datetime-local" className="mt-1 w-full min-h-11 rounded-md border px-3" value={appointmentStart} onChange={(e) => setAppointmentStart(e.target.value)} />
                          </label>
                          <label className="text-sm">Ends
                            <input aria-label={'Appointment end ' + a.id} type="datetime-local" className="mt-1 w-full min-h-11 rounded-md border px-3" value={appointmentEnd} onChange={(e) => setAppointmentEnd(e.target.value)} />
                          </label>
                          <p className="sm:col-span-2 text-xs text-gray-500" data-testid={'appointment-timezone-' + a.id}>
                            Times use {appointmentTimezone || 'the selected site timezone once configured'}
                          </p>
                          <div className="sm:col-span-2 flex flex-wrap gap-2">
                            <Button disabled={busy === a.id || !appointmentSite || !appointmentWorker || !appointmentStart || !appointmentEnd} onClick={() => void saveAppointment(a)}>
                              {a.status === 'requested' ? 'Confirm appointment' : 'Save reschedule'}
                            </Button>
                            <Button variant="outline" onClick={() => setEditingAppointment(null)}>Close</Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" className="min-h-11" onClick={() => openAppointmentEditor(a)}>
                            {a.status === 'requested' ? 'Review and confirm' : 'Reschedule'}
                          </Button>
                          {a.status === 'requested' && <Button variant="outline" className="min-h-11" disabled={busy === a.id} onClick={() => void transition(a.id,'declined')}>Decline</Button>}
                          <Button variant="outline" className="min-h-11" disabled={busy === a.id} onClick={() => void transition(a.id,'cancelled')}>Cancel</Button>
                          {a.status === 'confirmed' && <>
                            <Button variant="outline" className="min-h-11" disabled={busy === a.id} onClick={() => void transition(a.id,'fulfilled')}>Mark visit fulfilled</Button>
                            <Button variant="outline" className="min-h-11" disabled={busy === a.id} onClick={() => void transition(a.id,'no_show')}>Mark no-show</Button>
                          </>}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {isAdmin && (
        <>
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Settings2 className="w-4 h-4" />Branch scheduling settings</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                <label className="text-sm">Site
                  <select aria-label="Scheduling settings site" className="mt-1 w-full min-h-11 rounded-md border px-3" value={settingsSite} onChange={(e) => chooseSettingsSite(e.target.value)}>
                    <option value="">Select site</option>
                    {activeSites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
                <label className="text-sm">Scheduling
                  <select aria-label="Scheduling enabled" className="mt-1 w-full min-h-11 rounded-md border px-3" value={settingsEnabled === '' ? '' : String(settingsEnabled)} onChange={(e) => setSettingsEnabled(e.target.value === '' ? '' : e.target.value === 'true')}>
                    <option value="">Not configured</option>
                    <option value="true">Enabled</option>
                    <option value="false">Disabled</option>
                  </select>
                </label>
                <label className="text-sm">Concurrent capacity
                  <input aria-label="Maximum concurrent appointments" type="number" min="1" max="100" className="mt-1 w-full min-h-11 rounded-md border px-3" value={settingsCapacity} onChange={(e) => setSettingsCapacity(e.target.value)} placeholder="Not configured" />
                </label>
                <label className="text-sm">Slot interval (minutes)
                  <input aria-label="Slot interval minutes" type="number" min="5" max="240" className="mt-1 w-full min-h-11 rounded-md border px-3" value={settingsInterval} onChange={(e) => setSettingsInterval(e.target.value)} placeholder="Not configured" />
                </label>
              </div>
              {settingsSite && !config?.sites.find((s) => s.id === settingsSite)?.timezone && (
                <p className="text-sm text-amber-700" role="status">Schedule timezone not configured for this site.</p>
              )}
              <Button disabled={busy === 'settings' || !settingsSite || settingsEnabled === '' || !settingsCapacity || !settingsInterval} onClick={() => void saveSettings()}>Save scheduling settings</Button>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {activeSites.map((s) => <div key={s.id} className="rounded-lg border p-3 text-sm">
                  <p className="font-medium">{s.name}</p>
                  <p>Timezone: {s.timezone || 'Not configured'}</p>
                  {s.settings ? <>
                    <p>Scheduling: {s.settings.scheduling_enabled ? 'enabled' : 'disabled'}</p>
                    <p>{s.settings.max_concurrent_appointments} concurrent capacity</p>
                    <p>{s.settings.slot_interval_minutes}-minute slots</p>
                  </> : <p className="text-amber-700">Capacity not configured</p>}
                </div>)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Capacity inspector</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-gray-500">Counts appear only after a Service Case, site, date and duration are explicitly supplied.</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-sm">Service Case
                  <select aria-label="Capacity Service Case" className="mt-1 w-full min-h-11 rounded-md border px-3" value={capacityCase} onChange={(e) => setCapacityCase(e.target.value)}>
                    <option value="">Select Service Case</option>
                    {(schedule?.unscheduled_cases || []).map((c) => <option key={c.id} value={c.id}>{c.vin} · {c.status}</option>)}
                    {(schedule?.appointments || []).map((a) => <option key={a.service_case_id} value={a.service_case_id}>{a.service_case?.vin || a.service_case_id} · scheduled</option>)}
                  </select>
                </label>
                <label className="text-sm">Site
                  <select aria-label="Capacity site" className="mt-1 w-full min-h-11 rounded-md border px-3" value={capacitySite} onChange={(e) => setCapacitySite(e.target.value)}>
                    <option value="">Select site</option>
                    {activeSites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
                <label className="text-sm">Local date
                  <input aria-label="Capacity date" type="date" className="mt-1 w-full min-h-11 rounded-md border px-3" value={capacityDate} onChange={(e) => setCapacityDate(e.target.value)} />
                </label>
                <label className="text-sm">Duration (minutes)
                  <input aria-label="Capacity duration minutes" type="number" min="5" max="720" className="mt-1 w-full min-h-11 rounded-md border px-3" value={capacityDuration} onChange={(e) => setCapacityDuration(e.target.value)} placeholder="Required" />
                </label>
              </div>
              <Button disabled={capacityState === 'loading' || !capacityCase || !capacitySite || !capacityDate || !capacityDuration} onClick={() => void inspectCapacity()}>Calculate capacity</Button>
              {capacityResult && !capacityResult.configured && <p role="status" className="text-sm text-amber-700">{capacityResult.reason || 'Capacity not configured'}</p>}
              {capacityResult?.configured && capacityResult.enabled === false && <p role="status" className="text-sm text-amber-700">{capacityResult.reason}</p>}
              {capacityResult?.configured && capacityResult.enabled !== false && (
                <div className="space-y-2" data-testid="capacity-results">
                  <p className="text-sm">Site capacity: {capacityResult.capacity} · Slot interval: {capacityResult.slot_interval_minutes} minutes · Timezone: {capacityResult.branch.timezone}</p>
                  {capacityResult.slots.length === 0 ? <p className="text-sm text-gray-500">No slots are inside configured opening hours for this date.</p> : capacityResult.slots.map((slot) => (
                    <div key={slot.starts_at} className="rounded-lg border p-3 text-sm flex flex-wrap justify-between gap-2">
                      <span>{when(slot.starts_at, slot.appointment_timezone)} – {when(slot.ends_at, slot.appointment_timezone)}</span>
                      <span>{slot.branch_capacity} capacity · {slot.booked_count} booked · {slot.available_count} available</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Users className="w-4 h-4" />Workforce availability</CardTitle></CardHeader>
            <CardContent className="space-y-6">
              <section aria-labelledby="recurring-heading">
                <h3 id="recurring-heading" className="font-medium">Recurring work schedule</h3>
                <p className="text-sm text-gray-500 mb-3">Only explicit working windows contribute known bookable capacity.</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="text-sm">Workforce member
                    <select aria-label="Recurring schedule workforce" className="mt-1 w-full min-h-11 rounded-md border px-3" value={scheduleUser} onChange={(e) => setScheduleUser(e.target.value)}>
                      <option value="">Select workforce member</option>
                      {activeWorkers.map((w) => <option key={w.user_id} value={w.user_id}>{w.display_name || w.staff_code}</option>)}
                    </select>
                  </label>
                  <label className="text-sm">Site
                    <select aria-label="Recurring schedule site" className="mt-1 w-full min-h-11 rounded-md border px-3" value={scheduleSite} onChange={(e) => setScheduleSite(e.target.value)}>
                      <option value="">Select site</option>
                      {activeSites.filter((s) => activeWorkers.find((w) => w.user_id === scheduleUser)?.live_branch_ids.includes(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </label>
                  <label className="text-sm">Day
                    <select aria-label="Recurring schedule day" className="mt-1 w-full min-h-11 rounded-md border px-3" value={scheduleDay} onChange={(e) => setScheduleDay(e.target.value)}>
                      <option value="">Select day</option>
                      {DAY_NAMES.map((d,i) => <option key={d} value={i}>{d}</option>)}
                    </select>
                  </label>
                  <label className="text-sm">Effective from
                    <input aria-label="Recurring schedule effective from" type="date" className="mt-1 w-full min-h-11 rounded-md border px-3" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
                  </label>
                  <label className="text-sm">Starts
                    <input aria-label="Recurring schedule starts" type="time" className="mt-1 w-full min-h-11 rounded-md border px-3" value={scheduleStart} onChange={(e) => setScheduleStart(e.target.value)} />
                  </label>
                  <label className="text-sm">Ends
                    <input aria-label="Recurring schedule ends" type="time" className="mt-1 w-full min-h-11 rounded-md border px-3" value={scheduleEnd} onChange={(e) => setScheduleEnd(e.target.value)} />
                  </label>
                  <label className="text-sm">Effective until (optional)
                    <input aria-label="Recurring schedule effective until" type="date" className="mt-1 w-full min-h-11 rounded-md border px-3" value={effectiveUntil} onChange={(e) => setEffectiveUntil(e.target.value)} />
                  </label>
                </div>
                <Button className="mt-3" disabled={busy === 'work-schedule' || !scheduleUser || !scheduleSite || scheduleDay === '' || !scheduleStart || !scheduleEnd || !effectiveFrom} onClick={() => void saveRecurringSchedule()}>Add recurring schedule</Button>
              </section>

              <section aria-labelledby="unavailable-heading" className="border-t pt-5">
                <h3 id="unavailable-heading" className="font-medium">Temporary unavailability</h3>
                <p className="text-sm text-gray-500 mb-3">Bounded scheduling exception only; this is not an HR leave system.</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="text-sm">Workforce member
                    <select aria-label="Unavailability workforce" className="mt-1 w-full min-h-11 rounded-md border px-3" value={unavailableUser} onChange={(e) => setUnavailableUser(e.target.value)}>
                      <option value="">Select workforce member</option>
                      {activeWorkers.map((w) => <option key={w.user_id} value={w.user_id}>{w.display_name || w.staff_code}</option>)}
                    </select>
                  </label>
                  <label className="text-sm">Starts
                    <input aria-label="Unavailability starts" type="datetime-local" className="mt-1 w-full min-h-11 rounded-md border px-3" value={unavailableStart} onChange={(e) => setUnavailableStart(e.target.value)} />
                  </label>
                  <label className="text-sm">Ends
                    <input aria-label="Unavailability ends" type="datetime-local" className="mt-1 w-full min-h-11 rounded-md border px-3" value={unavailableEnd} onChange={(e) => setUnavailableEnd(e.target.value)} />
                  </label>
                  <label className="text-sm">Reason code (optional)
                    <select aria-label="Unavailability reason" className="mt-1 w-full min-h-11 rounded-md border px-3" value={unavailableReason} onChange={(e) => setUnavailableReason(e.target.value)}>
                      <option value="">Not recorded</option>
                      <option value="leave">Leave</option>
                      <option value="training">Training</option>
                      <option value="unavailable">Unavailable</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                </div>
                <Button className="mt-3" disabled={busy === 'unavailability' || !unavailableUser || !unavailableStart || !unavailableEnd} onClick={() => void saveUnavailability()}>Record unavailability</Button>
              </section>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Unscheduled Service Cases</CardTitle></CardHeader>
            <CardContent>
              {(schedule?.unscheduled_cases || []).length === 0 ? (
                <p className="text-sm text-gray-500">No open Service Cases are currently waiting without a live appointment.</p>
              ) : (
                <div className="space-y-2">
                  {schedule?.unscheduled_cases.map((c) => <div key={c.id} className="rounded-lg border p-3 text-sm">
                    <p className="font-medium">{c.vin} · {c.service_category || 'Service category not recorded'}</p>
                    <p>Status: {c.status} · Service Case {c.id}</p>
                  </div>)}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
