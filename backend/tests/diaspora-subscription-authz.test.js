/**
 * Gate S8-A — Subscription MUTATION authorization.
 *
 * Drives the REAL diasporaSubscriptionRoutes router + REAL authorizeRole middleware over HTTP with a
 * mocked Supabase. Proves that the billing MANAGEMENT endpoints (checkout/portal/change-plan/cancel)
 * require a trusted subscription manager (platform admin/super-admin, or a same-tenant tenant admin),
 * while READS (status/usage) remain available to any authenticated tenant member. Server-derived roles
 * only — a spoofed x-stakeholder-role cannot escalate, and a cross-tenant x-tenant-id is rejected by the
 * middleware before the route. The webhook is signature-authorized and carries NO user-role gate.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.DIASPORA_BILLING_WEBHOOK_SECRET = 'diaspora-billing-dev-webhook-secret';

const express = (await import('express')).default;
const subscriptionRouter = (await import('../routes/diasporaSubscriptionRoutes.js')).default;
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const { supabase } = await import('../db/supabase.js');
const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const { DIASPORA_RPCS } = await import('./helpers/diasporaRpcReference.js');
const { getSharedSandboxProvider } = await import('../services/diaspora/billing/billingProvider.js');
const { billingWebhookSecret } = await import('../constants/diaspora/diasporaBillingConstants.js');
const { canManageSubscription } = await import('../services/diaspora/diasporaAuthorization.js');

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

// platformRole comes from users.role; tenantRole comes from tenant_users.role.
const authDb = {
  users: {
    'tadmin': { id: 'tadmin', role: 'owner', is_verified: true },          // ordinary platform role
    'member': { id: 'member', role: 'dealer', is_verified: true },         // ordinary member
    'reviewer': { id: 'reviewer', role: 'reviewer', is_verified: true },   // platform reviewer
    'padmin': { id: 'padmin', role: 'platform_admin', is_verified: true }, // platform admin
  },
  tenantUsers: {
    [`${TENANT_A}|tadmin`]: { role: 'admin' },     // tenant admin of A
    [`${TENANT_A}|member`]: { role: 'manager' },   // ordinary tenant member
    [`${TENANT_A}|reviewer`]: { role: 'reviewer' },// reviewer is a member but NOT a tenant admin
    [`${TENANT_A}|padmin`]: { role: 'member' },    // platform admin is also a member (to pass tenant gate)
  },
};
function authBuilder(table) {
  const state = { table, filters: {} };
  const chain = {
    select() { return chain; }, eq(k, v) { state.filters[k] = v; return chain; },
    single() { return Promise.resolve(resolveAuth(state)); }, maybeSingle() { return Promise.resolve(resolveAuth(state)); },
    then(resolve, reject) { try { return Promise.resolve(resolveAuth(state)).then(resolve, reject); } catch (e) { return reject ? reject(e) : Promise.reject(e); } },
  };
  return chain;
}
function resolveAuth(state) {
  const ok = (data) => ({ data, error: null });
  const missing = (m) => ({ data: null, error: { message: m } });
  switch (state.table) {
    case 'user_sessions': return missing('no session');
    case 'users': return authDb.users[state.filters.id] ? ok(authDb.users[state.filters.id]) : missing('no user');
    case 'tenant_users': {
      const key = `${state.filters.tenant_id}|${state.filters.user_id}`;
      return authDb.tenantUsers[key] ? ok(authDb.tenantUsers[key]) : missing('no membership');
    }
    default: return ok([]);
  }
}

let server; let baseUrl; let app;
before(async () => {
  Object.defineProperty(supabase, 'from', { configurable: true, writable: true, value: (t) => authBuilder(t) });
  app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));
  app.use('/subscription', subscriptionRouter);
  app.use(errorHandler);
  await new Promise((r) => { server = http.createServer(app); server.listen(0, '127.0.0.1', r); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise((r) => server.close(r)); });

function freshDomain() {
  const client = createMockSupabase({
    diaspora_subscriptions: [], diaspora_billing_provider_events: [], diaspora_usage_meters: [],
    diaspora_usage_reservations: [], diaspora_subscription_plans: [], diaspora_user_entitlement_overrides: [],
  }, { rpc: DIASPORA_RPCS });
  app.locals.diasporaTestDeps = { supabaseClient: client, billingProvider: getSharedSandboxProvider() };
}
async function call(method, path, { userId, tenantId, role, body } = {}) {
  freshDomain();
  const headers = { 'content-type': 'application/json' };
  if (userId) headers['x-user-id'] = userId;
  if (tenantId) headers['x-tenant-id'] = tenantId;
  if (role) headers['x-stakeholder-role'] = role;
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const MGMT = [
  ['POST', '/subscription/checkout', { planKey: 'trade_pro' }, 201],
  ['POST', '/subscription/portal', {}, 201],
  ['POST', '/subscription/change-plan', { planKey: 'trade_pro' }, 200],
  ['POST', '/subscription/cancel', { atPeriodEnd: true }, 200],
];

// ── Reads available to any authenticated tenant member ──────────────────────────────────────────
test('S8-A: tenant member can read status and usage', async () => {
  assert.equal((await call('GET', '/subscription/status', { userId: 'member', tenantId: TENANT_A })).status, 200);
  assert.equal((await call('GET', '/subscription/usage', { userId: 'member', tenantId: TENANT_A })).status, 200);
});

// ── Tenant admin can manage ─────────────────────────────────────────────────────────────────────
for (const [method, path, body, okStatus] of MGMT) {
  test(`S8-A: tenant admin can ${path}`, async () => {
    const r = await call(method, path, { userId: 'tadmin', tenantId: TENANT_A, body });
    assert.equal(r.status, okStatus, JSON.stringify(r.body));
  });
}

// ── Platform admin can manage (canonical matrix) ────────────────────────────────────────────────
test('S8-A: platform admin can open checkout', async () => {
  const r = await call('POST', '/subscription/checkout', { userId: 'padmin', tenantId: TENANT_A, body: { planKey: 'enterprise' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
});

// ── Ordinary member cannot manage (each action) ─────────────────────────────────────────────────
for (const [method, path, body] of MGMT) {
  test(`S8-A: ordinary member cannot ${path} (403)`, async () => {
    const r = await call(method, path, { userId: 'member', tenantId: TENANT_A, body });
    assert.equal(r.status, 403, JSON.stringify(r.body));
  });
}

// ── Reviewer cannot mutate billing ──────────────────────────────────────────────────────────────
test('S8-A: reviewer cannot cancel subscription (403)', async () => {
  const r = await call('POST', '/subscription/cancel', { userId: 'reviewer', tenantId: TENANT_A, body: { atPeriodEnd: true } });
  assert.equal(r.status, 403, JSON.stringify(r.body));
});

// ── Spoofed x-stakeholder-role cannot escalate to manager ───────────────────────────────────────
test('S8-A: spoofed x-stakeholder-role=admin does not grant management', async () => {
  const r = await call('POST', '/subscription/checkout', { userId: 'member', tenantId: TENANT_A, role: 'admin', body: { planKey: 'trade_pro' } });
  assert.equal(r.status, 403, JSON.stringify(r.body));
});

// ── Cross-tenant management denied (no membership in target tenant -> middleware 403) ────────────
test('S8-A: cross-tenant management denied (tenant-A admin cannot act on tenant B)', async () => {
  const r = await call('POST', '/subscription/cancel', { userId: 'tadmin', tenantId: TENANT_B, body: { atPeriodEnd: true } });
  assert.equal(r.status, 403, JSON.stringify(r.body));
});

// ── Missing tenant context denied ───────────────────────────────────────────────────────────────
test('S8-A: missing tenant context denies management', async () => {
  const r = await call('POST', '/subscription/checkout', { userId: 'tadmin', body: { planKey: 'trade_pro' } });
  assert.ok(r.status === 400 || r.status === 403, `expected 400/403, got ${r.status}`);
});

// ── Webhook stays signature-authorized (no user-role gate) ──────────────────────────────────────
test('S8-A: webhook accepts a valid signature with no user role', async () => {
  const payload = { provider: 'sandbox', id: 'evt-s8a-1', type: 'subscription.updated', data: { tenantId: TENANT_A, planKey: 'trade_pro', status: 'active' } };
  const raw = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', billingWebhookSecret()).update(raw).digest('hex');
  freshDomain();
  const res = await fetch(`${baseUrl}/subscription/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-billing-signature': signature }, body: raw });
  assert.equal(res.status, 200);
});
test('S8-A: webhook rejects a bad signature (400), unaffected by the management gate', async () => {
  freshDomain();
  const res = await fetch(`${baseUrl}/subscription/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-billing-signature': 'deadbeef' }, body: JSON.stringify({ provider: 'sandbox', eventId: 'x', data: {} }) });
  assert.equal(res.status, 400);
});

// ── Unit checks of the predicate (defense-in-depth, incl. cross-tenant mismatch) ────────────────
test('S8-A: canManageSubscription predicate matrix', () => {
  const padmin = { id: 'p', platformRole: 'platform_admin', tenantRole: 'member', tenantId: TENANT_A };
  const tadmin = { id: 't', platformRole: 'owner', tenantRole: 'admin', tenantId: TENANT_A };
  const member = { id: 'm', platformRole: 'dealer', tenantRole: 'manager', tenantId: TENANT_A };
  const reviewer = { id: 'r', platformRole: 'reviewer', tenantRole: 'reviewer', tenantId: TENANT_A };
  assert.equal(canManageSubscription(padmin, TENANT_A), true);
  assert.equal(canManageSubscription(tadmin, TENANT_A), true);
  assert.equal(canManageSubscription(member, TENANT_A), false);
  assert.equal(canManageSubscription(reviewer, TENANT_A), false);
  // Cross-tenant: tenant-A admin cannot manage tenant B even if passed directly.
  assert.equal(canManageSubscription(tadmin, TENANT_B), false);
  // Missing tenant target.
  assert.equal(canManageSubscription(tadmin, null), false);
});
