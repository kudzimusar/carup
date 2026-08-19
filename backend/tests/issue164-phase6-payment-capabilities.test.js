import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const caps = await import('../services/diaspora/safetrade/safeTradePaymentCapabilities.js');
const constants = await import('../constants/diaspora/diasporaSafeTradeConstants.js');

const EXPECTED_CAPABILITIES = [
  'collect_payment',
  'authorize_hold',
  'capture',
  'refund',
  'partial_refund',
  'cancel',
  'retrieve_status',
  'payout_to_seller',
  'split_payment',
  'regulated_escrow',
  'delayed_release',
  'webhook_verify',
  'webhook_replay_resistant',
  'polling_fallback',
];

test('Phase 6C: canonical payment capability vocabulary is complete and stable', () => {
  assert.deepEqual([...caps.PAYMENT_CAPABILITIES], EXPECTED_CAPABILITIES);
});

test('Phase 6C: SafeTrade sandbox exposes only test-proven capabilities and never claims regulated escrow', () => {
  const sandbox = caps.getPaymentProviderCapabilities('sandbox');
  assert.equal(sandbox.evidence_state, 'sandbox_proven');
  assert.equal(sandbox.test_only, true);
  assert.equal(sandbox.merchant_legal_eligibility, 'test_only');
  assert.equal(sandbox.capabilities.collect_payment, true);
  assert.equal(sandbox.capabilities.authorize_hold, true);
  assert.equal(sandbox.capabilities.capture, true);
  assert.equal(sandbox.capabilities.cancel, true);
  assert.equal(sandbox.capabilities.retrieve_status, true);
  assert.equal(sandbox.capabilities.delayed_release, true);
  assert.equal(sandbox.capabilities.regulated_escrow, false);
  assert.equal(sandbox.capabilities.split_payment, false);

  assert.deepEqual(
    caps.evaluatePaymentProviderCapability('sandbox', 'capture', {
      testMode: true,
      currency: 'USD',
      method: 'sandbox',
    }),
    {
      allowed: true,
      state: 'sandbox_proven',
      reason: null,
      provider_key: 'sandbox',
      test_only: true,
    },
  );
  assert.equal(
    caps.evaluatePaymentProviderCapability('sandbox', 'regulated_escrow', {
      testMode: true, currency: 'USD', method: 'sandbox',
    }).allowed,
    false,
  );
  assert.equal(
    caps.evaluatePaymentProviderCapability('sandbox', 'capture', {
      testMode: false, currency: 'USD', method: 'sandbox',
    }).reason,
    'provider_test_only',
  );
});

test('Phase 6C: every external candidate remains unverified and non-callable', () => {
  for (const providerKey of ['contipay', 'paynow', 'paypal', 'stripe', 'pesapal', 'peach_payments', 'stitch', 'selcom', 'paychangu']) {
    const provider = caps.getPaymentProviderCapabilities(providerKey);
    assert.ok(provider, `missing provider candidate ${providerKey}`);
    assert.equal(provider.evidence_state, 'candidate_unverified');
    assert.equal(provider.supported_countries, null);
    assert.equal(provider.supported_currencies, null);
    assert.equal(provider.supported_methods, null);
    assert.equal(provider.merchant_legal_eligibility, 'unknown');
    for (const capability of EXPECTED_CAPABILITIES) {
      assert.equal(provider.capabilities[capability], null, `${providerKey}.${capability} must stay unknown`);
      const decision = caps.evaluatePaymentProviderCapability(providerKey, capability, {
        country: 'ZW', currency: 'USD', method: 'card', testMode: true,
      });
      assert.equal(decision.allowed, false);
      assert.equal(decision.state, 'unknown');
    }
  }
});

test('Phase 6C: candidate jurisdiction discovery never upgrades candidate to support', () => {
  const zw = caps.paymentProviderCandidatesForCountry('ZW');
  const keys = zw.map((entry) => entry.provider_key);
  assert.ok(keys.includes('contipay'));
  assert.ok(keys.includes('paynow'));
  assert.ok(keys.includes('paypal'));
  for (const entry of zw.filter((candidate) => candidate.provider_key !== 'sandbox')) {
    assert.equal(entry.candidate_only, true);
  }
  const paynow = caps.evaluatePaymentProviderCapability('paynow', 'collect_payment', {
    country: 'ZW', currency: 'USD', method: 'mobile_money',
  });
  assert.equal(paynow.allowed, false);
  assert.equal(paynow.reason, 'capability_unknown');
});

test('Phase 6C: missing provider/dimensions fail closed rather than defaulting', () => {
  assert.equal(
    caps.evaluatePaymentProviderCapability('does-not-exist', 'collect_payment', {}).reason,
    'provider_not_registered',
  );
  assert.equal(
    caps.evaluatePaymentProviderCapability('sandbox', 'does-not-exist', {}).reason,
    'capability_not_registered',
  );
  assert.throws(
    () => caps.assertPaymentProviderCapability('sandbox', 'capture', {
      testMode: true, currency: 'EUR', method: 'sandbox',
    }),
    /currency_unsupported/,
  );
});

test('Phase 6C: no live SafeTrade provider is approved by source', () => {
  assert.deepEqual([...constants.SAFETRADE_APPROVED_LIVE_PROVIDERS], []);
});
