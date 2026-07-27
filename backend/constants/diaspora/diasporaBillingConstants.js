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
  // Zimbabwe local collection rail (ADR-001 §4). Present so the provider-neutral adapter can be
  // exercised against a second, deliberately dissimilar wire contract; NOT approved for live.
  PAYNOW: 'paynow',
});

/**
 * Provider TEST-MODE profiles (ADR-001 §6). A profile is the wire contract only: URLs, encodings,
 * signature scheme and event vocabulary. Test mode makes REAL provider-shaped calls through an
 * injected transport; it never moves money and is refused in production.
 */
export const BILLING_TEST_PROFILES = Object.freeze({
  STRIPE: 'stripe',
  PAYNOW: 'paynow',
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

/**
 * Secret used to verify provider webhook signatures. Fail closed everywhere a real request can
 * reach the route.
 *
 * This previously fell back to a hard-coded literal whenever NODE_ENV !== 'production'. That literal
 * is committed to this repository, and the webhook it protects is the only endpoint in the billing
 * surface that writes authoritative subscription state: it has no auth middleware, is deliberately
 * CSRF-exempt, and writes through the RLS-bypassing service-role client. Worse, because
 * APPROVED_LIVE_PROVIDERS is empty the SANDBOX provider is selected in EVERY environment, so its
 * HMAC check — keyed on this secret — is the real authentication for that route.
 *
 * Net effect: any deployment whose NODE_ENV was 'staging', 'preview', 'development' or unset would
 * accept a forged webhook from anyone who had read this file, moving an arbitrary tenant onto any
 * plan. The signature verified correctly because the attacker held the same key we did.
 *
 * NODE_ENV==='test' keeps a fixed key so the suite stays hermetic — the only context with no real
 * tenant data and no externally reachable route.
 */
export function billingWebhookSecret() {
  const secret = process.env.DIASPORA_BILLING_WEBHOOK_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'test') return 'diaspora-billing-test-webhook-secret';
  throw new Error(
    'DIASPORA_BILLING_WEBHOOK_SECRET is required to verify billing webhooks. Refusing to fall back '
    + 'to a shared default: this secret is the only credential protecting an unauthenticated, '
    + 'CSRF-exempt route that writes subscription state.',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider TEST MODE (ADR-001 §6).
//
// Test mode sits BETWEEN sandbox and live: the adapter builds and sends real provider-shaped requests
// (correct path, headers, encoding, signature) through an injected HTTP transport, so the wire contract
// is genuinely exercised — but no money moves and, in tests, no socket is opened. It is a distinct axis
// from DIASPORA_BILLING_LIVE and can never imply it.
// ─────────────────────────────────────────────────────────────────────────────

/** Whether the provider-shaped TEST-MODE adapter is selected instead of the in-memory sandbox. */
export function isBillingTestModeEnabled() {
  return String(process.env.DIASPORA_BILLING_TEST_MODE || '').toLowerCase() === 'true';
}

/** Which wire profile test mode speaks. Defaults to the ADR-001 recommended primary provider. */
export function configuredBillingTestProfile() {
  const raw = String(process.env.DIASPORA_BILLING_TEST_PROFILE || '').toLowerCase();
  const known = Object.values(BILLING_TEST_PROFILES);
  return known.includes(raw) ? raw : BILLING_TEST_PROFILES.STRIPE;
}

/**
 * API base for test mode. Never a live host: the value must be an explicit sandbox/test base URL, and
 * the default is a non-routable placeholder so a misconfiguration cannot silently reach a real API.
 */
export function billingTestApiBase() {
  return process.env.DIASPORA_BILLING_TEST_API_BASE || 'https://provider-test.invalid';
}

// A test-mode credential must be *recognisably* a test credential. A live key accidentally pasted into
// the test-mode variable would otherwise let a "test" run authenticate against a production merchant.
const TEST_KEY_MARKERS = Object.freeze(['test', 'sandbox', 'sbx', 'dev']);

/** True when a credential carries a recognised non-production marker. */
export function looksLikeTestCredential(value) {
  const v = String(value || '').toLowerCase();
  if (!v) return false;
  return TEST_KEY_MARKERS.some((marker) => v.includes(marker));
}

/**
 * The test-mode API credential. Fails closed rather than defaulting to something that might be live:
 * an unset value yields a deterministic local placeholder, and a value that does not look like a test
 * credential is REFUSED (it is far more likely to be a live key in the wrong variable than a test key
 * with an unusual format).
 */
export function billingTestApiKey() {
  const key = process.env.DIASPORA_BILLING_TEST_API_KEY;
  if (!key) return 'billing-test-mode-placeholder-key';
  if (!looksLikeTestCredential(key)) {
    throw new Error(
      'DIASPORA_BILLING_TEST_API_KEY does not look like a test credential. Refusing to run test mode '
      + 'with a possibly-live key.',
    );
  }
  return key;
}

/**
 * Fail closed on the test-mode axis:
 *  - production must never speak to a provider sandbox (wrong data, wrong merchant, misleading state);
 *  - test mode and live mode are mutually exclusive — an operator who set both has a broken intent and
 *    must be told, not silently given one of them.
 */
export function assertBillingTestModeSafety() {
  if (!isBillingTestModeEnabled()) return;
  if (isProduction()) {
    throw new Error('DIASPORA_BILLING_TEST_MODE must not be enabled in production');
  }
  if (isBillingLiveEnabled()) {
    throw new Error('DIASPORA_BILLING_TEST_MODE and DIASPORA_BILLING_LIVE are mutually exclusive');
  }
  billingTestApiKey(); // throws on a credential that does not look like a test credential
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation (ADR-001 §7 — mandatory, not optional, on any rail whose callback is unreliable).
// ─────────────────────────────────────────────────────────────────────────────

export const BILLING_RECONCILIATION_TRIGGERS = Object.freeze({
  SCHEDULED: 'scheduled',
  OPERATOR: 'operator',
  STARTUP: 'startup',
  WEBHOOK_GAP: 'webhook_gap',
});

export const BILLING_RECONCILIATION_STATES = Object.freeze({
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
});

/** Whether the scheduled reconciliation loop may run. Default OFF (explicit activation, like every
 *  other scheduler in this codebase). Operator-triggered runs are always available. */
export function isBillingReconciliationSchedulerEnabled() {
  return String(process.env.DIASPORA_BILLING_RECONCILIATION_SCHEDULER || '').toLowerCase() === 'true';
}

/** Bounded batch size for one reconciliation run (never unbounded — a run must terminate). */
export function billingReconciliationBatchSize() {
  const n = Number(process.env.DIASPORA_BILLING_RECONCILIATION_BATCH || 100);
  if (!Number.isFinite(n) || n <= 0) return 100;
  return Math.min(Math.trunc(n), 500);
}

/**
 * How long a checkout session may stay open before it is considered abandoned. Deliberately generous:
 * a diaspora customer completing a mobile-money payment can legitimately take many minutes.
 */
export function billingCheckoutAbandonmentMinutes() {
  const n = Number(process.env.DIASPORA_BILLING_CHECKOUT_ABANDON_MINUTES || 60);
  if (!Number.isFinite(n) || n <= 0) return 60;
  return Math.min(Math.trunc(n), 1440);
}
