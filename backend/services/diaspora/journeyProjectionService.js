/**
 * T11-CAP-02 — Journey & Arrival: the projection.
 *
 * It COMPOSES. It is not an authority: it stores nothing, moves nothing and decides nothing. Every
 * fact is read from the layer that owns it — the order and vehicle (T4), the load (T10), the
 * movement (T11) — and every section says which. What is not yet composed says `not_yet_composed`
 * instead of returning an empty list that reads as "nothing to report".
 *
 * The distinctions T11 fought for are held, not simplified, because a friendlier journey page is
 * exactly where they would be lost:
 *
 *     PLANNED departure  ≠  OBSERVED departure
 *     ETA                ≠  ACTUAL ARRIVAL
 *     LOADED             ≠  SAILED
 *     a carrier reference ≠ movement
 *     a customs HOLD     ≠  a customs DECISION   (and customs is not composed here at all yet)
 *
 * Choosing the shipment (CAP-01 Part B §4.1). T11's own participant view takes `shipments[0]` for a
 * container, and `createShipment` has no uniqueness rule, so two shipments for one container are
 * possible. This projection never picks one arbitrarily:
 *
 *   tier 1  attached to THIS order (and on its container, when it has one)
 *   tier 2  attached to another order but sailing on THIS order's container
 *   tier 3  attached to this order but sailing on a DIFFERENT container (inconsistent — shown, flagged)
 *
 * The best tier present decides. Exactly one in that tier → selected. More than one → AMBIGUOUS, and
 * no movement is claimed at all. The legacy endpoint is unchanged and remains a recorded defect
 * candidate; this module composes around it, it does not repair it.
 *
 * Who may read. The Journey of an order is readable by exactly those who may read the order
 * (`canReadImportOrder`) plus platform admins and reviewers — one rule for who can read an order, not
 * a competing one. A non-privileged caller cannot tell a missing journey from a forbidden one. The
 * consignee is private data: only the order's own buyer/creator and platform admins/reviewers see it.
 * A sailing operator with no right to the order is refused; they have the T11 operator view.
 */
import { ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import {
  requireUserContext,
  isPlatformAdmin,
  isPlatformReviewer,
  isTenantAdminForRecord,
  canReadImportOrder,
  normalizeId,
} from './diasporaAuthorization.js';
import { resolveClient } from './diasporaServiceUtils.js';

const ORDERS = 'diaspora_import_orders';
const PARTICIPANTS = 'diaspora_import_order_participants';
const RESERVATIONS = 'diaspora_cargo_reservations';
const SHIPMENTS = 'diaspora_shipments';
const STAGE_EVENTS = 'diaspora_shipment_stage_events';
const LOADS = 'diaspora_container_loads';
const LOAD_ITEMS = 'diaspora_container_load_items';
const VEHICLES = 'vehicles';

export const JOURNEY_SUBJECT_TYPES = Object.freeze(['import_order', 'cargo_reservation', 'shipment']);

export const JOURNEY_STATES = Object.freeze({
  NO_TRANSACTION: 'NO_TRANSACTION',
  NOT_LOADED: 'NOT_LOADED',
  LEFT_BEHIND: 'LEFT_BEHIND',
  LOADED: 'LOADED',
  NO_SHIPMENT: 'NO_SHIPMENT',
  SHIPMENT_CREATED: 'SHIPMENT_CREATED',
  IN_TRANSIT: 'IN_TRANSIT',
  ARRIVED: 'ARRIVED',
  EXCEPTION: 'EXCEPTION',
  SHIPMENT_AMBIGUOUS: 'SHIPMENT_AMBIGUOUS',
});

const SENTENCE = Object.freeze({
  NO_TRANSACTION: 'No import order is attached to this booking yet, so there is no journey to show.',
  NOT_LOADED: 'Your cargo has not been loaded into a container yet.',
  LEFT_BEHIND: 'Your cargo was not loaded into this container.',
  LOADED: 'Your cargo is inside the container. The container has not been recorded as leaving.',
  NO_SHIPMENT: 'No shipment has been set up for this order yet. Nothing has been recorded as moving.',
  SHIPMENT_CREATED: 'A shipment has been set up. Nothing has been recorded as moving yet.',
  IN_TRANSIT: 'The shipment has left and is on its way.',
  ARRIVED: 'The shipment has been recorded as arrived.',
  EXCEPTION: 'Something has happened to this shipment that the organiser has recorded.',
  SHIPMENT_AMBIGUOUS: 'More than one shipment could match this order, so no movement is shown until that is resolved.',
});

const NOT_YET_COMPOSED = (owner) => Object.freeze({ availability: 'not_yet_composed', owner });

const DENIED = 'You do not have access to this journey';

const privileged = (ctx) => isPlatformAdmin(ctx) || isPlatformReviewer(ctx);

function requireText(value, field) {
  const text = String(value ?? '').trim();
  if (!text) throw new ValidationError(`${field} is required`);
  return text;
}

/**
 * A non-privileged caller gets the same refusal whether the subject is missing or merely not theirs,
 * so the endpoint cannot be used to find out which ids exist. A platform admin or reviewer is told
 * the truth.
 */
function missingOrDenied(context, what) {
  return privileged(context) ? new NotFoundError(`${what} not found`) : new ForbiddenError(DENIED);
}

/** Mirrors T11's definition (`shipmentTrackingService.projectDates`); an equivalence test guards drift. */
function projectDates(shipment) {
  const meta = shipment.metadata || {};
  return {
    planned_departure: meta.planned_departure_date || null,
    planned_departure_source: meta.planned_departure_date ? (meta.planned_departure_source || 'stated') : null,
    observed_departure: shipment.departure_date || null,
    estimated_arrival: shipment.estimated_arrival_date || null,
    observed_arrival: shipment.actual_arrival_date || null,
    note: 'A planned departure is an intention. An estimated arrival is an estimate. Only the observed dates are records of something that happened.',
  };
}

/** References only, never container or seal numbers (operator-only in T11), and never movement. */
function projectReferences(shipment) {
  return {
    carrier: shipment.carrier_name || null,
    tracking_reference: shipment.tracking_number || null,
    origin_port: shipment.origin_port || null,
    destination_port: shipment.destination_port || null,
    note: 'A carrier or tracking reference means the paperwork exists. It is not a record that anything has moved.',
  };
}

/**
 * Movement events, oldest first. Only stage, time, place and a declared `source` string leave this
 * function — never `metadata`, never who recorded it.
 */
function projectMovement(events = []) {
  return (events || [])
    .filter((e) => !e.deleted_at)
    .slice()
    .sort((a, b) => String(a.event_time || '').localeCompare(String(b.event_time || '')))
    .map((e) => ({
      kind: 'MOVEMENT',
      stage: e.stage,
      event_time: e.event_time,
      location: e.location || null,
      source: typeof e.metadata?.source === 'string' ? e.metadata.source : null,
    }));
}

/**
 * Which shipment, if any, is this order's. See the module header for the tiers. Returns the shipment
 * and how it was associated, or why none is shown.
 */
export function selectShipment(order, containerIds, byOrder = [], byContainer = []) {
  const seen = new Map();
  [...byOrder, ...byContainer].forEach((s) => { if (s && !s.deleted_at) seen.set(s.id, s); });
  const candidates = [...seen.values()];
  const sails = (s) => containerIds.length > 0 && containerIds.includes(normalizeId(s.container_id));
  const mine = (s) => normalizeId(s.import_order_id) === normalizeId(order.id);

  const tier1 = candidates.filter((s) => mine(s) && (containerIds.length === 0 || sails(s)));
  const tier2 = candidates.filter((s) => !tier1.includes(s) && sails(s));
  const tier3 = candidates.filter((s) => !tier1.includes(s) && !tier2.includes(s) && mine(s));

  const pick = (tier, association) => {
    if (tier.length === 1) return { shipment: tier[0], association };
    if (tier.length > 1) return { shipment: null, association: 'ambiguous', candidate_count: tier.length };
    return null;
  };
  return pick(tier1, 'order') || pick(tier2, 'container') || pick(tier3, 'order_container_mismatch')
    || { shipment: null, association: 'none' };
}

async function loadSubject(client, subjectType, subjectId, context) {
  if (subjectType === 'import_order') {
    const { data: order } = await client.from(ORDERS).select('*').eq('id', subjectId).is('deleted_at', null).maybeSingle();
    if (!order) throw missingOrDenied(context, 'Journey');
    return { order, reservation: null };
  }
  if (subjectType === 'cargo_reservation') {
    const { data: reservation } = await client.from(RESERVATIONS).select('*').eq('id', subjectId).is('deleted_at', null).maybeSingle();
    if (!reservation) throw missingOrDenied(context, 'Journey');
    const owners = [reservation.buyer_id, reservation.created_by].map(normalizeId).filter(Boolean);
    const ownsReservation = owners.includes(context.id) || privileged(context) || isTenantAdminForRecord(reservation, context);
    if (!ownsReservation) throw new ForbiddenError(DENIED);
    if (!reservation.import_order_id) return { order: null, reservation };
    const { data: order } = await client.from(ORDERS).select('*').eq('id', reservation.import_order_id).is('deleted_at', null).maybeSingle();
    if (!order) throw missingOrDenied(context, 'Journey');
    return { order, reservation };
  }
  const { data: shipment } = await client.from(SHIPMENTS).select('*').eq('id', subjectId).is('deleted_at', null).maybeSingle();
  if (!shipment) throw missingOrDenied(context, 'Journey');
  const { data: order } = await client.from(ORDERS).select('*').eq('id', shipment.import_order_id).is('deleted_at', null).maybeSingle();
  if (!order) throw missingOrDenied(context, 'Journey');
  return { order, reservation: null };
}

function viewerOf(order, participants, context) {
  const owner = [order.buyer_id, order.created_by].map(normalizeId).filter(Boolean).includes(context.id);
  if (privileged(context)) return { kind: 'ADMIN', privateAccess: true };
  if (owner) return { kind: 'OWNER', privateAccess: true };
  if (isTenantAdminForRecord(order, context)) return { kind: 'ADMIN', privateAccess: false };
  return { kind: 'PARTICIPANT', privateAccess: false };
}

function projectAsset(order, vehicle, privateAccess) {
  const base = {
    make: vehicle?.make ?? null,
    model: vehicle?.model ?? null,
    year: vehicle?.year ?? null,
    color: vehicle?.color ?? null,
    mileage: vehicle?.mileage ?? null,
    source: vehicle ? 'vehicles' : 'unknown',
  };
  // A request ("I want a Honda Vezel") is not a vehicle, so requested_make/requested_model are never read.
  if (!privateAccess) return base;
  return {
    ...base,
    chassis_number: vehicle?.chassis_number ?? order.chassis_number ?? null,
    engine_number: vehicle?.engine_number ?? null,
  };
}

function projectConsignee(order, privateAccess) {
  if (!privateAccess) return null;
  const kind = order.consignee_kind || null;
  const name = order.consignee_name || null;
  const phone = order.consignee_phone || null;
  return { recorded: Boolean(kind || name || phone), kind, name, phone };
}

function emptyJourney(subject, viewer) {
  return {
    subject,
    viewer: { kind: viewer.kind },
    state: JOURNEY_STATES.NO_TRANSACTION,
    sentence: SENTENCE.NO_TRANSACTION,
    asset: null,
    transaction: null,
    shipping: null,
    timeline: [],
    exceptions: [],
    contacts: null,
    sections: sectionsPlaceholder(),
    provenance: {},
    note: NOTE,
  };
}

const NOTE = 'This is a composition of records owned elsewhere. It records nothing and decides nothing.';

function sectionsPlaceholder() {
  return {
    documents: NOT_YET_COMPOSED('T8'),
    customs: NOT_YET_COMPOSED('T12'),
    payments: NOT_YET_COMPOSED('T13'),
    notifications: NOT_YET_COMPOSED('T7'),
    actions: NOT_YET_COMPOSED('derived from the owning authorities'),
  };
}

/**
 * The journey of one import order, however the caller names it (the order, a cargo booking on it, or
 * its shipment). Bounded reads — the number of queries does not grow with the length of the timeline.
 */
export async function getJourney(subjectType, subjectId, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  if (!JOURNEY_SUBJECT_TYPES.includes(String(subjectType))) {
    throw new ValidationError(`Journey subject must be one of: ${JOURNEY_SUBJECT_TYPES.join(', ')}`);
  }
  const type = String(subjectType);
  const id = requireText(subjectId, 'subjectId');

  const { order, reservation: aliasReservation } = await loadSubject(client, type, id, context);

  // A booking with no order has no journey. The caller was already authorized on the booking.
  if (!order) {
    return emptyJourney({ type, id, order_id: null }, viewerOf({}, [], context));
  }

  const { data: participants } = await client.from(PARTICIPANTS).select('*')
    .eq('import_order_id', order.id).is('deleted_at', null);
  if (!privileged(context) && !canReadImportOrder(order, participants || [], context)) {
    throw new ForbiddenError(DENIED);
  }
  // Owning a booking never opens an order the caller could not otherwise read (checked above).
  const viewer = viewerOf(order, participants || [], context);

  const { data: reservations } = await client.from(RESERVATIONS).select('*')
    .eq('import_order_id', order.id).is('deleted_at', null);
  const liveReservations = reservations || [];
  const containerIds = [...new Set(liveReservations.map((r) => normalizeId(r.container_id)).filter(Boolean))];

  // The load ladder applies only when exactly one booking is in play; otherwise no claim is made from it.
  const ladderReservation = aliasReservation
    || (liveReservations.length === 1 ? liveReservations[0] : null);

  let loadState = null;
  let loadRecord = null;
  if (ladderReservation?.container_id) {
    const { data: loads } = await client.from(LOADS).select('*')
      .eq('container_id', ladderReservation.container_id).is('deleted_at', null);
    loadRecord = (loads || []).find((l) => ['IN_PROGRESS', 'COMPLETED'].includes(String(l.status))) || null;
    const { data: mine } = loadRecord
      ? await client.from(LOAD_ITEMS).select('*').eq('load_id', loadRecord.id)
        .eq('subject_type', 'cargo_reservation').eq('subject_id', ladderReservation.id).is('deleted_at', null).maybeSingle()
      : { data: null };
    if (mine?.outcome === 'LEFT_BEHIND') loadState = JOURNEY_STATES.LEFT_BEHIND;
    else if (mine?.outcome === 'LOADED') loadState = JOURNEY_STATES.LOADED;
    else loadState = JOURNEY_STATES.NOT_LOADED;
  }

  const timeline = [];
  if (loadState === JOURNEY_STATES.LOADED && loadRecord?.confirmed_at) {
    timeline.push({ kind: 'LOAD', stage: 'LOADED', event_time: loadRecord.confirmed_at, location: null, source: 'T10' });
  }

  const exceptions = [];
  let state;
  let shipping;

  const goodsNotOnShipment = loadState === JOURNEY_STATES.LEFT_BEHIND || loadState === JOURNEY_STATES.NOT_LOADED;
  if (goodsNotOnShipment) {
    // Cargo that did not travel has no journey to follow, and a container-level shipment is not theirs to read.
    state = loadState;
    shipping = { association: 'not_applicable', dates: null, references: null, legs: NOT_YET_COMPOSED('T11') };
  } else {
    const { data: byOrder } = await client.from(SHIPMENTS).select('*')
      .eq('import_order_id', order.id).is('deleted_at', null);
    const { data: byContainer } = containerIds.length
      ? await client.from(SHIPMENTS).select('*').in('container_id', containerIds).is('deleted_at', null)
      : { data: [] };
    const picked = selectShipment(order, containerIds, byOrder || [], byContainer || []);

    if (!picked.shipment) {
      state = picked.association === 'ambiguous'
        ? JOURNEY_STATES.SHIPMENT_AMBIGUOUS
        : (loadState || JOURNEY_STATES.NO_SHIPMENT);
      if (picked.association === 'ambiguous') {
        exceptions.push({
          code: 'SHIPMENT_AMBIGUOUS',
          note: 'More than one shipment could match this order. No movement is shown until that is resolved.',
        });
      }
      shipping = {
        association: picked.association,
        ...(picked.candidate_count ? { candidate_count: picked.candidate_count } : {}),
        dates: null,
        references: null,
        legs: NOT_YET_COMPOSED('T11'),
      };
    } else {
      const shipment = picked.shipment;
      const { data: events } = await client.from(STAGE_EVENTS).select('*')
        .eq('shipment_id', shipment.id).is('deleted_at', null);
      const movement = projectMovement(events);
      const dates = projectDates(shipment);
      timeline.push(...movement);

      // Derived from OBSERVED facts, not from the status enum, which can carry customs and release
      // values the shipment authority must never report as a journey state.
      state = JOURNEY_STATES.SHIPMENT_CREATED;
      if (dates.observed_departure) state = JOURNEY_STATES.IN_TRANSIT;
      if (dates.observed_arrival) state = JOURNEY_STATES.ARRIVED;
      const latestException = movement.filter((e) => ['EXCEPTION', 'CUSTOMS_HOLD'].includes(e.stage)).slice(-1)[0] || null;
      if (latestException && !dates.observed_arrival) {
        state = JOURNEY_STATES.EXCEPTION;
        exceptions.push({
          code: 'SHIPMENT_EXCEPTION',
          stage: latestException.stage,
          recorded_at: latestException.event_time,
          note: 'This is what the organiser recorded about this shipment. It is not a customs decision.',
        });
      }
      if (picked.association === 'order_container_mismatch') {
        exceptions.push({
          code: 'ORDER_CONTAINER_MISMATCH',
          note: 'A shipment is attached to this order but sails on a different container than this booking. The records disagree.',
        });
      }
      shipping = {
        association: picked.association,
        reference: `SHPM-${String(shipment.id).replace(/-/g, '').slice(0, 8).toUpperCase()}`,
        dates,
        references: projectReferences(shipment),
        legs: NOT_YET_COMPOSED('T11'),
      };
    }
  }

  timeline.sort((a, b) => String(a.event_time || '').localeCompare(String(b.event_time || '')));

  const { data: vehicle } = order.linked_vehicle_vin
    ? await client.from(VEHICLES).select('*').eq('vin', order.linked_vehicle_vin).maybeSingle()
    : { data: null };

  return {
    subject: { type, id, order_id: order.id, ...(aliasReservation ? { reservation_id: aliasReservation.id } : {}) },
    viewer: { kind: viewer.kind },
    state,
    sentence: SENTENCE[state],
    asset: projectAsset(order, vehicle, viewer.privateAccess),
    transaction: {
      order_id: order.id,
      status: order.status || null,
      origin_country: order.origin_country || null,
      origin_city: order.origin_city || null,
      destination_country: order.destination_country || null,
      destination_city: order.destination_city || null,
    },
    shipping,
    timeline,
    exceptions,
    contacts: {
      consignee: projectConsignee(order, viewer.privateAccess),
      agents: NOT_YET_COMPOSED('T12'),
    },
    sections: sectionsPlaceholder(),
    provenance: {
      asset: { authority: vehicle ? 'vehicles' : 'unknown', note: 'Only recorded fields. A request is not a vehicle.' },
      transaction: { authority: 'T4' },
      journey: { authority: 'T11 + T10 (derived, read-only)' },
      shipping: { authority: 'T11', association: shipping.association },
      timeline: { authority: 'T11 + T10' },
      contacts: { authority: 'intake (T3)', note: 'Private: shown only to the order owner and platform admins.' },
    },
    generated_at: new Date().toISOString(),
    note: NOTE,
  };
}
