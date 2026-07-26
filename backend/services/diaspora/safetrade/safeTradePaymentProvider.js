/**
 * Phase 9 — SafeTrade payment provider abstraction (SANDBOX-ONLY).
 *
 * `PaymentProvider` is the interface every escrow provider implements. `SandboxPaymentProvider` is a
 * deterministic, fully in-memory implementation (NO network, NO real money) used by tests and as the
 * default until a real provider is wired AND legally approved (EB-4 external activation).
 * `LivePaymentProvider` is an external-activation stub: every method throws
 * `EXTERNAL_ACTIVATION_REQUIRED`. `selectPaymentProvider()` is fail-closed — it returns the sandbox
 * provider unless live payment is enabled AND an approved provider is configured (the approved list is
 * empty, so live always fails closed). This mirrors backend/services/diaspora/billing/billingProvider.js
 * (SandboxBillingProvider / StripeBillingProvider / selectBillingProvider) and the HMAC + anti-replay
 * webhook discipline of backend/services/payment/paymentRouter.js.
 *
 * Non-negotiables (directive §5.2 / N1, N7): the sandbox release()/refund() move ONLY fake balances;
 * every payload carries `live:false`; the live path never touches a network and always throws.
 */
import crypto from 'crypto';
import {
  SAFETRADE_PAYMENT_PROVIDERS,
  SAFETRADE_APPROVED_LIVE_PROVIDERS,
  SAFETRADE_EXTERNAL_ACTIVATION_ERROR,
  isSafeTradeLivePaymentEnabled,
  configuredSafeTradeProvider,
  shouldUseSandboxEscrow,
  assertSafeTradeProductionSafety,
} from '../../../constants/diaspora/diasporaSafeTradeConstants.js';

// Deterministic webhook secret: env in prod, a fixed dev constant otherwise (so tests can sign).
function safeTradeWebhookSecret() {
  return process.env.DIASPORA_SAFETRADE_WEBHOOK_SECRET || 'safetrade-sandbox-webhook-secret';
}

// 5-minute anti-replay drift window (ms), identical to paymentRouter.verifySignature.
const WEBHOOK_DRIFT_MS = 300000;

export class PaymentProviderError extends Error {
  constructor(message, code = 'PAYMENT_PROVIDER_ERROR') {
    // Sanitized message only — never include secrets, signatures, or raw provider payloads.
    super(message);
    this.name = 'PaymentProviderError';
    this.code = code;
  }
}

/**
 * The full provider surface (directive §42). Every method is async, takes a single options object,
 * returns a plain serializable object, and on the base throws 'not implemented'.
 */
export class PaymentProvider {
  get name() { return 'base'; }
  // eslint-disable-next-line no-unused-vars
  async createPaymentIntent(_input) { throw new PaymentProviderError('not implemented'); }
  // eslint-disable-next-line no-unused-vars
  async authorizeHold(_input) { throw new PaymentProviderError('not implemented'); }
  // eslint-disable-next-line no-unused-vars
  async captureRelease(_input) { throw new PaymentProviderError('not implemented'); }
  // eslint-disable-next-line no-unused-vars
  async refund(_input) { throw new PaymentProviderError('not implemented'); }
  // eslint-disable-next-line no-unused-vars
  async partialRefund(_input) { throw new PaymentProviderError('not implemented'); }
  // eslint-disable-next-line no-unused-vars
  async cancel(_input) { throw new PaymentProviderError('not implemented'); }
  // eslint-disable-next-line no-unused-vars
  async retrieveStatus(_input) { throw new PaymentProviderError('not implemented'); }
  // eslint-disable-next-line no-unused-vars
  async verifyWebhook(_input) { throw new PaymentProviderError('not implemented'); }
  // eslint-disable-next-line no-unused-vars
  async reconcileEvent(_input) { throw new PaymentProviderError('not implemented'); }
}

// Provider-side intent state machine (defense in depth; the authoritative machine lives in the RPC).
const PROVIDER_STATES = Object.freeze({
  REQUIRES_AUTHORIZATION: 'requires_authorization',
  AUTHORIZED: 'authorized',
  CAPTURED: 'captured',
  RELEASED: 'released',
  REFUNDED: 'refunded',
  PARTIALLY_REFUNDED: 'partially_refunded',
  CANCELLED: 'cancelled',
});

// Webhook event-type -> normalized internal effect (pure mapping, no I/O).
const WEBHOOK_EFFECTS = Object.freeze({
  'intent.created': { normalizedStatus: PROVIDER_STATES.REQUIRES_AUTHORIZATION, terminal: false },
  'hold.authorized': { normalizedStatus: PROVIDER_STATES.AUTHORIZED, terminal: false },
  'capture.succeeded': { normalizedStatus: PROVIDER_STATES.CAPTURED, terminal: false },
  'release.succeeded': { normalizedStatus: PROVIDER_STATES.RELEASED, terminal: true },
  'refund.succeeded': { normalizedStatus: PROVIDER_STATES.REFUNDED, terminal: true },
  'partial_refund.succeeded': { normalizedStatus: PROVIDER_STATES.PARTIALLY_REFUNDED, terminal: false },
  'cancel.succeeded': { normalizedStatus: PROVIDER_STATES.CANCELLED, terminal: true },
  'payment.failed': { normalizedStatus: 'failed', terminal: true },
});

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * Deterministic in-memory sandbox provider. State is a Map keyed by intentId and lives only in
 * memory; no external calls are ever made. Ids are monotonic (`sbx_pi_1`, `sbx_hold_1`, …) and the
 * clock is injectable (default a fixed timestamp) so tests assert without wall-clock flakiness.
 */
export class SandboxPaymentProvider extends PaymentProvider {
  constructor({ now = '2026-06-21T00:00:00.000Z' } = {}) {
    super();
    this._intents = new Map(); // intentId -> snapshot
    this._seq = 0;
    this._now = now;
    // Provider-layer idempotency: idempotencyKey -> prior result snapshot.
    this._idem = new Map();
  }

  get name() { return SAFETRADE_PAYMENT_PROVIDERS.SANDBOX; }

  _next(prefix) { return `${prefix}_${(this._seq += 1)}`; }

  _snapshot(intent, extra = {}) {
    return { ...intent, live: false, ...extra };
  }

  // Replay a mutating op by idempotencyKey: returns the prior result with idempotentReplay:true.
  _replay(idempotencyKey) {
    if (idempotencyKey && this._idem.has(idempotencyKey)) {
      return { ...this._idem.get(idempotencyKey), idempotentReplay: true };
    }
    return null;
  }

  _remember(idempotencyKey, result) {
    if (idempotencyKey) this._idem.set(idempotencyKey, result);
    return { ...result, idempotentReplay: false };
  }

  _require(intentId) {
    const intent = this._intents.get(intentId);
    if (!intent) throw new PaymentProviderError('intent not found', 'INVALID_INPUT');
    return intent;
  }

  async createPaymentIntent({
    milestoneId, tenantId = null, amount, currency = 'USD', payer = null, payee = null, idempotencyKey = null,
  } = {}) {
    const replay = this._replay(idempotencyKey);
    if (replay) return replay;
    if (amount == null || !(Number(amount) >= 0)) throw new PaymentProviderError('amount must be >= 0', 'INVALID_INPUT');
    const intentId = this._next('sbx_pi');
    const intent = {
      intentId,
      milestoneId: milestoneId ?? null,
      tenantId,
      status: PROVIDER_STATES.REQUIRES_AUTHORIZATION,
      amount: round2(amount),
      currency,
      payer,
      payee,
      capturedAmount: 0,
      refundedAmount: 0,
      holdRef: null,
      captureRef: null,
      releaseRef: null,
      createdAt: this._now,
    };
    this._intents.set(intentId, intent);
    return this._remember(idempotencyKey, {
      provider: this.name, intentId, status: intent.status, amount: intent.amount, currency, live: false,
    });
  }

  async authorizeHold({ intentId, idempotencyKey = null } = {}) {
    const replay = this._replay(idempotencyKey);
    if (replay) return replay;
    const intent = this._require(intentId);
    if (intent.status !== PROVIDER_STATES.REQUIRES_AUTHORIZATION) {
      throw new PaymentProviderError(`cannot authorize from ${intent.status}`, 'INVALID_STATE');
    }
    intent.status = PROVIDER_STATES.AUTHORIZED;
    intent.holdRef = this._next('sbx_hold');
    return this._remember(idempotencyKey, {
      provider: this.name, intentId, status: intent.status, holdRef: intent.holdRef, live: false,
    });
  }

  async captureRelease({ intentId, amount = null, idempotencyKey = null } = {}) {
    const replay = this._replay(idempotencyKey);
    if (replay) return replay;
    const intent = this._require(intentId);
    if (intent.status !== PROVIDER_STATES.AUTHORIZED) {
      throw new PaymentProviderError(`cannot capture from ${intent.status}`, 'INVALID_STATE');
    }
    const capturedAmount = round2(amount == null ? intent.amount : amount);
    if (capturedAmount > intent.amount) throw new PaymentProviderError('capture exceeds authorized amount', 'INVALID_INPUT');
    intent.status = PROVIDER_STATES.CAPTURED;
    intent.capturedAmount = capturedAmount;
    intent.captureRef = this._next('sbx_cap');
    return this._remember(idempotencyKey, {
      provider: this.name, intentId, status: intent.status, captureRef: intent.captureRef, capturedAmount, live: false,
    });
  }

  // Release captured funds to payee (sandbox moves only fake balances; live:false always).
  async release({ intentId, idempotencyKey = null, approval = null } = {}) {
    const replay = this._replay(idempotencyKey);
    if (replay) return replay;
    const intent = this._require(intentId);
    if (intent.status !== PROVIDER_STATES.CAPTURED) {
      throw new PaymentProviderError(`cannot release from ${intent.status}`, 'INVALID_STATE');
    }
    intent.status = PROVIDER_STATES.RELEASED;
    intent.releaseRef = this._next('sbx_rel');
    return this._remember(idempotencyKey, {
      provider: this.name, intentId, status: intent.status, releaseRef: intent.releaseRef, approval: approval ?? null, live: false,
    });
  }

  async refund({ intentId, idempotencyKey = null } = {}) {
    const replay = this._replay(idempotencyKey);
    if (replay) return replay;
    const intent = this._require(intentId);
    if (![PROVIDER_STATES.CAPTURED, PROVIDER_STATES.RELEASED].includes(intent.status)) {
      throw new PaymentProviderError(`cannot refund from ${intent.status}`, 'INVALID_STATE');
    }
    const refundedAmount = round2(intent.capturedAmount || intent.amount);
    intent.status = PROVIDER_STATES.REFUNDED;
    intent.refundedAmount = refundedAmount;
    const refundRef = this._next('sbx_ref');
    return this._remember(idempotencyKey, {
      provider: this.name, intentId, status: intent.status, refundRef, refundedAmount, live: false,
    });
  }

  async partialRefund({ intentId, amount, idempotencyKey = null } = {}) {
    const replay = this._replay(idempotencyKey);
    if (replay) return replay;
    const intent = this._require(intentId);
    if (![PROVIDER_STATES.CAPTURED, PROVIDER_STATES.RELEASED, PROVIDER_STATES.PARTIALLY_REFUNDED].includes(intent.status)) {
      throw new PaymentProviderError(`cannot partial-refund from ${intent.status}`, 'INVALID_STATE');
    }
    const delta = round2(amount);
    if (!(delta > 0)) throw new PaymentProviderError('partial refund amount must be > 0', 'INVALID_INPUT');
    const captured = round2(intent.capturedAmount || intent.amount);
    const newRefunded = round2((intent.refundedAmount || 0) + delta);
    if (newRefunded > captured) throw new PaymentProviderError('partial refund exceeds captured amount', 'INVALID_INPUT');
    intent.refundedAmount = newRefunded;
    intent.status = newRefunded >= captured ? PROVIDER_STATES.REFUNDED : PROVIDER_STATES.PARTIALLY_REFUNDED;
    const refundRef = this._next('sbx_ref');
    return this._remember(idempotencyKey, {
      provider: this.name,
      intentId,
      status: intent.status,
      refundRef,
      refundedAmount: newRefunded,
      remainingAmount: round2(captured - newRefunded),
      live: false,
    });
  }

  async cancel({ intentId, idempotencyKey = null } = {}) {
    const replay = this._replay(idempotencyKey);
    if (replay) return replay;
    const intent = this._require(intentId);
    if (![PROVIDER_STATES.REQUIRES_AUTHORIZATION, PROVIDER_STATES.AUTHORIZED].includes(intent.status)) {
      throw new PaymentProviderError(`cannot cancel from ${intent.status}`, 'INVALID_STATE');
    }
    intent.status = PROVIDER_STATES.CANCELLED;
    return this._remember(idempotencyKey, {
      provider: this.name, intentId, status: intent.status, live: false,
    });
  }

  async retrieveStatus({ intentId } = {}) {
    const intent = this._require(intentId);
    return {
      provider: this.name,
      intentId,
      status: intent.status,
      amount: intent.amount,
      capturedAmount: intent.capturedAmount,
      refundedAmount: intent.refundedAmount,
      live: false,
    };
  }

  /**
   * HMAC-SHA256 over `${timestamp}.${rawBody}` with the webhook secret, timing-safe compare, plus a
   * 5-minute anti-replay drift check — the exact composition of paymentRouter.verifySignature. Returns
   * `{ verified:false }` (never throws) on bad signature/missing timestamp/excess drift so a router can
   * answer 401 cleanly. `now` is injectable for deterministic drift tests.
   */
  async verifyWebhook({ rawBody, signature, timestamp, now = null } = {}) {
    const fail = { verified: false, eventId: null, eventType: null, intentId: null, payload: null };
    if (rawBody == null || !signature) return fail;
    if (timestamp == null) return fail;
    const clock = now == null ? Date.parse(this._now) : Number(now);
    const drift = Math.abs(clock - Number(timestamp));
    if (Number.isNaN(drift) || drift > WEBHOOK_DRIFT_MS) return fail;

    const body = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody);
    const expected = crypto
      .createHmac('sha256', safeTradeWebhookSecret())
      .update(`${timestamp}.${body}`)
      .digest('hex');
    const provided = String(signature);
    const verified = provided.length === expected.length
      && crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    if (!verified) return fail;

    let payload = null;
    try {
      payload = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
    } catch {
      payload = null;
    }
    return {
      verified: true,
      eventId: payload?.id || payload?.event_id || null,
      eventType: payload?.type || payload?.event_type || null,
      intentId: payload?.intentId || payload?.intent_id || payload?.data?.intentId || null,
      payload,
    };
  }

  /** Pure mapping of a verified webhook/status into a normalized internal effect. */
  async reconcileEvent({ event } = {}) {
    const eventType = event?.eventType || event?.type || null;
    const intentId = event?.intentId || event?.intent_id || event?.payload?.intentId || null;
    const mapped = WEBHOOK_EFFECTS[eventType] || { normalizedStatus: 'unknown', terminal: false };
    const amountDelta = event?.payload?.amount != null ? round2(event.payload.amount) : 0;
    return {
      intentId,
      normalizedStatus: mapped.normalizedStatus,
      amountDelta,
      terminal: Boolean(mapped.terminal),
      live: false,
    };
  }
}

/**
 * External-activation stub for the first real provider. Like StripeBillingProvider / GoogleDriveProvider,
 * EVERY method throws EXTERNAL_ACTIVATION_REQUIRED until an approved SDK + credentials are provisioned.
 * No SDK import, no network. Keeps "live escrow" honest: code-complete pending external activation.
 */
export class LivePaymentProvider extends PaymentProvider {
  get name() { return 'live'; }

  _throw(op) {
    throw new PaymentProviderError(
      `Live SafeTrade ${op} requires an approved payment provider SDK and credentials (external activation pending)`,
      SAFETRADE_EXTERNAL_ACTIVATION_ERROR,
    );
  }

  async createPaymentIntent() { this._throw('createPaymentIntent'); }
  async authorizeHold() { this._throw('authorizeHold'); }
  async captureRelease() { this._throw('captureRelease'); }
  async release() { this._throw('release'); }
  async refund() { this._throw('refund'); }
  async partialRefund() { this._throw('partialRefund'); }
  async cancel() { this._throw('cancel'); }
  async retrieveStatus() { this._throw('retrieveStatus'); }
  async verifyWebhook() { this._throw('verifyWebhook'); }
  async reconcileEvent() { this._throw('reconcileEvent'); }
}

let sharedSandbox = null;
/** Process-shared sandbox so an intent created in one call is observable by a later call (tests). */
export function getSharedSandboxPaymentProvider() {
  if (!sharedSandbox) sharedSandbox = new SandboxPaymentProvider();
  return sharedSandbox;
}

/**
 * Provider factory. Returns the sandbox provider unless LIVE payment is enabled AND an approved
 * provider is configured (the approved list is empty, so live always fails closed). The fail-closed
 * assert throws first; an "approved but unrecognized" provider in live mode also throws — it never
 * silently downgrades to sandbox. Never performs network I/O at selection time.
 */
export function selectPaymentProvider(options = {}) {
  if (options.paymentProvider) return options.paymentProvider; // test injection
  assertSafeTradeProductionSafety(); // fail closed if live requested without an approved provider
  if (shouldUseSandboxEscrow()) return getSharedSandboxPaymentProvider();

  // Live requested. assertSafeTradeProductionSafety would already have thrown for an unapproved
  // provider; this guard is defense-in-depth so an empty/unknown approved list cannot fall through.
  if (isSafeTradeLivePaymentEnabled()) {
    const provider = configuredSafeTradeProvider();
    if (provider && SAFETRADE_APPROVED_LIVE_PROVIDERS.includes(provider)) return new LivePaymentProvider();
    throw new PaymentProviderError(
      `Live SafeTrade payment provider '${provider}' is not implemented`,
      SAFETRADE_EXTERNAL_ACTIVATION_ERROR,
    );
  }
  return getSharedSandboxPaymentProvider();
}

export { safeTradeWebhookSecret, PROVIDER_STATES as SAFETRADE_PROVIDER_STATES, WEBHOOK_EFFECTS as SAFETRADE_WEBHOOK_EFFECTS };
