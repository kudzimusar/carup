import { supabase } from '../../db/supabase.js';
import { ConflictError, ForbiddenError, ValidationError } from '../../utils/errors.js';
import { getSession } from '../escrow/escrowTrustService.js';
import { selectMarketplacePaymentProvider } from './marketplacePaymentProviderSelector.js';
import { reconcileMarketplacePayment } from './marketplacePaymentService.js';

function actorId(actor) {
  return String(actor?.id || actor?.userId || '').trim() || null;
}

function actorRole(actor) {
  return String(actor?.effectiveRole || actor?.role || '').trim().toLowerCase() || null;
}

const RECOVERY_ROLES = new Set(['admin', 'platform_admin', 'super_admin', 'reviewer']);

/**
 * Recover a pending settlement claim only after the bound provider gives strong negative evidence
 * that release did NOT happen.
 *
 * Before asking the provider, CarUp records a durable recovery fence on the canonical transaction.
 * Release retries must honor that fence, so the provider observation cannot be invalidated by a
 * concurrent retry in the gap between confirmation and the recovery write.
 *
 * No browser/provider status is accepted. The adapter itself must implement `confirmNotReleased()`;
 * absence of that stronger provider semantic fails closed. Generic `retrieveStatus()` is not enough
 * for an external adapter because a stale/eventually-consistent read could incorrectly reopen a
 * payout that is still in flight.
 */
export async function recoverMarketplaceSettlement(sessionId, {
  actor,
  client = supabase,
  paymentProvider = null,
} = {}) {
  const id = actorId(actor);
  const role = actorRole(actor);
  if (!id || !RECOVERY_ROLES.has(role)) {
    throw new ForbiddenError('Reviewer/admin identity is required for settlement recovery.');
  }

  const session = await getSession(sessionId, actor, client);
  if (!session) throw new ValidationError('Transaction intent not found.');
  if (session.status !== 'release_approved') {
    throw new ConflictError('Settlement recovery requires a release-approved transaction.');
  }
  if (!session.settlement_operation_key || !session.payment_intent_id || !session.payment_provider) {
    throw new ConflictError('Transaction has no attributable settlement operation to recover.');
  }
  const operationState = String(session.settlement_operation_state || 'pending').toLowerCase();
  if (operationState === 'recovered') {
    return {
      transactionIntentId: session.id,
      settlementOperationState: 'recovered',
      idempotentReplay: true,
    };
  }
  if (operationState !== 'pending') {
    throw new ConflictError(`Settlement operation cannot be recovered from ${operationState}.`);
  }

  const provider = selectMarketplacePaymentProvider({ paymentProvider, client });
  if (provider.name !== session.payment_provider) {
    throw new ConflictError('Selected provider does not match the settlement payment intent.');
  }
  if (typeof provider.confirmNotReleased !== 'function') {
    throw new ConflictError('Payment provider cannot authoritatively confirm that settlement was not released.');
  }

  // Fence release retries BEFORE observing provider state. Migration 1290 makes this operation
  // durable and makes settlement re-claim fail closed while the fence is active.
  const { data: fencedData, error: fenceError } = await client.rpc('issue164_begin_settlement_recovery_atomic', {
    p_session_id: session.id,
    p_actor_id: id,
    p_actor_role: role,
    p_operation_key: session.settlement_operation_key,
  });
  if (fenceError) throw new ConflictError(`Settlement recovery could not be fenced: ${fenceError.message}`);
  const fencedSession = Array.isArray(fencedData) ? fencedData[0] : fencedData;
  if (!fencedSession?.settlement_recovery_fenced_at
      || fencedSession.settlement_recovery_fence_operation_key !== session.settlement_operation_key
      || fencedSession.settlement_recovery_fence_closed_at) {
    throw new ConflictError('Settlement recovery returned no active durable recovery fence.');
  }

  const confirmation = await provider.confirmNotReleased({
    intentId: fencedSession.payment_intent_id,
    operationKey: fencedSession.settlement_operation_key,
  });
  const providerStatus = String(confirmation?.status || 'unknown').toLowerCase();

  // If the provider says release DID happen, do not recover/abort anything. Reconcile the real money
  // truth immediately through the canonical provider-state path instead.
  if (providerStatus === 'released') {
    const reconciled = await reconcileMarketplacePayment(fencedSession.id, {
      actor,
      client,
      paymentProvider: provider,
    });
    return {
      transactionIntentId: fencedSession.id,
      settlementOperationState: 'completed',
      recovered: false,
      reconciledPaymentState: reconciled.paymentState,
    };
  }

  if (confirmation?.confirmed !== true
      || providerStatus !== 'captured'
      || !String(confirmation?.confirmationRef || '').trim()) {
    throw new ConflictError('Provider did not definitively confirm a captured/not-released settlement state.');
  }

  const { data, error } = await client.rpc('issue164_recover_settlement_atomic', {
    p_session_id: fencedSession.id,
    p_actor_id: id,
    p_actor_role: role,
    p_operation_key: fencedSession.settlement_operation_key,
    p_provider_status: providerStatus,
    p_confirmation_reference: String(confirmation.confirmationRef),
  });
  if (error) throw new ConflictError(`Settlement recovery could not be recorded: ${error.message}`);
  const recovered = Array.isArray(data) ? data[0] : data;
  if (!recovered || recovered.settlement_operation_state !== 'recovered') {
    throw new ConflictError('Settlement recovery returned no durable recovered operation state.');
  }

  return {
    transactionIntentId: fencedSession.id,
    settlementOperationState: 'recovered',
    providerStatus,
    confirmationReference: String(confirmation.confirmationRef),
    recovered: true,
  };
}

export default { recoverMarketplaceSettlement };
