/**
 * What a garage applicant is told, in their words.
 *
 * The seven onboarding states must never collapse into each other (canonical plan §6.1, DESIGN.md
 * §17.1). Not submitted, missing evidence, under review, OCR unavailable, system error, rejected and
 * approved are seven different facts, and a person waiting on their livelihood deserves to know
 * which one they are in. In particular:
 *
 *   OCR failure ≠ rejection · a failed lookup ≠ "no application" · no evidence yet ≠ fraudulent
 */

export type ApplicationStatus =
  | 'draft' | 'submitted' | 'information_required' | 'under_review' | 'approved' | 'rejected'

export type GarageApplication = {
  id: string
  status: ApplicationStatus
  trading_name: string | null
  address_line: string | null
  location_city: string | null
  location_province: string | null
  contact_phone: string | null
  contact_email: string | null
  service_categories: string[] | null
  applicant_relationship: string | null
  attestation_accepted_at: string | null
  submitted_at: string | null
  decided_at: string | null
  decision_reason: string | null
  decision_reason_code: string | null
  supersedes_application_id: string | null
  activated_tenant_id: string | null
}

export type StatusPresentation = {
  label: string
  /** What happens next — never a restatement of the label. */
  next: string
  tone: 'draft' | 'waiting' | 'action' | 'good' | 'closed'
  /** Whether the applicant still owns the form. */
  editable: boolean
}

const PRESENTATION: Record<ApplicationStatus, StatusPresentation> = {
  draft: {
    label: 'Not sent yet',
    next: 'Finish the details below and send your application when you are ready.',
    tone: 'draft',
    editable: true,
  },
  submitted: {
    label: 'Sent — waiting for CarUp',
    next: 'CarUp has your application. Someone will look at it and may ask for more.',
    tone: 'waiting',
    editable: false,
  },
  information_required: {
    label: 'CarUp needs something more',
    next: 'Add what was asked for below and send it back. This is the same application, not a new one.',
    tone: 'action',
    editable: true,
  },
  under_review: {
    label: 'Being reviewed',
    next: 'Someone at CarUp is going through your application now.',
    tone: 'waiting',
    editable: false,
  },
  approved: {
    label: 'Approved',
    next: 'Your garage is being set up. You will see it in your account.',
    tone: 'good',
    editable: false,
  },
  rejected: {
    label: 'Not approved',
    next: 'This application is closed. You can start a new one that carries on from it.',
    tone: 'closed',
    editable: false,
  },
}

export function statusPresentation(status: ApplicationStatus | string): StatusPresentation {
  return PRESENTATION[status as ApplicationStatus] ?? {
    label: 'Status not recorded',
    next: 'CarUp could not read the state of this application. This is a loading problem, not a decision.',
    tone: 'waiting',
    editable: false,
  }
}

export const STATUS_TONE_CLASS: Record<StatusPresentation['tone'], string> = {
  draft: 'bg-gray-400 text-white',
  waiting: 'bg-amber-500 text-white',
  action: 'bg-orange-500 text-white',
  good: 'bg-green-600 text-white',
  closed: 'bg-gray-500 text-white',
}

/** PO-2 field 6 — a declaration, not proof. */
export const APPLICANT_RELATIONSHIPS = [
  ['owner', 'I own this business'],
  ['manager', 'I manage it'],
  ['authorised_representative', 'I am authorised to act for it'],
] as const

/**
 * The setup checklist a person sees while they wait.
 *
 * Each step reports what is actually known — never a spinner standing in for a fact, and never a
 * tick for something that has not happened.
 */
export type SetupStep = { label: string; state: 'complete' | 'pending' | 'waiting' | 'blocked'; detail: string }

export function setupSteps(app: GarageApplication | null, blockers: string[] | null): SetupStep[] {
  if (!app) {
    return [{ label: 'Your details', state: 'pending', detail: 'Not started yet.' }]
  }
  const detailsDone = Array.isArray(blockers) && blockers.length === 0
  const sent = Boolean(app.submitted_at)
  const decided = Boolean(app.decided_at)

  return [
    {
      label: 'Your details',
      state: detailsDone ? 'complete' : 'pending',
      detail: detailsDone
        ? 'Everything CarUp needs is filled in.'
        : `Still needed: ${(blockers ?? []).join(', ') || 'a few details'}.`,
    },
    {
      label: 'Sent to CarUp',
      state: sent ? 'complete' : 'pending',
      detail: sent ? 'CarUp has your application.' : 'Not sent yet.',
    },
    {
      label: 'Review',
      state: decided ? 'complete' : (sent ? 'waiting' : 'pending'),
      detail: decided
        ? (app.status === 'approved' ? 'Approved.' : 'Closed — not approved.')
        : (app.status === 'information_required'
          ? 'Paused — CarUp asked you for something.'
          : (sent ? 'In progress.' : 'Starts once you send your application.')),
    },
    {
      label: 'Garage access',
      state: app.activated_tenant_id ? 'complete' : (app.status === 'rejected' ? 'blocked' : 'pending'),
      detail: app.activated_tenant_id
        ? 'Your garage workspace is ready.'
        : (app.status === 'rejected' ? 'Not granted.' : 'Granted once your application is approved.'),
    },
  ]
}
