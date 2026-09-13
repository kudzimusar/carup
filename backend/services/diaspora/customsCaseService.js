import { randomUUID } from 'node:crypto';
import { supabase } from '../../db/supabase.js';
import { DatabaseError, ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { writeDiasporaAudit } from './diasporaAuditService.js';
import {
  requireUserContext, isPlatformAdmin, isPlatformReviewer, isTenantAdminForRecord, isSailingOperator,
} from './diasporaAuthorization.js';

/**
 * Trade OS T12 — attributed customs coordination and Zimbabwe destination operations.
 *
 * >  CarUp coordinates customs. CarUp is not ZIMRA, and CarUp is not a licensed clearing agent.
 *
 * Every rule below follows from that. There is no calculator in this file. There is no rate, no
 * percentage, no formula and no threshold. `grep` it for a number and the only ones are string
 * lengths.
 *
 * The single load-bearing idea is `assertion_class`:
 *
 *   · `CARUP_OBSERVED` — an authorized person physically saw this happen. CarUp may originate it.
 *     Only ever a physical fact: goods arrived somewhere, were collected, were delivered.
 *   · `ATTRIBUTED`     — somebody told us. Everything a customs authority does reaches CarUp this
 *     way, and it carries who said it, what they are to this case, when, and on what evidence.
 *
 * There is no third class, and in particular there is no class that means "true".
 */

const CASES = 'diaspora_customs_cases';
const APPOINTMENTS = 'diaspora_customs_agent_appointments';
const EVENTS = 'diaspora_customs_events';

export const CARGO_KINDS = Object.freeze(['GENERAL', 'VEHICLE']);

/**
 * The vocabulary, and what each type is allowed to mean.
 *
 * `VEHICLE_REGISTRATION` is deliberately absent. Registration is the CVR's act; a type for it here
 * is how a phase starts writing another authority's records.
 */
export const CUSTOMS_EVENT_TYPES = Object.freeze({
  DOCUMENT_REQUESTED: { observed: false, meaning: 'Somebody asked for a document. Nothing has been supplied.' },
  DOCUMENT_PROVIDED: { observed: false, meaning: 'A document was supplied. Presence is presence — it has not been accepted by anyone.' },
  LODGEMENT_REPORTED: { observed: false, meaning: 'Somebody reported lodging a declaration. CarUp did not lodge it and cannot confirm it.' },
  QUERY_RAISED: { observed: false, meaning: 'A query or action request was raised against the consignment.' },
  INSPECTION_EVIDENCE_RECEIVED: { observed: false, meaning: 'Evidence of an inspection was received.' },
  ASSESSMENT_EVIDENCE_RECEIVED: { observed: false, meaning: 'Evidence of an assessment was received. The amount is transcribed from that evidence, never computed.' },
  PAYMENT_EVIDENCE_RECEIVED: { observed: false, meaning: 'Evidence of a payment was received. That is not the same as an authority confirming payment.' },
  RELEASE_EVIDENCE_RECEIVED: { observed: false, meaning: 'Evidence of a release was received. CarUp does not release goods.' },
  GATEWAY_ARRIVAL_OBSERVED: { observed: true, meaning: 'The goods were seen at the gateway port. A gateway is not the destination.' },
  TRANSIT_TO_DESTINATION_STARTED: { observed: true, meaning: 'The goods left the gateway for the destination.' },
  DESTINATION_ARRIVAL_OBSERVED: { observed: true, meaning: 'The goods were seen at the destination. Arriving is not being released.' },
  PORT_RELEASE_OBSERVED: { observed: true, meaning: 'The goods physically left the port or depot. That is a movement, not a customs decision.' },
  COLLECTION_OBSERVED: { observed: true, meaning: 'An authorized person collected the goods.' },
  DELIVERY_OBSERVED: { observed: true, meaning: 'The goods were delivered to a receiver who acknowledged them.' },
});

export const CUSTOMS_EVENT_TYPE_KEYS = Object.freeze(Object.keys(CUSTOMS_EVENT_TYPES));

/** Physical facts CarUp may originate, because an authorized person actually saw them. */
export const CARUP_OBSERVABLE = Object.freeze(
  CUSTOMS_EVENT_TYPE_KEYS.filter((k) => CUSTOMS_EVENT_TYPES[k].observed),
);

/**
 * Who may assert what.
 *
 * The importer may supply their own payment receipt — that is their document and their claim, and
 * refusing it would make the product unusable for the person paying. They may NOT report a
 * lodgement, an assessment, an inspection or a release: a customer moving their own goods to cleared
 * is the self-clearing this phase exists to make impossible.
 */
export const WHO_MAY_ASSERT = Object.freeze({
  DOCUMENT_REQUESTED: ['APPOINTED_CLEARING_AGENT', 'CONTAINER_OPERATOR', 'CARUP_STAFF', 'PLATFORM_REVIEWER'],
  DOCUMENT_PROVIDED: ['APPOINTED_CLEARING_AGENT', 'IMPORTER', 'CONTAINER_OPERATOR', 'CARUP_STAFF', 'PLATFORM_REVIEWER'],
  LODGEMENT_REPORTED: ['APPOINTED_CLEARING_AGENT', 'CONTAINER_OPERATOR', 'CARUP_STAFF', 'PLATFORM_REVIEWER'],
  QUERY_RAISED: ['APPOINTED_CLEARING_AGENT', 'CONTAINER_OPERATOR', 'CARUP_STAFF', 'PLATFORM_REVIEWER'],
  INSPECTION_EVIDENCE_RECEIVED: ['APPOINTED_CLEARING_AGENT', 'CONTAINER_OPERATOR', 'CARUP_STAFF', 'PLATFORM_REVIEWER'],
  ASSESSMENT_EVIDENCE_RECEIVED: ['APPOINTED_CLEARING_AGENT', 'CONTAINER_OPERATOR', 'CARUP_STAFF', 'PLATFORM_REVIEWER'],
  PAYMENT_EVIDENCE_RECEIVED: ['APPOINTED_CLEARING_AGENT', 'IMPORTER', 'CONTAINER_OPERATOR', 'CARUP_STAFF', 'PLATFORM_REVIEWER'],
  RELEASE_EVIDENCE_RECEIVED: ['APPOINTED_CLEARING_AGENT', 'CONTAINER_OPERATOR', 'CARUP_STAFF', 'PLATFORM_REVIEWER'],
  GATEWAY_ARRIVAL_OBSERVED: ['CONTAINER_OPERATOR', 'APPOINTED_CLEARING_AGENT', 'CARUP_STAFF', 'PLATFORM_REVIEWER'],
  TRANSIT_TO_DESTINATION_STARTED: ['CONTAINER_OPERATOR', 'APPOINTED_CLEARING_AGENT', 'CARUP_STAFF', 'PLATFORM_REVIEWER'],
  DESTINATION_ARRIVAL_OBSERVED: ['CONTAINER_OPERATOR', 'APPOINTED_CLEARING_AGENT', 'CARUP_STAFF', 'PLATFORM_REVIEWER'],
  PORT_RELEASE_OBSERVED: ['CONTAINER_OPERATOR', 'APPOINTED_CLEARING_AGENT', 'CARUP_STAFF', 'PLATFORM_REVIEWER'],
  COLLECTION_OBSERVED: ['CONTAINER_OPERATOR', 'APPOINTED_CLEARING_AGENT', 'CARUP_STAFF', 'PLATFORM_REVIEWER'],
  DELIVERY_OBSERVED: ['CONTAINER_OPERATOR', 'APPOINTED_CLEARING_AGENT', 'CARUP_STAFF', 'PLATFORM_REVIEWER'],
});

/**
 * How strong a claim of each kind is entitled to be.
 *
 * §G: an agent typing an amount is an agent-reported amount. An amount transcribed from an
 * assessment document is an assessment amount. These must READ differently, so they are stored
 * differently — and `AUTHORITY_DOCUMENT` requires the document, enforced here and again by a CHECK
 * constraint, because a claim on the authority's name with nothing behind it is the exact shape of
 * the forgery T12.1 removed.
 */
export const SOURCE_KINDS = Object.freeze([
  'CARUP_OBSERVATION', 'AGENT_REPORT', 'AUTHORITY_DOCUMENT', 'IMPORTER_DOCUMENT', 'THIRD_PARTY_DOCUMENT',
]);

const shortRef = (prefix, id) => `${prefix}-${String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase()}`;

function requireText(value, field, { max = 500 } = {}) {
  const text = String(value ?? '').trim();
  if (!text) throw new ValidationError(`${field} is required`);
  if (text.length > max) throw new ValidationError(`${field} must be ${max} characters or fewer`);
  return text;
}

function optionalText(value, field, { max = 2000 } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  return requireText(value, field, { max });
}

/**
 * An amount is transcribed, never computed — and NEVER defaulted.
 *
 * `|| 50000` is how the removed forgery produced an amount nobody had assessed. An absent amount
 * stays absent: unknown is not zero, and zero is a real figure only when a source states it.
 */
function transcribedAmount(value, field) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new ValidationError(`${field} must be a number of zero or more, transcribed from the evidence`);
  return Math.round(n * 100) / 100;
}

const privileged = (ctx) => isPlatformAdmin(ctx) || isPlatformReviewer(ctx);

async function resolveClient(options = {}) {
  return options.supabaseClient || supabase;
}

/**
 * An observation cannot have happened at a time that has not happened.
 *
 * The same rule T11 applies to movement, for the same reason: a customs page showing an event dated
 * next week reads as something that has already occurred.
 */
export function observedAt(stated, now = new Date().toISOString()) {
  if (!stated) return now;
  const when = new Date(stated);
  if (Number.isNaN(when.getTime())) throw new ValidationError('That is not a valid date and time');
  if (when.getTime() > Date.parse(now) + 60_000) {
    throw new ValidationError('A customs or destination event cannot be recorded as happening in the future');
  }
  return when.toISOString();
}

// ── Authority ──────────────────────────────────────────────────────────────

/**
 * What this person is to this case, derived on the server.
 *
 * Never the client's word for it. A caller claiming to be the appointed agent is a caller claiming
 * something; the appointment row is what decides.
 */
export async function deriveRelationship(kase, context, { client = supabase } = {}) {
  if (isPlatformAdmin(context) || isPlatformReviewer(context)) return 'PLATFORM_REVIEWER';

  const { data: appointment } = await client.from(APPOINTMENTS).select('*')
    .eq('case_id', kase.id).eq('status', 'ACTIVE').is('deleted_at', null).maybeSingle();
  const userId = String(context.id || '');
  if (appointment && userId && String(appointment.agent_user_id || '') === userId) {
    return 'APPOINTED_CLEARING_AGENT';
  }

  if (kase.container_context && isSailingOperator(kase.container_context, context)) return 'CONTAINER_OPERATOR';
  if (isTenantAdminForRecord(kase, context)) return 'CONTAINER_OPERATOR';

  if (kase.importer_user_ids && kase.importer_user_ids.some((id) => String(id) === userId)) return 'IMPORTER';
  return null;
}

/**
 * Load a case together with everything authority is derived FROM, so no caller has to assemble it —
 * and so no caller can assemble it differently.
 */
export async function loadCaseContext(caseId, { client = supabase } = {}) {
  const { data: kase } = await client.from(CASES).select('*').eq('id', caseId).is('deleted_at', null).maybeSingle();
  if (!kase) throw new NotFoundError('That customs case does not exist');

  let container = null;
  if (kase.shipment_id) {
    const { data: shipment } = await client.from('diaspora_shipments').select('*').eq('id', kase.shipment_id).is('deleted_at', null).maybeSingle();
    if (shipment?.container_id) {
      const { data: c } = await client.from('diaspora_container_shipments').select('*').eq('id', shipment.container_id).is('deleted_at', null).maybeSingle();
      container = c || null;
    }
  }

  const importerIds = [];
  if (kase.subject_type === 'cargo_reservation') {
    const { data: reservation } = await client.from('diaspora_cargo_reservations').select('*').eq('id', kase.subject_id).is('deleted_at', null).maybeSingle();
    if (reservation) {
      for (const id of [reservation.buyer_id, reservation.created_by]) if (id) importerIds.push(String(id));
      if (!container && reservation.container_id) {
        const { data: c } = await client.from('diaspora_container_shipments').select('*').eq('id', reservation.container_id).is('deleted_at', null).maybeSingle();
        container = c || null;
      }
    }
  }
  if (kase.import_order_id) {
    const { data: order } = await client.from('diaspora_import_orders').select('*').eq('id', kase.import_order_id).is('deleted_at', null).maybeSingle();
    if (order) for (const id of [order.buyer_id, order.created_by]) if (id) importerIds.push(String(id));
  }

  return { ...kase, container_context: container, importer_user_ids: [...new Set(importerIds)] };
}

/** Reading a case at all. Everyone with a relationship may read; nobody else may. */
export async function assertCanReadCase(kase, context, { client = supabase } = {}) {
  const relationship = await deriveRelationship(kase, context, { client });
  if (!relationship) throw new ForbiddenError('You are not a party to this customs case');
  return relationship;
}

/** Opening or running a case — the coordination role, not the customs act. */
export async function assertCanCoordinate(kase, context, { client = supabase } = {}) {
  const relationship = await deriveRelationship(kase, context, { client });
  if (!['PLATFORM_REVIEWER', 'CONTAINER_OPERATOR'].includes(relationship || '')) {
    throw new ForbiddenError('You are not authorized to coordinate this customs case');
  }
  return relationship;
}

// ── Cases ──────────────────────────────────────────────────────────────────

export async function openCase(payload = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);

  const subjectType = requireText(payload.subject_type, 'subject_type');
  if (!['cargo_reservation', 'import_order', 'shipment'].includes(subjectType)) {
    throw new ValidationError('A customs case can only be opened against a cargo booking, an import order or a shipment');
  }
  const subjectId = requireText(payload.subject_id, 'subject_id');
  const cargoKind = payload.cargo_kind || 'GENERAL';
  if (!CARGO_KINDS.includes(cargoKind)) throw new ValidationError(`cargo_kind must be one of ${CARGO_KINDS.join(', ')}`);

  // Authority to open comes from the CONTAINER the cargo is on, the same way T10 and T11 derive it —
  // a diaspora buyer's import order has no tenant to derive anything from.
  let container = null;
  if (payload.shipment_id) {
    const { data: shipment } = await client.from('diaspora_shipments').select('*').eq('id', payload.shipment_id).is('deleted_at', null).maybeSingle();
    if (!shipment) throw new NotFoundError('That shipment does not exist');
    if (shipment.container_id) {
      const { data: c } = await client.from('diaspora_container_shipments').select('*').eq('id', shipment.container_id).is('deleted_at', null).maybeSingle();
      container = c || null;
    }
  } else if (subjectType === 'cargo_reservation') {
    const { data: reservation } = await client.from('diaspora_cargo_reservations').select('*').eq('id', subjectId).is('deleted_at', null).maybeSingle();
    if (reservation?.container_id) {
      const { data: c } = await client.from('diaspora_container_shipments').select('*').eq('id', reservation.container_id).is('deleted_at', null).maybeSingle();
      container = c || null;
    }
  }
  if (!privileged(context) && !(container && isSailingOperator(container, context))) {
    throw new ForbiddenError('You are not authorized to open a customs case for this cargo');
  }

  const id = randomUUID();
  const row = {
    id,
    tenant_id: container?.tenant_id || userContext?.tenantId || null,
    subject_type: subjectType,
    subject_id: subjectId,
    shipment_id: payload.shipment_id || null,
    import_order_id: payload.import_order_id || null,
    // Derived from the case's OWN id, never the subject's. Two consignments whose ids share a prefix
    // would otherwise present the same reference to the person handling them.
    reference: shortRef('CUST', id),
    cargo_kind: cargoKind,
    // Set explicitly, not left to the column default. A service that reads back a value it never
    // wrote is trusting the schema to answer a question the code is asking.
    status: 'OPEN',
    gateway_port: optionalText(payload.gateway_port, 'gateway_port', { max: 200 }),
    gateway_country: optionalText(payload.gateway_country, 'gateway_country', { max: 200 }),
    destination_country: optionalText(payload.destination_country, 'destination_country', { max: 200 }),
    destination_city: optionalText(payload.destination_city, 'destination_city', { max: 200 }),
    final_destination: optionalText(payload.final_destination, 'final_destination', { max: 500 }),
    notes: optionalText(payload.notes, 'notes'),
    created_by: context.id,
    updated_by: context.id,
  };

  const { data, error } = await client.from(CASES).insert(row).select().single();
  if (error) {
    // 23505 is the guarantee. Matching on message text alone is how a friendly refusal quietly
    // stops firing when a driver or a version words the error differently.
    if (error.code === '23505' || String(error.message || '').includes('uq_customs_case_live_subject')) {
      throw new ValidationError('This cargo already has a live customs case. Two cases are two answers to the same question.');
    }
    throw new DatabaseError(error.message);
  }
  await writeDiasporaAudit({
    importOrderId: data.import_order_id, tenantId: data.tenant_id, actorId: context.id,
    action: 'CUSTOMS_CASE_OPENED', resourceType: 'diaspora_customs_case', resourceId: data.id, newState: data,
    supabaseClient: client,
  });
  return data;
}

export async function findCaseForSubject(subjectType, subjectId, { client = supabase } = {}) {
  const { data } = await client.from(CASES).select('*')
    .eq('subject_type', subjectType).eq('subject_id', subjectId)
    .is('deleted_at', null).neq('status', 'ABANDONED').maybeSingle();
  return data || null;
}

// ── Agent appointment ──────────────────────────────────────────────────────

/**
 * Appoint a clearing agent for ONE case.
 *
 * This records an appointment, not a licence. ZIMRA licenses clearing agents and the licence expires
 * annually (source register §7); CarUp cannot verify either. `licence_reference_claimed` is a string
 * somebody typed and every surface must say so.
 *
 * A provider cannot self-appoint: the appointment is made by whoever coordinates the case.
 */
export async function appointAgent(caseId, payload = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const kase = await loadCaseContext(caseId, { client });
  await assertCanCoordinate(kase, context, { client });

  const agentKind = payload.agent_kind === 'PERSON' ? 'PERSON' : 'ORGANISATION';
  const agentUserId = payload.agent_user_id || null;
  const agentOrgId = payload.agent_organisation_id || null;
  if (!agentUserId && !agentOrgId) throw new ValidationError('An appointment must name the agent — an organisation or a person');

  // The appointee has to be somebody who exists. An appointment naming a user id nobody has is an
  // appointment that can never be exercised, and it would read on the participant's page as though
  // somebody were handling their clearance.
  if (agentUserId) {
    const { data: user } = await client.from('users').select('id').eq('id', agentUserId).maybeSingle();
    if (!user) throw new NotFoundError('That agent user does not exist');
  }

  const row = {
    tenant_id: kase.tenant_id,
    case_id: kase.id,
    agent_kind: agentKind,
    agent_organisation_id: agentOrgId,
    agent_user_id: agentUserId,
    agent_display_name: requireText(payload.agent_display_name, 'agent_display_name', { max: 300 }),
    licence_reference_claimed: optionalText(payload.licence_reference_claimed, 'licence_reference_claimed', { max: 200 }),
    scope: payload.scope || 'CUSTOMS_CLEARANCE',
    // Likewise: `deriveRelationship` filters on this exact value, so it is written, not defaulted.
    status: 'ACTIVE',
    appointed_at: new Date().toISOString(),
    appointed_by: context.id,
    appointed_by_role: context.platformRole || null,
    evidence_document_id: payload.evidence_document_id || null,
    notes: optionalText(payload.notes, 'notes'),
    created_by: context.id,
    updated_by: context.id,
  };
  if (!['CUSTOMS_CLEARANCE', 'CUSTOMS_CLEARANCE_AND_DELIVERY', 'DELIVERY_ONLY'].includes(row.scope)) {
    throw new ValidationError('That is not a scope an appointment can have');
  }

  const { data, error } = await client.from(APPOINTMENTS).insert(row).select().single();
  if (error) {
    if (error.code === '23505' || String(error.message || '').includes('uq_customs_case_one_active_agent')) {
      throw new ValidationError('This case already has an active clearing agent. End that appointment before making another.');
    }
    throw new DatabaseError(error.message);
  }
  await writeDiasporaAudit({
    importOrderId: kase.import_order_id, tenantId: kase.tenant_id, actorId: context.id,
    action: 'CUSTOMS_AGENT_APPOINTED', resourceType: 'diaspora_customs_agent_appointment', resourceId: data.id, newState: data,
    supabaseClient: client,
  });
  return data;
}

export async function endAppointment(appointmentId, payload = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const { data: appointment } = await client.from(APPOINTMENTS).select('*').eq('id', appointmentId).is('deleted_at', null).maybeSingle();
  if (!appointment) throw new NotFoundError('That appointment does not exist');
  const kase = await loadCaseContext(appointment.case_id, { client });
  await assertCanCoordinate(kase, context, { client });

  const status = payload.status === 'REVOKED' ? 'REVOKED' : 'ENDED';
  const { data, error } = await client.from(APPOINTMENTS)
    .update({ status, ended_at: new Date().toISOString(), ended_reason: optionalText(payload.reason, 'reason'), updated_by: context.id })
    // Compare-and-set: ending an appointment twice must not overwrite who ended it first.
    .eq('id', appointmentId).eq('status', 'ACTIVE').select().single();
  if (error) throw new DatabaseError(error.message);
  await writeDiasporaAudit({
    importOrderId: kase.import_order_id, tenantId: kase.tenant_id, actorId: context.id,
    action: 'CUSTOMS_AGENT_APPOINTMENT_ENDED', resourceType: 'diaspora_customs_agent_appointment', resourceId: appointmentId,
    previousState: { status: appointment.status }, newState: { status },
    supabaseClient: client,
  });
  return data;
}

// ── Events ─────────────────────────────────────────────────────────────────

/**
 * Record an attributed claim or an observed fact.
 *
 * The refusals here are the phase. Each one is a sentence somebody could otherwise have made the
 * product say without having the standing to say it.
 */
export async function recordEvent(caseId, payload = {}, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = await resolveClient(options);
  const kase = await loadCaseContext(caseId, { client });

  const eventType = requireText(payload.event_type, 'event_type', { max: 100 });
  if (!CUSTOMS_EVENT_TYPE_KEYS.includes(eventType)) {
    throw new ValidationError(`${eventType} is not a customs or destination event this product records`);
  }
  if (kase.status !== 'OPEN') throw new ValidationError('This customs case is closed. Reopen it before recording anything further.');

  const relationship = await deriveRelationship(kase, context, { client });
  if (!relationship) throw new ForbiddenError('You are not a party to this customs case');
  if (!WHO_MAY_ASSERT[eventType].includes(relationship)) {
    throw new ForbiddenError(
      `As ${relationship.toLowerCase().replace(/_/g, ' ')} you cannot record "${eventType}" on this case. `
      + 'Customs acts are performed by the authority and reported by the appointed agent; they are not entered by the party whose goods they are.',
    );
  }

  const definition = CUSTOMS_EVENT_TYPES[eventType];
  const assertionClass = definition.observed ? 'CARUP_OBSERVED' : 'ATTRIBUTED';
  let sourceKind = payload.source_kind || (definition.observed ? 'CARUP_OBSERVATION' : null);
  if (!sourceKind) throw new ValidationError('source_kind is required: a claim has to say what it rests on');
  if (!SOURCE_KINDS.includes(sourceKind)) throw new ValidationError(`${sourceKind} is not a source kind`);
  if (definition.observed && sourceKind !== 'CARUP_OBSERVATION') {
    throw new ValidationError('A physical observation is a CarUp observation. It cannot claim another source.');
  }
  if (!definition.observed && sourceKind === 'CARUP_OBSERVATION') {
    throw new ValidationError('CarUp did not observe this. A customs act reaches us as somebody\'s report, and must say whose.');
  }

  const evidenceDocumentId = payload.evidence_document_id || null;
  if (sourceKind === 'AUTHORITY_DOCUMENT' && !evidenceDocumentId) {
    throw new ValidationError(
      'A claim resting on an authority document must be bound to that document. '
      + 'Without it this is a report, and it will be recorded and shown as one.',
    );
  }
  // The document has to be one this case can see, or "bound to the evidence" means nothing.
  if (evidenceDocumentId) {
    const { data: doc } = await client.from('diaspora_trade_documents').select('id').eq('id', evidenceDocumentId).is('deleted_at', null).maybeSingle();
    if (!doc) throw new NotFoundError('That evidence document does not exist');
  }

  const amount = transcribedAmount(payload.amount_value, 'amount_value');
  if (amount !== null && !['ASSESSMENT_EVIDENCE_RECEIVED', 'PAYMENT_EVIDENCE_RECEIVED'].includes(eventType)) {
    throw new ValidationError('An amount only means something on an assessment or a payment.');
  }
  if (amount !== null && !payload.amount_currency) throw new ValidationError('An amount without a currency is not an amount');

  // §H — a customs rate is an act of the authority with an effective period. It is never inferred
  // from T6 reference FX, market FX, today's rate, or a previous declaration.
  const rateValue = payload.customs_rate_value === undefined || payload.customs_rate_value === null || String(payload.customs_rate_value).trim() === ''
    ? null : Number(payload.customs_rate_value);
  if (rateValue !== null) {
    if (!Number.isFinite(rateValue) || rateValue <= 0) throw new ValidationError('A customs exchange rate must be a positive number, transcribed from its source');
    if (!payload.customs_rate_source) throw new ValidationError('A customs exchange rate must name its source. A rate with no source is a fabrication.');
    if (!payload.customs_rate_effective_from) throw new ValidationError('A customs exchange rate must state the date it takes effect. ZIMRA publishes these for a stated period.');
  }

  const row = {
    tenant_id: kase.tenant_id,
    case_id: kase.id,
    event_type: eventType,
    assertion_class: assertionClass,
    asserted_by_user_id: context.id,
    asserted_by_role: context.platformRole || null,
    asserted_by_relationship: relationship,
    appointment_id: payload.appointment_id || null,
    source_kind: sourceKind,
    source_description: optionalText(payload.source_description, 'source_description'),
    evidence_document_id: evidenceDocumentId,
    amount_value: amount,
    amount_currency: amount === null ? null : requireText(payload.amount_currency, 'amount_currency', { max: 10 }).toUpperCase(),
    customs_rate_value: rateValue,
    customs_rate_basis: optionalText(payload.customs_rate_basis, 'customs_rate_basis', { max: 100 }),
    customs_rate_source: optionalText(payload.customs_rate_source, 'customs_rate_source', { max: 300 }),
    customs_rate_effective_from: payload.customs_rate_effective_from || null,
    customs_rate_effective_to: payload.customs_rate_effective_to || null,
    event_time: observedAt(payload.event_time),
    location: optionalText(payload.location, 'location', { max: 300 }),
    notes: optionalText(payload.notes, 'notes'),
    created_by: context.id,
    updated_by: context.id,
  };

  const { data, error } = await client.from(EVENTS).insert(row).select().single();
  if (error) throw new DatabaseError(error.message);
  await writeDiasporaAudit({
    importOrderId: kase.import_order_id, tenantId: kase.tenant_id, actorId: context.id,
    action: `CUSTOMS_${eventType}`, resourceType: 'diaspora_customs_event', resourceId: data.id, newState: data,
    supabaseClient: client,
  });
  return data;
}
