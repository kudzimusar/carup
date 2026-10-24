import { useId } from 'react'
import { Check, CircleAlert, Clock, Minus, X, Circle } from 'lucide-react'
import type { GarageAppointment } from '@/hooks/useCarUpApi'
import {
  ESTIMATE_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  type CustomerEstimate,
  type CustomerInvoice,
  type OwnerAuthorization,
} from '@/lib/garageBusiness'
import { requestDate } from '@/lib/serviceRequests'

/**
 * The customer's view of one request's whole journey:
 * Requested -> Accepted -> Appointment -> Estimate -> Authorized -> In progress -> Completed -> Invoice -> Payment recorded.
 *
 * EVERY step is derived from data the server returned: the case's status and timestamps, the
 * appointment rows, the estimate statuses, the job's canonical `work_order_authorization` and the
 * invoice's `payment_status`. "Authorized" reads the authorization, never the estimate's status. A step is never shown as
 * done because the one before it was. A declined estimate stops the line at "Not authorized": the steps
 * after it are "Not reached", not "pending", because nothing in the data says they are coming.
 *
 * "Payment recorded" is deliberately NOT "Paid": a finished job or an issued invoice is not a payment,
 * and a payment is only ever what the garage recorded (the server states that source on every one).
 */

export type Loadable<T> = { status: 'idle' | 'loading' | 'ready' | 'error'; items: T[] }

export type JourneyRequest = {
  status: string
  requested_at: string | null
  accepted_at: string | null
  declined_at: string | null
  started_at: string | null
  completed_at: string | null
  cancelled_at: string | null
}

type StepState = 'done' | 'current' | 'pending' | 'stopped' | 'not_reached' | 'unknown' | 'none'

type Step = {
  key: string
  name: string
  state: StepState
  detail: string
  /** a stopped step that ends the journey. `false` = informational (a cancelled appointment does not end the job). */
  blocks?: boolean
}

const STATE_WORD: Record<StepState, string> = {
  done: 'Done',
  current: 'Needs attention or in progress',
  pending: 'Not yet',
  stopped: 'Stopped',
  not_reached: 'Not reached',
  unknown: 'Unknown',
  none: 'Nothing recorded',
}

const lower = (value: unknown) => String(value ?? '').toLowerCase()

function whenLabel(a: GarageAppointment): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: a.appointment_timezone,
    }).format(new Date(a.starts_at))
  } catch {
    return a.starts_at
  }
}

/** The appointment that best describes where scheduling stands: a real visit over a live request over a dead one. */
function pickAppointment(list: GarageAppointment[]): GarageAppointment | null {
  const rank: Record<GarageAppointment['status'], number> = {
    fulfilled: 5, confirmed: 4, requested: 3, no_show: 2, declined: 1, cancelled: 0,
  }
  return [...list].sort((a, b) =>
    (rank[b.status] - rank[a.status]) || String(b.starts_at).localeCompare(String(a.starts_at)),
  )[0] ?? null
}

function unknownDetail(status: Loadable<unknown>['status'], what: string): string {
  if (status === 'loading') return `Loading ${what}…`
  // Unknown is not "none": say the answer is missing, not that the answer is nothing.
  if (status === 'error') return 'Not shown — this could not be loaded'
  return 'Not available'
}

/**
 * The Authorized step reads the job's CANONICAL authorization (`work_order_authorization`), never the
 * estimate's status: an accepted estimate whose authorization was later withdrawn is not "authorized",
 * and an accepted estimate with no authorization state is not claimed to be.
 */
function authorizedStep(
  authorization: OwnerAuthorization | null,
  accepted: CustomerEstimate | null,
  latest: CustomerEstimate,
): Step {
  const base = { key: 'authorized', name: 'Authorized' }
  if (authorization === 'revoked') {
    return { ...base, state: 'stopped', detail: accepted ? 'Estimate accepted — authorization later withdrawn' : 'Authorization was withdrawn' }
  }
  if (authorization === 'authorized') {
    return {
      ...base, state: 'done',
      detail: accepted?.decided_at ? `Authorized — estimate accepted ${requestDate(accepted.decided_at)}` : 'Authorized',
    }
  }
  if (authorization === 'declined' || latest.status === 'declined') {
    return {
      ...base, state: 'stopped',
      detail: latest.status === 'declined' ? 'Not authorized — the estimate was declined' : 'Not authorized — authorization was declined',
    }
  }
  if (accepted && authorization === null) {
    return { ...base, state: 'unknown', detail: 'Estimate accepted — whether the work is authorized is not available' }
  }
  return { ...base, state: 'pending', detail: 'Not authorized yet' }
}

function deriveSteps(
  request: JourneyRequest,
  appointments: GarageAppointment[],
  estimates: Loadable<CustomerEstimate>,
  invoices: Loadable<CustomerInvoice>,
): { steps: Step[]; note: string | null } {
  const status = lower(request.status)
  const started = Boolean(request.started_at) || status === 'active' || status === 'completed'
  const completed = status === 'completed' || Boolean(request.completed_at)
  const acceptedByGarage = Boolean(request.accepted_at) || ['accepted', 'active', 'completed'].includes(status)

  const steps: Step[] = []

  // 1. Requested — the request exists, so it was made.
  steps.push({ key: 'requested', name: 'Requested', state: 'done', detail: `Sent ${requestDate(request.requested_at)}` })

  // 2. Accepted by the garage.
  if (status === 'declined') {
    steps.push({
      key: 'accepted', name: 'Accepted', state: 'stopped',
      detail: request.declined_at ? `Declined by the garage ${requestDate(request.declined_at)}` : 'Declined by the garage',
    })
  } else if (acceptedByGarage) {
    steps.push({
      key: 'accepted', name: 'Accepted', state: 'done',
      detail: request.accepted_at ? `Accepted by the garage ${requestDate(request.accepted_at)}` : 'Accepted by the garage',
    })
  } else {
    steps.push({ key: 'accepted', name: 'Accepted', state: 'pending', detail: 'Waiting for the garage' })
  }

  // 3. Appointment — optional, so its absence or end never stops the job.
  const appointment = pickAppointment(appointments)
  if (!appointment) {
    steps.push({ key: 'appointment', name: 'Appointment', state: 'none', detail: 'No appointment on record' })
  } else if (appointment.status === 'requested') {
    steps.push({ key: 'appointment', name: 'Appointment', state: 'current', detail: `Requested for ${whenLabel(appointment)} — not confirmed by the garage yet` })
  } else if (appointment.status === 'confirmed') {
    steps.push({ key: 'appointment', name: 'Appointment', state: 'done', detail: `Confirmed for ${whenLabel(appointment)}` })
  } else if (appointment.status === 'fulfilled') {
    steps.push({ key: 'appointment', name: 'Appointment', state: 'done', detail: `Visit fulfilled (${whenLabel(appointment)})` })
  } else {
    const text = appointment.status === 'declined' ? 'The garage declined the requested time'
      : appointment.status === 'cancelled' ? 'Appointment cancelled' : 'No-show recorded'
    steps.push({ key: 'appointment', name: 'Appointment', state: 'stopped', blocks: false, detail: text })
  }

  // 4 + 5. Estimate and Authorized — only the estimate statuses the server returned.
  const estimateRows = estimates.status === 'ready' ? estimates.items : null
  const sorted = estimateRows ? [...estimateRows].sort((a, b) => b.version - a.version) : []
  const accepted = sorted.find((e) => e.status === 'accepted') ?? null
  const latest = sorted[0] ?? null

  if (!estimateRows) {
    const detail = unknownDetail(estimates.status, 'estimates')
    steps.push({ key: 'estimate', name: 'Estimate', state: 'unknown', detail })
    steps.push({ key: 'authorized', name: 'Authorized', state: 'unknown', detail })
  } else if (!latest) {
    if (started) {
      steps.push({ key: 'estimate', name: 'Estimate', state: 'none', detail: 'No estimate recorded' })
      steps.push({ key: 'authorized', name: 'Authorized', state: 'none', detail: 'No estimate decision recorded' })
    } else {
      steps.push({ key: 'estimate', name: 'Estimate', state: 'pending', detail: 'No estimate sent to you yet' })
      steps.push({ key: 'authorized', name: 'Authorized', state: 'pending', detail: 'Not yet' })
    }
  } else {
    const shown = accepted ?? latest
    const label = `Version ${shown.version} — ${ESTIMATE_STATUS_LABEL[shown.status] ?? shown.status}`
    // The ESTIMATE step reports the estimate's own status; the AUTHORIZED step reports the job's
    // canonical authorization. They are separate facts and may disagree (accepted, then withdrawn).
    if (shown.status === 'sent') {
      if (shown.expired) {
        steps.push({ key: 'estimate', name: 'Estimate', state: 'stopped', detail: `Version ${shown.version} expired — it can no longer be accepted` })
      } else if (shown.awaiting_owner) {
        steps.push({ key: 'estimate', name: 'Estimate', state: 'current', detail: `Version ${shown.version} is waiting for the vehicle's registered owner to decide` })
      } else if (shown.can_decide) {
        steps.push({ key: 'estimate', name: 'Estimate', state: 'current', detail: `Version ${shown.version} is waiting for your decision` })
      } else {
        steps.push({ key: 'estimate', name: 'Estimate', state: 'current', detail: label })
      }
    } else if (shown.status === 'superseded') {
      steps.push({
        key: 'estimate', name: 'Estimate', state: 'current',
        detail: `Version ${shown.version} was replaced by a newer version that has not been sent to you`,
      })
    } else if (shown.status === 'accepted' || shown.status === 'declined') {
      steps.push({ key: 'estimate', name: 'Estimate', state: 'done', detail: label })
    } else {
      // cancelled (a draft never reaches the customer)
      steps.push({ key: 'estimate', name: 'Estimate', state: 'stopped', detail: label })
    }
    steps.push(authorizedStep(latest.work_order_authorization ?? null, accepted, latest))
  }

  // 6 + 7. Work status from the case itself.
  steps.push(started
    ? { key: 'in_progress', name: 'In progress', state: 'done', detail: request.started_at ? `Work started ${requestDate(request.started_at)}` : 'Work started' }
    : { key: 'in_progress', name: 'In progress', state: 'pending', detail: 'Not started' })
  steps.push(completed
    ? { key: 'completed', name: 'Completed', state: 'done', detail: request.completed_at ? `Completed ${requestDate(request.completed_at)}` : 'Completed' }
    : { key: 'completed', name: 'Completed', state: 'pending', detail: 'Not completed' })

  // 8 + 9. Invoice and the payments the garage recorded against it.
  if (invoices.status !== 'ready') {
    const detail = unknownDetail(invoices.status, 'invoices')
    steps.push({ key: 'invoice', name: 'Invoice', state: 'unknown', detail })
    steps.push({ key: 'payment', name: 'Payment recorded', state: 'unknown', detail })
  } else {
    const byRecent = [...invoices.items].sort((a, b) => String(b.issued_at).localeCompare(String(a.issued_at)))
    const invoice = byRecent.find((i) => i.status === 'issued') ?? byRecent[0] ?? null
    if (!invoice) {
      steps.push({ key: 'invoice', name: 'Invoice', state: 'pending', detail: 'No invoice issued yet' })
      steps.push({ key: 'payment', name: 'Payment recorded', state: 'pending', detail: 'Not yet' })
    } else if (invoice.status === 'voided') {
      steps.push({ key: 'invoice', name: 'Invoice', state: 'stopped', detail: `Invoice ${invoice.invoice_number} was voided` })
      steps.push({ key: 'payment', name: 'Payment recorded', state: 'pending', detail: 'Not yet' })
    } else {
      steps.push({ key: 'invoice', name: 'Invoice', state: 'done', detail: `Invoice ${invoice.invoice_number} issued ${requestDate(invoice.issued_at)}` })
      const paymentLabel = PAYMENT_STATUS_LABEL[invoice.payment_status] ?? 'Payment status not recorded'
      const paymentState: StepState = invoice.payment_status === 'paid' ? 'done'
        : invoice.payment_status === 'partially_paid' ? 'current'
          : invoice.payment_status === 'voided' ? 'stopped' : 'pending'
      steps.push({ key: 'payment', name: 'Payment recorded', state: paymentState, detail: paymentLabel })
    }
  }

  // After a stop, what was still "pending" is not coming — say so rather than imply it is.
  const cancelled = status === 'cancelled'
  let blocked = cancelled
  const settled = steps.map((step) => {
    const next = blocked && step.state === 'pending' ? { ...step, state: 'not_reached' as StepState, detail: 'Not reached' } : step
    if (step.state === 'stopped' && step.blocks !== false) blocked = true
    return next
  })

  const note = cancelled
    ? (request.cancelled_at ? `This request was cancelled ${requestDate(request.cancelled_at)}.` : 'This request was cancelled.')
    : null
  return { steps: settled, note }
}

const ICON_TONE: Record<StepState, string> = {
  done: 'bg-green-600 text-white',
  current: 'bg-amber-500 text-white',
  pending: 'border border-gray-300 bg-white text-gray-400',
  stopped: 'bg-red-600 text-white',
  not_reached: 'border border-gray-200 bg-gray-50 text-gray-400',
  unknown: 'border border-amber-400 bg-amber-50 text-amber-700',
  none: 'border border-gray-200 bg-gray-50 text-gray-400',
}

function StepIcon({ state }: { state: StepState }) {
  const cls = 'w-3.5 h-3.5'
  if (state === 'done') return <Check className={cls} aria-hidden="true" />
  if (state === 'current') return <Clock className={cls} aria-hidden="true" />
  if (state === 'stopped') return <X className={cls} aria-hidden="true" />
  if (state === 'unknown') return <CircleAlert className={cls} aria-hidden="true" />
  if (state === 'pending') return <Circle className={cls} aria-hidden="true" />
  return <Minus className={cls} aria-hidden="true" />
}

type Props = {
  request: JourneyRequest
  appointments: GarageAppointment[]
  estimates: Loadable<CustomerEstimate>
  invoices: Loadable<CustomerInvoice>
}

export default function JourneyProgress({ request, appointments, estimates, invoices }: Props) {
  const headingId = useId()
  const { steps, note } = deriveSteps(request, appointments, estimates, invoices)
  return (
    <section className="mt-4 rounded-lg border bg-white p-4" aria-labelledby={headingId} data-testid="journey-progress">
      <h3 id={headingId} className="text-sm font-semibold text-gray-900">Where this request stands</h3>
      {note && <p className="mt-1 text-sm text-gray-700" data-testid="journey-note">{note}</p>}
      <ol className="mt-3 space-y-2">
        {steps.map((step) => (
          <li
            key={step.key}
            className="flex items-start gap-3"
            data-testid="journey-step"
            data-step={step.key}
            data-state={step.state}
          >
            <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${ICON_TONE[step.state]}`}>
              <StepIcon state={step.state} />
              <span className="sr-only">{STATE_WORD[step.state]}:</span>
            </span>
            <div className="min-w-0">
              <p className={`text-sm font-medium ${step.state === 'not_reached' || step.state === 'none' ? 'text-gray-500' : 'text-gray-900'}`}>{step.name}</p>
              <p className="text-xs text-gray-600 break-words" data-testid="journey-step-detail">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
