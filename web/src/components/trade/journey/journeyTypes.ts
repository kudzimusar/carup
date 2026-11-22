/**
 * RX06-LR04 CAP S1 — the Journey & Arrival response types, taken from T11-CAP-LR01-R3
 * (6af11ac6:web/src/hooks/useTradeLogisticsApi.ts, the T11 tracking and T11-CAP-02 sections) and
 * mirroring backend journeyProjectionService. T9/T10/T4 types are not carried. A section that is
 * `not_yet_composed` is NOT empty: it is not connected to this view yet.
 */
// RX06-LR04 CAP S1 — two types the source imported from files that are not on this line: T12's customs status
// (pages/diaspora/customsDisplay) and the governed-media block (lib/governedMedia). S1 composes neither (customs is
// NOT_YET_COMPOSED('T12'), media is null) and draws neither, so they are opaque here. The slice that carries T12 or
// governed media brings the real types with it.
type MyCustomsStatus = {
  checklist: unknown
  assessment: unknown
  payment: unknown
  release: unknown
  handoffs: unknown
  timeline: unknown[]
}
type GovernedMediaBlock = unknown

// ── T11 — shipment movement & tracking ───────────────────────────────────
// A PLANNED date is an intention; an ETA is an estimate; only the observed dates are records of
// something that happened. `null` means nobody recorded it.

export interface ShipmentDates {
  planned_departure: string | null
  planned_departure_source: string | null
  observed_departure: string | null
  estimated_arrival: string | null
  observed_arrival: string | null
  note: string
}
export interface ShipmentReferences {
  carrier: string | null
  tracking_reference: string | null
  origin_port: string | null
  destination_port: string | null
  container_number: string | null
  seal_number: string | null
  note: string
}
export interface TimelineEvent {
  id: string
  stage: string
  event_time: string | null
  location: string | null
  notes: string | null
  recorded_by: string | null
  recorded_at: string | null
  source: string | null
}
export interface ShipmentOperatorView {
  shipment: { id: string; reference: string; stage: string; import_order_id: string; container_id: string | null }
  dates: ShipmentDates
  references: ShipmentReferences
  load: {
    id: string; reference: string; status: string; completed_at: string | null
    loaded_lines: number; left_behind_lines: number; actual_loaded_volume_cbm: number | null
  } | null
  timeline: TimelineEvent[]
  note: string
}
export interface MyTracking {
  subject: { type: string; id: string }
  state: 'NOT_LOADED' | 'LOADED' | 'SHIPMENT_CREATED' | 'IN_TRANSIT' | 'ARRIVED' | 'EXCEPTION' | 'LEFT_BEHIND'
  sentence: string
  left_behind_reason: string | null
  dates: ShipmentDates | null
  references: ShipmentReferences | null
  timeline: Array<{ stage: string; event_time: string | null; location: string | null }>
  exception?: { stage: string; recorded_at: string | null; note: string } | null
  note: string
}

// ── T11-CAP-02 — Journey & Arrival ───────────────────────────────────────────
// Mirrors journeyProjectionService. A COMPOSITION of records other layers own. A section that is
// `not_yet_composed` is NOT empty-and-complete: it is not connected to this view yet.

export interface JourneyNotComposed { availability: 'not_yet_composed'; owner: string }
export interface JourneyTimelineEntry {
  kind: 'MOVEMENT' | 'LOAD' | string
  stage: string
  event_time: string | null
  location: string | null
  source: string | null
}
export interface JourneyException { code: string; note: string; stage?: string; recorded_at?: string | null }
export interface JourneyAsset {
  make: string | null; model: string | null; year: number | null; color: string | null; mileage: number | null
  source: string
  // Present only for the order's owner and platform admins; absent (not null) for everyone else.
  chassis_number?: string | null
  engine_number?: string | null
  // T11-CAP-LR01-R2. The purchase's own reference number (private access only; null otherwise), the specifications as recorded, and the owner's
  // PRIVATE photographs of the vehicle — present only for someone entitled to THAT VEHICLE, absent (not empty) for everyone else.
  reference?: { value: string } | null
  specifications?: JourneySpecifications
  media?: GovernedMediaBlock
}

// ── T11-CAP-LR01-R2 — the customer's CAP, composed (mirrors journeyCapComposition) ───────────────────────────────
// Every part is withheld — identically to a missing one — from a viewer without private access; a failed read says `unavailable`, never "none".
export type CapWithheld = { availability: 'withheld' | 'unavailable'; note: string }
export interface JourneySpecItem { key: string; label: string; value: string; source: 'vehicle_record' | 'recorded_observation' | 'purchase_record' | string; reported: boolean; unit: string | null }
export type JourneySpecifications =
  | { availability: 'composed'; items: JourneySpecItem[]; equipment: { items: string[]; reported: boolean } | null; partial: boolean; note: string | null; read_note: string | null }
  | CapWithheld
export type CapOrigin = 'external_report' | 'owner_declared' | 'carup'
export interface JourneyParty {
  role: string; role_label: string; kind: string | null; name: string
  address: string | null; city: string | null; country: string | null; phone: string | null; email: string | null
  origin: CapOrigin; source_label: string; as_of: string | null; note: string | null
}
export type JourneyParties = { availability: 'composed'; items: JourneyParty[]; note: string } | CapWithheld
export interface JourneyDispatch {
  document_types: string[]; document_labels: string[]
  status: string; status_label: string; status_reported_text: string | null; message: string | null
  courier: string | null; tracking_number: string | null; dispatched_at: string | null; delivered_at: string | null; observed_at: string | null
  recipient: { role: string; name: string; city: string | null; country: string | null } | null
  origin: CapOrigin; source_label: string
}
export type JourneyDocumentDelivery =
  | {
    availability: 'composed'; items: JourneyDispatch[]; note: string
    contact: { name: string; phone: string | null; email: string | null; city: string | null; country: string | null; note: string } | null
  }
  | CapWithheld
export interface JourneyProgressRow {
  sequence: number
  action_taker: { label: string; kind: string; display_label: string }
  text: string; status: string; status_label: string
  time: { value: string; basis: string | null } | null; time_note: string | null
  origin: CapOrigin; source_label: string; verification: string
}
export interface JourneyProgressGroup {
  code: 'BOOKING' | 'DEPARTURE' | 'BILL_OF_LADING' | 'DISPATCH' | 'CLEARING_DELIVERY' | string
  title: string
  state: 'reported_completed' | 'reported_in_progress' | 'carup_recorded' | 'reported_to_carup' | 'not_recorded' | string
  reported_count: number; carup_count: number; rows: JourneyProgressRow[]
}
export type JourneyProgress =
  | {
    availability: 'composed'; groups: JourneyProgressGroup[]; totals: { reported_rows: number; carup_rows: number }
    sources: Array<{ origin: CapOrigin; source_label: string; observed_at: string | null; row_count: number }>; note: string
  }
  | CapWithheld
export type JourneyPayments =
  | {
    availability: 'composed'
    milestones: Array<{ type: string; amount: number | null; currency: string | null; status: string; due_date: string | null; confirmed_at: string | null }>
    recorded: number; note: string; disclaimer: string
  }
  | CapWithheld
export type JourneyImportantUpdate =
  | { availability: 'composed'; kind: 'exception' | 'document_dispatch' | string; title: string; detail: string | null; as_of: string | null; origin: CapOrigin; source_label?: string }
  | { availability: 'none'; note: string }
export type JourneyPurchasePrice = { availability: 'not_recorded'; note: string }
/** The short-lived view of one document's FILE (step H). Nothing here says where the file lives. */
export interface DocumentAccess {
  document: { id: string; document_type: string; version: number; supplied_at: string | null; review_state: 'verified' | 'rejected' | 'flagged' | 'not_verified' | string; review_note: string }
  view: { href: string; expires_at: string; disposition: 'view' | 'download' }
  note: string
}
export interface JourneyLeg {
  sequence: number
  carrier_name: string | null
  vessel_name: string | null
  voyage_ref: string | null
  imo: string | null
  mmsi: string | null
  port_of_loading: string | null
  port_of_discharge: string | null
  planned_departure: string | null
  estimated_arrival: string | null
  source: string | null
}
// Declared, not observed: nothing in a leg can say a vessel sailed or arrived.
export type JourneyLegs =
  | JourneyNotComposed
  | { availability: 'composed'; items: JourneyLeg[]; note: string }
  | { availability: 'not_applicable' }
  // RX06-LR04 CAP S1 (backend adaptation 5): a failed read is said as unavailable, never as "none declared".
  | { availability: 'unavailable'; note: string }
export interface JourneyEtaRevision {
  estimated_arrival: string | null
  observed_at: string | null
  reason: string | null
  source: string | null
  superseded: boolean
}
// The estimate: the latest accepted revision (`current`) BESIDE the shipment record's own (`original`).
// A revision is an observation shown next to the record, never over it, and never an arrival.
export type JourneyEta =
  | {
    availability: 'composed'
    basis: 'revision' | 'shipment_record' | 'none'
    original: string | null
    current: string | null
    change_days: number | null
    revision_count: number
    last_revised_at: string | null
    revisions: JourneyEtaRevision[]
    note: string
  }
  | { availability: 'not_applicable' }
  | JourneyNotComposed
  // RX06-LR04 CAP S1 (backend adaptation 5): a failed read of the estimate revisions.
  | { availability: 'unavailable'; note: string }
export interface JourneyShipping {
  association: 'order' | 'order_container_mismatch' | 'ambiguous' | 'none' | 'not_applicable' | string
  reference?: string
  candidate_count?: number
  dates: ShipmentDates | null
  references: {
    carrier: string | null; tracking_reference: string | null
    origin_port: string | null; destination_port: string | null; note: string
  } | null
  legs: JourneyLegs
  // Absent from services that predate estimate history.
  eta?: JourneyEta
}
// ── T11-CAP-06 — documents and next steps, composed ──────────────────────────
// Documents are T8's: the states are T8's own, and no document id, user id, storage path or extraction id
// is ever sent. `withheld` (T8 would refuse this viewer) and `unavailable` (T8 could not be read) are
// different things and neither is "there are none".
export interface JourneyDocumentItem {
  document_type: string
  display_name: string
  verification_required: boolean
  state: 'VERIFIED' | 'AWAITING_REVIEW' | 'PRESENT' | 'REJECTED' | 'REQUESTED' | 'MISSING' | 'NOT_APPLICABLE' | string
  note: string
  document: {
    // Forwarded ONLY to a viewer with private access, so the page can offer to open the file; the open route re-checks the rule, so an id grants nothing.
    id?: string
    can_open?: boolean
    version: number | null
    supplied_at: string | null
    reviewed_at: string | null
    has_extraction: boolean
    has_earlier_versions: boolean
  } | null
}
export type JourneyDocuments =
  | {
    availability: 'composed'
    items: JourneyDocumentItem[]
    summary: { total: number; supplied: number; verified: number; awaiting_review: number; rejected: number; requested_outstanding: number }
    disclaimer: string
  }
  | { availability: 'withheld'; note: string }
  | { availability: 'unavailable'; note: string }
  | { availability: 'not_applicable' }
  | JourneyNotComposed
export interface JourneyAction {
  kind: 'YOUR_ACTION' | 'WAITING_ON'
  code: string
  text: string
  waiting_on: string
  link?: { type: string; subject: { type: string; id: string } }
}
export type JourneyActions =
  | { availability: 'composed'; items: JourneyAction[]; note: string }
  | { availability: 'not_applicable' }
  | JourneyNotComposed
// ── T11-CAP-07 — customs and the clearing agent, composed from T12 ───────────
// What is forwarded IS T12's own participant status; the Journey states no customs outcome of its own.
// `withheld` (T12 does not admit this viewer — the same answer whether or not a case exists), `unavailable`
// (T12 could not be read), `not_applicable` (no container booking, or the cargo did not travel),
// `ambiguous` (several bookings) and `disagrees` (the case names a different shipment or order, so none
// of it is shown) each carry their own note. None of them is "there is no customs".
export interface JourneyCustomsComposed {
  availability: 'composed'
  state: string
  reference: string | null
  sentence: string
  checklist: MyCustomsStatus['checklist']
  assessment: MyCustomsStatus['assessment']
  payment: MyCustomsStatus['payment']
  release: MyCustomsStatus['release']
  handoffs: MyCustomsStatus['handoffs']
  timeline: MyCustomsStatus['timeline']
  next_action: string
  note: string
  unknown_note: string
  link: { type: string; subject: { type: string; id: string } }
}
export type JourneyCustoms =
  | JourneyCustomsComposed
  | { availability: 'withheld' | 'unavailable' | 'not_applicable' | 'ambiguous' | 'disagrees'; note?: string }
  | JourneyNotComposed
// The clearing agent, by display name only — never an id or a licence reference.
export type JourneyAgents =
  | { availability: 'composed'; items: Array<{ display_name: string; role: string; note: string | null }>; note: string }
  | { availability: 'withheld' | 'unavailable' | 'not_applicable' | 'ambiguous' | 'disagrees'; note?: string }
  | JourneyNotComposed
// ── T11-CAP-09 — statistics, derived only from recorded observations ────────
// A number comes from an OBSERVED date or it is absent (`value: null`, with the reason in `note`) — never
// zero standing in for "unknown". A route statistic is the SAME organiser's completed sailings only, counts
// sailings rather than shipments, and below the stated minimum says "not enough data" without saying how many.
// It describes journeys already completed; it is not a prediction.
export interface JourneyOwnMetric { value: number | null; ongoing?: boolean; note: string }
export type JourneyLane =
  | {
    availability: 'sufficient'
    minimum_sailings: number
    sailings: number
    transit_days: { median: number; min: number; max: number }
    arrival_vs_estimate_days: { availability: 'sufficient'; median_days: number } | { availability: 'insufficient_data'; note: string }
    note: string
  }
  | { availability: 'insufficient_data'; minimum_sailings: number; note: string }
  | { availability: 'not_applicable'; note: string }
export type JourneyIntelligence =
  | {
    availability: 'composed'
    own: { days_in_transit: JourneyOwnMetric; arrival_vs_first_estimate_days: JourneyOwnMetric }
    lane: JourneyLane
    note: string
  }
  | { availability: 'not_applicable' }
  | JourneyNotComposed
export interface JourneySections {
  documents?: JourneyDocuments
  actions?: JourneyActions
  customs?: JourneyCustoms
  intelligence?: JourneyIntelligence
  document_delivery?: JourneyDocumentDelivery
  progress?: JourneyProgress
  payments?: JourneyPayments | JourneyNotComposed
  [section: string]: JourneyDocuments | JourneyActions | JourneyCustoms | JourneyIntelligence | JourneyDocumentDelivery | JourneyProgress | JourneyPayments | JourneyNotComposed | { availability: string; owner?: string } | undefined
}
export interface Journey {
  subject: { type: string; id: string; order_id: string | null; reservation_id?: string }
  viewer: { kind: 'OWNER' | 'ADMIN' | 'PARTICIPANT' }
  state: string
  sentence: string
  // A vehicle with several import orders: offered, never chosen. Absent otherwise.
  candidates?: Array<{ order_id: string; status: string | null; created_at: string | null }>
  asset: JourneyAsset | null
  transaction: {
    order_id: string; status: string | null
    origin_country: string | null; origin_city: string | null
    destination_country: string | null; destination_city: string | null
    // Never a listing price: a purchase price is shown only where one is recorded, and none is.
    purchase_price?: JourneyPurchasePrice
  } | null
  shipping: JourneyShipping | null
  timeline: JourneyTimelineEntry[]
  exceptions: JourneyException[]
  contacts: {
    consignee: { recorded: boolean; kind: string | null; name: string | null; phone: string | null } | null
    agents: JourneyAgents
    // The parties the paperwork names (declared, not authoritative). Absent from a service that predates them.
    parties?: JourneyParties
  } | null
  // The most meaningful REAL record: a journey exception, else the latest document dispatch, else nothing.
  important_update?: JourneyImportantUpdate
  sections: JourneySections
  provenance: Record<string, { authority: string; note?: string; association?: string }>
  generated_at?: string
  note: string
}

