/**
 * CA-K3-AUTH-01 — the server-side Corporate Admin access decision, through the SHIPPED app, the real
 * authMiddleware and an in-memory world (no network, no staging, no seeded identities).
 *
 * Certification gates this file provides evidence for (CA-CERT model, blob b87b7d45):
 *   CA-CERT-AUTH-001  identity is not authority — an authenticated subject without a grant is denied;
 *   CA-CERT-UX-003    permission does not rely on hidden navigation — the server denies directly.
 *
 * Proven here:
 *   · no / invalid / expired / revoked session → 401; the x-user-id fallback never yields a grant;
 *   · every non-compatibility actor with a VALID session → 403 (owner, buyer, dealer, mechanic, garage
 *     member, bank, lender, insurance, government, reviewer, plain member, tenant admin);
 *   · tenant role / selected or asserted organisation / x-stakeholder-role never mint or widen a grant,
 *     and the existing tenant-mismatch refusal is intact;
 *   · CA-CLOSE-01 (F2): admission is PERSISTENT Corporate authority — admin / platform_admin / super_admin
 *     who are ACTIVE governors get the persistent grant plus the bounded, separately labelled read-only
 *     compatibility (no PII, no token, no tenant data, no governance capability from the role); the same
 *     roles WITHOUT a Corporate membership are refused 403 — users.role alone confers nothing;
 *   · the decision writes nothing.
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const method of ['log', 'info', 'warn', 'debug', 'error']) console[method] = () => {};

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
delete process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

const { createSupabaseWorld, installSupabaseWorld } = await import('./helpers/inMemorySupabaseWorld.js');
// CA-CLOSE-01 (F2): admission is persistent Corporate authority, so the administrators below are ALSO real governors in a
// real-SQL Corporate database (the accepted Phase A + B + C migrations); identity and sessions stay in the in-memory world.
const { openDatabase, closeAll, seedGovernor } = await import('./helpers/corporateGovernanceDb.js');
const { createServiceClient } = await import('./helpers/pgliteSupabaseClient.js');
const { app } = await import('../server.js');
const { supabase } = await import('../db/supabase.js');
const {
  evaluateCorporateAccess,
  CORPORATE_COMPATIBILITY_READ_CAPABILITIES,
  CORPORATE_COMPATIBILITY_PLATFORM_ROLES,
  CORPORATE_GRANT_SOURCE,
  CORPORATE_COMPATIBILITY_SOURCE,
} = await import('../services/corporate/corporateAccessService.js');

const ROUTE = '/api/corporate/access';
const FUTURE = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
const PAST = new Date(Date.now() - 3600 * 1000).toISOString();
const GARAGE = 'tenant-garage';
const DEALERSHIP = 'tenant-dealership';
const BANK = 'tenant-bank';

/** Every actor that must be DENIED although its session is valid: [label, user id]. */
const DENIED_ACTORS = [
  ['ordinary authenticated account (no role)', 'u-plain'],
  ['member', 'u-member'],
  ['owner', 'u-owner'],
  ['buyer / customer', 'u-buyer'],
  ['dealer', 'u-dealer'],
  ['mechanic', 'u-mechanic'],
  ['garage user (owner + tenant mechanic, garage selected)', 'u-garage'],
  ['bank', 'u-bank'],
  ['lender', 'u-lender'],
  ['insurance', 'u-insurance'],
  ['government', 'u-government'],
  ['reviewer', 'u-reviewer'],
  ['external tenant admin (owner + tenant admin, garage selected)', 'u-tenant-admin'],
  ['finance', 'u-finance'],
];
/** Legacy platform administrators who are ALSO active governors (membership + persistent assignments) — admitted. */
const GRANTED_ACTORS = [['admin', 'u-admin'], ['platform_admin', 'u-platform-admin'], ['super_admin', 'u-super-admin']];
/** Legacy platform administrators WITHOUT a Corporate membership — users.role alone admits nobody (CA-CLOSE-01). */
const NON_MEMBER_ADMINS = [['admin', 'u-admin-nonmember'], ['platform_admin', 'u-platform-admin-nonmember'], ['super_admin', 'u-super-admin-nonmember']];

const PII = ['@example.invalid', 'Admin Person', 'tok-', 'u-admin', 'u-platform-admin', 'u-super-admin', GARAGE, 'password'];

let world; let restoreWorld; let server; let baseUrl;
function seedWorld() {
  restoreWorld?.();
  const user = (id, role, name = `Person ${id}`) => ({ id, name, email: `${id}@example.invalid`, phone: '', role, is_verified: true, password_hash: 'not-a-real-hash' });
  const session = (id, userId, extra = {}) => ({ id: `s-${id}`, token: `tok-${id}`, user_id: userId, active_role: null, active_organization_id: null, is_valid: true, expires_at: FUTURE, ...extra });
  world = createSupabaseWorld({
    users: [
      user('u-plain', null), user('u-member', 'member'), user('u-owner', 'owner'), user('u-buyer', 'buyer'),
      user('u-dealer', 'dealer'), user('u-mechanic', 'mechanic'), user('u-garage', 'owner'), user('u-bank', 'bank'),
      user('u-lender', 'lender'), user('u-insurance', 'insurance'), user('u-government', 'government'),
      user('u-reviewer', 'reviewer'), user('u-tenant-admin', 'owner'), user('u-finance', 'finance'),
      user('u-admin', 'admin', 'Admin Person'), user('u-platform-admin', 'platform_admin'), user('u-super-admin', 'super_admin'),
      user('u-admin-nonmember', 'admin'), user('u-platform-admin-nonmember', 'platform_admin'), user('u-super-admin-nonmember', 'super_admin'),
    ],
    user_sessions: [
      session('u-plain', 'u-plain'), session('u-member', 'u-member'), session('u-owner', 'u-owner'), session('u-buyer', 'u-buyer'),
      session('u-dealer', 'u-dealer'), session('u-mechanic', 'u-mechanic'),
      session('u-garage', 'u-garage', { active_organization_id: GARAGE }),
      session('u-bank', 'u-bank'), session('u-lender', 'u-lender'), session('u-insurance', 'u-insurance'),
      session('u-government', 'u-government'), session('u-reviewer', 'u-reviewer'),
      session('u-tenant-admin', 'u-tenant-admin', { active_organization_id: GARAGE }),
      session('u-tenant-admin-unselected', 'u-tenant-admin'),
      session('u-finance', 'u-finance'),
      session('u-admin', 'u-admin'), session('u-platform-admin', 'u-platform-admin'), session('u-super-admin', 'u-super-admin'),
      session('u-admin-nonmember', 'u-admin-nonmember'), session('u-platform-admin-nonmember', 'u-platform-admin-nonmember'),
      session('u-super-admin-nonmember', 'u-super-admin-nonmember'),
      session('u-admin-in-garage', 'u-admin', { active_organization_id: GARAGE }),
      session('expired', 'u-admin', { expires_at: PAST }),
      session('revoked', 'u-admin', { is_valid: false }),
    ],
    tenants: [
      { id: GARAGE, name: 'Mbare Motors', type: 'garage', status: 'active' },
      { id: DEALERSHIP, name: 'Avondale Dealers', type: 'dealership', status: 'active' },
      { id: BANK, name: 'Lender Bank', type: 'bank', status: 'active' },
    ],
    tenant_users: [
      { tenant_id: GARAGE, user_id: 'u-garage', role: 'mechanic' },
      { tenant_id: GARAGE, user_id: 'u-tenant-admin', role: 'admin' },
      { tenant_id: DEALERSHIP, user_id: 'u-tenant-admin', role: 'dealer' },
      { tenant_id: GARAGE, user_id: 'u-admin', role: 'member' },
      { tenant_id: BANK, user_id: 'u-bank', role: 'admin' },
    ],
    trust_audit_events: [],
  });
  restoreWorld = installSupabaseWorld(supabase, world);
  // Every Corporate table and RPC is answered by the real accepted SQL; everything else by the in-memory world.
  const corporate = (name) => String(name).startsWith('corporate_');
  supabase.from = (table) => (corporate(table) ? corporateClient.from(table) : world.client.from(table));
  supabase.rpc = (name, params) => (corporate(name) ? corporateClient.rpc(name, params) : world.client.rpc(name, params));
}

let corporateClient;
before(async () => {
  const db = await openDatabase({ migrate: 'all' });
  for (const [, id] of GRANTED_ACTORS) await seedGovernor(db, id); // membership at the root + manage + session-revoke over the tree
  corporateClient = createServiceClient(db);
  seedWorld();
  await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  restoreWorld?.();
  if (server) await new Promise((resolve) => server.close(resolve));
  await closeAll();
});
beforeEach(() => seedWorld());

async function getAccess({ token, headers = {}, query = '' } = {}) {
  const res = await fetch(`${baseUrl}${ROUTE}${query}`, {
    headers: { 'x-bypass-rate-limit': 'true', ...(token ? { 'x-session-token': token } : {}), ...headers },
  });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, text, cacheControl: res.headers.get('cache-control') };
}

function assertNoGrant(r, label) {
  assert.equal(r.body?.grant, undefined, `${label}: a denial carries no grant`);
  assert.doesNotMatch(r.text, /corporate\.[a-z_.]+\.(read|manage|revoke)|legacy_admin_compatibility_bridge|persistent_corporate_authority/, `${label}: no capability or grant source leaks into a denial`);
}

/** CA-CLOSE-01: an ADMITTED governor who is also a legacy platform administrator — persistent grant + the bounded compatibility. */
function assertReadOnlyGrant(r, label) {
  assert.equal(r.status, 200, `${label}: status`);
  assert.deepEqual(Object.keys(r.body).sort(), ['contract', 'decision', 'grant'], `${label}: top-level keys`);
  assert.equal(r.body.contract, 'carup.corporate_access.v2');
  assert.equal(r.body.decision, 'granted');
  assert.deepEqual(Object.keys(r.body.grant).sort(), ['assignments', 'capabilities', 'compatibility', 'explanation', 'governance_capabilities', 'memberships', 'read_only', 'source'], `${label}: grant keys`);
  assert.equal(r.body.grant.source, CORPORATE_GRANT_SOURCE);
  assert.equal(r.body.grant.read_only, true);
  assert.deepEqual(r.body.grant.governance_capabilities, ['corporate.people.membership.manage', 'corporate.people.session.revoke']);
  assert.equal(r.body.grant.memberships.length, 1);
  assert.equal(r.body.grant.memberships[0].org_node_id, 'CARUP_CORPORATE');
  assert.deepEqual(r.body.grant.compatibility, { source: CORPORATE_COMPATIBILITY_SOURCE, read_only: true, bounded_by: 'admitted_corporate_member', capabilities: [...CORPORATE_COMPATIBILITY_READ_CAPABILITIES] });
  assert.deepEqual(r.body.grant.capabilities, [...CORPORATE_COMPATIBILITY_READ_CAPABILITIES]);
  assert.match(r.body.grant.explanation, /persistent Corporate permission assignments/);
  assert.equal(r.cacheControl, 'no-store', `${label}: never cached`);
  for (const needle of PII) assert.ok(!r.text.includes(needle), `${label}: response must not contain ${needle}`);
}

// ── Authentication: a real, validated session or nothing ──────────────────────────────────────────

test('1 · no session → 401, no grant', async () => {
  const r = await getAccess();
  assert.equal(r.status, 401);
  assertNoGrant(r, 'no session');
});

test('2 · invalid session token → 401, no grant', async () => {
  const r = await getAccess({ token: 'tok-does-not-exist' });
  assert.equal(r.status, 401);
  assert.match(r.body.error, /Session is invalid or expired/);
  assertNoGrant(r, 'invalid session');
});

test('3 · expired session of an administrator → 401, no grant', async () => {
  const r = await getAccess({ token: 'tok-expired' });
  assert.equal(r.status, 401);
  assertNoGrant(r, 'expired session');
});

test('4 · revoked session of an administrator → 401, no grant', async () => {
  const r = await getAccess({ token: 'tok-revoked' });
  assert.equal(r.status, 401);
  assertNoGrant(r, 'revoked session');
  // And a session revoked AFTER a grant stops granting on the very next request.
  assert.equal((await getAccess({ token: 'tok-u-admin' })).status, 200);
  world.rows('user_sessions').find((s) => s.token === 'tok-u-admin').is_valid = false;
  assert.equal((await getAccess({ token: 'tok-u-admin' })).status, 401);
});

test('5 · x-user-id fallback naming an administrator, without a valid session → 401, even when the fallback is otherwise open', async () => {
  for (const optIn of [undefined, 'true']) {
    if (optIn) process.env.CARUP_ALLOW_X_USER_ID_FALLBACK = optIn; else delete process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;
    try {
      for (const id of ['u-admin', 'u-platform-admin', 'u-super-admin']) {
        const bare = await getAccess({ headers: { 'x-user-id': id, 'x-stakeholder-role': 'admin' } });
        assert.equal(bare.status, 401, `x-user-id=${id} (opt-in ${optIn ?? 'unset'})`);
        assert.match(bare.body.error, /requires an authenticated session/);
        assertNoGrant(bare, `x-user-id=${id}`);
        const withBadToken = await getAccess({ token: 'tok-does-not-exist', headers: { 'x-user-id': id } });
        assert.equal(withBadToken.status, 401, `x-user-id=${id} + invalid token`);
        const withExpired = await getAccess({ token: 'tok-expired', headers: { 'x-user-id': id } });
        assert.equal(withExpired.status, 401, `x-user-id=${id} + expired token`);
      }
    } finally { delete process.env.CARUP_ALLOW_X_USER_ID_FALLBACK; }
  }
});

test('5b · x-user-id cannot replace the identity a valid session proves', async () => {
  const r = await getAccess({ token: 'tok-u-owner', headers: { 'x-user-id': 'u-admin' } });
  assert.equal(r.status, 403, 'the session identity (owner) decides, not the header');
  assertNoGrant(r, 'owner session + admin x-user-id');
});

test('5c · the evaluator itself refuses an asserted identity even if mounted without the session guard', async () => {
  const asserted = await evaluateCorporateAccess({ id: 'u-admin', platformRole: 'admin', authenticationMethod: 'x-user-id-fallback' });
  assert.equal(asserted.allowed, false);
  assert.equal(asserted.status, 401);
  assert.equal((await evaluateCorporateAccess(undefined)).status, 401);
  assert.equal((await evaluateCorporateAccess({ platformRole: 'admin', authenticationMethod: 'session' })).status, 401, 'no subject id');
});

// ── Authorization: authentication alone is never Corporate authority ──────────────────────────────

for (const [label, id] of DENIED_ACTORS) {
  test(`6–14 · ${label} with a valid session → 403, no grant`, async () => {
    const r = await getAccess({ token: `tok-${id}` });
    assert.equal(r.status, 403, label);
    assert.equal(r.body.decision, 'denied');
    assert.equal(r.body.code, 'CORPORATE_ACCESS_DENIED');
    assertNoGrant(r, label);
  });
}

test('CA-CERT-AUTH-001 · identity is not authority: every authenticated subject without the compatibility grant is denied by the server', async () => {
  const outcomes = [];
  for (const [label, id] of DENIED_ACTORS) {
    const r = await getAccess({ token: `tok-${id}` });
    outcomes.push([label, r.status, r.body?.decision]);
  }
  assert.ok(outcomes.length >= 10);
  for (const [label, status, decision] of outcomes) {
    assert.equal(status, 403, `${label} must be denied`);
    assert.equal(decision, 'denied', label);
  }
});

test('CA-CERT-UX-003 · the server decision does not depend on which Corporate page was requested or how it was reached', async () => {
  const DIRECT = ['/corporate', '/corporate/business-units', '/corporate/finance', '/corporate/people-access', '/corporate/platform'];
  for (const page of DIRECT) {
    const headers = { referer: `https://staging.carup.invalid${page}`, 'x-corporate-destination': page };
    const query = `?destination=${encodeURIComponent(page)}&role=admin&grant=all`;
    for (const [label, id] of DENIED_ACTORS) {
      const r = await getAccess({ token: `tok-${id}`, headers, query });
      assert.equal(r.status, 403, `${label} directly at ${page}`);
      assertNoGrant(r, `${label} directly at ${page}`);
    }
    assert.equal((await getAccess({ headers, query })).status, 401, `anonymous directly at ${page}`);
    const admin = await getAccess({ token: 'tok-u-admin', headers, query });
    assertReadOnlyGrant(admin, `admin directly at ${page}`);
  }
});

// ── Tenant / context: never minted, never widened, mismatch still refused ──────────────────────────

test('15 · tenant role ≠ Corporate authority: a selected or asserted organisation never mints a grant', async () => {
  // Tenant admin with the garage SELECTED on the session.
  assert.equal((await getAccess({ token: 'tok-u-tenant-admin' })).status, 403);
  // Same person, no selection, asserting the garage (where they are tenant admin) by header.
  const asserted = await getAccess({ token: 'tok-u-tenant-admin-unselected', headers: { 'x-tenant-id': GARAGE } });
  assert.equal(asserted.status, 403);
  assertNoGrant(asserted, 'asserted tenant admin');
  // A bank-tenant admin.
  assert.equal((await getAccess({ token: 'tok-u-bank', headers: { 'x-tenant-id': BANK } })).status, 403);
  // A tenant role LENT as the effective role (dealer) is still not Corporate authority.
  const lent = await getAccess({ token: 'tok-u-tenant-admin-unselected', headers: { 'x-tenant-id': DEALERSHIP, 'x-stakeholder-role': 'dealer' } });
  assert.equal(lent.status, 403);
  assertNoGrant(lent, 'lent dealer role');
});

test('15b · client-asserted role headers cannot claim the compatibility role', async () => {
  for (const role of CORPORATE_COMPATIBILITY_PLATFORM_ROLES) {
    const owner = await getAccess({ token: 'tok-u-owner', headers: { 'x-stakeholder-role': role } });
    assert.equal(owner.status, 403, `owner claiming ${role}`);
    assertNoGrant(owner, `owner claiming ${role}`);
    const tenantAdmin = await getAccess({ token: 'tok-u-tenant-admin', headers: { 'x-stakeholder-role': role } });
    assert.equal(tenantAdmin.status, 403, `tenant admin claiming ${role}`);
  }
});

test('15c · the existing tenant-mismatch refusal is intact, and a client context header cannot widen the decision', async () => {
  // Session selected GARAGE; the request names another organisation → refused before any decision.
  const mismatch = await getAccess({ token: 'tok-u-admin-in-garage', headers: { 'x-tenant-id': DEALERSHIP } });
  assert.equal(mismatch.status, 403);
  assert.equal(mismatch.body.code, 'TENANT_CONTEXT_MISMATCH');
  assertNoGrant(mismatch, 'tenant mismatch');
  // A non-member organisation asserted by header (no selection) → refused by the existing verifier.
  const foreign = await getAccess({ token: 'tok-u-owner', headers: { 'x-tenant-id': GARAGE } });
  assert.equal(foreign.status, 403);
  assertNoGrant(foreign, 'foreign tenant header');
  // An administrator acting inside a selected organisation gets EXACTLY the same read-only grant:
  // tenant context neither widens nor narrows it.
  const inGarage = await getAccess({ token: 'tok-u-admin-in-garage' });
  const plain = await getAccess({ token: 'tok-u-admin' });
  assertReadOnlyGrant(inGarage, 'admin in garage');
  assert.deepEqual(inGarage.body, plain.body);
});

// ── The persistent grant, and the bounded compatibility an admitted administrator may carry (CA-CLOSE-01) ──────────

for (const [label, id] of GRANTED_ACTORS) {
  test(`16–18 · ${label} who is an ACTIVE governor → persistent Corporate authority + the bounded read-only compatibility`, async () => {
    assertReadOnlyGrant(await getAccess({ token: `tok-${id}` }), label);
  });
}

for (const [label, id] of NON_MEMBER_ADMINS) {
  test(`16–18b · ${label} WITHOUT a Corporate membership → 403: users.role alone confers no Corporate authority`, async () => {
    const r = await getAccess({ token: `tok-${id}` });
    assert.equal(r.status, 403, label);
    assert.equal(r.body.decision, 'denied');
    assert.equal(r.body.code, 'CORPORATE_ACCESS_DENIED');
    assertNoGrant(r, label);
  });
}

test('capability discipline: navigation capabilities are fixed .read capabilities; governance comes only from persistent assignments', async () => {
  const r = await getAccess({ token: 'tok-u-super-admin' });
  assertReadOnlyGrant(r, 'super_admin');
  const caps = r.body.grant.capabilities;
  assert.equal(caps.length, 16);
  assert.equal(new Set(caps).size, caps.length);
  for (const c of caps) {
    assert.match(c, /^(corporate|platform)\.[a-z_]+(\.[a-z_]+)*\.read$/, c);
    assert.doesNotMatch(c, /\*|manage|\bact\b|approve|publish|export|delete|write|deploy|configure|create|update|revoke|delegate|generate/, c);
  }
  // super_admin is not "more": the role-derived compatibility is identical for every compatibility role, and the governance
  // capabilities are exactly the persistent ones — a platform role adds none.
  const admin = await getAccess({ token: 'tok-u-admin' });
  assert.deepEqual(r.body.grant.capabilities, admin.body.grant.capabilities);
  assert.deepEqual(r.body.grant.compatibility, admin.body.grant.compatibility);
  assert.deepEqual(r.body.grant.governance_capabilities, admin.body.grant.governance_capabilities);
  assert.equal(r.body.grant.source, CORPORATE_GRANT_SOURCE);
});

test('the decision is read-only: no request in this file writes to the store', async () => {
  const before = JSON.stringify(world.tables);
  const writesBefore = world.writes.length;
  for (const [, id] of [...DENIED_ACTORS, ...GRANTED_ACTORS, ...NON_MEMBER_ADMINS]) await getAccess({ token: `tok-${id}` });
  await getAccess();
  await getAccess({ headers: { 'x-user-id': 'u-admin' } });
  assert.equal(world.writes.length, writesBefore, 'no insert/update/delete');
  assert.equal(JSON.stringify(world.tables), before, 'store unchanged');
});

// ── Construction guards (mutation-checked) ────────────────────────────────────────────────────────

const routeSource = readFileSync(path.join(REPO, 'backend/routes/corporateAccessRoutes.js'), 'utf8');
const serviceSource = readFileSync(path.join(REPO, 'backend/services/corporate/corporateAccessService.js'), 'utf8');
const code = (s) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

function routeIsSessionOnly(src) {
  const c = code(src);
  return /router\.get\('\/api\/corporate\/access', authorizeSessionRole\(\[\]\), /.test(c)
    && /router\.get\('\/api\/corporate\/people-access', authorizeSessionRole\(\[\]\), /.test(c)
    && !/\bauthorizeRole\(|optionalAuth\(/.test(c);
}
/** The bounded compatibility reads ONLY the session method and the platform role taken from users.role. */
function bridgeReadsOnlyPlatformRole(src) {
  const c = code(src);
  const body = c.slice(c.indexOf('export function evaluateLegacyCompatibilityBridge'), c.indexOf('async function readEffectiveAssignments'));
  return /userContext\.authenticationMethod !== 'session'/.test(body)
    && /userContext\.platformRole/.test(body)
    && !/effectiveRole|tenantRole|activeTenant|requestedRole|tenantId|headers|\.role\b|baseRole/.test(c);
}
/** Admission order: session → ACTIVE membership → trusted evaluator → refusal when nothing is confirmed → only THEN the bridge. */
function admissionIsPersistentAuthority(src) {
  const c = code(src);
  const start = c.indexOf('export async function evaluateCorporateAccess');
  if (start < 0) return false;
  const body = c.slice(start);
  const at = (needle) => body.indexOf(needle);
  const order = [
    at("userContext.authenticationMethod !== 'session'"), at('resolveCorporateMembership('), at('membership.is_active_member !== true'),
    at('evaluateCorporateGovernanceAuthorization('), at("if (confirmed.length === 0) return deny('not_admitted');"), at('evaluateLegacyCompatibilityBridge(userContext)'),
  ];
  return order.every((i) => i >= 0) && order.every((i, k) => k === 0 || order[k - 1] < i);
}

test('guard: session-only routes; admission = session → membership → evaluator; the bridge reads only the platform role, only AFTER admission (mutants die)', () => {
  assert.equal(routeIsSessionOnly(routeSource), true);
  assert.equal(bridgeReadsOnlyPlatformRole(serviceSource), true);
  assert.equal(admissionIsPersistentAuthority(serviceSource), true);
  const m1 = routeSource.replace('authorizeSessionRole([])', "authorizeRole([], { allowUserIdFallback: true })");
  assert.notEqual(m1, routeSource); assert.equal(routeIsSessionOnly(m1), false, 'M1 header-fallback route survived');
  const m2 = serviceSource.replace('userContext.platformRole', 'userContext.effectiveRole');
  assert.notEqual(m2, serviceSource); assert.equal(bridgeReadsOnlyPlatformRole(m2), false, 'M2 effective-role bridge survived');
  const m3 = serviceSource.replace('  const actor = userContext.id;\n', "  const actor = userContext.id;\n  if (evaluateLegacyCompatibilityBridge(userContext)) return deny('unauthenticated');\n");
  assert.notEqual(m3, serviceSource); assert.equal(admissionIsPersistentAuthority(m3), false, 'M3 bridge consulted before admission survived');
  const m4 = serviceSource.replace('membership.is_active_member !== true', 'false');
  assert.notEqual(m4, serviceSource); assert.equal(admissionIsPersistentAuthority(m4), false, 'M4 membership-free admission survived');
  const m5 = serviceSource.replace('const result = await evaluateCorporateGovernanceAuthorization(', 'const result = await Promise.resolve(');
  assert.notEqual(m5, serviceSource); assert.equal(admissionIsPersistentAuthority(m5), false, 'M5 evaluator-free admission survived');
});

test('guard: the route is mounted on the shipped app', () => {
  const server = readFileSync(path.join(REPO, 'backend/server.js'), 'utf8');
  assert.match(server, /import corporateAccessRouter from '\.\/routes\/corporateAccessRoutes\.js';/);
  assert.match(server, /\napp\.use\(corporateAccessRouter\);/);
});

test('parity: the server capability set is exactly the union of the web navigation capabilities', () => {
  const nav = readFileSync(path.join(REPO, 'web/src/config/corporate/navigation.ts'), 'utf8');
  const webCaps = new Set();
  for (const m of nav.matchAll(/navCapabilities: \[([^\]]*)\]/g)) {
    for (const c of m[1].matchAll(/'([^']+)'/g)) webCaps.add(c[1]);
  }
  assert.equal(webCaps.size, 16, 'navigation capabilities parsed');
  assert.deepEqual([...webCaps].sort(), [...CORPORATE_COMPATIBILITY_READ_CAPABILITIES].sort());
});
