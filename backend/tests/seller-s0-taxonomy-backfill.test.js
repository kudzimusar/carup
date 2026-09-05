import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

const source=fs.readFileSync(new URL('../scripts/seller-s0-taxonomy-backfill.mjs',import.meta.url),'utf8');
test('legacy taxonomy backfill preserves raw values and skips fixtures',()=>{
  assert.match(source,/getFixtureExclusion/);
  assert.match(source,/normalizeVehicleTaxonomyInput/);
  assert.match(source,/taxonomy_source_values/);
  assert.doesNotMatch(source,/set\s+make\s*=/i);
  assert.doesNotMatch(source,/set\s+model\s*=/i);
  assert.doesNotMatch(source,/set\s+color\s*=/i);
});
test('backfill receipt is aggregate-only',()=>{
  const receiptSection=source.slice(source.indexOf("const receipt="),source.indexOf("const client="));
  assert.doesNotMatch(receiptSection,/vin|owner_id|tenant_id|buyer_id|email|phone/i);
});
