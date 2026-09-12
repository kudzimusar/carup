/**
 * Phase 9 / Trade OS T13 — SafeTrade TRANSACTION service.
 *
 * SafeTrade remains an assurance/payment overlay: shipment, customs, documents and reputation stay
 * owned by their existing domains. T13 additionally pins transaction commercial money to the accepted
 * quote when that quote carries complete commercial facts; caller-supplied amount/currency/seller can
 * never re-price a complete accepted quote.
 */
import { resolveClient, requestCorrelationId, appendBestEffortAudit } from '../diasporaServiceUtils.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../utils/errors.js';
import { requireFeature } from '../diasporaEntitlementGuard.js';
import { FEATURE_KEYS } from '../../../constants/diaspora/diasporaEntitlements.js';
import {
  isSafeTradeEnabled,
  isSafeTradeLivePaymentEnabled,
  resolveSafeTradeProvider,
  SAFETRADE_POLICY_VERSION,
} from '../../../constants/diaspora/diasporaSafeTradeConstants.js';
import {
  SAFETRADE_TRANSITIONS,
  getTransition,
  assertDispatchAllowed,
} from '../../../constants/diaspora/diasporaSafeTradeStatuses.js';
import {
  requireUserContext,
  isPlatformAdmin,
  isPlatformReviewer,
  isTenantAdminForRecord,
  normalizeId,
} from '../diasporaAuthorization.js';
import { evaluateEligibility } from './diasporaSafeTradeEligibilityService.js';
import { resolveSafeTradeCommercialTruth } from './diasporaSafeTradeCommercialTruthService.js';

const TRANSITION_TARGET_DB_STATUS = Object.freeze({
  [SAFETRADE_TRANSITIONS.INITIATE]: 'DRAFT',
  [SAFETRADE_TRANSITIONS.RUN_ELIGIBILITY]: 'INITIATED',
  [SAFETRADE_TRANSITIONS.ELIGIBILITY_CLEARED]: 'INITIATED',
  [SAFETRADE_TRANSITIONS.BUYER_COMMIT]: 'INITIATED',
  [SAFETRADE_TRANSITIONS.SELLER_COMMIT]: 'FUNDS_PENDING',
  [SAFETRADE_TRANSITIONS.HOLD_PAYMENT]: 'FUNDS_HELD',
  [SAFETRADE_TRANSITIONS.SUBMIT_COMPLIANCE]: 'IN_PROGRESS',
  [SAFETRADE_TRANSITIONS.COMPLIANCE_PASS]: 'IN_PROGRESS',
  [SAFETRADE_TRANSITIONS.MARK_ARRIVED]: 'RELEASE_REVIEW',
  [SAFETRADE_TRANSITIONS.RELEASE_ESCROW]: 'RELEASE_AUTHORIZED',
  [SAFETRADE_TRANSITIONS.RAISE_DISPUTE]: 'DISPUTED',
  [SAFETRADE_TRANSITIONS.COMPLIANCE_FAIL]: 'DISPUTED',
  [SAFETRADE_TRANSITIONS.SUSPEND]: 'DISPUTED',
  [SAFETRADE_TRANSITIONS.CANCEL]: 'CANCELLED',
  [SAFETRADE_TRANSITIONS.INITIATE_REFUND]: 'REFUND_REVIEW',
  [SAFETRADE_TRANSITIONS.COMPLETE_REFUND]: 'REFUNDED',
});

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

function deriveActorPartyRole(txn, context) {
  const actorId = normalizeId(context.id);
  if (normalizeId(txn.buyer_id) === actorId || normalizeId(txn.created_by) === actorId) return 'BUYER';
  if (normalizeId(txn.seller_id) === actorId) return 'SELLER';
  return null;
}

function assertActorRoleAllowed(descriptor, txn, context, { privileged }) {
  if (privileged) return;
  const allowed = descriptor.actorRoles;
  if (!Array.isArray(allowed) || allowed.length === 0) return;
  const party = deriveActorPartyRole(txn, context);
  if (party && allowed.includes(party)) return;
  throw new ForbiddenError(`Transition ${descriptor.event} is not permitted for this actor`, {
    code: 'SAFETRADE_ACTOR_NOT_ALLOWED',
    event: descriptor.event,
    allowedRoles: [...allowed],
  });
}

function assertCanAccessTransaction(txn, context) {
  const actorId = normalizeId(context.id);
  const participant = [txn.buyer_id, txn.seller_id, txn.created_by, txn.updated_by]
    .some((c) => normalizeId(c) === actorId);
  if (participant || isPrivileged(context, txn)) return;
  throw new ForbiddenError('You do not have access to this SafeTrade transaction');
}

/**
 * Create a DRAFT SafeTrade transaction from CURRENT server-derived authority and the accepted quote's
 * commercial truth. Complete accepted-quote fields always win; incompatible caller assertions are
 * recorded as ignored assertions, never stored as commercial truth. Historical quotes that pre-date
 * quote_amount/quote_currency/seller_id use an explicit legacy fallback recorded in metadata.
 */
export async function createTransaction(supabaseOrOptions, {
  importOrderId,
  sellerId = null,
  sellerContext = null,
  currency = 'USD',
  totalAmount,
  tenantId = null,
  idempotencyKey = null,
  userContext = {},
  req = null,
  skipEligibility = false,
  options = {},
} = {}) {
  assertEnabled();
  const context = requireUserContext(userContext);
  const supabase = await resolveSafeTradeClient(supabaseOrOptions, options);
  if (!importOrderId) throw new ValidationError('importOrderId is required');

  const assertedSellerId = sellerId ?? normalizeId(sellerContext?.id ?? sellerContext?.userId) ?? null;
  const commercial = await resolveSafeTradeCommercialTruth(supabase, {
    importOrderId,
    userContext: context,
    sellerId: assertedSellerId,
    currency,
    totalAmount,
    tenantId,
  });
  const effectiveTenantId = commercial.tenantId;

  await requireFeature(supabase, {
    tenantId: effectiveTenantId,
    userId: context.id,
    featureKey: FEATURE_KEYS.SAFETRADE_CREATE,
  });

  if (!skipEligibility) {
    const verdict = await evaluateEligibility(supabase, {
      importOrderId,
      buyerContext: context,
      sellerContext,
      sellerId: commercial.sellerId,
      tenantId: effectiveTenantId,
      requestedCurrency: commercial.currency,
      evaluatedAt: req?.fixedTimestamp || null,
      options: { supabaseClient: supabase },
    });
    if (!verdict.eligible) {
      throw new ForbiddenError('SafeTrade eligibility checks failed', {
        code: 'SAFETRADE_NOT_ELIGIBLE',
        blockers: verdict.blockers,
        policyVersion: verdict.policyVersion,
      });
    }
  }

  if (idempotencyKey) {
    let replay = supabase
      .from('diaspora_safetrade_transactions')
      .select('*')
      .eq('idempotency_key', idempotencyKey)
      .is('deleted_at', null);
    if (effectiveTenantId) replay = replay.eq('tenant_id', effectiveTenantId);
    else replay = replay.is('tenant_id', null);
    const { data: existing } = await replay.maybeSingle();
    if (existing) return { transaction: existing, idempotentReplay: true };
  }

  const { data, error } = await supabase
    .from('diaspora_safetrade_transactions')
    .insert({
      tenant_id: effectiveTenantId,
      import_order_id: importOrderId,
      accepted_quote_id: commercial.acceptedQuoteId,
      buyer_id: commercial.buyerId,
      seller_id: commercial.sellerId,
      currency: commercial.currency,
      total_amount: commercial.amount,
      status: 'DRAFT',
      payment_provider: resolveSafeTradeProvider(),
      live_payment: false,
      policy_version: SAFETRADE_POLICY_VERSION,
      idempotency_key: idempotencyKey,
      metadata: {
        safetrade: {
          createdVia: 'service',
          commercialSource: commercial.provenance,
        },
      },
      created_by: context.id,
      updated_by: context.id,
    })
    .select()
    .single();
  if (error) throw new ValidationError(`Failed to create SafeTrade transaction: ${error.message}`);

  await appendBestEffortAudit(supabase, {
    importOrderId,
    tenantId: effectiveTenantId,
    actorId: context.id,
    action: 'SAFETRADE_INITIATED',
    resourceType: 'diaspora_safetrade_transaction',
    resourceId: data.id,
    newState: { status: 'DRAFT' },
    metadata: {
      policyVersion: SAFETRADE_POLICY_VERSION,
      commercialSource: commercial.provenance.status,
      acceptedQuoteId: commercial.acceptedQuoteId,
      correlationId: requestCorrelationId(req),
    },
    req,
  });

  return { transaction: data, idempotentReplay: false };
}

export async function getTransaction(supabaseOrOptions, { transactionId, userContext = {}, options = {} } = {}) {
  assertEnabled();
  const context = requireUserContext(userContext);
  const supabase = await resolveSafeTradeClient(supabaseOrOptions, options);
  const { data, error } = await supabase
    .from('diaspora_safetrade_transactions')
    .select('*')
    .eq('id', transactionId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error || !data) throw new NotFoundError('SafeTrade transaction not found');
  assertCanAccessTransaction(data, context);
  return data;
}

export async function listTransactions(supabaseOrOptions, {
  tenantId = null, status = null, importOrderId = null, limit = 50, offset = 0, userContext = {}, options = {},
} = {}) {
  assertEnabled();
  const context = requireUserContext(userContext);
  const supabase = await resolveSafeTradeClient(supabaseOrOptions, options);

  let query = supabase
    .from('diaspora_safetrade_transactions')
    .select('*')
    .is('deleted_at', null);
  const effectiveTenantId = tenantId ?? context.tenantId ?? null;
  if (effectiveTenantId) query = query.eq('tenant_id', effectiveTenantId);
  if (status) query = query.eq('status', status);
  if (importOrderId) query = query.eq('import_order_id', importOrderId);

  const { data } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + Math.min(Math.max(Number(limit) || 50, 1), 500) - 1);

  const rows = data || [];
  const privileged = isPlatformAdmin(context) || isPlatformReviewer(context);
  if (privileged) return rows;

  const actorId = normalizeId(context.id);
  return rows.filter((t) => {
    if (isTenantAdminForRecord(t, context)) return true;
    return [t.buyer_id, t.seller_id, t.created_by, t.updated_by].some((c) => normalizeId(c) === actorId);
  });
}

export async function transition(supabaseOrOptions, {
  transactionId,
  event,
  evaluationId = null,
  reason = null,
  idempotencyKey = null,
  metadata = {},
  userContext = {},
  req = null,
  options = {},
} = {}) {
  assertEnabled();
  const context = requireUserContext(userContext);
  const supabase = await resolveSafeTradeClient(supabaseOrOptions, options);

  const descriptor = getTransition(event);
  if (!descriptor) throw new ValidationError(`Unknown SafeTrade transition: ${event}`);

  const txn = await getTransaction(supabase, { transactionId, userContext: context, options: { supabaseClient: supabase } });
  const privileged = isPrivileged(context, txn);

  const reviewerOnly = descriptor.actorRoles
    && !descriptor.actorRoles.includes('BUYER')
    && !descriptor.actorRoles.includes('SELLER');
  if (reviewerOnly && !privileged) {
    throw new ForbiddenError(`Transition ${event} requires a reviewer/admin`, { code: 'REVIEWER_REQUIRED' });
  }

  assertActorRoleAllowed(descriptor, txn, context, { privileged });

  const isReleaseAuthority = [
    SAFETRADE_TRANSITIONS.RELEASE_ESCROW,
    SAFETRADE_TRANSITIONS.INITIATE_REFUND,
    SAFETRADE_TRANSITIONS.COMPLETE_REFUND,
  ].includes(event);
  if (isReleaseAuthority) {
    if (!privileged) throw new ForbiddenError(`Transition ${event} requires a reviewer/admin`, { code: 'REVIEWER_REQUIRED' });
    if (!evaluationId) throw new ForbiddenError(`Transition ${event} requires an approval evaluation`, { code: 'EVALUATION_REQUIRED' });
  }

  const targetDbStatus = TRANSITION_TARGET_DB_STATUS[event];
  if (!targetDbStatus) {
    return applyObservationalTransition(supabase, { txn, event, context, metadata, req });
  }

  if (descriptor.from && descriptor.from.length > 0) {
    try { assertDispatchAllowed(txn.status, event); } catch { /* coarse DB statuses differ; RPC is authoritative */ }
  }

  const { data, error } = await supabase.rpc('diaspora_safetrade_transition_atomic', {
    p_transaction_id: transactionId,
    p_milestone_id: null,
    p_actor_id: context.id,
    p_tenant_id: txn.tenant_id ?? context.tenantId ?? null,
    p_actor_is_privileged: privileged,
    p_target_status: targetDbStatus,
    p_evaluation_id: evaluationId,
    p_payment_provider: resolveSafeTradeProvider(),
    p_live_payment: isSafeTradeLivePaymentEnabled(),
    p_idempotency_key: idempotencyKey,
    p_reason: reason,
    p_metadata: { event, ...metadata },
    p_correlation_id: requestCorrelationId(req),
    p_source: 'service',
  });
  if (error) throw mapRpcError(error);

  const result = {
    transaction: data?.transaction ?? null,
    event,
    idempotentReplay: Boolean(data?.idempotentReplay),
    reputationEligibilityEvent: null,
  };

  if (event === SAFETRADE_TRANSITIONS.RELEASE_ESCROW) {
    result.reputationEligibilityEvent = await emitReputationEligibility(supabase, { txn, context, req });
  }

  return result;
}

async function applyObservationalTransition(supabase, { txn, event, context, metadata, req }) {
  const flagPatch = {};
  if (event === SAFETRADE_TRANSITIONS.CONFIRM_DELIVERY) flagPatch.deliveryConfirmed = true;
  if (event === SAFETRADE_TRANSITIONS.REQUEST_PAYMENT) flagPatch.paymentRequested = true;
  if (event === SAFETRADE_TRANSITIONS.BEGIN_SHIPMENT) flagPatch.shipmentStarted = true;

  const nextMetadata = {
    ...(txn.metadata || {}),
    safetrade: { ...(txn.metadata?.safetrade || {}), ...flagPatch, lastEvent: event },
  };

  const { data, error } = await supabase
    .from('diaspora_safetrade_transactions')
    .update({ metadata: nextMetadata, updated_by: context.id })
    .eq('id', txn.id)
    .select()
    .single();
  if (error) throw new ValidationError(`Failed to apply ${event}: ${error.message}`);

  await appendBestEffortAudit(supabase, {
    importOrderId: txn.import_order_id,
    tenantId: txn.tenant_id,
    actorId: context.id,
    action: `SAFETRADE_${event}`,
    resourceType: 'diaspora_safetrade_transaction',
    resourceId: txn.id,
    previousState: { status: txn.status },
    newState: { status: txn.status, flags: flagPatch },
    metadata: { event, ...metadata, correlationId: requestCorrelationId(req) },
    req,
  });

  return { transaction: data, event, idempotentReplay: false, observational: true };
}

async function emitReputationEligibility(supabase, { txn, context, req }) {
  const eventName = 'DIASPORA_SAFETRADE_REPUTATION_ELIGIBLE';
  await appendBestEffortAudit(supabase, {
    importOrderId: txn.import_order_id,
    tenantId: txn.tenant_id,
    actorId: context.id,
    action: eventName,
    resourceType: 'diaspora_safetrade_transaction',
    resourceId: txn.id,
    newState: { reputationEligible: true },
    metadata: {
      buyerId: txn.buyer_id,
      sellerId: txn.seller_id,
      note: 'eligibility signal only — no reputation written here',
      correlationId: requestCorrelationId(req),
    },
    req,
  });
  return { event: eventName, transactionId: txn.id, wroteReputation: false };
}

export async function getTimeline(supabaseOrOptions, { transactionId, userContext = {}, options = {} } = {}) {
  assertEnabled();
  const context = requireUserContext(userContext);
  const supabase = await resolveSafeTradeClient(supabaseOrOptions, options);
  const txn = await getTransaction(supabase, { transactionId, userContext: context, options: { supabaseClient: supabase } });

  const { data } = await supabase
    .from('diaspora_import_audit_log')
    .select('*')
    .eq('resource_id', txn.id)
    .order('created_at', { ascending: true });
  return (data || []).filter((row) => String(row.action || '').startsWith('SAFETRADE_')
    || String(row.action || '').startsWith('DIASPORA_SAFETRADE_'));
}

function mapRpcError(error) {
  const message = error?.message || 'SafeTrade transition failed';
  if (/EXTERNAL_ACTIVATION_REQUIRED/.test(message)) return new ForbiddenError(message, { code: 'EXTERNAL_ACTIVATION_REQUIRED' });
  if (/FORBIDDEN|REVIEWER_REQUIRED/.test(message)) return new ForbiddenError(message, { code: 'FORBIDDEN' });
  if (/NOT_FOUND/.test(message)) return new NotFoundError(message);
  if (/IDEMPOTENCY_CONFLICT|INVALID_TRANSITION|EVALUATION_REQUIRED|NOT_ELIGIBLE|POLICY_VERSION_MISMATCH|TARGET_REQUIRED/.test(message)) {
    return new ValidationError(message, { code: message.split(':')[0] });
  }
  return new ValidationError(message);
}

export { TRANSITION_TARGET_DB_STATUS };
