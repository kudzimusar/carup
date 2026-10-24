import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createGarageFinalWorld, postgrestOver } from './helpers/garageFinalWorld.js';
import { deriveNextAction } from '../services/serviceNetwork/nextAction.js';
import { allowedActions } from '../services/serviceNetwork/allowedActions.js';
import { getCaseHub } from '../services/garageOperations/garageHubService.js';
import { completeJob, startServiceCase } from '../services/serviceNetwork/serviceCaseService.js';
import { recordService } from '../services/serviceNetwork/serviceRecordService.js';
import { assignMechanic, createWorkOrderForCase } from '../services/serviceNetwork/workOrderAssignmentService.js';
import { createEstimateForCase, decideMyEstimate, reviseEstimate, sendEstimate } from '../services/garageOperations/garageEstimateService.js';
import { consumeForService, createPart } from '../services/garageOperations/garageStockService.js';
import { issueInvoice, recordPayment, reversePayment, voidInvoice } from '../services/garageOperations/garageInvoiceService.js';

const OPS = [
  '20261024100000_garage_ops04_estimates_and_authorization.sql',
  '20261024110000_garage_ops05_workshop_execution_gates.sql',
  '20261024120000_garage_ops06_parts_stock.sql',
  '20261024130000_garage_ops07_invoice_payment_receipt.sql',
];
let world; let db; let client; let n = 0;
const garageActor = (id, tenant, role = 'admin') => ({ id, role: 'owner', activeTenant: { id: tenant, type: 'garage', role } });
const person = (id) => ({ id, role: 'owner', activeTenant: null });
const adminA = () => garageActor('admin-a', world.T.a);
const mechA = () => garageActor('mech-a', world.T.a, 'mechanic');
const noEmit = { emitDomainEvent: async () => ({}) };
const LINES = [{ category: 'labour', description: 'Service', quantity: 1, unit_price: 100 }];

async function rejects(promise, pattern) {
  try { await promise; } catch (error) { if (pattern) assert.match(error.message, pattern); return error; }
  assert.fail('expected a rejection');
}
async function newCase() {
  const { rows: [c] } = await db.query(
    "INSERT INTO service_cases (vin,garage_tenant_id,branch_id,requester_user_id,status) VALUES ($1,$2,$3,'customer-a','accepted') RETURNING id",
    [world.V.a, world.T.a, world.B.a1]);
  return c.id;
}
const hub = (caseId, actor = adminA()) => getCaseHub(client, actor, caseId);

before(async () => {
  world = await createGarageFinalWorld({ after: OPS });
  db = world.db; client = postgrestOver(db);
});
after(async () => { await db?.close(); });

test('pure ladder: next action and allowed actions for every recorded state', () => {
  const wo = (o = {}) => ({ owner_authorization: 'pending', status: 'In Progress', assigned_mechanic_user_id: null, ...o });
  const rows = [
    [{ caseStatus: 'requested' }, 'accept_or_decline'],
    [{ caseStatus: 'accepted' }, 'prepare_estimate'],
    [{ caseStatus: 'accepted', workOrder: wo() }, 'prepare_estimate'],
    [{ caseStatus: 'accepted', workOrder: wo(), estimate: { status: 'draft' } }, 'send_estimate'],
    [{ caseStatus: 'accepted', workOrder: wo(), estimate: { status: 'sent' } }, 'await_customer'],
    [{ caseStatus: 'accepted', workOrder: wo({ owner_authorization: 'declined' }), estimate: { status: 'declined' } }, 'revise_estimate'],
    [{ caseStatus: 'accepted', workOrder: wo({ owner_authorization: 'authorized' }) }, 'assign_mechanic'],
    [{ caseStatus: 'accepted', workOrder: wo({ owner_authorization: 'authorized', assigned_mechanic_user_id: 'm' }) }, 'start_work'],
    [{ caseStatus: 'accepted', workOrder: wo({ owner_authorization: 'revoked' }) }, 'authorization_revoked'],
    [{ caseStatus: 'active', workOrder: wo({ owner_authorization: 'authorized' }), serviceRecordCount: 0 }, 'record_service'],
    [{ caseStatus: 'active', workOrder: wo({ owner_authorization: 'authorized' }), serviceRecordCount: 2 }, 'complete_job'],
    [{ caseStatus: 'active', workOrder: wo({ owner_authorization: 'revoked' }), serviceRecordCount: 2 }, 'authorization_revoked'],
    [{ caseStatus: 'completed' }, 'issue_invoice'],
    [{ caseStatus: 'completed', invoice: { status: 'issued', payment_status: 'unpaid' } }, 'await_payment'],
    [{ caseStatus: 'completed', invoice: { status: 'issued', payment_status: 'partially_paid' } }, 'await_payment'],
    [{ caseStatus: 'completed', invoice: { status: 'issued', payment_status: 'paid' } }, 'none'],
    [{ caseStatus: 'completed', invoice: { status: 'voided' } }, 'issue_invoice'],
    [{ caseStatus: 'declined' }, 'none'],
    [{ caseStatus: 'cancelled' }, 'none'],
  ];
  for (const [facts, expected] of rows) assert.equal(deriveNextAction(facts), expected, JSON.stringify(facts));
  // a missing authorization reads as pending, never authorized
  assert.equal(deriveNextAction({ caseStatus: 'accepted', workOrder: { status: 'In Progress', assigned_mechanic_user_id: 'm' } }), 'prepare_estimate');
  // money is admin-only
  assert.ok(allowedActions({ caseStatus: 'completed', isAdmin: true }).includes('issue_invoice'));
  assert.deepEqual(allowedActions({ caseStatus: 'completed', isAdmin: false }), []);
  assert.ok(!allowedActions({ caseStatus: 'accepted', isAdmin: false }).includes('prepare_estimate'));
});

test('HUB = BACKEND: at every stage, an action the hub withholds is refused by the backend, and one it offers succeeds', async () => {
  const caseId = await newCase();

  // 1. accepted, no job yet
  let h = await hub(caseId);
  assert.equal(h.next_action, 'prepare_estimate');
  assert.deepEqual(h.allowed_actions.sort(), ['prepare_estimate']);
  assert.equal(h.work_order, null);
  await rejects(startServiceCase(client, adminA(), caseId, noEmit), /no job|Prepare an estimate/);

  // 2. a draft estimate exists
  const draft = await createEstimateForCase(client, adminA(), caseId, { currency: 'USD', lines: LINES, internal_note: 'margin' });
  h = await hub(caseId);
  assert.equal(h.next_action, 'send_estimate');
  assert.ok(h.allowed_actions.includes('send_estimate') && h.allowed_actions.includes('edit_estimate') && h.allowed_actions.includes('assign_mechanic'));
  assert.ok(!h.allowed_actions.includes('start_work') && !h.allowed_actions.includes('prepare_estimate'));
  assert.equal(h.estimates.latest.internal_note, 'margin', 'the admin sees the garage-private note');
  await rejects(startServiceCase(client, adminA(), caseId, noEmit), /has not authorized this work yet/);

  // 3. sent -> waiting for the customer
  await sendEstimate(client, adminA(), draft.id, noEmit);
  h = await hub(caseId);
  assert.equal(h.next_action, 'await_customer');
  assert.ok(h.allowed_actions.includes('revise_estimate') && !h.allowed_actions.includes('send_estimate'));
  await rejects(sendEstimate(client, adminA(), draft.id, noEmit), /Only a draft/);

  // 4. customer authorizes; nobody assigned
  await decideMyEstimate(client, person('customer-a'), draft.id, { decision: 'accept' });
  h = await hub(caseId);
  assert.equal(h.work_order.owner_authorization, 'authorized');
  assert.equal(h.next_action, 'assign_mechanic');
  assert.ok(h.allowed_actions.includes('assign_mechanic') && !h.allowed_actions.includes('start_work'));
  assert.ok(!h.allowed_actions.includes('prepare_estimate') && !h.allowed_actions.includes('revise_estimate'));
  await rejects(startServiceCase(client, adminA(), caseId, noEmit), /Assign a mechanic/);
  await rejects(reviseEstimate(client, adminA(), draft.id), /Only the latest sent or declined|settled|authorized/);

  // 5. assigned -> start is offered, and works
  await assignMechanic(client, adminA(), h.work_order.id, { mechanic_user_id: 'mech-a' });
  h = await hub(caseId);
  assert.equal(h.next_action, 'start_work');
  assert.ok(h.allowed_actions.includes('start_work'));
  assert.ok(h.mechanics.some((m) => m.user_id === 'mech-a' || m.id === 'mech-a' || JSON.stringify(m).includes('mech-a')), 'the assignment picker is part of the hub');
  await startServiceCase(client, mechA(), caseId, noEmit);

  // 6. active, nothing recorded: record is offered, complete is NOT (and is refused)
  h = await hub(caseId, mechA());
  assert.equal(h.next_action, 'record_service');
  assert.ok(h.allowed_actions.includes('record_service'));
  assert.ok(!h.allowed_actions.includes('complete_job') && !h.allowed_actions.includes('use_part'));
  await rejects(completeJob(client, mechA(), caseId, noEmit), /Record the work/);

  // 7. recorded: complete + parts offered
  const { record } = await recordService(client, mechA(), h.work_order.id, { work_performed: 'Done', total_cost: 100, currency: 'USD' });
  h = await hub(caseId, mechA());
  assert.equal(h.next_action, 'complete_job');
  assert.ok(h.allowed_actions.includes('complete_job') && h.allowed_actions.includes('use_part'));
  const part = (await createPart(client, adminA(), { name: 'Pad', sku: `HUB-${++n}`, opening_quantity: 3, sell_price: 20, unit_cost: 8, price_currency: 'USD' })).part;
  await consumeForService(client, mechA(), record.id, { part_id: part.id, quantity: 1 });
  h = await hub(caseId, mechA());
  assert.equal(h.parts_used.length, 1);
  assert.equal(h.service_records.length, 1);
  assert.equal(h.service_records[0].work_performed, 'Done', 'the workshop sees what was done');
  await completeJob(client, mechA(), caseId, noEmit);

  // 8. completed: a mechanic sees no money at all
  const mechView = await hub(caseId, mechA());
  assert.equal(mechView.closeout, null);
  assert.deepEqual(mechView.allowed_actions, []);
  assert.deepEqual(mechView.mechanics, []);
  assert.equal(mechView.viewer.is_admin, false);
  await rejects(issueInvoice(client, mechA(), caseId, { currency: 'USD', lines: LINES }), /./);

  // 9. completed, admin: invoice offered; then payments
  h = await hub(caseId);
  assert.equal(h.next_action, 'issue_invoice');
  assert.deepEqual(h.allowed_actions.sort(), ['issue_invoice']);
  assert.equal(h.closeout.can_issue_invoice, true);
  const invoice = await issueInvoice(client, adminA(), caseId, { currency: 'USD', lines: LINES }, noEmit);
  h = await hub(caseId);
  assert.equal(h.next_action, 'await_payment');
  assert.ok(h.allowed_actions.includes('record_payment') && h.allowed_actions.includes('void_invoice') && !h.allowed_actions.includes('issue_invoice'));
  const paid = await recordPayment(client, adminA(), invoice.id, { amount: 40, method: 'cash' }, noEmit);
  h = await hub(caseId);
  assert.ok(h.allowed_actions.includes('record_payment') && !h.allowed_actions.includes('void_invoice') && h.allowed_actions.includes('reverse_payment'));
  await rejects(voidInvoice(client, adminA(), invoice.id, { reason: 'x' }), /Reverse them before voiding/);
  await recordPayment(client, adminA(), invoice.id, { amount: 60, method: 'cash' }, noEmit);
  h = await hub(caseId);
  assert.equal(h.next_action, 'none');
  assert.ok(!h.allowed_actions.includes('record_payment'));
  await rejects(recordPayment(client, adminA(), invoice.id, { amount: 1, method: 'cash' }, noEmit), /more than the invoice balance/);
  void reversePayment; void paid;
  assert.deepEqual(h.history.map((e) => e.event_type).slice(-2), ['service.work.started', 'service.case.completed']);
});

test('the hub never leaks across garages and states unknowns honestly', async () => {
  const caseId = await newCase();
  await rejects(getCaseHub(client, garageActor('admin-b', world.T.b), caseId), /not found/i);
  await rejects(getCaseHub(client, person('customer-a'), caseId), /Select the garage/);
  const h = await hub(caseId);
  assert.equal(h.work_order, null);
  assert.equal(h.appointment, null);
  assert.deepEqual(h.service_records, []);
  assert.deepEqual(h.parts_used, []);
  assert.equal(h.estimates.latest, null);
});
