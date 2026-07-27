/**
 * Phase 8 — Billing provider abstraction.
 *
 * `BillingProvider` is the interface every provider implements. `SandboxBillingProvider` is a
 * deterministic, fully in-memory implementation (NO network) used by tests and as the default until a
 * real provider is wired and approved. Real (money-moving) providers are an explicit external
 * activation step: their methods throw EXTERNAL_ACTIVATION_REQUIRED until provisioned — mirroring the
 * Google Drive provider pattern (no fake "production-ready" claims).
 *
 * Subscriptions are TENANT-scoped (product decision PD-1): every operation keys off tenantId.
 */
import crypto from 'crypto';
import {
  isBillingLiveEnabled,
  configuredBillingProvider,
  shouldUseSandboxBilling,
  assertBillingProductionSafety,
  assertBillingTestModeSafety,
  isBillingTestModeEnabled,
  billingWebhookSecret,
  BILLING_PROVIDERS,
} from '../../../constants/diaspora/diasporaBillingConstants.js';
import { SUBSCRIPTION_STATES, DEFAULT_PLAN_KEY } from '../../../constants/diaspora/diasporaEntitlements.js';
import { BillingProvider, BillingProviderError } from './billingProviderBase.js';
import { TestModeBillingProvider } from './testModeBillingProvider.js';

// Re-exported so every existing import path (`from './billingProvider.js'`) is unchanged. The classes
// themselves live in billingProviderBase.js so the factory can import the adapters without a cycle.
export { BillingProvider, BillingProviderError };

/**
 * Deterministic in-memory billing provider. State is keyed by tenantId and lives only in memory; no
 * external calls are ever made. Useful for unit tests and for running the entitlement flow end-to-end
 * before a real provider is activated.
 */
export class SandboxBillingProvider extends BillingProvider {
  constructor() {
    super();
    this._subscriptions = new Map(); // tenantId -> subscription snapshot
    this._invoices = new Map();      // tenantId -> invoice state
    this._seq = 0;
  }

  get name() { return BILLING_PROVIDERS.SANDBOX; }

  _next(prefix) { return `${prefix}_${(this._seq += 1)}`; }

  async createCheckoutSession({ tenantId, planKey, successUrl = null, cancelUrl = null } = {}) {
    if (!tenantId) throw new BillingProviderError('tenantId is required', 'INVALID_INPUT');
    if (!planKey) throw new BillingProviderError('planKey is required', 'INVALID_INPUT');
    const sessionId = this._next('sbx_cs');
    return {
      provider: this.name,
      sessionId,
      // Deterministic local URL so tests can assert without a network. Never a real provider URL.
      url: `https://sandbox-billing.local/checkout/${sessionId}`,
      tenantId,
      planKey,
      successUrl,
      cancelUrl,
      live: false,
    };
  }

  async createPortalSession({ tenantId, returnUrl = null } = {}) {
    if (!tenantId) throw new BillingProviderError('tenantId is required', 'INVALID_INPUT');
    const sessionId = this._next('sbx_ps');
    return {
      provider: this.name,
      sessionId,
      url: `https://sandbox-billing.local/portal/${sessionId}`,
      tenantId,
      returnUrl,
      live: false,
    };
  }

  /**
   * Deterministically materialize/refresh a subscription snapshot for a tenant. In the sandbox this is
   * the source of truth the DB sync layer (M2) would persist.
   */
  async syncSubscription({ tenantId, planKey = DEFAULT_PLAN_KEY, status = SUBSCRIPTION_STATES.ACTIVE } = {}) {
    if (!tenantId) throw new BillingProviderError('tenantId is required', 'INVALID_INPUT');
    const now = new Date('2026-06-21T00:00:00.000Z');
    const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const snapshot = {
      provider: this.name,
      tenantId,
      planKey,
      status,
      providerCustomerRef: `sbx_cus_${tenantId}`,
      providerSubscriptionRef: this._subscriptions.get(tenantId)?.providerSubscriptionRef || this._next('sbx_sub'),
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: periodEnd.toISOString(),
      cancelAtPeriodEnd: false,
      live: false,
    };
    this._subscriptions.set(tenantId, snapshot);
    return { ...snapshot };
  }

  /**
   * Verify a webhook signature. Sandbox uses a deterministic HMAC of the raw body with the configured
   * webhook secret, so tests can construct valid/invalid signatures without a real provider.
   */
  async verifyWebhook({ rawBody, signature } = {}) {
    if (rawBody == null) throw new BillingProviderError('rawBody is required', 'INVALID_INPUT');
    const expected = crypto
      .createHmac('sha256', billingWebhookSecret())
      .update(typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody))
      .digest('hex');
    const provided = String(signature || '');
    // Constant-time compare; mismatched lengths are simply not verified.
    const verified = provided.length === expected.length
      && crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    let payload = null;
    try {
      payload = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
    } catch {
      payload = null;
    }
    return {
      verified,
      eventId: payload?.id || payload?.event_id || null,
      eventType: payload?.type || payload?.event_type || null,
      payload,
    };
  }

  async getInvoiceState({ tenantId } = {}) {
    if (!tenantId) throw new BillingProviderError('tenantId is required', 'INVALID_INPUT');
    return this._invoices.get(tenantId) || { tenantId, status: 'paid', amountDue: 0, provider: this.name, live: false };
  }

  /**
   * Pure read of the sandbox's own state — the reconciliation counterpart of syncSubscription().
   * Returns null when the sandbox has never seen the tenant, which is the honest answer and is what
   * lets reconciliation report MISSING_AT_PROVIDER instead of inventing an "active" snapshot.
   */
  async getSubscription({ tenantId } = {}) {
    if (!tenantId) throw new BillingProviderError('tenantId is required', 'INVALID_INPUT');
    const snapshot = this._subscriptions.get(tenantId);
    return snapshot ? { ...snapshot } : null;
  }

  async cancelSubscription({ tenantId, atPeriodEnd = true } = {}) {
    if (!tenantId) throw new BillingProviderError('tenantId is required', 'INVALID_INPUT');
    const existing = this._subscriptions.get(tenantId);
    const snapshot = {
      ...(existing || (await this.syncSubscription({ tenantId }))),
      status: atPeriodEnd ? SUBSCRIPTION_STATES.ACTIVE : SUBSCRIPTION_STATES.CANCELLED,
      cancelAtPeriodEnd: Boolean(atPeriodEnd),
    };
    this._subscriptions.set(tenantId, snapshot);
    return { ...snapshot };
  }

  async changePlan({ tenantId, planKey } = {}) {
    if (!tenantId) throw new BillingProviderError('tenantId is required', 'INVALID_INPUT');
    if (!planKey) throw new BillingProviderError('planKey is required', 'INVALID_INPUT');
    return this.syncSubscription({ tenantId, planKey, status: SUBSCRIPTION_STATES.ACTIVE });
  }

  async handleTrial({ tenantId, planKey = DEFAULT_PLAN_KEY, trialDays = 14 } = {}) {
    if (!tenantId) throw new BillingProviderError('tenantId is required', 'INVALID_INPUT');
    const now = new Date('2026-06-21T00:00:00.000Z');
    const trialEnd = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);
    const snapshot = {
      ...(await this.syncSubscription({ tenantId, planKey, status: SUBSCRIPTION_STATES.TRIALING })),
      trialEnd: trialEnd.toISOString(),
    };
    this._subscriptions.set(tenantId, snapshot);
    return { ...snapshot };
  }
}

/**
 * Placeholder for the first real provider. Like GoogleDriveProvider, every money-moving method throws
 * EXTERNAL_ACTIVATION_REQUIRED until the provider SDK and approved credentials are provisioned. This
 * keeps "live billing" honest: code-complete pending external activation, never a fake claim.
 */
export class StripeBillingProvider extends BillingProvider {
  get name() { return BILLING_PROVIDERS.STRIPE; }
  async getSubscription() { throw new BillingProviderError('Live Stripe subscription read requires external activation', 'EXTERNAL_ACTIVATION_REQUIRED'); }
  async createCheckoutSession() { throw new BillingProviderError('Live Stripe checkout requires the Stripe SDK and approved credentials (external activation pending)', 'EXTERNAL_ACTIVATION_REQUIRED'); }
  async createPortalSession() { throw new BillingProviderError('Live Stripe billing portal requires external activation', 'EXTERNAL_ACTIVATION_REQUIRED'); }
  async syncSubscription() { throw new BillingProviderError('Live Stripe subscription sync requires external activation', 'EXTERNAL_ACTIVATION_REQUIRED'); }
  async verifyWebhook() { throw new BillingProviderError('Live Stripe webhook verification requires external activation', 'EXTERNAL_ACTIVATION_REQUIRED'); }
  async getInvoiceState() { throw new BillingProviderError('Live Stripe invoice state requires external activation', 'EXTERNAL_ACTIVATION_REQUIRED'); }
  async cancelSubscription() { throw new BillingProviderError('Live Stripe cancellation requires external activation', 'EXTERNAL_ACTIVATION_REQUIRED'); }
  async changePlan() { throw new BillingProviderError('Live Stripe plan change requires external activation', 'EXTERNAL_ACTIVATION_REQUIRED'); }
  async handleTrial() { throw new BillingProviderError('Live Stripe trial handling requires external activation', 'EXTERNAL_ACTIVATION_REQUIRED'); }
}

let sharedSandbox = null;
/** A process-shared sandbox so a checkout made in one call is observable by a later call in tests. */
export function getSharedSandboxProvider() {
  if (!sharedSandbox) sharedSandbox = new SandboxBillingProvider();
  return sharedSandbox;
}

/**
 * Provider factory. Three mutually exclusive modes, checked in fail-closed order:
 *
 *   1. explicit injection  — tests and callers that supply their own provider;
 *   2. TEST MODE           — the provider-shaped adapter over an injected transport (ADR-001 §6).
 *                            Refused in production, refused alongside live mode, and its transport
 *                            never opens a socket under NODE_ENV=test;
 *   3. LIVE                — only when enabled AND the provider is in APPROVED_LIVE_PROVIDERS (empty),
 *                            so live always fails closed today;
 *   4. otherwise           — the deterministic in-memory sandbox.
 *
 * Never performs network I/O at selection time.
 */
export function selectBillingProvider(options = {}) {
  if (options.billingProvider) return options.billingProvider; // test injection
  assertBillingProductionSafety(); // fail closed if live requested without an approved provider
  assertBillingTestModeSafety();   // fail closed on test-mode misconfiguration (prod / live overlap)

  // Test mode is checked BEFORE the sandbox fallback: an operator who asked for the provider-shaped
  // adapter must get it or get an error, never a silent downgrade to the in-memory sandbox — a silent
  // downgrade would make an integration test pass without exercising a single provider-shaped call.
  if (isBillingTestModeEnabled()) {
    return new TestModeBillingProvider({ transport: options.billingTransport || null });
  }

  if (shouldUseSandboxBilling()) return getSharedSandboxProvider();

  // Live + approved provider configured: construct the real adapter (still external-activation gated).
  const provider = configuredBillingProvider();
  if (provider === BILLING_PROVIDERS.STRIPE) return new StripeBillingProvider();
  // Defensive: an "approved but unrecognized" provider must not silently downgrade to sandbox in live.
  if (isBillingLiveEnabled()) {
    throw new BillingProviderError(`Live billing provider '${provider}' is not implemented`, 'EXTERNAL_ACTIVATION_REQUIRED');
  }
  return getSharedSandboxProvider();
}
