/**
 * CARUP-PAY-01A — isolated CarUp Japan DIRECT MERCHANT sandbox contract.
 * NOT SafeTrade, escrow, seller settlement, a vehicle sale, or a live activation.
 * Only backend-built JPY100 certification checkout can be issued.
 */
import crypto from 'node:crypto';

export const PAY01A_ACCOUNT = 'acct_1UVnGaEjgXqvlsJk';
export const PAY01A_MERCHANT = 'carup_japan';
export const PAY01A_AMOUNT_JPY = 100;
export const PAY01A_CURRENCY = 'jpy';
export const PAY01A_CHECKOUT_LABEL = 'CarUp Japan — sandbox payment certification (not a vehicle purchase)';

export class Pay01aError extends Error {
  constructor(code, status = 409) {
    super(code);
    this.name = 'Pay01aError';
    this.code = code;
    this.status = status;
  }
}

export function requirePay01aSandbox(env = process.env, { webhook = false } = {}) {
  const deployment = String(env.VERCEL_ENV || '').toLowerCase();
  const app = String(env.CARUP_ENV || env.APP_ENV || '').toLowerCase();
  const node = String(env.NODE_ENV || '').toLowerCase();
  if (env.CARUP_PAY01A_ENABLED !== 'true'
    || deployment === 'production'
    || app === 'production'
    || (node === 'production' && !['preview', 'development'].includes(deployment))
    || (deployment && !['development', 'preview'].includes(deployment))
    || (app && !['development', 'test', 'staging'].includes(app))
    || (!deployment && !app && !['test', 'development'].includes(node))) {
    throw new Pay01aError('PAY01A_SANDBOX_DISABLED', 404);
  }
  if (env.CARUP_PAY01A_STRIPE_ACCOUNT_ID !== PAY01A_ACCOUNT) {
    throw new Pay01aError('PAY01A_MERCHANT_MISMATCH', 503);
  }
  const key = String(env.CARUP_PAY01A_STRIPE_SECRET_KEY || '');
  if (!key.startsWith('sk_test_') || key.length < 16) {
    throw new Pay01aError('PAY01A_TEST_KEY_REQUIRED', 503);
  }
  if (webhook) {
    if (!/^whsec_[A-Za-z0-9]+$/.test(String(env.CARUP_PAY01A_STRIPE_WEBHOOK_SECRET || ''))) {
      throw new Pay01aError('PAY01A_WEBHOOK_SECRET_REQUIRED', 503);
    }
    return { accountId: PAY01A_ACCOUNT };
  }
  const base = String(env.CARUP_PAY01A_RETURN_ORIGIN || '').replace(/\/$/, '');
  let parsed;
  try { parsed = new URL(base); } catch { throw new Pay01aError('PAY01A_RETURN_ORIGIN_INVALID', 503); }
  if (!(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))
    || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    // A remote Preview requires a separate bounded approval/change; never silently accept arbitrary redirects.
    throw new Pay01aError('PAY01A_LOCAL_RETURN_ORIGIN_REQUIRED', 503);
  }
  return { accountId: PAY01A_ACCOUNT, origin: parsed.origin };
}

export function pay01aMetadata(reference) {
  if (!/^pay01a_[0-9a-f-]{36}$/.test(String(reference || ''))) {
    throw new Pay01aError('PAY01A_REFERENCE_INVALID', 400);
  }
  return Object.freeze({
    carup_reference: reference,
    carup_merchant: PAY01A_MERCHANT,
    carup_environment: 'sandbox',
    carup_programme: 'PAY-01A',
  });
}

export function pay01aIdempotency(reference, operation) {
  return 'carup_pay01a_' + operation + '_' + crypto.createHash('sha256')
    .update(JSON.stringify({ reference, operation, account: PAY01A_ACCOUNT }))
    .digest('hex').slice(0, 32);
}

// Stripe's current Checkout API accepts an integration identifier for provider
// telemetry. Keep the identifier stable for a CarUp reference so an idempotent
// retry never changes the request body and cannot create a second integration
// identity.
export function pay01aIntegrationIdentifier(reference) {
  if (!/^pay01a_[0-9a-f-]{36}$/.test(String(reference || ''))) {
    throw new Pay01aError('PAY01A_REFERENCE_INVALID', 400);
  }
  return 'carup_pay01a_' + crypto.createHash('sha256')
    .update(reference)
    .digest('hex')
    .slice(0, 8);
}

function matchMetadata(meta, reference) {
  const expected = pay01aMetadata(reference);
  return Object.keys(expected).every((key) => meta?.[key] === expected[key]);
}

export function pay01aProviderId(value) {
  return typeof value === 'string' ? value : value?.id || null;
}

/**
 * Stripe's current Refund resource can omit `livemode`, unlike Checkout and
 * PaymentIntent. The exact parent PaymentIntent remains required and is itself
 * freshly verified as test-mode; a live value is always refused.
 */
export function isPay01aSandboxRefund(refund) {
  return Boolean(refund) && (refund.livemode === false || typeof refund.livemode === 'undefined');
}

/**
 * PAY-03B F5. Classify the provider's refund evidence for ONE PaymentIntent against CarUp's approved
 * full-refund-only policy. Pure: no network, no database.
 *
 *  - 'refunded'            the provider confirms refunds totalling the full amount (one or several);
 *  - 'refund_pending'      a refund of the full amount is in flight and nothing has been refunded yet;
 *  - 'reconciliation_hold' any other positive refund evidence (a succeeded or pending PARTIAL refund).
 *                          It conflicts with policy, so it is held for an operator, never guessed at;
 *  - 'paid'                no refund moved money (failed/canceled refunds carry no money movement).
 *
 * Evidence that cannot belong to this payment (another PaymentIntent, a live-mode refund, a different
 * currency, a non-positive or fractional amount, or a total above the payment) still throws.
 */
export function classifyPay01aRefundEvidence({ intentId, amountMinor, currency, refunds = [] }) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new Pay01aError('PAY01A_PROVIDER_AMOUNT_INVALID');
  }
  let refundedMinor = 0;
  let pendingRefundMinor = 0;
  const refundIds = [];
  for (const refund of refunds) {
    if (!isPay01aSandboxRefund(refund) || pay01aProviderId(refund.payment_intent) !== intentId
      || refund.currency !== currency || !Number.isSafeInteger(refund.amount) || refund.amount <= 0) {
      throw new Pay01aError('PAY01A_PROVIDER_REFUND_MISMATCH');
    }
    if (refund.status === 'succeeded') {
      refundedMinor += refund.amount;
      refundIds.push(refund.id);
    } else if (refund.status === 'pending' || refund.status === 'requires_action') {
      pendingRefundMinor += refund.amount;
      refundIds.push(refund.id);
    }
  }
  if (refundedMinor > amountMinor || refundedMinor + pendingRefundMinor > amountMinor) {
    throw new Pay01aError('PAY01A_REFUND_OVERFLOW');
  }
  const evidence = { refundedMinor, pendingRefundMinor, refundIds };
  if (refundedMinor === amountMinor) return { state: 'refunded', ...evidence };
  if (refundedMinor > 0) return { state: 'reconciliation_hold', mismatch: 'partial_refund_succeeded', ...evidence };
  if (pendingRefundMinor === amountMinor) return { state: 'refund_pending', ...evidence };
  if (pendingRefundMinor > 0) return { state: 'reconciliation_hold', mismatch: 'partial_refund_pending', ...evidence };
  return { state: 'paid', ...evidence };
}

/** A browser redirect is not payment authority. All money status requires fresh provider reads. */
export function evaluatePay01aProviderSnapshot({ checkout, intent = null, refunds = [], reference }) {
  if (!checkout || checkout.mode !== 'payment' || checkout.livemode !== false
    || checkout.client_reference_id !== reference || !matchMetadata(checkout.metadata, reference)
    || checkout.currency !== PAY01A_CURRENCY || checkout.amount_total !== PAY01A_AMOUNT_JPY) {
    throw new Pay01aError('PAY01A_PROVIDER_CHECKOUT_MISMATCH');
  }
  if (checkout.payment_status === 'paid') {
    if (!intent || intent.livemode !== false || intent.id !== pay01aProviderId(checkout.payment_intent)
      || !matchMetadata(intent.metadata, reference)
      || intent.currency !== PAY01A_CURRENCY || intent.amount !== PAY01A_AMOUNT_JPY
      || intent.amount_received !== PAY01A_AMOUNT_JPY || intent.status !== 'succeeded') {
      throw new Pay01aError('PAY01A_PROVIDER_INTENT_MISMATCH');
    }
    // F5: a partial refund is provider truth that conflicts with policy. It is returned as a held state with
    // its exact evidence (never thrown away, never rounded up to 'refunded', never left as 'paid').
    const evidence = classifyPay01aRefundEvidence({
      intentId: intent.id, amountMinor: PAY01A_AMOUNT_JPY, currency: PAY01A_CURRENCY, refunds,
    });
    const { state, ...refundEvidence } = evidence;
    // The certified PAY-01A result shape ({ status, intentId }) is unchanged when no refund moved money.
    return state === 'paid'
      ? { status: state, intentId: intent.id }
      : { status: state, intentId: intent.id, refundEvidence };
  }
  if (checkout.payment_status !== 'unpaid' && checkout.payment_status !== 'no_payment_required') {
    throw new Pay01aError('PAY01A_PROVIDER_STATUS_UNKNOWN');
  }
  return { status: checkout.status === 'expired' ? 'cancelled' : 'pending', intentId: null };
}

export function validatePay01aRequestKey(key) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,96}$/.test(key)) {
    throw new Pay01aError('PAY01A_IDEMPOTENCY_KEY_REQUIRED', 400);
  }
  return key;
}
