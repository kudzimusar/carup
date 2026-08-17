import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROVIDER_FREE_TIER_DAILY_CEILING,
  QUOTA_DECISION,
  QUOTA_STATE,
  evaluateQuotaState,
  evaluateSendAllowance,
  resolveQuotaThresholds,
} from '../config/emailProviderQuota.js';

/**
 * Proves the governing free-tier invariant from the Email 1.0 directive §0A.4:
 * no provider may silently move CarUp from free usage into paid usage.
 */

test('defaults sit below the documented free-tier ceilings so CarUp reacts before the provider does', () => {
  for (const provider of ['resend', 'brevo']) {
    const t = resolveQuotaThresholds(provider, {});
    assert.ok(t.soft < t.critical, `${provider}: soft must be below critical`);
    assert.ok(t.critical < t.ceiling, `${provider}: critical must be below the provider ceiling`);
    assert.equal(t.ceiling, PROVIDER_FREE_TIER_DAILY_CEILING[provider]);
  }
});

test('thresholds are configurable per provider, not hardcoded', () => {
  const t = resolveQuotaThresholds('resend', {
    RESEND_DAILY_SOFT_LIMIT: '10',
    RESEND_DAILY_CRITICAL_LIMIT: '20',
  });
  assert.equal(t.soft, 10);
  assert.equal(t.critical, 20);

  const b = resolveQuotaThresholds('brevo', {
    BREVO_DAILY_SOFT_LIMIT: '5',
    BREVO_DAILY_CRITICAL_LIMIT: '9',
  });
  assert.equal(b.soft, 5);
  assert.equal(b.critical, 9);
});

test('a misconfigured threshold falls back to safe defaults instead of disabling protection', () => {
  for (const bad of [{ RESEND_DAILY_SOFT_LIMIT: 'abc' }, { RESEND_DAILY_SOFT_LIMIT: '-5' }, { RESEND_DAILY_SOFT_LIMIT: '1.5' }]) {
    const t = resolveQuotaThresholds('resend', bad);
    assert.equal(t.soft, 70, 'invalid soft limit must fall back to the default');
  }
  // Inverted config would make critical unreachable — must not silently weaken protection.
  const inverted = resolveQuotaThresholds('resend', {
    RESEND_DAILY_SOFT_LIMIT: '95',
    RESEND_DAILY_CRITICAL_LIMIT: '10',
  });
  assert.equal(inverted.misconfigured, true);
  assert.ok(inverted.soft < inverted.critical);
});

test('quota state escalates OK -> soft -> critical', () => {
  const env = { RESEND_DAILY_SOFT_LIMIT: '70', RESEND_DAILY_CRITICAL_LIMIT: '90' };
  assert.equal(evaluateQuotaState('resend', 0, env).state, QUOTA_STATE.OK);
  assert.equal(evaluateQuotaState('resend', 69, env).state, QUOTA_STATE.OK);
  assert.equal(evaluateQuotaState('resend', 70, env).state, QUOTA_STATE.SOFT);
  assert.equal(evaluateQuotaState('resend', 89, env).state, QUOTA_STATE.SOFT);
  assert.equal(evaluateQuotaState('resend', 90, env).state, QUOTA_STATE.CRITICAL);
  assert.equal(evaluateQuotaState('resend', 500, env).state, QUOTA_STATE.CRITICAL);
});

test('soft threshold warns but never blocks a send', () => {
  const r = evaluateSendAllowance({ provider: 'resend', classification: 'marketing', sentToday: 75 }, {});
  assert.equal(r.decision, QUOTA_DECISION.ALLOW);
  assert.equal(r.warn, true);
  assert.equal(r.state, QUOTA_STATE.SOFT);
});

test('critical threshold preserves security/transactional/conversational capacity', () => {
  for (const classification of ['security', 'transactional', 'conversational']) {
    const r = evaluateSendAllowance({ provider: 'resend', classification, sentToday: 95 }, {});
    assert.equal(r.decision, QUOTA_DECISION.ALLOW, `${classification} must keep sending at critical`);
    assert.equal(r.warn, true);
  }
});

test('critical threshold suppresses marketing first and defers lower-priority Email', () => {
  const marketing = evaluateSendAllowance({ provider: 'brevo', classification: 'marketing', sentToday: 280 }, {});
  assert.equal(marketing.decision, QUOTA_DECISION.SUPPRESS);

  const service = evaluateSendAllowance({ provider: 'resend', classification: 'service', sentToday: 95 }, {});
  assert.equal(service.decision, QUOTA_DECISION.DEFER);

  // An unrecognised class must not be treated as critical-priority by default.
  const unknown = evaluateSendAllowance({ provider: 'resend', classification: 'something_new', sentToday: 95 }, {});
  assert.equal(unknown.decision, QUOTA_DECISION.DEFER);
});

test('no decision path ever authorises purchasing capacity', () => {
  const cases = [0, 70, 90, 999].flatMap((sentToday) =>
    ['security', 'transactional', 'conversational', 'service', 'marketing', 'unknown'].map((classification) =>
      evaluateSendAllowance({ provider: 'resend', classification, sentToday }, {})),
  );
  for (const c of cases) {
    assert.equal(c.autoPurchase, false);
  }
});

test('marketing pauses before transactional when Brevo free quota is constrained', () => {
  const sentToday = 275; // above Brevo critical (270), below the 300 ceiling
  assert.equal(
    evaluateSendAllowance({ provider: 'brevo', classification: 'marketing', sentToday }, {}).decision,
    QUOTA_DECISION.SUPPRESS,
  );
  assert.equal(
    evaluateSendAllowance({ provider: 'brevo', classification: 'transactional', sentToday }, {}).decision,
    QUOTA_DECISION.ALLOW,
  );
});

test('an unknown provider is not quota-governed and is never silently blocked', () => {
  const r = evaluateSendAllowance({ provider: 'sendgrid', classification: 'transactional', sentToday: 10_000 }, {});
  assert.equal(r.decision, QUOTA_DECISION.ALLOW);
  assert.equal(r.autoPurchase, false);
});
