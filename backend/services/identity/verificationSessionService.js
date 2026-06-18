import crypto from 'crypto';
import { supabase } from '../../db/supabase.js';
import { logAuditEvent } from '../auditLogger.js';
import { DocumentIntelligenceService } from '../document-intelligence/documentIntelligenceService.js';
import { downloadFromStorage, uploadToStorage, generateSecureReadUrl } from '../storage/storageService.js';
import { validateEvidenceImages } from './evidenceValidation.js';
import { compareAccountToDocument, documentHolderName } from './identityBinding.js';
import { DocumentClassifier, EVIDENCE_CLASSIFICATION, EXTRACTION_TRUST_STATUS } from './documentClassifier.js';
import { DecisionPolicyEngine } from './decisionPolicy.js';
import { VerificationDecisionRecorder } from './decisionRecorder.js';
import {
  DECISION_ACTION,
  WORKFLOW_PHASE,
  LEGACY_REVIEWABLE_STATUSES,
  legacyStatusToPhase,
  decisionToLegacyStatus,
  decisionToDisposition,
  decisionToPhase,
} from './caseWorkflow.js';
import { getReasonConfig } from './reasonCodes.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';

const BUCKET = 'ocr-documents';
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const DOUBLE_SIDED_DOCUMENTS = new Set(['national_id', 'driver_license', 'drivers_license', 'registration_book']);
const PUBLIC_OCR_FIELDS = ['first_name', 'last_name', 'national_id_number', 'date_of_birth', 'country'];
const VALID_SIDES = new Set(['front', 'back', 'selfie']);

const ADMIN_REVIEW_ROLES = new Set(['admin', 'platform_admin', 'super_admin']);

function now() {
  return new Date().toISOString();
}

function actorId(actor = {}) {
  return actor.id || actor.userId;
}

/**
 * Workstream D — record OCR provenance (best-effort, append-only).
 *
 * Captures WHERE an extracted identity came from: provider, model, whether the
 * run was a mock/seed, the evidence hash, confidence and success/failure. This
 * is the audit trail that lets a reviewer prove a verified identity is backed by
 * a real provider run on the actual bytes — and lets us detect mock/seeded data.
 *
 * A provenance write must NEVER block the verification flow: failures (including
 * the table not yet existing before the migration is applied) are swallowed and
 * logged, mirroring the existing structured-OCR persistence pattern.
 */
async function recordOcrProvenance(client, entry) {
  try {
    const result = entry.result || {};
    const isMock = result.mock === true;
    const row = {
      session_id: entry.session.id,
      user_id: entry.session.user_id,
      ocr_document_id: result.ocrDocumentId || null,
      provider: result.provider || (isMock ? 'mock' : 'unknown'),
      model: result.model || null,
      is_mock: isMock,
      succeeded: Boolean(entry.succeeded),
      confidence_score: entry.confidence ?? null,
      document_type: entry.session.document_type || null,
      evidence_hashes: entry.evidenceHashes || null,
      failure_reason: entry.failureReason || null,
      metadata: entry.metadata || null,
    };
    const { error } = await client.from('verification_ocr_provenance').insert(row);
    if (error) {
      console.warn('⚠️ OCR provenance persistence failed:', error.message);
    }
  } catch (err) {
    console.warn('⚠️ OCR provenance persistence failed:', err?.message || err);
  }
}

/**
 * Workstream F — fetch the authenticated ACCOUNT holder's name for the
 * account-vs-document identity binding. Tolerant of lookup failure: returns ''
 * so the binding is reported as indeterminate rather than a false mismatch, and
 * the account profile is never mutated from OCR.
 */
async function fetchAccountHolderName(client, userId) {
  if (!client || !userId) return '';
  try {
    const { data, error } = await client.from('users').select('name').eq('id', userId).single();
    if (error || !data || typeof data.name !== 'string') return '';
    return data.name;
  } catch {
    return '';
  }
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
    workflow_phase: session.workflow_phase || null,
    primary_reason_code: session.primary_reason_code || null,
    evidence_classification: session.evidence_classification || null,
    ocr_execution_status: session.ocr_execution_status || null,
    extraction_trust_status: session.extraction_trust_status || null,
    identity_binding_status: session.identity_binding_status || null,
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
    reviewer_identity: session.reviewer_identity || null,
    review_decision: session.review_decision || null,
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
      workflow_phase: WORKFLOW_PHASE.SYSTEM_PROCESSING,
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
    new_value: { status: pendingSession.status, document_type: session.document_type, workflow_phase: WORKFLOW_PHASE.SYSTEM_PROCESSING },
  });

  let evidenceHashes = null;

  try {
    const frontDocument = await storage.downloadFromStorage(BUCKET, session.front_storage_path);
    let backBuffer = null;
    let selfieBuffer = null;

    if (session.back_storage_path) {
      const backDoc = await storage.downloadFromStorage(BUCKET, session.back_storage_path);
      backBuffer = backDoc.buffer;
    }
    if (session.selfie_storage_path) {
      const selfieDoc = await storage.downloadFromStorage(BUCKET, session.selfie_storage_path);
      selfieBuffer = selfieDoc.buffer;
    }

    // -------------------------------------------------------
    // STAGE 1: Document classification (Layer 1 + Layer 2)
    // -------------------------------------------------------
    const classificationResult = await DocumentClassifier.classify(
      { front: frontDocument.buffer, back: backBuffer, selfie: selfieBuffer },
      session.document_type
    );

    evidenceHashes = classificationResult.hashes;

    // Persist classification assessment
    await DocumentClassifier.persistClassification(client, session.id, classificationResult);

    const completedAt = now();

    // -------------------------------------------------------
    // STAGE 2: Route based on classification
    // -------------------------------------------------------
    if (!classificationResult.extractionAllowed) {
      // Non-document or unreadable: route to manual review with NO identity fields
      const reasonCode = classificationResult.reasonCode || 'DOCUMENT_NOT_VISIBLE';
      const reasonConfig = getReasonConfig(reasonCode);
      const reasonText = classificationResult.reasons.join(' ') || reasonConfig.internalDescription;

      const { data: invalidSession, error: invalidError } = await client
        .from('verification_sessions')
        .update({
          status: 'pending_manual_review',
          workflow_phase: WORKFLOW_PHASE.REVIEWER_ACTION_REQUIRED,
          primary_reason_code: reasonCode,
          failure_reason: reasonText,
          review_notes: `Evidence classified as "${classificationResult.classification}". ${reasonText}. Manual review required.`,
          ocr_result: null,
          confidence_score: null,
          ocr_completed_at: completedAt,
          updated_at: completedAt,
        })
        .eq('id', session.id)
        .eq('user_id', session.user_id)
        .select()
        .single();

      if (invalidError) throw new Error(invalidError.message);

      await writeAudit(client, {
        req: options.req,
        event_type: 'VERIFICATION_EVIDENCE_INVALID',
        actor_user_id: actorId(actor),
        actor_role: actor.role,
        actor_tenant_id: actor.tenantId,
        source_route: `/api/identity/verification-sessions/${session.id}/submit`,
        targetType: 'verification_session',
        targetId: session.id,
        new_value: {
          status: 'pending_manual_review',
          workflow_phase: WORKFLOW_PHASE.REVIEWER_ACTION_REQUIRED,
          reason_code: reasonCode,
          evidence_classification: classificationResult.classification,
        },
        reason: reasonText,
      });

      return sanitizeSession(invalidSession);
    }

    // -------------------------------------------------------
    // STAGE 3: OCR extraction (only after classification passes)
    // -------------------------------------------------------
    const frontDataUri = `data:${session.front_mime_type || frontDocument.mimeType || 'image/jpeg'};base64,${frontDocument.buffer.toString('base64')}`;
    const result = await ocr.extractDocumentData(session.document_type, frontDataUri, session.user_id);
    const confidence = result.extractedData?.confidenceScore ?? result.qualityMetrics?.blurScore ?? null;
    const sanitizedResult = sanitizeOcrResult(result.extractedData || {});

    // Determine extraction trust status
    // Provider succeeded does NOT imply trusted extraction
    const ocrExecStatus = result.success ? 'provider_succeeded' : 'provider_failed';
    let extractionTrust = EXTRACTION_TRUST_STATUS.UNTRUSTED;
    let extractionReasonCode = 'OCR_RESULT_UNTRUSTED';

    if (result.success) {
      const hasText = (v) => typeof v === 'string' && v.trim().length > 0;
      const hasCoreIdentityFields =
        hasText(sanitizedResult.national_id_number) ||
        (hasText(sanitizedResult.first_name) && hasText(sanitizedResult.last_name));
      const hasFields = Object.keys(sanitizedResult).length > 0;
      if (hasCoreIdentityFields && classificationResult.classification === EVIDENCE_CLASSIFICATION.VALID_IDENTITY_DOCUMENT) {
        extractionTrust = EXTRACTION_TRUST_STATUS.PARTIALLY_TRUSTED;
        extractionReasonCode = null;
      } else if (hasCoreIdentityFields) {
        extractionTrust = EXTRACTION_TRUST_STATUS.UNTRUSTED;
        extractionReasonCode = 'OCR_RESULT_UNTRUSTED';
      } else if (hasFields) {
        extractionTrust = EXTRACTION_TRUST_STATUS.UNTRUSTED;
        extractionReasonCode = 'REQUIRED_FIELDS_MISSING';
      } else {
        extractionTrust = EXTRACTION_TRUST_STATUS.NO_FIELDS;
        extractionReasonCode = 'REQUIRED_FIELDS_MISSING';
      }
    } else {
      extractionTrust = EXTRACTION_TRUST_STATUS.NO_FIELDS;
      extractionReasonCode = 'OCR_PROVIDER_FAILED';
    }

    // Compute identity binding
    const documentName = documentHolderName(sanitizedResult);
    const accountName = await fetchAccountHolderName(client, session.user_id);
    const binding = compareAccountToDocument({ accountName, documentName });
    const identityBindingStatus = binding.status;

    // Build the primary reason
    const primaryReasonCode = extractionReasonCode || (
      binding.status === 'mismatch' ? 'ACCOUNT_DOCUMENT_MISMATCH' : null
    );

    const baseReason = 'Verification requires manual review. Automated OCR cannot confirm document authenticity on its own.';

    const failureReason = binding.status === 'mismatch'
      ? `Identity mismatch: ${binding.reason} ${baseReason}`
      : baseReason;

    const reviewNote = binding.status === 'mismatch'
      ? `Account/document identity MISMATCH — account holder "${accountName}" vs document holder "${documentName}". Manual review required.`
      : 'OCR completed but requires manual review.';

    // -------------------------------------------------------
    // STAGE 4: Persist — NEVER auto-verify
    // -------------------------------------------------------
    const finalStatus = 'pending_manual_review';

    const updateData = {
      status: finalStatus,
      workflow_phase: WORKFLOW_PHASE.REVIEWER_ACTION_REQUIRED,
      primary_reason_code: primaryReasonCode,
      evidence_classification: classificationResult.classification,
      ocr_execution_status: ocrExecStatus,
      extraction_trust_status: extractionTrust,
      identity_binding_status: identityBindingStatus,
      ocr_document_id: result.ocrDocumentId || null,
      ocr_result: sanitizedResult,
      confidence_score: confidence,
      failure_reason: failureReason,
      review_notes: reviewNote,
      ocr_completed_at: completedAt,
      updated_at: completedAt,
    };

    const { data: completedSession, error: completedError } = await client
      .from('verification_sessions')
      .update(updateData)
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
        workflow_phase: WORKFLOW_PHASE.REVIEWER_ACTION_REQUIRED,
        confidence_score: confidence,
        evidence_classification: classificationResult.classification,
        extraction_trust_status: extractionTrust,
        identity_binding: binding.status,
      },
      reason: failureReason,
    });

    // Workstream D — provenance for the completed OCR run
    await recordOcrProvenance(client, {
      session,
      result,
      succeeded: Boolean(result.success),
      confidence,
      evidenceHashes,
      failureReason: result.success ? null : failureReason,
      metadata: {
        identity_binding: binding.status,
        final_status: finalStatus,
        evidence_classification: classificationResult.classification,
        extraction_trust_status: extractionTrust,
      },
    });

    return sanitizeSession(completedSession);
  } catch (error) {
    const failedAt = now();
    const { data: failedSession, error: failedError } = await client
      .from('verification_sessions')
      .update({
        status: 'ocr_failed',
        workflow_phase: WORKFLOW_PHASE.REVIEWER_ACTION_REQUIRED,
        primary_reason_code: 'TECHNICAL_ERROR',
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
      new_value: { status: 'ocr_failed', workflow_phase: WORKFLOW_PHASE.REVIEWER_ACTION_REQUIRED },
      reason: error.message,
    });

    await recordOcrProvenance(client, {
      session,
      result: {},
      succeeded: false,
      confidence: null,
      evidenceHashes,
      failureReason: error.message,
      metadata: { final_status: 'ocr_failed' },
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
function sanitizeReviewSession(session, identity = null) {
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
    // New case management fields
    workflow_phase: session.workflow_phase || null,
    final_disposition: session.final_disposition || null,
    primary_reason_code: session.primary_reason_code || null,
    next_actor: session.next_actor || null,
    required_action: session.required_action || null,
    evidence_classification: session.evidence_classification || null,
    ocr_execution_status: session.ocr_execution_status || null,
    extraction_trust_status: session.extraction_trust_status || null,
    identity_binding_status: session.identity_binding_status || null,
    // Workstream F — surface BOTH identities + the comparison so the reviewer
    // can see an account-vs-document mismatch at a glance. null on the list view.
    identity_binding: identity,
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

  // Support both legacy status and workflow phase filters
  if (filters.workflow_phase !== undefined && filters.workflow_phase !== null && filters.workflow_phase !== '') {
    query = query.eq('workflow_phase', String(filters.workflow_phase).trim().toLowerCase());
  } else if (filters.status !== undefined && filters.status !== null && filters.status !== '') {
    const normalized = String(filters.status).trim().toLowerCase();
    if (!LEGACY_REVIEWABLE_STATUSES.has(normalized)) {
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

  // Compute identity binding
  const documentName = documentHolderName(session.ocr_result || {});
  const accountName = await fetchAccountHolderName(client, session.user_id);
  const binding = compareAccountToDocument({ accountName, documentName });
  const identity = {
    account_holder_name: accountName || null,
    document_holder_name: documentName || null,
    status: binding.status,
    reason: binding.reason,
  };

  // Build policy assessment summary
  const assessment = DecisionPolicyEngine.buildAssessmentSummary(session, null, null, binding);

  const reviewSession = sanitizeReviewSession(session, identity);
  reviewSession.assessment = assessment;

  // Fetch decisions
  const { data: decisions } = await client
    .from('verification_decisions')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  reviewSession.decisions = decisions || [];

  return reviewSession;
}

export async function reviewVerificationSession(client = supabase, actor = {}, sessionId, payload = {}, options = {}) {
  assertAdminReviewer(actor);

  const reviewerId = actorId(actor);
  if (!reviewerId) {
    throw new ValidationError('Authenticated reviewer context is required.');
  }

  // Map legacy action names to new decision actions for backward compatibility
  const legacyAction = String(payload.action || payload.decision || '').trim().toLowerCase();
  let action;

  switch (legacyAction) {
    case 'approve':
      action = DECISION_ACTION.APPROVE;
      break;
    case 'request_retry':
    case 'request_resubmission':
      action = DECISION_ACTION.REQUEST_RESUBMISSION;
      break;
    case 'reject':
      action = DECISION_ACTION.REJECT;
      break;
    case 'escalate':
      action = DECISION_ACTION.ESCALATE;
      break;
    case 'add_review_notes':
    case 'add_internal_note':
    case 'internal_note':
      action = DECISION_ACTION.ADD_INTERNAL_NOTE;
      break;
    default:
      throw new ValidationError(`Unsupported review action: ${legacyAction || '(missing)'}. Supported: approve, request_resubmission, reject, escalate, add_internal_note.`);
  }

  const reasonCode = payload.reasonCode || payload.reason_code || null;
  const internalNote = payload.internalNote || payload.internal_note || payload.reviewNotes || payload.review_notes || '';
  const applicantMessage = payload.applicantMessage || payload.applicant_message || payload.retryReason || payload.retry_reason || '';

  const session = await fetchSessionForReview(client, sessionId);
  const currentWorkflowPhase = session.workflow_phase || legacyStatusToPhase(session.status);

  return VerificationDecisionRecorder.recordDecision(client, {
    session,
    action,
    reasonCode,
    internalNote,
    applicantMessage,
    reviewerId,
    reviewerRole: actor.role,
    currentWorkflowPhase,
    req: options.req,
  });
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
