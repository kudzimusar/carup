import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createGmoDatabase } from './helpers/gmoGarageWorld.js';
import { migrationUpSql, MIGRATIONS_DIR } from './helpers/pgliteLedgerHarness.js';

const OPS = '20261022090000_garage_ops01_multisite_workforce.sql';
const S1 = '20261004180000_service_network_s1_garage_identity.sql';
const migration = () => readFileSync(`${MIGRATIONS_DIR}/${OPS}`, 'utf8');

async function database() {
  const db = await createGmoDatabase();
  await db.exec(migrationUpSql(S1));
  await db.exec(migrationUpSql(OPS));
  return db;
}

async function seedPeopleAndGarage(db) {
  await db.exec(`
    INSERT INTO users (id, name, email, role, join_date, is_verified, email_verified_at)
    VALUES
      ('ops-admin','Ops Admin','ops-admin@example.invalid','owner','2026-01-01',true,now()),
      ('ops-admin-2','Ops Admin Two','ops-admin-2@example.invalid','owner','2026-01-01',true,now()),
      ('ops-mech','Ops Mechanic','ops-mech@example.invalid','owner','2026-01-01',true,now()),
      ('ops-outsider','Outsider','ops-outsider@example.invalid','owner','2026-01-01',true,now());

    INSERT INTO tenants (id, name, type, status)
    VALUES
      ('11111111-1111-1111-1111-111111111111','OPS Garage','garage','active'),
      ('22222222-2222-2222-2222-222222222222','Other Garage','garage','active');

    INSERT INTO tenant_users (tenant_id, user_id, role)
    VALUES
      ('11111111-1111-1111-1111-111111111111','ops-admin','admin'),
      ('11111111-1111-1111-1111-111111111111','ops-admin-2','admin'),
      ('11111111-1111-1111-1111-111111111111','ops-mech','mechanic'),
      ('22222222-2222-2222-2222-222222222222','ops-outsider','admin');
  `);
}

test('OPS01 migration is last in lineage, has a Down, and keeps browser roles off its tables/functions', async () => {
  const all = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();
  assert.ok(all.includes(OPS));
  assert.equal(all.filter((f) => f.slice(0, 14) === OPS.slice(0, 14)).length, 1, 'OPS01 timestamp must be unique');
  assert.equal(all.at(-1), OPS, 'OPS01 must sort after the authority it extends');

  const sql = migration();
  assert.ok(sql.startsWith('-- +migrate Up'));
  assert.ok(sql.includes('-- +migrate Down'));
  assert.match(sql, /garage_branches remains the canonical site authority/i);
  assert.match(sql, /tenant_users remains the canonical membership/i);
  assert.match(sql, /REVOKE ALL ON TABLE public\.%I FROM PUBLIC, anon, authenticated/);
  for (const fn of [
    'replace_garage_branch_hours',
    'assign_garage_staff_branch',
    'end_garage_staff_branch_assignment',
    'remove_garage_member_ops01',
  ]) {
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(`));
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\(`));
  }
});

test('OPS01 applies on the current Garage authority and enforces admin-only branch managers at the database', async () => {
  const db = await database();
  try {
    await seedPeopleAndGarage(db);

    await db.exec(`
      INSERT INTO garage_branches
        (id, tenant_id, name, code, manager_user_id)
      VALUES
        ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
         '11111111-1111-1111-1111-111111111111',
         'CBD Workshop','CBD','ops-admin');
    `);

    await assert.rejects(
      db.exec(`
        INSERT INTO garage_branches
          (id, tenant_id, name, code, manager_user_id)
        VALUES
          ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
           '11111111-1111-1111-1111-111111111111',
           'Mechanic Managed','MECH','ops-mech');
      `),
      /GARAGE_BRANCH_MANAGER_ADMIN_REQUIRED/,
    );

    await assert.rejects(
      db.exec(`
        INSERT INTO garage_branches
          (id, tenant_id, name, code, manager_user_id)
        VALUES
          ('cccccccc-cccc-cccc-cccc-cccccccccccc',
           '11111111-1111-1111-1111-111111111111',
           'Foreign Managed','FOREIGN','ops-outsider');
      `),
      /GARAGE_BRANCH_MANAGER_ADMIN_REQUIRED|foreign key/i,
    );

    await assert.rejects(
      db.exec(`
        UPDATE tenant_users
           SET role='mechanic'
         WHERE tenant_id='11111111-1111-1111-1111-111111111111'
           AND user_id='ops-admin'
      `),
      /GARAGE_MEMBERSHIP_BRANCH_MANAGER/,
    );

    const { rows } = await db.query(`SELECT name, code, manager_user_id FROM garage_branches ORDER BY name`);
    assert.deepEqual(rows, [{ name: 'CBD Workshop', code: 'CBD', manager_user_id: 'ops-admin' }]);
  } finally { await db.close(); }
});

test('OPS01 staff metadata cannot manufacture membership and branch assignment is tenant/member/active-branch bound', async () => {
  const db = await database();
  try {
    await seedPeopleAndGarage(db);
    await db.exec(`
      INSERT INTO garage_branches (id, tenant_id, name, code, is_active)
      VALUES
        ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','CBD Workshop','CBD',true),
        ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','11111111-1111-1111-1111-111111111111','Closed Workshop','CLOSED',false),
        ('cccccccc-cccc-cccc-cccc-cccccccccccc','22222222-2222-2222-2222-222222222222','Other Site','OTHER',true);
    `);

    await assert.rejects(
      db.exec(`
        INSERT INTO garage_staff_profiles
          (tenant_id, user_id, employee_code, created_by_user_id, updated_by_user_id)
        VALUES
          ('11111111-1111-1111-1111-111111111111','ops-outsider','X01','ops-admin','ops-admin');
      `),
      /GARAGE_OPS_MEMBER_REQUIRED/,
    );

    const good = await db.query(`
      SELECT public.assign_garage_staff_branch(
        '11111111-1111-1111-1111-111111111111',
        'ops-mech',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        true,
        'ops-admin'
      ) AS result
    `);
    assert.equal(good.rows[0].result.created, true);
    assert.equal(good.rows[0].result.is_primary, true);

    await assert.rejects(
      db.exec(`
        INSERT INTO garage_staff_branch_assignments
          (tenant_id, user_id, branch_id, assigned_by_user_id)
        VALUES
          ('11111111-1111-1111-1111-111111111111',
           'ops-mech',
           'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
           'ops-admin')
      `),
      /GARAGE_BRANCH_NOT_ACTIVE/,
    );

    await assert.rejects(
      db.query(`
        SELECT public.assign_garage_staff_branch(
          '11111111-1111-1111-1111-111111111111',
          'ops-mech',
          'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          false,
          'ops-admin'
        )
      `),
      /GARAGE_BRANCH_NOT_ACTIVE/,
    );

    await assert.rejects(
      db.query(`
        SELECT public.assign_garage_staff_branch(
          '11111111-1111-1111-1111-111111111111',
          'ops-outsider',
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          false,
          'ops-admin'
        )
      `),
      /GARAGE_OPS_MEMBER_REQUIRED/,
    );

    await assert.rejects(
      db.query(`
        SELECT public.assign_garage_staff_branch(
          '11111111-1111-1111-1111-111111111111',
          'ops-mech',
          'cccccccc-cccc-cccc-cccc-cccccccccccc',
          false,
          'ops-admin'
        )
      `),
      /GARAGE_BRANCH_NOT_ACTIVE/,
    );
  } finally { await db.close(); }
});

test('OPS01 opening-hours replacement is atomic: a malformed replacement leaves the prior schedule intact', async () => {
  const db = await database();
  try {
    await seedPeopleAndGarage(db);
    await db.exec(`
      INSERT INTO garage_branches (id, tenant_id, name, code)
      VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','CBD Workshop','CBD');
    `);

    await db.query(`
      SELECT public.replace_garage_branch_hours(
        '11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '[{"weekday":1,"slot_no":1,"is_closed":false,"opens_at":"08:00","closes_at":"17:00"}]'::jsonb,
        'ops-admin'
      )
    `);

    await assert.rejects(
      db.query(`
        SELECT public.replace_garage_branch_hours(
          '11111111-1111-1111-1111-111111111111',
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          '[{"weekday":2,"slot_no":1,"is_closed":false,"opens_at":"18:00","closes_at":"08:00"}]'::jsonb,
          'ops-admin'
        )
      `),
      /garage_branch_hours_shape|violates check constraint/i,
    );

    const { rows } = await db.query(`
      SELECT weekday, slot_no, is_closed, opens_at::text AS opens_at, closes_at::text AS closes_at
      FROM garage_branch_hours
      WHERE branch_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    `);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].weekday, 1);
    assert.equal(rows[0].slot_no, 1);
    assert.equal(rows[0].is_closed, false);
    assert.match(rows[0].opens_at, /^08:00/);
    assert.match(rows[0].closes_at, /^17:00/);
  } finally { await db.close(); }
});

test('OPS01 membership removal closes live site placement, preserves assignment history, and refuses a current branch manager', async () => {
  const db = await database();
  try {
    await seedPeopleAndGarage(db);
    await db.exec(`
      INSERT INTO garage_branches (id, tenant_id, name, code, manager_user_id)
      VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','CBD Workshop','CBD','ops-admin');

      INSERT INTO garage_staff_branch_assignments
        (id, tenant_id, user_id, branch_id, is_primary, assigned_by_user_id)
      VALUES
        ('dddddddd-dddd-dddd-dddd-dddddddddddd',
         '11111111-1111-1111-1111-111111111111',
         'ops-mech',
         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
         true,
         'ops-admin');
    `);

    const removed = await db.query(`
      SELECT public.remove_garage_member_ops01(
        '11111111-1111-1111-1111-111111111111',
        'ops-mech',
        'ops-admin'
      ) AS result
    `);
    assert.equal(removed.rows[0].result.user_id, 'ops-mech');

    const member = await db.query(`
      SELECT count(*)::int AS count FROM tenant_users
      WHERE tenant_id='11111111-1111-1111-1111-111111111111' AND user_id='ops-mech'
    `);
    assert.equal(member.rows[0].count, 0);

    const assignment = await db.query(`
      SELECT user_id, ended_at IS NOT NULL AS ended, end_reason
      FROM garage_staff_branch_assignments
      WHERE id='dddddddd-dddd-dddd-dddd-dddddddddddd'
    `);
    assert.deepEqual(assignment.rows, [{ user_id: 'ops-mech', ended: true, end_reason: 'membership_removed' }]);

    await assert.rejects(
      db.exec(`DELETE FROM garage_staff_branch_assignments WHERE id='dddddddd-dddd-dddd-dddd-dddddddddddd'`),
      /GARAGE_STAFF_ASSIGNMENT_HISTORY_DELETE_FORBIDDEN/,
    );

    await assert.rejects(
      db.query(`
        SELECT public.remove_garage_member_ops01(
          '11111111-1111-1111-1111-111111111111',
          'ops-admin',
          'ops-admin-2'
        )
      `),
      /GARAGE_MEMBERSHIP_BRANCH_MANAGER/,
    );
    const managerStillMember = await db.query(`
      SELECT count(*)::int AS count FROM tenant_users
      WHERE tenant_id='11111111-1111-1111-1111-111111111111' AND user_id='ops-admin'
    `);
    assert.equal(managerStillMember.rows[0].count, 1);
  } finally { await db.close(); }
});

test('OPS01 source keeps profiles and branch placement as metadata, not authorization inputs', () => {
  const service = readFileSync(
    fileURLToPath(new URL('../services/serviceNetwork/garageOperationsService.js', import.meta.url)),
    'utf8',
  );
  const routes = readFileSync(
    fileURLToPath(new URL('../routes/garageOperationsRoutes.js', import.meta.url)),
    'utf8',
  );
  const auth = readFileSync(
    fileURLToPath(new URL('../middleware/authMiddleware.js', import.meta.url)),
    'utf8',
  );
  const directoryRoutes = readFileSync(
    fileURLToPath(new URL('../routes/garageDirectoryRoutes.js', import.meta.url)),
    'utf8',
  );

  assert.match(routes, /authorizeSessionRole\(\)/);
  assert.match(routes, /requireActiveTenant\(\{ types: \[GARAGE_TENANT_TYPE\]/);
  assert.match(service, /requireGarageTenant/);
  assert.doesNotMatch(auth, /garage_staff_profiles|garage_staff_branch_assignments|garage_departments/);
  assert.doesNotMatch(service, /x-tenant-id|x-user-id/);
  assert.match(directoryRoutes, /createGarageBranch/);
  assert.match(directoryRoutes, /setGarageBranchActive/);
  assert.doesNotMatch(directoryRoutes, /createMyGarageBranch|deactivateMyGarageBranch/);
});
