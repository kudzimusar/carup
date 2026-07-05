/**
 * Workstream 12 — capability feature flags: fail-closed production, overrides, kill switch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CAPABILITY_FLAGS, isCapabilityEnabled, capabilitySnapshot } from '../services/featureFlags/capabilityFlags.js';

test('all required capability flags are registered', () => {
  for (const f of ['zimra_adapter', 'cvr_adapter', 'zinara_adapter', 'vid_adapter', 'cid_adapter',
    'fraud_engine', 'dealer_compliance', 'mobile_offline_uploads', 'insurance_eligibility',
    'finance_eligibility', 'escrow', 'partner_api']) {
    assert.ok(CAPABILITY_FLAGS.includes(f), `missing flag ${f}`);
  }
});

test('enabled by default outside production', () => {
  assert.equal(isCapabilityEnabled('fraud_engine', { NODE_ENV: 'test' }), true);
});

test('fail-closed in production unless CAPABILITIES_LIVE=1', () => {
  assert.equal(isCapabilityEnabled('escrow', { NODE_ENV: 'production' }), false);
  assert.equal(isCapabilityEnabled('escrow', { NODE_ENV: 'production', CAPABILITIES_LIVE: '1' }), true);
});

test('per-flag explicit override wins', () => {
  assert.equal(isCapabilityEnabled('zimra_adapter', { NODE_ENV: 'production', FLAG_ZIMRA_ADAPTER: '1' }), true);
  assert.equal(isCapabilityEnabled('zimra_adapter', { NODE_ENV: 'test', FLAG_ZIMRA_ADAPTER: '0' }), false);
});

test('emergency kill switch forces everything off', () => {
  const snap = capabilitySnapshot({ NODE_ENV: 'test', CAPABILITY_KILL_SWITCH: '1' });
  assert.ok(Object.values(snap).every((v) => v === false));
});

test('snapshot covers all flags', () => {
  const snap = capabilitySnapshot({ NODE_ENV: 'test' });
  assert.equal(Object.keys(snap).length, CAPABILITY_FLAGS.length);
});
