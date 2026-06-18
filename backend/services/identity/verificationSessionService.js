import crypto from 'crypto';
import { supabase } from '../../db/supabase.js';
import { logAuditEvent } from '../auditLogger.js';
import { DocumentIntelligenceService } from '../document-intelligence/documentIntelligenceService.js';
import { downloadFromStorage, uploadToStorage, generateSecureReadUrl } from '../storage/storageService.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';

const BUCKET = 'ocr-documents';
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const DOUBLE_SIDED_DOCUMENTS = new Set(['national_id', 'driver_license', 'drivers_license', 'registration_book']);
const PUBLIC_OCR_FIELDS = ['first_name', 'last_name', 'national_id_number', 'date_of_birth', 'country'];
const VALID_SIDES = new Set(['front', 'back', 'selfie']);

// Admin manual-review surface (Phase 7C). Review is admin-only; the routes are
// also guarded by authorizeRole(['admin']), but the service re-checks so direct
// service callers cannot bypass the role gate.
const ADMIN_REVIEW_ROLES = new Set(['admin', 'platform_admin', 'super_admin']);
const REVIEWABLE_STATUSES = new Set([
  'pending_manual_review',
  'ocr_failed',
  'retry_requested',
  'verified',
  'rejected',
]);
const REVIEW_ACTIONS = new Set(['approve', 'reject', 'request_retry', 'add_review_notes']);

function now() {
  return new Date().toISOString();
}

function actorId(actor = {}) {
  return actor.id || actor.userId;
}

function normalizeDocumentType(value) {
  const documentType = String(value || '').trim().toLowerCase();
  if (!documentType) {
    throw new ValidationError('documentType is required.');
  }
  return documentType;
}

function requiresBack(documentType, explicitDoubleSided) {
  if (explicitDoubleSided === true) return true;
  if (explicitDoubleSided === false) return false;
  return DOUBLE_SIDED_DOCUMENTS.has(documentType);
}

function parseImagePayload(payload = {}) {
  const image = payload.image || payload.dataUri || payload.base64Data;
  if (!image || typeof image !== 'string') {
    throw new ValidationError('A base64 image payload is required.');
  }

  const dataUriMatch = image.match(/^data:([^;]+);base64,(.+)$/);
  const mimeType = String(payload.mimeType || dataUriMatch?.[1] || 'image/jpeg').toLowerCase();
  const base64 = dataUriMatch ? dataUriMatch[2] : image;

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new ValidationError('Unsupported verification image MIME type.');
  }

  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) {
    throw new ValidationError('Verification image payload is empty.');
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new ValidationError('Verification image exceeds the 15MB limit.');
  }

  return { buffer, mimeType, dataUri: `data:${mimeType};base64,${base64}` };
}

function extensionForMimeType(mimeType) {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
}

const MIN_VERIFIED_CONFIDENCE = 0.75;

/**
 * Quality gate for the verified status: OCR completing is not enough.
 * A session may only become 'verified' when the provider succeeded,
 * confidence clears MIN_VERIFIED_CONFIDENCE, and identity fields were
 * actually extracted (an ID number, or a first+last name). Blank or
 * unreadable images therefore land in pending_manual_review.
 */
export function evaluateOcrEvidence(result = {}) {
  if (!result.success) {
    return {
      sufficient: false,
      reason: result.error || result.ocrFailureReason || 'OCR did not complete successfully.',
    };
  }

  const extracted = result.extractedData || {};
  const confidence = Number(
    extracted.confidenceScore ?? result.qualityMetrics?.blurScore ?? 0
  );
  if (!Number.isFinite(confidence) || confidence < MIN_VERIFIED_CONFIDENCE) {
    return {
      sufficient: false,
      reason: `OCR confidence ${Number.isFinite(confidence) ? confidence.toFixed(2) : 'unavailable'} is below the ${MIN_VERIFIED_CONFIDENCE} verification threshold.`,
    };
  }

  const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
  const hasIdentityFields =
    hasText(extracted.national_id_number) ||
    (hasText(extracted.first_name) && hasText(extracted.last_name));
  if (!hasIdentityFields) {
    return {
      sufficient: false,
      reason: 'OCR did not extract the identity fields required for verification.',
    };
  }

  return { sufficient: true, reason: null };
}

function sanitizeOcrResult(extractedData = {}) {
  const result = {};
  for (const field of PUBLIC_OCR_FIELDS) {
    if (extractedData[field] !== undefined && extractedData[field] !== null) {
      result[field] = String(extractedData[field]);
    }
  }

  const additional = extractedData.additional_fields;
  if (additional && typeof additional === 'object') {
    result.additional_fields = {};
    for (const [key, value] of Object.entries(additional)) {
      if (['vin', 'engine_number', 'make', 'model', 'year', 'plate_number', 'expiry'].includes(key)) {
        result.additional_fields[key] = typeof value === 'object' ? JSON.stringify(value) : String(value);
      }
    }
  }

  return result;
}

function sanitizeSession(session) {
  if (!session) return null;
  return {
    id: session.id,
    user_id: session.user_id,
    document_type: session.document_type,
    double_sided: Boolean(session.double_sided),
    status: session.status,
    uploaded_sides: {
      front: Boolean(session.front_storage_path),
      back: Boolean(session.back_storage_path),
      selfie: Boolean(session.selfie_storage_path),
    },
    ocr_document_id: session.ocr_document_id || null,
    ocr_result: session.ocr_result || null,
    confidence_score: session.confidence_score === null || session.confidence_score === undefined
      ? null
      : Number(session.confidence_score),
    failure_reason: session.failure_reason || null,
    review_notes: session.review_notes || null,
    // Reviewer guidance the END USER needs to act on a retry request. Safe to
    // surface (it is not a private document path); the mobile result screen
    // shows it when a reviewer asks for a new capture.
    retry_reason: session.retry_reason || null,
    created_at: session.created_at,
    updated_at: session.updated_at,
    submitted_at: session.submitted_at || null,
    ocr_completed_at: session.ocr_completed_at || null,
  };
}

async function writeAudit(client, event) {
  const result = await logAuditEvent(client, event);
  if (!result.success) {
    throw new Error(`Verification audit failed: ${result.error || result.fallbackError || 'unknown error'}`);
  }
}

async function fetchSession(client, sessionId, actor, { allowReviewer = false } = {}) {
  let query = client.from('verification_sessions').select('*').eq('id', sessionId);
  if (!allowReviewer || !['admin', 'government'].includes(actor?.role)) {
    query = query.eq('user_id', actorId(actor));
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new NotFoundError('Verification session not found.');
  return data;
}

export async function createVerificationSession(client = supabase, actor = {}, payload = {}, options = {}) {
  const userId = actorId(actor);
  if (!userId) throw new ValidationError('Authenticated user context is required.');

  const documentType = normalizeDocumentType(payload.documentType || payload.document_type);
  const doubleSided = requiresBack(documentType, payload.doubleSided ?? payload.double_sided);
  const timestamp = now();

  const { data, error } = await client
    .from('verification_sessions')
    .insert({
      user_id: userId,
      document_type: documentType,
      double_sided: doubleSided,
      status: 'draft',
      created_at: timestamp,
      updated_at: timestamp,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  await writeAudit(client, {
    req: options.req,
    event_type: 'VERIFICATION_SESSION_CREATED',
    actor_user_id: userId,
    actor_role: actor.role,
    actor_tenant_id: actor.tenantId,
    source_route: '/api/identity/verification-sessions',
    targetType: 'verification_session',
    targetId: data.id,
    new_value: { status: data.status, document_type: documentType, double_sided: doubleSided },
  });

  return sanitizeSession(data);
}

export async function uploadVerificationSessionImage(client = supabase, actor = {}, sessionId, side, payload = {}, options = {}) {
  if (!VALID_SIDES.has(side)) {
    throw new ValidationError('Invalid verification image side.');
  }

  const session = await fetchSession(client, sessionId, actor);
  const parsed = parseImagePayload(payload);
  const timestamp = now();
  const extension = extensionForMimeType(parsed.mimeType);
  const storagePath = `${session.user_id}/${session.id}/${side}-${crypto.randomUUID()}.${extension}`;
  const storage = options.storage || { uploadToStorage };

  await storage.uploadToStorage(BUCKET, storagePath, parsed.buffer, parsed.mimeType);

  const updatePayload = {
    [`${side}_storage_path`]: storagePath,
    [`${side}_mime_type`]: parsed.mimeType,
    captured_at: session.captured_at || timestamp,
    uploaded_at: timestamp,
    updated_at: timestamp,
  };

  const hasFront = side === 'front' || Boolean(session.front_storage_path);
  const hasBack = side === 'back' || Boolean(session.back_storage_path);
  const hasSelfie = side === 'selfie' || Boolean(session.selfie_storage_path);
  updatePayload.status = hasFront && hasSelfie && (!session.double_sided || hasBack) ? 'uploaded' : 'captured';

  const { data, error } = await client
    .from('verification_sessions')
    .update(updatePayload)
    .eq('id', session.id)
    .eq('user_id', session.user_id)
    .select()
    .single();

  if (error) throw new Error(error.message);

  await writeAudit(client, {
    req: options.req,
    event_type: 'VERIFICATION_IMAGE_UPLOADED',
    actor_user_id: actorId(actor),
    actor_role: actor.role,
    actor_tenant_id: actor.tenantId,
    source_route: `/api/identity/verification-sessions/${session.id}/upload/${side}`,
    targetType: 'verification_session',
    targetId: session.id,
    new_value: { side, status: data.status, mime_type: parsed.mimeType, size_bytes: parsed.buffer.length },
  });

  return sanitizeSession(data);
}

export async function submitVerificationSession(client = supabase, actor = {}, sessionId, options = {}) {
  const session = await fetchSession(client, sessionId, actor);
  const missing = [];
  if (!session.front_storage_path) missing.push('front document');
  if (session.double_sided && !session.back_storage_path) missing.push('back document');
  if (!session.selfie_storage_path) missing.push('selfie');

  if (missing.length) {
    throw new ValidationError(`Missing required verification uploads: ${missing.join(', ')}.`);
  }

  const timestamp = now();
  const storage = options.storage || { downloadFromStorage };
  const ocr = options.ocr || DocumentIntelligenceService;

  const { data: pendingSession, error: pendingError } = await client
    .from('verification_sessions')
    .update({
      status: 'ocr_pending',
      submitted_at: session.submitted_at || timestamp,
      ocr_started_at: timestamp,
      updated_at: timestamp,
      failure_reason: null,
    })
    .eq('id', session.id)
    .eq('user_id', session.user_id)
    .select()
    .single();

  if (pendingError) throw new Error(pendingError.message);

  await writeAudit(client, {
    req: options.req,
    event_type: 'VERIFICATION_SUBMITTED',
    actor_user_id: actorId(actor),
    actor_role: actor.role,
    actor_tenant_id: actor.tenantId,
    source_route: `/api/identity/verification-sessions/${session.id}/submit`,
    targetType: 'verification_session',
    targetId: session.id,
    previous_value: { status: session.status },
    new_value: { status: pendingSession.status, document_type: session.document_type },
  });

  try {
    const frontDocument = await storage.downloadFromStorage(BUCKET, session.front_storage_path);
    const frontDataUri = `data:${session.front_mime_type || frontDocument.mimeType || 'image/jpeg'};base64,${frontDocument.buffer.toString('base64')}`;
    const result = await ocr.extractDocumentData(session.document_type, frontDataUri, session.user_id);
    const confidence = result.extractedData?.confidenceScore ?? result.qualityMetrics?.blurScore ?? null;
    const sanitizedResult = sanitizeOcrResult(result.extractedData || {});
    const evidence = evaluateOcrEvidence(result);
    // SECURITY (P0 — fail closed): the automated OCR path is NOT trustworthy
    // enough to auto-verify. It performs no document-type detection and the
    // providers can return plausible identity fields for a non-document (a cup,
    // a screenshot, a random photo). Until real document detection + OCR
    // provenance exist, NEVER set 'verified' here — every submitted session
    // goes to manual review so an admin inspects the actual evidence and makes
    // the verified decision via the admin review route. A failed/blank/low-
    // confidence capture is still surfaced honestly as the reason.
    const finalStatus = 'pending_manual_review';
    const failureReason = evidence.sufficient
      ? 'Automated OCR completed. Verification requires manual review of the uploaded document — automated OCR cannot confirm a genuine identity document on its own.'
      : evidence.reason;
    const completedAt = now();

    const { data: completedSession, error: completedError } = await client
      .from('verification_sessions')
      .update({
        status: finalStatus,
        ocr_document_id: result.ocrDocumentId || null,
        ocr_result: sanitizedResult,
        confidence_score: confidence,
        failure_reason: failureReason,
        review_notes: finalStatus === 'pending_manual_review' ? 'OCR completed but requires manual review.' : null,
        ocr_completed_at: completedAt,
        updated_at: completedAt,
      })
      .eq('id', session.id)
      .eq('user_id', session.user_id)
      .select()
      .single();

    if (completedError) throw new Error(completedError.message);

    if (result.ocrDocumentId) {
      await client
        .from('ocr_documents')
        .update({ file_path: session.front_storage_path })
        .eq('id', result.ocrDocumentId);
    }

    await writeAudit(client, {
      req: options.req,
      event_type: 'VERIFICATION_OCR_COMPLETED',
      actor_user_id: actorId(actor),
      actor_role: actor.role,
      actor_tenant_id: actor.tenantId,
      source_route: `/api/identity/verification-sessions/${session.id}/submit`,
      targetType: 'verification_session',
      targetId: session.id,
      previous_value: { status: 'ocr_pending' },
      new_value: {
        status: finalStatus,
        confidence_score: confidence,
        ocr_document_id: result.ocrDocumentId || null,
      },
      reason: failureReason,
    });

    return sanitizeSession(completedSession);
  } catch (error) {
    const failedAt = now();
    const { data: failedSession, error: failedError } = await client
      .from('verification_sessions')
      .update({
        status: 'ocr_failed',
        failure_reason: error.message,
        ocr_completed_at: failedAt,
        updated_at: failedAt,
      })
      .eq('id', session.id)
      .eq('user_id', session.user_id)
      .select()
      .single();

    if (failedError) throw new Error(failedError.message);

    await writeAudit(client, {
      req: options.req,
      event_type: 'VERIFICATION_OCR_FAILED',
      actor_user_id: actorId(actor),
      actor_role: actor.role,
      actor_tenant_id: actor.tenantId,
      source_route: `/api/identity/verification-sessions/${session.id}/submit`,
      targetType: 'verification_session',
      targetId: session.id,
      previous_value: { status: 'ocr_pending' },
      new_value: { status: 'ocr_failed' },
      reason: error.message,
    });

    return sanitizeSession(failedSession);
  }
}

export async function getVerificationSession(client = supabase, actor = {}, sessionId) {
  const session = await fetchSession(client, sessionId, actor, { allowReviewer: true });
  return sanitizeSession(session);
}

// --- Phase 7C: admin manual-review surface -------------------------------

function assertAdminReviewer(actor = {}) {
  const role = String(actor.role || actor.effectiveRole || actor.platformRole || '').toLowerCase();
  if (!ADMIN_REVIEW_ROLES.has(role)) {
    throw new ForbiddenError('Admin role is required to review verification sessions.');
  }
}

/**
 * Reviewer-facing projection. Builds on sanitizeSession (which already omits
 * every *_storage_path), so private document storage paths and any signed URL
 * never leave the service. Adds reviewer/decision metadata for the admin queue.
 */
function sanitizeReviewSession(session) {
  const base = sanitizeSession(session);
  if (!base) return null;
  return {
    ...base,
    reviewed_by: session.reviewed_by || null,
    reviewed_at: session.reviewed_at || null,
    review_decision: session.review_decision || null,
    retry_reason: session.retry_reason || null,
    liveness_status: session.liveness_status || null,
    submitted_at: session.submitted_at || null,
    ocr_started_at: session.ocr_started_at || null,
  };
}

async function fetchSessionForReview(client, sessionId) {
  const { data, error } = await client
    .from('verification_sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new NotFoundError('Verification session not found.');
  return data;
}

export async function listVerificationSessionsForReview(client = supabase, actor = {}, filters = {}) {
  assertAdminReviewer(actor);

  let query = client.from('verification_sessions').select('*');
  if (filters.status !== undefined && filters.status !== null && filters.status !== '') {
    const normalized = String(filters.status).trim().toLowerCase();
    if (!REVIEWABLE_STATUSES.has(normalized)) {
      throw new ValidationError(`Unsupported verification review status filter: ${normalized}.`);
    }
    query = query.eq('status', normalized);
  }
  query = query.order('created_at', { ascending: false });

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []).map(sanitizeReviewSession);
}

export async function getVerificationSessionForReview(client = supabase, actor = {}, sessionId) {
  assertAdminReviewer(actor);
  const session = await fetchSessionForReview(client, sessionId);
  return sanitizeReviewSession(session);
}

export async function reviewVerificationSession(client = supabase, actor = {}, sessionId, payload = {}, options = {}) {
  assertAdminReviewer(actor);

  const reviewerId = actorId(actor);
  if (!reviewerId) {
    throw new ValidationError('Authenticated reviewer context is required.');
  }

  const action = String(payload.action || '').trim().toLowerCase();
  if (!REVIEW_ACTIONS.has(action)) {
    throw new ValidationError(`Unsupported review action: ${action || '(missing)'}.`);
  }

  const reviewNotes = typeof payload.reviewNotes === 'string' ? payload.reviewNotes.trim() : '';
  const retryReason = typeof payload.retryReason === 'string' ? payload.retryReason.trim() : '';

  const session = await fetchSessionForReview(client, sessionId);
  const timestamp = now();

  const update = {
    reviewed_by: reviewerId,
    reviewed_at: timestamp,
    updated_at: timestamp,
  };
  let eventType;

  if (action === 'approve') {
    update.status = 'verified';
    update.review_decision = 'approve';
    update.failure_reason = null;
    if (reviewNotes) update.review_notes = reviewNotes;
    eventType = 'VERIFICATION_REVIEW_APPROVED';
  } else if (action === 'reject') {
    update.status = 'rejected';
    update.review_decision = 'reject';
    update.review_notes = reviewNotes || session.review_notes || null;
    update.failure_reason = reviewNotes || 'Verification rejected by reviewer.';
    eventType = 'VERIFICATION_REVIEW_REJECTED';
  } else if (action === 'request_retry') {
    if (!retryReason) {
      throw new ValidationError('retryReason is required to request a retry.');
    }
    update.status = 'retry_requested';
    update.review_decision = 'request_retry';
    update.retry_reason = retryReason;
    if (reviewNotes) update.review_notes = reviewNotes;
    eventType = 'VERIFICATION_REVIEW_RETRY_REQUESTED';
  } else {
    // add_review_notes: status is intentionally left unchanged.
    if (!reviewNotes) {
      throw new ValidationError('reviewNotes is required to add a review note.');
    }
    update.review_notes = reviewNotes;
    eventType = 'VERIFICATION_REVIEW_NOTE_ADDED';
  }

  const { data, error } = await client
    .from('verification_sessions')
    .update(update)
    .eq('id', session.id)
    .select()
    .single();

  if (error) throw new Error(error.message);

  await writeAudit(client, {
    req: options.req,
    event_type: eventType,
    actor_user_id: reviewerId,
    actor_role: actor.role,
    actor_tenant_id: actor.tenantId,
    source_route: `/api/admin/identity/verification-sessions/${session.id}/review`,
    targetType: 'verification_session',
    targetId: session.id,
    previous_value: { status: session.status, review_decision: session.review_decision || null },
    new_value: { status: data.status, review_decision: data.review_decision || null },
    reason: retryReason || (action === 'reject' ? (reviewNotes || 'Verification rejected by reviewer.') : null),
    decision_notes: reviewNotes || null,
  });

  return sanitizeReviewSession(data);
}

// --- Phase 7C Workstream G: secure, short-lived admin evidence previews ------

const EVIDENCE_PREVIEW_TTL_SECONDS = 180; // 3 minutes
const PREVIEWABLE_SIDES = new Set(['front', 'back', 'selfie']);

/**
 * Issue a short-lived signed URL so an admin can VIEW one piece of evidence
 * (front/back/selfie) for a session. The raw private storage path never leaves
 * the server; the signed URL expires in EVIDENCE_PREVIEW_TTL_SECONDS and is
 * never persisted. Every request is audited. Admin-only.
 */
export async function getEvidencePreviewUrl(client = supabase, actor = {}, sessionId, side, options = {}) {
  assertAdminReviewer(actor);

  const normalizedSide = String(side || '').trim().toLowerCase();
  if (!PREVIEWABLE_SIDES.has(normalizedSide)) {
    throw new ValidationError(`Unsupported evidence side: ${normalizedSide || '(missing)'}.`);
  }

  // fetchSessionForReview returns the RAW row (with *_storage_path); those paths
  // stay server-side and are used only to mint the signed URL.
  const session = await fetchSessionForReview(client, sessionId);
  const storagePath = session[`${normalizedSide}_storage_path`];
  if (!storagePath) {
    throw new NotFoundError(`No ${normalizedSide} image was uploaded for this verification session.`);
  }

  const storage = options.storage || { generateSecureReadUrl };
  const url = await storage.generateSecureReadUrl(BUCKET, storagePath, EVIDENCE_PREVIEW_TTL_SECONDS);
  if (!url) {
    throw new Error('Could not generate a secure preview URL for this evidence.');
  }

  await writeAudit(client, {
    req: options.req,
    event_type: 'VERIFICATION_EVIDENCE_PREVIEWED',
    actor_user_id: actorId(actor),
    actor_role: actor.role,
    actor_tenant_id: actor.tenantId,
    source_route: `/api/admin/identity/verification-sessions/${sessionId}/evidence/${normalizedSide}/preview`,
    targetType: 'verification_session',
    targetId: sessionId,
    new_value: { side: normalizedSide, ttl_seconds: EVIDENCE_PREVIEW_TTL_SECONDS },
  });

  // Return ONLY the short-lived signed URL — never the raw storage path.
  return { side: normalizedSide, url, expiresInSeconds: EVIDENCE_PREVIEW_TTL_SECONDS };
}

export {
  parseImagePayload,
  sanitizeOcrResult,
  sanitizeSession,
  sanitizeReviewSession,
  EVIDENCE_PREVIEW_TTL_SECONDS,
};
