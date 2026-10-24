import { Badge } from '@/components/ui/badge'
import { CalendarDays, Car, MapPin } from 'lucide-react'
import type { CaseHub } from '@/lib/garageBusiness'
import {
  appointmentStatusLabel, caseStatusLabel, categoryLabel, dateTimeLabel, STATUS_TONE, vehicleLabel, whenLabel,
} from '@/lib/garageWorkspace'

/** Vehicle, case status, appointment and the customer's own words about what they need. */
export function HubHeader({ hub }: { hub: CaseHub }) {
  const { case: c, vehicle, appointment, site } = hub
  return (
    <header className="space-y-4" data-testid="case-header">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold flex items-center gap-2" data-testid="case-vehicle">
            <Car className="w-5 h-5 text-gray-400 shrink-0" aria-hidden="true" />
            <span className="break-words min-w-0">{vehicleLabel(vehicle, c.vin)}</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1 break-all" data-testid="case-vin">{c.vin}</p>
        </div>
        <Badge className={STATUS_TONE[String(c.status).toLowerCase()]} data-testid="case-status">
          {caseStatusLabel(c.status)}
        </Badge>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt className="text-gray-500">What it is about</dt>
          <dd data-testid="case-category">{categoryLabel(c.service_category)}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Requested</dt>
          <dd>{whenLabel(c.requested_at)}</dd>
        </div>
      </dl>

      {c.status !== 'requested' && (
        <p className="flex items-start gap-2 text-sm text-gray-700" data-testid="case-site">
          <MapPin className="w-4 h-4 mt-0.5 text-gray-400 shrink-0" aria-hidden="true" />
          <span>
            {site
              ? <>Site: {site.name || 'Unnamed site'}{site.is_active ? '' : <span className="text-amber-700"> (no longer active)</span>}</>
              : 'No site is recorded on this job.'}
          </span>
        </p>
      )}

      {appointment && (
        <p className="flex items-start gap-2 text-sm text-gray-700" data-testid="case-appointment">
          <CalendarDays className="w-4 h-4 mt-0.5 text-gray-400 shrink-0" aria-hidden="true" />
          <span>
            Appointment {appointmentStatusLabel(appointment.status).toLowerCase()}:{' '}
            {dateTimeLabel(appointment.starts_at, appointment.appointment_timezone)}
            {' – '}
            {dateTimeLabel(appointment.ends_at, appointment.appointment_timezone)}
            <span className="text-gray-500"> ({appointment.appointment_timezone})</span>
          </span>
        </p>
      )}

      {c.request_summary && (
        <p className="text-sm text-gray-700 border-l-2 border-gray-200 pl-3 break-words" data-testid="case-summary">
          {c.request_summary}
        </p>
      )}
    </header>
  )
}
