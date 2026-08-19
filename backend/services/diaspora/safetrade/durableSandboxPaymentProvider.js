import { PaymentProvider, PaymentProviderError } from './safeTradePaymentProvider.js';

/**
 * Issue #164 Phase 6 — durable synthetic SafeTrade provider for Marketplace/UAT.
 *
 * The historical SandboxPaymentProvider is intentionally process-local and remains useful for
 * isolated unit tests. Marketplace transactions cannot persist those process-local intent IDs as
 * authority on a serverless runtime, so this adapter implements the SAME PaymentProvider contract
 * against the service-role-only PostgreSQL sandbox ledger created by migration 1260.
 *
 * It is still synthetic (`live:false`), still claims no regulated escrow, and performs no network
 * or real-money operation. The database is durability for TEST provider state, not a second CarUp
 * transaction model: `escrow_trust_sessions` remains the canonical CarUp transaction authority.
 */
export class DurableSandboxPaymentProvider extends PaymentProvider {
  constructor({ client } = {}) {
    super();
    if (!client || typeof client.rpc !== 'function') {
      throw new PaymentProviderError('durable sandbox requires a database client', 'INVALID_INPUT');
    }
    this.client = client;
  }

  get name() { return 'sandbox'; }

  async _action(action, {
    intentId = null,
    transactionIntentId = null,
    idempotencyKey = null,
    amount = null,
    currency = null,
    payer = null,
    payee = null,
    tenantId = null,
  } = {}) {
    const { data, error } = await this.client.rpc('issue164_sandbox_payment_action_atomic', {
      p_action: action,
      p_intent_id: intentId,
      p_transaction_intent_id: transactionIntentId,
      p_idempotency_key: idempotencyKey,
      p_amount: amount,
      p_currency: currency,
      p_payer_id: payer,
      p_payee_id: payee,
      p_tenant_id: tenantId,
    });
    if (error) {
      throw new PaymentProviderError(
        `durable sandbox ${action} failed: ${error.message || 'provider state unavailable'}`,
        'SANDBOX_PROVIDER_STATE_ERROR',
      );
    }
    if (!data || typeof data !== 'object') {
      throw new PaymentProviderError(`durable sandbox ${action} returned no state`, 'MALFORMED_PROVIDER_RESPONSE');
    }
    return { ...data, provider: 'sandbox', live: false };
  }

  async createPaymentIntent({
    milestoneId,
    tenantId = null,
    amount,
    currency = 'USD',
    payer = null,
    payee = null,
    idempotencyKey = null,
  } = {}) {
    return this._action('create', {
      transactionIntentId: milestoneId,
      idempotencyKey,
      amount,
      currency,
      payer,
      payee,
      tenantId,
    });
  }

  async authorizeHold({ intentId, idempotencyKey = null } = {}) {
    return this._action('authorize', { intentId, idempotencyKey });
  }

  async captureRelease({ intentId, amount = null, idempotencyKey = null } = {}) {
    return this._action('capture', { intentId, amount, idempotencyKey });
  }

  async release({ intentId, idempotencyKey = null } = {}) {
    return this._action('release', { intentId, idempotencyKey });
  }

  async refund({ intentId, idempotencyKey = null } = {}) {
    return this._action('refund', { intentId, idempotencyKey });
  }

  async partialRefund({ intentId, amount, idempotencyKey = null } = {}) {
    return this._action('partial_refund', { intentId, amount, idempotencyKey });
  }

  async cancel({ intentId, idempotencyKey = null } = {}) {
    return this._action('cancel', { intentId, idempotencyKey });
  }

  async retrieveStatus({ intentId } = {}) {
    return this._action('retrieve', { intentId });
  }

  /**
   * Strong negative settlement confirmation for the synthetic provider.
   *
   * This is deliberately stronger than a generic `retrieveStatus` call. Because the sandbox's
   * provider state is one PostgreSQL row updated atomically, `captured` is definitive evidence that
   * no release operation has committed for this intent. Other adapters must implement their own
   * equally strong provider-specific confirmation before CarUp may recover a settlement claim.
   */
  async confirmNotReleased({ intentId } = {}) {
    const state = await this.retrieveStatus({ intentId });
    const status = String(state?.status || 'unknown').toLowerCase();
    return {
      confirmed: status === 'captured',
      status,
      confirmationRef: `sandbox-ledger:${intentId}:${status}`,
      live: false,
    };
  }

  /**
   * The synthetic adapter has no external callback transport. A caller must never mistake an
   * unsigned local request for provider truth merely because this adapter is durable.
   */
  async verifyWebhook() {
    return { verified: false, eventId: null, eventType: null, intentId: null, payload: null };
  }

  async reconcileEvent({ event } = {}) {
    return {
      intentId: event?.intentId || event?.intent_id || null,
      normalizedStatus: 'unknown',
      amountDelta: 0,
      terminal: false,
      live: false,
    };
  }
}

export default DurableSandboxPaymentProvider;
