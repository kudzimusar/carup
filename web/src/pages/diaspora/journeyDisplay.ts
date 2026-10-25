/**
 * T11-CAP-03 — how the Journey & Arrival page is allowed to word what it was given.
 *
 * A pure module, like its T9–T12 siblings: a component file may export nothing else, and these
 * sentences are the part of the Journey a customer actually reads.
 *
 * The page sits over a projection that states honestly what it does not yet compose. The wording has
 * one job beyond being readable: an empty section must never read as "nothing to report", an
 * unknown vehicle must never be filled from a request, and every state the backend can produce must
 * have words — a blank badge would be the page quietly saying nothing at all.
 *
 * Departure and arrival wording is T11's (`trackingDisplay`), reused rather than copied, so a planned
 * date, an estimate and an observed event are worded identically on both pages.
 */
import { STAGE_UI } from './trackingDisplay'

export { describeArrival, describeDeparture, REFERENCE_IS_NOT_MOVEMENT, shortRef, when } from './trackingDisplay'

/** The state in the customer's words. Keys mirror the backend's JOURNEY_STATES (a test enforces it). */
export const JOURNEY_STATE_UI: Record<string, { label: string; tone: string }> = {
  NO_TRANSACTION: { label: 'No journey yet', tone: 'border-slate-300 bg-slate-50 text-slate-700' },
  NOT_LOADED: { label: 'Not loaded yet', tone: 'border-slate-300 bg-slate-50 text-slate-700' },
  LEFT_BEHIND: { label: 'Not on this container', tone: 'border-amber-300 bg-amber-50 text-amber-900' },
  LOADED: { label: 'Loaded — not sailed', tone: 'border-slate-300 bg-slate-50 text-slate-800' },
  NO_SHIPMENT: { label: 'No shipment set up yet', tone: 'border-slate-300 bg-slate-50 text-slate-700' },
  SHIPMENT_CREATED: { label: 'Shipment set up — nothing moving yet', tone: 'border-slate-300 bg-slate-50 text-slate-800' },
  IN_TRANSIT: { label: 'On its way', tone: 'border-sky-300 bg-sky-50 text-sky-900' },
  ARRIVED: { label: 'Arrived', tone: 'border-emerald-300 bg-emerald-50 text-emerald-900' },
  EXCEPTION: { label: 'Something has happened', tone: 'border-amber-300 bg-amber-50 text-amber-900' },
  SHIPMENT_AMBIGUOUS: { label: 'Shipment cannot be confirmed', tone: 'border-amber-300 bg-amber-50 text-amber-900' },
}

export const TABS = [
  { id: 'journey', label: 'Journey' },
  { id: 'documents', label: 'Documents' },
  { id: 'vehicle', label: 'Vehicle' },
  { id: 'payments', label: 'Payments' },
  { id: 'customs', label: 'Customs' },
  { id: 'messages', label: 'Messages' },
] as const

export type TabId = typeof TABS[number]['id']

/** Which projection section a tab shows. The Journey and Vehicle tabs are not a single section. */
export function sectionKeyForTab(tab: string): string | null {
  switch (tab) {
    case 'documents': return 'documents'
    case 'payments': return 'payments'
    case 'customs': return 'customs'
    case 'messages': return 'notifications'
    default: return null
  }
}

/**
 * What to say where the projection says `not_yet_composed`.
 *
 * Every message states that the section is not connected to this view, and none says there is
 * nothing in it — absence of a connection is not absence of documents, payments or customs.
 */
export const SECTION_UI: Record<string, { title: string; message: string }> = {
  documents: {
    title: 'Documents',
    message: 'Documents are not shown in this view yet. That does not mean none exist — they are kept in the document workspace.',
  },
  customs: {
    title: 'Customs and destination',
    message: 'Customs and destination status are not shown in this view yet. Customs decisions are recorded separately, and nothing here should be read as clearance.',
  },
  payments: {
    title: 'Payments',
    message: 'Payments are not connected to this view yet. Nothing here is a statement about what has or has not been paid.',
  },
  notifications: {
    title: 'Messages',
    message: 'Messages and updates are not shown in this view yet.',
  },
  actions: {
    title: 'What to do next',
    message: 'Next steps are not listed here yet. An empty list does not mean nothing is needed.',
  },
  legs: {
    title: 'Vessel and route',
    message: 'Vessel and voyage details are not available yet for this shipment.',
  },
  agents: {
    title: 'Destination contacts',
    message: 'Destination agent and clearing contacts are not shown in this view yet.',
  },
}

type AssetLike = { make?: string | null; model?: string | null; year?: number | string | null } | null | undefined

/** The vehicle, from recorded fields only. A request ("I want a Honda") is never passed in here. */
export function vehicleTitle(asset: AssetLike): string {
  if (!asset) return 'Your vehicle'
  const parts = [asset.year, asset.make, asset.model]
    .filter((v) => v !== null && v !== undefined && String(v).trim() !== '')
    .map(String)
  return parts.length ? parts.join(' ') : 'Your vehicle'
}

type Place = { origin_country?: string | null; origin_city?: string | null; destination_country?: string | null; destination_city?: string | null }

const place = (city?: string | null, country?: string | null): string | null => {
  if (city && country) return `${city}, ${country}`
  return city || country || null
}

/**
 * The route, from recorded places. The shipment's own ports win; the order's places are the fallback;
 * otherwise the route is not recorded — never guessed from a corridor or a carrier.
 */
export function routeLabel(journey: {
  shipping?: { references?: { origin_port?: string | null; destination_port?: string | null } | null } | null
  transaction?: Place | null
}): { from: string | null; to: string | null; text: string } {
  const refs = journey.shipping?.references
  let from = refs?.origin_port || null
  let to = refs?.destination_port || null
  if (!from && !to) {
    from = place(journey.transaction?.origin_city, journey.transaction?.origin_country)
    to = place(journey.transaction?.destination_city, journey.transaction?.destination_country)
  }
  if (!from && !to) return { from: null, to: null, text: 'Route not recorded' }
  return { from, to, text: `${from ?? 'Origin not recorded'} → ${to ?? 'Destination not recorded'}` }
}

export interface TimelineLike {
  kind: string
  stage: string
  event_time: string | null
  location: string | null
  source: string | null
}

/** The label for one timeline row. */
export function timelineLabel(entry: { kind: string; stage: string }): string {
  if (entry.kind === 'LOAD') return 'Loaded into the container'
  return STAGE_UI[entry.stage] || entry.stage
}

/** The most recent recorded event, whatever order they arrive in — or the honest absence of one. */
export function lastRecordedUpdate(timeline: TimelineLike[] = []): { label: string; at: string | null } {
  const dated = (timeline || []).filter((e) => e.event_time)
  if (!dated.length) return { label: 'No movement has been recorded', at: null }
  const latest = dated.slice().sort((a, b) => String(b.event_time).localeCompare(String(a.event_time)))[0]
  return { label: timelineLabel(latest), at: latest.event_time }
}

/** How the shipment was matched to this order, said only when it is not the ordinary case. */
export function associationNote(association: string | null | undefined): string | null {
  switch (association) {
    case 'container':
      return 'This is the shipment for the container your cargo is on. It may carry other people’s cargo too; their details are never shown here.'
    case 'order_container_mismatch':
      return 'The records disagree: a shipment is attached to this order, but it sails on a different container than your booking.'
    case 'ambiguous':
      return 'More than one shipment could match this order, so no movement is shown until that is resolved.'
    default:
      return null
  }
}

const dateOnly = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })

/** A date alone, or the honest absence of one. */
export function shortDate(iso: string | null | undefined): string | null {
  return iso ? dateOnly(iso) : null
}

/** A planned departure is a plan. It is never worded as an event. */
export function plannedDeparture(iso: string | null | undefined): string {
  return iso ? `Planned departure ${dateOnly(iso)}` : 'Planned departure not recorded'
}

/** An estimated arrival is an estimate. It is never worded as an event. */
export function estimatedArrival(iso: string | null | undefined): string {
  return iso ? `Estimated arrival ${dateOnly(iso)}` : 'Estimated arrival not recorded'
}

type LegLike = { sequence: number; vessel_name?: string | null; voyage_ref?: string | null; carrier_name?: string | null }

/** A leg\u2019s heading, from what is recorded. A vessel is never invented. */
export function legTitle(leg: LegLike): string {
  const head = `Leg ${leg.sequence}`
  const who = leg.vessel_name || leg.carrier_name || 'vessel not recorded'
  return leg.voyage_ref ? `${head} \u00b7 ${who} \u00b7 voyage ${leg.voyage_ref}` : `${head} \u00b7 ${who}`
}

/** A leg\u2019s route, only from recorded ports. */
export function legRoute(leg: { port_of_loading?: string | null; port_of_discharge?: string | null }): string {
  const from = leg.port_of_loading || null
  const to = leg.port_of_discharge || null
  if (!from && !to) return 'Ports not recorded'
  return `${from ?? 'loading port not recorded'} \u2192 ${to ?? 'discharge port not recorded'}`
}

/** How far the estimate has moved since it was first recorded. Said as an estimate; never as an event. */
export function estimateChange(days: number | null | undefined): string | null {
  if (days === null || days === undefined || !Number.isFinite(days)) return null
  if (days === 0) return 'The latest estimate matches the shipment record.'
  const n = Math.abs(days)
  return `The estimate has moved ${n} ${n === 1 ? 'day' : 'days'} ${days > 0 ? 'later' : 'earlier'} since it was first recorded.`
}

/** One revision\u2019s heading. An estimate, worded as one. */
export function revisionTitle(rev: { estimated_arrival: string | null }): string {
  return estimatedArrival(rev.estimated_arrival)
}

/** Why an estimate moved — only if somebody recorded why. */
export function revisionReason(reason: string | null | undefined): string {
  return isNonBlank(reason) ? `Reason given: ${String(reason).trim()}` : 'No reason was recorded.'
}

const isNonBlank = (v: string | null | undefined): boolean => v !== null && v !== undefined && String(v).trim() !== ''

/** Exception wording. A hold is where the goods are; it is never a customs verdict. */
export function exceptionText(code: string, fallback: string): string {
  switch (code) {
    case 'SHIPMENT_EXCEPTION':
      return 'The organiser recorded a problem with this shipment. This says where the goods are held. It is not a customs decision.'
    case 'SHIPMENT_AMBIGUOUS':
      return 'More than one shipment could match this order. No movement is shown until that is resolved.'
    case 'LEG_PORT_MISMATCH':
      return 'The vessel details name different ports than the shipment record. The records disagree.'
    case 'ORDER_CONTAINER_MISMATCH':
      return 'A shipment is attached to this order but sails on a different container than this booking. The records disagree.'
    default:
      return fallback
  }
}

/** Where a timeline row came from, in words. An unstated source is said to be unstated. */
export function sourceLabel(source: string | null | undefined): string {
  if (!source) return 'Source not stated'
  if (source === 'T10') return 'Recorded at loading'
  if (source === 'operator_declared' || source === 'OPERATOR_DECLARED') return 'Stated by the organiser'
  return `Source: ${source}`
}

const AUTHORITY_UI: Record<string, string> = {
  T4: 'Import order',
  T11: 'Shipment record',
  vehicles: 'Vehicle record',
  unknown: 'No linked record',
  'T11 + T10': 'Shipment timeline and loading record',
  'T11 + T10 (derived, read-only)': 'Shipment and loading records',
  'intake (T3)': 'Details given when ordering',
  'declared legs': 'Vessel details declared by the organiser',
  'estimate revisions': 'Estimates recorded by the organiser',
  T8: 'Document workspace',
}

/** The owning record, for people. Unknown authorities get a neutral label, never an internal code. */
export function authorityLabel(authority: string | null | undefined): string {
  return (authority && AUTHORITY_UI[authority]) || 'A recorded source'
}

export const PROVENANCE_PART_UI: Record<string, string> = {
  asset: 'Vehicle',
  transaction: 'Order',
  journey: 'Journey state',
  shipping: 'Movement',
  timeline: 'Timeline',
  legs: 'Vessel and route',
  eta: 'Estimate history',
  documents: 'Documents',
  contacts: 'Contacts',
}

// ── CAP-06: documents and next steps ─────────────────────────────────────────────────────────────────

const NEUTRAL_TONE = 'border-slate-300 bg-slate-50 text-slate-700'

/**
 * T8's own words for a document's state. T8's page exports no wording, so these are mirrored from it
 * and a test pins them to T8's source: a document must read the same on the Journey and in the
 * workspace. A state this page does not know is said to be unknown — it is never defaulted to "Not
 * supplied", which would claim something the record did not say.
 */
export const DOCUMENT_STATE_UI: Record<string, { label: string; tone: string }> = {
  VERIFIED: { label: 'Verified', tone: 'border-emerald-300 bg-emerald-50 text-emerald-900' },
  AWAITING_REVIEW: { label: 'Supplied — awaiting review', tone: 'border-amber-300 bg-amber-50 text-amber-900' },
  PRESENT: { label: 'Supplied', tone: 'border-slate-300 bg-slate-50 text-slate-800' },
  REJECTED: { label: 'Rejected', tone: 'border-red-300 bg-red-50 text-red-900' },
  REQUESTED: { label: 'Requested', tone: 'border-orange-300 bg-orange-50 text-orange-900' },
  MISSING: { label: 'Not supplied', tone: 'border-slate-200 bg-white text-slate-600' },
  NOT_APPLICABLE: { label: 'Does not apply', tone: 'border-slate-200 bg-white text-slate-500' },
}

export function documentState(state: string | null | undefined): { label: string; tone: string } {
  return (state && DOCUMENT_STATE_UI[state]) || { label: 'Status not recognised', tone: NEUTRAL_TONE }
}

type DocumentProvenanceLike = {
  version?: number | null
  supplied_at?: string | null
  reviewed_at?: string | null
  has_earlier_versions?: boolean
} | null | undefined

/** When a document was supplied and whether anyone reviewed it — never who. Nothing recorded, nothing said. */
export function documentProvenance(doc: DocumentProvenanceLike): string | null {
  if (!doc) return null
  const parts = [
    typeof doc.version === 'number' ? `Version ${doc.version}` : null,
    doc.has_earlier_versions ? 'earlier versions kept' : null,
    doc.supplied_at ? `Supplied ${dateOnly(doc.supplied_at)}` : null,
    doc.reviewed_at ? `Reviewed ${dateOnly(doc.reviewed_at)}` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(' \u00b7 ') : null
}

type DocumentSummaryLike = { total: number; supplied: number; verified: number; awaiting_review: number; rejected: number; requested_outstanding: number }

/** The counts in a line. Only counts that are above zero are said, so a quiet shipment is not a noisy one. */
export function documentsSummaryLine(summary: DocumentSummaryLike | null | undefined): string | null {
  if (!summary || !Number.isFinite(summary.total)) return null
  const parts = [`${summary.supplied} of ${summary.total} supplied`]
  if (summary.verified > 0) parts.push(`${summary.verified} verified`)
  if (summary.awaiting_review > 0) parts.push(`${summary.awaiting_review} awaiting review`)
  if (summary.rejected > 0) parts.push(`${summary.rejected} rejected`)
  if (summary.requested_outstanding > 0) parts.push(`${summary.requested_outstanding} requested`)
  return parts.join(' \u00b7 ')
}

/** Withheld is a refusal; unavailable is a failure to read. Neither is "there are no documents". */
export const DOCUMENTS_WITHHELD_FALLBACK = 'The documents for this order are not available to you here.'
export const DOCUMENTS_UNAVAILABLE_FALLBACK = 'The documents could not be read right now. That does not mean there are none.'
export const DOCUMENTS_NOT_APPLICABLE = 'Documents belong to an import order, and this booking does not have one yet.'

/** Nothing recorded as waiting. The service adds why that is not an all-clear. */
export const NO_STEPS_RECORDED = 'Nothing is recorded as waiting on anyone right now.'

type ActionLike = { kind?: string; waiting_on?: string | null }

/** Whose move it is. A step for someone else is worded as waiting on them, never as the viewer\u2019s. */
export function actionBadge(action: ActionLike): string {
  if (action.kind === 'YOUR_ACTION') return 'Your action'
  const who = action.waiting_on && action.waiting_on.trim() ? action.waiting_on.trim() : 'someone'
  return action.kind === 'WAITING_ON' ? `Waiting on ${who}` : 'Next step'
}

/**
 * Where a step\u2019s link goes. Only a link the page understands is followed, built from the subject the
 * service named — never an address the data supplied.
 */
export function documentWorkspacePath(link: { type?: string; subject?: { type?: string; id?: string } } | null | undefined): string | null {
  if (!link || link.type !== 'document_workspace') return null
  const subject = link.subject
  if (!subject || subject.type !== 'import_order' || !subject.id || !String(subject.id).trim()) return null
  return `/diaspora/documents/import_order/${encodeURIComponent(String(subject.id))}`
}

export const CONSIGNEE_KIND_UI: Record<string, string> = {
  self: 'The buyer',
  my_company: 'The buyer’s company',
  another_person: 'Another person',
  another_company: 'Another company',
  undecided: 'Not decided yet',
}
