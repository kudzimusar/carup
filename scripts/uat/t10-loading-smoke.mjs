/**
 * Trade OS T10 — a DEPLOYED reachability and firewall smoke test.
 *
 * T10 is `T10-PARTIAL`: the services exist and no screen calls them yet. This proves the half that
 * does exist is actually wired, because the recurring defect of this programme is a module that is
 * correct and unreachable — T6's whole commercial layer, T6.8's allocation engine, T7's advisor and
 * T7's exception consumer all shipped with passing tests and no path to them.
 *
 * It is NOT the T10.6 journey suite. It does not certify the product, and it says so in its own
 * output: the surfaces are not built, so nothing here walks a person through anything.
 *
 * REPEATABILITY: this creates a plan and a load, so a re-run needs a clean slate. Delete this run's
 * T10 rows first (seal records → load items → loads → plan items → plans, for container `9999…`).
 * That removes the previous run's facts so the services have to create them again; it never asserts
 * a fact into existence, and touches nothing outside the synthetic fixture set.
 *
 * Usage:
 *   node scripts/uat/t10-loading-smoke.mjs --api <backend-base-url> --password-file <path>
 */
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []),
);
const API = (args.api || '').replace(/\/$/, '');
if (!API) { console.error('--api is required'); process.exit(2); }
const { readFileSync } = await import('node:fs');
const PASSWORD = readFileSync(args['password-file'], 'utf8').trim();

// Read from the deployed system rather than hard-coded. The T9 journeys legitimately leave a
// different LATEST measurement depending on how they last ran (a correction is a new observation),
// and a smoke test that asserts a magic 3.8 fails on the data being correct. What matters is the
// INVARIANT — three distinct numbers, none overwriting another — not any one of their values.
let WAREHOUSE_CBM = null;

const CONTAINER = '99993333-0000-4000-8000-000000000001';
const RES_A = '99994444-0000-4000-8000-000000000001'; // received + measured 3.8, booked 3.0
const RES_B = '99994444-0000-4000-8000-000000000002'; // the co-loader's
const OP_TENANT = '99990000-0000-4000-8000-000000000001';

const results = [];
const check = async (name, fn) => {
  try { const d = await fn(); results.push({ name, ok: true, detail: d || null }); }
  catch (e) { results.push({ name, ok: false, error: String(e.message || e).slice(0, 300) }); }
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

let planId = null;
let loadId = null;

await check('the readiness endpoint is REACHABLE and derives blockers', async () => {
  const r = await asOp(`/container-marketplace/${CONTAINER}/load-readiness`);
  assert(r.status === 200, `status ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  assert(Array.isArray(r.data.candidates) && r.data.candidates.length > 0, 'no candidates');
  const a = r.data.candidates.find((c) => c.subject.id === RES_A);
  assert(a, 'the measured booking is missing from the queue');
  assert(a.booked_volume_cbm === 3, `booked ${a.booked_volume_cbm}`);
  assert(typeof a.warehouse_volume_cbm === 'number' && a.warehouse_volume_cbm > 0,
    `the warehouse measurement did not reach readiness: ${a.warehouse_volume_cbm}`);
  assert(a.warehouse_volume_cbm !== a.booked_volume_cbm,
    'the warehouse figure equals the booking estimate — readiness may be reading the wrong one');
  WAREHOUSE_CBM = a.warehouse_volume_cbm;
  // An unmeasured consignment must be null here, never 0 — the unknown-is-zero collapse.
  for (const c of r.data.candidates) {
    if (c.readiness.blockers.some((b) => b.code === 'NOT_MEASURED')) {
      assert(c.warehouse_volume_cbm === null, `an unmeasured consignment reported ${c.warehouse_volume_cbm}`);
    }
  }
  return `booked 3 vs warehouse ${WAREHOUSE_CBM}; ${r.data.summary.ready} ready of ${r.data.summary.total}, ${r.data.summary.unmeasured} unmeasured`;
});

await check('readiness NEVER claims customs or legal clearance', async () => {
  const r = await asOp(`/container-marketplace/${CONTAINER}/load-readiness`);
  for (const c of r.data.candidates) {
    const facts = JSON.stringify(c.readiness.facts).toLowerCase();
    for (const f of ['customs', 'cleared', 'compliant', 'legal']) assert(!facts.includes(f), `a readiness fact says "${f}"`);
    assert(/not a statement about customs/i.test(c.readiness.disclaimer), 'the disclaimer is missing');
  }
  return 'documents counted, never interpreted';
});

await check('a load plan can be opened and a line added, with its provenance', async () => {
  const p = await asOp(`/container-marketplace/${CONTAINER}/load-plan`, { method: 'POST', body: {} });
  assert(p.status === 201 || p.status === 200, `status ${p.status} ${JSON.stringify(p.body).slice(0, 200)}`);
  planId = p.data.id;
  const i = await asOp(`/load-plans/${planId}/items`, { method: 'POST', body: { subjectId: RES_A, disposition: 'PLANNED_IN' } });
  assert(i.status === 201, `item status ${i.status} ${JSON.stringify(i.body).slice(0, 200)}`);
  // The plan takes the WAREHOUSE measurement, not the booking estimate — and says which.
  assert(Number(i.data.planned_volume_cbm) === WAREHOUSE_CBM,
    `planned ${i.data.planned_volume_cbm}, expected the warehouse figure ${WAREHOUSE_CBM}`);
  assert(i.data.planned_source === 'WAREHOUSE_ACTUAL', `source ${i.data.planned_source}`);
  return `${i.data.planned_volume_cbm} CBM from ${i.data.planned_source}`;
});

await check('PLANNING is not LOADING — the customer is not told their cargo is aboard', async () => {
  const r = await api(customer, `/my-load-status/cargo_reservation/${RES_A}`);
  assert(r.status === 200, `status ${r.status}`);
  assert(r.data.state === 'NOT_STARTED', `state ${r.data.state} after only a plan line`);
  return r.data.sentence;
});

await check('a load can be opened and a line recorded, attributed to the caller', async () => {
  await asOp(`/load-plans/${planId}/confirm`, { method: 'POST', body: {} });
  const l = await asOp(`/container-marketplace/${CONTAINER}/loads`, { method: 'POST', body: {} });
  assert(l.status === 201 || l.status === 200, `status ${l.status} ${JSON.stringify(l.body).slice(0, 200)}`);
  loadId = l.data.id;
  const i = await asOp(`/loads/${loadId}/items`, { method: 'POST', body: { subjectId: RES_A, outcome: 'LOADED', loadedVolumeCbm: 3.6, loaded_by: customer.id } });
  assert(i.status === 201, `item status ${i.status} ${JSON.stringify(i.body).slice(0, 200)}`);
  assert(i.data.loaded_by === operator.id, `a forged loader landed: ${i.data.loaded_by}`);
  assert(Number(i.data.loaded_volume_cbm) === 3.6);
  return `loaded by ${i.data.loaded_by}`;
});

await check('THE THREE MEASUREMENTS all survive on the deployed system', async () => {
  const cargo = await api(customer, `/my-cargo/cargo_reservation/${RES_A}`);
  const booked = Number(cargo.data.estimate.volume_cbm);
  const warehouse = Number(cargo.data.intake.actual.volume_cbm);
  const load = await api(customer, `/my-load-status/cargo_reservation/${RES_A}`);
  const loaded = Number(load.data.loaded_volume_cbm);
  // The invariant, not three magic numbers: each is read from the phase that owns it, all three are
  // present, and no two have collapsed into one.
  assert(booked === 3, `the booking estimate moved: ${booked}`);
  assert(warehouse === WAREHOUSE_CBM, `the warehouse measurement moved: ${warehouse}`);
  assert(loaded === 3.6, `loaded ${loaded}`);
  assert(new Set([booked, warehouse, loaded]).size === 3,
    `three authorities produced ${new Set([booked, warehouse, loaded]).size} distinct values — one overwrote another`);
  return `booked ${booked} · warehouse ${warehouse} · loaded ${loaded}, all distinct`;
});

await check('T5 capacity is STILL computed from the estimates', async () => {
  const r = await asOp(`/container-marketplace/containers/${CONTAINER}/capacity`);
  assert(r.status === 200, `status ${r.status}`);
  assert(Number(r.data.capacity.usedVolume) === 5.5,
    `used ${r.data.capacity.usedVolume} — loading rewrote the ledger`);
  return `used ${r.data.capacity.usedVolume} from estimates`;
});

await check('left-behind cargo needs a bounded reason and stays on the manifest', async () => {
  const bad = await asOp(`/loads/${loadId}/items`, { method: 'POST', body: { subjectId: RES_B, outcome: 'LEFT_BEHIND' } });
  assert(bad.status >= 400, `a reasonless exclusion was accepted: ${bad.status}`);
  const ok = await asOp(`/loads/${loadId}/items`, { method: 'POST', body: { subjectId: RES_B, outcome: 'LEFT_BEHIND', leftBehindReason: 'NO_SPACE' } });
  assert(ok.status === 201, `status ${ok.status} ${JSON.stringify(ok.body).slice(0, 200)}`);
  assert(ok.data.loaded_volume_cbm === null, 'left-behind cargo carries a loaded volume');
  const state = await asOp(`/container-marketplace/${CONTAINER}/load-state`);
  assert(state.data.load.items.some((i) => i.subject.id === RES_B && i.outcome === 'LEFT_BEHIND'), 'the line vanished from the manifest');
  return 'refused without a reason, kept with one';
});

await check('the affected participant is told they were left behind, and why', async () => {
  const r = await api(coloader, `/my-load-status/cargo_reservation/${RES_B}`);
  assert(r.status === 200, `status ${r.status}`);
  assert(r.data.state === 'LEFT_BEHIND', `state ${r.data.state}`);
  assert(r.data.left_behind_reason === 'NO_SPACE');
  return r.data.sentence;
});

await check('a seal is recorded, and a replacement keeps the first', async () => {
  const first = await asOp(`/loads/${loadId}/seal-records`, { method: 'POST', body: { containerNumber: 'MSKU1234567', sealNumber: 'SEAL-0001' } });
  assert(first.status === 201, `status ${first.status} ${JSON.stringify(first.body).slice(0, 200)}`);
  const noNote = await asOp(`/loads/${loadId}/seal-records`, { method: 'POST', body: { sealNumber: 'SEAL-0002', recordReason: 'SEAL_REPLACED' } });
  assert(noNote.status >= 400, 'a seal was replaced with no reason');
  const ok = await asOp(`/loads/${loadId}/seal-records`, { method: 'POST', body: { sealNumber: 'SEAL-0002', recordReason: 'SEAL_REPLACED', reasonNote: 'Customs inspection at the gate' } });
  assert(ok.status === 201, `status ${ok.status}`);
  const state = await asOp(`/container-marketplace/${CONTAINER}/load-state`);
  assert(state.data.load.seal_number === 'SEAL-0002', `current seal ${state.data.load.seal_number}`);
  assert(state.data.load.seal_history >= 2, 'the first seal record was destroyed');
  return `current SEAL-0002, ${state.data.load.seal_history} records kept`;
});

await check('completing the load says NOTHING about departure', async () => {
  const done = await asOp(`/loads/${loadId}/complete`, { method: 'POST', body: {} });
  assert(done.status === 201 || done.status === 200, `status ${done.status} ${JSON.stringify(done.body).slice(0, 200)}`);
  assert(done.data.confirmed_by === operator.id);
  assert(Number(done.data.actual_loaded_volume_cbm) === 3.6, `total ${done.data.actual_loaded_volume_cbm}`);
  const state = await asOp(`/container-marketplace/${CONTAINER}/load-state`);
  const stripped = JSON.parse(JSON.stringify(state.data));
  delete stripped.note; delete stripped.candidates;
  const text = JSON.stringify(stripped).toLowerCase();
  for (const later of ['departed', 'shipped', 'in transit', 'sailed', 'arrived']) {
    assert(!text.includes(later), `the load state DATA says "${later}"`);
  }
  return `completed, total ${done.data.actual_loaded_volume_cbm} CBM, no departure claimed`;
});

await check('the customer is told loaded is not sailed', async () => {
  const r = await api(customer, `/my-load-status/cargo_reservation/${RES_A}`);
  assert(r.data.state === 'LOADED');
  assert(/does not mean the container has sailed/i.test(r.data.note), r.data.note);
  return r.data.note;
});

// ── Privacy, with positive controls ────────────────────────────────────────

await check('POSITIVE CONTROL: the operator CAN read the load state', async () => {
  const r = await asOp(`/container-marketplace/${CONTAINER}/load-state`);
  assert(r.status === 200 && r.data.load, 'the operator saw nothing');
  return '200 with a manifest';
});

await check('a customer cannot plan, load, seal or complete', async () => {
  const statuses = [];
  for (const [path, body] of [
    [`/container-marketplace/${CONTAINER}/load-plan`, {}],
    [`/loads/${loadId}/items`, { subjectId: RES_A, outcome: 'LOADED' }],
    [`/loads/${loadId}/seal-records`, { sealNumber: 'FORGED' }],
    [`/loads/${loadId}/complete`, {}],
  ]) {
    const r = await api(customer, path, { method: 'POST', body });
    statuses.push(r.status);
    assert(r.status === 401 || r.status === 403, `${path} returned ${r.status}, which is not a refusal`);
  }
  return statuses.join('/');
});

await check('a customer cannot read the sailing-wide load state', async () => {
  const r = await api(customer, `/container-marketplace/${CONTAINER}/load-state`);
  assert(r.status === 401 || r.status === 403, `status ${r.status}`);
  return `refused ${r.status}`;
});

await check('a co-loader cannot read another participant\'s load status', async () => {
  const r = await api(coloader, `/my-load-status/cargo_reservation/${RES_A}`);
  assert(r.status === 401 || r.status === 403, `status ${r.status}`);
  return `refused ${r.status}`;
});

await check('a foreign operator gets nothing about this sailing', async () => {
  const read = await api(foreign, `/container-marketplace/${CONTAINER}/load-state`, { tenantId: '99990000-0000-4000-8000-000000000002' });
  assert(read.status === 401 || read.status === 403, `read ${read.status}`);
  const write = await api(foreign, `/loads/${loadId}/items`, { method: 'POST', tenantId: '99990000-0000-4000-8000-000000000002', body: { subjectId: RES_A, outcome: 'LOADED' } });
  assert(write.status === 401 || write.status === 403, `write ${write.status}`);
  return `read ${read.status} · write ${write.status}`;
});

await check('an anonymous caller cannot reach any of it', async () => {
  for (const p of [`/container-marketplace/${CONTAINER}/load-readiness`, `/container-marketplace/${CONTAINER}/load-state`, `/my-load-status/cargo_reservation/${RES_A}`]) {
    const r = await fetch(`${API}/api/diaspora${p}`);
    // 404 is NOT authorization proof — a wrong path 404s too. Only 401/403 counts.
    assert(r.status === 401 || r.status === 403, `${p} returned ${r.status}`);
  }
  return '401/403 on all three';
});

await check('the participant projection leaks no other cargo, operator or capacity', async () => {
  const r = await api(customer, `/my-load-status/cargo_reservation/${RES_A}`);
  const text = JSON.stringify(r.data);
  assert(!text.includes(RES_B), 'another participant\'s booking appears');
  assert(!text.includes(operator.id), 'the operator is named to the customer');
  assert(!text.includes(OP_TENANT), 'the tenant is exposed');
  return 'clean';
});

let current = null;
for (const r of results) {
  if (current === null) { console.log('── T10 deployed reachability + firewall ──'); current = 1; }
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  · ${r.detail}` : ''}${r.error ? `  — ${r.error}` : ''}`);
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.length, ok: failed.length === 0 })}`);
console.log('NOTE: this proves the T10 SERVICES are reachable and the firewall holds on the deployed');
console.log('      backend. It is NOT the T10.6 journey suite — no T10 surface exists yet, so nothing');
console.log('      here walks a person through anything.');
process.exit(failed.length ? 1 : 0);
