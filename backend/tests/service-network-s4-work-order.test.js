/**
 * Service Network S4 — work order convergence and mechanic assignment contracts.
 *
 * The database cannot enforce these: the Title-Case status CHECK exists only in
 * 009_phase4_schema.sql (RETIRED_UNAPPLIABLE), and the legacy 006 shape declares
 * `status TEXT DEFAULT 'pending'` with no constraint — proven in
 * database/test/service_network_s4_check.mjs. So the vocabulary, the transition
 * guard and terminal-state immutability are SERVICE-LAYER obligations, and these
 * tests are what hold them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockSupabase } from './helpers/mockSupabase.js';
import {
  WORK_ORDER_STATUSES,
  assignMechanic,
  createWorkOrderForCase,
  getWorkOrderAssignment,
  unassignMechanic,
  updateWorkOrderStatus,
} from '../services/serviceNetwork/workOrderAssignmentService.js';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const VIN = 'VINWO000001';
const CASE_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const managerA = { id: 'u-mgr', role: 'mechanic', tenantId: TENANT_A };
const managerB = { id: 'u-mgr-b', role: 'mechanic', tenantId: TENANT_B };

function seedClient(over = {}) {
  return createMockSupabase({
    vehicles: [{ vin: VIN, owner_id: 'u-owner' }],
    tenants: [
      { id: TENANT_A, name: 'Harare Motors', type: 'garage' },
      { id: TENANT_B, name: 'Bulawayo Auto', type: 'garage' },
    ],
    tenant_users: [
      { tenant_id: TENANT_A, user_id: 'u-mech-1', role: 'mechanic' },
      { tenant_id: TENANT_A, user_id: 'u-mech-2', role: 'mechanic' },
      { tenant_id: TENANT_A, user_id: 'u-mgr', role: 'admin' },
      { tenant_id: TENANT_B, user_id: 'u-mech-b', role: 'mechanic' },
    ],
    service_cases: [{
      id: CASE_ID, vin: VIN, garage_tenant_id: TENANT_A, requester_user_id: 'u-owner',
      status: 'accepted', service_category: 'brakes', request_summary: 'Grinding noise',
      branch_id: null,
    }],
    mechanic_work_orders: [],
    work_order_assignments: [],
    ...over,
  });
}

async function openWorkOrder(client) {
  const { workOrder } = await createWorkOrderForCase(client, managerA, CASE_ID, {});
  return workOrder;
}

test('a work order opens from an accepted case, inheriting its context', async () => {
  const client = seedClient();
  const result = await createWorkOrderForCase(client, managerA, CASE_ID, {});
  assert.equal(result.created, true);
  assert.equal(result.workOrder.service_case_id, CASE_ID);
  assert.equal(result.workOrder.vin, VIN);
  assert.equal(result.workOrder.tenant_id, TENANT_A);
  assert.equal(result.workOrder.customer_id, 'u-owner');
  assert.equal(result.workOrder.service_category, 'brakes');
  assert.equal(result.workOrder.status, 'In Progress');
});

test('intake does NOT stamp the creator as the mechanic (the old conflation is gone)', async () => {
  const client = seedClient();
  const workOrder = await openWorkOrder(client);
  assert.ok(!workOrder.mechanic_id, 'a work order may legitimately begin unassigned');

  const assignment = await getWorkOrderAssignment(client, managerA, workOrder.id);
  assert.equal(assignment.assigned, false);
  assert.equal(assignment.assigned_mechanic_user_id, null, 'unassigned says so; it does not guess');
});

test('the case→work-order link is idempotent', async () => {
  const client = seedClient();
  const first = await createWorkOrderForCase(client, managerA, CASE_ID, {});
  const second = await createWorkOrderForCase(client, managerA, CASE_ID, {});
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.workOrder.id, first.workOrder.id);
  assert.equal(client._tables.mechanic_work_orders.length, 1);
});

test('a work order cannot be opened for a case that was never accepted', async () => {
  const client = seedClient({
    service_cases: [{ id: CASE_ID, vin: VIN, garage_tenant_id: TENANT_A, status: 'requested' }],
  });
  await assert.rejects(() => createWorkOrderForCase(client, managerA, CASE_ID, {}), /only be opened for an accepted case/);
});

test('another garage cannot open a work order for this case', async () => {
  const client = seedClient();
  await assert.rejects(() => createWorkOrderForCase(client, managerB, CASE_ID, {}), /not found/i);
  assert.equal(client._tables.mechanic_work_orders.length, 0);
});

test('assignment is attributable and recorded as history', async () => {
  const client = seedClient();
  const workOrder = await openWorkOrder(client);
  const { assignment } = await assignMechanic(client, managerA, workOrder.id, { mechanic_user_id: 'u-mech-1' });

  assert.equal(assignment.mechanic_user_id, 'u-mech-1');
  assert.equal(assignment.assigned_by_user_id, 'u-mgr', 'who assigned is recorded');
  assert.ok(assignment.assigned_at);
  // The in-memory mock omits unset columns where real PostgreSQL stores NULL; the
  // live/closed semantics themselves are pinned in service_network_s4_check.mjs.
  assert.ok(!assignment.unassigned_at, 'a new assignment is live');

  const view = await getWorkOrderAssignment(client, managerA, workOrder.id);
  assert.equal(view.assigned_mechanic_user_id, 'u-mech-1');
});

test('a garage cannot assign someone who is not its member', async () => {
  const client = seedClient();
  const workOrder = await openWorkOrder(client);
  await assert.rejects(
    () => assignMechanic(client, managerA, workOrder.id, { mechanic_user_id: 'u-mech-b' }),
    /not a member of this garage/,
  );
  await assert.rejects(
    () => assignMechanic(client, managerA, workOrder.id, { mechanic_user_id: 'u-stranger' }),
    /not a member of this garage/,
  );
});

test('a second live assignment is refused; reassignment goes through unassign', async () => {
  const client = seedClient();
  const workOrder = await openWorkOrder(client);
  await assignMechanic(client, managerA, workOrder.id, { mechanic_user_id: 'u-mech-1' });
  await assert.rejects(
    () => assignMechanic(client, managerA, workOrder.id, { mechanic_user_id: 'u-mech-2' }),
    /already has an assigned mechanic/,
  );

  await unassignMechanic(client, managerA, workOrder.id, { reason_code: 'reassigned' });
  await assignMechanic(client, managerA, workOrder.id, { mechanic_user_id: 'u-mech-2' });

  const view = await getWorkOrderAssignment(client, managerA, workOrder.id);
  assert.equal(view.assigned_mechanic_user_id, 'u-mech-2');
  assert.equal(view.history.length, 2, 'the previous assignment is retained as history, not deleted');
  assert.equal(view.history[0].unassign_reason_code, 'reassigned');
});

test('re-assigning the SAME mechanic is idempotent, not a conflict', async () => {
  const client = seedClient();
  const workOrder = await openWorkOrder(client);
  const first = await assignMechanic(client, managerA, workOrder.id, { mechanic_user_id: 'u-mech-1' });
  const again = await assignMechanic(client, managerA, workOrder.id, { mechanic_user_id: 'u-mech-1' });
  assert.equal(first.created, true);
  assert.equal(again.created, false);
  assert.equal(client._tables.work_order_assignments.length, 1);
});

test('status vocabulary is enforced in the service layer (the DB does not)', async () => {
  const client = seedClient();
  const workOrder = await openWorkOrder(client);
  await assert.rejects(
    () => updateWorkOrderStatus(client, managerA, workOrder.id, { status: 'completed' }),
    /status must be one of/,
    'lowercase is not the pinned vocabulary',
  );
  await assert.rejects(
    () => updateWorkOrderStatus(client, managerA, workOrder.id, { status: 'pending' }),
    /status must be one of/,
  );
  assert.deepEqual(WORK_ORDER_STATUSES, ['In Progress', 'Completed', 'Cancelled']);
});

test('a completed work order remains historical — it cannot be reopened', async () => {
  const client = seedClient();
  const workOrder = await openWorkOrder(client);
  const done = await updateWorkOrderStatus(client, managerA, workOrder.id, { status: 'Completed' });
  assert.equal(done.workOrder.status, 'Completed');
  assert.ok(done.workOrder.completed_at, 'completion has its own authoritative timestamp');

  await assert.rejects(
    () => updateWorkOrderStatus(client, managerA, workOrder.id, { status: 'In Progress' }),
    /remains historical/,
  );
  await assert.rejects(
    () => assignMechanic(client, managerA, workOrder.id, { mechanic_user_id: 'u-mech-1' }),
    /remains historical/,
  );
});

test('a cancelled work order is terminal and keeps a structured reason', async () => {
  const client = seedClient();
  const workOrder = await openWorkOrder(client);
  const cancelled = await updateWorkOrderStatus(client, managerA, workOrder.id, {
    status: 'Cancelled', reason_code: 'customer_withdrew',
  });
  assert.equal(cancelled.workOrder.status, 'Cancelled');
  assert.ok(cancelled.workOrder.cancelled_at);
  assert.equal(cancelled.workOrder.cancellation_reason_code, 'customer_withdrew');
  await assert.rejects(
    () => updateWorkOrderStatus(client, managerA, workOrder.id, { status: 'Completed' }),
    /remains historical/,
  );
});

test('recorded money always carries a currency, and absent cost stays absent', async () => {
  const client = seedClient();
  const workOrder = await openWorkOrder(client);

  await assert.rejects(
    () => updateWorkOrderStatus(client, managerA, workOrder.id, { status: 'Completed', total_cost: 120 }),
    /currency .* is required/,
    'no USD is assumed',
  );

  const done = await updateWorkOrderStatus(client, managerA, workOrder.id, {
    status: 'Completed', total_cost: 120, currency: 'usd',
  });
  assert.equal(done.workOrder.total_cost, 120);
  assert.equal(done.workOrder.currency, 'USD');

  // A work order completed without a recorded cost must not gain a fabricated zero.
  const client2 = seedClient();
  const wo2 = await openWorkOrder(client2);
  const done2 = await updateWorkOrderStatus(client2, managerA, wo2.id, { status: 'Completed' });
  assert.equal(done2.workOrder.currency ?? null, null);
  assert.notEqual(done2.workOrder.total_cost, 0, 'absent cost must not be recorded as zero');
});

test('another tenant cannot read or act on this work order', async () => {
  const client = seedClient();
  const workOrder = await openWorkOrder(client);
  await assert.rejects(() => getWorkOrderAssignment(client, managerB, workOrder.id), /not found/i);
  await assert.rejects(() => updateWorkOrderStatus(client, managerB, workOrder.id, { status: 'Completed' }), /not found/i);
  await assert.rejects(() => assignMechanic(client, managerB, workOrder.id, { mechanic_user_id: 'u-mech-b' }), /not found/i);
});

test('reads tolerate legacy status values instead of crashing on them', async () => {
  // The legacy 006 shape defaults status to 'pending', outside the API vocabulary.
  const client = seedClient({
    mechanic_work_orders: [{
      id: 'wo-legacy', tenant_id: TENANT_A, vin: VIN, status: 'pending', mechanic_id: 'u-mech-1',
    }],
  });
  const view = await getWorkOrderAssignment(client, managerA, 'wo-legacy');
  assert.equal(view.work_order_id, 'wo-legacy');
  assert.equal(view.assigned, false, 'the legacy mechanic_id column is not the assignment authority');

  // A legacy row is not terminal, so it can still be moved into the pinned vocabulary.
  const moved = await updateWorkOrderStatus(client, managerA, 'wo-legacy', { status: 'Completed' });
  assert.equal(moved.workOrder.status, 'Completed');
});
