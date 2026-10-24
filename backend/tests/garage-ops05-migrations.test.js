import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createGarageFinalWorld, seedAcceptedCase } from './helpers/garageFinalWorld.js';
import { migrationUpSql } from './helpers/pgliteLedgerHarness.js';

const OPS04 = '20261024100000_garage_ops04_estimates_and_authorization.sql';
const OPS05 = '20261024110000_garage_ops05_workshop_execution_gates.sql';
let world;
let db;

async function rejects(promise, pattern) {
  try { await promise; } catch (error) {
    if (pattern) assert.match(String(error.message), pattern, `expected ${pattern}, got: ${error.message}`);
    return error;
  }
  assert.fail(`expected a rejection${pattern ? ' matching ' + pattern : ''}`);
}
const newCase = (opts) => seedAcceptedCase(world, opts);
const setCase = (id, status) => db.query('UPDATE service_cases SET status=$2 WHERE id=$1', [id, status]);
const authorize = (c, who = 'customer-a') => db.query(
  "SELECT mechanic_work_order_decide_authorization($1,$2,$3,'owner',NULL,'owner','authorized',NULL)", [c.workOrderId, c.vin, who]);
const assign = (c, mech = 'mech-a', by = 'admin-a') => db.query(
  'INSERT INTO work_order_assignments (work_order_id,tenant_id,mechanic_user_id,assigned_by_user_id) VALUES ($1,$2,$3,$4)',
  [c.workOrderId, c.tenant, mech, by]);
const record = (c, { tenant = c.tenant } = {}) => db.query(
  `INSERT INTO service_records (work_order_id,service_case_id,tenant_id,vin,work_performed,service_authority,recorded_by_user_id,performed_at)
   VALUES ($1,$2,$3,$4,'Replaced pads','garage_stated','mech-a',now()) RETURNING id`,
  [c.workOrderId, c.caseId, tenant, c.vin]);
const complete = (c, actor = 'admin-a', tenant = c.tenant) =>
  db.query('SELECT garage_ops05_complete_job($1,$2,$3) r', [tenant, c.caseId, actor]);
const caseStatus = async (c) => (await db.query('SELECT status FROM service_cases WHERE id=$1', [c.caseId])).rows[0].status;
const woState = async (c) => (await db.query('SELECT status, owner_authorization FROM mechanic_work_orders WHERE id=$1', [c.workOrderId])).rows[0];

/** accepted + authorized + assigned: ready to start */
async function readyCase(opts) { const c = await newCase(opts); await authorize(c, opts?.garage === 'b' ? 'customer-b' : 'customer-a'); await assign(c, opts?.garage === 'b' ? 'mech-c' : 'mech-a', opts?.garage === 'b' ? 'admin-b' : 'admin-a'); return c; }
async function startedCase(opts) { const c = await readyCase(opts); await setCase(c.caseId, 'active'); return c; }

before(async () => {
  world = await createGarageFinalWorld({ after: [OPS04, OPS05] });
  db = world.db;
  await db.exec(migrationUpSql(OPS05)); // replay-safe
});
after(async () => { await db?.close(); });

test('OPS05 functions are service_role-only', async () => {
  const { rows } = await db.query(
    `SELECT p.proname, has_function_privilege('anon', p.oid,'EXECUTE') a, has_function_privilege('authenticated', p.oid,'EXECUTE') u,
            has_function_privilege('service_role', p.oid,'EXECUTE') s
       FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('garage_ops05_complete_job','garage_ops05_assert_workspace')`);
  assert.equal(rows.length, 2);
  for (const r of rows) assert.deepEqual({ a: r.a, u: r.u, s: r.s }, { a: false, u: false, s: true }, r.proname);
});

test('START GATE: work cannot start while the customer has not authorized it (pending, declined, revoked)', async () => {
  const pending = await newCase();
  await assign(pending);
  const e1 = await rejects(setCase(pending.caseId, 'active'), /GARAGE_OPS05_NOT_AUTHORIZED/);
  assert.match(String(e1.detail ?? ''), /pending|/);
  assert.equal(await caseStatus(pending), 'accepted');

  const declined = await newCase();
  await assign(declined);
  await db.query("SELECT mechanic_work_order_decide_authorization($1,$2,'customer-a','owner',NULL,'owner','declined',NULL)", [declined.workOrderId, declined.vin]);
  await rejects(setCase(declined.caseId, 'active'), /GARAGE_OPS05_NOT_AUTHORIZED/);

  const revoked = await newCase();
  await assign(revoked);
  await authorize(revoked);
  await db.query("SELECT mechanic_work_order_decide_authorization($1,$2,'customer-a','owner',NULL,'owner','revoked',NULL)", [revoked.workOrderId, revoked.vin]);
  await rejects(setCase(revoked.caseId, 'active'), /GARAGE_OPS05_NOT_AUTHORIZED/);
  for (const c of [pending, declined, revoked]) assert.equal(await caseStatus(c), 'accepted');
});

test('START GATE: an authorized job still needs a live mechanic, an open job and a job at all', async () => {
  const unassigned = await newCase();
  await authorize(unassigned);
  await rejects(setCase(unassigned.caseId, 'active'), /GARAGE_OPS05_MECHANIC_REQUIRED/);
  await assign(unassigned);
  await db.query("UPDATE work_order_assignments SET unassigned_at=now(), unassigned_by_user_id='admin-a' WHERE work_order_id=$1", [unassigned.workOrderId]);
  await rejects(setCase(unassigned.caseId, 'active'), /GARAGE_OPS05_MECHANIC_REQUIRED/);

  const cancelled = await newCase();
  await authorize(cancelled); await assign(cancelled);
  await db.query("UPDATE mechanic_work_orders SET status='Cancelled', cancelled_at=now() WHERE id=$1", [cancelled.workOrderId]);
  await rejects(setCase(cancelled.caseId, 'active'), /GARAGE_OPS05_WORK_ORDER_TERMINAL/);

  const { rows: [bare] } = await db.query(
    "INSERT INTO service_cases (vin,garage_tenant_id,branch_id,requester_user_id,status) VALUES ($1,$2,$3,'customer-a','accepted') RETURNING id",
    [world.V.a, world.T.a, world.B.a1]);
  await rejects(db.query("UPDATE service_cases SET status='active' WHERE id=$1", [bare.id]), /GARAGE_OPS05_WORK_ORDER_REQUIRED/);
});

test('START GATE: an authorized, assigned job starts', async () => {
  const c = await readyCase();
  await setCase(c.caseId, 'active');
  assert.equal(await caseStatus(c), 'active');
});

test('the gate does not disturb other case transitions (cancel/decline stay possible)', async () => {
  const c = await newCase();
  await setCase(c.caseId, 'cancelled');
  assert.equal(await caseStatus(c), 'cancelled');
});

test('RECORD GUARD: no work can be recorded before start, without authorization, after revocation, or after completion', async () => {
  const early = await readyCase();
  await rejects(record(early), /GARAGE_OPS05_WORK_NOT_STARTED/);

  const unauthorized = await newCase();
  await rejects(record(unauthorized), /GARAGE_OPS05_NOT_AUTHORIZED/);

  const live = await startedCase();
  await record(live);
  await db.query("SELECT mechanic_work_order_decide_authorization($1,$2,'customer-a','owner',NULL,'owner','revoked','no')", [live.workOrderId, live.vin]);
  await rejects(record(live), /GARAGE_OPS05_NOT_AUTHORIZED/);

  const done = await startedCase();
  await record(done);
  await complete(done);
  await rejects(record(done), /GARAGE_OPS05_WORK_ORDER_TERMINAL/);

  const stray = await startedCase();
  await rejects(record(stray, { tenant: world.T.b }), /GARAGE_OPS05_WORK_ORDER_REQUIRED|foreign key|violates/i);
});

test('COMPLETION: a job cannot be completed without recorded work, and the case cannot complete without its job', async () => {
  const c = await startedCase();
  await rejects(complete(c), /GARAGE_OPS05_NO_SERVICE_RECORD/);
  await rejects(db.query("UPDATE mechanic_work_orders SET status='Completed' WHERE id=$1", [c.workOrderId]), /GARAGE_OPS05_NO_SERVICE_RECORD/);
  await rejects(setCase(c.caseId, 'completed'), /GARAGE_OPS05_WORK_ORDER_NOT_COMPLETED/);
  assert.equal(await caseStatus(c), 'active');
  assert.equal((await woState(c)).status, 'In Progress');
});

test('COMPLETION: complete_job finishes job + case together with history, and cannot be repeated', async () => {
  const c = await startedCase();
  await record(c); await record(c);
  const { rows: [{ r }] } = await complete(c);
  assert.equal(r.service_record_count, 2);
  assert.equal(await caseStatus(c), 'completed');
  assert.equal((await woState(c)).status, 'Completed');
  const { rows: [ev] } = await db.query("SELECT event_type, from_status, to_status, actor_user_id, metadata FROM service_case_events WHERE service_case_id=$1 ORDER BY id DESC LIMIT 1", [c.caseId]);
  assert.equal(ev.event_type, 'service.case.completed');
  assert.equal(ev.from_status, 'active'); assert.equal(ev.to_status, 'completed'); assert.equal(ev.actor_user_id, 'admin-a');
  const { rows: [audit] } = await db.query("SELECT event_type, actor_tenant_id FROM trust_audit_events WHERE event_type='GARAGE_JOB_COMPLETED' ORDER BY created_at DESC LIMIT 1");
  assert.deepEqual(audit, { event_type: 'GARAGE_JOB_COMPLETED', actor_tenant_id: c.tenant });
  await rejects(complete(c), /GARAGE_OPS05_WORK_NOT_STARTED/);
});

test('COMPLETION: only a member of THIS garage workspace can complete; other garages and customers cannot', async () => {
  const c = await startedCase();
  await record(c);
  await rejects(complete(c, 'customer-a'), /GARAGE_OPS05_WORKSPACE_REQUIRED/);
  await rejects(complete(c, 'stranger'), /GARAGE_OPS05_WORKSPACE_REQUIRED/);
  await rejects(complete(c, 'admin-b'), /GARAGE_OPS05_WORKSPACE_REQUIRED/);
  // another garage addressing this garage's case: the case is looked up first (lock order), and it is not theirs
  await rejects(complete(c, 'admin-b', world.T.b), /GARAGE_OPS05_CASE_NOT_FOUND|GARAGE_OPS05_WORK_ORDER_REQUIRED/);
  await rejects(complete(c, 'admin-a', world.T.b), /GARAGE_OPS05_WORKSPACE_REQUIRED/);
  assert.equal(await caseStatus(c), 'active');
  // an assigned mechanic of this garage may complete
  await complete(c, 'mech-a');
  assert.equal(await caseStatus(c), 'completed');
});

test('COMPLETION: a revoked authorization blocks completion; revoking cannot be undone to sneak work through', async () => {
  const c = await startedCase();
  await record(c);
  await db.query("SELECT mechanic_work_order_decide_authorization($1,$2,'customer-a','owner',NULL,'owner','revoked','changed mind')", [c.workOrderId, c.vin]);
  await rejects(complete(c), /GARAGE_OPS05_NOT_AUTHORIZED/);
  await rejects(db.query("SELECT mechanic_work_order_decide_authorization($1,$2,'customer-a','owner',NULL,'owner','authorized',NULL)", [c.workOrderId, c.vin]), /cannot move from revoked/);
  assert.equal(await caseStatus(c), 'active');
});

test('FAIL-ATOMIC: if the completion audit fails, neither the job nor the case completes and no history is written', async () => {
  const c = await startedCase();
  await record(c);
  await db.exec(
    "CREATE OR REPLACE FUNCTION ops05_test_fail_audit() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN " +
    "IF NEW.event_type = 'GARAGE_JOB_COMPLETED' THEN RAISE EXCEPTION 'OPS05_TEST_AUDIT_FAILURE'; END IF; RETURN NEW; END $$; " +
    "CREATE TRIGGER trg_ops05_test_fail_audit BEFORE INSERT ON trust_audit_events FOR EACH ROW EXECUTE FUNCTION ops05_test_fail_audit();");
  try {
    await rejects(complete(c), /OPS05_TEST_AUDIT_FAILURE/);
  } finally {
    await db.exec('DROP TRIGGER IF EXISTS trg_ops05_test_fail_audit ON trust_audit_events; DROP FUNCTION IF EXISTS ops05_test_fail_audit();');
  }
  assert.equal(await caseStatus(c), 'active');
  assert.equal((await woState(c)).status, 'In Progress');
  assert.equal((await db.query("SELECT count(*)::int n FROM service_case_events WHERE service_case_id=$1 AND event_type='service.case.completed'", [c.caseId])).rows[0].n, 0);
  await complete(c);
  assert.equal(await caseStatus(c), 'completed');
});

test('legacy case-less work orders keep their old rules (no case, no new gate)', async () => {
  const { rows: [wo] } = await db.query(
    "INSERT INTO mechanic_work_orders (tenant_id,vin,customer_id,status,owner_authorization) VALUES ($1,$2,'customer-a','In Progress','pending') RETURNING id",
    [world.T.a, world.V.a]);
  await db.query("UPDATE mechanic_work_orders SET status='Completed' WHERE id=$1", [wo.id]);
  assert.equal((await db.query('SELECT status FROM mechanic_work_orders WHERE id=$1', [wo.id])).rows[0].status, 'Completed');
});

test('THE WHOLE JOURNEY: estimate -> customer accepts -> assign -> start -> record -> complete', async () => {
  const c = await newCase();
  const lines = JSON.stringify([{ category: 'labour', description: 'Service', quantity: 1, unit_price: 60 }]);
  const { rows: [est] } = await db.query('SELECT * FROM garage_ops04_create_estimate($1,$2,$3,$4,$5,$6,$7::jsonb,$8)',
    [c.tenant, c.workOrderId, 'USD', null, null, null, lines, 'admin-a']);
  await db.query('SELECT * FROM garage_ops04_send_estimate($1,$2,$3)', [c.tenant, est.id, 'admin-a']);
  await assign(c);
  await rejects(setCase(c.caseId, 'active'), /GARAGE_OPS05_NOT_AUTHORIZED/);
  await db.query('SELECT garage_ops04_decide_estimate($1,$2,$3,$4,$5,$6,$7)', [est.id, 'accepted', 'owner', 'customer-a', 'owner', null, null]);
  await setCase(c.caseId, 'active');
  await record(c);
  await complete(c);
  assert.equal(await caseStatus(c), 'completed');
  assert.equal((await db.query('SELECT status FROM garage_estimates WHERE id=$1', [est.id])).rows[0].status, 'accepted');
  assert.equal((await woState(c)).owner_authorization, 'authorized');
});

test('THE REFUSAL JOURNEY: decline -> no authorized work, no start, no service record, nothing to complete', async () => {
  const c = await newCase();
  const lines = JSON.stringify([{ category: 'labour', description: 'Service', quantity: 1, unit_price: 60 }]);
  const { rows: [est] } = await db.query('SELECT * FROM garage_ops04_create_estimate($1,$2,$3,$4,$5,$6,$7::jsonb,$8)',
    [c.tenant, c.workOrderId, 'USD', null, null, null, lines, 'admin-a']);
  await db.query('SELECT * FROM garage_ops04_send_estimate($1,$2,$3)', [c.tenant, est.id, 'admin-a']);
  await assign(c);
  await db.query('SELECT garage_ops04_decide_estimate($1,$2,$3,$4,$5,$6,$7)', [est.id, 'declined', 'owner', 'customer-a', 'owner', null, 'no']);
  await rejects(setCase(c.caseId, 'active'), /GARAGE_OPS05_NOT_AUTHORIZED/);
  await rejects(record(c), /GARAGE_OPS05_NOT_AUTHORIZED/);
  await rejects(complete(c), /GARAGE_OPS05_WORK_NOT_STARTED/);
  assert.equal((await db.query('SELECT count(*)::int n FROM service_records WHERE work_order_id=$1', [c.workOrderId])).rows[0].n, 0);
});
