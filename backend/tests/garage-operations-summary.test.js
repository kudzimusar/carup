import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { supabaseOver } from './helpers/pgliteLedgerHarness.js';
import { createGarageFinalWorld } from './helpers/garageFinalWorld.js';
import { garageActor, runGarageJob } from './helpers/garageJourney.js';
import { getOperationsSummary } from '../services/garageOperations/garageOperationsSummaryService.js';

const OPS = [
  '20261024100000_garage_ops04_estimates_and_authorization.sql',
  '20261024110000_garage_ops05_workshop_execution_gates.sql',
  '20261024120000_garage_ops06_parts_stock.sql',
  '20261024130000_garage_ops07_invoice_payment_receipt.sql',
];
let world; let db; let client;
const adminA = () => garageActor('admin-a', world.T.a);
const run = (o) => runGarageJob({ world, client, ...o });

before(async () => {
  world = await createGarageFinalWorld({ after: OPS });
  db = world.db; client = supabaseOver(db);
});
after(async () => { await db?.close(); });

test('an empty garage reports nothing as nothing — and measures nothing it cannot', async () => {
  const s = await getOperationsSummary(client, adminA(), { windowDays: 30 });
  assert.deepEqual(s.work.open_cases, { requested: 0, accepted: 0, active: 0, definition: s.work.open_cases.definition });
  assert.equal(s.work.completed_jobs.value, 0);
  assert.equal(s.work.cycle_time.state, 'not_measured');
  assert.equal(s.work.repeat_customers.state, 'not_measured');
  assert.equal(s.estimates.approval_rate.state, 'not_measured');
  assert.equal(s.appointments.no_show_rate.state, 'not_measured');
  assert.deepEqual(s.money.invoiced_by_currency, []);
  assert.deepEqual(s.money.outstanding_by_currency, []);
  assert.equal(s.truncated, false);
});

test('REAL FIRST-PARTY NUMBERS from real jobs; money per currency, never mixed; no revenue/profit/forecast', async () => {
  await run({ estimateTotal: 100, actualCost: 100, until: 'pay-full', partQty: 2 });            // USD, on estimate, paid
  await run({ estimateTotal: 100, until: 'decline' });                                          // declined
  await run({ estimateTotal: 80, actualCost: 120, until: 'pay-partial' });                      // USD, over estimate, half paid
  await run({ estimateTotal: null, actualCost: 70, until: 'complete' });                        // no estimate, not invoiced
  await run({ estimateTotal: 500, actualCost: 900, currency: 'ZAR', until: 'invoice' });        // ZAR, over estimate, unpaid
  await run({ estimateTotal: 60, until: 'stop-after-authorize' });                              // accepted + authorized, not started
  await run({ estimateTotal: 55, until: 'stop-after-authorize' });                              // decided: 5th decision
  await run({ garage: 'b', estimateTotal: 999, actualCost: 999, until: 'pay-full' });           // another garage — must not leak in

  const s = await getOperationsSummary(client, adminA(), { windowDays: 30 });

  // work
  assert.equal(s.work.open_cases.accepted, 3, 'declined-estimate case + two authorized-not-started');
  assert.equal(s.work.open_cases.active, 0);
  assert.equal(s.work.completed_jobs.value, 4);
  assert.equal(s.work.cycle_time.state, 'measured');
  assert.equal(s.work.cycle_time.jobs, 4);
  assert.ok(s.work.cycle_time.average_hours >= 2.9 && s.work.cycle_time.average_hours <= 3.5, `average ${s.work.cycle_time.average_hours}h`);
  assert.deepEqual(s.work.by_mechanic.map((m) => [m.user_id, m.completed_jobs, m.attribution]), [['mech-a', 4, 'assigned_mechanic']]);
  assert.equal(s.work.by_site.find((x) => x.branch_id === world.B.a1).completed_in_window, 4);
  assert.equal(s.work.repeat_customers.state, 'measured');
  assert.equal(s.work.repeat_customers.identified, 1);
  assert.equal(s.work.repeat_customers.repeat, 1, 'customer-a returned');

  // estimates: the no-estimate job made none, so 6 decisions (5 accepted, 1 declined) -> a measured rate
  assert.equal(s.estimates.approval_rate.state, 'measured');
  assert.equal(s.estimates.approval_rate.numerator, 5);
  assert.equal(s.estimates.approval_rate.denominator, 6);
  assert.equal(s.estimates.approval_rate.rate, 83.3);

  // money: USD and ZAR kept apart
  const usd = (arr) => arr.find((x) => x.currency === 'USD');
  const zar = (arr) => arr.find((x) => x.currency === 'ZAR');
  assert.deepEqual([usd(s.money.invoiced_by_currency).total, usd(s.money.invoiced_by_currency).invoices], ['220.00', 2]);
  assert.deepEqual([zar(s.money.invoiced_by_currency).total, zar(s.money.invoiced_by_currency).invoices], ['900.00', 1]);
  assert.equal(usd(s.money.outstanding_by_currency).balance, '60.00');
  assert.equal(zar(s.money.outstanding_by_currency).balance, '900.00');
  assert.equal(usd(s.money.recorded_payments_by_currency).net_recorded, '160.00');
  assert.equal(zar(s.money.recorded_payments_by_currency), undefined, 'no ZAR payment was recorded: it is absent, not 0');
  assert.match(usd(s.money.recorded_payments_by_currency).label, /not processed or verified/);
  assert.deepEqual(usd(s.money.estimate_vs_invoice.by_currency), { currency: 'USD', jobs: 2, estimate_total: '180.00', invoice_total: '220.00', difference: '+40.00' });
  assert.deepEqual(zar(s.money.estimate_vs_invoice.by_currency), { currency: 'ZAR', jobs: 1, estimate_total: '500.00', invoice_total: '900.00', difference: '+400.00' });
  assert.match(s.money.note, /Neither is revenue/);

  // parts
  assert.equal(s.parts.used_in_window[0].quantity, 2);

  // the other garage's 999 never appears
  assert.ok(!JSON.stringify(s).includes('999'), 'no cross-garage leakage');

  // never invented
  const topKeys = Object.keys(s).sort();
  assert.deepEqual(topKeys, ['appointments', 'estimates', 'generated_at', 'money', 'not_measured', 'parts', 'truncated', 'window', 'window_days', 'work']);
  const measuredText = JSON.stringify({ ...s, not_measured: undefined });
  assert.doesNotMatch(measuredText, /"revenue"|"profit"|conversion|lifetime|forecast|utili[sz]ation/i);
  const refused = new Set(s.not_measured.map((x) => x.key));
  for (const k of ['revenue', 'profit', 'conversion_rate', 'customer_lifetime_value', 'forecast', 'bay_capacity_utilisation', 'staffing_utilisation', 'technician_productivity']) {
    assert.ok(refused.has(k), `${k} must be declared not measured, with its reason`);
  }
  assert.ok(s.not_measured.every((x) => x.reason && x.reason.length > 15));
});

test('a small sample is "not measured", never a misleading percentage', async () => {
  const fresh = await createGarageFinalWorld({ after: OPS });
  try {
    const c2 = supabaseOver(fresh.db);
    await runGarageJob({ world: fresh, client: c2, estimateTotal: 50, until: 'decline' });
    await runGarageJob({ world: fresh, client: c2, estimateTotal: 50, until: 'stop-after-authorize' });
    const s = await getOperationsSummary(c2, garageActor('admin-a', fresh.T.a), { windowDays: 7 });
    assert.equal(s.estimates.approval_rate.state, 'not_measured');
    assert.equal(s.estimates.approval_rate.denominator, 2);
    assert.match(s.estimates.approval_rate.reason, /Fewer than 5/);
    assert.equal('rate' in s.estimates.approval_rate, false, 'no percentage is offered for 2 decisions');
  } finally { await fresh.db.close(); }
});

test('authority + input: admin only, own garage only, a known window only', async () => {
  await assert.rejects(getOperationsSummary(client, garageActor('mech-a', world.T.a, 'mechanic'), {}), /does not allow this action/);
  await assert.rejects(getOperationsSummary(client, { id: 'customer-a', activeTenant: null }, {}), /Select the garage/);
  await assert.rejects(getOperationsSummary(client, adminA(), { windowDays: 365 }), /window_days must be one of/);
  const b = await getOperationsSummary(client, garageActor('admin-b', world.T.b), { windowDays: 90 });
  assert.equal(b.work.completed_jobs.value, 1);
  assert.deepEqual(b.money.invoiced_by_currency.map((x) => x.total), ['999.00']);
});
