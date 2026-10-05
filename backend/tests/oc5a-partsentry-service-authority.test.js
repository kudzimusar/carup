/**
 * OC-5A P1-A — PartSentry object/service authority, through the SHIPPED app (real routing, real session
 * rows) on a real PostgreSQL (PGlite) running the repository's own migrations, with the REAL ledger writer
 * and the REAL Issue #158 custody contract (finalized here, so stakeholder signing works).
 *
 * RC1 residual finding A: "a mechanic somewhere" could write any vehicle's repair ledger and its
 * canonical odometer (a self-issued work order was a relationship), a dealership member without Dealer
 * authority could do the same on the dealership's stock (raw tenant equality), and an owner's own entry
 * was ledgered as a "Mechanic Inspection".
 *
 * Every negative the programme named is here, each asserting that NOTHING was written:
 *   dealership member without Dealer authority · mechanic in an unrelated garage · dealer for tenant A on
 *   a tenant B vehicle · forged tenant header · forged role header · owner declaration impersonating a
 *   mechanic verification — plus a pending (unauthorized) work order, a garage 'member', a revoked order.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
delete process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;
delete process.env.CARUP_LEDGER_HASH_VERSION;

const { createOc5aDatabase, finalizeCustody, installOver } = await import('./helpers/oc5aPartSentryWorld.js');
const { app } = await import('../server.js');
const { supabase } = await import('../db/supabase.js');
const { buildSessionRow } = await import('../services/auth/sessionRow.js');
const { custodyGeneration } = await import('../services/blockchain/blockchainKeyCustodyService.js');

const FUTURE = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
const VIN_OWNED = 'OC5AVINOWNED00001';
const VIN_STOCK_A = 'OC5AVINSTOCKA0001';
const VIN_STOCK_B = 'OC5AVINSTOCKB0001';
const USERS = {
  owner: ['owner-1', 'owner'],
  stranger: ['owner-2', 'owner'],
  mechanic: ['mech-1', 'mechanic'],        // platform mechanic, garage mechanic, authorized work order
  lentMechanic: ['mech-lend', 'owner'],    // platform owner lent 'mechanic' by a garage membership
  otherGarage: ['mech-2', 'mechanic'],     // mechanic of an UNRELATED garage
  garageMember: ['mech-3', 'mechanic'],    // only a 'member' of the work order's garage
  dealerA: ['dealer-a', 'dealer'],         // governed dealer of dealership A
  staffA: ['staff-a', 'dealer'],           // member of dealership A as 'mechanic' — no Dealer authority
  dealerB: ['dealer-b', 'dealer'],
  admin: ['admin-1', 'admin'],
  deskMechanic: ['mech-desk', 'mechanic'],     // 'mechanic' of a GOVERNMENT-type organisation
  suspendedMechanic: ['mech-susp', 'mechanic'], // mechanic of a SUSPENDED garage
};
const VIN_CONSIGNED = 'OC5AVINCONSIGN001'; // privately owned, held by dealership A for sale

let db; let server; let baseUrl; let installed;
const T = {};
const WO = {};

before(async () => {
  db = await createOc5aDatabase();
  installed = installOver(supabase, db);
  for (const [who, [id, role]] of Object.entries(USERS)) {
    await db.query(`INSERT INTO users (id, name, email, role, join_date, is_verified) VALUES ($1, $2, $3, $4, '2026-01-01', true)`, [id, who, `${id}@example.invalid`, role]);
    const { error } = await installed.client.from('user_sessions').insert(buildSessionRow({ userId: id, activeRole: role, token: `oc5a-session-${who}`, expiresAt: FUTURE }));
    assert.equal(error, null, `session for ${who}`);
  }
  const tenant = async (key, name, type, status = 'active') => {
    const { rows: [row] } = await db.query(`INSERT INTO tenants (name, type, status) VALUES ($1, $2, $3) RETURNING id`, [name, type, status]);
    T[key] = row.id;
  };
  await tenant('garage', 'Harare Garage', 'garage');
  await tenant('garage2', 'Unrelated Garage', 'garage');
  await tenant('dealerA', 'Dealership A', 'dealership');
  await tenant('dealerB', 'Dealership B', 'dealership');
  await tenant('desk', 'Licensing Desk', 'government');
  await tenant('suspendedGarage', 'Closed Garage', 'garage', 'suspended');
  const member = (tenantKey, userId, role) => db.query(`INSERT INTO tenant_users (tenant_id, user_id, role) VALUES ($1, $2, $3)`, [T[tenantKey], userId, role]);
  await member('garage', 'mech-1', 'mechanic');
  await member('garage', 'mech-lend', 'mechanic');
  await member('garage', 'mech-3', 'member');
  await member('garage2', 'mech-2', 'mechanic');
  await member('dealerA', 'dealer-a', 'dealer');
  await member('dealerA', 'staff-a', 'mechanic');
  await member('dealerB', 'dealer-b', 'dealer');
  await member('desk', 'mech-desk', 'mechanic');
  await member('suspendedGarage', 'mech-susp', 'mechanic');
  await db.query(`INSERT INTO vehicles (vin, make, model, year, mileage, price, owner_id, current_seller_id, tenant_id) VALUES
      ($1, 'Toyota', 'Hilux', 2020, 60000, 21000, 'owner-1', NULL, NULL),
      ($2, 'Mazda', 'BT-50', 2019, 30000, 15000, NULL, NULL, $4),
      ($3, 'Nissan', 'Navara', 2018, 45000, 12000, NULL, NULL, $5),
      ($6, 'Honda', 'Fit', 2015, 99000, 6000, 'owner-2', NULL, $4)`, [VIN_OWNED, VIN_STOCK_A, VIN_STOCK_B, T.dealerA, T.dealerB, VIN_CONSIGNED]);
  const order = async (key, tenantKey, vin, mechanicId, authorization, by = 'owner-1') => {
    const decided = authorization !== 'pending';
    const { rows: [row] } = await db.query(
      `INSERT INTO mechanic_work_orders (tenant_id, vin, customer_id, mechanic_id, status, description, owner_authorization, owner_authorized_by, owner_authorized_at)
       VALUES ($1, $2, 'owner-1', $3, 'In Progress', 'Brake service', $4, $5, $6) RETURNING id`,
      [T[tenantKey], vin, mechanicId, authorization, decided ? by : null, decided ? new Date().toISOString() : null]);
    WO[key] = row.id;
  };
  await order('authorized', 'garage', VIN_OWNED, 'mech-1', 'authorized');
  await order('pendingLent', 'garage', VIN_OWNED, 'mech-lend', 'pending');
  await order('memberOnly', 'garage', VIN_OWNED, 'mech-3', 'authorized');
  await order('desk', 'desk', VIN_OWNED, 'mech-desk', 'authorized');
  await order('suspended', 'suspendedGarage', VIN_OWNED, 'mech-susp', 'authorized');
  await finalizeCustody(db, custodyGeneration());
  await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  installed?.restore();
  if (server) await new Promise((resolve) => server.close(resolve));
  await db?.close();
});

async function call(path, { who = null, method = 'GET', body, headers = {} } = {}) {
  const h = { 'x-bypass-rate-limit': 'true', 'content-type': 'application/json', ...headers };
  if (who) h['x-session-token'] = `oc5a-session-${who}`;
  const res = await fetch(`${baseUrl}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed, text };
}

const part = (vin, overrides = {}) => ({ vin, partName: 'Brake pads', partOem: 'OEM-BP-1', actionType: 'Replaced', description: 'Front pads replaced', mileage: 60500, ...overrides });
const add = (who, body, headers) => call('/api/partsentry/add', { who, method: 'POST', body, headers });
const counts = async () => {
  const { rows: [c] } = await db.query(`SELECT
      (SELECT count(*)::int FROM partsentry_logs) AS logs,
      (SELECT count(*)::int FROM ledger_event_intents) AS intents,
      (SELECT count(*)::int FROM blockchain_events) AS events`);
  return c;
};
const mileageOf = async (vin) => (await db.query('SELECT mileage FROM vehicles WHERE vin = $1', [vin])).rows[0].mileage;

async function refusedWithoutWrites(label, request, expectedStatus = 403) {
  const before = await counts();
  const mileages = [await mileageOf(VIN_OWNED), await mileageOf(VIN_STOCK_A), await mileageOf(VIN_STOCK_B)];
  const res = await request();
  assert.equal(res.status, expectedStatus, `${label}: ${res.text.slice(0, 300)}`);
  assert.deepEqual(await counts(), before, `${label}: nothing may be written`);
  assert.deepEqual([await mileageOf(VIN_OWNED), await mileageOf(VIN_STOCK_A), await mileageOf(VIN_STOCK_B)], mileages, `${label}: no odometer moved`);
  return res;
}

// ── the governed mechanic service ─────────────────────────────────────────────────────────────────

test('a mechanic under an OWNER-AUTHORIZED work order of their own garage records a mechanic service: odometer moves, ledgered as a Mechanic Inspection signed by the mechanic', async () => {
  const res = await add('mechanic', part(VIN_OWNED), { 'x-tenant-id': T.garage });
  assert.equal(res.status, 201, res.text);
  assert.equal(res.body.attestation, 'mechanic_service');
  assert.equal(res.body.odometerApplied, true);
  assert.equal(res.body.workOrderId, WO.authorized);
  assert.equal(res.body.ledger.status, 'recorded', JSON.stringify(res.body.ledger));
  assert.equal(await mileageOf(VIN_OWNED), 60500);
  const { rows: [event] } = await db.query('SELECT event_type, payload, signature FROM blockchain_events WHERE id = $1', [res.body.ledger.eventId]);
  assert.equal(event.event_type, 'Mechanic Inspection');
  const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
  const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
  assert.equal(parsed.mechanicId, 'mech-1');
  assert.equal(parsed.attestation, 'mechanic_service');
  assert.ok(event.signature.startsWith('mech-1:'), 'signed with the mechanic\'s custodied key');
  const verified = await call(`/api/vehicles/${VIN_OWNED}/verify-ledger`, { who: 'owner' });
  assert.equal(verified.body.integrity, 'verified', verified.text);
});

test('a lent mechanic role works the same way — but only once the work order is authorized', async () => {
  await refusedWithoutWrites('pending work order', () => add('lentMechanic', part(VIN_OWNED, { mileage: 60600 }), { 'x-tenant-id': T.garage, 'x-stakeholder-role': 'mechanic' }));
  const pending = await add('lentMechanic', part(VIN_OWNED, { mileage: 60600 }), { 'x-tenant-id': T.garage, 'x-stakeholder-role': 'mechanic' });
  assert.equal(pending.body.reason, 'work_order_awaiting_owner_authorization');
});

// ── the named negatives ───────────────────────────────────────────────────────────────────────────

test('NEGATIVE: a mechanic of an UNRELATED garage — no work order, then a self-opened one — changes nothing', async () => {
  const none = await refusedWithoutWrites('unrelated garage', () => add('otherGarage', part(VIN_OWNED, { mileage: 61000 }), { 'x-tenant-id': T.garage2 }));
  assert.equal(none.body.reason, 'no_authorized_work_order');
  // The mechanic opens a work order on the vehicle themselves: it is a REQUEST, never authority.
  const opened = await call('/api/mechanic/work-orders', { who: 'otherGarage', method: 'POST', body: { vin: VIN_OWNED, issue_description: 'Self-issued' }, headers: { 'x-tenant-id': T.garage2 } });
  assert.equal(opened.status, 200, opened.text);
  assert.equal(opened.body.ownerAuthorization, 'pending');
  const after = await refusedWithoutWrites('self-issued work order', () => add('otherGarage', part(VIN_OWNED, { mileage: 61000 }), { 'x-tenant-id': T.garage2 }));
  assert.equal(after.body.reason, 'work_order_awaiting_owner_authorization');
});

test('NEGATIVE: an authorized work order is not enough for a mere MEMBER of the garage', async () => {
  const res = await refusedWithoutWrites('garage member', () => add('garageMember', part(VIN_OWNED, { mileage: 61100 })));
  assert.equal(res.body.reason, 'not_a_mechanic_of_the_work_order_organisation');
});

test('NEGATIVE: an authorized work order held by a NON-SERVICE organisation (a government desk) is no service relationship', async () => {
  const res = await refusedWithoutWrites('government-type organisation', () => add('deskMechanic', part(VIN_OWNED, { mileage: 61150 })));
  assert.equal(res.body.reason, 'organisation_not_a_service_provider');
});

test('NEGATIVE: an authorized work order of a SUSPENDED garage is no service relationship', async () => {
  const res = await refusedWithoutWrites('suspended garage', () => add('suspendedMechanic', part(VIN_OWNED, { mileage: 61160 })));
  assert.equal(res.body.reason, 'organisation_not_active');
});

test('NEGATIVE: a "mechanic somewhere" with no relationship to the vehicle changes nothing', async () => {
  await refusedWithoutWrites('mechanic somewhere', () => add('mechanic', part(VIN_STOCK_B, { mileage: 46000 }), { 'x-tenant-id': T.garage }));
});

test('NEGATIVE: a dealership member WITHOUT Dealer authority, on the dealership\'s own stock, changes nothing', async () => {
  const res = await refusedWithoutWrites('staff without dealer authority', () => add('staffA', part(VIN_STOCK_A, { mileage: 31000 }), { 'x-tenant-id': T.dealerA }));
  assert.equal(res.body.reason, 'no_relationship');
});

test('NEGATIVE: a dealer for tenant A on a tenant B vehicle changes nothing — with their own tenant, and with a forged tenant header', async () => {
  await refusedWithoutWrites('dealer A on B, own tenant', () => add('dealerA', part(VIN_STOCK_B, { mileage: 46000 }), { 'x-tenant-id': T.dealerA }));
  await refusedWithoutWrites('dealer A on B, forged tenant B', () => add('dealerA', part(VIN_STOCK_B, { mileage: 46000 }), { 'x-tenant-id': T.dealerB }));
});

test('NEGATIVE: forged tenant header — a mechanic claiming the vehicle\'s garage they do not belong to is refused before anything is read', async () => {
  const res = await refusedWithoutWrites('forged tenant', () => add('otherGarage', part(VIN_OWNED, { mileage: 61200 }), { 'x-tenant-id': T.garage }));
  assert.match(res.body.error, /do not have access to this tenant/);
});

test('NEGATIVE: forged role headers — mechanic with no membership, admin, government — are refused', async () => {
  for (const role of ['mechanic', 'admin', 'government', 'reviewer']) {
    await refusedWithoutWrites(`forged ${role}`, () => add('stranger', part(VIN_OWNED, { mileage: 61300 }), { 'x-stakeholder-role': role }));
  }
});

test('NEGATIVE: an owner\'s declaration can never impersonate a mechanic verification', async () => {
  // Claiming the mechanic role without a membership is refused outright.
  await refusedWithoutWrites('owner as mechanic', () => add('owner', part(VIN_OWNED, { mileage: 61400 }), { 'x-stakeholder-role': 'mechanic' }));
  // Naming someone else's authorized work order changes nothing about who is speaking.
  const before = await mileageOf(VIN_OWNED);
  const res = await add('owner', part(VIN_OWNED, { mileage: 61400, workOrderId: WO.authorized, partName: 'Wiper blades' }));
  assert.equal(res.status, 201, res.text);
  assert.equal(res.body.attestation, 'owner_stated');
  assert.equal(res.body.odometerApplied, false);
  assert.equal(res.body.workOrderId, null, 'an owner statement is never filed under a mechanic\'s work order');
  assert.equal(await mileageOf(VIN_OWNED), before, 'an owner statement never moves the canonical odometer');
  const { rows: [event] } = await db.query('SELECT event_type, payload FROM blockchain_events WHERE id = $1', [res.body.ledger.eventId]);
  assert.equal(event.event_type, 'Owner Maintenance Declaration');
  assert.doesNotMatch(String(event.payload), /mechanicId/, 'no mechanic identity in an owner declaration');
  const { rows: [log] } = await db.query('SELECT attestation, odometer_applied, work_order_id FROM partsentry_logs WHERE id = $1', [res.body.id]);
  assert.deepEqual({ ...log }, { attestation: 'owner_stated', odometer_applied: false, work_order_id: null });
});

// ── the other governed classes ────────────────────────────────────────────────────────────────────

test('a governed dealer records a dealer entry on its own stock — never an odometer move, never a mechanic inspection', async () => {
  const res = await add('dealerA', part(VIN_STOCK_A, { mileage: 31000 }), { 'x-tenant-id': T.dealerA });
  assert.equal(res.status, 201, res.text);
  assert.equal(res.body.attestation, 'dealer_recorded');
  assert.equal(res.body.odometerApplied, false);
  assert.equal(await mileageOf(VIN_STOCK_A), 30000);
  const { rows: [event] } = await db.query('SELECT event_type FROM blockchain_events WHERE id = $1', [res.body.ledger.eventId]);
  assert.equal(event.event_type, 'Dealer Maintenance Record');
});

test('a platform administrator records a platform entry, by PLATFORM role', async () => {
  const res = await add('admin', part(VIN_STOCK_B, { mileage: 45500 }));
  assert.equal(res.status, 201, res.text);
  assert.equal(res.body.attestation, 'platform_recorded');
  assert.equal(res.body.odometerApplied, false);
});

// ── reading the full record ───────────────────────────────────────────────────────────────────────

test('the FULL repair record is for the relationships that may write; a mechanic somewhere sees the public record', async () => {
  const full = await call(`/api/partsentry/${VIN_OWNED}`, { who: 'mechanic' });
  assert.equal(full.status, 200);
  assert.ok(full.body.length >= 2 && full.body.some((row) => row.mechanic_id), 'the authorized mechanic reads the full record');
  const owner = await call(`/api/partsentry/${VIN_OWNED}`, { who: 'owner' });
  assert.ok(owner.body.some((row) => row.mechanic_id), 'the owner reads the full record');
  for (const who of ['otherGarage', 'stranger', 'deskMechanic', 'suspendedMechanic', 'garageMember', null]) {
    const res = await call(`/api/partsentry/${VIN_OWNED}`, { who });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, [], `${who ?? 'anonymous'}: nothing unreviewed (no entry is public-card approved)`);
  }
});

// ── the custodian decides ─────────────────────────────────────────────────────────────────────────

test('the custodian decides: the owner lists the requests, authorizes one (audited), and only then may that mechanic record service; revoking withdraws it', async () => {
  const stranger = await call(`/api/vehicles/${VIN_OWNED}/work-orders`, { who: 'stranger' });
  assert.equal(stranger.status, 403);
  const mechanicLists = await call(`/api/vehicles/${VIN_OWNED}/work-orders`, { who: 'mechanic' });
  assert.equal(mechanicLists.status, 403, 'a mechanic is not the custodian');

  const listed = await call(`/api/vehicles/${VIN_OWNED}/work-orders`, { who: 'owner' });
  assert.equal(listed.status, 200, listed.text);
  const request = listed.body.find((order) => order.id === WO.pendingLent);
  assert.equal(request.owner_authorization, 'pending');
  assert.equal(request.organisation.name, 'Harare Garage');
  assert.doesNotMatch(listed.text, /@example\.invalid/, 'no contact details in the custodian view');

  const selfDecide = await call(`/api/vehicles/${VIN_OWNED}/work-orders/${WO.pendingLent}/authorization`, { who: 'lentMechanic', method: 'POST', body: { decision: 'authorized' } });
  assert.equal(selfDecide.status, 403, 'the requesting mechanic cannot authorize');

  const decided = await call(`/api/vehicles/${VIN_OWNED}/work-orders/${WO.pendingLent}/authorization`, { who: 'owner', method: 'POST', body: { decision: 'authorized', reason: 'Booked in for brakes' } });
  assert.equal(decided.status, 200, decided.text);
  assert.equal(decided.body.workOrder.owner_authorization, 'authorized');
  const { rows: audits } = await db.query(`SELECT actor_user_id, new_value FROM trust_audit_events WHERE event_type = 'WORK_ORDER_OWNER_AUTHORIZATION'`);
  assert.ok(audits.some((a) => a.actor_user_id === 'owner-1' && a.new_value.owner_authorization === 'authorized' && a.new_value.basis === 'owner'), 'the decision is audited with its basis');

  const logged = await add('lentMechanic', part(VIN_OWNED, { mileage: 62000, partName: 'Brake discs' }), { 'x-tenant-id': T.garage, 'x-stakeholder-role': 'mechanic' });
  assert.equal(logged.status, 201, logged.text);
  assert.equal(logged.body.attestation, 'mechanic_service');

  const revoked = await call(`/api/vehicles/${VIN_OWNED}/work-orders/${WO.pendingLent}/authorization`, { who: 'owner', method: 'POST', body: { decision: 'revoked' } });
  assert.equal(revoked.status, 200, revoked.text);
  await refusedWithoutWrites('after revocation', () => add('lentMechanic', part(VIN_OWNED, { mileage: 62100, partName: 'Pads' }), { 'x-tenant-id': T.garage, 'x-stakeholder-role': 'mechanic' }));
  const again = await call(`/api/vehicles/${VIN_OWNED}/work-orders/${WO.pendingLent}/authorization`, { who: 'owner', method: 'POST', body: { decision: 'authorized' } });
  assert.equal(again.status, 409, 'a revoked work order is final');
});

test('the custodian decision requires a real session — an x-user-id assertion is refused even in test mode', async () => {
  process.env.CARUP_ALLOW_X_USER_ID_FALLBACK = 'true';
  try {
    const res = await call(`/api/vehicles/${VIN_OWNED}/work-orders/${WO.memberOnly}/authorization`, { method: 'POST', body: { decision: 'revoked' }, headers: { 'x-user-id': 'owner-1' } });
    assert.equal(res.status, 401, res.text);
  } finally {
    delete process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;
  }
});

test('DATABASE: the decision function refuses self-authorization and a non-owner on the owner basis, under its own lock', async () => {
  await db.query(`INSERT INTO vehicles (vin, make, model, year, mileage, price, owner_id) VALUES ('OC5AVINSELF000001', 'VW', 'Polo', 2017, 9000, 5000, 'mech-1')`);
  const { rows: [order] } = await db.query(`INSERT INTO mechanic_work_orders (tenant_id, vin, mechanic_id, status) VALUES ($1, 'OC5AVINSELF000001', 'mech-1', 'In Progress') RETURNING id`, [T.garage]);
  await assert.rejects(db.query(`SELECT mechanic_work_order_decide_authorization($1, 'OC5AVINSELF000001', 'mech-1', 'mechanic', NULL, 'owner', 'authorized', NULL)`, [order.id]),
    (error) => error.code === '42501' && /cannot authorize/.test(error.message));
  await assert.rejects(db.query(`SELECT mechanic_work_order_decide_authorization($1, $2, 'owner-2', 'owner', NULL, 'owner', 'revoked', NULL)`, [WO.authorized, VIN_OWNED]),
    (error) => error.code === '42501' && /registered owner/.test(error.message));
  await assert.rejects(db.query(`UPDATE mechanic_work_orders SET owner_authorization = 'authorized', owner_authorized_by = 'mech-1', owner_authorized_at = now() WHERE id = $1`, [order.id]),
    (error) => error.code === '23514', 'the table itself refuses a self-authorized order');
  await assert.rejects(db.query(`UPDATE mechanic_work_orders SET owner_authorization = 'authorized' WHERE id = $1`, [order.id]),
    (error) => error.code === '23514', 'a decision without its maker and moment is refused');
});

test('the custodian function itself (not only the route guard): a mechanic is never a custodian; a dealer decides only for owner-less stock', async () => {
  const { resolveWorkOrderCustodian } = await import('../services/partsentry/partsentryServiceAuthority.js');
  const asMechanic = await resolveWorkOrderCustodian({ vin: VIN_OWNED, userContext: { id: 'mech-1', role: 'mechanic', platformRole: 'mechanic' } });
  assert.equal(asMechanic.allowed, false, 'a mechanic is not the custodian of a vehicle they service');
  const owner = await resolveWorkOrderCustodian({ vin: VIN_OWNED, userContext: { id: 'owner-1', role: 'owner', platformRole: 'owner' } });
  assert.deepEqual([owner.allowed, owner.basis], [true, 'owner']);
  const stock = await resolveWorkOrderCustodian({ vin: VIN_STOCK_A, userContext: { id: 'dealer-a', role: 'dealer', platformRole: 'dealer', tenantId: T.dealerA } });
  assert.deepEqual([stock.allowed, stock.basis], [true, 'dealer'], 'a governed dealer decides for its owner-less stock');
  const consigned = await resolveWorkOrderCustodian({ vin: VIN_CONSIGNED, userContext: { id: 'dealer-a', role: 'dealer', platformRole: 'dealer', tenantId: T.dealerA } });
  assert.equal(consigned.allowed, false, 'a privately owned vehicle\'s owner decides, even while a dealership holds it for sale');
  const stranger = await resolveWorkOrderCustodian({ vin: 'OC5ANOSUCHVIN0001', userContext: { id: 'owner-1', role: 'owner', platformRole: 'owner' } });
  assert.deepEqual([stranger.allowed, stranger.status], [false, 403], 'an unknown vin is refused like a stranger');
});
