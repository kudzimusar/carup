/**
 * Phase 7C — Append-only verification decision persistence.
 *
 * Every reviewer action produces an immutable decision record. The legacy
 * verification_sessions row is updated for compatibility, but the authoritative
 * audit trail is in verification_decisions.
 */

import crypto from 'crypto';
import { supabase } from '../../db/supabase.js';
import { emitDomainEvent } from '../eventBus/eventBusService.js';
import { logAuditEvent } from '../auditLogger.js';
import { logger } from '../../utils/logger.js';
import { DecisionPolicyEngine } from './decisionPolicy.js';
import {
  DECISION_ACTION,
  decisionToLegacyStatus,
  decisionToDisposition,
  decisionToPhase,
  WORKFLOW_PHASE,
  LEGACY_REVIEWABLE_STATUSES,
} from './caseWorkflow.js';
import { getReasonConfig, REASON_CODES } from './reasonCodes.js';
import { onVerificationApproved } from './identityLifecycleService.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';

// Decisions that materially change the applicant's verification outcome and
// therefore surface to the applicant through the communication engine.
// Internal-only actions (escalate, internal notes) never notify the applicant.
const APPLICANT_FACING_DECISIONS = Object.freeze([
  DECISION_ACTION.APPROVE,
  DECISION_ACTION.REQUEST_RESUBMISSION,
  DECISION_ACTION.REJECT,
]);

export class VerificationDecisionRecorder {
  /**
   * May a reviewer action move the case's PRIMARY reason to `incomingCode`?
   *
   * The approve gate reads the case's primary reason. Every action used to write the reviewer's code
   * over it, so a system-assigned blocker could be relaxed by a later action: a submission the
   * classifier refused as a non-document (DOCUMENT_NOT_VISIBLE, not approvable) could be escalated
   * with OTHER (approvable) and then approved (PC01-F F1; violates PO ruling §12D invariant 4:
   * "NON_DOCUMENT → blocked even if text was extracted", and invariant 9).
   *
   *   - REQUEST_RESUBMISSION and REJECT assign the case's reason, as before. The first sends the case
   *     back to the applicant, where approval is refused anyway; the second closes it.
   *   - An escalation, an internal note (and an approval's annotation) may TIGHTEN or replace a
   *     reason, but may never replace a blocking evidence/quality/document/extraction/identity/
   *     system/fraud/biometric reason with an approvable one. Those are facts about the evidence; only
   *     new evidence (a resubmission) changes them. The reviewer's own code is always kept on the
   *     action's immutable decision row.
   *   - The one blocking category a reviewer may lift is `escalation` (SPECIALIST_REVIEW_REQUIRED). The
   *     system never assigns it — it is a reviewer's own workflow marker — and once a case is escalated
   *     a note is the ONLY action left that can resolve it (escalate and reject are refused there), so
   *     the specialist resolution path stays exactly as it was.
   */
  static mayChangePrimaryReason(action, currentCode, incomingCode) {
    if (!incomingCode) return false;
    if (action === DECISION_ACTION.REQUEST_RESUBMISSION || action === DECISION_ACTION.REJECT) return true;
    if (!currentCode) return true;
    const current = REASON_CODES[currentCode] || null;
    const incoming = REASON_CODES[incomingCode] || null;
    if (!current || !incoming) return false;
    const relaxes = current.approveAllowed === false && incoming.approveAllowed === true;
    return !(relaxes && current.category !== 'escalation');
  }

  /**
   * Record a decision and update the session.
   * All legacy fields are synchronized for existing compatibility.
   */
  static async recordDecision(client, {
    session,
    action,
    reasonCode,
    internalNote,
    applicantMessage,
    reviewerId,
    reviewerRole,
    currentWorkflowPhase,
    req,
  }) {
    const timestamp = new Date().toISOString();

    // Validate action
    if (!Object.values(DECISION_ACTION).includes(action)) {
      throw new ValidationError(`Unsupported decision action: ${action}`);
    }

    // Validate reason code for certain actions
    if (action === DECISION_ACTION.REQUEST_RESUBMISSION || action === DECISION_ACTION.REJECT) {
      if (!reasonCode) {
        throw new ValidationError('A reason code is required for this action.');
      }
      const reasonConfig = getReasonConfig(reasonCode);
      if (!reasonConfig) {
        throw new ValidationError(`Unknown reason code: ${reasonCode}`);
      }
    }
    // Any reason a reviewer supplies must be a KNOWN code. getReasonConfig() maps an unknown code to
    // OTHER, which is approvable — so an unvalidated code on an escalation or a note was a way to turn
    // a typo, or anything at all, into an approvable reason (PC01-F F1).
    if (reasonCode && !Object.hasOwn(REASON_CODES, reasonCode)) {
      throw new ValidationError(`Unknown reason code: ${reasonCode}`);
    }

    // Validate applicant message for resubmission
    if (action === DECISION_ACTION.REQUEST_RESUBMISSION && !applicantMessage) {
      throw new ValidationError('An applicant message is required when requesting resubmission.');
    }

    // Get the current assessment from the decision policy
    const assessment = DecisionPolicyEngine.buildAssessmentSummary(session, null, null, null);

    // Proactive idempotency check — BEFORE the policy gate, so a retried
    // identical command replays the stored decision instead of failing the
    // policy re-evaluation against the post-decision state (e.g. a retried
    // "escalate" previously got 403 "Case is already escalated"). Scoped to
    // this session so a key can never replay another session's decision.
    const idempotencyKey = req?.headers?.['x-idempotency-key'] || null;
    if (idempotencyKey) {
      const { data: existingDecision } = await client
        .from('verification_decisions')
        .select('*')
        .eq('idempotency_key', idempotencyKey)
        .eq('session_id', session.id)
        .maybeSingle();

      if (existingDecision) {
        return VerificationDecisionRecorder._buildResponse(existingDecision, session, assessment);
      }
    }

    const policyCheck = DecisionPolicyEngine.isActionAllowed(action, assessment);

    if (!policyCheck.allowed) {
      throw new ForbiddenError(
        `Action "${action}" is not allowed: ${policyCheck.reason}`
      );
    }

    // Compute resulting state
    const resultingPhase = decisionToPhase(action);
    const newLegacyStatus = decisionToLegacyStatus(action, session.status);
    const disposition = decisionToDisposition(action, reasonCode);

    // Generate decision ID
    const decisionId = 'dec_' + crypto.randomUUID().replace(/-/g, '').substring(0, 16);

    // Optimistic concurrency: check version before any writes.
    // Skip entirely when session has no version field (pre-migration rows).
    const sessionVersion = session.version;
    if (sessionVersion != null) {
      const { data: versionRow } = await client
        .from('verification_sessions')
        .select('version')
        .eq('id', session.id)
        .maybeSingle();

      const dbVersion = versionRow?.version;
      if (dbVersion != null && dbVersion !== sessionVersion) {
        throw new ConflictError(
          `Session version ${sessionVersion} is stale. Current version is ${dbVersion}.`
        );
      }
    }

    // Map applicant message
    let applicantMsg = applicantMessage || null;
    if (action === DECISION_ACTION.REQUEST_RESUBMISSION && !applicantMsg) {
      const reasonConfig = getReasonConfig(reasonCode);
      applicantMsg = reasonConfig.defaultApplicantGuidance;
    }

    // Insert the decision record
    const decisionRecord = {
      id: decisionId,
      session_id: session.id,
      decision: action,
      reason_code: reasonCode || null,
      internal_note: internalNote || null,
      applicant_message: applicantMsg,
      reviewer_id: reviewerId,
      reviewer_role: reviewerRole || null,
      previous_workflow_phase: currentWorkflowPhase,
      resulting_workflow_phase: resultingPhase,
      previous_legacy_status: session.status,
      resulting_legacy_status: newLegacyStatus,
      final_disposition: disposition,
      idempotency_key: idempotencyKey,
      created_at: timestamp,
    };

    const { error: decisionError } = await client
      .from('verification_decisions')
      .insert(decisionRecord);

    if (decisionError) {
      // Idempotency check: if duplicate key, fetch existing. Scoped to this
      // session like the proactive check above, so a reused key can never
      // replay another session's decision.
      if (decisionError.code === '23505' && idempotencyKey) {
        const { data: existing } = await client
          .from('verification_decisions')
          .select('*')
          .eq('idempotency_key', idempotencyKey)
          .eq('session_id', session.id)
          .maybeSingle();

        if (existing) {
          return VerificationDecisionRecorder._buildResponse(existing, session, assessment);
        }
      }
      throw new Error(`Failed to record decision: ${decisionError.message}`);
    }

    // Update the session for legacy compatibility
    const sessionUpdate = {
      updated_at: timestamp,
    };

    if (sessionVersion != null) {
      sessionUpdate.version = sessionVersion + 1;
    }

    if (resultingPhase) {
      sessionUpdate.workflow_phase = resultingPhase;
    }
    if (newLegacyStatus) {
      sessionUpdate.status = newLegacyStatus;
    }
    if (disposition) {
      sessionUpdate.final_disposition = disposition;
    }
    if (reasonCode && VerificationDecisionRecorder.mayChangePrimaryReason(action, session.primary_reason_code, reasonCode)) {
      sessionUpdate.primary_reason_code = reasonCode;
    }

    // Legacy fields
    sessionUpdate.reviewed_by = reviewerId;
    sessionUpdate.reviewed_at = timestamp;

    if (action === DECISION_ACTION.APPROVE) {
      sessionUpdate.review_decision = 'approve';
      sessionUpdate.failure_reason = null;
      if (internalNote) sessionUpdate.review_notes = internalNote;
    } else if (action === DECISION_ACTION.REQUEST_RESUBMISSION) {
      sessionUpdate.review_decision = 'request_retry';
      sessionUpdate.status = 'retry_requested';
      sessionUpdate.retry_reason = applicantMsg;
      if (internalNote) sessionUpdate.review_notes = internalNote;
    } else if (action === DECISION_ACTION.REJECT) {
      sessionUpdate.review_decision = 'reject';
      sessionUpdate.status = 'rejected';
      sessionUpdate.failure_reason = applicantMsg || 'Verification rejected by reviewer.';
      sessionUpdate.review_notes = internalNote || applicantMsg || null;
    } else if (action === DECISION_ACTION.ESCALATE) {
      sessionUpdate.review_decision = null;
      sessionUpdate.status = 'pending_manual_review';
      if (internalNote) sessionUpdate.review_notes = internalNote;
    } else if (action === DECISION_ACTION.ADD_INTERNAL_NOTE) {
      if (internalNote) {
        sessionUpdate.review_notes = internalNote;
      }
    }

    const updateQuery = client
      .from('verification_sessions')
      .update(sessionUpdate)
      .eq('id', session.id);
    if (sessionVersion != null) {
      updateQuery.eq('version', sessionVersion);
    }
    const { data: updatedSession, error: updateError } = await updateQuery
      .select()
      .single();

    if (!updatedSession) {
      throw new ConflictError(
        `Session version ${sessionVersion ?? 1} is stale. The session has been modified by another request.`
      );
    }

    if (updateError) {
      throw new Error(`Session update failed: ${updateError.message}`);
    }

    // Write audit event
    const eventType = VerificationDecisionRecorder._eventTypeForAction(action);
    const auditResult = await logAuditEvent(client, {
      req,
      event_type: eventType,
      actor_user_id: reviewerId,
      actor_role: reviewerRole,
      source_route: `/api/admin/identity/verification-sessions/${session.id}/review`,
      targetType: 'verification_session',
      targetId: session.id,
      previous_value: {
        status: session.status,
        review_decision: session.review_decision || null,
        workflow_phase: currentWorkflowPhase,
      },
      new_value: {
        status: updatedSession.status,
        review_decision: updatedSession.review_decision || null,
        workflow_phase: resultingPhase,
        final_disposition: disposition,
        decision_id: decisionId,
      },
      reason: reasonCode || null,
      decision_notes: internalNote || applicantMessage || null,
      metadata: {
        decision_id: decisionId,
        reason_code: reasonCode,
        idempotency_key: idempotencyKey,
      },
    });

    // OC-4A classification: BUSINESS HISTORY + SECURITY AUDIT. The decision is already durable — the
    // idempotency-keyed verification_decisions row above IS the domain record — so failing the request
    // now would misreport a decision that happened (and invite a retry against a moved session). The
    // cross-domain trust_audit_events row is therefore not allowed to fail SILENTLY instead: the failure
    // is logged as an error and the response carries audit_recorded: false, so the reviewer surface and
    // reconciliation can see the gap (it is re-derivable from verification_decisions).
    const auditRecorded = auditResult.success === true;
    if (!auditRecorded) {
      logger.error('IDENTITY', 'verification decision audit was NOT recorded; the decision is durable in verification_decisions', {
        decision_id: decisionId, session_id: session.id, event_type: eventType, error: auditResult.error || null,
      });
    }

    // O2-X3 (ported by OC-5C): a durable APPROVE also advances the CURRENT identity lifecycle
    // (verified, or recovered from compromised). The approval above is already immutable history, so
    // the hook cannot fail the decision — but it is never silent (#208 used .catch(console.warn), an
    // OC-4A violation on an identity-history write): a policy refusal (a revoked identity, or evidence
    // that predates a restriction) is recorded as lifecycle_outcome 'refused'; any other failure is a
    // logged error with lifecycle_recorded false, which the reviewer surface can see.
    let lifecycleOutcome = 'not_applicable';
    if (action === DECISION_ACTION.APPROVE) {
      try {
        const lifecycle = await onVerificationApproved(client, {
          userId: session.user_id,
          sessionId: session.id,
          reviewerId,
          reviewerRole,
        }, { req });
        lifecycleOutcome = lifecycle.noop ? 'unchanged' : 'recorded';
      } catch (lifecycleError) {
        if (lifecycleError instanceof ForbiddenError) {
          lifecycleOutcome = 'refused';
          logger.warn('IDENTITY', 'verification approval did not advance the identity lifecycle (policy refusal)', {
            decision_id: decisionId, session_id: session.id, reason: lifecycleError.message,
          });
        } else {
          lifecycleOutcome = 'failed';
          logger.error('IDENTITY', 'identity lifecycle was NOT updated after a durable approval', {
            decision_id: decisionId, session_id: session.id, error: lifecycleError.message,
          });
        }
      }
    }

    // Bridge the persisted decision into the communication engine (seam-E E5).
    // Best-effort: the decision is already durable, so an outbox write failure
    // must never fail the review action itself.
    if (APPLICANT_FACING_DECISIONS.includes(action)) {
      await emitDomainEvent(null, 'identity.verification.decided', {
        sessionId: session.id,
        userId: session.user_id,
        recipientUserId: session.user_id,
        decision: action,
        reasonCodes: reasonCode ? [reasonCode] : [],
        // verification_sessions has NO tenant_id column (live-verified), so
        // session.tenant_id is always undefined — pass the platform scope (null)
        // explicitly instead of reading a phantom column.
      }, null).catch((err) => {
        console.warn('identity.verification.decided outbox emit failed:', err.message);
      });
    }

    // Recompute allowed actions based on new state
    const newAssessment = {
      ...assessment,
      workflow_phase: resultingPhase || currentWorkflowPhase,
      evidence_classification: session.evidence_classification || assessment.evidence_classification,
      extraction_trust_status: session.extraction_trust_status || assessment.extraction_trust_status,
      identity_binding_status: session.identity_binding_status || assessment.identity_binding_status,
      primary_reason_code: reasonCode || assessment.primary_reason_code,
      final_disposition: disposition || assessment.final_disposition,
    };
    newAssessment.allowed_actions = DecisionPolicyEngine.getAllowedActions(newAssessment);

    return {
      decision: {
        id: decisionId,
        action,
        reason_code: reasonCode,
        previous_phase: currentWorkflowPhase,
        resulting_phase: resultingPhase,
        legacy_status: newLegacyStatus,
        final_disposition: disposition,
        applicant_message: applicantMsg,
        internal_note: internalNote,
        reviewer_id: reviewerId,
        created_at: timestamp,
        audit_event_type: eventType,
        audit_recorded: auditRecorded,
        lifecycle_outcome: lifecycleOutcome,
        lifecycle_recorded: lifecycleOutcome === 'recorded' || lifecycleOutcome === 'unchanged',
      },
      session: updatedSession,
      allowed_actions: newAssessment.allowed_actions,
    };
  }

  static _eventTypeForAction(action) {
    switch (action) {
      case DECISION_ACTION.APPROVE: return 'VERIFICATION_REVIEW_APPROVED';
      case DECISION_ACTION.REQUEST_RESUBMISSION: return 'VERIFICATION_REVIEW_RETRY_REQUESTED';
      case DECISION_ACTION.REJECT: return 'VERIFICATION_REVIEW_REJECTED';
      case DECISION_ACTION.ESCALATE: return 'VERIFICATION_REVIEW_ESCALATED';
      case DECISION_ACTION.ADD_INTERNAL_NOTE: return 'VERIFICATION_REVIEW_NOTE_ADDED';
      default: return 'VERIFICATION_REVIEW_ACTION';
    }
  }

  static _buildResponse(decision, session, assessment) {
    return {
      decision: {
        id: decision.id,
        action: decision.decision,
        reason_code: decision.reason_code,
        previous_phase: decision.previous_workflow_phase,
        resulting_phase: decision.resulting_workflow_phase,
        legacy_status: decision.resulting_legacy_status,
        final_disposition: decision.final_disposition,
        applicant_message: decision.applicant_message,
        internal_note: decision.internal_note,
        reviewer_id: decision.reviewer_id,
        created_at: decision.created_at,
      },
      session,
      allowed_actions: DecisionPolicyEngine.getAllowedActions(assessment),
      idempotent_replay: true,
    };
  }
}
