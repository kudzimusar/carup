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
  if (env.CARUP_PAY01A_ENABLED !== 'true'
    || deployment === 'production'
    || app === 'production'
    || (deployment && !['development', 'preview'].includes(deployment))
    || (app && !['development', 'test', 'staging'].includes(app))
    || (!deployment && !app && !['test', 'development'].includes(String(env.NODE_ENV || '').toLowerCase()))) {
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

function matchMetadata(meta, reference) {
  const expected = pay01aMetadata(reference);
  return Object.keys(expected).every((key) => meta?.[key] === expected[key]);
}

/** A browser redirect is not payment authority. All money status requires fresh provider reads. */
export function evaluatePay01aProviderSnapshot({ checkout, intent = null, refunds = [], reference }) {
  if (!checkout || checkout.mode !== 'payment' || checkout.livemode !== false
    || checkout.client_reference_id !== reference || !matchMetadata(checkout.metadata, reference)
    || checkout.currency !== PAY01A_CURRENCY || checkout.amount_total !== PAY01A_AMOUNT_JPY) {
    throw new Pay01aError('PAY01A_PROVIDER_CHECKOUT_MISMATCH');
  }
  if (checkout.payment_status === 'paid') {
    if (!intent || intent.livemode !== false || intent.id !== (typeof checkout.payment_intent === 'string'
      ? checkout.payment_intent : checkout.payment_intent?.id)
      || !matchMetadata(intent.metadata, reference)
      || intent.currency !== PAY01A_CURRENCY || intent.amount !== PAY01A_AMOUNT_JPY
      || intent.amount_received !== PAY01A_AMOUNT_JPY || intent.status !== 'succeeded') {
      throw new Pay01aError('PAY01A_PROVIDER_INTENT_MISMATCH');
    }
    let refunded = 0;
    let pending = false;
    for (const refund of refunds) {
      if (refund.livemode !== false || refund.payment_intent !== intent.id
        || refund.currency !== PAY01A_CURRENCY) {
        throw new Pay01aError('PAY01A_PROVIDER_REFUND_MISMATCH');
      }
      if (refund.status === 'succeeded') refunded += refund.amount;
      if (refund.status === 'pending' || refund.status === 'requires_action') pending = true;
    }
    if (refunded > PAY01A_AMOUNT_JPY) throw new Pay01aError('PAY01A_REFUND_OVERFLOW');
    return { status: refunded === PAY01A_AMOUNT_JPY ? 'refunded' : pending ? 'refund_pending' : 'paid',
      intentId: intent.id };
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
