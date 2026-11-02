/**
 * Billing provider base types.
 *
 * Extracted from billingProvider.js so the adapters, the transport and the provider factory can share
 * the base class without an import cycle (factory -> adapter -> base, never adapter -> factory).
 * billingProvider.js re-exports both symbols, so every existing import path is unchanged.
 */

import { CarUpError } from '../../../utils/errors.js';

/**
 * The HTTP contract of every billing failure (OC-5R-PROV-01 C2). BillingProviderError used to be a
 * plain Error with no status, so the error middleware answered EVERY billing failure — a missing
 * tenantId, an unapproved provider on a deployment, a provider outage — as an untyped 500 that a
 * client, a retry policy and 5xx alerting cannot tell apart from a crash. Each code now carries a
 * deterministic status: the caller's mistake is 4xx, a provider CarUp does not run is 503, a
 * provider that answered badly is 502. A code without an entry is a provider failure (502).
 */
export const BILLING_ERROR_STATUS = Object.freeze({
  INVALID_INPUT: 400,
  RAW_BODY_REQUIRED: 400,
  EXTERNAL_ACTIVATION_REQUIRED: 503,
  PROVIDER_CAPABILITY_UNSUPPORTED: 503,
  TRANSPORT_UNAVAILABLE: 503,
  TRANSPORT_NOT_IMPLEMENTED: 503,
  TRANSPORT_ROUTE_MISSING: 503,
  TRANSPORT_INSECURE_URL: 503,
  TRANSPORT_FORBIDDEN_IN_TEST: 503,
  PROVIDER_REQUEST_REJECTED: 502,
  TRANSPORT_REQUEST_FAILED: 502,
});

export class BillingProviderError extends CarUpError {
  constructor(message, code = 'BILLING_PROVIDER_ERROR') {
    // Sanitized message only — never include secrets, signatures, or raw provider stack traces.
    super(message, BILLING_ERROR_STATUS[code] || 502, code);
    this.name = 'BillingProviderError';
  }
}

/**
 * The capability surface every provider implements. Methods take and return CarUp-shaped objects; no
 * provider vocabulary crosses this boundary (ADR-001 §5).
 */
export class BillingProvider {
  get name() { return 'base'; }
  // eslint-disable-next-line no-unused-vars
  async createCheckoutSession(_input) { throw new BillingProviderError('not implemented'); }
  // eslint-disable-next-line no-unused-vars
  async createPortalSession(_input) { throw new BillingProviderError('not implemented'); }
  // eslint-disable-next-line no-unused-vars
  async syncSubscription(_input) { throw new BillingProviderError('not implemented'); }
  // eslint-disable-next-line no-unused-vars
  async verifyWebhook(_input) { throw new BillingProviderError('not implemented'); }
  // eslint-disable-next-line no-unused-vars
  async getInvoiceState(_input) { throw new BillingProviderError('not implemented'); }
  // eslint-disable-next-line no-unused-vars
  async cancelSubscription(_input) { throw new BillingProviderError('not implemented'); }
  // eslint-disable-next-line no-unused-vars
  async changePlan(_input) { throw new BillingProviderError('not implemented'); }
  // eslint-disable-next-line no-unused-vars
  async handleTrial(_input) { throw new BillingProviderError('not implemented'); }

  /**
   * Authoritative provider-side state for a tenant's subscription, used by reconciliation. Distinct
   * from syncSubscription(), which may create/refresh state: getSubscription() is a pure read, so a
   * reconciliation run can never itself mutate the thing it is auditing.
   */
  // eslint-disable-next-line no-unused-vars
  async getSubscription(_input) { throw new BillingProviderError('not implemented'); }
}
