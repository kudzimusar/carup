/**
 * GMO-5 — context and portal handoff.
 *
 * The founder GMO-4 creates is platform `owner` with `tenant_users.role = 'admin'` (PO-1). That
 * combination was locked out of the garage it had just been given:
 *
 *   asserting the tenant role  -> resolveEffectiveRole THROWS (tenant admin must never become
 *                                 platform admin)
 *   asserting nothing          -> effective role stays `owner`, which no garage route lists
 *
 * A tenant `mechanic` never hit this, because `mechanic` is assumable. `admin` is the one tenant
 * role that is not — so PO-1's choice landed on exactly the case the mechanism could not serve.
 *
 * The fix admits one new case at the route gate: a VERIFIED membership in a role the route already
 * trusts. These tests pin both halves — that the founder gets in, and that nothing about platform
 * admin moved.
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

const { resolveEffectiveRole } = await import('../middleware/authMiddleware.js');
const { OPERATIONS_CAPABILITIES, hasOperationsCapability, operationsGrantingRole } =
  await import('../services/operations/operationsAuthorizationService.js');

const src = (rel) => readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), rel), 'utf8');

/**
 * The route gate, extracted so the decision can be exercised directly.
 *
 * `allowTenantMembership` defaults to FALSE here exactly as it does in production. The first version
 * of this helper hard-coded the tenant disjunct ON and was only ever called with
 * `allowed: GARAGE_ROLES` — so it could not see that the same gate, applied to `allowed: ['admin']`,
 * handed a garage founder the platform user directory. The tests below now vary the allow-list.
 */
function routeGateAllows({ allowed, effectiveRole, tenantRole, platformRole, allowTenantMembership = false }) {
  const PLATFORM_ADMIN_ROLES = new Set(['admin', 'super_admin', 'platform_admin']);
  const tenantMembershipSatisfiesRoute =
    allowTenantMembership && Boolean(tenantRole) && allowed.includes(tenantRole);
  return !(
    allowed.length > 0
    && !allowed.includes(effectiveRole)
    && !tenantMembershipSatisfiesRoute
    && !PLATFORM_ADMIN_ROLES.has(platformRole)
  );
}

const GARAGE_ROLES = ['mechanic', 'dealer', 'admin'];

// ── the escalation guard must NOT have moved ─────────────────────────────────────────────────────

test('GMO-5: a tenant admin still cannot become a platform admin', () => {
  // This is the guard the fix must not weaken. It is why the founder could not simply assert
  // their tenant role in the first place.
  assert.throws(
    () => resolveEffectiveRole({ userRole: 'owner', tenantRole: 'admin', requestedRole: 'admin' }),
    /not verified for this user context/,
  );
});

test('GMO-5: the founder\'s effective role is still `owner`, not `admin`', () => {
  const effective = resolveEffectiveRole({ userRole: 'owner', tenantRole: 'admin', requestedRole: null });
  assert.equal(effective, 'owner');
  assert.notEqual(effective, 'admin');
});

test('GMO-5: a tenant admin gains NO Operations capability', () => {
  // Operations capability comes from the server-derived platform role, never from tenancy.
  const founder = { id: 'u1', platformRole: 'owner', baseRole: 'owner', role: 'owner', tenantRole: 'admin' };
  assert.equal(operationsGrantingRole(founder), 'owner');
  for (const cap of Object.values(OPERATIONS_CAPABILITIES)) {
    assert.equal(hasOperationsCapability(founder, cap), false,
      `a garage founder must not hold ${cap}`);
  }
});

// ── the founder can now open their own garage ────────────────────────────────────────────────────

test('GMO-5: the founder reaches garage routes on a verified membership', () => {
  assert.equal(
    routeGateAllows({ allowed: GARAGE_ROLES, effectiveRole: 'owner', tenantRole: 'admin', platformRole: 'owner', allowTenantMembership: true }),
    true,
    'a verified tenant admin must be able to open the garage they founded',
  );
});

test('GMO-5: the garage employee case still works, unchanged', () => {
  assert.equal(resolveEffectiveRole({ userRole: 'owner', tenantRole: 'mechanic', requestedRole: 'mechanic' }), 'mechanic');
  assert.equal(
    routeGateAllows({ allowed: GARAGE_ROLES, effectiveRole: 'mechanic', tenantRole: 'mechanic', platformRole: 'owner', allowTenantMembership: true }),
    true,
  );
});

// ── and nobody else gets in ──────────────────────────────────────────────────────────────────────

test('GMO-5: a person with NO membership is still refused', () => {
  assert.equal(
    routeGateAllows({ allowed: GARAGE_ROLES, effectiveRole: 'owner', tenantRole: null, platformRole: 'owner', allowTenantMembership: true }),
    false,
    'no membership, no garage',
  );
});

test('GMO-5: a member in a role the route does NOT trust is still refused', () => {
  // `tenant_users.role` defaults to 'member'. Belonging is not the same as being trusted to work.
  for (const role of ['member', 'viewer', 'guest', 'billing']) {
    assert.equal(
      routeGateAllows({ allowed: GARAGE_ROLES, effectiveRole: 'owner', tenantRole: role, platformRole: 'owner', allowTenantMembership: true }),
      false,
      `tenant role '${role}' must not open a garage workspace`,
    );
  }
});

test('GMO-5: Garage A membership does not open Garage B', () => {
  // The membership was read for THE tenant in the request header, and a mismatch was already
  // refused with 403 before this gate is reached. So a tenantRole only ever describes the tenant
  // being addressed — there is no cross-tenant value to admit.
  const s = src('../middleware/authMiddleware.js');
  assert.match(s, /\.eq\('tenant_id', tenantIdHeader\)\s*\n\s*\.eq\('user_id', activeUserId\)/,
    'the membership is read for the requested tenant AND this user');
  assert.match(s, /if \(tenantError \|\| !tenantUser\) \{[\s\S]{0,160}?403/,
    'a non-member of the requested tenant is refused before any role decision');
});

test('GMO-5: the admitted case requires a VERIFIED membership, never a claimed one', () => {
  const s = src('../middleware/authMiddleware.js');
  const gate = s.slice(s.indexOf('const tenantMembershipSatisfiesRoute'), s.indexOf('// 5. Inject Context'));
  // `tenantRole` is server-read; `requestedRole` is a header. The gate must use the former.
  assert.match(gate, /Boolean\(tenantRole\) && allowed\.includes\(tenantRole\)/);
  assert.ok(!/requestedRole/.test(gate), 'the route gate must never consult a client-supplied role');
});

test('GMO-5: a pending applicant has no garage context at all', () => {
  // Before activation there is no tenant_users row, so tenantRole is null and the gate refuses.
  assert.equal(
    routeGateAllows({ allowed: GARAGE_ROLES, effectiveRole: 'owner', tenantRole: null, platformRole: 'owner', allowTenantMembership: true }),
    false,
  );
});

test('GMO-5: the gate change is scoped to the route check and touches nothing else', () => {
  const s = src('../middleware/authMiddleware.js');
  // The injected context must still report the UNCHANGED effective and platform roles.
  assert.match(s, /role: effectiveRole,/);
  assert.match(s, /platformRole,/);
  assert.match(s, /tenantRole,/);
  // resolveEffectiveRole itself must still refuse tenant admin.
  assert.match(s, /requested === trustedTenantRole && requested !== 'admin'/,
    'the platform-admin escalation guard must remain exactly as it was');
});

// ── the contexts a person can choose from ────────────────────────────────────────────────────────

const { listMyMemberships, GARAGE_OPERATING_ROLES } =
  await import('../services/garageOnboarding/garageContextService.js');

function membershipClient(result) {
  return {
    from: () => {
      const chain = {
        select() { return chain; }, eq() { return chain; }, order() { return chain; },
        then(res, rej) { return Promise.resolve(result).then(res, rej); },
      };
      return chain;
    },
  };
}

const GARAGE_ROW = (over = {}) => ({
  tenant_id: 't-1', role: 'admin', joined_at: '2026-09-06T10:00:00Z',
  tenants: { id: 't-1', name: 'Mbare Motors', type: 'garage', status: 'active' }, ...over,
});

test('GMO-5: a broken membership read RAISES — it never becomes "you belong to nothing"', async () => {
  // This has bitten this codebase before: a wrong column name made the query fail, the catch turned
  // it into an empty list, and a real garage member was locked out by a fix that looked correct.
  const c = membershipClient({ data: null, error: { message: 'column does not exist' } });
  await assert.rejects(() => listMyMemberships(c, { id: 'u1' }), /Could not read the organizations you belong to/);
});

test('GMO-5: a person genuinely in no organization gets an empty list, not an error', async () => {
  const out = await listMyMemberships(membershipClient({ data: [], error: null }), { id: 'u1' });
  assert.deepEqual(out.memberships, []);
  assert.deepEqual(out.garages, []);
});

test('GMO-5 (PO-6): every garage is listed, not just the first', async () => {
  const c = membershipClient({
    data: [
      GARAGE_ROW(),
      GARAGE_ROW({ tenant_id: 't-2', role: 'mechanic', tenants: { id: 't-2', name: 'Second Garage', type: 'garage', status: 'active' } }),
    ],
    error: null,
  });
  const out = await listMyMemberships(c, { id: 'u1' });
  // `resolveActiveMembership` at login takes limit(1); this is what makes the second garage reachable.
  assert.equal(out.garages.length, 2);
  assert.deepEqual(out.garages.map((g) => g.tenantName), ['Mbare Motors', 'Second Garage']);
});

test('GMO-5: the server says who can operate; the browser does not decide', async () => {
  const c = membershipClient({
    data: [
      GARAGE_ROW({ role: 'admin' }),
      GARAGE_ROW({ tenant_id: 't-2', role: 'member', tenants: { id: 't-2', name: 'Just A Member', type: 'garage', status: 'active' } }),
    ],
    error: null,
  });
  const out = await listMyMemberships(c, { id: 'u1' });
  assert.equal(out.garages.find((g) => g.tenantId === 't-1').canOperate, true);
  assert.equal(out.garages.find((g) => g.tenantId === 't-2').canOperate, false,
    'belonging is not the same as being able to work');
  assert.deepEqual(GARAGE_OPERATING_ROLES, ['admin', 'mechanic', 'dealer']);
});

test('GMO-5: non-garage tenants are listed as memberships but not as garages', async () => {
  const c = membershipClient({
    data: [GARAGE_ROW({ tenant_id: 't-9', tenants: { id: 't-9', name: 'A Dealership', type: 'dealer', status: 'active' } })],
    error: null,
  });
  const out = await listMyMemberships(c, { id: 'u1' });
  assert.equal(out.memberships.length, 1);
  assert.equal(out.garages.length, 0);
});

test('GMO-5: the memberships listing requires a caller', async () => {
  await assert.rejects(() => listMyMemberships(membershipClient({ data: [], error: null }), {}),
    /Authenticated user context is required/);
});

test('GMO-5: the handoff carries the tenant role, so no re-login is needed', () => {
  const s = src('../server.js');
  const block = s.slice(s.indexOf("app.post('/api/auth/switch-role'"), s.indexOf("// --- VEHICLE SINGLE FETCH ---"));
  assert.match(block, /active_tenant_role: verifiedTenantRole/,
    'the switch must return the verified tenant role');
  assert.match(block, /active_tenant_name: verifiedTenantName/);
  // And it must come from the VERIFIED membership row, not from the request body.
  assert.match(block, /verifiedTenantRole = tenantUser\.role/);
  assert.ok(!/active_tenant_role:\s*req\.body/.test(block), 'never from the client');
});

test('GMO-5: the switch still refuses a tenant role it has not verified', () => {
  const s = src('../server.js');
  const block = s.slice(s.indexOf("app.post('/api/auth/switch-role'"), s.indexOf("// --- VEHICLE SINGLE FETCH ---"));
  assert.match(block, /You do not belong to this organization/);
  assert.match(block, /role === user\.role \|\| \(verifiedTenantRole && role === verifiedTenantRole && role !== 'admin'\)/,
    'the escalation guard on the switch itself is unchanged');
});

test('GMO-5: the memberships route is gated by a proven session and scoped to the caller', () => {
  const s = src('../routes/garageOnboardingRoutes.js');
  const at = s.indexOf("'/api/auth/my-memberships'");
  assert.ok(at > 0);
  const block = s.slice(at, at + 240);
  assert.match(block, /authorizeSessionRole\(\)/, 'a proven session is required');
  assert.match(block, /req\.userContext/, 'the answer is scoped to the caller');
  // It must NOT accept a user id from the request.
  assert.ok(!/req\.query\.userId|req\.params\.userId/.test(block));
});

// ── the exploit an adversarial review found, and proved, pinned closed ───────────────────────────
//
// The first version of this change applied the tenant disjunct to EVERY route. A review executed
// the exploit against the real router: a garage founder — platform `owner`, `tenant_users.role =
// 'admin'` written by the governed activation function — added `x-tenant-id` naming her own garage
// and read `GET /api/users/management`, then suspended the real platform administrator.
//
// The cause was namespace collapse. `tenant_users.role` is unconstrained TEXT in which 'admin'
// means "administrator of this garage"; `users.role` is the platform vocabulary in which 'admin'
// means a CarUp administrator. 168 route registrations list 'admin' in the second sense. The gate
// could not tell them apart, so it treated the first as the second.

test('GMO-5 SECURITY: a garage founder must NOT reach a platform-admin route', () => {
  const founder = { effectiveRole: 'owner', tenantRole: 'admin', platformRole: 'owner' };
  // adminRoutes.js gates the platform user directory and user suspension on exactly this list, with
  // no capability check and no second gate.
  assert.equal(routeGateAllows({ allowed: ['admin'], ...founder }), false,
    'GET /api/users/management must stay closed to a tenant admin');
  assert.equal(routeGateAllows({ allowed: ['admin'], ...founder, allowTenantMembership: true }), true,
    'and this is exactly why the flag must never be set on such a route');
});

test('GMO-5 SECURITY: the platform-admin route families stay closed', () => {
  const founder = { effectiveRole: 'owner', tenantRole: 'admin', platformRole: 'owner' };
  // Each of these was confirmed reachable under the global version of the change.
  const PLATFORM_ONLY = [
    ['adminRoutes: user directory + suspend', ['admin']],
    ['escrowProviderRoutes: release/refund + kill switch', ['admin']],
    ['featureGovernanceRoutes: global rollout overrides', ['admin']],
    ['governmentActivationRoutes: ZIMRA/CVR + emergency disable', ['admin', 'government']],
    ['financeRoutes: the platform finance-application book', ['admin']],
    ['insurerRoutes: provider onboarding', ['admin', 'insurance']],
    ['navigationAnalyticsRoutes: platform rollups', ['admin']],
  ];
  for (const [what, allowed] of PLATFORM_ONLY) {
    assert.equal(routeGateAllows({ allowed, ...founder }), false, `${what} must stay closed`);
  }
});

test('GMO-5 SECURITY: the tenant disjunct is OFF unless a route opts in', () => {
  const s = src('../middleware/authMiddleware.js');
  assert.match(s, /allowTenantMembership = false/,
    'the option must default to off in authorizeRole');
  assert.match(s, /const tenantMembershipSatisfiesRoute =\s*\n?\s*allowTenantMembership &&/,
    'the disjunct must be gated by the flag');
  // `authorizeSessionRole` — used by most private routes — must NOT enable it.
  const sessionHelper = s.slice(s.indexOf('export function authorizeSessionRole'), s.indexOf('export function authorizeTenantRole'));
  assert.ok(!/allowTenantMembership/.test(sessionHelper),
    'authorizeSessionRole must not opt in');
});

/**
 * The complete opt-in set, named. A new file appearing here is a deliberate decision that must be
 * made explicitly, not a default that spreads.
 *
 * `garageInvitationRoutes.js` was added by GMO-6 and is legitimate: its `GARAGE_ADMIN_ROLES` list
 * means "an administrator of THIS garage", and the invitation service re-checks the caller's
 * verified `tenantRole` before issuing anything. This test caught its arrival, which is the point.
 */
test('GMO-5 SECURITY: only genuinely tenant-scoped routes use the opt-in helper', async () => {
  const { readdirSync } = await import('fs');
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../routes');
  const optedIn = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const body = readFileSync(path.join(dir, file), 'utf8');
    if (/authorizeTenantRole\(/.test(body)) optedIn.push(file);
  }
  // The complete opt-in set, named. A new file appearing here is a deliberate decision that must be
  // made explicitly, not a default that spreads.
  assert.deepEqual(optedIn.sort(), [
    'garageDirectoryRoutes.js',
    'garageInvitationRoutes.js',
    'garageMembershipRoutes.js',
    'garageQueueRoutes.js',
    'serviceCaseRoutes.js',
    'serviceRecordRoutes.js',
    'serviceWorkOrderRoutes.js',
  ], 'only the garage-side, tenant-scoped routers may opt in');

  // Each opted-in route must list TENANT roles. The named lists are enumerated so a route cannot
  // quietly start passing a platform-role array to the tenant gate.
  const TENANT_SCOPED_LISTS = new Set(['GARAGE_ROLES', 'GARAGE_ADMIN_ROLES']);
  for (const file of optedIn) {
    const body = readFileSync(path.join(dir, file), 'utf8');
    const lists = [...body.matchAll(/authorizeTenantRole\((\w+)\)/g)].map((m) => m[1]);
    for (const listName of new Set(lists)) {
      assert.ok(TENANT_SCOPED_LISTS.has(listName),
        `${file} passes ${listName} to the tenant gate; only tenant-scoped lists may be used`);
    }
  }
});

test('GMO-5 SECURITY: adminRoutes has not been switched to the tenant gate', () => {
  const s = src('../routes/adminRoutes.js');
  assert.ok(!/authorizeTenantRole/.test(s),
    'the platform user directory and suspension must never accept a tenant role');
  assert.match(s, /authorizeRole\(\['admin'\]\)/,
    'it stays on the platform-role gate');
});

// ── every table this programme adds must be locked down ──────────────────────────────────────────

test('GMO SECURITY: every GMO table has RLS enabled and forced in the migrations', async () => {
  const { readdirSync } = await import('fs');
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../database/migrations');
  const sql = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(path.join(dir, f), 'utf8'))
    .join('\n');

  // These four shipped without RLS. Every comparable table around them (tenants, tenant_users,
  // users, service_cases, dealer_compliance_documents) had it, and without it PostgREST exposes the
  // table straight to `anon` — the row deciding who becomes a garage administrator was writable
  // from a browser, bypassing the reviewer, the capability check and the step-up entirely.
  const GMO_TABLES = [
    'garage_applications',
    'garage_application_decisions',
    'garage_application_documents',
    'garage_invitations',
  ];
  for (const table of GMO_TABLES) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table}\\s+ENABLE ROW LEVEL SECURITY`),
      `${table} must enable RLS`);
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table}\\s+FORCE\\s+ROW LEVEL SECURITY`),
      `${table} must FORCE RLS — without it the table owner is exempt`);
    assert.match(sql, new RegExp(`REVOKE ALL ON public\\.${table}\\s+FROM anon, authenticated`),
      `${table} must not be reachable by anon or authenticated`);
  }
});

test('GMO SECURITY: the activation function is not callable from a browser', () => {
  const migration = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../../database/migrations/20260906200000_garage_onboarding_rls.sql'),
    'utf8',
  );
  // It is the one place a tenant and a founding membership are created, and the route in front of
  // it composes role + capability + step-up. PostgREST's RPC endpoint would skip all three.
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.activate_garage_application\(UUID, TEXT\) FROM PUBLIC, anon, authenticated/);
});

test('GMO SECURITY: the tenant-role namespace is bounded at the database', async () => {
  const { readdirSync } = await import('fs');
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../database/migrations');
  const sql = readdirSync(dir).filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(path.join(dir, f), 'utf8')).join('\n')
    .replace(/--[^\n]*/g, '');

  assert.match(sql, /ADD CONSTRAINT tenant_users_role_catalogue/,
    'tenant_users.role must be constrained to a catalogue');

  // The overlap with the platform namespace must be exactly `admin` (PO-1 requires it), and the
  // platform-only roles must be unwritable here. Convention became a vulnerability once.
  //
  // Anchor on THIS constraint. A bare /CHECK \(role IN/ matched the garage_invitations role check
  // from an earlier-sorting migration file and asserted against the wrong constraint entirely —
  // a green-looking test measuring something else.
  const check = sql.match(/ADD CONSTRAINT tenant_users_role_catalogue\s+CHECK \(role IN \(([^)]*)\)\)/);
  assert.ok(check, 'the catalogue must be expressed as ADD CONSTRAINT tenant_users_role_catalogue CHECK (role IN (...))');
  const allowed = (check[1].match(/'(\w+)'/g) ?? []).map((v) => v.replace(/'/g, ''));
  assert.deepEqual(allowed.sort(), ['admin', 'dealer', 'mechanic', 'member']);
  for (const platformOnly of ['super_admin', 'platform_admin', 'government', 'owner']) {
    assert.ok(!allowed.includes(platformOnly),
      `${platformOnly} is a PLATFORM role and must never be writable into tenant_users`);
  }
});
