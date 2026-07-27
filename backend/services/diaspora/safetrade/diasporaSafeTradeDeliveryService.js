/**
 * Phase 9 (Stage B) — SafeTrade DELIVERY confirmation service.
 *
 * Owns buyer (or reviewer-override) delivery confirmation over the Phase 9
 * diaspora_safetrade_delivery_confirmations table (connect, don't duplicate):
 *  - confirmDelivery     : record a signed buyer confirmation + signed-proof refs, set the buyer dispute
 *                          window, and write a CRITICAL audit + a CONFIRM_DELIVERY observational flag on
 *                          the transaction metadata. NEVER marks shipment/delivery complete on the order /
 *                          shipment tables; NEVER releases escrow; NEVER writes reputation.
 *  - closeDisputeWindow  : after the dispute window elapses with NO open dispute and NO fraud hold, mark
 *                          the window closed and EMIT a reputation-ELIGIBILITY event ONLY (best-effort
 *                          audit). The existing diasporaReputationService remains the only reputation writer.
 *  - escalateDelivery    : reviewer/admin (or timeout) escalation when the buyer never confirms.
 *  - markFraudHold / clearFraudHold : reviewer/admin fraud-hold toggles that gate eligibility.
 *
 * Non-negotiables (directive §5.2 / N3, N4): delivery is buyer-driven (or reviewer override) and never
 * time-auto-fired into a money move; reputation is an ELIGIBILITY EVENT only (no reputation row is ever
 * written here); gated behind DIASPORA_SAFETRADE_ENABLED. Server-derived roles only.
 *
 * Time handling: `evaluatedAt` / window math use an injected fixed timestamp (req.fixedTimestamp or the
 * `now` arg) when provided so tests never depend on Date.now().
 */
import { resolveClient, requestCorrelationId, appendCriticalAudit } from '../diasporaServiceUtils.js';
// ST-3 item #1 (Issue #127): aux-event shapes shared with the outbox drainer.
import { buildAuxEvent, SAFETRADE_AUX_EVENTS } from './diasporaSafeTradeOutboxService.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../utils/errors.js';
import {
  isSafeTradeEnabled,
  SAFETRADE_POLICY_VERSION,
} from '../../../constants/diaspora/diasporaSafeTradeConstants.js';
import {
  requireUserContext,
  isPlatformAdmin,
  isPlatformReviewer,
  isTenantAdminForRecord,
  normalizeId,
} from '../diasporaAuthorization.js';
import { hasActiveDispute } from './diasporaSafeTradeDisputeService.js';

export const SAFETRADE_DELIVERY_STATUSES = Object.freeze({
  CONFIRMED: 'CONFIRMED',
  DISPUTED: 'DISPUTED',
  ESCALATED: 'ESCALATED',
  SUPERSEDED: 'SUPERSEDED',
});

export const SAFETRADE_DELIVERY_METHODS = Object.freeze({
  BUYER_CONFIRMED: 'BUYER_CONFIRMED',
  REVIEWER_OVERRIDE: 'REVIEWER_OVERRIDE',
  TIMEOUT_ESCALATION: 'TIMEOUT_ESCALATION',
});

// Default buyer dispute window after a delivery confirmation (no money moves at expiry — eligibility only).
const DEFAULT_DISPUTE_WINDOW_HOURS = 72;

async function resolveSafeTradeClient(supabaseOrOptions, options = {}) {
  if (supabaseOrOptions && typeof supabaseOrOptions.from === 'function') return supabaseOrOptions;
  const injected = options.supabaseClient || supabaseOrOptions?.supabaseClient || null;
  return resolveClient(injected ? { supabaseClient: injected } : {});
}

function assertEnabled() {
  if (!isSafeTradeEnabled()) {
    throw new ForbiddenError('SafeTrade is disabled', { code: 'SAFETRADE_DISABLED' });
  }
}

function isPrivileged(context, record = {}) {
  return isPlatformAdmin(context) || isPlatformReviewer(context) || isTenantAdminForRecord(record, context);
}

function nowIso(req, now) {
  return now || req?.fixedTimestamp || new Date().toISOString();
}

function isBuyer(txn, context) {
  const actorId = normalizeId(context.id);
  return normalizeId(txn.buyer_id) === actorId || normalizeId(txn.created_by) === actorId;
}

function deriveConfirmRole(context, txn) {
  if (isPlatformAdmin(context)) return 'ADMIN';
  if (isPlatformReviewer(context)) return 'REVIEWER';
  if (isBuyer(txn, context)) return 'BUYER';
  return 'SYSTEM';
}

async function fetchTransaction(supabase, transactionId) {
  const { data, error } = await supabase
    .from('diaspora_safetrade_transactions')
    .select('*')
    .eq('id', transactionId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error || !data) throw new NotFoundError('SafeTrade transaction not found');
  return data;
}

async function fetchDeliveryConfirmation(supabase, confirmationId) {
  const { data, error } = await supabase
    .from('diaspora_safetrade_delivery_confirmations')
    .select('*')
    .eq('id', confirmationId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error || !data) throw new NotFoundError('SafeTrade delivery confirmation not found');
  return data;
}

/**
 * confirmDelivery — record a buyer (or reviewer-override) delivery confirmation with signed-proof refs.
 *  - Only the buyer (or a reviewer/admin override) may confirm (N3). The client role is never trusted.
 *  - Sets a buyer dispute window (no money moves at expiry — eligibility handling only).
 *  - Sets the CONFIRM_DELIVERY observational flag on the transaction metadata (read by the release policy
 *    as delivery.buyerConfirmed) WITHOUT changing the DB status of record.
 *  - NEVER marks shipment/delivery complete on the order/shipment tables; NEVER releases escrow; NEVER
 *    writes reputation. Idempotent on idempotencyKey (a replay returns the existing confirmation).
 */
export async function confirmDelivery(supabaseOrOptions, {
  transactionId,
  milestoneId = null,
  signedProofRefs = [],
  proofSignature = null,
  disputeWindowHours = DEFAULT_DISPUTE_WINDOW_HOURS,
  reviewerOverride = false,
  idempotencyKey = null,
  now = null,
  userContext = {},
  req = null,
  options = {},
} = {}) {
  assertEnabled();
  const context = requireUserContext(userContext);
  const supabase = await resolveSafeTradeClient(supabaseOrOptions, options);

  const txn = await fetchTransaction(supabase, transactionId);

  const buyer = isBuyer(txn, context);
  const privileged = isPrivileged(context, txn);
  // N3 — buyer confirms; a reviewer/admin may override. Sellers and others cannot confirm delivery.
  if (!buyer && !privileged) {
    throw new ForbiddenError('Only the buyer (or a reviewer/admin override) may confirm delivery', { code: 'BUYER_OR_REVIEWER_REQUIRED' });
  }
  if (reviewerOverride && !privileged) {
    throw new ForbiddenError('Reviewer override requires a reviewer/admin', { code: 'REVIEWER_REQUIRED' });
  }

  // Require at least one signed proof-of-delivery reference (a confirmation must be evidenced).
  const proofs = Array.isArray(signedProofRefs) ? signedProofRefs.filter(Boolean) : [];
  if (proofs.length === 0 && !proofSignature) {
    throw new ValidationError('At least one signed proof-of-delivery reference (or proofSignature) is required');
  }

  // Idempotency: a replay returns the existing confirmation rather than creating a duplicate.
  if (idempotencyKey) {
    const { data: existing } = await supabase
      .from('diaspora_safetrade_delivery_confirmations')
      .select('*')
      .eq('tenant_id', txn.tenant_id ?? context.tenantId ?? null)
      .eq('idempotency_key', idempotencyKey)
      .is('deleted_at', null)
      .maybeSingle();
    if (existing) return { confirmation: existing, idempotentReplay: true };
  }

  const at = nowIso(req, now);
  const windowHours = Number.isFinite(Number(disputeWindowHours)) && Number(disputeWindowHours) >= 0
    ? Number(disputeWindowHours)
    : DEFAULT_DISPUTE_WINDOW_HOURS;
  const windowEndsAt = new Date(Date.parse(at) + windowHours * 3600 * 1000).toISOString();
  const method = (reviewerOverride || (!buyer && privileged))
    ? SAFETRADE_DELIVERY_METHODS.REVIEWER_OVERRIDE
    : SAFETRADE_DELIVERY_METHODS.BUYER_CONFIRMED;

  const { data: confirmation, error } = await supabase
    .from('diaspora_safetrade_delivery_confirmations')
    .insert({
      tenant_id: txn.tenant_id ?? context.tenantId ?? null,
      transaction_id: transactionId,
      milestone_id: milestoneId,
      import_order_id: txn.import_order_id,
      confirmed_by: context.id,
      confirmed_by_role: deriveConfirmRole(context, txn),
      confirmation_method: method,
      status: SAFETRADE_DELIVERY_STATUSES.CONFIRMED,
      signed_proof_refs: proofs,
      proof_signature: proofSignature,
      confirmed_at: at,
      dispute_window_ends_at: windowEndsAt,
      dispute_window_closed: false,
      escalated: false,
      fraud_hold: false,
      reputation_eligibility_emitted: false,
      policy_version: SAFETRADE_POLICY_VERSION,
      idempotency_key: idempotencyKey,
      metadata: { safetrade: { confirmedVia: 'service' } },
      created_by: context.id,
      updated_by: context.id,
    })
    .select()
    .single();
  if (error) throw new ValidationError(`Failed to record delivery confirmation: ${error.message}`);

  // Set the observational CONFIRM_DELIVERY flag on the transaction metadata (read by the release policy
  // as delivery.buyerConfirmed). This does NOT change the DB status of record and does NOT move money.
  const nextMetadata = {
    ...(txn.metadata || {}),
    safetrade: {
      ...(txn.metadata?.safetrade || {}),
      deliveryConfirmed: true,
      deliveryConfirmedAt: at,
      deliveryConfirmationId: confirmation.id,
      lastEvent: 'CONFIRM_DELIVERY',
    },
  };
  await supabase
    .from('diaspora_safetrade_transactions')
    .update({ metadata: nextMetadata, updated_by: context.id })
    .eq('id', transactionId);

  // CRITICAL audit of the delivery confirmation (fail-loud — it is a release-relevant condition).
  await appendCriticalAudit(supabase, {
    importOrderId: txn.import_order_id,
    tenantId: txn.tenant_id,
    actorId: context.id,
    action: 'SAFETRADE_DELIVERY_CONFIRMED',
    resourceType: 'diaspora_safetrade_delivery',
    resourceId: confirmation.id,
    previousState: { deliveryConfirmed: false },
    newState: { deliveryConfirmed: true, method, disputeWindowEndsAt: windowEndsAt },
    metadata: {
      transactionId,
      milestoneId,
      proofCount: proofs.length,
      hasSignature: Boolean(proofSignature),
      correlationId: requestCorrelationId(req),
    },
    req,
  });

  return { confirmation, idempotentReplay: false, disputeWindowEndsAt: windowEndsAt };
}

/**
 * closeDisputeWindow — after the dispute window elapses, if there is NO open dispute and NO fraud hold and
 * the confirming participant is eligible, mark the window closed and EMIT a reputation-ELIGIBILITY event
 * ONLY (best-effort audit). NEVER writes a reputation record; NEVER releases escrow. Returns an explainable
 * envelope describing whether eligibility was emitted and why/why not. Idempotent: a second call after the
 * event was already emitted is a no-op success.
 */
export async function closeDisputeWindow(supabaseOrOptions, {
  confirmationId,
  now = null,
  force = false,
  userContext = {},
  req = null,
  options = {},
} = {}) {
  assertEnabled();
  const context = requireUserContext(userContext);
  const supabase = await resolveSafeTradeClient(supabaseOrOptions, options);

  const confirmation = await fetchDeliveryConfirmation(supabase, confirmationId);
  const txn = await fetchTransaction(supabase, confirmation.transaction_id);
  // Closing the window / emitting eligibility is a reviewer/admin (or scheduled-system) action.
  if (!isPrivileged(context, txn)) {
    throw new ForbiddenError('Only a reviewer/admin may close the dispute window', { code: 'REVIEWER_REQUIRED' });
  }

  const at = nowIso(req, now);

  // Already emitted → idempotent no-op.
  if (confirmation.reputation_eligibility_emitted) {
    return { eligibilityEmitted: true, idempotentReplay: true, reasons: [], confirmation };
  }

  const reasons = [];

  // Gate 1 — the dispute window must have elapsed (unless an explicit privileged force).
  const windowElapsed = confirmation.dispute_window_ends_at
    ? Date.parse(at) >= Date.parse(confirmation.dispute_window_ends_at)
    : true;
  if (!windowElapsed && !force) reasons.push('DISPUTE_WINDOW_OPEN');

  // Gate 2 — no open dispute on the transaction (fails closed if disputes are unreadable).
  const disputeOpen = await hasActiveDispute(supabase, { transactionId: confirmation.transaction_id, options: { supabaseClient: supabase } });
  if (disputeOpen) reasons.push('ACTIVE_DISPUTE');

  // Gate 3 — no fraud/security hold on this confirmation or the transaction.
  const fraudHold = Boolean(confirmation.fraud_hold)
    || Boolean(txn?.metadata?.safetrade?.securityHold)
    || txn.status === 'SUSPENDED';
  if (fraudHold) reasons.push('FRAUD_HOLD');

  // Gate 4 — the confirmation must itself be in a CONFIRMED state (not disputed/superseded).
  if (confirmation.status !== SAFETRADE_DELIVERY_STATUSES.CONFIRMED) reasons.push('CONFIRMATION_NOT_ACTIVE');

  // Gate 5 — participant eligibility: a buyer and seller must both be present on the transaction for a
  // reputation-eligibility signal to make sense (no counterparty → nothing to attribute reputation to).
  if (!txn.buyer_id || !txn.seller_id) reasons.push('PARTICIPANT_INELIGIBLE');

  if (reasons.length > 0) {
    // Close-not-eligible: record the window-close attempt but DO NOT emit eligibility.
    // ST-3 item #1 (Issue #127): the audit row and the downstream event are written by the same
    // transaction as the (no-op) state check, rather than appended best-effort after it.
    await closeDeliveryWindowAtomic(supabase, {
      confirmationId: confirmation.id,
      actorId: context.id,
      emitEligibility: false,
      at,
      auditAction: 'SAFETRADE_DELIVERY_WINDOW_CHECK',
      auditMetadata: { eligibilityEmitted: false, reasons },
      events: [buildAuxEvent(SAFETRADE_AUX_EVENTS.DELIVERY_WINDOW_CHECK_BLOCKED, {
        confirmationId: confirmation.id, reasons, eligible: false,
      })],
      correlationId: requestCorrelationId(req),
    });
    return { eligibilityEmitted: false, idempotentReplay: false, reasons, confirmation };
  }

  // All gates pass → close the window and EMIT a reputation-ELIGIBILITY event ONLY.
  //
  // ST-3 item #1 (Issue #127): the window close, the CRITICAL audit row and the eligibility event are
  // now ONE transaction. The previous shape — UPDATE, then a separate best-effort audit append — could
  // mark a window closed and lose the eligibility signal entirely if the process died in between.
  // The double-emit guard also moved onto the locked row inside the RPC: two concurrent closes used to
  // both read `reputation_eligibility_emitted = false` and both emit.
  const atomic = await closeDeliveryWindowAtomic(supabase, {
    confirmationId: confirmation.id,
    actorId: context.id,
    emitEligibility: true,
    at,
    auditAction: 'SAFETRADE_DELIVERY_WINDOW_CLOSED',
    auditMetadata: { eligibilityEmitted: true, emittedAt: at },
    events: [
      buildAuxEvent(SAFETRADE_AUX_EVENTS.DELIVERY_WINDOW_CLOSED, {
        confirmationId: confirmation.id, emittedAt: at,
      }),
      buildAuxEvent(SAFETRADE_AUX_EVENTS.REPUTATION_ELIGIBLE, {
        confirmationId: confirmation.id, eligible: true, emittedAt: at,
      }),
    ],
    correlationId: requestCorrelationId(req),
  });
  const updated = atomic?.confirmation || confirmation;
  const idempotentReplay = Boolean(atomic?.idempotentReplay);

  return {
    eligibilityEmitted: true,
    idempotentReplay,
    reasons: [],
    confirmation: updated,
    // The event is now the durable outbox row written by the transaction above; the shape is kept for
    // callers that read it, but it is no longer a separate best-effort write.
    eligibilityEvent: { emitted: !idempotentReplay, emittedAt: at },
  };
}


/**
 * closeDeliveryWindowAtomic — ST-3 item #1.
 *
 * One RPC, one transaction: the confirmation state, the CRITICAL audit row and the outbox events
 * commit together. The RPC also owns the double-emit guard, on the locked row, so two concurrent
 * close attempts cannot both emit a reputation-eligibility signal.
 */
async function closeDeliveryWindowAtomic(supabase, {
  confirmationId, actorId, emitEligibility, at = null,
  auditAction, auditMetadata = {}, events = [], correlationId = null,
}) {
  const { data, error } = await supabase.rpc('diaspora_safetrade_close_delivery_window_atomic', {
    p_confirmation_id: confirmationId,
    p_actor_id: actorId,
    p_emit_eligibility: Boolean(emitEligibility),
    p_at: at,
    p_events: events,
    p_audit_action: auditAction,
    p_audit_metadata: auditMetadata,
    p_correlation_id: correlationId,
  });
  if (error) throw new ValidationError(`Failed to close the delivery dispute window: ${error.message}`);
  return data;
}

/**
 * escalateDelivery — reviewer/admin (or timeout) escalation when the buyer never confirms. Records an
 * ESCALATED confirmation row (method TIMEOUT_ESCALATION) for reviewer action. NEVER releases escrow and
 * NEVER auto-confirms delivery on the buyer's behalf.
 */
export async function escalateDelivery(supabaseOrOptions, {
  transactionId,
  milestoneId = null,
  reason = null,
  now = null,
  userContext = {},
  req = null,
  options = {},
} = {}) {
  assertEnabled();
  const context = requireUserContext(userContext);
  const supabase = await resolveSafeTradeClient(supabaseOrOptions, options);

  const txn = await fetchTransaction(supabase, transactionId);
  if (!isPrivileged(context, txn)) {
    throw new ForbiddenError('Only a reviewer/admin may escalate a delivery', { code: 'REVIEWER_REQUIRED' });
  }

  const at = nowIso(req, now);
  const { data: confirmation, error } = await supabase
    .from('diaspora_safetrade_delivery_confirmations')
    .insert({
      tenant_id: txn.tenant_id ?? context.tenantId ?? null,
      transaction_id: transactionId,
      milestone_id: milestoneId,
      import_order_id: txn.import_order_id,
      confirmed_by: context.id,
      confirmed_by_role: deriveConfirmRole(context, txn),
      confirmation_method: SAFETRADE_DELIVERY_METHODS.TIMEOUT_ESCALATION,
      status: SAFETRADE_DELIVERY_STATUSES.ESCALATED,
      signed_proof_refs: [],
      confirmed_at: at,
      escalated: true,
      escalation_reason: reason,
      policy_version: SAFETRADE_POLICY_VERSION,
      metadata: { safetrade: { escalatedVia: 'service' } },
      created_by: context.id,
      updated_by: context.id,
    })
    .select()
    .single();
  if (error) throw new ValidationError(`Failed to escalate delivery: ${error.message}`);

  await appendCriticalAudit(supabase, {
    importOrderId: txn.import_order_id,
    tenantId: txn.tenant_id,
    actorId: context.id,
    action: 'SAFETRADE_DELIVERY_ESCALATED',
    resourceType: 'diaspora_safetrade_delivery',
    resourceId: confirmation.id,
    newState: { status: SAFETRADE_DELIVERY_STATUSES.ESCALATED, reason },
    metadata: { transactionId, milestoneId, correlationId: requestCorrelationId(req) },
    req,
  });

  return { confirmation };
}

/** markFraudHold — reviewer/admin-only: flag a fraud/security hold that gates reputation eligibility. */
export async function markFraudHold(supabaseOrOptions, {
  confirmationId, reason = null, userContext = {}, req = null, options = {},
} = {}) {
  return setFraudHold(supabaseOrOptions, { confirmationId, fraudHold: true, reason, userContext, req, options });
}

/** clearFraudHold — reviewer/admin-only: clear a previously-set fraud/security hold. */
export async function clearFraudHold(supabaseOrOptions, {
  confirmationId, reason = null, userContext = {}, req = null, options = {},
} = {}) {
  return setFraudHold(supabaseOrOptions, { confirmationId, fraudHold: false, reason, userContext, req, options });
}

async function setFraudHold(supabaseOrOptions, { confirmationId, fraudHold, reason, userContext, req, options }) {
  assertEnabled();
  const context = requireUserContext(userContext);
  const supabase = await resolveSafeTradeClient(supabaseOrOptions, options);

  const confirmation = await fetchDeliveryConfirmation(supabase, confirmationId);
  const txn = await fetchTransaction(supabase, confirmation.transaction_id);
  if (!isPrivileged(context, txn)) {
    throw new ForbiddenError('Only a reviewer/admin may change a fraud hold', { code: 'REVIEWER_REQUIRED' });
  }

  const { data, error } = await supabase
    .from('diaspora_safetrade_delivery_confirmations')
    .update({ fraud_hold: Boolean(fraudHold), updated_by: context.id })
    .eq('id', confirmationId)
    .select()
    .single();
  if (error) throw new ValidationError(`Failed to update fraud hold: ${error.message}`);

  await appendCriticalAudit(supabase, {
    importOrderId: txn.import_order_id,
    tenantId: txn.tenant_id,
    actorId: context.id,
    action: fraudHold ? 'SAFETRADE_DELIVERY_FRAUD_HOLD_SET' : 'SAFETRADE_DELIVERY_FRAUD_HOLD_CLEARED',
    resourceType: 'diaspora_safetrade_delivery',
    resourceId: confirmationId,
    newState: { fraudHold: Boolean(fraudHold) },
    metadata: { reason, correlationId: requestCorrelationId(req) },
    req,
  });

  return data;
}

/** getDeliveryConfirmation — participant/privileged scoped read. */
export async function getDeliveryConfirmation(supabaseOrOptions, { confirmationId, userContext = {}, options = {} } = {}) {
  assertEnabled();
  const context = requireUserContext(userContext);
  const supabase = await resolveSafeTradeClient(supabaseOrOptions, options);
  const confirmation = await fetchDeliveryConfirmation(supabase, confirmationId);
  const txn = await fetchTransaction(supabase, confirmation.transaction_id);
  const actorId = normalizeId(context.id);
  const participant = [txn.buyer_id, txn.seller_id, txn.created_by, txn.updated_by].some((c) => normalizeId(c) === actorId);
  if (!participant && !isPrivileged(context, txn)) {
    throw new ForbiddenError('You do not have access to this delivery confirmation');
  }
  return confirmation;
}

/** listDeliveryConfirmations — confirmations for a transaction (participant/privileged scoped). */
export async function listDeliveryConfirmations(supabaseOrOptions, { transactionId, userContext = {}, options = {} } = {}) {
  assertEnabled();
  const context = requireUserContext(userContext);
  const supabase = await resolveSafeTradeClient(supabaseOrOptions, options);
  const txn = await fetchTransaction(supabase, transactionId);
  const actorId = normalizeId(context.id);
  const participant = [txn.buyer_id, txn.seller_id, txn.created_by, txn.updated_by].some((c) => normalizeId(c) === actorId);
  if (!participant && !isPrivileged(context, txn)) {
    throw new ForbiddenError('You do not have access to this SafeTrade transaction');
  }
  const { data } = await supabase
    .from('diaspora_safetrade_delivery_confirmations')
    .select('*')
    .eq('transaction_id', transactionId)
    .is('deleted_at', null)
    .order('confirmed_at', { ascending: false });
  return data || [];
}

export { DEFAULT_DISPUTE_WINDOW_HOURS as SAFETRADE_DEFAULT_DISPUTE_WINDOW_HOURS };
