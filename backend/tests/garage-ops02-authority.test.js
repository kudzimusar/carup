import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createGmoDatabase } from './helpers/gmoGarageWorld.js';
import { migrationUpSql, MIGRATIONS_DIR, supabaseOver } from './helpers/pgliteLedgerHarness.js';
import {
  listGarageCustomerRelationships, getGarageCustomerDetail,
  updateGarageCustomerRelationship, createGarageProspect,
} from '../services/garageOperations/garageCustomerRelationshipService.js';

let db;
let client;
const T = {};
const S = {};
const actor = (tenantId, role = 'admin', id = role === 'admin' ? 'admin-a' : 'mechanic-a') => ({
  id, role: 'owner', activeTenant: { id: tenantId, type: 'garage', role },
});

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
  const communications = readFileSync(path.join(MIGRATIONS_DIR, '20260623143000_omnichannel_communication_engine.sql'), 'utf8');
  const start = communications.indexOf('CREATE TABLE IF NOT EXISTS channel_identities (');
  const end = communications.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_identities_unique', start);
  await db.exec(communications.slice(start, end));
  await db.exec(migrationUpSql('20261023111516_garage_ops02_customer_vehicle_relationship.sql'));
  for (const id of ['admin-a', 'mechanic-a', 'admin-b', 'customer-a', 'customer-b']) {
    await db.query("INSERT INTO users (id,name,email,role,join_date) VALUES ($1,$1,$2,'owner','2026-01-01')", [id, `${id}@example.invalid`]);
  }
  T.a = (await db.query("INSERT INTO tenants (name,type,status) VALUES ('Garage A','garage','active') RETURNING id")).rows[0].id;
  T.b = (await db.query("INSERT INTO tenants (name,type,status) VALUES ('Garage B','garage','active') RETURNING id")).rows[0].id;
  for (const [tenantId, id, role] of [[T.a, 'admin-a', 'admin'], [T.a, 'mechanic-a', 'mechanic'], [T.b, 'admin-b', 'admin']]) {
    await db.query('INSERT INTO tenant_users (tenant_id,user_id,role) VALUES ($1,$2,$3)', [tenantId, id, role]);
  }
  S.a = (await db.query("INSERT INTO garage_branches (tenant_id,name,branch_code) VALUES ($1,'Central A','CENTRAL-A') RETURNING id", [T.a])).rows[0].id;
  S.b = (await db.query("INSERT INTO garage_branches (tenant_id,name,branch_code) VALUES ($1,'Central B','CENTRAL-B') RETURNING id", [T.b])).rows[0].id;
  await db.query("INSERT INTO garage_workforce_profiles (tenant_id,user_id,staff_code,employment_classification,employment_status,start_date,created_by_user_id) VALUES ($1,'admin-a','ADMIN-A','owner','active','2026-10-01','admin-a')", [T.a]);
  await db.query("INSERT INTO garage_workforce_profiles (tenant_id,user_id,staff_code,employment_classification,employment_status,start_date,created_by_user_id) VALUES ($1,'admin-b','ADMIN-B','owner','active','2026-10-01','admin-b')", [T.b]);
  await db.query("INSERT INTO vehicles (vin,make,model,year,mileage,price,owner_id) VALUES ('OPS02VIN000000001','Toyota','Corolla',2019,50000,1000,'customer-b')");
  await db.query("INSERT INTO vehicles (vin,make,model,year,mileage,price,owner_id) VALUES ('OPS02VIN000000002','Honda','Fit',2020,30000,2000,'customer-a')");
  const aCase1 = (await db.query("INSERT INTO service_cases (vin,garage_tenant_id,requester_user_id,branch_id,status,service_category) VALUES ('OPS02VIN000000001',$1,'customer-a',$2,'completed','brakes') RETURNING id", [T.a, S.a])).rows[0].id;
  await db.query("INSERT INTO service_cases (vin,garage_tenant_id,requester_user_id,branch_id,status) VALUES ('OPS02VIN000000002',$1,'customer-a',$2,'active')", [T.a, S.a]);
  await db.query("INSERT INTO service_cases (vin,garage_tenant_id,requester_user_id,branch_id,status) VALUES ('OPS02VIN000000001',$1,'customer-b',$2,'requested')", [T.b, S.b]);
  const work = (await db.query("INSERT INTO mechanic_work_orders (tenant_id,vin,customer_id,service_case_id) VALUES ($1,'OPS02VIN000000001','customer-a',$2) RETURNING id", [T.a, aCase1])).rows[0].id;
  await db.query("INSERT INTO service_records (tenant_id,vin,work_order_id,service_case_id,total_cost,currency,recorded_by_user_id) VALUES ($1,'OPS02VIN000000001',$2,$3,150,'USD','admin-a')", [T.a, work, aCase1]);
  await db.query("INSERT INTO service_records (tenant_id,vin,work_order_id,service_case_id,total_cost,currency,recorded_by_user_id) VALUES ($1,'OPS02VIN000000001',$2,$3,900,'ZAR','admin-a')", [T.a, work, aCase1]);
  client = supabaseOver(db);
});
after(async () => { await db?.close(); });

test('registered customers are derived from real same-Garage cases and costs stay per currency', async () => {
  const result = await listGarageCustomerRelationships(client, actor(T.a));
  assert.equal(result.customers.length, 1);
  assert.equal(result.customers[0].user_id, 'customer-a');
  assert.equal(result.customers[0].vehicle_count, 2);
  assert.deepEqual(result.customers[0].spend_by_currency, { USD: 150, ZAR: 900 });
  assert.match(result.customers[0].relationship.customer_reference_code, /^CUS-/);
  await assert.rejects(() => getGarageCustomerDetail(client, actor(T.a), 'registered:customer-b'), /Customer not found/);
  await assert.rejects(() => listGarageCustomerRelationships(client, { id: 'admin-a' }), /Select the garage/);
  const failedIdentityRead = {
    ...client,
    from(table) {
      if (table === 'users') return { select: () => ({ in: async () => ({ data: null, error: { message: 'offline' } }) }) };
      return client.from(table);
    },
  };
  await assert.rejects(() => listGarageCustomerRelationships(failedIdentityRead, actor(T.a)), /Failed to load customer identities/);
});

test('detail uses canonical vehicles, Service Cases and existing work orders without claiming requester ownership', async () => {
  const result = await getGarageCustomerDetail(client, actor(T.a), 'registered:customer-a');
  assert.equal(result.vehicles.length, 2);
  assert.equal(result.cases.length, 2);
  assert.equal(result.work_orders.length, 1);
  assert.equal(result.service_records.length, 2);
  const first = result.vehicles.find((v) => v.vin === 'OPS02VIN000000001');
  assert.equal(first.relationship_basis, 'service_requester');
  assert.equal(first.canonical_owner_recorded, true);
  assert.equal(first.canonical_owner_is_customer, false);
});

test('admin metadata mutation rejects tenant spoofing, cross-Garage site and staff, and records redacted audit', async () => {
  await assert.rejects(() => updateGarageCustomerRelationship(client, actor(T.a), 'registered:customer-a', { tenant_id: T.b }), /cannot be changed/);
  await assert.rejects(() => updateGarageCustomerRelationship(client, actor(T.a), 'registered:customer-a', { preferred_branch_id: S.b }), /Preferred site must be active in this Garage/);
  await assert.rejects(() => updateGarageCustomerRelationship(client, actor(T.a), 'registered:customer-a', { assigned_staff_user_id: 'admin-b' }), /Service advisor must be active in this Garage/);
  const saved = await updateGarageCustomerRelationship(client, actor(T.a), 'registered:customer-a', {
    preferred_branch_id: S.a, assigned_staff_user_id: 'admin-a', internal_notes: 'private appointment context',
    follow_up_at: '2026-11-03T00:00:00Z', follow_up_status: 'pending',
  });
  assert.match(saved.relationship.customer_reference_code, /^CUS-/);
  const { rows: audit } = await db.query("SELECT event_type,new_value::text AS payload,actor_tenant_id FROM trust_audit_events WHERE event_type='GARAGE_CUSTOMER_FOLLOW_UP_CHANGED' AND actor_tenant_id=$1", [T.a]);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actor_tenant_id, T.a);
  assert.match(audit[0].payload, /notes_changed.*true/);
  assert.doesNotMatch(audit[0].payload, /private appointment context/);
  const mechanicView = await getGarageCustomerDetail(client, actor(T.a, 'mechanic', 'mechanic-a'), 'registered:customer-a');
  assert.equal(mechanicView.customer.relationship.internal_notes, null);
  assert.equal(mechanicView.customer.relationship.notes_available, false);
  await assert.rejects(() => updateGarageCustomerRelationship(client, actor(T.a, 'mechanic', 'mechanic-a'), 'registered:customer-a', { relationship_status: 'inactive' }), /role in this garage/);
});

test('follow-up lifecycle and walk-in prospect remain Garage-local and do not create a user', async () => {
  await assert.rejects(() => updateGarageCustomerRelationship(client, actor(T.a), 'registered:customer-a', { follow_up_at: null }), /date and status/);
  await updateGarageCustomerRelationship(client, actor(T.a), 'registered:customer-a', { follow_up_status: 'completed' });
  await assert.rejects(() => createGarageProspect(client, actor(T.a), { origin: 'walk_in', display_name: 'Walk-in', walk_in_confirmed: 'yes' }), /Confirm a real walk-in/);
  const result = await createGarageProspect(client, actor(T.a), { origin: 'walk_in', display_name: 'Walk-in A', walk_in_confirmed: true });
  assert.equal(result.party_kind, 'walk_in');
  const prospect = await getGarageCustomerDetail(client, actor(T.a), result.customer_id);
  assert.equal(prospect.customer.identity_status, 'Garage prospect; CarUp identity not verified');
  assert.deepEqual(prospect.vehicles, []);
  assert.deepEqual(prospect.cases, []);
  assert.equal((await db.query("SELECT count(*)::int AS count FROM users WHERE name='Walk-in A'")).rows[0].count, 0);
  await assert.rejects(() => updateGarageCustomerRelationship(client, actor(T.a), result.customer_id, { relationship_status: 'active' }), /unlinked prospect/);
});

test('an existing Communications external identity can be linked only inside its Garage without exposing contact values', async () => {
  const identity = (await db.query("INSERT INTO channel_identities (tenant_id,channel,external_id,normalized_address,display_name) VALUES ($1,'email','external-a','private@example.invalid','External prospect') RETURNING id", [T.a])).rows[0].id;
  await assert.rejects(() => createGarageProspect(client, actor(T.b, 'admin', 'admin-b'), {
    origin: 'communications', external_identity_id: identity,
  }), /must belong to this Garage/);
  const created = await createGarageProspect(client, actor(T.a), { origin: 'communications', external_identity_id: identity });
  assert.equal(created.party_kind, 'external');
  const listed = await listGarageCustomerRelationships(client, actor(T.a));
  assert.equal(listed.prospects.some((p) => p.customer_id === created.customer_id), true);
  assert.doesNotMatch(JSON.stringify(listed), /private@example.invalid/);
});

test('another Garage cannot read or mutate a prospect, its notes or follow-up by guessing its ID', async () => {
  const b = actor(T.b, 'admin', 'admin-b');
  const created = await createGarageProspect(client, b, {
    origin: 'walk_in', display_name: 'Garage B walk-in', walk_in_confirmed: true,
  });
  await updateGarageCustomerRelationship(client, b, created.customer_id, {
    internal_notes: 'Garage B private context',
    follow_up_at: '2026-11-05T00:00:00Z', follow_up_status: 'pending',
  });
  await assert.rejects(() => getGarageCustomerDetail(client, actor(T.a), created.customer_id), /Customer not found/);
  await assert.rejects(() => updateGarageCustomerRelationship(client, actor(T.a), created.customer_id, {
    internal_notes: 'unauthorized edit',
  }), /Customer not found/);
  const aList = await listGarageCustomerRelationships(client, actor(T.a));
  assert.doesNotMatch(JSON.stringify(aList), /Garage B walk-in|Garage B private context/);
});

test('CRM mutation cannot accept canonical vehicle, seller, publication, Trust or evidence authority fields', async () => {
  const forbidden = [
    { vin: 'OPS02VIN000000002' }, { owner_id: 'customer-a' }, { seller_id: 'admin-a' },
    { publication_status: 'published' }, { trust_score: 100 }, { evidence_status: 'verified' },
  ];
  for (const body of forbidden) {
    await assert.rejects(() => updateGarageCustomerRelationship(client, actor(T.a), 'registered:customer-a', body), /cannot be changed here/);
  }
  const { rows: [vehicle] } = await db.query("SELECT owner_id FROM vehicles WHERE vin='OPS02VIN000000001'");
  assert.equal(vehicle.owner_id, 'customer-b');
});
