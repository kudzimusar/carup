import { supabase } from '../../db/supabase.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';
import { requireUserContext } from './diasporaAuthorization.js';
import {
  CUSTOMS_EVENT_TYPES, assertCanReadCase, deriveRelationship, findCaseForSubject, loadCaseContext,
} from './customsCaseService.js';

/**
 * Trade OS T12 — read-only projections.
 *
 * This file decides **how strongly a claim is allowed to read**, which is where the whole phase can
 * still be lost after the authority has done everything right. A perfectly attributed row that a
 * projection renders as "Duty paid" has told the customer a customs authority confirmed something.
 *
 * Two rules run through everything below:
 *
 *   1. **A claim is never stronger than its source.** The same event, from an authority document or
 *      from an agent typing into a box, produces two different sentences. Not two different
 *      confidence badges on one sentence — two sentences.
 *   2. **Unknown is unknown.** No step defaults to "not started" as though that were a finding, and
 *      no absent amount becomes `0`.
 */

const EVENTS = 'diaspora_customs_events';
const APPOINTMENTS = 'diaspora_customs_agent_appointments';

/**
 * The evidence checklist, in the order a case actually moves.
 *
 * Each step is a SEPARATE fact with its own evidence. There is no rolled-up "cleared" state, because
 * the moment one exists every one of these gets written to it.
 */
export const CUSTOMS_STEPS = Object.freeze([
  { key: 'DOCUMENTS', label: 'Documents', satisfiedBy: ['DOCUMENT_PROVIDED'], needed: 'The documents the clearing agent asked for.' },
  { key: 'LODGEMENT', label: 'Declaration lodged', satisfiedBy: ['LODGEMENT_REPORTED'], needed: 'The clearing agent lodges the declaration and reports back.' },
  { key: 'ASSESSMENT', label: 'Assessment', satisfiedBy: ['ASSESSMENT_EVIDENCE_RECEIVED'], needed: 'An assessment issued by the authority.' },
  { key: 'PAYMENT', label: 'Payment', satisfiedBy: ['PAYMENT_EVIDENCE_RECEIVED'], needed: 'Proof that the assessed amount was paid.' },
  { key: 'RELEASE', label: 'Release', satisfiedBy: ['RELEASE_EVIDENCE_RECEIVED'], needed: 'A release document from the authority.' },
  { key: 'PORT_RELEASE', label: 'Left the port', satisfiedBy: ['PORT_RELEASE_OBSERVED'], needed: 'The goods physically leaving the port or depot.' },
  { key: 'COLLECTION', label: 'Collected', satisfiedBy: ['COLLECTION_OBSERVED'], needed: 'Somebody authorised collecting the goods.' },
  { key: 'DELIVERY', label: 'Delivered', satisfiedBy: ['DELIVERY_OBSERVED'], needed: 'Delivery to the receiver, acknowledged by them.' },
]);

/**
 * How a claim of each source kind is entitled to be worded.
 *
 * §G, made concrete. "Clearing agent reported declaration lodged" and "Declaration lodged by ZIMRA"
 * are different claims, and only one of them is ours to make.
 */
export const SOURCE_WORDING = Object.freeze({
  CARUP_OBSERVATION: { prefix: '', strength: 'OBSERVED', explains: 'Recorded by the person who handled the cargo.' },
  AUTHORITY_DOCUMENT: { prefix: 'Authority document received:', strength: 'AUTHORITY_EVIDENCE', explains: 'Taken from a document issued by the authority and attached to this case.' },
  AGENT_REPORT: { prefix: 'Clearing agent reported:', strength: 'REPORTED', explains: 'What the appointed clearing agent told us. Nobody has attached a document for it.' },
  IMPORTER_DOCUMENT: { prefix: 'Importer supplied:', strength: 'SUPPLIED', explains: 'A document the importer supplied. It has not been confirmed by the authority.' },
  THIRD_PARTY_DOCUMENT: { prefix: 'Received from a third party:', strength: 'SUPPLIED', explains: 'A document from someone other than the authority or the importer.' },
});

export const ASSERTION_NOTE =
  'CarUp coordinates customs. It does not assess duty, does not clear goods and is not ZIMRA. Every step below says who told us and what it rests on.';

export const UNKNOWN_IS_UNKNOWN =
  'Anything not shown has not been recorded. That is not the same as it being nil, refused, or complete.';

const strengthOf = (event) => SOURCE_WORDING[event.source_kind]?.strength || 'REPORTED';

/**
 * The sentence for one event.
 *
 * The event type supplies the fact; the SOURCE supplies how strongly it may be put. An assessment
 * from an authority document reads as an assessment. The same assessment typed by an agent with no
 * document reads as what it is — the agent's figure.
 */
export function describeEvent(event) {
  const wording = SOURCE_WORDING[event.source_kind] || SOURCE_WORDING.AGENT_REPORT;
  const base = {
    DOCUMENT_REQUESTED: 'a document was requested',
    DOCUMENT_PROVIDED: 'a document was provided',
    LODGEMENT_REPORTED: 'the declaration was lodged',
    QUERY_RAISED: 'a query was raised on the consignment',
    INSPECTION_EVIDENCE_RECEIVED: 'an inspection took place',
    ASSESSMENT_EVIDENCE_RECEIVED: 'an assessment was issued',
    PAYMENT_EVIDENCE_RECEIVED: 'the assessed amount was paid',
    RELEASE_EVIDENCE_RECEIVED: 'the goods were released by customs',
    GATEWAY_ARRIVAL_OBSERVED: 'the goods arrived at the gateway port',
    TRANSIT_TO_DESTINATION_STARTED: 'the goods left the gateway for the destination',
    DESTINATION_ARRIVAL_OBSERVED: 'the goods arrived at the destination',
    PORT_RELEASE_OBSERVED: 'the goods left the port',
    COLLECTION_OBSERVED: 'the goods were collected',
    DELIVERY_OBSERVED: 'the goods were delivered',
  }[event.event_type] || event.event_type;

  // An observation is ours and reads plainly. Everything else is somebody's claim and is prefixed
  // with whose — which is why the prefix is not decoration.
  const sentence = event.assertion_class === 'CARUP_OBSERVED'
    ? `${base.charAt(0).toUpperCase()}${base.slice(1)}.`
    : `${wording.prefix} ${base}.`;

  return {
    sentence,
    strength: wording.strength,
    provenance: wording.explains,
    attributed_to: event.asserted_by_relationship,
    has_document: Boolean(event.evidence_document_id),
  };
}

/**
 * The assessed amount, if anything entitles the product to show one.
 *
 * §G — there is NO calculator. This reads the latest assessment event and reports what its evidence
 * said, or reports that nothing has been assessed. It never adds, never converts, never estimates,
 * and never returns `0` to mean "we don't know".
 */
export function projectAssessment(events) {
  const assessments = events
    .filter((e) => e.event_type === 'ASSESSMENT_EVIDENCE_RECEIVED' && e.amount_value !== null && e.amount_value !== undefined)
    .sort((a, b) => Date.parse(b.event_time) - Date.parse(a.event_time));

  if (!assessments.length) {
    return {
      assessed: false,
      amount: null,
      currency: null,
      headline: 'Not yet assessed',
      detail: 'No assessment has been received for this consignment. CarUp does not calculate duty or tax.',
      source: null,
      source_strength: null,
      assessment_date: null,
      customs_rate: null,
    };
  }

  const latest = assessments[0];
  const strength = strengthOf(latest);
  const isAuthority = strength === 'AUTHORITY_EVIDENCE';
  return {
    assessed: true,
    amount: Number(latest.amount_value),
    currency: latest.amount_currency,
    // The distinction §G is about. Same number, two different claims about who stands behind it.
    headline: isAuthority ? 'Assessment amount' : 'Agent-reported amount',
    detail: isAuthority
      ? 'Taken from an assessment document attached to this case. CarUp did not calculate it.'
      : 'Reported by the appointed clearing agent. No assessment document has been attached, so this is their figure, not the authority\'s.',
    source: latest.source_description || SOURCE_WORDING[latest.source_kind]?.explains || null,
    source_strength: strength,
    assessment_date: latest.event_time,
    // §H — a rate travels with its own source and period, or it does not travel.
    customs_rate: latest.customs_rate_value === null || latest.customs_rate_value === undefined ? null : {
      value: Number(latest.customs_rate_value),
      basis: latest.customs_rate_basis || null,
      source: latest.customs_rate_source,
      effective_from: latest.customs_rate_effective_from,
      effective_to: latest.customs_rate_effective_to || null,
      note: 'The customs exchange rate as stated by its source. It is never a market rate and never a reference rate.',
    },
  };
}

/** Payment evidence — received is received, and is not an authority confirming payment. */
export function projectPayment(events) {
  const payments = events
    .filter((e) => e.event_type === 'PAYMENT_EVIDENCE_RECEIVED')
    .sort((a, b) => Date.parse(b.event_time) - Date.parse(a.event_time));
  if (!payments.length) {
    return { evidence_received: false, headline: 'No payment evidence', detail: 'Nobody has supplied proof of payment for this consignment.', amount: null, currency: null, source_strength: null };
  }
  const latest = payments[0];
  return {
    evidence_received: true,
    headline: 'Payment evidence received',
    // The sentence this phase exists to prevent is "Duty paid".
    detail: 'A payment document has been supplied. That is evidence of a payment; it is not the authority confirming the account is settled.',
    amount: latest.amount_value === null || latest.amount_value === undefined ? null : Number(latest.amount_value),
    currency: latest.amount_currency || null,
    source_strength: strengthOf(latest),
    received_at: latest.event_time,
  };
}

/** Release evidence — the same shape, and the same refusal to say "cleared". */
export function projectRelease(events) {
  const releases = events
    .filter((e) => e.event_type === 'RELEASE_EVIDENCE_RECEIVED')
    .sort((a, b) => Date.parse(b.event_time) - Date.parse(a.event_time));
  if (!releases.length) {
    return { evidence_received: false, headline: 'No release evidence', detail: 'No release document has been received. The goods have not been recorded as released.', source_strength: null };
  }
  const latest = releases[0];
  const strength = strengthOf(latest);
  return {
    evidence_received: true,
    headline: strength === 'AUTHORITY_EVIDENCE' ? 'Release document received' : 'Release reported',
    detail: strength === 'AUTHORITY_EVIDENCE'
      ? 'A release document has been received and attached to this case.'
      : 'A release has been reported without a document attached. It has not been evidenced.',
    source_strength: strength,
    received_at: latest.event_time,
  };
}

/**
 * §L — the handoffs, kept apart.
 *
 * Beira arrival is not Zimbabwe arrival, Zimbabwe arrival is not customs release, and none of them
 * is delivery. Each is its own observation or it is unknown.
 */
export function projectHandoffs(kase, events) {
  const first = (type) => events
    .filter((e) => e.event_type === type)
    .sort((a, b) => Date.parse(a.event_time) - Date.parse(b.event_time))[0] || null;

  const at = (e) => (e ? e.event_time : null);
  const gateway = first('GATEWAY_ARRIVAL_OBSERVED');
  const transit = first('TRANSIT_TO_DESTINATION_STARTED');
  const destination = first('DESTINATION_ARRIVAL_OBSERVED');
  const collection = first('COLLECTION_OBSERVED');
  const delivery = first('DELIVERY_OBSERVED');

  return {
    gateway: { port: kase.gateway_port || null, country: kase.gateway_country || null, arrived_at: at(gateway), observed: Boolean(gateway) },
    transit_started_at: at(transit),
    destination: {
      country: kase.destination_country || null, city: kase.destination_city || null,
      final_destination: kase.final_destination || null,
      arrived_at: at(destination), observed: Boolean(destination),
    },
    collected_at: at(collection),
    delivered_at: at(delivery),
    note: 'Arriving at the gateway port is not arriving in the destination country, and neither is being released, collected or delivered. Each is recorded separately.',
  };
}

/** The checklist, with what is still needed said in the coordinator's own terms. */
export function projectChecklist(events) {
  const byType = new Set(events.map((e) => e.event_type));
  return CUSTOMS_STEPS.map((step) => {
    const satisfying = events.filter((e) => step.satisfiedBy.includes(e.event_type));
    const latest = satisfying.sort((a, b) => Date.parse(b.event_time) - Date.parse(a.event_time))[0] || null;
    return {
      key: step.key,
      label: step.label,
      // Three states, never two. "Not evidenced" is not "no".
      state: latest ? (strengthOf(latest) === 'AUTHORITY_EVIDENCE' || latest.assertion_class === 'CARUP_OBSERVED' ? 'EVIDENCED' : 'REPORTED') : 'NOT_RECORDED',
      at: latest ? latest.event_time : null,
      source_strength: latest ? strengthOf(latest) : null,
      needed: latest ? null : step.needed,
      requested: byType.has('DOCUMENT_REQUESTED') && step.key === 'DOCUMENTS',
    };
  });
}

async function loadEvents(caseId, client) {
  const { data } = await client.from(EVENTS).select('*').eq('case_id', caseId).is('deleted_at', null).order('event_time', { ascending: true });
  return Array.isArray(data) ? data : (data ? [data] : []);
}

async function loadAppointment(caseId, client) {
  const { data } = await client.from(APPOINTMENTS).select('*').eq('case_id', caseId).is('deleted_at', null).order('appointed_at', { ascending: false }).limit(5);
  const rows = Array.isArray(data) ? data : (data ? [data] : []);
  return rows.find((a) => a.status === 'ACTIVE') || null;
}

/**
 * The coordinator's view of one case.
 *
 * Everything, with provenance on every line — including the open actions, because a checklist that
 * only says what is done leaves the coordinator to work out what to do next from absences.
 */
export async function getCustomsCaseWorkspace(caseId, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = options.supabaseClient || supabase;
  const kase = await loadCaseContext(caseId, { client });
  const relationship = await assertCanReadCase(kase, context, { client });

  const events = await loadEvents(kase.id, client);
  const appointment = await loadAppointment(kase.id, client);
  const checklist = projectChecklist(events);

  return {
    case: {
      id: kase.id, reference: kase.reference, status: kase.status,
      cargo_kind: kase.cargo_kind,
      subject: { type: kase.subject_type, id: kase.subject_id },
      shipment_id: kase.shipment_id, import_order_id: kase.import_order_id,
    },
    viewer_relationship: relationship,
    agent: appointment ? {
      id: appointment.id,
      display_name: appointment.agent_display_name,
      scope: appointment.scope,
      appointed_at: appointment.appointed_at,
      // Named `_claimed` in the database and `claimed` here, because CarUp cannot verify a licence.
      licence_reference_claimed: appointment.licence_reference_claimed || null,
      licence_note: 'This licence reference is what the appointing party supplied. CarUp has not verified it with the authority.',
    } : null,
    agent_note: appointment ? null : 'No clearing agent has been appointed for this consignment.',
    handoffs: projectHandoffs(kase, events),
    checklist,
    assessment: projectAssessment(events),
    payment: projectPayment(events),
    release: projectRelease(events),
    open_actions: checklist.filter((s) => s.state === 'NOT_RECORDED').map((s) => ({ key: s.key, label: s.label, needed: s.needed })),
    timeline: events.map((e) => ({
      id: e.id, event_type: e.event_type, ...describeEvent(e),
      event_time: e.event_time, location: e.location || null, notes: e.notes || null,
      recorded_by: e.asserted_by_user_id, recorded_at: e.created_at,
      evidence_document_id: e.evidence_document_id || null,
    })),
    // §M — vehicle cargo gets a vehicle-shaped projection, and general cargo is never forced through
    // it. A phase that exists to move boxes must remain usable for boxes.
    vehicle: kase.cargo_kind !== 'VEHICLE' ? null : {
      note: 'Zimbabwe customs and release evidence recorded here can be shown against the vehicle. Registration, inspection and licensing remain with their own authorities and are not created here.',
      evidence_available: checklist.filter((s) => ['RELEASE', 'DELIVERY'].includes(s.key) && s.state !== 'NOT_RECORDED').map((s) => s.key),
    },
    note: ASSERTION_NOTE,
    unknown_note: UNKNOWN_IS_UNKNOWN,
  };
}

/**
 * The participant's view.
 *
 * Scoped to their own consignment, in plain language, and deliberately NOT the workspace with fields
 * removed — a co-loader must not be able to read another participant's customs documents, amounts,
 * identity, consignee data or agent relationship, and the safest way to guarantee that is for this
 * projection never to load them.
 */
export async function getMyCustomsStatus(subjectType, subjectId, userContext = {}, options = {}) {
  const context = requireUserContext(userContext);
  const client = options.supabaseClient || supabase;
  if (String(subjectType) !== 'cargo_reservation') {
    throw new ValidationError('Customs tracking is currently available for container bookings only');
  }

  const { data: reservation } = await client.from('diaspora_cargo_reservations').select('*').eq('id', subjectId).is('deleted_at', null).maybeSingle();
  if (!reservation) throw new NotFoundError('That cargo booking does not exist');
  const userId = String(context.id || '');
  const owns = [reservation.buyer_id, reservation.created_by].some((id) => String(id || '') === userId);
  if (!owns) {
    const { ForbiddenError } = await import('../../utils/errors.js');
    throw new ForbiddenError('That cargo booking is not yours');
  }

  const bare = await findCaseForSubject('cargo_reservation', subjectId, { client });
  if (!bare) {
    return {
      subject: { type: 'cargo_reservation', id: subjectId },
      state: 'NO_CASE',
      sentence: 'Customs has not been started for your cargo yet.',
      agent: null, checklist: null, assessment: null, payment: null, release: null, handoffs: null, timeline: [],
      next_action: 'Nothing is needed from you yet. The organiser opens the customs case when the cargo reaches the gateway.',
      note: UNKNOWN_IS_UNKNOWN,
    };
  }

  const kase = await loadCaseContext(bare.id, { client });
  const events = await loadEvents(kase.id, client);
  const appointment = await loadAppointment(kase.id, client);
  const checklist = projectChecklist(events);
  const assessment = projectAssessment(events);
  const nextStep = checklist.find((s) => s.state === 'NOT_RECORDED') || null;

  return {
    subject: { type: 'cargo_reservation', id: subjectId },
    state: kase.status === 'OPEN' ? 'IN_PROGRESS' : 'CLOSED',
    reference: kase.reference,
    sentence: nextStep
      ? `Your cargo is going through customs. The step being worked on is: ${nextStep.label.toLowerCase()}.`
      : 'Every customs and destination step recorded for your cargo has been completed.',
    // Who is handling it — a name and a role, never an internal id.
    agent: appointment ? {
      display_name: appointment.agent_display_name,
      note: 'This is the clearing agent appointed for your consignment. CarUp coordinates; the agent performs the customs work.',
    } : null,
    agent_note: appointment ? null : 'No clearing agent has been appointed for your consignment yet.',
    checklist: checklist.map((s) => ({ key: s.key, label: s.label, state: s.state, at: s.at, needed: s.needed })),
    assessment,
    payment: projectPayment(events),
    release: projectRelease(events),
    handoffs: projectHandoffs(kase, events),
    timeline: events.map((e) => {
      const described = describeEvent(e);
      return { event_type: e.event_type, sentence: described.sentence, strength: described.strength, event_time: e.event_time, location: e.location || null };
    }),
    next_action: nextStep
      ? `Next: ${nextStep.needed}`
      : 'Nothing is outstanding on the steps recorded for your cargo.',
    note: ASSERTION_NOTE,
    unknown_note: UNKNOWN_IS_UNKNOWN,
  };
}

export { deriveRelationship, CUSTOMS_EVENT_TYPES };
