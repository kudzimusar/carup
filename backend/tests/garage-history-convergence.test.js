import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createGarageFinalWorld, postgrestOver } from './helpers/garageFinalWorld.js';
import { garageActor, runGarageJob } from './helpers/garageJourney.js';
import { listOwnerServiceHistory } from '../services/serviceNetwork/ownerServiceHistoryService.js';
import { buildCanonicalVehicleLifecycle } from '../services/report/canonicalVehicleLifecycleService.js';
import { getGarageCustomerDetail } from '../services/garageOperations/garageCustomerRelationshipService.js';
import { getGarageCustomers } from '../services/serviceNetwork/garageQueueService.js';

const OPS = [
  '20261024100000_garage_ops04_estimates_and_authorization.sql',
  '20261024110000_garage_ops05_workshop_execution_gates.sql',
  '20261024120000_garage_ops06_parts_stock.sql',
  '20261024130000_garage_ops07_invoice_payment_receipt.sql',
];
let world; let db; let client;
const adminA = () => garageActor('admin-a', world.T.a);
const mechA = () => garageActor('mech-a', world.T.a, 'mechanic');
const run = (o) => runGarageJob({ world, client, ...o });

before(async () => {
  world = await createGarageFinalWorld({ after: OPS });
  db = world.db; client = postgrestOver(db);
});
after(async () => { await db?.close(); });

test('a completed job is discoverable as history from the owner, the vehicle lifecycle and the Garage customer record', async () => {
  const done = await run({ estimateTotal: 100, actualCost: 100, until: 'pay-partial' });
  const declined = await run({ estimateTotal: 300, until: 'decline' });

  // ── the owner's history (frozen contract): truthful labels, recorded money only
  const history = await listOwnerServiceHistory(client, 'customer-a');
  const doneEntry = history.find((h) => h.id === done.workOrderId);
  const declinedEntry = history.find((h) => h.id === declined.workOrderId);
  assert.ok(doneEntry && declinedEntry, 'both jobs are in the owner\'s history');
  assert.equal(doneEntry.owner_authorization, 'authorized');
  assert.equal(doneEntry.status, 'Completed');
  assert.deepEqual(doneEntry.money, { recorded: true, amount: 100, currency: 'USD' });
  assert.equal(declinedEntry.owner_authorization, 'declined', 'a declined job is labelled declined, never presented as service performed');
  assert.equal(declinedEntry.money.recorded, false);
  assert.ok(!JSON.stringify(history).includes('300'), 'the declined estimate\'s amount is not service history');

  // ── the vehicle's canonical lifecycle: only ACTUAL performed work becomes a service event
  const lifecycle = await buildCanonicalVehicleLifecycle(client, world.V.a, { audience: 'public' });
  const serviceEvents = (lifecycle.events || lifecycle.timeline || []).filter((e) => e.sourceKind === 'service_record' || e.source_kind === 'service_record');
  assert.equal(serviceEvents.length, 1, 'exactly the one job that was performed');
  assert.ok(serviceEvents[0].id.endsWith(done.record.id));
  const text = JSON.stringify(lifecycle);
  assert.ok(!text.includes('Completed the service'), 'the private work narrative never reaches the lifecycle');
  assert.ok(!/"?(total_cost|sent_total_amount|invoice|estimate)"?/i.test(text), 'no commercial amount leaks into a vehicle\'s public history');
  assert.ok(!text.includes(declined.workOrderId), 'a declined job is not service history');

  // ── the Garage customer record (admin): commercial history from the real authorities
  const customers = await getGarageCustomers(client, adminA());
  const me = customers.customers.find((c) => c.user_id === 'customer-a');
  const detail = await getGarageCustomerDetail(client, adminA(), `registered:${me.user_id}`);
  assert.equal(detail.cases.length, 2);
  assert.equal(detail.commercial.invoices.length, 1);
  assert.deepEqual(
    [detail.commercial.invoices[0].status, detail.commercial.invoices[0].payment_status, detail.commercial.invoices[0].paid_amount, detail.commercial.invoices[0].total_amount],
    ['issued', 'partially_paid', '50.00', '100.00']);
  assert.deepEqual(detail.commercial.outstanding_by_currency, [{ currency: 'USD', balance: '50.00' }]);
  assert.deepEqual(detail.commercial.estimates.map((e) => [e.status, e.total_amount]).sort(), [['accepted', '100.00'], ['declined', '300.00']]);
  assert.match(detail.commercial.note, /not proof of paid revenue/);

  // a mechanic reads the customer's service facts but none of the money
  const mechDetail = await getGarageCustomerDetail(client, mechA(), `registered:${me.user_id}`);
  assert.equal(mechDetail.commercial, null);
});

test('customer spend is summed as exact decimals, per currency (0.10 + 0.20 is 0.30)', async () => {
  const fresh = await createGarageFinalWorld({ after: OPS });
  try {
    const c2 = postgrestOver(fresh.db);
    await runGarageJob({ world: fresh, client: c2, estimateTotal: null, actualCost: 0.1, until: 'complete' });
    await runGarageJob({ world: fresh, client: c2, estimateTotal: null, actualCost: 0.2, until: 'complete' });
    await runGarageJob({ world: fresh, client: c2, estimateTotal: null, actualCost: 500, currency: 'ZAR', until: 'complete' });
    const { customers } = await getGarageCustomers(c2, garageActor('admin-a', fresh.T.a));
    const spend = customers.find((c) => c.user_id === 'customer-a').spend_by_currency;
    assert.deepEqual(spend, { USD: 0.3, ZAR: 500 });
    assert.equal(spend.USD, 0.3, 'not 0.30000000000000004');
  } finally { await fresh.db.close(); }
});

test('another garage\'s customer, jobs and invoices never appear in this garage\'s record', async () => {
  await run({ garage: 'b', estimateTotal: 777, actualCost: 777, until: 'invoice' });
  const me = (await getGarageCustomers(client, adminA())).customers.find((c) => c.user_id === 'customer-a');
  const detail = await getGarageCustomerDetail(client, adminA(), `registered:${me.user_id}`);
  assert.ok(!JSON.stringify(detail).includes('777'));
  const bView = await getGarageCustomers(client, garageActor('admin-b', world.T.b));
  assert.ok(bView.customers.every((c) => c.user_id !== 'customer-a'));
});
