import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { supabaseOver } from './helpers/pgliteLedgerHarness.js';
import { createGarageFinalWorld } from './helpers/garageFinalWorld.js';
import {
  completeJob,
  completeServiceCase,
  startServiceCase,
} from '../services/serviceNetwork/serviceCaseService.js';
import { recordService } from '../services/serviceNetwork/serviceRecordService.js';
import {
  assignMechanic,
  createWorkOrderForCase,
  updateWorkOrderStatus,
} from '../services/serviceNetwork/workOrderAssignmentService.js';
import {
  createEstimateForCase,
  decideMyEstimate,
  sendEstimate,
} from '../services/garageOperations/garageEstimateService.js';

const OPS04 = '20261024100000_garage_ops04_estimates_and_authorization.sql';
const OPS05 = '20261024110000_garage_ops05_workshop_execution_gates.sql';
let world;
let db;
let client;

const garageActor = (id, tenant, role = 'admin') => ({ id, role: 'owner', activeTenant: { id: tenant, type: 'garage', role } });
const person = (id) => ({ id, role: 'owner', activeTenant: null });
const noEmit = { emitDomainEvent: async () => ({}) };

async function rejects(promise, { name, pattern } = {}) {
  try { await promise; } catch (error) {
    if (name) assert.equal(error.constructor.name, name, `expected ${name}, got ${error.constructor.name}: ${error.message}`);
    if (pattern) assert.match(error.message, pattern);
    return error;
  }
  assert.fail('expected a rejection');
}
async function newCase(garage = 'a') {
  const tenant = world.T[garage];
  const vin = garage === 'a' ? world.V.a : world.V.b;
  const requester = garage === 'a' ? 'customer-a' : 'customer-b';
  const { rows: [c] } = await db.query(
    "INSERT INTO service_cases (vin,garage_tenant_id,branch_id,requester_user_id,status) VALUES ($1,$2,$3,$4,'accepted') RETURNING id",
    [vin, tenant, world.B[garage + '1'], requester]);
  const { workOrder } = await createWorkOrderForCase(client, garageActor('admin-' + garage, tenant), c.id, {});
  return { caseId: c.id, workOrderId: workOrder.id, tenant, vin, requester, admin: garageActor('admin-' + garage, tenant) };
}
const authorizeDirectly = (c) => db.query(
  "SELECT mechanic_work_order_decide_authorization($1,$2,$3,'owner',NULL,'owner','authorized',NULL)", [c.workOrderId, c.vin, c.requester]);

before(async () => {
  world = await createGarageFinalWorld({ after: [OPS04, OPS05] });
  db = world.db;
  client = supabaseOver(db);
});
after(async () => { await db?.close(); });

test('starting work the customer has not authorized is refused, in words the operator can act on', async () => {
  const c = await newCase();
  await assignMechanic(client, c.admin, c.workOrderId, { mechanic_user_id: 'mech-a' });
  const e = await rejects(startServiceCase(client, c.admin, c.caseId, noEmit), { name: 'ConflictError' });
  assert.match(e.message, /has not authorized this work yet/);

  await db.query("SELECT mechanic_work_order_decide_authorization($1,$2,$3,'owner',NULL,'owner','declined',NULL)", [c.workOrderId, c.vin, c.requester]);
  await rejects(startServiceCase(client, c.admin, c.caseId, noEmit), { name: 'ConflictError', pattern: /declined this work/ });

  const d = await newCase();
  await authorizeDirectly(d);
  await db.query("SELECT mechanic_work_order_decide_authorization($1,$2,$3,'owner',NULL,'owner','revoked',NULL)", [d.workOrderId, d.vin, d.requester]);
  await assignMechanic(client, d.admin, d.workOrderId, { mechanic_user_id: 'mech-a' });
  await rejects(startServiceCase(client, d.admin, d.caseId, noEmit), { name: 'ConflictError', pattern: /withdrew their authorization/ });
  assert.equal((await db.query('SELECT status FROM service_cases WHERE id=$1', [c.caseId])).rows[0].status, 'accepted');
});

test('starting also needs a mechanic, and recording needs a started job', async () => {
  const c = await newCase();
  await authorizeDirectly(c);
  await rejects(startServiceCase(client, c.admin, c.caseId, noEmit), { name: 'ConflictError', pattern: /Assign a mechanic/ });
  await assignMechanic(client, c.admin, c.workOrderId, { mechanic_user_id: 'mech-a' });
  const mech = garageActor('mech-a', c.tenant, 'mechanic');
  await rejects(recordService(client, mech, c.workOrderId, { work_performed: 'Pads' }), { name: 'ConflictError', pattern: /under way/ });
  const started = await startServiceCase(client, c.admin, c.caseId, noEmit);
  assert.equal(started.case.status, 'active');
  const rec = await recordService(client, mech, c.workOrderId, { work_performed: 'Replaced pads', total_cost: 120, currency: 'USD' });
  assert.equal(rec.record.service_authority, 'garage_stated');
});

test('completing: legacy case-complete refuses until the job is complete; the job needs recorded work', async () => {
  const c = await newCase();
  await authorizeDirectly(c);
  await assignMechanic(client, c.admin, c.workOrderId, { mechanic_user_id: 'mech-a' });
  await startServiceCase(client, c.admin, c.caseId, noEmit);
  await rejects(completeServiceCase(client, c.admin, c.caseId, noEmit), { name: 'ConflictError', pattern: /Complete the job/ });
  await rejects(completeJob(client, c.admin, c.caseId, noEmit), { name: 'ConflictError', pattern: /Record the work that was actually done/ });
  await rejects(updateWorkOrderStatus(client, garageActor('mech-a', c.tenant, 'mechanic'), c.workOrderId, { status: 'Completed' }), { name: 'ConflictError', pattern: /Record the work/ });

  await recordService(client, garageActor('mech-a', c.tenant, 'mechanic'), c.workOrderId, { work_performed: 'Done' });
  const emitted = [];
  const done = await completeJob(client, garageActor('mech-a', c.tenant, 'mechanic'), c.caseId, { emitDomainEvent: async (...a) => { emitted.push(a); } });
  assert.equal(done.case.status, 'completed');
  assert.equal(done.service_record_count, 1);
  assert.equal(done.notification.emitted, true);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0][1], 'service.case.completed');
  assert.equal(emitted[0][2].recipientUserId, c.requester, 'the customer is told through the existing Communications contract');
  assert.equal((await db.query('SELECT status FROM mechanic_work_orders WHERE id=$1', [c.workOrderId])).rows[0].status, 'Completed');
  await rejects(completeJob(client, c.admin, c.caseId, noEmit), { name: 'ConflictError' });
});

test('completing is for THIS garage only; a customer and another garage get nothing', async () => {
  const c = await newCase();
  await authorizeDirectly(c);
  await assignMechanic(client, c.admin, c.workOrderId, { mechanic_user_id: 'mech-a' });
  await startServiceCase(client, c.admin, c.caseId, noEmit);
  await recordService(client, c.admin, c.workOrderId, { work_performed: 'Done' });
  await rejects(completeJob(client, person('customer-a'), c.caseId, noEmit), { name: 'ForbiddenError' });
  await rejects(completeJob(client, garageActor('admin-b', world.T.b), c.caseId, noEmit), { name: 'NotFoundError' });
  assert.equal((await db.query('SELECT status FROM service_cases WHERE id=$1', [c.caseId])).rows[0].status, 'active');
});

test('assigning the person who authorized the work is refused and leaves no half-applied assignment', async () => {
  const c = await newCase();
  await db.query("INSERT INTO tenant_users (tenant_id,user_id,role) VALUES ($1,'customer-a','mechanic') ON CONFLICT DO NOTHING", [c.tenant]);
  await authorizeDirectly(c);
  await rejects(assignMechanic(client, c.admin, c.workOrderId, { mechanic_user_id: 'customer-a' }), {
    name: 'ConflictError', pattern: /cannot also be the mechanic/ });
  const { rows } = await db.query('SELECT unassigned_at FROM work_order_assignments WHERE work_order_id=$1', [c.workOrderId]);
  assert.ok(rows.every((r) => r.unassigned_at), 'the failed assignment was closed, not left live');
  assert.equal((await db.query('SELECT mechanic_id FROM mechanic_work_orders WHERE id=$1', [c.workOrderId])).rows[0].mechanic_id, null);
  // a different mechanic can be assigned afterwards
  const ok = await assignMechanic(client, c.admin, c.workOrderId, { mechanic_user_id: 'mech-a' });
  assert.equal(ok.created, true);
});

test('THE GOLDEN SERVICE JOURNEY: estimate -> accept -> assign -> start -> record -> complete', async () => {
  const c = await newCase();
  const estimate = await createEstimateForCase(client, c.admin, c.caseId, {
    currency: 'USD',
    lines: [{ category: 'labour', description: 'Full service', quantity: 2, unit_price: 40 }, { category: 'part', description: 'Oil filter', quantity: 1, unit_price: 12.5 }],
  });
  await sendEstimate(client, c.admin, estimate.id);
  await rejects(startServiceCase(client, c.admin, c.caseId, noEmit), { name: 'ConflictError' });
  const decided = await decideMyEstimate(client, person('customer-a'), estimate.id, { decision: 'accept' });
  assert.equal(decided.work_order_authorization, 'authorized');
  await assignMechanic(client, c.admin, c.workOrderId, { mechanic_user_id: 'mech-a' });
  await startServiceCase(client, c.admin, c.caseId, noEmit);
  const mech = garageActor('mech-a', c.tenant, 'mechanic');
  // ACTUAL work and cost may differ from the estimate; the estimate is never copied into history
  await recordService(client, mech, c.workOrderId, { work_performed: 'Full service + wiper blades', total_cost: 105, currency: 'USD' });
  await completeJob(client, mech, c.caseId, noEmit);

  const { rows: [facts] } = await db.query(
    `SELECT (SELECT status FROM service_cases WHERE id=$1) case_status,
            (SELECT status FROM mechanic_work_orders WHERE id=$2) wo_status,
            (SELECT status FROM garage_estimates WHERE work_order_id=$2) estimate_status,
            (SELECT sent_total_amount FROM garage_estimates WHERE work_order_id=$2) estimated,
            (SELECT total_cost FROM service_records WHERE work_order_id=$2) actual`, [c.caseId, c.workOrderId]);
  assert.deepEqual(facts, { case_status: 'completed', wo_status: 'Completed', estimate_status: 'accepted', estimated: '92.50', actual: '105' });
});
