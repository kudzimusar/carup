/**
 * TEST-MODE billing adapter (ADR-001 §6, Issue #127 Deliverable D).
 *
 * This is NOT a second sandbox. `SandboxBillingProvider` invents state in a Map and never speaks a
 * provider's language; it proves the entitlement flow works but proves nothing about the integration.
 * This adapter builds and sends REAL provider-shaped requests — correct path, method, headers, body
 * encoding, idempotency key, signature scheme — through an INJECTED transport. In tests the transport
 * is a recording fake, so the wire contract is asserted byte-for-byte while nothing opens a socket.
 * Pointing the same code at a provider's own sandbox host is a transport swap and an env var, not a
 * code change.
 *
 * Why that distinction earns its keep: the failure mode this catches is "we'll write the real provider
 * calls when the merchant account arrives", where the day the credentials land is the day the
 * integration is first written and first debugged. Here the integration already exists and is already
 * under test; only the credentials and the socket are missing.
 *
 * Non-negotiables:
 *   - `live: false` on every returned object, always.
 *   - No money moves. Test mode is refused in production and is mutually exclusive with live mode.
 *   - Provider vocabulary never escapes: everything comes back CarUp-shaped, via the profile.
 *   - A capability the chosen provider genuinely lacks is refused honestly
 *     (`PROVIDER_CAPABILITY_UNSUPPORTED`) rather than faked — see ADR-001 §3E on the local rail having
 *     no hosted portal and no subscription object.
 */
import crypto from 'crypto';
import { BillingProvider, BillingProviderError } from './billingProviderBase.js';
import { selectBillingTransport } from './billingHttpTransport.js';
import { getBillingProfile, deriveEventId } from './billingProviderProfiles.js';
import {
  assertBillingTestModeSafety,
  billingTestApiBase,
  billingTestApiKey,
  billingWebhookSecret,
  configuredBillingTestProfile,
} from '../../../constants/diaspora/diasporaBillingConstants.js';
import { DEFAULT_PLAN_KEY, SUBSCRIPTION_STATES } from '../../../constants/diaspora/diasporaEntitlements.js';

export class TestModeBillingProvider extends BillingProvider {
  /**
   * @param {object} opts
   * @param {object} [opts.transport]   injected HTTP transport (required for offline determinism)
   * @param {string} [opts.profileKey]  wire profile to speak
   * @param {string} [opts.apiBase]     provider base URL (never a live host in test mode)
   * @param {string} [opts.apiKey]      test credential
   * @param {string} [opts.webhookSecret]
   * @param {string} [opts.integrationId] second credential some rails carry in the body
   */
  constructor({
    transport = null,
    profileKey = null,
    apiBase = null,
    apiKey = null,
    webhookSecret = null,
    integrationId = null,
  } = {}) {
    super();
    // Fail closed BEFORE anything is constructed: production must never reach a provider sandbox, and
    // a live-looking credential in the test variable is refused rather than used.
    assertBillingTestModeSafety();
    this._profile = getBillingProfile(profileKey || configuredBillingTestProfile());
    this._apiBase = String(apiBase || billingTestApiBase()).replace(/\/+$/, '');
    this._apiKey = apiKey || billingTestApiKey();
    this._webhookSecret = webhookSecret || billingWebhookSecret();
    this._integrationId = integrationId || process.env.DIASPORA_BILLING_TEST_INTEGRATION_ID || 'test-integration';
    this._transport = selectBillingTransport({ transport });
  }

  /** Provider identity is the profile's provider, suffixed so no ledger row can be mistaken for live. */
  get name() { return `${this._profile.providerName}_test`; }

  get profileKey() { return this._profile.key; }

  get transport() { return this._transport; }

  // ── Wire plumbing ────────────────────────────────────────────────────────────────────────────

  _url(path, query = null) {
    const url = `${this._apiBase}${path}`;
    if (!query) return url;
    const qs = new URLSearchParams(query).toString();
    return qs ? `${url}?${qs}` : url;
  }

  /**
   * Execute a profile-built request description. Provider-specific error SHAPES are normalized here so
   * no caller ever parses a provider error body.
   */
  async _send(descriptor, { operation }) {
    if (descriptor?.unsupported) {
      throw new BillingProviderError(
        `Provider ${this._profile.providerName} does not support ${operation} (${descriptor.unsupported})`,
        'PROVIDER_CAPABILITY_UNSUPPORTED',
      );
    }
    const headers = { ...this._profile.authHeaders(this._apiKey) };
    // An empty idempotency-key header would be sent as a real header with an empty value; drop it.
    if (descriptor.idempotencyKey) headers['idempotency-key'] = String(descriptor.idempotencyKey);
    else delete headers['idempotency-key'];

    const res = await this._transport.request({
      method: descriptor.method,
      url: this._url(descriptor.path, descriptor.query || null),
      headers,
      body: descriptor.body ?? null,
    });

    if (res.status >= 400) {
      // Sanitized: the provider's error body can echo request fields (and therefore the API key).
      throw new BillingProviderError(
        `Provider ${operation} failed with status ${res.status}`,
        res.status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_REQUEST_REJECTED',
      );
    }
    return res.body;
  }

  /** Deterministic idempotency key for a provider mutation. Stable per (tenant, operation, discriminator). */
  static idempotencyKey(tenantId, operation, discriminator = '') {
    const h = crypto.createHash('sha256').update(`${tenantId}|${operation}|${discriminator}`).digest('hex');
    return `carup_${operation}_${h.slice(0, 24)}`;
  }

  // ── Capability surface ───────────────────────────────────────────────────────────────────────

  async createCheckoutSession({
    tenantId, planKey, successUrl = null, cancelUrl = null, priceRef = null, idempotencyKey = null,
  } = {}) {
    if (!tenantId) throw new BillingProviderError('tenantId is required', 'INVALID_INPUT');
    if (!planKey) throw new BillingProviderError('planKey is required', 'INVALID_INPUT');
    const key = idempotencyKey || TestModeBillingProvider.idempotencyKey(tenantId, 'checkout', planKey);
    const body = await this._send(this._profile.buildCheckoutSession({
      tenantId, planKey, priceRef, successUrl, cancelUrl, idempotencyKey: key,
      apiKey: this._apiKey, integrationId: this._integrationId,
    }), { operation: 'createCheckoutSession' });

    const parsed = this._profile.parseCheckoutSession(body);
    return {
      provider: this.name,
      sessionId: parsed.sessionId,
      url: parsed.url,
      expiresAt: parsed.expiresAt,
      tenantId,
      planKey,
      successUrl,
      cancelUrl,
      idempotencyKey: key,
      live: false,
    };
  }

  async createPortalSession({ tenantId, customerRef = null, returnUrl = null } = {}) {
    if (!tenantId) throw new BillingProviderError('tenantId is required', 'INVALID_INPUT');
    const key = TestModeBillingProvider.idempotencyKey(tenantId, 'portal');
    const body = await this._send(this._profile.buildPortalSession({
      customerRef: customerRef || `cus_${tenantId}`, returnUrl, idempotencyKey: key,
    }), { operation: 'createPortalSession' });
    const parsed = this._profile.parsePortalSession(body);
    return {
      provider: this.name, sessionId: parsed.sessionId, url: parsed.url, tenantId, returnUrl, live: false,
    };
  }

  /**
   * Pure READ of provider state. Reconciliation depends on this being side-effect free: an audit that
   * mutates what it audits cannot detect drift, it creates it.
   */
  async getSubscription({ tenantId, subscriptionRef = null } = {}) {
    if (!tenantId) throw new BillingProviderError('tenantId is required', 'INVALID_INPUT');
    if (!subscriptionRef) {
      throw new BillingProviderError('subscriptionRef is required to read provider state', 'INVALID_INPUT');
    }
    const body = await this._send(this._profile.buildGetSubscription({ subscriptionRef }), {
      operation: 'getSubscription',
    });
    const snapshot = this._profile.parseSubscription(body);
    return { provider: this.name, tenantId, ...snapshot, live: false };
  }

  /** Refresh CarUp's view from the provider. Falls back to the read when a ref is known. */
  async syncSubscription({ tenantId, planKey = DEFAULT_PLAN_KEY, subscriptionRef = null } = {}) {
    if (!tenantId) throw new BillingProviderError('tenantId is required', 'INVALID_INPUT');
    if (subscriptionRef) {
      const snapshot = await this.getSubscription({ tenantId, subscriptionRef });
      return { ...snapshot, planKey: snapshot.planKey || planKey };
    }
    // No provider handle yet: there is nothing authoritative to read, and inventing an "active"
    // subscription here is exactly the lie that makes billing state untrustworthy.
    return {
      provider: this.name,
      tenantId,
      planKey,
      status: SUBSCRIPTION_STATES.INCOMPLETE,
      providerCustomerRef: null,
      providerSubscriptionRef: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      live: false,
    };
  }

  async cancelSubscription({ tenantId, subscriptionRef = null, atPeriodEnd = true } = {}) {
    if (!tenantId) throw new BillingProviderError('tenantId is required', 'INVALID_INPUT');
    if (!subscriptionRef) throw new BillingProviderError('subscriptionRef is required to cancel', 'INVALID_INPUT');
    const key = TestModeBillingProvider.idempotencyKey(tenantId, 'cancel', String(atPeriodEnd));
    const body = await this._send(this._profile.buildCancelSubscription({
      subscriptionRef, atPeriodEnd, idempotencyKey: key,
    }), { operation: 'cancelSubscription' });
    const snapshot = this._profile.parseSubscription(body);
    return { provider: this.name, tenantId, ...snapshot, live: false };
  }

  async changePlan({ tenantId, planKey, subscriptionRef = null, itemRef = null, priceRef = null } = {}) {
    if (!tenantId) throw new BillingProviderError('tenantId is required', 'INVALID_INPUT');
    if (!planKey) throw new BillingProviderError('planKey is required', 'INVALID_INPUT');
    if (!subscriptionRef) throw new BillingProviderError('subscriptionRef is required to change plan', 'INVALID_INPUT');
    const key = TestModeBillingProvider.idempotencyKey(tenantId, 'change_plan', planKey);
    const body = await this._send(this._profile.buildChangePlan({
      subscriptionRef, itemRef, priceRef, planKey, idempotencyKey: key,
    }), { operation: 'changePlan' });
    const snapshot = this._profile.parseSubscription(body);
    return { provider: this.name, tenantId, ...snapshot, planKey: snapshot.planKey || planKey, live: false };
  }

  async handleTrial({ tenantId, planKey = DEFAULT_PLAN_KEY, trialDays = 14, subscriptionRef = null } = {}) {
    if (!tenantId) throw new BillingProviderError('tenantId is required', 'INVALID_INPUT');
    // A trial is a subscription created with a trial end; there is no separate provider verb. Where no
    // subscription exists yet, checkout is the path, so this reads back whatever the provider holds.
    const snapshot = await this.syncSubscription({ tenantId, planKey, subscriptionRef });
    return { ...snapshot, trialDays, live: false };
  }

  async getInvoiceState({ tenantId, subscriptionRef = null } = {}) {
    if (!tenantId) throw new BillingProviderError('tenantId is required', 'INVALID_INPUT');
    if (!subscriptionRef) {
      return { tenantId, provider: this.name, status: null, amountDue: 0, currency: null, live: false };
    }
    const body = await this._send(this._profile.buildGetInvoice({ subscriptionRef }), {
      operation: 'getInvoiceState',
    });
    return { tenantId, provider: this.name, ...this._profile.parseInvoice(body), live: false };
  }

  /**
   * Verify a webhook against the RAW request bytes.
   *
   * `rawBody` must be the exact bytes the provider signed. Re-serializing a parsed body changes key
   * order and whitespace, so a signature computed over the re-serialization is meaningless — and the
   * "fix" (canonicalizing before verifying) is how signature verification silently stops verifying.
   * A non-string rawBody is therefore REJECTED rather than helpfully stringified.
   */
  async verifyWebhook({ rawBody, signature = null, headers = {}, now = null } = {}) {
    if (rawBody == null) throw new BillingProviderError('rawBody is required', 'INVALID_INPUT');
    if (typeof rawBody !== 'string') {
      throw new BillingProviderError(
        'rawBody must be the exact bytes the provider signed, as a string',
        'RAW_BODY_REQUIRED',
      );
    }
    const result = this._profile.verifySignature({
      rawBody, headers, signature, secret: this._webhookSecret, now,
    });
    if (!result.verified) {
      return { verified: false, reason: result.reason, eventId: null, eventType: null, payload: null, normalized: null };
    }

    const payload = this._profile.parseWebhookBody(rawBody);
    const normalized = this._profile.normalizeEvent(payload);
    const eventId = deriveEventId(this._profile, payload, normalized);
    return {
      verified: true,
      reason: null,
      eventId,
      // The NORMALIZED event type is what the rest of the system sees; the provider's own name is kept
      // alongside it for operator diagnosis only.
      eventType: normalized.eventType,
      providerEventType: normalized.providerEventType,
      payload,
      normalized: { ...normalized, eventId },
      derivedEventId: !normalized.eventId,
      provider: this.name,
    };
  }

  /** Sign a body with this provider's scheme — for fixtures and for the recording transport. */
  signPayload(rawBody, { timestampSeconds = null } = {}) {
    return this._profile.signPayload({
      rawBody, secret: this._webhookSecret, timestampSeconds,
    });
  }
}

/** Construct the configured test-mode adapter. Injection points exist for every external dependency. */
export function createTestModeBillingProvider(options = {}) {
  return new TestModeBillingProvider(options);
}
