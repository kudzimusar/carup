/**
 * Governance service — Milestone 5 (master plan §11).
 *
 * The human-accountability layer over the trust system. Reviewers act on AI/ingestion
 * findings through a single, audited decision path. Hard invariants:
 *
 *   1. applyDecision NEVER changes a trust score. It only moves a finding's reviewer_state
 *      (or an evidence verification_status) and records WHO decided WHAT and WHY.
 *   2. recordGovernedTrustChange is the ONLY function that writes trust_change_log — i.e.
 *      AI raw confidence can never become a trust value without a governed decision.
 *   3. Every decision is double-written: an append-only review_decisions row AND a
 *      trust_audit_events row (via the shared auditLogger), so accountability survives.
 *   4. Disputed / superseded findings can never render as confirmed-public.
 */
import { ValidationError, ForbiddenError, NotFoundError, DatabaseError } from '../../utils/errors.js';
import { logAuditEvent } from '../auditLogger.js';

const REVIEWER_ROLES = new Set(['admin', 'government', 'reviewer']);

// Decisions a reviewer may take against a finding/evidence target.
const DECISIONS = new Set([
  'confirm', 'reject', 'amend', 'request_more', 'inconclusive',
  'publish', 'unpublish', 'supersede', 'escalate',
]);

// reviewer_state CHECK on temporal_findings / disclosure_conflicts:
//   pending_review, confirmed, rejected, amended, inconclusive, superseded
const REVIEWER_STATE_MAP = {
  confirm: 'confirmed',
  reject: 'rejected',
  amend: 'amended',
  supersede: 'superseded',
  inconclusive: 'inconclusive',
  // request_more / escalate / publish / unpublish leave reviewer_state unchanged
  // (escalation/publication is tracked on the review_task + audit trail, not the
  // finding's CHECK-constrained reviewer_state column).
};

// vehicle_evidence.verification_status (timeline contract): pending/verified/rejected
const EVIDENCE_STATUS_MAP = {
  confirm: 'verified',
  reject: 'rejected',
  supersede: 'superseded',
  inconclusive: 'inconclusive',
  amend: 'amended',
};

const TARGETS = {
  temporal_findings: { table: 'temporal_findings', stateColumn: 'reviewer_state', map: REVIEWER_STATE_MAP },
  disclosure_conflicts: { table: 'disclosure_conflicts', stateColumn: 'reviewer_state', map: REVIEWER_STATE_MAP },
  vehicle_evidence: { table: 'vehicle_evidence', stateColumn: 'verification_status', map: EVIDENCE_STATUS_MAP },
  vehicle_identity_candidates: { table: 'vehicle_identity_candidates', stateColumn: 'status', map: { confirm: 'confirmed', reject: 'rejected', supersede: 'superseded' } },
};

// States that must never present as confirmed-public.
const NON_PUBLIC_STATES = new Set([
  'pending_review', 'pending', 'rejected', 'superseded', 'amended', 'inconclusive', 'disputed',
]);

function assertReviewer(reviewer) {
  const role = reviewer?.role || reviewer?.effectiveRole || reviewer?.platformRole;
  if (!reviewer || !reviewer.id) {
    throw new ForbiddenError('A reviewer context is required to act on a review task.');
  }
  if (!REVIEWER_ROLES.has(String(role).toLowerCase())) {
    throw new ForbiddenError(`Role '${role}' is not permitted to apply governance decisions.`);
  }
  return String(role).toLowerCase();
}

/**
 * Aggregate every pending review item across the trust system into one queue.
 * Optionally filter by master-plan task type.
 */
export async function listReviewQueue(supabase, { taskType } = {}) {
  const sources = [
    {
      task_type: 'temporal_finding',
      target_type: 'temporal_findings',
      table: 'temporal_findings',
      column: 'reviewer_state',
      value: 'pending_review',
    },
    {
      task_type: 'disclosure_conflict',
      target_type: 'disclosure_conflicts',
      table: 'disclosure_conflicts',
      column: 'reviewer_state',
      value: 'pending_review',
    },
    {
      task_type: 'vehicle_identity',
      target_type: 'vehicle_identity_candidates',
      table: 'vehicle_identity_candidates',
      column: 'status',
      value: 'pending',
    },
    {
      task_type: 'evidence_verification',
      target_type: 'vehicle_evidence',
      table: 'vehicle_evidence',
      column: 'verification_status',
      value: 'pending',
    },
  ];

  const selected = taskType ? sources.filter((s) => s.task_type === taskType) : sources;
  const queue = [];

  for (const source of selected) {
    const { data, error } = await supabase
      .from(source.table)
      .select('*')
      .eq(source.column, source.value)
      .order('created_at', { ascending: true });

    if (error) {
      throw new DatabaseError(`Failed to load ${source.table} review queue: ${error.message}`);
    }

    for (const row of data || []) {
      queue.push({
        task_type: source.task_type,
        target_type: source.target_type,
        target_id: row.id,
        vin: row.vin || null,
        state: row[source.column],
        confidence: row.confidence ?? null,
        severity: row.severity ?? null,
        created_at: row.created_at || null,
        summary: row.public_summary || row.notes || null,
      });
    }
  }

  return queue;
}

/**
 * Apply a governed reviewer decision against a finding / evidence record.
 *
 * Moves the target row's state, writes an APPEND-ONLY review_decisions row and a
 * trust_audit_events row. It NEVER touches a trust score — trust changes only ever
 * happen through recordGovernedTrustChange.
 */
export async function applyDecision(supabase, {
  targetType,
  targetId,
  vin,
  decision,
  reviewer,
  notes,
  policyVersion,
  reviewTaskId = null,
  correlationId = null,
}) {
  const reviewerRole = assertReviewer(reviewer);

  if (!DECISIONS.has(decision)) {
    throw new ValidationError(`Unsupported decision '${decision}'.`);
  }

  const target = TARGETS[targetType];
  if (!target) {
    throw new ValidationError(`Unsupported review target '${targetType}'.`);
  }
  if (!targetId) {
    throw new ValidationError('targetId is required to apply a decision.');
  }

  // Load the target row for before/after state + scope checks.
  const { data: before, error: loadError } = await supabase
    .from(target.table)
    .select('*')
    .eq('id', targetId)
    .single();

  if (loadError || !before) {
    throw new NotFoundError(`Review target ${targetType}:${targetId} was not found.`);
  }

  const nextState = target.map[decision];
  let after = before;

  if (nextState) {
    const patch = { [target.stateColumn]: nextState, updated_at: new Date().toISOString() };
    const { data: updated, error: updateError } = await supabase
      .from(target.table)
      .update(patch)
      .eq('id', targetId)
      .select('*')
      .single();

    if (updateError) {
      throw new DatabaseError(`Failed to update ${target.table}: ${updateError.message}`);
    }
    after = updated || { ...before, ...patch };
  }

  const conflictOfInterest = Boolean(
    before.created_by && reviewer.id && before.created_by === reviewer.id
  );

  // Append-only accountability record.
  const { data: decisionRow, error: decisionError } = await supabase
    .from('review_decisions')
    .insert({
      review_task_id: reviewTaskId,
      target_type: target.table,
      target_id: String(targetId),
      vin: vin || before.vin || null,
      reviewer_id: reviewer.id,
      reviewer_role: reviewerRole,
      decision,
      notes: notes || null,
      policy_version: policyVersion || null,
      before_state: { [target.stateColumn]: before[target.stateColumn] },
      after_state: { [target.stateColumn]: after[target.stateColumn] },
      correlation_id: correlationId,
      conflict_of_interest: conflictOfInterest,
    })
    .select('*')
    .single();

  if (decisionError || !decisionRow) {
    throw new DatabaseError(`Failed to record review decision: ${decisionError?.message || 'unknown error'}`);
  }

  // Mirror into the central trust audit trail (never throws fatally).
  await logAuditEvent(supabase, {
    event_type: 'GOVERNANCE_DECISION_APPLIED',
    vin: vin || before.vin || null,
    targetType: target.table,
    targetId: String(targetId),
    previous_value: { [target.stateColumn]: before[target.stateColumn] },
    new_value: { [target.stateColumn]: after[target.stateColumn] },
    actor_user_id: reviewer.id,
    actor_role: reviewerRole,
    reason: notes || null,
    metadata: { decision, policy_version: policyVersion || null, conflict_of_interest: conflictOfInterest },
  });

  // If a review_task drove this, advance/close it (escalate -> escalated; else resolved).
  if (reviewTaskId) {
    const taskStatus = decision === 'escalate' ? 'escalated' : (decision === 'request_more' ? 'in_review' : 'resolved');
    await supabase
      .from('review_tasks')
      .update({ status: taskStatus, decision_id: decisionRow.id, updated_at: new Date().toISOString() })
      .eq('id', reviewTaskId);
  }

  return decisionRow;
}

/**
 * The ONLY path that records a trust change. AI raw confidence must never become a
 * trust value directly — a governed review decision must back every entry here.
 */
export async function recordGovernedTrustChange(supabase, {
  vin,
  rule,
  evidenceIds = [],
  previous,
  newValue,
  approvedBy,
  approvedByRole,
  reviewDecisionId,
}) {
  if (!vin) throw new ValidationError('vin is required for a governed trust change.');
  if (!rule) throw new ValidationError('rule is required for a governed trust change.');
  if (!reviewDecisionId) {
    throw new ValidationError('A backing reviewDecisionId is required — trust may only change via a governed decision.');
  }

  const { data, error } = await supabase
    .from('trust_change_log')
    .insert({
      vin,
      rule,
      evidence_ids: Array.isArray(evidenceIds) ? evidenceIds.map(String) : [],
      previous_value: previous ?? null,
      new_value: newValue ?? null,
      approved_by: approvedBy || null,
      approved_by_role: approvedByRole || null,
      review_decision_id: reviewDecisionId,
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new DatabaseError(`Failed to record governed trust change: ${error?.message || 'unknown error'}`);
  }

  await logAuditEvent(supabase, {
    event_type: 'GOVERNED_TRUST_CHANGE',
    vin,
    trust_fact: rule,
    previous_value: previous ?? null,
    new_value: newValue ?? null,
    actor_user_id: approvedBy || null,
    actor_role: approvedByRole || null,
    evidence_ids: evidenceIds,
    metadata: { review_decision_id: reviewDecisionId },
  });

  return data;
}

/**
 * Public-safe projection helper. A disputed / superseded / pending finding must never
 * present to non-privileged callers as confirmed-public. Returns a neutral shape with a
 * public_state flag downstream views can rely on.
 */
export function publicSafeDisputeState(row) {
  if (!row) return null;
  const state = String(
    row.reviewer_state ?? row.verification_status ?? row.status ?? ''
  ).toLowerCase();
  const disputed = state === 'disputed' || row.disputed === true || row.under_dispute === true;
  const isPublic = !disputed && (state === 'confirmed' || state === 'verified');

  return {
    target_id: row.id ?? null,
    vin: row.vin ?? null,
    public_state: isPublic ? 'confirmed_public' : 'not_public',
    disputed,
    public_summary: isPublic ? (row.public_summary ?? null) : null,
  };
}

export const __testing = { REVIEWER_STATE_MAP, EVIDENCE_STATUS_MAP, NON_PUBLIC_STATES, REVIEWER_ROLES };
