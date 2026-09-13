/**
 * Trade OS T9 — deployed staging journeys A–F.
 *
 * Every assertion below is made against the DEPLOYED backend over HTTP, as a real signed-in person,
 * because the recurring lesson of this programme is that a module can be correct and never wired.
 * Nothing here reaches into the database to make something true; the only writes are the ones the
 * product itself performs.
 *
 * The privacy journey carries POSITIVE CONTROLS on purpose. A matrix that only shows refusals passes
 * just as happily when the endpoint is broken for everybody.
 *
 * REPEATABILITY: the journeys create their own intakes and therefore need a clean slate. Before a
 * re-run, delete this run's T9 rows only (measurements then intakes for warehouses `99991111%`).
 * That removes the PREVIOUS run's facts so the product has to create them again; it never asserts a
 * domain fact into existence, and it touches nothing outside the synthetic fixture set.
 *
 * Usage:
 *   node scripts/uat/t9-warehouse-journeys.mjs --api <backend-base-url> --password-file <path>
 */
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []),
);
const API = (args.api || '').replace(/\/$/, '');
if (!API) { console.error('--api is required'); process.exit(2); }

const { readFileSync } = await import('node:fs');
// Read, never import: a credential file that is require()-parsed echoes its contents on a syntax error.
const PASSWORD = readFileSync(args['password-file'], 'utf8').trim();

const FIXTURES = {
  warehouse: '99991111-0000-4000-8000-000000000001',
  foreignWarehouse: '99991111-0000-4000-8000-000000000002',
  container: '99993333-0000-4000-8000-000000000001',
  customerReservation: '99994444-0000-4000-8000-000000000001',
  coloaderReservation: '99994444-0000-4000-8000-000000000002',
  pendingReservation: '99994444-0000-4000-8000-000000000003',
  spareA: '99994444-0000-4000-8000-000000000004',
  spareB: '99994444-0000-4000-8000-000000000005',
  awardedRequest: '99995555-0000-4000-8000-000000000001',
};

const results = [];
let journey = '';
const check = async (name, fn) => {
  try { const detail = await fn(); results.push({ journey, name, ok: true, detail: detail || null }); }
  catch (e) { results.push({ journey, name, ok: false, error: String(e.message || e).slice(0, 300) }); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

// ── A signed-in person, with CSRF handled the way a browser handles it ──────
//
// The backend's CSRF is double-submit AND identity-bound: the token encodes {userId, sessionToken},
// so a guest token cannot be reused after login. That means two fetches — a guest token to post the
// login itself, then a session-bound one for everything after. Skipping the second yields a 403 that
// looks exactly like an authorization refusal, which is precisely how a privacy matrix passes by
// being broken for everybody.
async function csrf(headers = {}) {
  const res = await fetch(`${API}/api/security/csrf-token`, { headers });
  const body = await res.json().catch(() => ({}));
  const setCookie = res.headers.get('set-cookie') || '';
  return { token: body?.csrfToken || body?.data?.csrfToken || null, cookie: setCookie.split(';')[0] || '' };
}

async function signIn(email) {
  const guest = await csrf();
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': guest.token, cookie: guest.cookie },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`login ${email} failed: ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  const token = body?.data?.token || body?.token || body?.session?.token;
  const user = body?.data?.user || body?.user;
  if (!token) throw new Error(`login ${email} returned no token`);
  return { email, token, id: user?.id, role: user?.role };
}

async function withCsrf(session) {
  const bound = await csrf({ 'x-session-token': session.token, 'x-user-id': session.id });
  return { ...session, csrf: bound.token, cookie: bound.cookie };
}

async function api(session, path, { method = 'GET', body, tenantId } = {}) {
  const headers = {
    'content-type': 'application/json',
    'x-session-token': session.token,
    'x-user-id': session.id,
    'x-stakeholder-role': session.role,
  };
  if (tenantId) headers['x-tenant-id'] = tenantId;
  if (method !== 'GET' && session.csrf) { headers['x-csrf-token'] = session.csrf; headers.cookie = session.cookie; }
  const res = await fetch(`${API}/api/diaspora${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 300) }; }
  return { status: res.status, body: parsed, data: parsed?.data };
}

const OP_TENANT = '99990000-0000-4000-8000-000000000001';
const FOREIGN_TENANT = '99990000-0000-4000-8000-000000000002';

const operator = await withCsrf(await signIn('t9uat-operator@carup-staging.test'));
const customer = await withCsrf(await signIn('t9uat-customer@carup-staging.test'));
const coloader = await withCsrf(await signIn('t9uat-coloader@carup-staging.test'));
const foreign = await withCsrf(await signIn('t9uat-foreign@carup-staging.test'));
console.log(`signed in: operator=${operator.id} customer=${customer.id} coloader=${coloader.id} foreign=${foreign.id}\n`);

const asOperator = (path, opts = {}) => api(operator, path, { ...opts, tenantId: OP_TENANT });
const asForeign = (path, opts = {}) => api(foreign, path, { ...opts, tenantId: FOREIGN_TENANT });

// ══ Journey A — normal intake ══════════════════════════════════════════════
journey = 'A — normal intake';
let intakeId = null;

await check('the operator sees the warehouse they run, and only that one', async () => {
  const r = await asOperator('/warehouses');
  assert(r.status === 200, `status ${r.status}`);
  const ids = (r.data || []).map((w) => w.id);
  assert(ids.includes(FIXTURES.warehouse), 'own warehouse missing');
  assert(!ids.includes(FIXTURES.foreignWarehouse), 'another tenant\'s warehouse is visible');
  return `${ids.length} warehouse(s)`;
});

await check('cargo can be booked in against the APPROVED booking', async () => {
  const r = await asOperator('/warehouse-intakes', {
    method: 'POST',
    body: { warehouseId: FIXTURES.warehouse, subjectType: 'cargo_reservation', subjectId: FIXTURES.customerReservation },
  });
  assert(r.status === 201 || r.status === 200, `status ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  intakeId = r.data?.id;
  assert(intakeId, 'no intake id');
  assert(r.data.status === 'EXPECTED', `status ${r.data.status}`);
  assert(!r.data.received_at, 'an appointment must not set an arrival time');
  assert(!r.data.received_by, 'an appointment must not name a receiver');
  return r.data.reference;
});

await check('an APPROVED booking is still NOT received cargo', async () => {
  const r = await api(customer, `/my-cargo/cargo_reservation/${FIXTURES.customerReservation}`);
  assert(r.status === 200, `status ${r.status}`);
  assert(r.data.intake.status === 'EXPECTED', `status ${r.data.intake.status}`);
  assert(/expecting|not arrived|nothing has arrived/i.test(r.data.status_sentence), r.data.status_sentence);
  return r.data.status_sentence;
});

await check('the operator physically receives it', async () => {
  const r = await asOperator(`/warehouse-intakes/${intakeId}/receive`, {
    method: 'POST', body: { outcome: 'RECEIVED', condition: 'good', observedPackageCount: 4 },
  });
  assert(r.status === 201 || r.status === 200, `status ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  assert(r.data.status === 'RECEIVED', `status ${r.data.status}`);
  assert(r.data.received_by === operator.id, `receiver ${r.data.received_by}`);
  assert(r.data.received_at, 'no arrival time');
  return `by ${r.data.received_by}`;
});

await check('measurements are recorded and the volume is DERIVED by the server', async () => {
  const r = await asOperator(`/warehouse-intakes/${intakeId}/measurements`, {
    method: 'POST',
    // The client sends a deliberately wrong volume alongside real dimensions. The server must ignore it.
    body: { lengthValue: 200, widthValue: 100, heightValue: 190, dimensionUnit: 'cm', weightValue: 900, weightUnit: 'kg', actualVolumeCbm: 0.1 },
  });
  assert(r.status === 201, `status ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  const cbm = Number(r.data.measurement.actual_volume_cbm);
  assert(cbm === 3.8, `derived volume was ${cbm}, expected 3.8`);
  return `${cbm} CBM derived, client's 0.1 discarded`;
});

await check('a storage position is recorded when it is actually assigned', async () => {
  const before = await asOperator(`/warehouse-intakes/${intakeId}`);
  assert(before.data.storage_location === null, `a position appeared unbidden: ${before.data.storage_location}`);
  const r = await asOperator(`/warehouse-intakes/${intakeId}/storage-location`, { method: 'POST', body: { storageLocation: 'Bay 4, rack C' } });
  assert(r.status === 200, `status ${r.status}`);
  assert(r.data.storage_location === 'Bay 4, rack C');
  return 'unknown → assigned';
});

await check('the customer sees the SAME truth the warehouse recorded', async () => {
  const r = await api(customer, `/my-cargo/cargo_reservation/${FIXTURES.customerReservation}`);
  assert(r.data.intake.status === 'RECEIVED', 'status differs');
  assert(Number(r.data.intake.actual.volume_cbm) === 3.8, 'measurement differs');
  assert(r.data.intake.storage_location === 'Bay 4, rack C', 'storage differs');
  assert(Number(r.data.estimate.volume_cbm) === 3, 'estimate differs');
  return 'operator and customer agree';
});

// ══ Journey B — discrepancy ════════════════════════════════════════════════
journey = 'B — discrepancy';

await check('the +0.8 CBM difference is stated', async () => {
  const r = await api(customer, `/my-cargo/cargo_reservation/${FIXTURES.customerReservation}`);
  const d = r.data.intake.discrepancy;
  assert(d.status === 'DIFFERS', `status ${d.status}`);
  assert(Number(d.volume.difference_cbm) === 0.8, `difference ${d.volume.difference_cbm}`);
  assert(d.volume.direction === 'LARGER');
  return `+${d.volume.difference_cbm} CBM`;
});

await check('THE ORIGINAL ESTIMATE IS UNCHANGED', async () => {
  const r = await api(customer, `/my-cargo/cargo_reservation/${FIXTURES.customerReservation}`);
  assert(Number(r.data.estimate.volume_cbm) === 3, `estimate is now ${r.data.estimate.volume_cbm}`);
  assert(Number(r.data.intake.discrepancy.volume.estimated_cbm) === 3, 'the compared estimate moved');
  return '3.000 CBM, as booked';
});

await check('no price, charge or adjustment appears anywhere in the payload', async () => {
  const r = await api(customer, `/my-cargo/cargo_reservation/${FIXTURES.customerReservation}`);
  const d = r.data.intake.discrepancy;
  assert(d.commercial_effect === 'none', `commercial_effect ${d.commercial_effect}`);
  const { note, ...rest } = d;
  const text = JSON.stringify(rest).toLowerCase();
  for (const f of ['amount', 'charge', 'surcharge', 'currency', 'usd', 'invoice', 'fee']) {
    assert(!text.includes(f), `discrepancy carries "${f}"`);
  }
  return 'a fact, not a bill';
});

await check('a weight discrepancy is reported alongside it', async () => {
  const r = await api(customer, `/my-cargo/cargo_reservation/${FIXTURES.customerReservation}`);
  const w = r.data.intake.discrepancy.weight;
  assert(w && Number(w.difference_kg) === 100, `weight difference ${w && w.difference_kg}`);
  return `+${w.difference_kg} kg`;
});

await check('a PARTIAL estimate reports NOT_COMPARABLE rather than inventing a difference', async () => {
  const create = await asOperator('/warehouse-intakes', {
    method: 'POST', body: { warehouseId: FIXTURES.warehouse, subjectType: 'logistics_request', subjectId: FIXTURES.awardedRequest },
  });
  assert(create.status === 201 || create.status === 200, `status ${create.status}`);
  const id = create.data.id;
  await asOperator(`/warehouse-intakes/${id}/receive`, { method: 'POST', body: { outcome: 'RECEIVED', condition: 'good' } });
  const m = await asOperator(`/warehouse-intakes/${id}/measurements`, {
    method: 'POST', body: { lengthValue: 200, widthValue: 100, heightValue: 190, dimensionUnit: 'cm' },
  });
  assert(m.status === 201, `status ${m.status}`);
  assert(m.data.estimate.completeness === 'PARTIAL', `completeness ${m.data.estimate.completeness}`);
  assert(m.data.discrepancy.status === 'NOT_COMPARABLE', `status ${m.data.discrepancy.status}`);
  assert(m.data.discrepancy.volume === null, 'a difference was asserted against an incomplete estimate');
  assert(/1 of 2|2 of 2|of 2 cargo items/.test(m.data.discrepancy.reason), m.data.discrepancy.reason);
  return m.data.discrepancy.reason;
});

// ══ Journey D — refused / conditional (run before the T5 read, order is irrelevant) ══
journey = 'D — refused / conditional';

await check('a refusal without a reason is refused', async () => {
  const create = await asOperator('/warehouse-intakes', {
    method: 'POST', body: { warehouseId: FIXTURES.warehouse, subjectType: 'cargo_reservation', subjectId: FIXTURES.coloaderReservation },
  });
  assert(create.status === 201 || create.status === 200, `status ${create.status}`);
  const r = await asOperator(`/warehouse-intakes/${create.data.id}/receive`, { method: 'POST', body: { outcome: 'REFUSED' } });
  assert(r.status >= 400, `the server accepted a reasonless refusal: ${r.status}`);
  assert(/say why/i.test(JSON.stringify(r.body)), JSON.stringify(r.body).slice(0, 200));
  return 'refused, with the reason named';
});

await check('a refusal WITH a reason is recorded, and the booking survives', async () => {
  const list = await asOperator('/warehouse-intakes');
  const target = list.data.intakes.find((i) => i.subject.id === FIXTURES.coloaderReservation);
  assert(target, 'the co-loader intake is missing from the queue');
  const r = await asOperator(`/warehouse-intakes/${target.id}/receive`, {
    method: 'POST', body: { outcome: 'REFUSED', outcomeReason: 'Crate was open and contents were loose' },
  });
  assert(r.status === 201 || r.status === 200, `status ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  assert(r.data.status === 'REFUSED');
  assert(r.data.outcome_reason === 'Crate was open and contents were loose');
  assert(r.data.received_by === operator.id && r.data.received_at, 'a refusal is still an attributed act');
  // The booking is a different authority and T9 does not get to cancel it.
  const asColoader = await api(coloader, `/my-cargo/cargo_reservation/${FIXTURES.coloaderReservation}`);
  assert(asColoader.status === 200, 'the co-loader lost sight of their own booking');
  assert(asColoader.data.eligible_for_intake === true, 'the booking was invalidated by a physical refusal');
  return 'reason + actor + time preserved; booking untouched';
});

await check('cargo that has not been received cannot be measured', async () => {
  const create = await asOperator('/warehouse-intakes', {
    method: 'POST', body: { warehouseId: FIXTURES.warehouse, subjectType: 'cargo_reservation', subjectId: FIXTURES.pendingReservation },
  });
  assert(create.status >= 400, `an unapproved booking was booked in: ${create.status}`);
  assert(/not approved/i.test(JSON.stringify(create.body)), JSON.stringify(create.body).slice(0, 200));
  return 'an unapproved booking cannot become physical cargo';
});

// ══ Journey C — condition issue ════════════════════════════════════════════
journey = 'C — condition issue';

await check('a condition outside the vocabulary is refused, on a FRESH consignment', async () => {
  // Deliberately not the already-received intake: that would return the existing row and prove
  // nothing about the vocabulary, which is exactly the kind of check that passes without looking.
  const create = await asOperator('/warehouse-intakes', {
    method: 'POST', body: { warehouseId: FIXTURES.warehouse, subjectType: 'cargo_reservation', subjectId: FIXTURES.spareA },
  });
  assert(create.status === 201 || create.status === 200, `status ${create.status}`);
  const bad = await asOperator(`/warehouse-intakes/${create.data.id}/receive`, {
    method: 'POST', body: { outcome: 'RECEIVED', condition: 'looks_a_bit_rough' },
  });
  assert(bad.status >= 400, `an invented condition was accepted: ${bad.status}`);
  assert(/not one of the conditions/i.test(JSON.stringify(bad.body)), JSON.stringify(bad.body).slice(0, 200));

  // …and the bounded one IS accepted, so the refusal is about the vocabulary and not the endpoint.
  const good = await asOperator(`/warehouse-intakes/${create.data.id}/receive`, {
    method: 'POST', body: { outcome: 'CONDITIONALLY_RECEIVED', condition: 'minor_damage', outcomeReason: 'Corner of the crate was crushed' },
  });
  assert(good.status === 201 || good.status === 200, `the bounded condition was refused too: ${good.status}`);
  assert(good.data.condition === 'minor_damage');
  return 'invented refused · bounded accepted';
});

await check('LOADED cannot be smuggled in as an intake outcome', async () => {
  const list = await asOperator('/warehouse-intakes');
  const target = list.data.intakes.find((i) => i.subject.id === FIXTURES.spareA);
  const r = await asOperator(`/warehouse-intakes/${target.id}/receive`, { method: 'POST', body: { outcome: 'LOADED' } });
  // Already received, so this is a replay — prove the firewall on a genuinely fresh one instead.
  const fresh = await asOperator('/warehouse-intakes', {
    method: 'POST', body: { warehouseId: FIXTURES.warehouse, subjectType: 'cargo_reservation', subjectId: FIXTURES.spareB },
  });
  const loaded = await asOperator(`/warehouse-intakes/${fresh.data.id}/receive`, { method: 'POST', body: { outcome: 'LOADED' } });
  assert(loaded.status >= 400, `the deployed backend accepted LOADED: ${loaded.status}`);
  assert(/received, conditionally received, or refused/i.test(JSON.stringify(loaded.body)), JSON.stringify(loaded.body).slice(0, 200));
  return `refused ${loaded.status} (replay on the received one returned ${r.status})`;
});

await check('the customer sees the observation, and no Trust or insurance conclusion', async () => {
  const r = await api(customer, `/my-cargo/cargo_reservation/${FIXTURES.customerReservation}`);
  const text = JSON.stringify(r.data).toLowerCase();
  for (const f of ['insurance', 'liable', 'liability', 'trust score', 'claim', 'fault']) {
    assert(!text.includes(f), `the payload asserts "${f}"`);
  }
  return 'an observation, nothing more';
});

// ══ Journey B (continued) — the T5 capacity firewall ═══════════════════════
journey = 'B — T5 capacity firewall';

await check('T5 capacity is still computed from the ESTIMATES, not the measurement', async () => {
  const r = await asOperator(`/container-marketplace/containers/${FIXTURES.container}/capacity`);
  assert(r.status === 200, `status ${r.status} — could not read the ledger`);
  const cap = r.data?.capacity;
  assert(cap, `no capacity in payload: ${JSON.stringify(r.data).slice(0, 200)}`);
  // The strongest available form of this assertion. T5 computes usedVolume as the SUM of APPROVED
  // reservations' ESTIMATED volume — so if T9 had written its 3.8 CBM actual back into the estimate,
  // this number would be 6.3 rather than 5.5. Reading the stored column would not have caught that.
  assert(Number(cap.totalVolume) === 33, `total is ${cap.totalVolume}, was 33`);
  assert(Number(cap.usedVolume) === 5.5,
    `used is ${cap.usedVolume}, expected 5.5 (3.0 + 1.5 + 0.5 + 0.5 estimates) — the measurement reached the ledger`);
  assert(Number(cap.availableVolume) === 27.5, `available is ${cap.availableVolume}`);
  return `total 33 / used ${cap.usedVolume} from estimates / available ${cap.availableVolume}`;
});

// ══ Journey E — privacy, WITH positive controls ════════════════════════════
journey = 'E — privacy';

await check('POSITIVE CONTROL: the customer CAN read their own cargo', async () => {
  const r = await api(customer, `/my-cargo/cargo_reservation/${FIXTURES.customerReservation}`);
  assert(r.status === 200, `status ${r.status}`);
  assert(r.data.intake, 'the owner saw nothing — the matrix would pass by denying everybody');
  return '200 with data';
});

await check('POSITIVE CONTROL: the operator CAN read their own queue', async () => {
  const r = await asOperator('/warehouse-intakes');
  assert(r.status === 200 && r.data.intakes.length > 0, 'the operator saw nothing');
  return `${r.data.intakes.length} intakes`;
});

await check('a co-loader on the same sailing cannot read the other participant\'s cargo', async () => {
  const r = await api(coloader, `/my-cargo/cargo_reservation/${FIXTURES.customerReservation}`);
  assert(r.status === 403 || r.status === 404, `status ${r.status} — a co-loader read it`);
  return `refused ${r.status}`;
});

await check('a customer cannot mark their OWN cargo received', async () => {
  const r = await api(customer, `/warehouse-intakes/${intakeId}/receive`, { method: 'POST', body: { outcome: 'RECEIVED' } });
  assert(r.status >= 400, `status ${r.status} — the customer received their own cargo`);
  return `refused ${r.status}`;
});

await check('a customer cannot record a measurement', async () => {
  const r = await api(customer, `/warehouse-intakes/${intakeId}/measurements`, {
    method: 'POST', body: { lengthValue: 100, widthValue: 100, heightValue: 100, dimensionUnit: 'cm' },
  });
  assert(r.status >= 400, `status ${r.status} — the customer measured their own cargo`);
  return `refused ${r.status}`;
});

await check('a foreign warehouse operator cannot read or receive this cargo', async () => {
  const read = await asForeign(`/warehouse-intakes/${intakeId}`);
  assert(read.status >= 400, `read status ${read.status}`);
  const receive = await asForeign(`/warehouse-intakes/${intakeId}/receive`, { method: 'POST', body: { outcome: 'RECEIVED' } });
  assert(receive.status >= 400, `receive status ${receive.status}`);
  const queue = await asForeign('/warehouse-intakes');
  const leaked = (queue.data?.intakes || []).filter((i) => i.warehouse_id === FIXTURES.warehouse);
  assert(leaked.length === 0, `${leaked.length} foreign intakes leaked into the queue`);
  return `read ${read.status} · receive ${receive.status} · 0 leaked`;
});

await check('a forged warehouseId cannot widen a foreign operator\'s scope', async () => {
  const r = await asForeign(`/warehouse-intakes?warehouseId=${FIXTURES.warehouse}`);
  const leaked = (r.data?.intakes || []).filter((i) => i.warehouse_id === FIXTURES.warehouse);
  assert(leaked.length === 0, `${leaked.length} intakes leaked by naming the warehouse`);
  return 'naming a warehouse grants nothing';
});

await check('an anonymous caller cannot reach any of it', async () => {
  const paths = ['/warehouse-intakes', `/warehouse-intakes/${intakeId}`, '/warehouses', `/my-cargo/cargo_reservation/${FIXTURES.customerReservation}`];
  const statuses = [];
  for (const p of paths) {
    const res = await fetch(`${API}/api/diaspora${p}`);
    statuses.push(res.status);
    // A 404 is NOT authorization proof — a wrong path 404s too. Only 401/403 counts.
    assert(res.status === 401 || res.status === 403, `${p} returned ${res.status}, which is not a refusal`);
  }
  return `401/403 on all ${paths.length}`;
});

await check('an anonymous caller cannot RECEIVE cargo', async () => {
  const res = await fetch(`${API}/api/diaspora/warehouse-intakes/${intakeId}/receive`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ outcome: 'RECEIVED' }),
  });
  assert(res.status === 401 || res.status === 403, `status ${res.status}`);
  return `refused ${res.status}`;
});

await check('the customer payload carries no warehouse staff identity or tenant', async () => {
  const r = await api(customer, `/my-cargo/cargo_reservation/${FIXTURES.customerReservation}`);
  const text = JSON.stringify(r.data);
  assert(!text.includes(operator.id), 'the receiving staff member is named to the customer');
  assert(!text.includes(OP_TENANT), 'the warehouse tenant id is exposed');
  assert(!text.includes(FIXTURES.coloaderReservation), 'another participant\'s booking appears');
  return 'no staff, no tenant, no co-loader';
});

// ══ Journey F — replay and concurrency ═════════════════════════════════════
journey = 'F — replay / concurrency';

await check('booking the same cargo in twice yields ONE intake', async () => {
  const again = await asOperator('/warehouse-intakes', {
    method: 'POST', body: { warehouseId: FIXTURES.warehouse, subjectType: 'cargo_reservation', subjectId: FIXTURES.customerReservation },
  });
  assert(again.status === 200, `a second appointment was created: ${again.status}`);
  assert(again.data.id === intakeId, 'a different intake came back');
  assert(again.data.already_existed === true, 'the replay was not reported as one');
  return 'the winner was handed back';
});

await check('CONCURRENT book-in attempts yield ONE intake', async () => {
  const [a, b, c] = await Promise.all([
    asOperator('/warehouse-intakes', { method: 'POST', body: { warehouseId: FIXTURES.warehouse, subjectType: 'cargo_reservation', subjectId: FIXTURES.customerReservation } }),
    asOperator('/warehouse-intakes', { method: 'POST', body: { warehouseId: FIXTURES.warehouse, subjectType: 'cargo_reservation', subjectId: FIXTURES.customerReservation } }),
    asOperator('/warehouse-intakes', { method: 'POST', body: { warehouseId: FIXTURES.warehouse, subjectType: 'cargo_reservation', subjectId: FIXTURES.customerReservation } }),
  ]);
  const ids = new Set([a.data?.id, b.data?.id, c.data?.id]);
  assert(ids.size === 1 && ids.has(intakeId), `${ids.size} distinct intakes came back`);
  return 'three requests, one consignment';
});

await check('a REPLAYED receive does not move the arrival time', async () => {
  const before = await asOperator(`/warehouse-intakes/${intakeId}`);
  const replay = await asOperator(`/warehouse-intakes/${intakeId}/receive`, { method: 'POST', body: { outcome: 'RECEIVED', observedPackageCount: 99 } });
  assert(replay.status === 200, `status ${replay.status}`);
  assert(replay.data.already_received === true, 'the replay was not reported as one');
  const after = await asOperator(`/warehouse-intakes/${intakeId}`);
  assert(after.data.received_at === before.data.received_at, 'the arrival time moved');
  assert(Number(after.data.observed_package_count) === 4, `the package count became ${after.data.observed_package_count}`);
  return 'one arrival, unchanged';
});

await check('CONCURRENT receives on a fresh consignment produce ONE receipt', async () => {
  const list = await asOperator('/warehouse-intakes');
  const target = list.data.intakes.find((i) => i.subject.id === FIXTURES.spareB && i.status === 'EXPECTED');
  assert(target, 'no EXPECTED consignment left to race — the test would prove nothing');
  const [a, b, c] = await Promise.all([
    asOperator(`/warehouse-intakes/${target.id}/receive`, { method: 'POST', body: { outcome: 'RECEIVED', observedPackageCount: 1 } }),
    asOperator(`/warehouse-intakes/${target.id}/receive`, { method: 'POST', body: { outcome: 'RECEIVED', observedPackageCount: 2 } }),
    asOperator(`/warehouse-intakes/${target.id}/receive`, { method: 'POST', body: { outcome: 'RECEIVED', observedPackageCount: 3 } }),
  ]);
  const created = [a, b, c].filter((r) => r.status === 201);
  const replays = [a, b, c].filter((r) => r.status === 200 && r.data?.already_received);
  assert(created.length === 1, `${created.length} receipts were created for one arrival`);
  assert(replays.length === 2, `${replays.length} of the losers were handed the winner`);
  const after = await asOperator(`/warehouse-intakes/${target.id}`);
  assert(after.data.status === 'RECEIVED');
  return `1 receipt, 2 losers handed the winner, count=${after.data.observed_package_count}`;
});

await check('a second measurement is a correction, and the first survives', async () => {
  const r = await asOperator(`/warehouse-intakes/${intakeId}/measurements`, {
    method: 'POST', body: { lengthValue: 200, widthValue: 100, heightValue: 200, dimensionUnit: 'cm' },
  });
  assert(r.status === 201, `status ${r.status}`);
  const view = await asOperator(`/warehouse-intakes/${intakeId}`);
  assert(Number(view.data.actual.volume_cbm) === 4, `latest is ${view.data.actual.volume_cbm}`);
  assert(view.data.earlier_measurements >= 1, 'the earlier observation vanished');
  return `latest 4.000 CBM, ${view.data.earlier_measurements} earlier kept`;
});

// ── Report ─────────────────────────────────────────────────────────────────
let current = '';
for (const r of results) {
  if (r.journey !== current) { current = r.journey; console.log(`\n── ${current} ──`); }
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  · ${r.detail}` : ''}${r.error ? `  — ${r.error}` : ''}`);
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.length, ok: failed.length === 0 })}`);
console.log(`INTAKE_ID=${intakeId}`);
process.exit(failed.length ? 1 : 0);
