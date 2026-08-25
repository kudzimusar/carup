import test from 'node:test';
import assert from 'node:assert/strict';
import { isMarketplaceSandboxRuntimeAllowed } from '../services/transaction/marketplacePaymentProviderSelector.js';

test('Phase 6 sandbox provider is allowed only by the authoritative non-production environment signal', () => {
  assert.equal(isMarketplaceSandboxRuntimeAllowed({ VERCEL_ENV: 'preview', NODE_ENV: 'production' }), true);
  assert.equal(isMarketplaceSandboxRuntimeAllowed({ VERCEL_ENV: 'development', NODE_ENV: 'production' }), true);
  assert.equal(isMarketplaceSandboxRuntimeAllowed({ CARUP_ENV: 'staging', NODE_ENV: 'production' }), true);
  assert.equal(isMarketplaceSandboxRuntimeAllowed({ NODE_ENV: 'test' }), true);
  assert.equal(isMarketplaceSandboxRuntimeAllowed({ NODE_ENV: 'development' }), true);

  assert.equal(isMarketplaceSandboxRuntimeAllowed({ VERCEL_ENV: 'production' }), false);
  assert.equal(isMarketplaceSandboxRuntimeAllowed({ CARUP_ENV: 'production' }), false);
  assert.equal(isMarketplaceSandboxRuntimeAllowed({ NODE_ENV: 'production' }), false);
  assert.equal(isMarketplaceSandboxRuntimeAllowed({}), false);
});

test('Phase 6 mutation M20 — a stale staging/development flag cannot reopen sandbox payments in Vercel production', () => {
  const contradictory = {
    VERCEL_ENV: 'production',
    CARUP_ENV: 'staging',
    NODE_ENV: 'development',
  };
  assert.equal(
    isMarketplaceSandboxRuntimeAllowed(contradictory),
    false,
    'explicit production deployment must dominate all weaker non-production flags',
  );
});
