/**
 * SafeTrade maker-checker approvals (ST-3 item 2 — Issue #127).
 *
 * Two independent humans are required for a HIGH-risk release or refund: the MAKER, who evaluates and
 * requests, and the CHECKER, who approves. Three separate layers enforce it, because a single layer is
 * a single bug away from failing open:
 *
 *   1. this service refuses an approver who is the requester;
 *   2. ledger #21's CHECK constraint makes `approved_by = requested_by` unrepresentable, so even a
 *      direct service-role write cannot record a self-approval;
 *   3. ledger #22's transition RPC re-reads the approval under the row lock, re-checks both halves,
 *      refuses when the evaluator is the transitioning actor, and CONSUMES the approval so it can
 *      never bless a second release.
 *
 * Approvals expire. An approval minted for a decision made an hour ago should not authorize a release
 * next week, when the evidence it rested on may no longer hold.
 */
import { resolveClient, appendCriticalAudit } from '../diasporaServiceUtils.js';
import { ForbiddenError, ValidationError, NotFoundError } from '../../../utils/errors.js';

export const SAFETRADE_APPROVALS_TABLE = 'diaspora_safetrade_approvals';

export const APPROVAL_STATE = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
  CONSUMED: 'consumed',
});

export const DECISION_TYPES = Object.freeze(['release', 'refund', 'partial_refund', 'dispute_resolution']);

/** Default approval lifetime. Long enough for a human to act, short enough that stale evidence expires. */
export const APPROVAL_TTL_MINUTES = 60;

/** Only these decisions require the second human. Mirrors the RPC's `risk_level = 'HIGH'` test. */
export function requiresMakerChecker({ riskLevel } = {}) {
  return String(riskLevel || '').toUpperCase() === 'HIGH';
}

function assertPrivileged(userContext) {
  const role = String(userContext?.role || '').toLowerCase();
  const privileged = ['admin', 'platform_admin', 'super_admin', 'government', 'government_reviewer', 'reviewer'];
  if (!userContext?.id || !privileged.includes(role)) {
    throw new ForbiddenError('SafeTrade approvals are restricted to platform reviewers and administrators');
  }
}

/**
 * MAKER step: request approval for a high-risk money decision.
 * The requester is always taken from the server-derived user context, never from the request body —
 * otherwise a caller could name someone else as maker and then approve as themselves.
 */
export async function requestApproval({
  tenantId,
  transactionId,
  milestoneId = null,
  decisionType,
  evaluationId = null,
  riskLevel = 'HIGH',
  amount = null,
  currency = null,
  reason = null,
  ttlMinutes = APPROVAL_TTL_MINUTES,
  userContext,
  supabaseClient = null,
  req = null,
} = {}) {
  assertPrivileged(userContext);
  if (!tenantId) throw new ValidationError('An approval request requires a tenant');
  if (!transactionId) throw new ValidationError('An approval request requires a transaction');
  if (!DECISION_TYPES.includes(decisionType)) {
    throw new ValidationError(`Unknown approval decision type: ${decisionType}`);
  }

  const supabase = await resolveClient({ supabaseClient });
  const expiresAt = new Date(Date.now() + Math.max(1, Number(ttlMinutes) || APPROVAL_TTL_MINUTES) * 60000).toISOString();

  const { data, error } = await supabase
    .from(SAFETRADE_APPROVALS_TABLE)
    .insert({
      tenant_id: tenantId,
      transaction_id: transactionId,
      milestone_id: milestoneId,
      decision_type: decisionType,
      evaluation_id: evaluationId,
      risk_level: String(riskLevel || 'HIGH').toUpperCase(),
      amount,
      currency,
      requested_by: userContext.id,
      requested_reason: reason ? String(reason).slice(0, 1000) : null,
      state: APPROVAL_STATE.PENDING,
      expires_at: expiresAt,
    })
    .select()
    .single();
  if (error) throw new ValidationError(`Failed to request SafeTrade approval: ${error.message}`);

  await appendCriticalAudit(supabase, {
    tenantId,
    actorId: userContext.id,
    action: 'SAFETRADE_APPROVAL_REQUESTED',
    resourceType: 'diaspora_safetrade_approval',
    resourceId: data.id,
    newState: { decisionType, riskLevel: data.risk_level, expiresAt },
    req,
  });

  return data;
}

/**
 * CHECKER step: a DIFFERENT privileged human approves.
 * Self-approval is refused here, and again by the DB constraint, and again by the RPC.
 */
export async function approve({
  approvalId,
  userContext,
  notes = null,
  supabaseClient = null,
  req = null,
} = {}) {
  assertPrivileged(userContext);
  const supabase = await resolveClient({ supabaseClient });
  const approval = await getApproval(approvalId, { supabaseClient: supabase });
  if (!approval) throw new NotFoundError('Approval not found');

  if (approval.state !== APPROVAL_STATE.PENDING) {
    throw new ValidationError(`This approval is ${approval.state} and can no longer be approved`);
  }
  if (approval.expires_at && new Date(approval.expires_at) <= new Date()) {
    await supabase.from(SAFETRADE_APPROVALS_TABLE).update({ state: APPROVAL_STATE.EXPIRED }).eq('id', approvalId);
    throw new ValidationError('This approval has expired and must be requested again');
  }
  // Layer 1 of 3. The DB constraint and the RPC repeat it independently.
  if (approval.requested_by === userContext.id) {
    throw new ForbiddenError('The requester of a high-risk decision cannot approve it (maker-checker separation)');
  }

  const { data, error } = await supabase
    .from(SAFETRADE_APPROVALS_TABLE)
    .update({
      state: APPROVAL_STATE.APPROVED,
      approved_by: userContext.id,
      approved_at: new Date().toISOString(),
      metadata: { ...(approval.metadata || {}), approverNotes: notes ? String(notes).slice(0, 1000) : null },
    })
    .eq('id', approvalId)
    .eq('state', APPROVAL_STATE.PENDING) // lost-update guard: two checkers racing, one wins
    .select()
    .maybeSingle();
  if (error) throw new ValidationError(`Failed to approve SafeTrade decision: ${error.message}`);
  if (!data) throw new ValidationError('This approval was already actioned by someone else');

  await appendCriticalAudit(supabase, {
    tenantId: approval.tenant_id,
    actorId: userContext.id,
    action: 'SAFETRADE_APPROVAL_GRANTED',
    resourceType: 'diaspora_safetrade_approval',
    resourceId: approvalId,
    previousState: { state: APPROVAL_STATE.PENDING, requestedBy: approval.requested_by },
    newState: { state: APPROVAL_STATE.APPROVED, approvedBy: userContext.id },
    req,
  });

  return data;
}

export async function reject({ approvalId, userContext, reason = null, supabaseClient = null, req = null } = {}) {
  assertPrivileged(userContext);
  const supabase = await resolveClient({ supabaseClient });
  const approval = await getApproval(approvalId, { supabaseClient: supabase });
  if (!approval) throw new NotFoundError('Approval not found');
  if (approval.state !== APPROVAL_STATE.PENDING) {
    throw new ValidationError(`This approval is ${approval.state} and can no longer be rejected`);
  }

  const { data, error } = await supabase
    .from(SAFETRADE_APPROVALS_TABLE)
    .update({
      state: APPROVAL_STATE.REJECTED,
      rejection_reason: reason ? String(reason).slice(0, 1000) : null,
      // A rejection is still recorded against the rejecting human, but `approved_by` stays NULL so the
      // shape constraint and every "was this approved" query remain unambiguous.
      metadata: { ...(approval.metadata || {}), rejectedBy: userContext.id },
    })
    .eq('id', approvalId)
    .eq('state', APPROVAL_STATE.PENDING)
    .select()
    .maybeSingle();
  if (error) throw new ValidationError(`Failed to reject SafeTrade decision: ${error.message}`);
  if (!data) throw new ValidationError('This approval was already actioned by someone else');

  await appendCriticalAudit(supabase, {
    tenantId: approval.tenant_id,
    actorId: userContext.id,
    action: 'SAFETRADE_APPROVAL_REJECTED',
    resourceType: 'diaspora_safetrade_approval',
    resourceId: approvalId,
    newState: { state: APPROVAL_STATE.REJECTED },
    req,
  });
  return data;
}

export async function getApproval(approvalId, { supabaseClient = null } = {}) {
  if (!approvalId) return null;
  const supabase = await resolveClient({ supabaseClient });
  const { data, error } = await supabase
    .from(SAFETRADE_APPROVALS_TABLE).select('*').eq('id', approvalId).maybeSingle();
  if (error) throw new ValidationError(`Failed to read SafeTrade approval: ${error.message}`);
  return data || null;
}

/** Pending approvals a checker can act on. Tenant-scoped; never returns another tenant's queue. */
export async function listPendingApprovals({ tenantId, userContext, supabaseClient = null } = {}) {
  assertPrivileged(userContext);
  if (!tenantId) throw new ValidationError('Listing approvals requires a tenant');
  const supabase = await resolveClient({ supabaseClient });
  const { data, error } = await supabase
    .from(SAFETRADE_APPROVALS_TABLE)
    .select('id, transaction_id, milestone_id, decision_type, risk_level, amount, currency, requested_by, requested_at, requested_reason, expires_at, state')
    .eq('tenant_id', tenantId)
    .eq('state', APPROVAL_STATE.PENDING)
    .order('requested_at', { ascending: true })
    .limit(200);
  if (error) throw new ValidationError(`Failed to list SafeTrade approvals: ${error.message}`);

  // The UI must be able to grey out an approval the current viewer is not allowed to grant, without
  // the backend ever relying on that greying-out for enforcement.
  return (data || []).map((row) => ({
    ...row,
    canApprove: row.requested_by !== userContext.id,
    selfApprovalBlocked: row.requested_by === userContext.id,
  }));
}
