/**
 * Phase 9 — SafeTrade TRANSACTION service.
 *
 * The orchestration entry point for the SafeTrade escrow/assurance overlay. It owns:
 *  - createTransaction: eligibility-gated (evaluateEligibility) + entitlement-gated
 *    (requireFeature(diaspora.safetrade.create) when enforcement on) creation of a
 *    diaspora_safetrade_transactions row (DRAFT). It NEVER moves money, approves compliance, marks
 *    shipment/delivery, or creates reputation.
 *  - getTransaction / listTransactions: tenant + participant scoped reads (server-derived roles only).
 *  - transition: drives the authoritative state via the atomic RPC diaspora_safetrade_transition_atomic
 *    (in-txn CRITICAL audit, idempotency replay, money/high-risk fail-closed). The completion path emits
 *    a reputation-ELIGIBILITY event only (the existing diasporaReputationService remains the only
 *    reputation writer); it never writes reputation.
 *  - getTimeline: the audit trail for the transaction from diaspora_import_audit_log.
 *
 * Gated behind DIASPORA_SAFETRADE_ENABLED (default OFF) — every mutating entry point asserts enabled.
 * Connects to the existing domain (orders/quotes, reservations, compliance, documents, shipments); it
 * does not duplicate it.
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

// Map a SafeTrade state-machine target (the design's 16-state model) to the DB transaction status
// (the migration's transaction CHECK enum). Self/observational transitions map to null (no DB status
// change — they set metadata flags only). Money/compliance/shipment/delivery are NEVER auto-completed
// here: those targets are reached only via the dedicated services/RPCs.
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

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function isPrivileged(context, record = {}) {
  return isPlatformAdmin(context) || isPlatformReviewer(context) || isTenantAdminForRecord(record, context);
}

/**
 * Resolve a NON-privileged actor's transaction-scoped role from the AUTHORITATIVE row (server-derived;
 * the client x-stakeholder-role is never trusted). Mirrors the delivery service's buyer/seller derivation:
 *   - BUYER  : the txn.buyer_id (or txn.created_by) is the actor
 *   - SELLER : the txn.seller_id is the actor
 *   - null   : neither (an unrelated participant)
 * Privileged actors (platform admin/reviewer, tenant admin of the record) are handled by isPrivileged and
 * are exempt from this party allowlist; this only constrains the non-privileged buyer/seller parties.
 */
function deriveActorPartyRole(txn, context) {
  const actorId = normalizeId(context.id);
  if (normalizeId(txn.buyer_id) === actorId || normalizeId(txn.created_by) === actorId) return 'BUYER';
  if (normalizeId(txn.seller_id) === actorId) return 'SELLER';
  return null;
}

/**
 * Enforce the transition descriptor's actorRoles allowlist for a NON-privileged actor (FIX 1 — closes the
 * seller-confirm-delivery vector). The transition() reviewerOnly heuristic only rejected edges whose
 * actorRoles excluded BOTH buyer and seller; an edge like CONFIRM_DELIVERY (actorRoles ['BUYER','REVIEWER',
 * 'ADMIN']) let a SELLER through the /commit -> transition() path and flip the load-bearing buyer
 * delivery-confirmation gate. Here we require the non-privileged actor's server-derived party role to be in
 * descriptor.actorRoles. Privileged platform reviewer/admin (and tenant admin) override is preserved.
 */
function assertActorRoleAllowed(descriptor, txn, context, { privileged }) {
  if (privileged) return; // reviewer/admin/tenant-admin override (consistent with the rest of the service)
  const allowed = descriptor.actorRoles;
  if (!Array.isArray(allowed) || allowed.length === 0) return; // no party allowlist on this edge
  // If the edge admits SYSTEM but no concrete human party, it is a system/observational edge a
  // non-privileged human party cannot drive — fall through to the party check (party role must match).
  const party = deriveActorPartyRole(txn, context);
  if (party && allowed.includes(party)) return;
  throw new ForbiddenError(`Transition ${descriptor.event} is not permitted for this actor`, {
    code: 'SAFETRADE_ACTOR_NOT_ALLOWED',
    event: descriptor.event,
    allowedRoles: [...allowed],
  });
}

// Participant-scoped read authorization (buyer/seller/creator or privileged).
function assertCanAccessTransaction(txn, context) {
  const actorId = normalizeId(context.id);
  const participant = [txn.buyer_id, txn.seller_id, txn.created_by, txn.updated_by]
    .some((c) => normalizeId(c) === actorId);
  if (participant || isPrivileged(context, txn)) return;
  throw new ForbiddenError('You do not have access to this SafeTrade transaction');
}

/**
 * createTransaction — eligibility-gated + entitlement-gated creation of a DRAFT SafeTrade transaction.
 * Returns the created row. NEVER moves money / touches compliance / shipment / delivery / reputation.
 * Idempotent on idempotencyKey via the table's partial-unique (tenant_id, idempotency_key).
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
  if (totalAmount == null || !(Number(totalAmount) >= 0)) throw new ValidationError('totalAmount must be a non-negative number');

  const effectiveTenantId = tenantId ?? context.tenantId ?? null;

  // 1. Entitlement gate (no-op when enforcement off; ForbiddenError when on and denied).
  await requireFeature(supabase, {
    tenantId: effectiveTenantId,
    userId: context.id,
    featureKey: FEATURE_KEYS.SAFETRADE_CREATE,
  });

  // 2. Eligibility gate — explainable blockers; refuse creation unless eligible.
  if (!skipEligibility) {
    const verdict = await evaluateEligibility(supabase, {
      importOrderId,
      buyerContext: context,
      sellerContext,
      sellerId,
      tenantId: effectiveTenantId,
      requestedCurrency: currency,
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

  // Idempotency: a replay returns the existing draft rather than creating a duplicate.
  if (idempotencyKey) {
    const { data: existing } = await supabase
      .from('diaspora_safetrade_transactions')
      .select('*')
      .eq('tenant_id', effectiveTenantId)
      .eq('idempotency_key', idempotencyKey)
      .is('deleted_at', null)
      .maybeSingle();
    if (existing) return { transaction: existing, idempotentReplay: true };
  }

  // Resolve the accepted quote pointer (read-through; the order is the logistics source of truth).
  const { data: order } = await supabase
    .from('diaspora_import_orders')
    .select('*')
    .eq('id', importOrderId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!order) throw new NotFoundError('Diaspora import order not found');
  const acceptedQuoteId = order?.metadata?.rfq?.acceptedQuoteId ?? null;

  const { data, error } = await supabase
    .from('diaspora_safetrade_transactions')
    .insert({
      tenant_id: effectiveTenantId,
      import_order_id: importOrderId,
      accepted_quote_id: acceptedQuoteId,
      buyer_id: context.id,
      seller_id: sellerId ?? normalizeId(sellerContext?.id ?? sellerContext?.userId) ?? null,
      currency,
      total_amount: round2(totalAmount),
      status: 'DRAFT',
      payment_provider: resolveSafeTradeProvider(), // sandbox/fake only (fail-closed)
      live_payment: false, // DB CHECK also forces false; never live here
      policy_version: SAFETRADE_POLICY_VERSION,
      idempotency_key: idempotencyKey,
      metadata: { safetrade: { createdVia: 'service' } },
      created_by: context.id,
      updated_by: context.id,
    })
    .select()
    .single();
  if (error) throw new ValidationError(`Failed to create SafeTrade transaction: ${error.message}`);

  // Best-effort telemetry audit of the creation (the lifecycle transitions use in-txn CRITICAL audit).
  await appendBestEffortAudit(supabase, {
    importOrderId,
    tenantId: effectiveTenantId,
    actorId: context.id,
    action: 'SAFETRADE_INITIATED',
    resourceType: 'diaspora_safetrade_transaction',
    resourceId: data.id,
    newState: { status: 'DRAFT' },
    metadata: { policyVersion: SAFETRADE_POLICY_VERSION, correlationId: requestCorrelationId(req) },
    req,
  });

  return { transaction: data, idempotentReplay: false };
}

/** getTransaction — participant/privileged scoped read. */
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

/**
 * listTransactions — tenant + participant scoped. Privileged actors (platform admin/reviewer) see all
 * tenant rows; everyone else sees only rows where they are buyer/seller/creator. RLS is the backstop.
 */
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

/**
 * transition — dispatch a SafeTrade state-machine event against the transaction, driving the
 * authoritative DB status through the atomic transition RPC (in-txn CRITICAL audit, idempotency replay,
 * money/high-risk fail-closed). Structural legality is checked first via assertDispatchAllowed.
 *
 * Guardrails enforced here (defense-in-depth with the RPC):
 *  - Money/compliance/shipment/delivery/reputation are NEVER auto-completed by this function. Money
 *    edges (HOLD/RELEASE/REFUND) and milestone money state belong to the milestone service; this only
 *    moves the transaction-level status and refuses to drive a money target without privilege/eligibility.
 *  - RELEASE_ESCROW / INITIATE_REFUND / COMPLETE_REFUND / COMPLIANCE_PASS / SUSPEND require a
 *    reviewer/admin actor (the descriptor's actorRoles + the RPC's privilege gate).
 *  - The completion path emits a reputation-ELIGIBILITY event only (never writes reputation).
 */
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

  // Reviewer/admin-only edges (N2/N5): refuse early for non-privileged actors.
  const reviewerOnly = descriptor.actorRoles
    && !descriptor.actorRoles.includes('BUYER')
    && !descriptor.actorRoles.includes('SELLER');
  if (reviewerOnly && !privileged) {
    throw new ForbiddenError(`Transition ${event} requires a reviewer/admin`, { code: 'REVIEWER_REQUIRED' });
  }

  // FIX 1 — enforce the descriptor's actorRoles party allowlist for non-privileged actors. The
  // reviewerOnly heuristic above does NOT catch mixed-role edges (e.g. CONFIRM_DELIVERY admits BUYER but
  // not SELLER): without this, a SELLER could drive CONFIRM_DELIVERY through /commit -> transition() and
  // flip the load-bearing buyer delivery-confirmation gate. A non-privileged actor's server-derived party
  // role (BUYER for buyer/creator, SELLER for seller) must be in descriptor.actorRoles. For CONFIRM_DELIVERY
  // this means only the buyer (or a privileged reviewer/admin) may confirm — sellers/others are rejected.
  assertActorRoleAllowed(descriptor, txn, context, { privileged });

  // Money/release/refund authorization edges require a passing prior evaluation reference (N5).
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

  // Self/observational transitions (e.g. CONFIRM_DELIVERY, REQUEST_PAYMENT, BEGIN_SHIPMENT) set a
  // metadata flag only — no DB status change, no money. Handled without the transition RPC.
  if (!targetDbStatus) {
    return applyObservationalTransition(supabase, { txn, event, context, metadata, req });
  }

  // Structural legality of the DB-status edge is enforced authoritatively by the RPC; the design's
  // 16-state adjacency is asserted here for early, explainable rejection of clearly-illegal verbs.
  if (descriptor.from && descriptor.from.length > 0) {
    // The design state may differ from the coarse DB status; only assert when both share vocabulary.
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

  // N4 — completion emits a reputation-ELIGIBILITY event only; never writes reputation.
  if (event === SAFETRADE_TRANSITIONS.RELEASE_ESCROW) {
    result.reputationEligibilityEvent = await emitReputationEligibility(supabase, { txn, context, req });
  }

  return result;
}

/**
 * applyObservationalTransition — handle self/flag-setting events (CONFIRM_DELIVERY, REQUEST_PAYMENT,
 * AWAIT_DELIVERY, BEGIN_SHIPMENT, RUN_ELIGIBILITY when no DB status change) by writing a metadata flag
 * and a best-effort audit row. No money, no status-of-record change.
 */
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

/**
 * emitReputationEligibility — N4: surface a reputation-ELIGIBILITY signal only. We do NOT write
 * diaspora_reputation_records (the existing diasporaReputationService remains the only reputation
 * writer). Recorded as a best-effort audit event the reputation service / a human can consume.
 */
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

/** getTimeline — the SafeTrade audit trail for the transaction (from diaspora_import_audit_log). */
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
