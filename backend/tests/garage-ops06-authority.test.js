import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { supabaseOver } from './helpers/pgliteLedgerHarness.js';
import { createGarageFinalWorld, seedAcceptedCase } from './helpers/garageFinalWorld.js';
import {
  consumeForService,
  countStock,
  createPart,
  getPart,
  listParts,
  listWorkOrderParts,
  receiveStock,
  reverseUsage,
  stockState,
  updatePart,
} from '../services/garageOperations/garageStockService.js';

const OPS04 = '20261024100000_garage_ops04_estimates_and_authorization.sql';
const OPS05 = '20261024110000_garage_ops05_workshop_execution_gates.sql';
const OPS06 = '20261024120000_garage_ops06_parts_stock.sql';
let world;
let db;
let client;
let n = 0;

const garageActor = (id, tenant, role = 'admin') => ({ id, role: 'owner', activeTenant: { id: tenant, type: 'garage', role } });
const admin = () => garageActor('admin-a', world.T.a);
const mech = () => garageActor('mech-a', world.T.a, 'mechanic');
const sku = () => `S-${Date.now()}-${++n}`;

async function rejects(promise, { name, pattern } = {}) {
  try { await promise; } catch (error) {
    if (name) assert.equal(error.constructor.name, name, `expected ${name}, got ${error.constructor.name}: ${error.message}`);
    if (pattern) assert.match(error.message, pattern);
    return error;
  }
  assert.fail('expected a rejection');
}
async function activeJob() {
  const c = await seedAcceptedCase(world);
  await db.query("SELECT mechanic_work_order_decide_authorization($1,$2,'customer-a','owner',NULL,'owner','authorized',NULL)", [c.workOrderId, c.vin]);
  await db.query('INSERT INTO work_order_assignments (work_order_id,tenant_id,mechanic_user_id,assigned_by_user_id) VALUES ($1,$2,$3,$4)', [c.workOrderId, c.tenant, 'mech-a', 'admin-a']);
  await db.query("UPDATE service_cases SET status='active' WHERE id=$1", [c.caseId]);
  const { rows: [r] } = await db.query(
    `INSERT INTO service_records (work_order_id,service_case_id,tenant_id,vin,work_performed,service_authority,recorded_by_user_id,performed_at)
     VALUES ($1,$2,$3,$4,'Brakes','garage_stated','mech-a',now()) RETURNING id`, [c.workOrderId, c.caseId, c.tenant, c.vin]);
  return { ...c, recordId: r.id };
}

before(async () => {
  world = await createGarageFinalWorld({ after: [OPS04, OPS05, OPS06] });
  db = world.db;
  client = supabaseOver(db);
});
after(async () => { await db?.close(); });

test('stock state is honest: unknown, uncounted, out, low (only with a stated threshold), in stock', () => {
  assert.equal(stockState({ stock_level: null, counted: true }), 'unknown');
  assert.equal(stockState({ stock_level: 8, counted: false }), 'uncounted');
  assert.equal(stockState({ stock_level: 0, counted: true }), 'out');
  assert.equal(stockState({ stock_level: 2, min_stock: 3, counted: true }), 'low');
  assert.equal(stockState({ stock_level: 2, min_stock: null, counted: true }), 'in_stock', 'no threshold stated -> never "low"');
  assert.equal(stockState({ stock_level: 5, min_stock: 3, counted: true }), 'in_stock');
});

test('creating a part states the opening count and refuses invented values', async () => {
  await rejects(createPart(client, admin(), { name: 'Pad', sku: sku() }), { name: 'ValidationError', pattern: /opening_quantity is required/ });
  await rejects(createPart(client, admin(), { name: 'Pad', sku: sku(), opening_quantity: -1 }), { name: 'ValidationError' });
  await rejects(createPart(client, admin(), { name: 'Pad', sku: sku(), opening_quantity: 1.5 }), { name: 'ValidationError' });
  await rejects(createPart(client, admin(), { name: 'Pad', sku: sku(), opening_quantity: 3, unit_cost: 5 }), { name: 'ValidationError', pattern: /price_currency/ });
  await rejects(createPart(client, admin(), { name: '', sku: sku(), opening_quantity: 3 }), { name: 'ValidationError' });
  const created = await createPart(client, admin(), { name: 'Brake pad', sku: sku(), opening_quantity: 0 });
  assert.equal(created.part.stock_level, 0);
  assert.equal(created.part.stock_state, 'out');
  assert.equal(created.part.min_stock, null);
  assert.equal(created.part.supplier, null);
  assert.equal(created.part.unit_cost, null);
  assert.equal(created.part.legacy_price_currency_unknown, false);
  assert.equal(created.movements[0].movement_type, 'opening');
});

test('money and supplier are recorded exactly as stated, with an explicit currency', async () => {
  const s = sku();
  const { part } = await createPart(client, admin(), {
    name: 'Oil filter', sku: s, opening_quantity: 20, min_stock: 5, supplier: 'Harare Spares', unit_cost: '3.20', sell_price: 7.5, price_currency: 'USD' });
  assert.equal(part.supplier, 'Harare Spares');
  assert.equal(part.unit_cost, '3.20');
  assert.equal(part.sell_price, '7.50');
  assert.equal(part.price_currency, 'USD');
  await rejects(createPart(client, admin(), { name: 'x', sku: sku(), opening_quantity: 1, unit_cost: '3.123', price_currency: 'USD' }), { name: 'ValidationError', pattern: /decimal places/ });
  await rejects(createPart(client, admin(), { name: 'x', sku: sku(), opening_quantity: 1, unit_cost: 3, price_currency: 'usd' }), { name: 'ValidationError' });
  const edited = await updatePart(client, admin(), part.id, { supplier: null, min_stock: 8, sell_price: '8.00' });
  assert.equal(edited.part.supplier, null);
  assert.equal(edited.part.min_stock, 8);
  assert.equal(edited.part.sell_price, '8.00');
  assert.equal(edited.part.stock_level, 20, 'metadata edits never touch the quantity');
  await rejects(updatePart(client, admin(), part.id, {}), { name: 'ValidationError', pattern: /Nothing to update/ });
});

test('duplicate SKU is a conflict; a retried create (same key) is not a duplicate', async () => {
  const s = sku();
  const key = `idem-${s}-aaaa`;
  const first = await createPart(client, admin(), { name: 'A', sku: s, opening_quantity: 4, idempotency_key: key });
  const retry = await createPart(client, admin(), { name: 'A', sku: s, opening_quantity: 4, idempotency_key: key });
  assert.equal(retry.part.id, first.part.id);
  assert.equal(retry.movements.length, 1);
  await rejects(createPart(client, admin(), { name: 'B', sku: s.toLowerCase(), opening_quantity: 1 }), { name: 'ConflictError', pattern: /already exists/ });
});

test('authority: a mechanic reads stock but cannot manage it; another garage sees and changes nothing', async () => {
  const { part } = await createPart(client, admin(), { name: 'Private part', sku: sku(), opening_quantity: 3 });
  assert.ok((await listParts(client, mech())).parts.some((p) => p.id === part.id));
  await rejects(createPart(client, mech(), { name: 'x', sku: sku(), opening_quantity: 1 }), { name: 'ForbiddenError' });
  await rejects(receiveStock(client, mech(), part.id, { quantity: 1 }), { name: 'ForbiddenError' });
  await rejects(countStock(client, mech(), part.id, { counted_quantity: 1, reason: 'x' }), { name: 'ForbiddenError' });
  await rejects(updatePart(client, mech(), part.id, { name: 'hack' }), { name: 'ForbiddenError' });
  const other = garageActor('admin-b', world.T.b);
  assert.ok(!(await listParts(client, other)).parts.some((p) => p.id === part.id));
  await rejects(getPart(client, other, part.id), { name: 'NotFoundError' });
  await rejects(receiveStock(client, other, part.id, { quantity: 1 }), { name: 'NotFoundError' });
  await rejects(listParts(client, { id: 'customer-a', activeTenant: null }), { name: 'ForbiddenError' });
  await rejects(listParts(client, garageActor('x', world.T.a, 'member')), { name: 'ForbiddenError' });
});

test('legacy quantities are shown as UNCOUNTED (with the legacy price flagged), never trusted or hidden', async () => {
  await db.query("INSERT INTO mechanic_parts (tenant_id,name,sku,stock_level,unit_price) VALUES ($1,'Legacy pad','LEGACY-A',8,25)", [world.T.a]);
  const legacy = (await listParts(client, admin())).parts.find((p) => p.sku === 'LEGACY-A');
  assert.equal(legacy.stock_state, 'uncounted');
  assert.equal(legacy.counted, false);
  assert.equal(legacy.stock_level, 8);
  assert.equal(legacy.legacy_unit_price, '25');
  assert.equal(legacy.legacy_price_currency_unknown, true);
  assert.equal(legacy.unit_cost, null, 'a legacy price with no currency is not money');
  const counted = await countStock(client, admin(), legacy.id, { counted_quantity: 7 });
  assert.equal(counted.part.stock_state, 'in_stock');
  assert.equal(counted.movements[0].movement_type, 'opening');
  const { summary } = await listParts(client, admin());
  assert.equal(typeof summary.uncounted, 'number');
});

test('receiving, counting and the ledger view', async () => {
  const { part } = await createPart(client, admin(), { name: 'Wipers', sku: sku(), opening_quantity: 5 });
  await receiveStock(client, admin(), part.id, { quantity: 10, reason: 'purchase' });
  await rejects(receiveStock(client, admin(), part.id, { quantity: 0 }), { name: 'ValidationError' });
  await rejects(countStock(client, admin(), part.id, { counted_quantity: 15, reason: 'recount' }), { name: 'ConflictError', pattern: /nothing to adjust/ });
  await rejects(countStock(client, admin(), part.id, { counted_quantity: 12 }), { name: 'ValidationError', pattern: /Give a reason/ });
  const adj = await countStock(client, admin(), part.id, { counted_quantity: 12, reason: 'damaged' });
  assert.equal(adj.part.stock_level, 12);
  assert.deepEqual(adj.movements.map((m) => m.movement_type), ['adjustment', 'receipt', 'opening']);
  assert.deepEqual(adj.movements.map((m) => m.balance_after), [12, 15, 5]);
});

test('USING A PART ON A JOB: only actual work, never beyond stock, exactly once per request, reversible', async () => {
  const job = await activeJob();
  const { part } = await createPart(client, admin(), { name: 'Brake pad', sku: sku(), opening_quantity: 4, unit_cost: 6, sell_price: 11, price_currency: 'USD' });
  const key = `use-${part.id}-1`;
  const used = await consumeForService(client, mech(), job.recordId, { part_id: part.id, quantity: 3, idempotency_key: key });
  assert.equal(used.balance_after, 1);
  const replay = await consumeForService(client, mech(), job.recordId, { part_id: part.id, quantity: 3, idempotency_key: key });
  assert.equal(replay.replayed, true);
  assert.equal((await getPart(client, mech(), part.id)).part.stock_level, 1);

  const e = await rejects(consumeForService(client, mech(), job.recordId, { part_id: part.id, quantity: 2 }), { name: 'ConflictError' });
  assert.match(e.message, /Only 1 in stock; 2 requested/);
  await rejects(consumeForService(client, mech(), job.recordId, { part_id: part.id, quantity: 0 }), { name: 'ValidationError' });
  await rejects(consumeForService(client, mech(), job.recordId, { part_id: part.id }), { name: 'ValidationError' });
  await rejects(consumeForService(client, garageActor('admin-b', world.T.b), job.recordId, { part_id: part.id, quantity: 1 }), { name: 'NotFoundError' });
  await rejects(consumeForService(client, { id: 'customer-a', activeTenant: null }, job.recordId, { part_id: part.id, quantity: 1 }), { name: 'ForbiddenError' });

  const parts = await listWorkOrderParts(client, mech(), job.workOrderId);
  assert.equal(parts.usage.length, 1);
  assert.equal(parts.usage[0].quantity, 3);
  assert.equal(parts.usage[0].sell_price_snapshot, '11.00');
  assert.equal(parts.usage[0].price_currency_snapshot, 'USD');
  assert.equal(parts.usage[0].active, true);

  const undone = await reverseUsage(client, mech(), parts.usage[0].id, { reason: 'Wrong part' });
  assert.equal(undone.balance_after, 4);
  assert.equal((await listWorkOrderParts(client, mech(), job.workOrderId)).usage[0].active, false);
  await rejects(reverseUsage(client, mech(), parts.usage[0].id, { reason: 'again' }), { name: 'ConflictError', pattern: /already been reversed/ });
  await rejects(reverseUsage(client, mech(), parts.usage[0].id, {}), { name: 'ValidationError' });
});

test('using a part is refused before the work starts or without the customer\'s authorization', async () => {
  const { part } = await createPart(client, admin(), { name: 'Hose', sku: sku(), opening_quantity: 3 });
  const early = await seedAcceptedCase(world);
  await db.query("SELECT mechanic_work_order_decide_authorization($1,$2,'customer-a','owner',NULL,'owner','authorized',NULL)", [early.workOrderId, early.vin]);
  // a service record cannot even exist yet (OPS05), so there is nothing to consume against
  await rejects(consumeForService(client, mech(), '00000000-0000-0000-0000-000000000000', { part_id: part.id, quantity: 1 }), { name: 'NotFoundError' });
  const job = await activeJob();
  await db.query("SELECT mechanic_work_order_decide_authorization($1,$2,'customer-a','owner',NULL,'owner','revoked','x')", [job.workOrderId, job.vin]);
  await rejects(consumeForService(client, mech(), job.recordId, { part_id: part.id, quantity: 1 }), { name: 'ConflictError', pattern: /withdrew their authorization/ });
  assert.equal((await getPart(client, mech(), part.id)).part.stock_level, 3);
});
