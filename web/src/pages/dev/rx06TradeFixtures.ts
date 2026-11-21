/**
 * RX-06 — DEV-ONLY FIXTURES for the Trade fixture tour (pages/dev/Rx06TradeNorthStar.tsx).
 *
 * Imported only by that DEV page; App.tsx creates its route only when import.meta.env.DEV, and
 * scripts/assert-no-dev-pages.mjs proves no chunk named after this module (or the page) ships.
 *
 * EVERY VALUE HERE IS INVENTED FOR THE TOUR. None of it is an order, shipment, document, payment,
 * person or vehicle. VINs, chassis numbers, lots, references and carriers all carry "FIXTURE" so a
 * screenshot can never be mistaken for a record. Every status is one the real schema allows
 * (database/migrations/013_diaspora_trade_schema.sql + backend constants/diaspora/diasporaStatuses.js).
 *
 * One fictional importer account holds ten import orders: one in each of the seven phases of the
 * canonical lifecycle, plus the three exception states. Each order is rendered by the REAL pure
 * Import Order views (components/trade/order), with no actions, so the tour can never write.
 */
import type {
  DiasporaAuditEntry,
  DiasporaCargoReservation,
  DiasporaContainerShipment,
  DiasporaGovernmentDocument,
  DiasporaOwnershipHandoffStatus,
  DiasporaPaymentMilestone,
  DiasporaShipment,
  DiasporaShipmentStageEvent,
  DiasporaTradeDocument,
} from '@/types'
import type { TradeComplianceReview, TradeOrder, TradeQuote } from '@/components/trade/order/orderModel'

export const FX_BUYER = 'fxbuyer1-0000-4000-8000-000000000001'
export const FX_SELLER = 'fxseller-0000-4000-8000-000000000002'
export const FX_OPERATOR = 'fxoperat-0000-4000-8000-000000000003'

/** A fixed clock for the tour: day 0 is 1 August 2026 (fixtures never read the real clock). */
function day(n: number, hour = 9): string {
  const t = Date.UTC(2026, 7, 1, hour, 0, 0) + n * 86_400_000
  return new Date(t).toISOString()
}

export interface FixtureOrder {
  /** Phase key (request … handover) or exception key (flagged, disputed, cancelled). */
  key: string
  /** Picker label. */
  label: string
  /** What this snapshot demonstrates, in one line (shown beside the picker). */
  shows: string
  order: TradeOrder
  audit: DiasporaAuditEntry[]
  footprint: DiasporaGovernmentDocument[]
  handoff: DiasporaOwnershipHandoffStatus
  stageEvents: Record<string, DiasporaShipmentStageEvent[]>
}

/* ── small builders ──────────────────────────────────────────────────────────────────────────────── */

let seq = 0
const nextId = (prefix: string) => `${prefix}-${String(++seq).padStart(4, '0')}`

function doc(orderId: string, type: string, status: string, d: number, extra: Partial<DiasporaTradeDocument> = {}): DiasporaTradeDocument {
  const reviewed = status === 'VERIFIED' || status === 'REJECTED' || status === 'FLAGGED'
  return {
    id: nextId('fxdoc'),
    import_order_id: orderId,
    document_type: type,
    verification_status: status,
    uploaded_by: FX_BUYER,
    reviewed_by: reviewed ? FX_OPERATOR : null,
    reviewed_at: reviewed ? day(d + 1, 14) : null,
    file_name: `FIXTURE-${type.replace(/_/g, '-')}.pdf`,
    created_at: day(d),
    ...extra,
  }
}

function quote(status: string, amount: number, d: number, extra: Partial<TradeQuote> = {}): TradeQuote {
  return {
    id: nextId('fxquote'),
    seller_id: FX_SELLER,
    status,
    quote_amount: amount,
    quote_currency: 'USD',
    created_at: day(d),
    valid_until: day(d + 14),
    ...extra,
  }
}

function milestone(orderId: string, type: string, amount: number, status: string, d: number): DiasporaPaymentMilestone {
  return {
    id: nextId('fxms'),
    import_order_id: orderId,
    milestone_type: type,
    amount,
    currency: 'USD',
    status,
    external_reference: `FIXTURE-REF-${type.slice(0, 3)}-${String(seq).padStart(3, '0')}`,
    created_at: day(d),
  }
}

function audit(orderId: string, action: string, d: number, change: { from?: string; to?: string; after?: Record<string, unknown> } = {}, actor = FX_OPERATOR): DiasporaAuditEntry {
  const row: DiasporaAuditEntry & { previous_state?: Record<string, unknown>; new_state?: Record<string, unknown> } = {
    id: nextId('fxaudit'),
    import_order_id: orderId,
    action,
    actor_id: actor,
    resource_type: 'import_order',
    resource_id: orderId,
    created_at: day(d, 10),
    cryptographic_seal: `FIXTURE-SEAL-${String(seq).padStart(6, '0')}`,
  }
  if (change.from) row.previous_state = { status: change.from }
  if (change.to || change.after) row.new_state = { ...(change.to ? { status: change.to } : {}), ...(change.after ?? {}) }
  return row
}

/** The status walk an order took, as sealed status-change entries (from → to), one day apart. */
function walk(orderId: string, statuses: string[], startDay: number): DiasporaAuditEntry[] {
  return statuses.slice(1).map((to, i) => audit(orderId, 'IMPORT_ORDER_STATUS_CHANGED', startDay + i * 2, { from: statuses[i], to }))
}

function reservation(orderId: string, status: string, d: number, containerId = 'fxcont01-0000-4000-8000-0000000000c1'): DiasporaCargoReservation {
  return { id: nextId('fxres'), container_id: containerId, import_order_id: orderId, buyer_id: FX_BUYER, cargo_type: 'vehicle', estimated_volume: 14.5, reservation_status: status, created_at: day(d) }
}

function shipment(orderId: string, status: string, d: number, extra: Partial<DiasporaShipment> = {}): DiasporaShipment {
  return {
    id: nextId('fxship'),
    import_order_id: orderId,
    container_id: 'fxcont01-0000-4000-8000-0000000000c1',
    carrier_name: 'FIXTURE Ocean Line (not a carrier)',
    tracking_number: `FIXTURE-TRK-${String(seq).padStart(5, '0')}`,
    origin_port: null,
    destination_port: 'Durban (fixture)',
    departure_date: null,
    estimated_arrival_date: null,
    actual_arrival_date: null,
    status,
    created_at: day(d),
    ...extra,
  }
}

function stages(shipmentId: string, list: Array<[string, number, string?]>): DiasporaShipmentStageEvent[] {
  return list.map(([stage, d, notes]) => ({ id: nextId('fxstage'), shipment_id: shipmentId, stage, notes: notes ?? null, created_at: day(d, 11), created_by: FX_OPERATOR }))
}

function footprint(rows: Array<[string, string, boolean?]>): DiasporaGovernmentDocument[] {
  return rows.map(([category, status, required]) => ({
    category,
    status,
    requiredForZimbabweReady: required ?? true,
    documentId: status === 'MISSING' ? null : nextId('fxgov'),
    verifiedAt: status === 'VERIFIED' ? day(90) : null,
  }))
}

const ALL_GOV = ['ZIMRA_CLEARANCE', 'CVR_REGISTRATION', 'ZINARA_LICENSE', 'VID_ROADWORTHINESS', 'CID_POLICE_CLEARANCE', 'INSURANCE_RECORD', 'DUTY_TAX_PROOF', 'IMPORT_PORT_RECORD', 'ODOMETER_VERIFICATION', 'MECHANICAL_VERIFICATION']
const govAll = (status: string) => footprint(ALL_GOV.map(c => [c, status, !['ODOMETER_VERIFICATION', 'MECHANICAL_VERIFICATION'].includes(c)]))

function base(id: string, status: string, v: Partial<TradeOrder>): TradeOrder {
  return {
    id,
    buyer_id: FX_BUYER,
    order_type: 'vehicle',
    origin_country: 'Japan',
    destination_country: 'Zimbabwe',
    status,
    created_at: day(0),
    updated_at: day(0),
    created_by: FX_BUYER,
    diaspora_import_order_participants: [],
    diaspora_trade_documents: [],
    diaspora_payment_milestones: [],
    diaspora_import_quotes: [],
    diaspora_cargo_reservations: [],
    diaspora_shipments: [],
    diaspora_compliance_reviews: [],
    ...v,
  }
}

const sellerParticipant = (d: number) => ({ id: nextId('fxpart'), participant_role: 'seller', verification_status: 'VERIFIED', user_id: FX_SELLER, created_at: day(d) })
const review = (orderId: string, status: string, type: string, d: number, notes?: string): TradeComplianceReview => ({ id: nextId('fxrev'), import_order_id: orderId, status, review_type: type, created_at: day(d), reviewed_at: status === 'PENDING_REVIEW' ? null : day(d + 1), notes: notes ?? null })

const PRE = ['IMPORT_REQUESTED', 'QUOTE_ISSUED', 'SELLER_ASSIGNED', 'DOCUMENTS_PENDING', 'DOCUMENTS_VERIFIED', 'CONTAINER_BOOKED', 'READY_FOR_LOADING', 'LOADED', 'SHIPPED', 'ARRIVED_AT_BORDER', 'CUSTOMS_IN_PROGRESS', 'DUTY_PENDING', 'DUTY_PAID', 'RELEASED', 'REGISTRATION_PENDING', 'ROADWORTHINESS_PENDING', 'INSURANCE_PENDING', 'ZIMBABWE_READY', 'LOCAL_LISTING_ENABLED', 'COMPLETED']
const upTo = (status: string) => PRE.slice(0, PRE.indexOf(status) + 1)

/** The five required documents, all verified (later phases). */
function verifiedSet(orderId: string, d: number, duty: string = 'VERIFIED'): DiasporaTradeDocument[] {
  return [
    doc(orderId, 'passport', 'VERIFIED', d),
    doc(orderId, 'auction_sheet', 'VERIFIED', d + 1),
    doc(orderId, 'export_certificate', 'VERIFIED', d + 2),
    doc(orderId, 'bill_of_lading', 'VERIFIED', d + 10),
    ...(duty === 'MISSING' ? [] : [doc(orderId, 'customs_declaration', duty, d + 30)]),
  ]
}

/* ── the ten orders ──────────────────────────────────────────────────────────────────────────────── */

function requestPhase(): FixtureOrder {
  const id = 'fx01requ-0000-4000-8000-0000000000a1'
  const order = base(id, 'QUOTE_ISSUED', {
    requested_make: 'Toyota', requested_model: 'Hilux', requested_year_min: 2019, requested_year_max: 2021,
    origin_city: 'Yokohama', destination_city: 'Harare', budget_amount: 24000, budget_currency: 'USD',
    updated_at: day(2),
    diaspora_import_quotes: [quote('ISSUED', 22850, 2, { inclusions: ['FOB price', 'Export inspection'], exclusions: ['Ocean freight', 'Zimbabwe duty'] })],
    taxonomy_resolution: { make: 'canonical', model: 'canonical' },
  })
  return {
    key: 'request', label: 'Request & quotes', shows: 'A request with one quote waiting for you; no seller, documents or money yet.',
    order,
    audit: [audit(id, 'IMPORT_ORDER_CREATED', 0, { to: 'IMPORT_REQUESTED' }, FX_BUYER), audit(id, 'QUOTE_ISSUED', 2, { after: { quote_amount: 22850, quote_currency: 'USD' } }, FX_SELLER), ...walk(id, ['IMPORT_REQUESTED', 'QUOTE_ISSUED'], 2)],
    footprint: govAll('MISSING'), handoff: { handedOff: false }, stageEvents: {},
  }
}

function documentsPhase(): FixtureOrder {
  const id = 'fx02docs-0000-4000-8000-0000000000a2'
  const docs = [
    doc(id, 'passport', 'VERIFIED', 6),
    doc(id, 'auction_sheet', 'REJECTED', 6, { metadata: { rejection_reason: 'FIXTURE: page 2 unreadable' } }),
    doc(id, 'auction_sheet', 'UPLOADED', 8),
    doc(id, 'export_certificate', 'OCR_EXTRACTED', 9),
    doc(id, 'inspection_certificate', 'UPLOADED', 9),
  ]
  const order = base(id, 'DOCUMENTS_PENDING', {
    requested_make: 'Toyota', requested_model: 'Land Cruiser Prado', requested_year_min: 2017, requested_year_max: 2019,
    origin_city: 'Kobe', destination_city: 'Bulawayo', budget_amount: 31000, budget_currency: 'USD',
    chassis_number: 'FIXTURE-CH-0002', auction_lot_number: 'FIXTURE-LOT-0002', updated_at: day(9),
    diaspora_import_quotes: [quote('ACCEPTED', 29400, 2), quote('REJECTED', 30900, 3)],
    diaspora_import_order_participants: [sellerParticipant(4)],
    diaspora_trade_documents: docs,
    diaspora_payment_milestones: [milestone(id, 'DEPOSIT', 5000, 'CONFIRMED', 5)],
  })
  return {
    key: 'documents', label: 'Documents', shows: 'Uploaded is not verified: one verified, one re-uploaded after a rejection, one read automatically (not verified), two missing.',
    order,
    audit: [
      audit(id, 'IMPORT_ORDER_CREATED', 0, { to: 'IMPORT_REQUESTED' }, FX_BUYER),
      audit(id, 'QUOTE_ISSUED', 2, { after: { quote_amount: 29400, quote_currency: 'USD' } }, FX_SELLER),
      audit(id, 'SELLER_ASSIGNED', 4),
      ...walk(id, upTo('DOCUMENTS_PENDING'), 2),
      audit(id, 'PAYMENT_MILESTONE_CREATED', 5, { after: { milestone_type: 'DEPOSIT', amount: 5000, currency: 'USD' } }, FX_BUYER),
      audit(id, 'TRADE_DOCUMENT_UPLOADED', 6, { after: { document_type: 'passport' } }, FX_BUYER),
      audit(id, 'TRADE_DOCUMENT_VERIFIED', 7, { after: { document_type: 'passport' } }),
      audit(id, 'TRADE_DOCUMENT_REJECTED', 7, { after: { document_type: 'auction_sheet' } }),
      audit(id, 'TRADE_DOCUMENT_UPLOADED', 8, { after: { document_type: 'auction_sheet' } }, FX_BUYER),
      audit(id, 'TRADE_DOCUMENT_OCR_EXTRACTED', 9, { after: { document_type: 'export_certificate' } }),
    ],
    footprint: govAll('MISSING'), handoff: { handedOff: false }, stageEvents: {},
  }
}

function loadingPhase(): FixtureOrder {
  const id = 'fx03load-0000-4000-8000-0000000000a3'
  const ship = shipment(id, 'BOOKED', 24, { origin_port: 'Nagoya (fixture)' })
  const order = base(id, 'CONTAINER_BOOKED', {
    requested_make: 'Honda', requested_model: 'Fit Hybrid', requested_year_min: 2018, requested_year_max: 2019,
    origin_city: 'Nagoya', destination_city: 'Harare', budget_amount: 9800, budget_currency: 'USD',
    vin: 'FIXTUREVIN0000003', updated_at: day(24),
    diaspora_import_quotes: [quote('ACCEPTED', 9350, 2)],
    diaspora_import_order_participants: [sellerParticipant(4)],
    diaspora_trade_documents: [doc(id, 'passport', 'VERIFIED', 6), doc(id, 'commercial_invoice', 'VERIFIED', 7), doc(id, 'export_certificate', 'VERIFIED', 8), doc(id, 'bill_of_lading', 'UPLOADED', 23)],
    diaspora_payment_milestones: [milestone(id, 'DEPOSIT', 2000, 'CONFIRMED', 5), milestone(id, 'SHIPPING_FEE', 1450, 'PENDING', 22)],
    diaspora_cargo_reservations: [reservation(id, 'APPROVED', 20)],
    diaspora_shipments: [ship],
  })
  return {
    key: 'loading', label: 'Booking & loading', shows: 'Container space approved and a booking recorded — but no departure date or ETA has been recorded, so none is shown.',
    order,
    audit: [audit(id, 'IMPORT_ORDER_CREATED', 0, { to: 'IMPORT_REQUESTED' }, FX_BUYER), ...walk(id, upTo('CONTAINER_BOOKED'), 2), audit(id, 'CARGO_RESERVATION_REQUESTED', 20, {}, FX_BUYER), audit(id, 'CARGO_RESERVATION_APPROVED', 21), audit(id, 'SHIPMENT_CREATED', 24)],
    footprint: govAll('MISSING'), handoff: { handedOff: false },
    stageEvents: { [ship.id]: stages(ship.id, [['PLANNED', 22], ['BOOKED', 24, 'FIXTURE: slot confirmed by logistics']]) },
  }
}

function seaPhase(): FixtureOrder {
  const id = 'fx04sea0-0000-4000-8000-0000000000a4'
  const ship = shipment(id, 'IN_TRANSIT', 30, { origin_port: 'Southampton (fixture)', departure_date: day(40), estimated_arrival_date: day(68) })
  const order = base(id, 'SHIPPED', {
    requested_make: 'Mazda', requested_model: 'CX-5', requested_year_min: 2017, requested_year_max: 2018,
    origin_country: 'United Kingdom', origin_city: 'Southampton', destination_city: 'Harare', budget_amount: 14500, budget_currency: 'USD',
    vin: 'FIXTUREVIN0000004', updated_at: day(41),
    diaspora_import_quotes: [quote('ACCEPTED', 13100, 2)],
    diaspora_import_order_participants: [sellerParticipant(4)],
    diaspora_trade_documents: verifiedSet(id, 6, 'MISSING'),
    diaspora_payment_milestones: [milestone(id, 'DEPOSIT', 3000, 'CONFIRMED', 5), milestone(id, 'SHIPPING_FEE', 1900, 'CONFIRMED', 30), milestone(id, 'BALANCE_DUE', 8200, 'PENDING', 41)],
    diaspora_cargo_reservations: [reservation(id, 'APPROVED', 25)],
    diaspora_shipments: [ship],
  })
  return {
    key: 'sea', label: 'At sea', shows: 'Departed. The arrival date is a recorded estimate, labelled as one; there is no arrival until it is recorded.',
    order,
    audit: [audit(id, 'IMPORT_ORDER_CREATED', 0, { to: 'IMPORT_REQUESTED' }, FX_BUYER), ...walk(id, upTo('SHIPPED'), 2), audit(id, 'SHIPMENT_STAGE_CHANGED', 40, { from: 'LOADING', to: 'IN_TRANSIT' })],
    footprint: govAll('MISSING'), handoff: { handedOff: false },
    stageEvents: { [ship.id]: stages(ship.id, [['PLANNED', 26], ['BOOKED', 30], ['LOADING', 38], ['IN_TRANSIT', 40, 'FIXTURE: departed origin port']]) },
  }
}

function customsPhase(): FixtureOrder {
  const id = 'fx05cust-0000-4000-8000-0000000000a5'
  const ship = shipment(id, 'ARRIVED', 30, { origin_port: 'Osaka (fixture)', departure_date: day(40), estimated_arrival_date: day(68), actual_arrival_date: day(71) })
  const order = base(id, 'DUTY_PENDING', {
    requested_make: 'Toyota', requested_model: 'Aqua', requested_year_min: 2016, requested_year_max: 2018,
    origin_city: 'Osaka', destination_city: 'Gweru', budget_amount: 8200, budget_currency: 'USD',
    vin: 'FIXTUREVIN0000005', updated_at: day(76),
    diaspora_import_quotes: [quote('ACCEPTED', 7600, 2)],
    diaspora_import_order_participants: [sellerParticipant(4), { id: nextId('fxpart'), participant_role: 'customs_reviewer', verification_status: 'VERIFIED', user_id: FX_OPERATOR, created_at: day(72) }],
    diaspora_trade_documents: verifiedSet(id, 6, 'UPLOADED'),
    diaspora_payment_milestones: [milestone(id, 'DEPOSIT', 2000, 'CONFIRMED', 5), milestone(id, 'BALANCE_DUE', 5600, 'CONFIRMED', 38), milestone(id, 'CUSTOMS_DUTY', 2150, 'PENDING', 75)],
    diaspora_cargo_reservations: [reservation(id, 'APPROVED', 25)],
    diaspora_shipments: [ship],
    diaspora_compliance_reviews: [review(id, 'PENDING_REVIEW', 'customs_clearance', 73)],
  })
  return {
    key: 'customs', label: 'Border & customs', shows: 'Arrived and recorded. Duty is pending; the duty assessment is uploaded but not verified; the compliance review is open.',
    order,
    audit: [audit(id, 'IMPORT_ORDER_CREATED', 0, { to: 'IMPORT_REQUESTED' }, FX_BUYER), ...walk(id, upTo('DUTY_PENDING'), 2), audit(id, 'COMPLIANCE_REVIEW_CREATED', 73)],
    footprint: footprint([['IMPORT_PORT_RECORD', 'VERIFIED'], ['ZIMRA_CLEARANCE', 'PENDING_REVIEW'], ['DUTY_TAX_PROOF', 'MISSING'], ['CVR_REGISTRATION', 'MISSING'], ['ZINARA_LICENSE', 'MISSING'], ['VID_ROADWORTHINESS', 'MISSING'], ['CID_POLICE_CLEARANCE', 'MISSING'], ['INSURANCE_RECORD', 'MISSING'], ['ODOMETER_VERIFICATION', 'MISSING', false], ['MECHANICAL_VERIFICATION', 'MISSING', false]]),
    handoff: { handedOff: false },
    stageEvents: { [ship.id]: stages(ship.id, [['BOOKED', 30], ['LOADING', 38], ['IN_TRANSIT', 40], ['ARRIVED', 71, 'FIXTURE: arrival recorded at port'], ['CUSTOMS_HOLD', 73, 'FIXTURE: awaiting duty']]) },
  }
}

function readyPhase(): FixtureOrder {
  const id = 'fx06redy-0000-4000-8000-0000000000a6'
  const ship = shipment(id, 'RELEASED', 30, { carrier_name: 'FIXTURE Road Freight (not a carrier)', origin_port: 'Durban (fixture)', destination_port: 'Beitbridge (fixture)', departure_date: day(44), actual_arrival_date: day(47) })
  const order = base(id, 'ROADWORTHINESS_PENDING', {
    requested_make: 'Nissan', requested_model: 'X-Trail', requested_year_min: 2016, requested_year_max: 2017,
    origin_country: 'South Africa', origin_city: 'Durban', destination_city: 'Mutare', budget_amount: 11000, budget_currency: 'USD',
    vin: 'FIXTUREVIN0000006', updated_at: day(60),
    diaspora_import_quotes: [quote('ACCEPTED', 10400, 2)],
    diaspora_import_order_participants: [sellerParticipant(4)],
    diaspora_trade_documents: verifiedSet(id, 6),
    diaspora_payment_milestones: [milestone(id, 'DEPOSIT', 2500, 'CONFIRMED', 5), milestone(id, 'BALANCE_DUE', 7900, 'CONFIRMED', 30), milestone(id, 'CUSTOMS_DUTY', 2600, 'CONFIRMED', 50)],
    diaspora_cargo_reservations: [reservation(id, 'APPROVED', 25)],
    diaspora_shipments: [ship],
    diaspora_compliance_reviews: [review(id, 'APPROVED', 'customs_clearance', 49)],
  })
  return {
    key: 'ready', label: 'Zimbabwe ready', shows: 'Released from customs. Registration is verified; roadworthiness, licence and insurance are still to be recorded.',
    order,
    audit: [audit(id, 'IMPORT_ORDER_CREATED', 0, { to: 'IMPORT_REQUESTED' }, FX_BUYER), ...walk(id, upTo('ROADWORTHINESS_PENDING'), 2), audit(id, 'COMPLIANCE_APPROVED', 50), audit(id, 'GOVERNMENT_DOCUMENT_UPSERTED', 58)],
    footprint: footprint([['IMPORT_PORT_RECORD', 'VERIFIED'], ['ZIMRA_CLEARANCE', 'VERIFIED'], ['DUTY_TAX_PROOF', 'VERIFIED'], ['CVR_REGISTRATION', 'VERIFIED'], ['CID_POLICE_CLEARANCE', 'VERIFIED'], ['VID_ROADWORTHINESS', 'PENDING_REVIEW'], ['ZINARA_LICENSE', 'MISSING'], ['INSURANCE_RECORD', 'MISSING'], ['ODOMETER_VERIFICATION', 'MISSING', false], ['MECHANICAL_VERIFICATION', 'MISSING', false]]),
    handoff: { handedOff: false },
    stageEvents: { [ship.id]: stages(ship.id, [['BOOKED', 40], ['IN_TRANSIT', 44], ['ARRIVED', 47], ['RELEASED', 50, 'FIXTURE: released after duty']]) },
  }
}

function handoverPhase(): FixtureOrder {
  const id = 'fx07hand-0000-4000-8000-0000000000a7'
  const ship = shipment(id, 'COMPLETED', 30, { origin_port: 'Yokohama (fixture)', departure_date: day(40), estimated_arrival_date: day(68), actual_arrival_date: day(70) })
  const order = base(id, 'COMPLETED', {
    requested_make: 'Toyota', requested_model: 'Corolla Axio', requested_year_min: 2015, requested_year_max: 2016,
    origin_city: 'Yokohama', destination_city: 'Harare', budget_amount: 9000, budget_currency: 'USD',
    vin: 'FIXTUREVIN0000007', linked_vehicle_vin: 'FIXTUREVIN0000007', updated_at: day(96),
    diaspora_import_quotes: [quote('ACCEPTED', 8450, 2)],
    diaspora_import_order_participants: [sellerParticipant(4)],
    diaspora_trade_documents: verifiedSet(id, 6),
    diaspora_payment_milestones: [milestone(id, 'DEPOSIT', 2000, 'CONFIRMED', 5), milestone(id, 'BALANCE_DUE', 6450, 'CONFIRMED', 30), milestone(id, 'CUSTOMS_DUTY', 1900, 'CONFIRMED', 74)],
    diaspora_cargo_reservations: [reservation(id, 'APPROVED', 25)],
    diaspora_shipments: [ship],
    diaspora_compliance_reviews: [review(id, 'APPROVED', 'customs_clearance', 72)],
  })
  return {
    key: 'handover', label: 'Handover', shows: 'Completed: every government record verified, the vehicle record linked, and the handover recorded.',
    order,
    audit: [audit(id, 'IMPORT_ORDER_CREATED', 0, { to: 'IMPORT_REQUESTED' }, FX_BUYER), ...walk(id, upTo('COMPLETED'), 2), audit(id, 'VEHICLE_IMPORT_RECORD_LINKED', 92)],
    footprint: govAll('VERIFIED'),
    handoff: { handedOff: true, vehicleVin: 'FIXTUREVIN0000007', evidence: [{ kind: 'FIXTURE handover record', recorded_at: day(95) }] },
    stageEvents: { [ship.id]: stages(ship.id, [['BOOKED', 30], ['IN_TRANSIT', 40], ['ARRIVED', 70], ['RELEASED', 76], ['COMPLETED', 80]]) },
  }
}

function flaggedException(): FixtureOrder {
  const id = 'fx08flag-0000-4000-8000-0000000000b1'
  const order = base(id, 'FLAGGED_FOR_REVIEW', {
    requested_make: 'Isuzu', requested_model: 'D-Max', requested_year_min: 2018, requested_year_max: 2018,
    origin_city: 'Kobe', destination_city: 'Harare', budget_amount: 16000, budget_currency: 'USD',
    chassis_number: 'FIXTURE-CH-0008', updated_at: day(12),
    diaspora_import_quotes: [quote('ACCEPTED', 15200, 2)],
    diaspora_import_order_participants: [sellerParticipant(4)],
    diaspora_trade_documents: [doc(id, 'passport', 'VERIFIED', 6), doc(id, 'commercial_invoice', 'VERIFIED', 7), doc(id, 'export_certificate', 'FLAGGED', 8, { metadata: { flag_reason: 'FIXTURE: issuer details need confirmation' } })],
    diaspora_compliance_reviews: [review(id, 'FLAGGED', 'document_review', 10, 'FIXTURE: export certificate issuer to be confirmed')],
  })
  return {
    key: 'flagged', label: 'On hold for review', shows: 'An exception is never placed on the progress rail: nothing moves until the review is recorded.',
    order,
    audit: [audit(id, 'IMPORT_ORDER_CREATED', 0, { to: 'IMPORT_REQUESTED' }, FX_BUYER), ...walk(id, upTo('DOCUMENTS_PENDING'), 2), audit(id, 'COMPLIANCE_FLAGGED', 11), audit(id, 'IMPORT_ORDER_STATUS_CHANGED', 12, { from: 'DOCUMENTS_PENDING', to: 'FLAGGED_FOR_REVIEW' })],
    footprint: govAll('MISSING'), handoff: { handedOff: false }, stageEvents: {},
  }
}

function disputedException(): FixtureOrder {
  const id = 'fx09disp-0000-4000-8000-0000000000b2'
  const order = base(id, 'DISPUTED', {
    requested_make: 'Toyota', requested_model: 'Vitz', requested_year_min: 2017, requested_year_max: 2018,
    origin_city: 'Yokohama', destination_city: 'Harare', budget_amount: 6500, budget_currency: 'USD',
    updated_at: day(30),
    diaspora_import_quotes: [quote('ACCEPTED', 6100, 2)],
    diaspora_import_order_participants: [sellerParticipant(4)],
    diaspora_trade_documents: [doc(id, 'passport', 'VERIFIED', 6), doc(id, 'auction_sheet', 'VERIFIED', 7)],
    diaspora_payment_milestones: [milestone(id, 'DEPOSIT', 1500, 'CONFIRMED', 5)],
  })
  return {
    key: 'disputed', label: 'In dispute', shows: 'A dispute pauses progress: no next step is invented and the rail shows no position.',
    order,
    audit: [audit(id, 'IMPORT_ORDER_CREATED', 0, { to: 'IMPORT_REQUESTED' }, FX_BUYER), ...walk(id, upTo('DOCUMENTS_VERIFIED'), 2), audit(id, 'IMPORT_ORDER_STATUS_CHANGED', 30, { from: 'DOCUMENTS_VERIFIED', to: 'DISPUTED' })],
    footprint: govAll('MISSING'), handoff: { handedOff: false }, stageEvents: {},
  }
}

function cancelledException(): FixtureOrder {
  const id = 'fx10canc-0000-4000-8000-0000000000b3'
  const order = base(id, 'CANCELLED', {
    order_type: 'vehicle', requested_make: 'Nissan', requested_model: 'NP200', requested_year_min: 2015, requested_year_max: 2017,
    origin_country: 'South Africa', origin_city: 'Johannesburg', destination_city: 'Masvingo', budget_amount: 5000, budget_currency: 'USD',
    updated_at: day(9),
    diaspora_import_quotes: [quote('EXPIRED', 5400, 2), quote('REJECTED', 5900, 3)],
  })
  return {
    key: 'cancelled', label: 'Cancelled', shows: 'A cancelled order keeps its history, but no further step applies and no progress is tracked.',
    order,
    audit: [audit(id, 'IMPORT_ORDER_CREATED', 0, { to: 'IMPORT_REQUESTED' }, FX_BUYER), ...walk(id, ['IMPORT_REQUESTED', 'QUOTE_ISSUED'], 2), audit(id, 'IMPORT_ORDER_STATUS_CHANGED', 9, { from: 'QUOTE_ISSUED', to: 'CANCELLED' }, FX_BUYER)],
    footprint: govAll('MISSING'), handoff: { handedOff: false }, stageEvents: {},
  }
}

/** The ten fixture orders, in lifecycle order, then the exceptions. */
export const FIXTURE_ORDERS: FixtureOrder[] = [
  requestPhase(), documentsPhase(), loadingPhase(), seaPhase(), customsPhase(), readyPhase(), handoverPhase(),
  flaggedException(), disputedException(), cancelledException(),
]

/** Open containers the Shipping & CAP tab lists (fixture board). */
export const FIXTURE_CONTAINERS: DiasporaContainerShipment[] = [
  {
    id: 'fxcont01-0000-4000-8000-0000000000c1', origin_country: 'Japan', origin_city: 'Nagoya', destination_country: 'Zimbabwe', destination_city: 'Harare',
    departure_date: day(120), booking_deadline: day(110), estimated_arrival_date: null, container_type: '40ft high cube (fixture)',
    total_capacity_volume: 67.7, used_capacity_volume: 52.1, available_capacity_volume: 15.6, status: 'BOOKING_OPEN',
  },
]

export function fixtureByKey(key: string | null | undefined): FixtureOrder {
  return FIXTURE_ORDERS.find(f => f.key === key || f.order.id === key) ?? FIXTURE_ORDERS[0]
}
