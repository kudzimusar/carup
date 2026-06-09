import test from 'node:test';
import assert from 'node:assert/strict';
import { getMarketplaceNavCoverage } from '../services/marketplace/navCoverageService.js';
import { buildMockSupabase } from './fixtures/marketplaceListings.js';

// A real, public, locally_used-classified listing (valid VIN, real owner, Local/ZW, backfilled).
const luRow = (vin) => ({
  vin, make: 'Toyota', model: 'Corolla', year: 2018, price: 9500, currency: 'USD', mileage: 65000,
  fuel_type: 'Petrol', transmission: 'Manual', status: 'Available',
  owner_id: `usr-real-${vin.slice(-4)}`, tenant_id: null,
  import_source: 'Local', registration_country: 'ZW', current_seller_type: 'Private Owner',
  vehicle_condition_category: 'locally_used', passport_verified: false, duty_paid: true, police_verified: true, trust_score: 60,
});
// A fixture/demo row (synthetic VIN + seed owner + default tenant) — must be hidden, never counted.
const fixtureRow = {
  vin: 'VIN_REF_776997', make: 'Ford', model: 'Fiesta', year: 2018, price: 9500, status: 'Available',
  owner_id: 'u3', tenant_id: '00000000-0000-0000-0000-000000000001',
  import_source: 'Local', registration_country: 'ZW', vehicle_condition_category: 'locally_used',
};
const VINS = ['1HGBH41JXMN109186', '2T1BURHE8JC123456', '3N1AB7AP5KY123456'];

test('coverage returns locally_used count 3 + active when 3 real eligible rows exist', async () => {
  const sb = buildMockSupabase({ vehicles: VINS.map(luRow) });
  const cov = await getMarketplaceNavCoverage(sb);
  assert.equal(cov.categories.locally_used.count, 3);
  assert.equal(cov.categories.locally_used.active, true);
});

test('coverage returns 0 + inactive when only fixture/demo rows exist', async () => {
  const sb = buildMockSupabase({ vehicles: [fixtureRow] });
  const cov = await getMarketplaceNavCoverage(sb);
  assert.equal(cov.categories.locally_used.count, 0);
  assert.equal(cov.categories.locally_used.active, false);
});

test('threshold (>=3): 2 real rows -> inactive; 3 -> active', async () => {
  const two = await getMarketplaceNavCoverage(buildMockSupabase({ vehicles: VINS.slice(0, 2).map(luRow) }));
  assert.equal(two.categories.locally_used.count, 2);
  assert.equal(two.categories.locally_used.active, false);
  const three = await getMarketplaceNavCoverage(buildMockSupabase({ vehicles: VINS.map(luRow) }));
  assert.equal(three.categories.locally_used.active, true);
});

test('fixtures mixed with real: only real rows count toward coverage', async () => {
  const sb = buildMockSupabase({ vehicles: [...VINS.map(luRow), fixtureRow] });
  const cov = await getMarketplaceNavCoverage(sb);
  assert.equal(cov.categories.locally_used.count, 3); // fixture excluded
});

test('result shape: threshold, governed-deferred never active, no PII fields', async () => {
  const cov = await getMarketplaceNavCoverage(buildMockSupabase({ vehicles: [] }));
  assert.equal(cov.threshold, 3);
  assert.equal(cov.categories.locally_used.active, false);
  assert.equal(cov.categories.recently_imported.active, false);
  for (const g of ['passport_verified', 'partsentry_checked', 'brand_new', 'second_hand']) {
    assert.ok(cov.governed_deferred.includes(g));
    assert.equal(g in cov.categories, false); // governed never appear as activatable categories
  }
  // counts/booleans only — no owner_id/tenant_id anywhere in the payload
  const json = JSON.stringify(cov);
  assert.equal(/owner_id|tenant_id/.test(json), false);
});
