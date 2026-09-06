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

/* ── GMO-2: business-presence evidence ─────────────────────────────────────────────────────────── */

export type ExtractionState =
  | 'not_attempted' | 'unavailable' | 'failed'
  | 'low_confidence' | 'awaiting_confirmation' | 'confirmed'

export type EvidenceDocument = {
  id: string
  evidence_type: string
  description: string | null
  mime_type: string
  size_bytes: number
  extraction_state: ExtractionState
  extraction_candidates: Record<string, { state: string; value?: string }> | null
  extraction_confidence: number | null
  extraction_note: string | null
  created_at: string
  has_file: boolean
}

/**
 * What a garage can show to prove it exists.
 *
 * PO-2 forbids requiring incorporation, so this list leads with what an established Zimbabwe garage
 * actually has to hand. A company certificate appears well down it, as one option among many.
 */
export const GARAGE_EVIDENCE_TYPES: ReadonlyArray<readonly [string, string, string]> = [
  ['premises_photo', 'Photo of your workshop', 'The place you work from'],
  ['signage_photo', 'Photo of your sign or board', 'Your name where customers see it'],
  ['utility_bill', 'A bill for the address', 'ZESA, water or similar'],
  ['lease_or_title', 'Lease or title for the property', 'Rental agreement, lease or deed'],
  ['council_or_trade_licence', 'Council or trade licence', 'A shop or trading licence'],
  ['company_registration', 'Company registration', 'If you have one — it is not required'],
  ['tax_document', 'A tax document', 'ZIMRA registration or similar'],
  ['bank_or_mobile_money_statement', 'Bank or mobile money statement', 'A business account in the garage name'],
  ['other', 'Something else', 'Tell us what it is'],
] as const

export function evidenceTypeLabel(value: string): string {
  return GARAGE_EVIDENCE_TYPES.find(([v]) => v === value)?.[1] ?? value.replace(/_/g, ' ')
}

/**
 * The six extraction states, kept apart.
 *
 * `unavailable` and `failed` are the two that matter most. Neither is a problem with the person's
 * application, and both must leave them a working way forward — the manual path was always the
 * real path, and reading a document was only ever a convenience on top of it.
 */
export function extractionPresentation(doc: EvidenceDocument): {
  label: string; detail: string; tone: 'neutral' | 'waiting' | 'action' | 'good'; showCandidates: boolean
} {
  const note = doc.extraction_note
  switch (doc.extraction_state) {
    case 'not_attempted':
      return { label: 'Received', detail: note ?? 'CarUp has this document.', tone: 'neutral', showCandidates: false }
    case 'unavailable':
      return {
        label: 'Received',
        // Deliberately NOT phrased as a failure: nothing went wrong, and nothing is owed.
        detail: note ?? 'Reading this automatically is not available. Type the details in yourself.',
        tone: 'neutral', showCandidates: false,
      }
    case 'failed':
      return {
        label: 'Received — could not be read',
        detail: note ?? 'We could not read this automatically. Your upload is safe; type the details in yourself.',
        tone: 'neutral', showCandidates: false,
      }
    case 'low_confidence':
      return {
        label: 'Read, but check it',
        detail: note ?? 'We are not confident we read this correctly. Check each value.',
        tone: 'action', showCandidates: true,
      }
    case 'awaiting_confirmation':
      return {
        label: 'Read — please check',
        detail: note ?? 'Check these against your document before you use them.',
        tone: 'waiting', showCandidates: true,
      }
    case 'confirmed':
      return { label: 'Checked by you', detail: 'You have been through these values.', tone: 'good', showCandidates: true }
    default:
      return {
        label: 'Received',
        detail: 'CarUp has this document. Its reading status is not recorded.',
        tone: 'neutral', showCandidates: false,
      }
  }
}

/**
 * The setup checklist a person sees while they wait.
 *
 * Each step reports what is actually known — never a spinner standing in for a fact, and never a
 * tick for something that has not happened.
 */
export type SetupStep = { label: string; state: 'complete' | 'pending' | 'waiting' | 'blocked'; detail: string }

export function setupSteps(
  app: GarageApplication | null,
  blockers: string[] | null,
  evidenceCount: number | null = null,
): SetupStep[] {
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
      label: 'Proof your garage is real',
      // An unknown count reports as unknown. Rendering "0 uploaded" for a number nobody measured
      // tells a person their evidence vanished.
      state: evidenceCount === null ? 'pending' : (evidenceCount > 0 ? 'complete' : 'pending'),
      detail: evidenceCount === null
        ? 'Not loaded yet.'
        : evidenceCount > 0
          ? `${evidenceCount} ${evidenceCount === 1 ? 'document' : 'documents'} uploaded.`
          : 'Add at least one document or photo that shows your garage is real.',
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
