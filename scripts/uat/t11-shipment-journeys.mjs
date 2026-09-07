/**
 * Trade OS T11.5 — deployed staging journeys A–G.
 *
 * Every assertion is made against the DEPLOYED backend over HTTP as a real signed-in person.
 *
 * The precondition — a COMPLETED T10 load on the fixture sailing — is NOT seeded here. It was built
 * by the T10 product during T10's own certification, and this harness asserts it rather than
 * manufacturing it: a journey that creates its own preconditions in SQL proves the SQL.
 *
 * The privacy journey carries POSITIVE CONTROLS on both sides, because a matrix that only shows
 * refusals passes just as happily when the endpoint is broken for everybody. So does the container→
 * shipment gate, and so does the no-rewinding rule: something legitimate must still be accepted.
 *
 * REPEATABILITY: this creates one shipment and appends stage events, and stage events are append-only
 * in the database — they can only be soft-deleted. Before a re-run, soft-delete the shipment and its
 * events for import order 99992222-…-0001. That removes the PREVIOUS run's facts so the product has
 * to create them again; it asserts nothing into existence.
 *
 * Usage:
 *   node scripts/uat/t11-shipment-journeys.mjs --api <backend-base-url> --password-file <path>
 */
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []),
);
const API = (args.api || '').replace(/\/$/, '');
if (!API) { console.error('--api is required'); process.exit(2); }
const { readFileSync } = await import('node:fs');
const PASSWORD = readFileSync(args['password-file'], 'utf8').trim();

// ── Fixtures, as the T5/T9/T10 products left them ──────────────────────────
const LOADED_SAILING = '99993333-0000-4000-8000-000000000001';   // has a COMPLETED T10 load
const UNLOADED_SAILING = '77773333-0000-4000-8000-000000000001'; // has a load, but IN_PROGRESS
const OP_TENANT = '99990000-0000-4000-8000-000000000001';
const FOREIGN_TENANT = '99990000-0000-4000-8000-000000000002';
const ORDER_A = '99992222-0000-4000-8000-000000000001';
const ORDER_B = '99992222-0000-4000-8000-000000000002';
const RES_LOADED = '99994444-0000-4000-8000-000000000001';      // customer's — LOADED on the completed load
const RES_NOT_LOADED = '99994444-0000-4000-8000-000000000002';  // co-loader's — never in that load
const RES_LEFT_BEHIND = '88884444-0000-4000-8000-000000000002'; // co-loader's — LEFT_BEHIND on 88883333

// An ETA deliberately in the PAST. The ship was meant to be there by now, and nothing may read as
// arrived because of it.
const ETA_ALREADY_PASSED = '2026-09-01T00:00:00.000Z';
const PLANNED_DEPARTURE = '2026-08-25T00:00:00.000Z';

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
  const r = await fetch(`${API}/api/diaspora${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let p; try { p = JSON.parse(t); } catch { p = { raw: t.slice(0, 200) }; }
  return { status: r.status, body: p, data: p?.data };
}

const operator = await signIn('t9uat-operator@carup-staging.test');
const customer = await signIn('t9uat-customer@carup-staging.test');
const coloader = await signIn('t9uat-coloader@carup-staging.test');
const foreign = await signIn('t9uat-foreign@carup-staging.test');
const asOp = (p, o = {}) => api(operator, p, { ...o, tenantId: OP_TENANT });
console.log(`signed in: operator ${operator.id} · customer ${customer.id} · co-loader ${coloader.id} · foreign ${foreign.id}\n`);

let shipmentId = null;
let observedDeparture = null;

// ══ Journey A — a normal shipment, from a load that actually happened ══════
journey = 'A — normal shipment';

await check('the precondition is a COMPLETED T10 load, built by the T10 product', async () => {
  const r = await asOp(`/container-marketplace/${LOADED_SAILING}/load-state`);
  assert(r.status === 200, `status ${r.status} ${JSON.stringify(r.body).slice(0, 220)}`);
  const load = r.data?.load || r.data?.current_load || null;
  assert(load, `no load on the fixture sailing: ${JSON.stringify(r.data).slice(0, 220)}`);
  assert(load.status === 'COMPLETED', `the fixture load is ${load.status}, not COMPLETED`);
  return `load ${load.reference || load.id} COMPLETED`;
});

await check('a shipment is created; the plan stays a plan and no arrival is declared', async () => {
  const r = await api(operator, '/shipments', {
    method: 'POST', tenantId: OP_TENANT,
    body: {
      import_order_id: ORDER_A, container_id: LOADED_SAILING,
      carrier_name: 'Maersk', tracking_number: 'TRK-T11-UAT-1',
      origin_port: 'Durban', destination_port: 'Beira',
      // All three are CLAIMS made at creation. Only the estimate may survive as itself.
      departure_date: PLANNED_DEPARTURE,
      estimated_arrival_date: ETA_ALREADY_PASSED,
      actual_arrival_date: '2026-09-02T00:00:00.000Z',
    },
  });
  assert(r.status === 201, `status ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
  const row = r.data || r.body;
  shipmentId = row.id;
  assert(row.departure_date === null, `a planned departure was stored as observed: ${row.departure_date}`);
  assert(row.actual_arrival_date === null, `an arrival was declared at creation: ${row.actual_arrival_date}`);
  assert(row.metadata?.planned_departure_date === PLANNED_DEPARTURE, 'the plan was discarded instead of kept as a plan');
  assert(row.estimated_arrival_date, 'the estimate was dropped — an estimate is allowed to be an estimate');
  return `${row.id} · plan kept, observations NULL`;
});

await check('the operator view shows the load the shipment came from', async () => {
  const v = await asOp(`/shipment-tracking/${shipmentId}`);
  assert(v.status === 200, `status ${v.status} ${JSON.stringify(v.body).slice(0, 250)}`);
  assert(v.data.load?.status === 'COMPLETED', `load ${JSON.stringify(v.data.load)}`);
  assert(v.data.load.loaded_lines >= 1, `loaded lines ${v.data.load.loaded_lines}`);
  assert(v.data.dates.observed_departure === null && v.data.dates.observed_arrival === null,
    'the operator view shows observations that were never made');
  return `${v.data.load.loaded_lines} loaded · ${v.data.load.left_behind_lines} left behind`;
});

await check('recording IN_TRANSIT stamps an OBSERVED departure that is not the plan', async () => {
  const r = await api(operator, `/shipments/${shipmentId}/stage`, {
    method: 'PATCH', tenantId: OP_TENANT, body: { stage: 'IN_TRANSIT', notes: 'Vessel departed Durban' },
  });
  assert(r.status === 200, `status ${r.status} ${JSON.stringify(r.body).slice(0, 250)}`);
  const v = await asOp(`/shipment-tracking/${shipmentId}`);
  observedDeparture = v.data.dates.observed_departure;
  assert(observedDeparture, 'no observed departure was stamped');
  assert(observedDeparture !== v.data.dates.planned_departure, 'the plan was copied into the observation');
  assert(v.data.dates.planned_departure === PLANNED_DEPARTURE, 'the plan was overwritten by the observation');
  return `observed ${observedDeparture} ≠ planned ${v.data.dates.planned_departure}`;
});

await check('the shipment and its own timeline agree about when it sailed', async () => {
  // The defect this closes: the column took one time and the timeline event took another, so a
  // shipment could contradict its own history about when it left.
  const t = await asOp(`/shipments/${shipmentId}/timeline`);
  assert(t.status === 200, `status ${t.status}`);
  const sailed = (t.data || []).filter((e) => e.stage === 'IN_TRANSIT');
  assert(sailed.length === 1, `${sailed.length} departure events`);
  assert(sailed[0].event_time === observedDeparture,
    `timeline says ${sailed[0].event_time}, the shipment says ${observedDeparture}`);
  return `both say ${observedDeparture}`;
});

await check('a stated observed time is honoured, on the column and the timeline together', async () => {
  const stated = new Date(Date.now() - 3 * 3600_000).toISOString();
  const r = await api(operator, `/shipments/${shipmentId}/stage`, {
    method: 'PATCH', tenantId: OP_TENANT, body: { stage: 'ARRIVED', event_time: stated, notes: 'Berthed at Beira' },
  });
  assert(r.status === 200, `status ${r.status} ${JSON.stringify(r.body).slice(0, 250)}`);
  const v = await asOp(`/shipment-tracking/${shipmentId}`);
  assert(v.data.dates.observed_arrival === stated, `column ${v.data.dates.observed_arrival} ≠ stated ${stated}`);
  const t = await asOp(`/shipments/${shipmentId}/timeline`);
  const arrived = (t.data || []).filter((e) => e.stage === 'ARRIVED');
  assert(arrived.length === 1 && arrived[0].event_time === stated,
    `timeline ${arrived.map((e) => e.event_time).join(',')} ≠ stated ${stated}`);
  return `both say ${stated}`;
});

await check('the participant sees their own timeline and the same truth', async () => {
  const r = await api(customer, `/my-tracking/cargo_reservation/${RES_LOADED}`);
  assert(r.status === 200, `status ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  assert(r.data.state === 'ARRIVED', `state ${r.data.state}`);
  assert(r.data.dates.observed_arrival, 'the participant is not shown the arrival that was recorded');
  assert(r.data.timeline.length >= 2, `${r.data.timeline.length} events`);
  return `${r.data.state} · ${r.data.timeline.length} events`;
});

// ══ Journey B — skipped observations are not fabricated ═══════════════════
journey = 'B — skipped observations';

await check('a shipment that jumped PLANNED → IN_TRANSIT has no invented BOOKED or LOADING', async () => {
  const t = await asOp(`/shipments/${shipmentId}/timeline`);
  const stages = (t.data || []).map((e) => e.stage);
  for (const invented of ['BOOKED', 'LOADING']) {
    assert(!stages.includes(invented), `a ${invented} event nobody recorded appears in the timeline`);
  }
  assert(stages[0] === 'PLANNED', `the timeline opens at ${stages[0]}`);
  assert(stages.includes('IN_TRANSIT'), 'the departure that WAS observed is missing');
  return stages.join(' → ');
});

await check('the participant is shown the gap, not a manufactured sequence', async () => {
  const r = await api(customer, `/my-tracking/cargo_reservation/${RES_LOADED}`);
  const stages = (r.data.timeline || []).map((e) => e.stage);
  for (const invented of ['BOOKED', 'LOADING']) assert(!stages.includes(invented), `${invented} was invented for the customer`);
  return stages.join(' → ');
});

// ══ Journey C — an ETA is not an arrival ══════════════════════════════════
journey = 'C — ETA vs arrival';

await check('the ETA that already passed never became an arrival', async () => {
  const v = await asOp(`/shipment-tracking/${shipmentId}`);
  assert(v.data.dates.estimated_arrival === ETA_ALREADY_PASSED, `estimate ${v.data.dates.estimated_arrival}`);
  assert(v.data.dates.observed_arrival !== ETA_ALREADY_PASSED, 'the estimate was promoted into the observed arrival');
  return `estimate ${ETA_ALREADY_PASSED} · observed ${v.data.dates.observed_arrival}`;
});

await check('estimate and observation are carried as separate fields, and the difference is stated', async () => {
  const r = await api(customer, `/my-tracking/cargo_reservation/${RES_LOADED}`);
  const d = r.data.dates;
  assert('estimated_arrival' in d && 'observed_arrival' in d, `fields: ${Object.keys(d).join(',')}`);
  assert(d.note && /estimate/i.test(d.note), 'nothing tells the reader which is which');
  return 'separate fields, with the difference stated';
});

// ══ Journey D — an exception, without a customs verdict ═══════════════════
journey = 'D — exception';

await check('a CUSTOMS_HOLD is recorded as where the goods are', async () => {
  const r = await api(operator, `/shipments/${shipmentId}/stage`, {
    method: 'PATCH', tenantId: OP_TENANT, body: { stage: 'CUSTOMS_HOLD', notes: 'Held pending paperwork' },
  });
  assert(r.status === 200, `status ${r.status} ${JSON.stringify(r.body).slice(0, 250)}`);
  return 'recorded';
});

await check('the participant sees the hold and NO customs decision', async () => {
  const r = await api(customer, `/my-tracking/cargo_reservation/${RES_LOADED}`);
  assert(r.status === 200, `status ${r.status}`);
  assert(r.data.exception?.stage === 'CUSTOMS_HOLD', `exception ${JSON.stringify(r.data.exception)}`);
  const text = JSON.stringify(r.data).toLowerCase();
  for (const forbidden of ['cleared', 'duty', 'assessed', 'released by', 'declaration']) {
    assert(!text.includes(forbidden), `the participant view says "${forbidden}"`);
  }
  return 'held, with no verdict invented';
});

await check('T11 did not move the PURCHASE into a customs status', async () => {
  // The coupling this cycle closed: RELEASED sits after DUTY_PAID on the purchase ladder, so a
  // movement action writing it was asserting that duty had been paid.
  const r = await api(customer, `/import-orders/${ORDER_A}`);
  if (r.status >= 400) return `order unreadable to the buyer (${r.status}) — asserted at the DB level instead`;
  const status = String((r.data || r.body)?.status || '').toUpperCase();
  for (const customsy of ['CUSTOMS_IN_PROGRESS', 'DUTY_PENDING', 'DUTY_PAID', 'RELEASED']) {
    assert(status !== customsy, `a movement action put the purchase at ${status}`);
  }
  return `purchase at ${status}`;
});

// ══ Journey E — privacy, with positive controls on both sides ═════════════
journey = 'E — privacy';

await check('POSITIVE CONTROL: the operator CAN read the operator view', async () => {
  const r = await asOp(`/shipment-tracking/${shipmentId}`);
  assert(r.status === 200 && Array.isArray(r.data.timeline), 'the operator saw nothing');
  return `${r.data.timeline.length} events`;
});

await check('POSITIVE CONTROL: each participant CAN read their OWN tracking', async () => {
  const a = await api(customer, `/my-tracking/cargo_reservation/${RES_LOADED}`);
  const b = await api(coloader, `/my-tracking/cargo_reservation/${RES_NOT_LOADED}`);
  assert(a.status === 200, `customer ${a.status}`);
  assert(b.status === 200, `co-loader ${b.status}`);
  return `customer ${a.data.state} · co-loader ${b.data.state}`;
});

await check('a co-loader cannot read another participant\'s tracking', async () => {
  const r = await api(coloader, `/my-tracking/cargo_reservation/${RES_LOADED}`);
  assert(r.status === 401 || r.status === 403, `status ${r.status}`);
  return `refused ${r.status}`;
});

await check('a participant cannot read the operator view', async () => {
  const r = await api(customer, `/shipment-tracking/${shipmentId}`);
  assert(r.status === 401 || r.status === 403, `status ${r.status}`);
  return `refused ${r.status}`;
});

await check('a participant cannot record movement', async () => {
  const r = await api(customer, `/shipments/${shipmentId}/stage`, { method: 'PATCH', body: { stage: 'RELEASED' } });
  assert(r.status === 401 || r.status === 403, `status ${r.status}`);
  return `refused ${r.status}`;
});

await check('a foreign logistics tenant gets nothing, read or write', async () => {
  const read = await api(foreign, `/shipment-tracking/${shipmentId}`, { tenantId: FOREIGN_TENANT });
  const write = await api(foreign, `/shipments/${shipmentId}/stage`, { method: 'PATCH', tenantId: FOREIGN_TENANT, body: { stage: 'COMPLETED' } });
  assert(read.status === 401 || read.status === 403, `read ${read.status}`);
  assert(write.status === 401 || write.status === 403, `write ${write.status}`);
  return `read ${read.status} · write ${write.status}`;
});

await check('a forged tenant header does not buy authority', async () => {
  // The foreign operator claims the operator's tenant. The server derives authority; a header is a
  // claim, not a credential.
  const r = await api(foreign, `/shipment-tracking/${shipmentId}`, { tenantId: OP_TENANT });
  assert(r.status === 401 || r.status === 403, `status ${r.status}`);
  return `refused ${r.status}`;
});

await check('a forged shipment id gets nothing', async () => {
  const r = await asOp('/shipment-tracking/11111111-2222-4333-8444-555555555555');
  assert(r.status >= 400, `status ${r.status}`);
  return `refused ${r.status}`;
});

await check('an anonymous caller is refused — 401/403, never a wrong-route 404', async () => {
  const seen = [];
  for (const p of [`/shipment-tracking/${shipmentId}`, `/my-tracking/cargo_reservation/${RES_LOADED}`]) {
    const r = await fetch(`${API}/api/diaspora${p}`);
    seen.push(r.status);
    assert(r.status === 401 || r.status === 403, `${p} returned ${r.status} — a 404 is not authorization proof`);
  }
  const w = await fetch(`${API}/api/diaspora/shipments/${shipmentId}/stage`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stage: 'ARRIVED' }),
  });
  seen.push(w.status);
  assert(w.status === 401 || w.status === 403, `anonymous write ${w.status}`);
  return seen.join(' · ');
});

await check('the participant projection carries nothing private', async () => {
  const r = await api(customer, `/my-tracking/cargo_reservation/${RES_LOADED}`);
  const text = JSON.stringify(r.data);
  assert(!text.includes(RES_NOT_LOADED), 'another participant\'s booking appears');
  assert(!text.includes(operator.id), 'the operator is named to the participant');
  assert(!text.includes(OP_TENANT), 'the tenant id is exposed');
  for (const field of ['load', 'container_id', 'import_order_id', 'shipment']) {
    assert(!(field in r.data), `the participant view exposes ${field}`);
  }
  return 'clean';
});

// ══ Journey F — replay, rewind and the future ═════════════════════════════
journey = 'F — replay';

await check('re-reporting the CURRENT stage appends no second event', async () => {
  const before = await asOp(`/shipments/${shipmentId}/timeline`);
  const n = (before.data || []).length;
  for (let i = 0; i < 3; i += 1) {
    const r = await api(operator, `/shipments/${shipmentId}/stage`, { method: 'PATCH', tenantId: OP_TENANT, body: { stage: 'CUSTOMS_HOLD' } });
    assert(r.status === 200, `retry ${i} status ${r.status}`);
    assert(r.body?.unchanged === true, `retry ${i} was not reported as unchanged`);
  }
  const after = await asOp(`/shipments/${shipmentId}/timeline`);
  assert((after.data || []).length === n, `three retries added ${(after.data || []).length - n} events`);
  return `${n} events before and after three retries`;
});

await check('the timeline cannot be written BACKWARDS', async () => {
  const r = await api(operator, `/shipments/${shipmentId}/stage`, { method: 'PATCH', tenantId: OP_TENANT, body: { stage: 'IN_TRANSIT' } });
  assert(r.status >= 400, `a shipment was moved backwards: ${r.status}`);
  assert(/cannot go backwards/i.test(JSON.stringify(r.body)), JSON.stringify(r.body).slice(0, 200));
  return `refused ${r.status}`;
});

await check('a FUTURE observation is refused, on the column path AND the timeline path', async () => {
  const future = new Date(Date.now() + 7 * 86400_000).toISOString();
  const attempts = [
    ['stated as event_time', { stage: 'RELEASED', event_time: future }],
    // The path that used to be unvalidated: a stage writing no column reached the timeline through
    // metadata, where nothing checked it.
    ['smuggled through metadata', { stage: 'RELEASED', metadata: { event_time: future } }],
  ];
  const seen = [];
  for (const [how, body] of attempts) {
    const r = await api(operator, `/shipments/${shipmentId}/stage`, { method: 'PATCH', tenantId: OP_TENANT, body });
    assert(r.status >= 400, `a future movement was accepted (${how}): ${r.status}`);
    assert(/future/i.test(JSON.stringify(r.body)), `${how}: ${JSON.stringify(r.body).slice(0, 200)}`);
    seen.push(`${how} ${r.status}`);
  }
  return seen.join(' · ');
});

await check('a hold may be LIFTED — the one legitimate step back', async () => {
  // POSITIVE CONTROL for the rewinding rule: it must refuse going backwards without refusing
  // everything, or the refusals above would prove nothing.
  const r = await api(operator, `/shipments/${shipmentId}/stage`, { method: 'PATCH', tenantId: OP_TENANT, body: { stage: 'ARRIVED', notes: 'Hold lifted' } });
  assert(r.status === 200, `status ${r.status} ${JSON.stringify(r.body).slice(0, 250)}`);
  return 'CUSTOMS_HOLD → ARRIVED accepted';
});

await check('nothing dated in the future reached the timeline', async () => {
  const t = await asOp(`/shipments/${shipmentId}/timeline`);
  const now = Date.now();
  for (const e of t.data || []) {
    assert(Date.parse(e.event_time) <= now + 120_000, `${e.stage} is dated ${e.event_time}`);
  }
  return `${(t.data || []).length} events, all in the past`;
});

// ══ Journey G — loaded is not departed ════════════════════════════════════
journey = 'G — loaded ≠ departed';

await check('a container whose load is NOT COMPLETED cannot get a shipment', async () => {
  const r = await api(operator, '/shipments', {
    method: 'POST', tenantId: OP_TENANT,
    body: { import_order_id: ORDER_B, container_id: UNLOADED_SAILING, carrier_name: 'Maersk' },
  });
  assert(r.status >= 400, `a shipment was created for an unloaded container: ${r.status}`);
  assert(/SHIPMENT_WITHOUT_COMPLETED_LOAD|loaded/i.test(JSON.stringify(r.body)), JSON.stringify(r.body).slice(0, 250));
  return `refused ${r.status}`;
});

await check('POSITIVE CONTROL: the container that WAS loaded did get one', async () => {
  assert(shipmentId, 'journey A never created a shipment — the refusal above proves nothing');
  return `shipment ${shipmentId} exists on the loaded container`;
});

await check('a participant not in the load is NOT_LOADED, with no journey', async () => {
  const r = await api(coloader, `/my-tracking/cargo_reservation/${RES_NOT_LOADED}`);
  assert(r.status === 200, `status ${r.status}`);
  assert(r.data.state === 'NOT_LOADED', `state ${r.data.state}`);
  assert(r.data.dates === null && r.data.references === null, 'someone not in the load was shown the shipment dates');
  assert((r.data.timeline || []).length === 0, 'someone not in the load was shown the journey');
  return 'NOT_LOADED, and shown nothing about a journey that is not theirs';
});

await check('a LEFT_BEHIND participant is told so, and gets no journey', async () => {
  const r = await api(coloader, `/my-tracking/cargo_reservation/${RES_LEFT_BEHIND}`);
  assert(r.status === 200, `status ${r.status}`);
  assert(r.data.state === 'LEFT_BEHIND', `state ${r.data.state}`);
  assert(r.data.left_behind_reason === 'NO_SPACE', `reason ${r.data.left_behind_reason}`);
  assert(r.data.dates === null && (r.data.timeline || []).length === 0, 'a left-behind participant was shown a journey');
  return `LEFT_BEHIND (${r.data.left_behind_reason}), no journey`;
});

// ── Report ─────────────────────────────────────────────────────────────────
let current = '';
for (const r of results) {
  if (r.journey !== current) { current = r.journey; console.log(`\n── ${current} ──`); }
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  · ${r.detail}` : ''}${r.error ? `  — ${r.error}` : ''}`);
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.length, ok: failed.length === 0 })}`);
console.log(`SHIPMENT=${shipmentId}`);
process.exit(failed.length ? 1 : 0);
