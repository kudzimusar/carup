/**
 * CARUP-PAY-04-LR01 — shared contract for garage invoices, declared garage payments and provider-confirmed garage
 * payments (docs/payments/CARUP_PAY_04_GARAGE_PAYMENTS.md).
 *
 * Authority boundaries:
 *  - Garage revenue belongs to the GARAGE. A provider-confirmed garage payment is a canonical payment_transactions row
 *    of third-party funds (product gar.invoice.customer_payment, funds owner garage_business_tenant). CarUp is never
 *    the beneficiary and CarUp Japan's Stripe merchant never collects it.
 *  - Declared payments are OPS07's garage_payment_records ('garage_recorded_external'); PAY-04 never writes them.
 *  - Every money state is written by the canonical SECURITY DEFINER functions of migration 20261102110000; this
 *    module only names errors, gates and the words the customer and the garage read.
 *  - Level 1 only: the one provider is the clearly-labelled local simulator, enabled explicitly, never in production.
 */

export class Pay04Error extends Error {
  constructor(code, status = 409, details = null) {
    super(code);
    this.name = 'Pay04Error';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const PAY04_SIMULATOR_GATEWAY = 'pay04_garage_provider_simulator';
export const PAY04_PRODUCT_CODE = 'gar.invoice.customer_payment';

/** Words the customer and the garage read. Each one says exactly what CarUp did and did not do. */
export const PAY04_LABELS = Object.freeze({
  declaredSource: 'Recorded by the garage. CarUp has not processed or verified this payment.',
  providerSource: 'Confirmed by the garage’s payment provider. The money is paid to the garage, not to CarUp.',
  // a provider payment row states its channel only; whether it counts is its state (never "confirmed" before it is)
  providerChannel: 'Through the garage’s own payment provider. Money paid this way goes to the garage, not to CarUp.',
  mixedSource: 'Part recorded by the garage (CarUp has not verified it) and part confirmed by the garage’s payment provider (paid to the garage, not to CarUp).',
  simulatedProvider: 'Simulated payment provider — test environment. No real money moves.',
  instructionsDisclosure: 'These payment instructions come from the garage. Pay the garage directly. CarUp does not receive, hold or verify this money.',
  noInstructions: 'The garage has not published payment instructions on CarUp yet. Ask the garage how to pay.',
  inFlight: 'A payment is in progress with the provider. It is not counted until the provider confirms it.',
  held: 'The provider reported a refund that conflicts with the refund policy. This payment is under review and is not counted.',
  refundPending: 'A refund is in progress. This payment is not counted while the refund is pending.',
  unallocated: 'The provider confirmed money this invoice could not absorb. It is not counted and is under review.',
});

export function isPay04ProductionRuntime(env = process.env) {
  const deployment = String(env.VERCEL_ENV || '').toLowerCase();
  const app = String(env.CARUP_ENV || env.APP_ENV || '').toLowerCase();
  return deployment === 'production' || app === 'production' || String(env.NODE_ENV || '').toLowerCase() === 'production';
}

/** PAY-04 provider and operator routes are dark unless explicitly enabled outside production. */
export function isPay04Enabled(env = process.env) {
  return env.CARUP_PAY04_ENABLED === 'true' && !isPay04ProductionRuntime(env);
}

export function requirePay04Enabled(env = process.env) {
  if (!isPay04Enabled(env)) throw new Pay04Error('PAY04_DISABLED', 404);
}

const NOT_FOUND = /(_NOT_FOUND|PAYMENT_NOT_FOUND)$/;
const FORBIDDEN = /(ADMIN_REQUIRED|AUTHORITY_REFUSED|SELF_DEALING_REFUSED|PAYER_NOT_CUSTOMER|PAYER_IS_GARAGE_MEMBER)$/;
const UNAVAILABLE = /(GATEWAY_NOT_PERMITTED|GARAGE_MERCHANT_NOT_AVAILABLE|MERCHANT_CURRENCY_UNSUPPORTED|SIMULATOR_REFUSED|PROVIDER_AUTHORITY_PENDING|DISABLED)$/;
const VALIDATION = /(_INVALID|_REQUIRED|CURRENCY_MISMATCH|TOO_MANY_LINES|EXCEEDS_CURRENCY_PRECISION|NOT_PRICED)$/;

/** Map a database refusal (its stable token) to an HTTP-shaped Pay04Error. Unknown failures never leak details. */
export function pay04Failure(error, fallback = 'PAY04_OPERATION_UNAVAILABLE') {
  if (error instanceof Pay04Error) return error;
  const message = String(error?.message || '');
  // PAY05_: PAY-05's hunks inside the accepted PAY-04 functions raise their own refusals (a dispute Paynow still reports,
  // a Paynow row sent down a simulator-only path, an unresolved initiation); PAY-04's routes must state them too
  const token = (/\b(PAY04_[A-Z0-9_]+|PAY05_[A-Z0-9_]+|PAY03B_[A-Z0-9_]+|PAY01A_[A-Z0-9_]+|GARAGE_OPS0[0-9]_[A-Z0-9_]+)\b/.exec(message) || [])[1];
  if (!token) return new Pay04Error(fallback, 503);
  const detail = String(error?.details ?? error?.detail ?? '');
  const details = /^(uncommitted|balance|consumed)=/.test(detail) ? { detail } : null;
  if (NOT_FOUND.test(token)) return new Pay04Error(token, 404, details);
  if (FORBIDDEN.test(token)) return new Pay04Error(token, 403, details);
  if (UNAVAILABLE.test(token)) return new Pay04Error(token, 503, details);
  if (VALIDATION.test(token)) return new Pay04Error(token, 422, details);
  return new Pay04Error(token, 409, details);
}

/** Currencies without minor units (the same table the database and the web use). */
export const PAY04_ZERO_DECIMAL_CURRENCIES = Object.freeze(['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI',
  'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
export const pay04CurrencyScale = (currency) => (PAY04_ZERO_DECIMAL_CURRENCIES.includes(currency) ? 0 : 2);

/** Money is exchanged as decimal strings in the currency's own precision; nothing is converted or summed across. */
export function pay04Money(value, currency) {
  if (value === null || value === undefined) return null;
  return Number(value).toFixed(pay04CurrencyScale(currency));
}

export function pay04IdempotencyKey(provided) {
  const k = String(provided ?? '').trim();
  if (k.length < 8 || k.length > 120 || !/^[A-Za-z0-9._:-]+$/.test(k)) throw new Pay04Error('PAY04_IDEMPOTENCY_KEY_INVALID', 422);
  return k;
}

export function pay04Reason(value, { min = 10, max = 300 } = {}) {
  const r = String(value ?? '').trim();
  if (r.length < min || r.length > max) throw new Pay04Error('PAY04_REASON_REQUIRED', 422);
  return r;
}
