import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createGmoDatabase } from './gmoGarageWorld.js';
import { migrationUpSql, MIGRATIONS_DIR } from './pgliteLedgerHarness.js';

/**
 * GARAGE-1.0 FINAL — the hermetic PostgreSQL world every Garage business-OS migration test shares.
 *
 * It applies the repository's OWN migration Up SQL, in dependency order, onto PGlite, then seeds two
 * Garages (A and B), their staff, two customers who each own a vehicle, and one accepted Service Case
 * per Garage. Nothing is mocked: the canonical OC-5A decide function, the service-record tables and
 * the OPS01-03 foundations are the real ones.
 */
export const FOUNDATION_MIGRATIONS = Object.freeze([
  '20261004180000_service_network_s1_garage_identity.sql',
  '20261004180100_service_network_s2_service_cases.sql',
  '009_phase4_schema.sql',
  '20261004160100_oc5a_work_order_owner_authorization.sql',
  '20261004180300_service_network_s4_work_order_assignment.sql',
  '20261004180400_service_network_s5_service_records.sql',
  '20261022130000_garage_ops01_multisite_workforce.sql',
  '20261023111516_garage_ops02_customer_vehicle_relationship.sql',
  '20261023140000_garage_ops03_appointments_scheduling_capacity.sql',
]);

export async function applyFoundation(db) {
  for (const file of FOUNDATION_MIGRATIONS) await db.exec(migrationUpSql(file));
}

export async function applyMigrations(db, files) {
  for (const file of files) await db.exec(migrationUpSql(file));
}

function installCommunicationIdentities(db) {
  // OPS03's world needs the channel_identities table that the omnichannel engine owns.
  const communications = readFileSync(
    path.join(MIGRATIONS_DIR, '20260623143000_omnichannel_communication_engine.sql'), 'utf8',
  );
  const start = communications.indexOf('CREATE TABLE IF NOT EXISTS channel_identities (');
  const end = communications.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_identities_unique', start);
  if (start < 0 || end <= start) throw new Error('channel_identities block not found');
  return db.exec(communications.slice(start, end));
}

/**
 * @param {object} [options]
 * @param {string[]} [options.after] migrations to apply after the foundation (the phase under test)
 * @param {boolean} [options.seed] seed the two-garage world (default true)
 */
export async function createGarageFinalWorld({ after = [], seed = true } = {}) {
  const db = await createGmoDatabase();
  const world = { db, T: {}, B: {}, C: {}, W: {}, V: {} };

  for (const file of FOUNDATION_MIGRATIONS.slice(0, 7)) await db.exec(migrationUpSql(file));
  await installCommunicationIdentities(db);

  if (seed) {
    for (const id of ['admin-a', 'admin-b', 'customer-a', 'customer-b', 'stranger', 'mech-a', 'mech-b', 'mech-c']) {
      await db.query(
        "INSERT INTO users (id,name,email,role,join_date) VALUES ($1,$1,$2,'owner','2026-01-01')",
        [id, id + '@example.invalid'],
      );
    }
    world.T.a = (await db.query("INSERT INTO tenants (name,type,status) VALUES ('Garage A','garage','active') RETURNING id")).rows[0].id;
    world.T.b = (await db.query("INSERT INTO tenants (name,type,status) VALUES ('Garage B','garage','active') RETURNING id")).rows[0].id;
    for (const row of [
      [world.T.a, 'admin-a', 'admin'], [world.T.a, 'mech-a', 'admin'], [world.T.a, 'mech-b', 'admin'],
      [world.T.b, 'admin-b', 'admin'], [world.T.b, 'mech-c', 'admin'],
    ]) await db.query('INSERT INTO tenant_users (tenant_id,user_id,role) VALUES ($1,$2,$3)', row);

    world.V.a = 'FINALVIN0000000001';
    world.V.b = 'FINALVIN0000000002';
    world.V.ownerless = 'FINALVIN0000000003';
    await db.query("INSERT INTO vehicles (vin,make,model,year,mileage,price,owner_id) VALUES ($1,'Toyota','Corolla',2020,50000,1000,'customer-a')", [world.V.a]);
    await db.query("INSERT INTO vehicles (vin,make,model,year,mileage,price,owner_id) VALUES ($1,'Honda','Fit',2021,30000,1100,'customer-b')", [world.V.b]);
    await db.query("INSERT INTO vehicles (vin,make,model,year,mileage,price,owner_id) VALUES ($1,'Mazda','Demio',2019,80000,900,NULL)", [world.V.ownerless]);

    world.B.a1 = (await db.query("INSERT INTO garage_branches (tenant_id,name,branch_code,timezone,is_active) VALUES ($1,'A Central','A-CENTRAL','Africa/Harare',true) RETURNING id", [world.T.a])).rows[0].id;
    world.B.b1 = (await db.query("INSERT INTO garage_branches (tenant_id,name,branch_code,timezone,is_active) VALUES ($1,'B Central','B-CENTRAL','Africa/Harare',true) RETURNING id", [world.T.b])).rows[0].id;
    for (const [tenant, branch] of [[world.T.a, world.B.a1], [world.T.b, world.B.b1]]) {
      await db.query("INSERT INTO garage_branch_opening_hours (tenant_id,branch_id,day_of_week,is_closed,opens_at,closes_at) VALUES ($1,$2,1,false,'08:00','17:00')", [tenant, branch]);
    }
    for (const [key, tenant, user, code, actor] of [
      ['a1', world.T.a, 'mech-a', 'MECH-A', 'admin-a'],
      ['a2', world.T.a, 'mech-b', 'MECH-B', 'admin-a'],
      ['b1', world.T.b, 'mech-c', 'MECH-C', 'admin-b'],
    ]) {
      world.W[key] = (await db.query(
        "INSERT INTO garage_workforce_profiles (tenant_id,user_id,staff_code,employment_classification,employment_status,start_date,created_by_user_id) VALUES ($1,$2,$3,'employee','active','2026-10-01',$4) RETURNING id",
        [tenant, user, code, actor],
      )).rows[0].id;
      await db.query(
        'INSERT INTO garage_workforce_branch_assignments (tenant_id,workforce_profile_id,branch_id,is_primary,assigned_by_user_id) VALUES ($1,$2,$3,true,$4)',
        [tenant, world.W[key], tenant === world.T.a ? world.B.a1 : world.B.b1, actor],
      );
    }
    await db.query("UPDATE tenant_users SET role='mechanic' WHERE tenant_id=$1 AND user_id IN ('mech-a','mech-b')", [world.T.a]);
    await db.query("UPDATE tenant_users SET role='mechanic' WHERE tenant_id=$1 AND user_id='mech-c'", [world.T.b]);
  }

  for (const file of FOUNDATION_MIGRATIONS.slice(7)) await db.exec(migrationUpSql(file));
  await applyMigrations(db, after);
  return world;
}

/** An accepted Service Case + its (pending-authorization) work order for the given garage. */
export async function seedAcceptedCase(world, { garage = 'a', vin, requester } = {}) {
  const { db } = world;
  const tenant = world.T[garage];
  const branch = world.B[garage + '1'];
  const caseVin = vin || (garage === 'a' ? world.V.a : world.V.b);
  const who = requester || (garage === 'a' ? 'customer-a' : 'customer-b');
  const caseId = (await db.query(
    "INSERT INTO service_cases (vin,garage_tenant_id,branch_id,requester_user_id,status) VALUES ($1,$2,$3,$4,'accepted') RETURNING id",
    [caseVin, tenant, branch, who],
  )).rows[0].id;
  const workOrderId = (await db.query(
    "INSERT INTO mechanic_work_orders (tenant_id,vin,customer_id,service_case_id,branch_id,status,owner_authorization) VALUES ($1,$2,$3,$4,$5,'In Progress','pending') RETURNING id",
    [tenant, caseVin, who, caseId, branch],
  )).rows[0].id;
  return { caseId, workOrderId, tenant, vin: caseVin, requester: who };
}

export const oneLine = (category, description, quantity, unit_price) => ({ category, description, quantity, unit_price });
