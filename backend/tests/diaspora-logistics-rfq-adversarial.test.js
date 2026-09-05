/**
 * Trade OS T3 — the adversarial acceptance matrix, over HTTP.
 *
 * These drive the REAL diaspora router + participant auth + logistics service + the reference
 * mirror of the award RPC against an in-memory Supabase, because several of these boundaries live
 * at the HTTP projection (DRAFT offer hiding) or in the RPC (self-award, single-winner atomicity)
 * and a service-level call would not exercise them.
 *
 * The invariants that must never regress:
 *   - a logistics quote is not a booking; an accepted quote is not approved capacity;
 *   - only APPROVED reservations consume container capacity;
 *   - a provider sees a safe projection, never the requester's identity or a private DRAFT;
 *   - commercial eligibility is a business profile, never a spoofable header or a global role.
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.DIASPORA_SUBSCRIPTION_ENFORCEMENT = 'false';

const express = (await import('express')).default;
const diasporaRouter = (await import('../routes/diasporaRoutes.js')).default;
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const { supabase } = await import('../db/supabase.js');
const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const { DIASPORA_RPCS } = await import('./helpers/diasporaRpcReference.js');

const TENANT_P = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; // the logistics provider's own tenant
const TENANT_R = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; // a rival organiser's tenant

function seeded() {
  return createMockSupabase({
    users: [
      { id: 'req-A', name: 'SYNTHETIC Tariro Requester', email: 'tariro@synthetic.test', phone: '+263700000001', role: 'owner', is_verified: true },
      { id: 'req-B', name: 'SYNTHETIC Other Requester', email: 'other@synthetic.test', role: 'owner', is_verified: true },
      { id: 'prov-1', name: 'SYNTHETIC Hikari Logistics', role: 'owner', is_verified: true },
      { id: 'prov-2', name: 'SYNTHETIC Rival Logistics', role: 'owner', is_verified: true },
      { id: 'dealer-1', name: 'SYNTHETIC Ordinary Dealer', role: 'dealer', is_verified: true },
      { id: 'padmin-1', name: 'SYNTHETIC Platform Admin', role: 'admin', is_verified: true },
    ],
    tenants: [
      { id: TENANT_P, name: 'SYNTHETIC Hikari Logistics', type: 'import', status: 'active' },
      { id: TENANT_R, name: 'SYNTHETIC Rival Freight', type: 'import', status: 'active' },
    ],
    tenant_users: [
      { tenant_id: TENANT_P, user_id: 'prov-1', role: 'admin' },
      { tenant_id: TENANT_R, user_id: 'prov-2', role: 'admin' },
    ],
    user_registration_profiles: [
      { user_id: 'prov-1', account_kind: 'business', business_type: 'logistics_provider', organization_name: 'SYNTHETIC Hikari Logistics', country_of_residence: 'Japan', city: 'Yokohama' },
      { user_id: 'prov-2', account_kind: 'business', business_type: 'logistics_provider', organization_name: 'SYNTHETIC Rival Freight', country_of_residence: 'Japan', city: 'Kobe' },
      // A dealer is a commercial account, but NOT a logistics business.
      { user_id: 'dealer-1', account_kind: 'business', business_type: 'dealer', organization_name: 'SYNTHETIC Ordinary Dealer', country_of_residence: 'Japan', city: 'Tokyo' },
      // req-A IS provider-eligible on purpose: the self-quote test below must be refused by the
      // "cannot quote your own shipping request" guard, not bounce off eligibility first.
      { user_id: 'req-A', account_kind: 'business', business_type: 'logistics_provider', organization_name: 'SYNTHETIC Tariro Own-Truck Logistics', country_of_residence: 'United Kingdom', city: 'London' },
    ],
    diaspora_logistics_requests: [
      { id: 'ship-open', tenant_id: null, requester_id: 'req-A', created_by: 'req-A', origin_country: 'Japan', origin_city: 'Yokohama', destination_country: 'Zimbabwe', destination_city: 'Harare', service_preference: 'flexible', status: 'OPEN_FOR_QUOTES', accepted_quote_id: null, metadata: {}, deleted_at: null },
      { id: 'ship-draft', tenant_id: null, requester_id: 'req-A', created_by: 'req-A', origin_country: 'Japan', origin_city: 'Yokohama', destination_country: 'Zimbabwe', destination_city: 'Harare', service_preference: 'flexible', status: 'DRAFT', accepted_quote_id: null, metadata: {}, deleted_at: null },
    ],
    diaspora_logistics_request_items: [
      { id: 'item-open', logistics_request_id: 'ship-open', line_number: 1, cargo_category: 'boxes', description: 'Household cartons', quantity: 12, estimated_volume_cbm: 2, estimated_weight_kg: 200, measurement_basis: 'PROVIDED', linked_vehicle_vin: null, deleted_at: null },
      { id: 'item-draft', logistics_request_id: 'ship-draft', line_number: 1, cargo_category: 'boxes', description: 'Private draft cargo', quantity: 3, estimated_volume_cbm: 1, estimated_weight_kg: 60, measurement_basis: 'PROVIDED', linked_vehicle_vin: null, deleted_at: null },
    ],
    diaspora_logistics_quotes: [],
    diaspora_container_shipments: [
      // Route-compatible, open, operated by prov-1.
      { id: 'cont-ok', tenant_id: TENANT_P, coordinator_id: 'prov-1', status: 'BOOKING_OPEN', origin_country: 'Japan', origin_city: 'Yokohama', destination_country: 'Zimbabwe', destination_city: 'Harare', container_type: '40HC', total_capacity_volume: 60, used_capacity_volume: 0, available_capacity_volume: 60, metadata: {} },
      // Same operator, but the route does not match the request.
      { id: 'cont-route', tenant_id: TENANT_P, coordinator_id: 'prov-1', status: 'BOOKING_OPEN', origin_country: 'Germany', origin_city: 'Hamburg', destination_country: 'Zimbabwe', destination_city: 'Harare', container_type: '40HC', total_capacity_volume: 60, used_capacity_volume: 0, available_capacity_volume: 60, metadata: {} },
      // Same operator and route, but no longer accepting bookings.
      { id: 'cont-closed', tenant_id: TENANT_P, coordinator_id: 'prov-1', status: 'BOOKING_CLOSED', origin_country: 'Japan', origin_city: 'Yokohama', destination_country: 'Zimbabwe', destination_city: 'Harare', container_type: '40HC', total_capacity_volume: 60, used_capacity_volume: 0, available_capacity_volume: 60, metadata: {} },
      // Another organiser's sailing entirely.
      { id: 'cont-foreign', tenant_id: TENANT_R, coordinator_id: 'prov-2', status: 'BOOKING_OPEN', origin_country: 'Japan', origin_city: 'Yokohama', destination_country: 'Zimbabwe', destination_city: 'Harare', container_type: '40HC', total_capacity_volume: 60, used_capacity_volume: 0, available_capacity_volume: 60, metadata: {} },
    ],
    diaspora_cargo_reservations: [],
    diaspora_import_audit_log: [],
    diaspora_import_orders: [],
    diaspora_import_order_participants: [],
  }, { rpc: DIASPORA_RPCS });
}

let server; let baseUrl; let mock;
function installMock() {
  mock = seeded();
  Object.defineProperty(supabase, 'from', { configurable: true, writable: true, value: (t) => mock.from(t) });
  Object.defineProperty(supabase, 'rpc', { configurable: true, writable: true, value: (n, p) => mock.rpc(n, p) });
}

before(async () => {
  installMock();
  const app = express();
  app.use(express.json());
  app.use('/api/diaspora', diasporaRouter);
  app.use(errorHandler);
  await new Promise((r) => { server = http.createServer(app); server.listen(0, '127.0.0.1', r); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise((r) => server.close(r)); });
beforeEach(installMock);

async function call(method, path, { userId, role, tenantId, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (userId) headers['x-user-id'] = userId;
  if (role) headers['x-stakeholder-role'] = role;
  if (tenantId) headers['x-tenant-id'] = tenantId;
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// The T3 logistics routes are mounted at the diaspora root; the hardened container kernel keeps
// its own /container-marketplace prefix in the same router.
const T3 = '/api/diaspora';
const BASE = '/api/diaspora/container-marketplace';
const OFFER = { service_mode: 'lcl', total_amount: 800, currency: 'USD', freight_amount: 700 };

/** prov-1 submits a real offer on the open request. */
async function submitOfferAs(userId, tenantId, extra = {}) {
  return call('POST', `${T3}/logistics-opportunities/ship-open/quotes`, {
    userId, tenantId, body: { ...OFFER, submit: true, ...extra },
  });
}

// ── discovery / projection ─────────────────────────────────────────────────────────────────────

test('ADVERSARIAL: a provider cannot read the requester’s private DRAFT shipping request', async () => {
  // Not in the marketplace…
  const list = await call('GET', `${T3}/logistics-opportunities`, { userId: 'prov-1', tenantId: TENANT_P });
  assert.equal(list.status, 200);
  // requestReference truncates the id to 8 chars, so 'ship-draft' renders as 'SHIP-SHIPDRAF'.
  // The original filter searched for 'SHIPDRAFT' (9 chars) — a substring the reference can never
  // contain, making the assertion pass unconditionally. Verified falsifiable: 'SHIPDRAF' matches
  // the draft's real reference when the DRAFT filter is removed.
  assert.deepEqual(list.body.data.map((row) => row.reference).filter((ref) => ref.includes('SHIPDRAF')), []);
  assert.ok(!JSON.stringify(list.body).includes('Private draft cargo'));

  // …and not by naming it directly.
  const direct = await call('GET', `${T3}/logistics-opportunities/ship-draft`, { userId: 'prov-1', tenantId: TENANT_P });
  assert.equal(direct.status, 404, 'an unpublished request must not even confirm its own existence');

  // …and not through the requester-side read either.
  const owner = await call('GET', `${T3}/logistics-requests/ship-draft`, { userId: 'prov-1', tenantId: TENANT_P });
  assert.equal(owner.status, 403);
});

test('ADVERSARIAL: the opportunity projection carries no requester identity or contact facts', async () => {
  const { status, body } = await call('GET', `${T3}/logistics-opportunities/ship-open`, { userId: 'prov-1', tenantId: TENANT_P });
  assert.equal(status, 200);
  const serialized = JSON.stringify(body);
  for (const secret of ['req-A', 'tariro@synthetic.test', '+263700000001', 'SYNTHETIC Tariro Requester']) {
    assert.ok(!serialized.includes(secret), `provider projection leaked ${secret}`);
  }
  assert.equal(body.data.requester_id, undefined);
  assert.equal(body.data.tenant_id, undefined);
});

// ── eligibility ────────────────────────────────────────────────────────────────────────────────

test('ADVERSARIAL: a dealer is a commercial account but cannot submit a logistics offer', async () => {
  const { status } = await submitOfferAs('dealer-1', undefined);
  assert.equal(status, 403, 'a global dealer role is not logistics-provider eligibility');
});

test('ADVERSARIAL: spoofed role and tenant headers do not manufacture provider eligibility', async () => {
  const spoofRole = await call('POST', `${T3}/logistics-opportunities/ship-open/quotes`, {
    userId: 'dealer-1', role: 'admin', body: { ...OFFER, submit: true },
  });
  assert.ok([401, 403].includes(spoofRole.status), `expected refusal, got ${spoofRole.status}`);

  const spoofTenant = await call('POST', `${T3}/logistics-opportunities/ship-open/quotes`, {
    userId: 'dealer-1', tenantId: TENANT_P, body: { ...OFFER, submit: true },
  });
  assert.ok([401, 403].includes(spoofTenant.status), `expected refusal, got ${spoofTenant.status}`);
});

test('ADVERSARIAL: a requester cannot quote their own shipping request', async () => {
  const { status } = await call('POST', `${T3}/logistics-opportunities/ship-open/quotes`, {
    userId: 'req-A', body: { ...OFFER, submit: true },
  });
  assert.equal(status, 403);
});

// ── container attachment ───────────────────────────────────────────────────────────────────────

test('ADVERSARIAL: a provider cannot attach another organiser’s sailing, a mismatched route, or a closed sailing', async () => {
  const foreign = await submitOfferAs('prov-1', TENANT_P, { compatible_container_id: 'cont-foreign' });
  assert.equal(foreign.status, 403, 'another organiser’s sailing');

  const route = await submitOfferAs('prov-1', TENANT_P, { compatible_container_id: 'cont-route' });
  assert.equal(route.status, 400, 'route mismatch');

  const closed = await submitOfferAs('prov-1', TENANT_P, { compatible_container_id: 'cont-closed' });
  assert.equal(closed.status, 400, 'a sailing that is no longer accepting bookings');

  // Nothing partial was written by any of the three refusals.
  assert.equal(mock._tables.diaspora_logistics_quotes.length, 0);
});

// ── offer privacy and ownership ────────────────────────────────────────────────────────────────

test('ADVERSARIAL: a provider’s DRAFT offer is invisible to the requester, and the requester cannot edit any offer', async () => {
  const draft = await call('POST', `${T3}/logistics-opportunities/ship-open/quotes`, {
    userId: 'prov-1', tenantId: TENANT_P, body: { ...OFFER, total_amount: 1234 },
  });
  assert.equal(draft.status, 201);

  const seen = await call('GET', `${T3}/logistics-requests/ship-open`, { userId: 'req-A' });
  assert.equal(seen.status, 200);
  assert.deepEqual(seen.body.data.quotes, [], 'a draft price must not reach the requester before submission');
  assert.ok(!JSON.stringify(seen.body).includes('1234'));

  const edit = await call('PATCH', `${T3}/logistics-quotes/${draft.body.data.id}`, {
    userId: 'req-A', body: { total_amount: 1 },
  });
  assert.equal(edit.status, 403, 'the requester must never be able to rewrite a provider’s offer');

  const rival = await call('PATCH', `${T3}/logistics-quotes/${draft.body.data.id}`, {
    userId: 'prov-2', tenantId: TENANT_R, body: { total_amount: 1 },
  });
  assert.equal(rival.status, 403, 'nor may a competing provider');
});

// ── award ──────────────────────────────────────────────────────────────────────────────────────

test('ADVERSARIAL: a provider cannot award its own offer, and a stranger cannot award at all', async () => {
  const offer = await submitOfferAs('prov-1', TENANT_P);
  assert.equal(offer.status, 201);

  const selfAward = await call('POST', `${T3}/logistics-requests/ship-open/accept-quote`, {
    userId: 'prov-1', tenantId: TENANT_P, body: { quoteId: offer.body.data.id },
  });
  assert.ok([400, 403].includes(selfAward.status), `expected refusal, got ${selfAward.status}`);

  const stranger = await call('POST', `${T3}/logistics-requests/ship-open/accept-quote`, {
    userId: 'req-B', body: { quoteId: offer.body.data.id },
  });
  assert.ok([400, 403].includes(stranger.status), `expected refusal, got ${stranger.status}`);

  const request = mock._tables.diaspora_logistics_requests.find((row) => row.id === 'ship-open');
  assert.equal(request.status, 'OPEN_FOR_QUOTES');
  assert.equal(request.accepted_quote_id, null);
});

test('ADVERSARIAL: acceptance chooses exactly ONE offer atomically; every other submitted offer is rejected', async () => {
  const winner = await submitOfferAs('prov-1', TENANT_P);
  const loser = await submitOfferAs('prov-2', TENANT_R, { total_amount: 900 });
  assert.equal(winner.status, 201);
  assert.equal(loser.status, 201);

  const award = await call('POST', `${T3}/logistics-requests/ship-open/accept-quote`, {
    userId: 'req-A', body: { quoteId: winner.body.data.id },
  });
  assert.equal(award.status, 200);

  const quotes = mock._tables.diaspora_logistics_quotes;
  assert.equal(quotes.filter((row) => row.status === 'ACCEPTED').length, 1);
  assert.equal(quotes.find((row) => row.id === winner.body.data.id).status, 'ACCEPTED');
  assert.equal(quotes.find((row) => row.id === loser.body.data.id).status, 'REJECTED');

  // A second award of a DIFFERENT offer cannot displace the first.
  const second = await call('POST', `${T3}/logistics-requests/ship-open/accept-quote`, {
    userId: 'req-A', body: { quoteId: loser.body.data.id },
  });
  assert.ok([400, 409].includes(second.status), `expected refusal, got ${second.status}`);
  assert.equal(quotes.filter((row) => row.status === 'ACCEPTED').length, 1);
});

// ── quote ≠ booking ≠ approved capacity ────────────────────────────────────────────────────────

test('TRUTH: submitting an offer creates NO container reservation and consumes NO capacity', async () => {
  const offer = await submitOfferAs('prov-1', TENANT_P, { compatible_container_id: 'cont-ok' });
  assert.equal(offer.status, 201);
  assert.equal(mock._tables.diaspora_cargo_reservations.length, 0, 'a quote is not a booking');

  const container = mock._tables.diaspora_container_shipments.find((row) => row.id === 'cont-ok');
  assert.equal(container.used_capacity_volume, 0);
  assert.equal(container.available_capacity_volume, 60);
});

test('TRUTH: selecting a shared-container offer creates at most ONE REQUESTED reservation, which consumes no capacity until approved', async () => {
  const offer = await submitOfferAs('prov-1', TENANT_P, { compatible_container_id: 'cont-ok' });
  await call('POST', `${T3}/logistics-requests/ship-open/accept-quote`, {
    userId: 'req-A', body: { quoteId: offer.body.data.id },
  });

  // An award alone still books nothing.
  assert.equal(mock._tables.diaspora_cargo_reservations.length, 0, 'an accepted quote is not approved capacity');

  const first = await call('POST', `${T3}/logistics-requests/ship-open/request-space`, { userId: 'req-A' });
  assert.equal(first.status, 200);
  assert.equal(first.body.data.reservation.reservation_status, 'REQUESTED');
  assert.equal(mock._tables.diaspora_cargo_reservations.length, 1);

  // Retrying is idempotent — a double-click must not book the same cargo twice.
  const retry = await call('POST', `${T3}/logistics-requests/ship-open/request-space`, { userId: 'req-A' });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.data.idempotentReplay, true);
  assert.equal(mock._tables.diaspora_cargo_reservations.length, 1);

  // A REQUESTED reservation consumes nothing; only the organiser's approval does.
  const container = mock._tables.diaspora_container_shipments.find((row) => row.id === 'cont-ok');
  assert.equal(container.used_capacity_volume, 0);
  assert.equal(container.available_capacity_volume, 60);
});

test('ADVERSARIAL: the requester cannot approve their own container space — organiser authority is untouched', async () => {
  const offer = await submitOfferAs('prov-1', TENANT_P, { compatible_container_id: 'cont-ok' });
  await call('POST', `${T3}/logistics-requests/ship-open/accept-quote`, {
    userId: 'req-A', body: { quoteId: offer.body.data.id },
  });
  const space = await call('POST', `${T3}/logistics-requests/ship-open/request-space`, { userId: 'req-A' });
  const reservationId = space.body.data.reservation.id;

  const selfApprove = await call('POST', `${BASE}/reservations/${reservationId}/approve`, { userId: 'req-A' });
  assert.equal(selfApprove.status, 403);

  const rivalApprove = await call('POST', `${BASE}/reservations/${reservationId}/approve`, { userId: 'prov-2', tenantId: TENANT_R });
  assert.equal(rivalApprove.status, 403, 'another organiser cannot approve on this sailing either');

  const reservation = mock._tables.diaspora_cargo_reservations.find((row) => row.id === reservationId);
  assert.equal(reservation.reservation_status, 'REQUESTED');
});

test('ADVERSARIAL: anonymous callers reach none of the T3 surfaces', async () => {
  for (const [method, path] of [
    ['GET', `${T3}/logistics-requests/mine`],
    ['POST', `${T3}/logistics-requests`],
    ['GET', `${T3}/logistics-opportunities`],
    ['GET', `${T3}/logistics-requests/ship-open`],
    ['POST', `${T3}/logistics-opportunities/ship-open/quotes`],
    ['POST', `${T3}/logistics-requests/ship-open/accept-quote`],
    ['POST', `${T3}/logistics-requests/ship-open/request-space`],
  ]) {
    const { status } = await call(method, path, { body: method === 'POST' ? {} : undefined });
    assert.equal(status, 401, `${method} ${path} was reachable anonymously`);
  }
});

// ── Post-closure audit fixes — each of these pins a defect the adversarial workflow confirmed ──

test('ADVERSARIAL: a PRIVILEGED provider awarding its own offer is refused by SELF_AWARD itself', async () => {
  // The earlier self-award case was refused at the OWNERSHIP gate (the provider was not the
  // requester), so the deeper SELF_AWARD guard was never executed by any HTTP test. A privileged
  // actor passes ownership, which makes this the one path that genuinely reaches it.
  const offer = await call('POST', `${T3}/logistics-opportunities/ship-open/quotes`, {
    userId: 'padmin-1', body: { ...OFFER, submit: true },
  });
  assert.equal(offer.status, 201, 'privileged oversight may quote');
  const award = await call('POST', `${T3}/logistics-requests/ship-open/accept-quote`, {
    userId: 'padmin-1', body: { quoteId: offer.body.data.id },
  });
  assert.ok([400, 403].includes(award.status), `expected refusal, got ${award.status}`);
  assert.match(JSON.stringify(award.body), /own offer|SELF_AWARD/i);
});

test('ADVERSARIAL: the self-quote refusal is the OWN-REQUEST guard, not an eligibility accident', async () => {
  // req-A is seeded WITH a logistics_provider profile, so eligibility passes and the refusal
  // below can only come from "cannot quote your own shipping request".
  const { status, body } = await call('POST', `${T3}/logistics-opportunities/ship-open/quotes`, {
    userId: 'req-A', body: { ...OFFER, submit: true },
  });
  assert.equal(status, 403);
  assert.match(JSON.stringify(body), /own shipping request/i);
});

test('PRIVACY: withdrawing a never-submitted DRAFT does not disclose it to the requester', async () => {
  const draft = await call('POST', `${T3}/logistics-opportunities/ship-open/quotes`, {
    userId: 'prov-1', tenantId: TENANT_P, body: { ...OFFER, total_amount: 4321 },
  });
  assert.equal(draft.status, 201);
  const withdrawn = await call('POST', `${T3}/logistics-quotes/${draft.body.data.id}/withdraw`, {
    userId: 'prov-1', tenantId: TENANT_P,
  });
  assert.equal(withdrawn.status, 200);

  // Before the allow-list, this exact read leaked the retracted draft's full terms: the filter
  // excluded only status==='DRAFT', and withdrawal had just moved the row past it.
  const seen = await call('GET', `${T3}/logistics-requests/ship-open`, { userId: 'req-A' });
  assert.equal(seen.status, 200);
  assert.deepEqual(seen.body.data.quotes, []);
  assert.ok(!JSON.stringify(seen.body).includes('4321'), 'the withdrawn draft price crossed the boundary');
});

test('PRIVACY: the requester quote projection is an allow-list — no tenant id, metadata or actor ids', async () => {
  const offer = await submitOfferAs('prov-1', TENANT_P);
  assert.equal(offer.status, 201);
  const seen = await call('GET', `${T3}/logistics-requests/ship-open`, { userId: 'req-A' });
  assert.equal(seen.status, 200);
  assert.equal(seen.body.data.quotes.length, 1);
  const projected = seen.body.data.quotes[0];
  for (const forbidden of ['provider_tenant_id', 'metadata', 'created_by', 'updated_by', 'deleted_at']) {
    assert.ok(!(forbidden in projected), `requester projection carries ${forbidden}`);
  }
  assert.equal(projected.total_amount, OFFER.total_amount);
});

test('TRUTH: cargo that rounds to 0.000 CBM is refused BEFORE any request header exists', async () => {
  const { status, body } = await call('POST', `${T3}/logistics-requests`, {
    userId: 'req-A',
    body: {
      origin_country: 'Japan', destination_country: 'Zimbabwe',
      items: [{ cargo_category: 'parts', description: 'One tiny bolt', quantity: 1, dimension_unit: 'cm', length_value: 1, width_value: 1, height_value: 1 }],
    },
  });
  assert.equal(status, 400);
  assert.match(JSON.stringify(body), /0\.000 CBM/);
  // The point of the preflight: the refusal wrote NOTHING — no header, no items. Asserted on the
  // table itself, because the seeded fixture legitimately contains its own draft.
  assert.equal(mock._tables.diaspora_logistics_requests.length, 2, 'a request header was written before the refusal');
  assert.equal(mock._tables.diaspora_logistics_request_items.some((row) => /tiny bolt/i.test(row.description || '')), false);
});

test('TRUTH: an unknown-volume award is a DEFERRAL, not a dead end — confirm-measurements unblocks booking', async () => {
  // Publish with volume UNKNOWN (the wizard's default), collect a shared-container offer, award it.
  const created = await call('POST', `${T3}/logistics-requests`, {
    userId: 'req-B',
    body: {
      origin_country: 'Japan', destination_country: 'Zimbabwe',
      items: [{ cargo_category: 'household', description: 'Boxes, size not yet known', quantity: 6 }],
    },
  });
  assert.equal(created.status, 201);
  const requestId = created.body.data.id;
  assert.equal((await call('POST', `${T3}/logistics-requests/${requestId}/publish`, { userId: 'req-B' })).status, 200);
  const offer = await call('POST', `${T3}/logistics-opportunities/${requestId}/quotes`, {
    userId: 'prov-1', tenantId: TENANT_P, body: { ...OFFER, submit: true, compatible_container_id: 'cont-ok' },
  });
  assert.equal(offer.status, 201);
  assert.equal((await call('POST', `${T3}/logistics-requests/${requestId}/accept-quote`, {
    userId: 'req-B', body: { quoteId: offer.body.data.id },
  })).status, 200);

  // The dead end the audit confirmed: booking refused for a volume no surface allowed recording.
  const blocked = await call('POST', `${T3}/logistics-requests/${requestId}/request-space`, { userId: 'req-B' });
  assert.equal(blocked.status, 400);
  assert.match(JSON.stringify(blocked.body), /estimated volume/i);

  const itemId = created.body.data.items[0].id;
  // A stranger cannot confirm someone else's measurements…
  assert.equal((await call('POST', `${T3}/logistics-requests/${requestId}/confirm-measurements`, {
    userId: 'req-A', body: { items: [{ item_id: itemId, estimated_volume_cbm: 2 }] },
  })).status, 403);
  // …and the requester can only FILL, with a real positive volume.
  assert.equal((await call('POST', `${T3}/logistics-requests/${requestId}/confirm-measurements`, {
    userId: 'req-B', body: { items: [{ item_id: itemId, estimated_volume_cbm: 0 }] },
  })).status, 400);
  const confirmed = await call('POST', `${T3}/logistics-requests/${requestId}/confirm-measurements`, {
    userId: 'req-B', body: { items: [{ item_id: itemId, estimated_volume_cbm: 2.5, estimated_weight_kg: 120 }] },
  });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.data.items[0].estimated_volume_cbm, 2.5);
  assert.equal(confirmed.body.data.items[0].measurement_basis, 'PROVIDED');

  // Fill-only: a second confirmation of the SAME item is refused — stated facts stay stated.
  assert.equal((await call('POST', `${T3}/logistics-requests/${requestId}/confirm-measurements`, {
    userId: 'req-B', body: { items: [{ item_id: itemId, estimated_volume_cbm: 9 }] },
  })).status, 400);

  // The promised deferral now completes: booking proceeds, REQUESTED as always.
  const space = await call('POST', `${T3}/logistics-requests/${requestId}/request-space`, { userId: 'req-B' });
  assert.equal(space.status, 200);
  assert.equal(space.body.data.reservation.reservation_status, 'REQUESTED');
});

test('TRUTH: clearing a charge on a DRAFT offer clears it — the stored value must not resurrect', async () => {
  const draft = await call('POST', `${T3}/logistics-opportunities/ship-open/quotes`, {
    userId: 'prov-1', tenantId: TENANT_P, body: { ...OFFER, freight_amount: 700, handling_amount: 55 },
  });
  assert.equal(draft.status, 201);
  const patched = await call('PATCH', `${T3}/logistics-quotes/${draft.body.data.id}`, {
    userId: 'prov-1', tenantId: TENANT_P, body: { freight_amount: null, total_amount: 800 },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.data.freight_amount, null, 'cleared freight resurrected from the stored row');
  assert.equal(patched.body.data.handling_amount, 55, 'an UNSENT key must keep its previous value');
});

test('ADVERSARIAL: anonymous callers reach NONE of the T3 surfaces — the full route table', async () => {
  // The earlier loop covered 7 of the registered T3 routes; this is all of them, so a newly added
  // route cannot ship unauthenticated by being forgotten here.
  const routes = [
    ['GET', `${T3}/logistics-requests/mine`],
    ['POST', `${T3}/logistics-requests`],
    ['GET', `${T3}/logistics-opportunities`],
    ['GET', `${T3}/logistics-opportunities/ship-open`],
    ['POST', `${T3}/logistics-opportunities/ship-open/quotes`],
    ['GET', `${T3}/logistics-quotes/mine`],
    ['PATCH', `${T3}/logistics-quotes/some-id`],
    ['POST', `${T3}/logistics-quotes/some-id/submit`],
    ['POST', `${T3}/logistics-quotes/some-id/withdraw`],
    ['GET', `${T3}/logistics-requests/ship-open`],
    ['PATCH', `${T3}/logistics-requests/ship-open`],
    ['POST', `${T3}/logistics-requests/ship-open/publish`],
    ['POST', `${T3}/logistics-requests/ship-open/accept-quote`],
    ['GET', `${T3}/logistics-requests/ship-open/sailing-matches`],
    ['POST', `${T3}/logistics-requests/ship-open/confirm-measurements`],
    ['POST', `${T3}/logistics-requests/ship-open/request-space`],
    ['POST', `${T3}/logistics-requests/ship-open/conversation`],
  ];
  for (const [method, path] of routes) {
    const { status } = await call(method, path, { body: method === 'GET' ? undefined : {} });
    assert.equal(status, 401, `${method} ${path} was reachable anonymously`);
  }
});
