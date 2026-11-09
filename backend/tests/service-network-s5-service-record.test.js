/**
 * Service Network S5 — service record, mileage, PartSentry and Evidence contracts.
 *
 * The load-bearing one is mileage: vehicles.mileage keeps its single existing
 * writer (partsentryService.addRepairLog), and Service Network records only
 * OBSERVATIONS. These tests prove no second canonical writer was introduced.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockSupabase } from './helpers/mockSupabase.js';
import {
  SERVICE_AUTHORITIES,
  getServiceRecord,
  linkEvidence,
  linkPartRecord,
  recordMileageObservation,
  recordService,
} from '../services/serviceNetwork/serviceRecordService.js';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const VIN = 'VINSR000001';
const WO = '11111111-2222-3333-4444-555555555555';

const mechA = { id: 'u-mech', role: 'mechanic', tenantId: TENANT_A };
const mechB = { id: 'u-mech-b', role: 'mechanic', tenantId: TENANT_B };

const CASE_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

function seedClient(over = {}) {
  return createMockSupabase({
    vehicles: [{ vin: VIN, owner_id: 'u-owner', mileage: 120000 }],
    tenants: [{ id: TENANT_A, type: 'garage' }, { id: TENANT_B, type: 'garage' }],
    // Evidence may only be attached through a governed engagement, so the work order
    // carries a real Service Case for this vehicle and this garage.
    service_cases: [{ id: CASE_ID, vin: VIN, garage_tenant_id: TENANT_A, requester_user_id: 'u-owner', status: 'active' }],
    mechanic_work_orders: [
      { id: WO, tenant_id: TENANT_A, vin: VIN, status: 'In Progress', service_case_id: CASE_ID, service_category: 'brakes' },
    ],
    partsentry_logs: [{ id: 42, vin: VIN, tenant_id: TENANT_A, part_name: 'Front pads' }],
    vehicle_evidence: [{ id: 'ev-1', vin: VIN }],
    service_records: [],
    service_mileage_observations: [],
    service_record_parts: [],
    service_record_evidence: [],
    ...over,
  });
}

async function makeRecord(client, body = {}) {
  const { record } = await recordService(client, mechA, WO, { work_performed: 'Replaced front pads', ...body });
  return record;
}

test('a service record captures what was done, with explicit provenance', async () => {
  const client = seedClient();
  const record = await makeRecord(client, { service_authority: 'professional_governed' });
  assert.equal(record.vin, VIN);
  assert.equal(record.tenant_id, TENANT_A);
  assert.equal(record.work_performed, 'Replaced front pads');
  assert.equal(record.service_authority, 'professional_governed');
  assert.equal(record.service_category, 'brakes', 'inherited from the work order');
  assert.ok(record.performed_at);
});

test('provenance defaults to unknown rather than to a flattering guess', async () => {
  const client = seedClient();
  const record = await makeRecord(client);
  assert.equal(record.service_authority, 'unknown');
  assert.ok(SERVICE_AUTHORITIES.includes('evidence_backed'));
  await assert.rejects(
    () => recordService(client, mechA, WO, { service_authority: 'verified_repair' }),
    /Unknown service provenance/,
  );
});

test('a mileage observation NEVER writes the canonical odometer', async () => {
  const client = seedClient();
  const record = await makeRecord(client);
  const before = client._tables.vehicles[0].mileage;

  const result = await recordMileageObservation(client, mechA, record.id, {
    observed_mileage: 131500, observation_source: 'mechanic_attributed',
  });

  assert.equal(result.observation.observed_mileage, 131500);
  assert.equal(client._tables.vehicles[0].mileage, before,
    'vehicles.mileage must keep its single existing writer');
  assert.equal(result.canonical_mileage, 120000);
  assert.equal(result.disagrees_with_canonical, false);
});

test('a DISAGREEING reading is recorded and reported, not silently discarded', async () => {
  const client = seedClient();
  const record = await makeRecord(client);
  const result = await recordMileageObservation(client, mechA, record.id, { observed_mileage: 90000 });

  assert.equal(result.observation.observed_mileage, 90000, 'the disagreement is preserved');
  assert.equal(result.disagrees_with_canonical, true, 'and surfaced');
  assert.equal(client._tables.vehicles[0].mileage, 120000, 'while the canonical value is untouched');
});

test('with no canonical odometer to compare against, the answer is unknown — not "agrees"', async () => {
  const client = seedClient({ vehicles: [{ vin: VIN, owner_id: 'u-owner', mileage: null }] });
  const record = await makeRecord(client);
  const result = await recordMileageObservation(client, mechA, record.id, { observed_mileage: 100 });
  assert.equal(result.canonical_mileage, null);
  assert.equal(result.disagrees_with_canonical, null, 'unknown is not false');
});

test('mileage observation vocabulary and bounds are enforced', async () => {
  const client = seedClient();
  const record = await makeRecord(client);
  await assert.rejects(() => recordMileageObservation(client, mechA, record.id, { observed_mileage: -1 }), /non-negative integer/);
  await assert.rejects(() => recordMileageObservation(client, mechA, record.id, { observed_mileage: 1.5 }), /non-negative integer/);
  await assert.rejects(
    () => recordMileageObservation(client, mechA, record.id, { observed_mileage: 100, observation_source: 'telepathy' }),
    /Unknown mileage observation source/,
  );
});

test('recorded money carries a currency; absent cost stays absent', async () => {
  const client = seedClient();
  await assert.rejects(() => recordService(client, mechA, WO, { total_cost: 250 }), /currency .* is required/);

  const priced = await makeRecord(client, { total_cost: 250, currency: 'usd' });
  assert.equal(priced.total_cost, 250);
  assert.equal(priced.currency, 'USD');

  const unpriced = await makeRecord(client);
  assert.equal(unpriced.total_cost, null, 'absent cost must not become zero');
  assert.equal(unpriced.currency, null);
});

test('parts link to PartSentry rather than being re-implemented', async () => {
  const client = seedClient();
  const record = await makeRecord(client);
  const linked = await linkPartRecord(client, mechA, record.id, { partsentry_log_id: 42 });
  assert.equal(linked.created, true);
  assert.equal(linked.link.partsentry_log_id, 42);
  assert.equal(client._tables.partsentry_logs.length, 1, 'no part record was duplicated');

  const retry = await linkPartRecord(client, mechA, record.id, { partsentry_log_id: 42 });
  assert.equal(retry.created, false, 'a retry does not double-attach');
});

test('a part record from another vehicle or garage cannot be attached', async () => {
  const client = seedClient({
    partsentry_logs: [
      { id: 42, vin: VIN, tenant_id: TENANT_A },
      { id: 43, vin: 'OTHERVIN', tenant_id: TENANT_A },
      { id: 44, vin: VIN, tenant_id: TENANT_B },
    ],
  });
  const record = await makeRecord(client);
  await assert.rejects(() => linkPartRecord(client, mechA, record.id, { partsentry_log_id: 43 }), /different vehicle/);
  await assert.rejects(() => linkPartRecord(client, mechA, record.id, { partsentry_log_id: 44 }), /different garage/);
  await assert.rejects(() => linkPartRecord(client, mechA, record.id, { partsentry_log_id: 999 }), /not found/i);
});

test('evidence-backed provenance is EARNED by attaching evidence, never claimed', async () => {
  const client = seedClient();
  const record = await makeRecord(client, { service_authority: 'garage_stated' });
  assert.equal(record.service_authority, 'garage_stated');

  await linkEvidence(client, mechA, record.id, { evidence_id: 'ev-1' });

  const stored = client._tables.service_records.find((r) => r.id === record.id);
  assert.equal(stored.service_authority, 'evidence_backed',
    'provenance strengthens only because real evidence was attached');
});

test('evidence from another vehicle cannot be attached', async () => {
  const client = seedClient({ vehicle_evidence: [{ id: 'ev-other', vin: 'OTHERVIN' }] });
  const record = await makeRecord(client);
  await assert.rejects(() => linkEvidence(client, mechA, record.id, { evidence_id: 'ev-other' }), /different vehicle/);
  await assert.rejects(() => linkEvidence(client, mechA, record.id, { evidence_id: 'ev-missing' }), /not found/i);
});

test('no service can be recorded against a terminal work order', async () => {
  const client = seedClient({
    mechanic_work_orders: [{ id: WO, tenant_id: TENANT_A, vin: VIN, status: 'Completed' }],
  });
  await assert.rejects(() => recordService(client, mechA, WO, {}), /remains historical/);
});

test('another garage can neither record against nor read this work', async () => {
  const client = seedClient();
  const record = await makeRecord(client);
  await assert.rejects(() => recordService(client, mechB, WO, {}), /not found/i);
  await assert.rejects(() => getServiceRecord(client, mechB, record.id), /not found/i);
  await assert.rejects(
    () => recordMileageObservation(client, mechB, record.id, { observed_mileage: 1 }),
    /not found/i,
  );
});

test('the full source view assembles observations, parts and evidence', async () => {
  const client = seedClient();
  const record = await makeRecord(client);
  await recordMileageObservation(client, mechA, record.id, { observed_mileage: 131500 });
  await linkPartRecord(client, mechA, record.id, { partsentry_log_id: 42 });
  await linkEvidence(client, mechA, record.id, { evidence_id: 'ev-1' });

  const view = await getServiceRecord(client, mechA, record.id);
  assert.equal(view.mileage_observations.length, 1);
  assert.equal(view.part_records.length, 1);
  assert.equal(view.evidence_references.length, 1);
  assert.equal(view.record.vin, VIN);
});
