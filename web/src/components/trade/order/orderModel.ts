/**
 * RX-06 — the Import Order model behind the unified Trade views (pure: no React, no network).
 *
 * Everything here only READS what the API returned. It never invents a date, amount, ETA, vessel,
 * duty, clearance or verification:
 *  - the lifecycle position always comes from the shared core (`positionOf`), never re-derived;
 *  - a required document is verified only when its LATEST live submission is verified;
 *  - an unknown or exception status lights no progress and suggests no shipment action;
 *  - an absent value is reported as absent ("not recorded", "not provided"), never guessed.
 *
 * The required-document, next-step, CAP-journey and operator-role rules were lifted UNCHANGED from
 * pages/diaspora/DiasporaTrade.tsx (RX03-P2-R4/R5) so the legacy page and the unified views share one
 * copy. The milestone cap/total rules mirror the shared PaymentMilestonesCard (which mirrors the backend).
 */
import type {
  DiasporaAuditEntry,
  DiasporaCargoReservation,
  DiasporaComplianceReview,
  DiasporaImportOrder,
  DiasporaImportOrderQuoteSummary,
  DiasporaPaymentMilestoneInput,
  DiasporaShipment,
  DiasporaTradeDocument,
} from '@/types'
import { IMPORT_ORDER_LIFECYCLE, positionOf, statusLabel } from '@/components/trade/core/importOrderLifecycle'
import { OFFLINE_TEXT, THROTTLED_TEXT, isNetworkFailure } from '@/components/trade/core/readFailure'

/* ── Reads: loading / ready / failed / denied / unavailable are five different statements ──────── */

export type Read<T> =
  | { state: 'loading' }
  | { state: 'ready'; data: T }
  | { state: 'failed'; message?: string; onRetry?: () => void }
  | { state: 'denied'; message?: string }
  | { state: 'unavailable'; message?: string }

export const READ_LOADING: Read<never> = { state: 'loading' }

export function readReady<T>(data: T): Read<T> {
  return { state: 'ready', data }
}

/** Truncate a server message for inline display (apiClient throws message-only Errors). */
export function truncateMessage(err: unknown, fallback: string): string {
  const message = err instanceof Error && err.message ? err.message : fallback
  return message.length > 200 ? `${message.slice(0, 200)}…` : message
}

/** The HTTP status apiClient attaches to a failed request (undefined for network/other errors). */
export function errorStatus(err: unknown): number | undefined {
  const status = (err as { status?: unknown } | null)?.status
  return typeof status === 'number' ? status : undefined
}

export const SESSION_ENDED_TEXT = 'Your session has ended. Sign in again to continue — nothing new was loaded or changed with the old session.'

/** apiClient raises SessionExpiredError (status 401) when the server rejects the session. */
export function isSessionEnded(err: unknown): boolean {
  return errorStatus(err) === 401 || (err as { name?: unknown } | null)?.name === 'SessionExpiredError'
}

/**
 * Plain words for a failed ACTION. A business refusal (400/409/422) keeps the caller's prefix
 * (e.g. "Blocked: "); a refusal of permission, an ended session and an unconfirmed outcome are each
 * said as what they are. After a 5xx or a network failure the outcome is unknown, so the text never
 * claims that nothing changed — it asks the person to refresh and look.
 */
export function actionFailureText(err: unknown, businessPrefix = '', fallback = 'Action failed'): string {
  const status = errorStatus(err)
  const message = truncateMessage(err, fallback)
  if (isSessionEnded(err)) return 'Your session has ended. Sign in again, then retry.'
  if (status === 403) return `Not permitted: ${message}`
  if (status === 404) return `Not found: ${message}`
  if (status === 400 || status === 409 || status === 422) return `${businessPrefix}${message}`
  if (status !== undefined && status >= 500) return 'CarUp could not confirm this change. Refresh to see the current state before trying again.'
  return 'CarUp could not be reached, so this change was not confirmed. Refresh to see the current state before trying again.'
}

/**
 * Classify a failed read: a refusal (403) and a missing/feature-off resource (404) are their own
 * honest states, never "failed" and never "empty". Anything else is a failure with a retry.
 */
export function readFromError(err: unknown, onRetry?: () => void, fallback = 'This could not be loaded.'): Read<never> {
  const status = errorStatus(err)
  const message = truncateMessage(err, fallback)
  // A session that ended is not a failure to retry: retrying with the same (cleared) session cannot
  // succeed. Protected routes redirect to sign-in with the return path; say what happened meanwhile.
  if (isSessionEnded(err)) return { state: 'failed', message: SESSION_ENDED_TEXT }
  if (status === 403) return { state: 'denied', message }
  if (status === 404) return { state: 'unavailable', message }
  // RX06-LR04: a throttled read is not a refusal, and a read that never reached CarUp is not an outage of the record.
  if (status === 429) return { state: 'failed', message: THROTTLED_TEXT, onRetry }
  if (isNetworkFailure(status, err instanceof Error ? err.message : null)) return { state: 'failed', message: OFFLINE_TEXT, onRetry }
  if (status === undefined && /forbidden|not authori[sz]ed|do not have access/i.test(message)) return { state: 'denied', message }
  return { state: 'failed', message, onRetry }
}

/** Same classification for a status + message pair kept in page state. */
export function readFromFailure(status: number | null | undefined, message: string, onRetry?: () => void): Read<never> {
  // RX06-LR04: an ended session is not retried with the same session (signing in is the way back).
  if (status === 401) return { state: 'failed', message: SESSION_ENDED_TEXT }
  if (status === 403) return { state: 'denied', message }
  if (status === 404) return { state: 'unavailable', message }
  if (status === 429) return { state: 'failed', message: THROTTLED_TEXT, onRetry }
  if (isNetworkFailure(status, message)) return { state: 'failed', message: OFFLINE_TEXT, onRetry }
  return { state: 'failed', message, onRetry }
}

/* ── The order aggregate (GET /diaspora/import-orders/:id embeds these relations) ──────────────── */

export interface TradeQuote extends DiasporaImportOrderQuoteSummary {
  valid_until?: string | null
  inclusions?: unknown
  exclusions?: unknown
}

export interface TradeParticipant {
  id: string
  participant_role?: string | null
  verification_status?: string | null
  user_id?: string | null
  trade_profile_id?: string | null
  created_at?: string | null
}

export interface TradeComplianceReview extends DiasporaComplianceReview {
  notes?: string | null
  reviewed_at?: string | null
  updated_at?: string | null
}

export interface TradeOrder extends DiasporaImportOrder {
  vin?: string | null
  chassis_number?: string | null
  auction_lot_number?: string | null
  linked_vehicle_vin?: string | null
  created_by?: string | null
  updated_by?: string | null
  taxonomy_resolution?: Record<string, string> | null
  diaspora_import_quotes?: TradeQuote[]
  diaspora_import_order_participants?: TradeParticipant[]
  diaspora_cargo_reservations?: DiasporaCargoReservation[]
  diaspora_shipments?: DiasporaShipment[]
  diaspora_compliance_reviews?: TradeComplianceReview[]
}

/* ── Tabs and modes (deep-linkable without new routes) ───────────────────────────────────────────── */

export const ORDER_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'quotes', label: 'Quotes' },
  { key: 'documents', label: 'Documents' },
  { key: 'shipping', label: 'Shipping & CAP' },
  { key: 'customs', label: 'Customs' },
  { key: 'payments', label: 'Payments' },
  { key: 'activity', label: 'Activity' },
] as const

export type OrderTab = typeof ORDER_TABS[number]['key']
export type OrderMode = OrderTab | 'passport'

/** Tabs that live on the order route itself, chosen with ?tab=. */
const QUERY_TABS = new Set<OrderTab>(['quotes', 'customs', 'payments', 'activity'])

export function orderHref(orderId: string, mode: OrderMode = 'overview'): string {
  const base = `/diaspora/imports/${encodeURIComponent(orderId)}`
  if (mode === 'documents') return `${base}/documents`
  if (mode === 'shipping') return `${base}/shipment`
  if (mode === 'passport') return `${base}/passport`
  if (QUERY_TABS.has(mode)) return `${base}?tab=${mode}`
  return base
}

/** The tab chosen on the order route (?tab=); anything else is the overview. */
export function tabFromQuery(value: string | null | undefined): OrderTab {
  const tab = String(value ?? '').toLowerCase() as OrderTab
  return QUERY_TABS.has(tab) ? tab : 'overview'
}

/* ── Presentation helpers (they re-case what the API returned; they never change its meaning) ──── */

export function labelize(value?: string | null): string {
  if (!value) return 'Not set'
  return value
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, char => char.toUpperCase())
}

/** "BILL_OF_LADING" → "Bill of lading" (sentence case). */
export function sentence(value?: string | null, fallback = 'Not recorded'): string {
  if (!value) return fallback
  const s = value.replace(/_/g, ' ').toLowerCase().trim()
  if (!s) return fallback
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Short reference for an id (never the whole id on screen; never an email or phone). */
export function shortRef(id?: string | null): string {
  if (!id) return '—'
  return id.length > 8 ? id.slice(0, 8) : id
}

export function place(city?: string | null, country?: string | null): string | null {
  const text = [city, country].filter(part => part && String(part).trim()).join(', ')
  return text || null
}

/** "USD 9,000" — or null when no amount was recorded (the caller says so). */
export function money(amount?: number | string | null, currency?: string | null): string | null {
  if (amount === undefined || amount === null || amount === '') return null
  const value = Number(amount)
  if (!Number.isFinite(value)) return null
  return `${(currency || 'USD').toUpperCase()} ${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}

function validDate(iso?: string | null): Date | null {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

/** "17 Nov 2026" — or null when the record carries no usable date. */
export function formatDay(iso?: string | null): string | null {
  const date = validDate(iso)
  return date ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null
}

/** "17 Nov 2026, 18:56" — or null. */
export function formatWhen(iso?: string | null): string | null {
  const date = validDate(iso)
  if (!date) return null
  return `${formatDay(iso)}, ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
}

export function timeOf(iso?: string | null): number | null {
  const date = validDate(iso)
  return date ? date.getTime() : null
}

export function yearsLabel(min?: number | null, max?: number | null): string | null {
  if (!min && !max) return null
  if (min && max && min !== max) return `${min}–${max}`
  return String(min || max)
}

/** The order's name from what the buyer asked for. */
export function orderTitle(order: Pick<TradeOrder, 'order_type' | 'requested_make' | 'requested_model'>): string {
  const name = [order.requested_make, order.requested_model].filter(Boolean).join(' ')
  if (order.order_type === 'vehicle') return name || 'Vehicle import'
  const kind = order.order_type === 'parts' ? 'Parts import' : `${labelize(order.order_type)} import`
  return name ? `${kind} · ${name}` : kind
}

export function cargoLabel(type?: string | null): string {
  if (type === 'vehicle') return 'Vehicle'
  if (type === 'parts') return 'Parts'
  if (type === 'mixed') return 'Mixed cargo'
  return type ? sentence(type) : 'Not recorded'
}

/** Identifiers recorded on the order — only the ones present, never placeholders. */
export function orderIdentifiers(order: TradeOrder): Array<{ key: string; label: string; value: string }> {
  const out: Array<{ key: string; label: string; value: string }> = []
  if (order.vin) out.push({ key: 'vin', label: 'VIN', value: order.vin })
  if (order.chassis_number) out.push({ key: 'chassis', label: 'Chassis', value: order.chassis_number })
  if (order.auction_lot_number) out.push({ key: 'lot', label: 'Auction lot', value: order.auction_lot_number })
  if (order.linked_vehicle_vin && order.linked_vehicle_vin !== order.vin) {
    out.push({ key: 'linked', label: 'Linked vehicle VIN', value: order.linked_vehicle_vin })
  }
  return out
}

/** Whether the requested make/model matched CarUp's vehicle catalogue when the order was recorded. */
export function catalogueMatch(order: TradeOrder): 'matched' | 'unmatched' | null {
  const res = order.taxonomy_resolution
  if (!res || typeof res !== 'object') return null
  const states = [res.make, res.model].filter(Boolean)
  if (states.length === 0) return null
  return states.every(s => s === 'canonical') ? 'matched' : 'unmatched'
}

/** "You" for the signed-in account, a short reference for anyone else, never an email or phone. */
export function actorLabel(actorId?: string | null, viewerId?: string | null): string {
  if (!actorId) return 'Not recorded'
  if (viewerId && actorId === viewerId) return 'You'
  return `Account ${shortRef(actorId)}`
}

/* ── Operator roles (display gating only; the backend authorizes every action) ──────────────────── */

export const TRADE_OPERATOR_ROLES = new Set(['admin', 'platform_admin', 'super_admin', 'government', 'government_reviewer', 'reviewer'])

export function isTradeOperator(role?: string | null): boolean {
  return TRADE_OPERATOR_ROLES.has(role || '')
}

/*
 * RX06-LR04 — which operator action this account is OFFERED, per action, mirroring the server's own authority
 * (backend/services/diaspora/diasporaAuthorization.js and the atomic order RPCs). Display only: the backend still
 * authorizes every call. An action the server refuses for a role is never offered to it — a plain platform `admin`
 * is a platform admin, not a platform reviewer. Rights granted per order tenant (tenant admins) or per order (the
 * owner) are not visible to this client, so they are not offered from the operations controls.
 *  - assign a seller, mark Zimbabwe-ready: platform reviewers;
 *  - complete the ownership handoff: platform admins and platform reviewers;
 *  - link the vehicle import record, verify / reject / read documents: platform reviewers (review duties).
 */
export const PLATFORM_REVIEW_ROLES = new Set(['platform_admin', 'super_admin', 'government', 'government_reviewer', 'reviewer'])
export const PLATFORM_ADMIN_ROLES = new Set(['admin', 'platform_admin', 'super_admin'])
export type OrderOperatorAction = 'assignSeller' | 'markZimbabweReady' | 'linkVehicleRecord' | 'completeHandoff' | 'reviewDocuments'

export function mayOfferOperatorAction(action: OrderOperatorAction, role?: string | null): boolean {
  const r = String(role || '').toLowerCase()
  if (PLATFORM_REVIEW_ROLES.has(r)) return true
  return action === 'completeHandoff' && PLATFORM_ADMIN_ROLES.has(r)
}

/* ── Required documents (lifted unchanged from DiasporaTrade.tsx, RX03-P2-R4/R5) ────────────────── */

export const REQUIRED_DOCUMENTS = [
  'Buyer identity document',
  'Invoice or auction sheet',
  'Export certificate',
  'Bill of lading',
  'ZIMRA duty assessment',
]

/**
 * RX03-P2-R4 — which uploaded document types satisfy each required row. Presentation mapping only;
 * RX-06 owns the governed requirement set.
 */
export const REQUIRED_DOCUMENT_TYPES: Record<string, string[]> = {
  'Buyer identity document': ['passport', 'national_id', 'residence_card'],
  'Invoice or auction sheet': ['commercial_invoice', 'auction_sheet'],
  'Export certificate': ['export_certificate'],
  'Bill of lading': ['bill_of_lading'],
  'ZIMRA duty assessment': ['customs_declaration', 'duty_receipt'],
}

/** The state of one required row from the order's real documents (never assumed). */
export type RequiredDocumentState = 'Pending' | 'Uploaded' | 'Verified' | 'Rejected' | 'Flagged' | 'Review needed'

/**
 * RX03-P2-R5 TRADE-01 — per document type the LATEST live submission is authoritative — a later
 * rejection is never hidden by an earlier verification. Same-type submissions that cannot be ordered
 * (no created_at) and disagree are "Review needed", never success. A requirement is Verified only when
 * nothing it depends on is rejected, flagged, ambiguous or still awaiting review.
 */
export function requiredDocumentState(name: string, documents: DiasporaTradeDocument[]): RequiredDocumentState {
  const types = REQUIRED_DOCUMENT_TYPES[name] ?? []
  const live = documents.filter(d => !(d as { deleted_at?: string | null }).deleted_at
    && types.includes(String(d.document_type || '').toLowerCase()))
  if (live.length === 0) return 'Pending'
  const status = (d: DiasporaTradeDocument) => String(d.verification_status || 'UPLOADED').toUpperCase()
  const perType: string[] = []
  for (const type of types) {
    const ofType = live.filter(d => String(d.document_type || '').toLowerCase() === type)
    if (ofType.length === 0) continue
    const distinct = new Set(ofType.map(status))
    if (distinct.size > 1 && ofType.some(d => !d.created_at || Number.isNaN(Date.parse(d.created_at)))) {
      perType.push('AMBIGUOUS')
      continue
    }
    const latest = [...ofType].sort((a, b) => Date.parse(b.created_at || '') - Date.parse(a.created_at || ''))[0]
    perType.push(status(latest))
  }
  if (perType.includes('REJECTED')) return 'Rejected'
  if (perType.includes('FLAGGED')) return 'Flagged'
  if (perType.includes('AMBIGUOUS')) return 'Review needed'
  if (perType.some(st => st === 'MISSING') && !perType.some(st => st !== 'MISSING')) return 'Pending'
  if (perType.some(st => st === 'VERIFIED') && perType.every(st => st === 'VERIFIED' || st === 'MISSING')) return 'Verified'
  return 'Uploaded'
}

/** The latest live submission that satisfies a requirement (for "uploaded when / by whom"). */
export function latestSubmissionFor(name: string, documents: DiasporaTradeDocument[]): DiasporaTradeDocument | null {
  const types = REQUIRED_DOCUMENT_TYPES[name] ?? []
  const live = documents.filter(d => !(d as { deleted_at?: string | null }).deleted_at
    && types.includes(String(d.document_type || '').toLowerCase()))
  if (live.length === 0) return null
  return [...live].sort((a, b) => (timeOf(b.created_at) ?? 0) - (timeOf(a.created_at) ?? 0))[0]
}

export const DOCUMENT_TYPE_OPTIONS = [
  { value: 'passport', label: 'Passport' },
  { value: 'national_id', label: 'National ID' },
  { value: 'residence_card', label: 'Residence Card' },
  { value: 'vehicle_registration', label: 'Vehicle Registration' },
  { value: 'auction_sheet', label: 'Auction Sheet' },
  { value: 'bill_of_lading', label: 'Bill of Lading' },
  { value: 'commercial_invoice', label: 'Commercial Invoice' },
  { value: 'export_certificate', label: 'Export Certificate' },
  { value: 'customs_declaration', label: 'Customs Declaration' },
  { value: 'inspection_certificate', label: 'Inspection Certificate' },
  { value: 'insurance_certificate', label: 'Insurance Certificate' },
  { value: 'duty_receipt', label: 'Duty Receipt' },
  { value: 'packing_list', label: 'Packing List' },
  { value: 'port_release_order', label: 'Port Release Order' },
  { value: 'police_clearance', label: 'Police Clearance' },
  { value: 'mechanical_report', label: 'Mechanical Report' },
]

/** The upload rules the document form enforces before anything is sent. */
export const DOCUMENT_UPLOAD_ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
export const DOCUMENT_UPLOAD_MAX_BYTES = 10 * 1024 * 1024 // 10MB

/** The legacy form's messages for a refused file (null when the file may be uploaded). */
export function documentFileProblem(file: Pick<File, 'type' | 'size'>): string | null {
  if (!DOCUMENT_UPLOAD_ALLOWED_TYPES.includes(file.type)) return 'Invalid file type. Only PDF, JPEG, PNG, and WebP are allowed.'
  if (file.size > DOCUMENT_UPLOAD_MAX_BYTES) return 'File too large. Maximum size is 10MB.'
  return null
}

export function documentTypeLabel(type?: string | null): string {
  const option = DOCUMENT_TYPE_OPTIONS.find(o => o.value === String(type || '').toLowerCase())
  return option ? option.label : sentence(type, 'Document')
}

/* ── Order truth: next step and outcome (lifted unchanged from DiasporaTrade.tsx, RX03-P2-R4/R5) ── */

/** The canonical lifecycle (core) — one list, used for ranks. */
export function orderRank(status?: string | null): number {
  const i = (IMPORT_ORDER_LIFECYCLE as readonly string[]).indexOf(status || '')
  return i < 0 ? -1 : i
}

/** Statuses whose position on the shipment path is not a progress point (backend constants). */
export function statusOutcome(status?: string | null): { title: string; detail: string; timeline: string } | null {
  const st = String(status || '')
  if (st === 'CANCELLED') return { title: 'This import order was cancelled', detail: 'No further documents, booking or shipment steps apply to a cancelled order.', timeline: 'Cancelled — progress is no longer tracked for this order.' }
  if (st === 'DISPUTED') return { title: 'This import order is in dispute', detail: 'CarUp is handling the dispute. No shipment progress is shown while it is open.', timeline: 'In dispute — progress is paused while the dispute is open.' }
  if (st === 'FLAGGED_FOR_REVIEW') return { title: 'This order is on hold for CarUp review', detail: 'A CarUp reviewer is checking this order. Nothing moves forward until the review is recorded.', timeline: 'On hold for review — the current milestone is not shown until the review is recorded.' }
  if (!st || orderRank(st) < 0) return { title: 'Order status unavailable', detail: `CarUp does not recognise this order's current status${st ? ` (“${labelize(st)}”)` : ''}, so no progress or next step is shown.`, timeline: 'Status unavailable — no milestone is shown for an unrecognised status.' }
  return null
}

export type NextStepTarget = 'documents' | 'shipping'
export type NextStep = { title: string; detail: string; cta?: { label: string; to: string; target: NextStepTarget } }

/** The one next step for this order, derived only from its real status and documents. */
export function nextStepFor(order: Pick<TradeOrder, 'id' | 'status' | 'diaspora_trade_documents'>, documentsOverride?: DiasporaTradeDocument[]): NextStep {
  const outcome = statusOutcome(order.status)
  if (outcome) return { title: outcome.title, detail: outcome.detail }
  const documents = documentsOverride ?? order.diaspora_trade_documents ?? []
  const states = REQUIRED_DOCUMENTS.map(name => [name, requiredDocumentState(name, documents)] as const)
  const named = (wanted: RequiredDocumentState[]) => states.filter(([, st]) => wanted.includes(st)).map(([name]) => name.toLowerCase())
  const rejected = named(['Rejected', 'Flagged'])
  const missing = named(['Pending'])
  const ambiguous = named(['Review needed'])
  const awaitingReview = named(['Uploaded'])
  const rank = orderRank(order.status)
  const docsTo = orderHref(order.id, 'documents')
  const shipTo = orderHref(order.id, 'shipping')
  // A rejected or flagged document is consequential: it leads, and missing documents never hide it.
  if (rejected.length > 0) {
    return {
      title: rejected.length === 1 ? 'A required document was rejected' : 'Required documents were rejected',
      detail: `Rejected or flagged: ${rejected.join(', ')}. Upload a replacement for review.${missing.length ? ` Still missing: ${missing.join(', ')}.` : ''}`,
      cta: { label: 'Open documents', to: docsTo, target: 'documents' },
    }
  }
  if (ambiguous.length > 0) {
    return { title: 'CarUp needs to confirm your documents', detail: `The records for ${ambiguous.join(', ')} disagree, so they are not treated as verified. CarUp will confirm which submission stands.`, cta: { label: 'View documents', to: docsTo, target: 'documents' } }
  }
  if (rank >= orderRank('CONTAINER_BOOKED')) {
    return { title: 'Follow your shipment', detail: `${labelize(order.status)}. Shipment milestones are recorded by CarUp as logistics confirm them.`, cta: { label: 'Open shipment', to: shipTo, target: 'shipping' } }
  }
  if (missing.length > 0) {
    return {
      title: 'Add your trade documents',
      detail: `${missing.length} of ${REQUIRED_DOCUMENTS.length} required documents are not uploaded yet: ${missing.join(', ')}.`,
      cta: { label: 'Add documents', to: docsTo, target: 'documents' },
    }
  }
  if (awaitingReview.length > 0) {
    return { title: 'Your documents are with CarUp for review', detail: 'Nothing is verified until a reviewer has checked each original. You will see each result here.', cta: { label: 'View documents', to: docsTo, target: 'documents' } }
  }
  if (states.every(([, st]) => st === 'Verified')) {
    return { title: 'Waiting for a container booking', detail: 'Required documents are verified. CarUp books a container slot next; nothing is scheduled until a booking is recorded.', cta: { label: 'View shipment', to: shipTo, target: 'shipping' } }
  }
  return { title: 'Document status unavailable', detail: 'CarUp could not establish the state of every required document, so none is treated as verified.' }
}

/** Counts behind the required set: uploaded and verified are separate facts. */
export function requiredDocumentTally(documents: DiasporaTradeDocument[]) {
  const states = REQUIRED_DOCUMENTS.map(name => requiredDocumentState(name, documents))
  return {
    total: REQUIRED_DOCUMENTS.length,
    uploaded: states.filter(s => s !== 'Pending').length,
    verified: states.filter(s => s === 'Verified').length,
    rejected: states.filter(s => s === 'Rejected' || s === 'Flagged').length,
    reviewNeeded: states.filter(s => s === 'Review needed').length,
  }
}

/* ── Status tone (unreviewed or pending is never green) ─────────────────────────────────────────── */

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

/** Required-row tone: only a reviewer's verification is green; uploaded is information, not success. */
export const REQUIRED_STATE_TONE: Record<RequiredDocumentState, Tone> = {
  Pending: 'neutral',
  Uploaded: 'info',
  Verified: 'success',
  Rejected: 'danger',
  Flagged: 'warning',
  'Review needed': 'warning',
}

export function orderStatusTone(status?: string | null): Tone {
  const pos = positionOf(status)
  if (pos.exception === 'CANCELLED') return 'neutral'
  if (pos.exception) return 'warning'
  if (!pos.known) return 'neutral'
  if (pos.status === 'COMPLETED') return 'success'
  return 'info'
}

export function recordStatusTone(status?: string | null): Tone {
  const s = String(status || '').toUpperCase()
  if (!s) return 'neutral'
  if (/^(VERIFIED|APPROVED|ACCEPTED|CONFIRMED|COMPLETED|RELEASED)$/.test(s)) return 'success'
  if (/(REJECTED|FAILED|DISPUTED)/.test(s)) return 'danger'
  if (/(FLAGGED|EXCEPTION|HOLD|EXPIRED|MISSING)/.test(s)) return 'warning'
  if (/(CANCELLED|WITHDRAWN)/.test(s)) return 'neutral'
  return 'info'
}

export { statusLabel }

/* ── Shipping & CAP (lifted unchanged from DiasporaTrade.tsx) ──────────────────────────────────── */

export const SHIPMENT_COORDINATION_NOTE =
  'CarUp coordinates shipment facilitation. Final carrier movement, customs clearance, and release depend on verified logistics and regulatory processing.'

/** Shipment stages the backend accepts (mirror of SHIPMENT_STATUSES) for the logistics stage control. */
export const SHIPMENT_STAGES = ['PLANNED', 'BOOKED', 'LOADING', 'IN_TRANSIT', 'ARRIVED', 'CUSTOMS_HOLD', 'RELEASED', 'COMPLETED', 'EXCEPTION']

export const RESERVATION_CARGO_TYPES = [
  { value: 'vehicle', label: 'Vehicle' },
  { value: 'parts', label: 'Parts' },
  { value: 'mixed', label: 'Mixed' },
  { value: 'other', label: 'Other' },
]

export const CAP_JOURNEY_PHASES: { key: string; label: string; minStatus?: string }[] = [
  { key: 'reservation_requested', label: 'Reservation requested' },
  { key: 'reservation_confirmed', label: 'Reservation confirmed' },
  { key: 'container_booked', label: 'Container booked', minStatus: 'CONTAINER_BOOKED' },
  { key: 'loaded', label: 'Loaded', minStatus: 'LOADED' },
  { key: 'shipped', label: 'Shipped', minStatus: 'SHIPPED' },
  { key: 'arrived', label: 'Arrived', minStatus: 'ARRIVED_AT_BORDER' },
  { key: 'customs', label: 'Customs in progress', minStatus: 'CUSTOMS_IN_PROGRESS' },
  { key: 'released', label: 'Released', minStatus: 'RELEASED' },
  { key: 'zimbabwe_ready', label: 'Zimbabwe ready', minStatus: 'ZIMBABWE_READY' },
]

export interface CapJourneyStep { key: string; label: string; reached: boolean; current: boolean; source: 'reservation' | 'status' }

/** Derive the CAP journey ONLY from the real order status and reservation records — never fabricate progress. */
export function buildShipmentTimeline(order: Pick<DiasporaImportOrder, 'status'> | null, reservations: DiasporaCargoReservation[]): CapJourneyStep[] {
  const rank = orderRank(order?.status)
  const hasReservation = reservations.length > 0
  const reservationConfirmed = reservations.some(r => r.reservation_status === 'APPROVED') || rank >= orderRank('CONTAINER_BOOKED')
  const steps = CAP_JOURNEY_PHASES.map(p => {
    let reached: boolean
    if (p.key === 'reservation_requested') reached = hasReservation || rank >= orderRank('CONTAINER_BOOKED')
    else if (p.key === 'reservation_confirmed') reached = reservationConfirmed
    else reached = rank >= orderRank(p.minStatus)
    const source: CapJourneyStep['source'] = p.key.startsWith('reservation') && hasReservation ? 'reservation' : 'status'
    return { key: p.key, label: p.label, reached, source }
  })
  let currentIndex = -1
  steps.forEach((s, i) => { if (s.reached) currentIndex = i })
  return steps.map((s, i) => ({ ...s, current: i === currentIndex }))
}

/** The reservation that still holds space (not rejected or cancelled). */
export function activeReservation(reservations: DiasporaCargoReservation[]): DiasporaCargoReservation | undefined {
  return reservations.find(r => r.reservation_status !== 'REJECTED' && r.reservation_status !== 'CANCELLED')
}

/* ── Payment milestones (mirrors PaymentMilestonesCard, which mirrors the backend cap) ─────────── */

export const MILESTONE_TYPE_OPTIONS = [
  { value: 'DEPOSIT', label: 'Deposit' },
  { value: 'BALANCE_DUE', label: 'Balance due' },
  { value: 'SHIPPING_FEE', label: 'Shipping fee' },
  { value: 'CUSTOMS_DUTY', label: 'Customs duty' },
  { value: 'FINAL_PAYMENT', label: 'Final payment' },
  { value: 'OTHER', label: 'Other' },
]

const ACTIVE_MILESTONE_STATUSES = new Set(['PENDING', 'CONFIRMED'])

export interface MilestoneRow {
  id: string
  milestone_type?: string | null
  amount?: number | string | null
  currency?: string | null
  status?: string | null
  due_date?: string | null
  external_reference?: string | null
  created_at?: string | null
}

export interface MilestoneSummary {
  totals: Array<{ currency: string; total: number }>
  cap: { amount: number; currency: string; source: 'accepted quote' | 'order budget' } | null
  remaining: number | null
}

/** Active (pending/confirmed) totals per currency, and the cap: an ACCEPTED quote, else the budget. */
export function milestoneSummary(milestones: MilestoneRow[], quotes: TradeQuote[] = [], budgetAmount?: number | string | null, budgetCurrency?: string | null): MilestoneSummary {
  const totals = new Map<string, number>()
  for (const m of milestones) {
    if (!ACTIVE_MILESTONE_STATUSES.has(String(m.status || '').toUpperCase())) continue
    const cur = (m.currency || 'USD').toUpperCase()
    const amt = Number(m.amount)
    if (!Number.isFinite(amt)) continue
    totals.set(cur, (totals.get(cur) || 0) + amt)
  }
  const accepted = quotes.find(q => String(q.status || '').toUpperCase() === 'ACCEPTED')
  let cap: MilestoneSummary['cap'] = null
  if (accepted && Number.isFinite(Number(accepted.quote_amount)) && accepted.quote_amount !== null && accepted.quote_amount !== '') {
    cap = { amount: Number(accepted.quote_amount), currency: (accepted.quote_currency || 'USD').toUpperCase(), source: 'accepted quote' }
  } else if (budgetAmount != null && budgetAmount !== '' && Number.isFinite(Number(budgetAmount))) {
    cap = { amount: Number(budgetAmount), currency: (budgetCurrency || 'USD').toUpperCase(), source: 'order budget' }
  }
  const remaining = cap ? cap.amount - (totals.get(cap.currency) || 0) : null
  return { totals: [...totals.entries()].map(([currency, total]) => ({ currency, total })), cap, remaining }
}

/** Per-submit idempotency key: a retried or double-clicked submission cannot create a duplicate record. */
export function newMilestoneKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `pm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export function milestonePayload(input: { milestoneType: string; amount: number; currency: string; reference: string }): DiasporaPaymentMilestoneInput {
  return {
    milestone_type: input.milestoneType,
    amount: input.amount,
    currency: input.currency.trim().toUpperCase() || 'USD',
    external_reference: input.reference.trim() || undefined,
    idempotency_key: newMilestoneKey(),
  }
}

export function formatAmount(value: number, currency: string): string {
  return `${currency} ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/* ── Activity: one chronological feed from the sealed audit trail and the order's own records ───── */

export type ActivityKind = 'order' | 'quote' | 'participant' | 'document' | 'reservation' | 'shipment' | 'review' | 'milestone' | 'vehicle' | 'other'

export interface ActivityEvent {
  id: string
  at: string | null
  title: string
  detail?: string
  actorId: string | null
  /** Server-derived relation to the viewer when the redacted timeline omits actor ids (R2C). */
  actorRelation?: 'you' | 'other' | 'system' | null
  source: 'audit' | 'record'
  sealed: boolean
  kind: ActivityKind
}

/**
 * Who did it, in plain words. A redacted timeline (RX06-BE-01 R2C) carries no actor id, only whether
 * the action was the viewer's own, someone else's, or the system's; never guess an identity.
 */
export function activityActorLabel(event: Pick<ActivityEvent, 'actorId' | 'actorRelation'>, viewerId?: string | null): string {
  if (event.actorId) return actorLabel(event.actorId, viewerId)
  if (event.actorRelation === 'you') return 'You'
  if (event.actorRelation === 'system') return 'CarUp'
  if (event.actorRelation === 'other') return 'Another participant'
  return 'Not recorded'
}

const AUDIT_LABELS: Record<string, [string, ActivityKind]> = {
  IMPORT_ORDER_CREATED: ['Import request recorded', 'order'],
  IMPORT_ORDER_STATUS_CHANGED: ['Order status changed', 'order'],
  SELLER_ASSIGNED: ['Seller assigned', 'participant'],
  QUOTE_ISSUED: ['Quote recorded', 'quote'],
  TRADE_DOCUMENT_UPLOADED: ['Document uploaded', 'document'],
  TRADE_DOCUMENT_OCR_EXTRACTED: ['Fields read automatically from a document (not verified)', 'document'],
  TRADE_DOCUMENT_VERIFIED: ['Document verified by a reviewer', 'document'],
  TRADE_DOCUMENT_REJECTED: ['Document rejected by a reviewer', 'document'],
  CARGO_RESERVATION_CREATED: ['Container space requested', 'reservation'],
  CARGO_RESERVATION_REQUESTED: ['Container space requested', 'reservation'],
  CARGO_RESERVATION_APPROVED: ['Container reservation approved', 'reservation'],
  CARGO_RESERVATION_REJECTED: ['Container reservation rejected', 'reservation'],
  CARGO_RESERVATION_CANCELLED: ['Container reservation cancelled', 'reservation'],
  SHIPMENT_CREATED: ['Shipment record created', 'shipment'],
  SHIPMENT_STAGE_CHANGED: ['Shipment stage recorded', 'shipment'],
  COMPLIANCE_REVIEW_CREATED: ['Compliance review opened', 'review'],
  COMPLIANCE_APPROVED: ['Compliance review approved', 'review'],
  COMPLIANCE_FLAGGED: ['Compliance review flagged', 'review'],
  GOVERNMENT_DOCUMENT_UPSERTED: ['Government record updated', 'review'],
  PAYMENT_MILESTONE_CREATED: ['Payment milestone recorded', 'milestone'],
  VEHICLE_IMPORT_RECORD_LINKED: ['Vehicle import record linked', 'vehicle'],
}

/** Plain words for an audit action; an unknown action is shown as recorded, re-cased. */
export function auditActionLabel(action?: string | null): string {
  const known = AUDIT_LABELS[String(action || '').toUpperCase()]
  return known ? known[0] : sentence(action, 'Recorded action')
}

type AuditRow = DiasporaAuditEntry

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

/** Records the viewer already holds on the order, used to describe a redacted audit entry. */
interface AuditRecordLookup {
  quotes: Map<string, TradeQuote>
  documents: Map<string, DiasporaTradeDocument>
  milestones: Map<string, NonNullable<TradeOrder['diaspora_payment_milestones']>[number]>
}

function auditDetail(entry: AuditRow, records?: AuditRecordLookup): string | undefined {
  const action = String(entry.action || '').toUpperCase()
  const before = entry.previous_state || {}
  const after = entry.new_state || {}
  const ref = entry.resource_id ? String(entry.resource_id) : null
  if (action === 'IMPORT_ORDER_STATUS_CHANGED' || action === 'SHIPMENT_STAGE_CHANGED') {
    // Raw rows (reviewers, older servers) carry the snapshots; the redacted timeline carries
    // status_from/status_to only (R2C). Both describe the same transition.
    const from = str(before.status) ?? str(entry.status_from)
    const to = str(after.status) ?? str(entry.status_to)
    if (from && to) return `${statusLabel(from)} → ${statusLabel(to)}`
    if (to) return `Now: ${statusLabel(to)}`
  }
  if (action.startsWith('TRADE_DOCUMENT')) {
    const type = str(after.document_type) ?? (ref ? str(records?.documents.get(ref)?.document_type) : null)
    if (type) return documentTypeLabel(type)
  }
  if (action === 'PAYMENT_MILESTONE_CREATED') {
    const m = entry.new_state ? null : ref ? records?.milestones.get(ref) : null
    const type = str(after.milestone_type) ?? str(m?.milestone_type)
    const amount = (after.amount as number | string | null | undefined) ?? m?.amount ?? null
    const parts = [type ? sentence(type) : null, money(amount, str(after.currency) ?? str(m?.currency))]
    const text = parts.filter(Boolean).join(' · ')
    return text || undefined
  }
  if (action === 'QUOTE_ISSUED') {
    if (entry.new_state) return money(after.quote_amount as number | string | null, str(after.quote_currency)) ?? undefined
    // Redacted timeline: describe the quote only from the order's own quote record, which the
    // server already returned to this viewer — the timeline never discloses an amount itself.
    const q = ref ? records?.quotes.get(ref) : undefined
    return q ? money(q.quote_amount, q.quote_currency) ?? undefined : undefined
  }
  return undefined
}

/** Audit actions that describe the creation (or review) of a record kept on the order. */
const AUDIT_CREATES: Record<string, string> = {
  IMPORT_ORDER_CREATED: 'order',
  SELLER_ASSIGNED: 'participant',
  QUOTE_ISSUED: 'quote',
  TRADE_DOCUMENT_UPLOADED: 'document-upload',
  TRADE_DOCUMENT_VERIFIED: 'document-review',
  TRADE_DOCUMENT_REJECTED: 'document-review',
  CARGO_RESERVATION_CREATED: 'reservation',
  CARGO_RESERVATION_REQUESTED: 'reservation',
  SHIPMENT_CREATED: 'shipment',
  COMPLIANCE_REVIEW_CREATED: 'review',
  PAYMENT_MILESTONE_CREATED: 'milestone',
}

/**
 * The order's activity, newest first. The sealed audit trail leads; a record-derived event is added
 * only when the audit (if readable) holds no entry for that record, so nothing is counted twice and
 * nothing is invented. Events without a timestamp are kept, last, and say so.
 */
export function buildActivity({ order, audit, documents }: {
  order: TradeOrder
  audit?: DiasporaAuditEntry[] | null
  documents?: DiasporaTradeDocument[] | null
}): ActivityEvent[] {
  const events: ActivityEvent[] = []
  const covered = new Set<string>()
  const records: AuditRecordLookup = {
    quotes: new Map((order.diaspora_import_quotes || []).map(q => [String(q.id), q])),
    documents: new Map((documents ?? order.diaspora_trade_documents ?? []).map(d => [String(d.id), d])),
    milestones: new Map((order.diaspora_payment_milestones || []).map(m => [String(m.id), m])),
  }
  for (const raw of audit || []) {
    const entry = raw as AuditRow
    const action = String(entry.action || '').toUpperCase()
    const kind = AUDIT_LABELS[action]?.[1] ?? 'other'
    if (entry.resource_id && AUDIT_CREATES[action]) covered.add(`${AUDIT_CREATES[action]}:${entry.resource_id}`)
    events.push({
      id: `audit:${entry.id}`,
      at: entry.created_at ?? null,
      title: auditActionLabel(action),
      detail: auditDetail(entry, records),
      actorId: entry.actor_id ?? null,
      actorRelation: entry.actor_relation ?? null,
      source: 'audit',
      sealed: Boolean(entry.cryptographic_seal) || entry.sealed === true,
      kind,
    })
  }
  const auditTimes = (audit || []).map(a => timeOf(a.created_at)).filter((t): t is number => t !== null)
  const add = (key: string, event: Omit<ActivityEvent, 'source' | 'sealed'>) => {
    if (covered.has(key)) return
    events.push({ ...event, source: 'record', sealed: false })
  }

  add(`order:${order.id}`, { id: `order:${order.id}`, at: order.created_at ?? null, title: 'Import request recorded', detail: orderTitle(order), actorId: order.created_by ?? order.buyer_id ?? null, kind: 'order' })
  const created = timeOf(order.created_at)
  const updated = timeOf(order.updated_at)
  if (updated !== null && (created === null || updated - created > 1000) && !auditTimes.some(t => Math.abs(t - updated) <= 5000)) {
    add(`order-updated:${order.id}`, { id: `order-updated:${order.id}`, at: order.updated_at ?? null, title: 'Order record last changed', detail: `Status now: ${statusLabel(order.status)}`, actorId: order.updated_by ?? null, kind: 'order' })
  }
  for (const p of order.diaspora_import_order_participants || []) {
    add(`participant:${p.id}`, { id: `participant:${p.id}`, at: p.created_at ?? null, title: `${sentence(p.participant_role, 'Participant')} added to the order`, actorId: null, kind: 'participant' })
  }
  for (const q of order.diaspora_import_quotes || []) {
    add(`quote:${q.id}`, { id: `quote:${q.id}`, at: q.created_at ?? null, title: 'Quote recorded', detail: [money(q.quote_amount, q.quote_currency), q.status ? sentence(q.status) : null].filter(Boolean).join(' · ') || undefined, actorId: null, kind: 'quote' })
  }
  for (const d of documents ?? order.diaspora_trade_documents ?? []) {
    add(`document-upload:${d.id}`, { id: `document-upload:${d.id}`, at: d.created_at ?? null, title: 'Document uploaded', detail: documentTypeLabel(d.document_type), actorId: d.uploaded_by ?? null, kind: 'document' })
    const status = String(d.verification_status || '').toUpperCase()
    if (d.reviewed_at && (status === 'VERIFIED' || status === 'REJECTED' || status === 'FLAGGED')) {
      add(`document-review:${d.id}`, { id: `document-review:${d.id}`, at: d.reviewed_at, title: status === 'VERIFIED' ? 'Document verified by a reviewer' : status === 'REJECTED' ? 'Document rejected by a reviewer' : 'Document flagged by a reviewer', detail: documentTypeLabel(d.document_type), actorId: d.reviewed_by ?? null, kind: 'document' })
    }
  }
  for (const r of order.diaspora_cargo_reservations || []) {
    add(`reservation:${r.id}`, { id: `reservation:${r.id}`, at: r.created_at ?? null, title: 'Container space requested', detail: `Now: ${sentence(r.reservation_status)}`, actorId: r.buyer_id ?? null, kind: 'reservation' })
  }
  for (const s of order.diaspora_shipments || []) {
    add(`shipment:${s.id}`, { id: `shipment:${s.id}`, at: s.created_at ?? null, title: 'Shipment record created', detail: `Now: ${sentence(s.status)}`, actorId: null, kind: 'shipment' })
  }
  for (const c of order.diaspora_compliance_reviews || []) {
    add(`review:${c.id}`, { id: `review:${c.id}`, at: c.created_at ?? null, title: 'Compliance review opened', detail: [c.review_type ? sentence(c.review_type) : null, `Now: ${sentence(c.status)}`].filter(Boolean).join(' · '), actorId: null, kind: 'review' })
  }
  for (const m of order.diaspora_payment_milestones || []) {
    add(`milestone:${m.id}`, { id: `milestone:${m.id}`, at: m.created_at ?? null, title: 'Payment milestone recorded', detail: [sentence(m.milestone_type), money(m.amount, m.currency), sentence(m.status)].filter(Boolean).join(' · '), actorId: null, kind: 'milestone' })
  }
  return events.sort((a, b) => {
    const ta = timeOf(a.at)
    const tb = timeOf(b.at)
    if (ta === null && tb === null) return 0
    if (ta === null) return 1
    if (tb === null) return -1
    return tb - ta
  })
}

/** The most recent recorded moment on the order (its own record or any embedded record). */
export function lastRecordedAt(order: TradeOrder): string | null {
  const stamps: Array<string | null | undefined> = [order.updated_at, order.created_at]
  for (const list of [order.diaspora_trade_documents, order.diaspora_import_quotes, order.diaspora_cargo_reservations, order.diaspora_shipments, order.diaspora_compliance_reviews, order.diaspora_payment_milestones] as Array<Array<{ created_at?: string | null }> | undefined>) {
    for (const row of list || []) stamps.push(row.created_at)
  }
  let best: { t: number; iso: string } | null = null
  for (const iso of stamps) {
    const t = timeOf(iso)
    if (t !== null && iso && (!best || t > best.t)) best = { t, iso }
  }
  return best?.iso ?? null
}

/** Zimbabwe-ready or later, from the canonical status only. */
export function isZimbabweReadyOrLater(status?: string | null): boolean {
  return orderRank(String(status || '').toUpperCase()) >= orderRank('ZIMBABWE_READY')
}

/** Phase position words for one compact line ("Phase 1 of 7 · Request & quotes"). */
export function phaseLine(status?: string | null): string {
  const pos = positionOf(status)
  if (pos.exception) return `${statusLabel(pos.status)} · not placed on the lifecycle`
  if (!pos.known) return 'Status not recognised · not placed on the lifecycle'
  const phase = pos.phases[pos.phaseIndex]?.phase
  return phase ? `Phase ${pos.phaseIndex + 1} of ${pos.phases.length} · ${phase.label}` : statusLabel(pos.status)
}

/* ── Government records (GET …/government-footprint categories, backend GOVERNMENT_DOCUMENT_CATEGORIES) ── */

const GOVERNMENT_RECORD_LABELS: Record<string, string> = {
  ZIMRA_CLEARANCE: 'ZIMRA clearance',
  CVR_REGISTRATION: 'CVR registration',
  ZINARA_LICENSE: 'ZINARA licence',
  VID_ROADWORTHINESS: 'VID roadworthiness',
  CID_POLICE_CLEARANCE: 'CID police clearance',
  INSURANCE_RECORD: 'Insurance record',
  DUTY_TAX_PROOF: 'Duty and tax proof',
  IMPORT_PORT_RECORD: 'Import port record',
  ODOMETER_VERIFICATION: 'Odometer verification',
  MECHANICAL_VERIFICATION: 'Mechanical verification',
}

export function governmentRecordLabel(category?: string | null): string {
  return GOVERNMENT_RECORD_LABELS[String(category || '').toUpperCase()] ?? sentence(category, 'Government record')
}

/** A government record's status as words: MISSING means "not recorded yet", never a failure. */
export function governmentRecordStatus(status?: string | null): { label: string; tone: Tone } {
  const s = String(status || '').toUpperCase()
  if (!s || s === 'MISSING') return { label: 'Not recorded yet', tone: 'neutral' }
  if (s === 'VERIFIED') return { label: 'Verified', tone: 'success' }
  if (s === 'REJECTED') return { label: 'Rejected', tone: 'danger' }
  if (s === 'FLAGGED') return { label: 'Flagged', tone: 'warning' }
  return { label: sentence(s), tone: 'info' }
}

/** Customs-phase states in canonical order (core lifecycle). */
export const CUSTOMS_STATES = ['ARRIVED_AT_BORDER', 'CUSTOMS_IN_PROGRESS', 'DUTY_PENDING', 'DUTY_PAID', 'RELEASED'] as const

/** The required row a document type counts toward (null: a supporting document, not one of the five). */
export function requirementFor(documentType?: string | null): string | null {
  const type = String(documentType || '').toLowerCase()
  return REQUIRED_DOCUMENTS.find(name => (REQUIRED_DOCUMENT_TYPES[name] ?? []).includes(type)) ?? null
}
