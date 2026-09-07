/**
 * Trade OS T11.2/T11.3 — the shipment timeline, projected for the two people who read it.
 *
 * It PROJECTS. It is not an authority: it creates nothing, moves nothing, and every fact it reports
 * is read from the layer that owns it — `diaspora_shipments` and `diaspora_shipment_stage_events`
 * for movement, the T10 load for what is inside the container, T5 for the sailing.
 *
 * Three distinctions the projection exists to keep visible, because collapsing any of them is how a
 * tracking page starts lying:
 *
 *     PLANNED departure  ≠  OBSERVED departure   — an intention is not a sailing
 *     ETA                ≠  ACTUAL ARRIVAL        — an estimate is not an event
 *     a carrier reference ≠ movement              — a booking number is not a ship leaving
 *
 * And the participant view carries one more, inherited from T10: **LOADED is not SAILED.**
 */
import { ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import {
  requireUserContext,
  isPlatformAdmin,
  isPlatformReviewer,
  isTenantAdminForRecord,
  normalizeId,
} from './diasporaAuthorization.js';
import { resolveClient } from './diasporaServiceUtils.js';

const SHIPMENTS = 'diaspora_shipments';
const STAGE_EVENTS = 'diaspora_shipment_stage_events';
const CONTAINERS = 'diaspora_container_shipments';
const RESERVATIONS = 'diaspora_cargo_reservations';
const LOADS = 'diaspora_container_loads';
const LOAD_ITEMS = 'diaspora_container_load_items';
const SEALS = 'diaspora_container_seal_records';
const ORDERS = 'diaspora_import_orders';

const privileged = (ctx) => isPlatformAdmin(ctx) || isPlatformReviewer(ctx);

/**
 * What a participant is allowed to be told, and in what words.
 *
 * `SHIPMENT_CREATED` is the one that needed care. A shipment record existing means paperwork has
 * begun, not that anything moved — and a customer reading a new row on a tracking page will assume
 * their goods are on the way unless told otherwise.
 */
export const TRACKING_STATES = Object.freeze({
  NOT_LOADED: 'NOT_LOADED',
  LOADED: 'LOADED',
  SHIPMENT_CREATED: 'SHIPMENT_CREATED',
  IN_TRANSIT: 'IN_TRANSIT',
  ARRIVED: 'ARRIVED',
  EXCEPTION: 'EXCEPTION',
  LEFT_BEHIND: 'LEFT_BEHIND',
});

const TRACKING_SENTENCE = Object.freeze({
  NOT_LOADED: 'Your cargo has not been loaded into a container yet.',
  LOADED: 'Your cargo is inside the container. The container has not been recorded as leaving.',
  SHIPMENT_CREATED: 'A shipment has been set up for your container. Nothing has been recorded as moving yet.',
  IN_TRANSIT: 'Your container has left and is on its way.',
  ARRIVED: 'Your container has arrived.',
  EXCEPTION: 'Something has happened to your shipment that the organiser has recorded.',
  LEFT_BEHIND: 'Your cargo was not loaded into this container.',
});

function requireText(value, field) {
  const text = String(value ?? '').trim();
  if (!text) throw new ValidationError(`${field} is required`);
  return text;
}

/** Who runs this sailing. The same predicate T5, T7 and T10 use. */
function isOperatorOf(container, context) {
  if (!container) return privileged(context);
  const coordinator = normalizeId(container.coordinator_id || container.created_by);
  if (coordinator && coordinator === context.id) return true;
  return privileged(context) || isTenantAdminForRecord(container, context);
}

/**
 * Split the record's dates into what was INTENDED and what was OBSERVED.
 *
 * `departure_date` is only ever written by an actual `IN_TRANSIT` transition (T11.1), and the plan
 * lives in metadata. Reading them back apart is what stops a screen showing an intention as an event.
 */
function projectDates(shipment) {
  const meta = shipment.metadata || {};
  return {
    planned_departure: meta.planned_departure_date || null,
    planned_departure_source: meta.planned_departure_date ? (meta.planned_departure_source || 'stated') : null,
    // Written only by an observed movement. Null means nobody has recorded it leaving.
    observed_departure: shipment.departure_date || null,
    // An ESTIMATE. It may move, and moving it is not an arrival.
    estimated_arrival: shipment.estimated_arrival_date || null,
    // Written only by an observed ARRIVED transition.
    observed_arrival: shipment.actual_arrival_date || null,
    note: 'A planned departure is an intention. An estimated arrival is an estimate. Only the observed dates are records of something that happened.',
  };
}

/**
 * References, reported only where somebody actually supplied them.
 *
 * A carrier or tracking number existing says paperwork was done, never that a ship left — so this
 * returns them alongside an explicit statement of that, rather than letting a populated field imply
 * movement.
 */
function projectReferences(shipment, seal) {
  return {
    carrier: shipment.carrier_name || null,
    tracking_reference: shipment.tracking_number || null,
    origin_port: shipment.origin_port || null,
    destination_port: shipment.destination_port || null,
    container_number: seal?.container_number || null,
    seal_number: seal?.seal_number || null,
    note: 'A carrier or tracking reference means the paperwork exists. It is not a record that anything has moved.',
  };
}

function currentSeal(rows = []) {
  const live = (rows || []).filter((r) => !r.deleted_at);
  if (!live.length) return null;
  return live.slice().sort((a, b) => String(b.recorded_at || '').localeCompare(String(a.recorded_at || '')))[0];
}

/** The timeline, oldest first, each event carrying who said so and when. */
function projectTimeline(events = []) {
  return (events || [])
    .filter((e) => !e.deleted_at)
    .slice()
    .sort((a, b) => String(a.event_time || '').localeCompare(String(b.event_time || '')))
    .map((e) => ({
      id: e.id,
      stage: e.stage,
      event_time: e.event_time,
      // Unknown stays unknown. No port is inferred from a stage name.
      location: e.location || null,
      notes: e.notes || null,
      recorded_by: e.created_by || null,
      recorded_at: e.created_at || null,
      // Where the fact came from, when anything said. Never guessed.
      source: e.metadata?.source || null,
    }));
}

/**
 * The operator's whole picture of one shipment.
 *
 * Bounded reads: six queries regardless of how long the timeline is.
 */
export async function getShipmentOperatorView(shipmentId, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const id = requireText(shipmentId, 'shipmentId');

  const { data: shipment } = await client.from(SHIPMENTS).select('*').eq('id', id).is('deleted_at', null).maybeSingle();
  if (!shipment) throw new NotFoundError('Shipment not found');

  const { data: container } = shipment.container_id
    ? await client.from(CONTAINERS).select('*').eq('id', shipment.container_id).is('deleted_at', null).maybeSingle()
    : { data: null };

  // Authority comes from the sailing when there is one, and from the platform otherwise. A
  // participant is refused here and served by getMyShipmentTracking instead.
  if (!isOperatorOf(container, context)) {
    throw new ForbiddenError('You are not authorized to manage this shipment');
  }

  const [{ data: events }, { data: loads }] = await Promise.all([
    client.from(STAGE_EVENTS).select('*').eq('shipment_id', id).is('deleted_at', null),
    shipment.container_id
      ? client.from(LOADS).select('*').eq('container_id', shipment.container_id).is('deleted_at', null)
      : Promise.resolve({ data: [] }),
  ]);

  const load = (loads || []).find((l) => String(l.status) === 'COMPLETED') || (loads || [])[0] || null;
  const [{ data: items }, { data: seals }] = await Promise.all([
    load ? client.from(LOAD_ITEMS).select('*').eq('load_id', load.id).is('deleted_at', null) : Promise.resolve({ data: [] }),
    load ? client.from(SEALS).select('*').eq('load_id', load.id).is('deleted_at', null) : Promise.resolve({ data: [] }),
  ]);

  const loaded = (items || []).filter((i) => i.outcome === 'LOADED');
  const leftBehind = (items || []).filter((i) => i.outcome === 'LEFT_BEHIND');

  return {
    shipment: {
      id: shipment.id,
      reference: `SHPM-${String(shipment.id).replace(/-/g, '').slice(0, 8).toUpperCase()}`,
      stage: shipment.status,
      import_order_id: shipment.import_order_id,
      container_id: shipment.container_id || null,
    },
    dates: projectDates(shipment),
    references: projectReferences(shipment, currentSeal(seals)),
    // Where this shipment came from. A shipment exists because a container was loaded, and the
    // operator should be able to see that rather than take it on trust.
    load: load ? {
      id: load.id,
      reference: load.reference,
      status: load.status,
      completed_at: load.confirmed_at || null,
      loaded_lines: loaded.length,
      // Left-behind cargo stays historically attached to the load and is NOT travelling. Both
      // numbers are shown so the operator can see the difference.
      left_behind_lines: leftBehind.length,
      actual_loaded_volume_cbm: load.actual_loaded_volume_cbm === null || load.actual_loaded_volume_cbm === undefined
        ? null : Number(load.actual_loaded_volume_cbm),
    } : null,
    timeline: projectTimeline(events),
    // Said in the payload so no screen can imply otherwise.
    note: 'This is what has been recorded about the shipment moving. Customs, duties and release are recorded separately and are not shown here.',
  };
}

/**
 * What ONE participant may see about their own cargo's journey.
 *
 * Authorized from the CARGO, not the sailing. A co-loader owns a different booking and learns
 * nothing about this one — and the projection deliberately carries no other participant's line, no
 * operator identity, no sailing total, and no consignee or commercial detail.
 *
 * The state ladder is derived from facts other phases own, and stops where T11's knowledge stops:
 * customs and destination states are T12's, so this never reports them however tempting the
 * shipment's own status enum makes it.
 */
export async function getMyShipmentTracking(subjectType, subjectId, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  if (String(subjectType) !== 'cargo_reservation') {
    throw new ValidationError('Tracking is currently available for container bookings only');
  }
  const id = requireText(subjectId, 'subjectId');

  const { data: reservation } = await client.from(RESERVATIONS).select('*').eq('id', id).is('deleted_at', null).maybeSingle();
  if (!reservation) throw new NotFoundError('That cargo booking does not exist');

  const owners = [reservation.buyer_id, reservation.created_by].map(normalizeId).filter(Boolean);
  if (!owners.includes(context.id) && !privileged(context) && !isTenantAdminForRecord(reservation, context)) {
    throw new ForbiddenError('This is not your cargo');
  }

  const { data: loads } = await client.from(LOADS).select('*')
    .eq('container_id', reservation.container_id).is('deleted_at', null);
  const load = (loads || []).find((l) => ['IN_PROGRESS', 'COMPLETED'].includes(String(l.status))) || null;
  const { data: mine } = load
    ? await client.from(LOAD_ITEMS).select('*').eq('load_id', load.id)
      .eq('subject_type', 'cargo_reservation').eq('subject_id', id).is('deleted_at', null).maybeSingle()
    : { data: null };

  // Cargo that did not travel gets the truth and stops there. Nothing about the shipment's journey
  // is theirs to read — their goods are not on it.
  if (mine && mine.outcome === 'LEFT_BEHIND') {
    return {
      subject: { type: 'cargo_reservation', id },
      state: TRACKING_STATES.LEFT_BEHIND,
      sentence: TRACKING_SENTENCE.LEFT_BEHIND,
      left_behind_reason: mine.left_behind_reason || null,
      dates: null,
      references: null,
      timeline: [],
      note: 'Your cargo is not on this container, so there is no journey to follow. What happens to it next is arranged with the organiser.',
    };
  }

  if (!mine || mine.outcome !== 'LOADED') {
    return {
      subject: { type: 'cargo_reservation', id },
      state: TRACKING_STATES.NOT_LOADED,
      sentence: TRACKING_SENTENCE.NOT_LOADED,
      left_behind_reason: null,
      dates: null,
      references: null,
      timeline: [],
      note: 'Tracking begins once your cargo has been loaded into a container.',
    };
  }

  const { data: shipments } = await client.from(SHIPMENTS).select('*')
    .eq('container_id', reservation.container_id).is('deleted_at', null);
  const shipment = (shipments || [])[0] || null;

  if (!shipment) {
    return {
      subject: { type: 'cargo_reservation', id },
      state: TRACKING_STATES.LOADED,
      sentence: TRACKING_SENTENCE.LOADED,
      left_behind_reason: null,
      dates: null,
      references: null,
      timeline: [],
      // T10's clarification, carried forward because this is exactly the moment it is needed.
      note: 'Loaded means the cargo is inside the container. It does not mean the container has sailed.',
    };
  }

  const { data: events } = await client.from(STAGE_EVENTS).select('*')
    .eq('shipment_id', shipment.id).is('deleted_at', null);
  const timeline = projectTimeline(events);
  const dates = projectDates(shipment);

  // The state is derived from OBSERVED facts, not from the shipment's status enum — which can carry
  // customs and release values T11 must never report to a participant.
  let state = TRACKING_STATES.SHIPMENT_CREATED;
  if (dates.observed_departure) state = TRACKING_STATES.IN_TRANSIT;
  if (dates.observed_arrival) state = TRACKING_STATES.ARRIVED;
  const latestException = timeline.filter((e) => ['EXCEPTION', 'CUSTOMS_HOLD'].includes(e.stage)).slice(-1)[0] || null;
  if (latestException && !dates.observed_arrival) state = TRACKING_STATES.EXCEPTION;

  return {
    subject: { type: 'cargo_reservation', id },
    state,
    sentence: TRACKING_SENTENCE[state],
    left_behind_reason: null,
    dates,
    references: projectReferences(shipment, null),
    // The customer sees the movement events and nothing else — no notes about other participants,
    // no internal operator commentary. Stage, time and place only.
    timeline: timeline.map((e) => ({ stage: e.stage, event_time: e.event_time, location: e.location })),
    exception: latestException ? {
      stage: latestException.stage,
      recorded_at: latestException.event_time,
      // T11 records that the goods are held. It never says a declaration is being processed, that
      // duty was assessed, or that anything was cleared — T12 owns all of that.
      note: 'This is what the organiser recorded about your shipment. It is not a customs decision.',
    } : null,
    note: 'Customs, duties and release are recorded separately and are not shown here.',
  };
}
