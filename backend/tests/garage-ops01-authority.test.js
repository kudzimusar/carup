/**
 * GARAGE-1.0-OPS01 — shipped HTTP authority certification.
 *
 * Security is the current AUTH/session-selected Garage boundary, not a client tenant id, platform
 * role or user-facing workforce title. Database-specific uniqueness/composite FK tests live in
 * garage-ops01-migrations.test.js.
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

for (const method of ['log', 'info', 'warn', 'debug', 'error']) console[method] = () => {};

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
delete process.env.CARUP_ALLOW_X_USER_ID_FALLBACK;

const { createSupabaseWorld, installSupabaseWorld } = await import('./helpers/inMemorySupabaseWorld.js');
const { app } = await import('../server.js');
const { supabase } = await import('../db/supabase.js');

const FUTURE = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const DEALER = '33333333-3333-3333-3333-333333333333';
const INACTIVE = '44444444-4444-4444-4444-444444444444';
const BRANCH_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BRANCH_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const BRANCH_A_INACTIVE = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const PROFILE_A = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

let world; let restoreWorld; let server; let baseUrl;
const session = (token, user, tenant) => ({
  token, user_id: user, active_role: 'owner', active_organization_id: tenant,
  is_valid: true, expires_at: FUTURE,
});

function seed() {
  restoreWorld?.();
  world = createSupabaseWorld({
    users: [
      { id: 'admin-a', name: 'Admin A', email: 'admin-a@example.invalid', role: 'owner', is_verified: true },
      { id: 'mech-a', name: 'Mechanic A', email: 'mech-a@example.invalid', role: 'owner', is_verified: true },
      { id: 'member-a', name: 'Member A', email: 'member-a@example.invalid', role: 'owner', is_verified: true },
      { id: 'admin-b', name: 'Admin B', email: 'admin-b@example.invalid', role: 'owner', is_verified: true },
      { id: 'dealer-admin', name: 'Dealer Admin', email: 'dealer@example.invalid', role: 'owner', is_verified: true },
      { id: 'platform-admin', name: 'Platform Admin', email: 'platform@example.invalid', role: 'admin', is_verified: true },
      { id: 'inactive-admin', name: 'Inactive Admin', email: 'inactive@example.invalid', role: 'owner', is_verified: true },
      { id: 'stranger', name: 'Stranger', email: 'stranger@example.invalid', role: 'owner', is_verified: true },
    ],
    user_sessions: [
      session('tok-admin-a', 'admin-a', A),
      session('tok-mech-a', 'mech-a', A),
      session('tok-member-a', 'member-a', A),
      session('tok-admin-b', 'admin-b', B),
      session('tok-dealer', 'dealer-admin', DEALER),
      session('tok-platform-admin', 'platform-admin', A),
      session('tok-inactive', 'inactive-admin', INACTIVE),
    ],
    tenants: [
      { id: A, name: 'Garage A', type: 'garage', status: 'active' },
      { id: B, name: 'Garage B', type: 'garage', status: 'active' },
      { id: DEALER, name: 'Dealer C', type: 'dealership', status: 'active' },
      { id: INACTIVE, name: 'Closed Garage', type: 'garage', status: 'inactive' },
    ],
    tenant_users: [
      { id: 'm-admin-a', tenant_id: A, user_id: 'admin-a', role: 'admin', joined_at: '2026-01-01T00:00:00Z' },
      { id: 'm-mech-a', tenant_id: A, user_id: 'mech-a', role: 'mechanic', joined_at: '2026-01-02T00:00:00Z' },
      { id: 'm-member-a', tenant_id: A, user_id: 'member-a', role: 'mechanic', joined_at: '2026-01-03T00:00:00Z' },
      { id: 'm-admin-b', tenant_id: B, user_id: 'admin-b', role: 'admin', joined_at: '2026-01-01T00:00:00Z' },
      { id: 'm-dealer', tenant_id: DEALER, user_id: 'dealer-admin', role: 'admin', joined_at: '2026-01-01T00:00:00Z' },
      { id: 'm-inactive', tenant_id: INACTIVE, user_id: 'inactive-admin', role: 'admin', joined_at: '2026-01-01T00:00:00Z' },
    ],
    tenant_settings: [
      { tenant_id: A, timezone: 'Africa/Harare' },
      { tenant_id: B, timezone: 'Africa/Harare' },
    ],
    garage_branches: [
      { id: BRANCH_A, tenant_id: A, name: 'Central', branch_code: 'CENTRAL-01', location_city: 'Harare', address_public: '1 Road', country_code: 'ZW', timezone: 'Africa/Harare', is_active: true, is_primary: true, is_public: false, manager_user_id: null },
      { id: BRANCH_A_INACTIVE, tenant_id: A, name: 'Closed', branch_code: 'CLOSED-01', location_city: 'Harare', address_public: '2 Road', country_code: 'ZW', timezone: 'Africa/Harare', is_active: false, is_primary: false, is_public: false, manager_user_id: null },
      { id: BRANCH_B, tenant_id: B, name: 'Other Garage', branch_code: 'OTHER-01', location_city: 'Bulawayo', address_public: '3 Road', country_code: 'ZW', timezone: 'Africa/Harare', is_active: true, is_primary: true, is_public: false, manager_user_id: null },
    ],
    garage_branch_opening_hours: [],
    garage_departments: [],
    garage_workforce_profiles: [
      { id: PROFILE_A, tenant_id: A, user_id: 'mech-a', staff_code: 'STAFF-001', job_title: 'Technician', employment_classification: 'employee', employment_status: 'active', start_date: '2026-01-01', end_date: null, department_id: null, created_by_user_id: 'admin-a' },
    ],
    garage_workforce_branch_assignments: [
      { id: 'seed-assign-a', tenant_id: A, workforce_profile_id: PROFILE_A, branch_id: BRANCH_A,
        is_primary: true, assigned_at: '2026-01-01T00:00:00Z', assigned_by_user_id: 'admin-a', ended_at: null },
    ],
    garage_workforce_skills: [],
    garage_workforce_certifications: [],
    trust_audit_events: [],
    organization_users: [],
    organization_audit_logs: [],
  });

  world.rpcs.set('garage_ops01_replace_workforce_branches', async (params, { rowsOf }) => {
    const {
      p_tenant_id: tenantId,
      p_workforce_profile_id: profileId,
      p_primary_branch_id: primaryId,
      p_additional_branch_ids: additional = [],
      p_actor_user_id: actorUserId,
    } = params || {};

    const profile = rowsOf('garage_workforce_profiles')
      .find((row) => row.id === profileId && row.tenant_id === tenantId);
    if (!profile) return { data: null, error: { message: 'GARAGE_WORKFORCE_PROFILE_NOT_FOUND' } };
    if (!['pending', 'active'].includes(profile.employment_status)) {
      return { data: null, error: { message: 'GARAGE_WORKFORCE_ASSIGNMENT_PROFILE_INACTIVE' } };
    }
    const member = rowsOf('tenant_users')
      .some((row) => row.tenant_id === tenantId && row.user_id === profile.user_id);
    if (!member) return { data: null, error: { message: 'GARAGE_WORKFORCE_NOT_MEMBER' } };

    const desired = [...new Set([primaryId, ...(additional || [])].filter(Boolean))].sort();
    const valid = desired.every((branchId) => rowsOf('garage_branches')
      .some((row) => row.id === branchId && row.tenant_id === tenantId && row.is_active === true));
    if (!primaryId || !valid) {
      return { data: null, error: { message: 'GARAGE_WORKFORCE_ASSIGNMENT_BRANCH_INVALID' } };
    }

    const current = rowsOf('garage_workforce_branch_assignments')
      .filter((row) => row.tenant_id === tenantId && row.workforce_profile_id === profileId && !row.ended_at);
    const currentIds = current.map((row) => row.branch_id).sort();
    const currentPrimary = current.find((row) => row.is_primary)?.branch_id || null;
    if (JSON.stringify(currentIds) === JSON.stringify(desired) && currentPrimary === primaryId) {
      return { data: false, error: null };
    }

    const now = new Date().toISOString();
    for (const row of current) {
      row.ended_at = now;
      row.ended_by_user_id = actorUserId || null;
      row.is_primary = false;
    }
    for (const branchId of desired) {
      rowsOf('garage_workforce_branch_assignments').push({
        id: `rpc-assignment-${profileId}-${branchId}-${rowsOf('garage_workforce_branch_assignments').length + 1}`,
        tenant_id: tenantId,
        workforce_profile_id: profileId,
        branch_id: branchId,
        is_primary: branchId === primaryId,
        assigned_at: now,
        assigned_by_user_id: actorUserId || null,
        ended_at: null,
      });
    }
    return { data: true, error: null };
  });



  world.rpcs.set('garage_ops01_set_workforce_status', async (params, { rowsOf }) => {
    const {
      p_tenant_id: tenantId,
      p_workforce_profile_id: profileId,
      p_status: requestedStatus,
      p_actor_user_id: actorUserId,
    } = params || {};
    const next = String(requestedStatus || '').toLowerCase();
    const profile = rowsOf('garage_workforce_profiles')
      .find((row) => row.id === profileId && row.tenant_id === tenantId);
    if (!profile) return { data: null, error: { message: 'GARAGE_WORKFORCE_PROFILE_NOT_FOUND' } };
    const actorAdmin = rowsOf('tenant_users')
      .some((row) => row.tenant_id === tenantId && row.user_id === actorUserId && String(row.role).toLowerCase() === 'admin');
    if (!actorAdmin) return { data: null, error: { message: 'GARAGE_WORKFORCE_STATUS_ACTOR_NOT_ADMIN' } };
    if (!['pending', 'active', 'inactive', 'ended'].includes(next)) {
      return { data: null, error: { message: 'GARAGE_WORKFORCE_STATUS_INVALID' } };
    }
    if (profile.employment_status === next) return { data: false, error: null };

    const membership = rowsOf('tenant_users')
      .find((row) => row.tenant_id === tenantId && row.user_id === profile.user_id);
    if (['pending', 'active'].includes(next) && !membership) {
      return { data: null, error: { message: 'GARAGE_WORKFORCE_NOT_MEMBER' } };
    }
    if (next === 'active' && String(membership?.role || '').toLowerCase() === 'mechanic') {
      const primaryCount = rowsOf('garage_workforce_branch_assignments')
        .filter((row) => row.tenant_id === tenantId && row.workforce_profile_id === profileId
          && !row.ended_at && row.is_primary === true).length;
      if (primaryCount !== 1) return { data: null, error: { message: 'GARAGE_WORKFORCE_PRIMARY_SITE_REQUIRED' } };
    }

    const now = new Date().toISOString();
    if (next !== 'active') {
      for (const row of rowsOf('garage_workforce_branch_assignments')) {
        if (row.tenant_id === tenantId && row.workforce_profile_id === profileId && !row.ended_at) {
          row.ended_at = now;
          row.ended_by_user_id = actorUserId;
          row.is_primary = false;
        }
      }
      for (const row of rowsOf('garage_branches')) {
        if (row.tenant_id === tenantId && row.manager_user_id === profile.user_id) {
          row.manager_user_id = null;
          row.updated_at = now;
        }
      }
    }
    profile.employment_status = next;
    if (next === 'ended' && !profile.end_date) profile.end_date = now.slice(0, 10);
    if (next === 'active') profile.end_date = null;
    profile.updated_at = now;
    return { data: true, error: null };
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
  if (server) await new Promise((resolve) => server.close(resolve));
});
beforeEach(() => seed());

async function call(method, path, { token, headers = {}, body } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-bypass-rate-limit': 'true',
      ...(token ? { 'x-session-token': token } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed, text };
}

const siteBody = (overrides = {}) => ({
  branch_code: 'EAST-01',
  name: 'East Site',
  address_line: '10 Enterprise Road',
  location_city: 'Harare',
  country_code: 'ZW',
  timezone: 'Africa/Harare',
  opening_hours: [{ day_of_week: 1, is_closed: false, opens_at: '08:00', closes_at: '17:00' }],
  ...overrides,
});

test('Garage admin can manage own sites and a client-supplied tenant id cannot redirect the write', async () => {
  const created = await call('POST', '/api/garage/sites', {
    token: 'tok-admin-a',
    body: siteBody({ tenant_id: B }),
  });
  assert.equal(created.status, 201, created.text);
  assert.equal(created.body.site.tenant_id, A);
  assert.equal(created.body.site.branch_code, 'EAST-01');

  const listed = await call('GET', '/api/garage/sites', { token: 'tok-admin-a' });
  assert.equal(listed.status, 200);
  assert.ok(listed.body.sites.every((site) => site.tenant_id === A));
});

test('site timezone is governed IANA authority, not arbitrary display text', async () => {
  const before = world.rows('garage_branches').length;
  const res = await call('POST', '/api/garage/sites', {
    token: 'tok-admin-a',
    body: siteBody({ branch_code: 'BADTZ-01', timezone: 'Moon/Base' }),
  });
  assert.equal(res.status, 400, res.text);
  assert.match(String(res.body?.message || res.text), /valid IANA time zone/i);
  assert.equal(world.rows('garage_branches').length, before, 'invalid timezone creates no site');
});

test('mechanic, dealership admin and platform admin without Garage membership cannot perform Garage-admin site mutations', async () => {
  for (const [token, expectedCode] of [
    ['tok-mech-a', 'ACTIVE_TENANT_ROLE'],
    ['tok-dealer', 'ACTIVE_TENANT_TYPE'],
    ['tok-platform-admin', 'TENANT_CONTEXT_REVOKED'],
  ]) {
    const res = await call('POST', '/api/garage/sites', { token, body: siteBody() });
    assert.equal(res.status, 403, `${token}: ${res.text}`);
    assert.equal(res.body.code, expectedCode);
  }
});

test('wrong tenant header cannot redirect an authenticated Garage admin', async () => {
  const res = await call('POST', '/api/garage/sites', {
    token: 'tok-admin-a',
    headers: { 'x-tenant-id': B },
    body: siteBody(),
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'TENANT_CONTEXT_MISMATCH');
});

test('revoked membership and inactive Garage stop new operations on the next request', async () => {
  assert.equal((await call('GET', '/api/garage/sites', { token: 'tok-admin-a' })).status, 200);
  world.tables.tenant_users = world.rows('tenant_users').filter((m) => m.user_id !== 'admin-a');
  const revoked = await call('GET', '/api/garage/sites', { token: 'tok-admin-a' });
  assert.equal(revoked.status, 403);
  assert.equal(revoked.body.code, 'TENANT_CONTEXT_REVOKED');

  const inactive = await call('POST', '/api/garage/sites', { token: 'tok-inactive', body: siteBody() });
  assert.equal(inactive.status, 403);
});

test('another Garage cannot read or mutate a private site by guessing its branch id', async () => {
  const read = await call('GET', `/api/garage/sites/${BRANCH_A}`, { token: 'tok-admin-b' });
  assert.equal(read.status, 404);
  const edit = await call('PATCH', `/api/garage/sites/${BRANCH_A}`, {
    token: 'tok-admin-b', body: { name: 'Hijacked' },
  });
  assert.equal(edit.status, 404);
  assert.equal(world.rows('garage_branches').find((b) => b.id === BRANCH_A).name, 'Central');
});

test('branch manager must be an active workforce member of the same Garage', async () => {
  const good = await call('PATCH', `/api/garage/sites/${BRANCH_A}/manager`, {
    token: 'tok-admin-a', body: { user_id: 'mech-a' },
  });
  assert.equal(good.status, 200, good.text);
  assert.equal(good.body.site.manager_user_id, 'mech-a');

  for (const user_id of ['admin-b', 'stranger']) {
    const bad = await call('PATCH', `/api/garage/sites/${BRANCH_A}/manager`, {
      token: 'tok-admin-a', body: { user_id },
    });
    assert.equal(bad.status, 400, bad.text);
  }
});

test('workforce profile can be created only for a current member of the selected Garage', async () => {
  const created = await call('POST', '/api/garage/workforce', {
    token: 'tok-admin-a',
    body: {
      user_id: 'member-a', staff_code: 'STAFF-002', job_title: 'Service Advisor',
      employment_classification: 'employee', start_date: '2026-10-01', tenant_id: B,
    },
  });
  assert.equal(created.status, 201, created.text);
  assert.equal(created.body.profile.tenant_id, A);
  assert.equal(created.body.profile.user_id, 'member-a');

  for (const user_id of ['admin-b', 'stranger']) {
    const denied = await call('POST', '/api/garage/workforce', {
      token: 'tok-admin-a',
      body: { user_id, staff_code: 'OTHER-01', employment_classification: 'contractor', start_date: '2026-10-01' },
    });
    assert.equal(denied.status, 400, denied.text);
  }
});

test('staff code is stable after workforce profile creation', async () => {
  const res = await call('PATCH', '/api/garage/workforce/mech-a', {
    token: 'tok-admin-a',
    body: {
      staff_code: 'RENAMED-001',
      job_title: 'Technician',
      employment_classification: 'employee',
      start_date: '2026-01-01',
    },
  });
  assert.equal(res.status, 409, res.text);
  assert.equal(world.rows('garage_workforce_profiles')[0].staff_code, 'STAFF-001');
});

test('staff assignment is same-Garage, requires active staff and an active site', async () => {
  const cross = await call('PUT', '/api/garage/workforce/mech-a/branches', {
    token: 'tok-admin-a',
    body: { primary_branch_id: BRANCH_B },
  });
  assert.equal(cross.status, 404, cross.text);

  const inactiveSite = await call('PUT', '/api/garage/workforce/mech-a/branches', {
    token: 'tok-admin-a',
    body: { primary_branch_id: BRANCH_A_INACTIVE },
  });
  assert.equal(inactiveSite.status, 404, inactiveSite.text);

  const ok = await call('PUT', '/api/garage/workforce/mech-a/branches', {
    token: 'tok-admin-a',
    body: { primary_branch_id: BRANCH_A, additional_branch_ids: [] },
  });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.profile.branch_assignments.length, 1);
  assert.equal(ok.body.profile.branch_assignments[0].branch_id, BRANCH_A);

  world.tables.garage_workforce_profiles[0].employment_status = 'inactive';
  const staffInactive = await call('PUT', '/api/garage/workforce/mech-a/branches', {
    token: 'tok-admin-a',
    body: { primary_branch_id: BRANCH_A },
  });
  assert.equal(staffInactive.status, 409);
});

test('inactive mechanic reactivation requires pending preparation before a new primary-site assignment', async () => {
  const inactive = await call('PATCH', '/api/garage/workforce/mech-a/status', {
    token: 'tok-admin-a', body: { status: 'inactive' },
  });
  assert.equal(inactive.status, 200, inactive.text);
  assert.equal(world.rows('garage_workforce_profiles')[0].employment_status, 'inactive');
  assert.ok(world.rows('garage_workforce_branch_assignments')[0].ended_at);

  const assignmentWhileInactive = await call('PUT', '/api/garage/workforce/mech-a/branches', {
    token: 'tok-admin-a', body: { primary_branch_id: BRANCH_A },
  });
  assert.equal(assignmentWhileInactive.status, 409);

  const pending = await call('PATCH', '/api/garage/workforce/mech-a/status', {
    token: 'tok-admin-a', body: { status: 'pending' },
  });
  assert.equal(pending.status, 200, pending.text);

  const reassigned = await call('PUT', '/api/garage/workforce/mech-a/branches', {
    token: 'tok-admin-a', body: { primary_branch_id: BRANCH_A },
  });
  assert.equal(reassigned.status, 200, reassigned.text);
  assert.equal(reassigned.body.profile.branch_assignments.filter((row) => row.is_primary).length, 1);

  const active = await call('PATCH', '/api/garage/workforce/mech-a/status', {
    token: 'tok-admin-a', body: { status: 'active' },
  });
  assert.equal(active.status, 200, active.text);
  assert.equal(active.body.profile.employment_status, 'active');
});

test('deactivating workforce closes future site assignment and manager responsibility without deleting records', async () => {
  world.tables.garage_branches[0].manager_user_id = 'mech-a';
  const res = await call('PATCH', '/api/garage/workforce/mech-a/status', {
    token: 'tok-admin-a', body: { status: 'ended' },
  });
  assert.equal(res.status, 200, res.text);
  assert.equal(world.rows('garage_workforce_profiles')[0].employment_status, 'ended');
  assert.ok(world.rows('garage_workforce_branch_assignments')[0].ended_at, 'assignment history retained and closed');
  assert.equal(world.rows('garage_branches')[0].manager_user_id, null);
});

test('site deactivation refuses to strand a live workforce assignment', async () => {
  const res = await call('PATCH', `/api/garage/sites/${BRANCH_A}/status`, {
    token: 'tok-admin-a', body: { status: 'inactive' },
  });
  assert.equal(res.status, 409, res.text);
  assert.equal(world.rows('garage_branches').find((b) => b.id === BRANCH_A).is_active, true);
});

test('material Garage administration writes authoritative tenant-attributed audit events', async () => {
  const createdSite = await call('POST', '/api/garage/sites', {
    token: 'tok-admin-a',
    body: siteBody({ branch_code: 'AUDIT-01', name: 'Audit Site' }),
  });
  assert.equal(createdSite.status, 201, createdSite.text);
  const siteId = createdSite.body.site.id;

  assert.equal((await call('PATCH', `/api/garage/sites/${siteId}`, {
    token: 'tok-admin-a', body: { name: 'Audit Site Updated' },
  })).status, 200);
  assert.equal((await call('PATCH', `/api/garage/sites/${siteId}/status`, {
    token: 'tok-admin-a', body: { status: 'inactive' },
  })).status, 200);
  assert.equal((await call('PATCH', `/api/garage/sites/${siteId}/status`, {
    token: 'tok-admin-a', body: { status: 'active' },
  })).status, 200);
  assert.equal((await call('PATCH', `/api/garage/sites/${siteId}/manager`, {
    token: 'tok-admin-a', body: { user_id: 'mech-a' },
  })).status, 200);

  const department = await call('POST', '/api/garage/departments', {
    token: 'tok-admin-a', body: { name: 'Audit Workshop' },
  });
  assert.equal(department.status, 201, department.text);
  const departmentId = department.body.department.id;
  assert.equal((await call('PATCH', `/api/garage/departments/${departmentId}`, {
    token: 'tok-admin-a', body: { name: 'Audit Workshop Team' },
  })).status, 200);

  const profile = await call('POST', '/api/garage/workforce', {
    token: 'tok-admin-a',
    body: {
      user_id: 'member-a',
      staff_code: 'AUDIT-STAFF-01',
      job_title: 'Technician',
      employment_classification: 'employee',
      start_date: '2026-10-01',
      department_id: departmentId,
    },
  });
  assert.equal(profile.status, 201, profile.text);

  assert.equal((await call('PATCH', '/api/garage/workforce/member-a', {
    token: 'tok-admin-a', body: { job_title: 'Senior Technician' },
  })).status, 200);

  assert.equal((await call('PUT', '/api/garage/workforce/member-a/branches', {
    token: 'tok-admin-a',
    body: { primary_branch_id: siteId, additional_branch_ids: [] },
  })).status, 200);

  assert.equal((await call('PATCH', '/api/garage/workforce/member-a/status', {
    token: 'tok-admin-a', body: { status: 'active' },
  })).status, 200);

  const events = world.rows('trust_audit_events');
  const eventTypes = new Set(events.map((event) => event.event_type));
  for (const expected of [
    'GARAGE_SITE_CREATED',
    'GARAGE_SITE_UPDATED',
    'GARAGE_SITE_DEACTIVATED',
    'GARAGE_SITE_ACTIVATED',
    'GARAGE_SITE_MANAGER_CHANGED',
    'GARAGE_DEPARTMENT_CREATED',
    'GARAGE_DEPARTMENT_UPDATED',
    'GARAGE_WORKFORCE_PROFILE_CREATED',
    'GARAGE_WORKFORCE_PROFILE_UPDATED',
    'GARAGE_WORKFORCE_BRANCH_ASSIGNMENT_CHANGED',
    'GARAGE_WORKFORCE_STATUS_CHANGED',
  ]) {
    assert.ok(eventTypes.has(expected), `missing audit event ${expected}`);
  }
  for (const event of events.filter((row) => String(row.event_type || '').startsWith('GARAGE_'))) {
    assert.equal(event.actor_user_id, 'admin-a');
    assert.equal(event.actor_tenant_id, A);
  }
});

test('Service Network rejects inactive sites for new work but historical branch rows remain readable', async () => {
  const { assertBranchBelongsToTenant } = await import('../services/serviceNetwork/serviceAuthority.js');
  await assert.rejects(
    () => assertBranchBelongsToTenant(supabase, BRANCH_A_INACTIVE, A),
    /inactive/i,
  );
  const historical = await assertBranchBelongsToTenant(supabase, BRANCH_A_INACTIVE, A, { requireActive: false });
  assert.equal(historical.id, BRANCH_A_INACTIVE);
});

test('OPS01 operator journey: two sites plus governed workforce stay on one Garage authority', async () => {
  const siteA = await call('POST', '/api/garage/sites', {
    token: 'tok-admin-a',
    body: siteBody({ branch_code: 'JOURNEY-A', name: 'Journey Site A' }),
  });
  assert.equal(siteA.status, 201, siteA.text);

  const siteB = await call('POST', '/api/garage/sites', {
    token: 'tok-admin-a',
    body: siteBody({ branch_code: 'JOURNEY-B', name: 'Journey Site B', is_primary: false }),
  });
  assert.equal(siteB.status, 201, siteB.text);

  const siteAId = siteA.body.site.id;
  const siteBId = siteB.body.site.id;

  const edited = await call('PATCH', `/api/garage/sites/${siteAId}`, {
    token: 'tok-admin-a',
    body: { name: 'Journey Site A — Updated' },
  });
  assert.equal(edited.status, 200, edited.text);
  assert.equal(edited.body.site.name, 'Journey Site A — Updated');

  const deactivated = await call('PATCH', `/api/garage/sites/${siteBId}/status`, {
    token: 'tok-admin-a', body: { status: 'inactive' },
  });
  assert.equal(deactivated.status, 200, deactivated.text);
  assert.equal(deactivated.body.site.is_active, false);

  const reactivated = await call('PATCH', `/api/garage/sites/${siteBId}/status`, {
    token: 'tok-admin-a', body: { status: 'active' },
  });
  assert.equal(reactivated.status, 200, reactivated.text);
  assert.equal(reactivated.body.site.is_active, true);

  const department = await call('POST', '/api/garage/departments', {
    token: 'tok-admin-a', body: { name: 'Journey Workshop' },
  });
  assert.equal(department.status, 201, department.text);

  const profile = await call('POST', '/api/garage/workforce', {
    token: 'tok-admin-a',
    body: {
      user_id: 'member-a',
      staff_code: 'JOURNEY-001',
      job_title: 'Technician',
      employment_classification: 'employee',
      start_date: '2026-10-22',
      department_id: department.body.department.id,
    },
  });
  assert.equal(profile.status, 201, profile.text);
  assert.equal(profile.body.profile.employment_status, 'pending');

  const assigned = await call('PUT', '/api/garage/workforce/member-a/branches', {
    token: 'tok-admin-a',
    body: { primary_branch_id: siteAId, additional_branch_ids: [siteBId] },
  });
  assert.equal(assigned.status, 200, assigned.text);
  assert.equal(assigned.body.profile.branch_assignments.length, 2);
  assert.equal(assigned.body.profile.branch_assignments.filter((row) => row.is_primary).length, 1);

  const skilled = await call('PUT', '/api/garage/workforce/member-a/skills', {
    token: 'tok-admin-a',
    body: { skills: ['Brakes', 'Diagnostics'] },
  });
  assert.equal(skilled.status, 200, skilled.text);
  assert.deepEqual(
    skilled.body.profile.skills.map((row) => row.skill_name).sort(),
    ['Brakes', 'Diagnostics'],
  );

  const certified = await call('POST', '/api/garage/workforce/member-a/certifications', {
    token: 'tok-admin-a',
    body: {
      name: 'Journey Brake Systems',
      issuer: 'Recorded Training Body',
      reference_number: 'JBS-001',
      issue_date: '2026-01-10',
      expiry_date: '2028-01-10',
    },
  });
  assert.equal(certified.status, 201, certified.text);

  const activated = await call('PATCH', '/api/garage/workforce/member-a/status', {
    token: 'tok-admin-a', body: { status: 'active' },
  });
  assert.equal(activated.status, 200, activated.text);
  assert.equal(activated.body.profile.employment_status, 'active');

  const manager = await call('PATCH', `/api/garage/sites/${siteAId}/manager`, {
    token: 'tok-admin-a', body: { user_id: 'member-a' },
  });
  assert.equal(manager.status, 200, manager.text);
  assert.equal(manager.body.site.manager_user_id, 'member-a');

  const workforce = await call('GET', '/api/garage/workforce/member-a', { token: 'tok-admin-a' });
  assert.equal(workforce.status, 200, workforce.text);
  assert.equal(workforce.body.profile.staff_code, 'JOURNEY-001');
  assert.equal(workforce.body.profile.department.name, 'Journey Workshop');
  assert.equal(workforce.body.profile.branch_assignments.length, 2);
  assert.equal(workforce.body.profile.skills.length, 2);
  assert.equal(workforce.body.profile.certifications.length, 1);

  const sites = await call('GET', '/api/garage/sites', { token: 'tok-admin-a' });
  assert.equal(sites.status, 200, sites.text);
  const journeySites = sites.body.sites.filter((site) => ['JOURNEY-A', 'JOURNEY-B'].includes(site.branch_code));
  assert.equal(journeySites.length, 2);
  assert.ok(journeySites.every((site) => site.tenant_id === A));
});

test('site edit accepts database-style time values after a read round-trip', async () => {
  const created = await call('POST', '/api/garage/sites', {
    token: 'tok-admin-a',
    body: siteBody({ branch_code: 'ROUNDTRIP-01', name: 'Round Trip Site' }),
  });
  assert.equal(created.status, 201, created.text);
  const siteId = created.body.site.id;
  const returnedHour = world.rows('garage_branch_opening_hours')
    .find((row) => row.branch_id === siteId && row.day_of_week === 1);
  assert.ok(returnedHour);
  // Supabase/Postgres returns time columns with seconds even though OPS01 records minutes.
  returnedHour.opens_at = '08:00:00';
  returnedHour.closes_at = '17:00:00';

  const edited = await call('PATCH', `/api/garage/sites/${siteId}`, {
    token: 'tok-admin-a',
    body: {
      name: 'Round Trip Site Updated',
      opening_hours: [{
        day_of_week: 1, is_closed: false,
        opens_at: returnedHour.opens_at, closes_at: returnedHour.closes_at,
      }],
    },
  });
  assert.equal(edited.status, 200, edited.text);
  assert.equal(world.rows('garage_branches').find((row) => row.id === siteId).name, 'Round Trip Site Updated');
  const normalizedHour = world.rows('garage_branch_opening_hours')
    .find((row) => row.branch_id === siteId && row.day_of_week === 1);
  assert.deepEqual(
    { opens_at: normalizedHour.opens_at, closes_at: normalizedHour.closes_at },
    { opens_at: '08:00', closes_at: '17:00' },
  );
  assert.equal(
    world.rows('trust_audit_events').filter((row) => row.event_type === 'GARAGE_SITE_UPDATED').length,
    1,
  );
});

test('invalid minute-level opening hours fail before site mutation or update audit', async () => {
  const created = await call('POST', '/api/garage/sites', {
    token: 'tok-admin-a',
    body: siteBody({ branch_code: 'ATOMIC-01', name: 'Atomic Site' }),
  });
  assert.equal(created.status, 201, created.text);
  const siteId = created.body.site.id;
  const beforeAuditCount = world.rows('trust_audit_events')
    .filter((row) => row.event_type === 'GARAGE_SITE_UPDATED').length;
  const beforeHour = world.rows('garage_branch_opening_hours')
    .find((row) => row.branch_id === siteId && row.day_of_week === 1);
  const rejected = await call('PATCH', `/api/garage/sites/${siteId}`, {
    token: 'tok-admin-a',
    body: {
      name: 'Must Not Persist',
      opening_hours: [{
        day_of_week: 1, is_closed: false,
        opens_at: '08:00:30', closes_at: '17:00:00',
      }],
    },
  });
  assert.equal(rejected.status, 400, rejected.text);
  assert.equal(world.rows('garage_branches').find((row) => row.id === siteId).name, 'Atomic Site');
  const afterHour = world.rows('garage_branch_opening_hours')
    .find((row) => row.branch_id === siteId && row.day_of_week === 1);
  assert.deepEqual(
    { opens_at: afterHour.opens_at, closes_at: afterHour.closes_at },
    { opens_at: beforeHour.opens_at, closes_at: beforeHour.closes_at },
  );
  assert.equal(
    world.rows('trust_audit_events').filter((row) => row.event_type === 'GARAGE_SITE_UPDATED').length,
    beforeAuditCount,
  );
});
