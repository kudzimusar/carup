/**
 * OC-5R-PROV-01 C2 + C3 — provider surfaces say what is true.
 *
 *   C2  Billing failures are typed: a caller's mistake is 4xx, a provider CarUp does not run is a
 *       deterministic 503, a provider that answered badly is 502 — never an untyped 500 — and the
 *       read-only subscription routes do not need a provider at all. Nothing simulates success.
 *   C3  Health never reports Sentry `enabled` when no Sentry SDK is installed.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const express = (await import('express')).default;
const { supabase } = await import('../db/supabase.js');
const originalFrom = supabase.from;
const { CarUpError } = await import('../utils/errors.js');
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const { BillingProviderError, BILLING_ERROR_STATUS } = await import('../services/diaspora/billing/billingProviderBase.js');
const { selectBillingProvider } = await import('../services/diaspora/billing/billingProvider.js');
const subscriptionRouter = (await import('../routes/diasporaSubscriptionRoutes.js')).default;
const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const { DIASPORA_RPCS } = await import('./helpers/diasporaRpcReference.js');
const { sentryHealth, SENTRY_SDK_INSTALLED } = await import('../services/ai/sentry.js');

async function withEnv(overrides, fn) {
  const saved = {};
  for (const k of Object.keys(overrides)) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(overrides)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

function fakeRes() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

// ═══ C2 — typed billing failures ═══════════════════════════════════════════════════════════════

test('C2: every billing failure carries a deterministic HTTP status — never an untyped 500', () => {
  const cases = {
    INVALID_INPUT: 400, RAW_BODY_REQUIRED: 400,
    EXTERNAL_ACTIVATION_REQUIRED: 503, TRANSPORT_UNAVAILABLE: 503, PROVIDER_CAPABILITY_UNSUPPORTED: 503,
    PROVIDER_REQUEST_REJECTED: 502, TRANSPORT_REQUEST_FAILED: 502, SOMETHING_NEW: 502,
  };
  for (const [code, status] of Object.entries(cases)) {
    const err = new BillingProviderError('sanitised', code);
    assert.ok(err instanceof CarUpError, code);
    assert.equal(err.statusCode, status, code);
    assert.equal(err.code, code);
    assert.equal(err.name, 'BillingProviderError');
  }
  assert.equal(new BillingProviderError('default').statusCode, 502);
  for (const status of Object.values(BILLING_ERROR_STATUS)) assert.notEqual(status, 500);
});

test('C2: an unconfigured provider renders as 503 with its own code and message', () => {
  const res = fakeRes();
  errorHandler(new BillingProviderError('Billing is not configured for this deployed runtime.', 'EXTERNAL_ACTIVATION_REQUIRED'),
    { path: '/subscription/checkout', method: 'POST', headers: {} }, res, () => {});
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error.code, 'EXTERNAL_ACTIVATION_REQUIRED');
  assert.match(res.body.error.message, /not configured/);
});

test('C2: a deployment selects no simulated provider — it refuses, typed', async () => {
  for (const marker of [{ CARUP_ENV: 'staging' }, { VERCEL_ENV: 'preview' }, { VERCEL_ENV: 'production' }]) {
    await withEnv({ ...marker, DIASPORA_BILLING_TEST_MODE: undefined, DIASPORA_BILLING_LIVE: undefined }, async () => {
      assert.throws(() => selectBillingProvider(), (e) => e instanceof BillingProviderError && e.statusCode === 503 && e.code === 'EXTERNAL_ACTIVATION_REQUIRED', JSON.stringify(marker));
    });
  }
});

// Route level, in a DEPLOYMENT. Identity uses the explicit, auditable x-user-id opt-in (B1 keeps it).
const TENANT = '11111111-1111-1111-1111-111111111111';
function authBuilder(table) {
  const filters = {};
  const resolve = () => {
    if (table === 'users' && filters.id === 'owner-1') return { data: { id: 'owner-1', role: 'owner', is_verified: true }, error: null };
    if (table === 'tenant_users' && filters.user_id === 'owner-1' && filters.tenant_id === TENANT) return { data: { role: 'admin' }, error: null };
    return { data: null, error: { code: 'PGRST116', message: 'none' } };
  };
  const chain = {
    select() { return chain; }, eq(k, v) { filters[k] = v; return chain; }, is() { return chain; },
    single() { return Promise.resolve(resolve()); }, maybeSingle() { return Promise.resolve(resolve()); },
    then(r, j) { return Promise.resolve(resolve()).then(r, j); },
  };
  return chain;
}

let server;
after(async () => { if (server) await new Promise((r) => server.close(r)); });

test('C2: on a deployment the read-only subscription routes work and provider routes answer 503 — nothing is written', async () => {
  Object.defineProperty(supabase, 'from', { configurable: true, writable: true, value: (t) => authBuilder(t) });
  const domain = createMockSupabase({ diaspora_subscriptions: [], diaspora_billing_provider_events: [], diaspora_usage_meters: [], diaspora_subscription_plans: [], diaspora_user_entitlement_overrides: [] }, { rpc: DIASPORA_RPCS });
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));
  app.locals.diasporaTestDeps = { supabaseClient: domain }; // NO injected provider: the real selector decides
  app.use('/subscription', subscriptionRouter);
  app.use(errorHandler);
  await new Promise((r) => { server = http.createServer(app); server.listen(0, '127.0.0.1', r); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(`${base}${path}`, {
      method, headers: { 'content-type': 'application/json', 'x-user-id': 'owner-1', 'x-tenant-id': TENANT },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };
  await withEnv({ CARUP_ENV: 'staging', CARUP_ALLOW_X_USER_ID_FALLBACK: 'true', DIASPORA_BILLING_TEST_MODE: undefined, DIASPORA_BILLING_LIVE: undefined }, async () => {
    const status = await call('GET', '/subscription/status');
    assert.equal(status.status, 200, JSON.stringify(status.json));
    assert.equal(status.json.data.planKey, 'free', 'the read reports the synthetic Free plan honestly');
    const entitlements = await call('GET', '/subscription/entitlements');
    assert.equal(entitlements.status, 200, JSON.stringify(entitlements.json));

    for (const [path, body] of [['/subscription/checkout', { planKey: 'seller' }], ['/subscription/portal', {}], ['/subscription/cancel', {}], ['/subscription/webhook', { id: 'evt-1' }]]) {
      const res = await call('POST', path, body);
      assert.equal(res.status, 503, `${path}: ${JSON.stringify(res.json)}`);
      assert.equal(res.json.error.code, 'EXTERNAL_ACTIVATION_REQUIRED', path);
    }
  });
  assert.equal(domain._rows('diaspora_subscriptions').length, 0, 'no subscription truth was manufactured');
  assert.equal(domain._rows('diaspora_billing_provider_events').length, 0, 'no provider event was recorded');
});

// ═══ C3 — Sentry health ════════════════════════════════════════════════════════════════════════

test('C3: a configured DSN without an installed SDK is UNAVAILABLE, never enabled', () => {
  assert.equal(SENTRY_SDK_INSTALLED, false, 'no Sentry SDK is a dependency of this lineage');
  assert.deepEqual(sentryHealth({ SENTRY_DSN: 'https://public@example.invalid/1' }), {
    enabled: false, status: 'unavailable', sdk_installed: false, dsn_configured: true, reporting_to: 'structured_logger',
  });
  assert.deepEqual(sentryHealth({}), {
    enabled: false, status: 'not_configured', sdk_installed: false, dsn_configured: false, reporting_to: 'structured_logger',
  });
});

test('C3: /api/health reports the truthful Sentry state and never echoes the DSN', async () => {
  // server.js reads through the real client shape at import; undo the C2 route test's auth double.
  Object.defineProperty(supabase, 'from', { configurable: true, writable: true, value: originalFrom });
  const { app } = await import('../server.js');
  const dsn = 'https://public-key-should-not-echo@example.invalid/42';
  const body = await withEnv({ SENTRY_DSN: dsn }, async () => {
    const s = http.createServer(app).listen(0);
    try {
      await new Promise((r) => s.once('listening', r));
      const res = await fetch(`http://127.0.0.1:${s.address().port}/api/health`);
      return await res.json();
    } finally { await new Promise((r) => s.close(r)); }
  });
  assert.equal(body.sentry.enabled, false);
  assert.equal(body.sentry.status, 'unavailable');
  assert.equal(JSON.stringify(body).includes('public-key-should-not-echo'), false);
});
