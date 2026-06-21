/**
 * Phase 8 (M2) — Diaspora subscription + billing API routes.
 *
 * Drives the REAL diasporaSubscriptionRoutes router + the REAL authorizeRole middleware over HTTP with
 * a mocked Supabase. The auth middleware reads users/tenant_users/user_sessions from the shared supabase
 * singleton (overridden here); the route handlers read/write the domain tables through an injected mock
 * client placed on app.locals.diasporaTestDeps (the same client + the deterministic SANDBOX billing
 * provider — never a real network).
 *
 * Proves:
 *   - GET /plans returns the 5-plan catalog;
 *   - GET /status, /entitlements, /usage are tenant-scoped;
 *   - cross-tenant isolation: tenant B cannot read tenant A's status/usage;
 *   - webhook: valid new event processed + persisted; duplicate event_id idempotent (alreadyProcessed);
 *     bad signature -> 400; a replayed event does not double-apply the subscription sync.
 *
 * STUB NOTE: the in-memory mock cannot run SQL, so the webhook's idempotency (which in production is the
 * DB unique (provider,event_id) constraint + the SECURITY DEFINER reserve RPC) is exercised via the mock
 * tables + the JS reference. The route's findEvent() select gives us the same observable behavior. This
 * is documented per the test directive; true DB-constraint concurrency is proven in the staging suite.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
// Deterministic webhook secret for HMAC signing in this test (matches the dev default).
process.env.DIASPORA_BILLING_WEBHOOK_SECRET = 'diaspora-billing-dev-webhook-secret';

const express = (await import('express')).default;
const subscriptionRouter = (await import('../routes/diasporaSubscriptionRoutes.js')).default;
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const { supabase } = await import('../db/supabase.js');
const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const { DIASPORA_RPCS } = await import('./helpers/diasporaRpcReference.js');
const { getSharedSandboxProvider } = await import('../services/diaspora/billing/billingProvider.js');
const { billingWebhookSecret } = await import('../constants/diaspora/diasporaBillingConstants.js');

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

// Auth-layer fixtures (read by authorizeRole from the supabase singleton override below).
const authDb = {
  users: {
    'user-A': { id: 'user-A', role: 'owner', is_verified: true },
    'user-B': { id: 'user-B', role: 'owner', is_verified: true },
  },
  tenantUsers: {
    [`${TENANT_A}|user-A`]: { role: 'admin' },
    [`${TENANT_B}|user-B`]: { role: 'admin' },
  },
};

// Auth-layer mock builder (users / tenant_users / user_sessions only).
function authBuilder(table) {
  const state = { table, filters: {} };
  const chain = {
    select() { return chain; },
    eq(k, v) { state.filters[k] = v; return chain; },
    single() { return Promise.resolve(resolveAuth(state)); },
    maybeSingle() { return Promise.resolve(resolveAuth(state)); },
    then(resolve, reject) { try { return Promise.resolve(resolveAuth(state)).then(resolve, reject); } catch (e) { return reject ? reject(e) : Promise.reject(e); } },
  };
  return chain;
}
function resolveAuth(state) {
  const ok = (data) => ({ data, error: null });
  const missing = (m) => ({ data: null, error: { message: m } });
  switch (state.table) {
    case 'user_sessions': return missing('no session'); // force x-user-id fallback (allowed in test)
    case 'users': return authDb.users[state.filters.id] ? ok(authDb.users[state.filters.id]) : missing('no user');
    case 'tenant_users': {
      const key = `${state.filters.tenant_id}|${state.filters.user_id}`;
      return authDb.tenantUsers[key] ? ok(authDb.tenantUsers[key]) : missing('no membership');
    }
    default: return ok([]);
  }
}

// The domain mock client (subscriptions / billing events / meters), shared across a test via app.locals.
let domainClient;
function freshDomainClient(seed = {}) {
  return createMockSupabase({
    diaspora_subscriptions: [],
    diaspora_billing_provider_events: [],
    diaspora_usage_meters: [],
    diaspora_usage_reservations: [],
    diaspora_subscription_plans: [],
    diaspora_user_entitlement_overrides: [],
    ...seed,
  }, { rpc: DIASPORA_RPCS });
}

let server; let baseUrl; let app;
before(async () => {
  Object.defineProperty(supabase, 'from', { configurable: true, writable: true, value: (t) => authBuilder(t) });
  app = express();
  // Capture the raw body so the webhook HMAC verifies against the exact bytes the client signed.
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));
  app.use('/subscription', subscriptionRouter);
  app.use(errorHandler);
  await new Promise((r) => { server = http.createServer(app); server.listen(0, '127.0.0.1', r); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise((r) => server.close(r)); });

function setDomain(client) {
  domainClient = client;
  app.locals.diasporaTestDeps = { supabaseClient: client, billingProvider: getSharedSandboxProvider() };
}

function hdr(userId, { tenantId } = {}) {
  const h = { 'content-type': 'application/json' };
  if (userId) h['x-user-id'] = userId;
  if (tenantId) h['x-tenant-id'] = tenantId;
  return h;
}
async function call(method, path, { userId, tenantId, body, headers = {} } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...hdr(userId, { tenantId }), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

function sign(payloadObj) {
  const raw = JSON.stringify(payloadObj);
  const signature = crypto.createHmac('sha256', billingWebhookSecret()).update(raw).digest('hex');
  return { raw, signature };
}

// ── GET /plans ─────────────────────────────────────────────────────────────────────────────────

test('GET /plans returns the 5-plan catalog, sorted', async () => {
  setDomain(freshDomainClient());
  const { status, body } = await call('GET', '/subscription/plans', { userId: 'user-A', tenantId: TENANT_A });
  assert.equal(status, 200);
  assert.equal(body.data.length, 5);
  assert.deepEqual(body.data.map((p) => p.planKey), ['free', 'diaspora_buyer', 'seller', 'trade_pro', 'enterprise']);
  // Each plan carries its entitlements map.
  assert.equal(body.data[0].entitlements['diaspora.workbook.download'], true);
});

// ── GET /status, /entitlements, /usage (tenant-scoped) ──────────────────────────────────────────

test('GET /status returns synthetic Free for a tenant with no subscription', async () => {
  setDomain(freshDomainClient());
  const { status, body } = await call('GET', '/subscription/status', { userId: 'user-A', tenantId: TENANT_A });
  assert.equal(status, 200);
  assert.equal(body.data.planKey, 'free');
  assert.equal(body.data.synthetic, true);
  assert.equal(body.data.active, true);
});

test('GET /status reflects a seeded active subscription', async () => {
  setDomain(freshDomainClient({
    diaspora_subscriptions: [{ id: 'sub-A', tenant_id: TENANT_A, plan_key: 'seller', status: 'active', deleted_at: null, created_at: new Date(2026, 5, 1).toISOString() }],
  }));
  const { status, body } = await call('GET', '/subscription/status', { userId: 'user-A', tenantId: TENANT_A });
  assert.equal(status, 200);
  assert.equal(body.data.planKey, 'seller');
  assert.equal(body.data.synthetic, false);
});

test('GET /entitlements returns the effective entitlement map for the tenant plan', async () => {
  setDomain(freshDomainClient({
    diaspora_subscriptions: [{ id: 'sub-A', tenant_id: TENANT_A, plan_key: 'seller', status: 'active', deleted_at: null, created_at: new Date(2026, 5, 1).toISOString() }],
  }));
  const { status, body } = await call('GET', '/subscription/entitlements', { userId: 'user-A', tenantId: TENANT_A });
  assert.equal(status, 200);
  assert.equal(body.data.planKey, 'seller');
  assert.equal(body.data.entitlements['diaspora.stock.publish'], true);
  assert.equal(body.data.entitlements['diaspora.rfq.create'], false);
});

test('GET /usage returns metered-feature usage for the current period', async () => {
  setDomain(freshDomainClient());
  const { status, body } = await call('GET', '/subscription/usage', { userId: 'user-A', tenantId: TENANT_A });
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.data.usage));
  assert.ok(body.data.usage.some((u) => u.featureKey === 'diaspora.ai.execute_medium'));
});

test('subscription reads require a tenant context (400 without x-tenant-id)', async () => {
  setDomain(freshDomainClient());
  const { status } = await call('GET', '/subscription/status', { userId: 'user-A' });
  assert.equal(status, 400);
});

// ── Cross-tenant isolation ──────────────────────────────────────────────────────────────────────

test('cross-tenant: user-B cannot read tenant-A status (forbidden by auth tenant membership)', async () => {
  setDomain(freshDomainClient({
    diaspora_subscriptions: [{ id: 'sub-A', tenant_id: TENANT_A, plan_key: 'seller', status: 'active', deleted_at: null, created_at: new Date(2026, 5, 1).toISOString() }],
  }));
  // user-B is NOT a member of tenant A -> authorizeRole returns 403 before the handler runs.
  const { status } = await call('GET', '/subscription/status', { userId: 'user-B', tenantId: TENANT_A });
  assert.equal(status, 403);
});

test('cross-tenant: user-B reading their OWN tenant B never sees tenant A subscription', async () => {
  setDomain(freshDomainClient({
    diaspora_subscriptions: [{ id: 'sub-A', tenant_id: TENANT_A, plan_key: 'enterprise', status: 'active', deleted_at: null, created_at: new Date(2026, 5, 1).toISOString() }],
  }));
  const { status, body } = await call('GET', '/subscription/status', { userId: 'user-B', tenantId: TENANT_B });
  assert.equal(status, 200);
  assert.equal(body.data.planKey, 'free'); // tenant B has no sub -> synthetic Free, not tenant A's enterprise
  assert.equal(body.data.synthetic, true);
});

// ── Billing actions (sandbox; no network) ───────────────────────────────────────────────────────

test('POST /checkout returns a deterministic sandbox session (never a real URL)', async () => {
  setDomain(freshDomainClient());
  const { status, body } = await call('POST', '/subscription/checkout', { userId: 'user-A', tenantId: TENANT_A, body: { planKey: 'seller' } });
  assert.equal(status, 201);
  assert.equal(body.data.live, false);
  assert.match(body.data.url, /sandbox-billing\.local/);
});

test('POST /checkout rejects an unknown plan (400)', async () => {
  setDomain(freshDomainClient());
  const { status } = await call('POST', '/subscription/checkout', { userId: 'user-A', tenantId: TENANT_A, body: { planKey: 'not-a-plan' } });
  assert.equal(status, 400);
});

test('POST /change-plan persists the provider snapshot (status never client-trusted)', async () => {
  setDomain(freshDomainClient());
  const { status, body } = await call('POST', '/subscription/change-plan', { userId: 'user-A', tenantId: TENANT_A, body: { planKey: 'trade_pro' } });
  assert.equal(status, 200);
  assert.equal(body.data.plan_key, 'trade_pro');
  assert.equal(body.data.status, 'active');
  // Exactly one subscription row for the tenant.
  const subs = domainClient._rows('diaspora_subscriptions').filter((s) => s.tenant_id === TENANT_A);
  assert.equal(subs.length, 1);
});

// ── Webhook (verified, idempotent, only state-mutating sync path) ───────────────────────────────

function webhookEvent({ eventId, planKey = 'seller', status = 'active' }) {
  return {
    id: eventId,
    type: 'subscription.updated',
    provider: 'sandbox',
    data: {
      tenantId: TENANT_A,
      planKey,
      status,
      currentPeriodStart: '2026-06-01T00:00:00.000Z',
      currentPeriodEnd: '2026-07-01T00:00:00.000Z',
    },
  };
}

test('webhook: a valid new event is processed and the subscription is synced + persisted', async () => {
  setDomain(freshDomainClient());
  const event = webhookEvent({ eventId: 'evt-100', planKey: 'seller' });
  const { signature } = sign(event);
  const { status, body } = await call('POST', '/subscription/webhook', { body: event, headers: { 'x-billing-signature': signature } });
  assert.equal(status, 200);
  assert.equal(body.alreadyProcessed, false);
  assert.equal(body.synced.planKey, 'seller');

  const events = domainClient._rows('diaspora_billing_provider_events');
  assert.equal(events.length, 1);
  assert.equal(events[0].event_id, 'evt-100');
  assert.equal(events[0].signature_verified, true);
  assert.ok(events[0].processed_at);

  const subs = domainClient._rows('diaspora_subscriptions').filter((s) => s.tenant_id === TENANT_A);
  assert.equal(subs.length, 1);
  assert.equal(subs[0].plan_key, 'seller');
  assert.equal(subs[0].status, 'active');
});

test('webhook: a bad signature is rejected with 400 and nothing is persisted', async () => {
  setDomain(freshDomainClient());
  const event = webhookEvent({ eventId: 'evt-bad' });
  const { status } = await call('POST', '/subscription/webhook', { body: event, headers: { 'x-billing-signature': 'deadbeef' } });
  assert.equal(status, 400);
  assert.equal(domainClient._rows('diaspora_billing_provider_events').length, 0);
  assert.equal(domainClient._rows('diaspora_subscriptions').length, 0);
});

test('webhook: a duplicate event_id is idempotent (alreadyProcessed, no double-apply)', async () => {
  setDomain(freshDomainClient());
  const event = webhookEvent({ eventId: 'evt-dup', planKey: 'seller' });
  const { signature } = sign(event);

  const first = await call('POST', '/subscription/webhook', { body: event, headers: { 'x-billing-signature': signature } });
  assert.equal(first.status, 200);
  assert.equal(first.body.alreadyProcessed, false);

  // Replay the SAME event id (even if a later payload tries to escalate the plan, it must not apply).
  const replayEvent = webhookEvent({ eventId: 'evt-dup', planKey: 'enterprise' });
  const { signature: sig2 } = sign(replayEvent);
  const second = await call('POST', '/subscription/webhook', { body: replayEvent, headers: { 'x-billing-signature': sig2 } });
  assert.equal(second.status, 200);
  assert.equal(second.body.alreadyProcessed, true);

  // Still exactly one event row and the plan was NOT escalated by the replay.
  assert.equal(domainClient._rows('diaspora_billing_provider_events').length, 1);
  const subs = domainClient._rows('diaspora_subscriptions').filter((s) => s.tenant_id === TENANT_A);
  assert.equal(subs.length, 1);
  assert.equal(subs[0].plan_key, 'seller'); // not 'enterprise'
});

test('webhook: a missing event id is rejected (400)', async () => {
  setDomain(freshDomainClient());
  const event = { type: 'subscription.updated', provider: 'sandbox', data: { tenantId: TENANT_A } }; // no id
  const { signature } = sign(event);
  const { status } = await call('POST', '/subscription/webhook', { body: event, headers: { 'x-billing-signature': signature } });
  assert.equal(status, 400);
});
