/**
 * O2 — J-5: the workbook execute AUTHORITY, proved across the real Express router boundary.
 *
 * The I-round proof invoked `authorizeRole()` by hand and then called the candidate helper. That
 * shows the pieces agree; it does not show the deployed request path uses them. This drives real
 * HTTP into the REAL router, through the REAL `authorizeRole` middleware, into the REAL
 * `executeVehicleWorkbookImport` service, and asserts on the status the client actually receives.
 *
 * Nothing is stubbed except the database itself, and that double REFUSES to answer a dealership
 * query that is not scoped by BOTH user_id and tenant_id — so a resolver that asks a weaker
 * question fails here rather than passing.
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const express = (await import('express')).default;
const workbookRouter = (await import('../routes/workbookRoutes.js')).default;
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const { supabase } = await import('../db/supabase.js');

const DEALERSHIP = 'tenant-moyo-motors';
const GARAGE = 'tenant-garage-1';
const BATCH = 'batch-j5';

let db;
function resetDb() {
  db = {
    users: {
      'u-owner': { id: 'u-owner', role: 'owner', is_verified: true },
      'u-dealer': { id: 'u-dealer', role: 'dealer', is_verified: true },
      'u-dealer-garage': { id: 'u-dealer-garage', role: 'dealer', is_verified: true },
      'u-dealer-none': { id: 'u-dealer-none', role: 'dealer', is_verified: true },
      'u-admin': { id: 'u-admin', role: 'admin', is_verified: true },
    },
    // Generic organisational membership. NONE of this is selling authority.
    tenantUsers: {
      [`${DEALERSHIP}|u-dealer`]: { role: 'admin' },
      [`${GARAGE}|u-dealer-garage`]: { role: 'mechanic' },
      [`${GARAGE}|u-admin`]: { role: 'member' },
    },
    // The ONLY governed Dealer↔tenant binding.
    dealerProfiles: [{ id: 'dp-1', user_id: 'u-dealer', tenant_id: DEALERSHIP, suspension_state: 'none' }],
  };
}

function makeBuilder(table) {
  const f = {};
  let single = false;
  const chain = {
    select() { return chain; }, insert() { return chain; }, update() { return chain; }, delete() { return chain; },
    eq(k, v) { f[k] = v; return chain; }, neq() { return chain; }, is() { return chain; }, in() { return chain; },
    or() { return chain; }, order() { return chain; }, range() { return chain; }, limit() { return chain; },
    gte() { return chain; }, lte() { return chain; }, not() { return chain; },
    single() { single = true; return chain; }, maybeSingle() { single = true; return chain; },
    then(resolve, reject) {
      try { return Promise.resolve(resolve_(table, f, single)).then(resolve, reject); }
      catch (e) { return reject ? reject(e) : Promise.reject(e); }
    },
  };
  return chain;
}

function resolve_(table, f, single) {
  const ok = (data) => ({ data, error: null });
  const missing = (msg) => ({ data: null, error: { message: msg, code: 'PGRST116' } });
  switch (table) {
    case 'user_sessions': return missing('no session (this suite uses the x-user-id fallback)');
    case 'users': return db.users[f.id] ? ok(db.users[f.id]) : missing('user not found');
    case 'tenant_users': {
      const hit = db.tenantUsers[`${f.tenant_id}|${f.user_id}`];
      return hit ? ok(hit) : missing('no membership');
    }
    case 'dealer_profiles': {
      // A dealership query that does not scope BOTH dimensions is the J-3 defect. Refuse it.
      if (!('user_id' in f) || !('tenant_id' in f)) {
        return { data: null, error: { message: 'J-3: dealer binding must be scoped by user_id AND tenant_id' } };
      }
      const hit = db.dealerProfiles.find((p) => p.user_id === f.user_id && p.tenant_id === f.tenant_id);
      return hit ? ok(hit) : ok(null);
    }
    case 'diaspora_workbook_import_batches': {
      if (f.id !== BATCH) return ok([]);
      const batch = {
        id: BATCH, uploaded_by: f.uploaded_by, template_type: 'seller_vehicles',
        import_status: 'VALIDATED', tenant_id: null,
      };
      return single ? ok(batch) : ok([batch]);
    }
    case 'diaspora_workbook_import_rows': return ok([]); // gate-only proof: no rows to import
    default:
      if (single) return ok({ id: 'mock', metadata: {} });
      return ok([]);
  }
}

let server; let baseUrl;
before(async () => {
  resetDb();
  Object.defineProperty(supabase, 'from', { configurable: true, writable: true, value: (t) => makeBuilder(t) });
  Object.defineProperty(supabase, 'rpc', { configurable: true, writable: true, value: async () => ({ data: null, error: null }) });
  const app = express();
  app.use(express.json());
  app.use(workbookRouter);
  app.use(errorHandler);
  await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise((r) => server.close(r)); });
beforeEach(resetDb);

async function execute({ userId, tenantId, stakeholderRole } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (userId) headers['x-user-id'] = userId;
  if (tenantId) headers['x-tenant-id'] = tenantId;
  if (stakeholderRole) headers['x-stakeholder-role'] = stakeholderRole;
  const res = await fetch(`${baseUrl}/api/workbook/import-batches/${BATCH}/execute`, {
    method: 'POST', headers, body: JSON.stringify({ confirm: true }),
  });
  let body = {};
  try { body = await res.json(); } catch { /* empty body is fine */ }
  return { status: res.status, body };
}

const noSubject = (r) => r.status === 400 && /no_listing_subject/.test(JSON.stringify(r.body));

test('J-5: an OWNER executes under their own listing subject', async () => {
  const r = await execute({ userId: 'u-owner' });
  assert.equal(r.status, 200, `owner must reach execute, got ${r.status} ${JSON.stringify(r.body)}`);
});

test('J-5: a dealer with its OWN governed dealership executes', async () => {
  const r = await execute({ userId: 'u-dealer', tenantId: DEALERSHIP });
  assert.equal(r.status, 200, `governed dealership must reach execute, got ${r.status} ${JSON.stringify(r.body)}`);
});

test('J-5: a dealer with NO tenant is refused at the route — no listing subject', async () => {
  const r = await execute({ userId: 'u-dealer-none' });
  assert.ok(noSubject(r), `expected a no_listing_subject refusal, got ${r.status} ${JSON.stringify(r.body)}`);
});

test('J-5: a dealer whose only tenant is a GARAGE mechanic membership is refused', async () => {
  const r = await execute({ userId: 'u-dealer-garage', tenantId: GARAGE });
  assert.ok(noSubject(r),
    `membership in a garage is not a dealership; got ${r.status} ${JSON.stringify(r.body)}`);
});

test('J-5: a dealer sending a FOREIGN tenant is refused by the tenant gate (403)', async () => {
  const r = await execute({ userId: 'u-dealer-none', tenantId: DEALERSHIP });
  assert.equal(r.status, 403, 'no membership in that tenant at all');
});

test('J-5: a FORGED tenant id is refused (403) — it is validated, never trusted', async () => {
  const r = await execute({ userId: 'u-dealer', tenantId: 'tenant-does-not-exist' });
  assert.equal(r.status, 403);
});

test('J-5: an ADMIN with generic tenant membership has no listing subject', async () => {
  const r = await execute({ userId: 'u-admin', tenantId: GARAGE });
  assert.ok(noSubject(r), `got ${r.status} ${JSON.stringify(r.body)}`);
});

test('J-5: a FORGED x-user-id for a non-existent account is refused (401)', async () => {
  const r = await execute({ userId: 'u-ghost' });
  assert.equal(r.status, 401);
});

test('J-5: a dealer cannot escalate into the dealership by ASKING for a role', async () => {
  // x-stakeholder-role is a request, never a grant: the garage membership is 'mechanic', so
  // asking for 'dealer' inside the garage cannot manufacture a dealership there.
  const r = await execute({ userId: 'u-dealer-garage', tenantId: GARAGE, stakeholderRole: 'dealer' });
  assert.ok(noSubject(r) || r.status === 403, `got ${r.status} ${JSON.stringify(r.body)}`);
});

test('J-5: a WITHDRAWN dealership loses execute authority at the route', async () => {
  resetDb();
  db.dealerProfiles[0].suspension_state = 'suspended';
  const r = await execute({ userId: 'u-dealer', tenantId: DEALERSHIP });
  assert.ok(noSubject(r),
    `a suspended dealership must not still import under the tenant; got ${r.status} ${JSON.stringify(r.body)}`);
});
