/**
 * CarUp Intelligence 1.0 — I9 mechanic and garage intelligence.
 *
 * The frozen model
 * (docs/intelligence/receipts/I9_MECHANIC_GARAGE_PROJECTION_MODEL.md) says:
 *
 *   mechanic = person / practitioner scope
 *   garage   = tenant / organization scope
 *   shared work-order data may feed both, but one must NOT impersonate the other
 *
 * So the load-bearing tests here are the ones that prove separation: a mechanic's
 * figures never widen to the tenant, a garage's never narrow to the caller, and a
 * garage question with no verified organization is refused rather than answered
 * with one person's work.
 *
 * The rest prove that everything CarUp cannot measure — bookings, capacity,
 * staffing, branches, turnaround, cancellations, service categories — is declared
 * with a reason rather than estimated.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

import {
  getMechanicIntelligence,
  getGarageIntelligence,
  demandByVehicle,
  repeatCustomers,
  NOT_MEASURABLE,
  SERVICE_INTELLIGENCE_VERSION,
} from '../services/intelligence/serviceIntelligenceService.js';
import { AVAILABILITY, AuthorizationError } from '../services/intelligence/intelligenceProjectionService.js';

const MECHANIC = { id: 'mech-1', role: 'mechanic', tenantId: 'garage-tenant-a' };
const OTHER_MECHANIC = { id: 'mech-2', role: 'mechanic', tenantId: 'garage-tenant-a' };
const NO_TENANT = { id: 'mech-3', role: 'mechanic', tenantId: null };

const today = new Date().toISOString();

const order = (o = {}) => ({
  id: o.id || 'wo-1', vin: o.vin || null, status: o.status || 'open',
  created_at: o.created_at || today, customer_id: o.customer_id || null,
  mechanic_id: o.mechanic_id || null, tenant_id: o.tenant_id || null,
  organization_id: o.organization_id || null,
});

/**
 * Fake client that RESPECTS the filters, so a test can prove scoping rather than
 * merely observe whatever the fake decided to return.
 */
function createClient({ orders = [], inquiries = [], vehicles = [], records = [], failTable = null } = {}) {
  const build = (table, rows) => {
    const filters = {};
    const api = {
      select() { return api },
      eq(col, val) { filters[col] = val; return api },
      in(col, vals) { filters[col] = vals; return api },
      range(from) {
        if (failTable === table) return Promise.resolve({ data: null, error: { message: `${table} unavailable` } });
        let out = rows.filter((row) => Object.entries(filters).every(([k, v]) => (
          Array.isArray(v) ? v.includes(row[k]) : row[k] === v
        )));
        return Promise.resolve({ data: from === 0 ? out : [], error: null });
      },
      then(resolve) {
        if (failTable === table) return resolve({ data: null, error: { message: `${table} unavailable` } });
        const out = rows.filter((row) => Object.entries(filters).every(([k, v]) => (
          Array.isArray(v) ? v.includes(row[k]) : row[k] === v
        )));
        return resolve({ data: out, error: null });
      },
    };
    return api;
  };
  return {
    from(table) {
      return build(table, {
        mechanic_work_orders: orders,
        marketplace_inquiries: inquiries,
        vehicles,
        partsentry_logs: records,
      }[table] ?? []);
    },
  };
}

// ── The separation the model exists to protect ─────────────────────────────

test('a mechanic sees only their OWN work, never the organization\'s', async () => {
  const client = createClient({
    orders: [
      order({ id: 'a', mechanic_id: 'mech-1', tenant_id: 'garage-tenant-a' }),
      order({ id: 'b', mechanic_id: 'mech-2', tenant_id: 'garage-tenant-a' }),
      order({ id: 'c', mechanic_id: 'mech-2', tenant_id: 'garage-tenant-a' }),
    ],
  });
  const result = await getMechanicIntelligence(client, MECHANIC);
  assert.equal(result.scope, 'mechanic');
  assert.equal(result.metrics.work_orders.value, 1,
    'a colleague\'s work in the same garage is not this practitioner\'s work');
});

test('an UNATTRIBUTED work order is credited to nobody', async () => {
  const client = createClient({
    orders: [
      order({ id: 'a', mechanic_id: 'mech-1', tenant_id: 'garage-tenant-a' }),
      // No mechanic_id: real work for the organization, but not attributable.
      order({ id: 'orphan', mechanic_id: null, tenant_id: 'garage-tenant-a' }),
    ],
  });
  const mech = await getMechanicIntelligence(client, MECHANIC);
  assert.equal(mech.metrics.work_orders.value, 1,
    'an unattributed order must not be credited to whoever is looking');

  // The organization still sees it, because it IS the organization's work.
  const garage = await getGarageIntelligence(client, MECHANIC);
  assert.equal(garage.metrics.work_orders.value, 2);
});

test('a garage sees the WHOLE tenant, never narrowed to the caller', async () => {
  const client = createClient({
    orders: [
      order({ id: 'a', mechanic_id: 'mech-1', tenant_id: 'garage-tenant-a' }),
      order({ id: 'b', mechanic_id: 'mech-2', tenant_id: 'garage-tenant-a' }),
    ],
  });
  const result = await getGarageIntelligence(client, MECHANIC);
  assert.equal(result.scope, 'garage');
  assert.equal(result.metrics.work_orders.value, 2);
  assert.equal(result.metrics.practitioners_contributing.value, 2);
});

test('one row can legitimately appear in BOTH projections without either impersonating the other', async () => {
  const client = createClient({
    orders: [order({ id: 'shared', mechanic_id: 'mech-1', tenant_id: 'garage-tenant-a' })],
  });
  const mech = await getMechanicIntelligence(client, MECHANIC);
  const garage = await getGarageIntelligence(client, MECHANIC);
  assert.equal(mech.metrics.work_orders.value, 1);
  assert.equal(garage.metrics.work_orders.value, 1);
  // The labels differ, which is what stops one being read as the other.
  assert.equal(mech.scope, 'mechanic');
  assert.equal(garage.scope, 'garage');
});

test('another tenant\'s work never appears', async () => {
  const client = createClient({
    orders: [
      order({ id: 'ours', mechanic_id: 'mech-1', tenant_id: 'garage-tenant-a' }),
      order({ id: 'theirs', mechanic_id: 'mech-9', tenant_id: 'garage-tenant-b' }),
    ],
  });
  const result = await getGarageIntelligence(client, MECHANIC);
  assert.equal(result.metrics.work_orders.value, 1);
});

test('a garage question with NO verified organization is refused, not answered personally', async () => {
  const client = createClient({ orders: [order({ mechanic_id: 'mech-3' })] });
  await assert.rejects(
    () => getGarageIntelligence(client, NO_TENANT),
    (error) => error instanceof AuthorizationError,
  );
});

test('an unauthenticated caller gets no mechanic projection', async () => {
  const client = createClient();
  await assert.rejects(() => getMechanicIntelligence(client, null), (e) => e instanceof AuthorizationError);
});

// ── No new garage role was invented ────────────────────────────────────────

test('garage intelligence is reached by tenant membership, not by a garage role', async () => {
  // A `dealer`-role user belonging to the garage's tenant gets the organization
  // view; nothing about the projection depends on a role called "garage".
  const client = createClient({ orders: [order({ mechanic_id: 'x', tenant_id: 'garage-tenant-a' })] });
  const result = await getGarageIntelligence(client, { id: 'u1', role: 'dealer', tenantId: 'garage-tenant-a' });
  assert.equal(result.metrics.work_orders.value, 1);
});

// ── What CarUp cannot measure is declared, not invented ────────────────────

// ── Service Network reconciliation (O3) ────────────────────────────────────
//
// These four tests previously pinned eight not-measurable capabilities. Service Network S2/S4/S5
// made six of them genuinely measurable, so the pins are FLIPPED rather than deleted: continuing
// to publish "no booking model" would be a false statement about CarUp's own schema, and
// understating what is known is the same class of error as overstating it.

test('every unmeasurable garage capability is declared with a reason', async () => {
  const client = createClient({ orders: [] });
  const result = await getGarageIntelligence(client, MECHANIC);
  const keys = result.not_measurable.map((n) => n.key).sort();
  assert.deepEqual(keys, ['capacity_utilisation', 'team_performance'],
    'only capacity and staffing remain genuinely unsupported after Service Network');
  for (const entry of result.not_measurable) {
    assert.ok(entry.reason, `${entry.key} must state a reason`);
    assert.ok(entry.detail && entry.detail.length > 20, `${entry.key} must explain itself`);
  }
});

test('capacity and team performance are still absent, for the right reasons', () => {
  const capacity = NOT_MEASURABLE.find((n) => n.key === 'capacity_utilisation');
  assert.equal(capacity.reason, 'no_capacity_model');
  const team = NOT_MEASURABLE.find((n) => n.key === 'team_performance');
  assert.equal(team.reason, 'no_staffing_data');
  // Assignment now exists; the reason must say why that still is not performance.
  assert.match(team.detail, /work_order_assignments/);
  assert.match(team.detail, /not performance/i);
});

test('the six capabilities Service Network made measurable are no longer declared absent', () => {
  const stale = NOT_MEASURABLE.map((n) => n.key).filter((key) => [
    'bookings', 'booking_conversion', 'branch_performance',
    'turnaround_time', 'cancellation_rate', 'service_category_demand',
  ].includes(key));
  assert.deepEqual(stale, [],
    'these are computed from governed service_cases columns and must not also be declared missing');
});

test('a practitioner is not asked about branch or team performance', async () => {
  const client = createClient({ orders: [] });
  const result = await getMechanicIntelligence(client, MECHANIC);
  const keys = result.not_measurable.map((n) => n.key);
  assert.ok(!keys.includes('branch_performance'));
  assert.ok(!keys.includes('team_performance'));
  // Capacity still applies to a person's own view.
  assert.ok(keys.includes('capacity_utilisation'));
});

test('the mechanic projection never reads the tenant-wide service case ledger', async () => {
  const read = [];
  const client = createClient({ orders: [] });
  const wrapped = {
    from(table) { read.push(table); return client.from(table); },
  };
  await getMechanicIntelligence(wrapped, MECHANIC);
  assert.ok(!read.includes('service_cases'),
    'a practitioner scope must stay person-wide; service_cases is organization data');
});

// ── Measured behaviour ─────────────────────────────────────────────────────

test('completion is counted from authoritative work-order state', async () => {
  const client = createClient({
    orders: [
      order({ id: '1', mechanic_id: 'mech-1', status: 'completed' }),
      order({ id: '2', mechanic_id: 'mech-1', status: 'Completed' }),
      order({ id: '3', mechanic_id: 'mech-1', status: 'open' }),
      order({ id: '4', mechanic_id: 'mech-1', status: 'in_progress' }),
      order({ id: '5', mechanic_id: 'mech-1', status: 'closed' }),
    ],
  });
  const result = await getMechanicIntelligence(client, MECHANIC);
  assert.equal(result.metrics.work_orders.value, 5);
  assert.equal(result.metrics.completed_work_orders.value, 3, 'status matching is case-insensitive');
  assert.equal(result.metrics.open_work_orders.value, 2);
  assert.equal(result.conversion.completion_rate.value, 60);
});

test('a completion rate is withheld when there is too little work to mean anything', async () => {
  const client = createClient({
    orders: [order({ id: '1', mechanic_id: 'mech-1', status: 'completed' })],
  });
  const result = await getMechanicIntelligence(client, MECHANIC);
  assert.equal(result.conversion.completion_rate.availability, AVAILABILITY.INSUFFICIENT_DATA);
  // The raw counts are still shown; only the ratio is withheld.
  assert.equal(result.metrics.work_orders.value, 1);
});

test('repeat customers counts people, not jobs', () => {
  const result = repeatCustomers([
    order({ customer_id: 'c1' }), order({ customer_id: 'c1' }), order({ customer_id: 'c1' }),
    order({ customer_id: 'c2' }),
    order({ customer_id: null }),
  ]);
  assert.equal(result.identified, 2, 'an anonymous job identifies no customer');
  assert.equal(result.repeat, 1, 'three jobs for one person is ONE repeat customer');
});

test('demand by vehicle uses canonical identity and never guesses an unknown VIN', () => {
  const vehicles = new Map([
    ['VIN1', { vin: 'VIN1', make: 'Toyota', model: 'Hilux' }],
    ['VIN2', { vin: 'VIN2', make: 'Toyota', model: 'Hilux' }],
    ['VIN3', { vin: 'VIN3', make: 'Honda', model: 'Fit' }],
  ]);
  const result = demandByVehicle([
    order({ vin: 'VIN1' }), order({ vin: 'VIN2' }), order({ vin: 'VIN3' }),
    order({ vin: 'VIN-UNKNOWN' }), order({ vin: null }),
  ], vehicles);
  assert.deepEqual(result.top[0], { label: 'Toyota Hilux', count: 2 });
  assert.equal(result.unidentified, 2, 'an unknown VIN and a missing VIN are both unidentified');
});

test('no service metric computes, displays or implies a Trust position', async () => {
  const client = createClient({
    orders: [order({ mechanic_id: 'mech-1', vin: 'VIN1' })],
    vehicles: [{ vin: 'VIN1', make: 'Toyota', model: 'Hilux' }],
  });
  const result = await getMechanicIntelligence(client, MECHANIC);
  const serialized = JSON.stringify(result);
  for (const forbidden of ['trust', 'Trust', 'trust_score', 'trust_band']) {
    assert.ok(!serialized.includes(forbidden), `${forbidden} must not appear in a service projection`);
  }
});

test('spam and rejected service enquiries are not leads', async () => {
  const client = createClient({
    orders: [],
    inquiries: [
      { id: 'i1', inquiry_type: 'garage_service_request', status: 'new', seller_id: 'mech-1', created_at: today },
      { id: 'i2', inquiry_type: 'garage_service_request', status: 'spam', seller_id: 'mech-1', created_at: today },
      { id: 'i3', inquiry_type: 'vehicle_purchase_interest', status: 'new', seller_id: 'mech-1', created_at: today },
    ],
  });
  const result = await getMechanicIntelligence(client, MECHANIC);
  assert.equal(result.metrics.enquiries.value, 1,
    'spam is excluded, and a vehicle-purchase enquiry is not a service enquiry');
});

// ── Failure posture ────────────────────────────────────────────────────────

test('an unreadable work-order table reports unavailable, never zero', async () => {
  const client = createClient({ failTable: 'mechanic_work_orders' });
  const result = await getMechanicIntelligence(client, MECHANIC);
  assert.equal(result.availability, AVAILABILITY.UNAVAILABLE);
  assert.match(result.message, /NOT zero/);
  assert.ok(!result.metrics, 'no metric block may accompany an unreadable read');
});

test('a genuinely empty practice reports measured zeros, distinguishable from a failure', async () => {
  const client = createClient({ orders: [], inquiries: [], records: [] });
  const result = await getMechanicIntelligence(client, MECHANIC);
  assert.equal(result.availability, AVAILABILITY.VALUE);
  assert.equal(result.metrics.work_orders.value, 0);
  assert.equal(result.metrics.work_orders.availability, AVAILABILITY.VALUE);
});

test('the calculation version travels with every projection', async () => {
  const client = createClient({ orders: [] });
  const mech = await getMechanicIntelligence(client, MECHANIC);
  const garage = await getGarageIntelligence(client, MECHANIC);
  assert.equal(mech.calculation_version, SERVICE_INTELLIGENCE_VERSION);
  assert.equal(garage.calculation_version, SERVICE_INTELLIGENCE_VERSION);
});

test('a colleague reading the same garage sees the same organization figures', async () => {
  const client = createClient({
    orders: [
      order({ id: 'a', mechanic_id: 'mech-1', tenant_id: 'garage-tenant-a' }),
      order({ id: 'b', mechanic_id: 'mech-2', tenant_id: 'garage-tenant-a' }),
    ],
  });
  const asOne = await getGarageIntelligence(client, MECHANIC);
  const asOther = await getGarageIntelligence(client, OTHER_MECHANIC);
  assert.equal(asOne.metrics.work_orders.value, asOther.metrics.work_orders.value,
    'the organization view does not change with who is looking');
});
