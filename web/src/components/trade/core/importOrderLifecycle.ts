/**
 * RX-06 — the Import Order lifecycle, as presentation over the CANONICAL backend state machine
 * (backend/constants/diaspora/diasporaStatuses.js: IMPORT_ORDER_STATUSES / IMPORT_ORDER_TRANSITIONS /
 * DOCUMENT_STATUSES). Nothing here creates, renames or reorders a canonical state; it only groups the 20
 * happy-path states into seven phases people can read, and names the three exception states.
 *
 * Truth rules encoded here:
 *  - An unknown status is NEVER placed on the rail (it is reported as unknown, not guessed).
 *  - An exception status (cancelled / disputed / flagged) replaces the order's status, so where the order
 *    stood before is NOT knowable from the status alone: the rail says so instead of inventing progress.
 *  - Transitions are not linear (e.g. DOCUMENTS_VERIFIED → CUSTOMS_IN_PROGRESS for a vehicle already in
 *    the country; SELLER_ASSIGNED → QUOTE_ISSUED for a re-quote). A phase that the order skipped is shown
 *    as "not needed / skipped" only when the CURRENT state proves it was passed — never as completed work
 *    with dates. Phases are "passed", not "completed by someone on a date".
 *  - "Usually with" names the party the canonical state waits on (from the state's meaning), never a
 *    specific person, and never implies that person was notified.
 */

export const IMPORT_ORDER_LIFECYCLE = [
  'IMPORT_REQUESTED', 'QUOTE_ISSUED', 'SELLER_ASSIGNED', 'DOCUMENTS_PENDING', 'DOCUMENTS_VERIFIED',
  'CONTAINER_BOOKED', 'READY_FOR_LOADING', 'LOADED', 'SHIPPED', 'ARRIVED_AT_BORDER', 'CUSTOMS_IN_PROGRESS',
  'DUTY_PENDING', 'DUTY_PAID', 'RELEASED', 'REGISTRATION_PENDING', 'ROADWORTHINESS_PENDING',
  'INSURANCE_PENDING', 'ZIMBABWE_READY', 'LOCAL_LISTING_ENABLED', 'COMPLETED',
] as const
export type ImportOrderState = typeof IMPORT_ORDER_LIFECYCLE[number]

export const IMPORT_ORDER_EXCEPTIONS = ['CANCELLED', 'DISPUTED', 'FLAGGED_FOR_REVIEW'] as const
export type ImportOrderException = typeof IMPORT_ORDER_EXCEPTIONS[number]

export type PhaseKey = 'request' | 'documents' | 'loading' | 'sea' | 'customs' | 'ready' | 'handover'
export type Party = 'you' | 'seller' | 'carup' | 'authority' | 'none'

export interface TradePhase {
  key: PhaseKey
  label: string
  short: string
  states: ImportOrderState[]
}

/** Seven readable phases over the 20 canonical states (order preserved; every state in exactly one phase). */
export const TRADE_PHASES: readonly TradePhase[] = [
  { key: 'request', label: 'Request & quotes', short: 'Quotes', states: ['IMPORT_REQUESTED', 'QUOTE_ISSUED', 'SELLER_ASSIGNED'] },
  { key: 'documents', label: 'Documents', short: 'Documents', states: ['DOCUMENTS_PENDING', 'DOCUMENTS_VERIFIED'] },
  { key: 'loading', label: 'Booking & loading', short: 'Loading', states: ['CONTAINER_BOOKED', 'READY_FOR_LOADING', 'LOADED'] },
  { key: 'sea', label: 'At sea', short: 'At sea', states: ['SHIPPED'] },
  { key: 'customs', label: 'Border & customs', short: 'Customs', states: ['ARRIVED_AT_BORDER', 'CUSTOMS_IN_PROGRESS', 'DUTY_PENDING', 'DUTY_PAID', 'RELEASED'] },
  { key: 'ready', label: 'Zimbabwe ready', short: 'Ready', states: ['REGISTRATION_PENDING', 'ROADWORTHINESS_PENDING', 'INSURANCE_PENDING', 'ZIMBABWE_READY'] },
  { key: 'handover', label: 'Handover', short: 'Handover', states: ['LOCAL_LISTING_ENABLED', 'COMPLETED'] },
]

interface StateGuide { label: string; meaning: string; usuallyWith: Party }

/** What each canonical state means for a person, and which party it usually waits on. */
export const STATE_GUIDE: Record<ImportOrderState | ImportOrderException, StateGuide> = {
  IMPORT_REQUESTED: { label: 'Request received', meaning: 'Your request is recorded. Sellers can now quote.', usuallyWith: 'seller' },
  QUOTE_ISSUED: { label: 'Quote issued', meaning: 'At least one quote has been issued for you to review.', usuallyWith: 'you' },
  SELLER_ASSIGNED: { label: 'Seller assigned', meaning: 'A seller is assigned to this order.', usuallyWith: 'seller' },
  DOCUMENTS_PENDING: { label: 'Documents pending', meaning: 'Required documents are being collected and reviewed.', usuallyWith: 'seller' },
  DOCUMENTS_VERIFIED: { label: 'Documents verified', meaning: 'CarUp recorded the required documents as verified.', usuallyWith: 'carup' },
  CONTAINER_BOOKED: { label: 'Container booked', meaning: 'Space for the vehicle is booked.', usuallyWith: 'carup' },
  READY_FOR_LOADING: { label: 'Ready for loading', meaning: 'The vehicle is ready to be loaded.', usuallyWith: 'seller' },
  LOADED: { label: 'Loaded', meaning: 'Loading was recorded.', usuallyWith: 'carup' },
  SHIPPED: { label: 'Shipped', meaning: 'Departure was recorded.', usuallyWith: 'carup' },
  ARRIVED_AT_BORDER: { label: 'Arrived at the border', meaning: 'Arrival at the border was recorded.', usuallyWith: 'authority' },
  CUSTOMS_IN_PROGRESS: { label: 'Customs in progress', meaning: 'The customs process is under way.', usuallyWith: 'authority' },
  DUTY_PENDING: { label: 'Duty pending', meaning: 'Duty has been assessed and is awaiting payment.', usuallyWith: 'you' },
  DUTY_PAID: { label: 'Duty paid', meaning: 'Duty payment was recorded.', usuallyWith: 'authority' },
  RELEASED: { label: 'Released', meaning: 'Release from customs was recorded.', usuallyWith: 'carup' },
  REGISTRATION_PENDING: { label: 'Registration pending', meaning: 'Local registration is pending.', usuallyWith: 'authority' },
  ROADWORTHINESS_PENDING: { label: 'Roadworthiness pending', meaning: 'A roadworthiness check is pending.', usuallyWith: 'authority' },
  INSURANCE_PENDING: { label: 'Insurance pending', meaning: 'Insurance is pending.', usuallyWith: 'you' },
  ZIMBABWE_READY: { label: 'Zimbabwe ready', meaning: 'The vehicle is recorded as ready for Zimbabwe roads.', usuallyWith: 'carup' },
  LOCAL_LISTING_ENABLED: { label: 'Local listing enabled', meaning: 'Local listing is enabled for this vehicle.', usuallyWith: 'you' },
  COMPLETED: { label: 'Completed', meaning: 'This order is recorded as completed.', usuallyWith: 'none' },
  CANCELLED: { label: 'Cancelled', meaning: 'This order was cancelled.', usuallyWith: 'none' },
  DISPUTED: { label: 'Disputed', meaning: 'A dispute is recorded on this order.', usuallyWith: 'carup' },
  FLAGGED_FOR_REVIEW: { label: 'Flagged for review', meaning: 'CarUp flagged this order for review. Progress is paused until the review is resolved.', usuallyWith: 'carup' },
}

export const PARTY_LABELS: Record<Party, string> = {
  you: 'You', seller: 'The seller', carup: 'CarUp operations', authority: 'The authority', none: 'Nobody',
}

export type PhaseProgress = 'passed' | 'current' | 'upcoming' | 'unknown'

export interface OrderPosition {
  status: string
  known: boolean
  exception: ImportOrderException | null
  phaseIndex: number // -1 when unknown or exception
  stateIndex: number // index in IMPORT_ORDER_LIFECYCLE, -1 when unknown or exception
  phases: Array<{ phase: TradePhase; progress: PhaseProgress; currentState: ImportOrderState | null }>
  guide: StateGuide | null
  terminal: boolean
}

export function isLifecycleState(s: string): s is ImportOrderState {
  return (IMPORT_ORDER_LIFECYCLE as readonly string[]).includes(s)
}
export function isException(s: string): s is ImportOrderException {
  return (IMPORT_ORDER_EXCEPTIONS as readonly string[]).includes(s)
}

/** Where an order stands, from its canonical status only. */
export function positionOf(rawStatus: string | null | undefined): OrderPosition {
  const status = String(rawStatus ?? '').toUpperCase()
  if (isException(status)) {
    return {
      status, known: true, exception: status, phaseIndex: -1, stateIndex: -1,
      phases: TRADE_PHASES.map(phase => ({ phase, progress: 'unknown' as const, currentState: null })),
      guide: STATE_GUIDE[status], terminal: status !== 'FLAGGED_FOR_REVIEW',
    }
  }
  if (!isLifecycleState(status)) {
    return {
      status, known: false, exception: null, phaseIndex: -1, stateIndex: -1,
      phases: TRADE_PHASES.map(phase => ({ phase, progress: 'unknown' as const, currentState: null })),
      guide: null, terminal: false,
    }
  }
  const stateIndex = IMPORT_ORDER_LIFECYCLE.indexOf(status)
  const phaseIndex = TRADE_PHASES.findIndex(p => p.states.includes(status))
  return {
    status, known: true, exception: null, phaseIndex, stateIndex,
    phases: TRADE_PHASES.map((phase, i) => ({
      phase,
      progress: i < phaseIndex ? 'passed' : i === phaseIndex ? (status === 'COMPLETED' ? 'passed' : 'current') : 'upcoming',
      currentState: i === phaseIndex ? status : null,
    })),
    guide: STATE_GUIDE[status],
    terminal: status === 'COMPLETED',
  }
}

/** Human label for any status string (canonical or not). */
export function statusLabel(rawStatus: string | null | undefined): string {
  const s = String(rawStatus ?? '').toUpperCase()
  if (isLifecycleState(s) || isException(s)) return STATE_GUIDE[s].label
  if (!s) return 'Status not recorded'
  return s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase())
}

// ── Documents (canonical DOCUMENT_STATUSES) ──
export type DocTruth = 'missing' | 'uploaded' | 'in_review' | 'verified' | 'rejected' | 'flagged' | 'unknown'
export interface DocState { truth: DocTruth; uploaded: boolean; verified: boolean; label: string }

/** Uploaded is never verified: the two facts are reported separately. */
export function documentState(rawStatus: string | null | undefined): DocState {
  const s = String(rawStatus ?? '').toUpperCase()
  switch (s) {
    case 'MISSING': return { truth: 'missing', uploaded: false, verified: false, label: 'Missing' }
    case 'UPLOADED': return { truth: 'uploaded', uploaded: true, verified: false, label: 'Uploaded · not yet reviewed' }
    case 'OCR_EXTRACTED': return { truth: 'in_review', uploaded: true, verified: false, label: 'Uploaded · fields read automatically, not verified' }
    case 'PENDING_REVIEW': return { truth: 'in_review', uploaded: true, verified: false, label: 'Uploaded · awaiting review' }
    case 'VERIFIED': return { truth: 'verified', uploaded: true, verified: true, label: 'Verified' }
    case 'REJECTED': return { truth: 'rejected', uploaded: true, verified: false, label: 'Uploaded · rejected' }
    case 'FLAGGED': return { truth: 'flagged', uploaded: true, verified: false, label: 'Uploaded · flagged for review' }
    default: return { truth: 'unknown', uploaded: false, verified: false, label: s ? statusLabel(s) : 'Status not recorded' }
  }
}
