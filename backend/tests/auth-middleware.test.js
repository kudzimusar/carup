import assert from 'node:assert/strict';
import test from 'node:test';
import { isUserIdFallbackAllowed, resolveEffectiveRole } from '../middleware/authMiddleware.js';

test('rejects spoofed stakeholder role when it is not verified for the user', () => {
  assert.throws(
    () => resolveEffectiveRole({ userRole: 'owner', requestedRole: 'admin' }, { NODE_ENV: 'production' }),
    /not verified/
  );
});

test('accepts the verified user role as the effective role', () => {
  assert.equal(resolveEffectiveRole({ userRole: 'dealer', requestedRole: 'dealer' }, { NODE_ENV: 'production' }), 'dealer');
});

test('requires tenant role to be verified before using it', () => {
  assert.equal(
    resolveEffectiveRole({ userRole: 'owner', tenantRole: 'mechanic', requestedRole: 'mechanic' }, { NODE_ENV: 'production' }),
    'mechanic'
  );
});

test('does not treat tenant admin as global admin escalation', () => {
  assert.throws(
    () => resolveEffectiveRole({ userRole: 'dealer', tenantRole: 'admin', requestedRole: 'admin' }, { NODE_ENV: 'production' }),
    /not verified/
  );
});

test('x-user-id fallback is unavailable outside local and test modes', () => {
  assert.equal(isUserIdFallbackAllowed({ NODE_ENV: 'production' }), false);
  assert.equal(isUserIdFallbackAllowed({ NODE_ENV: 'test' }), true);
  assert.equal(isUserIdFallbackAllowed({ NODE_ENV: 'development' }), true);
  assert.equal(isUserIdFallbackAllowed({ CARUP_ALLOW_X_USER_ID_FALLBACK: 'true', NODE_ENV: 'production' }), true);
});
