import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const migration=fs.readFileSync(new URL('../../database/migrations/20260828133000_global_vehicle_taxonomy_s0.sql',import.meta.url),'utf8');

test('seller write path persists every S0 commercial field instead of silently dropping it',()=>{
  for(const field of ['seller_description','seller_features','body_style','seller_stated_condition','taxonomy_version','make_taxon_id','model_taxon_id']){
    assert.match(server,new RegExp(field));
    assert.match(migration,new RegExp(field));
  }
  assert.match(server,/features:\s*form\.features|seller_features/);
});

test('global taxonomy migration is additive and preserves source values',()=>{
  assert.match(migration,/taxonomy_source_values JSONB/);
  assert.match(migration,/vehicle_taxonomy_observations/);
  assert.doesNotMatch(migration,/UPDATE\s+vehicles\s+SET\s+make\s*=/i);
  assert.doesNotMatch(migration,/UPDATE\s+vehicles\s+SET\s+model\s*=/i);
});
