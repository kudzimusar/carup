/**
 * OC-5H — RC2 product journeys, end to end through the SHIPPED app.
 *
 * OC-4E proved RC1's journeys. These prove what OC-5 added, each as ONE person's path through real
 * routes with real session authentication (every caller holds a `user_sessions` row; no x-user-id
 * fallback), over one in-memory world (helpers/inMemorySupabaseWorld.js — PostgREST-faithful
 * projection; not a database: constraints and functions are proven on PGlite in the phase suites).
 *
 * AI LABEL, per journey (the programme's rule: mocked output is never provider evidence):
 *   every journey in this file is  AI: NONE — none of these paths calls a model. A fetch guard
 *   refuses any request that leaves this process and the file asserts zero provider calls, so the
 *   label is checked, not claimed. REAL provider runs: none (OC-5 runs no live provider).
 *
 *   J1  An organisation is CHOSEN, never guessed (OC-5D P1/P2).
 *   J2  A customer's vehicle is serviced end to end: request → garage accepts → work order awaits the
 *       custodian → refused until authorized → authorized → recorded → the owner's history (OC-5D).
 *       One DOUBLE: the custodian's decision function (see before()), proven on PostgreSQL in OC-5A.
 *   J4  A seller's numbers survive a sale: rollup@2 credits a reservation to the seller it was made
 *       WITH, after the vehicle transferred to the buyer, and counts the funnel's compare stage (OC-5F).
 *   J5  A governed decision reaches the person: a reviewer's seller-authority decision becomes an
 *       outbox event, the real orchestrator renders it from the governed registry (OC-5G's rows,
 *       loaded from the migration itself), and it routes in-app even for a person who prefers email.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

for (const method of ['log', 'info', 'warn', 'debug', 'error']) console[method] = () => {};

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
delete process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;

const { readFileSync } = await import('node:fs');
const { PGlite } = await import('@electric-sql/pglite');
const { createSupabaseWorld, installSupabaseWorld } = await import('./helpers/inMemorySupabaseWorld.js');
const { app } = await import('../server.js');
const { supabase } = await import('../db/supabase.js');
const { hashPassword } = await import('../utils/passwordAuth.js');
const { createCommunicationServices } = await import('../services/communication/communicationServiceFactory.js');
const { CommunicationRepository } = await import('../services/communication/communicationRepository.js');

const FUTURE = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
const GARAGE = '51515151-5151-4515-8515-515151515151';
const DEALERSHIP = '52525252-5252-4525-8525-525252525252';
const VIN = 'OC5HJRNVIN0000001';
const LIVE_VIN = 'OC5HJRNVIN0000002';   // J4: the seller's live listing
const SOLD_VIN = 'OC5HJRNVIN0000003';   // J4: reserved from the seller, then transferred to the buyer
const REVIEW_VIN = 'OC5HJRNVIN0000004'; // J5: the seller-authority subject
const ADMIN_PASSWORD = 'oc5h-admin-correct-horse';
const DAY = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10); // yesterday, UTC

/** OC-5G's registry rows, produced by the migration itself on the real registry DDL (PGlite). */
async function governedRegistryRows() {
  const at = (file) => readFileSync(new URL(`../../database/migrations/${file}`, import.meta.url), 'utf8');
  const ddl = at('20260811131500_communications_2_conversation_core.sql');
  const start = ddl.indexOf('CREATE TABLE IF NOT EXISTS communication_templates (');
  const end = ddl.indexOf(';', ddl.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS idx_communication_template_version_unique')) + 1;
  const db = new PGlite();
  try {
    await db.exec(ddl.slice(start, end));
    await db.exec(at('20261004210000_oc5g_policy_notification_templates.sql').split(/^-- \+migrate Down/m)[0]);
    return {
      communication_templates: (await db.query('SELECT * FROM communication_templates')).rows,
      communication_template_versions: (await db.query('SELECT * FROM communication_template_versions')).rows
        .map((v) => ({ ...v, provider_template_reference: null })),
    };
  } finally { await db.close(); }
}
const event = (type, vin, overrides = {}) => ({
  id: `act-${Math.random().toString(36).slice(2)}`, event_type: type, listing_id: vin, vehicle_reference: vin, tenant_id: null,
  authenticated_user_id: null, pseudonymous_session_key: overrides.session || 'sess-1', exclusion_flags: [], metadata: {},
  occurred_at: `${DAY}T10:00:00.000Z`,
});

// ── The AI label is checked: nothing leaves this process ────────────────────────────────────────
const realFetch = globalThis.fetch;
const escapedCalls = [];
globalThis.fetch = async (url, init) => {
  const target = String(url?.url || url);
  if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(target)) return realFetch(url, init);
  escapedCalls.push(target);
  throw new Error(`OC-5H journeys call no provider or remote service; refused ${target}`);
};

let world; let restoreWorld; let server; let baseUrl;

before(async () => {
  const session = (token, user, role = 'owner') => ({ token, user_id: user, active_role: role, active_organization_id: null, is_valid: true, expires_at: FUTURE });
  const registry = await governedRegistryRows();
  world = createSupabaseWorld({
    users: [
      { id: 'u-owner', name: 'Rudo Owner', role: 'owner', is_verified: true },
      { id: 'u-gadmin', name: 'Garage Admin', role: 'owner', is_verified: true },
      { id: 'u-gmech', name: 'Garage Mechanic', role: 'owner', is_verified: true },
      { id: 'u-dadmin', name: 'Dealership Admin', role: 'owner', is_verified: true },
      { id: 'u-seller', name: 'Private Seller', role: 'owner', is_verified: true },
      { id: 'u-buyer', name: 'Private Buyer', role: 'owner', is_verified: true },
      { id: 'u-padmin', name: 'Platform Reviewer', role: 'admin', is_verified: true, password_hash: await hashPassword(ADMIN_PASSWORD) },
    ],
    // Every session starts with NO organisation: login never picks one (OC-5D).
    user_sessions: [
      ...['owner', 'gadmin', 'gmech', 'dadmin', 'seller', 'buyer'].map((who) => session(`tok-${who}`, `u-${who}`)),
      session('tok-padmin', 'u-padmin', 'admin'),
    ],
    // J4 — the seller's live listing, and a vehicle reserved from them and then transferred away.
    marketplace_activity_events: [
      event('marketplace_listing_opened', LIVE_VIN, { session: 's-1' }),
      event('marketplace_listing_opened', LIVE_VIN, { session: 's-2' }),
      event('marketplace_listing_opened', LIVE_VIN, { session: 's-3' }),
      event('marketplace_compare_added', LIVE_VIN, { session: 's-2' }),
    ],
    vehicle_reservations: [{ id: 'res-1', vin: SOLD_VIN, status: 'active', seller_id: 'u-seller', buyer_id: 'u-buyer', created_at: `${DAY}T11:00:00.000Z` }],
    marketplace_inquiries: [], saved_vehicles: [], intelligence_rollup_runs: [],
    listing_daily_metrics: [], seller_daily_metrics: [], tenant_daily_metrics: [], platform_daily_metrics: [],
    // J5 — the governed registry, and the seller-authority subject.
    ...registry,
    vehicle_seller_authority: [], communication_preferences: [{ id: 'pref-seller', user_id: 'u-seller', tenant_id: null, preferred_channel: 'email', email_enabled: true }],
    message_threads: [], message_participants: [], messages: [], notification_queue: [],
    tenants: [
      { id: GARAGE, name: 'Mbare Motors', type: 'garage', status: 'active' },
      { id: DEALERSHIP, name: 'Avondale Dealers', type: 'dealership', status: 'active' },
    ],
    tenant_users: [
      { tenant_id: GARAGE, user_id: 'u-gadmin', role: 'admin' },
      { tenant_id: GARAGE, user_id: 'u-gmech', role: 'mechanic' },
      { tenant_id: DEALERSHIP, user_id: 'u-dadmin', role: 'admin' },
    ],
    garage_public_profiles: [{ tenant_id: GARAGE, slug: 'mbare-motors', display_name: 'Mbare Motors', publication_status: 'published' }],
    vehicles: [
      { vin: VIN, owner_id: 'u-owner', make: 'Toyota', model: 'Hilux', year: 2019, mileage: 91000, status: 'Available' },
      { vin: LIVE_VIN, owner_id: 'u-seller', current_seller_id: 'u-seller', tenant_id: null, status: 'Available', publication_status: 'published' },
      { vin: SOLD_VIN, owner_id: 'u-buyer', current_seller_id: 'u-buyer', tenant_id: null, status: 'Sold', publication_status: 'published' },
      { vin: REVIEW_VIN, owner_id: 'u-seller', current_seller_id: 'u-seller', tenant_id: null, status: 'Available', publication_status: 'draft' },
    ],
    service_cases: [], service_case_events: [], mechanic_work_orders: [], work_order_assignments: [],
    service_records: [], service_mileage_observations: [], service_record_parts: [], service_record_evidence: [],
    trust_audit_events: [], domain_events: [],
  });
  // The custodian's decision is ONE database function (OC-5A, 20261004160100). This world is not a
  // database, so the function is a DOUBLE here: same guards, same error codes, same state change. Its
  // real behaviour (locking, the audit row, every transition) is proven on PostgreSQL in
  // oc5a-partsentry-service-authority.test.js. This journey proves the chain AROUND it: the route's
  // own custodian check, and that nothing is recorded until the decision exists.
  world.rpcs.set('mechanic_work_order_decide_authorization', (p, { rowsOf }) => {
    const fail = (code, message) => ({ data: null, error: { code, message } });
    if (!['authorized', 'declined', 'revoked'].includes(p.p_decision)) return fail('22023', `${p.p_decision} is not a decision`);
    const order = rowsOf('mechanic_work_orders').find((row) => row.id === p.p_work_order_id);
    if (!order || order.vin !== p.p_vin) return fail('P0002', 'work order not found for this vehicle');
    if (order.mechanic_id && order.mechanic_id === p.p_actor_id) return fail('42501', 'the mechanic assigned to a work order cannot authorize it');
    if (p.p_basis === 'owner' && rowsOf('vehicles').find((v) => v.vin === p.p_vin)?.owner_id !== p.p_actor_id) {
      return fail('42501', 'only the registered owner may decide on the owner\'s basis');
    }
    const previous = order.owner_authorization;
    const allowed = (previous === 'pending' && ['authorized', 'declined'].includes(p.p_decision))
      || (previous === 'authorized' && p.p_decision === 'revoked') || (previous === 'declined' && p.p_decision === 'authorized');
    if (!allowed) return fail('55000', `work order authorization cannot move from ${previous} to ${p.p_decision}`);
    Object.assign(order, { owner_authorization: p.p_decision, owner_authorized_by: p.p_actor_id, owner_authorized_at: new Date().toISOString() });
    return { data: { ...order, previous_owner_authorization: previous }, error: null };
  });
  restoreWorld = installSupabaseWorld(supabase, world);
  await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  restoreWorld?.();
  globalThis.fetch = realFetch;
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function call(method, path, { who, body, headers = {} } = {}) {
  const res = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-bypass-rate-limit': 'true', ...(who ? { 'x-session-token': `tok-${who}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, text };
}
const errorCode = (res) => res.body?.code || res.body?.error?.code || null;

// ── J1 ────────────────────────────────────────────────────────────────────────────────────────────

test('J1 [AI: NONE] an organisation is chosen, never guessed — and only the chosen garage acts as one', async () => {
  // Signed in, with one garage membership: listed, never selected for them.
  const me = await call('GET', '/api/auth/me', { who: 'gmech' });
  assert.equal(me.status, 200, me.text);
  assert.equal(me.body.user.active_tenant_id, null);
  assert.equal(me.body.user.tenant_context, 'none');
  assert.deepEqual(me.body.user.memberships.map((m) => [m.id, m.type, m.role, m.selectable]), [[GARAGE, 'garage', 'mechanic', true]]);

  // The workspace refuses by name until they choose — the server never picks.
  const before = await call('GET', '/api/garage/queue', { who: 'gmech' });
  assert.equal(before.status, 403);
  assert.equal(errorCode(before), 'ACTIVE_TENANT_REQUIRED');

  const chosen = await call('PUT', '/api/auth/active-tenant', { who: 'gmech', body: { tenantId: GARAGE } });
  assert.equal(chosen.status, 200, chosen.text);
  assert.deepEqual(chosen.body.active_tenant, { id: GARAGE, name: 'Mbare Motors', type: 'garage', status: 'active', role: 'mechanic' });
  const after = await call('GET', '/api/garage/queue', { who: 'gmech' });
  assert.equal(after.status, 200, after.text);

  // A header naming another organisation is an assertion about the selection — refused.
  const asserted = await call('GET', '/api/garage/queue', { who: 'gmech', headers: { 'x-tenant-id': DEALERSHIP } });
  assert.equal(asserted.status, 403);

  // A dealership's admin, having chosen their dealership, is not a garage.
  assert.equal((await call('PUT', '/api/auth/active-tenant', { who: 'dadmin', body: { tenantId: DEALERSHIP } })).status, 200);
  const dealer = await call('GET', '/api/garage/queue', { who: 'dadmin' });
  assert.equal(dealer.status, 403);
  assert.equal(errorCode(dealer), 'ACTIVE_TENANT_TYPE');
  // …and cannot choose a garage they do not belong to.
  const notMine = await call('PUT', '/api/auth/active-tenant', { who: 'dadmin', body: { tenantId: GARAGE } });
  assert.equal(notMine.status, 403, notMine.text);
});

// ── J2 ────────────────────────────────────────────────────────────────────────────────────────────

test('J2 [AI: NONE] a customer\'s vehicle is serviced: nothing is recorded until its owner authorizes the work', async () => {
  assert.equal((await call('PUT', '/api/auth/active-tenant', { who: 'gadmin', body: { tenantId: GARAGE } })).status, 200);
  assert.equal((await call('PUT', '/api/auth/active-tenant', { who: 'gmech', body: { tenantId: GARAGE } })).status, 200);

  // The owner asks the garage for a service.
  const requested = await call('POST', '/api/service-cases', { who: 'owner', body: { vin: VIN, garage_tenant_id: GARAGE, summary: 'Brakes squeal at low speed' } });
  assert.equal(requested.status, 201, requested.text);
  const caseId = requested.body.case?.id || requested.body.service_case?.id || requested.body.id;
  assert.ok(caseId, `no case id in ${requested.text}`);

  // The garage accepts and opens a work order: born AWAITING the custodian (OC-5A).
  const accepted = await call('POST', `/api/service-cases/${caseId}/accept`, { who: 'gadmin', body: {} });
  assert.equal(accepted.status, 200, accepted.text);
  const opened = await call('POST', `/api/service-cases/${caseId}/work-order`, { who: 'gadmin', body: {} });
  assert.ok([200, 201].includes(opened.status), opened.text);
  const workOrder = opened.body.work_order || opened.body.workOrder || opened.body;
  assert.ok(workOrder.id, opened.text);
  assert.equal(world.rows('mechanic_work_orders').find((w) => w.id === workOrder.id).owner_authorization, 'pending');

  const assigned = await call('POST', `/api/service-work-orders/${workOrder.id}/assign`, { who: 'gadmin', body: { mechanic_user_id: 'u-gmech' } });
  assert.ok([200, 201].includes(assigned.status), assigned.text);

  // The mechanic cannot record service the owner has not authorized — and nothing is written.
  const early = await call('POST', `/api/service-work-orders/${workOrder.id}/records`, { who: 'gmech', body: { work_performed: 'Front pads replaced' } });
  assert.equal(early.status, 409, early.text);
  assert.equal(world.rows('service_records').length, 0);

  // The owner — and only the owner — authorizes.
  const byMechanic = await call('POST', `/api/vehicles/${VIN}/work-orders/${workOrder.id}/authorization`, { who: 'gmech', body: { decision: 'authorized' } });
  assert.notEqual(byMechanic.status, 200, 'the garage cannot authorize its own work order');
  const authorized = await call('POST', `/api/vehicles/${VIN}/work-orders/${workOrder.id}/authorization`, { who: 'owner', body: { decision: 'authorized', reason: 'Booked in for brakes' } });
  assert.equal(authorized.status, 200, authorized.text);

  // Provenance is derived, never declared: a garage cannot stamp its own work 'evidence_backed'.
  const declared = await call('POST', `/api/service-work-orders/${workOrder.id}/records`, { who: 'gmech', body: { work_performed: 'Front pads replaced', service_authority: 'evidence_backed' } });
  assert.equal(declared.status, 400, declared.text);
  assert.equal(world.rows('service_records').length, 0);

  const recorded = await call('POST', `/api/service-work-orders/${workOrder.id}/records`, { who: 'gmech', body: { work_performed: 'Front pads replaced' } });
  assert.ok([200, 201].includes(recorded.status), recorded.text);
  const [record] = world.rows('service_records');
  assert.equal(record.vin, VIN);
  assert.equal(record.service_authority, 'garage_stated');

  // The owner reads it back through the v1 history contract: the work, never another person's id.
  const history = await call('GET', '/api/service-history/me', { who: 'owner' });
  assert.equal(history.status, 200, history.text);
  const body = JSON.stringify(history.body);
  assert.match(body, /Front pads replaced/);
  for (const other of ['u-gmech', 'u-gadmin']) assert.ok(!body.includes(other), `the owner's history names ${other}`);
});

// ── J4 ────────────────────────────────────────────────────────────────────────────────────────────

test('J4 [AI: NONE] a seller\'s numbers survive a sale — the reservation stays theirs, and the compare stage counts', async () => {
  const rollup = await call('POST', '/api/internal/intelligence/rollup', { who: 'padmin', body: { date: DAY, days: 1 } });
  assert.equal(rollup.status, 200, rollup.text);

  const seller = await call('GET', '/api/marketplace/my-analytics?window=7', { who: 'seller' });
  assert.equal(seller.status, 200, seller.text);
  const metrics = seller.body.metrics;
  assert.ok(metrics, `no metrics in ${seller.text.slice(0, 600)}`);
  assert.equal(metrics.views.value, 3);
  assert.equal(metrics.compare_adds.value, 1, 'the funnel\'s compare stage (rollup@2)');
  assert.equal(metrics.reservations.value, 1, 'the reservation was made WITH this seller — a later transfer does not move it');
  assert.equal(world.rows('seller_daily_metrics').find((r) => r.seller_user_id === 'u-seller').calculation_version, 'rollup@2');

  // The buyer bought the car; they were never its seller for that reservation.
  const buyerRow = world.rows('seller_daily_metrics').find((r) => r.seller_user_id === 'u-buyer');
  assert.equal(buyerRow?.reservations ?? 0, 0, 'rollup@1\'s current-owner attribution credited the BUYER');
});

// ── J5 ────────────────────────────────────────────────────────────────────────────────────────────

test('J5 [AI: NONE] a governed decision reaches the person — through the outbox, the registry, and in-app only', async () => {
  // The reviewer re-proves their password on this session first (O2-X3 step-up).
  const stepUp = await call('POST', '/api/auth/step-up', { who: 'padmin', body: { password: ADMIN_PASSWORD } });
  assert.equal(stepUp.status, 200, stepUp.text);
  const decided = await call('POST', `/api/vehicles/${REVIEW_VIN}/seller-authority/review`, { who: 'padmin', body: { seller_user_id: 'u-seller', decision: 'under_review' } });
  assert.equal(decided.status, 200, decided.text);

  // The route wrote ONE outbox event; the live listener hands exactly this to the orchestrator.
  const outbox = world.rows('domain_events').filter((row) => row.event_type === 'seller.authority.decided');
  assert.equal(outbox.length, 1);
  const [row] = outbox;
  // The listener's services, over THIS world — production's repository is a service client of the
  // same database the route wrote to.
  const { orchestrator } = createCommunicationServices({ repository: new CommunicationRepository({ client: world.client }) });
  await orchestrator.handleDomainEvent({ ...row, event_type: row.event_type, payload: row.payload }, null, row.tenant_id ?? null);

  // Rendered from the GOVERNED row (OC-5G), routed in-app although this seller prefers email (G1).
  const queued = world.rows('notification_queue').filter((n) => n.recipient_user_id === 'u-seller');
  assert.deepEqual(queued.map((n) => n.channel), ['in_app']);
  const message = world.rows('messages').find((m) => m.id === queued[0].message_id);
  assert.equal(message.content_text, `CarUp updated the seller authority for vehicle ${REVIEW_VIN}: Seller authority under CarUp review.`);
  const template = world.rows('communication_templates').find((t) => t.template_key === 'seller_authority_v1');
  assert.equal(message.content_json.template_id, template.id, 'the governed registry rendered it, not the in-code fallback');
});

test('the AI label holds: no journey here reached a provider or any remote service', () => {
  assert.deepEqual(escapedCalls, []);
});
