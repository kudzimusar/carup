import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateLoginCredentials,
  hashPassword,
  isPasswordlessLoginAllowed,
  verifyPassword,
} from '../utils/passwordAuth.js';

test('hashPassword/verifyPassword roundtrip accepts the right password only', async () => {
  const hash = await hashPassword('Phase7B-test-2026');
  assert.match(hash, /^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/);
  assert.equal(await verifyPassword('Phase7B-test-2026', hash), true);
  assert.equal(await verifyPassword('wrong-password', hash), false);
  assert.equal(await verifyPassword('', hash), false);
  assert.equal(await verifyPassword(undefined, hash), false);
});

test('hashPassword rejects short passwords', async () => {
  await assert.rejects(() => hashPassword('short'), /at least 8 characters/);
});

test('verifyPassword rejects malformed stored hashes', async () => {
  assert.equal(await verifyPassword('whatever', 'plaintext'), false);
  assert.equal(await verifyPassword('whatever', 'md5:abc:def'), false);
  assert.equal(await verifyPassword('whatever', null), false);
});

test('passwordless login is disabled in production unless explicitly flagged', () => {
  assert.equal(isPasswordlessLoginAllowed({ NODE_ENV: 'production' }), false);
  assert.equal(isPasswordlessLoginAllowed({ NODE_ENV: 'production', CARUP_ALLOW_PASSWORDLESS_LOGIN: 'false' }), false);
  assert.equal(isPasswordlessLoginAllowed({ NODE_ENV: 'production', CARUP_ALLOW_PASSWORDLESS_LOGIN: 'true' }), true);
  assert.equal(isPasswordlessLoginAllowed({ NODE_ENV: 'development' }), true);
  assert.equal(isPasswordlessLoginAllowed({ NODE_ENV: 'test' }), true);
});

test('email-only login does NOT authenticate in production mode', async () => {
  // Legacy account without a stored password hash: in production, email
  // alone must be rejected regardless of what password was supplied.
  const legacyUser = { id: 'u_legacy', email: 'legacy@example.com', password_hash: null };

  const noPassword = await evaluateLoginCredentials({
    user: legacyUser,
    password: undefined,
    env: { NODE_ENV: 'production' },
  });
  assert.equal(noPassword.ok, false);
  assert.equal(noPassword.reason, 'password_not_set');

  const anyPassword = await evaluateLoginCredentials({
    user: legacyUser,
    password: 'anything-goes',
    env: { NODE_ENV: 'production' },
  });
  assert.equal(anyPassword.ok, false);
});

test('email-only login still works for legacy accounts in local/dev mode', async () => {
  const legacyUser = { id: 'u_legacy', email: 'legacy@example.com', password_hash: null };
  const result = await evaluateLoginCredentials({
    user: legacyUser,
    password: undefined,
    env: { NODE_ENV: 'development' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.method, 'legacy_passwordless');
});

test('accounts with a stored hash always require the matching password, even in dev', async () => {
  const hash = await hashPassword('CorrectHorse9');
  const user = { id: 'u_secure', email: 'secure@example.com', password_hash: hash };

  const wrong = await evaluateLoginCredentials({ user, password: 'wrong', env: { NODE_ENV: 'development' } });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.reason, 'invalid_password');

  const missing = await evaluateLoginCredentials({ user, password: undefined, env: { NODE_ENV: 'development' } });
  assert.equal(missing.ok, false);

  const right = await evaluateLoginCredentials({ user, password: 'CorrectHorse9', env: { NODE_ENV: 'production' } });
  assert.equal(right.ok, true);
  assert.equal(right.method, 'password');
});

test('unknown user is rejected', async () => {
  const result = await evaluateLoginCredentials({ user: null, password: 'x', env: { NODE_ENV: 'production' } });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unknown_user');
});
