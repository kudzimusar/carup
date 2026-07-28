/**
 * Diaspora billing — security and lifecycle CONTRACT tests (Deliverable D, Issue #127).
 *
 * Phase 1 adversarial discovery of the subscription surface found three defects that every existing
 * billing test passed. Each is the same shape this branch has now hit four times: two sides of a
 * contract, each defensible alone, with nothing asserting the join.
 *
 *   P0-1  The webhook's only credential fell back to a literal committed to this repository whenever
 *         NODE_ENV was not exactly 'production'. That route has no auth middleware, is deliberately
 *         CSRF-exempt, and writes authoritative subscription state through the RLS-bypassing
 *         service-role client — and because APPROVED_LIVE_PROVIDERS is empty, the sandbox provider's
 *         HMAC check (keyed on that secret) is the real authentication in EVERY environment. Any
 *         staging/preview/dev deployment therefore accepted a forged webhook from anyone who had read
 *         the file, moving an arbitrary tenant onto any plan. The suite could not catch it because it
 *         hard-codes the same constant as the expected secret.
 *
 *   P0-2  Webhook idempotency keyed on ROW EXISTENCE rather than on completed work. The row is
 *         written before the state is applied and processed_at stamped after, so any failure between
 *         them permanently blackholed the event: the provider retried, every retry was answered
 *         200 "already processed", and processed_at stayed NULL with nothing scanning for it.
 *
 *   P1-1  Cancellation and expiry did nothing. resolveSubscription decided access from `status`
 *         alone; nothing ever transitions a row out of 'active' (there is no scheduler, and an
 *         at-period-end cancellation intentionally KEEPS status 'active'). A cancelled tenant kept
 *         paid entitlements forever.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const billingConstants = await import('../constants/diaspora/diasporaBillingConstants.js');
const entitlements = await import('../services/diaspora/diasporaEntitlementService.js');

// ─────────────────────────────────────────────────────────────────────────────
// P0-1 — the webhook secret must never fall back to a shared literal
// ─────────────────────────────────────────────────────────────────────────────

function withEnv(overrides, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(overrides)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const LEAKED_DEFAULT = 'diaspora-billing-dev-webhook-secret';

test('the webhook secret is never the literal that used to be committed here', () => {
  // Whatever the resolution rules become, this exact string must never again be a valid key: it is
  // public, and it authenticates an unauthenticated route that writes billing state.
  for (const env of ['test', 'development', 'staging', 'preview', 'production', undefined]) {
    const resolved = withEnv({ NODE_ENV: env, DIASPORA_BILLING_WEBHOOK_SECRET: undefined }, () => {
      try { return billingConstants.billingWebhookSecret(); } catch { return null; }
    });
    assert.notEqual(resolved, LEAKED_DEFAULT, `NODE_ENV=${env} must not resolve the leaked default`);
  }
});

test('a deployment with no configured secret fails closed instead of guessing', () => {
  // 'staging' and 'preview' are the environments that actually shipped with the fallback, and they
  // hold real tenant rows. Refusing to start verification is the only safe answer.
  for (const env of ['development', 'staging', 'preview', 'production', undefined]) {
    assert.throws(
      () => withEnv({ NODE_ENV: env, DIASPORA_BILLING_WEBHOOK_SECRET: undefined },
        () => billingConstants.billingWebhookSecret()),
      /DIASPORA_BILLING_WEBHOOK_SECRET is required/,
      `NODE_ENV=${env} must refuse to verify without a configured secret`,
    );
  }
});

test('a configured secret is used verbatim in every environment', () => {
  for (const env of ['test', 'development', 'staging', 'production']) {
    const resolved = withEnv({ NODE_ENV: env, DIASPORA_BILLING_WEBHOOK_SECRET: 'operator-supplied' },
      () => billingConstants.billingWebhookSecret());
    assert.equal(resolved, 'operator-supplied');
  }
});

test('the test environment keeps a hermetic key so the suite needs no real secret', () => {
  const resolved = withEnv({ NODE_ENV: 'test', DIASPORA_BILLING_WEBHOOK_SECRET: undefined },
    () => billingConstants.billingWebhookSecret());
  assert.equal(typeof resolved, 'string');
  assert.ok(resolved.length > 0);
  assert.notEqual(resolved, LEAKED_DEFAULT);
});

// ─────────────────────────────────────────────────────────────────────────────
// P1-1 — cancellation and expiry must actually end access
// ─────────────────────────────────────────────────────────────────────────────

const NOW = new Date('2026-07-27T00:00:00.000Z');
const PAST = '2026-07-01T00:00:00.000Z';
const FUTURE = '2026-08-31T00:00:00.000Z';

test('an active subscription inside its billing period grants access', () => {
  assert.equal(entitlements.grantsAccessNow(
    { status: 'active', current_period_end: FUTURE }, NOW), true);
});

test('an at-period-end cancellation still grants access BEFORE the period ends', () => {
  // This is the promise the UI makes: "access continues until the period ends".
  assert.equal(entitlements.grantsAccessNow(
    { status: 'active', cancel_at_period_end: true, current_period_end: FUTURE }, NOW), true);
});

test('an at-period-end cancellation stops granting access AFTER the period ends', () => {
  // The defect: the provider deliberately keeps status 'active' for this case and nothing ever
  // transitions the row, so status-only evaluation granted paid entitlements forever.
  assert.equal(entitlements.grantsAccessNow(
    { status: 'active', cancel_at_period_end: true, current_period_end: PAST }, NOW), false);
});

test('a lapsed billing period stops granting access even without a cancellation', () => {
  assert.equal(entitlements.grantsAccessNow(
    { status: 'active', current_period_end: PAST }, NOW), false);
});

test('a non-granting status never grants access regardless of period', () => {
  for (const status of ['cancelled', 'expired', 'past_due', 'suspended', 'incomplete', 'paused']) {
    assert.equal(entitlements.grantsAccessNow({ status, current_period_end: FUTURE }, NOW), false,
      `${status} must not grant access`);
  }
});

test('trialing and grace_period still grant access inside their period', () => {
  for (const status of ['trialing', 'grace_period']) {
    assert.equal(entitlements.grantsAccessNow({ status, current_period_end: FUTURE }, NOW), true);
  }
});

test('a row with no period end keeps the previous status-only behaviour', () => {
  // The synthetic Free subscription and any open-ended row depend on this.
  assert.equal(entitlements.grantsAccessNow({ status: 'active', current_period_end: null }, NOW), true);
  assert.equal(entitlements.grantsAccessNow({ status: 'active' }, NOW), true);
});

test('an unparseable period end does not silently revoke access', () => {
  // Failing closed on corrupt data would take paying tenants offline; this is the one case where
  // falling back to status is the safer error.
  assert.equal(entitlements.grantsAccessNow(
    { status: 'active', current_period_end: 'not-a-date' }, NOW), true);
});

test('resolveSubscription is the caller that must apply this rule', async () => {
  // Guards the wiring, not just the predicate: a subscription whose period lapsed must resolve to
  // the synthetic Free plan rather than the stored paid row.
  const { createMockSupabase } = await import('./helpers/mockSupabase.js');
  const client = createMockSupabase({
    diaspora_subscriptions: [{
      id: 'sub-1', tenant_id: 'tenant-A', plan_key: 'enterprise', status: 'active',
      cancel_at_period_end: true, current_period_end: PAST, deleted_at: null,
      created_at: '2026-06-01T00:00:00.000Z',
    }],
  });
  const resolved = await entitlements.resolveSubscription(client, 'tenant-A');
  assert.notEqual(resolved.plan_key, 'enterprise', 'a lapsed cancellation must not keep the paid plan');
  assert.equal(resolved.plan_key, 'free');
});
