import { supabase as defaultClient } from '../../db/supabase.js';
import { logAuditEvent } from '../auditLogger.js';
import { getIdentityAssurance } from '../identity/identityAssuranceService.js';
import { generateSecureReadUrl } from '../storage/storageService.js';
import { listEvidence, GARAGE_EVIDENCE_BUCKET } from './garageEvidenceService.js';
import { ForbiddenError, NotFoundError, ValidationError, DatabaseError, ConflictError } from '../../utils/errors.js';

/**
 * GMO-3 — the reviewer's side of a garage application.
 *
 * PO-3 fixes who this is: an authorised CarUp Operations / Compliance reviewer, gated by the
 * canonical machinery (`authorizeRole` → `requireOperationsCapability` → X3 step-up), exactly as
 * dealer compliance decisions already are. This service does the deciding and nothing else.
 *
 * **A decision is not an activation.** `approve` records a judgment: status, who made it, when, and
 * why. It creates no tenant and no membership — that is GMO-4's single job, and the schema enforces
 * the ordering (`activated_tenant_id` is refused unless the row is already approved). Keeping the
 * two apart is what makes activation idempotent and independently testable.
 *
 * **Approved is not verified.** Nothing here claims CarUp checked the business. An approved garage
 * may still truthfully display "CarUp has not independently verified this garage" — PO-2 was
 * explicit, and no field written here contradicts it.
 */

const REVIEWABLE = Object.freeze(['submitted', 'under_review', 'information_required']);
const DECIDABLE = Object.freeze(['submitted', 'under_review']);

export const REVIEW_DECISIONS = Object.freeze(['start_review', 'request_more_info', 'approve', 'reject']);

/** Where each decision leaves the application. */
const RESULTING_STATUS = Object.freeze({
  start_review: 'under_review',
  request_more_info: 'information_required',
  approve: 'approved',
  reject: 'rejected',
});

/** A decision that closes or pauses someone's livelihood must say why. */
const REASON_REQUIRED = Object.freeze(['request_more_info', 'reject']);

const EVIDENCE_PREVIEW_TTL_SECONDS = 180;

function requireReviewer(actor = {}) {
  const userId = actor.id || actor.userId;
  if (!userId) throw new ValidationError('A reviewer identity is required to act on an application.');
  return userId;
}

async function writeAudit(client, event) {
  const result = await logAuditEvent(client, event);
  if (!result.success) {
    throw new Error(`Garage review audit failed: ${result.error || result.fallbackError || 'unknown error'}`);
  }
}

/**
 * The review queue.
 *
 * A failed read raises. An empty queue and a broken queue look identical to a reviewer otherwise,
 * and the difference is whether people are waiting.
 */
export async function listApplicationsForReview(client = defaultClient, options = {}) {
  const statuses = options.statuses?.length ? options.statuses : REVIEWABLE;
  const { data, error } = await client
    .from('garage_applications')
    .select('*')
    .in('status', statuses)
    .order('submitted_at', { ascending: true });
  if (error) throw new DatabaseError(`Could not load the review queue: ${error.message}`);
  return { applications: data || [], statuses };
}

/**
 * Everything a reviewer needs to decide, gathered in one read.
 *
 * The applicant's identity assurance is included because PO-2 makes governed person-identity
 * approval a prerequisite for activation. It is O2's answer, consumed here — never re-derived, and
 * never inferred from the application's own contents.
 */
export async function getApplicationForReview(client = defaultClient, applicationId, deps = {}) {
  const { data, error } = await client
    .from('garage_applications')
    .select('*')
    .eq('id', applicationId)
    .maybeSingle();
  if (error) throw new DatabaseError(`Could not load this application: ${error.message}`);
  if (!data) throw new NotFoundError('Application not found.');

  const { data: decisions, error: decisionsError } = await client
    .from('garage_application_decisions')
    .select('*')
    .eq('application_id', applicationId)
    .order('created_at', { ascending: false });
  if (decisionsError) throw new DatabaseError(`Could not load this application's history: ${decisionsError.message}`);

  const documents = await listEvidence(client, applicationId, { includeRemoved: true });

  // Identity is a prerequisite, so a failure to read it must not present as "not verified" — that
  // would turn an outage into a refusal against a person who did everything asked of them.
  let identity = null;
  let identityError = null;
  try {
    const assurance = deps.getIdentityAssurance || getIdentityAssurance;
    identity = await assurance(client, data.applicant_user_id);
  } catch (err) {
    identityError = err.message;
  }

  return {
    application: data,
    decisions: decisions || [],
    documents,
    identity,
    identity_error: identityError,
    // Server-derived, so the browser renders what it is told rather than deciding what is possible.
    allowed_decisions: allowedDecisions(data.status),
    blocking: approvalBlockers(data, documents, identity, identityError),
  };
}

/** Which decisions this status can accept. The UI renders this; it never computes its own. */
export function allowedDecisions(status) {
  if (status === 'submitted') return ['start_review', 'request_more_info', 'approve', 'reject'];
  if (status === 'under_review') return ['request_more_info', 'approve', 'reject'];
  // An application waiting on the applicant is not the reviewer's to move; they resubmit it.
  if (status === 'information_required') return [];
  return [];
}

/**
 * What stands between this application and approval, in the reviewer's words.
 *
 * These are PO-2's minimum activation conditions, checked as facts rather than assumed. A reviewer
 * is still the one who decides — this list exists so nobody approves a garage whose applicant has
 * no governed identity, which would put an unverified person inside a real workspace.
 */
export function approvalBlockers(application, documents = [], identity = null, identityError = null) {
  const blockers = [];
  if (identityError) {
    blockers.push('The applicant\'s identity status could not be read just now. This is a system problem, not a finding against them — try again before deciding.');
  } else if (!identity) {
    blockers.push('No identity record was found for this applicant.');
  } else if (identity.usable_for_identity_gated_actions !== true) {
    blockers.push(`The applicant's identity is not approved (${identity.identity_state || 'unknown state'}). Person identity must be approved before a garage workspace is created.`);
  }
  const live = (documents || []).filter((d) => !d.removed_at);
  if (live.length === 0) {
    blockers.push('No business-presence evidence has been provided.');
  }
  return blockers;
}

/**
 * Record a reviewer's decision.
 *
 * The status transition is guarded against the state that was read, so two reviewers acting on the
 * same application at once cannot both win. The ledger entry is written FIRST: a decision that
 * moved an application but left no record of who made it is worse than one that failed outright.
 */
export async function recordDecision(client = defaultClient, actor = {}, applicationId, input = {}, options = {}) {
  const reviewerId = requireReviewer(actor);
  const decision = String(input.decision || '').trim();

  if (!REVIEW_DECISIONS.includes(decision)) {
    throw new ValidationError(`decision must be one of: ${REVIEW_DECISIONS.join(', ')}.`);
  }
  const reason = input.reason ? String(input.reason).trim() : '';
  if (REASON_REQUIRED.includes(decision) && !reason) {
    throw new ValidationError('Tell the applicant why. A decision that pauses or closes an application must carry a reason.');
  }

  const { data: current, error: readError } = await client
    .from('garage_applications')
    .select('*')
    .eq('id', applicationId)
    .maybeSingle();
  if (readError) throw new DatabaseError(`Could not load this application: ${readError.message}`);
  if (!current) throw new NotFoundError('Application not found.');

  // A reviewer must never be the applicant. Self-approval is the shortest path from "I applied" to
  // "I have a workspace", and no capability check catches it.
  if (String(current.applicant_user_id) === String(reviewerId)) {
    throw new ForbiddenError('You cannot decide your own garage application.');
  }

  const permitted = allowedDecisions(current.status);
  if (!permitted.includes(decision)) {
    throw new ConflictError(
      current.status === 'information_required'
        ? 'This application is waiting on the applicant. It comes back to you when they send it again.'
        : `This application is ${current.status.replace(/_/g, ' ')} and cannot be ${decision.replace(/_/g, ' ')}.`,
    );
  }

  if (decision === 'approve') {
    const documents = await listEvidence(client, applicationId, { includeRemoved: true });
    let identity = null;
    let identityError = null;
    try {
      const assurance = options.getIdentityAssurance || getIdentityAssurance;
      identity = await assurance(client, current.applicant_user_id);
    } catch (err) {
      identityError = err.message;
    }
    const blockers = approvalBlockers(current, documents, identity, identityError);
    if (blockers.length) {
      throw new ValidationError(`This application cannot be approved yet. ${blockers.join(' ')}`);
    }
  }

  const nextStatus = RESULTING_STATUS[decision];
  const terminal = decision === 'approve' || decision === 'reject';
  const now = new Date().toISOString();

  const { data: ledgerRow, error: ledgerError } = await client
    .from('garage_application_decisions')
    .insert({
      application_id: applicationId,
      decision,
      reason_code: input.reason_code ? String(input.reason_code).trim().slice(0, 80) : null,
      reason: reason || null,
      actor_user_id: reviewerId,
      actor_role: actor.role || null,
    })
    .select()
    .single();
  if (ledgerError) throw new DatabaseError(`Could not record this decision: ${ledgerError.message}`);

  const patch = {
    status: nextStatus,
    updated_at: now,
    ...(terminal
      ? {
        decided_at: now,
        decided_by_user_id: reviewerId,
        decision_reason_code: input.reason_code ? String(input.reason_code).trim().slice(0, 80) : null,
        decision_reason: reason || null,
      }
      : {}),
  };

  const { data: updated, error: updateError } = await client
    .from('garage_applications')
    .update(patch)
    .eq('id', applicationId)
    // Only move a row still in the state this decision was made against.
    .in('status', DECIDABLE)
    .select()
    .maybeSingle();
  if (updateError) throw new DatabaseError(`Could not apply this decision: ${updateError.message}`);
  if (!updated) {
    throw new ConflictError('This application changed while you were deciding. Open it again — your decision was not applied.');
  }

  await writeAudit(client, {
    req: options.req,
    event_type: 'GARAGE_APPLICATION_DECISION',
    actor_user_id: reviewerId,
    actor_role: actor.role,
    source_route: '/api/admin/garage-applications/:id/decision',
    targetType: 'garage_application',
    targetId: applicationId,
    old_value: { status: current.status },
    new_value: { status: nextStatus, decision, reason_code: patch.decision_reason_code || null },
  });

  if (typeof options.emitDomainEvent === 'function') {
    await options.emitDomainEvent(null, `garage.application.${decision}`, {
      applicationId,
      applicantUserId: current.applicant_user_id,
      recipientUserId: current.applicant_user_id,
      reviewerUserId: reviewerId,
      status: nextStatus,
      reason: reason || null,
    }).catch((e) => console.error(`garage.application.${decision} not emitted:`, e?.message || e));
  }

  return { application: updated, decision: ledgerRow };
}

/** Reviewer preview of a private document. Sensitive, so the route composes X3 step-up. Audited. */
export async function getEvidencePreviewForReview(client = defaultClient, actor = {}, applicationId, documentId, options = {}) {
  const reviewerId = requireReviewer(actor);
  const { data: doc, error } = await client
    .from('garage_application_documents')
    .select('*')
    .eq('id', documentId)
    .eq('application_id', applicationId)
    .maybeSingle();
  if (error) throw new DatabaseError(`Could not load that document: ${error.message}`);
  if (!doc || !doc.file_ref) throw new NotFoundError('Document not found on this application.');

  const storage = options.storage || { generateSecureReadUrl };
  const url = await storage.generateSecureReadUrl(GARAGE_EVIDENCE_BUCKET, doc.file_ref, EVIDENCE_PREVIEW_TTL_SECONDS);
  if (!url) throw new Error('Could not generate a preview link.');

  await writeAudit(client, {
    req: options.req,
    event_type: 'GARAGE_EVIDENCE_PREVIEWED_BY_REVIEWER',
    actor_user_id: reviewerId,
    actor_role: actor.role,
    source_route: '/api/admin/garage-applications/:id/evidence/:docId/preview',
    targetType: 'garage_application_document',
    targetId: documentId,
    new_value: { application_id: applicationId, ttl_seconds: EVIDENCE_PREVIEW_TTL_SECONDS },
  });

  return { url, expiresInSeconds: EVIDENCE_PREVIEW_TTL_SECONDS };
}
