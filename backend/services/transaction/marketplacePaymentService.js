import crypto from 'node:crypto';
import { supabase } from '../../db/supabase.js';
import { ConflictError, ForbiddenError, ValidationError } from '../../utils/errors.js';
import { evaluateEscrowGates, getSession } from '../escrow/escrowTrustService.js';
import { recomputeMarketplaceEscrowGateContext } from './marketplaceTransactionAuthority.js';
import { SAFETRADE_PROVIDER_STATES } from '../diaspora/safetrade/safeTradePaymentProvider.js';
import { assertPaymentProviderCapability } from '../diaspora/safetrade/safeTradePaymentCapabilities.js';
import { selectMarketplacePaymentProvider } from './marketplacePaymentProviderSelector.js';

/**
 * Issue #164 Phase 6A/6B bridge.
 *
 * Marketplace owns the transaction and its server-derived deposit policy. SafeTrade owns the
 * provider abstraction. This module translates between them; it does not invent a second provider
 * contract and it never writes money truth from a browser payload.
 */
export const MARKETPLACE_DEPOSIT_POLICY = Object.freeze({
  version: 'marketplace-deposit-1.0.0',
  amountByCurrency: Object.freeze({ USD: 500 }),
});

function actorId(actor) {
  return String(actor?.id || actor?.userId || '').trim() || null;
}

function actorRole(actor) {
  return String(actor?.effectiveRole || actor?.role || '').trim().toLowerCase() || null;
}

function paymentIdempotencyKey(sessionId, policyVersion) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({ contract: 'marketplace-payment-intent-v1', sessionId, policyVersion }))
    .digest('hex');
}

function reconciliationKey(sessionId, provider, intentId, normalizedStatus, discriminator = '') {
  return crypto.createHash('sha256')
    .update(JSON.stringify({
      contract: 'marketplace-payment-reconciliation-v1',
      sessionId,
      provider,
      intentId,
      normalizedStatus,
      discriminator,
    }))
    .digest('hex');
}

function providerMode(provider, result = {}) {
  if (result.live === true) return 'live';
  if (String(provider?.name || result.provider || '').toLowerCase() === 'sandbox') return 'sandbox';
  return 'test';
}

/**
 * No external provider inherits a geographic/payment-method assumption from the sandbox. The only
 * currently callable adapter is the synthetic sandbox; future adapters must supply their proven
 * country/currency/method/legal context as part of their integration rather than falling through.
 */
function currentProviderCapabilityContext(provider, currency) {
  const key = String(provider?.name || '').toLowerCase();
  if (key === 'sandbox') {
    return { testMode: true, currency, method: 'sandbox' };
  }
  return { testMode: false, currency, country: null, method: null };
}

function requireCapability(provider, capability, currency) {
  try {
    return assertPaymentProviderCapability(
      provider?.name,
      capability,
      currentProviderCapabilityContext(provider, currency),
    );
  } catch (error) {
    throw new ConflictError(error.message);
  }
}

async function loadActiveReservation(session, client = supabase) {
  const { data, error } = await client
    .from('vehicle_reservations')
    .select('id, vin, transaction_intent_id, inquiry_id, buyer_id, seller_id, status, reserved_at, expires_at')
    .eq('transaction_intent_id', session.id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export function evaluateMarketplaceDepositPolicy({ session = {}, reservation = null, gateContext = {}, now = new Date() } = {}) {
  const reasons = [];
  const gate = evaluateEscrowGates(gateContext);
  if (!gate.allowed) reasons.push(...gate.reasons.map((reason) => `transaction_gate:${reason}`));

  if (!reservation || reservation.status !== 'active') {
    reasons.push('active_reservation_required');
  } else {
    if (reservation.transaction_intent_id !== session.id) reasons.push('reservation_transaction_mismatch');
    if (reservation.buyer_id !== session.buyer_id) reasons.push('reservation_buyer_mismatch');
    if (reservation.seller_id !== session.seller_id) reasons.push('reservation_seller_mismatch');
    if (reservation.inquiry_id !== session.inquiry_id) reasons.push('reservation_inquiry_mismatch');
    const expiry = Date.parse(reservation.expires_at || '');
    if (!Number.isFinite(expiry) || expiry <= now.getTime()) reasons.push('reservation_expired');
  }

  const currency = String(session.listing_currency || '').trim().toUpperCase();
  const configuredAmount = MARKETPLACE_DEPOSIT_POLICY.amountByCurrency[currency];
  if (!configuredAmount) reasons.push('deposit_currency_unsupported');
  const listingAmount = Number(session.listing_amount);
  if (!Number.isFinite(listingAmount) || listingAmount <= 0) reasons.push('listing_amount_unavailable');
  if (configuredAmount && Number.isFinite(listingAmount) && listingAmount < configuredAmount) {
    reasons.push('listing_amount_below_deposit_policy');
  }

  return {
    eligible: reasons.length === 0,
    amount: reasons.length === 0 ? configuredAmount : null,
    currency: reasons.length === 0 ? currency : null,
    policyVersion: MARKETPLACE_DEPOSIT_POLICY.version,
    reasons,
  };
}

/**
 * Recompute all transaction gates, then persist deposit eligibility through the atomic DB function.
 * The fixed USD 500 value is not a frontend literal any more: it is a versioned server policy and
 * unsupported currencies fail closed rather than being silently converted.
 */
export async function evaluateMarketplaceDepositEligibility(sessionId, {
  actor,
  client = supabase,
  now = new Date(),
} = {}) {
  const id = actorId(actor);
  if (!id) throw new ForbiddenError('Authenticated buyer required.');
  const session = await getSession(sessionId, actor, client);
  if (!session) throw new ValidationError('Transaction intent not found.');
  if (session.buyer_id !== id) throw new ForbiddenError('Only the transaction buyer may request deposit eligibility.');

  const recomputed = await recomputeMarketplaceEscrowGateContext(session, { actor, client });
  const reservation = await loadActiveReservation(session, client);
  const verdict = evaluateMarketplaceDepositPolicy({
    session,
    reservation,
    gateContext: recomputed.gateContext,
    now,
  });

  const { data, error } = await client.rpc('issue164_set_deposit_eligibility_atomic', {
    p_session_id: session.id,
    p_actor_id: id,
    p_eligibility: verdict.eligible ? 'eligible' : 'ineligible',
    p_amount: verdict.amount,
    p_currency: verdict.currency,
    p_policy_version: verdict.eligible ? verdict.policyVersion : null,
    p_reasons: verdict.reasons,
  });
  if (error) throw new ConflictError(`Deposit eligibility could not be recorded: ${error.message}`);

  return {
    transactionIntentId: session.id,
    eligibility: verdict.eligible ? 'eligible' : 'ineligible',
    amount: verdict.amount,
    currency: verdict.currency,
    policyVersion: verdict.policyVersion,
    reasons: verdict.reasons,
    session: data || null,
  };
}

/**
 * Create a provider intent only after a fresh deposit-eligibility evaluation. Provider selection
 * remains SafeTrade-owned; Marketplace replaces only SafeTrade's process-local synthetic provider
 * with its durable test/staging adapter. The browser cannot choose provider, amount, currency, payer
 * or payee.
 */
export async function createMarketplacePaymentIntent(sessionId, {
  actor,
  client = supabase,
  paymentProvider = null,
} = {}) {
  const id = actorId(actor);
  if (!id) throw new ForbiddenError('Authenticated buyer required.');

  const eligibility = await evaluateMarketplaceDepositEligibility(sessionId, { actor, client });
  if (eligibility.eligibility !== 'eligible') {
    throw new ConflictError(`Deposit is not eligible: ${eligibility.reasons.join(',') || 'unknown reason'}`);
  }

  const session = await getSession(sessionId, actor, client);
  if (!session) throw new ValidationError('Transaction intent not found.');
  if (session.payment_intent_id) {
    return {
      transactionIntentId: session.id,
      provider: session.payment_provider,
      providerMode: session.payment_provider_mode,
      paymentIntentId: session.payment_intent_id,
      paymentState: session.payment_state,
      idempotentReplay: true,
      live: session.payment_provider_mode === 'live',
    };
  }

  const provider = selectMarketplacePaymentProvider({ paymentProvider, client });
  requireCapability(provider, 'collect_payment', eligibility.currency);
  const idempotencyKey = paymentIdempotencyKey(session.id, eligibility.policyVersion);
  const result = await provider.createPaymentIntent({
    milestoneId: session.id,
    tenantId: session.tenant_id || null,
    amount: eligibility.amount,
    currency: eligibility.currency,
    payer: session.buyer_id,
    payee: session.seller_id,
    idempotencyKey,
  });
  if (!result?.intentId || !result?.status) {
    throw new ConflictError('Payment provider returned no attributable payment intent.');
  }

  const mode = providerMode(provider, result);
  const { data, error } = await client.rpc('issue164_link_payment_intent_atomic', {
    p_session_id: session.id,
    p_actor_id: id,
    p_provider: result.provider || provider.name,
    p_provider_mode: mode,
    p_intent_id: result.intentId,
    p_payment_state: result.status,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw new ConflictError(`Payment intent could not be linked: ${error.message}`);

  return {
    transactionIntentId: session.id,
    provider: result.provider || provider.name,
    providerMode: mode,
    paymentIntentId: result.intentId,
    paymentState: result.status,
    idempotentReplay: Boolean(result.idempotentReplay),
    live: result.live === true,
    session: data || null,
  };
}

async function persistProviderState(session, normalizedStatus, {
  client,
  provider,
  providerEventId = null,
  discriminator = '',
  payload = {},
} = {}) {
  const idempotencyKey = reconciliationKey(
    session.id,
    provider,
    session.payment_intent_id,
    normalizedStatus,
    discriminator,
  );
  const { data, error } = await client.rpc('issue164_record_payment_state_atomic', {
    p_session_id: session.id,
    p_provider: provider,
    p_intent_id: session.payment_intent_id,
    p_normalized_status: normalizedStatus,
    p_provider_event_id: providerEventId,
    p_idempotency_key: idempotencyKey,
    p_payload: payload,
  });
  if (error) throw new ConflictError(`Provider state could not be reconciled: ${error.message}`);
  return data;
}

/** Poll/reconcile provider state. Useful for providers whose webhook is delayed or optional. */
export async function reconcileMarketplacePayment(sessionId, {
  actor,
  client = supabase,
  paymentProvider = null,
} = {}) {
  const session = await getSession(sessionId, actor, client);
  if (!session) throw new ValidationError('Transaction intent not found.');
  if (!session.payment_intent_id || !session.payment_provider) {
    throw new ConflictError('Transaction has no linked payment intent.');
  }

  const provider = selectMarketplacePaymentProvider({ paymentProvider, client });
  if (provider.name !== session.payment_provider) {
    throw new ConflictError('Selected provider does not match the transaction payment intent.');
  }
  requireCapability(provider, 'retrieve_status', session.deposit_currency || session.listing_currency);
  const result = await provider.retrieveStatus({ intentId: session.payment_intent_id });
  await persistProviderState(session, result.status || 'unknown', {
    client,
    provider: session.payment_provider,
    discriminator: result.status || 'unknown',
    payload: { source: 'status_poll', live: result.live === true },
  });
  return {
    transactionIntentId: session.id,
    provider: session.payment_provider,
    paymentState: result.status || 'unknown',
    live: result.live === true,
  };
}

/**
 * Test/UAT helper: drive the durable SafeTrade sandbox through authorization and capture, then
 * reconcile the canonical transaction to `funds_held`. The HTTP route exposing this helper is
 * separately runtime-gated to test/development/preview/staging and never becomes a production money
 * action.
 */
export async function captureMarketplaceSandboxDeposit(sessionId, {
  actor,
  client = supabase,
  paymentProvider = null,
} = {}) {
  const session = await getSession(sessionId, actor, client);
  if (!session?.payment_intent_id) throw new ConflictError('Create the payment intent first.');
  const provider = selectMarketplacePaymentProvider({ paymentProvider, client });
  if (provider.name !== session.payment_provider || provider.name !== 'sandbox') {
    throw new ConflictError('Sandbox capture is available only for the canonical sandbox provider.');
  }

  requireCapability(provider, 'authorize_hold', session.deposit_currency || session.listing_currency);
  const authorize = await provider.authorizeHold({
    intentId: session.payment_intent_id,
    idempotencyKey: `${session.payment_idempotency_key}:authorize`,
  });
  if (authorize.status !== SAFETRADE_PROVIDER_STATES.AUTHORIZED) {
    throw new ConflictError('Sandbox provider did not authorize the deposit hold.');
  }

  requireCapability(provider, 'capture', session.deposit_currency || session.listing_currency);
  const captured = await provider.captureRelease({
    intentId: session.payment_intent_id,
    amount: session.deposit_amount,
    idempotencyKey: `${session.payment_idempotency_key}:capture`,
  });
  if (captured.status !== SAFETRADE_PROVIDER_STATES.CAPTURED) {
    throw new ConflictError('Sandbox provider did not capture the deposit.');
  }
  await persistProviderState(session, captured.status, {
    client,
    provider: session.payment_provider,
    discriminator: captured.captureRef || 'capture',
    payload: { source: 'sandbox_test_capture', live: false },
  });
  return {
    transactionIntentId: session.id,
    paymentState: captured.status,
    live: false,
  };
}

/**
 * Reviewer/admin release after the canonical transaction reached release_approved.
 *
 * The settlement operation is claimed atomically in PostgreSQL BEFORE provider release. That claim
 * freezes conflicting human state changes and snapshots the approved seller/payment lineage. If a
 * provider call is ambiguous, retries use the same idempotency key and the transaction remains
 * settlement-claimed rather than reopening a dispute path. Provider `released` is then reconciled
 * against the durable claim, so CarUp cannot lose money truth because mutable seller state changed
 * after the payout request was sent.
 */
export async function releaseMarketplacePayment(sessionId, {
  actor,
  client = supabase,
  paymentProvider = null,
} = {}) {
  const session = await getSession(sessionId, actor, client);
  if (!session) throw new ValidationError('Transaction intent not found.');
  if (session.status !== 'release_approved') {
    throw new ConflictError('Transaction must be release-approved before provider settlement.');
  }
  if (!session.payment_idempotency_key || !session.payment_intent_id || !session.payment_provider) {
    throw new ConflictError('Transaction has no attributable captured payment intent.');
  }

  const provider = selectMarketplacePaymentProvider({ paymentProvider, client });
  if (provider.name !== session.payment_provider) throw new ConflictError('Payment provider mismatch.');
  requireCapability(provider, 'delayed_release', session.deposit_currency || session.listing_currency);
  requireCapability(provider, 'payout_to_seller', session.deposit_currency || session.listing_currency);
  if (typeof provider.release !== 'function') throw new ConflictError('Payment provider does not support release.');

  const id = actorId(actor);
  const role = actorRole(actor);
  if (!id || !role) throw new ForbiddenError('Reviewer/admin identity is required for settlement.');
  const releaseKey = `${session.payment_idempotency_key}:release`;
  const { data: claimed, error: claimError } = await client.rpc('issue164_begin_settlement_atomic', {
    p_session_id: session.id,
    p_actor_id: id,
    p_actor_role: role,
    p_operation_key: releaseKey,
  });
  if (claimError) throw new ConflictError(`Settlement could not be claimed: ${claimError.message}`);
  const claimedSession = Array.isArray(claimed) ? claimed[0] : claimed;
  if (!claimedSession?.settlement_operation_key) {
    throw new ConflictError('Settlement claim returned no durable operation identity.');
  }

  const released = await provider.release({
    intentId: claimedSession.settlement_payment_intent_id || session.payment_intent_id,
    idempotencyKey: releaseKey,
    approval: { actorId: id },
  });
  if (released.status !== SAFETRADE_PROVIDER_STATES.RELEASED) {
    throw new ConflictError('Provider did not confirm settlement release.');
  }
  await persistProviderState(claimedSession, released.status, {
    client,
    provider: session.payment_provider,
    discriminator: released.releaseRef || 'release',
    payload: {
      source: 'governed_release',
      live: released.live === true,
      settlementOperationKey: claimedSession.settlement_operation_key,
    },
  });
  return { transactionIntentId: session.id, paymentState: released.status, live: released.live === true };
}

/** Provider-backed refund. The canonical DB function releases the reservation/listing cache. */
export async function refundMarketplacePayment(sessionId, {
  actor,
  client = supabase,
  paymentProvider = null,
} = {}) {
  const session = await getSession(sessionId, actor, client);
  if (!session) throw new ValidationError('Transaction intent not found.');
  if (session.settlement_operation_key) {
    throw new ConflictError('Settlement is already claimed; reconcile provider release before any refund action.');
  }
  if (!['funds_held', 'inspection_pending', 'release_approved', 'disputed'].includes(session.status)) {
    throw new ConflictError(`Transaction cannot be refunded from ${session.status}.`);
  }
  const provider = selectMarketplacePaymentProvider({ paymentProvider, client });
  if (provider.name !== session.payment_provider) throw new ConflictError('Payment provider mismatch.');
  requireCapability(provider, 'refund', session.deposit_currency || session.listing_currency);
  const refunded = await provider.refund({
    intentId: session.payment_intent_id,
    idempotencyKey: `${session.payment_idempotency_key}:refund`,
  });
  if (refunded.status !== SAFETRADE_PROVIDER_STATES.REFUNDED) {
    throw new ConflictError('Payment provider did not confirm refund.');
  }
  await persistProviderState(session, refunded.status, {
    client,
    provider: session.payment_provider,
    discriminator: refunded.refundRef || 'refund',
    payload: { source: 'governed_refund', live: refunded.live === true },
  });
  return { transactionIntentId: session.id, paymentState: refunded.status, live: refunded.live === true };
}

export default {
  MARKETPLACE_DEPOSIT_POLICY,
  evaluateMarketplaceDepositPolicy,
  evaluateMarketplaceDepositEligibility,
  createMarketplacePaymentIntent,
  reconcileMarketplacePayment,
  captureMarketplaceSandboxDeposit,
  releaseMarketplacePayment,
  refundMarketplacePayment,
};
