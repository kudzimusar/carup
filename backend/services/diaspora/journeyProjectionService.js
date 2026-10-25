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
 * Choosing the shipment (CAP-01 Part B §4.1, tightened by T11-CAP-LR01-R1 D2). A shipment belongs to ONE
 * import order. Sharing a container is not an association: a shipment attached to another order is never
 * this order's journey, however the two are co-loaded. `createShipment` has no uniqueness rule, so two
 * shipments for one order are possible, and this projection never picks one arbitrarily:
 *
 *   tier 1  attached to THIS order (and on its container, when it has one)
 *   tier 2  attached to this order but sailing on a DIFFERENT container (inconsistent — shown, flagged)
 *
 * The best tier present decides. Exactly one in that tier → selected. More than one → AMBIGUOUS, and
 * no movement is claimed at all. T11's participant view was brought to the same rule in R1 (D2).
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
import { listLegsForShipment, projectLeg } from './shipmentLegRead.js';
import { listEtaRevisionsForShipment, projectEta } from './shipmentObservationRead.js';
import { buildDocumentWorkspace } from './tradeDocumentWorkspaceService.js';
import { findCaseForSubject } from './customsCaseService.js';
import { getMyCustomsStatus } from './customsProjectionService.js';
import { projectLaneStatistics, projectOwnMetrics } from './journeyIntelligence.js';

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

/** Nothing to compose here: there is no shipment shown, so there is no vessel to attach. */
const NOT_APPLICABLE = Object.freeze({ availability: 'not_applicable' });

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
export function selectShipment(order, containerIds, byOrder = []) {
  const candidates = [...new Map((byOrder || []).filter((s) => s && !s.deleted_at).map((s) => [s.id, s])).values()];
  const sails = (s) => containerIds.length > 0 && containerIds.includes(normalizeId(s.container_id));
  // The association is the ORDER. A shipment that merely sails on this order's container is some other
  // order's, and is never selected (D2).
  const mine = (s) => normalizeId(s.import_order_id) === normalizeId(order.id);

  const tier1 = candidates.filter((s) => mine(s) && (containerIds.length === 0 || sails(s)));
  const tier2 = candidates.filter((s) => !tier1.includes(s) && mine(s));

  const pick = (tier, association) => {
    if (tier.length === 1) return { shipment: tier[0], association };
    if (tier.length > 1) return { shipment: null, association: 'ambiguous', candidate_count: tier.length };
    return null;
  };
  return pick(tier1, 'order') || pick(tier2, 'order_container_mismatch')
    || { shipment: null, association: 'none' };
}

const portKey = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Two port names agree if either contains the other once punctuation and case are ignored. Unknown agrees with anything. */
function portsAgree(a, b) {
  const x = portKey(a);
  const y = portKey(b);
  if (!x || !y) return true;
  return x.includes(y) || y.includes(x);
}

/**
 * Do the declared legs contradict the shipment record? Only the two ENDS of the journey are compared —
 * the first loading port with the shipment's origin, the last discharge port with its destination —
 * because the ports in between belong to a transshipment, not to the shipment record.
 */
function legsContradictShipmentPorts(legRows, shipment) {
  const ordered = legRows.slice().sort((a, b) => a.leg_sequence - b.leg_sequence);
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  return !portsAgree(first.port_of_loading, shipment.origin_port) || !portsAgree(last.port_of_discharge, shipment.destination_port);
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
    sections: { ...sectionsPlaceholder(), documents: NOT_APPLICABLE, actions: NOT_APPLICABLE, customs: NOT_APPLICABLE, intelligence: NOT_APPLICABLE },
    provenance: {},
    note: NOTE,
  };
}

const NOTE = 'This is a composition of records owned elsewhere. It records nothing and decides nothing.';

function sectionsPlaceholder() {
  return {
    payments: NOT_YET_COMPOSED('T13'),
    notifications: NOT_YET_COMPOSED('T7'),
  };
}

/**
 * The documents a journey is about: the shipping evidence, in the order a customer thinks of them.
 * (Customs documents are CAP-07's, and identity documents are not a journey's business.)
 */
export const JOURNEY_DOCUMENT_TYPES = Object.freeze([
  'bill_of_lading', 'commercial_invoice', 'export_certificate', 'inspection_certificate', 'insurance_certificate', 'packing_list',
]);

/**
 * Documents are T8's. This COMPOSES T8's own workspace — it does not re-implement who may see a
 * document or what state it is in — trims it to the journey's documents, and forwards no document id,
 * no user id (who supplied or reviewed it), no storage path and no extraction id. T8's authority for an
 * order's documents is narrower than the Journey's (it does not admit a tenant admin or an assigned
 * participant), so a viewer can be allowed the Journey and refused its documents: that is reported as
 * WITHHELD, not as an error. If T8 cannot be read at all the section says UNAVAILABLE — it never fails
 * the journey, and it never implies there are no documents.
 */
async function composeDocuments(client, order, context) {
  try {
    const workspace = await buildDocumentWorkspace('import_order', order.id, context, { supabaseClient: client });
    const byCode = new Map((workspace.items || []).map((i) => [i.document_type, i]));
    const items = JOURNEY_DOCUMENT_TYPES.map((code) => byCode.get(code)).filter(Boolean).map((i) => ({
      document_type: i.document_type,
      display_name: i.display_name,
      verification_required: Boolean(i.verification_required),
      state: i.state,
      note: i.note,
      document: i.document ? {
        version: i.document.version,
        supplied_at: i.document.supplied_at,
        reviewed_at: i.document.reviewed_at,
        has_extraction: i.document.has_extraction,
        has_earlier_versions: i.document.has_earlier_versions,
      } : null,
    }));
    const count = (state) => items.filter((i) => i.state === state).length;
    return {
      availability: 'composed',
      items,
      summary: {
        total: items.length,
        supplied: items.filter((i) => i.document).length,
        verified: count('VERIFIED'),
        awaiting_review: count('AWAITING_REVIEW'),
        rejected: count('REJECTED'),
        requested_outstanding: count('REQUESTED'),
      },
      disclaimer: workspace.disclaimer,
    };
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { availability: 'withheld', note: 'The documents for this order are not available to you here.' };
    }
    // eslint-disable-next-line no-console
    console.warn('[journey] documents could not be read:', err?.message);
    return { availability: 'unavailable', note: 'The documents could not be read right now. That does not mean there are none.' };
  }
}

/**
 * Customs is T12's. This calls T12's own participant status and forwards it — it does not re-derive a
 * step, an amount, a sentence or a handoff, and it never states a customs outcome of its own. T12's
 * authority (the cargo booking's buyer) is narrower than the Journey's, so every other viewer is told the
 * section is WITHHELD, and that answer is the same whether or not a case exists (T12 refuses first, so
 * there is nothing to probe). Gateway arrival, destination arrival, release, collection and delivery stay
 * separate observations exactly as T12 keeps them.
 *
 * A customs case carries a shipment id and an order id that nobody verified when it was opened. Only
 * AFTER T12 has admitted the viewer, the case is checked against the shipment and order this Journey
 * resolved; where they disagree NOTHING from the case is shown (G10). A case linked to no shipment
 * contradicts nothing. Cargo that did not travel, an order with no container booking, and several
 * bookings that cannot be matched to one case each say so — none is "no customs".
 *
 * The result is `{ section, agents }`: the clearing agent is named only by display name, and follows the
 * customs section's availability because it is read from the same case.
 */
async function composeCustoms({ client, orderId, reservation, reservationCount, shipmentId, goodsNotOnShipment, context }) {
  const closed = (availability, note) => ({ section: { availability, note }, agents: { availability, note } });
  if (goodsNotOnShipment) {
    return closed('not_applicable', 'Your cargo is not on a shipment, so there is no customs journey to follow.');
  }
  if (!reservation) {
    return reservationCount > 1
      ? closed('ambiguous', 'More than one cargo booking is on this order, so customs cannot be matched to one of them. Open the journey from a booking to see its customs status.')
      : closed('not_applicable', 'Customs tracking follows a container booking, and this order has none.');
  }
  try {
    const status = await getMyCustomsStatus('cargo_reservation', reservation.id, context, { supabaseClient: client });
    if (status.state !== 'NO_CASE') {
      const kase = await findCaseForSubject('cargo_reservation', reservation.id, { client });
      const wrongShipment = Boolean(kase?.shipment_id) && String(kase.shipment_id) !== String(shipmentId || '');
      const wrongOrder = Boolean(kase?.import_order_id) && String(kase.import_order_id) !== String(orderId);
      if (wrongShipment || wrongOrder) {
        return {
          ...closed('disagrees', 'The customs case for this booking is linked to a different shipment or order than the one shown here, so none of it is shown. The records disagree.'),
          mismatch: true,
        };
      }
    }
    return {
      section: {
        availability: 'composed',
        state: status.state,
        reference: status.reference ?? null,
        sentence: status.sentence,
        checklist: status.checklist,
        assessment: status.assessment,
        payment: status.payment,
        release: status.release,
        handoffs: status.handoffs,
        timeline: status.timeline,
        next_action: status.next_action,
        note: status.note,
        unknown_note: status.unknown_note,
        link: { type: 'customs_status', subject: { type: 'cargo_reservation', id: reservation.id } },
      },
      agents: {
        availability: 'composed',
        items: status.agent ? [{ display_name: status.agent.display_name, role: 'Clearing agent', note: status.agent.note }] : [],
        note: status.agent_note || (status.agent ? 'A clearing agent is named only where one has been appointed for this cargo.' : 'No clearing agent is recorded for this cargo yet.'),
      },
    };
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return closed('withheld', 'Customs status for this cargo is not available to you here.');
    }
    // eslint-disable-next-line no-console
    console.warn('[journey] customs could not be read:', err?.message);
    return closed('unavailable', 'Customs status could not be read right now. That does not mean nothing has happened.');
  }
}

/**
 * What is waiting on whom — derived ONLY from recorded authority state (T8's document states and the
 * exceptions already established above). Nothing here invents an obligation: a document that is merely
 * missing is not a demand, and one that is verified, present or not applicable asks for nothing. For
 * anyone but the buyer, "your action" becomes "the buyer's".
 */
function deriveActions({ viewer, documents, customs, exceptions, orderId, reservationId }) {
  const you = viewer.kind === 'OWNER';
  const whose = you ? 'you' : 'the buyer';
  const link = { type: 'document_workspace', subject: { type: 'import_order', id: orderId } };
  const items = [];

  if (documents.availability === 'composed') {
    for (const d of documents.items) {
      if (d.state === 'REQUESTED') {
        items.push({
          kind: you ? 'YOUR_ACTION' : 'WAITING_ON', code: 'DOCUMENT_REQUESTED', waiting_on: whose, link,
          text: you ? `Supply your ${d.display_name}. It has been requested.` : `The ${d.display_name} has been requested and has not been supplied.`,
        });
      } else if (d.state === 'REJECTED') {
        items.push({
          kind: you ? 'YOUR_ACTION' : 'WAITING_ON', code: 'DOCUMENT_REJECTED', waiting_on: whose, link,
          text: you ? `Supply a corrected ${d.display_name}. The one on file was reviewed and rejected.` : `A corrected ${d.display_name} is needed. The one on file was reviewed and rejected.`,
        });
      } else if (d.state === 'AWAITING_REVIEW') {
        items.push({ kind: 'WAITING_ON', code: 'DOCUMENT_AWAITING_REVIEW', waiting_on: 'CarUp review', link, text: `The ${d.display_name} is waiting for CarUp to check it.` });
      }
    }
  }

  // Customs documents the clearing agent asked for and nobody has supplied. Only a RECORDED request is a
  // step: T12's "next" step is what has not been recorded yet, and an unrecorded step is not an obligation.
  if (customs.availability === 'composed' && customs.state === 'IN_PROGRESS' && reservationId) {
    // T12's participant view drops the checklist's `requested` flag; the recorded request is in its timeline.
    const docs = (customs.checklist || []).find((st) => st.key === 'DOCUMENTS');
    const asked = (customs.timeline || []).some((e) => e.event_type === 'DOCUMENT_REQUESTED');
    if (docs && asked && docs.state === 'NOT_RECORDED') {
      items.push({
        kind: you ? 'YOUR_ACTION' : 'WAITING_ON', code: 'CUSTOMS_DOCUMENTS_REQUESTED', waiting_on: whose,
        link: { type: 'customs_status', subject: { type: 'cargo_reservation', id: reservationId } },
        text: you ? 'The clearing agent has asked for customs documents. Supply them on the customs page.' : 'Customs documents have been requested and have not been supplied.',
      });
    }
  }

  const ORGANISER = {
    SHIPMENT_AMBIGUOUS: 'The organiser needs to resolve which shipment belongs to this order.',
    SHIPMENT_EXCEPTION: 'The organiser recorded a problem with the shipment. Ask the organiser what it means; this is not a customs decision.',
    LEG_PORT_MISMATCH: 'The vessel details and the shipment record name different ports. The organiser needs to correct one of them.',
    ORDER_CONTAINER_MISMATCH: 'The records disagree about which container this order is on. The organiser needs to resolve it.',
    CUSTOMS_CASE_MISMATCH: 'The customs case and the shipment record disagree about which shipment or order the case belongs to. The organiser needs to resolve it.',
  };
  for (const e of exceptions) {
    if (ORGANISER[e.code]) items.push({ kind: 'WAITING_ON', code: e.code, waiting_on: 'the organiser', text: ORGANISER[e.code] });
  }

  // Why document steps are missing differs: a refusal is not a failure to read, and each says its own.
  let caveat = '';
  if (documents.availability === 'withheld') caveat = 'Document steps are not shown because the documents are not available to you here. ';
  else if (documents.availability === 'unavailable') caveat = 'Document steps are not shown because the documents could not be read right now. ';
  // Customs steps can be missing for the same kind of reason; each says its own.
  const CUSTOMS_CAVEAT = {
    withheld: 'Customs steps are not shown because customs status is not available to you here. ',
    unavailable: 'Customs steps are not shown because customs status could not be read right now. ',
    ambiguous: 'Customs steps are not shown because customs cannot be matched to one booking. ',
    disagrees: 'Customs steps are not shown because the customs case disagrees with the shipment record. ',
  };
  caveat += CUSTOMS_CAVEAT[customs.availability] || '';
  return {
    availability: 'composed',
    items,
    note: `${caveat}Steps are listed only where a record says someone must act. An empty list does not mean nothing is needed.`,
  };
}

/** The short reference a customer sees for a shipment — shared so an alert and the Journey print the same one. */
export function shipmentReference(shipmentId) {
  return `SHPM-${String(shipmentId).replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

/**
 * Which shipment, if any, is THIS order's journey.
 *
 * One rule, used by the Journey AND by the alerts (journeyAlertNotifier), so the people told that a
 * shipment moved are exactly the people whose Journey shows that shipment — not a second implementation
 * of "who is on this ship" that could drift from it. It reads the order's live bookings, the load ladder
 * for the booking in play, and the candidate shipments, and returns the evidence; it writes nothing.
 *
 * The load ladder applies only when exactly one booking is in play (or the caller named a booking);
 * otherwise no claim is made from it. Cargo that was left behind, or was never loaded, has no journey
 * to follow, and a container-level shipment is not theirs to read.
 */
export async function resolveJourneyShipment(client, order, aliasReservation = null) {
  const { data: reservations } = await client.from(RESERVATIONS).select('*')
    .eq('import_order_id', order.id).is('deleted_at', null);
  const liveReservations = reservations || [];
  const containerIds = [...new Set(liveReservations.map((r) => normalizeId(r.container_id)).filter(Boolean))];

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

  const goodsNotOnShipment = loadState === JOURNEY_STATES.LEFT_BEHIND || loadState === JOURNEY_STATES.NOT_LOADED;
  let picked = null;
  if (!goodsNotOnShipment) {
    const { data: byOrder } = await client.from(SHIPMENTS).select('*')
      .eq('import_order_id', order.id).is('deleted_at', null);
    picked = selectShipment(order, containerIds, byOrder || []);
  }
  return { liveReservations, containerIds, ladderReservation, loadState, loadRecord, goodsNotOnShipment, picked };
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

  // Which shipment is this order's journey — the same rule the alerts use (resolveJourneyShipment).
  const {
    liveReservations, ladderReservation, loadState, loadRecord, goodsNotOnShipment, picked,
  } = await resolveJourneyShipment(client, order, aliasReservation);

  const timeline = [];
  if (loadState === JOURNEY_STATES.LOADED && loadRecord?.confirmed_at) {
    timeline.push({ kind: 'LOAD', stage: 'LOADED', event_time: loadRecord.confirmed_at, location: null, source: 'T10' });
  }

  const exceptions = [];
  let state;
  let shipping;
  let resolvedShipmentId = null;
  // CAP-09. Statistics exist only for a shipment the Journey plainly resolved; everything else says there are none.
  let intelligence = NOT_APPLICABLE;
  const now = options.now ? new Date(options.now) : new Date();

  if (goodsNotOnShipment) {
    // Cargo that did not travel has no journey to follow, and a container-level shipment is not theirs to read.
    state = loadState;
    shipping = { association: 'not_applicable', dates: null, references: null, legs: NOT_APPLICABLE, eta: NOT_APPLICABLE };
  } else {
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
        legs: NOT_APPLICABLE,
        eta: NOT_APPLICABLE,
      };
    } else {
      const shipment = picked.shipment;
      resolvedShipmentId = shipment.id;
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
      // Vessel legs are DECLARED facts (CAP-04). They are listed and labelled as such, and they cannot
      // move the state above: nothing in a leg can say a vessel sailed or arrived.
      const legRows = await listLegsForShipment(shipment.id, client);
      const legs = {
        availability: 'composed',
        items: legRows.map(projectLeg),
        note: legRows.length
          ? 'Vessel and voyage details are declared, not observed. They do not record that the vessel sailed or arrived.'
          : 'No vessel or voyage has been declared for this shipment.',
      };
      if (legRows.length && legsContradictShipmentPorts(legRows, shipment)) {
        exceptions.push({
          code: 'LEG_PORT_MISMATCH',
          note: 'The vessel details name different ports than the shipment record. The records disagree.',
        });
      }
      // The estimate, current BESIDE original. An accepted revision is an observation shown next to the
      // shipment record's own estimate, never written over it — and an estimate is never an arrival.
      const eta = projectEta(shipment, await listEtaRevisionsForShipment(shipment.id, client));
      // Derived only from RECORDED observations, and only where the association is plain: an inconsistent
      // one is flagged on the Journey, so statistics about it would be statistics about a disagreement.
      if (picked.association === 'order') {
        intelligence = {
          availability: 'composed',
          own: projectOwnMetrics(dates, now),
          lane: await projectLaneStatistics(client, shipment),
          note: 'Derived from recorded dates only. It describes what has been recorded and what has already been completed, and predicts nothing.',
        };
      }
      shipping = {
        association: picked.association,
        reference: shipmentReference(shipment.id),
        dates,
        references: projectReferences(shipment),
        legs,
        eta,
      };
    }
  }

  timeline.sort((a, b) => String(a.event_time || '').localeCompare(String(b.event_time || '')));

  const { data: vehicle } = order.linked_vehicle_vin
    ? await client.from(VEHICLES).select('*').eq('vin', order.linked_vehicle_vin).maybeSingle()
    : { data: null };

  // Documents are T8's and are composed from it; next steps are derived only from recorded state.
  const documents = await composeDocuments(client, order, context);

  // Customs is T12's, composed only after T12 has admitted the viewer, then checked against the shipment
  // and order this journey resolved. A disagreement is surfaced as an exception and shows nothing of the case.
  const { section: customs, agents, mismatch } = await composeCustoms({
    client, orderId: order.id, reservation: ladderReservation, reservationCount: liveReservations.length,
    shipmentId: resolvedShipmentId, goodsNotOnShipment, context,
  });
  if (mismatch) {
    exceptions.push({
      code: 'CUSTOMS_CASE_MISMATCH',
      note: 'The customs case for this booking is linked to a different shipment or order than the one shown here. The records disagree.',
    });
  }
  const actions = deriveActions({ viewer, documents, customs, exceptions, orderId: order.id, reservationId: ladderReservation?.id || null });

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
      agents,
    },
    sections: { ...sectionsPlaceholder(), documents, customs, actions, intelligence },
    provenance: {
      asset: { authority: vehicle ? 'vehicles' : 'unknown', note: 'Only recorded fields. A request is not a vehicle.' },
      transaction: { authority: 'T4' },
      journey: { authority: 'T11 + T10 (derived, read-only)' },
      shipping: { authority: 'T11', association: shipping.association },
      timeline: { authority: 'T11 + T10' },
      legs: { authority: 'declared legs', note: 'Declared by the organiser, not observed.' },
      documents: { authority: 'T8', note: 'Read from the document workspace; nothing is stored here.' },
      intelligence: { authority: 'derived', note: 'Derived from recorded shipment dates. Nothing is stored and nothing is predicted.' },
      customs: { authority: 'T12', note: 'Read from the customs record; nothing is stored here. CarUp coordinates customs; it does not decide it.' },
      eta: { authority: 'estimate revisions', note: 'Recorded by the organiser; shown beside the shipment record, not over it.' },
      contacts: { authority: 'intake (T3)', note: 'Private: shown only to the order owner and platform admins.' },
    },
    generated_at: new Date().toISOString(),
    note: NOTE,
  };
}
