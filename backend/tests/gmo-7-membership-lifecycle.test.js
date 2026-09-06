/**
 * GMO-7 — membership revocation and lifecycle.
 *
 * Removing someone ends what they can do NEXT. It must not touch what they already did.
 *
 * A garage that could erase who serviced a car by removing a mechanic would be a garage whose
 * service history means nothing — and that history is the thing the Service Network exists to make
 * trustworthy. So the load-bearing assertions here are as much about what revocation does NOT do.
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

const { listMembers, removeMember, changeMemberRole } =
  await import('../services/garageOnboarding/garageMembershipService.js');

const TENANT = 'garage-1';
const OTHER_TENANT = 'garage-2';
const ADMIN = 'u_admin';
const MECHANIC = 'u_mechanic';

const admin = { id: ADMIN, role: 'owner', tenantId: TENANT, tenantRole: 'admin' };
const mechanicActor = { id: MECHANIC, role: 'owner', tenantId: TENANT, tenantRole: 'mechanic' };

const src = (rel) => readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), rel), 'utf8');

function client(tables, log = []) {
  const withDefaults = { trust_audit_events: () => ({ data: { id: 'a1' }, error: null }), ...tables };
  const from = (table) => {
    const filters = {}; let payload = null; let op = 'select'; let head = false;
    const result = () => {
      log.push({ table, op, filters: { ...filters }, payload });
      const entry = withDefaults[table];
      const out = typeof entry === 'function' ? entry(filters, { op, payload }) : { data: entry ?? null, error: null };
      if (head && out.count === undefined) {
        out.count = Array.isArray(out.data) ? out.data.length : (out.data ? 1 : 0);
      }
      return out;
    };
    const chain = {
      select(_c, opts) { if (opts?.head) head = true; return chain; },
      insert(p) { op = 'insert'; payload = p; return chain; },
      update(p) { op = 'update'; payload = p; return chain; },
      delete() { op = 'delete'; return chain; },
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

/** Two admins and one mechanic, so removal is permitted by default. */
function garageOf(members, log = []) {
  return client({
    tenant_users: (filters, { op }) => {
      if (op === 'delete' || op === 'update') {
        const hit = members.find((m) => m.user_id === filters.user_id);
        return { data: hit ? { ...hit } : null, error: null };
      }
      if (filters.role === 'admin') {
        const admins = members.filter((m) => m.role === 'admin');
        return { data: admins, count: admins.length, error: null };
      }
      if (filters.user_id) {
        return { data: members.find((m) => m.user_id === filters.user_id) ?? null, error: null };
      }
      return { data: members, error: null };
    },
    users: [{ id: ADMIN, name: 'Rutendo', email: 'r@example.com' }, { id: MECHANIC, name: 'Thabo', email: 't@example.com' }],
  }, log);
}

const TWO_ADMINS = [
  { id: 'm1', user_id: ADMIN, role: 'admin', joined_at: '2026-01-01' },
  { id: 'm2', user_id: 'u_admin_2', role: 'admin', joined_at: '2026-02-01' },
  { id: 'm3', user_id: MECHANIC, role: 'mechanic', joined_at: '2026-03-01' },
];
const ONE_ADMIN = [
  { id: 'm1', user_id: ADMIN, role: 'admin', joined_at: '2026-01-01' },
  { id: 'm3', user_id: MECHANIC, role: 'mechanic', joined_at: '2026-03-01' },
];

// ── who may act ──────────────────────────────────────────────────────────────────────────────────

test('GMO-7: only a garage administrator may remove someone', async () => {
  await assert.rejects(
    () => removeMember(garageOf(TWO_ADMINS), mechanicActor, MECHANIC, {}),
    /Only a garage administrator can change who works here/,
  );
});

test('GMO-7: a person with no open garage cannot remove anyone', async () => {
  await assert.rejects(
    () => removeMember(garageOf(TWO_ADMINS), { id: ADMIN, role: 'owner' }, MECHANIC, {}),
    /Open the garage you want to manage first/,
  );
});

/**
 * A mutation that made the tenant `options.tenantId || requireGarageAdmin(actor)` survived the
 * original suite, because every test passed `{}` for options and the fallback always ran. The
 * hostile shape was never constructed — the same gap that let the GMO-5 gate change through.
 */
test('GMO-7: no caller-supplied tenant or actor can redirect a removal', async () => {
  const log = [];
  await removeMember(garageOf(TWO_ADMINS, log), admin, MECHANIC, {
    tenantId: OTHER_TENANT, tenant_id: OTHER_TENANT,
    actor: { tenantId: OTHER_TENANT, tenantRole: 'admin' },
  });
  for (const write of log.filter((l) => l.table === 'tenant_users' && l.op !== 'select')) {
    assert.equal(write.filters.tenant_id, TENANT,
      'the tenant must come from the verified session context, never from options');
  }
});

test('GMO-7: no caller-supplied tenant can redirect a role change', async () => {
  const log = [];
  await changeMemberRole(garageOf(TWO_ADMINS, log), admin, MECHANIC, 'admin', { tenantId: OTHER_TENANT });
  const update = log.find((l) => l.table === 'tenant_users' && l.op === 'update');
  assert.equal(update.filters.tenant_id, TENANT);
});

test('GMO-7: removal is scoped to the caller\'s OWN garage', async () => {
  const log = [];
  await removeMember(garageOf(TWO_ADMINS, log), admin, MECHANIC, {});
  const del = log.find((l) => l.table === 'tenant_users' && l.op === 'delete');
  assert.equal(del.filters.tenant_id, TENANT, 'Garage A cannot remove a member of Garage B');
  assert.notEqual(del.filters.tenant_id, OTHER_TENANT);
  assert.equal(del.filters.user_id, MECHANIC);
});

// ── ending FUTURE authority ──────────────────────────────────────────────────────────────────────

test('GMO-7: removing a mechanic deletes the membership their authority depends on', async () => {
  const log = [];
  const out = await removeMember(garageOf(TWO_ADMINS, log), admin, MECHANIC, {});
  assert.equal(out.removed, true);
  assert.equal(out.previousRole, 'mechanic');
  assert.ok(log.some((l) => l.table === 'tenant_users' && l.op === 'delete'));
});

test('GMO-7: the three gates that read membership all stop offering them', () => {
  // Ending authority is not asserted by this service — it follows from the membership row being
  // gone. These are the three places that read it, and each fails closed for a non-member.
  const assignment = src('../services/serviceNetwork/workOrderAssignmentService.js');
  assert.match(assignment, /if \(!membership\) throw new ValidationError\('That mechanic is not a member of this garage'\)/,
    'assignMechanic refuses a non-member');

  const middleware = src('../middleware/authMiddleware.js');
  assert.match(middleware, /if \(tenantError \|\| !tenantUser\) \{[\s\S]{0,160}?403/,
    'the route gate refuses a non-member outright');

  const queue = src('../services/serviceNetwork/garageQueueService.js');
  assert.match(queue, /from\('tenant_users'\)[\s\S]{0,120}?\.eq\('tenant_id', tenantId\)/,
    'the mechanic picker lists only current members');
});

// ── preserving HISTORICAL truth ──────────────────────────────────────────────────────────────────

test('GMO-7: revocation writes to NO record of work already done', async () => {
  const log = [];
  await removeMember(garageOf(TWO_ADMINS, log), admin, MECHANIC, {});
  for (const table of ['work_order_assignments', 'service_records', 'service_cases', 'service_work_orders', 'vehicles']) {
    assert.ok(!log.some((l) => l.table === table),
      `removing a mechanic must not touch ${table}`);
  }
});

test('GMO-7: the service is structurally incapable of rewriting history', () => {
  const s = src('../services/garageOnboarding/garageMembershipService.js');
  for (const table of ['work_order_assignments', 'service_records', 'service_cases', 'service_work_orders']) {
    assert.ok(!new RegExp(`from\\('${table}'\\)`).test(s), `revocation must never reference ${table}`);
  }
});

test('GMO-7: attribution lives on the work, not on the membership', () => {
  // `work_order_assignments.mechanic_user_id` records WHO DID THE WORK. It is not derived from
  // `tenant_users`, which records who is currently employed — so deleting the latter cannot erase
  // the former.
  const assignment = src('../services/serviceNetwork/workOrderAssignmentService.js');
  assert.match(assignment, /mechanic_user_id: mechanicUserId/,
    'the assignment stores the mechanic id on the work order itself');
  assert.ok(!/from\('tenant_users'\)[\s\S]{0,140}?\.(delete|update)\(/.test(assignment),
    'assignment never mutates membership');
});

test('GMO-7: the removal survives in the audit record', async () => {
  const log = [];
  await removeMember(garageOf(TWO_ADMINS, log), admin, MECHANIC, {});
  const audit = log.find((l) => l.table === 'trust_audit_events');
  assert.ok(audit, 'the membership row is gone; that it was removed, and by whom, is not');
});

// ── the last administrator ───────────────────────────────────────────────────────────────────────

test('GMO-7: the ONLY administrator cannot be removed', async () => {
  await assert.rejects(
    () => removeMember(garageOf(ONE_ADMIN), admin, ADMIN, {}),
    /only administrator.*nobody who can manage it/s,
  );
  // A garage with nobody who can invite, assign or manage is a garage no product path can restore.
});

test('GMO-7: the only administrator cannot be demoted either', async () => {
  await assert.rejects(
    () => changeMemberRole(garageOf(ONE_ADMIN), admin, ADMIN, 'mechanic', {}),
    /only administrator/,
  );
});

test('GMO-7: one of two administrators CAN be removed', async () => {
  const out = await removeMember(garageOf(TWO_ADMINS), admin, 'u_admin_2', {});
  assert.equal(out.removed, true);
});

test('GMO-7: a mechanic is removable regardless of how many admins there are', async () => {
  const out = await removeMember(garageOf(ONE_ADMIN), admin, MECHANIC, {});
  assert.equal(out.removed, true);
});

test('GMO-7: the listing says who is removable, and the browser does not decide', async () => {
  const { members, adminCount } = await listMembers(garageOf(ONE_ADMIN), admin);
  assert.equal(adminCount, 1);
  assert.equal(members.find((m) => m.userId === ADMIN).removable, false);
  assert.equal(members.find((m) => m.userId === MECHANIC).removable, true);

  const two = await listMembers(garageOf(TWO_ADMINS), admin);
  assert.equal(two.members.find((m) => m.userId === ADMIN).removable, true);
});

// ── changing what someone does ───────────────────────────────────────────────────────────────────

test('GMO-7: a mechanic can be promoted, so an admin has a way to hand over', async () => {
  const out = await changeMemberRole(garageOf(ONE_ADMIN), admin, MECHANIC, 'admin', {});
  assert.equal(out.changed, true);
  assert.equal(out.role, 'admin');
  assert.equal(out.previousRole, 'mechanic');
});

test('GMO-7: only garage roles can be assigned', async () => {
  for (const role of ['owner', 'government', 'super_admin', 'platform_admin']) {
    await assert.rejects(
      () => changeMemberRole(garageOf(TWO_ADMINS), admin, MECHANIC, role, {}),
      /role must be one of: admin, mechanic/,
      `must not be able to make someone '${role}'`,
    );
  }
});

test('GMO-7: setting the role someone already has is a no-op, not an error', async () => {
  const out = await changeMemberRole(garageOf(TWO_ADMINS), admin, MECHANIC, 'mechanic', {});
  assert.equal(out.changed, false);
});

test('GMO-7: the role change is guarded against a concurrent edit', async () => {
  const log = [];
  await changeMemberRole(garageOf(TWO_ADMINS, log), admin, MECHANIC, 'admin', {});
  const update = log.find((l) => l.table === 'tenant_users' && l.op === 'update');
  assert.equal(update.filters.role, 'mechanic', 'only a row still in the state we read is moved');
  assert.equal(update.filters.tenant_id, TENANT);
});

// ── PO-6: one garage at a time ───────────────────────────────────────────────────────────────────

test('GMO-7 (PO-6): removal from Garage A leaves Garage B untouched', async () => {
  const log = [];
  await removeMember(garageOf(TWO_ADMINS, log), admin, MECHANIC, {});
  // Every write names ONE tenant — the caller's. There is no statement here that could reach the
  // same person's membership of any other garage.
  const writes = log.filter((l) => l.table === 'tenant_users' && l.op !== 'select');
  assert.ok(writes.length > 0);
  for (const w of writes) {
    assert.equal(w.filters.tenant_id, TENANT);
  }
});

// ── failures are failures, not answers ───────────────────────────────────────────────────────────

test('GMO-7: a broken member read RAISES — it never becomes "this garage has no members"', async () => {
  const c = client({ tenant_users: () => ({ data: null, error: { message: 'connection reset' } }) });
  await assert.rejects(() => listMembers(c, admin), /Could not load this garage's members/);
});

test('GMO-7: a broken admin count RAISES rather than guessing either way', async () => {
  const c = client({
    tenant_users: (filters, { op }) => {
      if (filters.role === 'admin') return { data: null, error: { message: 'timeout' } };
      if (op === 'select') return { data: { id: 'm1', user_id: ADMIN, role: 'admin' }, error: null };
      return { data: null, error: null };
    },
  });
  // Guessing low blocks a legitimate removal; guessing high removes the last administrator.
  await assert.rejects(() => removeMember(c, admin, ADMIN, {}), /Could not check the garage's administrators/);
});

test('GMO-7: removing someone who is not a member says so', async () => {
  const c = client({ tenant_users: () => ({ data: null, error: null }) });
  await assert.rejects(() => removeMember(c, admin, 'u_nobody', {}), /not a member of this garage/);
});

test('GMO-7: a membership that changed mid-removal is reported, not silently missed', async () => {
  const log = [];
  const c = client({
    tenant_users: (filters, { op }) => {
      if (op === 'delete') return { data: null, error: null };
      if (filters.role === 'admin') return { data: [{ id: 'a' }, { id: 'b' }], count: 2, error: null };
      return { data: { id: 'm3', user_id: MECHANIC, role: 'mechanic' }, error: null };
    },
  }, log);
  await assert.rejects(() => removeMember(c, admin, MECHANIC, {}), /changed while you were removing it/);
});

test('GMO-7: a member whose name cannot be resolved is unnamed, never invented', async () => {
  const c = client({
    tenant_users: [{ id: 'm9', user_id: 'u_ghost', role: 'mechanic', joined_at: '2026-01-01' }],
    users: [],
  });
  const { members } = await listMembers(c, admin);
  assert.equal(members[0].displayName, null);
  assert.equal(members[0].email, null);
  assert.equal(members[0].userId, 'u_ghost');
});

test('GMO-7: the routes are tenant-scoped and admin-only', () => {
  const s = src('../routes/garageMembershipRoutes.js');
  for (const route of ["'/api/garage/members'", "'/api/garage/members/:userId'", "'/api/garage/members/:userId/role'"]) {
    const at = s.indexOf(route);
    assert.ok(at > 0, `${route} must exist`);
    assert.match(s.slice(at, at + 200), /authorizeTenantRole\(GARAGE_ADMIN_ROLES\)/);
  }
});
