/**
 * Phase 7C — Verification decision policy engine.
 *
 * Central authority for what transitions are allowed given the current case
 * assessment and evidence classification. Prevents the admin UI or API from
 * approving non-documents, rejecting without cause, or performing illegal
 * workflow transitions.
 *
 * Every blocking rule returns: { allowed, reason, recommendedAction, allowedActions }
 */

import { getReasonConfig } from './reasonCodes.js';
import {
  DECISION_ACTION,
  EVIDENCE_CLASSIFICATION,
  EXTRACTION_TRUST_STATUS,
  IDENTITY_BINDING_STATUS,
  WORKFLOW_PHASE,
  FINAL_DISPOSITION,
  legacyStatusToPhase,
  OCR_EXECUTION_STATUS,
  SELFIE_STATUS,
} from './caseWorkflow.js';

const VALID_ACTIONS = Object.values(DECISION_ACTION);

export class DecisionPolicyEngine {
  /**
   * Evaluate what actions are allowed for a session given its current assessment.
   */
  static getAllowedActions(assessment) {
    const allowed = [];

    for (const action of VALID_ACTIONS) {
      const result = DecisionPolicyEngine.isActionAllowed(action, assessment);
      if (result.allowed) {
        allowed.push(action);
      }
    }

    return allowed;
  }

  /**
   * Check whether a specific action is allowed.
   */
  static isActionAllowed(action, assessment) {
    if (!assessment) {
      return { allowed: false, reason: 'No assessment data available.', recommendedAction: null, allowedActions: [] };
    }

    const workflowPhase = assessment.workflow_phase || assessment.workflowPhase;
    const evidenceClass = assessment.evidence_classification || assessment.evidenceClassification;
    const extractionTrust = assessment.extraction_trust_status || assessment.extractionTrustStatus;
    const identityBinding = assessment.identity_binding_status || assessment.identityBindingStatus;
    const reasonCode = assessment.primary_reason_code || assessment.primaryReasonCode;
    const biometric = assessment.biometric || null;

    switch (action) {
      case DECISION_ACTION.APPROVE:
        return DecisionPolicyEngine._checkApprove(workflowPhase, evidenceClass, extractionTrust, identityBinding, reasonCode, biometric);

      case DECISION_ACTION.REQUEST_RESUBMISSION:
        return DecisionPolicyEngine._checkRequestResubmission(workflowPhase, evidenceClass, reasonCode);

      case DECISION_ACTION.REJECT:
        return DecisionPolicyEngine._checkReject(workflowPhase, reasonCode);

      case DECISION_ACTION.ESCALATE:
        return DecisionPolicyEngine._checkEscalate(workflowPhase);

      case DECISION_ACTION.ADD_INTERNAL_NOTE:
        return DecisionPolicyEngine._checkAddNote(workflowPhase);

      default:
        return { allowed: false, reason: `Unknown action: ${action}`, recommendedAction: null, allowedActions: [] };
    }
  }

  static _checkApprove(workflowPhase, evidenceClass, extractionTrust, identityBinding, reasonCode, biometric = null) {
    if (workflowPhase === WORKFLOW_PHASE.RESOLVED_APPROVED || workflowPhase === WORKFLOW_PHASE.RESOLVED_REJECTED) {
      return { allowed: false, reason: 'Case is already resolved.', recommendedAction: null };
    }

    if (workflowPhase === WORKFLOW_PHASE.APPLICANT_ACTION_REQUIRED) {
      return { allowed: false, reason: 'Applicant must resubmit evidence before approval can be considered.', recommendedAction: DECISION_ACTION.ADD_INTERNAL_NOTE };
    }

    if (reasonCode) {
      const reasonConfig = getReasonConfig(reasonCode);
      if (!reasonConfig.approveAllowed) {
        return { allowed: false, reason: `Approval is not permitted when the primary reason is "${reasonCode}".`, recommendedAction: DECISION_ACTION.REQUEST_RESUBMISSION };
      }
    }

    if (evidenceClass && [
      EVIDENCE_CLASSIFICATION.NON_DOCUMENT,
      EVIDENCE_CLASSIFICATION.UNSUPPORTED_DOCUMENT,
      EVIDENCE_CLASSIFICATION.UNREADABLE,
      EVIDENCE_CLASSIFICATION.UNCERTAIN,
    ].includes(evidenceClass)) {
      return { allowed: false, reason: 'No valid identity document detected. Approval requires a valid or likely identity document.', recommendedAction: DECISION_ACTION.REQUEST_RESUBMISSION };
    }

    if (identityBinding === IDENTITY_BINDING_STATUS.MISMATCH) {
      return { allowed: false, reason: 'Account and document holder names do not match. Approval is not permitted without resolved identity.', recommendedAction: DECISION_ACTION.REQUEST_RESUBMISSION };
    }

    // O2-X4 — biometric EVIDENCE gates approval on hard failure and never grants it: a match
    // strengthens the recommendation, indeterminate/unavailable stays a human judgment, and
    // only the two failed states block. There is deliberately no "approve because biometric
    // passed" path — a passing biometric changes nothing about the checks above.
    if (biometric) {
      if (biometric.face_match_status === 'mismatch') {
        return { allowed: false, reason: 'Provider face↔document comparison reports a mismatch. Approval requires escalation or fresh evidence.', recommendedAction: DECISION_ACTION.ESCALATE };
      }
      if (biometric.liveness_status === 'failed') {
        return { allowed: false, reason: 'Provider liveness assessment failed. Approval requires a fresh capture or escalation.', recommendedAction: DECISION_ACTION.REQUEST_RESUBMISSION };
      }
    }

    return { allowed: true, reason: null, recommendedAction: DECISION_ACTION.APPROVE };
  }

  static _checkRequestResubmission(workflowPhase, evidenceClass, reasonCode) {
    if (workflowPhase === WORKFLOW_PHASE.RESOLVED_APPROVED) {
      return { allowed: false, reason: 'Case is already approved. Re-opening requires escalation.', recommendedAction: DECISION_ACTION.ESCALATE };
    }

    if (reasonCode) {
      const reasonConfig = getReasonConfig(reasonCode);
      if (!reasonConfig.resubmissionAllowed) {
        return { allowed: false, reason: `Resubmission is not permitted when the reason is "${reasonCode}".`, recommendedAction: DECISION_ACTION.REJECT };
      }
    }

    return { allowed: true, reason: null, recommendedAction: DECISION_ACTION.REQUEST_RESUBMISSION };
  }

  static _checkReject(workflowPhase, reasonCode) {
    if (workflowPhase === WORKFLOW_PHASE.RESOLVED_APPROVED || workflowPhase === WORKFLOW_PHASE.RESOLVED_REJECTED) {
      return { allowed: false, reason: 'Case is already resolved.', recommendedAction: null };
    }

    if (workflowPhase === WORKFLOW_PHASE.ESCALATED) {
      return { allowed: false, reason: 'Case is escalated. Only a specialist can reject.', recommendedAction: DECISION_ACTION.ADD_INTERNAL_NOTE };
    }

    return { allowed: true, reason: null, recommendedAction: DECISION_ACTION.REJECT };
  }

  static _checkEscalate(workflowPhase) {
    if (workflowPhase === WORKFLOW_PHASE.RESOLVED_APPROVED || workflowPhase === WORKFLOW_PHASE.RESOLVED_REJECTED) {
      return { allowed: false, reason: 'Case is already resolved.', recommendedAction: null };
    }

    if (workflowPhase === WORKFLOW_PHASE.ESCALATED) {
      return { allowed: false, reason: 'Case is already escalated.', recommendedAction: DECISION_ACTION.ADD_INTERNAL_NOTE };
    }

    return { allowed: true, reason: null, recommendedAction: DECISION_ACTION.ESCALATE };
  }

  static _checkAddNote(workflowPhase) {
    if (workflowPhase === WORKFLOW_PHASE.RESOLVED_APPROVED || workflowPhase === WORKFLOW_PHASE.RESOLVED_REJECTED) {
      return { allowed: false, reason: 'Case is resolved. Notes cannot be added to closed cases.', recommendedAction: null };
    }
    return { allowed: true, reason: null, recommendedAction: DECISION_ACTION.ADD_INTERNAL_NOTE };
  }

  /**
   * Build a policy-computed assessment summary for a session.
   */
  static buildAssessmentSummary(session, ocrProvenance, classificationResult, bindingResult, biometricAssessment = null) {
    const workflowPhase = session.workflow_phase || session.workflowPhase || legacyStatusToPhase(session.status);
    const evidenceClass = classificationResult?.classification || session.evidence_classification || EVIDENCE_CLASSIFICATION.NOT_RUN;
    const extractionTrust = classificationResult?.extractionTrust || session.extraction_trust_status || EXTRACTION_TRUST_STATUS.NOT_RUN;
    const identityBinding = bindingResult?.status || session.identity_binding_status || IDENTITY_BINDING_STATUS.NOT_RUN;

    const primaryReasonCode = session.primary_reason_code || classificationResult?.reasonCode || null;
    const reasonConfig = primaryReasonCode ? getReasonConfig(primaryReasonCode) : null;

    const assessment = {
      workflow_phase: workflowPhase,
      evidence_classification: evidenceClass,
      ocr_execution_status: session.ocr_execution_status || OCR_EXECUTION_STATUS.NOT_RUN,
      extraction_trust_status: extractionTrust,
      identity_binding_status: identityBinding,
      primary_reason_code: primaryReasonCode,
      risk_level: reasonConfig ? reasonConfig.severity : 'info',
      final_disposition: session.final_disposition || FINAL_DISPOSITION.NONE,
      selfie_check_status: session.selfie_check_status || SELFIE_STATUS.NOT_SUBMITTED,
      // O2-X4 — the biometric evidence dimension, when a provider assessment exists. A
      // separate axis from the name-binding above; never merged and never decisive.
      biometric: biometricAssessment
        ? {
          face_match_status: biometricAssessment.face_match_status || 'not_run',
          face_match_score: biometricAssessment.face_match_score ?? null,
          liveness_status: biometricAssessment.liveness_status || 'not_run',
          liveness_score: biometricAssessment.liveness_score ?? null,
          provider: biometricAssessment.provider || null,
          provider_state: biometricAssessment.provider_state || null,
          threshold_policy_version: biometricAssessment.threshold_policy_version || null,
          assessed_at: biometricAssessment.created_at || null,
        }
        : null,
    };

    assessment.allowed_actions = DecisionPolicyEngine.getAllowedActions(assessment);
    assessment.recommended_action = DecisionPolicyEngine._recommendAction(assessment);

    return assessment;
  }

  static _recommendAction(assessment) {
    const allowed = assessment.allowed_actions;

    if (allowed.includes(DECISION_ACTION.REQUEST_RESUBMISSION)) {
      return DECISION_ACTION.REQUEST_RESUBMISSION;
    }
    if (allowed.includes(DECISION_ACTION.APPROVE)) {
      return DECISION_ACTION.APPROVE;
    }
    if (allowed.includes(DECISION_ACTION.ADD_INTERNAL_NOTE)) {
      return DECISION_ACTION.ADD_INTERNAL_NOTE;
    }
    if (allowed.includes(DECISION_ACTION.REJECT)) {
      return DECISION_ACTION.REJECT;
    }
    if (allowed.includes(DECISION_ACTION.ESCALATE)) {
      return DECISION_ACTION.ESCALATE;
    }

    return null;
  }
}
