/**
 * Service-request vocabulary for customer-facing surfaces.
 *
 * The backend calls this a "Service Case" and uses `requested / accepted / active / completed /
 * declined / cancelled`. Owner UAT flagged that vocabulary as internal architecture leaking into
 * the interface: a Zimbabwean vehicle owner does not have a "case", they have a request to a
 * garage. The backend names are unchanged — only what a person reads is translated here, in one
 * place, so two surfaces cannot describe the same state differently.
 */

/** Governed categories, mirroring GARAGE_SERVICE_CATEGORIES in garageDirectoryService.js. */
export const SERVICE_CATEGORIES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'general_service', label: 'General service' },
  { value: 'engine', label: 'Engine' },
  { value: 'transmission', label: 'Transmission' },
  { value: 'brakes', label: 'Brakes' },
  { value: 'suspension', label: 'Suspension' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'diagnostics', label: 'Diagnostics — find the problem first' },
  { value: 'bodywork', label: 'Bodywork' },
  { value: 'tyres', label: 'Tyres' },
  { value: 'air_conditioning', label: 'Air conditioning' },
  { value: 'exhaust', label: 'Exhaust' },
  { value: 'other', label: 'Something else' },
]

export function serviceCategoryLabel(value: string | null | undefined): string {
  if (!value) return 'Not specified'
  return SERVICE_CATEGORIES.find((c) => c.value === value)?.label ?? value
}

export type ServiceRequestStatus =
  | 'requested' | 'accepted' | 'active' | 'completed' | 'declined' | 'cancelled'

type StatusPresentation = {
  /** What the owner reads. */
  label: string
  /** What actually happens next, in plain language. Never a promise CarUp cannot keep. */
  next: string
  tone: 'waiting' | 'progress' | 'done' | 'closed'
}

const STATUS: Record<string, StatusPresentation> = {
  requested: {
    label: 'Sent — waiting for the garage',
    next: 'The garage has your request and will accept or decline it. You will see the change here.',
    tone: 'waiting',
  },
  accepted: {
    label: 'Accepted by the garage',
    next: 'The garage has taken the job on. Work starts when they begin it.',
    tone: 'progress',
  },
  active: {
    label: 'Work in progress',
    next: 'The garage is working on your vehicle. What they record will appear in your service history.',
    tone: 'progress',
  },
  completed: {
    label: 'Completed',
    next: 'The work is finished. Anything the garage recorded is in your service history.',
    tone: 'done',
  },
  declined: {
    label: 'Declined by the garage',
    next: 'This garage cannot take the job. You can ask a different garage.',
    tone: 'closed',
  },
  cancelled: {
    label: 'Cancelled',
    next: 'This request was cancelled and the garage will not act on it.',
    tone: 'closed',
  },
}

export function statusPresentation(status: string | null | undefined): StatusPresentation {
  return STATUS[String(status ?? '').toLowerCase()] ?? {
    label: 'Status not recorded',
    next: 'CarUp does not have a current status for this request.',
    tone: 'waiting',
  }
}

export function statusLabel(status: string | null | undefined): string {
  return statusPresentation(status).label
}

/** Only a request the garage has not yet acted on can be withdrawn by the owner. */
export function canCancel(status: string | null | undefined): boolean {
  const s = String(status ?? '').toLowerCase()
  return s === 'requested' || s === 'accepted'
}

/** A short, human reference. The case id is a UUID; nobody reads a UUID down a phone. */
export function requestReference(caseId: string | null | undefined): string {
  const raw = String(caseId ?? '').replace(/-/g, '').toUpperCase()
  return raw ? `SR-${raw.slice(0, 8)}` : 'SR-UNKNOWN'
}

export function requestDate(iso: string | null | undefined): string {
  if (!iso) return 'Date not recorded'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? 'Date not recorded' : d.toLocaleDateString()
}
