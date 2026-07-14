/**
 * Phase 7C — Verification case management types.
 *
 * Extends the legacy verificationStatus with workflow phase, evidence
 * classification, decision record, and reason-code taxonomy.
 */

export type VerificationSessionStatus =
  | 'draft'
  | 'submitted'
  | 'processing'
  | 'pending_manual_review'
  | 'ocr_failed'
  | 'retry_requested'
  | 'verified'
  | 'rejected';

/** Visual/severity tone, mapped to concrete colors per platform. */
export type VerificationStatusTone = 'positive' | 'pending' | 'warning' | 'negative' | 'neutral';

/** Reviewer actions the admin console can take against a session. */
export type VerificationReviewAction = 'approve' | 'reject' | 'request_retry' | 'add_review_notes';

export interface VerificationStatusMeta {
  status: VerificationSessionStatus;
  /** Short human label for badges/titles. */
  label: string;
  /** One-line explanation of what the status means / what happens next. */
  description: string;
  tone: VerificationStatusTone;
  /** Whether the END USER can restart/redo verification from this status. */
  retryAllowed: boolean;
  /** Whether an admin can take a decision (approve/reject/request_retry) here. */
  adminActionAllowed: boolean;
}

export const VERIFICATION_STATUS_META: Record<VerificationSessionStatus, VerificationStatusMeta> = {
  draft: {
    status: 'draft',
    label: 'Draft',
    description: 'Verification started but not yet submitted.',
    tone: 'neutral',
    retryAllowed: false,
    adminActionAllowed: false,
  },
  submitted: {
    status: 'submitted',
    label: 'Submitted',
    description: 'Submitted and waiting for automated checks.',
    tone: 'pending',
    retryAllowed: false,
    adminActionAllowed: false,
  },
  processing: {
    status: 'processing',
    label: 'Processing',
    description: 'Running document checks. This usually takes a moment.',
    tone: 'pending',
    retryAllowed: false,
    adminActionAllowed: false,
  },
  pending_manual_review: {
    status: 'pending_manual_review',
    label: 'Pending Manual Review',
    description: 'Submitted and awaiting a human reviewer. Not verified yet.',
    tone: 'warning',
    retryAllowed: false,
    adminActionAllowed: true,
  },
  ocr_failed: {
    status: 'ocr_failed',
    label: 'OCR Failed',
    description: 'Automated reading failed. A new capture or manual review is needed.',
    tone: 'warning',
    retryAllowed: true,
    adminActionAllowed: true,
  },
  retry_requested: {
    status: 'retry_requested',
    label: 'Retry Requested',
    description: 'A reviewer asked for a new capture. Please restart verification.',
    tone: 'warning',
    retryAllowed: true,
    adminActionAllowed: true,
  },
  verified: {
    status: 'verified',
    label: 'Verified',
    description: 'Identity verified by the backend.',
    tone: 'positive',
    retryAllowed: false,
    adminActionAllowed: false,
  },
  rejected: {
    status: 'rejected',
    label: 'Rejected',
    description: 'Verification was rejected by a reviewer.',
    tone: 'negative',
    retryAllowed: true,
    adminActionAllowed: false,
  },
};

const UNKNOWN_STATUS_META: VerificationStatusMeta = {
  status: 'pending_manual_review',
  label: 'Unknown',
  description: 'Status is unavailable. The backend is the source of truth.',
  tone: 'neutral',
  retryAllowed: false,
  adminActionAllowed: false,
};

/** Statuses an admin can meaningfully filter/queue on. */
export const REVIEWABLE_VERIFICATION_STATUSES: VerificationSessionStatus[] = [
  'pending_manual_review',
  'ocr_failed',
  'retry_requested',
  'verified',
  'rejected',
];

export function isVerificationSessionStatus(value: unknown): value is VerificationSessionStatus {
  return typeof value === 'string' && value in VERIFICATION_STATUS_META;
}

/** Safe lookup with an Unknown fallback so a new/empty status never crashes the UI. */
export function getVerificationStatusMeta(status: string | null | undefined): VerificationStatusMeta {
  if (isVerificationSessionStatus(status)) {
    return VERIFICATION_STATUS_META[status];
  }
  return { ...UNKNOWN_STATUS_META, label: status ? humanize(status) : 'Unknown' };
}

function humanize(value: string): string {
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** Sanitized OCR fields safe to surface to admin/user UIs (never raw documents). */
export interface VerificationOcrFields {
  first_name?: string;
  last_name?: string;
  national_id_number?: string;
  date_of_birth?: string;
  country?: string;
  additional_fields?: Record<string, string>;
}

/** Account-holder vs document-holder comparison (Workstream F). */
export type IdentityBindingStatus = 'match' | 'mismatch' | 'indeterminate' | 'not_run' | 'not_assessable';

export interface IdentityBinding {
  account_holder_name: string | null;
  document_holder_name: string | null;
  status: IdentityBindingStatus;
  reason: string | null;
}

/**
 * Shape returned by the backend admin review endpoints
 * (sanitizeReviewSession). Contains NO private storage paths or document URLs —
 * only uploaded-side booleans and sanitized OCR fields.
 */
export interface AdminVerificationSession {
  id: string;
  user_id: string;
  document_type: string;
  double_sided: boolean;
  status: VerificationSessionStatus;
  uploaded_sides: {
    front: boolean;
    back: boolean;
    selfie: boolean;
  };
  ocr_document_id: string | null;
  ocr_result: VerificationOcrFields | null;
  confidence_score: number | null;
  failure_reason: string | null;
  review_notes: string | null;
  review_decision: 'approve' | 'reject' | 'request_retry' | null;
  retry_reason: string | null;
  liveness_status: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  ocr_started_at: string | null;
  ocr_completed_at: string | null;
  /** Present on the detail view (null on the list). */
  identity_binding?: IdentityBinding | null;
}

/** Backend response for a short-lived signed evidence preview URL. */
export interface EvidencePreview {
  side: 'front' | 'back' | 'selfie';
  url: string;
  expiresInSeconds: number;
}

export interface VerificationReviewRequest {
  action: VerificationReviewAction;
  reviewNotes?: string;
  retryReason?: string;
}

// ============================================================
// Phase 7C — Case management extended types
// ============================================================

export type WorkflowPhase =
  | 'system_processing'
  | 'reviewer_action_required'
  | 'applicant_action_required'
  | 'escalated'
  | 'resolved_approved'
  | 'resolved_rejected'
  | 'cancelled';

export type EvidenceClassification =
  | 'not_run'
  | 'valid_identity_document'
  | 'likely_identity_document'
  | 'unsupported_document'
  | 'non_document'
  | 'unreadable'
  | 'uncertain';

export type ExtractionTrustStatus =
  | 'not_run'
  | 'trusted'
  | 'partially_trusted'
  | 'untrusted'
  | 'no_fields';

export type WorkflowFinalDisposition =
  | 'none'
  | 'approved'
  | 'resubmission_requested'
  | 'rejected_invalid_evidence'
  | 'rejected_identity_mismatch'
  | 'rejected_suspected_fraud'
  | 'rejected_unsupported_document'
  | 'escalated_specialist_review';

export type DecisionAction =
  | 'approve'
  | 'request_resubmission'
  | 'reject'
  | 'escalate'
  | 'add_internal_note';

export type ReasonCode =
  | 'NON_DOCUMENT'
  | 'DOCUMENT_NOT_VISIBLE'
  | 'DOCUMENT_TOO_SMALL'
  | 'BLURRY'
  | 'GLARE'
  | 'CROPPED'
  | 'FRONT_BACK_DUPLICATE'
  | 'SELFIE_DOCUMENT_DUPLICATE'
  | 'UNSUPPORTED_DOCUMENT_TYPE'
  | 'EXPIRED_DOCUMENT'
  | 'UNREADABLE_DOCUMENT'
  | 'OCR_PROVIDER_FAILED'
  | 'OCR_RESULT_UNTRUSTED'
  | 'REQUIRED_FIELDS_MISSING'
  | 'ACCOUNT_DOCUMENT_MISMATCH'
  | 'DOCUMENT_SIDE_MISMATCH'
  | 'SUSPECTED_TAMPERING'
  | 'SUSPECTED_FRAUD'
  | 'TECHNICAL_ERROR'
  | 'SPECIALIST_REVIEW_REQUIRED'
  | 'OTHER';

export interface VerificationDecisionRecord {
  id: string;
  session_id: string;
  decision: DecisionAction;
  reason_code: ReasonCode | null;
  internal_note: string | null;
  applicant_message: string | null;
  reviewer_id: string;
  reviewer_role: string | null;
  previous_workflow_phase: string | null;
  resulting_workflow_phase: string | null;
  previous_legacy_status: string | null;
  resulting_legacy_status: string | null;
  final_disposition: string | null;
  created_at: string;
}

export interface AssessmentSummary {
  workflow_phase: WorkflowPhase;
  evidence_classification: EvidenceClassification;
  ocr_execution_status: string;
  extraction_trust_status: ExtractionTrustStatus;
  identity_binding_status: IdentityBindingStatus;
  primary_reason_code: ReasonCode | null;
  risk_level: string;
  final_disposition: WorkflowFinalDisposition;
  selfie_check_status: string;
  allowed_actions: DecisionAction[];
  recommended_action: DecisionAction | null;
}

export interface ExtendedAdminVerificationSession extends AdminVerificationSession {
  /** Applicant identity for admin cards (users join; may be null). */
  applicant_name?: string | null;
  applicant_email?: string | null;
  /** Applicant-notification bookkeeping. */
  notification_status?: string | null;
  notification_attempted_at?: string | null;
  workflow_phase: WorkflowPhase | null;
  final_disposition: WorkflowFinalDisposition | null;
  primary_reason_code: ReasonCode | null;
  next_actor: string | null;
  required_action: string | null;
  evidence_classification: EvidenceClassification | null;
  ocr_execution_status: string | null;
  extraction_trust_status: ExtractionTrustStatus | null;
  identity_binding_status: IdentityBindingStatus | null;
  assessment?: AssessmentSummary | null;
  decisions?: VerificationDecisionRecord[];
}

export interface DecisionResponse {
  decision: {
    id: string;
    action: DecisionAction;
    reason_code: ReasonCode | null;
    previous_phase: string | null;
    resulting_phase: string | null;
    legacy_status: string | null;
    final_disposition: string | null;
    applicant_message: string | null;
    internal_note: string | null;
    reviewer_id: string;
    created_at: string;
    audit_event_type: string;
  };
  session: ExtendedAdminVerificationSession;
  allowed_actions: DecisionAction[];
  idempotent_replay?: boolean;
}

export const WORKFLOW_PHASE_META: Record<string, { label: string; description: string; tone: string }> = {
  system_processing: { label: 'System Processing', description: 'Automated checks in progress.', tone: 'neutral' },
  reviewer_action_required: { label: 'Reviewer Action Required', description: 'Awaiting human reviewer decision.', tone: 'warning' },
  applicant_action_required: { label: 'Waiting for Applicant', description: 'Applicant needs to resubmit evidence.', tone: 'warning' },
  escalated: { label: 'Escalated', description: 'Case requires specialist review.', tone: 'error' },
  resolved_approved: { label: 'Approved', description: 'Identity verified and approved.', tone: 'positive' },
  resolved_rejected: { label: 'Rejected / Closed', description: 'Verification was rejected.', tone: 'negative' },
  cancelled: { label: 'Cancelled', description: 'Verification was cancelled.', tone: 'neutral' },
};

export const EVIDENCE_CLASSIFICATION_LABELS: Record<string, string> = {
  not_run: 'Not checked',
  valid_identity_document: 'Valid identity document',
  likely_identity_document: 'Likely identity document',
  unsupported_document: 'Unsupported document type',
  non_document: 'Non-document',
  unreadable: 'Unreadable',
  uncertain: 'Uncertain',
};

export const EXTRACTION_TRUST_LABELS: Record<string, string> = {
  not_run: 'Not run',
  trusted: 'Trusted',
  partially_trusted: 'Partially trusted',
  untrusted: 'Untrusted — disregard',
  no_fields: 'No fields extracted',
};

export const REASON_CODE_LABELS: Record<string, string> = {
  NON_DOCUMENT: 'Not an identity document',
  DOCUMENT_NOT_VISIBLE: 'Document not visible',
  DOCUMENT_TOO_SMALL: 'Document too small',
  BLURRY: 'Blurry image',
  GLARE: 'Glare or reflection',
  CROPPED: 'Document cropped',
  FRONT_BACK_DUPLICATE: 'Duplicate front/back',
  SELFIE_DOCUMENT_DUPLICATE: 'Duplicate selfie/document',
  UNSUPPORTED_DOCUMENT_TYPE: 'Unsupported document type',
  EXPIRED_DOCUMENT: 'Expired document',
  UNREADABLE_DOCUMENT: 'Unreadable document',
  OCR_PROVIDER_FAILED: 'OCR provider failed',
  OCR_RESULT_UNTRUSTED: 'OCR result untrusted',
  REQUIRED_FIELDS_MISSING: 'Required fields missing',
  ACCOUNT_DOCUMENT_MISMATCH: 'Identity mismatch',
  DOCUMENT_SIDE_MISMATCH: 'Document side mismatch',
  SUSPECTED_TAMPERING: 'Suspected tampering',
  SUSPECTED_FRAUD: 'Suspected fraud',
  TECHNICAL_ERROR: 'Technical error',
  SPECIALIST_REVIEW_REQUIRED: 'Specialist review',
  OTHER: 'Other',
};
