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

/** Exception wording. A hold is where the goods are; it is never a customs verdict. */
export function exceptionText(code: string, fallback: string): string {
  switch (code) {
    case 'SHIPMENT_EXCEPTION':
      return 'The organiser recorded a problem with this shipment. This says where the goods are held. It is not a customs decision.'
    case 'SHIPMENT_AMBIGUOUS':
      return 'More than one shipment could match this order. No movement is shown until that is resolved.'
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
  if (source === 'operator_declared') return 'Stated by the organiser'
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
  contacts: 'Contacts',
}

export const CONSIGNEE_KIND_UI: Record<string, string> = {
  self: 'The buyer',
  my_company: 'The buyer’s company',
  another_person: 'Another person',
  another_company: 'Another company',
  undecided: 'Not decided yet',
}
