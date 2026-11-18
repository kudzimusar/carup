/**
 * Phase 7C — Append-only verification decision persistence.
 *
 * Every reviewer action produces an immutable decision record. The legacy
 * verification_sessions row is updated for compatibility, but the authoritative
 * audit trail is in verification_decisions.
 */

import crypto from 'crypto';
import { supabase } from '../../db/supabase.js';
import { requestContext, writeLegacyAuditMirror } from '../auditLogger.js';
import { DecisionPolicyEngine } from './decisionPolicy.js';
import {
  DECISION_ACTION,
  decisionToLegacyStatus,
  decisionToDisposition,
  decisionToPhase,
  WORKFLOW_PHASE,
  LEGACY_REVIEWABLE_STATUSES,
} from './caseWorkflow.js';
import { getReasonConfig } from './reasonCodes.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';

export class VerificationDecisionRecorder {
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
        if (existingDecision.decision !== action || (existingDecision.reason_code || null) !== (reasonCode || null)
          || (existingDecision.internal_note || null) !== (internalNote || null)
          || (existingDecision.applicant_message || null) !== (applicantMessage || null)
          || existingDecision.reviewer_id !== reviewerId) throw new ConflictError('Decision idempotency key was reused for a different request.');
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
    if (reasonCode) {
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

    const eventType = VerificationDecisionRecorder._eventTypeForAction(action);
    // Decision, versioned case update and authoritative audit share one DB transaction.
    // The migration is mandatory; no non-atomic fallback is permitted.
    if (!Number.isInteger(sessionVersion)) throw new ConflictError('Session version is unavailable.');
    const { data: atomicResult, error: atomicError } = await client.rpc('record_verification_decision_with_event_atomic', {
      p_session_id: session.id, p_expected_version: sessionVersion, p_decision: decisionRecord,
      p_update: sessionUpdate, p_event_type: eventType,
      p_request_id: requestContext(req).requestId,
      p_ip_address: requestContext(req).ipAddress, p_user_agent: requestContext(req).userAgent,
    });
    if (atomicError || !atomicResult) throw new Error('Verification decision audit or update failed.');
    if (atomicResult.code === 'REPLAY') return VerificationDecisionRecorder._buildResponse(atomicResult.decision, atomicResult.session, assessment);
    if (atomicResult.code !== 'OK') throw new ConflictError('The verification case changed or the decision cannot be applied.');
    const updatedSession = atomicResult.session;
    void writeLegacyAuditMirror(client, { req, event_type: eventType, actor_user_id: reviewerId, actor_role: reviewerRole, targetType: 'verification_session', targetId: session.id, metadata: { decision_id: decisionId, reason_code: reasonCode, idempotency_key: idempotencyKey } }).catch(() => {});

    // The RPC writes applicant-facing events to the existing outbox in the
    // same transaction as the decision and authoritative audit.

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
