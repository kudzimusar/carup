/**
 * Service Network S6 — owner Service History projection contracts.
 *
 * Plan §3.4 records four truth debts on this surface: a hard-coded "Next Service
 * 500 km", an absent cost rendered as $0, a generic literal "Garage" standing in for
 * provider identity, and an assumed USD. These tests hold the projection that removes
 * them: every field is either a stated fact or explicitly absent (Invariant 10).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockSupabase } from './helpers/mockSupabase.js';
import { getOwnerServiceHistory } from '../services/serviceNetwork/ownerServiceHistoryService.js';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_UNPUBLISHED = '22222222-2222-2222-2222-222222222222';
const TENANT_UNKNOWN = '33333333-3333-3333-3333-333333333333';
const VIN = 'VINOWN000001';
const owner = { id: 'u-owner', role: 'owner' };

function seedClient(over = {}) {
  return createMockSupabase({
    vehicles: [{ vin: VIN, owner_id: 'u-owner' }],
    garage_public_profiles: [
      { tenant_id: TENANT_A, display_name: 'Harare Motors', slug: 'harare-motors', publication_status: 'published' },
      { tenant_id: TENANT_UNPUBLISHED, display_name: 'Quiet Garage', slug: 'quiet-garage', publication_status: 'draft' },
    ],
    mechanic_work_orders: [],
    service_records: [],
    service_mileage_observations: [],
    ...over,
  });
}

test('an owner with no vehicles gets an empty history, not an error', async () => {
  const client = seedClient({ vehicles: [] });
  const result = await getOwnerServiceHistory(client, owner);
  assert.deepEqual(result.entries, []);
  assert.equal(result.total, 0);
});

test('provider identity comes from the governed profile, never the word "Garage"', async () => {
  const client = seedClient({
    mechanic_work_orders: [{ id: 'wo-1', vin: VIN, tenant_id: TENANT_A, status: 'Completed', created_at: '2026-08-01T00:00:00Z' }],
  });
  const { entries } = await getOwnerServiceHistory(client, owner);
  assert.equal(entries[0].provider.known, true);
  assert.equal(entries[0].provider.display_name, 'Harare Motors');
  assert.equal(entries[0].provider.slug, 'harare-motors', 'a published garage is linkable');
});

test('a garage with no governed profile is reported as NOT RECORDED, not invented', async () => {
  const client = seedClient({
    mechanic_work_orders: [{ id: 'wo-1', vin: VIN, tenant_id: TENANT_UNKNOWN, status: 'Completed', created_at: '2026-08-01T00:00:00Z' }],
  });
  const { entries } = await getOwnerServiceHistory(client, owner);
  assert.equal(entries[0].provider.known, false);
  assert.equal(entries[0].provider.display_name, null, 'no placeholder name is fabricated');
  assert.equal(entries[0].provider.slug, null);
});

test('an unpublished garage is named but not linked', async () => {
  const client = seedClient({
    mechanic_work_orders: [{ id: 'wo-1', vin: VIN, tenant_id: TENANT_UNPUBLISHED, status: 'Completed', created_at: '2026-08-01T00:00:00Z' }],
  });
  const { entries } = await getOwnerServiceHistory(client, owner);
  assert.equal(entries[0].provider.known, true);
  assert.equal(entries[0].provider.display_name, 'Quiet Garage');
  assert.equal(entries[0].provider.slug, null, 'a draft garage has no public page to link to');
});

test('an unrecorded cost is reported as NOT RECORDED — never as zero', async () => {
  const client = seedClient({
    mechanic_work_orders: [{ id: 'wo-1', vin: VIN, tenant_id: TENANT_A, status: 'Completed', created_at: '2026-08-01T00:00:00Z' }],
  });
  const { entries } = await getOwnerServiceHistory(client, owner);
  assert.equal(entries[0].cost.recorded, false);
  assert.equal(entries[0].cost.amount, null);
  assert.notEqual(entries[0].cost.amount, 0, 'absent must not become zero');
});

test('a recorded cost always carries its own currency — no USD is assumed', async () => {
  const client = seedClient({
    mechanic_work_orders: [{ id: 'wo-1', vin: VIN, tenant_id: TENANT_A, status: 'Completed', created_at: '2026-08-01T00:00:00Z' }],
    service_records: [{ id: 'sr-1', work_order_id: 'wo-1', vin: VIN, tenant_id: TENANT_A, total_cost: 250, currency: 'ZWG', service_authority: 'professional_governed' }],
  });
  const { entries } = await getOwnerServiceHistory(client, owner);
  assert.equal(entries[0].cost.recorded, true);
  assert.equal(entries[0].cost.amount, 250);
  assert.equal(entries[0].cost.currency, 'ZWG', 'the recorded currency is preserved, not coerced to USD');
});

test('a cost stored WITHOUT a currency is not displayable as money', async () => {
  const client = seedClient({
    mechanic_work_orders: [{ id: 'wo-1', vin: VIN, tenant_id: TENANT_A, status: 'Completed', created_at: '2026-08-01T00:00:00Z', total_cost: 99 }],
  });
  const { entries } = await getOwnerServiceHistory(client, owner);
  assert.equal(entries[0].cost.recorded, false, 'an amount with no currency is not a safe money claim');
  assert.equal(entries[0].cost.amount, null);
});

test('provenance is stated, and defaults to unknown without a service record', async () => {
  const client = seedClient({
    mechanic_work_orders: [
      { id: 'wo-1', vin: VIN, tenant_id: TENANT_A, status: 'Completed', created_at: '2026-08-01T00:00:00Z' },
      { id: 'wo-2', vin: VIN, tenant_id: TENANT_A, status: 'Completed', created_at: '2026-08-02T00:00:00Z' },
    ],
    service_records: [{ id: 'sr-2', work_order_id: 'wo-2', vin: VIN, tenant_id: TENANT_A, service_authority: 'evidence_backed', work_performed: 'Replaced pads' }],
  });
  const { entries } = await getOwnerServiceHistory(client, owner);
  const byId = Object.fromEntries(entries.map((e) => [e.id, e]));
  assert.equal(byId['wo-1'].provenance, 'unknown');
  assert.equal(byId['wo-2'].provenance, 'evidence_backed');
  assert.equal(byId['wo-2'].work_performed, 'Replaced pads');
});

test('mileage is surfaced as an OBSERVATION with its source, or not at all', async () => {
  const client = seedClient({
    mechanic_work_orders: [{ id: 'wo-1', vin: VIN, tenant_id: TENANT_A, status: 'Completed', created_at: '2026-08-01T00:00:00Z' }],
    service_records: [{ id: 'sr-1', work_order_id: 'wo-1', vin: VIN, tenant_id: TENANT_A, service_authority: 'garage_stated' }],
    service_mileage_observations: [
      { id: 1, service_record_id: 'sr-1', vin: VIN, observed_mileage: 120000, observed_at: '2026-08-01T09:00:00Z', observation_source: 'garage_stated' },
      { id: 2, service_record_id: 'sr-1', vin: VIN, observed_mileage: 131500, observed_at: '2026-08-01T17:00:00Z', observation_source: 'mechanic_attributed' },
    ],
  });
  const { entries } = await getOwnerServiceHistory(client, owner);
  assert.equal(entries[0].mileage_observation.observed_mileage, 131500, 'the latest observation');
  assert.equal(entries[0].mileage_observation.source, 'mechanic_attributed');

  const noObs = seedClient({
    mechanic_work_orders: [{ id: 'wo-9', vin: VIN, tenant_id: TENANT_A, status: 'Completed', created_at: '2026-08-01T00:00:00Z' }],
  });
  const second = await getOwnerServiceHistory(noObs, owner);
  assert.equal(second.entries[0].mileage_observation, null, 'no reading means no claim');
});

test('the projection never invents a next-service prediction', async () => {
  const client = seedClient({
    mechanic_work_orders: [{ id: 'wo-1', vin: VIN, tenant_id: TENANT_A, status: 'Completed', created_at: '2026-08-01T00:00:00Z' }],
  });
  const { entries } = await getOwnerServiceHistory(client, owner);
  const serialized = JSON.stringify(entries);
  assert.equal(/next_service|nextService|500 km/i.test(serialized), false,
    'no authority supports a next-service due figure in Foundation 1.0');
});

test('an owner only ever sees their own vehicles', async () => {
  const client = seedClient({
    vehicles: [{ vin: VIN, owner_id: 'u-owner' }, { vin: 'OTHERVIN', owner_id: 'u-someone-else' }],
    mechanic_work_orders: [
      { id: 'wo-mine', vin: VIN, tenant_id: TENANT_A, status: 'Completed', created_at: '2026-08-01T00:00:00Z' },
      { id: 'wo-theirs', vin: 'OTHERVIN', tenant_id: TENANT_A, status: 'Completed', created_at: '2026-08-01T00:00:00Z' },
    ],
  });
  const { entries } = await getOwnerServiceHistory(client, owner);
  assert.deepEqual(entries.map((e) => e.id), ['wo-mine']);
});

test('legacy row fields are preserved so existing consumers keep working', async () => {
  const client = seedClient({
    mechanic_work_orders: [{
      id: 'wo-1', vin: VIN, tenant_id: TENANT_A, status: 'In Progress',
      description: 'Brake service', issue_description: 'legacy text', created_at: '2026-08-01T00:00:00Z',
    }],
  });
  const { entries } = await getOwnerServiceHistory(client, owner);
  assert.equal(entries[0].description, 'Brake service');
  assert.equal(entries[0].issue_description, 'legacy text');
  assert.equal(entries[0].status, 'In Progress');
  assert.equal(entries[0].vin, VIN);
});
