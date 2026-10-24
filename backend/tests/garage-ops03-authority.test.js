
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createGmoDatabase } from './helpers/gmoGarageWorld.js';
import { migrationUpSql, supabaseOver } from './helpers/pgliteLedgerHarness.js';
import {
  addWorkforceRecurringSchedule,
  addWorkforceUnavailability,
  getGarageSchedule,
  getGarageSchedulingConfiguration,
  getRequesterAppointmentAvailability,
  requestAppointment,
  transitionGarageAppointment,
  cancelRequesterAppointment,
  updateBranchSchedulingSettings,
} from '../services/garageOperations/garageSchedulingService.js';

let db;
let client;
const T = {};
const B = {};
const P = {};
const C = {};
const actor = (id, tenantId, tenantRole = 'admin') => ({
  id,
  role: 'owner',
  activeTenant: { id: tenantId, type: 'garage', role: tenantRole },
});
const requester = (id) => ({ id, role: 'owner', activeTenant: null });

before(async () => {
  db = await createGmoDatabase();
  for (const file of [
    '20261004180000_service_network_s1_garage_identity.sql',
    '20261004180100_service_network_s2_service_cases.sql',
    '009_phase4_schema.sql',
    '20261004180300_service_network_s4_work_order_assignment.sql',
    '20261004180400_service_network_s5_service_records.sql',
    '20261022130000_garage_ops01_multisite_workforce.sql',
    '20261023140000_garage_ops03_appointments_scheduling_capacity.sql',
  ]) await db.exec(migrationUpSql(file));

  for (const id of ['admin-a','admin-b','mech-a','customer-a','customer-b']) {
    await db.query(
      "INSERT INTO users (id,name,email,role,join_date) VALUES ($1,$1,$2,'owner','2026-01-01')",
      [id,id + '@example.invalid'],
    );
  }
  T.a = (await db.query("INSERT INTO tenants (name,type,status) VALUES ('Garage A','garage','active') RETURNING id")).rows[0].id;
  T.b = (await db.query("INSERT INTO tenants (name,type,status) VALUES ('Garage B','garage','active') RETURNING id")).rows[0].id;
  for (const row of [[T.a,'admin-a','admin'],[T.a,'mech-a','admin'],[T.b,'admin-b','admin']]) {
    await db.query('INSERT INTO tenant_users (tenant_id,user_id,role) VALUES ($1,$2,$3)', row);
  }
  B.a = (await db.query(
    "INSERT INTO garage_branches (tenant_id,name,branch_code,timezone,is_active) VALUES ($1,'Central A','A-1','Africa/Harare',true) RETURNING id",
    [T.a],
  )).rows[0].id;
  B.b = (await db.query(
    "INSERT INTO garage_branches (tenant_id,name,branch_code,timezone,is_active) VALUES ($1,'Central B','B-1','Africa/Harare',true) RETURNING id",
    [T.b],
  )).rows[0].id;
  await db.query(
    "INSERT INTO garage_branch_opening_hours (tenant_id,branch_id,day_of_week,is_closed,opens_at,closes_at) VALUES ($1,$2,1,false,'08:00','17:00')",
    [T.a,B.a],
  );
  P.a = (await db.query(
    "INSERT INTO garage_workforce_profiles (tenant_id,user_id,staff_code,employment_classification,employment_status,start_date,created_by_user_id) VALUES ($1,'mech-a','M-A','employee','active','2026-10-01','admin-a') RETURNING id",
    [T.a],
  )).rows[0].id;
  await db.query(
    'INSERT INTO garage_workforce_branch_assignments (tenant_id,workforce_profile_id,branch_id,is_primary,assigned_by_user_id) VALUES ($1,$2,$3,true,$4)',
    [T.a,P.a,B.a,'admin-a'],
  );
  await db.query("UPDATE tenant_users SET role='mechanic' WHERE tenant_id=$1 AND user_id='mech-a'", [T.a]);

  await db.query(
    "INSERT INTO vehicles (vin,make,model,year,mileage,price,owner_id) VALUES ('OPS03AUTHVIN00001','Toyota','Corolla',2020,50000,1000,'customer-a')",
  );
  C.a = (await db.query(
    "INSERT INTO service_cases (vin,garage_tenant_id,branch_id,requester_user_id,status) VALUES ('OPS03AUTHVIN00001',$1,$2,'customer-a','accepted') RETURNING id",
    [T.a,B.a],
  )).rows[0].id;
  C.other = (await db.query(
    "INSERT INTO service_cases (vin,garage_tenant_id,branch_id,requester_user_id,status) VALUES ('OPS03AUTHVIN00001',$1,$2,'customer-b','accepted') RETURNING id",
    [T.a,B.a],
  )).rows[0].id;
  client = supabaseOver(db);
});
after(async () => { await db?.close(); });

test('requester availability derives Garage and Service Case authority and refuses another requester', async () => {
  const notConfigured = await getRequesterAppointmentAvailability(client, requester('customer-a'), C.a, {
    branch_id: B.a, date: '2026-10-26', duration_minutes: 60, tenant_id: T.b,
  });
  assert.equal(notConfigured.configured, false);
  assert.equal(notConfigured.reason, 'Scheduling not configured');
  assert.equal(notConfigured.branch.id, B.a);

  await assert.rejects(
    () => getRequesterAppointmentAvailability(client, requester('customer-b'), C.a, {
      branch_id: B.a, date: '2026-10-26', duration_minutes: 60,
    }),
    /Service case not found/,
  );
});

test('Garage configuration is selected-tenant admin authority and mechanic mutation is refused', async () => {
  await assert.rejects(
    () => getGarageSchedulingConfiguration(client, actor('mech-a',T.a,'mechanic')),
    /role in this garage/i,
  );
  await assert.rejects(
    () => updateBranchSchedulingSettings(client, actor('mech-a',T.a,'mechanic'), B.a, {
      scheduling_enabled: true, max_concurrent_appointments: 2, slot_interval_minutes: 30,
    }),
    /role in this garage/i,
  );

  const saved = await updateBranchSchedulingSettings(client, actor('admin-a',T.a), B.a, {
    scheduling_enabled: true,
    max_concurrent_appointments: 2,
    slot_interval_minutes: 30,
    tenant_id: T.b,
  });
  assert.equal(saved.settings.tenant_id, T.a);
  assert.equal(saved.settings.max_concurrent_appointments, 2);
  const audits = (await db.query(
    "SELECT actor_user_id,actor_role,actor_tenant_id,actor_type,source_route,previous_value,new_value FROM trust_audit_events WHERE event_type='GARAGE_BRANCH_SCHEDULING_UPDATED'"
  )).rows;
  assert.equal(audits.length, 1, 'one service mutation writes one authoritative audit');
  assert.equal(audits[0].actor_user_id, 'admin-a');
  assert.equal(audits[0].actor_role, 'owner');
  assert.equal(audits[0].actor_tenant_id, T.a);
  assert.equal(audits[0].actor_type, 'user');
  assert.equal(audits[0].source_route, '/api/garage/schedule/sites/:siteId/settings');
  assert.equal(audits[0].new_value.max_concurrent_appointments, 2);
});

test('workforce schedule uses canonical active profile and live same-site assignment', async () => {
  const saved = await addWorkforceRecurringSchedule(client, actor('admin-a',T.a), 'mech-a', {
    branch_id: B.a, day_of_week: 1, starts_at: '08:00', ends_at: '17:00',
    effective_from: '2026-10-01', tenant_id: T.b,
  });
  assert.equal(saved.schedule.tenant_id, T.a);
  assert.equal(saved.schedule.workforce_profile_id, P.a);
  const audits = (await db.query(
    "SELECT actor_user_id,actor_role,actor_tenant_id,actor_type,source_route,new_value FROM trust_audit_events WHERE event_type='GARAGE_WORKFORCE_SCHEDULE_UPDATED'"
  )).rows;
  assert.equal(audits.length, 1, 'one recurring-schedule mutation writes one authoritative audit');
  assert.equal(audits[0].actor_user_id, 'admin-a');
  assert.equal(audits[0].actor_role, 'owner');
  assert.equal(audits[0].actor_tenant_id, T.a);
  assert.equal(audits[0].source_route, '/api/garage/schedule/workforce/:userId/recurring');

  await assert.rejects(
    () => addWorkforceRecurringSchedule(client, actor('admin-a',T.a), 'mech-a', {
      branch_id: B.b, day_of_week: 1, starts_at: '08:00', ends_at: '17:00', effective_from: '2026-10-01',
    }),
    /not active|site assignment|Garage site/i,
  );
});

test('workforce unavailability uses transaction-coupled audit authority exactly once', async () => {
  const saved = await addWorkforceUnavailability(client, actor('admin-a',T.a), 'mech-a', {
    starts_at: '2026-10-27T08:00:00Z',
    ends_at: '2026-10-27T09:00:00Z',
    reason_code: 'training',
    tenant_id: T.b,
  });
  assert.equal(saved.unavailability.tenant_id, T.a);
  assert.equal(saved.unavailability.workforce_profile_id, P.a);
  const audits = (await db.query(
    "SELECT actor_user_id,actor_role,actor_tenant_id,actor_type,source_route,new_value FROM trust_audit_events WHERE event_type='GARAGE_WORKFORCE_UNAVAILABILITY_CHANGED'"
  )).rows;
  assert.equal(audits.length, 1, 'one unavailability mutation writes one authoritative audit');
  assert.equal(audits[0].actor_user_id, 'admin-a');
  assert.equal(audits[0].actor_role, 'owner');
  assert.equal(audits[0].actor_tenant_id, T.a);
  assert.equal(audits[0].source_route, '/api/garage/schedule/workforce/:userId/unavailability');
  assert.equal(audits[0].new_value.reason_code, 'training');
});

test('request body tenant spoofing cannot redirect appointment authority', async () => {
  const result = await requestAppointment(client, requester('customer-a'), C.a, {
    branch_id: B.a,
    starts_at: '2026-10-26T08:00:00Z',
    ends_at: '2026-10-26T09:00:00Z',
    tenant_id: T.b,
  });
  const { rows: [stored] } = await db.query(
    'SELECT tenant_id,service_case_id,status,planned_workforce_profile_id FROM garage_appointments WHERE id=$1',
    [result.appointment.id],
  );
  assert.equal(stored.tenant_id, T.a);
  assert.equal(stored.service_case_id, C.a);
  assert.equal(stored.status, 'requested');
  assert.equal(stored.planned_workforce_profile_id, null);
  C.appointment = result.appointment.id;
  await assert.rejects(
    () => cancelRequesterAppointment(client, requester('customer-b'), C.a, result.appointment.id),
    /Service case not found/,
  );
});

test('mechanic schedule read is narrowed to planned-for-me and cannot expose Garage-wide appointments', async () => {
  await db.query(
    "UPDATE garage_appointments SET status='confirmed', planned_workforce_profile_id=$1, confirmed_by_user_id='admin-a', confirmed_at=NOW() WHERE service_case_id=$2",
    [P.a,C.a],
  );
  const mechanic = await getGarageSchedule(client, actor('mech-a',T.a,'mechanic'));
  assert.equal(mechanic.scope, 'planned_for_me');
  assert.equal(mechanic.appointments.length, 1);
  assert.equal(mechanic.appointments[0].planned_workforce.profile_id, P.a);
  assert.deepEqual(mechanic.unscheduled_cases, []);

  const bView = await getGarageSchedule(client, actor('admin-b',T.b,'admin'));
  assert.equal(bView.appointments.length, 0);
  await assert.rejects(
    () => transitionGarageAppointment(client, actor('admin-b',T.b,'admin'), C.appointment, 'cancelled'),
    /Could not change appointment status/,
    'Garage B cannot mutate Garage A appointment by guessing its id',
  );
});

test('requester can cancel only their own live appointment without changing the Service Case', async () => {
  const caseId = (await db.query(
    "INSERT INTO service_cases (vin,garage_tenant_id,branch_id,requester_user_id,status) VALUES ('OPS03AUTHVIN00001',$1,$2,'customer-a','accepted') RETURNING id",
    [T.a,B.a],
  )).rows[0].id;
  const requested = await requestAppointment(client, requester('customer-a'), caseId, {
    branch_id: B.a,
    starts_at: '2026-10-26T10:00:00Z',
    ends_at: '2026-10-26T11:00:00Z',
  });
  const cancelled = await cancelRequesterAppointment(client, requester('customer-a'), caseId, requested.appointment.id);
  assert.equal(cancelled.appointment.status, 'cancelled');
  assert.equal((await db.query('SELECT status FROM service_cases WHERE id=$1',[caseId])).rows[0].status, 'accepted');
});

test('planning writes no work order or work-order assignment side effects', async () => {
  assert.equal((await db.query('SELECT count(*)::int n FROM mechanic_work_orders')).rows[0].n, 0);
  assert.equal((await db.query('SELECT count(*)::int n FROM work_order_assignments')).rows[0].n, 0);
});
