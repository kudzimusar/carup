/**
 * OC-5R-PROV-01 Stage B — one security convergence family.
 *
 *   B1  One canonical deployed-runtime classifier (utils/runtimeEnvironment.js). No bypass may be
 *       opened by NODE_ENV alone when CARUP_ENV / VERCEL_ENV declares a deployment.
 *   B2  Webhook verification never yields to NODE_ENV=test in a deployment, and no committed
 *       fallback secret is a usable credential in one.
 *   B3  SafeTrade payment webhooks: wall-clock replay window, no committed key in a deployment, and
 *       the route fails UNAVAILABLE (never sandbox-verified, never reconciled) without a provider.
 *   B4  Escrow provider PATCH/initiate: an unrelated authenticated user cannot act on another escrow.
 *   B5  Eligibility/insurer/lender webhooks: the caller can never choose the verification key, and a
 *       signature for one capability cannot move another capability's request.
 *
 * Every deployment probe keeps NODE_ENV=test — the exact mis-configuration CarUp has already shipped.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const express = (await import('express')).default;
const { supabase } = await import('../db/supabase.js');
const runtime = await import('../utils/runtimeEnvironment.js');
const fixtureGuard = await import('../config/testFixtureGuard.js');
const { isUserIdFallbackAllowed } = await import('../middleware/authMiddleware.js');
const { isPasswordlessLoginAllowed } = await import('../utils/passwordAuth.js');
const { csrfMiddleware, generateCsrfToken } = await import('../middleware/securityMiddleware.js');
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const { assertVehicleOcrActor } = await import('../services/evidence/vehicleDocumentOcrService.js');
const { normalizeProviderBackedExtraction } = await import('../services/diaspora/diasporaDocumentService.js');
const { createStaticTokenProvider } = await import('../services/diaspora/drive/googleSecretManagerVault.js');
const { sellerAutomationFixtureScope } = await import('../routes/marketplaceRoutes.js');
const { CommunicationWebhookService } = await import('../services/communication/communicationWebhookService.js');
const { billingWebhookSecret } = await import('../constants/diaspora/diasporaBillingConstants.js');
const webhookSecurity = await import('../services/eligibility/webhookSecurity.js');
const escrowProvider = await import('../services/escrow/escrowProviderService.js');
const safeTrade = await import('../services/diaspora/safetrade/safeTradePaymentProvider.js');
const safeTradeRouter = (await import('../routes/diasporaSafeTradeRoutes.js')).default;
const escrowProviderRouter = (await import('../routes/escrowProviderRoutes.js')).default;
const eligibilityRouter = (await import('../routes/eligibilityRoutes.js')).default;
const eligibility = await import('../services/eligibility/eligibilityService.js');
const insurer = await import('../services/insurance/insurerWorkflow.js');
const lender = await import('../services/finance/lenderWorkflow.js');

// ── environment probes ──────────────────────────────────────────────────────────────────────────
const DEPLOYED = [
  { label: 'staging (CARUP_ENV)', env: { CARUP_ENV: 'staging' } },
  { label: 'Vercel preview', env: { VERCEL_ENV: 'preview' } },
  { label: 'Vercel production', env: { VERCEL_ENV: 'production' } },
  { label: 'production (CARUP_ENV)', env: { CARUP_ENV: 'production' } },
];
const MARKERS = ['CARUP_ENV', 'VERCEL_ENV'];

/** Run `fn` with the deployment markers cleared, then `overrides` applied (undefined deletes). */
async function withEnv(overrides, fn) {
  const keys = new Set([...MARKERS, ...Object.keys(overrides)]);
  const saved = {};
  for (const k of keys) saved[k] = process.env[k];
  for (const k of MARKERS) delete process.env[k];
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
}

const hmac = (secret, ts, payload) => crypto.createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');

function fakeRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}

// ── in-memory store for the route/service tests ─────────────────────────────────────────────────
let db;
let seq = 0;
const writes = [];
function run(st) {
  const ok = (data) => ({ data, error: null });
  const rows = (db[st.table] = db[st.table] || []);
  if (st.op !== 'select') writes.push({ table: st.table, op: st.op });
  if (st.op === 'insert') {
    const list = Array.isArray(st.payload) ? st.payload : [st.payload];
    const ins = list.map((p) => ({ id: p.id || `${st.table}-${++seq}`, created_at: p.created_at || new Date(Date.UTC(2026, 9, 7, 0, 0, seq)).toISOString(), ...p }));
    rows.push(...ins);
    return ok(st.single ? ins[0] : ins);
  }
  const match = (r) => Object.entries(st.filters).every(([k, v]) => r[k] === v);
  if (st.op === 'update') {
    const hit = rows.filter(match);
    hit.forEach((r) => Object.assign(r, st.payload));
    return ok(st.single ? hit[0] || null : hit);
  }
  let out = rows.filter(match);
  if (st.order) out = out.slice().sort((a, b) => (st.order.asc ? 1 : -1) * ((a[st.order.col] > b[st.order.col]) ? 1 : -1));
  if (st.limit) out = out.slice(0, st.limit);
  if (st.maybe) return ok(out[0] || null);
  if (st.single) return out[0] ? ok(out[0]) : { data: null, error: { message: 'not found', code: 'PGRST116' } };
  return ok(out);
}
function builder(table) {
  const st = { table, op: 'select', filters: {}, single: false, maybe: false, order: null, limit: null, payload: null };
  const chain = {
    select() { return chain; },
    insert(p) { st.op = 'insert'; st.payload = p; return chain; },
    update(p) { st.op = 'update'; st.payload = p; return chain; },
    eq(k, v) { st.filters[k] = v; return chain; },
    is() { return chain; }, in() { return chain; },
    order(c, o) { st.order = { col: c, asc: o?.ascending ?? false }; return chain; },
    limit(n) { st.limit = n; return chain; },
    single() { st.single = true; return chain; },
    maybeSingle() { st.maybe = true; return chain; },
    then(res, rej) { try { return Promise.resolve(run(st)).then(res, rej); } catch (e) { return rej ? rej(e) : Promise.reject(e); } },
  };
  return chain;
}
function install(seed = {}) {
  seq = 0;
  writes.length = 0;
  db = {
    users: [
      { id: 'buyer-1', role: 'buyer', is_verified: true },
      { id: 'seller-1', role: 'owner', is_verified: true },
      { id: 'stranger-1', role: 'buyer', is_verified: true },
      { id: 'dealer-9', role: 'dealer', is_verified: true },
      { id: 'admin-1', role: 'admin', is_verified: true },
    ],
    user_sessions: [], tenant_users: [],
    ...seed,
  };
  supabase.from = (t) => builder(t);
}

const servers = [];
async function serve(mount) {
  const app = express();
  mount(app);
  app.use(errorHandler);
  const server = await new Promise((resolve) => { const s = http.createServer(app); s.listen(0, '127.0.0.1', () => resolve(s)); });
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}
after(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); });

async function call(base, method, path, { userId, body, headers = {}, raw } = {}) {
  const h = { 'content-type': 'application/json', ...headers };
  if (userId) h['x-user-id'] = userId;
  const res = await fetch(`${base}${path}`, { method, headers: h, body: raw ?? (body ? JSON.stringify(body) : undefined) });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// B1 — one canonical classifier; NODE_ENV alone never opens a bypass in a deployment
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('B1: the fixture guard uses THE central deployed-runtime classifier, not a copy', () => {
  assert.equal(fixtureGuard.isDeployedRuntime, runtime.isDeployedRuntime);
  for (const { label, env } of DEPLOYED) {
    assert.equal(fixtureGuard.isTestRuntime({ NODE_ENV: 'test', ...env }), false, label);
    assert.equal(runtime.isFixtureRuntime({ NODE_ENV: 'test', ...env }), false, label);
  }
  assert.equal(fixtureGuard.isTestRuntime({ NODE_ENV: 'test' }), true);
});

test('B1: the x-user-id identity fallback is never inferred from NODE_ENV in any deployment', () => {
  for (const { label, env } of DEPLOYED) {
    for (const nodeEnv of ['test', 'development', 'local']) {
      assert.equal(isUserIdFallbackAllowed({ NODE_ENV: nodeEnv, ...env }), false, `${label} NODE_ENV=${nodeEnv}`);
    }
  }
  assert.equal(isUserIdFallbackAllowed({ NODE_ENV: 'test' }), true, 'local/CI unchanged');
  // Deliberately unchanged: the explicit, auditable opt-in (not a NODE_ENV inference).
  assert.equal(isUserIdFallbackAllowed({ CARUP_ALLOW_X_USER_ID_FALLBACK: 'true', CARUP_ENV: 'staging' }), true);
});

test('B1: passwordless (email-only) login is never inferred from NODE_ENV in any deployment', () => {
  for (const { label, env } of DEPLOYED) {
    for (const nodeEnv of ['test', 'development', 'local']) {
      assert.equal(isPasswordlessLoginAllowed({ NODE_ENV: nodeEnv, ...env }), false, `${label} NODE_ENV=${nodeEnv}`);
    }
  }
  assert.equal(isPasswordlessLoginAllowed({ NODE_ENV: 'test' }), true, 'local/CI unchanged');
  assert.equal(isPasswordlessLoginAllowed({ NODE_ENV: 'production' }), false);
  assert.equal(isPasswordlessLoginAllowed({ CARUP_ALLOW_PASSWORDLESS_LOGIN: 'true', CARUP_ENV: 'staging' }), true, 'explicit opt-in unchanged');
});

test('B1: the CSRF check is enforced in every deployment even under NODE_ENV=test', async () => {
  const attempt = () => {
    const req = { method: 'POST', headers: {}, originalUrl: '/api/vehicles/V1/claims', url: '/api/vehicles/V1/claims' };
    const res = fakeRes();
    let passed = false;
    csrfMiddleware(req, res, () => { passed = true; });
    return { passed, status: res.statusCode };
  };
  for (const { label, env } of DEPLOYED) {
    const out = await withEnv(env, async () => attempt());
    assert.equal(out.passed, false, `${label}: CSRF bypassed`);
    assert.equal(out.status, 403, label);
  }
  const local = await withEnv({}, async () => attempt());
  assert.equal(local.passed, true, 'the fixture runtime keeps its bypass');
});

test('B1: the committed CSRF signing secret is unusable in every deployment', async () => {
  for (const { label, env } of DEPLOYED) {
    await withEnv({ ...env, JWT_SECRET: undefined }, async () => {
      assert.throws(() => generateCsrfToken('u1', 's1'), /JWT_SECRET is required/, label);
    });
  }
  await withEnv({ JWT_SECRET: undefined }, async () => {
    assert.equal(typeof generateCsrfToken('u1', 's1'), 'string', 'the fixture runtime keeps its default');
  });
});

test('B1: error diagnostics are withheld in every deployment', async () => {
  const render = () => {
    const res = fakeRes();
    errorHandler(new Error('internal-diagnostic-detail'), { path: '/x', method: 'GET', headers: {} }, res, () => {});
    return res.body;
  };
  for (const { label, env } of DEPLOYED) {
    const body = await withEnv(env, async () => render());
    assert.equal(body.error.details, undefined, label);
  }
  const local = await withEnv({}, async () => render());
  assert.match(String(local.error.details), /internal-diagnostic-detail/);
});

test('B1: an ephemeral blockchain signing secret is refused in every deployment', async () => {
  for (const { label, env } of DEPLOYED) {
    await withEnv({ ...env, CARUP_BLOCKCHAIN_SIGNING_MASTER_SECRET: undefined }, async () => {
      const fresh = await import(`../services/blockchain/blockchainKeyCustodyService.js?b1-${label.replace(/\W+/g, '-')}`);
      assert.throws(() => fresh.custodyGeneration(), /CARUP_BLOCKCHAIN_SIGNING_MASTER_SECRET is required/, label);
    });
  }
  await withEnv({ CARUP_BLOCKCHAIN_SIGNING_MASTER_SECRET: undefined }, async () => {
    const fresh = await import('../services/blockchain/blockchainKeyCustodyService.js?b1-local');
    assert.match(fresh.custodyGeneration(), /^custody:/);
  });
});

test('B1: vehicle-document OCR demands a proven session in every deployment', async () => {
  const actor = { id: 'owner-1', role: 'owner' };
  for (const { label, env } of DEPLOYED) {
    await withEnv(env, async () => {
      assert.throws(() => assertVehicleOcrActor(actor), /proven authenticated session/, label);
      assert.deepEqual(assertVehicleOcrActor({ ...actor, authenticationMethod: 'session' }), { userId: 'owner-1', role: 'owner' });
    });
  }
  await withEnv({}, async () => assert.deepEqual(assertVehicleOcrActor(actor), { userId: 'owner-1', role: 'owner' }));
});

test('B1: a client-supplied extraction is never accepted in a deployment', async () => {
  const payload = { extraction_provider: 'client', extracted_fields: { vin: 'X' }, confidence_score: 0.99 };
  for (const { label, env } of DEPLOYED) {
    await withEnv(env, async () => assert.throws(() => normalizeProviderBackedExtraction(payload, null), undefined, label));
  }
  await withEnv({}, async () => assert.equal(normalizeProviderBackedExtraction(payload, null).extractionProvider, 'client'));
});

test('B1: a static vault token is refused in every deployment', async () => {
  for (const { label, env } of DEPLOYED) {
    await withEnv(env, async () => assert.throws(() => createStaticTokenProvider('tok'), /must never be used in production/, label));
  }
  await withEnv({}, async () => assert.equal(createStaticTokenProvider('tok').name, 'static'));
});

test('B1: the Seller automation fixture scope exists only in previews and the fixture runtime', async () => {
  const req = { query: { fixture_scope: 'seller-1-2' } };
  await withEnv({ CARUP_ENV: 'staging' }, async () => assert.equal(sellerAutomationFixtureScope(req), null));
  await withEnv({ VERCEL_ENV: 'production' }, async () => assert.equal(sellerAutomationFixtureScope(req), null));
  await withEnv({ VERCEL_ENV: 'preview' }, async () => assert.equal(sellerAutomationFixtureScope(req), 'seller-1-2'));
  await withEnv({}, async () => assert.equal(sellerAutomationFixtureScope(req), 'seller-1-2'));
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// B2 — webhook test seams and committed secrets are local/CI only
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('B2: an unsigned `{test:true}` communications webhook is refused in every deployment', () => {
  // ['generic', 'webchat'] used to reach a catch-all shared-secret branch; since G1 no inbound
  // provider may speak for web chat at all, in any runtime (see the communications boundary suite).
  const cases = [['sendgrid', 'email'], ['twilio', 'sms'], ['expo', 'push']];
  for (const { label, env } of DEPLOYED) {
    const svc = new CommunicationWebhookService({ env: { NODE_ENV: 'test', ...env } });
    for (const [provider, channel] of cases) {
      assert.equal(svc.verify(provider, channel, { headers: {}, body: { test: true } }), false, `${label} ${provider}`);
    }
  }
  const local = new CommunicationWebhookService({ env: { NODE_ENV: 'test' } });
  for (const [provider, channel] of cases) {
    assert.equal(local.verify(provider, channel, { headers: {}, body: { test: true } }), true, `fixture ${provider}`);
  }
  assert.equal(local.verify('generic', 'webchat', { headers: {}, body: { test: true } }), false, 'no provider speaks for web chat');
});

test('B2: the committed billing webhook key does not exist in any deployment', async () => {
  for (const { label, env } of DEPLOYED) {
    await withEnv({ ...env, DIASPORA_BILLING_WEBHOOK_SECRET: undefined }, async () => {
      assert.throws(() => billingWebhookSecret(), /DIASPORA_BILLING_WEBHOOK_SECRET is required/, label);
    });
  }
  await withEnv({ DIASPORA_BILLING_WEBHOOK_SECRET: undefined }, async () => assert.equal(billingWebhookSecret(), 'diaspora-billing-test-webhook-secret'));
});

test('B2: committed eligibility keys and the dev bypass are unusable in every deployment', async () => {
  const payload = '{"request_id":"r1","status":"eligible"}';
  const ts = String(Date.now());
  const forged = hmac('insurance-sandbox-hmac-secret', ts, payload);
  for (const { label, env } of DEPLOYED) {
    await withEnv({ ...env, INSURANCE_WEBHOOK_SECRET: undefined, WEBHOOK_DEV_BYPASS: '1' }, async () => {
      assert.equal(webhookSecurity.sign('insurance_sandbox', payload, ts), null, label);
      assert.equal(webhookSecurity.verifyWebhook('insurance_sandbox', payload, forged, ts).valid, false, `${label}: committed key accepted`);
      assert.equal(webhookSecurity.verifyWebhook('insurance_sandbox', payload, 'dev-bypass-sig', ts).valid, false, `${label}: dev bypass accepted`);
    });
  }
  await withEnv({ INSURANCE_WEBHOOK_SECRET: undefined, WEBHOOK_DEV_BYPASS: '1' }, async () => {
    assert.equal(webhookSecurity.verifyWebhook('insurance_sandbox', payload, forged, ts).valid, true);
    assert.equal(webhookSecurity.verifyWebhook('insurance_sandbox', payload, 'dev-bypass-sig', ts).reason, 'dev_bypass');
  });
});

test('B2: the committed escrow-provider webhook key is unusable in every deployment', async () => {
  const payload = '{"session_id":"s1"}';
  const ts = String(Date.now());
  const forged = hmac('escrow-provider-sandbox-hmac-secret', ts, payload);
  for (const { label, env } of DEPLOYED) {
    await withEnv({ ...env, ESCROW_PROVIDER_WEBHOOK_SECRET: undefined }, async () => {
      assert.equal(escrowProvider.signEscrowWebhook(payload, ts), null, label);
      assert.deepEqual(escrowProvider.verifyEscrowWebhook(payload, forged, ts), { valid: false, replay: false, reason: 'missing_secret' }, label);
    });
  }
  await withEnv({ ESCROW_PROVIDER_WEBHOOK_SECRET: undefined }, async () => assert.equal(escrowProvider.verifyEscrowWebhook(payload, forged, ts).valid, true));
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// B3 — SafeTrade payment webhooks
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const SANDBOX_RECORD_CLOCK = Date.parse('2026-06-21T00:00:00.000Z');

test('B3: the replay window is the wall clock — a delivery stamped at the sandbox record clock is stale', async () => {
  const sandbox = new safeTrade.SandboxPaymentProvider();
  const body = JSON.stringify({ id: 'evt-clock', type: 'hold.authorized', intentId: 'sbx_pi_1' });
  const secret = safeTrade.safeTradeWebhookSecret();
  const stale = await sandbox.verifyWebhook({ rawBody: body, signature: hmac(secret, SANDBOX_RECORD_CLOCK, body), timestamp: SANDBOX_RECORD_CLOCK });
  assert.equal(stale.verified, false);
  assert.equal(stale.reason, 'timestamp_drift');
  const freshTs = Date.now();
  const fresh = await sandbox.verifyWebhook({ rawBody: body, signature: hmac(secret, freshTs, body), timestamp: freshTs });
  assert.equal(fresh.verified, true);
  assert.equal(fresh.eventId, 'evt-clock');
});

test('B3: no deployment can verify with the committed SafeTrade key — an unconfigured secret is unavailable', async () => {
  const body = JSON.stringify({ id: 'evt-forged', type: 'release.captured', intentId: 'sbx_pi_1' });
  const ts = Date.now();
  const forged = hmac('safetrade-sandbox-webhook-secret', ts, body);
  for (const { label, env } of DEPLOYED) {
    await withEnv({ ...env, DIASPORA_SAFETRADE_WEBHOOK_SECRET: undefined }, async () => {
      assert.equal(safeTrade.safeTradeWebhookSecret(), null, label);
      const out = await new safeTrade.SandboxPaymentProvider().verifyWebhook({ rawBody: body, signature: forged, timestamp: ts });
      assert.equal(out.verified, false, label);
      assert.equal(out.reason, 'webhook_secret_unconfigured', label);
    });
  }
});

test('B3: in a deployment the payment webhook route answers 503 UNAVAILABLE and writes nothing', async () => {
  install();
  const base = await serve((app) => {
    app.use(express.json());
    app.use((req, _res, next) => { req.fixedTimestamp = '2026-06-21T00:00:00.000Z'; next(); });
    app.use('/api/diaspora', safeTradeRouter);
  });
  const body = { id: 'evt-deployed', type: 'release.captured', intentId: 'sbx_pi_1' };
  const ts = Date.now();
  const forged = hmac('safetrade-sandbox-webhook-secret', ts, JSON.stringify(body));
  for (const { label, env } of DEPLOYED) {
    writes.length = 0;
    const res = await withEnv({ ...env, DIASPORA_SAFETRADE_ENABLED: 'true', DIASPORA_SAFETRADE_WEBHOOK_SECRET: undefined }, () => call(base, 'POST', '/api/diaspora/safetrade/payment-webhook', {
      body, headers: { 'x-safetrade-signature': forged, 'x-safetrade-timestamp': String(ts) },
    }));
    assert.equal(res.status, 503, label);
    assert.equal(res.json.code, 'SAFETRADE_WEBHOOK_UNAVAILABLE', label);
    assert.deepEqual(writes, [], `${label}: nothing may be claimed or reconciled`);
  }
});

test('B3: a deployment WITH a configured webhook secret still has no provider — a correctly signed delivery is 503, never reconciled', async () => {
  // The case the secret guard alone cannot cover: staging holds DIASPORA_SAFETRADE_WEBHOOK_SECRET, a
  // delivery is signed with it and verifies — but CarUp runs no approved provider there, so it must
  // not be verified against the sandbox and reconciled into simulated payment truth.
  install();
  const base = await serve((app) => {
    app.use(express.json());
    app.use('/api/diaspora', safeTradeRouter);
  });
  const body = { id: 'evt-configured', type: 'release.captured', intentId: 'sbx_pi_1' };
  const ts = Date.now();
  const signedWithConfigured = hmac('configured-staging-webhook-secret', ts, JSON.stringify(body));
  for (const { label, env } of DEPLOYED) {
    writes.length = 0;
    const res = await withEnv({ ...env, DIASPORA_SAFETRADE_ENABLED: 'true', DIASPORA_SAFETRADE_WEBHOOK_SECRET: 'configured-staging-webhook-secret' }, () => call(base, 'POST', '/api/diaspora/safetrade/payment-webhook', {
      body, headers: { 'x-safetrade-signature': signedWithConfigured, 'x-safetrade-timestamp': String(ts) },
    }));
    assert.equal(res.status, 503, `${label}: ${JSON.stringify(res.json)}`);
    assert.equal(res.json.code, 'SAFETRADE_WEBHOOK_UNAVAILABLE', label);
    assert.deepEqual(writes, [], `${label}: nothing may be claimed or reconciled`);
  }
});

test('B3: a pinned request clock is a fixture-runtime facility only — elsewhere the wall clock decides', async () => {
  install();
  const base = await serve((app) => {
    app.use(express.json());
    app.use((req, _res, next) => { req.fixedTimestamp = '2026-06-21T00:00:00.000Z'; next(); });
    app.use('/api/diaspora', safeTradeRouter);
  });
  const body = { id: 'evt-pinned', type: 'hold.authorized', intentId: 'sbx_pi_1' };
  const pinned = Date.parse('2026-06-21T00:00:00.000Z');
  const sig = hmac('safetrade-sandbox-webhook-secret', pinned, JSON.stringify(body));
  // Local development: not deployed (sandbox allowed) but NOT the fixture runtime.
  const res = await withEnv({ NODE_ENV: 'development', DIASPORA_SAFETRADE_ENABLED: 'true', DIASPORA_SAFETRADE_WEBHOOK_SECRET: undefined }, () => call(base, 'POST', '/api/diaspora/safetrade/payment-webhook', {
    body, headers: { 'x-safetrade-signature': sig, 'x-safetrade-timestamp': String(pinned) },
  }));
  assert.equal(res.status, 401, 'a delivery stamped at the pinned clock is stale against the wall clock');
  assert.deepEqual(writes.filter((w) => w.op !== 'select'), []);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// B4 — escrow provider routes: participant authority
// ═══════════════════════════════════════════════════════════════════════════════════════════════

function escrowSeed() {
  return {
    escrow_trust_sessions: [{ id: 'sess-1', vin: 'V1', buyer_id: 'buyer-1', seller_id: 'seller-1', status: 'requested' }],
    escrow_trust_events: [{ id: 'ev-0', session_id: 'sess-1', from_status: 'provider:none', to_status: 'provider:funding', created_at: '2026-10-07T00:00:00.000Z' }],
  };
}
const providerEvents = () => db.escrow_trust_events.filter((e) => e.session_id === 'sess-1').length;

test('B4: an unrelated authenticated user cannot transition another escrow (403, nothing written)', async () => {
  install(escrowSeed());
  const base = await serve((app) => { app.use(express.json()); app.use(escrowProviderRouter); });
  for (const intruder of ['stranger-1', 'dealer-9']) {
    const before = providerEvents();
    const res = await call(base, 'PATCH', '/api/escrow/sess-1/provider/transition', { userId: intruder, body: { to_state: 'inspection' } });
    assert.equal(res.status, 403, intruder);
    assert.equal(res.json.code, 'ESCROW_PARTICIPANT_REQUIRED', intruder);
    assert.equal(providerEvents(), before, `${intruder}: no escrow event may be written`);
  }
});

test('B4: an unrelated user cannot initiate provider escrow on another session either', async () => {
  install(escrowSeed());
  const base = await serve((app) => { app.use(express.json()); app.use(escrowProviderRouter); });
  const before = providerEvents();
  const res = await call(base, 'POST', '/api/escrow/sess-1/provider/initiate', { userId: 'stranger-1', body: { provider_key: 'p', amount_cents: 100, currency: 'USD' } });
  assert.equal(res.status, 403);
  assert.equal(providerEvents(), before);
});

test('B4: the buyer and seller (and a privileged admin) keep their authority; an unknown escrow is 404', async () => {
  install(escrowSeed());
  const base = await serve((app) => { app.use(express.json()); app.use(escrowProviderRouter); });
  const buyer = await call(base, 'PATCH', '/api/escrow/sess-1/provider/transition', { userId: 'buyer-1', body: { to_state: 'inspection' } });
  assert.equal(buyer.status, 200, JSON.stringify(buyer.json));
  assert.equal(buyer.json.state, 'inspection');
  const seller = await call(base, 'PATCH', '/api/escrow/sess-1/provider/transition', { userId: 'seller-1', body: { to_state: 'dispute' } });
  assert.equal(seller.status, 200, JSON.stringify(seller.json));
  const admin = await call(base, 'PATCH', '/api/escrow/sess-1/provider/transition', { userId: 'admin-1', body: { to_state: 'refund' } });
  assert.equal(admin.status, 200, JSON.stringify(admin.json));
  const missing = await call(base, 'PATCH', '/api/escrow/nope/provider/transition', { userId: 'buyer-1', body: { to_state: 'inspection' } });
  assert.equal(missing.status, 404);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// B5 — server-owned webhook identity
// ═══════════════════════════════════════════════════════════════════════════════════════════════

function eligibilitySeed() {
  return {
    eligibility_requests: [
      { id: 'req-fin', capability: 'finance', vin: 'V1', status: 'pending', provider_id: 'finance_sandbox', mode: 'sandbox' },
      { id: 'req-ins', capability: 'insurance', vin: 'V1', status: 'pending', provider_id: 'insurance_sandbox', mode: 'sandbox', decision_inputs: { insurer_profile_id: 'ip-1' } },
    ],
    eligibility_decisions: [], eligibility_webhook_events: [], insurance_provider_decisions: [], finance_provider_decisions: [],
  };
}
const status = (id) => db.eligibility_requests.find((r) => r.id === id).status;
const signed = (secret, body) => {
  const payloadString = JSON.stringify(body);
  const timestamp = String(Date.now());
  return { payloadString, timestamp, signature: hmac(secret, timestamp, payloadString), body };
};

test('B5: verifyRouteWebhook — a caller-asserted provider can never select a different key', () => {
  const p = '{"a":1}';
  const ts = String(Date.now());
  const insuranceSig = hmac('insurance-sandbox-hmac-secret', ts, p);
  assert.equal(webhookSecurity.verifyRouteWebhook('finance_sandbox', 'insurance_sandbox', p, insuranceSig, ts).reason, 'provider_mismatch');
  assert.equal(webhookSecurity.verifyRouteWebhook('finance_sandbox', null, p, insuranceSig, ts).reason, 'bad_signature', 'the route key is used');
  assert.equal(webhookSecurity.verifyRouteWebhook('nope', null, p, insuranceSig, ts).reason, 'unknown_provider');
  assert.equal(webhookSecurity.verifyRouteWebhook('insurance_sandbox', 'insurance_sandbox', p, insuranceSig, ts).valid, true);
});

test('B5: eligibility webhooks — key is server-owned and a signature moves only its own capability', async () => {
  install(eligibilitySeed());
  const asInsurance = signed('insurance-sandbox-hmac-secret', { request_id: 'req-fin', status: 'eligible' });
  const named = await eligibility.ingestWebhook('finance', { ...asInsurance, providerId: 'insurance_sandbox' });
  assert.deepEqual([named.applied, named.reason, named.signature_valid], [false, 'provider_mismatch', false]);
  const unnamed = await eligibility.ingestWebhook('finance', { ...asInsurance });
  assert.deepEqual([unnamed.applied, unnamed.reason], [false, 'bad_signature']);
  assert.equal(status('req-fin'), 'pending');

  const crossCapability = await eligibility.ingestWebhook('finance', signed('finance-sandbox-hmac-secret', { request_id: 'req-ins', status: 'eligible' }));
  assert.deepEqual([crossCapability.applied, crossCapability.reason], [false, 'request_not_found_for_capability']);
  assert.equal(status('req-ins'), 'pending');

  const own = await eligibility.ingestWebhook('finance', signed('finance-sandbox-hmac-secret', { request_id: 'req-fin', status: 'eligible' }));
  assert.equal(own.applied, true);
  assert.equal(status('req-fin'), 'eligible');

  const unknown = await eligibility.ingestWebhook('escrow', signed('escrow-trust-sandbox-hmac-secret', { request_id: 'req-fin', status: 'eligible' }));
  assert.deepEqual([unknown.applied, unknown.reason], [false, 'unknown_capability']);
});

test('B5: the eligibility webhook route refuses an x-provider-id that names another key (401) and an unknown capability (404)', async () => {
  install(eligibilitySeed());
  const base = await serve((app) => { app.use(eligibilityRouter); });
  const d = signed('insurance-sandbox-hmac-secret', { request_id: 'req-fin', status: 'eligible' });
  const res = await call(base, 'POST', '/api/eligibility/finance/webhook', {
    raw: d.payloadString, headers: { 'x-provider-id': 'insurance_sandbox', 'x-signature': d.signature, 'x-timestamp': d.timestamp },
  });
  assert.equal(res.status, 401);
  assert.equal(res.json.reason, 'provider_mismatch');
  assert.equal(status('req-fin'), 'pending');
  const unknown = await call(base, 'POST', '/api/eligibility/escrow/webhook', { raw: d.payloadString, headers: { 'x-signature': d.signature, 'x-timestamp': d.timestamp } });
  assert.equal(unknown.status, 404);
});

test('B5: insurer webhooks — server-owned key, insurance requests only', async () => {
  install(eligibilitySeed());
  const asFinance = signed('finance-sandbox-hmac-secret', { request_id: 'req-ins', outcome: 'conditional', provider_reference: 'POL-1' });
  const named = await insurer.ingestInsurerWebhook({ ...asFinance, providerId: 'finance_sandbox' });
  assert.deepEqual([named.applied, named.reason], [false, 'provider_mismatch']);
  const cross = await insurer.ingestInsurerWebhook(signed('insurance-sandbox-hmac-secret', { request_id: 'req-fin', outcome: 'conditional', provider_reference: 'POL-1' }));
  assert.deepEqual([cross.applied, cross.reason], [false, 'request_not_found_for_capability']);
  assert.equal(status('req-fin'), 'pending');
});

test('B5: lender webhooks — server-owned key, finance requests only', async () => {
  install(eligibilitySeed());
  const asInsurance = signed('insurance-sandbox-hmac-secret', { request_id: 'req-fin', outcome: 'declined' });
  const named = await lender.ingestLenderWebhook({ ...asInsurance, providerId: 'insurance_sandbox' });
  assert.deepEqual([named.applied, named.reason], [false, 'provider_mismatch']);
  const cross = await lender.ingestLenderWebhook(signed('finance-sandbox-hmac-secret', { request_id: 'req-ins', outcome: 'declined' }));
  assert.deepEqual([cross.applied, cross.reason], [false, 'request_not_found_for_capability']);
  assert.equal(status('req-ins'), 'pending');
});
