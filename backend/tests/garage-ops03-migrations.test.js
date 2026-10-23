
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createGmoDatabase } from './helpers/gmoGarageWorld.js';
import { migrationUpSql, MIGRATIONS_DIR } from './helpers/pgliteLedgerHarness.js';

const OPS02 = '20261023111516_garage_ops02_customer_vehicle_relationship.sql';
const OPS03 = '20261023140000_garage_ops03_appointments_scheduling_capacity.sql';
const SLOT_START = '2026-10-26T08:00:00.000Z'; // 10:00 Africa/Harare.
const SLOT_END = '2026-10-26T09:00:00.000Z';
let db;
const T = {};
const B = {};
const P = {};
const C = {};

async function rejected(promise) {
  try { await promise; return null; } catch (error) { return error; }
}
async function requestAppointment(caseId, actor, start = SLOT_START, end = SLOT_END, branch = B.a1) {
  return db.query(
    'SELECT (garage_ops03_request_appointment($1,$2,$3,$4,$5)).*',
    [caseId, branch, start, end, actor],
  );
}
async function confirmAppointment(appointmentId, workforceProfileId, start = SLOT_START, end = SLOT_END, branch = B.a1) {
  return db.query(
    'SELECT (garage_ops03_confirm_appointment($1,$2,$3,$4,$5,$6,$7)).*',
    [T.a, appointmentId, branch, start, end, workforceProfileId, 'admin-a'],
  );
}
async function appointmentId(result) { return result.rows[0].id; }

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

  const communications = readFileSync(
    path.join(MIGRATIONS_DIR, '20260623143000_omnichannel_communication_engine.sql'), 'utf8',
  );
  const channelStart = communications.indexOf('CREATE TABLE IF NOT EXISTS channel_identities (');
  const channelEnd = communications.indexOf(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_identities_unique', channelStart,
  );
  assert.ok(channelStart >= 0 && channelEnd > channelStart);
  await db.exec(communications.slice(channelStart, channelEnd));

  for (const id of ['admin-a','admin-b','customer-a','customer-b','mech-a','mech-b','mech-c']) {
    await db.query(
      "INSERT INTO users (id,name,email,role,join_date) VALUES ($1,$1,$2,'owner','2026-01-01')",
      [id, id + '@example.invalid'],
    );
  }
  T.a = (await db.query(
    "INSERT INTO tenants (name,type,status) VALUES ('Garage A','garage','active') RETURNING id",
  )).rows[0].id;
  T.b = (await db.query(
    "INSERT INTO tenants (name,type,status) VALUES ('Garage B','garage','active') RETURNING id",
  )).rows[0].id;
  for (const row of [
    [T.a,'admin-a','admin'], [T.a,'mech-a','mechanic'], [T.a,'mech-b','mechanic'],
    [T.b,'admin-b','admin'], [T.b,'mech-c','mechanic'],
  ]) await db.query('INSERT INTO tenant_users (tenant_id,user_id,role) VALUES ($1,$2,$3)', row);

  await db.query(
    "INSERT INTO vehicles (vin,make,model,year,mileage,price,owner_id) VALUES ('OPS03VIN000000001','Toyota','Corolla',2020,50000,1000,'customer-a')",
  );
  await db.query(
    "INSERT INTO vehicles (vin,make,model,year,mileage,price,owner_id) VALUES ('OPS03VIN000000002','Honda','Fit',2021,30000,1100,'customer-b')",
  );

  B.a1 = (await db.query(
    "INSERT INTO garage_branches (tenant_id,name,branch_code,timezone,is_active) VALUES ($1,'A Central','A-CENTRAL','Africa/Harare',true) RETURNING id",
    [T.a],
  )).rows[0].id;
  B.a2 = (await db.query(
    "INSERT INTO garage_branches (tenant_id,name,branch_code,timezone,is_active) VALUES ($1,'A North','A-NORTH','Africa/Harare',true) RETURNING id",
    [T.a],
  )).rows[0].id;
  B.b1 = (await db.query(
    "INSERT INTO garage_branches (tenant_id,name,branch_code,timezone,is_active) VALUES ($1,'B Central','B-CENTRAL','Africa/Harare',true) RETURNING id",
    [T.b],
  )).rows[0].id;
  for (const [tenant, branch] of [[T.a,B.a1],[T.a,B.a2],[T.b,B.b1]]) {
    await db.query(
      "INSERT INTO garage_branch_opening_hours (tenant_id,branch_id,day_of_week,is_closed,opens_at,closes_at) VALUES ($1,$2,1,false,'08:00','17:00')",
      [tenant, branch],
    );
  }

  P.a1 = (await db.query(
    "INSERT INTO garage_workforce_profiles (tenant_id,user_id,staff_code,employment_classification,employment_status,start_date,created_by_user_id) VALUES ($1,'mech-a','MECH-A','employee','active','2026-10-01','admin-a') RETURNING id",
    [T.a],
  )).rows[0].id;
  P.a2 = (await db.query(
    "INSERT INTO garage_workforce_profiles (tenant_id,user_id,staff_code,employment_classification,employment_status,start_date,created_by_user_id) VALUES ($1,'mech-b','MECH-B','employee','active','2026-10-01','admin-a') RETURNING id",
    [T.a],
  )).rows[0].id;
  P.b1 = (await db.query(
    "INSERT INTO garage_workforce_profiles (tenant_id,user_id,staff_code,employment_classification,employment_status,start_date,created_by_user_id) VALUES ($1,'mech-c','MECH-C','employee','active','2026-10-01','admin-b') RETURNING id",
    [T.b],
  )).rows[0].id;
  for (const [tenant, profile, branch, actor] of [
    [T.a,P.a1,B.a1,'admin-a'], [T.a,P.a1,B.a2,'admin-a'], [T.a,P.a2,B.a1,'admin-a'],
    [T.b,P.b1,B.b1,'admin-b'],
  ]) {
    await db.query(
      'INSERT INTO garage_workforce_branch_assignments (tenant_id,workforce_profile_id,branch_id,is_primary,assigned_by_user_id) VALUES ($1,$2,$3,$4,$5)',
      [tenant, profile, branch, branch === B.a1 || branch === B.b1, actor],
    );
  }

  C.a1 = (await db.query(
    "INSERT INTO service_cases (vin,garage_tenant_id,branch_id,requester_user_id,status) VALUES ('OPS03VIN000000001',$1,$2,'customer-a','accepted') RETURNING id",
    [T.a,B.a1],
  )).rows[0].id;
  C.a2 = (await db.query(
    "INSERT INTO service_cases (vin,garage_tenant_id,branch_id,requester_user_id,status) VALUES ('OPS03VIN000000002',$1,$2,'customer-b','accepted') RETURNING id",
    [T.a,B.a1],
  )).rows[0].id;
  C.a3 = (await db.query(
    "INSERT INTO service_cases (vin,garage_tenant_id,branch_id,requester_user_id,status) VALUES ('OPS03VIN000000001',$1,$2,'customer-a','accepted') RETURNING id",
    [T.a,B.a1],
  )).rows[0].id;
  C.a4 = (await db.query(
    "INSERT INTO service_cases (vin,garage_tenant_id,branch_id,requester_user_id,status) VALUES ('OPS03VIN000000002',$1,$2,'customer-b','accepted') RETURNING id",
    [T.a,B.a1],
  )).rows[0].id;
  C.b1 = (await db.query(
    "INSERT INTO service_cases (vin,garage_tenant_id,branch_id,requester_user_id,status) VALUES ('OPS03VIN000000001',$1,$2,'customer-a','accepted') RETURNING id",
    [T.b,B.b1],
  )).rows[0].id;

  await db.exec(migrationUpSql(OPS02));
  await db.exec(migrationUpSql(OPS03));
  await db.exec(migrationUpSql(OPS03));
});
after(async () => { await db?.close(); });

test('OPS03 migration is replay-safe, private and least-privilege', async () => {
  for (const table of [
    'garage_branch_scheduling_settings','garage_workforce_schedules',
    'garage_workforce_unavailability','garage_appointments','garage_appointment_events',
  ]) {
    const { rows: [rls] } = await db.query(
      "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=$1", [table],
    );
    assert.deepEqual(rls, { relrowsecurity: true, relforcerowsecurity: true });
    const { rows: [p] } = await db.query(
      "SELECT has_table_privilege('anon',$1,'SELECT') anon_read, has_table_privilege('authenticated',$1,'SELECT') auth_read, has_table_privilege('service_role',$1,'SELECT') service_read, has_table_privilege('service_role',$1,'DELETE') service_delete",
      [table],
    );
    assert.equal(p.anon_read, false);
    assert.equal(p.auth_read, false);
    assert.equal(p.service_read, true);
    assert.equal(p.service_delete, false);
  }
  const { rows: [rpc] } = await db.query(
    "SELECT has_function_privilege('anon','garage_ops03_confirm_appointment(uuid,uuid,uuid,timestamptz,timestamptz,uuid,text)','EXECUTE') anon, has_function_privilege('authenticated','garage_ops03_confirm_appointment(uuid,uuid,uuid,timestamptz,timestamptz,uuid,text)','EXECUTE') auth, has_function_privilege('service_role','garage_ops03_confirm_appointment(uuid,uuid,uuid,timestamptz,timestamptz,uuid,text)','EXECUTE') service",
  );
  assert.deepEqual(rpc, { anon: false, auth: false, service: true });
});

test('unconfigured capacity and unscheduled workforce remain unavailable rather than fabricated', async () => {
  let error = await rejected(db.query(
    'SELECT * FROM garage_ops03_list_availability($1,$2,$3,$4,$5)',
    [T.a,C.a1,B.a1,'2026-10-26',60],
  ));
  assert.match(error?.message || '', /SCHEDULING_NOT_CONFIGURED/);

  await db.query(
    'INSERT INTO garage_branch_scheduling_settings (branch_id,tenant_id,scheduling_enabled,max_concurrent_appointments,slot_interval_minutes,updated_by_user_id) VALUES ($1,$2,true,1,30,$3)',
    [B.a1,T.a,'admin-a'],
  );
  const noSchedule = await db.query(
    'SELECT * FROM garage_ops03_evaluate_interval($1,$2,$3,$4,NULL)',
    [T.a,B.a1,SLOT_START,SLOT_END],
  );
  assert.equal(noSchedule.rows[0].available_count, 0, 'a branch assignment alone contributes zero known capacity');

  for (const profile of [P.a1,P.a2]) {
    await db.query(
      "INSERT INTO garage_workforce_schedules (tenant_id,workforce_profile_id,branch_id,day_of_week,starts_at,ends_at,effective_from,created_by_user_id) VALUES ($1,$2,$3,1,'08:00','17:00','2026-10-01','admin-a')",
      [T.a,profile,B.a1],
    );
  }
  const configured = await db.query(
    'SELECT * FROM garage_ops03_evaluate_interval($1,$2,$3,$4,NULL)',
    [T.a,B.a1,SLOT_START,SLOT_END],
  );
  assert.equal(configured.rows[0].max_concurrent_appointments, 1);
  assert.equal(configured.rows[0].available_count, 1, 'explicit branch capacity limits otherwise-eligible staff');
});

test('work schedules require same-Garage active workforce, active site and live branch relationship', async () => {
  const foreign = await rejected(db.query(
    "INSERT INTO garage_workforce_schedules (tenant_id,workforce_profile_id,branch_id,day_of_week,starts_at,ends_at,effective_from,created_by_user_id) VALUES ($1,$2,$3,1,'08:00','17:00','2026-10-01','admin-a')",
    [T.a,P.b1,B.a1],
  ));
  assert.match(foreign?.message || '', /WORKFORCE_SCHEDULE_AUTHORITY_INVALID/);

  const wrongSite = await rejected(db.query(
    "INSERT INTO garage_workforce_schedules (tenant_id,workforce_profile_id,branch_id,day_of_week,starts_at,ends_at,effective_from,created_by_user_id) VALUES ($1,$2,$3,1,'08:00','17:00','2026-10-01','admin-a')",
    [T.a,P.a2,B.a2],
  ));
  assert.match(wrongSite?.message || '', /WORKFORCE_SCHEDULE_AUTHORITY_INVALID/);
});

test('timezone, opening hours and slot precision are enforced from recorded site truth', async () => {
  const outside = await rejected(db.query(
    'SELECT * FROM garage_ops03_evaluate_interval($1,$2,$3,$4,NULL)',
    [T.a,B.a1,'2026-10-26T05:00:00Z','2026-10-26T06:00:00Z'],
  ));
  assert.match(outside?.message || '', /OUTSIDE_OPENING_HOURS/);
  const misaligned = await rejected(db.query(
    'SELECT * FROM garage_ops03_evaluate_interval($1,$2,$3,$4,NULL)',
    [T.a,B.a1,'2026-10-26T08:10:00Z','2026-10-26T09:10:00Z'],
  ));
  assert.match(misaligned?.message || '', /SLOT_INTERVAL_MISMATCH/);

  await db.query('UPDATE garage_branches SET timezone=NULL WHERE id=$1', [B.a2]);
  await db.query(
    'INSERT INTO garage_branch_scheduling_settings (branch_id,tenant_id,scheduling_enabled,max_concurrent_appointments,slot_interval_minutes,updated_by_user_id) VALUES ($1,$2,true,1,30,$3)',
    [B.a2,T.a,'admin-a'],
  );
  const missingTz = await rejected(db.query(
    'SELECT * FROM garage_ops03_evaluate_interval($1,$2,$3,$4,NULL)',
    [T.a,B.a2,SLOT_START,SLOT_END],
  ));
  assert.match(missingTz?.message || '', /SCHEDULE_TIMEZONE_NOT_CONFIGURED/);
});

test('unavailability removes only explicitly affected workforce from capacity', async () => {
  await db.query(
    "INSERT INTO garage_workforce_unavailability (tenant_id,workforce_profile_id,starts_at,ends_at,reason_code,created_by_user_id) VALUES ($1,$2,$3,$4,'training','admin-a')",
    [T.a,P.a1,SLOT_START,SLOT_END],
  );
  const withOneUnavailable = await db.query(
    'SELECT * FROM garage_ops03_evaluate_interval($1,$2,$3,$4,NULL)',
    [T.a,B.a1,SLOT_START,SLOT_END],
  );
  assert.equal(withOneUnavailable.rows[0].available_count, 1);
  assert.deepEqual(withOneUnavailable.rows[0].available_workforce_profile_ids, [P.a2]);
  await db.query(
    "UPDATE garage_workforce_unavailability SET starts_at='2026-10-27T08:00:00Z', ends_at='2026-10-27T09:00:00Z' WHERE workforce_profile_id=$1",
    [P.a1],
  );
});

test('a requester can request only their Service Case and requests do not reserve confirmed capacity', async () => {
  const wrongRequester = await rejected(requestAppointment(C.a1, 'customer-b'));
  assert.match(wrongRequester?.message || '', /SERVICE_CASE_NOT_OWNED/);

  const first = await requestAppointment(C.a1, 'customer-a');
  const second = await requestAppointment(C.a2, 'customer-b');
  assert.equal(first.rows[0].status, 'requested');
  assert.equal(second.rows[0].status, 'requested');

  const stillAvailable = await db.query(
    'SELECT * FROM garage_ops03_evaluate_interval($1,$2,$3,$4,NULL)',
    [T.a,B.a1,SLOT_START,SLOT_END],
  );
  assert.equal(stillAvailable.rows[0].booked_count, 0);
  assert.equal(stillAvailable.rows[0].available_count, 1);

  C.appt1 = await appointmentId(first);
  C.appt2 = await appointmentId(second);
  const duplicate = await rejected(requestAppointment(C.a1, 'customer-a'));
  assert.match(duplicate?.message || '', /LIVE_APPOINTMENT_EXISTS/);
});

test('concurrent final-slot confirmations produce one winner and capacity release enables the waiting request', async () => {
  const attempts = await Promise.allSettled([
    confirmAppointment(C.appt1, P.a1),
    confirmAppointment(C.appt2, P.a2),
  ]);
  const won = attempts.filter((x) => x.status === 'fulfilled');
  const lost = attempts.filter((x) => x.status === 'rejected');
  assert.equal(won.length, 1, 'exactly one confirmation claims the final branch slot');
  assert.equal(lost.length, 1);
  assert.match(String(lost[0].reason?.message || ''), /CAPACITY_EXHAUSTED|CAPACITY/);

  const confirmed = (await db.query(
    "SELECT id FROM garage_appointments WHERE id IN ($1,$2) AND status='confirmed'",
    [C.appt1,C.appt2],
  )).rows[0].id;
  const requested = confirmed === C.appt1 ? C.appt2 : C.appt1;
  C.capacityWinner = confirmed;
  C.capacityWaiting = requested;

  await db.query(
    "SELECT garage_ops03_transition_appointment($1,'cancelled','admin-a','garage',$2)",
    [confirmed,T.a],
  );
  const waitingWorker = requested === C.appt1 ? P.a1 : P.a2;
  const afterRelease = await confirmAppointment(requested, waitingWorker);
  assert.equal(afterRelease.rows[0].status, 'confirmed', 'cancelled confirmed appointment releases capacity');
  C.confirmedAfterRelease = requested;
});

test('same mechanic cannot be confirmed twice at overlapping times even when branch capacity allows two', async () => {
  await db.query(
    'UPDATE garage_branch_scheduling_settings SET max_concurrent_appointments=2 WHERE branch_id=$1',
    [B.a1],
  );
  await db.query(
    "SELECT garage_ops03_transition_appointment($1,'cancelled','admin-a','garage',$2)",
    [C.confirmedAfterRelease,T.a],
  );

  const r3 = await requestAppointment(C.a3, 'customer-a', '2026-10-26T10:00:00Z','2026-10-26T11:00:00Z');
  const r4 = await requestAppointment(C.a4, 'customer-b', '2026-10-26T10:00:00Z','2026-10-26T11:00:00Z');
  const a3 = await appointmentId(r3);
  const a4 = await appointmentId(r4);

  const attempts = await Promise.allSettled([
    confirmAppointment(a3,P.a1,'2026-10-26T10:00:00Z','2026-10-26T11:00:00Z'),
    confirmAppointment(a4,P.a1,'2026-10-26T10:00:00Z','2026-10-26T11:00:00Z'),
  ]);
  assert.equal(attempts.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter((x) => x.status === 'rejected').length, 1);
  assert.match(
    String(attempts.find((x) => x.status === 'rejected')?.reason?.message || ''),
    /PLANNED_WORKFORCE_UNAVAILABLE/,
  );
  C.mechanicWinner = (await db.query(
    "SELECT id FROM garage_appointments WHERE id IN ($1,$2) AND status='confirmed'", [a3,a4],
  )).rows[0].id;
});

test('failed reschedule is atomic and writes no false rescheduled event', async () => {
  const before = (await db.query(
    'SELECT status,branch_id,starts_at,ends_at,planned_workforce_profile_id FROM garage_appointments WHERE id=$1',
    [C.mechanicWinner],
  )).rows[0];
  const eventsBefore = (await db.query(
    "SELECT count(*)::int n FROM garage_appointment_events WHERE appointment_id=$1 AND event_type='rescheduled'",
    [C.mechanicWinner],
  )).rows[0].n;
  const failure = await rejected(db.query(
    'SELECT garage_ops03_reschedule_appointment($1,$2,$3,$4,$5,$6,$7)',
    [T.a,C.mechanicWinner,B.a1,'2026-10-26T18:00:00Z','2026-10-26T19:00:00Z',P.a1,'admin-a'],
  ));
  assert.match(failure?.message || '', /OUTSIDE_OPENING_HOURS/);
  const afterRow = (await db.query(
    'SELECT status,branch_id,starts_at,ends_at,planned_workforce_profile_id FROM garage_appointments WHERE id=$1',
    [C.mechanicWinner],
  )).rows[0];
  assert.deepEqual(afterRow, before);
  const eventsAfter = (await db.query(
    "SELECT count(*)::int n FROM garage_appointment_events WHERE appointment_id=$1 AND event_type='rescheduled'",
    [C.mechanicWinner],
  )).rows[0].n;
  assert.equal(eventsAfter, eventsBefore);
});

test('terminal appointments remain historical and a new request can be created for the Service Case', async () => {
  await db.query(
    "SELECT garage_ops03_transition_appointment($1,'cancelled','admin-a','garage',$2)",
    [C.mechanicWinner,T.a],
  );
  const reopen = await rejected(db.query(
    "UPDATE garage_appointments SET status='requested' WHERE id=$1", [C.mechanicWinner],
  ));
  assert.match(reopen?.message || '', /TERMINAL_APPOINTMENT_IMMUTABLE/);

  const old = (await db.query('SELECT service_case_id FROM garage_appointments WHERE id=$1',[C.mechanicWinner])).rows[0];
  const owner = (await db.query('SELECT requester_user_id FROM service_cases WHERE id=$1',[old.service_case_id])).rows[0].requester_user_id;
  const next = await requestAppointment(old.service_case_id, owner, '2026-10-26T12:00:00Z','2026-10-26T13:00:00Z');
  assert.equal(next.rows[0].status, 'requested');
});

test('appointment history is append-only and governance audit excludes Service Case free text', async () => {
  const event = (await db.query('SELECT id FROM garage_appointment_events ORDER BY created_at LIMIT 1')).rows[0];
  assert.match((await rejected(db.query("UPDATE garage_appointment_events SET event_type='cancelled' WHERE id=$1",[event.id])))?.message || '', /APPEND_ONLY/);
  assert.match((await rejected(db.query('DELETE FROM garage_appointment_events WHERE id=$1',[event.id])))?.message || '', /APPEND_ONLY/);

  const auditRows = (await db.query(
    "SELECT event_type,previous_value,new_value FROM trust_audit_events WHERE event_type LIKE 'GARAGE_APPOINTMENT_%'",
  )).rows;
  assert.ok(auditRows.length > 0);
  assert.equal(JSON.stringify(auditRows).includes('request_summary'), false);
});

test('confirmed scheduling preserves Service Case, work-order assignment and vehicle authority', async () => {
  const serviceCases = (await db.query(
    'SELECT id,status,vin,requester_user_id FROM service_cases WHERE id IN ($1,$2) ORDER BY id',
    [C.a1,C.a2],
  )).rows;
  assert.ok(serviceCases.every((x) => x.status === 'accepted'));
  assert.equal(
    (await db.query("SELECT owner_id FROM vehicles WHERE vin='OPS03VIN000000001'")).rows[0].owner_id,
    'customer-a',
  );
  const workAssignments = (await db.query('SELECT count(*)::int n FROM work_order_assignments')).rows[0].n;
  assert.equal(workAssignments, 0, 'appointment planning never manufactures execution assignment');
});

test('future confirmed appointments block silent OPS01 site/workforce deactivation', async () => {
  const openCase = (await db.query(
    "INSERT INTO service_cases (vin,garage_tenant_id,branch_id,requester_user_id,status) VALUES ('OPS03VIN000000001',$1,$2,'customer-a','accepted') RETURNING id",
    [T.a,B.a1],
  )).rows[0].id;
  const request = await requestAppointment(openCase,'customer-a','2026-10-26T14:00:00Z','2026-10-26T15:00:00Z');
  const appointment = await appointmentId(request);
  await confirmAppointment(appointment,P.a2,'2026-10-26T14:00:00Z','2026-10-26T15:00:00Z');

  assert.match(
    (await rejected(db.query('UPDATE garage_branches SET is_active=false WHERE id=$1',[B.a1])))?.message || '',
    /BLOCK_SITE_DEACTIVATION/,
  );
  assert.match(
    (await rejected(db.query("UPDATE garage_workforce_profiles SET employment_status='inactive' WHERE id=$1",[P.a2])))?.message || '',
    /BLOCK_WORKFORCE_DEACTIVATION/,
  );
});

test('cross-Garage branch/workforce/service-case spoofing is database-enforced', async () => {
  assert.match(
    (await rejected(db.query(
      'SELECT garage_ops03_request_appointment($1,$2,$3,$4,$5)',
      [C.a1,B.b1,SLOT_START,SLOT_END,'customer-a'],
    )))?.message || '',
    /SERVICE_CASE_BRANCH_MISMATCH|ACTIVE_BRANCH_REQUIRED/,
  );

  const cross = await rejected(db.query(
    "INSERT INTO garage_workforce_schedules (tenant_id,workforce_profile_id,branch_id,day_of_week,starts_at,ends_at,effective_from,created_by_user_id) VALUES ($1,$2,$3,1,'08:00','17:00','2026-10-01','admin-a')",
    [T.a,P.b1,B.a1],
  ));
  assert.match(cross?.message || '', /AUTHORITY_INVALID/);
});
