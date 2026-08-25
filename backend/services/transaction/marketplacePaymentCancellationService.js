import { supabase } from '../../db/supabase.js';
import { ConflictError, ValidationError } from '../../utils/errors.js';
import { getSession } from '../escrow/escrowTrustService.js';
import { SAFETRADE_PROVIDER_STATES } from '../diaspora/safetrade/safeTradePaymentProvider.js';
import { assertPaymentProviderCapability } from '../diaspora/safetrade/safeTradePaymentCapabilities.js';
import { reconcileMarketplacePayment } from './marketplacePaymentService.js';
import { selectMarketplacePaymentProvider } from './marketplacePaymentProviderSelector.js';

function requireCancelCapability(provider, session) {
  try {
    assertPaymentProviderCapability(provider?.name, 'cancel', {
      testMode: provider?.name === 'sandbox',
      currency: session.deposit_currency || session.listing_currency,
      method: provider?.name === 'sandbox' ? 'sandbox' : null,
      country: null,
    });
  } catch (error) {
    throw new ConflictError(error.message);
  }
}

/**
 * Issue #164 Phase 6 — cancel a provider-linked transaction through the SAME PaymentProvider that
 * owns its provider intent. A participant requests cancellation; no participant submits the target
 * transaction/payment state. The provider confirms `cancelled`, then the canonical reconciliation
 * RPC closes transaction + reservation/cache atomically.
 */
export async function cancelMarketplacePayment(sessionId, {
  actor,
  client = supabase,
  paymentProvider = null,
} = {}) {
  const session = await getSession(sessionId, actor, client);
  if (!session) throw new ValidationError('Transaction intent not found.');
  if (!session.payment_intent_id || !session.payment_provider || !session.payment_idempotency_key) {
    throw new ConflictError('Transaction has no linked provider intent to cancel.');
  }
  if (session.status !== 'initiated') {
    throw new ConflictError(`Provider-linked transaction cannot be cancelled from ${session.status}.`);
  }

  const provider = selectMarketplacePaymentProvider({ paymentProvider, client });
  if (provider.name !== session.payment_provider) {
    throw new ConflictError('Selected provider does not match the transaction payment intent.');
  }
  requireCancelCapability(provider, session);
  if (typeof provider.cancel !== 'function') {
    throw new ConflictError('Payment provider does not support cancellation.');
  }

  const cancelled = await provider.cancel({
    intentId: session.payment_intent_id,
    idempotencyKey: `${session.payment_idempotency_key}:cancel`,
  });
  if (cancelled.status !== SAFETRADE_PROVIDER_STATES.CANCELLED) {
    throw new ConflictError('Payment provider did not confirm cancellation.');
  }

  // Re-use the canonical provider status reconciliation path rather than duplicating its
  // idempotency/audit/RPC mapping in a second service.
  const reconciled = await reconcileMarketplacePayment(sessionId, {
    actor,
    client,
    paymentProvider: provider,
  });
  if (reconciled.paymentState !== SAFETRADE_PROVIDER_STATES.CANCELLED) {
    throw new ConflictError('Cancelled provider intent did not reconcile as cancelled.');
  }
  return reconciled;
}

export default { cancelMarketplacePayment };
