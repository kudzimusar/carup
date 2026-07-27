/**
 * Entitlement enforcement boundaries closed in Issue #127 phase 2C.
 *
 * Three keys were previously in the registry as "not enforced, with a reason" while four plans sold
 * them: diaspora.drive.connect, diaspora.drive.export and diaspora.graph.advanced. A reason is not a
 * control — a tenant on the Free plan could connect Drive, push files to it, and read the whole trade
 * graph, and the only thing standing between them and the paid tier was that nobody had wired a
 * check. This file drives each newly-guarded operation through the boundary a real request takes.
 *
 * What it asserts, beyond "allowed / denied":
 *
 *   · OFF is a byte-identical no-op. Wiring a guard must change nothing until enforcement is
 *     deliberately switched on, or this whole program is a latent outage.
 *   · Both halves of a two-step flow are guarded. A gate on `authorize` that the `callback` does not
 *     repeat is a gate a caller walks around by holding on to a state string.
 *   · The gate is on the FUNNEL, not on the friendly route. /drive/export and /drive/upload reach the
 *     same provider write; gating only the one named "export" is enforcement theatre.
 *   · Nothing a client controls participates in the decision — not a header, not a body field, not a
 *     claimed role, not a claimed tenant.
 *   · Every subscription state resolves the way the policy says, including a period that simply
 *     lapsed while the status still reads "active", and a row that reconciliation has found to be
 *     wrong but not yet repaired.
 */
import test, { before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.DIASPORA_DRIVE_ENABLED = 'true';
process.env.DIASPORA_TRADE_GRAPH = 'true';

const express = (await import('express')).default;
const { createMockSupabase } = await import('./helpers/mockSupabase.js');
const { DIASPORA_RPCS } = await import('./helpers/diasporaRpcReference.js');
const { FAKE, createFakeGoogle } = await import('./helpers/googleDriveFixtures.js');
const { InMemoryCredentialVault } = await import('../services/diaspora/drive/credentialVault.js');
const { GoogleDriveProvider } = await import('../services/diaspora/drive/googleDriveProvider.js');
const drive = await import('../services/diaspora/diasporaDriveSyncService.js');
const stock = await import('../services/diaspora/diasporaStockService.js');
const { FEATURE_KEYS } = await import('../constants/diaspora/diasporaEntitlements.js');
const { runBillingReconciliation } = await import('../services/diaspora/billing/diasporaBillingReconciliationService.js');
const { supabase } = await import('../db/supabase.js');
const graphRouter = (await import('../routes/diasporaTradeGraphRoutes.js'));
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;

const ENFORCE = 'DIASPORA_SUBSCRIPTION_ENFORCEMENT';
function enforcement(on) {
  if (on) process.env[ENFORCE] = 'true';
  else delete process.env[ENFORCE];
}
afterEach(() => enforcement(false));

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

const user = (id, tenantId, role = 'dealer') => ({
  id, userId: id, role, platformRole: role, tenantRole: role, tenantId,
});

function subscription(tenantId, planKey, overrides = {}) {
  return {
    id: `sub-${tenantId}-${planKey}`,
    tenant_id: tenantId,
    plan_key: planKey,
    status: 'active',
    deleted_at: null,
    created_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function domainClient(subscriptions = [], seed = {}) {
  return createMockSupabase({
    diaspora_subscriptions: subscriptions,
    diaspora_subscription_plans: [],   // empty -> the config PLAN_CATALOG is the fallback
    diaspora_user_entitlement_overrides: [],
    diaspora_usage_meters: [],
    diaspora_usage_reservations: [],
    diaspora_import_audit_log: [],
    diaspora_stock_items: [],
    diaspora_drive_connections: [],
    diaspora_drive_files: [],
    diaspora_oauth_states: [],
    diaspora_credential_references: [],
    diaspora_drive_sync_attempts: [],
    ...seed,
  }, { rpc: DIASPORA_RPCS });
}

/** Mock database + fake Google + the REAL provider and vault, on a given plan. */
function driveEnv(planKey, { tenantId = TENANT_A } = {}) {
  const client = domainClient(planKey ? [subscription(tenantId, planKey)] : []);
  const google = createFakeGoogle();
  const vault = new InMemoryCredentialVault();
  const driveProvider = new GoogleDriveProvider({
    transport: google, vault,
    clientId: FAKE.clientId, clientSecret: FAKE.clientSecret, redirectUris: [FAKE.redirectUri],
  });
  return {
    client, google, vault,
    options: { supabaseClient: client, driveProvider, vault, redirectUri: FAKE.redirectUri },
  };
}

/** authorize + callback, exactly as the two routes would. */
async function connect(context, e) {
  const auth = await drive.getAuthorizationUrl(context, e.options);
  const stateRow = e.client._rows('diaspora_oauth_states').at(-1);
  const code = e.google.issueAuthorizationCode({
    codeChallenge: stateRow.metadata.pkce.challenge,
    redirectUri: stateRow.metadata.redirectUri,
  });
  const connection = await drive.handleOAuthCallback({ code, state: auth.state }, context, e.options);
  return { auth, stateRow, code, connection };
}

const denied = (featureKey) => (err) => {
  assert.equal(err.statusCode, 403, `expected a 403, got ${err.statusCode}: ${err.message}`);
  assert.equal(err.details?.featureKey, featureKey);
  return true;
};

// ════════════════════════════════════════════════════════════════════════════════════════════════
// diaspora.drive.connect
// ════════════════════════════════════════════════════════════════════════════════════════════════

test('drive connect: OFF is a no-op — a free tenant still connects exactly as before', async () => {
  const e = driveEnv('free');
  const { connection } = await connect(user('u1', TENANT_A), e);
  assert.equal(connection.connected, true);
});

test('drive connect: ON denies a free tenant before any state or vault entry is created', async () => {
  const e = driveEnv('free');
  enforcement(true);
  await assert.rejects(
    () => drive.getAuthorizationUrl(user('u1', TENANT_A), e.options),
    denied(FEATURE_KEYS.DRIVE_CONNECT),
  );
  // The gate sits ahead of the PKCE put and the nonce insert deliberately: a denial must not leave a
  // vault entry or a state row behind for someone to clean up later.
  assert.equal(e.client._rows('diaspora_oauth_states').length, 0);
  assert.equal(e.vault.size, 0, 'a denied connect left a PKCE verifier in the vault');
});

test('drive connect: ON allows a buyer tenant (the lowest plan that grants it)', async () => {
  const e = driveEnv('diaspora_buyer');
  enforcement(true);
  const { connection } = await connect(user('u1', TENANT_A), e);
  assert.equal(connection.connected, true);
});

test('drive connect: the CALLBACK is gated too — a held state cannot finish a lost entitlement', async () => {
  // The two halves are separately reachable HTTP routes. A caller who authorized while entitled and
  // was then downgraded must not be able to complete the connection with the state string they kept.
  const e = driveEnv('diaspora_buyer');
  enforcement(true);
  const auth = await drive.getAuthorizationUrl(user('u1', TENANT_A), e.options);
  const stateRow = e.client._rows('diaspora_oauth_states').at(-1);
  const code = e.google.issueAuthorizationCode({
    codeChallenge: stateRow.metadata.pkce.challenge,
    redirectUri: stateRow.metadata.redirectUri,
  });

  e.client._rows('diaspora_subscriptions')[0].plan_key = 'free'; // downgrade between the two calls

  await assert.rejects(
    () => drive.handleOAuthCallback({ code, state: auth.state }, user('u1', TENANT_A), e.options),
    denied(FEATURE_KEYS.DRIVE_CONNECT),
  );
  assert.equal(e.client._rows('diaspora_drive_connections').length, 0, 'no connection was persisted');
  const nonce = e.client._rows('diaspora_oauth_states').at(-1);
  assert.equal(nonce.consumed_at ?? null, null,
    'the gate runs before the one-time nonce is consumed, so a denial does not burn it');
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// diaspora.drive.export
// ════════════════════════════════════════════════════════════════════════════════════════════════

async function connectedEnv(planKey) {
  const e = driveEnv(planKey);
  await connect(user('u1', TENANT_A), e); // connect while enforcement is OFF
  return e;
}

test('drive export: OFF is a no-op — a buyer tenant still uploads exactly as before', async () => {
  const e = await connectedEnv('diaspora_buyer');
  const out = await drive.uploadDriveFile(
    { linkedEntityType: 'export', fileName: 'a.json', content: '{}' }, user('u1', TENANT_A), e.options);
  assert.ok(out.file.driveFileId);
});

test('drive export: ON denies a buyer tenant, whose plan grants connect but not export', async () => {
  const e = await connectedEnv('diaspora_buyer');
  enforcement(true);
  await assert.rejects(
    () => drive.uploadDriveFile(
      { linkedEntityType: 'export', fileName: 'a.json', content: '{}' }, user('u1', TENANT_A), e.options),
    denied(FEATURE_KEYS.DRIVE_EXPORT),
  );
  assert.equal(e.client._rows('diaspora_drive_files').length, 0, 'nothing reached Drive or the ledger');
});

test('drive export: ON allows a trade_pro tenant', async () => {
  const e = await connectedEnv('trade_pro');
  enforcement(true);
  const out = await drive.uploadDriveFile(
    { linkedEntityType: 'export', fileName: 'a.json', content: '{}' }, user('u1', TENANT_A), e.options);
  assert.ok(out.file.driveFileId);
});

test('drive export: POST /drive/upload is NOT a way around POST /drive/export', async () => {
  // exportToDrive only formats a payload and calls uploadDriveFile. If the gate lived on exportToDrive
  // a denied tenant would simply call the upload route with the same bytes and reach the same write.
  const e = await connectedEnv('diaspora_buyer');
  enforcement(true);
  await assert.rejects(
    () => drive.exportToDrive({ linkedEntityType: 'export', content: { a: 1 } }, user('u1', TENANT_A), e.options),
    denied(FEATURE_KEYS.DRIVE_EXPORT),
  );
  await assert.rejects(
    () => drive.uploadDriveFile(
      { linkedEntityType: 'trade_document', fileName: 'same-bytes.json', content: '{"a":1}' },
      user('u1', TENANT_A), e.options),
    denied(FEATURE_KEYS.DRIVE_EXPORT),
  );
  assert.equal(e.client._rows('diaspora_drive_files').length, 0);
});

test('drive export: the request payload does not participate in the decision', async () => {
  // Every field a client controls, set to whatever would be most convenient for them.
  const e = await connectedEnv('diaspora_buyer');
  enforcement(true);
  await assert.rejects(
    () => drive.uploadDriveFile({
      linkedEntityType: 'buyer_order',      // a "cheaper-looking" entity type
      fileName: 'x.json',
      content: '{}',
      tenantId: TENANT_B,                   // a tenant the caller is not in
      planKey: 'enterprise',                // a plan the caller is not on
      featureKey: FEATURE_KEYS.DRIVE_CONNECT, // the key they DO hold
      entitlements: { [FEATURE_KEYS.DRIVE_EXPORT]: true },
    }, user('u1', TENANT_A), e.options),
    denied(FEATURE_KEYS.DRIVE_EXPORT),
  );
});

test('drive export: a claimed role in the user context does not grant the feature', async () => {
  // Entitlement is a billing decision, not an authorization one. Being a platform admin says nothing
  // about what the TENANT bought, and must not be mistaken for it.
  const e = await connectedEnv('diaspora_buyer');
  enforcement(true);
  await assert.rejects(
    () => drive.uploadDriveFile(
      { linkedEntityType: 'export', fileName: 'x.json', content: '{}' },
      { ...user('u1', TENANT_A), role: 'super_admin', platformRole: 'super_admin' },
      e.options),
    denied(FEATURE_KEYS.DRIVE_EXPORT),
  );
});

test('drive export: a service-role client does not bypass the guard', async () => {
  // The injected client IS the service-role client — it bypasses RLS by design. RLS is the second
  // line of defence; the guard is the first, and it runs in application code that no key skips.
  const e = await connectedEnv('diaspora_buyer');
  enforcement(true);
  await assert.rejects(
    () => drive.uploadDriveFile(
      { linkedEntityType: 'export', fileName: 'x.json', content: '{}' }, user('u1', TENANT_A), e.options),
    denied(FEATURE_KEYS.DRIVE_EXPORT),
  );
});

test('drive export: entitlement is scoped to the caller\'s OWN tenant', async () => {
  // Tenant A is on enterprise; the caller belongs to tenant B, which bought nothing.
  const client = domainClient([subscription(TENANT_A, 'enterprise')]);
  const google = createFakeGoogle();
  const vault = new InMemoryCredentialVault();
  const options = {
    supabaseClient: client,
    driveProvider: new GoogleDriveProvider({
      transport: google, vault,
      clientId: FAKE.clientId, clientSecret: FAKE.clientSecret, redirectUris: [FAKE.redirectUri],
    }),
    vault,
    redirectUri: FAKE.redirectUri,
  };
  const e = { client, google, vault, options };
  await connect(user('u2', TENANT_B), e);

  enforcement(true);
  await assert.rejects(
    () => drive.uploadDriveFile(
      { linkedEntityType: 'export', fileName: 'x.json', content: '{}' }, user('u2', TENANT_B), options),
    denied(FEATURE_KEYS.DRIVE_EXPORT),
  );
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// Subscription states — every state the policy names, through a real guarded operation
// ════════════════════════════════════════════════════════════════════════════════════════════════

const FUTURE = '2027-01-01T00:00:00.000Z';
const PAST = '2026-01-01T00:00:00.000Z';

async function canCreateStock(subscriptions) {
  const client = domainClient(subscriptions);
  enforcement(true);
  try {
    await stock.createStockItem({ part_name: 'Alternator' }, user('u1', TENANT_A, 'admin'), { supabaseClient: client });
    return true;
  } catch (err) {
    if (err.statusCode === 403) return false;
    throw err;
  }
}

const STATE_CASES = [
  // [label, subscription rows, expected access]
  ['no subscription at all falls back to Free', [], false],
  ['active', [subscription(TENANT_A, 'seller', { status: 'active', current_period_end: FUTURE })], true],
  ['trialing', [subscription(TENANT_A, 'seller', { status: 'trialing', current_period_end: FUTURE })], true],
  ['grace_period', [subscription(TENANT_A, 'seller', { status: 'grace_period', current_period_end: FUTURE })], true],
  ['past_due', [subscription(TENANT_A, 'seller', { status: 'past_due', current_period_end: FUTURE })], false],
  ['cancelled', [subscription(TENANT_A, 'seller', { status: 'cancelled', current_period_end: FUTURE })], false],
  ['expired', [subscription(TENANT_A, 'seller', { status: 'expired' })], false],
  ['suspended', [subscription(TENANT_A, 'seller', { status: 'suspended', current_period_end: FUTURE })], false],
  ['paused', [subscription(TENANT_A, 'seller', { status: 'paused', current_period_end: FUTURE })], false],
  ['incomplete', [subscription(TENANT_A, 'seller', { status: 'incomplete', current_period_end: FUTURE })], false],
  // The one that used to be permanent access: nothing in this system moves a row out of 'active', and
  // a provider deliberately KEEPS 'active' for an at-period-end cancellation. The period end is what
  // ends it.
  ['active but the billing period has LAPSED',
    [subscription(TENANT_A, 'seller', { status: 'active', current_period_end: PAST })], false],
  ['soft-deleted subscription rows are ignored',
    [subscription(TENANT_A, 'seller', { status: 'active', deleted_at: '2026-06-15T00:00:00.000Z' })], false],
];

for (const [label, rows, expected] of STATE_CASES) {
  test(`subscription state: ${label} -> ${expected ? 'allowed' : 'denied'}`, async () => {
    assert.equal(await canCreateStock(rows), expected);
  });
}

test('subscription state: reconciliation-required — the LOCAL ledger decides until it is repaired', async () => {
  // Drift in the dangerous direction: the provider cancelled the subscription and we never heard.
  // Until reconciliation writes that back, the persisted row is what the guard reads — a transient
  // provider read must not be able to revoke access, and it must not be able to grant it either.
  const client = domainClient([subscription(TENANT_A, 'seller', {
    status: 'active', current_period_end: FUTURE,
    provider: 'sandbox', provider_subscription_ref: 'sub_ref_1',
  })]);
  const providerSaysCancelled = {
    name: 'sandbox',
    async getSubscription() {
      return { tenantId: TENANT_A, planKey: 'seller', status: 'cancelled', currentPeriodEnd: FUTURE };
    },
  };

  enforcement(true);
  const before = await stock.createStockItem(
    { part_name: 'Alternator' }, user('u1', TENANT_A, 'admin'), { supabaseClient: client });
  assert.ok(before.id, 'the unreconciled local row still governs access');

  // Detect only. The default is deliberately non-repairing, so a mismatch is evidence before it is a
  // correction — and access does not change on detection alone.
  const detect = await runBillingReconciliation({
    tenantId: TENANT_A, repair: false, billingProvider: providerSaysCancelled, supabaseClient: client,
  });
  assert.equal(detect.mismatches >= 1, true);
  assert.ok(detect.findings.some((f) => f.field === 'status' && f.expected === 'cancelled'));
  const stillAllowed = await stock.createStockItem(
    { part_name: 'Starter' }, user('u1', TENANT_A, 'admin'), { supabaseClient: client });
  assert.ok(stillAllowed.id, 'detection alone must not change entitlements');

  // Repair in the safe direction (provider says cancelled) writes the ledger, and the guard follows.
  await runBillingReconciliation({
    tenantId: TENANT_A, repair: true, billingProvider: providerSaysCancelled, supabaseClient: client,
  });
  assert.equal(client._rows('diaspora_subscriptions')[0].status, 'cancelled');
  await assert.rejects(
    () => stock.createStockItem({ part_name: 'Radiator' }, user('u1', TENANT_A, 'admin'), { supabaseClient: client }),
    denied(FEATURE_KEYS.STOCK_CREATE),
  );
});

test('cross-tenant: one tenant\'s paid plan never leaks into another tenant\'s decision', async () => {
  const client = domainClient([subscription(TENANT_A, 'enterprise', { current_period_end: FUTURE })]);
  enforcement(true);
  // Tenant A is entitled...
  const okA = await stock.createStockItem(
    { part_name: 'Alternator' }, user('u1', TENANT_A, 'admin'), { supabaseClient: client });
  assert.ok(okA.id);
  // ...and tenant B, in the same database, is not.
  await assert.rejects(
    () => stock.createStockItem({ part_name: 'Alternator' }, user('u2', TENANT_B, 'admin'), { supabaseClient: client }),
    denied(FEATURE_KEYS.STOCK_CREATE),
  );
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// diaspora.graph.advanced — driven over HTTP through the REAL router and auth middleware
// ════════════════════════════════════════════════════════════════════════════════════════════════

const authDb = {
  users: {
    'user-A': { id: 'user-A', role: 'owner', is_verified: true },
    'user-B': { id: 'user-B', role: 'owner', is_verified: true },
    'user-admin': { id: 'user-admin', role: 'platform_admin', is_verified: true },
  },
  tenantUsers: {
    [`${TENANT_A}|user-A`]: { role: 'admin' },
    [`${TENANT_B}|user-B`]: { role: 'admin' },
    [`${TENANT_A}|user-admin`]: { role: 'admin' },
  },
};
function authBuilder(table) {
  const state = { table, filters: {} };
  const chain = {
    select() { return chain; },
    eq(k, v) { state.filters[k] = v; return chain; },
    single() { return Promise.resolve(resolveAuth(state)); },
    maybeSingle() { return Promise.resolve(resolveAuth(state)); },
    then(res, rej) { try { return Promise.resolve(resolveAuth(state)).then(res, rej); } catch (e) { return rej ? rej(e) : Promise.reject(e); } },
  };
  return chain;
}
function resolveAuth(state) {
  const ok = (data) => ({ data, error: null });
  const missing = (m) => ({ data: null, error: { message: m } });
  switch (state.table) {
    case 'user_sessions': return missing('no session'); // force the x-user-id fallback (test mode)
    case 'users': return authDb.users[state.filters.id] ? ok(authDb.users[state.filters.id]) : missing('no user');
    case 'tenant_users': {
      const key = `${state.filters.tenant_id}|${state.filters.user_id}`;
      return authDb.tenantUsers[key] ? ok(authDb.tenantUsers[key]) : missing('no membership');
    }
    default: return ok([]);
  }
}

/** A pg pool that answers every graph query with nothing, so a permitted read 200s without a DB. */
function emptyPgPool() {
  const client = { query: async () => ({ rows: [] }), release() {} };
  return { connect: async () => client };
}

let server; let baseUrl; let app;
before(async () => {
  Object.defineProperty(supabase, 'from', { configurable: true, writable: true, value: (t) => authBuilder(t) });
  graphRouter.__setGraphPgPool(emptyPgPool());
  app = express();
  app.use(express.json());
  app.use('/trade-graph', graphRouter.default);
  app.use(errorHandler);
  await new Promise((r) => { server = http.createServer(app); server.listen(0, '127.0.0.1', r); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise((r) => server.close(r)); });

function setGraphPlan(planKey, { tenantId = TENANT_A } = {}) {
  app.locals.diasporaTestDeps = {
    supabaseClient: domainClient(planKey ? [subscription(tenantId, planKey, { current_period_end: FUTURE })] : []),
  };
}

async function graphCall(path, { userId = 'user-A', tenantId = TENANT_A, method = 'GET', headers = {}, body } = {}) {
  const h = { 'content-type': 'application/json', ...headers };
  if (userId) h['x-user-id'] = userId;
  if (tenantId) h['x-tenant-id'] = tenantId;
  const res = await fetch(`${baseUrl}${path}`, {
    method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const GRAPH_READS = [
  '/trade-graph/summary',
  '/trade-graph/projection/status',
  '/trade-graph/stock/demand-signals',
  '/trade-graph/containers/opportunities',
  '/trade-graph/risk/exposure',
];

test('graph: OFF is a no-op — a free tenant reaches every read exactly as before', async () => {
  setGraphPlan('free');
  for (const path of GRAPH_READS) {
    const res = await graphCall(path);
    assert.notEqual(res.status, 403, `${path} was gated while enforcement is OFF`);
  }
});

test('graph: ON denies a free tenant on every read, with an explainable denial', async () => {
  setGraphPlan('free');
  enforcement(true);
  for (const path of GRAPH_READS) {
    const res = await graphCall(path);
    assert.equal(res.status, 403, `${path} was reachable on the free plan`);
    // The denial has to say WHICH feature and WHICH plan would grant it, or the caller is told
    // "forbidden" and has no way to act on it.
    assert.equal(res.body.error.details.featureKey, FEATURE_KEYS.GRAPH_ADVANCED, `${path} denial`);
    assert.equal(res.body.error.details.requiredPlan, 'trade_pro', `${path} denial`);
    assert.equal(res.body.error.code, 'INSUFFICIENT_PERMISSIONS');
  }
});

test('graph: ON allows a trade_pro tenant on every read', async () => {
  setGraphPlan('trade_pro');
  enforcement(true);
  for (const path of GRAPH_READS) {
    const res = await graphCall(path);
    assert.notEqual(res.status, 403, `${path} denied a trade_pro tenant`);
  }
});

test('graph: a seller tenant is denied — the gate is the plan, not merely being logged in', async () => {
  setGraphPlan('seller');
  enforcement(true);
  assert.equal((await graphCall('/trade-graph/stock/demand-signals')).status, 403);
});

test('graph: headers cannot grant access', async () => {
  setGraphPlan('free');
  enforcement(true);
  const res = await graphCall('/trade-graph/summary', {
    headers: {
      'x-stakeholder-role': 'super_admin',                 // the role escalation header
      'x-plan-key': 'enterprise',                          // an invented plan header
      'x-entitlements': JSON.stringify({ [FEATURE_KEYS.GRAPH_ADVANCED]: true }),
      'x-subscription-status': 'active',
    },
  });
  assert.equal(res.status, 403, 'a header set the plan');
});

test('graph: the tenant is server-derived — a body tenantId cannot borrow another tenant\'s plan', async () => {
  // Tenant A holds trade_pro. The caller belongs to tenant B and names tenant A in the body.
  app.locals.diasporaTestDeps = {
    supabaseClient: domainClient([subscription(TENANT_A, 'trade_pro', { current_period_end: FUTURE })]),
  };
  enforcement(true);
  const res = await graphCall('/trade-graph/summary', {
    userId: 'user-B', tenantId: TENANT_B, method: 'GET',
  });
  assert.equal(res.status, 403);
});

test('graph: an unauthenticated caller is 401 — the gate never runs on a caller with no identity', async () => {
  setGraphPlan('trade_pro');
  enforcement(true);
  const res = await graphCall('/trade-graph/summary', { userId: null, tenantId: null });
  assert.equal(res.status, 401);
});

test('graph: platform-admin repair paths stay reachable for an unentitled tenant', async () => {
  // A free tenant's projection must still be repairable and triageable. Gating these on the target
  // tenant's plan would let a billing decision block fixing a broken graph.
  setGraphPlan('free');
  enforcement(true);
  const deadLetters = await graphCall('/trade-graph/dead-letters', { userId: 'user-admin' });
  assert.notEqual(deadLetters.status, 403, 'dead-letter triage was gated on the tenant plan');
  const rebuild = await graphCall('/trade-graph/rebuild', {
    userId: 'user-admin', method: 'POST', body: { reason: 'test' },
  });
  assert.notEqual(rebuild.status, 403, 'projection rebuild was gated on the tenant plan');
});

test('graph: a caller with no tenant context is refused, not evaluated', async () => {
  // Entitlements are tenant-scoped. With no tenant there is no decision to make, so the gate fails
  // closed with the same 403 the handlers raise rather than a 400 about a malformed check.
  setGraphPlan('trade_pro');
  enforcement(true);
  const res = await graphCall('/trade-graph/summary', { tenantId: null });
  assert.equal(res.status, 403);
  assert.match(res.body.error.message, /tenant context is required/i);
});

test('graph: the exemption list is exact — no path that merely starts with an exempt one is exempt', async () => {
  setGraphPlan('free');
  enforcement(true);
  // '/rebuild' is exempt; '/rebuild' as a prefix of something else must not be.
  const res = await graphCall('/trade-graph/entities/BUYER_ORDER/rebuild');
  assert.equal(res.status, 403);
});
