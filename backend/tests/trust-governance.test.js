import assert from 'node:assert/strict';
import test from 'node:test';
import { canSetTrustFact } from '../services/trustGovernance/trustPermissionService.js';

test('owner cannot approve trust facts', () => {
  const result = canSetTrustFact({ id: 'u1', role: 'owner' }, 'passport_verified', 'approve');
  assert.equal(result.allowed, false);
  assert.match(result.reason, /Owner cannot/);
});

test('dealer cannot self-certify dealer_verified', () => {
  const result = canSetTrustFact({ id: 'u3', role: 'dealer' }, 'dealer_verified', 'approve');
  assert.equal(result.allowed, false);
  assert.match(result.reason, /self-certify/);
});

test('mechanic cannot verify their own part records by default', () => {
  const result = canSetTrustFact(
    { id: 'u2', role: 'mechanic' },
    'verified_parts',
    'approve',
    { submittedBy: 'u2' }
  );
  assert.equal(result.allowed, false);
  assert.match(result.reason, /own part records/);
});

test('government can approve plate ZIMRA and CID facts', () => {
  for (const fact of ['plate_verified', 'zimra_verified', 'cid_clear']) {
    const result = canSetTrustFact({ id: 'u5', role: 'government' }, fact, 'approve');
    assert.equal(result.allowed, true, `${fact} should be allowed`);
  }
});

test('finance and bank can set SafePay readiness through future workflow', () => {
  assert.equal(canSetTrustFact({ id: 'f1', role: 'finance' }, 'safe_pay_ready', 'set').allowed, true);
  assert.equal(canSetTrustFact({ id: 'b1', role: 'bank' }, 'safe_pay_ready', 'approve').allowed, true);
});

test('admin approve and revoke actions require a reason', () => {
  assert.equal(canSetTrustFact({ id: 'u9', role: 'admin' }, 'passport_verified', 'approve').allowed, false);
  assert.equal(
    canSetTrustFact({ id: 'u9', role: 'admin' }, 'passport_verified', 'approve', { reason: 'Reviewed evidence bundle' }).allowed,
    true
  );
});

test('system can refresh summaries but cannot create source facts', () => {
  assert.equal(
    canSetTrustFact({ role: 'system' }, 'vehicle_listing_summaries_refresh', 'refresh').allowed,
    true
  );
  assert.equal(
    canSetTrustFact({ role: 'system' }, 'passport_verified', 'approve').allowed,
    false
  );
});
