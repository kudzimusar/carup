/**
 * Trade OS T12 — attributed customs coordination.
 *
 * Written against the sentences the phase has to be able to say, and the ones it must refuse:
 *
 *   1. a customer cannot clear their own goods, and a provider cannot mint ZIMRA's authority;
 *   2. an amount is transcribed from evidence or there is no amount — never calculated, never zero;
 *   3. an agent's typed figure and an authority document produce DIFFERENT SENTENCES;
 *   4. a customs exchange rate arrives with its source and its effective period, or not at all;
 *   5. a gateway is not a destination, and neither is a release, a collection or a delivery;
 *   6. general cargo completes the phase without touching a single vehicle authority.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMockSupabase } from './helpers/mockSupabase.js';
import {
  CARUP_OBSERVABLE, CUSTOMS_EVENT_TYPES, CUSTOMS_EVENT_TYPE_KEYS, WHO_MAY_ASSERT,
  appointAgent, deriveRelationship, endAppointment, loadCaseContext, observedAt, openCase, recordEvent,
} from '../services/diaspora/customsCaseService.js';
import {
  CUSTOMS_STEPS, SOURCE_WORDING, describeEvent, getCustomsCaseWorkspace, getMyCustomsStatus,
  projectAssessment, projectHandoffs, projectPayment, projectRelease,
} from '../services/diaspora/customsProjectionService.js';

const OPERATOR = { id: 'user-operator', platformRole: 'member', tenantRole: 'admin', tenantId: 'tenant-op' };
const CUSTOMER = { id: 'user-customer', platformRole: 'member' };
const COLOADER = { id: 'user-coloader', platformRole: 'member' };
const AGENT = { id: 'user-agent', platformRole: 'member' };
const FOREIGN_AGENT = { id: 'user-foreign-agent', platformRole: 'member' };
const OUTSIDER = { id: 'user-outsider', platformRole: 'member', tenantRole: 'admin', tenantId: 'tenant-other' };

const CONTAINER = 'cont-1';
const SHIPMENT = 'ship-1';
const RES_A = 'res-a';   // customer's
const RES_B = 'res-b';   // co-loader's

function world() {
  return createMockSupabase({
    users: [{ id: 'user-agent' }, { id: 'user-foreign-agent' }, { id: 'user-customer' }, { id: 'user-operator' }],
    diaspora_container_shipments: [
      { id: CONTAINER, tenant_id: 'tenant-op', coordinator_id: 'user-operator', status: 'IN_TRANSIT', deleted_at: null },
    ],
    diaspora_shipments: [
      { id: SHIPMENT, tenant_id: 'tenant-op', container_id: CONTAINER, import_order_id: 'ord-a', status: 'ARRIVED', deleted_at: null },
    ],
    diaspora_cargo_reservations: [
      { id: RES_A, tenant_id: 'tenant-op', container_id: CONTAINER, import_order_id: 'ord-a', buyer_id: 'user-customer', created_by: 'user-customer', reservation_status: 'APPROVED', deleted_at: null },
      { id: RES_B, tenant_id: 'tenant-op', container_id: CONTAINER, import_order_id: 'ord-b', buyer_id: 'user-coloader', created_by: 'user-coloader', reservation_status: 'APPROVED', deleted_at: null },
    ],
    diaspora_import_orders: [
      { id: 'ord-a', tenant_id: null, buyer_id: 'user-customer', created_by: 'user-customer', status: 'ARRIVED_AT_BORDER', deleted_at: null },
      { id: 'ord-b', tenant_id: null, buyer_id: 'user-coloader', created_by: 'user-coloader', status: 'ARRIVED_AT_BORDER', deleted_at: null },
    ],
    diaspora_trade_documents: [
      { id: 'doc-assessment', deleted_at: null },
      { id: 'doc-receipt', deleted_at: null },
      { id: 'doc-release', deleted_at: null },
    ],
    diaspora_customs_cases: [],
    diaspora_customs_agent_appointments: [],
    diaspora_customs_events: [],
    diaspora_import_audit_log: [],
  });
}

const opts = (client) => ({ supabaseClient: client });

async function openCaseFor(client, over = {}) {
  return openCase({
    subject_type: 'cargo_reservation', subject_id: RES_A, shipment_id: SHIPMENT,
    gateway_port: 'Beira', gateway_country: 'Mozambique',
    destination_country: 'Zimbabwe', destination_city: 'Harare', final_destination: 'Harare depot',
    ...over,
  }, OPERATOR, opts(client));
}

async function withAgent(client, kase) {
  return appointAgent(kase.id, { agent_kind: 'PERSON', agent_user_id: 'user-agent', agent_display_name: 'Nyati Clearing (Pvt) Ltd' }, OPERATOR, opts(client));
}

// ── 1. Nobody clears their own goods ───────────────────────────────────────

test('T12: a CUSTOMER cannot report a lodgement, an assessment or a release', async () => {
  const client = world();
  const kase = await openCaseFor(client);
  for (const type of ['LODGEMENT_REPORTED', 'ASSESSMENT_EVIDENCE_RECEIVED', 'RELEASE_EVIDENCE_RECEIVED', 'INSPECTION_EVIDENCE_RECEIVED']) {
    await assert.rejects(
      () => recordEvent(kase.id, { event_type: type, source_kind: 'AGENT_REPORT' }, CUSTOMER, opts(client)),
      /cannot record/, `a customer recorded ${type}`,
    );
  }
});

test('T12: …and the refusal says WHY, in terms of who performs a customs act', async () => {
  const client = world();
  const kase = await openCaseFor(client);
  try {
    await recordEvent(kase.id, { event_type: 'RELEASE_EVIDENCE_RECEIVED', source_kind: 'AGENT_REPORT' }, CUSTOMER, opts(client));
    assert.fail('accepted');
  } catch (err) {
    assert.match(err.message, /performed by the authority/i);
    assert.match(err.message, /not entered by the party whose goods they are/i);
  }
});

test('T12: POSITIVE CONTROL — the importer CAN supply their own payment receipt', async () => {
  // Refusing this would make the product unusable for the person actually paying. Their receipt is
  // their document; it is recorded as such and never as the authority confirming settlement.
  const client = world();
  const kase = await openCaseFor(client);
  const event = await recordEvent(kase.id, {
    event_type: 'PAYMENT_EVIDENCE_RECEIVED', source_kind: 'IMPORTER_DOCUMENT',
    evidence_document_id: 'doc-receipt', amount_value: 1200, amount_currency: 'usd',
  }, CUSTOMER, opts(client));
  assert.equal(event.asserted_by_relationship, 'IMPORTER');
  assert.equal(event.amount_currency, 'USD');
});

test('T12: a CO-LOADER is not a party to another participant\'s case at all', async () => {
  const client = world();
  const kase = await openCaseFor(client);
  await assert.rejects(() => getCustomsCaseWorkspace(kase.id, COLOADER, opts(client)), /not a party/);
  await assert.rejects(
    () => recordEvent(kase.id, { event_type: 'DOCUMENT_PROVIDED', source_kind: 'IMPORTER_DOCUMENT' }, COLOADER, opts(client)),
    /not a party/,
  );
});

test('T12: a foreign tenant admin is not this container\'s operator', async () => {
  const client = world();
  const kase = await openCaseFor(client);
  await assert.rejects(() => getCustomsCaseWorkspace(kase.id, OUTSIDER, opts(client)), /not a party/);
});

test('T12: a random provider cannot self-appoint as the clearing agent', async () => {
  const client = world();
  const kase = await openCaseFor(client);
  await assert.rejects(
    () => appointAgent(kase.id, { agent_kind: 'PERSON', agent_user_id: 'user-foreign-agent', agent_display_name: 'Self Appointed Ltd' }, FOREIGN_AGENT, opts(client)),
    /not authorized to coordinate/,
  );
});

test('T12: an appointment is scoped to ONE case, not a platform role', async () => {
  const client = world();
  const caseA = await openCaseFor(client);
  await withAgent(client, caseA);
  const caseB = await openCase({ subject_type: 'cargo_reservation', subject_id: RES_B, shipment_id: SHIPMENT }, OPERATOR, opts(client));

  // The agent may act on the case they were appointed to…
  const loadedA = await loadCaseContext(caseA.id, { client });
  assert.equal(await deriveRelationship(loadedA, AGENT, { client }), 'APPOINTED_CLEARING_AGENT');
  // …and is nobody on the one they were not.
  const loadedB = await loadCaseContext(caseB.id, { client });
  assert.equal(await deriveRelationship(loadedB, AGENT, { client }), null);
});

test('T12: an ENDED appointment stops conferring authority', async () => {
  const client = world();
  const kase = await openCaseFor(client);
  const appointment = await withAgent(client, kase);
  await recordEvent(kase.id, { event_type: 'LODGEMENT_REPORTED', source_kind: 'AGENT_REPORT' }, AGENT, opts(client));

  await endAppointment(appointment.id, { status: 'REVOKED', reason: 'Replaced' }, OPERATOR, opts(client));
  await assert.rejects(
    () => recordEvent(kase.id, { event_type: 'LODGEMENT_REPORTED', source_kind: 'AGENT_REPORT' }, AGENT, opts(client)),
    /not a party/,
  );
});

test('T12: a case cannot have two live clearing agents', async () => {
  const client = world();
  const kase = await openCaseFor(client);
  await withAgent(client, kase);
  await assert.rejects(
    () => appointAgent(kase.id, { agent_kind: 'PERSON', agent_user_id: 'user-foreign-agent', agent_display_name: 'Second Agent' }, OPERATOR, opts(client)),
    /already has an active clearing agent|uq_customs_case_one_active_agent/,
  );
});

test('T12: an appointment cannot name a person who does not exist', async () => {
  // It would read on the participant's page as though somebody were handling their clearance.
  const client = world();
  const kase = await openCaseFor(client);
  await assert.rejects(
    () => appointAgent(kase.id, { agent_kind: 'PERSON', agent_user_id: 'user-nobody', agent_display_name: 'Ghost Clearing' }, OPERATOR, opts(client)),
    /does not exist/,
  );
});

// ── 2. There is no calculator ──────────────────────────────────────────────

test('T12: an unassessed consignment has NO amount — not zero', async () => {
  const client = world();
  const kase = await openCaseFor(client);
  const view = await getCustomsCaseWorkspace(kase.id, OPERATOR, opts(client));
  assert.equal(view.assessment.assessed, false);
  assert.equal(view.assessment.amount, null, 'an unassessed duty became a number');
  assert.equal(view.assessment.headline, 'Not yet assessed');
  assert.match(view.assessment.detail, /does not calculate duty or tax/i);
});

test('T12: an amount is refused where an amount cannot mean anything', async () => {
  const client = world();
  const kase = await openCaseFor(client);
  await withAgent(client, kase);
  await assert.rejects(
    () => recordEvent(kase.id, { event_type: 'LODGEMENT_REPORTED', source_kind: 'AGENT_REPORT', amount_value: 500, amount_currency: 'USD' }, AGENT, opts(client)),
    /only means something on an assessment or a payment/,
  );
});

test('T12: an amount without a currency is not an amount', async () => {
  const client = world();
  const kase = await openCaseFor(client);
  await withAgent(client, kase);
  await assert.rejects(
    () => recordEvent(kase.id, { event_type: 'ASSESSMENT_EVIDENCE_RECEIVED', source_kind: 'AUTHORITY_DOCUMENT', evidence_document_id: 'doc-assessment', amount_value: 500 }, AGENT, opts(client)),
    /without a currency/,
  );
});

test('T12: an explicit ZERO is kept — a source may state nil', async () => {
  // Zero is a real figure when an authority states it. It is only forbidden as a stand-in for
  // "we do not know", which is what `|| 50000` and `|| 0` both are.
  const client = world();
  const kase = await openCaseFor(client);
  await withAgent(client, kase);
  const e = await recordEvent(kase.id, {
    event_type: 'ASSESSMENT_EVIDENCE_RECEIVED', source_kind: 'AUTHORITY_DOCUMENT',
    evidence_document_id: 'doc-assessment', amount_value: 0, amount_currency: 'USD',
  }, AGENT, opts(client));
  assert.equal(e.amount_value, 0);
  const view = await getCustomsCaseWorkspace(kase.id, OPERATOR, opts(client));
  assert.equal(view.assessment.assessed, true);
  assert.equal(view.assessment.amount, 0);
});

test('T12: the service contains no rate, percentage or formula', async () => {
  const source = await readFile('backend/services/diaspora/customsCaseService.js', 'utf8');
  const projection = await readFile('backend/services/diaspora/customsProjectionService.js', 'utf8');
  for (const [name, code] of [['authority', source], ['projection', projection]]) {
    const body = code.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
    assert.ok(!/13\.5|50000/.test(body), `${name} carries one of the removed fabricated values`);
    assert.ok(!/\*\s*0\.\d+|\bVAT_RATE\b|\bDUTY_RATE\b|\bSURTAX\b/i.test(body), `${name} looks like it calculates a tax`);
  }
});

// ── 3. A claim is never stronger than its source ───────────────────────────

test('T12: an AUTHORITY claim without the document is refused', async () => {
  const client = world();
  const kase = await openCaseFor(client);
  await withAgent(client, kase);
  await assert.rejects(
    () => recordEvent(kase.id, { event_type: 'ASSESSMENT_EVIDENCE_RECEIVED', source_kind: 'AUTHORITY_DOCUMENT', amount_value: 900, amount_currency: 'USD' }, AGENT, opts(client)),
    /must be bound to that document/,
  );
});

test('T12: the SAME amount reads differently from an agent and from an authority document', async () => {
  const reported = projectAssessment([{ event_type: 'ASSESSMENT_EVIDENCE_RECEIVED', amount_value: 900, amount_currency: 'USD', source_kind: 'AGENT_REPORT', event_time: '2026-09-20T10:00:00Z' }]);
  const evidenced = projectAssessment([{ event_type: 'ASSESSMENT_EVIDENCE_RECEIVED', amount_value: 900, amount_currency: 'USD', source_kind: 'AUTHORITY_DOCUMENT', event_time: '2026-09-20T10:00:00Z' }]);

  assert.equal(reported.amount, evidenced.amount, 'the figures should be the same');
  assert.notEqual(reported.headline, evidenced.headline, 'the same number is being presented as the same claim');
  assert.equal(reported.headline, 'Agent-reported amount');
  assert.equal(evidenced.headline, 'Assessment amount');
  assert.match(reported.detail, /their figure, not the authority's/i);
  assert.match(evidenced.detail, /CarUp did not calculate it/i);
});

test('T12: an attributed event NAMES its source in the sentence; an observation does not', () => {
  const agent = describeEvent({ event_type: 'LODGEMENT_REPORTED', assertion_class: 'ATTRIBUTED', source_kind: 'AGENT_REPORT', asserted_by_relationship: 'APPOINTED_CLEARING_AGENT' });
  assert.match(agent.sentence, /^Clearing agent reported:/);
  assert.ok(!/^The declaration was lodged/.test(agent.sentence), 'an agent report reads as a bare fact');

  const observed = describeEvent({ event_type: 'DELIVERY_OBSERVED', assertion_class: 'CARUP_OBSERVED', source_kind: 'CARUP_OBSERVATION', asserted_by_relationship: 'CONTAINER_OPERATOR' });
  assert.equal(observed.sentence, 'The goods were delivered.');
  assert.equal(observed.strength, 'OBSERVED');
});

test('T12: payment EVIDENCE is never worded as the authority confirming payment', () => {
  const p = projectPayment([{ event_type: 'PAYMENT_EVIDENCE_RECEIVED', source_kind: 'IMPORTER_DOCUMENT', amount_value: 900, amount_currency: 'USD', event_time: '2026-09-21T10:00:00Z' }]);
  assert.equal(p.headline, 'Payment evidence received');
  assert.match(p.detail, /not the authority confirming/i);
  assert.ok(!/duty paid/i.test(`${p.headline} ${p.detail}`), 'the projection says "duty paid"');
});

test('T12: a release REPORTED and a release EVIDENCED are different sentences', () => {
  const reported = projectRelease([{ event_type: 'RELEASE_EVIDENCE_RECEIVED', source_kind: 'AGENT_REPORT', event_time: '2026-09-22T10:00:00Z' }]);
  const evidenced = projectRelease([{ event_type: 'RELEASE_EVIDENCE_RECEIVED', source_kind: 'AUTHORITY_DOCUMENT', event_time: '2026-09-22T10:00:00Z' }]);
  assert.equal(reported.headline, 'Release reported');
  assert.equal(evidenced.headline, 'Release document received');
  assert.match(reported.detail, /has not been evidenced/i);
});

test('T12: CarUp cannot claim to have observed a customs act', async () => {
  const client = world();
  const kase = await openCaseFor(client);
  await withAgent(client, kase);
  await assert.rejects(
    () => recordEvent(kase.id, { event_type: 'RELEASE_EVIDENCE_RECEIVED', source_kind: 'CARUP_OBSERVATION' }, AGENT, opts(client)),
    /CarUp did not observe this/,
  );
});

test('T12: a physical observation cannot borrow an authority\'s name', async () => {
  const client = world();
  const kase = await openCaseFor(client);
  await assert.rejects(
    () => recordEvent(kase.id, { event_type: 'DELIVERY_OBSERVED', source_kind: 'AUTHORITY_DOCUMENT', evidence_document_id: 'doc-release' }, OPERATOR, opts(client)),
    /cannot claim another source/,
  );
});

// ── 4. Customs FX ──────────────────────────────────────────────────────────

test('T12: a customs rate must name its source and its effective date', async () => {
  const client = world();
  const kase = await openCaseFor(client);
  await withAgent(client, kase);
  const base = { event_type: 'ASSESSMENT_EVIDENCE_RECEIVED', source_kind: 'AUTHORITY_DOCUMENT', evidence_document_id: 'doc-assessment', amount_value: 900, amount_currency: 'USD' };

  await assert.rejects(
    () => recordEvent(kase.id, { ...base, customs_rate_value: 13.5 }, AGENT, opts(client)),
    /must name its source/,
  );
  await assert.rejects(
    () => recordEvent(kase.id, { ...base, customs_rate_value: 13.5, customs_rate_source: 'ZIMRA weekly rates' }, AGENT, opts(client)),
    /must state the date it takes effect/,
  );
});

test('T12: POSITIVE CONTROL — a properly sourced rate is recorded with its period', async () => {
  const client = world();
  const kase = await openCaseFor(client);
  await withAgent(client, kase);
  await recordEvent(kase.id, {
    event_type: 'ASSESSMENT_EVIDENCE_RECEIVED', source_kind: 'AUTHORITY_DOCUMENT', evidence_document_id: 'doc-assessment',
    amount_value: 900, amount_currency: 'USD',
    customs_rate_value: 26.4312, customs_rate_basis: 'USD/ZWG',
    customs_rate_source: 'ZIMRA rates of exchange for customs purposes, week commencing 2026-09-07',
    customs_rate_effective_from: '2026-09-07', customs_rate_effective_to: '2026-09-13',
  }, AGENT, opts(client));

  const view = await getCustomsCaseWorkspace(kase.id, OPERATOR, opts(client));
  assert.equal(view.assessment.customs_rate.value, 26.4312);
  assert.equal(view.assessment.customs_rate.effective_from, '2026-09-07');
  assert.match(view.assessment.customs_rate.note, /never a market rate and never a reference rate/i);
});

test('T12: an assessment with NO rate reports no rate — it does not borrow one', async () => {
  const client = world();
  const kase = await openCaseFor(client);
  await withAgent(client, kase);
  await recordEvent(kase.id, {
    event_type: 'ASSESSMENT_EVIDENCE_RECEIVED', source_kind: 'AUTHORITY_DOCUMENT',
    evidence_document_id: 'doc-assessment', amount_value: 900, amount_currency: 'USD',
  }, AGENT, opts(client));
  const view = await getCustomsCaseWorkspace(kase.id, OPERATOR, opts(client));
  assert.equal(view.assessment.customs_rate, null, 'a rate appeared from somewhere');
});

test('T12: neither service imports T6 reference FX', async () => {
  // §4 of the ruling: customs FX is not T6 reference FX, and the cheapest way to break that rule is
  // an import that makes the substitution one line away.
  for (const file of ['backend/services/diaspora/customsCaseService.js', 'backend/services/diaspora/customsProjectionService.js']) {
    const code = (await readFile(file, 'utf8')).replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
    assert.ok(!/ecb|exchangeRateService|fxService|referenceRate/i.test(code), `${file} reaches for a reference FX source`);
  }
});

// ── 5. The handoffs stay apart ─────────────────────────────────────────────

test('T12: a gateway arrival is not a destination arrival, a release, a collection or a delivery', async () => {
  const client = world();
  const kase = await openCaseFor(client);
  await recordEvent(kase.id, { event_type: 'GATEWAY_ARRIVAL_OBSERVED', location: 'Beira' }, OPERATOR, opts(client));

  const view = await getCustomsCaseWorkspace(kase.id, OPERATOR, opts(client));
  assert.equal(view.handoffs.gateway.observed, true);
  assert.equal(view.handoffs.destination.observed, false, 'a gateway arrival became a destination arrival');
  assert.equal(view.handoffs.collected_at, null);
  assert.equal(view.handoffs.delivered_at, null);
  assert.equal(view.release.evidence_received, false, 'arriving somewhere released the goods');
  assert.match(view.handoffs.note, /not arriving in the destination country/i);
});

test('T12: every handoff is its own observation', () => {
  const h = projectHandoffs({ gateway_port: 'Beira', destination_city: 'Harare' }, [
    { event_type: 'GATEWAY_ARRIVAL_OBSERVED', event_time: '2026-09-20T08:00:00Z' },
    { event_type: 'TRANSIT_TO_DESTINATION_STARTED', event_time: '2026-09-21T08:00:00Z' },
    { event_type: 'DESTINATION_ARRIVAL_OBSERVED', event_time: '2026-09-23T08:00:00Z' },
    { event_type: 'DELIVERY_OBSERVED', event_time: '2026-09-25T08:00:00Z' },
  ]);
  const times = [h.gateway.arrived_at, h.transit_started_at, h.destination.arrived_at, h.delivered_at];
  assert.equal(new Set(times).size, 4, 'two handoffs are sharing a timestamp — they have been collapsed');
  assert.equal(h.collected_at, null, 'a collection was invented from a delivery');
});

test('T12: the checklist keeps every step separate — there is no CLEARED boolean', () => {
  const keys = CUSTOMS_STEPS.map((s) => s.key);
  for (const required of ['DOCUMENTS', 'LODGEMENT', 'ASSESSMENT', 'PAYMENT', 'RELEASE', 'PORT_RELEASE', 'COLLECTION', 'DELIVERY']) {
    assert.ok(keys.includes(required), `${required} has no step of its own`);
  }
  assert.equal(new Set(keys).size, keys.length);
});

test('T12: a step nobody recorded is NOT_RECORDED, and says what would satisfy it', async () => {
  const client = world();
  const kase = await openCaseFor(client);
  const view = await getCustomsCaseWorkspace(kase.id, OPERATOR, opts(client));
  for (const step of view.checklist) {
    assert.equal(step.state, 'NOT_RECORDED');
    assert.ok(step.needed && step.needed.length > 10, `${step.key} does not say what is needed`);
  }
  assert.equal(view.open_actions.length, CUSTOMS_STEPS.length);
});

test('T12: a REPORTED step is not an EVIDENCED one', async () => {
  const client = world();
  const kase = await openCaseFor(client);
  await withAgent(client, kase);
  await recordEvent(kase.id, { event_type: 'LODGEMENT_REPORTED', source_kind: 'AGENT_REPORT' }, AGENT, opts(client));
  await recordEvent(kase.id, { event_type: 'RELEASE_EVIDENCE_RECEIVED', source_kind: 'AUTHORITY_DOCUMENT', evidence_document_id: 'doc-release' }, AGENT, opts(client));

  const view = await getCustomsCaseWorkspace(kase.id, OPERATOR, opts(client));
  const byKey = Object.fromEntries(view.checklist.map((s) => [s.key, s]));
  assert.equal(byKey.LODGEMENT.state, 'REPORTED');
  assert.equal(byKey.RELEASE.state, 'EVIDENCED');
});

// ── 6. General cargo, and the vehicle firewall ─────────────────────────────

test('T12: GENERAL cargo completes without any vehicle projection', async () => {
  const client = world();
  const kase = await openCaseFor(client, { cargo_kind: 'GENERAL' });
  await withAgent(client, kase);
  for (const [type, extra] of [
    ['GATEWAY_ARRIVAL_OBSERVED', {}],
    ['DOCUMENT_PROVIDED', { source_kind: 'IMPORTER_DOCUMENT', evidence_document_id: 'doc-receipt' }],
    ['LODGEMENT_REPORTED', { source_kind: 'AGENT_REPORT' }],
    ['ASSESSMENT_EVIDENCE_RECEIVED', { source_kind: 'AUTHORITY_DOCUMENT', evidence_document_id: 'doc-assessment', amount_value: 900, amount_currency: 'USD' }],
    ['PAYMENT_EVIDENCE_RECEIVED', { source_kind: 'IMPORTER_DOCUMENT', evidence_document_id: 'doc-receipt', amount_value: 900, amount_currency: 'USD' }],
    ['RELEASE_EVIDENCE_RECEIVED', { source_kind: 'AUTHORITY_DOCUMENT', evidence_document_id: 'doc-release' }],
    ['PORT_RELEASE_OBSERVED', {}],
    ['COLLECTION_OBSERVED', {}],
    ['DELIVERY_OBSERVED', {}],
  ]) {
    await recordEvent(kase.id, { event_type: type, ...extra }, AGENT, opts(client));
  }
  const view = await getCustomsCaseWorkspace(kase.id, OPERATOR, opts(client));
  assert.equal(view.vehicle, null, 'general cargo was given a vehicle projection');
  assert.equal(view.open_actions.length, 0, `still open: ${view.open_actions.map((a) => a.key).join(', ')}`);
});

test('T12: VEHICLE cargo gets a projection that creates no vehicle authority record', async () => {
  const client = world();
  const kase = await openCaseFor(client, { cargo_kind: 'VEHICLE' });
  await withAgent(client, kase);
  await recordEvent(kase.id, { event_type: 'RELEASE_EVIDENCE_RECEIVED', source_kind: 'AUTHORITY_DOCUMENT', evidence_document_id: 'doc-release' }, AGENT, opts(client));

  const view = await getCustomsCaseWorkspace(kase.id, OPERATOR, opts(client));
  assert.ok(view.vehicle, 'vehicle cargo has no vehicle projection');
  assert.match(view.vehicle.note, /remain with their own authorities and are not created here/i);
  // …and nothing was written to any of them.
  for (const table of ['cvr_ownership_records', 'vid_inspections', 'zinara_licensing_records', 'zimra_declarations', 'cid_clearance_records']) {
    assert.equal((client.__tables?.[table] || []).length, 0, `T12 wrote to ${table}`);
  }
});

test('T12: neither service writes ANY government registry table', async () => {
  for (const file of ['backend/services/diaspora/customsCaseService.js', 'backend/services/diaspora/customsProjectionService.js']) {
    const code = (await readFile(file, 'utf8')).replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
    for (const table of ['zimra_declarations', 'cvr_ownership_records', 'cid_clearance_records', 'vid_inspections', 'zinara_licensing_records']) {
      assert.ok(!new RegExp(`['"]${table}['"]`).test(code), `${file} references the government registry table ${table}`);
    }
  }
});

test('T12: VEHICLE_REGISTRATION is not an event this phase can record', () => {
  // Registration is the CVR's act. A type for it here is how a phase starts writing another
  // authority's records.
  assert.ok(!CUSTOMS_EVENT_TYPE_KEYS.includes('VEHICLE_REGISTRATION'));
  assert.ok(!CUSTOMS_EVENT_TYPE_KEYS.some((k) => /REGISTRATION|LICENC|LICENS/i.test(k)));
});

// ── 7. Time, and the participant view ──────────────────────────────────────

test('T12: an event cannot be recorded as happening in the future', async () => {
  const future = new Date(Date.now() + 7 * 86400_000).toISOString();
  assert.throws(() => observedAt(future), /in the future/);
  const client = world();
  const kase = await openCaseFor(client);
  await assert.rejects(
    () => recordEvent(kase.id, { event_type: 'GATEWAY_ARRIVAL_OBSERVED', event_time: future }, OPERATOR, opts(client)),
    /in the future/,
  );
});

test('T12: the participant sees their own case, in plain language, with no internal ids', async () => {
  const client = world();
  const kase = await openCaseFor(client);
  await withAgent(client, kase);
  await recordEvent(kase.id, { event_type: 'LODGEMENT_REPORTED', source_kind: 'AGENT_REPORT' }, AGENT, opts(client));

  const mine = await getMyCustomsStatus('cargo_reservation', RES_A, CUSTOMER, opts(client));
  assert.equal(mine.state, 'IN_PROGRESS');
  assert.equal(mine.agent.display_name, 'Nyati Clearing (Pvt) Ltd');
  const text = JSON.stringify(mine);
  assert.ok(!text.includes('user-agent'), 'the agent\'s internal id is exposed to the participant');
  assert.ok(!text.includes('user-operator'), 'the operator is named to the participant');
  assert.ok(!text.includes(RES_B), 'another participant\'s booking appears');
  assert.ok(!text.includes('tenant-op'), 'the tenant is exposed');
});

test('T12: a participant with no case is told nothing has started — not that nothing is wrong', async () => {
  const client = world();
  const mine = await getMyCustomsStatus('cargo_reservation', RES_A, CUSTOMER, opts(client));
  assert.equal(mine.state, 'NO_CASE');
  assert.equal(mine.assessment, null);
  assert.match(mine.note, /has not been recorded/i);
});

test('T12: a co-loader cannot read another participant\'s customs status', async () => {
  const client = world();
  await openCaseFor(client);
  await assert.rejects(() => getMyCustomsStatus('cargo_reservation', RES_A, COLOADER, opts(client)), /not yours/);
});

test('T12: the participant is told what is needed next, from the same facts', async () => {
  const client = world();
  const kase = await openCaseFor(client);
  const mine = await getMyCustomsStatus('cargo_reservation', RES_A, CUSTOMER, opts(client));
  assert.match(mine.next_action, /^Next: /);
  assert.ok(mine.checklist.length === CUSTOMS_STEPS.length);
  assert.equal(kase.reference, mine.reference);
});

test('T12: every recordable event type has a rule for who may assert it', () => {
  for (const type of CUSTOMS_EVENT_TYPE_KEYS) {
    assert.ok(Array.isArray(WHO_MAY_ASSERT[type]) && WHO_MAY_ASSERT[type].length, `${type} has no assertion rule`);
    assert.ok(!WHO_MAY_ASSERT[type].includes('IMPORTER') || ['DOCUMENT_PROVIDED', 'PAYMENT_EVIDENCE_RECEIVED'].includes(type),
      `${type} lets the importer assert a customs act`);
  }
  // Every observable type is a physical fact, and every non-observable one is somebody's claim.
  for (const type of CARUP_OBSERVABLE) assert.equal(CUSTOMS_EVENT_TYPES[type].observed, true);
});

test('T12: two consignments do not share a case reference', async () => {
  // The collision found twice on the deployed product in T9 and T10: a reference derived from the
  // subject rather than from the row's own id.
  const client = world();
  const a = await openCaseFor(client);
  const b = await openCase({ subject_type: 'cargo_reservation', subject_id: RES_B, shipment_id: SHIPMENT }, OPERATOR, opts(client));
  assert.notEqual(a.reference, b.reference);
  assert.match(a.reference, /^CUST-[0-9A-F]{8}$/);
});

test('T12: one live case per consignment', async () => {
  const client = world();
  await openCaseFor(client);
  await assert.rejects(() => openCaseFor(client), /already has a live customs case|uq_customs_case_live_subject/);
});

test('T12: every source kind has wording, and none of them says "cleared" or "duty paid"', () => {
  for (const [kind, wording] of Object.entries(SOURCE_WORDING)) {
    assert.ok(wording.strength && wording.explains, `${kind} has no wording`);
  }
  const all = Object.values(SOURCE_WORDING).map((w) => `${w.prefix} ${w.explains}`).join(' ').toLowerCase();
  for (const forbidden of ['duty paid', 'cleared customs', 'customs cleared']) {
    assert.ok(!all.includes(forbidden), `the wording says "${forbidden}"`);
  }
});
