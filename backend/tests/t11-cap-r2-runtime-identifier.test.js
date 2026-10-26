/**
 * T11-CAP-LR01-R2 §16 — RUNTIME-LINEAGE ADAPTATION (integration candidate only; not product).
 *
 * On the Trade OS base the identifier floor lives in marketplaceClassificationRules.js. On the runtime lineage the same question is answered by the ONE
 * provenance authority (services/provenance/recordProvenance.js), which carried its own copy of the 12–17 character floor. A documented Japanese frame number
 * such as RU3-1316558 (11 characters) must not be classified as an invalid identifier there either — and nothing that was refused before may start passing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { vehicleFixtureMarker } from '../services/provenance/recordProvenance.js';
import { getFixtureExclusion } from '../services/marketplace/marketplaceClassificationRules.js';

const reason = (vin) => vehicleFixtureMarker({ vin })?.reason ?? null;

test('RT1: a documented Japanese frame number below 12 characters is a vehicle identifier — not an invalid format', () => {
  for (const vin of ['RU3-1316558', 'GFC27-027051', 'ZE1-1234567', 'NHP10-1234567']) {
    assert.equal(reason(vin), null, `${vin} was classified: ${reason(vin)}`);
    assert.equal(getFixtureExclusion({ vin }), null);
  }
});

test('RT2: everything that was refused stays refused', () => {
  const refused = ['GFC27-02705', 'ABC-123', 'RU3-13165', '1234567890', 'RU3_1316558', 'AB-12345', 'ABCDEFGHIJK'];
  for (const vin of refused) assert.match(reason(vin) || '', /invalid_vin_format|synthetic_vin_prefix/, `${vin} started passing`);
});

test('RT3: provenance markers still win over shape', () => {
  assert.match(reason('VIN-1316558') || '', /synthetic_vin_prefix/);
  assert.match(reason('E2E-123456') || '', /integration_fixture_vin|synthetic|invalid/);
  assert.match(reason('TEST-1316558') || '', /synthetic_vin_prefix/);
});

test('RT4: a standard 17-character VIN and a 12–17 character identifier are still accepted', () => {
  assert.equal(reason('1HGCM82633A004352'), null);
  assert.equal(reason('JTDKARFP0H3000731'), null);
  assert.equal(reason('GFC27-0270511'), null);
});
