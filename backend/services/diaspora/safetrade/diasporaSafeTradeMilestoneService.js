/**
 * Phase 9 — SafeTrade MILESTONE service (sandbox-only escrow milestones).
 *
 * Operates over the Phase 9 diaspora_safetrade_milestones table (connect, don't duplicate). Milestone
 * DEFINITION goes through the atomic RPC diaspora_safetrade_record_milestone_atomic (single-currency
 * total reconciliation + in-txn CRITICAL audit, idempotent). Money operations (hold/capture/release/
 * refund) drive ONLY the SandboxPaymentProvider (live throws EXTERNAL_ACTIVATION_REQUIRED) and then
 * advance milestone state through the atomic transition RPC diaspora_safetrade_transition_atomic
 * (in-txn CRITICAL audit, idempotency replay, money fail-closed). Totals reconcile to the transaction
 * total within SAFETRADE_RECONCILIATION_TOLERANCE; every money op is idempotent on its idempotencyKey.
 *
 * Non-negotiables (directive §5.2): never moves real money (sandbox only); HIGH-risk release requires a
 * reviewer/admin actor + passing release policy even when conditions pass (enforced here AND in the RPC);
 * critical transitions fail atomically if their audit can't be written (the RPC writes audit in-txn);
 * gated behind DIASPORA_SAFETRADE_ENABLED. Server-derived roles only.
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

// Milestone types whose release ALWAYS requires reviewer/admin approval (high-risk), per directive.
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

// Participant-scoped read authorization on a transaction (buyer/seller/creator or privileged).
function assertCanAccessTransaction(txn, context) {
  const actorId = normalizeId(context.id);
  const participant = [txn.buyer_id, txn.seller_id, txn.created_by, txn.updated_by]
    .some((c) => normalizeId(c) === actorId);
  if (participant || isPrivileged(context, txn)) return;
  throw new ForbiddenError('You do not have access to this SafeTrade transaction');
}

/**
 * createMilestones — define/seed the milestone set for a transaction via the atomic reconciliation RPC.
 * Reconciles Σ amount to total_amount within SAFETRADE_RECONCILIATION_TOLERANCE (also pre-checked in JS),
 * idempotent on idempotencyKey, CRITICAL audit written in-txn by the RPC.
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

  // JS pre-flight reconciliation (the RPC re-asserts authoritatively in-txn).
  const sum = round2(milestones
    .filter((m) => (m.milestoneType || m.milestone_type) !== SAFETRADE_MILESTONE_TYPES.REFUND)
    .reduce((s, m) => s + Number(m.amount || 0), 0));
  if (Math.abs(sum - Number(txn.total_amount)) > SAFETRADE_RECONCILIATION_TOLERANCE) {
    throw new ValidationError('Milestone amounts do not reconcile to the transaction total', {
      sum, total: Number(txn.total_amount), tolerance: SAFETRADE_RECONCILIATION_TOLERANCE,
    });
  }

  const privileged = isPrivileged(context, txn);
  const payload = milestones.map((m, i) => ({
    milestoneType: m.milestoneType || m.milestone_type,
    sequence: m.sequence ?? i,
    amount: round2(m.amount),
    currency: m.currency || txn.currency,
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

/** listMilestones — read all milestones for a transaction (participant/privileged scoped). */
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

// Map a money op to the provider call + the target milestone status the transition RPC must reach.
const MONEY_OP_PLAN = Object.freeze({
  HOLD: { providerMethod: 'authorizeHold', targetStatus: 'FUNDS_PENDING' },
  CAPTURE: { providerMethod: 'captureRelease', targetStatus: 'HELD' },
  RELEASE: { providerMethod: 'release', targetStatus: 'RELEASED' },
  REFUND: { providerMethod: 'refund', targetStatus: 'REFUNDED' },
});

/**
 * recordMilestone — perform a sandbox money operation (hold/capture/release/refund) on a milestone and
 * advance its state through the atomic transition RPC. Idempotent on idempotencyKey at BOTH the provider
 * layer and the RPC layer. RELEASE of a high-risk milestone requires a reviewer/admin actor AND a passing
 * release-policy evaluation (evaluationId) — enforced here and re-checked in the RPC. Never moves real
 * money: the provider is sandbox; the live path throws EXTERNAL_ACTIVATION_REQUIRED.
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

  // RELEASE is reviewer/admin authority; high-risk milestone release also requires a passing evaluation.
  if (op === MONEY_OPS.RELEASE) {
    if (!privileged) throw new ForbiddenError('Only a reviewer/admin may release escrow', { code: 'REVIEWER_REQUIRED' });
    const highRisk = HIGH_RISK_MILESTONE_TYPES.has(milestone.milestone_type);
    // Re-evaluate release policy against live state (never trust a passed-in verdict).
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

  // Resolve the provider (sandbox unless live activated; live throws on use). Fail-closed selection.
  const provider = selectPaymentProvider(options);
  const providerArgs = {
    intentId: milestone.provider_reference,
    milestoneId,
    tenantId: txn.tenant_id ?? context.tenantId ?? null,
    amount: amount == null ? Number(milestone.amount) : round2(amount),
    currency: milestone.currency,
    payer: milestone.payer,
    payee: milestone.payee,
    idempotencyKey,
    approval: op === MONEY_OPS.RELEASE ? { evaluationId, actorId: context.id } : undefined,
  };

  // For HOLD, create the intent first if the milestone has none yet (sandbox intent).
  let providerResult;
  if (op === MONEY_OPS.HOLD && !milestone.provider_reference) {
    const intent = await provider.createPaymentIntent(providerArgs);
    providerArgs.intentId = intent.intentId;
    providerResult = await provider.authorizeHold({ intentId: intent.intentId, idempotencyKey });
    providerResult.intentId = intent.intentId;
  } else {
    providerResult = await provider[plan.providerMethod](providerArgs);
  }

  // Advance milestone state atomically (in-txn CRITICAL audit, idempotency replay, money fail-closed).
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
    p_idempotency_key: idempotencyKey,
    p_reason: `milestone ${op}`,
    p_metadata: {
      operation: op,
      providerReference: providerArgs.intentId ?? null,
      providerStatus: providerResult?.status ?? null,
      idempotentReplay: Boolean(providerResult?.idempotentReplay),
    },
    p_correlation_id: requestCorrelationId(req),
    p_source: 'service',
  });
  if (error) throw mapRpcError(error);

  return {
    milestone: data?.milestone ?? null,
    transaction: data?.transaction ?? null,
    provider: { name: provider.name, ...providerResult },
    idempotentReplay: Boolean(data?.idempotentReplay),
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

// Translate a Postgres/RPC error envelope into a typed CarUp error.
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
