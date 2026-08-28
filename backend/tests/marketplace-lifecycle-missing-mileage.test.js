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
