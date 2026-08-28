import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCanonicalVehicleLifecycle } from '../services/report/canonicalVehicleLifecycleService.js';

function emptyClient() {
  return {
    from: () => ({
      select: () => ({
        eq: async () => ({ data: [], error: null }),
      }),
    }),
  };
}

test('canonical lifecycle preserves missing current/listing mileage as missing', async () => {
  const result = await buildCanonicalVehicleLifecycle(
    emptyClient(),
    'TESTVIN0000000001',
    {
      vehicle: {
        vin: 'TESTVIN0000000001',
        mileage: null,
        updated_at: '2026-08-28T00:00:00.000Z',
      },
      listings: [
        {
          id: 'listing-null',
          captured_at: '2026-08-27T00:00:00.000Z',
          advertised_mileage: null,
          mileage_unit: 'km',
        },
        {
          id: 'listing-blank',
          captured_at: '2026-08-26T00:00:00.000Z',
          advertised_mileage: '   ',
          mileage_unit: 'km',
        },
      ],
    },
  );

  assert.equal(result.mileage.observations.length, 0);
  assert.equal(result.events.some(event => event.source_kind === 'current_listing'), false);
  assert.equal(result.events.some(event => event.source_kind === 'listing_snapshot'), false);
});

test('canonical lifecycle keeps genuine zero mileage as a recorded fact', async () => {
  const result = await buildCanonicalVehicleLifecycle(
    emptyClient(),
    'TESTVIN0000000002',
    {
      vehicle: {
        vin: 'TESTVIN0000000002',
        mileage: 0,
        updated_at: '2026-08-28T00:00:00.000Z',
      },
      listings: [
        {
          id: 'listing-zero',
          captured_at: '2026-08-27T00:00:00.000Z',
          advertised_mileage: '0',
          mileage_unit: 'km',
        },
      ],
    },
  );

  assert.deepEqual(result.mileage.observations.map(observation => observation.value), [0, 0]);
  assert.equal(result.events.some(event => event.source_kind === 'current_listing' && event.mileage === 0), true);
  assert.equal(result.events.some(event => event.source_kind === 'listing_snapshot' && event.mileage === 0), true);
});


function clientWithRows(rowsByTable, accesses) {
  return {
    from: (table) => {
      accesses.push(table);
      return {
        select: () => ({
          eq: async () => ({ data: rowsByTable[table] || [], error: null }),
        }),
      };
    },
  };
}

test('public lifecycle never reads or publishes tenant-private operational source rows', async () => {
  const accesses = [];
  const client = clientWithRows({
    mechanic_work_orders: [{ id: 'wo-private', created_at: '2026-08-01T00:00:00.000Z', status: 'completed' }],
    insurance_records: [{ id: 'ins-private', policy_number: 'SECRET-POLICY', start_date: '2026-07-01T00:00:00.000Z', active: true }],
    vid_inspections: [{ id: 'vid-private', inspected_at: '2026-06-01T00:00:00.000Z', inspection_status: 'passed', odometer_reading: 12345 }],
  }, accesses);

  const result = await buildCanonicalVehicleLifecycle(client, 'TESTVINPRIVATE001', {
    audience: 'public',
    vehicle: { vin: 'TESTVINPRIVATE001', mileage: null },
    listings: [],
  });

  assert.equal(accesses.includes('mechanic_work_orders'), false);
  assert.equal(accesses.includes('insurance_records'), false);
  assert.equal(accesses.includes('vid_inspections'), false);
  assert.equal(result.source_states.mechanic_work_orders, 'unavailable');
  assert.equal(result.source_states.insurance_registry, 'unavailable');
  assert.equal(result.source_states.vid_inspections, 'unavailable');
  assert.equal(result.events.some(event => event.source_kind === 'mechanic_work_order'), false);
  assert.equal(result.events.some(event => event.source_kind === 'insurance_registry'), false);
  assert.equal(result.events.some(event => event.source_kind === 'vid_registry'), false);
  assert.equal(JSON.stringify(result).includes('SECRET-POLICY'), false);
});

test('privileged lifecycle retains operational source reads', async () => {
  const accesses = [];
  const client = clientWithRows({
    mechanic_work_orders: [{ id: 'wo-admin', created_at: '2026-08-01T00:00:00.000Z', status: 'completed' }],
    insurance_records: [{ id: 'ins-admin', policy_number: 'POLICY-ADMIN', start_date: '2026-07-01T00:00:00.000Z', active: true }],
    vid_inspections: [{ id: 'vid-admin', inspected_at: '2026-06-01T00:00:00.000Z', inspection_status: 'passed', odometer_reading: 12345 }],
  }, accesses);

  const result = await buildCanonicalVehicleLifecycle(client, 'TESTVINADMIN0001', {
    audience: 'admin',
    vehicle: { vin: 'TESTVINADMIN0001', mileage: null },
    listings: [],
  });

  assert.equal(accesses.includes('mechanic_work_orders'), true);
  assert.equal(accesses.includes('insurance_records'), true);
  assert.equal(accesses.includes('vid_inspections'), true);
  assert.equal(result.events.some(event => event.source_kind === 'mechanic_work_order'), true);
  assert.equal(result.events.some(event => event.source_kind === 'insurance_registry'), true);
  assert.equal(result.events.some(event => event.source_kind === 'vid_registry'), true);
});
