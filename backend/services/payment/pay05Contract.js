/**
 * CARUP-PAY-05-LR01 — Zimbabwe collections (Paynow first): shared contract.
 *
 * Authority boundaries (docs/payments/CARUP_PAY_05_ZIMBABWE_COLLECTIONS_MOBILE_MONEY.md):
 *  - A garage's customer pays the GARAGE's own Paynow merchant integration, never a CarUp account. Paynow forbids
 *    one account collecting for several merchants (forum staff, F/240; Terms), so CarUp never pools garage money.
 *  - CarUp first-party Zimbabwe collections need an approved CarUp ZW merchant and approved tariffs: refused until then.
 *  - Sellers, insurers, lenders, government and freight keep their own funds ownership: PAY-06/07/08, refused here.
 *  - Money truth is an authenticated Paynow message (SHA-512 hash with the integration key) confirmed by a poll of the
 *    stored poll URL, written through the PAY-04 governed writers. A browser return is never proof of payment.
 *  - Paynow documents no cancel API, no expiry and no merchant refund API: the adapter never pretends otherwise.
 *  - Level 1 only: the one reachable Paynow endpoint is the local protocol simulator, in a disposable runtime.
 */
import { Pay04Error, isPay04Enabled, isPay04ProductionRuntime } from './pay04Contract.js';

export class Pay05Error extends Pay04Error {
  constructor(code, status = 409, details = null) {
    super(code, status, details);
    this.name = 'Pay05Error';
  }
}

export const PAY05_GATEWAY = 'paynow_zimbabwe';
/** ISO 4217 codes only. Paynow's site writes "ZIG"; that is a brand, never a currency code here. */
export const PAY05_CURRENCIES = Object.freeze(['USD', 'ZWG']);
/** 'web' = Paynow's hosted page (card, Zimswitch and whatever else the integration offers there). */
export const PAY05_METHODS = Object.freeze(['web', 'ecocash', 'onemoney', 'innbucks', 'omari']);
export const PAY05_EXPRESS_METHODS = Object.freeze(['ecocash', 'onemoney', 'innbucks', 'omari']);
// Paynow's Express checkout takes the payer's phone for every mobile-money method, InnBucks included (independent review P8)
export const PAY05_PHONE_METHODS = Object.freeze(['ecocash', 'onemoney', 'innbucks', 'omari']);
/** Integration credentials belong to exactly one world: the local protocol simulator, Paynow test mode, or live. */
export const PAY05_MODES = Object.freeze(['simulator', 'paynow_test', 'paynow_live']);

/** What CarUp can and cannot do through the Paynow merchant API (evidence: the PAY-05 capability matrix). */
export const PAY05_PAYNOW_CAPABILITIES = Object.freeze({
  hostedCheckout: true,
  expressCheckout: true,
  signedStatusUpdates: true,
  poll: true,
  trace: true,
  cancelCheckout: false,      // no endpoint in the docs, the five SDKs or the plugins
  enforcesExpiry: false,      // no expiry is documented or settable
  refund: false,              // merchant refunds happen in the Paynow dashboard (forum staff, F/497, F/3820)
  partialRefund: false,
  disputeApi: false,
  currencyField: false,       // one integration ID per currency
});

export const PAY05_LABELS = Object.freeze({
  paynowChannel: 'Paid through the garage’s own Paynow account. The money goes to the garage, not to CarUp.',
  simulated: 'Simulated Paynow — local test environment. No real money moves.',
  waiting: 'Waiting for Paynow. Nothing is counted until Paynow confirms the payment.',
  escrow: 'Paid to Paynow and held by Paynow until it is released to the garage. Not yet counted on the invoice.',
  disputed: 'Disputed with Paynow. The money is held while the dispute is resolved and is not counted.',
  refunded: 'Paynow reports this payment refunded to the customer.',
  cannotCancel: 'Paynow cannot cancel a payment request. If you do not complete it, nothing is charged; if you do pay it, it still counts.',
  refundsInPaynow: 'Paynow does not let CarUp refund. Refund the customer in your Paynow dashboard; CarUp records it when Paynow reports it.',
  noRedirectProof: 'Coming back from Paynow is not proof of payment. CarUp checks with Paynow.',
});

export function isPay05Enabled(env = process.env) {
  return env.CARUP_PAY05_ENABLED === 'true' && isPay04Enabled(env) && !isPay04ProductionRuntime(env);
}

export function requirePay05Enabled(env = process.env) {
  if (!isPay05Enabled(env)) throw new Pay05Error('PAY05_DISABLED', 404);
}

const NOT_FOUND = /(_NOT_FOUND|_NOT_ATTACHED)$/;
const FORBIDDEN = /(AUTHORITY_REFUSED|SEPARATION_REQUIRED|SELF_DEALING_REFUSED|ADMIN_REQUIRED|PAYER_NOT_CUSTOMER|PAYER_IS_GARAGE_MEMBER)$/;
const UNAVAILABLE = /(DISABLED|NOT_PERMITTED|UNAVAILABLE|NOT_AUTHORIZED|SIMULATOR_REFUSED|ORIGIN_INVALID|KEK_UNAVAILABLE|KEK_VERSION_MISMATCH|PROVIDER_AUTHORITY_PENDING|MERCHANT_NOT_AVAILABLE)$/;
const VALIDATION = /(_INVALID|_REQUIRED|_MISMATCH|NOT_SUPPORTED|NOT_AVAILABLE|DUPLICATE_CURRENCY|EXCEEDS_CURRENCY_PRECISION|TOO_MANY_LINES)$/;
/** Constraint names that carry a meaning the API can state. */
const CONSTRAINTS = Object.freeze({
  pay05_innbucks_usd_only: 'PAY05_METHOD_NOT_AVAILABLE',
  pay05_merchant_gateway: 'PAY05_GATEWAY_NOT_PERMITTED',
});

/** Map a database or service refusal to an HTTP-shaped Pay05Error. Unknown failures never leak details. */
export function pay05Failure(error, fallback = 'PAY05_OPERATION_UNAVAILABLE') {
  if (error instanceof Pay04Error) return error;
  const message = String(error?.message || '');
  for (const [constraint, code] of Object.entries(CONSTRAINTS)) {
    if (message.includes(constraint)) return new Pay05Error(code, code.endsWith('NOT_PERMITTED') ? 503 : 422);
  }
  const token = (/\b(PAY05_[A-Z0-9_]+|PAY04_[A-Z0-9_]+|PAY03B_[A-Z0-9_]+|PAY01A_[A-Z0-9_]+|GARAGE_OPS0[0-9]_[A-Z0-9_]+)\b/.exec(message) || [])[1];
  if (!token) return new Pay05Error(fallback, 503);
  const detail = String(error?.details ?? error?.detail ?? '');
  const details = /^[a-z_=0-9.:-]{1,60}$/.test(detail) ? { detail } : null;
  if (FORBIDDEN.test(token)) return new Pay05Error(token, 403, details);
  if (NOT_FOUND.test(token)) return new Pay05Error(token, 404, details);
  if (UNAVAILABLE.test(token)) return new Pay05Error(token, 503, details);
  if (VALIDATION.test(token)) return new Pay05Error(token, 422, details);
  return new Pay05Error(token, 409, details);
}
