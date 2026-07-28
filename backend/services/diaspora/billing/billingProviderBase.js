/**
 * Billing provider base types.
 *
 * Extracted from billingProvider.js so the adapters, the transport and the provider factory can share
 * the base class without an import cycle (factory -> adapter -> base, never adapter -> factory).
 * billingProvider.js re-exports both symbols, so every existing import path is unchanged.
 */

export class BillingProviderError extends Error {
  constructor(message, code = 'BILLING_PROVIDER_ERROR') {
    // Sanitized message only — never include secrets, signatures, or raw provider stack traces.
    super(message);
    this.name = 'BillingProviderError';
    this.code = code;
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
