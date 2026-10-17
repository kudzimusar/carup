/**
 * OC-5D (P1) — a VERIFIED, EXPLICIT active-tenant context. Through the SHIPPED app, the real middleware
 * and an in-memory world.
 *
 * Before: login and /me handed back the caller's "sole" membership as a hint the client then sent as
 * x-tenant-id; #197 extended the guess to "the oldest"; featureGovernance made a third, unordered one.
 * The middleware checked membership only — never the tenant's type or status — and a membership read
 * that FAILED answered 403 "you do not belong". switch-role spread `select('*')` from users into its
 * response (the caller's own password hash) and let any tenant role but 'admin' be assumed.
 *
 * Proven here:
 *   · login never picks an organisation; it lists the memberships the person may choose from;
 *   · PUT /api/auth/active-tenant is the only way a session gains one — verified (a membership of an
 *     ACTIVE tenant), recorded on the session, audited, and withdrawn if the audit cannot be written;
 *   · every request re-verifies the selection: revoking the membership or deactivating the tenant
 *     ends its authority on the very next request;
 *   · x-tenant-id is an assertion about the selection — a different one is refused, a revoked one is
 *     refused; with no selection the header is verified (membership AND active tenant) for one release;
 *   · a failed membership read is a 503, never "not a member";
 *   · requireActiveTenant answers type and role questions, with no platform-admin bypass;
 *   · switch-role returns an allow-listed user and lends only the governed domain roles;
 *   · optionalAuth and featureGovernance use the same verifier;
 *   · an audit record attributes only a VERIFIED tenant, never a raw header.
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import express from 'express';

for (const method of ['log', 'info', 'warn', 'debug', 'error']) console[method] = () => {};

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
delete process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;

const { createSupabaseWorld, installSupabaseWorld } = await import('./helpers/inMemorySupabaseWorld.js');
const { app } = await import('../server.js');
const { supabase } = await import('../db/supabase.js');
const { hashPassword } = await import('../utils/passwordAuth.js');
const { authorizeRole, authorizeSessionRole, optionalAuth, requireActiveTenant } = await import('../middleware/authMiddleware.js');
const {
  resolveVerifiedActiveTenant,
  listVerifiedMemberships,
  toActiveTenantView,
  TenantContextUnavailableError,
} = await import('../services/auth/activeTenantContext.js');
const { resolveRequestContext } = await import('../services/featureGovernance/featureGovernanceService.js');
const { logAuditEvent } = await import('../services/auditLogger.js');

const FUTURE = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
const PASSWORD = 'correct horse battery';
const PASSWORD_HASH = await hashPassword(PASSWORD);

const GARAGE = 'tenant-garage';
const DEALER = 'tenant-dealer';
const CLOSED = 'tenant-closed';
const GOV = 'tenant-gov';

let world; let restoreWorld; let server; let baseUrl;
function seedWorld() {
  restoreWorld?.();
  world = createSupabaseWorld({
    users: [
      { id: 'u-mech', name: 'Farai Garage', email: 'mech@example.invalid', phone: '', role: 'owner', is_verified: true, password_hash: PASSWORD_HASH },
      { id: 'u-multi', name: 'Rudo Two', email: 'multi@example.invalid', phone: '', role: 'owner', is_verified: true, password_hash: PASSWORD_HASH },
      { id: 'u-none', name: 'Tendai None', email: 'none@example.invalid', phone: '', role: 'owner', is_verified: true, password_hash: PASSWORD_HASH },
      { id: 'u-padmin', name: 'Platform Admin', email: 'padmin@example.invalid', phone: '', role: 'admin', is_verified: true, password_hash: PASSWORD_HASH },
    ],
    user_sessions: [
      { id: 's-mech', token: 'tok-mech', user_id: 'u-mech', active_role: 'owner', active_organization_id: null, is_valid: true, expires_at: FUTURE },
      { id: 's-multi', token: 'tok-multi', user_id: 'u-multi', active_role: 'owner', active_organization_id: null, is_valid: true, expires_at: FUTURE },
      { id: 's-multi-2', token: 'tok-multi-2', user_id: 'u-multi', active_role: 'owner', active_organization_id: null, is_valid: true, expires_at: FUTURE },
      { id: 's-none', token: 'tok-none', user_id: 'u-none', active_role: 'owner', active_organization_id: null, is_valid: true, expires_at: FUTURE },
      { id: 's-padmin', token: 'tok-padmin', user_id: 'u-padmin', active_role: 'admin', active_organization_id: null, is_valid: true, expires_at: FUTURE },
    ],
    tenants: [
      { id: GARAGE, name: 'Mbare Motors', type: 'garage', status: 'active' },
      { id: DEALER, name: 'Avondale Dealers', type: 'dealership', status: 'active' },
      { id: CLOSED, name: 'Closed Garage', type: 'garage', status: 'suspended' },
      { id: GOV, name: 'Registry Office', type: 'government', status: 'active' },
    ],
    tenant_users: [
      { tenant_id: GARAGE, user_id: 'u-mech', role: 'mechanic' },
      { tenant_id: GARAGE, user_id: 'u-multi', role: 'admin' },
      { tenant_id: DEALER, user_id: 'u-multi', role: 'dealer' },
      { tenant_id: CLOSED, user_id: 'u-multi', role: 'admin' },
      { tenant_id: GOV, user_id: 'u-multi', role: 'government' }, // a pre-catalogue hostile row
    ],
    trust_audit_events: [],
    login_attempts: [],
  });
  restoreWorld = installSupabaseWorld(supabase, world);
}

/** Make one table's reads (or writes) fail the way a network failure does: an error with no code. */
function failTable(table, { op = 'select' } = {}) {
  const inner = supabase.from;
  supabase.from = (name) => {
    const builder = inner(name);
    if (name !== table) return builder;
    const failure = { data: null, error: { message: 'connection reset' } };
    if (op === 'select') {
      builder.single = async () => failure;
      builder.maybeSingle = async () => failure;
      builder.then = (resolve, reject) => Promise.resolve(failure).then(resolve, reject);
    } else {
      const original = builder[op].bind(builder);
      builder[op] = (...args) => {
        original(...args);
        builder.single = async () => failure;
        builder.then = (resolve, reject) => Promise.resolve(failure).then(resolve, reject);
        return builder;
      };
    }
    return builder;
  };
  return () => { supabase.from = inner; };
}

before(async () => {
  seedWorld();
  await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  restoreWorld?.();
  if (server) await new Promise((resolve) => server.close(resolve));
});
beforeEach(() => seedWorld());

async function call(method, path, { token, body, headers = {}, base = baseUrl } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-bypass-rate-limit': 'true', ...(token ? { 'x-session-token': token } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, text };
}

const session = (token) => world.rows('user_sessions').find((s) => s.token === token);
const auditsOf = (type) => world.rows('trust_audit_events').filter((e) => e.event_type === type);

/** A probe app behind the REAL middleware, sharing the world. */
async function withProbe(handlers, fn) {
  const probe = express();
  probe.get('/probe', ...handlers, (req, res) => res.json({ ctx: req.userContext ?? null }));
  const probeServer = http.createServer(probe);
  await new Promise((resolve) => probeServer.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${probeServer.address().port}`;
  try { return await fn((opts) => call('GET', '/probe', { ...opts, base })); } finally {
    await new Promise((resolve) => probeServer.close(resolve));
  }
}

// ── The verifier ───────────────────────────────────────────────────────────────────────────────────

test('verifier: a membership of an active tenant carries its type, status and role', async () => {
  const tenant = await resolveVerifiedActiveTenant(supabase, 'u-multi', GARAGE);
  assert.deepEqual(toActiveTenantView(tenant), { id: GARAGE, name: 'Mbare Motors', type: 'garage', status: 'active', role: 'admin' });
  assert.equal(tenant.usable, true);
  assert.equal(tenant.metadataUnavailable, false);
});

test('verifier: not a member → null; a deactivated tenant is a membership that is not usable', async () => {
  assert.equal(await resolveVerifiedActiveTenant(supabase, 'u-mech', DEALER), null);
  assert.equal(await resolveVerifiedActiveTenant(supabase, 'u-mech', null), null);
  const closed = await resolveVerifiedActiveTenant(supabase, 'u-multi', CLOSED);
  assert.equal(closed.status, 'suspended');
  assert.equal(closed.usable, false);
});

test('verifier: a FAILED membership read is TenantContextUnavailableError (503), never "not a member"', async () => {
  const restore = failTable('tenant_users');
  try {
    await assert.rejects(resolveVerifiedActiveTenant(supabase, 'u-mech', GARAGE), (error) => {
      assert.ok(error instanceof TenantContextUnavailableError);
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, 'TENANT_CONTEXT_UNAVAILABLE');
      assert.doesNotMatch(JSON.stringify(error.details), /connection reset/, 'no raw database text in the details');
      return true;
    });
  } finally { restore(); }
});

test('verifier: a malformed tenant id (Postgres 22P02) names no tenant — not an outage', async () => {
  const inner = supabase.from;
  supabase.from = (name) => {
    const builder = inner(name);
    if (name === 'tenant_users') builder.single = async () => ({ data: null, error: { code: '22P02', message: 'invalid input syntax for type uuid' } });
    return builder;
  };
  try {
    assert.equal(await resolveVerifiedActiveTenant(supabase, 'u-mech', 'not-a-uuid'), null);
  } finally { supabase.from = inner; }
});

test('verifier: a store that answers "no row" WITHOUT an error (maybeSingle-style) is still not a member', async () => {
  const inner = supabase.from;
  supabase.from = (name) => {
    const builder = inner(name);
    if (name === 'tenant_users') builder.single = async () => ({ data: null, error: null });
    return builder;
  };
  try {
    assert.equal(await resolveVerifiedActiveTenant(supabase, 'u-mech', GARAGE), null);
  } finally { supabase.from = inner; }
});

test('verifier: membership proven but the tenant row unreadable → usable, metadataUnavailable (a type guard must 503)', async () => {
  const restore = failTable('tenants');
  try {
    const tenant = await resolveVerifiedActiveTenant(supabase, 'u-mech', GARAGE);
    assert.equal(tenant.role, 'mechanic');
    assert.equal(tenant.metadataUnavailable, true);
    assert.equal(tenant.type, null);
  } finally { restore(); }
});

test('memberships: every organisation, with its type/status/role and whether it can be selected; a failed read throws', async () => {
  const list = await listVerifiedMemberships(supabase, 'u-multi');
  assert.deepEqual(list.map((m) => [m.name, m.type, m.role, m.selectable]), [
    ['Avondale Dealers', 'dealership', 'dealer', true],
    ['Closed Garage', 'garage', 'admin', false],
    ['Mbare Motors', 'garage', 'admin', true],
    ['Registry Office', 'government', 'government', true],
  ]);
  assert.deepEqual(await listVerifiedMemberships(supabase, 'u-none'), []);
  const restore = failTable('tenant_users');
  try {
    await assert.rejects(listVerifiedMemberships(supabase, 'u-multi'), TenantContextUnavailableError);
  } finally { restore(); }
});

// ── Login never guesses ──────────────────────────────────────────────────────────────────────────

test('login: a SOLE membership is listed, never selected — the new session carries no organisation', async () => {
  const res = await call('POST', '/api/auth/login', { body: { email: 'mech@example.invalid', password: PASSWORD } });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.user.active_tenant_id, null);
  assert.equal(res.body.user.tenant_role, null);
  assert.equal(res.body.user.active_tenant, null);
  assert.deepEqual(res.body.user.memberships, [
    { id: GARAGE, name: 'Mbare Motors', type: 'garage', status: 'active', role: 'mechanic', selectable: true },
  ]);
  assert.equal(res.body.user.password_hash, undefined);
  assert.equal(session(res.body.token).active_organization_id, null, 'the session row itself starts with no organisation');

  const me = await call('GET', '/api/auth/me', { token: res.body.token });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.active_tenant_id, null, '/me does not guess either');
  assert.equal(me.body.user.tenant_context, 'none');
  assert.equal(me.body.user.memberships.length, 1);
});

test('login: a failed membership read never fails the login — it is reported', async () => {
  const restore = failTable('tenant_users');
  try {
    const res = await call('POST', '/api/auth/login', { body: { email: 'multi@example.invalid', password: PASSWORD } });
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.body.user.memberships, []);
    assert.equal(res.body.user.memberships_unavailable, true);
    assert.equal(res.body.user.active_tenant_id, null);
  } finally { restore(); }
});

test('source: the sole-membership guess is gone from the server', () => {
  const src = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /resolveSoleTenantMembership/);
  assert.doesNotMatch(src, /\.limit\(2\)[\s\S]{0,120}data\.length !== 1/);
});

// ── Selecting an organisation ────────────────────────────────────────────────────────────────────

test('select: a verified membership is recorded on THIS session, audited, and /me reports it', async () => {
  const res = await call('PUT', '/api/auth/active-tenant', { token: 'tok-multi', body: { tenantId: GARAGE } });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.body.active_tenant, { id: GARAGE, name: 'Mbare Motors', type: 'garage', status: 'active', role: 'admin' });
  assert.equal(res.body.user.active_tenant_id, GARAGE);
  assert.equal(res.body.user.tenant_role, 'admin');
  assert.equal(session('tok-multi').active_organization_id, GARAGE);
  assert.equal(session('tok-mech').active_organization_id, null, 'no other session moved');
  assert.equal(session('tok-multi-2').active_organization_id, null, 'the SAME person\'s other session (another device) did not move');

  const [audit] = auditsOf('ACTIVE_TENANT_SELECTED');
  assert.ok(audit, 'the selection is audited');
  assert.equal(audit.actor_user_id, 'u-multi');
  assert.equal(audit.actor_tenant_id, GARAGE);
  assert.deepEqual(audit.previous_value, { tenantId: null });
  assert.equal(audit.new_value.tenantId, GARAGE);

  const me = await call('GET', '/api/auth/me', { token: 'tok-multi' });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.active_tenant_id, GARAGE);
  assert.equal(me.body.user.tenant_context, 'selected');
  assert.deepEqual(me.body.user.active_tenant, res.body.active_tenant);
  assert.equal(me.body.user.memberships.length, 4);
});

test('select: not a member → 403 TENANT_NOT_MEMBER; inactive → 403 TENANT_INACTIVE; nothing recorded', async () => {
  const notMine = await call('PUT', '/api/auth/active-tenant', { token: 'tok-mech', body: { tenantId: DEALER } });
  assert.equal(notMine.status, 403);
  assert.equal(notMine.body.code, 'TENANT_NOT_MEMBER');
  const closed = await call('PUT', '/api/auth/active-tenant', { token: 'tok-multi', body: { tenantId: CLOSED } });
  assert.equal(closed.status, 403);
  assert.equal(closed.body.code, 'TENANT_INACTIVE');
  assert.equal(session('tok-mech').active_organization_id, null);
  assert.equal(session('tok-multi').active_organization_id, null);
  assert.equal(auditsOf('ACTIVE_TENANT_SELECTED').length, 0);
});

test('select: a failed membership read → 503, nothing recorded', async () => {
  const restore = failTable('tenant_users');
  try {
    const res = await call('PUT', '/api/auth/active-tenant', { token: 'tok-mech', body: { tenantId: GARAGE } });
    assert.equal(res.status, 503);
    assert.equal(res.body.code, 'TENANT_CONTEXT_UNAVAILABLE');
  } finally { restore(); }
  assert.equal(session('tok-mech').active_organization_id, null);
});

test('select: an unreadable tenant row cannot be selected (its status is unproven) → 503', async () => {
  const restore = failTable('tenants');
  try {
    const res = await call('PUT', '/api/auth/active-tenant', { token: 'tok-mech', body: { tenantId: GARAGE } });
    assert.equal(res.status, 503);
    assert.equal(res.body.code, 'TENANT_CONTEXT_UNAVAILABLE');
  } finally { restore(); }
  assert.equal(session('tok-mech').active_organization_id, null);
});

test('select: needs a real session (the x-user-id fallback is refused) and a well-formed body', async () => {
  const fallback = await call('PUT', '/api/auth/active-tenant', { headers: { 'x-user-id': 'u-mech' }, body: { tenantId: GARAGE } });
  assert.equal(fallback.status, 401);
  const probe = await call('PUT', '/api/auth/active-tenant', { headers: { 'x-user-id': 'u-mech' }, body: { tenantId: DEALER } });
  assert.equal(probe.status, 401, 'an asserted identity is refused before any membership is consulted (no membership oracle)');
  const anonymous = await call('PUT', '/api/auth/active-tenant', { body: { tenantId: GARAGE } });
  assert.equal(anonymous.status, 401);
  for (const body of [{}, { tenantId: 42 }, { tenantId: { id: GARAGE } }, { tenantId: 'x'.repeat(129) }]) {
    const res = await call('PUT', '/api/auth/active-tenant', { token: 'tok-mech', body });
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.code, 'INVALID_TENANT_ID');
  }
  assert.equal(session('tok-mech').active_organization_id, null);
});

test('select: CSRF-protected like every other session write; a blank id clears rather than storing ""', async () => {
  const forged = await call('PUT', '/api/auth/active-tenant', { token: 'tok-mech', headers: { 'x-verify-csrf': 'true' }, body: { tenantId: GARAGE } });
  assert.equal(forged.status, 403, 'no CSRF token, no selection');
  assert.equal(session('tok-mech').active_organization_id, null);
  await call('PUT', '/api/auth/active-tenant', { token: 'tok-mech', body: { tenantId: GARAGE } });
  const blank = await call('PUT', '/api/auth/active-tenant', { token: 'tok-mech', body: { tenantId: '   ' } });
  assert.equal(blank.status, 200, blank.text);
  assert.equal(session('tok-mech').active_organization_id, null);
});

test('select: null clears the selection (audited as cleared)', async () => {
  await call('PUT', '/api/auth/active-tenant', { token: 'tok-mech', body: { tenantId: GARAGE } });
  const res = await call('PUT', '/api/auth/active-tenant', { token: 'tok-mech', body: { tenantId: null } });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.active_tenant, null);
  assert.equal(session('tok-mech').active_organization_id, null);
  const [cleared] = auditsOf('ACTIVE_TENANT_CLEARED');
  assert.deepEqual(cleared.previous_value, { tenantId: GARAGE });
});

test('select: an audit that cannot be written WITHDRAWS the selection (503) — no unaudited change of acting authority', async () => {
  await call('PUT', '/api/auth/active-tenant', { token: 'tok-multi', body: { tenantId: DEALER } });
  assert.equal(session('tok-multi').active_organization_id, DEALER);
  const restore = failTable('trust_audit_events', { op: 'insert' });
  let res;
  try {
    res = await call('PUT', '/api/auth/active-tenant', { token: 'tok-multi', body: { tenantId: GARAGE } });
  } finally { restore(); }
  assert.equal(res.status, 503);
  assert.equal(res.body.code, 'ACTIVE_TENANT_AUDIT_UNAVAILABLE');
  assert.equal(session('tok-multi').active_organization_id, DEALER, 'the previous selection is restored');
  assert.equal(session('tok-multi').is_valid, true);
});

test('select: the session endpoints ignore a stale x-tenant-id, so a confused client can always recover', async () => {
  await call('PUT', '/api/auth/active-tenant', { token: 'tok-multi', body: { tenantId: GARAGE } });
  const me = await call('GET', '/api/auth/me', { token: 'tok-multi', headers: { 'x-tenant-id': DEALER } });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.active_tenant_id, GARAGE);
  const reselect = await call('PUT', '/api/auth/active-tenant', { token: 'tok-multi', headers: { 'x-tenant-id': CLOSED }, body: { tenantId: DEALER } });
  assert.equal(reselect.status, 200, reselect.text);
  assert.equal(session('tok-multi').active_organization_id, DEALER);
});

// ── Every request re-verifies ────────────────────────────────────────────────────────────────────

test('middleware: the selection IS the context — no header needed — and a different header is refused', async () => {
  await call('PUT', '/api/auth/active-tenant', { token: 'tok-multi', body: { tenantId: DEALER } });
  await withProbe([authorizeRole()], async (probe) => {
    const plain = await probe({ token: 'tok-multi' });
    assert.equal(plain.status, 200);
    assert.equal(plain.body.ctx.tenantId, DEALER);
    assert.equal(plain.body.ctx.tenantRole, 'dealer');
    assert.equal(plain.body.ctx.tenantContext, 'selected');
    assert.equal(plain.body.ctx.activeTenant.type, 'dealership');
    const same = await probe({ token: 'tok-multi', headers: { 'x-tenant-id': DEALER } });
    assert.equal(same.status, 200);
    const other = await probe({ token: 'tok-multi', headers: { 'x-tenant-id': GARAGE } });
    assert.equal(other.status, 403, 'a header naming another organisation — even one the person belongs to — is refused');
    assert.equal(other.body.code, 'TENANT_CONTEXT_MISMATCH');
  });
});

test('middleware: revoking the membership ends its authority on the NEXT request', async () => {
  await call('PUT', '/api/auth/active-tenant', { token: 'tok-mech', body: { tenantId: GARAGE } });
  await withProbe([authorizeRole(), requireActiveTenant({ types: ['garage'] })], async (probe) => {
    assert.equal((await probe({ token: 'tok-mech' })).status, 200);
    world.tables.tenant_users = world.rows('tenant_users').filter((m) => m.user_id !== 'u-mech');
    const after = await probe({ token: 'tok-mech' });
    assert.equal(after.status, 403);
    assert.equal(after.body.code, 'TENANT_CONTEXT_REVOKED');
    const asserted = await probe({ token: 'tok-mech', headers: { 'x-tenant-id': GARAGE } });
    assert.equal(asserted.status, 403, 'asserting the revoked organisation is refused outright');
    assert.equal(asserted.body.code, 'TENANT_CONTEXT_REVOKED');
  });
  await withProbe([authorizeRole()], async (probe) => {
    const asserted = await probe({ token: 'tok-mech', headers: { 'x-tenant-id': GARAGE } });
    assert.equal(asserted.status, 403, 'the middleware itself refuses — no handler, and no raw-header fallback in one, ever sees it');
    assert.equal(asserted.body.code, 'TENANT_CONTEXT_REVOKED');
    assert.equal(asserted.body.ctx, undefined);
    const personal = await probe({ token: 'tok-mech' });
    assert.equal(personal.status, 200, 'the person keeps their own account; only the organisation is gone');
    assert.equal(personal.body.ctx.tenantId, null);
    assert.equal(personal.body.ctx.tenantRole, null);
    assert.equal(personal.body.ctx.tenantContext, 'revoked');
  });
  const me = await call('GET', '/api/auth/me', { token: 'tok-mech' });
  assert.equal(me.body.user.tenant_context, 'revoked');
  assert.equal(me.body.user.active_tenant_id, null);
});

test('middleware: deactivating the TENANT ends the selection the same way', async () => {
  await call('PUT', '/api/auth/active-tenant', { token: 'tok-mech', body: { tenantId: GARAGE } });
  world.rows('tenants').find((t) => t.id === GARAGE).status = 'suspended';
  await withProbe([authorizeRole(), requireActiveTenant()], async (probe) => {
    const res = await probe({ token: 'tok-mech' });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'TENANT_CONTEXT_REVOKED');
  });
});

test('middleware: a FAILED read of the selection is a 503, never a silent downgrade or "not a member"', async () => {
  await call('PUT', '/api/auth/active-tenant', { token: 'tok-mech', body: { tenantId: GARAGE } });
  const restore = failTable('tenant_users');
  try {
    await withProbe([authorizeRole()], async (probe) => {
      const res = await probe({ token: 'tok-mech' });
      assert.equal(res.status, 503);
      assert.equal(res.body.code, 'TENANT_CONTEXT_UNAVAILABLE');
    });
  } finally { restore(); }
});

test('middleware (one release): with no selection, a header is verified — membership AND an active tenant', async () => {
  await withProbe([authorizeRole()], async (probe) => {
    const ok = await probe({ token: 'tok-multi', headers: { 'x-tenant-id': GARAGE } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.ctx.tenantId, GARAGE);
    assert.equal(ok.body.ctx.tenantContext, 'asserted');
    const notMine = await probe({ token: 'tok-mech', headers: { 'x-tenant-id': DEALER } });
    assert.equal(notMine.status, 403);
    const inactive = await probe({ token: 'tok-multi', headers: { 'x-tenant-id': CLOSED } });
    assert.equal(inactive.status, 403, 'membership alone used to be enough');
    assert.equal(inactive.body.code, 'TENANT_INACTIVE');
    const none = await probe({ token: 'tok-multi' });
    assert.equal(none.status, 200);
    assert.equal(none.body.ctx.tenantId, null);
    assert.equal(none.body.ctx.tenantContext, 'none');
  });
  const restore = failTable('tenant_users');
  try {
    await withProbe([authorizeRole()], async (probe) => {
      const res = await probe({ token: 'tok-mech', headers: { 'x-tenant-id': GARAGE } });
      assert.equal(res.status, 503, 'RC1 answered 403 "you do not belong" to a broken query');
      assert.equal(res.body.code, 'TENANT_CONTEXT_UNAVAILABLE');
    });
  } finally { restore(); }
});

test('middleware: a lent role comes only from the verified selection, and only a lendable one', async () => {
  await call('PUT', '/api/auth/active-tenant', { token: 'tok-mech', body: { tenantId: GARAGE } });
  await withProbe([authorizeRole(['mechanic'])], async (probe) => {
    const lent = await probe({ token: 'tok-mech', headers: { 'x-stakeholder-role': 'mechanic' } });
    assert.equal(lent.status, 200);
    assert.equal(lent.body.ctx.role, 'mechanic');
    assert.equal(lent.body.ctx.platformRole, 'owner');
  });
  await call('PUT', '/api/auth/active-tenant', { token: 'tok-multi', body: { tenantId: GOV } });
  await withProbe([authorizeRole(['government'])], async (probe) => {
    const hostile = await probe({ token: 'tok-multi', headers: { 'x-stakeholder-role': 'government' } });
    assert.equal(hostile.status, 403, 'a tenant row reading government lends nothing, selected or not');
  });
});

// ── requireActiveTenant ──────────────────────────────────────────────────────────────────────────

test('requireActiveTenant: no organisation, the wrong kind, the wrong role — each refused by name', async () => {
  const guard = [authorizeSessionRole(), requireActiveTenant({ types: ['garage'], roles: ['admin'] })];
  await withProbe(guard, async (probe) => {
    const none = await probe({ token: 'tok-multi' });
    assert.equal(none.status, 403);
    assert.equal(none.body.code, 'ACTIVE_TENANT_REQUIRED');
  });
  await call('PUT', '/api/auth/active-tenant', { token: 'tok-multi', body: { tenantId: DEALER } });
  await withProbe(guard, async (probe) => {
    const wrongKind = await probe({ token: 'tok-multi' });
    assert.equal(wrongKind.status, 403);
    assert.equal(wrongKind.body.code, 'ACTIVE_TENANT_TYPE');
  });
  await call('PUT', '/api/auth/active-tenant', { token: 'tok-mech', body: { tenantId: GARAGE } });
  await withProbe(guard, async (probe) => {
    const wrongRole = await probe({ token: 'tok-mech' });
    assert.equal(wrongRole.status, 403);
    assert.equal(wrongRole.body.code, 'ACTIVE_TENANT_ROLE');
  });
  await call('PUT', '/api/auth/active-tenant', { token: 'tok-multi', body: { tenantId: GARAGE } });
  await withProbe(guard, async (probe) => {
    const ok = await probe({ token: 'tok-multi' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.ctx.activeTenant.role, 'admin');
  });
});

test('requireActiveTenant: no platform-admin bypass — acting for a garage is a garage member\'s act', async () => {
  await withProbe([authorizeSessionRole(), requireActiveTenant({ types: ['garage'] })], async (probe) => {
    const res = await probe({ token: 'tok-padmin' });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'ACTIVE_TENANT_REQUIRED');
  });
});

test('requireActiveTenant: an unreadable tenant row cannot prove the TYPE → 503; unauthenticated → 401', async () => {
  await call('PUT', '/api/auth/active-tenant', { token: 'tok-mech', body: { tenantId: GARAGE } });
  const restore = failTable('tenants');
  try {
    await withProbe([authorizeSessionRole(), requireActiveTenant({ types: ['garage'] })], async (probe) => {
      const res = await probe({ token: 'tok-mech' });
      assert.equal(res.status, 503);
      assert.equal(res.body.code, 'TENANT_CONTEXT_UNAVAILABLE');
    });
  } finally { restore(); }
  await withProbe([requireActiveTenant()], async (probe) => {
    const res = await probe({});
    assert.equal(res.status, 401);
  });
});

// ── switch-role ──────────────────────────────────────────────────────────────────────────────────

test('switch-role: the response is an allow-listed user — no password hash, no unlisted column', async () => {
  const res = await call('POST', '/api/auth/switch-role', { token: 'tok-mech', body: { userId: 'u-mech', role: 'owner' } });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.user.password_hash, undefined);
  assert.doesNotMatch(res.text, /password_hash|\$2[aby]\$|scrypt/i);
  assert.deepEqual(Object.keys(res.body.user).sort(), ['active_tenant', 'active_tenant_id', 'email', 'id', 'is_verified', 'name', 'phone', 'role', 'tenant_role']);
});

test('switch-role: a lendable membership switches and the new session carries the verified organisation', async () => {
  const res = await call('POST', '/api/auth/switch-role', { token: 'tok-mech', body: { userId: 'u-mech', role: 'mechanic', tenantId: GARAGE } });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.user.active_tenant_id, GARAGE);
  assert.equal(res.body.user.active_tenant.type, 'garage');
  assert.equal(session(res.body.token).active_organization_id, GARAGE);
  assert.equal(session(res.body.token).active_role, 'mechanic');
});

test('switch-role: a tenant row reading government — or admin — cannot be assumed; an inactive tenant cannot be switched into', async () => {
  const gov = await call('POST', '/api/auth/switch-role', { token: 'tok-multi', body: { userId: 'u-multi', role: 'government', tenantId: GOV } });
  assert.equal(gov.status, 403, 'RC1 minted a government session here');
  const admin = await call('POST', '/api/auth/switch-role', { token: 'tok-multi', body: { userId: 'u-multi', role: 'admin', tenantId: GARAGE } });
  assert.equal(admin.status, 403);
  const closed = await call('POST', '/api/auth/switch-role', { token: 'tok-multi', body: { userId: 'u-multi', role: 'owner', tenantId: CLOSED } });
  assert.equal(closed.status, 403);
  const minted = world.rows('user_sessions').filter((s) => s.user_id === 'u-multi');
  assert.equal(minted.length, 2, 'no session was minted by a refused switch (two were seeded)');
});

test('switch-role: a failed membership read is a 503, not a refusal', async () => {
  const restore = failTable('tenant_users');
  try {
    const res = await call('POST', '/api/auth/switch-role', { token: 'tok-mech', body: { userId: 'u-mech', role: 'mechanic', tenantId: GARAGE } });
    assert.equal(res.status, 503);
  } finally { restore(); }
});

// ── The same verifier everywhere ─────────────────────────────────────────────────────────────────

test('optionalAuth: the selection is context; a mismatching header or a revoked selection yields none; never blocks', async () => {
  await call('PUT', '/api/auth/active-tenant', { token: 'tok-multi', body: { tenantId: DEALER } });
  await withProbe([optionalAuth()], async (probe) => {
    const plain = await probe({ token: 'tok-multi' });
    assert.equal(plain.body.ctx.tenantId, DEALER);
    assert.equal(plain.body.ctx.activeTenant.type, 'dealership');
    const mismatch = await probe({ token: 'tok-multi', headers: { 'x-tenant-id': GARAGE } });
    assert.equal(mismatch.status, 200);
    assert.equal(mismatch.body.ctx.tenantId, null);
    world.rows('tenants').find((t) => t.id === DEALER).status = 'closed';
    const revoked = await probe({ token: 'tok-multi' });
    assert.equal(revoked.status, 200);
    assert.equal(revoked.body.ctx.tenantId, null);
    const inactiveHeader = await probe({ token: 'tok-none', headers: { 'x-tenant-id': CLOSED } });
    assert.equal(inactiveHeader.body.ctx.tenantId, null);
  });
  const restore = failTable('tenant_users');
  try {
    await withProbe([optionalAuth()], async (probe) => {
      const res = await probe({ token: 'tok-multi' });
      assert.equal(res.status, 200);
      assert.equal(res.body.ctx.tenantId, null);
    });
  } finally { restore(); }
});

test('featureGovernance: a switched session lends only a lendable role of an ACTIVE tenant', async () => {
  world.rows('user_sessions').push(
    { token: 'tok-fg-gov', user_id: 'u-multi', active_role: 'government', active_organization_id: GOV, is_valid: true, expires_at: FUTURE },
    { token: 'tok-fg-dealer', user_id: 'u-multi', active_role: 'dealer', active_organization_id: DEALER, is_valid: true, expires_at: FUTURE },
  );
  const ctx = (token) => resolveRequestContext({ headers: { 'x-session-token': token } }, { client: supabase });
  assert.deepEqual(await ctx('tok-fg-gov').then((c) => [c.role, c.tenantId]), ['owner', null], 'RC1 surfaced government navigation here');
  assert.deepEqual(await ctx('tok-fg-dealer').then((c) => [c.role, c.tenantId]), ['dealer', DEALER]);
  world.rows('tenants').find((t) => t.id === DEALER).status = 'suspended';
  assert.deepEqual(await ctx('tok-fg-dealer').then((c) => [c.role, c.tenantId]), ['owner', null]);
});

test('audit: a raw x-tenant-id is never attributed as the actor\'s tenant; a verified one is', async () => {
  await logAuditEvent(supabase, { event_type: 'OC5D_PROBE_RAW', actor_user_id: 'u-mech', req: { headers: { 'x-tenant-id': DEALER } } });
  await logAuditEvent(supabase, { event_type: 'OC5D_PROBE_VERIFIED', actor_user_id: 'u-mech', req: { headers: { 'x-tenant-id': GARAGE }, userContext: { tenantId: GARAGE } } });
  assert.equal(auditsOf('OC5D_PROBE_RAW')[0].actor_tenant_id, null);
  assert.equal(auditsOf('OC5D_PROBE_VERIFIED')[0].actor_tenant_id, GARAGE);
});
