import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

const runner=fs.readFileSync(new URL('../scripts/seller-s0-taxonomy-staging.mjs',import.meta.url),'utf8');
test('S0 staging runner is staging-only and preflights before apply',()=>{
  assert.match(runner,/eoyenigwevnxwwhyhaer/);
  assert.match(runner,/--mode=/);
  assert.match(runner,/ROLLBACK/);
  assert.match(runner,/vehicle_taxonomy_observations/);
  assert.match(runner,/20260828143000_global_vehicle_taxonomy_color_s0/);
  assert.doesNotMatch(runner,/production/i);
});
test('S0 receipt inventory does not select VIN or seller identity',()=>{
  const inventorySection=runner.slice(runner.indexOf('async function m0Inventory'),runner.indexOf('async function verifySchema'));
  assert.doesNotMatch(inventorySection,/select\s+vin/i);
  assert.doesNotMatch(inventorySection,/owner_id|buyer_id|email|phone/i);
});
