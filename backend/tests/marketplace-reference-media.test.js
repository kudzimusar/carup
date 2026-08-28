import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(HERE, '../fixtures/marketplace-reference-media-v1.json'), 'utf8'));
const importer = readFileSync(resolve(HERE, '../scripts/marketplace-reference-media-staging.mjs'), 'utf8');

test('reference media manifest is exactly nine vehicles x five synthetic listing images', () => {
  assert.equal(manifest.programme, 'CARUP_MARKETPLACE_REFERENCE_MEDIA_V1');
  assert.equal(manifest.environment, 'staging-only');
  assert.equal(manifest.provenance.synthetic_demo, true);
  assert.equal(manifest.provenance.evidence_eligible, false);
  assert.equal(manifest.provenance.trust_input, false);
  assert.equal(manifest.vehicles.length, 9);

  const vins = new Set();
  const generations = new Set();
  for (const vehicle of manifest.vehicles) {
    assert.match(vehicle.vin, /^[A-Z0-9]{17}$/);
    assert.equal(vehicle.synthetic_demo, true);
    assert.equal(vehicle.media.length, 5);
    assert.equal(vins.has(vehicle.vin), false);
    vins.add(vehicle.vin);

    vehicle.media.forEach((asset, index) => {
      assert.equal(asset.display_order, index);
      assert.equal(asset.is_primary, false, 'synthetic media must not invent seller primacy');
      assert.equal(generations.has(asset.generation_id), false);
      generations.add(asset.generation_id);
      const url = new URL(asset.source_url);
      assert.equal(url.protocol, 'https:');
      assert.equal(url.hostname, 'd8j0ntlcm91z4.cloudfront.net');
      assert.ok(url.pathname.includes(asset.generation_id));
    });
  }
  assert.equal(generations.size, 45);
});

test('reference media is pinned to a dedicated CarUp synthetic storage prefix', () => {
  assert.deepEqual(manifest.storage, {
    bucket: 'vehicle-images',
    prefix: 'marketplace-reference-synthetic/v1',
  });
});

test('staging importer reuses the canonical staging identity guard and never writes evidence or Trust', () => {
  assert.match(importer, /evaluateStagingGuard/);
  assert.match(importer, /marketplace-reference-synthetic\/v1/);
  assert.match(importer, /\.from\('listing_images'\)/);
  assert.doesNotMatch(importer, /\.from\('vehicle_evidence'\)/);
  assert.doesNotMatch(importer, /\.from\('vehicle_trust/);
  assert.doesNotMatch(importer, /refreshCanonicalTrust/);
  assert.match(importer, /evidence_rows_touched:\s*0/);
  assert.match(importer, /trust_rows_touched:\s*0/);
});

test('staging importer uploads complete target galleries before legacy cleanup', () => {
  const presenceGate = importer.indexOf('refused legacy cleanup because the five target assets are not all present');
  const deleteCall = importer.indexOf(".from('listing_images').delete()");
  assert.ok(presenceGate > 0);
  assert.ok(deleteCall > presenceGate, 'legacy rows may be removed only after five target images are present');
});
