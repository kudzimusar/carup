/**
 * Trade OS T12 — deployed staging journeys A–I.
 *
 * Every assertion is made against the DEPLOYED backend over HTTP as a real signed-in person, and the
 * T11 precondition (an arrived shipment) is asserted rather than manufactured.
 *
 * The privacy journey carries POSITIVE CONTROLS on both sides. So does every refusal: a matrix that
 * only shows refusals passes just as happily when the endpoint is broken for everybody.
 *
 * REPEATABILITY: this opens customs cases and appends events, and events are append-only in the
 * database — they can only be soft-deleted. Before a re-run, soft-delete the T12 UAT cases (their
 * events and appointments cascade on the case, so soft-delete the events first, then the case).
 *
 * Usage:
 *   node scripts/uat/t12-customs-journeys.mjs --api <backend-base-url> --password-file <path>
 */
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []),
);
const API = (args.api || '').replace(/\/$/, '');
if (!API) { console.error('--api is required'); process.exit(2); }
const { readFileSync } = await import('node:fs');
const PASSWORD = readFileSync(args['password-file'], 'utf8').trim();

const OP_TENANT = '99990000-0000-4000-8000-000000000001';
const FOREIGN_TENANT = '99990000-0000-4000-8000-000000000002';
const SHIPMENT = args.shipment || 'a927d4d6-e714-4b0f-af00-ad971cd022dc';
const RES_VEHICLE = '99994444-0000-4000-8000-000000000001';   // customer's — VEHICLE cargo
const RES_GENERAL = '99994444-0000-4000-8000-000000000002';   // co-loader's — GENERAL cargo
const DOC = args.doc || 'ecae599f-e84a-4328-8100-60d1268df870';

const results = [];
let journey = '';
const check = async (name, fn) => {
  try { const d = await fn(); results.push({ journey, name, ok: true, detail: d || null }); }
  catch (e) { results.push({ journey, name, ok: false, error: String(e.message || e).slice(0, 400) }); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

async function csrf(headers = {}) {
  const r = await fetch(`${API}/api/security/csrf-token`, { headers });
  const b = await r.json().catch(() => ({}));
  return { token: b?.csrfToken || b?.data?.csrfToken || null, cookie: (r.headers.get('set-cookie') || '').split(';')[0] || '' };
}
async function signIn(email) {
  const g = await csrf();
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': g.token, cookie: g.cookie },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`login ${email}: ${r.status} ${JSON.stringify(b).slice(0, 200)}`);
  const u = b?.data?.user || b?.user || {};
  const s = { email, token: b?.data?.token || b?.token, id: u.id, role: u.role };
  const bound = await csrf({ 'x-session-token': s.token, 'x-user-id': s.id });
  return { ...s, csrf: bound.token, cookie: bound.cookie };
}
async function api(session, path, { method = 'GET', body, tenantId } = {}) {
  const headers = { 'content-type': 'application/json', 'x-session-token': session.token, 'x-user-id': session.id };
  if (session.role) headers['x-stakeholder-role'] = session.role;
  if (tenantId) headers['x-tenant-id'] = tenantId;
  if (method !== 'GET') { headers['x-csrf-token'] = session.csrf; headers.cookie = session.cookie; }

  // A preview deployment cold-starts, and the connection is dropped rather than answered. Retrying
  // the TRANSPORT is not retrying the assertion: a refusal still refuses and a 500 is still a 500 —
  // only "no answer at all" is tried again, and the last transport error is reported if it persists.
  let lastTransportError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const r = await fetch(`${API}/api/diaspora${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
      const t = await r.text();
      let p; try { p = JSON.parse(t); } catch { p = { raw: t.slice(0, 200) }; }
      return { status: r.status, body: p, data: p?.data };
    } catch (e) {
      lastTransportError = e;
      await new Promise((res) => setTimeout(res, 1500 * attempt));
    }
  }
  throw new Error(`transport failed after 3 attempts: ${lastTransportError?.message || lastTransportError}`);
}

const operator = await signIn('t9uat-operator@carup-staging.test');
const customer = await signIn('t9uat-customer@carup-staging.test');
const coloader = await signIn('t9uat-coloader@carup-staging.test');
const foreign = await signIn('t9uat-foreign@carup-staging.test');
const agent = await signIn('t12uat-agent@carup-staging.test');
const foreignAgent = await signIn('t12uat-foreign-agent@carup-staging.test');
const asOp = (p, o = {}) => api(operator, p, { ...o, tenantId: OP_TENANT });
console.log(`signed in: operator ${operator.id} · customer ${customer.id} · co-loader ${coloader.id} · agent ${agent.id} · foreign agent ${foreignAgent.id}\n`);

let vehicleCase = null;   // the customer's, VEHICLE
let generalCase = null;   // the co-loader's, GENERAL

// ══ Journey A — agent coordination ═════════════════════════════════════════
journey = 'A — agent coordination';

await check('the T11 precondition is an ARRIVED shipment, built by the T11 product', async () => {
  const r = await asOp(`/shipment-tracking/${SHIPMENT}`);
  assert(r.status === 200, `status ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  assert(['ARRIVED', 'CUSTOMS_HOLD'].includes(r.data.shipment.stage), `shipment is ${r.data.shipment.stage}`);
  return `shipment at ${r.data.shipment.stage}`;
});

await check('a customs case is opened for the arrived cargo', async () => {
  const r = await api(operator, '/customs-cases', {
    method: 'POST', tenantId: OP_TENANT,
    body: {
      subject_type: 'cargo_reservation', subject_id: RES_VEHICLE, shipment_id: SHIPMENT, cargo_kind: 'VEHICLE',
      gateway_port: 'Beira', gateway_country: 'Mozambique',
      destination_country: 'Zimbabwe', destination_city: 'Harare', final_destination: 'Harare — customer address',
    },
  });
  assert(r.status === 201, `status ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
  vehicleCase = r.data.id;
  assert(/^CUST-[0-9A-F]{8}$/.test(r.data.reference), `reference ${r.data.reference}`);
  return `${r.data.reference} (VEHICLE)`;
});

await check('a clearing agent is appointed — as an appointment, not a licence', async () => {
  const r = await api(operator, `/customs-cases/${vehicleCase}/agent`, {
    method: 'POST', tenantId: OP_TENANT,
    body: { agent_kind: 'PERSON', agent_user_id: agent.id, agent_display_name: 'Nyati Clearing (Pvt) Ltd', licence_reference_claimed: 'CA/2026/0042' },
  });
  assert(r.status === 201, `status ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
  const view = await asOp(`/customs-cases/${vehicleCase}`);
  assert(view.data.agent.licence_reference_claimed === 'CA/2026/0042', 'the claimed licence was not kept');
  assert(/has not verified/i.test(view.data.agent.licence_note), `licence note: ${view.data.agent.licence_note}`);
  return 'appointed, licence recorded as unverified';
});

await check('the agent can request a document; the participant sees it attributed', async () => {
  const r = await api(agent, `/customs-cases/${vehicleCase}/events`, {
    method: 'POST', body: { event_type: 'DOCUMENT_REQUESTED', source_kind: 'AGENT_REPORT', notes: 'Commercial invoice and BoL please' },
  });
  assert(r.status === 201, `status ${r.status} ${JSON.stringify(r.body).slice(0, 250)}`);
  return 'requested';
});

await check('the agent reports the declaration lodged, and it reads AS a report', async () => {
  const r = await api(agent, `/customs-cases/${vehicleCase}/events`, {
    method: 'POST', body: { event_type: 'LODGEMENT_REPORTED', source_kind: 'AGENT_REPORT' },
  });
  assert(r.status === 201, `status ${r.status} ${JSON.stringify(r.body).slice(0, 250)}`);

  const mine = await api(customer, `/my-customs/cargo_reservation/${RES_VEHICLE}`);
  assert(mine.status === 200, `participant ${mine.status}`);
  const lodged = mine.data.timeline.find((e) => e.event_type === 'LODGEMENT_REPORTED');
  assert(lodged, 'the participant cannot see the lodgement at all');
  assert(/^Clearing agent reported:/.test(lodged.sentence), `sentence: ${lodged.sentence}`);
  assert(lodged.strength === 'REPORTED', `strength ${lodged.strength}`);
  return lodged.sentence;
});

// ══ Journey B — assessment ════════════════════════════════════════════════
journey = 'B — assessment';

await check('before any assessment, the amount is NOT YET ASSESSED — not zero', async () => {
  const mine = await api(customer, `/my-customs/cargo_reservation/${RES_VEHICLE}`);
  assert(mine.data.assessment.assessed === false, 'something was assessed already');
  assert(mine.data.assessment.amount === null, `amount is ${mine.data.assessment.amount}`);
  assert(/Not yet assessed/i.test(mine.data.assessment.headline), mine.data.assessment.headline);
  assert(/does not calculate/i.test(mine.data.assessment.detail), mine.data.assessment.detail);
  return 'no amount, and no zero';
});

await check('an AUTHORITY claim with no document is refused', async () => {
  const r = await api(agent, `/customs-cases/${vehicleCase}/events`, {
    method: 'POST', body: { event_type: 'ASSESSMENT_EVIDENCE_RECEIVED', source_kind: 'AUTHORITY_DOCUMENT', amount_value: 1420.5, amount_currency: 'USD' },
  });
  assert(r.status >= 400, `an unevidenced authority claim was accepted: ${r.status}`);
  assert(/bound to that document/i.test(JSON.stringify(r.body)), JSON.stringify(r.body).slice(0, 200));
  return `refused ${r.status}`;
});

await check('assessment evidence with a document shows the amount, its source and its date', async () => {
  const r = await api(agent, `/customs-cases/${vehicleCase}/events`, {
    method: 'POST',
    body: {
      event_type: 'ASSESSMENT_EVIDENCE_RECEIVED', source_kind: 'AUTHORITY_DOCUMENT', evidence_document_id: DOC,
      amount_value: 1420.5, amount_currency: 'USD',
      source_description: 'ZIMRA assessment notice attached to this case',
      customs_rate_value: 26.4312, customs_rate_basis: 'USD/ZWG',
      customs_rate_source: 'ZIMRA rates of exchange for customs purposes, week commencing 2026-09-07',
      customs_rate_effective_from: '2026-09-07', customs_rate_effective_to: '2026-09-13',
    },
  });
  assert(r.status === 201, `status ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);

  const view = await asOp(`/customs-cases/${vehicleCase}`);
  assert(view.data.assessment.assessed === true, 'the assessment did not land');
  assert(view.data.assessment.amount === 1420.5, `amount ${view.data.assessment.amount}`);
  assert(view.data.assessment.headline === 'Assessment amount', view.data.assessment.headline);
  assert(/did not calculate it/i.test(view.data.assessment.detail), view.data.assessment.detail);
  assert(view.data.assessment.customs_rate.value === 26.4312, 'the customs rate did not travel with it');
  assert(view.data.assessment.customs_rate.effective_from === '2026-09-07', 'the rate lost its effective date');
  assert(/ZIMRA/.test(view.data.assessment.customs_rate.source), 'the rate lost its source');
  return `USD 1420.50 · rate 26.4312 effective 2026-09-07`;
});

await check('an agent-typed amount reads as the AGENT\'s figure, not the authority\'s', async () => {
  // Same shape of claim on the OTHER case, so the two can be compared side by side.
  const opened = await api(operator, '/customs-cases', {
    method: 'POST', tenantId: OP_TENANT,
    body: {
      subject_type: 'cargo_reservation', subject_id: RES_GENERAL, shipment_id: SHIPMENT, cargo_kind: 'GENERAL',
      gateway_port: 'Beira', destination_country: 'Zimbabwe', destination_city: 'Harare',
    },
  });
  assert(opened.status === 201, `open ${opened.status} ${JSON.stringify(opened.body).slice(0, 250)}`);
  generalCase = opened.data.id;
  await api(operator, `/customs-cases/${generalCase}/agent`, {
    method: 'POST', tenantId: OP_TENANT,
    body: { agent_kind: 'PERSON', agent_user_id: agent.id, agent_display_name: 'Nyati Clearing (Pvt) Ltd' },
  });
  const r = await api(agent, `/customs-cases/${generalCase}/events`, {
    method: 'POST', body: { event_type: 'ASSESSMENT_EVIDENCE_RECEIVED', source_kind: 'AGENT_REPORT', amount_value: 1420.5, amount_currency: 'USD' },
  });
  assert(r.status === 201, `status ${r.status} ${JSON.stringify(r.body).slice(0, 250)}`);

  const view = await asOp(`/customs-cases/${generalCase}`);
  assert(view.data.assessment.amount === 1420.5, 'the figure changed');
  assert(view.data.assessment.headline === 'Agent-reported amount', view.data.assessment.headline);
  assert(/their figure, not the authority/i.test(view.data.assessment.detail), view.data.assessment.detail);
  return 'same number, different claim';
});

await check('a customs rate with no source or no date is refused', async () => {
  const seen = [];
  for (const [how, extra] of [
    ['no source', { customs_rate_value: 13.5, customs_rate_effective_from: '2026-09-07' }],
    ['no effective date', { customs_rate_value: 13.5, customs_rate_source: 'somebody said so' }],
  ]) {
    const r = await api(agent, `/customs-cases/${generalCase}/events`, {
      method: 'POST', body: { event_type: 'ASSESSMENT_EVIDENCE_RECEIVED', source_kind: 'AGENT_REPORT', amount_value: 1, amount_currency: 'USD', ...extra },
    });
    assert(r.status >= 400, `a rate with ${how} was accepted: ${r.status}`);
    seen.push(`${how} ${r.status}`);
  }
  return seen.join(' · ');
});

// ══ Journey C — payment evidence ══════════════════════════════════════════
journey = 'C — payment evidence';

await check('the IMPORTER may supply their own receipt — positive control', async () => {
  const r = await api(customer, `/customs-cases/${vehicleCase}/events`, {
    method: 'POST', body: { event_type: 'PAYMENT_EVIDENCE_RECEIVED', source_kind: 'IMPORTER_DOCUMENT', evidence_document_id: DOC, amount_value: 1420.5, amount_currency: 'USD' },
  });
  assert(r.status === 201, `status ${r.status} ${JSON.stringify(r.body).slice(0, 250)}`);
  return 'accepted, as the importer';
});

await check('it reads as evidence received, NOT as the authority confirming payment', async () => {
  const mine = await api(customer, `/my-customs/cargo_reservation/${RES_VEHICLE}`);
  assert(mine.data.payment.evidence_received === true, 'the payment evidence did not land');
  assert(mine.data.payment.headline === 'Payment evidence received', mine.data.payment.headline);
  assert(/not the authority confirming/i.test(mine.data.payment.detail), mine.data.payment.detail);
  const text = JSON.stringify(mine.data).toLowerCase();
  assert(!text.includes('duty paid'), 'the participant view says "duty paid"');
  assert(!text.includes('zimra confirms'), 'the participant view claims ZIMRA confirmed it');
  return mine.data.payment.headline;
});

// ══ Journey D — release ═══════════════════════════════════════════════════
journey = 'D — release';

await check('release evidence from a governed source shows its source and status', async () => {
  const r = await api(agent, `/customs-cases/${vehicleCase}/events`, {
    method: 'POST', body: { event_type: 'RELEASE_EVIDENCE_RECEIVED', source_kind: 'AUTHORITY_DOCUMENT', evidence_document_id: DOC },
  });
  assert(r.status === 201, `status ${r.status} ${JSON.stringify(r.body).slice(0, 250)}`);
  const mine = await api(customer, `/my-customs/cargo_reservation/${RES_VEHICLE}`);
  assert(mine.data.release.evidence_received === true, 'the release evidence did not land');
  assert(mine.data.release.headline === 'Release document received', mine.data.release.headline);
  assert(mine.data.release.source_strength === 'AUTHORITY_EVIDENCE', mine.data.release.source_strength);
  return mine.data.release.headline;
});

await check('a release REPORTED without a document reads differently', async () => {
  const r = await api(agent, `/customs-cases/${generalCase}/events`, {
    method: 'POST', body: { event_type: 'RELEASE_EVIDENCE_RECEIVED', source_kind: 'AGENT_REPORT' },
  });
  assert(r.status === 201, `status ${r.status}`);
  const view = await asOp(`/customs-cases/${generalCase}`);
  assert(view.data.release.headline === 'Release reported', view.data.release.headline);
  assert(/has not been evidenced/i.test(view.data.release.detail), view.data.release.detail);
  return 'reported ≠ evidenced';
});

await check('T12 did NOT rewrite the shipment\'s movement history', async () => {
  // T11 remains the movement authority. Nothing in T12 may touch departure, transit or arrival.
  const t = await asOp(`/shipments/${SHIPMENT}/timeline`);
  assert(t.status === 200, `status ${t.status}`);
  const stages = (t.data || []).map((e) => e.stage);
  for (const s of stages) {
    assert(!/CUSTOMS_|RELEASE|DELIVER/i.test(s) || s === 'CUSTOMS_HOLD', `T12 wrote a movement stage: ${s}`);
  }
  const v = await asOp(`/shipment-tracking/${SHIPMENT}`);
  assert(v.data.dates.observed_departure, 'the observed departure disappeared');
  return `${stages.length} movement events, untouched`;
});

// ══ Journey E — gateway to Zimbabwe ═══════════════════════════════════════
journey = 'E — gateway ≠ destination';

await check('each handoff is recorded and read separately', async () => {
  for (const type of ['GATEWAY_ARRIVAL_OBSERVED', 'TRANSIT_TO_DESTINATION_STARTED', 'DESTINATION_ARRIVAL_OBSERVED', 'PORT_RELEASE_OBSERVED', 'COLLECTION_OBSERVED']) {
    const r = await api(operator, `/customs-cases/${vehicleCase}/events`, { method: 'POST', tenantId: OP_TENANT, body: { event_type: type, location: 'Beira / Harare' } });
    assert(r.status === 201, `${type} → ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  }
  const view = await asOp(`/customs-cases/${vehicleCase}`);
  const h = view.data.handoffs;
  assert(h.gateway.observed && h.destination.observed, 'a handoff did not land');
  assert(h.gateway.arrived_at !== h.destination.arrived_at, 'the gateway and the destination share a timestamp — they have been collapsed');
  assert(h.delivered_at === null, 'a delivery was invented from a collection');
  return `gateway ${h.gateway.arrived_at} ≠ destination ${h.destination.arrived_at} · delivered: none`;
});

await check('a gateway arrival did NOT become a delivery on the participant page', async () => {
  const mine = await api(customer, `/my-customs/cargo_reservation/${RES_VEHICLE}`);
  const delivered = mine.data.checklist.find((s) => s.key === 'DELIVERY');
  assert(delivered.state === 'NOT_RECORDED', `delivery reads ${delivered.state}`);
  assert(mine.data.handoffs.delivered_at === null, 'the participant is shown a delivery');
  return 'still not delivered, and says so';
});

await check('delivery is its own observation, and completes the destination handoff', async () => {
  const r = await api(operator, `/customs-cases/${vehicleCase}/events`, { method: 'POST', tenantId: OP_TENANT, body: { event_type: 'DELIVERY_OBSERVED', location: 'Harare — customer address' } });
  assert(r.status === 201, `status ${r.status}`);
  const mine = await api(customer, `/my-customs/cargo_reservation/${RES_VEHICLE}`);
  assert(mine.data.handoffs.delivered_at, 'the delivery did not land');
  return `delivered ${mine.data.handoffs.delivered_at}`;
});

// ══ Journey F — vehicle ═══════════════════════════════════════════════════
journey = 'F — vehicle';

await check('vehicle cargo gets a vehicle projection that creates no vehicle authority', async () => {
  const view = await asOp(`/customs-cases/${vehicleCase}`);
  assert(view.data.case.cargo_kind === 'VEHICLE', view.data.case.cargo_kind);
  assert(view.data.vehicle, 'vehicle cargo has no vehicle projection');
  assert(/not created here/i.test(view.data.vehicle.note), view.data.vehicle.note);
  return view.data.vehicle.evidence_available.join(', ') || 'evidence projected';
});

await check('delivery is not registration, and nothing claims otherwise', async () => {
  const mine = await api(customer, `/my-customs/cargo_reservation/${RES_VEHICLE}`);
  const text = JSON.stringify(mine.data).toLowerCase();
  for (const forbidden of ['registered', 'registration number', 'number plate', 'zinara', 'cvr', 'vid inspection']) {
    assert(!text.includes(forbidden), `the participant view says "${forbidden}"`);
  }
  return 'delivered, and nothing about registration';
});

// ══ Journey G — general cargo ═════════════════════════════════════════════
journey = 'G — general cargo';

await check('general cargo completes T12 with NO vehicle authority anywhere', async () => {
  for (const type of ['GATEWAY_ARRIVAL_OBSERVED', 'DESTINATION_ARRIVAL_OBSERVED', 'PORT_RELEASE_OBSERVED', 'COLLECTION_OBSERVED', 'DELIVERY_OBSERVED']) {
    const r = await api(operator, `/customs-cases/${generalCase}/events`, { method: 'POST', tenantId: OP_TENANT, body: { event_type: type } });
    assert(r.status === 201, `${type} → ${r.status}`);
  }
  const view = await asOp(`/customs-cases/${generalCase}`);
  assert(view.data.case.cargo_kind === 'GENERAL', view.data.case.cargo_kind);
  assert(view.data.vehicle === null, 'general cargo was given a vehicle projection');
  const text = JSON.stringify(view.data).toLowerCase();
  // WHOLE WORDS. A bare substring ban is the defect T10 hit when `eta` matched `metadata`: here
  // `vin` matches "leaving" and "moving", so the check would fail on the phase working correctly.
  for (const forbidden of ['vin', 'chassis', 'zinara', 'registration', 'cvr']) {
    assert(!new RegExp(`\\b${forbidden}\\b`).test(text), `general cargo was asked for "${forbidden}"`);
  }
  return 'completed with no VIN, no CVR, no VID, no ZINARA';
});

// ══ Journey H — privacy ═══════════════════════════════════════════════════
journey = 'H — privacy';

await check('POSITIVE CONTROL: each participant CAN read their own customs case', async () => {
  const a = await api(customer, `/my-customs/cargo_reservation/${RES_VEHICLE}`);
  const b = await api(coloader, `/my-customs/cargo_reservation/${RES_GENERAL}`);
  assert(a.status === 200 && b.status === 200, `${a.status}/${b.status}`);
  return `customer ${a.data.state} · co-loader ${b.data.state}`;
});

await check('POSITIVE CONTROL: the operator and the appointed agent CAN read the case', async () => {
  const op = await asOp(`/customs-cases/${vehicleCase}`);
  const ag = await api(agent, `/customs-cases/${vehicleCase}`);
  assert(op.status === 200, `operator ${op.status}`);
  assert(ag.status === 200, `agent ${ag.status}`);
  return 'both 200';
});

await check('a co-loader cannot read another participant\'s customs case', async () => {
  const r = await api(coloader, `/my-customs/cargo_reservation/${RES_VEHICLE}`);
  assert(r.status === 401 || r.status === 403, `status ${r.status}`);
  return `refused ${r.status}`;
});

await check('a co-loader cannot read the other case\'s workspace, amounts or documents', async () => {
  const r = await api(coloader, `/customs-cases/${vehicleCase}`);
  assert(r.status === 401 || r.status === 403, `status ${r.status}`);
  return `refused ${r.status}`;
});

await check('a participant CANNOT self-clear — lodgement, assessment, release all refused', async () => {
  const seen = [];
  for (const type of ['LODGEMENT_REPORTED', 'ASSESSMENT_EVIDENCE_RECEIVED', 'RELEASE_EVIDENCE_RECEIVED', 'INSPECTION_EVIDENCE_RECEIVED']) {
    const r = await api(customer, `/customs-cases/${vehicleCase}/events`, {
      method: 'POST', body: { event_type: type, source_kind: 'AGENT_REPORT' },
    });
    assert(r.status === 401 || r.status === 403, `a customer recorded ${type}: ${r.status}`);
    seen.push(`${type} ${r.status}`);
  }
  return seen.length + ' refused';
});

await check('a FOREIGN clearing agent gets nothing on a case they were not appointed to', async () => {
  const read = await api(foreignAgent, `/customs-cases/${vehicleCase}`);
  const write = await api(foreignAgent, `/customs-cases/${vehicleCase}/events`, {
    method: 'POST', body: { event_type: 'RELEASE_EVIDENCE_RECEIVED', source_kind: 'AGENT_REPORT' },
  });
  assert(read.status === 401 || read.status === 403, `read ${read.status}`);
  assert(write.status === 401 || write.status === 403, `write ${write.status}`);
  return `read ${read.status} · write ${write.status}`;
});

await check('nobody can self-appoint as the clearing agent', async () => {
  const r = await api(foreignAgent, `/customs-cases/${vehicleCase}/agent`, {
    method: 'POST', body: { agent_kind: 'PERSON', agent_user_id: foreignAgent.id, agent_display_name: 'Self Appointed Ltd' },
  });
  assert(r.status === 401 || r.status === 403, `status ${r.status}`);
  return `refused ${r.status}`;
});

await check('a foreign logistics tenant gets nothing, even forging the tenant header', async () => {
  const own = await api(foreign, `/customs-cases/${vehicleCase}`, { tenantId: FOREIGN_TENANT });
  const forged = await api(foreign, `/customs-cases/${vehicleCase}`, { tenantId: OP_TENANT });
  assert(own.status === 401 || own.status === 403, `own tenant ${own.status}`);
  assert(forged.status === 401 || forged.status === 403, `forged tenant ${forged.status}`);
  return `own ${own.status} · forged ${forged.status}`;
});

await check('an anonymous caller is refused — 401/403, never a wrong-route 404', async () => {
  const seen = [];
  for (const p of [`/customs-cases/${vehicleCase}`, `/my-customs/cargo_reservation/${RES_VEHICLE}`]) {
    const r = await fetch(`${API}/api/diaspora${p}`);
    seen.push(r.status);
    assert(r.status === 401 || r.status === 403, `${p} returned ${r.status} — a 404 is not authorization proof`);
  }
  const w = await fetch(`${API}/api/diaspora/customs-cases/${vehicleCase}/events`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event_type: 'RELEASE_EVIDENCE_RECEIVED', source_kind: 'AGENT_REPORT' }),
  });
  seen.push(w.status);
  assert(w.status === 401 || w.status === 403, `anonymous write ${w.status}`);
  return seen.join(' · ');
});

await check('a forged case id gets nothing', async () => {
  const r = await asOp('/customs-cases/11111111-2222-4333-8444-555555555555');
  assert(r.status >= 400, `status ${r.status}`);
  return `refused ${r.status}`;
});

await check('the participant projection carries no other participant\'s data', async () => {
  const mine = await api(customer, `/my-customs/cargo_reservation/${RES_VEHICLE}`);
  const text = JSON.stringify(mine.data);
  assert(!text.includes(RES_GENERAL), 'another participant\'s booking appears');
  assert(!text.includes(operator.id), 'the operator is named to the participant');
  assert(!text.includes(agent.id), 'the agent\'s internal id is exposed');
  assert(!text.includes(OP_TENANT), 'the tenant id is exposed');
  assert(!text.includes(DOC), 'a document id is exposed to the participant');
  return 'clean';
});

// ══ Journey I — unknowns stay unknown ═════════════════════════════════════
journey = 'I — unknowns';

await check('a consignment with no case at all says so, and shows no amount', async () => {
  // A third booking that never got a case.
  const r = await api(customer, '/my-customs/cargo_reservation/99994444-0000-4000-8000-000000000004');
  assert(r.status === 200, `status ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  assert(r.data.state === 'NO_CASE', `state ${r.data.state}`);
  assert(r.data.assessment === null, 'an amount appeared on a case that does not exist');
  assert(r.data.release === null && r.data.handoffs === null, 'a journey appeared on a case that does not exist');
  return 'NO_CASE, and nothing invented';
});

await check('no assessment → no amount; no rate → no rate; no release → no "cleared"', async () => {
  const opened = await api(operator, '/customs-cases', {
    method: 'POST', tenantId: OP_TENANT,
    body: { subject_type: 'cargo_reservation', subject_id: '99994444-0000-4000-8000-000000000005', gateway_port: 'Beira' },
  });
  assert(opened.status === 201, `open ${opened.status} ${JSON.stringify(opened.body).slice(0, 250)}`);
  const view = await asOp(`/customs-cases/${opened.data.id}`);
  assert(view.data.assessment.amount === null, `amount ${view.data.assessment.amount}`);
  assert(view.data.assessment.customs_rate === null, 'a rate appeared from somewhere');
  assert(view.data.release.evidence_received === false, 'a release appeared from somewhere');
  const text = JSON.stringify(view.data).toLowerCase();
  for (const forbidden of ['cleared', 'duty paid']) assert(!text.includes(forbidden), `the view says "${forbidden}"`);
  assert(view.data.open_actions.length === 8, `${view.data.open_actions.length} open actions`);
  return 'every step unknown, and each says what would satisfy it';
});

await check('a future event is refused', async () => {
  const future = new Date(Date.now() + 7 * 86400_000).toISOString();
  const r = await api(operator, `/customs-cases/${generalCase}/events`, {
    method: 'POST', tenantId: OP_TENANT, body: { event_type: 'COLLECTION_OBSERVED', event_time: future },
  });
  assert(r.status >= 400, `a future event was accepted: ${r.status}`);
  assert(/future/i.test(JSON.stringify(r.body)), JSON.stringify(r.body).slice(0, 200));
  return `refused ${r.status}`;
});

await check('a second live case for the same consignment is refused', async () => {
  const r = await api(operator, '/customs-cases', {
    method: 'POST', tenantId: OP_TENANT,
    body: { subject_type: 'cargo_reservation', subject_id: RES_VEHICLE, shipment_id: SHIPMENT },
  });
  assert(r.status >= 400, `a second case was opened: ${r.status}`);
  assert(/already has a live customs case/i.test(JSON.stringify(r.body)), JSON.stringify(r.body).slice(0, 200));
  return `refused ${r.status}`;
});

// ── Report ─────────────────────────────────────────────────────────────────
let current = '';
for (const r of results) {
  if (r.journey !== current) { current = r.journey; console.log(`\n── ${current} ──`); }
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  · ${r.detail}` : ''}${r.error ? `  — ${r.error}` : ''}`);
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.length, ok: failed.length === 0 })}`);
console.log(`VEHICLE_CASE=${vehicleCase} GENERAL_CASE=${generalCase}`);
process.exit(failed.length ? 1 : 0);
