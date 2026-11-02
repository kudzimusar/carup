import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createGarageFinalWorld, postgrestOver } from './helpers/garageFinalWorld.js';
import {
  cancelEstimate,
  createEstimateForCase,
  decideMyEstimate,
  getGarageEstimate,
  listCaseEstimates,
  listMyEstimates,
  reviseEstimate,
  sendEstimate,
  updateEstimateDraft,
} from '../services/garageOperations/garageEstimateService.js';
import { currencyScale, moneyAmount, requireCurrency, sumMoney } from '../utils/garageMoney.js';

const OPS04 = '20261024100000_garage_ops04_estimates_and_authorization.sql';
let world;
let db;
let client;

const garageActor = (id, tenant, role = 'admin') => ({ id, role: 'owner', activeTenant: { id: tenant, type: 'garage', role } });
const person = (id, role = 'owner') => ({ id, role, activeTenant: null });
const LINES = [
  { category: 'labour', description: 'Brake pad replacement', quantity: 2, unit_price: '45' },
  { category: 'part', description: 'Front pads', quantity: 1, unit_price: 80.5 },
];

async function rejects(promise, { name, pattern } = {}) {
  try { await promise; } catch (error) {
    if (name) assert.equal(error.constructor.name, name, `expected ${name}, got ${error.constructor.name}: ${error.message}`);
    if (pattern) assert.match(error.message, pattern);
    return error;
  }
  assert.fail('expected a rejection');
}
async function newCase({ garage = 'a', vin, requester } = {}) {
  const tenant = world.T[garage];
  const branch = world.B[garage + '1'];
  const caseVin = vin || (garage === 'a' ? world.V.a : world.V.b);
  const who = requester || (garage === 'a' ? 'customer-a' : 'customer-b');
  const { rows: [c] } = await db.query(
    "INSERT INTO service_cases (vin,garage_tenant_id,branch_id,requester_user_id,status) VALUES ($1,$2,$3,$4,'accepted') RETURNING id",
    [caseVin, tenant, branch, who]);
  return { caseId: c.id, tenant, vin: caseVin };
}

before(async () => {
  world = await createGarageFinalWorld({ after: [OPS04] });
  db = world.db;
  client = postgrestOver(db);
});
after(async () => { await db?.close(); });

test('money helpers: explicit currency, exact decimals, no float drift, no silent mixing', () => {
  assert.equal(requireCurrency('ZWG'), 'ZWG');
  for (const bad of [undefined, null, '', 'usd', 'US', 'XXX', 'KWD']) {
    assert.throws(() => requireCurrency(bad), (e) => e.constructor.name === 'ValidationError', String(bad));
  }
  assert.equal(currencyScale('USD'), 2);
  assert.equal(currencyScale('JPY'), 0);
  assert.equal(currencyScale('KWD'), null);
  assert.equal(moneyAmount('12.50', 'p', 'USD'), '12.50');
  assert.equal(moneyAmount(0, 'p', 'USD'), '0', 'zero is a recorded price');
  assert.equal(moneyAmount(null, 'p', 'USD', { optional: true }), null, 'null stays null: not recorded');
  assert.equal(moneyAmount('', 'p', 'USD', { optional: true }), null);
  assert.throws(() => moneyAmount(undefined, 'p', 'USD'), /required/);
  assert.throws(() => moneyAmount('12.505', 'p', 'USD'), /decimal places/);
  assert.throws(() => moneyAmount('100.5', 'p', 'JPY'), /decimal places/);
  assert.throws(() => moneyAmount('-1', 'p', 'USD'), /non-negative/);
  assert.throws(() => moneyAmount('1e3', 'p', 'USD'), /non-negative/);
  assert.throws(() => moneyAmount(Number.NaN, 'p', 'USD'), /finite/);
  assert.equal(sumMoney(['0.10', '0.20'], 'USD'), '0.30', 'exact decimal sum (0.1 + 0.2 != 0.3 in floats)');
  assert.equal(sumMoney(['10', '5'], 'JPY'), '15');
  assert.equal(sumMoney(['1.00', null], 'USD'), null, 'one unknown term makes the total unknown');
});

test('garage admin prepares, sends and the custodian accepts; the service never invents a total', async () => {
  const c = await newCase();
  const admin = garageActor('admin-a', c.tenant);
  const draft = await createEstimateForCase(client, admin, c.caseId, { currency: 'USD', lines: LINES, customer_note: 'Pads and labour', internal_note: 'margin 30%' });
  assert.equal(draft.status, 'draft');
  assert.equal(draft.total_amount, '170.50');
  assert.equal(draft.total_state, 'draft_total');
  assert.equal(draft.internal_note, 'margin 30%');

  // the customer cannot see a draft
  const before = await listMyEstimates(client, person('customer-a'));
  assert.deepEqual(before.estimates, []);

  const sent = await sendEstimate(client, admin, draft.id);
  assert.equal(sent.status, 'sent');
  assert.equal(sent.total_state, 'frozen_at_send');

  const mine = await listMyEstimates(client, person('customer-a'));
  assert.equal(mine.estimates.length, 1);
  const view = mine.estimates[0];
  assert.equal(view.can_decide, true);
  assert.equal(view.total_amount, '170.50');
  assert.equal(view.vin, c.vin);
  for (const secret of ['internal_note', 'created_by_user_id', 'sent_by_user_id', 'tenant_id', 'cancel_reason']) {
    assert.equal(secret in view, false, `customer view must not carry ${secret}`);
  }
  assert.equal(view.customer_note, 'Pads and labour');

  assert.equal(view.work_order_authorization, 'pending', 'the customer\'s view carries the canonical authorization');
  const decided = await decideMyEstimate(client, person('customer-a'), draft.id, { decision: 'accept' });
  assert.equal(decided.work_order_authorization, 'authorized');
  const after = (await listMyEstimates(client, person('customer-a'))).estimates.find((e) => e.id === draft.id);
  assert.equal(after.work_order_authorization, 'authorized');

  const { rows: [wo] } = await db.query('SELECT owner_authorization FROM mechanic_work_orders WHERE service_case_id=$1', [c.caseId]);
  assert.equal(wo.owner_authorization, 'authorized');

  const hub = await listCaseEstimates(client, admin, c.caseId);
  assert.equal(hub.work_order.owner_authorization, 'authorized');
  assert.equal(hub.latest.status, 'accepted');
  const detail = await getGarageEstimate(client, admin, draft.id);
  assert.deepEqual(detail.history.map((h) => h.event_type), ['created', 'sent', 'accepted']);
});

test('input is refused honestly before it reaches the database', async () => {
  const c = await newCase();
  const admin = garageActor('admin-a', c.tenant);
  await rejects(createEstimateForCase(client, admin, c.caseId, { lines: LINES }), { name: 'ValidationError', pattern: /currency is required/ });
  await rejects(createEstimateForCase(client, admin, c.caseId, { currency: 'usd', lines: LINES }), { name: 'ValidationError' });
  await rejects(createEstimateForCase(client, admin, c.caseId, { currency: 'USD', lines: [{ category: 'labour', description: 'x', quantity: 0, unit_price: 1 }] }), { name: 'ValidationError', pattern: /quantity/ });
  await rejects(createEstimateForCase(client, admin, c.caseId, { currency: 'USD', lines: [{ category: 'labour', description: 'x', quantity: 1, unit_price: '1.999' }] }), { name: 'ValidationError', pattern: /decimal places/ });
  await rejects(createEstimateForCase(client, admin, c.caseId, { currency: 'USD', lines: [{ category: 'bribe', description: 'x', quantity: 1, unit_price: 1 }] }), { name: 'ValidationError', pattern: /category/ });
  await rejects(createEstimateForCase(client, admin, c.caseId, { currency: 'USD', valid_until: '2000-01-01' }), { name: 'ValidationError' });
  const { rows: [n] } = await db.query('SELECT count(*)::int n FROM garage_estimates WHERE service_case_id=$1', [c.caseId]);
  assert.equal(n.n, 0);
});

test('a line with no price is "not recorded": it can be drafted but the estimate cannot be sent', async () => {
  const c = await newCase();
  const admin = garageActor('admin-a', c.tenant);
  const draft = await createEstimateForCase(client, admin, c.caseId, {
    currency: 'USD',
    lines: [{ category: 'labour', description: 'Diagnosis', quantity: 1, unit_price: 30 }, { category: 'part', description: 'Sensor', quantity: 1 }],
  });
  assert.equal(draft.total_amount, null);
  assert.equal(draft.total_state, 'not_recorded');
  assert.equal(draft.lines[1].price_recorded, false);
  assert.equal(draft.lines[1].unit_price, null);
  await rejects(sendEstimate(client, admin, draft.id), { name: 'ConflictError', pattern: /Every line needs a price/ });
  // fixing it with an explicit zero (free) makes it sendable
  const fixed = await updateEstimateDraft(client, admin, draft.id, {
    currency: 'USD',
    lines: [{ category: 'labour', description: 'Diagnosis', quantity: 1, unit_price: 30 }, { category: 'part', description: 'Sensor', quantity: 1, unit_price: 0 }],
    expected_updated_at: draft.updated_at,
  });
  assert.equal(fixed.total_amount, '30.00');
  assert.equal((await sendEstimate(client, admin, fixed.id)).status, 'sent');
});

test('authority: a mechanic cannot mutate; another garage cannot see or touch the estimate', async () => {
  const c = await newCase();
  const admin = garageActor('admin-a', c.tenant);
  await rejects(createEstimateForCase(client, garageActor('mech-a', c.tenant, 'mechanic'), c.caseId, { currency: 'USD', lines: LINES }), { name: 'ForbiddenError' });
  const draft = await createEstimateForCase(client, admin, c.caseId, { currency: 'USD', lines: LINES, internal_note: 'private' });

  const mech = garageActor('mech-a', c.tenant, 'mechanic');
  const readable = await getGarageEstimate(client, mech, draft.id);
  assert.equal('internal_note' in readable, false, 'a mechanic reads the estimate but not the admin-only note');
  assert.equal(readable.money_visible, false);
  assert.equal(readable.total_amount, null, 'nor what the work costs: the server redacts money for a mechanic');
  assert.ok(readable.lines.length > 0 && readable.lines.every((l) => l.unit_price === null && l.line_total === null && l.description));
  const adminRead = await getGarageEstimate(client, admin, draft.id);
  assert.equal(adminRead.money_visible, true);
  assert.equal(adminRead.total_amount, '170.50');
  const mechList = await listCaseEstimates(client, mech, c.caseId);
  assert.equal(mechList.latest.money_visible, false);
  assert.equal(mechList.latest.total_amount, null);
  await rejects(sendEstimate(client, mech, draft.id), { name: 'ForbiddenError' });
  await rejects(cancelEstimate(client, mech, draft.id), { name: 'ForbiddenError' });
  await rejects(updateEstimateDraft(client, mech, draft.id, { currency: 'USD' }), { name: 'ForbiddenError' });
  await rejects(reviseEstimate(client, mech, draft.id), { name: 'ForbiddenError' });

  const otherAdmin = garageActor('admin-b', world.T.b);
  await rejects(getGarageEstimate(client, otherAdmin, draft.id), { name: 'NotFoundError' });
  await rejects(listCaseEstimates(client, otherAdmin, c.caseId), { name: 'NotFoundError' });
  await rejects(sendEstimate(client, otherAdmin, draft.id), { name: 'NotFoundError' });
  await rejects(createEstimateForCase(client, otherAdmin, c.caseId, { currency: 'USD', lines: LINES }), { name: 'NotFoundError' });
  // no garage selected / not a garage / member role
  await rejects(getGarageEstimate(client, person('admin-a'), draft.id), { name: 'ForbiddenError' });
  await rejects(getGarageEstimate(client, { id: 'x', activeTenant: { id: c.tenant, type: 'dealership', role: 'admin' } }, draft.id), { name: 'ForbiddenError' });
  await rejects(getGarageEstimate(client, garageActor('x', c.tenant, 'member'), draft.id), { name: 'ForbiddenError' });
  assert.equal((await db.query('SELECT status FROM garage_estimates WHERE id=$1', [draft.id])).rows[0].status, 'draft');
});

test('customer isolation: only the custodian decides; a stranger and another customer learn nothing', async () => {
  const c = await newCase();
  const admin = garageActor('admin-a', c.tenant);
  const draft = await createEstimateForCase(client, admin, c.caseId, { currency: 'USD', lines: LINES });
  await rejects(decideMyEstimate(client, person('customer-a'), draft.id, { decision: 'accept' }), { name: 'NotFoundError' });
  await sendEstimate(client, admin, draft.id);

  assert.deepEqual((await listMyEstimates(client, person('customer-b'))).estimates, []);
  assert.deepEqual((await listMyEstimates(client, person('stranger'))).estimates, []);
  await rejects(decideMyEstimate(client, person('customer-b'), draft.id, { decision: 'accept' }), { name: 'NotFoundError' });
  await rejects(decideMyEstimate(client, person('stranger'), draft.id, { decision: 'decline' }), { name: 'NotFoundError' });
  await rejects(decideMyEstimate(client, person('customer-a'), draft.id, { decision: 'sure' }), { name: 'ValidationError' });
  // a garage admin acting AS a garage cannot decide for the customer either
  await rejects(decideMyEstimate(client, garageActor('admin-a', c.tenant), draft.id, { decision: 'accept' }), { name: 'NotFoundError' });
  const { rows: [still] } = await db.query('SELECT e.status, w.owner_authorization FROM garage_estimates e JOIN mechanic_work_orders w ON w.id=e.work_order_id WHERE e.id=$1', [draft.id]);
  assert.deepEqual(still, { status: 'sent', owner_authorization: 'pending' });
});

test('a requester who is not the registered owner can follow the estimate but cannot decide it', async () => {
  // customer-b requests service on customer-a's vehicle (a capability holder / friend / driver)
  const c = await newCase({ vin: world.V.a, requester: 'customer-b' });
  const admin = garageActor('admin-a', c.tenant);
  const draft = await createEstimateForCase(client, admin, c.caseId, { currency: 'USD', lines: LINES });
  await sendEstimate(client, admin, draft.id);

  const seenByRequester = (await listMyEstimates(client, person('customer-b'))).estimates.find((e) => e.id === draft.id);
  assert.ok(seenByRequester, 'the requester follows their own request');
  assert.equal(seenByRequester.can_decide, false);
  assert.equal(seenByRequester.awaiting_owner, true);
  await rejects(decideMyEstimate(client, person('customer-b'), draft.id, { decision: 'accept' }), { name: 'ForbiddenError', pattern: /registered owner/ });

  const seenByOwner = (await listMyEstimates(client, person('customer-a'))).estimates.find((e) => e.id === draft.id);
  assert.equal(seenByOwner.can_decide, true, 'the owner sees it too, and may decide');
  await decideMyEstimate(client, person('customer-a'), draft.id, { decision: 'decline', reason: 'Too dear' });
  const { rows: [wo] } = await db.query('SELECT owner_authorization FROM mechanic_work_orders WHERE id=(SELECT work_order_id FROM garage_estimates WHERE id=$1)', [draft.id]);
  assert.equal(wo.owner_authorization, 'declined');
});

test('refusal path: decline -> no authorized work, no service record, no invoice, no payment', async () => {
  const c = await newCase();
  const admin = garageActor('admin-a', c.tenant);
  const draft = await createEstimateForCase(client, admin, c.caseId, { currency: 'USD', lines: LINES });
  await sendEstimate(client, admin, draft.id);
  const out = await decideMyEstimate(client, person('customer-a'), draft.id, { decision: 'decline', reason: 'No thanks' });
  assert.equal(out.work_order_authorization, 'declined');
  const { rows: [counts] } = await db.query(
    `SELECT (SELECT count(*)::int FROM service_records WHERE service_case_id=$1) records,
            (SELECT count(*)::int FROM mechanic_work_orders WHERE service_case_id=$1 AND owner_authorization='authorized') authorized`, [c.caseId]);
  assert.deepEqual(counts, { records: 0, authorized: 0 });
  await rejects(decideMyEstimate(client, person('customer-a'), draft.id, { decision: 'accept' }), { name: 'ConflictError', pattern: /already been decided/ });
  // the garage may revise and try again; the declined version stays on record
  const v2 = await reviseEstimate(client, admin, draft.id);
  assert.equal(v2.version, 2);
  const hub = await listCaseEstimates(client, admin, c.caseId);
  assert.deepEqual(hub.estimates.map((e) => [e.version, e.status]), [[2, 'draft'], [1, 'declined']]);
});

test('an estimate cannot start from a case that is not accepted, and one live estimate per job', async () => {
  const c = await newCase();
  const admin = garageActor('admin-a', c.tenant);
  await createEstimateForCase(client, admin, c.caseId, { currency: 'USD', lines: LINES });
  await rejects(createEstimateForCase(client, admin, c.caseId, { currency: 'USD', lines: LINES }), { name: 'ConflictError', pattern: /already has a draft or sent estimate/ });
  await db.query("UPDATE service_cases SET status='requested' WHERE id=$1", [c.caseId]);
  await rejects(createEstimateForCase(client, admin, c.caseId, { currency: 'USD', lines: LINES }), { name: 'ConflictError', pattern: /accepted/ });
});

test('the customer cannot decide an estimate that was only ever a draft or was cancelled before sending', async () => {
  const c = await newCase();
  const admin = garageActor('admin-a', c.tenant);
  const draft = await createEstimateForCase(client, admin, c.caseId, { currency: 'USD', lines: LINES });
  await cancelEstimate(client, admin, draft.id, { reason: 'wrong vehicle' });
  assert.deepEqual((await listMyEstimates(client, person('customer-a'))).estimates.filter((e) => e.id === draft.id), []);
  await rejects(decideMyEstimate(client, person('customer-a'), draft.id, { decision: 'accept' }), { name: 'NotFoundError' });
});

test('a later revocation stops reading as "authorized" on the customer view even though the estimate stays accepted', async () => {
  const c = await newCase();
  const admin = garageActor('admin-a', c.tenant);
  const est = await createEstimateForCase(client, admin, c.caseId, { currency: 'USD', lines: LINES });
  await sendEstimate(client, admin, est.id);
  await decideMyEstimate(client, person('customer-a'), est.id, { decision: 'accept' });
  await db.query("SELECT mechanic_work_order_decide_authorization($1,$2,'customer-a','owner',NULL,'owner','revoked','changed my mind')", [est.work_order_id, c.vin]);
  const view = (await listMyEstimates(client, person('customer-a'))).estimates.find((e) => e.id === est.id);
  assert.equal(view.status, 'accepted', 'the historical decision is not rewritten');
  assert.equal(view.work_order_authorization, 'revoked', 'but the canonical authorization is');
});
