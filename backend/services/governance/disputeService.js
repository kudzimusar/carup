/**
 * Dispute service — Milestone 5 (master plan §11).
 *
 * The seller/owner dispute lifecycle over published findings:
 *   open -> responded -> independent_review -> resolved (-> appealed)
 *
 * Every transition appends an IMMUTABLE dispute_event so the history is always
 * reconstructable. resolveDispute can supersede/correct the public finding while
 * retaining the full history (it never deletes the original record).
 */
import { ValidationError, ForbiddenError, NotFoundError, DatabaseError } from '../../utils/errors.js';
import { logAuditEvent } from '../auditLogger.js';
import { applyDecision } from './governanceService.js';

const RAISE_ROLES = new Set(['owner', 'dealer', 'admin']);
const REVIEWER_ROLES = new Set(['admin', 'government', 'reviewer']);

// Default seller response window (master plan §11.5): 7 days.
const RESPONSE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function roleOf(actor) {
  return String(actor?.role || actor?.effectiveRole || actor?.platformRole || '').toLowerCase();
}

async function appendEvent(supabase, disputeId, { eventType, actor, details = {} }) {
  const { error } = await supabase
    .from('dispute_events')
    .insert({
      dispute_id: disputeId,
      event_type: eventType,
      actor_id: actor?.id || null,
      actor_role: roleOf(actor) || null,
      details,
    });
  if (error) {
    throw new DatabaseError(`Failed to append dispute event: ${error.message}`);
  }
}

async function loadDispute(supabase, id) {
  const { data, error } = await supabase.from('disputes').select('*').eq('id', id).single();
  if (error || !data) {
    throw new NotFoundError(`Dispute ${id} was not found.`);
  }
  return data;
}

export async function submitDispute(supabase, actor, { vin, subjectType, subjectId, reason }) {
  const role = roleOf(actor);
  if (!actor?.id || !RAISE_ROLES.has(role)) {
    throw new ForbiddenError(`Role '${role}' is not permitted to raise a dispute.`);
  }
  if (!subjectType || !subjectId) {
    throw new ValidationError('subjectType and subjectId are required to raise a dispute.');
  }

  const responseDeadline = new Date(Date.now() + RESPONSE_WINDOW_MS).toISOString();
  const { data, error } = await supabase
    .from('disputes')
    .insert({
      vin: vin || null,
      subject_type: subjectType,
      subject_id: String(subjectId),
      raised_by: actor.id,
      raised_by_role: role,
      status: 'open',
      response_deadline: responseDeadline,
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new DatabaseError(`Failed to create dispute: ${error?.message || 'unknown error'}`);
  }

  await appendEvent(supabase, data.id, {
    eventType: 'dispute_opened',
    actor,
    details: { reason: reason || null, subject_type: subjectType, subject_id: String(subjectId) },
  });
  await logAuditEvent(supabase, {
    event_type: 'DISPUTE_OPENED',
    vin: vin || null,
    targetType: subjectType,
    targetId: String(subjectId),
    actor_user_id: actor.id,
    actor_role: role,
    reason: reason || null,
  });

  return data;
}

export async function respondToDispute(supabase, actor, disputeId, { response }) {
  const dispute = await loadDispute(supabase, disputeId);
  if (!response) {
    throw new ValidationError('A response is required.');
  }

  const { data, error } = await supabase
    .from('disputes')
    .update({ status: 'responded', updated_at: new Date().toISOString() })
    .eq('id', disputeId)
    .select('*')
    .single();
  if (error) {
    throw new DatabaseError(`Failed to update dispute: ${error.message}`);
  }

  await appendEvent(supabase, disputeId, {
    eventType: 'dispute_response',
    actor,
    details: { response },
  });

  return data || { ...dispute, status: 'responded' };
}

export async function assignIndependentReviewer(supabase, actor, disputeId, { reviewerId }) {
  const role = roleOf(actor);
  if (!REVIEWER_ROLES.has(role)) {
    throw new ForbiddenError(`Role '${role}' cannot assign an independent reviewer.`);
  }
  const dispute = await loadDispute(supabase, disputeId);
  if (!reviewerId) {
    throw new ValidationError('reviewerId is required.');
  }
  if (reviewerId === dispute.raised_by) {
    throw new ValidationError('An independent reviewer cannot be the party who raised the dispute.');
  }

  const { data, error } = await supabase
    .from('disputes')
    .update({ status: 'independent_review', assigned_reviewer: reviewerId, updated_at: new Date().toISOString() })
    .eq('id', disputeId)
    .select('*')
    .single();
  if (error) {
    throw new DatabaseError(`Failed to assign reviewer: ${error.message}`);
  }

  await appendEvent(supabase, disputeId, {
    eventType: 'independent_reviewer_assigned',
    actor,
    details: { reviewer_id: reviewerId },
  });

  return data || { ...dispute, status: 'independent_review', assigned_reviewer: reviewerId };
}

/**
 * Resolve a dispute. Optionally supersede/correct the public finding via a governed
 * decision (which retains the original record + full history). Never deletes anything.
 */
export async function resolveDispute(supabase, actor, disputeId, {
  resolution,
  outcome,
  targetType,
  targetId,
  policyVersion,
}) {
  const role = roleOf(actor);
  if (!REVIEWER_ROLES.has(role)) {
    throw new ForbiddenError(`Role '${role}' cannot resolve a dispute.`);
  }
  const dispute = await loadDispute(supabase, disputeId);
  if (!resolution) {
    throw new ValidationError('A resolution is required.');
  }

  let correctionDecisionId = null;
  // outcome 'upheld' => correct/supersede the public finding through the governed path.
  if (outcome === 'upheld' && targetType && targetId) {
    const decision = await applyDecision(supabase, {
      targetType,
      targetId,
      vin: dispute.vin,
      decision: 'supersede',
      reviewer: actor,
      notes: `Dispute ${disputeId} upheld: ${resolution}`,
      policyVersion,
    });
    correctionDecisionId = decision.id;
  }

  const { data, error } = await supabase
    .from('disputes')
    .update({ status: 'resolved', resolution, updated_at: new Date().toISOString() })
    .eq('id', disputeId)
    .select('*')
    .single();
  if (error) {
    throw new DatabaseError(`Failed to resolve dispute: ${error.message}`);
  }

  await appendEvent(supabase, disputeId, {
    eventType: 'dispute_resolved',
    actor,
    details: { resolution, outcome: outcome || null, correction_decision_id: correctionDecisionId },
  });
  await logAuditEvent(supabase, {
    event_type: 'DISPUTE_RESOLVED',
    vin: dispute.vin || null,
    targetType: dispute.subject_type,
    targetId: dispute.subject_id,
    actor_user_id: actor.id,
    actor_role: role,
    reason: resolution,
    metadata: { outcome: outcome || null, correction_decision_id: correctionDecisionId },
  });

  return data || { ...dispute, status: 'resolved', resolution };
}

export async function appealDispute(supabase, actor, disputeId, { reason }) {
  const role = roleOf(actor);
  if (!actor?.id || !RAISE_ROLES.has(role)) {
    throw new ForbiddenError(`Role '${role}' is not permitted to appeal a dispute.`);
  }
  const dispute = await loadDispute(supabase, disputeId);
  if (dispute.status !== 'resolved') {
    throw new ValidationError('Only a resolved dispute can be appealed.');
  }

  const { data, error } = await supabase
    .from('disputes')
    .update({ status: 'appealed', updated_at: new Date().toISOString() })
    .eq('id', disputeId)
    .select('*')
    .single();
  if (error) {
    throw new DatabaseError(`Failed to appeal dispute: ${error.message}`);
  }

  await appendEvent(supabase, disputeId, {
    eventType: 'dispute_appealed',
    actor,
    details: { reason: reason || null },
  });

  return data || { ...dispute, status: 'appealed' };
}
