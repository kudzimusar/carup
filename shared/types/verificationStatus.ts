/**
 * Canonical identity-verification status mapping shared by the web admin
 * console and the mobile result screen so labels, copy, and decision rules
 * stay consistent across platforms.
 *
 * Keyed by the BACKEND session status (the single source of truth). The mobile
 * app maps its internal capture states onto these where a backend status
 * exists; pre-submit local states (idle/incomplete) are handled in the mobile
 * UI directly.
 *
 * This module is plain TypeScript (no React, no platform APIs) so both the
 * Vite/React web app and the React Native/Expo mobile app can import it via the
 * shared `@shared/types` alias.
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
}

export interface VerificationReviewRequest {
  action: VerificationReviewAction;
  reviewNotes?: string;
  retryReason?: string;
}
