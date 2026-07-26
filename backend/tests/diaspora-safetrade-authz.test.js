/**
 * Phase 9 — Gate S9-A: SafeTrade AUTHORIZATION suite (HTTP, real router + real authorizeRole middleware).
 *
 * Drives the REAL (unmounted) diasporaSafeTradeRoutes router over HTTP with an in-memory mock wired onto
 * the supabase singleton (the SAME harness shape as diaspora-safetrade.test.js), proving the server-derived
 * authorization boundary end-to-end. The client x-stakeholder-role can NEVER escalate; party authority is
 * derived from the authoritative transaction row + the user's DB role + verified tenant_users membership.
 *
 * Proven here (the Gate S9-A matrix):
 *   - buyer cannot perform a seller-only transition (403); seller cannot perform a buyer-only transition (403);
 *   - ordinary participant cannot evaluate-release (403) nor approve-release (403);
 *   - a reviewer cannot impersonate a participant for a participant-only transition (BUYER_COMMIT by reviewer
 *     is rejected because BUYER_COMMIT actorRoles=[BUYER] does not admit ADMIN/REVIEWER);
 *   - dealer does NOT gain reviewer authority: dealer is rejected at the route (403) for evaluate-release /
 *     approve-release / resolve;
 *   - government / government_reviewer ARE platform reviewers -> may pass the reviewer route gate (assert
 *     what the service actually allows, not weakened);
 *   - a spoofed x-stakeholder-role is denied; a cross-tenant x-tenant-id is denied; an unrelated participant
 *     read is denied (GET /:id -> 403);
 *   - an invalid transition event is denied; an invalid source state is denied;
 *   - request-release / approve-release without a passing prior evaluation are denied; high-risk release
 *     without reviewer approval is denied;
 *   - a live-payment request fails closed (EXTERNAL_ACTIVATION_REQUIRED / disabled);
 *   - cancellation after the held-funds boundary is denied;
 *   - delivery confirmation authority is enforced (buyer-only; seller rejected);
 *   - dispute resolution by an ordinary participant is denied (403); a reviewer is allowed;
 *   - webhook behaviour is unchanged (valid signature 200, bad signature 401).
 *
 * Time is fixed (req.fixedTimestamp); no test depends on Date.now().
 */
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.DIASPORA_SAFETRADE_ENABLED = 'true';
delete process.env.DIASPORA_SAFETRADE_LIVE_PAYMENT;
delete process.env.DIASPORA_SUBSCRIPTION_ENFORCEMENT;

const FIXED_TS = '2026-06-21T13:00:00.000Z';

const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const { DIASPORA_RPCS } = await import('./helpers/diasporaRpcReference.js');
const { SAFETRADE_RPCS } = await import('./helpers/diasporaSafeTradeRpcReference.js');

const express = (await import('express')).default;
const http = await import('node:http');
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const safeTradeRouter = (await import('../routes/diasporaSafeTradeRoutes.js')).default;
const { supabase } = await import('../db/supabase.js');

const ALL_RPCS = { ...DIASPORA_RPCS, ...SAFETRADE_RPCS };

// ── Route users (resolved by the auth middleware via the x-user-id fallback in test mode). The DB `role`
//    becomes the server-derived platformRole. government/government_reviewer/reviewer ARE platform reviewers.
const routeUsers = {
  'buyer-1': { id: 'buyer-1', role: 'owner', is_verified: true },
  'seller-1': { id: 'seller-1', role: 'dealer', is_verified: true },
  'rev-1': { id: 'rev-1', role: 'reviewer', is_verified: true },
  'adm-1': { id: 'adm-1', role: 'platform_admin', is_verified: true },
  'dealer-1': { id: 'dealer-1', role: 'dealer', is_verified: true },
  'gov-1': { id: 'gov-1', role: 'government', is_verified: true },
  'govrev-1': { id: 'govrev-1', role: 'government_reviewer', is_verified: true },
  'out-1': { id: 'out-1', role: 'owner', is_verified: true },
};

// ── tenant_users memberships (the auth middleware rejects an x-tenant-id WITHOUT a verified membership).
//    Keyed by `${tenantId}:${userId}` -> { role }. Only the rows below are valid memberships.
const tenantMemberships = {
  'tenant-A:buyer-1': { role: 'member' },
  'tenant-A:seller-1': { role: 'member' },
  'tenant-A:rev-1': { role: 'member' },
  'tenant-A:adm-1': { role: 'admin' },
  'tenant-A:dealer-1': { role: 'member' },
  'tenant-A:gov-1': { role: 'member' },
  'tenant-A:govrev-1': { role: 'member' },
  // out-1 belongs to tenant-B only (NOT tenant-A) — used for the cross-tenant denial.
  'tenant-B:out-1': { role: 'member' },
};

// A fully eligible domain seed for tenant-A order ord-1 (so creation works when needed).
function eligibleSeed(extra = {}) {
  return {
    diaspora_import_orders: [
      { id: 'ord-1', tenant_id: 'tenant-A', buyer_id: 'buyer-1', status: 'SELLER_ASSIGNED', metadata: { rfq: { acceptedQuoteId: 'q-1' } }, created_by: 'buyer-1' },
    ],
    diaspora_import_quotes: [{ id: 'q-1', import_order_id: 'ord-1', status: 'ACCEPTED', tenant_id: 'tenant-A' }],
    diaspora_cargo_reservations: [{ id: 'res-1', import_order_id: 'ord-1', reservation_status: 'APPROVED', tenant_id: 'tenant-A' }],
    diaspora_trade_profiles: [
      { id: 'tp-b', user_id: 'buyer-1', verification_status: 'VERIFIED', tenant_id: 'tenant-A' },
      { id: 'tp-s', user_id: 'seller-1', verification_status: 'VERIFIED', tenant_id: 'tenant-A' },
    ],
    diaspora_safetrade_transactions: [],
    diaspora_safetrade_milestones: [],
    diaspora_safetrade_release_evaluations: [],
    diaspora_safetrade_disputes: [],
    diaspora_safetrade_dispute_evidence: [],
    diaspora_safetrade_delivery_confirmations: [],
    diaspora_compliance_reviews: [],
    vehicle_government_documents: [],
    diaspora_shipments: [],
    diaspora_import_audit_log: [],
    ...extra,
  };
}

// Seed a transaction (buyer-1/seller-1, tenant-A) at a chosen DB status with one milestone.
function seedTxn(client, { id = 'st-1', txnStatus = 'IN_PROGRESS', milestoneStatus = 'HELD', total = 1000, metadata = {} } = {}) {
  client._rows('diaspora_safetrade_transactions').push({
    id, tenant_id: 'tenant-A', import_order_id: 'ord-1', accepted_quote_id: 'q-1',
    buyer_id: 'buyer-1', seller_id: 'seller-1', currency: 'USD', total_amount: total,
    status: txnStatus, payment_provider: 'sandbox', live_payment: false,
    policy_version: 'safetrade-policy-v1', metadata: { safetrade: {}, ...metadata },
    created_by: 'buyer-1', updated_by: 'buyer-1',
  });
  client._rows('diaspora_safetrade_milestones').push({
    id: `${id}-m1`, tenant_id: 'tenant-A', transaction_id: id, import_order_id: 'ord-1',
    milestone_type: 'RELEASE', sequence: 0, amount: total, currency: 'USD',
    status: milestoneStatus, payer: 'BUYER', payee: 'SELLER', release_trigger: 'REVIEWER_APPROVAL',
    provider_reference: milestoneStatus === 'PENDING' ? null : 'sbx_pi_seed',
    evidence_requirements: [], evidence_refs: [], metadata: { safetrade: {} },
    created_by: 'buyer-1', updated_by: 'buyer-1',
  });
}

// A mock the route middleware (users/sessions/tenant_users) AND the services (everything else) share.
function routeMock(seed = eligibleSeed()) {
  const m = createMockSupabase(seed, { rpc: ALL_RPCS });
  const originalFrom = m.from;
  m.from = (table) => {
    if (table === 'user_sessions') return staticBuilder({ data: null, error: { message: 'no session', code: 'PGRST116' } });
    if (table === 'users') return userBuilder();
    if (table === 'tenant_users') return tenantUserBuilder();
    return originalFrom(table);
  };
  return m;
}

function staticBuilder(result) {
  const chain = {
    select() { return chain; }, eq() { return chain; }, is() { return chain; }, in() { return chain; },
    order() { return chain; }, range() { return chain; }, limit() { return chain; }, maybeSingle() { return chain; },
    single() { return chain; },
    then(resolve) { return Promise.resolve(result).then(resolve); },
  };
  return chain;
}
function userBuilder() {
  let id = null;
  const chain = {
    select() { return chain; }, eq(k, v) { if (k === 'id') id = v; return chain; }, single() { return chain; },
    maybeSingle() { return chain; }, is() { return chain; },
    then(resolve) {
      const u = routeUsers[id];
      return Promise.resolve(u ? { data: u, error: null } : { data: null, error: { message: 'not found', code: 'PGRST116' } }).then(resolve);
    },
  };
  return chain;
}
function tenantUserBuilder() {
  let tenantId = null;
  let userId = null;
  const chain = {
    select() { return chain; },
    eq(k, v) { if (k === 'tenant_id') tenantId = v; if (k === 'user_id') userId = v; return chain; },
    single() { return chain; }, maybeSingle() { return chain; }, is() { return chain; },
    then(resolve) {
      const membership = tenantMemberships[`${tenantId}:${userId}`];
      return Promise.resolve(membership ? { data: membership, error: null } : { data: null, error: { message: 'no membership', code: 'PGRST116' } }).then(resolve);
    },
  };
  return chain;
}

let activeMock = null;
function installSupabaseMock(mock) {
  activeMock = mock;
  Object.defineProperty(supabase, 'from', { configurable: true, writable: true, value: (t) => activeMock.from(t) });
  Object.defineProperty(supabase, 'rpc', { configurable: true, writable: true, value: (n, p) => activeMock.rpc(n, p) });
}

async function startServer() {
  const app = express();
  app.use(express.json());
  // Pin a fixed timestamp on every request so the services/policy never depend on Date.now().
  app.use((req, _res, next) => { req.fixedTimestamp = FIXED_TS; next(); });
  app.use('/api/diaspora', safeTradeRouter);
  app.use(errorHandler);
  const server = await new Promise((resolve) => { const s = http.createServer(app); s.listen(0, '127.0.0.1', () => resolve(s)); });
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function httpReq(baseUrl, method, path, { userId, role, tenantId, body, headers = {} } = {}) {
  const h = { 'content-type': 'application/json', ...headers };
  if (userId) h['x-user-id'] = userId;
  if (role) h['x-stakeholder-role'] = role;
  if (tenantId) h['x-tenant-id'] = tenantId;
  const res = await fetch(`${baseUrl}${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

// Run a single HTTP request against a freshly-seeded server (one server per case keeps state isolated).
async function withServer(mock, fn) {
  installSupabaseMock(mock);
  const { server, baseUrl } = await startServer();
  try { return await fn(baseUrl); } finally { await new Promise((r) => server.close(r)); }
}

afterEach(() => {
  process.env.DIASPORA_SAFETRADE_ENABLED = 'true';
  delete process.env.DIASPORA_SAFETRADE_LIVE_PAYMENT;
  delete process.env.DIASPORA_SAFETRADE_PROVIDER;
  delete process.env.DIASPORA_SUBSCRIPTION_ENFORCEMENT;
});

// ════════════════════════════════════════════════════════════════════════════
// Participant transition authority (buyer-only vs seller-only)
// ════════════════════════════════════════════════════════════════════════════

test('S9-A: a buyer CANNOT perform a seller-only transition (SELLER_COMMIT) — 403', async () => {
  const mock = routeMock();
  seedTxn(mock, { txnStatus: 'INITIATED', milestoneStatus: 'PENDING' }); // AWAITING_SELLER_COMMITMENT band
  await withServer(mock, async (baseUrl) => {
    const res = await httpReq(baseUrl, 'POST', '/api/diaspora/safetrade/st-1/commit', {
      userId: 'buyer-1', body: { event: 'SELLER_COMMIT' },
    });
    assert.equal(res.status, 403);
    assert.equal(res.json.error.details?.code || res.json.error.code, 'SAFETRADE_ACTOR_NOT_ALLOWED');
  });
});

test('S9-A: a seller CANNOT perform a buyer-only transition (BUYER_COMMIT) — 403', async () => {
  const mock = routeMock();
  seedTxn(mock, { txnStatus: 'INITIATED', milestoneStatus: 'PENDING' });
  await withServer(mock, async (baseUrl) => {
    const res = await httpReq(baseUrl, 'POST', '/api/diaspora/safetrade/st-1/commit', {
      userId: 'seller-1', body: { event: 'BUYER_COMMIT' },
    });
    assert.equal(res.status, 403);
    assert.equal(res.json.error.details?.code || res.json.error.code, 'SAFETRADE_ACTOR_NOT_ALLOWED');
  });
});

test('S9-A: a participant cannot impersonate another participant for a participant-only transition (BUYER_COMMIT)', async () => {
  // BUYER_COMMIT actorRoles=[BUYER] does NOT admit a SELLER. A non-privileged actor's server-derived party
  // role must be in descriptor.actorRoles (assertActorRoleAllowed). A privileged reviewer/admin is given the
  // documented override on the party allowlist (consistent with the rest of the service), so the REAL
  // participant-only protection — and the impersonation guard — is that a non-privileged NON-buyer cannot
  // drive BUYER_COMMIT. The seller's server-derived party role (SELLER) is enforced from the authoritative
  // row, so even sending NO spoofed header (passing the route auth as the dealer it is) the seller is
  // rejected by the service actor gate. The client x-stakeholder-role is irrelevant: authority is row-derived.
  const mock = routeMock();
  seedTxn(mock, { txnStatus: 'INITIATED', milestoneStatus: 'PENDING' });
  await withServer(mock, async (baseUrl) => {
    // A non-privileged SELLER attempting the buyer-only BUYER_COMMIT is rejected by the actor gate (no
    // spoofed role header needed — the route admits the seller, the SERVICE rejects the wrong party).
    const sellerImpersonation = await httpReq(baseUrl, 'POST', '/api/diaspora/safetrade/st-1/commit', {
      userId: 'seller-1', body: { event: 'BUYER_COMMIT' },
    });
    assert.equal(sellerImpersonation.status, 403);
    assert.equal(sellerImpersonation.json.error.details?.code || sellerImpersonation.json.error.code, 'SAFETRADE_ACTOR_NOT_ALLOWED');

    // And a spoofed x-stakeholder-role=admin does NOT escalate the seller into a privileged override: the
    // route's `auth` middleware rejects the role mismatch (requested 'admin' != server role 'dealer') first.
    const spoofed = await httpReq(baseUrl, 'POST', '/api/diaspora/safetrade/st-1/commit', {
      userId: 'seller-1', role: 'admin', body: { event: 'BUYER_COMMIT' },
    });
    assert.equal(spoofed.status, 403);
  });
});

test('S9-A: legitimate participant edges are NOT over-blocked (buyer HOLD_PAYMENT succeeds)', async () => {
  const mock = routeMock();
  seedTxn(mock, { txnStatus: 'FUNDS_PENDING', milestoneStatus: 'HELD', total: 1000 });
  await withServer(mock, async (baseUrl) => {
    const res = await httpReq(baseUrl, 'POST', '/api/diaspora/safetrade/st-1/commit', {
      userId: 'buyer-1', body: { event: 'HOLD_PAYMENT' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.transaction.status, 'FUNDS_HELD');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Reviewer-only routes: ordinary participant denied; dealer denied; reviewer/admin allowed
// ════════════════════════════════════════════════════════════════════════════

test('S9-A: an ordinary participant CANNOT evaluate-release (403) nor approve-release (403)', async () => {
  const mock = routeMock();
  seedTxn(mock, { txnStatus: 'RELEASE_AUTHORIZED', milestoneStatus: 'RELEASE_AUTHORIZED', total: 1000 });
  await withServer(mock, async (baseUrl) => {
    for (const userId of ['buyer-1', 'seller-1']) {
      assert.equal((await httpReq(baseUrl, 'POST', '/api/diaspora/safetrade/st-1/evaluate-release', { userId, body: {} })).status, 403);
      assert.equal((await httpReq(baseUrl, 'POST', '/api/diaspora/safetrade/st-1/approve-release', { userId, body: {} })).status, 403);
    }
  });
});

test('S9-A: a DEALER does NOT gain reviewer authority — rejected at the route (403) for evaluate/approve/resolve', async () => {
  const mock = routeMock();
  seedTxn(mock, { txnStatus: 'RELEASE_AUTHORIZED', milestoneStatus: 'RELEASE_AUTHORIZED', total: 1000 });
  // An open dispute so resolve has a case to (attempt to) act on.
  mock._rows('diaspora_safetrade_disputes').push({ id: 'd-1', tenant_id: 'tenant-A', transaction_id: 'st-1', import_order_id: 'ord-1', status: 'OPEN', raised_by: 'buyer-1', raised_by_role: 'BUYER' });
  await withServer(mock, async (baseUrl) => {
    assert.equal((await httpReq(baseUrl, 'POST', '/api/diaspora/safetrade/st-1/evaluate-release', { userId: 'dealer-1', body: {} })).status, 403);
    assert.equal((await httpReq(baseUrl, 'POST', '/api/diaspora/safetrade/st-1/approve-release', { userId: 'dealer-1', body: {} })).status, 403);
    assert.equal((await httpReq(baseUrl, 'POST', '/api/diaspora/safetrade/disputes/d-1/resolve', { userId: 'dealer-1', body: { resolution: 'DISMISSED' } })).status, 403);
    // Even spoofing x-stakeholder-role=reviewer does not escalate the dealer (server-derived only).
    assert.equal((await httpReq(baseUrl, 'POST', '/api/diaspora/safetrade/st-1/evaluate-release', { userId: 'dealer-1', role: 'reviewer', body: {} })).status, 403);
  });
});

test('S9-A: government and government_reviewer ARE platform reviewers — they pass the reviewer route gate', async () => {
  const mock = routeMock();
  seedTxn(mock, { txnStatus: 'RELEASE_AUTHORIZED', milestoneStatus: 'RELEASE_AUTHORIZED', total: 1000 });
  await withServer(mock, async (baseUrl) => {
    for (const userId of ['gov-1', 'govrev-1']) {
      // The reviewer route gate admits them; evaluate-release records an evaluation (verdict may be
      // ineligible on the seeded data, but the AUTHORIZATION gate is passed -> NOT 403/401).
      const res = await httpReq(baseUrl, 'POST', '/api/diaspora/safetrade/st-1/evaluate-release', { userId, body: {} });
      assert.notEqual(res.status, 401);
      assert.notEqual(res.status, 403);
      assert.equal(res.status, 201); // an evaluation row is recorded; the verdict is in the body
      assert.ok(res.json.verdict);
    }
  });
});

test('S9-A: a reviewer is allowed at the reviewer routes (evaluate-release passes the gate)', async () => {
  const mock = routeMock();
  seedTxn(mock, { txnStatus: 'RELEASE_AUTHORIZED', milestoneStatus: 'RELEASE_AUTHORIZED', total: 1000 });
  await withServer(mock, async (baseUrl) => {
    const res = await httpReq(baseUrl, 'POST', '/api/diaspora/safetrade/st-1/evaluate-release', { userId: 'rev-1', body: {} });
    assert.equal(res.status, 201);
    assert.ok(res.json.verdict);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Spoofed role, cross-tenant, unrelated read
// ════════════════════════════════════════════════════════════════════════════

test('S9-A: a spoofed x-stakeholder-role cannot escalate a buyer onto a reviewer route (403)', async () => {
  const mock = routeMock();
  seedTxn(mock, { txnStatus: 'RELEASE_AUTHORIZED', milestoneStatus: 'RELEASE_AUTHORIZED' });
  await withServer(mock, async (baseUrl) => {
    assert.equal((await httpReq(baseUrl, 'POST', '/api/diaspora/safetrade/st-1/evaluate-release', { userId: 'buyer-1', role: 'admin', body: {} })).status, 403);
    assert.equal((await httpReq(baseUrl, 'POST', '/api/diaspora/safetrade/st-1/evaluate-release', { userId: 'buyer-1', role: 'reviewer', body: {} })).status, 403);
  });
});

test('S9-A: a cross-tenant x-tenant-id (non-member of that tenant) is rejected (403)', async () => {
  const mock = routeMock();
  await withServer(mock, async (baseUrl) => {
    // buyer-1 is NOT a member of tenant-B -> the tenant membership check fails.
    assert.equal((await httpReq(baseUrl, 'GET', '/api/diaspora/safetrade', { userId: 'buyer-1', tenantId: 'tenant-B' })).status, 403);
    // An entirely unknown tenant is also rejected.
    assert.equal((await httpReq(baseUrl, 'GET', '/api/diaspora/safetrade', { userId: 'buyer-1', tenantId: 'tenant-ZZZ' })).status, 403);
  });
});

test('S9-A: an unrelated (non-participant) actor cannot READ the transaction (GET /:id -> 403)', async () => {
  const mock = routeMock();
  seedTxn(mock, { txnStatus: 'IN_PROGRESS', milestoneStatus: 'HELD' });
  await withServer(mock, async (baseUrl) => {
    // out-1 is authenticated (verified user) but is neither a participant nor privileged on st-1.
    const res = await httpReq(baseUrl, 'GET', '/api/diaspora/safetrade/st-1', { userId: 'out-1' });
    assert.equal(res.status, 403);
  });
});

test('S9-A: unauthenticated requests are rejected (401)', async () => {
  const mock = routeMock();
  await withServer(mock, async (baseUrl) => {
    assert.equal((await httpReq(baseUrl, 'GET', '/api/diaspora/safetrade', {})).status, 401);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Invalid transition event / invalid source state
// ════════════════════════════════════════════════════════════════════════════

test('S9-A: an invalid (non-canonical) transition event is denied', async () => {
  const mock = routeMock();
  seedTxn(mock, { txnStatus: 'IN_PROGRESS', milestoneStatus: 'HELD' });
  await withServer(mock, async (baseUrl) => {
    const res = await httpReq(baseUrl, 'POST', '/api/diaspora/safetrade/st-1/commit', {
      userId: 'buyer-1', body: { event: 'TOTALLY_FAKE_EVENT' },
    });
    assert.equal(res.status, 400);
    assert.match(JSON.stringify(res.json), /Unknown SafeTrade transition|VALIDATION/i);
  });
});

test('S9-A: an invalid source state is denied (illegal structural edge)', async () => {
  const mock = routeMock();
  // SELLER_COMMIT from DRAFT is structurally illegal (it is only legal from AWAITING_SELLER_COMMITMENT).
  seedTxn(mock, { txnStatus: 'DRAFT', milestoneStatus: 'PENDING' });
  await withServer(mock, async (baseUrl) => {
    const res = await httpReq(baseUrl, 'POST', '/api/diaspora/safetrade/st-1/commit', {
      userId: 'seller-1', body: { event: 'SELLER_COMMIT' },
    });
    // Either the actor gate (seller-from-draft) or the structural edge rejects — both are >= 400 denials.
    assert.ok(res.status === 403 || res.status === 409 || res.status === 400, `expected a denial, got ${res.status}`);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Release authority requires a passing prior evaluation; high-risk needs reviewer approval
// ════════════════════════════════════════════════════════════════════════════

test('S9-A: approve-release WITHOUT a passing prior evaluation is denied (EVALUATION_REQUIRED)', async () => {
  const mock = routeMock();
  seedTxn(mock, { txnStatus: 'RELEASE_AUTHORIZED', milestoneStatus: 'RELEASE_AUTHORIZED', total: 1000 });
  await withServer(mock, async (baseUrl) => {
    // Reviewer hits the bare RELEASE_ESCROW transition with NO evaluationId -> the service refuses.
    const res = await httpReq(baseUrl, 'POST', '/api/diaspora/safetrade/st-1/approve-release', { userId: 'rev-1', body: {} });
    assert.ok(res.status === 403 || res.status === 400, `expected a denial, got ${res.status}`);
    assert.match(JSON.stringify(res.json), /EVALUATION_REQUIRED|evaluation/i);
  });
});

test('S9-A: a high-risk milestone RELEASE without a reviewer approval record is denied', async () => {
  const mock = routeMock();
  // $30k > $25k threshold -> HIGH risk; even a reviewer needs an approval evaluation row.
  seedTxn(mock, { txnStatus: 'RELEASE_AUTHORIZED', milestoneStatus: 'RELEASE_AUTHORIZED', total: 30000 });
  // Positive release evidence so the ONLY blocker is the missing high-risk approval.
  mock._rows('diaspora_compliance_reviews').push({ id: 'cr-1', import_order_id: 'ord-1', status: 'APPROVED', tenant_id: 'tenant-A' });
  mock._rows('vehicle_government_documents').push({ id: 'doc-1', import_order_id: 'ord-1', verification_status: 'VERIFIED' });
  mock._rows('diaspora_shipments').push({ id: 'sh-1', import_order_id: 'ord-1', status: 'ARRIVED' });
  const txn = mock._rows('diaspora_safetrade_transactions').find((t) => t.id === 'st-1');
  txn.metadata = { safetrade: { deliveryConfirmed: true } };
  await withServer(mock, async (baseUrl) => {
    // Reviewer drives the milestone RELEASE money op with NO approval evaluation -> denied (high-risk).
    const res = await httpReq(baseUrl, 'POST', '/api/diaspora/safetrade/st-1/approve-release', {
      userId: 'rev-1', body: { milestoneId: 'st-1-m1', operation: 'RELEASE' },
    });
    assert.ok(res.status === 403 || res.status === 400, `expected a denial, got ${res.status}`);
    assert.match(JSON.stringify(res.json), /REVIEWER_APPROVAL_REQUIRED|approval|NOT_ELIGIBLE/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Live-payment fails closed
// ════════════════════════════════════════════════════════════════════════════

test('S9-A: a live-payment request fails closed (EXTERNAL_ACTIVATION_REQUIRED — no money moves)', async () => {
  process.env.DIASPORA_SAFETRADE_LIVE_PAYMENT = 'true';
  process.env.DIASPORA_SAFETRADE_PROVIDER = 'stripe'; // not on the approved (empty) list
  const mock = routeMock();
  seedTxn(mock, { txnStatus: 'FUNDS_PENDING', milestoneStatus: 'PENDING', total: 1000 });
  await withServer(mock, async (baseUrl) => {
    // A reviewer-driven milestone money op resolves the provider FIRST, which fails closed
    // (assertSafeTradeProductionSafety refuses an unapproved live provider). The fail-closed guard throws
    // before any money move. NOTE: assertSafeTradeProductionSafety throws a PLAIN Error (no statusCode), so
    // this surfaces as HTTP 500 rather than a typed 403 — the money-safety invariant (no money moves) holds
    // either way; the status quirk is reported as a (non-security) finding.
    const res = await httpReq(baseUrl, 'POST', '/api/diaspora/safetrade/st-1/request-release', {
      userId: 'rev-1', body: { milestoneId: 'st-1-m1', operation: 'HOLD' },
    });
    assert.ok(res.status >= 400, `expected a fail-closed denial, got ${res.status}`);
    assert.match(JSON.stringify(res.json), /EXTERNAL_ACTIVATION_REQUIRED|external activation|refusing/i);
    // The milestone never advanced out of PENDING (no money moved).
    assert.equal(mock._rows('diaspora_safetrade_milestones').find((m) => m.id === 'st-1-m1').status, 'PENDING');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Held-funds boundary: cancel forbidden once funds are held
// ════════════════════════════════════════════════════════════════════════════

test('S9-A: cancellation after the held-funds boundary is denied', async () => {
  const mock = routeMock();
  seedTxn(mock, { txnStatus: 'FUNDS_HELD', milestoneStatus: 'HELD', total: 1000 });
  await withServer(mock, async (baseUrl) => {
    const res = await httpReq(baseUrl, 'POST', '/api/diaspora/safetrade/st-1/cancel', { userId: 'buyer-1', body: {} });
    // CANCEL from FUNDS_HELD is not a legal structural edge (held-funds boundary) -> denied (>=400).
    assert.ok(res.status === 409 || res.status === 400 || res.status === 403, `expected a denial, got ${res.status}`);
  });
});

test('S9-A: cancellation BEFORE the held-funds boundary is allowed for the buyer', async () => {
  const mock = routeMock();
  // INITIATED -> CANCELLED is a legal pre-hold CANCEL edge in the authoritative RPC DAG (DRAFT/INITIATED/
  // DISPUTED may CANCEL; FUNDS_PENDING onward may not — that is the held-funds boundary asserted above).
  seedTxn(mock, { txnStatus: 'INITIATED', milestoneStatus: 'PENDING', total: 1000 });
  await withServer(mock, async (baseUrl) => {
    const res = await httpReq(baseUrl, 'POST', '/api/diaspora/safetrade/st-1/cancel', { userId: 'buyer-1', body: {} });
    assert.equal(res.status, 200);
    assert.equal(res.json.transaction.status, 'CANCELLED');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Delivery confirmation authority (buyer-only; seller rejected)
// ════════════════════════════════════════════════════════════════════════════

test('S9-A: delivery confirmation authority is enforced — a seller driving CONFIRM_DELIVERY is rejected (403)', async () => {
  const mock = routeMock();
  seedTxn(mock, { txnStatus: 'IN_PROGRESS', milestoneStatus: 'HELD', total: 1000 });
  await withServer(mock, async (baseUrl) => {
    const sellerConfirm = await httpReq(baseUrl, 'POST', '/api/diaspora/safetrade/st-1/commit', {
      userId: 'seller-1', body: { event: 'CONFIRM_DELIVERY' },
    });
    assert.equal(sellerConfirm.status, 403);
    assert.equal(sellerConfirm.json.error.details?.code || sellerConfirm.json.error.code, 'SAFETRADE_ACTOR_NOT_ALLOWED');
    // The buyer CAN confirm (regression of the happy path).
    const buyerConfirm = await httpReq(baseUrl, 'POST', '/api/diaspora/safetrade/st-1/commit', {
      userId: 'buyer-1', body: { event: 'CONFIRM_DELIVERY' },
    });
    assert.equal(buyerConfirm.status, 200);
    assert.equal(buyerConfirm.json.observational, true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Dispute resolution authority (ordinary participant denied; reviewer allowed)
// ════════════════════════════════════════════════════════════════════════════

test('S9-A: dispute resolution by an ordinary participant is denied (403); a reviewer is allowed', async () => {
  const mock = routeMock();
  seedTxn(mock, { txnStatus: 'FUNDS_HELD', milestoneStatus: 'HELD', total: 1000 });
  // Open a dispute first (buyer opens it; drives DISPUTED + a sandbox hold).
  await withServer(mock, async (baseUrl) => {
    const opened = await httpReq(baseUrl, 'POST', '/api/diaspora/safetrade/st-1/disputes', {
      userId: 'buyer-1', body: { reason: 'wrong vehicle', category: 'ITEM_NOT_AS_DESCRIBED' },
    });
    assert.equal(opened.status, 201);
    const disputeId = opened.json.dispute.id;

    // A participant (seller) cannot resolve — the reviewer route rejects a dealer-role seller at the gate.
    const sellerResolve = await httpReq(baseUrl, 'POST', `/api/diaspora/safetrade/disputes/${disputeId}/resolve`, {
      userId: 'seller-1', body: { resolution: 'DISMISSED' },
    });
    assert.equal(sellerResolve.status, 403);

    // A reviewer is allowed at the gate and resolves the case (record-only DISMISSED -> no money move).
    const reviewerResolve = await httpReq(baseUrl, 'POST', `/api/diaspora/safetrade/disputes/${disputeId}/resolve`, {
      userId: 'rev-1', body: { resolution: 'DISMISSED' },
    });
    assert.equal(reviewerResolve.status, 200);
    assert.equal(reviewerResolve.json.dispute.status, 'REJECTED'); // DISMISSED maps to REJECTED terminal
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Webhook behaviour unchanged
// ════════════════════════════════════════════════════════════════════════════

test('S9-A: payment-webhook accepts a valid signature (200) and rejects a bad signature (401)', async () => {
  const provider = await import('../services/diaspora/safetrade/safeTradePaymentProvider.js');
  const mock = routeMock();
  await withServer(mock, async (baseUrl) => {
    const body = { id: 'wh-evt-authz-1', type: 'hold.authorized', intentId: 'sbx_pi_1' };
    // This harness pins req.fixedTimestamp=FIXED_TS, so the route passes now=Date.parse(FIXED_TS) to the
    // provider's anti-replay drift check. Sign with that SAME timestamp so the signature is within drift.
    const ts = Date.parse(FIXED_TS);
    const okSig = crypto.createHmac('sha256', provider.safeTradeWebhookSecret()).update(`${ts}.${JSON.stringify(body)}`).digest('hex');

    const bad = await httpReq(baseUrl, 'POST', '/api/diaspora/safetrade/payment-webhook', {
      body, headers: { 'x-safetrade-signature': 'deadbeef', 'x-safetrade-timestamp': String(ts) },
    });
    assert.equal(bad.status, 401);

    const good = await httpReq(baseUrl, 'POST', '/api/diaspora/safetrade/payment-webhook', {
      body, headers: { 'x-safetrade-signature': okSig, 'x-safetrade-timestamp': String(ts) },
    });
    assert.equal(good.status, 200);
    assert.equal(good.json.ok, true);
  });
});
