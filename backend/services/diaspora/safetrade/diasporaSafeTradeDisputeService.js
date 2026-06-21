/**
 * Phase 9 (Stage B) — SafeTrade DISPUTE service.
 *
 * Owns the dispute case lifecycle over the Phase 9 disputes tables (connect, don't duplicate):
 *  - createDispute   : open a case (reason/category, linked transaction/optional milestone), drive the
 *                      transaction to DISPUTED via the existing atomic RPC diaspora_safetrade_transition_atomic
 *                      (in-txn CRITICAL audit), and place a TEMPORARY sandbox payment HOLD on a held/funded
 *                      milestone (via the milestone service — sandbox only; live throws EXTERNAL_ACTIVATION_REQUIRED).
 *  - addEvidence / addStatement : append-only evidence/statements with participant-privacy visibility.
 *  - assignReviewer  : reviewer/admin assignment (server-derived roles only).
 *  - resolveDispute  : reviewer/admin-only terminal resolution (refund / release / cancel). Money moves
 *                      ONLY through the sandbox provider (milestone service); high-risk release still requires
 *                      a passing release-policy evaluation. Never auto-releases; never writes reputation.
 *
 * Non-negotiables (directive §5.2): never moves real money (sandbox only); an ACTIVE dispute BLOCKS
 * release (the release policy reads it); release/refund are reviewer/admin-gated; critical transitions
 * fail atomically if their audit cannot be written (the core RPC writes audit in-txn); gated behind
 * DIASPORA_SAFETRADE_ENABLED. Server-derived roles only — the client x-stakeholder-role is never read.
 */
import { resolveClient, requestCorrelationId, appendCriticalAudit, appendBestEffortAudit } from '../diasporaServiceUtils.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../utils/errors.js';
import {
  isSafeTradeEnabled,
  isSafeTradeLivePaymentEnabled,
  resolveSafeTradeProvider,
  SAFETRADE_POLICY_VERSION,
} from '../../../constants/diaspora/diasporaSafeTradeConstants.js';
import {
  requireUserContext,
  isPlatformAdmin,
  isPlatformReviewer,
  isTenantAdminForRecord,
  normalizeId,
} from '../diasporaAuthorization.js';
import { recordMilestone, SAFETRADE_MILESTONE_MONEY_OPS } from './diasporaSafeTradeMilestoneService.js';

// Stable dispute categories / statuses / resolutions (mirror the migration CHECKs).
export const SAFETRADE_DISPUTE_CATEGORIES = Object.freeze({
  ITEM_NOT_AS_DESCRIBED: 'ITEM_NOT_AS_DESCRIBED',
  ITEM_NOT_RECEIVED: 'ITEM_NOT_RECEIVED',
  DAMAGED_IN_TRANSIT: 'DAMAGED_IN_TRANSIT',
  DOCUMENT_DISCREPANCY: 'DOCUMENT_DISCREPANCY',
  COMPLIANCE_CONCERN: 'COMPLIANCE_CONCERN',
  PAYMENT_DISCREPANCY: 'PAYMENT_DISCREPANCY',
  FRAUD_SUSPECTED: 'FRAUD_SUSPECTED',
  DELIVERY_TIMEOUT: 'DELIVERY_TIMEOUT',
  OTHER: 'OTHER',
});

export const SAFETRADE_DISPUTE_STATUSES = Object.freeze({
  OPEN: 'OPEN',
  UNDER_REVIEW: 'UNDER_REVIEW',
  AWAITING_INFO: 'AWAITING_INFO',
  RESOLVED: 'RESOLVED',
  REJECTED: 'REJECTED',
  WITHDRAWN: 'WITHDRAWN',
  CANCELLED: 'CANCELLED',
});

// Non-terminal statuses that count as an ACTIVE dispute (blocks release).
export const SAFETRADE_ACTIVE_DISPUTE_STATUSES = Object.freeze([
  SAFETRADE_DISPUTE_STATUSES.OPEN,
  SAFETRADE_DISPUTE_STATUSES.UNDER_REVIEW,
  SAFETRADE_DISPUTE_STATUSES.AWAITING_INFO,
]);

export const SAFETRADE_DISPUTE_RESOLUTIONS = Object.freeze({
  REFUND: 'REFUND',
  RELEASE: 'RELEASE',
  CANCEL: 'CANCEL',
  PARTIAL_REFUND: 'PARTIAL_REFUND',
  DISMISSED: 'DISMISSED',
  NO_ACTION: 'NO_ACTION',
});

const EVIDENCE_VISIBILITY = Object.freeze({
  PARTICIPANTS: 'PARTICIPANTS',
  REVIEWERS_ONLY: 'REVIEWERS_ONLY',
  AUTHOR_ONLY: 'AUTHOR_ONLY',
});

// Milestone statuses where funds are notionally held (a temp HOLD on open is meaningful here).
const HELD_MILESTONE_STATUSES = new Set(['FUNDED', 'HELD', 'RELEASE_REVIEW', 'RELEASE_AUTHORIZED']);

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

// Server-derived role token for an actor relative to a transaction (audit/record only — never trusted input).
function deriveActorRole(context, txn) {
  if (isPlatformAdmin(context)) return 'ADMIN';
  if (isPlatformReviewer(context)) return 'REVIEWER';
  const actorId = normalizeId(context.id);
  if (normalizeId(txn.buyer_id) === actorId || normalizeId(txn.created_by) === actorId) return 'BUYER';
  if (normalizeId(txn.seller_id) === actorId) return 'SELLER';
  return 'SYSTEM';
}

function isParticipant(txn, context) {
  const actorId = normalizeId(context.id);
  return [txn.buyer_id, txn.seller_id, txn.created_by, txn.updated_by].some((c) => normalizeId(c) === actorId);
}

function assertCanAccessTransaction(txn, context) {
  if (isParticipant(txn, context) || isPrivileged(context, txn)) return;
  throw new ForbiddenError('You do not have access to this SafeTrade transaction');
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

async function fetchDispute(supabase, disputeId) {
  const { data, error } = await supabase
    .from('diaspora_safetrade_disputes')
    .select('*')
    .eq('id', disputeId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error || !data) throw new NotFoundError('SafeTrade dispute not found');
  return data;
}

async function loadActiveDispute(supabase, transactionId) {
  const { data } = await supabase
    .from('diaspora_safetrade_disputes')
    .select('*')
    .eq('transaction_id', transactionId)
    .is('deleted_at', null)
    .in('status', SAFETRADE_ACTIVE_DISPUTE_STATUSES);
  return (data || [])[0] || null;
}

/**
 * hasActiveDispute — read helper used by callers/the release policy to confirm there is no open case.
 * Fails CLOSED (returns true) if the disputes table is unreadable, so release can never silently proceed.
 */
export async function hasActiveDispute(supabaseOrOptions, { transactionId, options = {} } = {}) {
  const supabase = await resolveSafeTradeClient(supabaseOrOptions, options);
  try {
    const active = await loadActiveDispute(supabase, transactionId);
    return Boolean(active);
  } catch {
    return true; // fail closed — an unreadable disputes table must not unblock release
  }
}

/**
 * createDispute — open a dispute case, drive the transaction to DISPUTED through the atomic RPC (in-txn
 * CRITICAL audit), and place a TEMPORARY sandbox payment HOLD on a held/funded milestone when one exists.
 * Buyer, seller, reviewer or admin may open. Idempotent: a re-open while a case is active returns it.
 */
export async function createDispute(supabaseOrOptions, {
  transactionId,
  milestoneId = null,
  category = SAFETRADE_DISPUTE_CATEGORIES.OTHER,
  reason,
  evidence = null,
  placeHold = true,
  idempotencyKey = null,
  userContext = {},
  req = null,
  options = {},
} = {}) {
  assertEnabled();
  const context = requireUserContext(userContext);
  const supabase = await resolveSafeTradeClient(supabaseOrOptions, options);

  if (!reason || !String(reason).trim()) throw new ValidationError('A dispute reason is required');
  if (!SAFETRADE_DISPUTE_CATEGORIES[category] && !Object.values(SAFETRADE_DISPUTE_CATEGORIES).includes(category)) {
    throw new ValidationError(`Unknown dispute category: ${category}`);
  }

  const txn = await fetchTransaction(supabase, transactionId);
  assertCanAccessTransaction(txn, context);

  // Buyer, seller, reviewer or admin may raise; anyone else (non-participant, non-privileged) is blocked
  // by assertCanAccessTransaction above. Record the server-derived role.
  const raisedByRole = deriveActorRole(context, txn);

  // Idempotency / single active case: an active dispute already exists → return it (no duplicate).
  const existingActive = await loadActiveDispute(supabase, transactionId);
  if (existingActive) {
    return { dispute: existingActive, idempotentReplay: true, holdPlaced: Boolean(existingActive.hold_placed) };
  }

  const tenantId = txn.tenant_id ?? context.tenantId ?? null;

  // 1. Drive the transaction to DISPUTED via the core atomic RPC (in-txn CRITICAL audit, idempotency).
  //    Only attempt when the current DB status legally allows it (the RPC is authoritative; on an
  //    illegal edge it raises INVALID_TRANSITION, which we surface — we never force-set the status).
  let transitioned = null;
  if (txn.status !== 'DISPUTED') {
    const { data: rpcData, error: rpcError } = await supabase.rpc('diaspora_safetrade_transition_atomic', {
      p_transaction_id: transactionId,
      p_milestone_id: null,
      p_actor_id: context.id,
      p_tenant_id: tenantId,
      p_actor_is_privileged: isPrivileged(context, txn),
      p_target_status: 'DISPUTED',
      p_evaluation_id: null,
      p_payment_provider: resolveSafeTradeProvider(),
      p_live_payment: isSafeTradeLivePaymentEnabled(),
      p_idempotency_key: idempotencyKey ? `${idempotencyKey}:dispute-open` : null,
      p_reason: `dispute opened (${category})`,
      p_metadata: { event: 'RAISE_DISPUTE', category, raisedByRole },
      p_correlation_id: requestCorrelationId(req),
      p_source: 'service',
    });
    if (rpcError) throw mapRpcError(rpcError);
    transitioned = rpcData?.transaction ?? null;
  }

  // 2. Insert the dispute case record.
  const { data: dispute, error: insertError } = await supabase
    .from('diaspora_safetrade_disputes')
    .insert({
      tenant_id: tenantId,
      transaction_id: transactionId,
      milestone_id: milestoneId,
      import_order_id: txn.import_order_id,
      raised_by: context.id,
      raised_by_role: raisedByRole,
      category,
      reason: String(reason).trim(),
      status: SAFETRADE_DISPUTE_STATUSES.OPEN,
      hold_placed: false,
      policy_version: SAFETRADE_POLICY_VERSION,
      metadata: { safetrade: { openedVia: 'service' } },
      created_by: context.id,
      updated_by: context.id,
    })
    .select()
    .single();
  if (insertError) throw new ValidationError(`Failed to open dispute: ${insertError.message}`);

  // 3. CRITICAL audit of the dispute open (fail-loud).
  await appendCriticalAudit(supabase, {
    importOrderId: txn.import_order_id,
    tenantId,
    actorId: context.id,
    action: 'SAFETRADE_DISPUTE_RAISED',
    resourceType: 'diaspora_safetrade_dispute',
    resourceId: dispute.id,
    previousState: { transactionStatus: txn.status },
    newState: { disputeStatus: dispute.status, transactionStatus: transitioned?.status ?? txn.status },
    metadata: { category, raisedByRole, reason: dispute.reason, correlationId: requestCorrelationId(req) },
    req,
  });

  // 4. Place a TEMPORARY sandbox payment HOLD on a held/funded milestone (sandbox only; live throws).
  let holdResult = null;
  if (placeHold) {
    holdResult = await placeTemporaryHold(supabase, {
      txn, dispute, milestoneId, context, idempotencyKey, req, options,
    });
  }

  // 5. Optional first evidence/statement supplied at open time.
  if (evidence && (evidence.statement || evidence.documentRef || evidence.evidenceRefs)) {
    await addEvidence(supabase, {
      disputeId: dispute.id,
      evidenceType: evidence.evidenceType || (evidence.statement ? 'STATEMENT' : 'OTHER'),
      statement: evidence.statement || null,
      documentRef: evidence.documentRef || null,
      evidenceRefs: evidence.evidenceRefs || [],
      visibility: evidence.visibility || EVIDENCE_VISIBILITY.PARTICIPANTS,
      userContext: context,
      req,
      options: { supabaseClient: supabase },
    });
  }

  // Return the current dispute (reflecting the hold flag written by placeTemporaryHold).
  const currentDispute = holdResult?.holdPlaced ? await fetchDispute(supabase, dispute.id) : dispute;

  return {
    dispute: currentDispute,
    transaction: transitioned,
    idempotentReplay: false,
    holdPlaced: Boolean(holdResult?.holdPlaced),
    hold: holdResult?.hold ?? null,
  };
}

// Milestone statuses where a (sandbox) escrow hold is ALREADY in place — no redundant money op needed.
const ALREADY_HELD_STATUSES = new Set(['FUNDED', 'HELD', 'RELEASE_REVIEW', 'RELEASE_AUTHORIZED']);
// Pre-hold statuses where a fresh sandbox HOLD can still be authorized to freeze in-flight funds.
const HOLDABLE_PRE_STATUSES = new Set(['DUE', 'FUNDS_PENDING']);

/**
 * placeTemporaryHold — record that escrow funds are (sandbox) frozen for the duration of the dispute.
 *  - If a milestone's funds are ALREADY held (FUNDED/HELD/RELEASE_*), the hold is already in effect: the
 *    active dispute itself blocks release (release policy ACTIVE_DISPUTE). We record hold_placed=true
 *    against the existing provider_reference WITHOUT a redundant (and illegal) money transition.
 *  - If funds are not yet held but the milestone is in a holdable pre-state, authorize a fresh sandbox
 *    HOLD via the milestone service (sandbox only; live throws EXTERNAL_ACTIVATION_REQUIRED).
 * Never moves real money. If no holdable milestone exists, records hold_placed=false (funds not captured);
 * release remains blocked by the open case regardless.
 */
async function placeTemporaryHold(supabase, { txn, dispute, milestoneId, context, idempotencyKey, req, options }) {
  const { data: milestoneRows } = await supabase
    .from('diaspora_safetrade_milestones')
    .select('*')
    .eq('transaction_id', txn.id)
    .is('deleted_at', null);
  const rows = milestoneRows || [];
  const pick = (set) => (milestoneId && rows.find((m) => m.id === milestoneId && set.has(m.status)))
    || rows.find((m) => set.has(m.status))
    || null;

  // Funds already held → the hold is in place; no money op (and no illegal milestone edge).
  const alreadyHeld = pick(ALREADY_HELD_STATUSES);
  if (alreadyHeld) {
    const holdReference = alreadyHeld.provider_reference || null;
    await supabase
      .from('diaspora_safetrade_disputes')
      .update({ hold_placed: true, hold_reference: holdReference, updated_by: context.id })
      .eq('id', dispute.id);
    await appendBestEffortAudit(supabase, {
      importOrderId: txn.import_order_id,
      tenantId: txn.tenant_id,
      actorId: context.id,
      action: 'SAFETRADE_DISPUTE_HOLD_PLACED',
      resourceType: 'diaspora_safetrade_dispute',
      resourceId: dispute.id,
      metadata: { milestoneId: alreadyHeld.id, holdReference, sandbox: true, alreadyHeld: true, correlationId: requestCorrelationId(req) },
      req,
    });
    return { holdPlaced: true, hold: null };
  }

  // Funds not yet held but in a holdable pre-state → authorize a fresh sandbox HOLD.
  const target = pick(HOLDABLE_PRE_STATUSES);
  if (!target) return { holdPlaced: false, hold: null };

  let hold = null;
  try {
    hold = await recordMilestone(supabase, {
      transactionId: txn.id,
      milestoneId: target.id,
      operation: SAFETRADE_MILESTONE_MONEY_OPS.HOLD,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:dispute-hold` : null,
      userContext: context,
      req,
      options: { ...options, supabaseClient: supabase },
    });
  } catch (err) {
    // A failed (sandbox) hold must not strand the dispute open; record it and let a reviewer act.
    await appendBestEffortAudit(supabase, {
      importOrderId: txn.import_order_id,
      tenantId: txn.tenant_id,
      actorId: context.id,
      action: 'SAFETRADE_DISPUTE_HOLD_FAILED',
      resourceType: 'diaspora_safetrade_dispute',
      resourceId: dispute.id,
      metadata: { milestoneId: target.id, error: err?.message, correlationId: requestCorrelationId(req) },
      req,
    });
    return { holdPlaced: false, hold: null };
  }

  const holdReference = hold?.provider?.holdRef || hold?.provider?.intentId || target.provider_reference || null;
  await supabase
    .from('diaspora_safetrade_disputes')
    .update({ hold_placed: true, hold_reference: holdReference, updated_by: context.id })
    .eq('id', dispute.id);

  await appendBestEffortAudit(supabase, {
    importOrderId: txn.import_order_id,
    tenantId: txn.tenant_id,
    actorId: context.id,
    action: 'SAFETRADE_DISPUTE_HOLD_PLACED',
    resourceType: 'diaspora_safetrade_dispute',
    resourceId: dispute.id,
    metadata: { milestoneId: target.id, holdReference, sandbox: true, correlationId: requestCorrelationId(req) },
    req,
  });

  return { holdPlaced: true, hold };
}

/**
 * addEvidence — append an evidence/statement row to a dispute (append-only). Participants and reviewers
 * may add; visibility controls who can later read it (participant privacy). Best-effort audit.
 */
export async function addEvidence(supabaseOrOptions, {
  disputeId,
  evidenceType = 'STATEMENT',
  statement = null,
  documentRef = null,
  evidenceRefs = [],
  visibility = EVIDENCE_VISIBILITY.PARTICIPANTS,
  userContext = {},
  req = null,
  options = {},
} = {}) {
  assertEnabled();
  const context = requireUserContext(userContext);
  const supabase = await resolveSafeTradeClient(supabaseOrOptions, options);

  const dispute = await fetchDispute(supabase, disputeId);
  const txn = await fetchTransaction(supabase, dispute.transaction_id);
  assertCanAccessTransaction(txn, context);

  if (!EVIDENCE_VISIBILITY[visibility]) throw new ValidationError(`Unknown evidence visibility: ${visibility}`);
  if (evidenceType === 'STATEMENT' && (!statement || !String(statement).trim())) {
    throw new ValidationError('A statement is required for STATEMENT evidence');
  }

  // Non-reviewers cannot post REVIEWERS_ONLY evidence (would leak the channel intent).
  const privileged = isPrivileged(context, txn);
  const effectiveVisibility = (visibility === EVIDENCE_VISIBILITY.REVIEWERS_ONLY && !privileged)
    ? EVIDENCE_VISIBILITY.PARTICIPANTS
    : visibility;

  const authorRole = deriveActorRole(context, txn);

  const { data, error } = await supabase
    .from('diaspora_safetrade_dispute_evidence')
    .insert({
      tenant_id: txn.tenant_id ?? context.tenantId ?? null,
      dispute_id: disputeId,
      transaction_id: dispute.transaction_id,
      evidence_type: evidenceType,
      author_id: context.id,
      author_role: authorRole,
      visibility: effectiveVisibility,
      statement: statement ? String(statement).trim() : null,
      document_ref: documentRef,
      evidence_refs: Array.isArray(evidenceRefs) ? evidenceRefs : [],
      metadata: { correlationId: requestCorrelationId(req) },
      created_by: context.id,
      updated_by: context.id,
    })
    .select()
    .single();
  if (error) throw new ValidationError(`Failed to add dispute evidence: ${error.message}`);

  await appendBestEffortAudit(supabase, {
    importOrderId: txn.import_order_id,
    tenantId: txn.tenant_id,
    actorId: context.id,
    action: 'SAFETRADE_DISPUTE_EVIDENCE_ADDED',
    resourceType: 'diaspora_safetrade_dispute',
    resourceId: disputeId,
    metadata: { evidenceId: data.id, evidenceType, visibility: effectiveVisibility, authorRole, correlationId: requestCorrelationId(req) },
    req,
  });

  return data;
}

/** addStatement — convenience wrapper around addEvidence for a free-text statement. */
export async function addStatement(supabaseOrOptions, {
  disputeId, statement, visibility = EVIDENCE_VISIBILITY.PARTICIPANTS, userContext = {}, req = null, options = {},
} = {}) {
  return addEvidence(supabaseOrOptions, {
    disputeId, evidenceType: 'STATEMENT', statement, visibility, userContext, req, options,
  });
}

/**
 * listEvidence — read evidence with participant-privacy redaction. Reviewers/admins see everything;
 * participants see PARTICIPANTS + their own AUTHOR_ONLY rows, never REVIEWERS_ONLY or others' AUTHOR_ONLY.
 */
export async function listEvidence(supabaseOrOptions, { disputeId, userContext = {}, options = {} } = {}) {
  assertEnabled();
  const context = requireUserContext(userContext);
  const supabase = await resolveSafeTradeClient(supabaseOrOptions, options);
  const dispute = await fetchDispute(supabase, disputeId);
  const txn = await fetchTransaction(supabase, dispute.transaction_id);
  assertCanAccessTransaction(txn, context);

  const { data } = await supabase
    .from('diaspora_safetrade_dispute_evidence')
    .select('*')
    .eq('dispute_id', disputeId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });

  const rows = data || [];
  const privileged = isPrivileged(context, txn);
  if (privileged) return rows;

  const actorId = normalizeId(context.id);
  return rows.filter((r) => {
    if (r.visibility === EVIDENCE_VISIBILITY.REVIEWERS_ONLY) return false;
    if (r.visibility === EVIDENCE_VISIBILITY.AUTHOR_ONLY) return normalizeId(r.author_id) === actorId;
    return true; // PARTICIPANTS
  });
}

/**
 * assignReviewer — reviewer/admin-only: assign a reviewer to the case and move it to UNDER_REVIEW.
 * Server-derived roles only.
 */
export async function assignReviewer(supabaseOrOptions, {
  disputeId, reviewerId = null, userContext = {}, req = null, options = {},
} = {}) {
  assertEnabled();
  const context = requireUserContext(userContext);
  const supabase = await resolveSafeTradeClient(supabaseOrOptions, options);

  const dispute = await fetchDispute(supabase, disputeId);
  const txn = await fetchTransaction(supabase, dispute.transaction_id);
  if (!isPrivileged(context, txn)) {
    throw new ForbiddenError('Only a reviewer/admin may assign a dispute reviewer', { code: 'REVIEWER_REQUIRED' });
  }
  if (![SAFETRADE_DISPUTE_STATUSES.OPEN, SAFETRADE_DISPUTE_STATUSES.UNDER_REVIEW, SAFETRADE_DISPUTE_STATUSES.AWAITING_INFO].includes(dispute.status)) {
    throw new ValidationError(`Cannot assign a reviewer to a ${dispute.status} dispute`);
  }

  const assignedReviewerId = normalizeId(reviewerId) || context.id;
  const { data, error } = await supabase
    .from('diaspora_safetrade_disputes')
    .update({
      assigned_reviewer_id: assignedReviewerId,
      assigned_at: req?.fixedTimestamp || new Date().toISOString(),
      status: SAFETRADE_DISPUTE_STATUSES.UNDER_REVIEW,
      updated_by: context.id,
    })
    .eq('id', disputeId)
    .select()
    .single();
  if (error) throw new ValidationError(`Failed to assign reviewer: ${error.message}`);

  await appendCriticalAudit(supabase, {
    importOrderId: txn.import_order_id,
    tenantId: txn.tenant_id,
    actorId: context.id,
    action: 'SAFETRADE_DISPUTE_REVIEWER_ASSIGNED',
    resourceType: 'diaspora_safetrade_dispute',
    resourceId: disputeId,
    previousState: { status: dispute.status },
    newState: { status: SAFETRADE_DISPUTE_STATUSES.UNDER_REVIEW, assignedReviewerId },
    metadata: { correlationId: requestCorrelationId(req) },
    req,
  });

  return data;
}

/**
 * resolveDispute — reviewer/admin-only terminal resolution. Drives the resolution outcome:
 *   - REFUND  : reviewer/admin refunds a held milestone (sandbox provider, evaluation-gated in the RPC).
 *   - RELEASE : reviewer/admin releases escrow — re-evaluates the release policy (high-risk needs approval).
 *   - CANCEL / DISMISSED / NO_ACTION / PARTIAL_REFUND : record-only resolution; no money move here.
 * Money moves ONLY through the sandbox provider via the milestone service. Never auto-releases; the
 * dispute must be closed before release can proceed (an active dispute blocks release).
 */
export async function resolveDispute(supabaseOrOptions, {
  disputeId,
  resolution,
  milestoneId = null,
  evaluationId = null,
  notes = null,
  idempotencyKey = null,
  userContext = {},
  req = null,
  options = {},
} = {}) {
  assertEnabled();
  const context = requireUserContext(userContext);
  const supabase = await resolveSafeTradeClient(supabaseOrOptions, options);

  if (!Object.values(SAFETRADE_DISPUTE_RESOLUTIONS).includes(resolution)) {
    throw new ValidationError(`Unknown dispute resolution: ${resolution}`);
  }

  const dispute = await fetchDispute(supabase, disputeId);
  const txn = await fetchTransaction(supabase, dispute.transaction_id);

  // Resolution is reviewer/admin authority (N5) — buyers/sellers can never self-resolve.
  if (!isPrivileged(context, txn)) {
    throw new ForbiddenError('Only a reviewer/admin may resolve a dispute', { code: 'REVIEWER_REQUIRED' });
  }
  if (!SAFETRADE_ACTIVE_DISPUTE_STATUSES.includes(dispute.status)) {
    throw new ValidationError(`Dispute is already ${dispute.status}`);
  }

  const targetMilestoneId = milestoneId || dispute.milestone_id || null;

  // Drive the money outcome through the sandbox provider (milestone service) BEFORE closing the case.
  // RELEASE / REFUND are reviewer/admin + evaluation gated inside recordMilestone and the core RPC.
  let moneyResult = null;
  if (resolution === SAFETRADE_DISPUTE_RESOLUTIONS.REFUND || resolution === SAFETRADE_DISPUTE_RESOLUTIONS.RELEASE) {
    if (!targetMilestoneId) {
      throw new ValidationError(`A milestoneId is required to ${resolution} a dispute`);
    }
    const op = resolution === SAFETRADE_DISPUTE_RESOLUTIONS.REFUND
      ? SAFETRADE_MILESTONE_MONEY_OPS.REFUND
      : SAFETRADE_MILESTONE_MONEY_OPS.RELEASE;

    // Stage the milestone through the legal intermediate review/authorized states so the terminal money
    // op (recordMilestone REFUND→REFUNDED / RELEASE→RELEASED) is a valid single edge. These staging
    // transitions are reviewer/admin + evaluation gated inside the atomic RPC (N5), never moving money.
    await stageMilestoneForMoneyOp(supabase, {
      txn, milestoneId: targetMilestoneId, op, evaluationId, context, idempotencyKey, req,
    });

    moneyResult = await recordMilestone(supabase, {
      transactionId: dispute.transaction_id,
      milestoneId: targetMilestoneId,
      operation: op,
      evaluationId,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:resolve-${op}` : null,
      userContext: context,
      req,
      options: { ...options, supabaseClient: supabase },
    });
  }

  // Close the case.
  const terminalStatus = resolution === SAFETRADE_DISPUTE_RESOLUTIONS.DISMISSED
    ? SAFETRADE_DISPUTE_STATUSES.REJECTED
    : SAFETRADE_DISPUTE_STATUSES.RESOLVED;

  const { data: resolved, error } = await supabase
    .from('diaspora_safetrade_disputes')
    .update({
      status: terminalStatus,
      resolution,
      resolution_notes: notes,
      resolved_by: context.id,
      resolved_at: req?.fixedTimestamp || new Date().toISOString(),
      updated_by: context.id,
    })
    .eq('id', disputeId)
    .select()
    .single();
  if (error) throw new ValidationError(`Failed to resolve dispute: ${error.message}`);

  // CRITICAL audit of the resolution (fail-loud).
  await appendCriticalAudit(supabase, {
    importOrderId: txn.import_order_id,
    tenantId: txn.tenant_id,
    actorId: context.id,
    action: 'SAFETRADE_DISPUTE_RESOLVED',
    resourceType: 'diaspora_safetrade_dispute',
    resourceId: disputeId,
    previousState: { status: dispute.status },
    newState: { status: terminalStatus, resolution },
    metadata: {
      resolution,
      milestoneId: targetMilestoneId,
      moneyMoved: Boolean(moneyResult),
      providerStatus: moneyResult?.provider?.status ?? null,
      correlationId: requestCorrelationId(req),
    },
    req,
  });

  return { dispute: resolved, resolution, money: moneyResult };
}

/** getDispute — participant/privileged scoped read of a single case. */
export async function getDispute(supabaseOrOptions, { disputeId, userContext = {}, options = {} } = {}) {
  assertEnabled();
  const context = requireUserContext(userContext);
  const supabase = await resolveSafeTradeClient(supabaseOrOptions, options);
  const dispute = await fetchDispute(supabase, disputeId);
  const txn = await fetchTransaction(supabase, dispute.transaction_id);
  assertCanAccessTransaction(txn, context);
  return dispute;
}

/** listDisputes — disputes for a transaction (participant/privileged scoped). */
export async function listDisputes(supabaseOrOptions, { transactionId, userContext = {}, options = {} } = {}) {
  assertEnabled();
  const context = requireUserContext(userContext);
  const supabase = await resolveSafeTradeClient(supabaseOrOptions, options);
  const txn = await fetchTransaction(supabase, transactionId);
  assertCanAccessTransaction(txn, context);
  const { data } = await supabase
    .from('diaspora_safetrade_disputes')
    .select('*')
    .eq('transaction_id', transactionId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  return data || [];
}

// Legal milestone staging paths to the state from which the terminal money op is a single valid edge:
//   REFUND  → milestone must reach REFUND_REVIEW (then recordMilestone drives REFUND_REVIEW→REFUNDED).
//   RELEASE → milestone must reach RELEASE_AUTHORIZED (then recordMilestone drives RELEASE_AUTHORIZED→RELEASED).
// Keyed by current status → ordered list of intermediate targets to dispatch (mirrors the SQL allowlist).
const REFUND_STAGE_PATHS = Object.freeze({
  FUNDS_PENDING: ['REFUND_REVIEW'],
  FUNDED: ['REFUND_REVIEW'],
  HELD: ['REFUND_REVIEW'],
  RELEASE_REVIEW: ['REFUND_REVIEW'],
  RELEASE_AUTHORIZED: [], // RELEASE_AUTHORIZED has no legal edge to REFUND_REVIEW; reviewer must release or compensate
  REFUND_REVIEW: [],
});
const RELEASE_STAGE_PATHS = Object.freeze({
  HELD: ['RELEASE_REVIEW', 'RELEASE_AUTHORIZED'],
  RELEASE_REVIEW: ['RELEASE_AUTHORIZED'],
  RELEASE_AUTHORIZED: [],
});

/**
 * stageMilestoneForMoneyOp — drive a milestone through the legal intermediate review/authorized edges so
 * the terminal money op is valid. Each hop goes through the atomic transition RPC (in-txn CRITICAL audit,
 * reviewer/evaluation gated for RELEASE_AUTHORIZED). Never moves money itself; the RPC fails closed on
 * live/non-sandbox. A no-op when the milestone is already staged.
 */
async function stageMilestoneForMoneyOp(supabase, { txn, milestoneId, op, evaluationId, context, idempotencyKey, req }) {
  const milestone = await fetchMilestone(supabase, milestoneId);
  if (normalizeId(milestone.transaction_id) !== normalizeId(txn.id)) {
    throw new ValidationError('Milestone does not belong to the transaction');
  }
  const paths = op === SAFETRADE_MILESTONE_MONEY_OPS.REFUND ? REFUND_STAGE_PATHS : RELEASE_STAGE_PATHS;
  const hops = paths[milestone.status];
  if (hops === undefined) {
    throw new ValidationError(`Milestone in ${milestone.status} cannot be staged for ${op}`);
  }
  for (const target of hops) {
    const { error } = await supabase.rpc('diaspora_safetrade_transition_atomic', {
      p_transaction_id: txn.id,
      p_milestone_id: milestoneId,
      p_actor_id: context.id,
      p_tenant_id: txn.tenant_id ?? context.tenantId ?? null,
      p_actor_is_privileged: isPrivileged(context, txn),
      p_target_status: target,
      p_evaluation_id: evaluationId,
      p_payment_provider: resolveSafeTradeProvider(),
      p_live_payment: isSafeTradeLivePaymentEnabled(),
      p_idempotency_key: idempotencyKey ? `${idempotencyKey}:stage-${target}` : null,
      p_reason: `dispute resolution staging (${op})`,
      p_metadata: { event: 'DISPUTE_RESOLUTION_STAGE', op, target },
      p_correlation_id: requestCorrelationId(req),
      p_source: 'service',
    });
    if (error) throw mapRpcError(error);
  }
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

// Translate a Postgres/RPC error envelope into a typed CarUp error.
function mapRpcError(error) {
  const message = error?.message || 'SafeTrade dispute operation failed';
  if (/EXTERNAL_ACTIVATION_REQUIRED/.test(message)) return new ForbiddenError(message, { code: 'EXTERNAL_ACTIVATION_REQUIRED' });
  if (/FORBIDDEN|REVIEWER_REQUIRED/.test(message)) return new ForbiddenError(message, { code: 'FORBIDDEN' });
  if (/NOT_FOUND/.test(message)) return new NotFoundError(message);
  if (/IDEMPOTENCY_CONFLICT|INVALID_TRANSITION|EVALUATION_REQUIRED|NOT_ELIGIBLE|POLICY_VERSION_MISMATCH|TARGET_REQUIRED/.test(message)) {
    return new ValidationError(message, { code: message.split(':')[0] });
  }
  return new ValidationError(message);
}

export { EVIDENCE_VISIBILITY as SAFETRADE_EVIDENCE_VISIBILITY, HELD_MILESTONE_STATUSES as SAFETRADE_DISPUTE_HELD_STATUSES };
