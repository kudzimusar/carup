/**
 * LR02 — the public SAMPLE import journey (/diaspora/sample): static, clearly fictional data.
 *
 * EVERY VALUE HERE IS INVENTED. None of it is an order, a shipment, a document, a payment, a person, a
 * business or a vehicle. Every identifier carries SAMPLE — order, account, quote and shipment references,
 * VINs, chassis and lot numbers, file names, payment references, tracking numbers, carriers and seals — so
 * a screenshot can never be taken for a record. Dates, amounts and places are illustrative.
 *
 * Every status comes from the real vocabularies (database/migrations/013_diaspora_trade_schema.sql;
 * backend constants/diaspora/diasporaStatuses.js and diasporaRfqConstants.js), so the REAL Import Order
 * views render each sample exactly as they would render a record — with no actions, so nothing can be
 * changed. This is production code on purpose: the DEV fixture tour (pages/dev) must never be imported
 * by production code, so the public sample keeps its own data.
 *
 * One fictional buyer holds ten sample orders: one in each of the seven phases of the canonical
 * lifecycle, plus the three exception states.
 */
import type {
  DiasporaAuditEntry,
  DiasporaCargoReservation,
  DiasporaGovernmentDocument,
  DiasporaOwnershipHandoffStatus,
  DiasporaPaymentMilestone,
  DiasporaShipment,
  DiasporaShipmentStageEvent,
  DiasporaTradeDocument,
} from '@/types'
import { ORDER_TABS, type OrderMode, type TradeComplianceReview, type TradeOrder, type TradeQuote } from '@/components/trade/order/orderModel'

/** The sample buyer: the sample shows every order the way it looks to this buyer. */
export const SAMPLE_BUYER_ID = 'SAMPLEBY-0000-4000-8000-000000000001'
const SAMPLE_SELLER_ID = 'SAMPLESL-0000-4000-8000-000000000002'
const SAMPLE_OPERATOR_ID = 'SAMPLEOP-0000-4000-8000-000000000003'
const SAMPLE_CONTAINER_ID = 'SAMPLECT-0000-4000-8000-0000000000c1'

/** The importer's perspective (a buyer account); the role only decides what the views SHOW. */
export const SAMPLE_VIEWER = { id: SAMPLE_BUYER_ID, role: 'owner' } as const

export interface SampleOrder {
  /** Phase key (request … handover) or exception key (flagged, disputed, cancelled). */
  key: string
  /** Chooser label. */
  label: string
  /** What this sample shows, in one line. */
  shows: string
  order: TradeOrder
  audit: DiasporaAuditEntry[]
  footprint: DiasporaGovernmentDocument[]
  handoff: DiasporaOwnershipHandoffStatus
  stageEvents: Record<string, DiasporaShipmentStageEvent[]>
}

/** Every mode the sample opens: the order's seven sections and its Passport. */
export const SAMPLE_MODES: readonly OrderMode[] = [...ORDER_TABS.map(tab => tab.key), 'passport']

/** The mode named in the URL, or the overview. */
export function sampleModeFrom(value: string | null | undefined): OrderMode {
  return SAMPLE_MODES.find(mode => mode === value) ?? 'overview'
}

/** A fixed, illustrative clock: day 0 is 2 February 2026 (the sample never reads the real clock). */
function day(n: number, hour = 9): string {
  return new Date(Date.UTC(2026, 1, 2, hour, 0, 0) + n * 86_400_000).toISOString()
}

const ALL_GOVERNMENT_RECORDS = [
  'ZIMRA_CLEARANCE', 'CVR_REGISTRATION', 'ZINARA_LICENSE', 'VID_ROADWORTHINESS', 'CID_POLICE_CLEARANCE',
  'INSURANCE_RECORD', 'DUTY_TAX_PROOF', 'IMPORT_PORT_RECORD', 'ODOMETER_VERIFICATION', 'MECHANICAL_VERIFICATION',
]
const OPTIONAL_GOVERNMENT_RECORDS = new Set(['ODOMETER_VERIFICATION', 'MECHANICAL_VERIFICATION'])

/** The happy-path states in order (the canonical lifecycle), for the sealed status walk. */
const LIFECYCLE = [
  'IMPORT_REQUESTED', 'QUOTE_ISSUED', 'SELLER_ASSIGNED', 'DOCUMENTS_PENDING', 'DOCUMENTS_VERIFIED', 'CONTAINER_BOOKED',
  'READY_FOR_LOADING', 'LOADED', 'SHIPPED', 'ARRIVED_AT_BORDER', 'CUSTOMS_IN_PROGRESS', 'DUTY_PENDING', 'DUTY_PAID',
  'RELEASED', 'REGISTRATION_PENDING', 'ROADWORTHINESS_PENDING', 'INSURANCE_PENDING', 'ZIMBABWE_READY',
  'LOCAL_LISTING_ENABLED', 'COMPLETED',
]
const upTo = (status: string) => LIFECYCLE.slice(0, LIFECYCLE.indexOf(status) + 1)

function buildSampleOrders(): SampleOrder[] {
  // Deterministic references: SAMPLE + a two-letter kind + a running number (e.g. SAMPLEQT-0004).
  let seq = 0
  const ref = (kind: string) => `SAMPLE${kind}-${String(++seq).padStart(4, '0')}`

  const doc = (orderId: string, type: string, status: string, d: number, extra: Partial<DiasporaTradeDocument> = {}): DiasporaTradeDocument => {
    const reviewed = status === 'VERIFIED' || status === 'REJECTED' || status === 'FLAGGED'
    return {
      id: ref('DC'),
      import_order_id: orderId,
      document_type: type,
      verification_status: status,
      uploaded_by: SAMPLE_BUYER_ID,
      reviewed_by: reviewed ? SAMPLE_OPERATOR_ID : null,
      reviewed_at: reviewed ? day(d + 1, 14) : null,
      file_name: `SAMPLE-${type.replace(/_/g, '-')}.pdf`,
      created_at: day(d),
      ...extra,
    }
  }

  const quote = (status: string, amount: number, d: number, extra: Partial<TradeQuote> = {}): TradeQuote => ({
    id: ref('QT'),
    seller_id: SAMPLE_SELLER_ID,
    status,
    quote_amount: amount,
    quote_currency: 'USD',
    created_at: day(d),
    valid_until: day(d + 14),
    ...extra,
  })

  const milestone = (orderId: string, type: string, amount: number, status: string, d: number): DiasporaPaymentMilestone => {
    const id = ref('MS')
    return {
      id,
      import_order_id: orderId,
      milestone_type: type,
      amount,
      currency: 'USD',
      status,
      external_reference: `SAMPLE-REF-${type.slice(0, 3)}-${id.slice(-4)}`,
      created_at: day(d),
    }
  }

  const audit = (orderId: string, action: string, d: number, change: { from?: string; to?: string; after?: Record<string, unknown> } = {}, actor = SAMPLE_OPERATOR_ID): DiasporaAuditEntry => {
    const id = ref('AU')
    const row: DiasporaAuditEntry & { previous_state?: Record<string, unknown>; new_state?: Record<string, unknown> } = {
      id,
      import_order_id: orderId,
      action,
      actor_id: actor,
      resource_type: 'import_order',
      resource_id: orderId,
      created_at: day(d, 10),
      cryptographic_seal: `SAMPLE-SEAL-${id.slice(-4)}`,
    }
    if (change.from) row.previous_state = { status: change.from }
    if (change.to || change.after) row.new_state = { ...(change.to ? { status: change.to } : {}), ...(change.after ?? {}) }
    return row
  }

  /** The status walk an order took, as sealed status-change entries (from → to), two days apart. */
  const walk = (orderId: string, statuses: string[], startDay: number): DiasporaAuditEntry[] =>
    statuses.slice(1).map((to, i) => audit(orderId, 'IMPORT_ORDER_STATUS_CHANGED', startDay + i * 2, { from: statuses[i], to }))

  const reservation = (orderId: string, status: string, d: number): DiasporaCargoReservation => ({
    id: ref('RS'), container_id: SAMPLE_CONTAINER_ID, import_order_id: orderId, buyer_id: SAMPLE_BUYER_ID,
    cargo_type: 'vehicle', estimated_volume: 14.5, reservation_status: status, created_at: day(d),
  })

  const shipment = (orderId: string, status: string, d: number, extra: Partial<DiasporaShipment> = {}): DiasporaShipment => {
    const id = ref('SH')
    return {
      id,
      import_order_id: orderId,
      container_id: SAMPLE_CONTAINER_ID,
      carrier_name: 'SAMPLE Ocean Line (fictional carrier)',
      tracking_number: `SAMPLE-TRK-${id.slice(-4)}`,
      origin_port: null,
      destination_port: 'Durban (sample)',
      departure_date: null,
      estimated_arrival_date: null,
      actual_arrival_date: null,
      status,
      created_at: day(d),
      ...extra,
    }
  }

  const stages = (shipmentId: string, list: Array<[string, number, string?]>): DiasporaShipmentStageEvent[] =>
    list.map(([stage, d, notes]) => ({ id: ref('ST'), shipment_id: shipmentId, stage, notes: notes ?? null, created_at: day(d, 11), created_by: SAMPLE_OPERATOR_ID }))

  const footprint = (rows: Array<[string, string]>): DiasporaGovernmentDocument[] =>
    rows.map(([category, status]) => ({
      category,
      status,
      requiredForZimbabweReady: !OPTIONAL_GOVERNMENT_RECORDS.has(category),
      documentId: status === 'MISSING' ? null : ref('GV'),
      verifiedAt: status === 'VERIFIED' ? day(90) : null,
    }))
  const allGovernmentRecords = (status: string) => footprint(ALL_GOVERNMENT_RECORDS.map(category => [category, status]))

  const base = (id: string, status: string, v: Partial<TradeOrder>): TradeOrder => ({
    id,
    buyer_id: SAMPLE_BUYER_ID,
    order_type: 'vehicle',
    origin_country: 'Japan',
    destination_country: 'Zimbabwe',
    status,
    created_at: day(0),
    updated_at: day(0),
    created_by: SAMPLE_BUYER_ID,
    diaspora_import_order_participants: [],
    diaspora_trade_documents: [],
    diaspora_payment_milestones: [],
    diaspora_import_quotes: [],
    diaspora_cargo_reservations: [],
    diaspora_shipments: [],
    diaspora_compliance_reviews: [],
    ...v,
  })

  const seller = (d: number) => ({ id: ref('PT'), participant_role: 'seller', verification_status: 'VERIFIED', user_id: SAMPLE_SELLER_ID, created_at: day(d) })
  const review = (orderId: string, status: string, type: string, d: number, notes?: string): TradeComplianceReview => ({
    id: ref('RV'), import_order_id: orderId, status, review_type: type, created_at: day(d),
    reviewed_at: status === 'PENDING_REVIEW' ? null : day(d + 1), notes: notes ?? null,
  })
  const created = (orderId: string) => audit(orderId, 'IMPORT_ORDER_CREATED', 0, { to: 'IMPORT_REQUESTED' }, SAMPLE_BUYER_ID)

  /** The five required documents, all verified (later phases); the duty assessment as given. */
  const verifiedSet = (orderId: string, d: number, duty: 'VERIFIED' | 'UPLOADED' | 'MISSING' = 'VERIFIED'): DiasporaTradeDocument[] => [
    doc(orderId, 'passport', 'VERIFIED', d),
    doc(orderId, 'auction_sheet', 'VERIFIED', d + 1),
    doc(orderId, 'export_certificate', 'VERIFIED', d + 2),
    doc(orderId, 'bill_of_lading', 'VERIFIED', d + 10),
    ...(duty === 'MISSING' ? [] : [doc(orderId, 'customs_declaration', duty, d + 30)]),
  ]

  /* ── 1 · Request & quotes ─────────────────────────────────────────────────────────────────────── */
  const request = (): SampleOrder => {
    const id = 'SAMPLE01-0000-4000-8000-0000000000a1'
    const order = base(id, 'QUOTE_ISSUED', {
      requested_make: 'Toyota', requested_model: 'Hilux', requested_year_min: 2019, requested_year_max: 2021,
      origin_city: 'Yokohama', destination_city: 'Harare', budget_amount: 24000, budget_currency: 'USD',
      updated_at: day(2),
      diaspora_import_quotes: [quote('ISSUED', 22850, 2, { inclusions: ['FOB price', 'Export inspection'], exclusions: ['Ocean freight', 'Zimbabwe duty'] })],
      taxonomy_resolution: { make: 'canonical', model: 'canonical' },
    })
    return {
      key: 'request', label: 'Request & quotes',
      shows: 'A request with one submitted quote waiting for the buyer. No seller is assigned and no document or money is recorded yet.',
      order,
      audit: [created(id), audit(id, 'QUOTE_ISSUED', 2, { after: { quote_amount: 22850, quote_currency: 'USD' } }, SAMPLE_SELLER_ID), ...walk(id, ['IMPORT_REQUESTED', 'QUOTE_ISSUED'], 2)],
      footprint: allGovernmentRecords('MISSING'), handoff: { handedOff: false }, stageEvents: {},
    }
  }

  /* ── 2 · Documents ───────────────────────────────────────────────────────────────────────────── */
  const documents = (): SampleOrder => {
    const id = 'SAMPLE02-0000-4000-8000-0000000000a2'
    const certificate = doc(id, 'export_certificate', 'OCR_EXTRACTED', 9)
    certificate.extractions = [{
      id: ref('OC'), trade_document_id: certificate.id, extraction_provider: 'carup_ocr', confidence_score: 0.82,
      extracted_fields: { certificate_number: 'SAMPLE-EXC-0002', exporter: 'SAMPLE exporter (fictional)' }, created_at: day(9, 12),
    }]
    const order = base(id, 'DOCUMENTS_PENDING', {
      requested_make: 'Toyota', requested_model: 'Land Cruiser Prado', requested_year_min: 2017, requested_year_max: 2019,
      origin_city: 'Kobe', destination_city: 'Bulawayo', budget_amount: 31000, budget_currency: 'USD',
      chassis_number: 'SAMPLE-CH-0002', auction_lot_number: 'SAMPLE-LOT-0002', updated_at: day(9),
      diaspora_import_quotes: [quote('ACCEPTED', 29400, 2), quote('REJECTED', 30900, 3)],
      diaspora_import_order_participants: [seller(4)],
      diaspora_trade_documents: [
        doc(id, 'passport', 'VERIFIED', 6),
        doc(id, 'auction_sheet', 'REJECTED', 6, { metadata: { rejection_reason: 'SAMPLE: page 2 is unreadable' } }),
        doc(id, 'auction_sheet', 'UPLOADED', 8),
        certificate,
        doc(id, 'inspection_certificate', 'UPLOADED', 9),
      ],
      diaspora_payment_milestones: [milestone(id, 'DEPOSIT', 5000, 'CONFIRMED', 5)],
    })
    return {
      key: 'documents', label: 'Documents',
      shows: 'Uploaded is not verified: one document verified, one uploaded again after a rejection, one read automatically (still not verified) and two not uploaded yet.',
      order,
      audit: [
        created(id),
        audit(id, 'QUOTE_ISSUED', 2, { after: { quote_amount: 29400, quote_currency: 'USD' } }, SAMPLE_SELLER_ID),
        audit(id, 'SELLER_ASSIGNED', 4),
        ...walk(id, upTo('DOCUMENTS_PENDING'), 2),
        audit(id, 'PAYMENT_MILESTONE_CREATED', 5, { after: { milestone_type: 'DEPOSIT', amount: 5000, currency: 'USD' } }, SAMPLE_BUYER_ID),
        audit(id, 'TRADE_DOCUMENT_UPLOADED', 6, { after: { document_type: 'passport' } }, SAMPLE_BUYER_ID),
        audit(id, 'TRADE_DOCUMENT_VERIFIED', 7, { after: { document_type: 'passport' } }),
        audit(id, 'TRADE_DOCUMENT_REJECTED', 7, { after: { document_type: 'auction_sheet' } }),
        audit(id, 'TRADE_DOCUMENT_UPLOADED', 8, { after: { document_type: 'auction_sheet' } }, SAMPLE_BUYER_ID),
        audit(id, 'TRADE_DOCUMENT_OCR_EXTRACTED', 9, { after: { document_type: 'export_certificate' } }),
      ],
      footprint: allGovernmentRecords('MISSING'), handoff: { handedOff: false }, stageEvents: {},
    }
  }

  /* ── 3 · Booking & loading ───────────────────────────────────────────────────────────────────── */
  const loading = (): SampleOrder => {
    const id = 'SAMPLE03-0000-4000-8000-0000000000a3'
    const ship = shipment(id, 'BOOKED', 24, { origin_port: 'Nagoya (sample)' })
    const order = base(id, 'CONTAINER_BOOKED', {
      requested_make: 'Honda', requested_model: 'Fit Hybrid', requested_year_min: 2018, requested_year_max: 2019,
      origin_city: 'Nagoya', destination_city: 'Harare', budget_amount: 9800, budget_currency: 'USD',
      vin: 'SAMPLEVIN00000003', updated_at: day(24),
      diaspora_import_quotes: [quote('ACCEPTED', 9350, 2)],
      diaspora_import_order_participants: [seller(4)],
      diaspora_trade_documents: [doc(id, 'passport', 'VERIFIED', 6), doc(id, 'commercial_invoice', 'VERIFIED', 7), doc(id, 'export_certificate', 'VERIFIED', 8), doc(id, 'bill_of_lading', 'UPLOADED', 23)],
      diaspora_payment_milestones: [milestone(id, 'DEPOSIT', 2000, 'CONFIRMED', 5), milestone(id, 'SHIPPING_FEE', 1450, 'PENDING', 22)],
      diaspora_cargo_reservations: [reservation(id, 'APPROVED', 20)],
      diaspora_shipments: [ship],
    })
    return {
      key: 'loading', label: 'Booking & loading',
      shows: 'Container space approved and a booking recorded. No departure date or arrival estimate has been recorded, so none is shown.',
      order,
      audit: [created(id), ...walk(id, upTo('CONTAINER_BOOKED'), 2), audit(id, 'CARGO_RESERVATION_REQUESTED', 20, {}, SAMPLE_BUYER_ID), audit(id, 'CARGO_RESERVATION_APPROVED', 21), audit(id, 'SHIPMENT_CREATED', 24)],
      footprint: allGovernmentRecords('MISSING'), handoff: { handedOff: false },
      stageEvents: { [ship.id]: stages(ship.id, [['PLANNED', 22], ['BOOKED', 24, 'SAMPLE: space confirmed by logistics']]) },
    }
  }

  /* ── 4 · At sea ──────────────────────────────────────────────────────────────────────────────── */
  const sea = (): SampleOrder => {
    const id = 'SAMPLE04-0000-4000-8000-0000000000a4'
    const ship = shipment(id, 'IN_TRANSIT', 30, { origin_port: 'Southampton (sample)', departure_date: day(40), estimated_arrival_date: day(68) })
    const order = base(id, 'SHIPPED', {
      requested_make: 'Mazda', requested_model: 'CX-5', requested_year_min: 2017, requested_year_max: 2018,
      origin_country: 'United Kingdom', origin_city: 'Southampton', destination_city: 'Harare', budget_amount: 14500, budget_currency: 'USD',
      vin: 'SAMPLEVIN00000004', updated_at: day(41),
      diaspora_import_quotes: [quote('ACCEPTED', 13100, 2)],
      diaspora_import_order_participants: [seller(4)],
      diaspora_trade_documents: verifiedSet(id, 6, 'MISSING'),
      diaspora_payment_milestones: [milestone(id, 'DEPOSIT', 3000, 'CONFIRMED', 5), milestone(id, 'SHIPPING_FEE', 1900, 'CONFIRMED', 30), milestone(id, 'BALANCE_DUE', 8200, 'PENDING', 41)],
      diaspora_cargo_reservations: [reservation(id, 'APPROVED', 25)],
      diaspora_shipments: [ship],
    })
    return {
      key: 'sea', label: 'At sea',
      shows: 'Departure recorded. The arrival date is the estimate logistics recorded, labelled as one; the vehicle has not arrived until arrival is recorded.',
      order,
      audit: [created(id), ...walk(id, upTo('SHIPPED'), 2), audit(id, 'SHIPMENT_STAGE_CHANGED', 40, { from: 'LOADING', to: 'IN_TRANSIT' })],
      footprint: allGovernmentRecords('MISSING'), handoff: { handedOff: false },
      stageEvents: { [ship.id]: stages(ship.id, [['PLANNED', 26], ['BOOKED', 30], ['LOADING', 38], ['IN_TRANSIT', 40, 'SAMPLE: departed the port of loading']]) },
    }
  }

  /* ── 5 · Border & customs ────────────────────────────────────────────────────────────────────── */
  const customs = (): SampleOrder => {
    const id = 'SAMPLE05-0000-4000-8000-0000000000a5'
    const ship = shipment(id, 'ARRIVED', 30, { origin_port: 'Osaka (sample)', departure_date: day(40), estimated_arrival_date: day(68), actual_arrival_date: day(71) })
    const order = base(id, 'DUTY_PENDING', {
      requested_make: 'Toyota', requested_model: 'Aqua', requested_year_min: 2016, requested_year_max: 2018,
      origin_city: 'Osaka', destination_city: 'Gweru', budget_amount: 8200, budget_currency: 'USD',
      vin: 'SAMPLEVIN00000005', updated_at: day(76),
      diaspora_import_quotes: [quote('ACCEPTED', 7600, 2)],
      diaspora_import_order_participants: [seller(4), { id: ref('PT'), participant_role: 'customs_reviewer', verification_status: 'VERIFIED', user_id: SAMPLE_OPERATOR_ID, created_at: day(72) }],
      diaspora_trade_documents: verifiedSet(id, 6, 'UPLOADED'),
      diaspora_payment_milestones: [milestone(id, 'DEPOSIT', 2000, 'CONFIRMED', 5), milestone(id, 'BALANCE_DUE', 5600, 'CONFIRMED', 38), milestone(id, 'CUSTOMS_DUTY', 2150, 'PENDING', 75)],
      diaspora_cargo_reservations: [reservation(id, 'APPROVED', 25)],
      diaspora_shipments: [ship],
      diaspora_compliance_reviews: [review(id, 'PENDING_REVIEW', 'customs_clearance', 73)],
    })
    return {
      key: 'customs', label: 'Border & customs',
      shows: 'Arrival recorded. Duty is pending, the duty assessment is uploaded but not verified, and a compliance review is open.',
      order,
      audit: [created(id), ...walk(id, upTo('DUTY_PENDING'), 2), audit(id, 'COMPLIANCE_REVIEW_CREATED', 73)],
      footprint: footprint([
        ['IMPORT_PORT_RECORD', 'VERIFIED'], ['ZIMRA_CLEARANCE', 'PENDING_REVIEW'], ['DUTY_TAX_PROOF', 'MISSING'], ['CVR_REGISTRATION', 'MISSING'],
        ['ZINARA_LICENSE', 'MISSING'], ['VID_ROADWORTHINESS', 'MISSING'], ['CID_POLICE_CLEARANCE', 'MISSING'], ['INSURANCE_RECORD', 'MISSING'],
        ['ODOMETER_VERIFICATION', 'MISSING'], ['MECHANICAL_VERIFICATION', 'MISSING'],
      ]),
      handoff: { handedOff: false },
      stageEvents: { [ship.id]: stages(ship.id, [['BOOKED', 30], ['LOADING', 38], ['IN_TRANSIT', 40], ['ARRIVED', 71, 'SAMPLE: arrival recorded at the port'], ['CUSTOMS_HOLD', 73, 'SAMPLE: awaiting duty']]) },
    }
  }

  /* ── 6 · Zimbabwe ready ──────────────────────────────────────────────────────────────────────── */
  const ready = (): SampleOrder => {
    const id = 'SAMPLE06-0000-4000-8000-0000000000a6'
    const ship = shipment(id, 'RELEASED', 30, { carrier_name: 'SAMPLE Road Freight (fictional carrier)', origin_port: 'Durban (sample)', destination_port: 'Beitbridge (sample)', departure_date: day(44), actual_arrival_date: day(47) })
    const order = base(id, 'ROADWORTHINESS_PENDING', {
      requested_make: 'Nissan', requested_model: 'X-Trail', requested_year_min: 2016, requested_year_max: 2017,
      origin_country: 'South Africa', origin_city: 'Durban', destination_city: 'Mutare', budget_amount: 11000, budget_currency: 'USD',
      vin: 'SAMPLEVIN00000006', updated_at: day(60),
      diaspora_import_quotes: [quote('ACCEPTED', 10400, 2)],
      diaspora_import_order_participants: [seller(4)],
      diaspora_trade_documents: verifiedSet(id, 6),
      diaspora_payment_milestones: [milestone(id, 'DEPOSIT', 2500, 'CONFIRMED', 5), milestone(id, 'BALANCE_DUE', 7900, 'CONFIRMED', 30), milestone(id, 'CUSTOMS_DUTY', 2600, 'CONFIRMED', 50)],
      diaspora_cargo_reservations: [reservation(id, 'APPROVED', 25)],
      diaspora_shipments: [ship],
      diaspora_compliance_reviews: [review(id, 'APPROVED', 'customs_clearance', 49)],
    })
    return {
      key: 'ready', label: 'Zimbabwe ready',
      shows: 'Released from customs. Registration is verified; roadworthiness, licence and insurance are still to be recorded.',
      order,
      audit: [created(id), ...walk(id, upTo('ROADWORTHINESS_PENDING'), 2), audit(id, 'COMPLIANCE_APPROVED', 50), audit(id, 'GOVERNMENT_DOCUMENT_UPSERTED', 58)],
      footprint: footprint([
        ['IMPORT_PORT_RECORD', 'VERIFIED'], ['ZIMRA_CLEARANCE', 'VERIFIED'], ['DUTY_TAX_PROOF', 'VERIFIED'], ['CVR_REGISTRATION', 'VERIFIED'],
        ['CID_POLICE_CLEARANCE', 'VERIFIED'], ['VID_ROADWORTHINESS', 'PENDING_REVIEW'], ['ZINARA_LICENSE', 'MISSING'], ['INSURANCE_RECORD', 'MISSING'],
        ['ODOMETER_VERIFICATION', 'MISSING'], ['MECHANICAL_VERIFICATION', 'MISSING'],
      ]),
      handoff: { handedOff: false },
      stageEvents: { [ship.id]: stages(ship.id, [['BOOKED', 40], ['IN_TRANSIT', 44], ['ARRIVED', 47], ['RELEASED', 50, 'SAMPLE: released after duty']]) },
    }
  }

  /* ── 7 · Handover ────────────────────────────────────────────────────────────────────────────── */
  const handover = (): SampleOrder => {
    const id = 'SAMPLE07-0000-4000-8000-0000000000a7'
    const ship = shipment(id, 'COMPLETED', 30, { origin_port: 'Yokohama (sample)', departure_date: day(40), estimated_arrival_date: day(68), actual_arrival_date: day(70) })
    const order = base(id, 'COMPLETED', {
      requested_make: 'Toyota', requested_model: 'Corolla Axio', requested_year_min: 2015, requested_year_max: 2016,
      origin_city: 'Yokohama', destination_city: 'Harare', budget_amount: 9000, budget_currency: 'USD',
      vin: 'SAMPLEVIN00000007', linked_vehicle_vin: 'SAMPLEVIN00000007', updated_at: day(96),
      diaspora_import_quotes: [quote('ACCEPTED', 8450, 2)],
      diaspora_import_order_participants: [seller(4)],
      diaspora_trade_documents: verifiedSet(id, 6),
      diaspora_payment_milestones: [milestone(id, 'DEPOSIT', 2000, 'CONFIRMED', 5), milestone(id, 'BALANCE_DUE', 6450, 'CONFIRMED', 30), milestone(id, 'CUSTOMS_DUTY', 1900, 'CONFIRMED', 74)],
      diaspora_cargo_reservations: [reservation(id, 'APPROVED', 25)],
      diaspora_shipments: [ship],
      diaspora_compliance_reviews: [review(id, 'APPROVED', 'customs_clearance', 72)],
    })
    return {
      key: 'handover', label: 'Handover',
      shows: 'Completed: every government record verified, the vehicle record linked and the handover recorded.',
      order,
      audit: [created(id), ...walk(id, upTo('COMPLETED'), 2), audit(id, 'VEHICLE_IMPORT_RECORD_LINKED', 92)],
      footprint: allGovernmentRecords('VERIFIED'),
      handoff: { handedOff: true, vehicleVin: 'SAMPLEVIN00000007', evidence: [{ kind: 'SAMPLE handover record', recorded_at: day(95) }] },
      stageEvents: { [ship.id]: stages(ship.id, [['BOOKED', 30], ['IN_TRANSIT', 40], ['ARRIVED', 70], ['RELEASED', 76], ['COMPLETED', 80]]) },
    }
  }

  /* ── Exceptions: never placed on the progress rail ───────────────────────────────────────────── */
  const flagged = (): SampleOrder => {
    const id = 'SAMPLE08-0000-4000-8000-0000000000b1'
    const order = base(id, 'FLAGGED_FOR_REVIEW', {
      requested_make: 'Isuzu', requested_model: 'D-Max', requested_year_min: 2018, requested_year_max: 2018,
      origin_city: 'Kobe', destination_city: 'Harare', budget_amount: 16000, budget_currency: 'USD',
      chassis_number: 'SAMPLE-CH-0008', updated_at: day(12),
      diaspora_import_quotes: [quote('ACCEPTED', 15200, 2)],
      diaspora_import_order_participants: [seller(4)],
      diaspora_trade_documents: [doc(id, 'passport', 'VERIFIED', 6), doc(id, 'commercial_invoice', 'VERIFIED', 7), doc(id, 'export_certificate', 'FLAGGED', 8, { metadata: { flag_reason: 'SAMPLE: the issuer details need confirming' } })],
      diaspora_compliance_reviews: [review(id, 'FLAGGED', 'document_review', 10, 'SAMPLE: the export certificate issuer is to be confirmed')],
    })
    return {
      key: 'flagged', label: 'On hold for review',
      shows: 'An exception is never placed on the progress rail: nothing moves until the review is recorded.',
      order,
      audit: [created(id), ...walk(id, upTo('DOCUMENTS_PENDING'), 2), audit(id, 'COMPLIANCE_FLAGGED', 11), audit(id, 'IMPORT_ORDER_STATUS_CHANGED', 12, { from: 'DOCUMENTS_PENDING', to: 'FLAGGED_FOR_REVIEW' })],
      footprint: allGovernmentRecords('MISSING'), handoff: { handedOff: false }, stageEvents: {},
    }
  }

  const disputed = (): SampleOrder => {
    const id = 'SAMPLE09-0000-4000-8000-0000000000b2'
    const order = base(id, 'DISPUTED', {
      requested_make: 'Toyota', requested_model: 'Vitz', requested_year_min: 2017, requested_year_max: 2018,
      origin_city: 'Yokohama', destination_city: 'Harare', budget_amount: 6500, budget_currency: 'USD',
      updated_at: day(30),
      diaspora_import_quotes: [quote('ACCEPTED', 6100, 2)],
      diaspora_import_order_participants: [seller(4)],
      diaspora_trade_documents: [doc(id, 'passport', 'VERIFIED', 6), doc(id, 'auction_sheet', 'VERIFIED', 7)],
      diaspora_payment_milestones: [milestone(id, 'DEPOSIT', 1500, 'CONFIRMED', 5)],
    })
    return {
      key: 'disputed', label: 'In dispute',
      shows: 'A dispute pauses progress: no next step is invented and the rail shows no position.',
      order,
      audit: [created(id), ...walk(id, upTo('DOCUMENTS_VERIFIED'), 2), audit(id, 'IMPORT_ORDER_STATUS_CHANGED', 30, { from: 'DOCUMENTS_VERIFIED', to: 'DISPUTED' })],
      footprint: allGovernmentRecords('MISSING'), handoff: { handedOff: false }, stageEvents: {},
    }
  }

  const cancelled = (): SampleOrder => {
    const id = 'SAMPLE10-0000-4000-8000-0000000000b3'
    const order = base(id, 'CANCELLED', {
      requested_make: 'Nissan', requested_model: 'NP200', requested_year_min: 2015, requested_year_max: 2017,
      origin_country: 'South Africa', origin_city: 'Johannesburg', destination_city: 'Masvingo', budget_amount: 5000, budget_currency: 'USD',
      updated_at: day(9),
      diaspora_import_quotes: [quote('EXPIRED', 5400, 2), quote('REJECTED', 5900, 3)],
    })
    return {
      key: 'cancelled', label: 'Cancelled',
      shows: 'A cancelled order keeps its history, but no further step applies and no progress is tracked.',
      order,
      audit: [created(id), ...walk(id, ['IMPORT_REQUESTED', 'QUOTE_ISSUED'], 2), audit(id, 'IMPORT_ORDER_STATUS_CHANGED', 9, { from: 'QUOTE_ISSUED', to: 'CANCELLED' }, SAMPLE_BUYER_ID)],
      footprint: allGovernmentRecords('MISSING'), handoff: { handedOff: false }, stageEvents: {},
    }
  }

  return [request(), documents(), loading(), sea(), customs(), ready(), handover(), flagged(), disputed(), cancelled()]
}

/** The ten sample orders, in lifecycle order, then the three exceptions. */
export const SAMPLE_ORDERS: readonly SampleOrder[] = buildSampleOrders()

/** The sample order named in the URL (by its key), or the first one. */
export function sampleOrderByKey(key: string | null | undefined): SampleOrder {
  return SAMPLE_ORDERS.find(sample => sample.key === key) ?? SAMPLE_ORDERS[0]
}

/** The key of the sample order with this id (order links inside the sample are built from it). */
export function sampleKeyOf(orderId: string): string | null {
  return SAMPLE_ORDERS.find(sample => sample.order.id === orderId)?.key ?? null
}
