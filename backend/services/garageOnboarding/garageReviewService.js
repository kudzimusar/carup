import { supabase as defaultClient } from '../../db/supabase.js';
import { logAuditEvent } from '../auditLogger.js';
import { getIdentityAssurance } from '../identity/identityAssuranceService.js';
import { listEvidence, garageEvidenceStorage, GARAGE_EVIDENCE_BUCKET } from './garageEvidenceService.js';
import { ForbiddenError, NotFoundError, ValidationError, DatabaseError, ConflictError } from '../../utils/errors.js';

/**
 * GMO-3 — the reviewer's side of a garage application (ported by OC-5E from PR #209 6425e905).
 *
 * PO-3 fixes who this is: an authorised CarUp Operations / Compliance reviewer, gated by the
 * canonical machinery (a real session → `requireOperationsCapability` → X3 step-up), exactly as
 * dealer compliance decisions already are. This service does the deciding and nothing else.
 *
 * **A decision is not an activation.** `approve` records a judgment: status, who made it, when, and
 * why. It creates no tenant and no membership — that is GMO-4's single job, and the schema enforces
 * the ordering (`activated_tenant_id` is refused unless the row is already approved).
 *
 * **Approved is not verified.** Nothing here claims CarUp checked the business. An approved garage
 * may still truthfully display "CarUp has not independently verified this garage" (PO-2).
 *
 * OC-5E, beyond #209:
 *   - the decision is ONE transaction (`record_garage_application_decision`, 20261004190000): #209
 *     wrote the ledger row and then a guarded status update, so the loser of a race left a ledger
 *     entry for a decision that never applied;
 *   - a reviewer never sees an application the applicant has not submitted (#209's `?status=draft`
 *     listed drafts, and a draft's id opened it).
 */

/** What a reviewer may see: everything the applicant has handed to CarUp — never a draft. */
export const REVIEW_VISIBLE = Object.freeze(['submitted', 'under_review', 'information_required', 'approved', 'rejected']);
/** The default queue: applications waiting on CarUp or on the applicant. */
const REVIEW_QUEUE = Object.freeze(['submitted', 'under_review', 'information_required']);

export const REVIEW_DECISIONS = Object.freeze(['start_review', 'request_more_info', 'approve', 'reject']);

/** A decision that closes or pauses someone's livelihood must say why. */
const REASON_REQUIRED = Object.freeze(['request_more_info', 'reject']);

const EVIDENCE_PREVIEW_TTL_SECONDS = 180;

function requireReviewer(actor = {}) {
  const userId = actor.id || actor.userId;
  if (!userId) throw new ValidationError('A reviewer identity is required to act on an application.');
  return userId;
}

/**
 * trust_audit_events has no target column: the normalizer keeps a target id only for vehicle,
 * evidence and PartSentry targets, and reads `previous_value` (not `old_value`). #209's rows said
 * "a reviewer approved something" without saying what. Every event here carries its subject's ids
 * in the values themselves.
 */
async function writeAudit(client, event) {
  const result = await logAuditEvent(client, event);
  if (!result.success) {
    throw new Error(`Garage review audit failed: ${result.error || result.fallbackError || 'unknown error'}`);
  }
}

/** A reviewer-visible application, or NotFound — a draft is not CarUp's to read. */
async function loadVisibleApplication(client, applicationId) {
  const { data, error } = await client
    .from('garage_applications')
    .select('*')
    .eq('id', applicationId)
    .maybeSingle();
  if (error) throw new DatabaseError(`Could not load this application: ${error.message}`);
  if (!data || !REVIEW_VISIBLE.includes(data.status)) throw new NotFoundError('Application not found.');
  return data;
}

/**
 * The review queue.
 *
 * A failed read raises. An empty queue and a broken queue look identical to a reviewer otherwise,
 * and the difference is whether people are waiting. Asking for a status a reviewer may not see is
 * refused, not answered with an empty list.
 */
export async function listApplicationsForReview(client = defaultClient, options = {}) {
  const requested = options.statuses?.length ? options.statuses : REVIEW_QUEUE;
  const hidden = requested.filter((status) => !REVIEW_VISIBLE.includes(status));
  if (hidden.length) {
    throw new ValidationError(`status must be among: ${REVIEW_VISIBLE.join(', ')}. An unsubmitted application is not visible to reviewers.`);
  }
  const { data, error } = await client
    .from('garage_applications')
    .select('*')
    .in('status', requested)
    .order('submitted_at', { ascending: true });
  if (error) throw new DatabaseError(`Could not load the review queue: ${error.message}`);
  return { applications: data || [], statuses: requested };
}

async function readIdentity(client, applicantUserId, deps = {}) {
  // Identity is a prerequisite, so a failure to read it must not present as "not verified" — that
  // would turn an outage into a refusal against a person who did everything asked of them.
  try {
    const assurance = deps.getIdentityAssurance || getIdentityAssurance;
    return { identity: await assurance(client, applicantUserId), identityError: null };
  } catch (err) {
    return { identity: null, identityError: err.message };
  }
}

/**
 * Everything a reviewer needs to decide, gathered in one read.
 *
 * The applicant's identity assurance is included because PO-2 makes governed person-identity
 * approval a prerequisite for activation. It is O2's answer (identity_assurance.v1), consumed here —
 * never re-derived, and never inferred from the application's own contents.
 */
export async function getApplicationForReview(client = defaultClient, applicationId, deps = {}) {
  const application = await loadVisibleApplication(client, applicationId);

  const { data: decisions, error: decisionsError } = await client
    .from('garage_application_decisions')
    .select('*')
    .eq('application_id', applicationId)
    .order('created_at', { ascending: false });
  if (decisionsError) throw new DatabaseError(`Could not load this application's history: ${decisionsError.message}`);

  const documents = await listEvidence(client, applicationId, { includeRemoved: true });
  const { identity, identityError } = await readIdentity(client, application.applicant_user_id, deps);

  return {
    application,
    decisions: decisions || [],
    documents,
    identity,
    identity_error: identityError,
    // Server-derived, so the browser renders what it is told rather than deciding what is possible.
    allowed_decisions: allowedDecisions(application.status),
    blocking: approvalBlockers(application, documents, identity, identityError),
  };
}

/** Which decisions this status can accept. The UI renders this; it never computes its own. */
export function allowedDecisions(status) {
  if (status === 'submitted') return ['start_review', 'request_more_info', 'approve', 'reject'];
  if (status === 'under_review') return ['request_more_info', 'approve', 'reject'];
  // An application waiting on the applicant is not the reviewer's to move; they resubmit it.
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

/** The database's refusal, in the reviewer's words; anything else is a failure, not a finding. */
function decisionRefusal(error) {
  const message = String(error?.message || '');
  if (message.includes('GARAGE_APPLICATION_NOT_FOUND')) return new NotFoundError('Application not found.');
  if (message.includes('GARAGE_DECISION_SELF')) return new ForbiddenError('You cannot decide your own garage application.');
  if (message.includes('GARAGE_DECISION_REASON_REQUIRED')) {
    return new ValidationError('Tell the applicant why. A decision that pauses or closes an application must carry a reason.');
  }
  if (message.includes('GARAGE_DECISION_CONFLICT')) {
    return new ConflictError('This application changed while you were deciding. Open it again — your decision was not applied.');
  }
  if (message.includes('GARAGE_DECISION_UNKNOWN')) return new ValidationError(`decision must be one of: ${REVIEW_DECISIONS.join(', ')}.`);
  return new DatabaseError(`Could not record this decision: ${message}`);
}

/**
 * Record a reviewer's decision.
 *
 * Everything that needs another domain (governed identity, the live evidence) is checked here,
 * first; the transition itself — lock, state check, ledger row, status — is one database
 * transaction (`record_garage_application_decision`), so two reviewers acting at once cannot both
 * win and the loser leaves no trace.
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

  const current = await loadVisibleApplication(client, applicationId);

  // A reviewer must never be the applicant. Self-approval is the shortest path from "I applied" to
  // "I have a workspace", and no capability check catches it. (The database refuses it again.)
  if (String(current.applicant_user_id) === String(reviewerId)) {
    throw new ForbiddenError('You cannot decide your own garage application.');
  }

  if (!allowedDecisions(current.status).includes(decision)) {
    throw new ConflictError(
      current.status === 'information_required'
        ? 'This application is waiting on the applicant. It comes back to you when they send it again.'
        : `This application is ${current.status.replace(/_/g, ' ')} and cannot be ${decision.replace(/_/g, ' ')}.`,
    );
  }

  if (decision === 'approve') {
    const documents = await listEvidence(client, applicationId, { includeRemoved: true });
    const { identity, identityError } = await readIdentity(client, current.applicant_user_id, options);
    const blockers = approvalBlockers(current, documents, identity, identityError);
    if (blockers.length) {
      throw new ValidationError(`This application cannot be approved yet. ${blockers.join(' ')}`);
    }
  }

  const reasonCode = input.reason_code ? String(input.reason_code).trim().slice(0, 80) : null;
  const { data: outcome, error } = await client.rpc('record_garage_application_decision', {
    p_application_id: applicationId,
    p_decision: decision,
    p_actor_user_id: String(reviewerId),
    p_actor_role: actor.role || null,
    p_reason_code: reasonCode,
    p_reason: reason || null,
  });
  if (error) throw decisionRefusal(error);
  if (!outcome?.application) throw new DatabaseError('The decision returned no application.');

  await writeAudit(client, {
    req: options.req,
    event_type: 'GARAGE_APPLICATION_DECISION',
    actor_user_id: reviewerId,
    actor_role: actor.role,
    source_route: '/api/admin/garage-applications/:id/decision',
    targetType: 'garage_application',
    targetId: applicationId,
    previous_value: { application_id: applicationId, status: outcome.from_status },
    new_value: {
      application_id: applicationId,
      decision_id: outcome.decision?.id || null,
      status: outcome.to_status,
      decision,
      reason_code: reasonCode,
    },
  });

  if (typeof options.emitDomainEvent === 'function') {
    await options.emitDomainEvent(null, `garage.application.${decision}`, {
      applicationId,
      applicantUserId: current.applicant_user_id,
      recipientUserId: current.applicant_user_id,
      reviewerUserId: reviewerId,
      status: outcome.to_status,
      reason: reason || null,
    }).catch((e) => console.error(`garage.application.${decision} not emitted:`, e?.message || e));
  }

  return { application: outcome.application, decision: outcome.decision };
}

/** Reviewer preview of a private document. Sensitive, so the route composes X3 step-up. Audited. */
export async function getEvidencePreviewForReview(client = defaultClient, actor = {}, applicationId, documentId, options = {}) {
  const reviewerId = requireReviewer(actor);
  // A draft's evidence is the applicant's own until they hand the application to CarUp.
  await loadVisibleApplication(client, applicationId);
  const { data: doc, error } = await client
    .from('garage_application_documents')
    .select('*')
    .eq('id', documentId)
    .eq('application_id', applicationId)
    .maybeSingle();
  if (error) throw new DatabaseError(`Could not load that document: ${error.message}`);
  if (!doc || !doc.file_ref) throw new NotFoundError('Document not found on this application.');

  const storage = options.storage || garageEvidenceStorage;
  const url = await storage.generateSecureReadUrl(GARAGE_EVIDENCE_BUCKET, doc.file_ref, EVIDENCE_PREVIEW_TTL_SECONDS);
  if (!url) throw new Error('Could not generate a preview link.');

  // Audited BEFORE the link is handed over: a preview nobody can account for is not handed out.
  await writeAudit(client, {
    req: options.req,
    event_type: 'GARAGE_EVIDENCE_PREVIEWED_BY_REVIEWER',
    actor_user_id: reviewerId,
    actor_role: actor.role,
    source_route: '/api/admin/garage-applications/:id/evidence/:docId/preview',
    targetType: 'garage_application_document',
    targetId: documentId,
    new_value: { application_id: applicationId, document_id: documentId, ttl_seconds: EVIDENCE_PREVIEW_TTL_SECONDS },
  });

  return { url, expiresInSeconds: EVIDENCE_PREVIEW_TTL_SECONDS };
}
