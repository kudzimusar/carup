/**
 * CA-OWNER-02 — the Corporate management read-model routes through the SHIPPED app: real authMiddleware, real routes, the
 * real accepted Corporate SQL (PGlite) behind admission, and an in-memory world for every other table.
 *
 * Proven here:
 *   · GET /api/corporate/management/:area admits only through the frozen server decision + the destination capability:
 *     Governor A (platform admin governor) 200; Governor B (platform owner governor, governance capabilities only) 403
 *     naming the capability; no session 401; an unknown area 404;
 *   · the Overview carries the governance record (2 memberships / 4 assignments) and rule-backed attention; every response is
 *     no-store and read-only; the Platform area leaks no explanations or secrets;
 *   · nothing is written — not to the world, not to the Corporate tables.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

for (const method of ['log', 'info', 'warn', 'debug', 'error']) console[method] = () => {};
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
delete process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;
delete process.env.CORPORATE_MEMBERSHIP_SHADOW;
delete process.env.SESSION_AUTH_DATABASE_URL;

const { openDatabase, closeAll, seedGovernor, snapshot, OWNER } = await import('./helpers/corporateGovernanceDb.js');
const { createServiceClient } = await import('./helpers/pgliteSupabaseClient.js');
const { createSupabaseWorld, installSupabaseWorld } = await import('./helpers/inMemorySupabaseWorld.js');
const { app } = await import('../server.js');
const { supabase } = await import('../db/supabase.js');

after(closeAll);

const CORPORATE_TABLES = ['corporate_org_nodes', 'corporate_memberships', 'corporate_membership_events', 'corporate_permission_assignments', 'corporate_permission_assignment_events'];
const FUTURE = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

test('HTTP · /api/corporate/management/:area through the shipped app', async (t) => {
  const db = await openDatabase({ migrate: 'all' });
  await db.exec(`SET ROLE ${OWNER}; ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT;`);
  await seedGovernor(db, 'gov-a');
  await seedGovernor(db, 'gov-b');
  const pg = createServiceClient(db);
  const user = (id, role, name) => ({ id, name, email: `${id}@governors.invalid`, phone: '', role, is_verified: true, password_hash: 'not-a-real-hash' });
  const sess = (token, userId) => ({ id: `s-${token}`, token, user_id: userId, active_role: null, active_organization_id: null, is_valid: true, expires_at: FUTURE });
  const world = createSupabaseWorld({
    users: [user('gov-a', 'admin', 'Governor A'), user('gov-b', 'owner', 'Governor B'), { id: 'u_bbbbbbbbbbbbbbbb', email: 'rudo@gmail.com', name: 'Rudo Banda', role: 'owner' }],
    user_sessions: [sess('tok-a', 'gov-a'), sess('tok-b', 'gov-b')],
    tenants: [], tenant_users: [], trust_audit_events: [],
    vehicles: [], marketplace_inquiries: [], message_threads: [], messages: [], communication_audit_events: [], communication_sla_policies: [],
    notification_queue: [{ id: 1, status: 'dead_letter', channel: 'email', recipient_user_id: 'u_bbbbbbbbbbbbbbbb', created_at: '2026-08-17T00:00:00Z' }],
    verification_sessions: [{ id: 'v1', user_id: 'u_bbbbbbbbbbbbbbbb', status: 'submitted', workflow_phase: 'reviewer_action_required', submitted_at: '2026-10-10T00:00:00Z', created_at: '2026-10-10T00:00:00Z' }],
    domain_events: [],
  });
  const restore = installSupabaseWorld(supabase, world);
  const corporate = (name) => String(name).startsWith('corporate_');
  supabase.from = (table) => (corporate(table) ? pg.from(table) : world.client.from(table));
  supabase.rpc = (name, params) => (corporate(name) ? pg.rpc(name, params) : world.client.rpc(name, params));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { restore(); await new Promise((resolve) => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (route, token) => {
    const res = await fetch(`${base}${route}`, { headers: { 'x-bypass-rate-limit': 'true', ...(token ? { 'x-session-token': token } : {}) } });
    const text = await res.text(); let body; try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body, text, cacheControl: res.headers.get('cache-control') };
  };
  const writesBefore = world.writes.length;
  const sqlBefore = await snapshot(db, CORPORATE_TABLES);

  const A = await get('/api/corporate/management/overview', 'tok-a');
  assert.equal(A.status, 200, A.text);
  assert.equal(A.cacheControl, 'no-store');
  assert.equal(A.body.contract, 'carup.corporate_management.v1');
  assert.equal(A.body.read_only, true);
  // CA-OWNER-02-R3 (D3): every answer says how old its shared snapshot is and whether a refresh is running.
  assert.equal(typeof A.body.snapshot, 'object', A.text.slice(0, 200));
  assert.equal(A.body.snapshot.generated_at, A.body.generated_at);
  assert.equal(A.body.snapshot.stale, false);
  assert.equal(A.body.snapshot.refreshing, false);
  assert.equal(typeof A.body.snapshot.age_seconds, 'number');
  const governance = Object.fromEntries(A.body.sections.governance.map((f) => [f.id, f]));
  assert.equal(governance['corporate.governance.membership.active'].value, 2);
  assert.equal(governance['corporate.governance.assignment.active'].value, 4);
  assert.ok(Array.isArray(A.body.attention));
  assert.ok(A.body.attention.some((i) => i.id === 'attention:queue:trust.identity_verification'));

  // CA-OWNER-02-R3 (D3): the governance record is read for THIS request at THIS request's time — never at the shared
  // snapshot's, which may be minutes old while it is served during a refresh. The frozen projection decides "ACTIVE and
  // inside its effective window" at the time it is given, and dates the figures with it.
  await new Promise((resolve) => { setTimeout(resolve, 1_100); });
  const askedAt = Date.now();
  const A2 = await get('/api/corporate/management/overview', 'tok-a');
  assert.equal(A2.status, 200, A2.text);
  assert.equal(A2.body.snapshot.generated_at, A.body.snapshot.generated_at, 'the shared snapshot was served from the cache');
  assert.equal(A2.body.sections.governance.length, 2);
  for (const f of A2.body.sections.governance) {
    assert.ok(Date.parse(f.as_of) >= askedAt, `${f.id} is dated ${f.as_of}: before this request (${new Date(askedAt).toISOString()}), i.e. at the snapshot's time`);
  }

  const B = await get('/api/corporate/management/overview', 'tok-b');
  assert.equal(B.status, 403);
  assert.equal(B.body.code, 'CORPORATE_CAPABILITY_REQUIRED');
  assert.equal(B.body.capability, 'corporate.overview.read');

  assert.equal((await get('/api/corporate/management/overview')).status, 401);
  assert.equal((await get('/api/corporate/management/everything', 'tok-a')).status, 404);

  const P = await get('/api/corporate/management/platform', 'tok-a');
  assert.equal(P.status, 200, P.text);
  assert.equal(/explanations|webhookUrl|endpointsLatency|failuresByUrl|password|service_role_key/i.test(P.text), false);
  assert.ok(P.body.facts.find((f) => f.id === 'platform.certification_sessions'));

  for (const area of ['operations', 'trust', 'finance', 'growth', 'data-sources', 'report']) {
    const r = await get(`/api/corporate/management/${area}`, 'tok-a');
    assert.equal(r.status, 200, `${area}: ${r.text.slice(0, 200)}`);
    assert.equal(r.body.area, area);
  }

  assert.equal(world.writes.length, writesBefore, 'the read models write nothing to the world');
  assert.equal(await snapshot(db, CORPORATE_TABLES), sqlBefore, 'the read models write nothing to the Corporate tables');
});
