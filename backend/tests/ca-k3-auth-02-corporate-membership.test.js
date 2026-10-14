/**
 * CA-K3-AUTH-02 (Phase A) — the internal Corporate membership resolver and its SHADOW policy.
 *
 * Proven here, deterministically and with no network:
 *   · the resolver reads ONLY the dedicated membership source — never users.role (admin / platform_admin /
 *     super_admin), tenant_users, the legacy organization_users, headers or sessions;
 *   · PENDING / SUSPENDED / ENDED / before-start / at-or-after-end are NOT active; ACTIVE inside its window is;
 *   · an ACTIVE membership grants ZERO Corporate capability and does not change effective /corporate admission;
 *   · a failed read is UNAVAILABLE — never "not a member";
 *   · an identity ASSERTED by a header is never evaluated, so a header cannot mint, name or probe a membership;
 *   · the shadow result keeps legacy_bridge_decision and corporate_membership_state SEPARATE, is OFF by default,
 *     and cannot change, delay or fail the HTTP response;
 *   · the legacy bridge (corporateAccessService.js) is byte-identical to its frozen CA-K3 foundation.
 * The SQL itself (constraints, triggers, privileges, RLS, Up/Down) is proven on real PostgreSQL in
 * ca-k3-auth-02-migration-pglite.test.js.
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ORIGINAL_CONSOLE = {};
for (const method of ['log', 'info', 'warn', 'debug', 'error']) { ORIGINAL_CONSOLE[method] = console[method]; console[method] = () => {}; }

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
delete process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;
delete process.env.CORPORATE_MEMBERSHIP_SHADOW;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const read = (relative) => readFileSync(path.join(REPO, relative), 'utf8');
const code = (source) => source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
const gitBlob = (relative) => { const body = readFileSync(path.join(REPO, relative)); return createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex'); };

const { createSupabaseWorld, installSupabaseWorld } = await import('./helpers/inMemorySupabaseWorld.js');
const { app } = await import('../server.js');
const { supabase } = await import('../db/supabase.js');
const { evaluateCorporateAccess } = await import('../services/corporate/corporateAccessService.js');
const membership = await import('../services/corporate/corporateMembershipService.js');
const shadow = await import('../services/corporate/corporateShadowPolicy.js');
const { MEMBERSHIP_STATE: S, classifyMembershipRow, resolveCorporateMembership } = membership;

const NOW = new Date('2026-10-14T12:00:00.000Z');
const iso = (offsetMs) => new Date(NOW.getTime() + offsetMs).toISOString();
const HOUR = 3600 * 1000;
const FUTURE = new Date(Date.now() + 24 * HOUR).toISOString();

// ── Fixture world ───────────────────────────────────────────────────────────────────────────────────
const user = (id, role) => ({ id, name: `Person ${id}`, email: `${id}@example.invalid`, phone: '', role, is_verified: true, password_hash: 'x' });
const session = (token, userId) => ({ id: `s-${token}`, token, user_id: userId, is_valid: true, expires_at: FUTURE, active_organization_id: null });
const NODES = [
  { node_id: 'CARUP_CORPORATE', entity_type: 'CORPORATE_PARENT' }, { node_id: 'BU_MARKETPLACE', entity_type: 'BUSINESS_UNIT' },
  { node_id: 'BU_SERVICE_NETWORK', entity_type: 'BUSINESS_UNIT' }, { node_id: 'BU_FINANCIAL_SERVICES', entity_type: 'BUSINESS_UNIT' },
  { node_id: 'BU_DIASPORA_TRADE', entity_type: 'BUSINESS_UNIT' },
];
let mid = 0;
const row = (userId, nodeId, state, from = iso(-24 * HOUR), until = null) => ({ membership_id: `m-${(mid += 1).toString().padStart(4, '0')}`, user_id: userId, org_node_id: nodeId, state, effective_from: from, effective_until: until });

let world; let restoreWorld; let server; let baseUrl;
function seed(memberships = []) {
  restoreWorld?.();
  world = createSupabaseWorld({
    users: [
      user('u-admin', 'admin'), user('u-padmin', 'platform_admin'), user('u-sadmin', 'super_admin'),
      user('u-owner', 'owner'), user('u-owner-member', 'owner'), user('u-admin-member', 'admin'),
      user('u-tenant-admin', 'owner'), user('u-legacy-org', 'owner'), user('u-nobody', 'owner'),
    ],
    user_sessions: [
      session('tok-admin', 'u-admin'), session('tok-owner', 'u-owner'), session('tok-owner-member', 'u-owner-member'),
      session('tok-admin-member', 'u-admin-member'), session('tok-nobody', 'u-nobody'),
    ],
    tenants: [{ id: 'T-DEALER', name: 'Avondale Dealers', type: 'dealership', status: 'active' }, { id: 'T-GARAGE', name: 'Mbare Motors', type: 'garage', status: 'active' }],
    tenant_users: [
      { tenant_id: 'T-DEALER', user_id: 'u-tenant-admin', role: 'admin' }, { tenant_id: 'T-GARAGE', user_id: 'u-tenant-admin', role: 'mechanic' },
    ],
    organizations: [{ id: 'O-1', name: 'Legacy External Org' }],
    organization_users: [{ organization_id: 'O-1', user_id: 'u-legacy-org', role: 'admin' }],
    corporate_org_nodes: NODES.map((n) => ({ ...n })),
    corporate_memberships: memberships,
    trust_audit_events: [],
  });
  restoreWorld = installSupabaseWorld(supabase, world);
}

before(async () => {
  seed();
  await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  restoreWorld?.();
  delete process.env.CORPORATE_MEMBERSHIP_SHADOW;
  if (server) await new Promise((resolve) => server.close(resolve));
});
beforeEach(() => { seed(); delete process.env.CORPORATE_MEMBERSHIP_SHADOW; });

const snapshot = (tables) => JSON.stringify(Object.fromEntries(tables.map((t) => [t, world.rows(t)])));
const IDENTITY_TABLES = ['users', 'user_sessions', 'tenants', 'tenant_users', 'organizations', 'organization_users'];

async function accessAs({ token, headers = {} } = {}) {
  const res = await fetch(`${baseUrl}/api/corporate/access`, { headers: { 'x-bypass-rate-limit': 'true', ...(token ? { 'x-session-token': token } : {}), ...headers } });
  const text = await res.text();
  return { status: res.status, text, body: (() => { try { return JSON.parse(text); } catch { return null; } })(), cacheControl: res.headers.get('cache-control') };
}

/** Capture the shadow log lines the route emits (console.info is silenced by default in this file). */
async function withShadowLog(fn) {
  const lines = [];
  console.info = (line) => { try { lines.push(JSON.parse(line)); } catch { lines.push(line); } };
  process.env.CORPORATE_MEMBERSHIP_SHADOW = 'true';
  try { await fn(); await new Promise((r) => setTimeout(r, 150)); } finally { console.info = () => {}; delete process.env.CORPORATE_MEMBERSHIP_SHADOW; }
  return lines;
}

// ═════════════════════════ 1 · the state of ONE membership at a moment (pure) ═════════════════════════

test('stored PENDING / SUSPENDED / ENDED are never active, whatever their dates say', () => {
  for (const state of ['PENDING', 'SUSPENDED', 'ENDED']) {
    assert.equal(classifyMembershipRow({ state, effective_from: iso(-HOUR), effective_until: iso(HOUR) }, NOW), S[state], `${state} inside its window`);
    assert.notEqual(classifyMembershipRow({ state, effective_from: iso(-HOUR), effective_until: null }, NOW), S.ACTIVE);
  }
});

test('ACTIVE inside its effective period → ACTIVE (open-ended and bounded)', () => {
  assert.equal(classifyMembershipRow({ state: 'ACTIVE', effective_from: iso(-HOUR), effective_until: null }, NOW), S.ACTIVE);
  assert.equal(classifyMembershipRow({ state: 'ACTIVE', effective_from: iso(-HOUR), effective_until: iso(HOUR) }, NOW), S.ACTIVE);
});

test('ACTIVE before effective_from → NOT_YET_EFFECTIVE; the start instant itself is inclusive', () => {
  assert.equal(classifyMembershipRow({ state: 'ACTIVE', effective_from: iso(HOUR), effective_until: null }, NOW), S.NOT_YET_EFFECTIVE);
  assert.equal(classifyMembershipRow({ state: 'ACTIVE', effective_from: iso(1), effective_until: null }, NOW), S.NOT_YET_EFFECTIVE);
  assert.equal(classifyMembershipRow({ state: 'ACTIVE', effective_from: iso(0), effective_until: null }, NOW), S.ACTIVE);
});

test('ACTIVE at or after effective_until → EXPIRED; the end instant itself is exclusive', () => {
  assert.equal(classifyMembershipRow({ state: 'ACTIVE', effective_from: iso(-2 * HOUR), effective_until: iso(0) }, NOW), S.EXPIRED);
  assert.equal(classifyMembershipRow({ state: 'ACTIVE', effective_from: iso(-2 * HOUR), effective_until: iso(-1) }, NOW), S.EXPIRED);
  assert.equal(classifyMembershipRow({ state: 'ACTIVE', effective_from: iso(-2 * HOUR), effective_until: iso(1) }, NOW), S.ACTIVE);
});

test('anything unreadable fails closed: unknown stored state, missing/garbled dates, a bad clock, no row', () => {
  const ok = { state: 'ACTIVE', effective_from: iso(-HOUR), effective_until: null };
  for (const bad of [null, undefined, 'ACTIVE', 42, { ...ok, state: 'active' }, { ...ok, state: 'APPROVED' }, { ...ok, state: undefined },
    { ...ok, effective_from: null }, { ...ok, effective_from: 'not-a-date' }, { ...ok, effective_until: 'not-a-date' }]) {
    assert.equal(classifyMembershipRow(bad, NOW), S.NOT_EVALUATED, JSON.stringify(bad));
  }
  for (const clock of [undefined, null, 'now', new Date('nope'), 1760443200000]) assert.equal(classifyMembershipRow(ok, clock), S.NOT_EVALUATED);
});

test('timestamps arrive as ISO strings (PostgREST) or Date objects (a driver) — both resolve the same way', () => {
  const asStrings = { state: 'ACTIVE', effective_from: iso(-HOUR), effective_until: iso(HOUR) };
  const asDates = { state: 'ACTIVE', effective_from: new Date(iso(-HOUR)), effective_until: new Date(iso(HOUR)) };
  assert.equal(classifyMembershipRow(asStrings, NOW), S.ACTIVE);
  assert.equal(classifyMembershipRow(asDates, NOW), S.ACTIVE);
});

// ═════════════════════════ 2 · the resolver ═════════════════════════

test('an account with no Corporate membership → NO_MEMBERSHIP (not an active member)', async () => {
  const r = await resolveCorporateMembership(supabase, 'u-nobody', { now: NOW });
  assert.equal(r.state, S.NO_MEMBERSHIP);
  assert.equal(r.is_active_member, false);
  assert.deepEqual(r.active_memberships, []);
});

test('users.role admin / platform_admin / super_admin WITHOUT a membership → no Corporate membership', async () => {
  for (const id of ['u-admin', 'u-padmin', 'u-sadmin']) {
    const r = await resolveCorporateMembership(supabase, id, { now: NOW });
    assert.equal(r.state, S.NO_MEMBERSHIP, `${id} (${world.rows('users').find((u) => u.id === id).role})`);
    assert.equal(r.is_active_member, false);
  }
});

test('external tenant_users relationship only (incl. tenant admin) → no Corporate membership', async () => {
  const r = await resolveCorporateMembership(supabase, 'u-tenant-admin', { now: NOW });
  assert.equal(world.rows('tenant_users').filter((t) => t.user_id === 'u-tenant-admin' && t.role === 'admin').length, 1, 'fixture: a real tenant admin');
  assert.equal(r.state, S.NO_MEMBERSHIP);
  assert.equal(r.is_active_member, false);
});

test('legacy organization_users relationship only → no Corporate membership', async () => {
  const r = await resolveCorporateMembership(supabase, 'u-legacy-org', { now: NOW });
  assert.equal(world.rows('organization_users').filter((o) => o.user_id === 'u-legacy-org').length, 1, 'fixture: a real legacy org admin');
  assert.equal(r.state, S.NO_MEMBERSHIP);
});

test('every stored state resolves as specified for the SAME person at the SAME node', async () => {
  const cases = [
    ['PENDING', S.PENDING, false], ['SUSPENDED', S.SUSPENDED, false], ['ENDED', S.ENDED, false],
    ['ACTIVE', S.ACTIVE, true],
  ];
  for (const [stored, expected, active] of cases) {
    seed([row('u-nobody', 'BU_MARKETPLACE', stored)]);
    const r = await resolveCorporateMembership(supabase, 'u-nobody', { now: NOW });
    assert.equal(r.state, expected, stored);
    assert.equal(r.is_active_member, active, stored);
  }
  seed([row('u-nobody', 'BU_MARKETPLACE', 'ACTIVE', iso(HOUR))]);
  assert.equal((await resolveCorporateMembership(supabase, 'u-nobody', { now: NOW })).state, S.NOT_YET_EFFECTIVE);
  seed([row('u-nobody', 'BU_MARKETPLACE', 'ACTIVE', iso(-2 * HOUR), iso(-HOUR))]);
  assert.equal((await resolveCorporateMembership(supabase, 'u-nobody', { now: NOW })).state, S.EXPIRED);
});

test('an ACTIVE membership resolves to its accepted node and node type', async () => {
  seed([row('u-nobody', 'BU_DIASPORA_TRADE', 'ACTIVE', iso(-HOUR), iso(HOUR))]);
  const r = await resolveCorporateMembership(supabase, 'u-nobody', { now: NOW });
  assert.equal(r.state, S.ACTIVE);
  assert.equal(r.contract, 'carup.corporate_membership_state.v1');
  assert.deepEqual(r.active_memberships.map((m) => [m.org_node_id, m.org_node_type, m.effective_until]), [['BU_DIASPORA_TRADE', 'BUSINESS_UNIT', iso(HOUR)]]);
});

test('several memberships: ACTIVE wins and every active node is reported; otherwise the state is named by a fixed order', async () => {
  seed([row('u-nobody', 'BU_MARKETPLACE', 'ACTIVE'), row('u-nobody', 'BU_SERVICE_NETWORK', 'ACTIVE'), row('u-nobody', 'BU_DIASPORA_TRADE', 'SUSPENDED')]);
  const a = await resolveCorporateMembership(supabase, 'u-nobody', { now: NOW });
  assert.equal(a.state, S.ACTIVE);
  assert.deepEqual(a.active_memberships.map((m) => m.org_node_id), ['BU_MARKETPLACE', 'BU_SERVICE_NETWORK']);
  assert.equal(a.considered.length, 3);
  seed([row('u-nobody', 'BU_MARKETPLACE', 'ENDED'), row('u-nobody', 'BU_SERVICE_NETWORK', 'SUSPENDED'), row('u-nobody', 'BU_FINANCIAL_SERVICES', 'PENDING')]);
  const b = await resolveCorporateMembership(supabase, 'u-nobody', { now: NOW });
  assert.equal(b.state, S.PENDING, 'descriptive naming only — nothing here is active');
  assert.equal(b.is_active_member, false);
});

test('another person\'s membership never leaks into this person\'s result', async () => {
  seed([row('u-owner-member', 'BU_MARKETPLACE', 'ACTIVE')]);
  assert.equal((await resolveCorporateMembership(supabase, 'u-owner-member', { now: NOW })).is_active_member, true);
  for (const other of ['u-nobody', 'u-admin', 'u-owner']) assert.equal((await resolveCorporateMembership(supabase, other, { now: NOW })).state, S.NO_MEMBERSHIP);
});

test('an ACTIVE membership whose node cannot be resolved is not active', async () => {
  seed([row('u-nobody', 'BU_GHOST', 'ACTIVE')]);
  const r = await resolveCorporateMembership(supabase, 'u-nobody', { now: NOW });
  assert.equal(r.state, S.ORG_NODE_UNRESOLVED);
  assert.equal(r.is_active_member, false);
});

test('a FAILED read is UNAVAILABLE — never NO_MEMBERSHIP, never active', async () => {
  seed([row('u-nobody', 'BU_MARKETPLACE', 'ACTIVE')]);
  const real = supabase.from;
  const fail = (table, how) => { supabase.from = (name) => { if (name !== table) return real(name); if (how === 'throw') throw new Error('connection reset'); const b = real(name); b.then = (res, rej) => Promise.resolve({ data: null, error: { message: 'connection reset' } }).then(res, rej); return b; }; };
  try {
    for (const [table, how, reason] of [['corporate_memberships', 'error', 'membership_read_failed'], ['corporate_memberships', 'throw', 'membership_read_failed'], ['corporate_org_nodes', 'error', 'org_node_read_failed'], ['corporate_org_nodes', 'throw', 'org_node_read_failed']]) {
      supabase.from = real; fail(table, how);
      const r = await resolveCorporateMembership(supabase, 'u-nobody', { now: NOW });
      assert.equal(r.state, S.UNAVAILABLE, `${table}/${how}`);
      assert.equal(r.is_active_member, false);
      assert.equal(r.reason, reason);
      assert.doesNotMatch(JSON.stringify(r), /connection reset/, 'no raw database text in the result');
    }
  } finally { supabase.from = real; }
});

test('an unbounded set of rows is refused rather than truncated and misread', async () => {
  seed(Array.from({ length: 500 }, (_, i) => row('u-nobody', i === 0 ? 'BU_MARKETPLACE' : 'BU_SERVICE_NETWORK', i === 0 ? 'ACTIVE' : 'ENDED')));
  const r = await resolveCorporateMembership(supabase, 'u-nobody', { now: NOW });
  assert.equal(r.state, S.UNAVAILABLE);
  assert.equal(r.reason, 'membership_set_too_large');
});

test('an invalid subject or clock is NOT_EVALUATED and nothing is looked up', async () => {
  const real = supabase.from; let calls = 0;
  supabase.from = (name) => { calls += 1; return real(name); };
  try {
    for (const subject of ['', '   ', null, undefined, 42, {}, ['u-nobody'], 'x'.repeat(129)]) {
      const r = await resolveCorporateMembership(supabase, subject, { now: NOW });
      assert.equal(r.state, S.NOT_EVALUATED, String(subject));
      assert.equal(r.is_active_member, false);
    }
    assert.equal((await resolveCorporateMembership(supabase, 'u-nobody', { now: new Date('nope') })).state, S.NOT_EVALUATED);
    assert.equal(calls, 0, 'no query was issued');
  } finally { supabase.from = real; }
});

test('the resolver is READ-ONLY and changes no identity table: users.role, tenant membership, sessions, legacy orgs', async () => {
  seed([row('u-admin-member', 'BU_MARKETPLACE', 'ACTIVE'), row('u-owner-member', 'BU_SERVICE_NETWORK', 'PENDING')]);
  const before = snapshot(IDENTITY_TABLES); const writes = world.writes.length;
  for (const id of ['u-admin-member', 'u-owner-member', 'u-admin', 'u-tenant-admin', 'u-legacy-org']) await resolveCorporateMembership(supabase, id, { now: NOW });
  assert.equal(world.writes.length, writes, 'no insert/update/delete of any kind');
  assert.equal(snapshot(IDENTITY_TABLES), before, 'identity tables unchanged');
  assert.equal(world.rows('users').find((u) => u.id === 'u-admin-member').role, 'admin');
  assert.equal(world.rows('users').find((u) => u.id === 'u-owner-member').role, 'owner', 'an ACTIVE-capable member keeps users.role = owner');
});

// ═════════════════════════ 3 · ACTIVE membership grants ZERO capability ═════════════════════════

test('an ACTIVE membership carries an empty, frozen capability list and says it grants none', async () => {
  seed([row('u-nobody', 'BU_MARKETPLACE', 'ACTIVE')]);
  const r = await resolveCorporateMembership(supabase, 'u-nobody', { now: NOW });
  assert.equal(r.is_active_member, true);
  assert.deepEqual(r.capabilities, []);
  assert.equal(Object.isFrozen(r.capabilities), true);
  assert.equal(r.grants_capability, false);
  assert.throws(() => { 'use strict'; r.capabilities.push('corporate.overview.read'); }, TypeError);
  const text = JSON.stringify(r);
  assert.doesNotMatch(text, /corporate\.[a-z_.]+\.read|platform\.[a-z_.]+\.read|legacy_admin_compatibility_bridge/, 'no capability, destination or bridge material');
  assert.doesNotMatch(text, /destination|navigation|route|admission|"grant"/i);
});

test('through the shipped app: an ACTIVE Corporate member WITHOUT the legacy role is still refused by /api/corporate/access', async () => {
  const baseline = await accessAs({ token: 'tok-owner' });
  seed([row('u-owner-member', 'BU_MARKETPLACE', 'ACTIVE'), row('u-owner-member', 'BU_SERVICE_NETWORK', 'ACTIVE')]);
  const member = await accessAs({ token: 'tok-owner-member' });
  assert.equal(member.status, 403);
  assert.equal(member.body.decision, 'denied');
  assert.equal(member.body.code, 'CORPORATE_ACCESS_DENIED');
  assert.equal(member.body.grant, undefined);
  assert.equal(member.text, baseline.text, 'byte-identical to an account with no membership at all');
});

test('through the shipped app: effective admission is unchanged for every account class, with or without a membership', async () => {
  const classes = [['tok-admin', 200], ['tok-admin-member', 200], ['tok-owner', 403], ['tok-owner-member', 403], ['tok-nobody', 403]];
  const without = {}; for (const [tok] of classes) without[tok] = await accessAs({ token: tok });
  seed([row('u-admin', 'BU_MARKETPLACE', 'ACTIVE'), row('u-admin-member', 'BU_SERVICE_NETWORK', 'ACTIVE'), row('u-owner-member', 'BU_FINANCIAL_SERVICES', 'ACTIVE'), row('u-nobody', 'BU_DIASPORA_TRADE', 'ACTIVE'), row('u-owner', 'BU_MARKETPLACE', 'PENDING')]);
  for (const [tok, status] of classes) {
    const withM = await accessAs({ token: tok });
    assert.equal(withM.status, status, tok);
    assert.equal(withM.text, without[tok].text, `${tok}: body byte-identical whatever membership exists`);
    assert.equal(withM.cacheControl, 'no-store');
  }
});

test('an ACTIVE membership changes nothing about the legacy bridge capability bundle', async () => {
  const granted = (await accessAs({ token: 'tok-admin' })).body;
  seed([row('u-admin', 'BU_MARKETPLACE', 'ACTIVE')]);
  const after = (await accessAs({ token: 'tok-admin' })).body;
  assert.deepEqual(after, granted);
  assert.equal(after.grant.source, 'legacy_admin_compatibility_bridge');
  assert.equal(after.grant.capabilities.length, 16);
});

// ═════════════════════════ 4 · identity asserted by a header never reaches the membership source ═════════════════════════

test('a header-asserted identity is not evaluated: no x-user-id / x-tenant-id / x-stakeholder-role names or mints a membership', async () => {
  seed([row('u-owner-member', 'BU_MARKETPLACE', 'ACTIVE')]);
  const real = supabase.from; const touched = [];
  supabase.from = (name) => { touched.push(name); return real(name); };
  try {
    const fallbackCtx = { id: 'u-owner-member', authenticationMethod: 'x-user-id-fallback', platformRole: 'owner' };
    const r = await shadow.evaluateShadowPolicy({ userContext: fallbackCtx, legacyDecision: evaluateCorporateAccess(fallbackCtx), now: NOW });
    assert.equal(r.corporate_membership_state.state, S.NOT_EVALUATED);
    assert.equal(r.corporate_membership_state.reason, 'identity_not_session_proven');
    assert.equal(r.corporate_membership_state.is_active_member, false);
    assert.equal(touched.length, 0, 'the membership source was never queried');
    for (const ctx of [undefined, null, {}, { id: '', authenticationMethod: 'session' }, { id: 'u-owner-member' }, { id: 'u-owner-member', authenticationMethod: 'x-user-id-fallback' }]) {
      assert.equal((await shadow.evaluateShadowPolicy({ userContext: ctx, legacyDecision: { allowed: false }, now: NOW })).corporate_membership_state.state, S.NOT_EVALUATED);
    }
    assert.equal(touched.length, 0);
  } finally { supabase.from = real; }
});

test('HTTP: a header naming an ACTIVE member cannot stand in for the session — 401 without one, and the SESSION\'s account is the one evaluated', async () => {
  seed([row('u-owner-member', 'BU_MARKETPLACE', 'ACTIVE')]);
  const lines = await withShadowLog(async () => {
    const bare = await accessAs({ headers: { 'x-user-id': 'u-owner-member', 'x-tenant-id': 'T-DEALER', 'x-stakeholder-role': 'admin' } });
    assert.equal(bare.status, 401);
    const wrongSubject = await accessAs({ token: 'tok-nobody', headers: { 'x-user-id': 'u-owner-member' } });
    assert.equal(wrongSubject.status, 403);
  });
  assert.equal(lines.length, 1, 'only the session-authenticated request was observed');
  assert.equal(lines[0].corporate_membership_state, S.NO_MEMBERSHIP, 'tok-nobody, not the header-named member');
  assert.equal(lines[0].subject_digest, createHash('sha256').update('u-nobody').digest('hex').slice(0, 12));
});

// ═════════════════════════ 5 · the shadow policy keeps the two facts separate ═════════════════════════

test('shadow evaluation: legacy decision and membership state are separate fields; nothing is merged into a grant', async () => {
  seed([row('u-owner-member', 'BU_MARKETPLACE', 'ACTIVE')]);
  const ownerCtx = { id: 'u-owner-member', authenticationMethod: 'session', platformRole: 'owner' };
  const adminCtx = { id: 'u-admin', authenticationMethod: 'session', platformRole: 'admin' };
  const a = await shadow.evaluateShadowPolicy({ userContext: ownerCtx, legacyDecision: evaluateCorporateAccess(ownerCtx), now: NOW });
  assert.deepEqual(Object.keys(a).sort(), ['affects_admission', 'alignment', 'contract', 'corporate_membership_state', 'legacy_bridge_decision', 'mode']);
  assert.equal(a.contract, 'carup.corporate_membership_shadow.v1');
  assert.equal(a.mode, 'SHADOW');
  assert.equal(a.affects_admission, false);
  assert.deepEqual(a.legacy_bridge_decision, { decision: 'denied', source: null });
  assert.equal(a.corporate_membership_state.is_active_member, true);
  assert.equal(a.alignment, 'legacy_denied__membership_active', 'an ACTIVE member the bridge does not admit: still denied');
  assert.deepEqual(a.corporate_membership_state.capabilities, []);
  const b = await shadow.evaluateShadowPolicy({ userContext: adminCtx, legacyDecision: evaluateCorporateAccess(adminCtx), now: NOW });
  assert.deepEqual(b.legacy_bridge_decision, { decision: 'granted', source: 'legacy_admin_compatibility_bridge' });
  assert.equal(b.corporate_membership_state.state, S.NO_MEMBERSHIP);
  assert.equal(b.alignment, 'legacy_granted__membership_not_active', 'the bridge admits an admin who is NOT a Corporate member — the policy does not');
  for (const result of [a, b]) {
    assert.doesNotMatch(JSON.stringify(result), /corporate\.[a-z_.]+\.read|"capabilities":\[".+"\]/, 'the legacy capability list is not copied in');
    assert.equal(result.grant, undefined);
    assert.equal(result.capabilities, undefined);
  }
});

test('shadow observation is OFF by default: no log, no database access', async () => {
  seed([row('u-owner-member', 'BU_MARKETPLACE', 'ACTIVE')]);
  const real = supabase.from; const touched = []; supabase.from = (n) => { touched.push(n); return real(n); };
  const lines = [];
  console.info = (l) => lines.push(l);
  try {
    assert.equal(shadow.isShadowObservationEnabled({}), false);
    for (const value of ['', 'false', '1', 'TRUE', 'yes', ' true']) assert.equal(shadow.isShadowObservationEnabled({ CORPORATE_MEMBERSHIP_SHADOW: value }), false, value);
    assert.equal(shadow.isShadowObservationEnabled({ CORPORATE_MEMBERSHIP_SHADOW: 'true' }), true);
    await accessAs({ token: 'tok-admin' }); await accessAs({ token: 'tok-owner-member' });
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(lines.length, 0);
    assert.ok(touched.length > 0 && touched.every((n) => !n.startsWith('corporate_')), `only the authentication reads happened: ${touched.join(',')}`);
    assert.equal(world.rows('corporate_memberships').length, 1);
  } finally { supabase.from = real; console.info = () => {}; }
});

test('shadow observation ON: one pseudonymous line per authenticated request — no email, name, token or raw account id', async () => {
  seed([row('u-admin-member', 'BU_MARKETPLACE', 'ACTIVE')]);
  const lines = await withShadowLog(async () => { await accessAs({ token: 'tok-admin' }); await accessAs({ token: 'tok-admin-member' }); await accessAs({ token: 'tok-owner' }); });
  assert.equal(lines.length, 3);
  const text = JSON.stringify(lines);
  assert.doesNotMatch(text, /example\.invalid|Person |tok-|u-admin|u-owner|u-nobody|password/);
  for (const line of lines) {
    assert.deepEqual(Object.keys(line).sort(), ['active_membership_count', 'affects_admission', 'alignment', 'contract', 'corporate_membership_state', 'legacy_bridge_decision', 'level', 'mode', 'msg', 'subject_digest']);
    assert.equal(line.msg, 'corporate_membership_shadow'); assert.equal(line.affects_admission, false); assert.match(line.subject_digest, /^[0-9a-f]{12}$/);
  }
  const by = (alignment) => lines.find((l) => l.alignment === alignment);
  assert.equal(by('legacy_granted__membership_not_active').corporate_membership_state, S.NO_MEMBERSHIP);
  assert.equal(by('legacy_granted__membership_active').active_membership_count, 1);
  assert.equal(by('legacy_denied__membership_not_active').legacy_bridge_decision, 'denied');
});

test('the shadow observation cannot change, delay or fail the response — flag on, table missing, database down, log sink throwing', async () => {
  const baseline = {}; for (const tok of ['tok-admin', 'tok-owner']) baseline[tok] = await accessAs({ token: tok });
  const observeAll = async () => { const out = {}; for (const tok of ['tok-admin', 'tok-owner']) out[tok] = await accessAs({ token: tok }); return out; };
  const same = (got, label) => { for (const tok of Object.keys(baseline)) { assert.equal(got[tok].status, baseline[tok].status, `${label} ${tok}`); assert.equal(got[tok].text, baseline[tok].text, `${label} ${tok}`); assert.equal(got[tok].cacheControl, 'no-store'); } };

  process.env.CORPORATE_MEMBERSHIP_SHADOW = 'true';
  try {
    same(await observeAll(), 'flag on');
    const real = supabase.from;
    supabase.from = (name) => { if (name.startsWith('corporate_')) throw new Error('relation "corporate_memberships" does not exist'); return real(name); };
    try { same(await observeAll(), 'table missing / database down'); } finally { supabase.from = real; }
    const realInfo = console.info; console.info = () => { throw new Error('log sink down'); };
    try { same(await observeAll(), 'log sink throwing'); await new Promise((r) => setTimeout(r, 100)); } finally { console.info = realInfo; }
  } finally { delete process.env.CORPORATE_MEMBERSHIP_SHADOW; }

  assert.doesNotThrow(() => shadow.observeShadowPolicy({ userContext: undefined, legacyDecision: undefined, env: { CORPORATE_MEMBERSHIP_SHADOW: 'true' }, supabaseClient: null }));
  assert.doesNotThrow(() => shadow.observeShadowPolicy({ userContext: { id: 'u', authenticationMethod: 'session' }, legacyDecision: {}, env: { CORPORATE_MEMBERSHIP_SHADOW: 'true' }, supabaseClient: { from() { throw new Error('boom'); } }, log() { throw new Error('boom'); } }));
});

test('the observation writes nothing: no audit row, no membership row, no identity change', async () => {
  seed([row('u-admin-member', 'BU_MARKETPLACE', 'ACTIVE')]);
  const before = snapshot([...IDENTITY_TABLES, 'corporate_memberships', 'corporate_org_nodes', 'trust_audit_events']); const writes = world.writes.length;
  await withShadowLog(async () => { for (const tok of ['tok-admin', 'tok-admin-member', 'tok-owner', 'tok-nobody']) await accessAs({ token: tok }); });
  assert.equal(world.writes.length, writes);
  assert.equal(snapshot([...IDENTITY_TABLES, 'corporate_memberships', 'corporate_org_nodes', 'trust_audit_events']), before);
});

// ═════════════════════════ 6 · the legacy bridge is frozen; the new modules cannot reach forbidden sources ═════════════════════════

test('the legacy bridge is byte-identical to its frozen foundation (3fc2bdcf) — nothing re-expressed, narrowed or widened', () => {
  // git blob ids at 3fc2bdcf. A deliberate change to the bridge must update these pins in the same commit.
  assert.equal(gitBlob('backend/services/corporate/corporateAccessService.js'), 'fd38cd1bc8f2559974808ddfc68db61f71eba1c3');
  const svc = read('backend/services/corporate/corporateAccessService.js');
  assert.match(svc, /CORPORATE_COMPATIBILITY_PLATFORM_ROLES = Object\.freeze\(\['admin', 'platform_admin', 'super_admin'\]\)/);
  assert.match(svc, /CORPORATE_ACCESS_CONTRACT = 'carup\.corporate_access\.v1'/);
});

test('the route differs from its frozen foundation by exactly the shadow observer call and its import', () => {
  const route = read('backend/routes/corporateAccessRoutes.js');
  const stripped = code(route).replace(/import \{ observeShadowPolicy \} from '\.\.\/services\/corporate\/corporateShadowPolicy\.js';\n/, '').replace(/\n\s*observeShadowPolicy\(\{ userContext: req\.userContext, legacyDecision: decision \}\);/, '');
  assert.match(stripped, /router\.get\('\/api\/corporate\/access', authorizeSessionRole\(\[\]\), \(req, res\) => \{\s*const decision = evaluateCorporateAccess\(req\.userContext\);\s*res\.set\('Cache-Control', 'no-store'\);\s*return res\.status\(decision\.status\)\.json\(decision\.body\);\s*\}\);/);
  assert.doesNotMatch(code(route), /\bauthorizeRole\(|optionalAuth\(/);
});

const FORBIDDEN_SOURCES = [/\busers\b/, /tenant_users|\btenants\b/, /organization_users|\borganizations\b/, /user_sessions/, /x-user-id|x-tenant-id|x-stakeholder-role/i, /\breq\b|\bheaders\b/, /platformRole|effectiveRole|tenantRole|baseRole|\.role\b/, /jobTitle|job_title/, /legacy_admin_compatibility_bridge/, /corporateAccessService|evaluateCorporateAccess/];
const sourcesTouched = (src) => FORBIDDEN_SOURCES.filter((re) => re.test(code(src))).map(String);

test('guard: the resolver reads only the membership source — no role, tenant, organisation, session, header, title or bridge (mutants die)', () => {
  const svc = read('backend/services/corporate/corporateMembershipService.js');
  assert.deepEqual(sourcesTouched(svc), []);
  const tables = [...code(svc).matchAll(/\.from\('([a-z_]+)'\)/g)].map((m) => m[1]).sort();
  assert.deepEqual(tables, ['corporate_memberships', 'corporate_org_nodes']);
  for (const [name, mutant] of [
    ['reads users.role', svc.replace(".from('corporate_org_nodes')", ".from('users')")],
    ['reads tenant_users', svc.replace(".from('corporate_org_nodes')", ".from('tenant_users')")],
    ['reads organization_users', svc.replace(".from('corporate_memberships')", ".from('organization_users')")],
    ['reads a header', svc.replace("typeof userId !== 'string'", "typeof req.headers['x-user-id'] !== 'string'")],
  ]) { assert.notEqual(mutant, svc, name); assert.notDeepEqual(sourcesTouched(mutant).concat(JSON.stringify([...code(mutant).matchAll(/\.from\('([a-z_]+)'\)/g)].map((m) => m[1]).sort()) === JSON.stringify(tables) ? [] : ['tables']), [], `${name}: mutant survived`); }
});

test('guard: the shadow module takes the legacy decision as DATA — it neither recomputes it nor reads identity sources', () => {
  const src = read('backend/services/corporate/corporateShadowPolicy.js');
  const touched = sourcesTouched(src).filter((s) => !/legacy_admin_compatibility_bridge/.test(s));
  assert.deepEqual(touched, []);
  assert.doesNotMatch(code(src), /import[^;]*corporateAccessService/);
  assert.match(code(src), /userContext\?\.authenticationMethod === 'session'/);
});

test('guard: neither new module defines, imports or returns a capability, destination or permission', () => {
  for (const file of ['backend/services/corporate/corporateMembershipService.js', 'backend/services/corporate/corporateShadowPolicy.js']) {
    const src = code(read(file));
    assert.doesNotMatch(src, /'corporate\.[a-z_.]+'|'platform\.[a-z_.]+'|navCapabilities|CAPABILIT(Y|IES)_|BRIDGE_READ/i, file);
    assert.doesNotMatch(src, /res\.(status|json|send)|router\.|app\.use/, `${file} never answers an HTTP request`);
  }
  assert.equal(Object.keys(membership).filter((k) => /capabilit|permission|destination|grant/i.test(k)).length, 0);
  assert.equal(Object.keys(shadow).filter((k) => /capabilit|permission|destination|grant/i.test(k)).length, 0);
});

test('guard: the access route never reads the shadow result — the observer returns nothing and is never awaited', () => {
  const route = code(read('backend/routes/corporateAccessRoutes.js'));
  assert.match(route, /\n\s*observeShadowPolicy\(\{/);
  assert.doesNotMatch(route, /(?:=|await|return|\()\s*observeShadowPolicy/);
  assert.doesNotMatch(code(read('backend/services/corporate/corporateShadowPolicy.js')), /export (async )?function observeShadowPolicy[\s\S]*?\breturn [^;]*;/);
});
