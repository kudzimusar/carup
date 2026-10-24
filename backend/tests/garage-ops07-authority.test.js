import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createGarageFinalWorld, postgrestOver } from './helpers/garageFinalWorld.js';
import { completeJob, startServiceCase } from '../services/serviceNetwork/serviceCaseService.js';
import { recordService } from '../services/serviceNetwork/serviceRecordService.js';
import { assignMechanic, createWorkOrderForCase } from '../services/serviceNetwork/workOrderAssignmentService.js';
import { createEstimateForCase, decideMyEstimate, sendEstimate } from '../services/garageOperations/garageEstimateService.js';
import { consumeForService, createPart } from '../services/garageOperations/garageStockService.js';
import {
  PAYMENT_SOURCE_LABEL,
  getCloseout,
  getInvoice,
  issueInvoice,
  listInvoices,
  listMyInvoices,
  recordPayment,
  reversePayment,
  suggestLines,
  varianceOf,
  voidInvoice,
} from '../services/garageOperations/garageInvoiceService.js';

const OPS = [
  '20261024100000_garage_ops04_estimates_and_authorization.sql',
  '20261024110000_garage_ops05_workshop_execution_gates.sql',
  '20261024120000_garage_ops06_parts_stock.sql',
  '20261024130000_garage_ops07_invoice_payment_receipt.sql',
];
let world;
let db;
let client;
let n = 0;

const garageActor = (id, tenant, role = 'admin') => ({ id, role: 'owner', activeTenant: { id: tenant, type: 'garage', role } });
const person = (id) => ({ id, role: 'owner', activeTenant: null });
const noEmit = { emitDomainEvent: async () => ({}) };
const adminA = () => garageActor('admin-a', world.T.a);
const mechA = () => garageActor('mech-a', world.T.a, 'mechanic');

async function rejects(promise, { name, pattern } = {}) {
  try { await promise; } catch (error) {
    if (name) assert.equal(error.constructor.name, name, `expected ${name}, got ${error.constructor.name}: ${error.message}`);
    if (pattern) assert.match(error.message, pattern);
    return error;
  }
  assert.fail('expected a rejection');
}

/** Drives the REAL services from an accepted request all the way to a completed job. */
async function runJobToCompletion({ withEstimate = true, withPart = true } = {}) {
  const { rows: [c] } = await db.query(
    "INSERT INTO service_cases (vin,garage_tenant_id,branch_id,requester_user_id,status) VALUES ($1,$2,$3,'customer-a','accepted') RETURNING id",
    [world.V.a, world.T.a, world.B.a1]);
  const { workOrder } = await createWorkOrderForCase(client, adminA(), c.id, {});
  let estimate = null;
  if (withEstimate) {
    estimate = await createEstimateForCase(client, adminA(), c.id, {
      currency: 'USD', lines: [{ category: 'labour', description: 'Brake service', quantity: 2, unit_price: 45 }, { category: 'part', description: 'Pads', quantity: 1, unit_price: 80.5 }] });
    await sendEstimate(client, adminA(), estimate.id);
    await decideMyEstimate(client, person('customer-a'), estimate.id, { decision: 'accept' });
  } else {
    await db.query("SELECT mechanic_work_order_decide_authorization($1,$2,'customer-a','owner',NULL,'owner','authorized',NULL)", [workOrder.id, world.V.a]);
  }
  await assignMechanic(client, adminA(), workOrder.id, { mechanic_user_id: 'mech-a' });
  await startServiceCase(client, adminA(), c.id, noEmit);
  const { record } = await recordService(client, mechA(), workOrder.id, { work_performed: 'Replaced pads', service_category: 'brakes', total_cost: 100, currency: 'USD' });
  let part = null;
  if (withPart) {
    part = (await createPart(client, adminA(), { name: 'Brake pads', sku: `BP-${Date.now()}-${++n}`, opening_quantity: 5, unit_cost: 30, sell_price: 55, price_currency: 'USD' })).part;
    await consumeForService(client, mechA(), record.id, { part_id: part.id, quantity: 1 });
  }
  await completeJob(client, mechA(), c.id, noEmit);
  return { caseId: c.id, workOrderId: workOrder.id, estimate, record, part };
}

before(async () => {
  world = await createGarageFinalWorld({ after: OPS });
  db = world.db;
  client = postgrestOver(db);
});
after(async () => { await db?.close(); });

test('pure helpers: the suggestion never converts currency and never turns "not recorded" into free; variance only when comparable', () => {
  const s = suggestLines({
    records: [{ id: 'r1', service_category: 'brakes', total_cost: '100', currency: 'USD' }, { id: 'r2', service_category: null, total_cost: null, currency: null }],
    usage: [{ id: 'u1', part_name_snapshot: 'Pads', quantity: 2, sell_price_snapshot: '55.00', price_currency_snapshot: 'USD', reversed_at: null },
      { id: 'u2', part_name_snapshot: 'Oil', quantity: 1, sell_price_snapshot: null, price_currency_snapshot: null, reversed_at: null },
      { id: 'u3', part_name_snapshot: 'Reversed', quantity: 1, sell_price_snapshot: '9.00', price_currency_snapshot: 'USD', reversed_at: '2026-10-24' }],
  });
  assert.equal(s.currency, 'USD');
  assert.equal(s.lines.length, 4, 'a reversed usage is not suggested');
  assert.equal(s.lines.find((l) => l.description === 'Oil').unit_price, null);
  assert.ok(s.notes.some((x) => /not zero|not free/.test(x)));
  const mixed = suggestLines({
    records: [{ id: 'r1', service_category: 'x', total_cost: '100', currency: 'USD' }, { id: 'r2', service_category: 'y', total_cost: '900', currency: 'ZAR' }], usage: [] });
  assert.equal(mixed.currency, null, 'two currencies: no currency is chosen for the garage');
  assert.ok(mixed.notes.some((x) => /never converted/.test(x)));

  assert.deepEqual(varianceOf(null), { state: 'no_estimate' });
  assert.deepEqual(varianceOf({ estimate_id: null }), { state: 'no_estimate' });
  assert.equal(varianceOf({ estimate_id: 'e', currency: 'USD', estimate_currency: 'ZAR', total_amount: '10', estimate_total_amount: '10' }).state, 'not_comparable');
  assert.deepEqual(
    varianceOf({ estimate_id: 'e', currency: 'USD', estimate_currency: 'USD', total_amount: '105.00', estimate_total_amount: '170.50' }),
    { state: 'comparable', currency: 'USD', estimate_total: '170.50', invoice_total: '105.00', difference: '-65.50', direction: 'under_estimate' });
  assert.equal(varianceOf({ estimate_id: 'e', currency: 'USD', estimate_currency: 'USD', total_amount: '0.30', estimate_total_amount: '0.20' }).difference, '+0.10', 'no float drift');
});

test('THE GOLDEN JOURNEY (garage side): estimate -> authorize -> work -> parts -> complete -> closeout -> invoice -> payments -> paid', async () => {
  const job = await runJobToCompletion();

  const closeout = await getCloseout(client, adminA(), job.caseId);
  assert.equal(closeout.can_issue_invoice, true);
  assert.equal(closeout.estimate.total_amount, '170.50');
  assert.equal(closeout.estimate.version, 1);
  assert.equal(closeout.actual_work.length, 1);
  assert.deepEqual(closeout.actual_work[0].cost, { amount: '100.00', currency: 'USD' });
  assert.equal('work_performed' in closeout.actual_work[0], false, 'the private work narrative is not part of the commercial statement');
  assert.equal(closeout.parts_used.length, 1);
  assert.deepEqual(closeout.recorded_cost_by_currency, [{ currency: 'USD', total: '100.00' }]);
  assert.equal(closeout.suggested_invoice.currency, 'USD');
  assert.equal(closeout.suggested_invoice.lines.length, 2);
  assert.equal(closeout.invoice, null);
  assert.deepEqual(closeout.variance, { state: 'awaiting_invoice' });
  assert.equal(closeout.payment_source_label, PAYMENT_SOURCE_LABEL);

  const invoice = await issueInvoice(client, adminA(), job.caseId, {
    currency: 'USD', customer_note: 'Thank you', internal_note: 'margin ok',
    lines: closeout.suggested_invoice.lines.map((l) => ({ ...l })),
  });
  assert.equal(invoice.status, 'issued');
  assert.equal(invoice.total_amount, '155.00', 'actual 100 + part 55 — the estimate (170.50) is not the amount');
  assert.equal(invoice.payment_status, 'unpaid');
  assert.equal(invoice.paid_amount, '0.00');
  assert.equal(invoice.variance.direction, 'under_estimate');
  assert.equal(invoice.variance.difference, '-15.50');
  assert.equal(invoice.internal_note, 'margin ok');
  assert.deepEqual(invoice.receipts, []);

  const p1 = await recordPayment(client, adminA(), invoice.id, { amount: '100', method: 'mobile_money', reference: 'EC-7788' });
  assert.equal(p1.payment_status, 'partially_paid');
  assert.equal(p1.balance_amount, '55.00');
  assert.equal(p1.payment_source_label, PAYMENT_SOURCE_LABEL);
  assert.equal(p1.invoice.receipts.length, 1);
  assert.equal(p1.invoice.receipts[0].payment_source_label, PAYMENT_SOURCE_LABEL);
  const p2 = await recordPayment(client, adminA(), invoice.id, { amount: 55, method: 'cash' });
  assert.equal(p2.payment_status, 'paid');
  assert.equal(p2.invoice.receipts.length, 2);
  assert.deepEqual(p2.invoice.history.map((h) => h.event_type), ['issued', 'payment_recorded', 'payment_recorded']);

  const listing = await listInvoices(client, adminA());
  const mine = listing.invoices.find((i) => i.id === invoice.id);
  assert.equal(mine.payment_status, 'paid');
  assert.equal(listing.summary.paid >= 1, true);
  assert.deepEqual(listing.summary.outstanding_by_currency.filter((o) => o.currency === 'USD').every((o) => o.balance !== undefined), true);
});

test('THE GOLDEN JOURNEY (customer side): they see the invoice, payment state and receipts — never the garage\'s internals', async () => {
  const job = await runJobToCompletion();
  const invoice = await issueInvoice(client, adminA(), job.caseId, {
    currency: 'USD', customer_note: 'Thanks', internal_note: 'SECRET MARGIN',
    lines: [{ category: 'labour', description: 'Brake service', quantity: 1, unit_price: 100 }] });
  await recordPayment(client, adminA(), invoice.id, { amount: 40, method: 'bank_transfer', reference: 'REF-1' });

  const mineA = await listMyInvoices(client, person('customer-a'));
  const view = mineA.invoices.find((i) => i.id === invoice.id);
  assert.ok(view, 'the vehicle owner sees their invoice');
  assert.equal(view.payment_status, 'partially_paid');
  assert.equal(view.balance_amount, '60.00');
  assert.equal(view.payments.length, 1);
  assert.equal(view.receipts[0].payment_source_label, PAYMENT_SOURCE_LABEL);
  for (const hidden of ['internal_note', 'issued_by_user_id', 'void_reason', 'tenant_id', 'history']) {
    assert.equal(hidden in view, false, `customer view must not carry ${hidden}`);
  }
  assert.ok(!JSON.stringify(view).includes('SECRET MARGIN'));
  assert.deepEqual((await listMyInvoices(client, person('customer-b'))).invoices.filter((i) => i.id === invoice.id), []);
  assert.deepEqual((await listMyInvoices(client, person('stranger'))).invoices, []);
});

test('THE REFUSAL JOURNEY: estimate declined -> no authorized work, no service record, no stock use, no invoice, no payment', async () => {
  const { rows: [c] } = await db.query(
    "INSERT INTO service_cases (vin,garage_tenant_id,branch_id,requester_user_id,status) VALUES ($1,$2,$3,'customer-a','accepted') RETURNING id",
    [world.V.a, world.T.a, world.B.a1]);
  const { workOrder } = await createWorkOrderForCase(client, adminA(), c.id, {});
  const estimate = await createEstimateForCase(client, adminA(), c.id, { currency: 'USD', lines: [{ category: 'labour', description: 'Big job', quantity: 1, unit_price: 900 }] });
  await sendEstimate(client, adminA(), estimate.id);
  await decideMyEstimate(client, person('customer-a'), estimate.id, { decision: 'decline', reason: 'Too expensive' });
  await assignMechanic(client, adminA(), workOrder.id, { mechanic_user_id: 'mech-a' });

  await rejects(startServiceCase(client, adminA(), c.id, noEmit), { name: 'ConflictError', pattern: /declined this work/ });
  await rejects(recordService(client, mechA(), workOrder.id, { work_performed: 'x' }), { name: 'ConflictError' });
  await rejects(completeJob(client, adminA(), c.id, noEmit), { name: 'ConflictError' });
  await rejects(issueInvoice(client, adminA(), c.id, { currency: 'USD', lines: [{ category: 'labour', description: 'x', quantity: 1, unit_price: 900 }] }), { name: 'ConflictError', pattern: /once the job is complete/ });
  const closeout = await getCloseout(client, adminA(), c.id);
  assert.equal(closeout.can_issue_invoice, false);
  assert.equal(closeout.invoice, null);
  assert.equal(closeout.estimate, null, 'a declined estimate is not an accepted one');
  const { rows: [facts] } = await db.query(
    `SELECT (SELECT count(*)::int FROM service_records WHERE work_order_id=$1) records,
            (SELECT count(*)::int FROM garage_service_part_usage WHERE work_order_id=$1) usage,
            (SELECT count(*)::int FROM garage_invoices WHERE work_order_id=$1) invoices,
            (SELECT count(*)::int FROM garage_payment_records p JOIN garage_invoices i ON i.id=p.invoice_id WHERE i.work_order_id=$1) payments`, [workOrder.id]);
  assert.deepEqual(facts, { records: 0, usage: 0, invoices: 0, payments: 0 });
});

test('authority: invoices and payments are garage-admin only; another garage learns nothing; a customer cannot mark anything paid', async () => {
  const job = await runJobToCompletion({ withPart: false });
  const lines = [{ category: 'labour', description: 'Service', quantity: 1, unit_price: 100 }];
  await rejects(issueInvoice(client, mechA(), job.caseId, { currency: 'USD', lines }), { name: 'ForbiddenError' });
  await rejects(issueInvoice(client, person('customer-a'), job.caseId, { currency: 'USD', lines }), { name: 'ForbiddenError' });
  await rejects(issueInvoice(client, garageActor('admin-b', world.T.b), job.caseId, { currency: 'USD', lines }), { name: 'NotFoundError' });
  await rejects(getCloseout(client, mechA(), job.caseId), { name: 'ForbiddenError' });
  const invoice = await issueInvoice(client, adminA(), job.caseId, { currency: 'USD', lines });
  await rejects(recordPayment(client, mechA(), invoice.id, { amount: 10, method: 'cash' }), { name: 'ForbiddenError' });
  await rejects(recordPayment(client, person('customer-a'), invoice.id, { amount: 10, method: 'cash' }), { name: 'ForbiddenError' });
  await rejects(recordPayment(client, garageActor('admin-b', world.T.b), invoice.id, { amount: 10, method: 'cash' }), { name: 'NotFoundError' });
  await rejects(getInvoice(client, garageActor('admin-b', world.T.b), invoice.id), { name: 'NotFoundError' });
  await rejects(voidInvoice(client, mechA(), invoice.id, { reason: 'x' }), { name: 'ForbiddenError' });
  assert.equal((await getInvoice(client, adminA(), invoice.id)).payment_status, 'unpaid');
});

test('money refusals: wrong currency, over-collection, unknown method, bad amounts, every line priced', async () => {
  const job = await runJobToCompletion({ withPart: false });
  await rejects(issueInvoice(client, adminA(), job.caseId, { lines: [{ category: 'labour', description: 'x', quantity: 1, unit_price: 5 }] }), { name: 'ValidationError', pattern: /currency is required/ });
  await rejects(issueInvoice(client, adminA(), job.caseId, { currency: 'USD', lines: [{ category: 'labour', description: 'x', quantity: 1 }] }), { name: 'ValidationError', pattern: /price is required/ });
  await rejects(issueInvoice(client, adminA(), job.caseId, { currency: 'USD', lines: [{ category: 'labour', description: 'x', quantity: 1, unit_price: '1.234' }] }), { name: 'ValidationError', pattern: /decimal places/ });
  await rejects(issueInvoice(client, adminA(), job.caseId, { currency: 'USD', lines: [{ category: 'labour', description: 'x', quantity: 1, unit_price: 0 }] }), { name: 'ValidationError', pattern: /greater than zero/ });
  const invoice = await issueInvoice(client, adminA(), job.caseId, { currency: 'USD', lines: [{ category: 'labour', description: 'Service', quantity: 1, unit_price: 100 }] });
  await rejects(recordPayment(client, adminA(), invoice.id, { amount: 10, method: 'cash', currency: 'ZAR' }), { name: 'ValidationError', pattern: /never converted/ });
  await rejects(recordPayment(client, adminA(), invoice.id, { amount: 10, method: 'crypto' }), { name: 'ValidationError', pattern: /method must be/ });
  await rejects(recordPayment(client, adminA(), invoice.id, { amount: 0, method: 'cash' }), { name: 'ValidationError' });
  await rejects(recordPayment(client, adminA(), invoice.id, { amount: '10.999', method: 'cash' }), { name: 'ValidationError', pattern: /decimal places/ });
  await rejects(recordPayment(client, adminA(), invoice.id, { method: 'cash' }), { name: 'ValidationError', pattern: /amount is required/ });
  await rejects(recordPayment(client, adminA(), invoice.id, { amount: 100.01, method: 'cash' }), { name: 'ConflictError', pattern: /more than the invoice balance \(100\.00 remaining\)/ });
  assert.equal((await getInvoice(client, adminA(), invoice.id)).payment_status, 'unpaid');
});

test('duplicate payment callback: the same key records the money once; reversal restores the balance; voiding needs no payments', async () => {
  const job = await runJobToCompletion({ withPart: false });
  const invoice = await issueInvoice(client, adminA(), job.caseId, { currency: 'USD', lines: [{ category: 'labour', description: 'Service', quantity: 1, unit_price: 100 }] });
  const key = `dup-callback-${Date.now()}`;
  const a = await recordPayment(client, adminA(), invoice.id, { amount: 30, method: 'cash', idempotency_key: key });
  const b = await recordPayment(client, adminA(), invoice.id, { amount: 30, method: 'cash', idempotency_key: key });
  assert.equal(b.replayed, true);
  assert.equal(b.payment_id, a.payment_id);
  assert.equal((await getInvoice(client, adminA(), invoice.id)).paid_amount, '30.00');
  await rejects(voidInvoice(client, adminA(), invoice.id, { reason: 'wrong' }), { name: 'ConflictError', pattern: /Reverse them before voiding/ });
  const rev = await reversePayment(client, adminA(), a.payment_id, { reason: 'Wrong invoice' });
  assert.equal(rev.payment_status, 'unpaid');
  await rejects(reversePayment(client, adminA(), a.payment_id, { reason: 'again' }), { name: 'ConflictError', pattern: /already been reversed/ });
  const voided = await voidInvoice(client, adminA(), invoice.id, { reason: 'Issued in error' });
  assert.equal(voided.status, 'voided');
  assert.equal(voided.payment_status, 'voided');
  const customerView = (await listMyInvoices(client, person('customer-a'))).invoices.find((i) => i.id === invoice.id);
  assert.equal(customerView.void_reason, undefined, 'the garage\'s void reason stays internal');
  assert.ok(customerView.payments.every((p) => !('reason' in p)));
});
