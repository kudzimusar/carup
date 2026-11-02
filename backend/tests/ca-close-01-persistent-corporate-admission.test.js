/**
 * CA-CLOSE-01 — F2 persistent Corporate admission + F1 People & Access projection, against the REAL accepted Corporate SQL.
 *
 * Part A runs the two services against PGlite 17 carrying the accepted Phase A + B + C migrations (applied by a non-superuser
 * owner, with Supabase's default privileges reproduced), called exactly as the backend calls them: service_role through a
 * Supabase-shaped client. The trusted evaluator answering every question is the real corporate_authority_evaluate.
 *
 * Part B runs the SHIPPED app (real authMiddleware, real routes): identity and sessions come from the in-memory world, and every
 * corporate_* table and RPC is served by the same real-SQL database — so the HTTP path is proven to reach the real evaluator.
 *
 * Proven here:
 *   · admission = session + ACTIVE membership + a persistent assignment confirmed by the evaluator; users.role alone admits nobody;
 *   · a platform OWNER governor is admitted; a platform ADMIN without a membership is refused;
 *   · the legacy compatibility only ADDS read navigation to an admitted platform administrator, never admits, never adds governance;
 *   · non-ACTIVE / out-of-window assignments and bare memberships admit nobody; forged identity and dead sessions are 401;
 *   · anything unreadable fails closed (503) and grants nothing;
 *   · the People & Access projection shows exactly the ACTIVE memberships and assignments the actor governs, truthfully, with no
 *     secret, scoped by the evaluator; it and the decision write nothing.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

for (const method of ['log', 'info', 'warn', 'debug', 'error']) console[method] = () => {};

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
delete process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;
delete process.env.CORPORATE_MEMBERSHIP_SHADOW;

const {
  openDatabase, closeAll, seedGovernor, seedMembership, seedAssignment, ensureUsers, snapshot, backdate, MANAGE, REVOKE_SESSIONS, ROOT_NODE, OWNER,
} = await import('./helpers/corporateGovernanceDb.js');
const { createServiceClient } = await import('./helpers/pgliteSupabaseClient.js');
const { createSupabaseWorld, installSupabaseWorld } = await import('./helpers/inMemorySupabaseWorld.js');
const access = await import('../services/corporate/corporateAccessService.js');
const { projectCorporatePeopleAccess, PEOPLE_ACCESS_CONTRACT } = await import('../services/corporate/corporatePeopleAccessService.js');
const { app } = await import('../server.js');
const { supabase } = await import('../db/supabase.js');

after(closeAll);

const CORPORATE_TABLES = ['corporate_org_nodes', 'corporate_memberships', 'corporate_membership_events', 'corporate_permission_assignments', 'corporate_permission_assignment_events'];
const session = (id, platformRole) => ({ id, platformRole, authenticationMethod: 'session' });
const GOV_CAPS = [MANAGE, REVOKE_SESSIONS].sort();

/** A real-SQL Corporate database; `name` is added to users as TEST INFRASTRUCTURE (production users carry a display name). */
async function database() {
  const db = await openDatabase({ migrate: 'all' });
  await db.exec(`SET ROLE ${OWNER}; ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT;`);
  return db;
}
const named = (db, id, name) => db.query('UPDATE users SET name = $2, email = $3 WHERE id = $1', [id, name, `${id}@governors.invalid`]);

/** The two governors exactly as staging holds them: one membership each at the root, manage + revoke over the whole tree. */
async function governorWorld() {
  const db = await database();
  const a = await seedGovernor(db, 'gov-a');
  const b = await seedGovernor(db, 'gov-b');
  await named(db, 'gov-a', 'Governor A'); await named(db, 'gov-b', 'Governor B');
  return { db, client: createServiceClient(db), a, b };
}

// ══ Part A · the services against the real SQL ═══════════════════════════════════════════════════════════════════════════════

let G; // the governor world, shared by the read-only tests of part A
before(async () => { G = await governorWorld(); });

test('F2 · a governor who is a platform ADMINISTRATOR is admitted by persistent authority; the compatibility only adds read navigation', async () => {
  const d = await access.evaluateCorporateAccess(session('gov-a', 'admin'), { supabaseClient: G.client });
  assert.equal(d.status, 200);
  assert.equal(d.allowed, true);
  assert.equal(d.body.contract, 'carup.corporate_access.v2');
  const g = d.body.grant;
  assert.equal(g.source, 'persistent_corporate_authority');
  assert.equal(g.read_only, true);
  assert.deepEqual(g.governance_capabilities, GOV_CAPS);
  assert.deepEqual(g.memberships.map((m) => [m.membership_id, m.org_node_id]), [[G.a.membershipId, ROOT_NODE]]);
  assert.deepEqual(g.assignments.map((x) => x.assignment_id).sort(), [G.a.manageId, G.a.revokeId].sort());
  for (const x of g.assignments) {
    assert.deepEqual(x.scope_node_ids, [ROOT_NODE]);
    assert.equal(x.include_descendants, true);
    assert.equal(x.assurance_floor, 'A1_RECENT_REAUTH');
  }
  // the bounded compatibility: labelled separately, read-only, exactly the sixteen navigation reads, no governance capability
  assert.deepEqual(g.compatibility, { source: 'legacy_admin_compatibility_bridge', read_only: true, bounded_by: 'admitted_corporate_member', capabilities: [...access.CORPORATE_COMPATIBILITY_READ_CAPABILITIES] });
  assert.deepEqual(g.capabilities, [...access.CORPORATE_COMPATIBILITY_READ_CAPABILITIES]);
  for (const c of g.capabilities) {
    assert.match(c, /^(corporate|platform)\.[a-z_]+(\.[a-z_]+)*\.read$/, c);
    assert.doesNotMatch(c, /\*|manage|approve|publish|export|delete|write|deploy|configure|create|update|revoke|delegate|generate/, c);
  }
  assert.match(g.explanation, /persistent Corporate permission assignments/);
  assert.match(g.explanation, /bounded compatibility/);
  // the grant names no account, e-mail, token or secret
  assert.doesNotMatch(JSON.stringify(d.body), /gov-a|gov-b|@|token|password|hash/i);
});

test('F2 · a governor whose platform role is OWNER is admitted by persistent authority alone — no compatibility, no read navigation', async () => {
  const d = await access.evaluateCorporateAccess(session('gov-b', 'owner'), { supabaseClient: G.client });
  assert.equal(d.status, 200);
  const g = d.body.grant;
  assert.equal(g.source, 'persistent_corporate_authority');
  assert.deepEqual(g.governance_capabilities, GOV_CAPS);
  assert.equal(g.compatibility, null);
  assert.deepEqual(g.capabilities, []);
  assert.doesNotMatch(g.explanation, /compatibility/);
  assert.deepEqual(g.memberships.map((m) => m.membership_id), [G.b.membershipId]);
});

test('F2 · users.role alone admits nobody: platform administrators WITHOUT a membership are refused', async () => {
  await ensureUsers(G.db, ['adm-nonmember']);
  for (const role of access.CORPORATE_COMPATIBILITY_PLATFORM_ROLES) {
    const d = await access.evaluateCorporateAccess(session('adm-nonmember', role), { supabaseClient: G.client });
    assert.equal(d.status, 403, role);
    assert.equal(d.body.code, 'CORPORATE_ACCESS_DENIED', role);
    assert.equal(d.body.decision, 'denied');
    assert.equal(d.body.grant, undefined);
    assert.doesNotMatch(JSON.stringify(d.body), /corporate\.[a-z_]+\.[a-z_.]+|legacy_admin_compatibility_bridge|persistent_corporate_authority/, `${role}: no capability or grant material in a denial`);
  }
});

test('F2 · an identity that is not session-proven is never evaluated (401)', async () => {
  for (const ctx of [null, undefined, {}, { id: 'gov-a', platformRole: 'admin' }, { id: 'gov-a', platformRole: 'admin', authenticationMethod: 'x-user-id-fallback' }, { id: '', authenticationMethod: 'session' }]) {
    const d = await access.evaluateCorporateAccess(ctx, { supabaseClient: G.client });
    assert.equal(d.status, 401, JSON.stringify(ctx));
    assert.equal(d.body.code, 'CORPORATE_SESSION_REQUIRED');
  }
});

test('F2 · fail closed: an unreadable membership store, assignment store or evaluator grants nothing (503)', async () => {
  for (const fault of ['select:corporate_memberships', 'select:corporate_org_nodes', 'select:corporate_permission_assignment_effective']) {
    const d = await access.evaluateCorporateAccess(session('gov-a', 'admin'), { supabaseClient: createServiceClient(G.db, { faults: new Set([fault]) }) });
    assert.equal(d.status, 503, fault);
    assert.equal(d.body.code, 'CORPORATE_AUTHORITY_UNAVAILABLE', fault);
    assert.equal(d.body.grant, undefined, fault);
  }
  const broken = createServiceClient(G.db, { beforeRpc: async () => { throw new Error('evaluator down'); } });
  assert.equal((await access.evaluateCorporateAccess(session('gov-a', 'admin'), { supabaseClient: broken })).status, 503, 'evaluator unreachable');
  // an evaluator answer that is not exactly the answer to the question asked is unreadable, never a grant
  const real = createServiceClient(G.db);
  const tampered = {
    from: (t) => real.from(t),
    rpc: async (name, params) => { const r = await real.rpc(name, params); return r.data ? { ...r, data: { ...r.data, actor_user_id: 'someone-else' } } : r; },
  };
  assert.equal((await access.evaluateCorporateAccess(session('gov-a', 'admin'), { supabaseClient: tampered })).status, 503, 'tampered evaluator answer');
});

test('F2 · a membership alone, or an assignment that is not ACTIVE-and-effective, admits nobody — whatever the platform role', async () => {
  const db = await database();
  const client = createServiceClient(db);
  await seedMembership(db, 'member-only', 'BU_MARKETPLACE');
  for (const role of ['admin', 'owner']) {
    assert.equal((await access.evaluateCorporateAccess(session('member-only', role), { supabaseClient: client })).status, 403, `bare membership (${role})`);
  }
  for (const finalState of ['REQUESTED', 'APPROVED', 'SUSPENDED', 'REVOKED', 'EXPIRED']) {
    const subject = `holder-${finalState.toLowerCase()}`;
    const membershipId = await seedMembership(db, subject, ROOT_NODE);
    await seedAssignment(db, { subject, membershipId, capability: MANAGE, finalState });
    const d = await access.evaluateCorporateAccess(session(subject, 'admin'), { supabaseClient: client });
    assert.equal(d.status, 403, finalState);
    assert.equal(d.body.code, 'CORPORATE_ACCESS_DENIED', finalState);
  }
  // an ACTIVE assignment whose MEMBERSHIP is no longer ACTIVE admits nobody either
  const endedMembership = await seedMembership(db, 'holder-ended-membership', ROOT_NODE);
  await seedAssignment(db, { subject: 'holder-ended-membership', membershipId: endedMembership, capability: MANAGE });
  await backdate(db, "UPDATE corporate_memberships SET state = 'SUSPENDED', updated_by_kind = 'SYSTEM', updated_reason = 'fixture suspension' WHERE membership_id = $1", [endedMembership]);
  assert.equal((await access.evaluateCorporateAccess(session('holder-ended-membership', 'admin'), { supabaseClient: client })).status, 403, 'suspended membership');
});

test('F2 · the ACTIVE-membership requirement stands on its own: assignment rows without a resolvable membership admit nobody', async () => {
  // The effective view already joins an ACTIVE membership, which would MASK a missing first-line check. Split the reads: the
  // assignment view still answers with the governor's rows while the membership store answers "none" — admission must refuse.
  const real = createServiceClient(G.db);
  const noMembership = {
    rpc: (name, params) => real.rpc(name, params),
    from: (table) => (table === 'corporate_memberships'
      ? { select() { return this; }, eq() { return this; }, abortSignal() { return this; }, then: (resolve) => resolve({ data: [], error: null }) }
      : real.from(table)),
  };
  for (const role of ['admin', 'owner']) {
    const d = await access.evaluateCorporateAccess(session('gov-a', role), { supabaseClient: noMembership });
    assert.equal(d.status, 403, role);
    assert.equal(d.body.code, 'CORPORATE_ACCESS_DENIED', role);
  }
});

test('F2/F1 · a member holding only session-revoke is admitted with that capability alone, and is refused the People & Access rows', async () => {
  const db = await database();
  const client = createServiceClient(db);
  const membershipId = await seedMembership(db, 'revoker', 'BU_SERVICE_NETWORK');
  await seedAssignment(db, { subject: 'revoker', membershipId, capability: REVOKE_SESSIONS, nodes: ['BU_SERVICE_NETWORK'], includeDescendants: false });
  const d = await access.evaluateCorporateAccess(session('revoker', 'owner'), { supabaseClient: client });
  assert.equal(d.status, 200);
  assert.deepEqual(d.body.grant.governance_capabilities, [REVOKE_SESSIONS]);
  const p = await projectCorporatePeopleAccess(client, { actorUserId: 'revoker' });
  assert.equal(p.status, 403);
  assert.equal(p.body.code, 'CORPORATE_PEOPLE_ACCESS_DENIED');
  assert.equal(p.body.memberships, undefined);
});

test('F1 · People & Access for a governor: the two ACTIVE governor memberships and the four ACTIVE assignments, truthfully', async () => {
  for (const actor of ['gov-a', 'gov-b']) {
    const p = await projectCorporatePeopleAccess(G.client, { actorUserId: actor });
    assert.equal(p.status, 200, actor);
    const b = p.body;
    assert.equal(b.contract, PEOPLE_ACCESS_CONTRACT);
    assert.equal(b.source, 'persistent_corporate_authority');
    assert.equal(b.read_only, true);
    assert.deepEqual(b.basis.capability, MANAGE);
    assert.deepEqual(b.basis.governed_nodes.map((n) => n.node_id), [ROOT_NODE]);
    assert.deepEqual(b.counts, { memberships: 2, assignments: 4 });

    assert.deepEqual(b.memberships.map((m) => m.subject.user_id).sort(), ['gov-a', 'gov-b']);
    for (const m of b.memberships) {
      assert.equal(m.state, 'ACTIVE');
      assert.deepEqual(m.org_node, { node_id: ROOT_NODE, display_name: 'CarUp Corporate', entity_type: 'CORPORATE_PARENT' });
      assert.match(m.effective_from, /^\d{4}-\d{2}-\d{2}T/);
      assert.equal(m.effective_until, null);
      assert.match(m.subject.name, /^Governor [AB]$/);
      assert.match(m.subject.email, /@governors\.invalid$/);
    }
    const seen = b.assignments.map((x) => `${x.subject.user_id}:${x.capability}`).sort();
    assert.deepEqual(seen, [`gov-a:${MANAGE}`, `gov-a:${REVOKE_SESSIONS}`, `gov-b:${MANAGE}`, `gov-b:${REVOKE_SESSIONS}`].sort());
    for (const x of b.assignments) {
      assert.equal(x.state, 'ACTIVE');
      assert.equal(x.effective_now, true);
      assert.deepEqual(x.scope, [{ node_id: ROOT_NODE, display_name: 'CarUp Corporate', entity_type: 'CORPORATE_PARENT' }]);
      assert.equal(x.include_descendants, true);
      assert.equal(x.assurance_floor, 'A1_RECENT_REAUTH');
      assert.ok(Date.parse(x.effective_until) > Date.parse(x.effective_from));
      for (const who of ['requested_by', 'approved_by', 'activated_by']) assert.equal(typeof x[who].user_id, 'string', who);
    }
    assert.doesNotMatch(JSON.stringify(b), /password|hash|token|secret/i, 'no secret material');
  }
});

test('F1 · scope comes from the evaluator: a manager governing ONLY BU_MARKETPLACE sees only that node', async () => {
  const db = await database();
  const client = createServiceClient(db);
  await seedGovernor(db, 'root-gov');
  const buManager = await seedMembership(db, 'bu-manager', 'BU_MARKETPLACE');
  await seedAssignment(db, { subject: 'bu-manager', membershipId: buManager, capability: MANAGE, nodes: ['BU_MARKETPLACE'], includeDescendants: false });
  await seedMembership(db, 'bu-colleague', 'BU_MARKETPLACE');
  await seedMembership(db, 'other-bu-member', 'BU_DIASPORA_TRADE');
  await seedMembership(db, 'pending-member', 'BU_MARKETPLACE', { state: 'PENDING' });

  const scoped = await projectCorporatePeopleAccess(client, { actorUserId: 'bu-manager' });
  assert.equal(scoped.status, 200);
  assert.deepEqual(scoped.body.basis.governed_nodes.map((n) => n.node_id), ['BU_MARKETPLACE']);
  assert.deepEqual(scoped.body.memberships.map((m) => m.subject.user_id).sort(), ['bu-colleague', 'bu-manager'], 'no root, no other BU, no PENDING row');
  assert.deepEqual(scoped.body.assignments.map((x) => x.subject.user_id), ['bu-manager']);

  const whole = await projectCorporatePeopleAccess(client, { actorUserId: 'root-gov' });
  assert.deepEqual(whole.body.memberships.map((m) => m.subject.user_id).sort(), ['bu-colleague', 'bu-manager', 'other-bu-member', 'root-gov'], 'descendant scope covers every BU; PENDING is not ACTIVE');
});

test('F1 · fail closed and refuse cleanly: unreadable store → 503 with nothing shown; no actor → 403', async () => {
  for (const fault of ['select:corporate_memberships', 'select:corporate_org_nodes', 'select:corporate_permission_assignments', 'select:users']) {
    const p = await projectCorporatePeopleAccess(createServiceClient(G.db, { faults: new Set([fault]) }), { actorUserId: 'gov-a' });
    assert.equal(p.status, 503, fault);
    assert.equal(p.body.memberships, undefined, fault);
  }
  assert.equal((await projectCorporatePeopleAccess(G.client, { actorUserId: '' })).status, 403);
  assert.equal((await projectCorporatePeopleAccess(G.client, {})).status, 403);
});

test('F1/F2 · the decision and the projection write nothing', async () => {
  const before = await snapshot(G.db, CORPORATE_TABLES);
  await access.evaluateCorporateAccess(session('gov-a', 'admin'), { supabaseClient: G.client });
  await access.evaluateCorporateAccess(session('gov-b', 'owner'), { supabaseClient: G.client });
  await projectCorporatePeopleAccess(G.client, { actorUserId: 'gov-a' });
  assert.equal(await snapshot(G.db, CORPORATE_TABLES), before);
});

// ══ Part B · the shipped app: real middleware and routes, real Corporate SQL behind them ══════════════════════════════════════

const FUTURE = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
const PAST = new Date(Date.now() - 3600 * 1000).toISOString();

test('HTTP · /api/corporate/access and /api/corporate/people-access through the shipped app', async (t) => {
  const { db, a, b } = await governorWorld();
  await ensureUsers(db, ['adm-x', 'owner-x']);
  const pg = createServiceClient(db);
  const user = (id, role, name) => ({ id, name, email: `${id}@governors.invalid`, phone: '', role, is_verified: true, password_hash: 'not-a-real-hash' });
  const sess = (token, userId, extra = {}) => ({ id: `s-${token}`, token, user_id: userId, active_role: null, active_organization_id: null, is_valid: true, expires_at: FUTURE, ...extra });
  const world = createSupabaseWorld({
    users: [user('gov-a', 'admin', 'Governor A'), user('gov-b', 'owner', 'Governor B'), user('adm-x', 'admin', 'Admin X'), user('owner-x', 'owner', 'Owner X')],
    user_sessions: [sess('tok-a', 'gov-a'), sess('tok-b', 'gov-b'), sess('tok-adm', 'adm-x'), sess('tok-owner', 'owner-x'), sess('tok-revoked', 'gov-a', { is_valid: false }), sess('tok-expired', 'gov-b', { expires_at: PAST })],
    tenants: [], tenant_users: [], trust_audit_events: [],
  });
  const restore = installSupabaseWorld(supabase, world);
  // identity + sessions from the world; every Corporate table and RPC from the real SQL
  const corporate = (name) => String(name).startsWith('corporate_');
  supabase.from = (table) => (corporate(table) ? pg.from(table) : world.client.from(table));
  supabase.rpc = (name, params) => (corporate(name) ? pg.rpc(name, params) : world.client.rpc(name, params));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { restore(); await new Promise((resolve) => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (route, { token, headers = {} } = {}) => {
    const res = await fetch(`${base}${route}`, { headers: { 'x-bypass-rate-limit': 'true', ...(token ? { 'x-session-token': token } : {}), ...headers } });
    const text = await res.text(); let body; try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body, text, cacheControl: res.headers.get('cache-control') };
  };
  const writesBefore = world.writes.length;
  const sqlBefore = await snapshot(db, CORPORATE_TABLES);

  const A = await get('/api/corporate/access', { token: 'tok-a' });
  assert.equal(A.status, 200);
  assert.equal(A.cacheControl, 'no-store');
  assert.equal(A.body.grant.source, 'persistent_corporate_authority');
  assert.deepEqual(A.body.grant.governance_capabilities, GOV_CAPS);
  assert.equal(A.body.grant.compatibility.source, 'legacy_admin_compatibility_bridge');
  assert.deepEqual(A.body.grant.memberships.map((m) => m.membership_id), [a.membershipId]);

  const B = await get('/api/corporate/access', { token: 'tok-b' });
  assert.equal(B.status, 200, 'GOVERNOR B (platform owner) is admitted through persistent authority');
  assert.equal(B.body.grant.source, 'persistent_corporate_authority');
  assert.equal(B.body.grant.compatibility, null);
  assert.deepEqual(B.body.grant.capabilities, []);
  assert.deepEqual(B.body.grant.memberships.map((m) => m.membership_id), [b.membershipId]);

  const adm = await get('/api/corporate/access', { token: 'tok-adm' });
  assert.equal(adm.status, 403, 'a non-member platform admin is refused');
  assert.equal(adm.body.code, 'CORPORATE_ACCESS_DENIED');
  assert.equal((await get('/api/corporate/access', { token: 'tok-owner' })).status, 403, 'an ordinary owner is refused');

  for (const [label, opts] of [['no session', {}], ['forged x-user-id', { headers: { 'x-user-id': 'gov-a' } }], ['revoked session', { token: 'tok-revoked' }], ['expired session', { token: 'tok-expired' }], ['forged token', { token: 'tok-forged', headers: { 'x-user-id': 'gov-a' } }]]) {
    for (const route of ['/api/corporate/access', '/api/corporate/people-access']) {
      const r = await get(route, opts);
      assert.equal(r.status, 401, `${label} ${route}`);
      assert.doesNotMatch(r.text, /persistent_corporate_authority|corporate\.people/, `${label} ${route}: nothing leaks`);
    }
  }
  // a session for B naming A in x-user-id: B's session is the one judged (never A's compatibility), or the request is refused
  const spoof = await get('/api/corporate/access', { token: 'tok-b', headers: { 'x-user-id': 'gov-a' } });
  assert.ok(spoof.status === 200 ? spoof.body.grant.compatibility === null : spoof.status >= 400, `spoof ${spoof.status}`);

  for (const token of ['tok-a', 'tok-b']) {
    const p = await get('/api/corporate/people-access', { token });
    assert.equal(p.status, 200, token);
    assert.equal(p.cacheControl, 'no-store');
    assert.deepEqual(p.body.counts, { memberships: 2, assignments: 4 }, token);
    assert.deepEqual(p.body.memberships.map((m) => `${m.subject.name} <${m.subject.email}>`).sort(), ['Governor A <gov-a@governors.invalid>', 'Governor B <gov-b@governors.invalid>']);
    assert.doesNotMatch(p.text, /not-a-real-hash|password|tok-/, 'no secret or token in the projection');
  }
  assert.equal((await get('/api/corporate/people-access', { token: 'tok-adm' })).status, 403, 'non-member admin: no projection');
  assert.equal((await get('/api/corporate/people-access', { token: 'tok-owner' })).status, 403, 'ordinary owner: no projection');

  assert.equal(world.writes.length, writesBefore, 'no write to identity or sessions');
  assert.equal(await snapshot(db, CORPORATE_TABLES), sqlBefore, 'no write to the Corporate tables');
});
