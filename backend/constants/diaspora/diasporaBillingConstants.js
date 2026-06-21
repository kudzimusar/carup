/**
 * Phase 8 — Billing/subscription feature flags (env-driven, fail-closed in production).
 *
 * Two independent flags:
 *  - DIASPORA_SUBSCRIPTION_ENFORCEMENT — whether entitlement denials actually block protected
 *    operations. Enforcement on real routes/features is M2 work; the foundation defaults to OFF so
 *    existing flows are never broken by this PR.
 *  - DIASPORA_BILLING_LIVE — whether a real (money-moving) billing provider may be selected. Defaults
 *    to OFF; the sandbox provider is always used until an approved live provider is explicitly wired
 *    and this flag is set. Live billing is an external activation step (no real network here).
 *
 * Mirrors the style of diasporaDriveConstants.js: small pure helpers, no side effects at import time,
 * production never auto-selects an unsafe path.
 */

// Providers recognised by the billing abstraction. SANDBOX/MANUAL are always safe; STRIPE is the
// first real provider slot but is not implemented (external activation pending).
export const BILLING_PROVIDERS = Object.freeze({
  SANDBOX: 'sandbox',
  MANUAL: 'manual',
  STRIPE: 'stripe',
});

// Providers approved for LIVE money movement. Empty until a real provider is implemented and approved,
// so isBillingLiveEnabled() can be true yet still fail closed at selection time.
export const APPROVED_LIVE_PROVIDERS = Object.freeze([]);

export function isProduction() {
  return process.env.NODE_ENV === 'production';
}

/** Whether entitlement denials block protected operations. Default OFF (M1 foundation, no enforcement). */
export function isSubscriptionEnforcementEnabled() {
  return String(process.env.DIASPORA_SUBSCRIPTION_ENFORCEMENT || '').toLowerCase() === 'true';
}

/** Whether live (money-moving) billing is requested. Selection still requires an approved provider. */
export function isBillingLiveEnabled() {
  return String(process.env.DIASPORA_BILLING_LIVE || '').toLowerCase() === 'true';
}

/** The configured live provider key (only consulted when live billing is enabled). */
export function configuredBillingProvider() {
  return String(process.env.DIASPORA_BILLING_PROVIDER || '').toLowerCase() || null;
}

/**
 * Fail closed: refuse to run live billing unless an approved provider is configured. Throwing here
 * (rather than silently downgrading) makes a misconfiguration loud in any environment, and guarantees
 * production never moves money through an unapproved/unimplemented path.
 */
export function assertBillingProductionSafety() {
  if (!isBillingLiveEnabled()) return; // sandbox path is always safe
  const provider = configuredBillingProvider();
  if (!provider || !APPROVED_LIVE_PROVIDERS.includes(provider)) {
    throw new Error(
      'DIASPORA_BILLING_LIVE is enabled but no approved live billing provider is configured '
      + '(DIASPORA_BILLING_PROVIDER). Live billing requires external activation; refusing to proceed.',
    );
  }
}

/** Sandbox is selected unless live billing is enabled AND an approved provider is configured. */
export function shouldUseSandboxBilling() {
  if (!isBillingLiveEnabled()) return true;
  const provider = configuredBillingProvider();
  return !provider || !APPROVED_LIVE_PROVIDERS.includes(provider);
}

/** Secret used to verify provider webhook signatures. Fail closed in production. */
export function billingWebhookSecret() {
  const secret = process.env.DIASPORA_BILLING_WEBHOOK_SECRET;
  if (secret) return secret;
  if (isProduction()) {
    throw new Error('DIASPORA_BILLING_WEBHOOK_SECRET is required in production');
  }
  return 'diaspora-billing-dev-webhook-secret';
}
