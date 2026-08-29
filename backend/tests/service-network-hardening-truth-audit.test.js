/**
 * Service Network hardening — truth and presentation audit.
 *
 * Guards the distinctions that are easy to erode one commit at a time:
 * published ≠ verified, activity ≠ quality, service ≠ Trust, unknown ≠ zero.
 * These read the SOURCE of the Service Network modules, so a future edit that
 * reintroduces a forbidden claim or a second authority fails here rather than in review.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMockSupabase } from './helpers/mockSupabase.js';
import { getPublicGarageDetail, publishMyGarageProfile, upsertMyGarageProfile } from '../services/serviceNetwork/garageDirectoryService.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SN_DIR = path.join(HERE, '..', 'services', 'serviceNetwork');
const sources = fs.readdirSync(SN_DIR)
  .filter((f) => f.endsWith('.js'))
  .map((f) => ({ file: f, text: fs.readFileSync(path.join(SN_DIR, f), 'utf8') }));

/** Strip comments so prohibitions written in prose are not mistaken for code. */
function codeOnly(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('Service Network contains no Trust writer (Invariant 4)', () => {
  for (const { file, text } of sources) {
    const code = codeOnly(text);
    assert.equal(/trust_score\s*:/.test(code), false, `${file} appears to write trust_score`);
    assert.equal(/refreshCanonicalTrust|trustEnforcementEngine|trustGraphService/.test(code), false,
      `${file} reaches into a Trust engine`);
  }
});

test('Service Network contains no ownership or seller writer', () => {
  for (const { file, text } of sources) {
    const code = codeOnly(text);
    assert.equal(/owner_id\s*:/.test(code), false, `${file} appears to write owner_id`);
    assert.equal(/current_seller_id\s*:/.test(code), false, `${file} appears to write current_seller_id`);
  }
});

test('Service Network contains no second canonical-odometer writer (plan §13.1)', () => {
  for (const { file, text } of sources) {
    const code = codeOnly(text);
    const writesVehicleMileage = /from\(['"]vehicles['"]\)[\s\S]{0,200}?\.update\(/.test(code);
    assert.equal(writesVehicleMileage, false, `${file} appears to update the vehicles table`);
  }
});

test('published is never presented as verified', async () => {
  const TENANT = '11111111-1111-1111-1111-111111111111';
  const client = createMockSupabase({
    tenants: [{ id: TENANT, type: 'garage', name: 'A' }],
    garage_public_profiles: [], garage_branches: [], partsentry_logs: [],
  });
  const garage = { id: 'u-a', tenantId: TENANT };
  await upsertMyGarageProfile(client, garage, {
    display_name: 'Harare Motors', location_city: 'Harare', service_categories: ['engine'],
  });
  await publishMyGarageProfile(client, garage);

  const detail = await getPublicGarageDetail(client, 'harare-motors');
  // Publishing is the garage's own act. It must confer no verification claim.
  assert.deepEqual(detail.garage.verification_dimensions, {},
    'a published garage is not thereby a verified one');
  const serialized = JSON.stringify(detail);
  assert.equal(/"verified"\s*:\s*true/i.test(serialized), false);
  assert.equal(/rating|stars|certified|accredited/i.test(serialized), false,
    'no quality or credential claim may appear in the public projection');
});

test('no Service Network surface fabricates a rating, certification or quality claim', () => {
  for (const { file, text } of sources) {
    const code = codeOnly(text);
    for (const banned of ['rating', 'star_rating', 'certified', 'accreditation', 'quality_score']) {
      // The metric catalogue may NAME customer_rating in order to refuse it.
      if (file === 'serviceMetricCatalogue.js') continue;
      assert.equal(new RegExp(`${banned}\\s*:`).test(code), false,
        `${file} appears to emit a ${banned} field`);
    }
  }
});

test('absent money is never coerced to zero anywhere in Service Network', () => {
  for (const { file, text } of sources) {
    const code = codeOnly(text);
    assert.equal(/total_cost\s*\|\|\s*0/.test(code), false, `${file} coerces absent cost to zero`);
    assert.equal(/cost\s*\?\?\s*0/.test(code), false, `${file} coerces absent cost to zero`);
  }
});

test('every Service Network migration is retention-safe', () => {
  const migDir = path.join(HERE, '..', '..', 'database', 'migrations');
  const migrations = fs.readdirSync(migDir).filter((f) => f.includes('service_network'));
  assert.ok(migrations.length >= 6, 'expected the Service Network migration set');
  for (const file of migrations) {
    const sql = fs.readFileSync(path.join(migDir, file), 'utf8');
    assert.equal(/ON DELETE CASCADE/.test(sql), false,
      `${file} uses ON DELETE CASCADE — history could be erased by an unrelated delete`);
    assert.equal(/GRANT[^;]*\bDELETE\b[^;]*TO service_role/.test(sql), false,
      `${file} grants DELETE — Service Network records change state, they are not destroyed`);
  }
});
