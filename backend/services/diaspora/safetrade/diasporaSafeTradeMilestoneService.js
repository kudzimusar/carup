/**
 * Phase 9 / Trade OS T13 — SafeTrade MILESTONE service (sandbox-only escrow milestones).
 *
 * Milestone definition remains authoritative through the atomic reconciliation RPC. Money operations
 * reserve a durable operation BEFORE provider dispatch, use one canonical economic idempotency key at
 * the provider/RPC boundary, and never redispatch an unresolved operation. A provider-confirmed result
 * is not success until the authoritative ledger applies the same operation.
 */
import { resolveClient, requestCorrelationId } from '../diasporaServiceUtils.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../utils/errors.js';
import {
  isSafeTradeEnabled,
  resolveSafeTradeProvider,
  isSafeTradeLivePaymentEnabled,
  SAFETRADE_RECONCILIATION_TOLERANCE,
  SAFETRADE_MILESTONE_TYPES,
} from '../../../constants/diaspora/diasporaSafeTradeConstants.js';
import {
  requireUserContext,
  isPlatformAdmin,
  isPlatformReviewer,
  isTenantAdminForRecord,
  normalizeId,
} from '../diasporaAuthorization.js';
import { selectPaymentProvider } from './safeTradePaymentProvider.js';
import { evaluateRelease } from './diasporaSafeTradeReleasePolicyService.js';
import {
  OPERATION_STATE,
  reserveOperation,
  markDispatched,
  markProviderConfirmed,
  markUnknown,
  markFailed,
} from './diasporaSafeTradeOperationService.js';

const HIGH_RISK_MILESTONE_TYPES = new Set([
  SAFETRADE_MILESTONE_TYPES.RELEASE,
  SAFETRADE_MILESTONE_TYPES.DELIVERY,
]);

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

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function isPrivileged(context, record = {}) {
  return isPlatformAdmin(context) || isPlatformReviewer(context) || isTenantAdminForRecord(record, context);
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

async function fetchMilestone(supabase, milestoneId) {
  const { data, error } = await supabase
    .from('diaspora_safetrade_milestones')
    .select('*')
    .eq('id', milestoneId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error || !data) throw new NotFoundError('SafeTrade milestone not found');
  return data;
}

function assertCanAccessTransaction(txn, context) {
  const actorId = normalizeId(context.id);
  const participant = [txn.buyer_id, txn.seller_id, txn.created_by, txn.updated_by]
    .some((c) => normalizeId(c) === actorId);
  if (participant || isPrivileged(context, txn)) return;
  throw new ForbiddenError('You do not have access to this SafeTrade transaction');
}

function assertBuyerOrPrivileged(txn, context, privileged, operation) {
  if (privileged) return;
  if (normalizeId(txn.buyer_id) === normalizeId(context.id)) return;
  throw new ForbiddenError(`Only the buyer or a reviewer/admin may initiate ${operation.toLowerCase()}`, {
    code: 'SAFETRADE_PAYER_AUTHORITY_REQUIRED',
  });
}

function assertFullMilestoneAmount(milestone, requestedAmount) {
  const canonical = round2(milestone.amount);
  const requested = requestedAmount == null ? canonical : round2(requestedAmount);
  if (!(canonical > 0) || !(requested > 0)) {
    throw new ValidationError('SafeTrade milestone money operation requires an amount greater than zero', {
      code: 'INVALID_AMOUNT',
    });
  }
  if (requested !== canonical) {
    throw new ValidationError('Partial money cannot advance a full SafeTrade milestone state', {
      code: 'SAFETRADE_PARTIAL_MONEY_NOT_SUPPORTED',
      milestoneAmount: canonical,
      requestedAmount: requested,
    });
  }
  return canonical;
}

function reconciliationRequired(operationRow, reason = null) {
  return new ValidationError(
    reason || 'This SafeTrade money operation is already in progress or requires reconciliation; do not retry it at the provider',
    {
      code: 'SAFETRADE_OPERATION_RECONCILIATION_REQUIRED',
      operationId: operationRow?.id ?? null,
      state: operationRow?.state ?? null,
    },
  );
}

/**
 * createMilestones — define/seed the milestone set for a transaction via the atomic reconciliation RPC.
 */
export async function createMilestones(supabaseOrOptions, {
  transactionId,
  milestones,
  idempotencyKey = null,
  userContext = {},
  req = null,
  options = {},
} = {}) {
  assertEnabled();
  const context = requireUserContext(userContext);
  const supabase = await resolveSafeTradeClient(supabaseOrOptions, options);

  if (!Array.isArray(milestones) || milestones.length === 0) {
    throw new ValidationError('milestones must be a non-empty array');
  }

  const txn = await fetchTransaction(supabase, transactionId);
  assertCanAccessTransaction(txn, context);

  const sum = round2(milestones
    .filter((m) => (m.milestoneType || m.milestone_type) !== SAFETRADE_MILESTONE_TYPES.REFUND)
    .reduce((s, m) => s + Number(m.amount || 0), 0));
  if (Math.abs(sum - Number(txn.total_amount)) > SAFETRADE_RECONCILIATION_TOLERANCE) {
    throw new ValidationError('Milestone amounts do not reconcile to the transaction total', {
      sum, total: Number(txn.total_amount), tolerance: SAFETRADE_RECONCILIATION_TOLERANCE,
    });
  }

  for (const milestone of milestones) {
    const milestoneAmount = round2(milestone.amount);
    const milestoneCurrency = String(milestone.currency || txn.currency || '').trim().toUpperCase();
    if (!(milestoneAmount > 0)) {
      throw new ValidationError('Milestone amounts must be greater than zero', { code: 'INVALID_AMOUNT' });
    }
    if (milestoneCurrency !== String(txn.currency || '').trim().toUpperCase()) {
      throw new ValidationError('Milestone currency must match the SafeTrade transaction currency', {
        code: 'CURRENCY_MISMATCH',
      });
    }
  }

  const privileged = isPrivileged(context, txn);
  const payload = milestones.map((m, i) => ({
    milestoneType: m.milestoneType || m.milestone_type,
    sequence: m.sequence ?? i,
    amount: round2(m.amount),
    currency: String(m.currency || txn.currency).trim().toUpperCase(),
    payer: m.payer ?? null,
    payee: m.payee ?? null,
    dueTrigger: m.dueTrigger || m.due_trigger || 'MANUAL',
    releaseTrigger: m.releaseTrigger || m.release_trigger || 'REVIEWER_APPROVAL',
    evidenceRequirements: m.evidenceRequirements || m.evidence_requirements || [],
    legacyPaymentMilestoneId: m.legacyPaymentMilestoneId || m.legacy_payment_milestone_id || null,
    idempotencyKey: m.idempotencyKey || null,
  }));

  const { data, error } = await supabase.rpc('diaspora_safetrade_record_milestone_atomic', {
    p_transaction_id: transactionId,
    p_actor_id: context.id,
    p_tenant_id: txn.tenant_id ?? context.tenantId ?? null,
    p_actor_is_privileged: privileged,
    p_milestones: payload,
    p_idempotency_key: idempotencyKey,
    p_correlation_id: requestCorrelationId(req),
    p_source: 'service',
  });
  if (error) throw mapRpcError(error);
  return data;
}

export async function listMilestones(supabaseOrOptions, {
  transactionId, userContext = {}, options = {},
} = {}) {
  assertEnabled();
  const context = requireUserContext(userContext);
  const supabase = await resolveSafeTradeClient(supabaseOrOptions, options);
  const txn = await fetchTransaction(supabase, transactionId);
  assertCanAccessTransaction(txn, context);
  const { data } = await supabase
    .from('diaspora_safetrade_milestones')
    .select('*')
    .eq('transaction_id', transactionId)
    .is('deleted_at', null)
    .order('sequence', { ascending: true });
  return data || [];
}

const MONEY_OPS = Object.freeze({
  HOLD: 'HOLD',
  CAPTURE: 'CAPTURE',
  RELEASE: 'RELEASE',
  REFUND: 'REFUND',
});

const MONEY_OP_PLAN = Object.freeze({
  HOLD: { providerMethod: 'authorizeHold', targetStatus: 'FUNDS_PENDING' },
  CAPTURE: { providerMethod: 'captureRelease', targetStatus: 'HELD' },
  RELEASE: { providerMethod: 'release', targetStatus: 'RELEASED' },
  REFUND: { providerMethod: 'refund', targetStatus: 'REFUNDED' },
});

const OPERATION_FOR_MONEY_OP = Object.freeze({
  HOLD: 'authorize_hold',
  CAPTURE: 'capture',
  RELEASE: 'release',
  REFUND: 'refund',
});

/**
 * Perform one full-state money operation exactly once. A durable operation replay never causes a
 * second provider dispatch. `provider_confirmed` may resume only the ledger step; ambiguous states are
 * handed to reconciliation rather than retried into a possible double-spend.
 */
export async function recordMilestone(supabaseOrOptions, {
  transactionId,
  milestoneId,
  operation,
  amount = null,
  evaluationId = null,
  idempotencyKey = null,
  userContext = {},
  req = null,
  options = {},
} = {}) {
  assertEnabled();
  const op = String(operation || '').toUpperCase();
  if (!MONEY_OPS[op]) throw new ValidationError(`Unknown milestone operation: ${operation}`);

  const context = requireUserContext(userContext);
  const supabase = await resolveSafeTradeClient(supabaseOrOptions, options);

  const txn = await fetchTransaction(supabase, transactionId);
  assertCanAccessTransaction(txn, context);
  const milestone = await fetchMilestone(supabase, milestoneId);
  if (normalizeId(milestone.transaction_id) !== normalizeId(transactionId)) {
    throw new ValidationError('Milestone does not belong to the transaction');
  }

  const privileged = isPrivileged(context, txn);
  const plan = MONEY_OP_PLAN[op];

  if ([MONEY_OPS.HOLD, MONEY_OPS.CAPTURE].includes(op)) {
    assertBuyerOrPrivileged(txn, context, privileged, op);
  }

  if (op === MONEY_OPS.RELEASE) {
    if (!privileged) throw new ForbiddenError('Only a reviewer/admin may release escrow', { code: 'REVIEWER_REQUIRED' });
    const highRisk = HIGH_RISK_MILESTONE_TYPES.has(milestone.milestone_type);
    const verdict = await evaluateRelease(supabase, {
      safeTradeId: transactionId,
      milestoneId,
      actorContext: context,
      options: { supabaseClient: supabase },
    });
    if (!verdict.eligible) {
      throw new ForbiddenError('Release is not eligible under the current release policy', { code: 'NOT_ELIGIBLE', blockers: verdict.blockers });
    }
    if (highRisk && verdict.requiresApproval && !evaluationId) {
      throw new ForbiddenError('High-risk release requires a reviewer/admin approval evaluation', { code: 'REVIEWER_APPROVAL_REQUIRED' });
    }
  }
  if (op === MONEY_OPS.REFUND && !privileged) {
    throw new ForbiddenError('Only a reviewer/admin may refund escrow', { code: 'REVIEWER_REQUIRED' });
  }

  const operationAmount = assertFullMilestoneAmount(milestone, amount);
  const operationIdempotencyKey = String(
    idempotencyKey || `auto:${transactionId}:${milestoneId}:${op}:${milestone.status}`,
  );

  const provider = selectPaymentProvider(options);
  const providerArgs = {
    intentId: milestone.provider_reference,
    milestoneId,
    tenantId: txn.tenant_id ?? context.tenantId ?? null,
    amount: operationAmount,
    currency: milestone.currency,
    payer: milestone.payer,
    payee: milestone.payee,
    idempotencyKey: operationIdempotencyKey,
    approval: op === MONEY_OPS.RELEASE ? { evaluationId, actorId: context.id } : undefined,
  };

  const reservation = await reserveOperation({
    tenantId: txn.tenant_id ?? context.tenantId ?? null,
    transactionId,
    milestoneId,
    operation: OPERATION_FOR_MONEY_OP[op],
    idempotencyKey: operationIdempotencyKey,
    provider: provider.name,
    amount: providerArgs.amount,
    currency: providerArgs.currency,
    requestedBy: context.id,
    metadata: { moneyOp: op, correlationId: requestCorrelationId(req) },
    supabaseClient: supabase,
  });
  let operationRow = reservation.operation;

  let providerResult = null;
  if (reservation.replay) {
    if (operationRow.state === OPERATION_STATE.LEDGER_APPLIED) {
      return {
        milestone: await fetchMilestone(supabase, milestoneId),
        transaction: await fetchTransaction(supabase, transactionId),
        provider: {
          name: operationRow.provider,
          intentId: operationRow.provider_ref ?? milestone.provider_reference ?? null,
          status: operationRow.provider_status ?? null,
        },
        idempotentReplay: true,
      };
    }

    if (operationRow.state === OPERATION_STATE.PROVIDER_CONFIRMED) {
      providerResult = {
        provider: operationRow.provider,
        intentId: operationRow.provider_ref ?? milestone.provider_reference ?? null,
        status: operationRow.provider_status ?? null,
        idempotentReplay: true,
      };
      providerArgs.intentId = providerResult.intentId;
    } else if ([
      OPERATION_STATE.PENDING,
      OPERATION_STATE.PROVIDER_DISPATCHED,
      OPERATION_STATE.RECONCILING,
    ].includes(operationRow.state)) {
      throw reconciliationRequired(operationRow);
    } else if ([OPERATION_STATE.FAILED, OPERATION_STATE.COMPENSATED].includes(operationRow.state)) {
      throw new ValidationError('This SafeTrade idempotency key belongs to a terminal operation and cannot be reused', {
        code: 'IDEMPOTENCY_CONFLICT',
        operationId: operationRow.id,
        state: operationRow.state,
      });
    } else {
      throw reconciliationRequired(operationRow, 'SafeTrade operation is in an unknown durable state');
    }
  } else {
    try {
      operationRow = await markDispatched(operationRow.id, { supabaseClient: supabase }) || operationRow;

      if (op === MONEY_OPS.HOLD && !milestone.provider_reference) {
        // The intent creation and hold authorization are two provider mutations. They receive related
        // but distinct provider keys so the provider cannot mistake the intent replay for the hold.
        const intent = await provider.createPaymentIntent({
          ...providerArgs,
          idempotencyKey: `${operationIdempotencyKey}:intent`,
        });
        providerArgs.intentId = intent.intentId;
        providerResult = await provider.authorizeHold({
          intentId: intent.intentId,
          idempotencyKey: operationIdempotencyKey,
        });
        providerResult.intentId = intent.intentId;
      } else {
        providerResult = await provider[plan.providerMethod]({
          ...providerArgs,
          idempotencyKey: operationIdempotencyKey,
        });
      }

      const confirmedOperation = await markProviderConfirmed(operationRow.id, {
        providerRef: providerResult?.intentId ?? providerArgs.intentId ?? null,
        providerStatus: providerResult?.status ?? null,
        supabaseClient: supabase,
      });
      operationRow = confirmedOperation || operationRow;
      if (operationRow.state !== OPERATION_STATE.PROVIDER_CONFIRMED) {
        throw reconciliationRequired(operationRow, 'Provider result is ambiguous and cannot be applied to the SafeTrade ledger');
      }
    } catch (providerError) {
      // Do not overwrite the deliberate reconciling state produced by a duplicate provider reference
      // or another ambiguity discovered after the provider call.
      if (providerError?.details?.code === 'SAFETRADE_OPERATION_RECONCILIATION_REQUIRED'
        || providerError?.code === 'SAFETRADE_OPERATION_RECONCILIATION_REQUIRED') {
        throw providerError;
      }

      const definiteRefusal = ['INVALID_INPUT', 'INVALID_STATE'].includes(providerError?.code);
      if (definiteRefusal) {
        await markFailed(operationRow.id, {
          errorCode: providerError.code,
          reason: providerError.message,
          supabaseClient: supabase,
        });
      } else {
        await markUnknown(operationRow.id, providerError?.message || 'provider call failed', {
          supabaseClient: supabase,
        });
      }
      throw providerError;
    }
  }

  const { data, error } = await supabase.rpc('diaspora_safetrade_transition_atomic', {
    p_transaction_id: transactionId,
    p_milestone_id: milestoneId,
    p_actor_id: context.id,
    p_tenant_id: txn.tenant_id ?? context.tenantId ?? null,
    p_actor_is_privileged: privileged,
    p_target_status: plan.targetStatus,
    p_evaluation_id: evaluationId,
    p_payment_provider: resolveSafeTradeProvider(),
    p_live_payment: isSafeTradeLivePaymentEnabled(),
    p_idempotency_key: operationIdempotencyKey,
    p_reason: `milestone ${op}`,
    p_metadata: {
      operation: op,
      providerReference: providerResult?.intentId ?? providerArgs.intentId ?? null,
      providerStatus: providerResult?.status ?? operationRow.provider_status ?? null,
      idempotentReplay: Boolean(providerResult?.idempotentReplay || reservation.replay),
      operationId: operationRow.id,
    },
    p_correlation_id: requestCorrelationId(req),
    p_source: 'service',
  });
  if (error) throw mapRpcError(error);

  return {
    milestone: data?.milestone ?? await fetchMilestone(supabase, milestoneId),
    transaction: data?.transaction ?? await fetchTransaction(supabase, transactionId),
    provider: { name: provider.name, ...providerResult },
    idempotentReplay: Boolean(data?.idempotentReplay || reservation.replay),
  };
}

/**
 * reconcileTotals — pure read helper: does the milestone set still reconcile to the transaction total
 * within tolerance? Returns an explainable summary; never mutates.
 */
export async function reconcileTotals(supabaseOrOptions, {
  transactionId, userContext = {}, options = {},
} = {}) {
  assertEnabled();
  const context = requireUserContext(userContext);
  const supabase = await resolveSafeTradeClient(supabaseOrOptions, options);
  const txn = await fetchTransaction(supabase, transactionId);
  assertCanAccessTransaction(txn, context);
  const { data } = await supabase
    .from('diaspora_safetrade_milestones')
    .select('*')
    .eq('transaction_id', transactionId)
    .is('deleted_at', null);
  const milestones = data || [];
  const sum = round2(milestones
    .filter((m) => m.milestone_type !== SAFETRADE_MILESTONE_TYPES.REFUND && !['CANCELLED', 'WAIVED'].includes(m.status))
    .reduce((s, m) => s + Number(m.amount || 0), 0));
  const total = Number(txn.total_amount || 0);
  const reconciled = Math.abs(sum - total) <= SAFETRADE_RECONCILIATION_TOLERANCE;
  return { reconciled, sum, total, tolerance: SAFETRADE_RECONCILIATION_TOLERANCE, milestoneCount: milestones.length };
}

function mapRpcError(error) {
  const message = error?.message || 'SafeTrade milestone operation failed';
  if (/EXTERNAL_ACTIVATION_REQUIRED/.test(message)) return new ForbiddenError(message, { code: 'EXTERNAL_ACTIVATION_REQUIRED' });
  if (/FORBIDDEN|REVIEWER_REQUIRED/.test(message)) return new ForbiddenError(message, { code: 'FORBIDDEN' });
  if (/NOT_FOUND/.test(message)) return new NotFoundError(message);
  if (/IDEMPOTENCY_CONFLICT|INVALID_TRANSITION|TOTALS_UNRECONCILED|CURRENCY_MISMATCH|INVALID_AMOUNT|MILESTONES_LOCKED|MILESTONES_REQUIRED|NOT_ELIGIBLE|EVALUATION_REQUIRED|POLICY_VERSION_MISMATCH/.test(message)) {
    return new ValidationError(message, { code: message.split(':')[0] });
  }
  return new ValidationError(message);
}

export { MONEY_OPS as SAFETRADE_MILESTONE_MONEY_OPS, HIGH_RISK_MILESTONE_TYPES };
