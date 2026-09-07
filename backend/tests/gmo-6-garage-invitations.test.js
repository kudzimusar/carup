/**
 * GMO-6 — inviting a mechanic into a garage.
 *
 * This is the second of only two product paths that create a garage membership, and the only one an
 * ordinary person can trigger. So every refusal below corresponds to a specific attack or mistake,
 * and each is tested by attempting it rather than by asserting that a guard exists.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';
process.env.JWT_SECRET ||= 'test-jwt-secret';

const {
  inviteToGarage, revokeInvitation, acceptInvitation, peekInvitation, listInvitations,
  sanitizeInvitation, INVITABLE_ROLES,
} = await import('../services/garageOnboarding/garageInvitationService.js');
const { hashCapabilityToken } = await import('../services/serviceNetwork/serviceLinkService.js');

const TENANT = 'garage-1';
const OTHER_TENANT = 'garage-2';
const ADMIN = 'u_garage_admin';
const INVITEE = 'u_invitee';
const STRANGER = 'u_stranger';

const admin = { id: ADMIN, role: 'owner', tenantId: TENANT, tenantRole: 'admin' };
const mechanicMember = { id: 'u_mech', role: 'owner', tenantId: TENANT, tenantRole: 'mechanic' };
const noContext = { id: ADMIN, role: 'owner' };

const FUTURE = new Date(Date.now() + 86400000).toISOString();
const PAST = new Date(Date.now() - 86400000).toISOString();

const INVITATION = (over = {}) => ({
  id: 'inv-1', tenant_id: TENANT, invited_email: 'thabo@example.com', invited_name: 'Thabo',
  role: 'mechanic', invited_by_user_id: ADMIN, token_hash: 'hash', expires_at: FUTURE,
  accepted_at: null, accepted_by_user_id: null, revoked_at: null, revoked_by_user_id: null,
  created_at: '2026-09-06T10:00:00Z', ...over,
});

function client(tables, log = []) {
  const withDefaults = { trust_audit_events: () => ({ data: { id: 'a1' }, error: null }), ...tables };
  const from = (table) => {
    const filters = {}; let payload = null; let op = 'select';
    const result = () => {
      log.push({ table, op, filters: { ...filters }, payload });
      const entry = withDefaults[table];
      return typeof entry === 'function' ? entry(filters, { op, payload }) : { data: entry ?? null, error: null };
    };
    const chain = {
      select() { return chain; },
      insert(p) { op = 'insert'; payload = p; return chain; },
      update(p) { op = 'update'; payload = p; return chain; },
      eq(k, v) { filters[k] = v; return chain; },
      is(k, v) { filters[`is:${k}`] = v; return chain; },
      in(k, v) { filters[`in:${k}`] = v; return chain; },
      order() { return chain; }, limit() { return chain; },
      maybeSingle: async () => result(),
      single: async () => result(),
      then(res, rej) { return Promise.resolve(result()).then(res, rej); },
    };
    return chain;
  };
  return { from };
}

const src = (rel) => readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), rel), 'utf8');

// ── who may invite ───────────────────────────────────────────────────────────────────────────────

test('GMO-6: only a garage ADMIN may invite', async () => {
  const c = client({ garage_invitations: () => ({ data: INVITATION(), error: null }) });
  await assert.rejects(
    () => inviteToGarage(c, mechanicMember, { email: 'x@example.com' }, {}),
    /Only a garage administrator can invite/,
  );
});

test('GMO-6: a person with no open garage cannot invite', async () => {
  const c = client({ garage_invitations: () => ({ data: INVITATION(), error: null }) });
  await assert.rejects(
    () => inviteToGarage(c, noContext, { email: 'x@example.com' }, {}),
    /Open the garage you want to invite someone into first/,
  );
});

test('GMO-6: the tenant comes from the VERIFIED context, never from the request', async () => {
  const log = [];
  const c = client({ garage_invitations: (_f, { payload }) => ({ data: INVITATION(payload), error: null }) }, log);
  await inviteToGarage(c, admin, { email: 'thabo@example.com', tenant_id: OTHER_TENANT, tenantId: OTHER_TENANT }, {});
  const insert = log.find((l) => l.table === 'garage_invitations' && l.op === 'insert');
  assert.equal(insert.payload.tenant_id, TENANT, 'Garage A must not be able to invite into Garage B');
  assert.notEqual(insert.payload.tenant_id, OTHER_TENANT);
});

test('GMO-6: the inviter is recorded from the session', async () => {
  const log = [];
  const c = client({ garage_invitations: (_f, { payload }) => ({ data: INVITATION(payload), error: null }) }, log);
  await inviteToGarage(c, admin, { email: 'thabo@example.com', invited_by_user_id: STRANGER }, {});
  const insert = log.find((l) => l.op === 'insert' && l.table === 'garage_invitations');
  assert.equal(insert.payload.invited_by_user_id, ADMIN);
});

// ── the token ────────────────────────────────────────────────────────────────────────────────────

test('GMO-6: the raw token is NEVER stored — only its hash', async () => {
  const log = [];
  const c = client({ garage_invitations: (_f, { payload }) => ({ data: INVITATION(payload), error: null }) }, log);
  const { token } = await inviteToGarage(c, admin, { email: 'thabo@example.com' }, {});
  const insert = log.find((l) => l.op === 'insert' && l.table === 'garage_invitations');
  assert.ok(token && token.length > 20, 'a real token is returned once, for delivery');
  assert.equal(insert.payload.token_hash, hashCapabilityToken(token));
  assert.ok(!JSON.stringify(insert.payload).includes(token),
    'a leaked table must reveal who was invited, never how to accept');
});

test('GMO-6: the token never appears in an audit record', async () => {
  const log = [];
  const c = client({ garage_invitations: (_f, { payload }) => ({ data: INVITATION(payload), error: null }) }, log);
  const { token } = await inviteToGarage(c, admin, { email: 'thabo@example.com' }, {});
  const audit = log.find((l) => l.table === 'trust_audit_events');
  assert.ok(audit, 'the invitation is audited');
  assert.ok(!JSON.stringify(audit.payload ?? {}).includes(token));
});

test('GMO-6: the token hash is never handed back to a client', () => {
  const safe = sanitizeInvitation(INVITATION({ token_hash: 'secret-hash' }));
  assert.equal(safe.token_hash, undefined);
  assert.ok(!JSON.stringify(safe).includes('secret-hash'));
});

test('GMO-6: two tokens are never the same', async () => {
  const c = client({ garage_invitations: (_f, { payload }) => ({ data: INVITATION(payload), error: null }) });
  const a = await inviteToGarage(c, admin, { email: 'a@example.com' }, {});
  const b = await inviteToGarage(c, admin, { email: 'b@example.com' }, {});
  assert.notEqual(a.token, b.token);
});

// ── what an invitation may offer ─────────────────────────────────────────────────────────────────

test('GMO-6: only garage roles can be invited', async () => {
  const c = client({ garage_invitations: () => ({ data: INVITATION(), error: null }) });
  for (const role of ['owner', 'government', 'super_admin', 'platform_admin', 'dealer']) {
    await assert.rejects(
      () => inviteToGarage(c, admin, { email: 'x@example.com', role }, {}),
      /role must be one of/,
      `must not be able to invite someone as '${role}'`,
    );
  }
  assert.deepEqual(INVITABLE_ROLES, ['mechanic', 'admin']);
});

test('GMO-6: an address that is not an address is refused', async () => {
  const c = client({ garage_invitations: () => ({ data: INVITATION(), error: null }) });
  for (const email of ['', '   ', 'not-an-email', 'a@b', '@example.com']) {
    await assert.rejects(() => inviteToGarage(c, admin, { email }, {}), /email address of the person/);
  }
});

test('GMO-6: a second live invitation for the same person is refused', async () => {
  const c = client({ garage_invitations: () => ({ data: null, error: { code: '23505', message: 'duplicate key' } }) });
  await assert.rejects(
    () => inviteToGarage(c, admin, { email: 'thabo@example.com' }, {}),
    /already has an invitation to this garage that has not been used yet/,
  );
  // Two valid tokens for one person is two independent ways into the garage.
});

// ── accepting ────────────────────────────────────────────────────────────────────────────────────

const invitee = { id: INVITEE, role: 'owner' };

function acceptClient({ invitation, existingMembership = null, email = 'thabo@example.com' }, log = []) {
  return client({
    garage_invitations: (_f, { op, payload }) => (op === 'update'
      ? { data: invitation ? { ...invitation, ...payload } : null, error: null }
      : { data: invitation, error: null }),
    users: { email },
    tenant_users: (_f, { op, payload }) => (op === 'insert'
      ? { data: { id: 'm-1', ...payload }, error: null }
      : { data: existingMembership, error: null }),
  }, log);
}

test('GMO-6: a valid invitation creates the membership', async () => {
  const log = [];
  const out = await acceptInvitation(acceptClient({ invitation: INVITATION() }, log), invitee, 'raw-token', {});
  assert.equal(out.created, true);
  assert.equal(out.tenantId, TENANT);
  assert.equal(out.role, 'mechanic');
  const insert = log.find((l) => l.table === 'tenant_users' && l.op === 'insert');
  assert.equal(insert.payload.user_id, INVITEE);
  assert.equal(insert.payload.tenant_id, TENANT);
  assert.equal(insert.payload.role, 'mechanic', 'the role comes from the invitation, not the request');
});

test('GMO-6 WRONG RECIPIENT: a forwarded link cannot seat whoever opens it', async () => {
  // Without this guard, an invitation is a bearer token to a garage's private customer list.
  const c = acceptClient({ invitation: INVITATION(), email: 'someone.else@example.com' });
  await assert.rejects(
    () => acceptInvitation(c, invitee, 'raw-token', {}),
    /was sent to thabo@example\.com\. Sign in with that email address/,
  );
});

test('GMO-6 WRONG RECIPIENT: matching is case- and space-insensitive', async () => {
  const c = acceptClient({ invitation: INVITATION({ invited_email: 'Thabo@Example.com ' }), email: ' thabo@example.COM' });
  const out = await acceptInvitation(c, invitee, 'raw-token', {});
  assert.equal(out.created, true, 'a real person typing their own address differently is not an attacker');
});

test('GMO-6 WRONG RECIPIENT: an unreadable account email FAILS CLOSED', async () => {
  const c = client({
    garage_invitations: INVITATION(),
    users: { email: null },
    tenant_users: null,
  });
  await assert.rejects(
    () => acceptInvitation(c, invitee, 'raw-token', {}),
    /no email address on record, so this invitation cannot be matched/,
  );
  // The dangerous alternative is skipping the check when the address cannot be read.
});

test('GMO-6 REPLAY: a spent invitation cannot seat a second person', async () => {
  const c = acceptClient({ invitation: INVITATION({ accepted_at: 'yesterday', accepted_by_user_id: 'someone_else' }) });
  await assert.rejects(() => acceptInvitation(c, invitee, 'raw-token', {}), /already been used/);
});

test('GMO-6 REPLAY: the ORIGINAL invitee re-clicking gets their membership, not an error', async () => {
  const c = acceptClient({ invitation: INVITATION({ accepted_at: 'yesterday', accepted_by_user_id: INVITEE }) });
  const out = await acceptInvitation(c, invitee, 'raw-token', {});
  assert.equal(out.alreadyMember, true);
  assert.equal(out.created, false);
  assert.equal(out.tenantId, TENANT);
});

test('GMO-6 EXPIRY: an old link is not a way in', async () => {
  const c = acceptClient({ invitation: INVITATION({ expires_at: PAST }) });
  await assert.rejects(() => acceptInvitation(c, invitee, 'raw-token', {}), /has expired/);
});

test('GMO-6 REVOCATION: a withdrawn invitation cannot be accepted', async () => {
  const c = acceptClient({ invitation: INVITATION({ revoked_at: 'yesterday', revoked_by_user_id: ADMIN }) });
  await assert.rejects(() => acceptInvitation(c, invitee, 'raw-token', {}), /cancelled by the garage/);
});

test('GMO-6: a guessed or mangled token is refused', async () => {
  const c = acceptClient({ invitation: null });
  await assert.rejects(() => acceptInvitation(c, invitee, 'not-a-real-token', {}), /not valid/);
  await assert.rejects(() => acceptInvitation(c, invitee, '', {}), /invitation link is required/);
});

test('GMO-6: the token is looked up by HASH, never compared in the clear', async () => {
  const log = [];
  await acceptInvitation(acceptClient({ invitation: INVITATION() }, log), invitee, 'raw-token', {}).catch(() => {});
  const read = log.find((l) => l.table === 'garage_invitations' && l.op === 'select');
  assert.equal(read.filters.token_hash, hashCapabilityToken('raw-token'));
  assert.ok(!Object.values(read.filters).includes('raw-token'));
});

test('GMO-6 RACE: the invitation is claimed BEFORE the membership is created', async () => {
  const log = [];
  await acceptInvitation(acceptClient({ invitation: INVITATION() }, log), invitee, 'raw-token', {});
  const claim = log.findIndex((l) => l.table === 'garage_invitations' && l.op === 'update');
  const membership = log.findIndex((l) => l.table === 'tenant_users' && l.op === 'insert');
  assert.ok(claim >= 0 && membership >= 0);
  assert.ok(claim < membership,
    'claiming first means a lost race creates no membership at all');
  const claimLog = log[claim];
  assert.equal(claimLog.filters['is:accepted_at'], null, 'the claim is guarded on the invitation still being open');
  assert.equal(claimLog.filters['is:revoked_at'], null);
});

test('GMO-6 RACE: the loser of a claim is told, and creates nothing', async () => {
  const log = [];
  const c = client({
    garage_invitations: (_f, { op }) => (op === 'update'
      ? { data: null, error: null }        // someone else claimed it in between
      : { data: INVITATION(), error: null }),
    users: { email: 'thabo@example.com' },
    tenant_users: null,
  }, log);
  await assert.rejects(() => acceptInvitation(c, invitee, 'raw-token', {}), /just used or cancelled/);
  assert.ok(!log.some((l) => l.table === 'tenant_users' && l.op === 'insert'));
});

test('GMO-6 (PO-6): someone already in another garage keeps that membership', async () => {
  const log = [];
  const out = await acceptInvitation(acceptClient({ invitation: INVITATION() }, log), invitee, 'raw-token', {});
  const insert = log.find((l) => l.table === 'tenant_users' && l.op === 'insert');
  // The insert names ONE tenant. Nothing here touches any other membership this person holds.
  assert.equal(insert.payload.tenant_id, TENANT);
  assert.ok(!log.some((l) => l.table === 'tenant_users' && ['update', 'delete'].includes(l.op)),
    'joining Garage B must not modify Garage A');
  assert.equal(out.created, true);
});

test('GMO-6: someone already in THIS garage is not given a second membership', async () => {
  const log = [];
  const c = acceptClient({ invitation: INVITATION(), existingMembership: { id: 'm-old', role: 'admin' } }, log);
  const out = await acceptInvitation(c, invitee, 'raw-token', {});
  assert.equal(out.alreadyMember, true);
  assert.equal(out.role, 'admin', 'they keep the role they already hold');
  assert.ok(!log.some((l) => l.table === 'tenant_users' && l.op === 'insert'));
});

// ── revocation and listing ───────────────────────────────────────────────────────────────────────

test('GMO-6: revoking is scoped to this garage and to an OPEN invitation', async () => {
  const log = [];
  const c = client({ garage_invitations: (_f, { payload }) => ({ data: INVITATION(payload), error: null }) }, log);
  await revokeInvitation(c, admin, 'inv-1', {});
  const update = log.find((l) => l.table === 'garage_invitations' && l.op === 'update');
  assert.equal(update.filters.tenant_id, TENANT, 'Garage A cannot revoke Garage B\'s invitation');
  assert.equal(update.filters['is:accepted_at'], null);
  assert.equal(update.filters['is:revoked_at'], null);
  assert.equal(update.payload.revoked_by_user_id, ADMIN);
});

test('GMO-6: revoking something already used or cancelled says so', async () => {
  const c = client({ garage_invitations: () => ({ data: null, error: null }) });
  await assert.rejects(() => revokeInvitation(c, admin, 'inv-1', {}), /not open/);
});

test('GMO-6: a mechanic cannot revoke invitations', async () => {
  const c = client({ garage_invitations: () => ({ data: INVITATION(), error: null }) });
  await assert.rejects(() => revokeInvitation(c, mechanicMember, 'inv-1', {}), /Only a garage administrator/);
});

test('GMO-6: the listing is scoped to the caller\'s own garage', async () => {
  const log = [];
  const c = client({ garage_invitations: [INVITATION()] }, log);
  const { invitations } = await listInvitations(c, admin);
  assert.equal(log.find((l) => l.table === 'garage_invitations').filters.tenant_id, TENANT);
  assert.equal(invitations[0].status, 'pending');
  assert.equal(invitations[0].token_hash, undefined);
});

test('GMO-6: each invitation reports its real state', () => {
  assert.equal(sanitizeInvitation(INVITATION()).status, 'pending');
  assert.equal(sanitizeInvitation(INVITATION({ accepted_at: 'x', accepted_by_user_id: 'u' })).status, 'accepted');
  assert.equal(sanitizeInvitation(INVITATION({ revoked_at: 'x', revoked_by_user_id: 'u' })).status, 'revoked');
  assert.equal(sanitizeInvitation(INVITATION({ expires_at: PAST })).status, 'expired');
});

// ── what a stranger holding a link can learn ─────────────────────────────────────────────────────

test('GMO-6: peeking shows the garage and the role, and nothing operational', async () => {
  const c = client({
    garage_invitations: { ...INVITATION(), tenants: { name: 'Mbare Motors' } },
  });
  const out = await peekInvitation(c, 'raw-token');
  assert.equal(out.garageName, 'Mbare Motors');
  assert.equal(out.role, 'mechanic');
  assert.equal(out.usable, true);
  // A token found in a forwarded email must not be a reconnaissance tool.
  const serialized = JSON.stringify(out);
  for (const leak of ['customers', 'cases', 'members', 'revenue', 'token_hash', 'invited_by']) {
    assert.ok(!serialized.includes(leak), `peek must not expose ${leak}`);
  }
});

test('GMO-6: peeking reports an unusable invitation as unusable', async () => {
  for (const [over, status] of [
    [{ revoked_at: 'x', revoked_by_user_id: 'u' }, 'revoked'],
    [{ accepted_at: 'x', accepted_by_user_id: 'u' }, 'accepted'],
    [{ expires_at: PAST }, 'expired'],
  ]) {
    const c = client({ garage_invitations: { ...INVITATION(over), tenants: { name: 'Mbare Motors' } } });
    const out = await peekInvitation(c, 'raw-token');
    assert.equal(out.status, status);
    assert.equal(out.usable, false);
  }
});

// ── structural ───────────────────────────────────────────────────────────────────────────────────

test('GMO-6: the service writes tenant_users and NOTHING else about authority', () => {
  const s = src('../services/garageOnboarding/garageInvitationService.js');
  assert.ok(!/from\('tenants'\)[\s\S]{0,140}?\.(insert|update|upsert|delete)\(/.test(s),
    'inviting someone must never create or alter a garage');
  assert.ok(!/from\('users'\)[\s\S]{0,140}?\.(insert|update|upsert|delete)\(/.test(s),
    'inviting someone must never change their platform role');
});

test('GMO-6: the management routes use the TENANT gate, and accepting needs only a session', () => {
  const s = src('../routes/garageInvitationRoutes.js');
  for (const route of ["'/api/garage/invitations'", "'/api/garage/invitations/:invitationId'"]) {
    const at = s.indexOf(route);
    assert.ok(at > 0, `${route} must exist`);
    assert.match(s.slice(at, at + 200), /authorizeTenantRole\(GARAGE_ADMIN_ROLES\)/);
  }
  // Accepting must not require a role: the invitee is whoever they are.
  const acceptAt = s.indexOf("'/api/garage/invitations/accept'");
  assert.match(s.slice(acceptAt, acceptAt + 200), /authorizeSessionRole\(\)/);
});
