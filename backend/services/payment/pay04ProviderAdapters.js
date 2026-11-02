/**
 * CARUP-PAY-04-LR01 — the garage payment-provider ADAPTER INTERFACE and its registry.
 *
 * A garage collects into ITS OWN merchant account. An adapter therefore always acts for one registered garage
 * merchant (pay04_garage_merchant_accounts) and never for CarUp. Every adapter implements:
 *
 *   createCheckout({ collectionId, merchantReference, amountMinor, currency, successUrl, cancelUrl, expiresAt })
 *        -> { checkoutId, paymentId, url }            idempotent per collectionId; the checkout MUST take no money
 *                                                      after expiresAt (CarUp's own collection expiry)
 *   cancelCheckout(checkoutId)                     -> { status, events }   status 'complete' = the provider had already
 *                                                      taken the money (never undone here); anything else = closed unpaid.
 *                                                      Throws when the provider cannot be reached (CarUp then changes nothing)
 *   refund({ paymentId, amountMinor, idempotencyKey }) -> { refundId, status, events }   full refund only (policy); one
 *                                                      idempotency key per refund REQUEST, so a refused one can be retried
 *   getPaymentTruth({ paymentId })                 -> { status, amountMinor, currency, merchantReference,
 *                                                       refundedMinor, pendingRefundMinor, refundIds, mismatch, refundId }
 *   verifyWebhook({ rawBody, signature })          -> event                (signature + replay window + shape)
 *
 * Money truth is ALWAYS a fresh getPaymentTruth() read applied through the single governed database writer
 * (pay04_apply_garage_provider_snapshot). A browser redirect or an unverified webhook body is never payment authority.
 *
 * Registered gateways (Level 1):
 *   pay04_garage_provider_simulator   local simulator, disposable environments only (pay04GarageSimulator.js)
 * Candidates that are NOT callable — each needs the garage's merchant contract, provider credentials, Owner approval
 * and a migration that admits its gateway value; until then every call refuses:
 *   paynow_zimbabwe                   Zimbabwe card / mobile-money aggregator (PAY-05 candidate)
 */
import { Pay04Error, PAY04_SIMULATOR_GATEWAY } from './pay04Contract.js';
import { Pay04GarageSimulatorProvider } from './pay04GarageSimulator.js';

export const PAY04_PROVIDER_CANDIDATES = Object.freeze([
  Object.freeze({
    gateway: 'paynow_zimbabwe',
    status: 'authority_pending',
    callable: false,
    requires: Object.freeze(['garage merchant contract with the provider', 'provider integration credentials held by CarUp',
      'Owner authorization', 'a migration admitting the gateway value', 'PAY-05 provider certification']),
  }),
]);

/** The refusing shape of every candidate adapter: callable only after its authority exists. */
export class Pay04PendingAuthorityAdapter {
  constructor(gateway) { this.gateway = gateway; }
  refuse() { throw new Pay04Error('PAY04_PROVIDER_AUTHORITY_PENDING', 503, { gateway: this.gateway }); }
  async createCheckout() { return this.refuse(); }
  async cancelCheckout() { return this.refuse(); }
  async refund() { return this.refuse(); }
  async getPaymentTruth() { return this.refuse(); }
  verifyWebhook() { return this.refuse(); }
}

/**
 * The adapter for a merchant's gateway. `provider` (tests and the UAT runtime) injects an instance; otherwise the
 * simulator is built from the environment, which refuses outside a disposable, non-production runtime.
 */
export function pay04AdapterFor(gateway, { env = process.env, provider = null } = {}) {
  if (gateway === PAY04_SIMULATOR_GATEWAY) {
    if (provider) {
      if (provider.gateway !== PAY04_SIMULATOR_GATEWAY) throw new Pay04Error('PAY04_PROVIDER_GATEWAY_MISMATCH', 503);
      return provider;
    }
    return new Pay04GarageSimulatorProvider({ env });
  }
  if (PAY04_PROVIDER_CANDIDATES.some((c) => c.gateway === gateway)) return new Pay04PendingAuthorityAdapter(gateway);
  throw new Pay04Error('PAY04_GATEWAY_NOT_PERMITTED', 503);
}
