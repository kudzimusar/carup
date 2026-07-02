/**
 * Release-acceptance regression (P1) — webhook signature must FAIL CLOSED in production
 * when the provider secret env is unset, and the dev-bypass must be opt-in only.
 * (PROVIDER_SECRETS/IS_PRODUCTION are evaluated at call-time, so env is set per-assertion.)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { sign, verifyWebhook } from '../services/eligibility/webhookSecurity.js';

const MANAGED = ['NODE_ENV', 'CARUP_ENV', 'INSURANCE_WEBHOOK_SECRET', 'FINANCE_WEBHOOK_SECRET', 'WEBHOOK_DEV_BYPASS'];
function withEnv(env, fn) {
  // Only touch the keys this test manages — never wipe unrelated env (avoids cross-test flakiness).
  const saved = Object.fromEntries(MANAGED.map((k) => [k, process.env[k]]));
  for (const k of MANAGED) delete process.env[k];
  Object.assign(process.env, env);
  try { fn(); } finally {
    for (const k of MANAGED) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

test('production with NO secret env -> a forged signature cannot verify', () => {
  withEnv({ NODE_ENV: 'production' }, () => {
    assert.equal(sign('insurance_sandbox', '{}', '1000'), null);
    const v = verifyWebhook('insurance_sandbox', '{}', 'deadbeef', '1000', 1000);
    assert.equal(v.valid, false);
    assert.equal(v.reason, 'unknown_provider');
  });
});

test('production dev-bypass is never honored', () => {
  withEnv({ NODE_ENV: 'production', WEBHOOK_DEV_BYPASS: '1' }, () => {
    assert.equal(verifyWebhook('insurance_sandbox', '{}', 'dev-bypass-sig', String(Date.now())).valid, false);
  });
});

test('staging (non-prod) without the flag does NOT honor dev-bypass', () => {
  withEnv({ NODE_ENV: 'test' }, () => {
    assert.equal(verifyWebhook('insurance_sandbox', '{}', 'dev-bypass-sig', String(Date.now())).valid, false);
  });
});

test('dev-bypass works only with the explicit flag outside production', () => {
  withEnv({ NODE_ENV: 'test', WEBHOOK_DEV_BYPASS: '1' }, () => {
    assert.equal(verifyWebhook('insurance_sandbox', '{}', 'dev-bypass-sig', String(Date.now())).valid, true);
  });
});

test('outside production a real signed payload still verifies (sandbox reproducible)', () => {
  withEnv({ NODE_ENV: 'test' }, () => {
    const ts = String(Date.now());
    const sig = sign('insurance_sandbox', '{"a":1}', ts);
    assert.ok(sig);
    assert.equal(verifyWebhook('insurance_sandbox', '{"a":1}', sig, ts).valid, true);
  });
});

test('production WITH a configured secret verifies a correctly-signed payload', () => {
  withEnv({ NODE_ENV: 'production', INSURANCE_WEBHOOK_SECRET: 'real-prod-secret' }, () => {
    const ts = String(Date.now());
    const sig = sign('insurance_sandbox', '{"x":2}', ts);
    assert.ok(sig);
    assert.equal(verifyWebhook('insurance_sandbox', '{"x":2}', sig, ts).valid, true);
  });
});
