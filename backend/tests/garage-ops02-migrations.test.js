import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createGmoDatabase } from './helpers/gmoGarageWorld.js';
import { migrationUpSql, MIGRATIONS_DIR } from './helpers/pgliteLedgerHarness.js';

const OPS02 = '20261023111516_garage_ops02_customer_vehicle_relationship.sql';
let db;
const tenant = {};
const site = {};
const profile = {};
const relation = {};
async function rejected(promise) { try { await promise; return null; } catch (error) { return error; } }

before(async () => {
  db = await createGmoDatabase();
  for (const file of [
    '20261004180000_service_network_s1_garage_identity.sql',
    '20261004180100_service_network_s2_service_cases.sql',
    '009_phase4_schema.sql',
    '20261004180300_service_network_s4_work_order_assignment.sql',
    '20261004180400_service_network_s5_service_records.sql',
    '20261022130000_garage_ops01_multisite_workforce.sql',
  ]) await db.exec(migrationUpSql(file));
  // The Communications identity table is reused verbatim; the surrounding migration also
  // creates unrelated providers, queues and threads that this focused schema test does not need.
  const communications = readFileSync(path.join(MIGRATIONS_DIR, '20260623143000_omnichannel_communication_engine.sql'), 'utf8');
  const start = communications.indexOf('CREATE TABLE IF NOT EXISTS channel_identities (');
  const end = communications.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_identities_unique', start);
  assert.ok(start >= 0 && end > start);
  await db.exec(communications.slice(start, end));
  for (const id of ['admin-a', 'admin-b', 'customer-a', 'customer-new', 'advisor-a']) {
    await db.query("INSERT INTO users (id, name, email, role, join_date) VALUES ($1,$1,$2,'owner','2026-01-01')", [id, `${id}@example.invalid`]);
  }
  tenant.a = (await db.query("INSERT INTO tenants (name,type,status) VALUES ('Garage A','garage','active') RETURNING id")).rows[0].id;
  tenant.b = (await db.query("INSERT INTO tenants (name,type,status) VALUES ('Garage B','garage','active') RETURNING id")).rows[0].id;
  for (const [t, u, role] of [[tenant.a, 'admin-a', 'admin'], [tenant.a, 'advisor-a', 'mechanic'], [tenant.b, 'admin-b', 'admin']]) {
    await db.query('INSERT INTO tenant_users (tenant_id,user_id,role) VALUES ($1,$2,$3)', [t, u, role]);
  }
  await db.query("INSERT INTO vehicles (vin,make,model,year,mileage,price,owner_id) VALUES ('OPS02VIN000000001','Toyota','Corolla',2019,50000,1000,'customer-a')");
  for (const [key, t] of [['a', tenant.a], ['b', tenant.b]]) {
    site[key] = (await db.query("INSERT INTO garage_branches (tenant_id,name,branch_code) VALUES ($1,'Central','CENTRAL-01') RETURNING id", [t])).rows[0].id;
    await db.query("INSERT INTO service_cases (vin,garage_tenant_id,requester_user_id) VALUES ('OPS02VIN000000001',$1,'customer-a')", [t]);
  }
  await db.exec(migrationUpSql(OPS02));
  await db.exec(migrationUpSql(OPS02));
  await db.query("INSERT INTO service_cases (vin,garage_tenant_id,requester_user_id) VALUES ('OPS02VIN000000001',$1,'customer-new')", [tenant.a]);
  relation.a = (await db.query("SELECT id,customer_reference_code FROM garage_customer_relationships WHERE tenant_id=$1 AND registered_user_id='customer-a'", [tenant.a])).rows[0];
  relation.b = (await db.query("SELECT id FROM garage_customer_relationships WHERE tenant_id=$1 AND registered_user_id='customer-a'", [tenant.b])).rows[0].id;
  profile.a = (await db.query("INSERT INTO garage_workforce_profiles (tenant_id,user_id,staff_code,employment_classification,employment_status,start_date,created_by_user_id) VALUES ($1,'admin-a','ADMIN-A','owner','active','2026-10-01','admin-a') RETURNING id", [tenant.a])).rows[0].id;
  profile.b = (await db.query("INSERT INTO garage_workforce_profiles (tenant_id,user_id,staff_code,employment_classification,employment_status,start_date,created_by_user_id) VALUES ($1,'admin-b','ADMIN-B','owner','active','2026-10-01','admin-b') RETURNING id", [tenant.b])).rows[0].id;
  await db.query("INSERT INTO garage_workforce_profiles (tenant_id,user_id,staff_code,employment_classification,employment_status,start_date,created_by_user_id) VALUES ($1,'advisor-a','ADVISOR-A','employee','inactive','2026-10-01','admin-a')", [tenant.a]);
});
after(async () => { await db?.close(); });

test('OPS02 migration is replay-safe and gives no direct client access', async () => {
  const { rows: [privileges] } = await db.query(`SELECT
    has_table_privilege('anon','garage_customer_relationships','SELECT') AS anon_read,
    has_table_privilege('authenticated','garage_customer_relationships','UPDATE') AS auth_write,
    has_table_privilege('service_role','garage_customer_relationships','SELECT') AS service_read,
    has_table_privilege('service_role','garage_customer_relationships','DELETE') AS service_delete`);
  assert.deepEqual(privileges, { anon_read: false, auth_write: false, service_read: true, service_delete: false });
  const { rows: [rls] } = await db.query("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='garage_customer_relationships'");
  assert.deepEqual(rls, { relrowsecurity: true, relforcerowsecurity: true });
  const { rows: [writes] } = await db.query(`SELECT
    has_table_privilege('anon','garage_customer_relationships','INSERT') AS anon_insert,
    has_table_privilege('authenticated','garage_customer_relationships','SELECT') AS auth_read,
    has_table_privilege('authenticated','garage_customer_relationships','INSERT') AS auth_insert,
    has_table_privilege('authenticated','garage_customer_relationships','DELETE') AS auth_delete`);
  assert.deepEqual(writes, { anon_insert: false, auth_read: false, auth_insert: false, auth_delete: false });
});

test('one real requester has one relationship per Garage, with a stable local reference', async () => {
  assert.match(relation.a.customer_reference_code, /^CUS-[A-F0-9]{12}$/);
  const duplicate = await rejected(db.query(`INSERT INTO garage_customer_relationships
    (tenant_id,party_kind,origin,registered_user_id,relationship_status,first_relationship_at,created_by_user_id)
    VALUES ($1,'registered','service_case','customer-a','active',now(),'admin-a')`, [tenant.a]));
  assert.equal(duplicate?.code, '23505');
  assert.ok(relation.b, 'the same requester has a separate Garage B relationship');
  const { rows: [newCaseRelationship] } = await db.query("SELECT customer_reference_code FROM garage_customer_relationships WHERE tenant_id=$1 AND registered_user_id='customer-new'", [tenant.a]);
  assert.match(newCaseRelationship.customer_reference_code, /^CUS-/);
  const { rows: [originAudit] } = await db.query("SELECT actor_type,actor_tenant_id,source_route FROM trust_audit_events WHERE event_type='GARAGE_CUSTOMER_RELATIONSHIP_CREATED' AND actor_tenant_id=$1 ORDER BY created_at LIMIT 1", [tenant.a]);
  assert.deepEqual(originAudit, { actor_type: 'system', actor_tenant_id: tenant.a, source_route: 'service_cases' });
  const changeIdentity = await rejected(db.query("UPDATE garage_customer_relationships SET registered_user_id='admin-a' WHERE id=$1", [relation.a.id]));
  assert.match(changeIdentity?.message || '', /IDENTITY_IMMUTABLE/);
});

test('a registered customer cannot be invented without a same-Garage Service Case', async () => {
  const error = await rejected(db.query(`INSERT INTO garage_customer_relationships
    (tenant_id,party_kind,origin,registered_user_id,relationship_status,first_relationship_at,created_by_user_id)
    VALUES ($1,'registered','service_case','admin-b','active',now(),'admin-a')`, [tenant.a]));
  assert.match(error?.message || '', /SERVICE_ORIGIN_REQUIRED/);
});

test('preferred site and assigned advisor are same-Garage, active facts', async () => {
  await db.query("UPDATE garage_customer_relationships SET preferred_branch_id=$1,assigned_staff_user_id=$2,updated_by_user_id='admin-a' WHERE id=$3", [site.a, 'admin-a', relation.a.id]);
  assert.match((await rejected(db.query("UPDATE garage_customer_relationships SET preferred_branch_id=$1,updated_by_user_id='admin-a' WHERE id=$2", [site.b, relation.a.id])))?.message || '', /ACTIVE_SITE_REQUIRED/);
  assert.match((await rejected(db.query("UPDATE garage_customer_relationships SET assigned_staff_user_id='admin-b',updated_by_user_id='admin-a' WHERE id=$1", [relation.a.id])))?.message || '', /ACTIVE_ADVISOR_REQUIRED/);
  assert.match((await rejected(db.query("UPDATE garage_customer_relationships SET assigned_staff_user_id='advisor-a',updated_by_user_id='admin-a' WHERE id=$1", [relation.a.id])))?.message || '', /ACTIVE_ADVISOR_REQUIRED/);
  await db.query('UPDATE garage_branches SET is_active=false WHERE id=$1', [site.a]);
  await db.query("UPDATE garage_customer_relationships SET customer_category=$1,updated_by_user_id='admin-a' WHERE id=$2", ['fleet', relation.a.id]);
  const inactiveSite = (await db.query("INSERT INTO garage_branches (tenant_id,name,branch_code,is_active) VALUES ($1,'Inactive','INACTIVE-01',false) RETURNING id", [tenant.a])).rows[0].id;
  assert.match((await rejected(db.query("UPDATE garage_customer_relationships SET preferred_branch_id=$1,updated_by_user_id='admin-a' WHERE id=$2", [inactiveSite, relation.a.id])))?.message || '', /ACTIVE_SITE_REQUIRED/);
  await db.query('UPDATE garage_branches SET is_active=true WHERE id=$1', [site.a]);
});

test('external identity and walk-in remain prospects, never users or vehicle owners', async () => {
  const ext = (await db.query("INSERT INTO channel_identities (tenant_id,channel,external_id,display_name) VALUES ($1,'email','ext-a','Walk-in email') RETURNING id", [tenant.a])).rows[0].id;
  await db.query(`INSERT INTO garage_customer_relationships
    (tenant_id,party_kind,origin,external_identity_id,relationship_status,first_relationship_at,created_by_user_id)
    VALUES ($1,'external','communications',$2,'prospect',now(),'admin-a')`, [tenant.a, ext]);
  const otherGarage = await rejected(db.query(`INSERT INTO garage_customer_relationships
    (tenant_id,party_kind,origin,external_identity_id,relationship_status,first_relationship_at,created_by_user_id)
    VALUES ($1,'external','communications',$2,'prospect',now(),'admin-b')`, [tenant.b, ext]));
  assert.match(otherGarage?.message || '', /EXTERNAL_IDENTITY_NOT_IN_GARAGE/);
  await db.query(`INSERT INTO garage_customer_relationships
    (tenant_id,party_kind,origin,prospect_name,relationship_status,first_relationship_at,created_by_user_id)
    VALUES ($1,'walk_in','walk_in','Unverified walk-in','prospect',now(),'admin-a')`, [tenant.a]);
  assert.equal((await db.query("SELECT owner_id FROM vehicles WHERE vin='OPS02VIN000000001'")).rows[0].owner_id, 'customer-a');
});

test('a failed authoritative audit rolls back a relationship update', async () => {
  await db.exec(`
    CREATE FUNCTION garage_ops02_test_fail_audit() RETURNS TRIGGER LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.event_type LIKE 'GARAGE_CUSTOMER_%' THEN RAISE EXCEPTION 'TEST_AUDIT_UNAVAILABLE'; END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER trg_garage_ops02_test_fail_audit BEFORE INSERT ON trust_audit_events
      FOR EACH ROW EXECUTE FUNCTION garage_ops02_test_fail_audit();
  `);
  try {
    const attempted = await rejected(db.query("UPDATE garage_customer_relationships SET customer_category='business',updated_by_user_id='admin-a' WHERE id=$1", [relation.a.id]));
    assert.match(attempted?.message || '', /TEST_AUDIT_UNAVAILABLE/);
    const { rows: [saved] } = await db.query('SELECT customer_category FROM garage_customer_relationships WHERE id=$1', [relation.a.id]);
    assert.equal(saved.customer_category, 'fleet');
  } finally {
    await db.exec('DROP TRIGGER trg_garage_ops02_test_fail_audit ON trust_audit_events; DROP FUNCTION garage_ops02_test_fail_audit();');
  }
});
