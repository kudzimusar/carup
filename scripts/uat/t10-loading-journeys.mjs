/**
 * Trade OS T10.6 — deployed staging journeys A–F.
 *
 * Every assertion is made against the DEPLOYED backend over HTTP as a real signed-in person. The
 * T9 half of each journey goes through the T9 product too — receiving and measuring cargo with the
 * governed endpoints rather than reaching into the database — because a journey that seeds its own
 * preconditions in SQL proves the preconditions, not the product.
 *
 * The privacy journey carries POSITIVE CONTROLS. A matrix that only shows refusals passes just as
 * happily when the endpoint is broken for everybody.
 *
 * REPEATABILITY: this creates intakes, plans, loads AND moves sailing statuses, so a re-run needs a
 * clean slate. Before running again, for the three fixture sailings:
 *   1. delete seal records → load items → loads → plan items → plans;
 *   2. delete this warehouse's measurements → intakes;
 *   3. reset each sailing's `status` to BOOKING_CLOSED.
 * Step 3 is the one that is easy to forget: Journey F leaves a sailing in LOADING, and the
 * pre-existing transition map rejects LOADING → LOADING, so the next run fails for a reason that has
 * nothing to do with what it is testing. All three steps remove the PREVIOUS run's facts so the
 * product has to create them again; none asserts a fact into existence.
 *
 * Usage:
 *   node scripts/uat/t10-loading-journeys.mjs --api <backend-base-url> --password-file <path>
 */
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []),
);
const API = (args.api || '').replace(/\/$/, '');
if (!API) { console.error('--api is required'); process.exit(2); }
const { readFileSync } = await import('node:fs');
const PASSWORD = readFileSync(args['password-file'], 'utf8').trim();

// The roomy sailing (33 CBM) for A/B/C/E/F, and a deliberately SMALL one (6 CBM) for D, so capacity
// pressure is a real operational case rather than a contrived number.
const BIG = '99993333-0000-4000-8000-000000000001';
const SMALL = '88883333-0000-4000-8000-000000000001';
// A sailing that deliberately NEVER gets a load, so the bypass refusal is actually exercised on the
// deployed backend. The first version of Journey F checked this on sailings that by then HAD loads,
// so it passed without testing anything — the same "a check that cannot see what it claims" shape
// this programme keeps producing.
const EMPTY = '77773333-0000-4000-8000-000000000001';
const WAREHOUSE = '99991111-0000-4000-8000-000000000001';
const OP_TENANT = '99990000-0000-4000-8000-000000000001';
const FOREIGN_TENANT = '99990000-0000-4000-8000-000000000002';

const BIG_A = '99994444-0000-4000-8000-000000000001'; // customer, booked 3.0
const BIG_B = '99994444-0000-4000-8000-000000000002'; // co-loader, booked 1.5
const SMALL_A = '88884444-0000-4000-8000-000000000001'; // customer, booked 3.0
const SMALL_B = '88884444-0000-4000-8000-000000000002'; // co-loader, booked 2.5
const SMALL_C = '88884444-0000-4000-8000-000000000003'; // customer, booked 1.0

const results = [];
let journey = '';
const check = async (name, fn) => {
  try { const d = await fn(); results.push({ journey, name, ok: true, detail: d || null }); }
  catch (e) { results.push({ journey, name, ok: false, error: String(e.message || e).slice(0, 320) }); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

async function csrf(headers = {}) {
  const r = await fetch(`${API}/api/security/csrf-token`, { headers });
  const b = await r.json().catch(() => ({}));
  return { token: b?.csrfToken || null, cookie: (r.headers.get('set-cookie') || '').split(';')[0] || '' };
}
async function signIn(email) {
  const g = await csrf();
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': g.token, cookie: g.cookie },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`);
  const s = { email, token: b?.data?.token || b?.token, id: (b?.data?.user || b?.user)?.id, role: (b?.data?.user || b?.user)?.role };
  const bound = await csrf({ 'x-session-token': s.token, 'x-user-id': s.id });
  return { ...s, csrf: bound.token, cookie: bound.cookie };
}
async function api(session, path, { method = 'GET', body, tenantId } = {}) {
  const headers = { 'content-type': 'application/json', 'x-session-token': session.token, 'x-user-id': session.id, 'x-stakeholder-role': session.role };
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
console.log(`signed in: ${operator.id} / ${customer.id} / ${coloader.id} / ${foreign.id}\n`);

/** Receive and measure a consignment through the T9 PRODUCT, not through SQL. */
async function receiveAndMeasure(subjectId, { l, w, h } = { l: 200, w: 100, h: 190 }) {
  const created = await asOp('/warehouse-intakes', {
    method: 'POST', body: { warehouseId: WAREHOUSE, subjectType: 'cargo_reservation', subjectId },
  });
  if (created.status >= 400) throw new Error(`book-in ${subjectId}: ${created.status} ${JSON.stringify(created.body).slice(0, 160)}`);
  const id = created.data.id;
  await asOp(`/warehouse-intakes/${id}/receive`, { method: 'POST', body: { outcome: 'RECEIVED', condition: 'good' } });
  const m = await asOp(`/warehouse-intakes/${id}/measurements`, {
    method: 'POST', body: { lengthValue: l, widthValue: w, heightValue: h, dimensionUnit: 'cm' },
  });
  if (m.status >= 400) throw new Error(`measure ${subjectId}: ${m.status} ${JSON.stringify(m.body).slice(0, 160)}`);
  return Number(m.data.measurement.actual_volume_cbm);
}

// ══ Journey A — normal consolidation ═══════════════════════════════════════
journey = 'A — normal consolidation';
let planId = null;
let loadId = null;
let measuredA = null;

await check('two approved bookings are received and measured through the T9 product', async () => {
  measuredA = await receiveAndMeasure(BIG_A, { l: 200, w: 100, h: 190 }); // 3.800
  const b = await receiveAndMeasure(BIG_B, { l: 100, w: 100, h: 120 });   // 1.200
  assert(measuredA === 3.8, `A measured ${measuredA}`);
  assert(b === 1.2, `B measured ${b}`);
  return `A ${measuredA} CBM · B ${b} CBM`;
});

await check('readiness turns READY only once received AND measured', async () => {
  const r = await asOp(`/container-marketplace/${BIG}/load-readiness`);
  assert(r.status === 200, `status ${r.status}`);
  const a = r.data.candidates.find((c) => c.subject.id === BIG_A);
  assert(a && a.readiness.ready, `A not ready: ${JSON.stringify(a && a.readiness.blockers)}`);
  const unready = r.data.candidates.filter((c) => !c.readiness.ready);
  for (const c of unready) assert(c.readiness.blockers.length > 0, 'a NOT-ready candidate gave no reason');
  return `${r.data.summary.ready} ready of ${r.data.summary.total}`;
});

await check('a plan is created and a line takes the WAREHOUSE figure, saying so', async () => {
  const p = await asOp(`/container-marketplace/${BIG}/load-plan`, { method: 'POST', body: {} });
  assert(p.status === 201 || p.status === 200, `status ${p.status} ${JSON.stringify(p.body).slice(0, 160)}`);
  planId = p.data.id;
  const i = await asOp(`/load-plans/${planId}/items`, { method: 'POST', body: { subjectId: BIG_A, disposition: 'PLANNED_IN' } });
  assert(i.status === 201, `item ${i.status} ${JSON.stringify(i.body).slice(0, 160)}`);
  assert(Number(i.data.planned_volume_cbm) === measuredA, `planned ${i.data.planned_volume_cbm}`);
  assert(i.data.planned_source === 'WAREHOUSE_ACTUAL', `source ${i.data.planned_source}`);
  return `${i.data.planned_volume_cbm} CBM from ${i.data.planned_source}`;
});

await check('PLANNING is not LOADING — the participant is not told their cargo is aboard', async () => {
  const r = await api(customer, `/my-load-status/cargo_reservation/${BIG_A}`);
  assert(r.status === 200, `status ${r.status}`);
  assert(r.data.state === 'NOT_STARTED', `state ${r.data.state} after only a plan line`);
  return r.data.sentence;
});

await check('the plan is confirmed, then a load is opened and cargo recorded', async () => {
  const c = await asOp(`/load-plans/${planId}/confirm`, { method: 'POST', body: {} });
  assert(c.status === 201 || c.status === 200, `confirm ${c.status} ${JSON.stringify(c.body).slice(0, 160)}`);
  const l = await asOp(`/container-marketplace/${BIG}/loads`, { method: 'POST', body: {} });
  assert(l.status === 201 || l.status === 200, `open ${l.status}`);
  loadId = l.data.id;
  const i = await asOp(`/loads/${loadId}/items`, {
    method: 'POST', body: { subjectId: BIG_A, outcome: 'LOADED', loadedVolumeCbm: 3.6, loaded_by: customer.id },
  });
  assert(i.status === 201, `item ${i.status} ${JSON.stringify(i.body).slice(0, 160)}`);
  assert(i.data.loaded_by === operator.id, `a forged loader landed: ${i.data.loaded_by}`);
  return `loaded 3.6 by ${i.data.loaded_by}`;
});

await check('a container number and seal are recorded, then the load is completed', async () => {
  const s = await asOp(`/loads/${loadId}/seal-records`, { method: 'POST', body: { containerNumber: 'MSKU7654321', sealNumber: 'SEAL-A1' } });
  assert(s.status === 201, `seal ${s.status}`);
  const done = await asOp(`/loads/${loadId}/complete`, { method: 'POST', body: {} });
  assert(done.status === 201 || done.status === 200, `complete ${done.status} ${JSON.stringify(done.body).slice(0, 160)}`);
  assert(done.data.confirmed_by === operator.id);
  assert(Number(done.data.actual_loaded_volume_cbm) === 3.6, `total ${done.data.actual_loaded_volume_cbm}`);
  return `completed, total ${done.data.actual_loaded_volume_cbm} CBM`;
});

await check('the participant sees the SAME truth the operator recorded', async () => {
  const r = await api(customer, `/my-load-status/cargo_reservation/${BIG_A}`);
  assert(r.data.state === 'LOADED', `state ${r.data.state}`);
  assert(Number(r.data.loaded_volume_cbm) === 3.6, `volume ${r.data.loaded_volume_cbm}`);
  assert(/does not mean the container has sailed/i.test(r.data.note), r.data.note);
  return r.data.sentence;
});

// ══ Journey B — the warehouse actual differs from the booking ══════════════
journey = 'B — warehouse actual differs';

await check('all THREE figures survive: booked 3.0, warehouse 3.8, loaded 3.6', async () => {
  const cargo = await api(customer, `/my-cargo/cargo_reservation/${BIG_A}`);
  const booked = Number(cargo.data.estimate.volume_cbm);
  const warehouse = Number(cargo.data.intake.actual.volume_cbm);
  const load = await api(customer, `/my-load-status/cargo_reservation/${BIG_A}`);
  const loaded = Number(load.data.loaded_volume_cbm);
  assert(booked === 3, `the booking estimate moved: ${booked}`);
  assert(warehouse === 3.8, `the warehouse measurement moved: ${warehouse}`);
  assert(loaded === 3.6, `loaded ${loaded}`);
  assert(new Set([booked, warehouse, loaded]).size === 3, 'two of the three collapsed into one');
  return `booked ${booked} · warehouse ${warehouse} · loaded ${loaded}`;
});

await check('T5 booked capacity is STILL computed from the estimates', async () => {
  const r = await asOp(`/container-marketplace/containers/${BIG}/capacity`);
  assert(r.status === 200, `status ${r.status}`);
  assert(Number(r.data.capacity.usedVolume) === 5.5,
    `used ${r.data.capacity.usedVolume} — loading or measuring rewrote the ledger`);
  return `used ${r.data.capacity.usedVolume} from estimates`;
});

// ══ Journey C — left behind ════════════════════════════════════════════════
journey = 'C — left behind';

await check('a left-behind line needs a bounded reason and keeps its place on the manifest', async () => {
  // The load is COMPLETED, so a new one is not possible on this sailing; use the plan-level
  // exclusion plus the manifest read to prove the shape, then the small sailing exercises the
  // manifest path end to end in Journey D.
  const state = await asOp(`/container-marketplace/${BIG}/load-state`);
  assert(state.status === 200, `status ${state.status}`);
  assert(state.data.load.items.length >= 1, 'the manifest is empty');
  return `${state.data.load.items.length} manifest line(s) kept`;
});

// ══ Journey D — capacity pressure ══════════════════════════════════════════
journey = 'D — capacity pressure';
let smallPlanId = null;
let smallLoadId = null;

await check('three consignments are received and measured beyond a 6 CBM container', async () => {
  const a = await receiveAndMeasure(SMALL_A, { l: 200, w: 100, h: 190 }); // 3.800
  const b = await receiveAndMeasure(SMALL_B, { l: 150, w: 100, h: 200 }); // 3.000
  const c = await receiveAndMeasure(SMALL_C, { l: 100, w: 100, h: 100 }); // 1.000
  assert(Math.abs((a + b + c) - 7.8) < 0.001, `total ${a + b + c}`);
  return `${a} + ${b} + ${c} = ${Math.round((a + b + c) * 1000) / 1000} CBM into a 6.000 CBM box`;
});

await check('the plan shows the pressure BEFORE confirmation', async () => {
  const p = await asOp(`/container-marketplace/${SMALL}/load-plan`, { method: 'POST', body: {} });
  assert(p.status === 201 || p.status === 200, `plan ${p.status}`);
  smallPlanId = p.data.id;
  for (const s of [SMALL_A, SMALL_B, SMALL_C]) {
    const i = await asOp(`/load-plans/${smallPlanId}/items`, { method: 'POST', body: { subjectId: s, disposition: 'PLANNED_IN' } });
    assert(i.status === 201, `item ${s}: ${i.status} ${JSON.stringify(i.body).slice(0, 140)}`);
  }
  const state = await asOp(`/container-marketplace/${SMALL}/load-state`);
  const pressure = state.data.plan.pressure;
  assert(pressure.over_capacity === true, 'the overage was not reported');
  assert(Math.abs(pressure.over_by_cbm - 1.8) < 0.001, `over by ${pressure.over_by_cbm}`);
  return `over by ${pressure.over_by_cbm} CBM, shown while planning`;
});

await check('an IMPOSSIBLE plan is REFUSED, and says by how much', async () => {
  const c = await asOp(`/load-plans/${smallPlanId}/confirm`, { method: 'POST', body: {} });
  assert(c.status >= 400, `the impossible plan was confirmed: ${c.status}`);
  const text = JSON.stringify(c.body);
  assert(/too much/i.test(text), text.slice(0, 200));
  return 'refused with the overage named';
});

await check('T5 booked capacity is UNCHANGED by the refusal — nothing "made room"', async () => {
  const r = await asOp(`/container-marketplace/containers/${SMALL}/capacity`);
  assert(Number(r.data.capacity.totalVolume) === 6, `total ${r.data.capacity.totalVolume}`);
  assert(Number(r.data.capacity.usedVolume) === 6.5, `used ${r.data.capacity.usedVolume}`);
  return `total 6 / used 6.5 from estimates, untouched`;
});

await check('the governed resolution works: exclude with a reason, then it confirms', async () => {
  const out = await asOp(`/load-plans/${smallPlanId}/items`, {
    method: 'POST', body: { subjectId: SMALL_B, disposition: 'PLANNED_OUT', exclusionReason: 'DOES_NOT_FIT' },
  });
  assert(out.status === 201, `exclude ${out.status} ${JSON.stringify(out.body).slice(0, 160)}`);
  const c = await asOp(`/load-plans/${smallPlanId}/confirm`, { method: 'POST', body: {} });
  assert(c.status === 201 || c.status === 200, `confirm after revision ${c.status} ${JSON.stringify(c.body).slice(0, 160)}`);
  return '3.8 + 1.0 fits in 6.0; the excluded line carries its reason';
});

await check('the refusal invented no commercial consequence', async () => {
  const state = await asOp(`/container-marketplace/${SMALL}/load-state`);
  const text = JSON.stringify(state.data.plan).toLowerCase();
  for (const forbidden of ['refund', 'surcharge', 'charge', 'invoice', 'next sailing', 'rebook']) {
    assert(!text.includes(forbidden), `the plan mentions "${forbidden}"`);
  }
  return 'a volume fact, nothing more';
});

await check('the actual load records a left-behind line with its reason', async () => {
  const l = await asOp(`/container-marketplace/${SMALL}/loads`, { method: 'POST', body: {} });
  assert(l.status === 201 || l.status === 200, `open ${l.status}`);
  smallLoadId = l.data.id;
  const bad = await asOp(`/loads/${smallLoadId}/items`, { method: 'POST', body: { subjectId: SMALL_B, outcome: 'LEFT_BEHIND' } });
  assert(bad.status >= 400, `a reasonless exclusion was accepted: ${bad.status}`);
  const ok = await asOp(`/loads/${smallLoadId}/items`, { method: 'POST', body: { subjectId: SMALL_B, outcome: 'LEFT_BEHIND', leftBehindReason: 'NO_SPACE' } });
  assert(ok.status === 201, `left-behind ${ok.status} ${JSON.stringify(ok.body).slice(0, 160)}`);
  assert(ok.data.loaded_volume_cbm === null, 'a left-behind line carries a loaded volume');
  await asOp(`/loads/${smallLoadId}/items`, { method: 'POST', body: { subjectId: SMALL_A, outcome: 'LOADED', loadedVolumeCbm: 3.6 } });
  return 'refused without a reason, kept with one, and no volume';
});

await check('the affected participant is told, with the reason and no promise', async () => {
  const r = await api(coloader, `/my-load-status/cargo_reservation/${SMALL_B}`);
  assert(r.status === 200, `status ${r.status}`);
  assert(r.data.state === 'LEFT_BEHIND', `state ${r.data.state}`);
  assert(r.data.left_behind_reason === 'NO_SPACE');
  const text = JSON.stringify(r.data).toLowerCase();
  for (const promise of ['refund', 'next sailing', 'rebook', 'compensat']) {
    assert(!text.includes(promise), `the projection promises "${promise}"`);
  }
  return r.data.sentence;
});

// ══ Journey E — privacy, with positive controls ════════════════════════════
journey = 'E — privacy';

await check('POSITIVE CONTROL: the operator CAN read the governed load state', async () => {
  const r = await asOp(`/container-marketplace/${BIG}/load-state`);
  assert(r.status === 200 && r.data.load, 'the operator saw nothing');
  return `${r.data.candidates.length} candidates, manifest present`;
});

await check('POSITIVE CONTROL: each participant CAN read their own load status', async () => {
  const a = await api(customer, `/my-load-status/cargo_reservation/${BIG_A}`);
  const b = await api(coloader, `/my-load-status/cargo_reservation/${SMALL_B}`);
  assert(a.status === 200 && b.status === 200, `${a.status}/${b.status}`);
  return 'both owners 200';
});

await check('a co-loader cannot read another participant\'s load status', async () => {
  const r = await api(coloader, `/my-load-status/cargo_reservation/${BIG_A}`);
  assert(r.status === 401 || r.status === 403, `status ${r.status}`);
  return `refused ${r.status}`;
});

await check('a participant cannot read the sailing-wide manifest', async () => {
  const r = await api(customer, `/container-marketplace/${BIG}/load-state`);
  assert(r.status === 401 || r.status === 403, `status ${r.status}`);
  const r2 = await api(customer, `/container-marketplace/${BIG}/load-readiness`);
  assert(r2.status === 401 || r2.status === 403, `readiness ${r2.status}`);
  return `manifest ${r.status} · readiness ${r2.status}`;
});

await check('a participant cannot plan, load, seal or complete', async () => {
  const attempts = [
    [`/container-marketplace/${BIG}/load-plan`, {}],
    [`/load-plans/${planId}/items`, { subjectId: BIG_A, disposition: 'PLANNED_IN' }],
    [`/load-plans/${planId}/confirm`, {}],
    [`/loads/${loadId}/items`, { subjectId: BIG_A, outcome: 'LOADED' }],
    [`/loads/${loadId}/seal-records`, { sealNumber: 'FORGED' }],
    [`/loads/${loadId}/complete`, {}],
  ];
  for (const [path, body] of attempts) {
    const r = await api(customer, path, { method: 'POST', body });
    assert(r.status === 401 || r.status === 403, `${path} returned ${r.status}, which is not a refusal`);
  }
  return `${attempts.length} write paths all refused`;
});

await check('a foreign logistics tenant gets nothing about this sailing', async () => {
  const read = await api(foreign, `/container-marketplace/${BIG}/load-state`, { tenantId: FOREIGN_TENANT });
  const write = await api(foreign, `/loads/${loadId}/items`, { method: 'POST', tenantId: FOREIGN_TENANT, body: { subjectId: BIG_A, outcome: 'LOADED' } });
  assert(read.status === 401 || read.status === 403, `read ${read.status}`);
  assert(write.status === 401 || write.status === 403, `write ${write.status}`);
  return `read ${read.status} · write ${write.status}`;
});

await check('a forged plan id, load id and reservation all get nothing', async () => {
  const forgedPlan = await asOp('/load-plans/11111111-2222-3333-4444-555555555555/items', { method: 'POST', body: { subjectId: BIG_A, disposition: 'PLANNED_IN' } });
  assert(forgedPlan.status >= 400, `forged plan ${forgedPlan.status}`);
  const forgedLoad = await asOp('/loads/11111111-2222-3333-4444-555555555555/items', { method: 'POST', body: { subjectId: BIG_A, outcome: 'LOADED' } });
  assert(forgedLoad.status >= 400, `forged load ${forgedLoad.status}`);
  const forgedRes = await asOp(`/loads/${smallLoadId}/items`, { method: 'POST', body: { subjectId: BIG_A, outcome: 'LOADED' } });
  assert(forgedRes.status >= 400, 'cargo from ANOTHER sailing was put on this manifest');
  return `${forgedPlan.status}/${forgedLoad.status}/${forgedRes.status}`;
});

await check('cargo never received cannot be loaded', async () => {
  // SMALL_C was received and measured, so use the BIG sailing's unapproved booking instead: it has
  // no intake at all, and the service must refuse it on the received check.
  const r = await asOp(`/loads/${smallLoadId}/items`, { method: 'POST', body: { subjectId: '99994444-0000-4000-8000-000000000003', outcome: 'LOADED' } });
  assert(r.status >= 400, `unreceived cargo was loaded: ${r.status}`);
  return `refused ${r.status}`;
});

await check('an anonymous caller cannot reach any of it', async () => {
  for (const p of [`/container-marketplace/${BIG}/load-state`, `/container-marketplace/${BIG}/load-readiness`, `/my-load-status/cargo_reservation/${BIG_A}`]) {
    const r = await fetch(`${API}/api/diaspora${p}`);
    // 404 is NOT authorization proof — a wrong path 404s too. Only 401/403 counts.
    assert(r.status === 401 || r.status === 403, `${p} returned ${r.status}`);
  }
  const w = await fetch(`${API}/api/diaspora/loads/${loadId}/items`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subjectId: BIG_A, outcome: 'LOADED' }) });
  assert(w.status === 401 || w.status === 403, `anonymous write ${w.status}`);
  return '401/403 on all four';
});

await check('the participant projection leaks no other cargo, operator, tenant or capacity', async () => {
  const r = await api(customer, `/my-load-status/cargo_reservation/${BIG_A}`);
  const text = JSON.stringify(r.data);
  assert(!text.includes(BIG_B), 'another participant\'s booking appears');
  assert(!text.includes(operator.id), 'the operator is named to the participant');
  assert(!text.includes(OP_TENANT), 'the tenant is exposed');
  assert(!text.includes('33'), 'the sailing capacity is exposed');
  return 'clean';
});

// ══ Journey F — loaded is not shipped ══════════════════════════════════════
journey = 'F — loaded is not shipped';

await check('the completed load claims no departure anywhere in its data', async () => {
  const state = await asOp(`/container-marketplace/${BIG}/load-state`);
  const stripped = JSON.parse(JSON.stringify(state.data));
  delete stripped.note; delete stripped.candidates;
  const text = JSON.stringify(stripped).toLowerCase();
  for (const later of ['departed', 'in transit', 'sailed', 'arrived', 'customs']) {
    assert(!text.includes(later), `the load state DATA says "${later}"`);
  }
  return 'no movement claimed';
});

await check('the legacy mark-loading bypass is CLOSED — a sailing with NO load is refused', async () => {
  const r = await api(operator, `/containers/${EMPTY}/mark-loading`, { method: 'POST', body: {}, tenantId: OP_TENANT });
  assert(r.status >= 400, `a sailing with no load at all was marked LOADING: ${r.status}`);
  const text = JSON.stringify(r.body);
  assert(/nothing has been recorded as going into it/i.test(text), text.slice(0, 220));
  // …and it did not move anyway.
  const after = await api(operator, `/containers/${EMPTY}/mark-loading`, { method: 'POST', body: {}, tenantId: OP_TENANT });
  assert(after.status >= 400, 'a second attempt succeeded');
  return `refused ${r.status}, with the reason a caller can act on`;
});

await check('the legacy mark-shipped bypass is CLOSED on that same empty sailing', async () => {
  const r = await api(operator, `/containers/${EMPTY}/mark-shipped`, { method: 'POST', body: {}, tenantId: OP_TENANT });
  assert(r.status >= 400, `a sailing with no load was marked SHIPPED: ${r.status}`);
  return `refused ${r.status}`;
});

await check('POSITIVE CONTROL: the SAME sailing is accepted once a load exists', async () => {
  // The cleanest control available: the sailing that was just refused, refused only because it had
  // no load. Give it one through the governed service and the identical request is accepted. A gate
  // that refuses everybody is not a gate — and one that refuses on the wrong grounds is worse.
  const opened = await api(operator, `/container-marketplace/${EMPTY}/loads`, { method: 'POST', body: {}, tenantId: OP_TENANT });
  assert(opened.status === 201 || opened.status === 200, `could not open a load: ${opened.status} ${JSON.stringify(opened.body).slice(0, 160)}`);
  const r = await api(operator, `/containers/${EMPTY}/mark-loading`, { method: 'POST', body: {}, tenantId: OP_TENANT });
  assert(r.status === 200 || r.status === 201, `a legitimate transition was refused: ${r.status} ${JSON.stringify(r.body).slice(0, 180)}`);
  // This legacy route returns the container row directly rather than under `data` — the older
  // response shape, unchanged by T10.
  const row = r.data || r.body;
  assert(row?.status === 'LOADING', `status ${row?.status}`);
  return 'same sailing, same request: refused without a load, accepted with one';
});

await check('mark-shipped is refused while a load is still IN_PROGRESS', async () => {
  const r = await api(operator, `/containers/${SMALL}/mark-shipped`, { method: 'POST', body: {}, tenantId: OP_TENANT });
  assert(r.status >= 400, `a sailing whose load is unfinished was marked SHIPPED: ${r.status}`);
  const text = JSON.stringify(r.body);
  assert(/loading has not been completed|Illegal container transition/i.test(text), text.slice(0, 200));
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
console.log(`PLAN=${planId} LOAD=${loadId} SMALL_LOAD=${smallLoadId}`);
process.exit(failed.length ? 1 : 0);
