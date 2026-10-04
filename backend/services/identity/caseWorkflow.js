/**
 * Phase 7C — Verification case workflow phase model and transition rules.
 *
 * Separates the overloaded legacy `status` field into distinct dimensions:
 * capture state, evidence classification, OCR status, extraction trust,
 * identity binding, workflow phase, and final disposition.
 */

import { RESPONSIBILITY } from '../operations/responsibilityVocabulary.js';

// ============================================================
// A. CAPTURE STATE
// ============================================================
export const CAPTURE_STATE = Object.freeze({
  DRAFT: 'draft',
  EVIDENCE_UPLOADED: 'evidence_uploaded',
  SUBMITTED: 'submitted',
  PROCESSING: 'processing',
  COMPLETE: 'complete',
});

// ============================================================
// B. EVIDENCE CLASSIFICATION
// ============================================================
export const EVIDENCE_CLASSIFICATION = Object.freeze({
  NOT_RUN: 'not_run',
  VALID_IDENTITY_DOCUMENT: 'valid_identity_document',
  LIKELY_IDENTITY_DOCUMENT: 'likely_identity_document',
  UNSUPPORTED_DOCUMENT: 'unsupported_document',
  NON_DOCUMENT: 'non_document',
  UNREADABLE: 'unreadable',
  UNCERTAIN: 'uncertain',
});

// ============================================================
// C. OCR EXECUTION STATUS
// ============================================================
export const OCR_EXECUTION_STATUS = Object.freeze({
  NOT_RUN: 'not_run',
  PROVIDER_SUCCEEDED: 'provider_succeeded',
  PROVIDER_FAILED: 'provider_failed',
  TIMED_OUT: 'timed_out',
});

// ============================================================
// D. EXTRACTION TRUST STATUS
// ============================================================
export const EXTRACTION_TRUST_STATUS = Object.freeze({
  NOT_RUN: 'not_run',
  TRUSTED: 'trusted',
  PARTIALLY_TRUSTED: 'partially_trusted',
  UNTRUSTED: 'untrusted',
  NO_FIELDS: 'no_fields',
});

// ============================================================
// E. IDENTITY BINDING
// ============================================================
export const IDENTITY_BINDING_STATUS = Object.freeze({
  NOT_RUN: 'not_run',
  MATCH: 'match',
  MISMATCH: 'mismatch',
  INDETERMINATE: 'indeterminate',
  NOT_ASSESSABLE: 'not_assessable',
});

// ============================================================
// F. SELFIE/LIVENESS STATUS
// ============================================================
export const SELFIE_STATUS = Object.freeze({
  NOT_SUBMITTED: 'not_submitted',
  SUBMITTED_NOT_CHECKED: 'submitted_not_checked',
  NOT_RUN: 'not_run',
  UNAVAILABLE: 'unavailable',
  PASSED: 'passed',
  FAILED: 'failed',
});

// ============================================================
// G. CASE WORKFLOW PHASE
// ============================================================
export const WORKFLOW_PHASE = Object.freeze({
  SYSTEM_PROCESSING: 'system_processing',
  REVIEWER_ACTION_REQUIRED: 'reviewer_action_required',
  APPLICANT_ACTION_REQUIRED: 'applicant_action_required',
  ESCALATED: 'escalated',
  RESOLVED_APPROVED: 'resolved_approved',
  RESOLVED_REJECTED: 'resolved_rejected',
  CANCELLED: 'cancelled',
});

// ============================================================
// H. FINAL DISPOSITION
// ============================================================
export const FINAL_DISPOSITION = Object.freeze({
  NONE: 'none',
  APPROVED: 'approved',
  RESUBMISSION_REQUESTED: 'resubmission_requested',
  REJECTED_INVALID_EVIDENCE: 'rejected_invalid_evidence',
  REJECTED_IDENTITY_MISMATCH: 'rejected_identity_mismatch',
  REJECTED_SUSPECTED_FRAUD: 'rejected_suspected_fraud',
  REJECTED_UNSUPPORTED_DOCUMENT: 'rejected_unsupported_document',
  ESCALATED_SPECIALIST_REVIEW: 'escalated_specialist_review',
});

// ============================================================
// Decision action types for the review endpoint
// ============================================================
export const DECISION_ACTION = Object.freeze({
  APPROVE: 'approve',
  REQUEST_RESUBMISSION: 'request_resubmission',
  REJECT: 'reject',
  ESCALATE: 'escalate',
  ADD_INTERNAL_NOTE: 'add_internal_note',
});

// ============================================================
// Transition rules: maps reason-code categories to allowed workflow phases
// ============================================================
export const REASON_TO_RECOMMENDED_ACTION = {
  evidence: DECISION_ACTION.REQUEST_RESUBMISSION,
  quality: DECISION_ACTION.REQUEST_RESUBMISSION,
  document: DECISION_ACTION.REQUEST_RESUBMISSION,
  extraction: DECISION_ACTION.REQUEST_RESUBMISSION,
  identity: DECISION_ACTION.REQUEST_RESUBMISSION,
  fraud: DECISION_ACTION.ESCALATE,
  system: DECISION_ACTION.REQUEST_RESUBMISSION,
  escalation: DECISION_ACTION.ESCALATE,
  other: DECISION_ACTION.ADD_INTERNAL_NOTE,
};

export function recommendedActionForCategory(category) {
  return REASON_TO_RECOMMENDED_ACTION[category] || DECISION_ACTION.REQUEST_RESUBMISSION;
}

// ============================================================
// Legacy status compatibility mapping
// ============================================================
const LEGACY_STATUS_TO_PHASE = {
  draft: WORKFLOW_PHASE.SYSTEM_PROCESSING,
  captured: WORKFLOW_PHASE.SYSTEM_PROCESSING,
  uploaded: WORKFLOW_PHASE.SYSTEM_PROCESSING,
  ocr_pending: WORKFLOW_PHASE.SYSTEM_PROCESSING,
  ocr_failed: WORKFLOW_PHASE.REVIEWER_ACTION_REQUIRED,
  pending_manual_review: WORKFLOW_PHASE.REVIEWER_ACTION_REQUIRED,
  retry_requested: WORKFLOW_PHASE.APPLICANT_ACTION_REQUIRED,
  verified: WORKFLOW_PHASE.RESOLVED_APPROVED,
  rejected: WORKFLOW_PHASE.RESOLVED_REJECTED,
};

export function legacyStatusToPhase(legacyStatus) {
  return LEGACY_STATUS_TO_PHASE[legacyStatus] || WORKFLOW_PHASE.SYSTEM_PROCESSING;
}

const DECISION_TO_LEGACY_STATUS = {
  [DECISION_ACTION.APPROVE]: 'verified',
  [DECISION_ACTION.REQUEST_RESUBMISSION]: 'retry_requested',
  [DECISION_ACTION.REJECT]: 'rejected',
  [DECISION_ACTION.ESCALATE]: 'pending_manual_review',
  [DECISION_ACTION.ADD_INTERNAL_NOTE]: null,
};

export function decisionToLegacyStatus(action, currentStatus) {
  return DECISION_TO_LEGACY_STATUS[action] || currentStatus;
}

const DECISION_TO_DISPOSITION = {
  [DECISION_ACTION.APPROVE]: FINAL_DISPOSITION.APPROVED,
  [DECISION_ACTION.REQUEST_RESUBMISSION]: FINAL_DISPOSITION.RESUBMISSION_REQUESTED,
  [DECISION_ACTION.REJECT]: null,
  [DECISION_ACTION.ESCALATE]: FINAL_DISPOSITION.ESCALATED_SPECIALIST_REVIEW,
  [DECISION_ACTION.ADD_INTERNAL_NOTE]: FINAL_DISPOSITION.NONE,
};

export function decisionToDisposition(action, reasonCode) {
  if (action === DECISION_ACTION.REJECT) {
    switch (reasonCode) {
      case 'SUSPECTED_FRAUD':
      case 'SUSPECTED_TAMPERING':
        return FINAL_DISPOSITION.REJECTED_SUSPECTED_FRAUD;
      case 'ACCOUNT_DOCUMENT_MISMATCH':
        return FINAL_DISPOSITION.REJECTED_IDENTITY_MISMATCH;
      case 'UNSUPPORTED_DOCUMENT_TYPE':
      case 'EXPIRED_DOCUMENT':
        return FINAL_DISPOSITION.REJECTED_UNSUPPORTED_DOCUMENT;
      default:
        return FINAL_DISPOSITION.REJECTED_INVALID_EVIDENCE;
    }
  }
  return DECISION_TO_DISPOSITION[action] || FINAL_DISPOSITION.NONE;
}

const DECISION_TO_PHASE = {
  [DECISION_ACTION.APPROVE]: WORKFLOW_PHASE.RESOLVED_APPROVED,
  [DECISION_ACTION.REQUEST_RESUBMISSION]: WORKFLOW_PHASE.APPLICANT_ACTION_REQUIRED,
  [DECISION_ACTION.REJECT]: WORKFLOW_PHASE.RESOLVED_REJECTED,
  [DECISION_ACTION.ESCALATE]: WORKFLOW_PHASE.ESCALATED,
  [DECISION_ACTION.ADD_INTERNAL_NOTE]: null,
};

export function decisionToPhase(action) {
  return DECISION_TO_PHASE[action];
}

export const LEGACY_REVIEWABLE_STATUSES = new Set([
  'pending_manual_review',
  'ocr_failed',
  'retry_requested',
  'verified',
  'rejected',
]);

// ============================================================
// O2/P2 — normalized responsibility projection (M8 ADR §10.1)
// ============================================================
// The cross-domain "who must act next" contract. WORKFLOW_PHASE stays canonical inside this
// domain; this projection exists so a People-facing surface can show identity, seller authority
// and dealer compliance in ONE consistent vocabulary. Derived, never stored.

const PHASE_TO_RESPONSIBILITY = Object.freeze({
  [WORKFLOW_PHASE.SYSTEM_PROCESSING]: RESPONSIBILITY.PLATFORM_PROCESSING,
  [WORKFLOW_PHASE.REVIEWER_ACTION_REQUIRED]: RESPONSIBILITY.CARUP_REVIEW,
  [WORKFLOW_PHASE.APPLICANT_ACTION_REQUIRED]: RESPONSIBILITY.SUBJECT_ACTION,
  [WORKFLOW_PHASE.ESCALATED]: RESPONSIBILITY.ESCALATED,
  [WORKFLOW_PHASE.RESOLVED_APPROVED]: RESPONSIBILITY.NONE,
  [WORKFLOW_PHASE.RESOLVED_REJECTED]: RESPONSIBILITY.NONE,
  [WORKFLOW_PHASE.CANCELLED]: RESPONSIBILITY.NONE,
});

/**
 * Map an identity workflow phase to the normalized responsibility. Total over WORKFLOW_PHASE —
 * the totality test fails BY NAME on any phase added without a mapping, so a new phase cannot
 * silently project as "nobody needs to act".
 */
export function toResponsibilityProjection(workflowPhase) {
  const mapped = PHASE_TO_RESPONSIBILITY[workflowPhase];
  if (!mapped) {
    throw new Error(`Identity workflow phase '${workflowPhase}' has no responsibility mapping`);
  }
  return mapped;
}
