/**
 * GARAGE-1.0-OPS01 — real PostgreSQL/PGlite schema certification.
 *
 * Proves OPS01 extends the current garage_branches authority without weakening its tenant-safe
 * composite identity, and adds workforce metadata that survives membership lifecycle as history.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

const { createGmoDatabase } = await import('./helpers/gmoGarageWorld.js');
const { migrationUpSql } = await import('./helpers/pgliteLedgerHarness.js');

const S1 = '20261004180000_service_network_s1_garage_identity.sql';
const OPS = '20261022130000_garage_ops01_multisite_workforce.sql';

let db;
const T = {};
const B = {};

async function refusal(promise) {
  try { await promise; return null; } catch (error) { return error; }
}

before(async () => {
  db = await createGmoDatabase();
  await db.exec(migrationUpSql(S1));
  await db.exec(migrationUpSql(OPS));
  // Repository migration convention: additive migrations must be safe if the Up body is replayed
  // against a schema that already has their objects.
  await db.exec(migrationUpSql(OPS));

  for (const id of ['admin-a', 'mech-a', 'member-a', 'admin-b', 'mech-b', 'stranger']) {
    await db.query(
      `INSERT INTO users (id, name, email, role, join_date, is_verified)
       VALUES ($1, $2, $3, 'owner', '2026-01-01', true)`,
      [id, id, `${id}@example.invalid`],
    );
  }
  const tenant = async (key, name, type = 'garage') => {
    T[key] = (await db.query(
      `INSERT INTO tenants (name, type, status) VALUES ($1, $2, 'active') RETURNING id`,
      [name, type],
    )).rows[0].id;
  };
  await tenant('a', 'Garage A');
  await tenant('b', 'Garage B');
  await tenant('dealer', 'Dealer C', 'dealership');

  const member = (tenantId, user, role) => db.query(
    'INSERT INTO tenant_users (tenant_id, user_id, role) VALUES ($1, $2, $3)',
    [tenantId, user, role],
  );
  await member(T.a, 'admin-a', 'admin');
  await member(T.a, 'mech-a', 'mechanic');
  await member(T.a, 'member-a', 'mechanic');
  await member(T.b, 'admin-b', 'admin');
  await member(T.b, 'mech-b', 'mechanic');
});

after(async () => { await db?.close(); });

test('OPS01 Up is replay-safe and keeps public tables closed to direct client roles', async () => {
  for (const table of [
    'garage_branch_opening_hours', 'garage_departments', 'garage_workforce_profiles',
    'garage_workforce_branch_assignments', 'garage_workforce_skills', 'garage_workforce_certifications',
  ]) {
    const { rows: [p] } = await db.query(
      `SELECT
         has_table_privilege('anon', $1, 'SELECT') AS anon_select,
         has_table_privilege('authenticated', $1, 'SELECT') AS auth_select,
         has_table_privilege('service_role', $1, 'SELECT') AS service_select`,
      [`public.${table}`],
    );
    assert.deepEqual(p, { anon_select: false, auth_select: false, service_select: true }, table);
  }
});

test('branch code is Garage-local, stable, and the existing branch UUID remains technical identity', async () => {
  B.a1 = (await db.query(
    `INSERT INTO garage_branches
      (tenant_id, name, branch_code, location_city, address_public, country_code, timezone, is_public)
     VALUES ($1, 'Central', 'CENTRAL-01', 'Harare', '1 Example Road', 'ZW', 'Africa/Harare', false)
     RETURNING id`, [T.a],
  )).rows[0].id;

  const duplicate = await refusal(db.query(
    `INSERT INTO garage_branches
      (tenant_id, name, branch_code, location_city, address_public, country_code, timezone)
     VALUES ($1, 'Second', 'CENTRAL-01', 'Harare', '2 Example Road', 'ZW', 'Africa/Harare')`, [T.a],
  ));
  assert.equal(duplicate?.code, '23505', 'same Garage cannot reuse a branch code');

  B.b1 = (await db.query(
    `INSERT INTO garage_branches
      (tenant_id, name, branch_code, location_city, address_public, country_code, timezone)
     VALUES ($1, 'Central', 'CENTRAL-01', 'Bulawayo', '3 Example Road', 'ZW', 'Africa/Harare')
     RETURNING id`, [T.b],
  )).rows[0].id;
  assert.ok(B.b1, 'different Garage may use the same local operational code');

  const rename = await refusal(db.query(
    `UPDATE garage_branches SET branch_code = 'CENTRAL-02' WHERE id = $1`, [B.a1],
  ));
  assert.match(rename?.message || '', /GARAGE_BRANCH_CODE_IMMUTABLE/);
});

test('a branch manager is a same-Garage member; a platform/user identity alone is not enough', async () => {
  await db.query(`UPDATE garage_branches SET manager_user_id = 'admin-a' WHERE id = $1`, [B.a1]);
  const cross = await refusal(db.query(
    `UPDATE garage_branches SET manager_user_id = 'admin-b' WHERE id = $1`, [B.a1],
  ));
  assert.match(cross?.message || '', /GARAGE_BRANCH_MANAGER_NOT_MEMBER/);
  const stranger = await refusal(db.query(
    `UPDATE garage_branches SET manager_user_id = 'stranger' WHERE id = $1`, [B.a1],
  ));
  assert.match(stranger?.message || '', /GARAGE_BRANCH_MANAGER_NOT_MEMBER/);
});

test('opening hours are structured and reject dishonest/invalid shapes', async () => {
  await db.query(
    `INSERT INTO garage_branch_opening_hours
      (tenant_id, branch_id, day_of_week, is_closed, opens_at, closes_at)
     VALUES ($1, $2, 1, false, '08:00', '17:00'),
            ($1, $2, 0, true, NULL, NULL)`,
    [T.a, B.a1],
  );
  const bad = await refusal(db.query(
    `INSERT INTO garage_branch_opening_hours
      (tenant_id, branch_id, day_of_week, is_closed, opens_at, closes_at)
     VALUES ($1, $2, 2, false, NULL, NULL)`, [T.a, B.a1],
  ));
  assert.equal(bad?.code, '23514');
});

test('workforce profile requires real membership and staff code is unique only inside one Garage', async () => {
  const deptA = (await db.query(
    `INSERT INTO garage_departments (tenant_id, name, created_by_user_id)
     VALUES ($1, 'Workshop', 'admin-a') RETURNING id`, [T.a],
  )).rows[0].id;
  const deptB = (await db.query(
    `INSERT INTO garage_departments (tenant_id, name, created_by_user_id)
     VALUES ($1, 'Workshop', 'admin-b') RETURNING id`, [T.b],
  )).rows[0].id;

  const pA = (await db.query(
    `INSERT INTO garage_workforce_profiles
      (tenant_id, user_id, staff_code, job_title, employment_classification, employment_status, start_date, department_id, created_by_user_id)
     VALUES ($1, 'mech-a', 'STAFF-001', 'Technician', 'employee', 'pending', '2026-10-01', $2, 'admin-a')
     RETURNING id`, [T.a, deptA],
  )).rows[0].id;

  const duplicate = await refusal(db.query(
    `INSERT INTO garage_workforce_profiles
      (tenant_id, user_id, staff_code, employment_classification, employment_status, start_date, created_by_user_id)
     VALUES ($1, 'member-a', 'STAFF-001', 'employee', 'pending', '2026-10-01', 'admin-a')`, [T.a],
  ));
  assert.equal(duplicate?.code, '23505');

  const renamedStaffCode = await refusal(db.query(
    `UPDATE garage_workforce_profiles SET staff_code = 'STAFF-002' WHERE id = $1`, [pA],
  ));
  assert.match(renamedStaffCode?.message || '', /GARAGE_WORKFORCE_STAFF_CODE_IMMUTABLE/);

  const pB = (await db.query(
    `INSERT INTO garage_workforce_profiles
      (tenant_id, user_id, staff_code, employment_classification, employment_status, start_date, department_id, created_by_user_id)
     VALUES ($1, 'mech-b', 'STAFF-001', 'employee', 'pending', '2026-10-01', $2, 'admin-b')
     RETURNING id`, [T.b, deptB],
  )).rows[0].id;
  assert.ok(pB, 'staff code is local to the Garage');

  const nonmember = await refusal(db.query(
    `INSERT INTO garage_workforce_profiles
      (tenant_id, user_id, staff_code, employment_classification, employment_status, start_date, created_by_user_id)
     VALUES ($1, 'stranger', 'STAFF-999', 'contractor', 'pending', '2026-10-01', 'admin-a')`, [T.a],
  ));
  assert.match(nonmember?.message || '', /GARAGE_WORKFORCE_NOT_MEMBER/);

  const fabricatedHistory = await refusal(db.query(
    `INSERT INTO garage_workforce_profiles
      (tenant_id, user_id, staff_code, employment_classification, employment_status, start_date, end_date, created_by_user_id)
     VALUES ($1, 'stranger', 'STAFF-998', 'contractor', 'ended', '2026-09-01', '2026-09-30', 'admin-a')`, [T.a],
  ));
  assert.match(
    fabricatedHistory?.message || '',
    /GARAGE_WORKFORCE_NOT_MEMBER/,
    'an already-ended profile cannot manufacture employment history for a nonmember',
  );

  const crossDepartment = await refusal(db.query(
    `UPDATE garage_workforce_profiles SET department_id = $1 WHERE id = $2`, [deptB, pA],
  ));
  assert.equal(crossDepartment?.code, '23503', 'department and workforce profile must share tenant');

  // Keep for assignment/lifecycle tests.
  T.profileA = pA;
});

test('staff-to-site assignments are same-tenant, support one primary + additional sites, and require active sites', async () => {
  B.a2 = (await db.query(
    `INSERT INTO garage_branches
      (tenant_id, name, branch_code, location_city, address_public, country_code, timezone)
     VALUES ($1, 'North', 'NORTH-01', 'Harare', '4 Example Road', 'ZW', 'Africa/Harare')
     RETURNING id`, [T.a],
  )).rows[0].id;

  const assignment = async (branch, primary) => db.query(
    `INSERT INTO garage_workforce_branch_assignments
      (tenant_id, workforce_profile_id, branch_id, is_primary, assigned_by_user_id)
     VALUES ($1, $2, $3, $4, 'admin-a')`,
    [T.a, T.profileA, branch, primary],
  );
  await assignment(B.a1, true);
  await assignment(B.a2, false);
  await db.query(`UPDATE garage_workforce_profiles SET employment_status='active' WHERE id=$1`, [T.profileA]);

  const { rows } = await db.query(
    `SELECT branch_id, is_primary FROM garage_workforce_branch_assignments
     WHERE tenant_id=$1 AND workforce_profile_id=$2 AND ended_at IS NULL ORDER BY is_primary DESC`,
    [T.a, T.profileA],
  );
  assert.equal(rows.length, 2);
  assert.equal(rows.filter((r) => r.is_primary).length, 1);

  await db.query(`UPDATE garage_workforce_profiles SET employment_status='inactive' WHERE id=$1`, [T.profileA]);
  const inactiveWorker = await refusal(assignment(B.a2, false));
  assert.match(inactiveWorker?.message || '', /GARAGE_WORKFORCE_ASSIGNMENT_PROFILE_INACTIVE/);
  await db.query(`UPDATE garage_workforce_profiles SET employment_status='active' WHERE id=$1`, [T.profileA]);

  const cross = await refusal(assignment(B.b1, false));
  assert.equal(cross?.code, '23503', 'composite FK blocks another Garage branch');

  await db.query(`UPDATE garage_branches SET is_active=false WHERE id=$1`, [B.a2]);
  await db.query(`UPDATE garage_workforce_branch_assignments SET ended_at=now(), is_primary=false
                  WHERE branch_id=$1 AND ended_at IS NULL`, [B.a2]);
  const inactive = await refusal(assignment(B.a2, false));
  assert.match(inactive?.message || '', /GARAGE_WORKFORCE_ASSIGNMENT_BRANCH_INACTIVE/);
});

test('membership removal ends future workforce authority while preserving workforce and assignment history', async () => {
  await db.query(`UPDATE garage_branches SET manager_user_id='mech-a' WHERE id=$1`, [B.a1]);
  const before = (await db.query(
    `SELECT count(*)::int AS n FROM garage_workforce_branch_assignments
      WHERE tenant_id=$1 AND workforce_profile_id=$2`, [T.a, T.profileA],
  )).rows[0].n;

  await db.query(`DELETE FROM tenant_users WHERE tenant_id=$1 AND user_id='mech-a'`, [T.a]);

  const { rows: [profile] } = await db.query(
    `SELECT employment_status, end_date FROM garage_workforce_profiles WHERE id=$1`, [T.profileA],
  );
  assert.equal(profile.employment_status, 'ended');
  assert.ok(profile.end_date);

  const { rows: [branch] } = await db.query(`SELECT manager_user_id FROM garage_branches WHERE id=$1`, [B.a1]);
  assert.equal(branch.manager_user_id, null);

  const { rows: [history] } = await db.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE ended_at IS NOT NULL)::int AS ended
       FROM garage_workforce_branch_assignments
      WHERE tenant_id=$1 AND workforce_profile_id=$2`, [T.a, T.profileA],
  );
  assert.equal(history.total, before, 'assignment rows are retained');
  assert.equal(history.ended, before, 'live assignments are closed rather than deleted');

  const branchStillThere = (await db.query(`SELECT id FROM garage_branches WHERE id=$1`, [B.a1])).rows[0];
  assert.equal(branchStillThere.id, B.a1, 'historically referenced branch is retained');
});

test('a dealership cannot become a Garage site/workforce authority merely by using the tables', async () => {
  const site = await refusal(db.query(
    `INSERT INTO garage_branches
      (tenant_id, name, branch_code, location_city, address_public, country_code, timezone)
     VALUES ($1, 'Dealer Branch', 'D-01', 'Harare', '5 Road', 'ZW', 'Africa/Harare')`, [T.dealer],
  ));
  assert.match(site?.message || '', /GARAGE_BRANCH_NOT_GARAGE_TENANT/);
});
