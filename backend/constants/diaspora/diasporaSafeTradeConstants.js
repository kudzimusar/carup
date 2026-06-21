/**
 * Phase 9 — SafeTrade feature flags + money constants (env-driven, fail-closed).
 *
 * Mirrors diasporaBillingConstants.js / diasporaDriveConstants.js: small pure helpers, no side
 * effects at import time, production never auto-selects an unsafe (real-money) path. This module is
 * the SafeTrade equivalent of assertBillingProductionSafety() and is deliberately separate from
 * diasporaBillingConstants.js (track-owned, not edited here).
 *
 * Two INDEPENDENT flags (directive N7):
 *  - DIASPORA_SAFETRADE_ENABLED — master feature/route/service gate. Default OFF: when off, all
 *    SafeTrade routes/services are inert and isSafeTradeEnabled() === false.
 *  - DIASPORA_SAFETRADE_LIVE_PAYMENT — whether a real (money-moving) escrow provider may be selected.
 *    Default OFF and FAIL-CLOSED: the sandbox provider is always used until an approved live provider
 *    is explicitly wired AND this flag is set. The live path is an external activation step (EB-4);
 *    there is no real network/provider here.
 */

// Providers recognised by the SafeTrade escrow abstraction. SANDBOX/FAKE are always safe (no real
// money). Real providers are added only at EB-4 external activation; the approved list is empty so
// isSafeTradeLivePaymentEnabled() can be true yet still fail closed at selection time.
export const SAFETRADE_PAYMENT_PROVIDERS = Object.freeze({
  SANDBOX: 'sandbox',
  FAKE: 'fake',
});

// Providers approved for LIVE escrow money movement. Empty until a real provider is implemented and
// legally approved (EB-4). Keeping this empty is the application-layer twin of the DB CHECK that
// forces diaspora_safetrade_transactions.live_payment = false.
export const SAFETRADE_APPROVED_LIVE_PROVIDERS = Object.freeze([]);

// Canonical policy version recorded on transactions/evaluations (kept in sync with the migration).
export const SAFETRADE_POLICY_VERSION = 'safetrade-policy-v1';

// Throw key used by the money-edge live gate (mirrors the RPC's
// DIASPORA_SAFETRADE/EXTERNAL_ACTIVATION_REQUIRED defense-in-depth).
export const SAFETRADE_EXTERNAL_ACTIVATION_ERROR = 'EXTERNAL_ACTIVATION_REQUIRED';

// Milestone types accepted by the record-milestone RPC / service (mirror the DB CHECK).
export const SAFETRADE_MILESTONE_TYPES = Object.freeze({
  DEPOSIT: 'DEPOSIT',
  PROGRESS: 'PROGRESS',
  SHIPMENT: 'SHIPMENT',
  CUSTOMS_DUTY: 'CUSTOMS_DUTY',
  DELIVERY: 'DELIVERY',
  RELEASE: 'RELEASE',
  INSURANCE: 'INSURANCE',
  FEE: 'FEE',
  REFUND: 'REFUND',
});

// Milestone due/release triggers (mirror the DB CHECK).
export const SAFETRADE_DUE_TRIGGERS = Object.freeze([
  'MANUAL',
  'ON_INITIATION',
  'ON_SHIPMENT_BOOKED',
  'ON_LOADED',
  'ON_ARRIVAL',
  'ON_CUSTOMS_CLEARED',
  'ON_DELIVERY_CONFIRMED',
]);

export const SAFETRADE_RELEASE_TRIGGERS = Object.freeze([
  'REVIEWER_APPROVAL',
  'ON_DELIVERY_CONFIRMED_REVIEWED',
  'ON_DOCUMENTS_VERIFIED_REVIEWED',
  'MANUAL_REVIEWER',
]);

// Tolerance for total reconciliation at numeric(_,2) storage scale (half the smallest unit).
export const SAFETRADE_RECONCILIATION_TOLERANCE = 0.005;

export function isProduction() {
  return process.env.NODE_ENV === 'production';
}

/** Master gate. Default OFF — when false, all SafeTrade routes/services are inert. */
export function isSafeTradeEnabled() {
  return String(process.env.DIASPORA_SAFETRADE_ENABLED || '').toLowerCase() === 'true';
}

/** Whether live (real-money) escrow is requested. Selection still requires an approved provider. */
export function isSafeTradeLivePaymentEnabled() {
  return String(process.env.DIASPORA_SAFETRADE_LIVE_PAYMENT || '').toLowerCase() === 'true';
}

/** The configured live escrow provider key (only consulted when live payment is enabled). */
export function configuredSafeTradeProvider() {
  return String(process.env.DIASPORA_SAFETRADE_PROVIDER || '').toLowerCase() || null;
}

/**
 * Fail closed: refuse to run live escrow unless an approved provider is configured. Throwing here
 * (rather than silently downgrading) makes a misconfiguration loud in any environment and guarantees
 * production never moves real money / releases real escrow through an unapproved/unimplemented path.
 * The RPC enforces the same invariant inside the transaction (defense-in-depth).
 */
export function assertSafeTradeProductionSafety() {
  if (!isSafeTradeLivePaymentEnabled()) return; // sandbox path is always safe
  const provider = configuredSafeTradeProvider();
  if (!provider || !SAFETRADE_APPROVED_LIVE_PROVIDERS.includes(provider)) {
    throw new Error(
      `DIASPORA_SAFETRADE_LIVE_PAYMENT is enabled but no approved live escrow provider is configured `
      + `(DIASPORA_SAFETRADE_PROVIDER). Live escrow requires external activation; refusing to proceed `
      + `(${SAFETRADE_EXTERNAL_ACTIVATION_ERROR}).`,
    );
  }
}

/** Sandbox is selected unless live payment is enabled AND an approved provider is configured. */
export function shouldUseSandboxEscrow() {
  if (!isSafeTradeLivePaymentEnabled()) return true;
  const provider = configuredSafeTradeProvider();
  return !provider || !SAFETRADE_APPROVED_LIVE_PROVIDERS.includes(provider);
}

/**
 * Resolve the escrow provider key the abstraction must use. Always returns a sandbox/fake provider
 * until EB-4 activation; never returns a non-approved live provider (it throws first).
 */
export function resolveSafeTradeProvider() {
  assertSafeTradeProductionSafety();
  if (shouldUseSandboxEscrow()) return SAFETRADE_PAYMENT_PROVIDERS.SANDBOX;
  return configuredSafeTradeProvider();
}
