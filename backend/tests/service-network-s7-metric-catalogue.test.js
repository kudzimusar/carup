/**
 * Service Network S7 — measurable metric catalogue and I9 reconciliation contracts.
 *
 * Intelligence observes; it never becomes business truth (Invariant 7). The catalogue
 * computes nothing — it declares what is answerable and from where — so these tests hold
 * the two properties that actually matter:
 *
 *   1. nothing is claimed measurable without governed numerator, timestamp and scope
 *      sources (plan §19.3), and each source really exists in the schema S1–S6 built;
 *   2. everything plan §19.2 forbids inferring stays not-measurable, with the MISSING
 *      FACT named rather than a bare refusal.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockSupabase } from './helpers/mockSupabase.js';
import {
  SERVICE_METRIC_CATALOGUE,
  assertScopeAllowed,
  evaluateMeasurability,
  getMetric,
  listMeasurableMetrics,
  listNotMeasurableMetrics,
  violatesMeasurabilityBar,
} from '../services/serviceNetwork/serviceMetricCatalogue.js';

/** Every table S1–S6 actually created, so source claims can be checked against reality. */
function seedClient() {
  return createMockSupabase({
    service_cases: [], service_case_events: [], mechanic_work_orders: [],
    work_order_assignments: [], service_records: [], service_mileage_observations: [],
    service_record_parts: [], service_record_evidence: [], garage_public_profiles: [],
    garage_branches: [], vehicles: [], marketplace_inquiries: [],
  });
}

test('every catalogue entry meets the plan §19.3 bar', () => {
  for (const metric of SERVICE_METRIC_CATALOGUE) {
    const violation = violatesMeasurabilityBar(metric);
    assert.equal(violation, null, `${metric.key}: ${violation}`);
  }
});

test('every measurable metric names sources that really exist in the schema', async () => {
  const client = seedClient();
  for (const metric of listMeasurableMetrics()) {
    const result = await evaluateMeasurability(client, metric.key);
    assert.equal(result.measurable, true, `${metric.key} claims measurable but ${result.reason}`);
    assert.equal(result.availability, 'available');
  }
});

test('a metric whose source is missing is UNAVAILABLE, not zero', async () => {
  const client = seedClient();
  const originalFrom = client.from.bind(client);
  client.from = (table) => (table === 'service_cases'
    ? { select: () => ({ limit: async () => ({ data: null, error: { message: 'relation does not exist' } }) }) }
    : originalFrom(table));

  const result = await evaluateMeasurability(client, 'service_requests');
  assert.equal(result.measurable, false);
  assert.equal(result.availability, 'unavailable');
  assert.match(result.reason, /service_cases is unavailable/);
  assert.equal(Object.hasOwn(result, 'value'), false, 'an unavailable metric reports no value at all');
});

test('everything plan §19.2 forbids inferring stays not measurable, with the missing fact named', () => {
  const forbidden = [
    'bay_capacity_utilisation', 'appointment_no_show_rate', 'staffing_utilisation',
    'technician_productivity', 'estimate_approval_rate', 'estimate_to_invoice_variance',
    'comeback_warranty_rate', 'customer_rating', 'first_time_fix_rate',
  ];
  for (const key of forbidden) {
    const metric = getMetric(key);
    assert.ok(metric, `${key} must be present in the registry, not silently absent`);
    assert.equal(metric.measurable, false, `${key} must not be inferred`);
    assert.ok(metric.reason && metric.reason.length > 20, `${key} must name the missing fact`);
  }
});

test('customer rating stays unmeasurable because Foundation publishes no ratings', () => {
  const metric = getMetric('customer_rating');
  assert.equal(metric.measurable, false);
  assert.match(metric.reason, /publishes no ratings/);
});

test('response time stays unmeasurable until a governed Communications join exists', () => {
  // Plan §19.1 lists it as potentially measurable, but Communications owns the fact and
  // no governed join to service cases exists yet — so it is honestly still not measurable.
  const metric = getMetric('response_time');
  assert.equal(metric.measurable, false);
  assert.match(metric.reason, /Communications owns response time/);
});

test('the I9 contradiction is resolved: cancellation IS measurable now', () => {
  // Plan fact #6 flags that older I9 text calls cancellation not-measurable while the
  // work-order route already supports Cancelled. S2/S4 gave both a governed timestamp.
  const cases = getMetric('cancelled_cases');
  const orders = getMetric('work_orders_cancelled');
  assert.equal(cases.measurable, true);
  assert.equal(orders.measurable, true);
  assert.match(cases.sources.timestamp, /cancelled_at/);
  assert.match(orders.sources.timestamp, /cancelled_at/);
});

test('metrics that became measurable only because Foundation added the fact', () => {
  // Each of these was impossible before S2/S4/S5 — the point of the reconciliation.
  const gained = {
    request_to_accept_elapsed: /accepted_at/,
    accept_to_completion_elapsed: /completed_at/,
    contributing_mechanics: /work_order_assignments/,
    branch_activity: /branch_id/,
    service_category_demand: /service_category/,
  };
  for (const [key, pattern] of Object.entries(gained)) {
    const metric = getMetric(key);
    assert.equal(metric.measurable, true, `${key} should now be measurable`);
    const sources = JSON.stringify(metric.sources);
    assert.match(sources, pattern, `${key} must cite the Foundation field that made it measurable`);
  }
});

test('mechanic-person scope never widens to the tenant (Invariant 3)', () => {
  // A garage-tenant metric must not be answerable as if it described one person...
  assert.throws(() => assertScopeAllowed('service_requests', 'mechanic_person'), /not defined at mechanic_person scope/);
  assert.throws(() => assertScopeAllowed('declined_requests', 'mechanic_person'), /not defined at mechanic_person scope/);
  // ...and a person-level metric must not be answerable at branch width.
  assert.throws(() => assertScopeAllowed('technician_productivity', 'branch'), /not defined at branch scope/);
  // Legitimate scopes still pass.
  assert.equal(assertScopeAllowed('service_requests', 'garage_tenant'), true);
  assert.equal(assertScopeAllowed('contributing_mechanics', 'mechanic_person'), true);
});

test('unknown metrics and scopes are refused rather than guessed', async () => {
  const client = seedClient();
  assert.equal(getMetric('made_up_metric'), null);
  assert.throws(() => assertScopeAllowed('made_up_metric', 'garage_tenant'), /Unknown service metric/);
  assert.throws(() => assertScopeAllowed('service_requests', 'galaxy'), /Unknown metric scope/);
  const evaluated = await evaluateMeasurability(client, 'made_up_metric');
  assert.equal(evaluated.known, false);
  assert.equal(evaluated.measurable, false);
});

test('the catalogue declares no metric CarUp cannot source, and no duplicate keys', () => {
  const keys = SERVICE_METRIC_CATALOGUE.map((m) => m.key);
  assert.equal(new Set(keys).size, keys.length, 'duplicate metric keys would fork the registry');
  assert.ok(listMeasurableMetrics().length >= 15, 'Foundation should unlock a real catalogue');
  assert.ok(listNotMeasurableMetrics().length >= 9, 'the not-measurable registry must stay explicit');
});

test('the catalogue computes nothing — it only declares answerability (Invariant 7)', async () => {
  const client = seedClient();
  const result = await evaluateMeasurability(client, 'service_requests');
  for (const forbidden of ['value', 'count', 'total', 'score']) {
    assert.equal(Object.hasOwn(result, forbidden), false,
      `the catalogue must not produce a ${forbidden} — Intelligence observes, it does not become truth`);
  }
});
