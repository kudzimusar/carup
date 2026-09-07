/**
 * Service Network S9 — garage surface projections.
 *
 * CustomerRecords previously shipped four invented people — fabricated names, phone
 * numbers, emails and spend — on a live product surface. These tests hold the projection
 * that replaces it with the garage's real customers, and the queue that S2's cases need.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockSupabase } from './helpers/mockSupabase.js';
import { getGarageCustomers, getGarageQueue } from '../services/serviceNetwork/garageQueueService.js';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const garageA = { id: 'u-mgr', role: 'mechanic', tenantId: TENANT_A };
const garageB = { id: 'u-mgr-b', role: 'mechanic', tenantId: TENANT_B };

function seedClient(over = {}) {
  return createMockSupabase({
    vehicles: [
      { vin: 'VIN1', make: 'Toyota', model: 'Hilux', year: 2019, owner_id: 'u-cust-1' },
      { vin: 'VIN2', make: 'Mazda', model: 'BT-50', year: 2020, owner_id: 'u-cust-2' },
    ],
    users: [{ id: 'u-cust-1', name: 'Tendai Moyo' }, { id: 'u-cust-2', name: null }],
    service_cases: [],
    mechanic_work_orders: [],
    service_records: [],
    ...over,
  });
}

const aCase = (over = {}) => ({
  id: 'case-1', vin: 'VIN1', garage_tenant_id: TENANT_A, requester_user_id: 'u-cust-1',
  status: 'requested', service_category: 'brakes', requested_at: '2026-08-01T09:00:00Z',
  accepted_at: null, completed_at: null, branch_id: null, conversation_thread_id: null, ...over,
});

test('the queue shows only this garage cases, ordered by what needs attention first', async () => {
  const client = seedClient({
    service_cases: [
      aCase({ id: 'c-active', status: 'active', requested_at: '2026-08-01T09:00:00Z' }),
      aCase({ id: 'c-requested', status: 'requested', requested_at: '2026-08-03T09:00:00Z' }),
      aCase({ id: 'c-accepted', status: 'accepted', requested_at: '2026-08-02T09:00:00Z' }),
      aCase({ id: 'c-other-garage', garage_tenant_id: TENANT_B, status: 'requested' }),
    ],
  });
  const { queue, counts } = await getGarageQueue(client, garageA, {});
  assert.deepEqual(queue.map(q => q.id), ['c-requested', 'c-accepted', 'c-active']);
  assert.deepEqual(counts, { requested: 1, accepted: 1, active: 1 });
  assert.equal(queue.some(q => q.id === 'c-other-garage'), false, 'never another tenant\'s work');
});

test('closed cases are not in the open queue', async () => {
  const client = seedClient({
    service_cases: [
      aCase({ id: 'c-open', status: 'requested' }),
      aCase({ id: 'c-done', status: 'completed' }),
      aCase({ id: 'c-declined', status: 'declined' }),
      aCase({ id: 'c-cancelled', status: 'cancelled' }),
    ],
  });
  const { queue } = await getGarageQueue(client, garageA, {});
  assert.deepEqual(queue.map(q => q.id), ['c-open']);
});

test('the queue states the next action from real state, never a guess', async () => {
  const client = seedClient({
    service_cases: [
      aCase({ id: 'c1', status: 'requested' }),
      aCase({ id: 'c2', status: 'accepted' }),
      aCase({ id: 'c3', status: 'accepted' }),
      aCase({ id: 'c4', status: 'active' }),
    ],
    mechanic_work_orders: [{ id: 'wo-3', service_case_id: 'c3', status: 'In Progress' }],
  });
  const { queue } = await getGarageQueue(client, garageA, {});
  const byId = Object.fromEntries(queue.map(q => [q.id, q]));
  assert.equal(byId.c1.next_action, 'accept_or_decline');
  assert.equal(byId.c2.next_action, 'open_work_order', 'accepted with no work order');
  assert.equal(byId.c3.next_action, 'start_work', 'accepted with a work order');
  assert.equal(byId.c4.next_action, 'record_service');
  assert.equal(byId.c3.work_order.id, 'wo-3');
  assert.equal(byId.c2.work_order, null);
});

test('an unresolvable vehicle or category is stated as unknown, not defaulted', async () => {
  const client = seedClient({
    service_cases: [aCase({ vin: 'VIN-MISSING', service_category: null })],
  });
  const { queue } = await getGarageQueue(client, garageA, {});
  assert.equal(queue[0].vehicle, null, 'no placeholder vehicle is invented');
  assert.equal(queue[0].vin, 'VIN-MISSING', 'the VIN is still reported');
  assert.equal(queue[0].service_category, null, 'not defaulted to "General"');
});

test('an empty queue is empty, not an error', async () => {
  const client = seedClient();
  const result = await getGarageQueue(client, garageA, {});
  assert.deepEqual(result.queue, []);
  assert.deepEqual(result.counts, { requested: 0, accepted: 0, active: 0 });
});

test('a queue read requires a membership-verified garage tenant context', async () => {
  const client = seedClient({ service_cases: [aCase()] });
  await assert.rejects(() => getGarageQueue(client, { id: 'u-nobody' }, {}), /membership-verified garage tenant context/);
  await assert.rejects(() => getGarageCustomers(client, { id: 'u-nobody' }), /membership-verified garage tenant context/);
});

test('customers are the garage real customers, counted from its own records', async () => {
  const client = seedClient({
    service_cases: [
      aCase({ id: 'c1', requester_user_id: 'u-cust-1', vin: 'VIN1', status: 'completed', completed_at: '2026-08-05T00:00:00Z' }),
      aCase({ id: 'c2', requester_user_id: 'u-cust-1', vin: 'VIN2', status: 'requested', requested_at: '2026-08-06T00:00:00Z' }),
      aCase({ id: 'c3', requester_user_id: 'u-cust-2', vin: 'VIN2', status: 'completed', completed_at: '2026-08-01T00:00:00Z' }),
      aCase({ id: 'c4', garage_tenant_id: TENANT_B, requester_user_id: 'u-cust-9' }),
    ],
  });
  const { customers, total } = await getGarageCustomers(client, garageA);
  assert.equal(total, 2, 'only this garage customers');
  const tendai = customers.find(c => c.user_id === 'u-cust-1');
  assert.equal(tendai.display_name, 'Tendai Moyo');
  assert.equal(tendai.case_count, 2);
  assert.equal(tendai.completed_count, 1);
  assert.equal(tendai.vehicle_count, 2);
  assert.equal(customers.some(c => c.user_id === 'u-cust-9'), false);
});

test('a customer with no resolvable name is unnamed, never invented', async () => {
  const client = seedClient({
    service_cases: [aCase({ requester_user_id: 'u-cust-2' })],
  });
  const { customers } = await getGarageCustomers(client, garageA);
  assert.equal(customers[0].display_name, null, 'the UI says "Unnamed customer"; no name is fabricated');
});

test('no contact details are harvested — Communications owns reaching the customer', async () => {
  const client = seedClient({
    users: [{ id: 'u-cust-1', name: 'Tendai Moyo', email: 'tendai@example.com', phone: '+263 773 345 678' }],
    service_cases: [aCase({ conversation_thread_id: 'thread-1' })],
  });
  const { customers } = await getGarageCustomers(client, garageA);
  const serialized = JSON.stringify(customers);
  assert.equal(serialized.includes('tendai@example.com'), false, 'no email is exposed to the garage');
  assert.equal(serialized.includes('+263'), false, 'no phone number is exposed');
  assert.equal(customers[0].conversation_thread_id, 'thread-1', 'contact goes through the bound conversation');
});

test('spend is tracked per currency and never summed across currencies', async () => {
  const client = seedClient({
    service_cases: [
      aCase({ id: 'c1', requester_user_id: 'u-cust-1' }),
      aCase({ id: 'c2', requester_user_id: 'u-cust-1' }),
      aCase({ id: 'c3', requester_user_id: 'u-cust-1' }),
    ],
    service_records: [
      { service_case_id: 'c1', total_cost: 250, currency: 'ZWG' },
      { service_case_id: 'c2', total_cost: 100, currency: 'USD' },
      { service_case_id: 'c3', total_cost: null, currency: null },
    ],
  });
  const { customers } = await getGarageCustomers(client, garageA);
  assert.deepEqual(customers[0].spend_by_currency, { ZWG: 250, USD: 100 });
  assert.equal(JSON.stringify(customers[0].spend_by_currency).includes('350'), false, 'currencies are never added');
});

test('a customer with no recorded cost shows no spend — not zero spend', async () => {
  const client = seedClient({ service_cases: [aCase()] });
  const { customers } = await getGarageCustomers(client, garageA);
  assert.deepEqual(customers[0].spend_by_currency, {}, 'an empty map means unrecorded, not zero');
});
