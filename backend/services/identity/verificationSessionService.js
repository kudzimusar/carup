import crypto from 'crypto';
import { sanitizeOcrResult, sanitizeSession } from './sessionProjection.js';
import { configuredIdentityOcrAdapter } from './identityOcrAdapter.js';
import { supabase } from '../../db/supabase.js';
import { logAuditEvent, requestContext, writeLegacyAuditMirror } from '../auditLogger.js';
import { downloadFromStorage, uploadToStorage, removeFromStorage, generateSecureReadUrl } from '../storage/storageService.js';
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
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';

const BUCKET = 'ocr-documents';
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const DOUBLE_SIDED_DOCUMENTS = new Set(['national_id', 'driver_license', 'drivers_license', 'registration_book']);
const VALID_SIDES = new Set(['front', 'back', 'selfie']);
// An abandoned claim may be retried after the two bounded provider calls have
// had time to finish. The version guard prevents the old worker finalizing.
const OCR_PROCESSING_LEASE_MS = 5 * 60 * 1000;

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


async function writeAudit(client, event) {
  const result = await logAuditEvent(client, event);
  if (!result.success) {
    throw new Error('Verification audit failed.');
  }
}

async function fetchSession(client, sessionId, actor) {
  const query = client.from('verification_sessions').select('*')
    .eq('id', sessionId).eq('user_id', actorId(actor));

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error('Verification service operation failed.');
  if (!data) throw new NotFoundError('Verification session not found.');
  return data;
}

export async function createVerificationSession(client = supabase, actor = {}, payload = {}, options = {}) {
  const userId = actorId(actor);
  if (!userId) throw new ValidationError('Authenticated user context is required.');

  // REJECTION IS TERMINAL (retry policy A — deliberate, not accidental):
  // an applicant may not self-start a new verification while their most
  // recent session is rejected. A reviewer/support reopens the case by
  // requesting resubmission on it (allowed by the decision policy), which
  // moves it off the terminal state and resumes the SAME session.
  const { data: priorSessions } = await client
    .from('verification_sessions')
    .select('id, status, created_at')
    .eq('user_id', userId);
  const latestPrior = (priorSessions || [])
    .slice()
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
  if (latestPrior && latestPrior.status === 'rejected') {
    throw new ForbiddenError(
      'Your previous verification was closed by a reviewer. A new attempt requires a reviewer to reopen the case (request resubmission) or CarUp support.',
    );
  }

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

  if (error) throw new Error('Verification service operation failed.');

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
  if (!['draft', 'captured', 'uploaded', 'retry_requested', 'ocr_failed'].includes(session.status)) {
    throw new ConflictError('Images cannot be changed in the current verification state.');
  }
  if (!Number.isInteger(session.version)) throw new ConflictError('Verification session version is unavailable.');
  const parsed = parseImagePayload(payload);
  const timestamp = now();
  const extension = extensionForMimeType(parsed.mimeType);
  const storagePath = `${session.user_id}/${session.id}/${side}-${crypto.randomUUID()}.${extension}`;
  const storage = options.storage || { uploadToStorage, removeFromStorage };

  try {
    await storage.uploadToStorage(BUCKET, storagePath, parsed.buffer, parsed.mimeType);
  } catch {
    throw new Error('Verification image upload failed.');
  }

  const updatePayload = {
    [`${side}_storage_path`]: storagePath,
    [`${side}_mime_type`]: parsed.mimeType,
    captured_at: session.captured_at || timestamp,
    uploaded_at: timestamp,
    updated_at: timestamp,
    version: session.version + 1,
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
    .eq('status', session.status)
    .eq('version', session.version)
    .select()
    .maybeSingle();

  if (error) throw new Error('Verification service operation failed.');
  if (!data) {
    try {
      if (storage.removeFromStorage) await storage.removeFromStorage(BUCKET, storagePath);
    } catch {
      // A private, unattached object requires retention cleanup; do not leak its path.
      console.error('Verification evidence cleanup failed.');
    }
    throw new ConflictError('Verification changed while the image was uploading. Please retry.');
  }

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
  const startedAt = Date.parse(session.ocr_started_at || '');
  const expiredClaim = session.status === 'ocr_pending' && Number.isFinite(startedAt) && Date.now() - startedAt >= OCR_PROCESSING_LEASE_MS;
  if ((session.status === 'ocr_pending' && !expiredClaim) || ['pending_manual_review', 'verified'].includes(session.status)) return sanitizeSession(session);
  if (!['draft', 'captured', 'uploaded', 'ocr_failed', 'ocr_pending'].includes(session.status)) {
    throw new ConflictError('Verification cannot be submitted in its current state.');
  }
  const missing = [];
  if (!session.front_storage_path) missing.push('front document');
  if (session.double_sided && !session.back_storage_path) missing.push('back document');
  if (!session.selfie_storage_path) missing.push('selfie');

  if (missing.length) {
    throw new ValidationError(`Missing required verification uploads: ${missing.join(', ')}.`);
  }

  if (!['uploaded', 'ocr_failed'].includes(session.status) && !expiredClaim) {
    throw new ConflictError('Verification cannot be submitted in its current state.');
  }
  if (!Number.isInteger(session.version)) throw new ConflictError('Verification session version is unavailable.');

  const storage = options.storage || { downloadFromStorage };
  // The legacy document-intelligence path has synthetic quality/confidence
  // fallbacks. Do not send identity evidence through it as authoritative OCR.
  // An adapter supplied by the caller is an internal test seam; HTTP callers
  // cannot select a provider. The configured real adapter remains off by default.
  const ocr = options.ocr || configuredIdentityOcrAdapter();

  // The database transaction writes the claim and authoritative audit together.
  // A missing migration or failed audit fails closed; there is no legacy fallback.
  const { data: pendingSession, error: pendingError } = await client.rpc('claim_verification_ocr_submission', {
    p_session_id: session.id, p_user_id: session.user_id, p_expected_version: session.version,
    p_expected_status: session.status, p_actor_role: actor.role || null,
    p_actor_tenant_id: actor.tenantId || null,
    p_request_id: requestContext(options.req).requestId,
    p_ip_address: requestContext(options.req).ipAddress,
    p_user_agent: requestContext(options.req).userAgent,
  });
  if (pendingError) throw new Error('Verification submission audit or claim failed.');
  if (!pendingSession) {
    const current = await fetchSession(client, sessionId, actor);
    if (['ocr_pending', 'pending_manual_review', 'verified'].includes(current.status)) return sanitizeSession(current);
    throw new ConflictError('Verification changed before submission. Please retry.');
  }
  void writeLegacyAuditMirror(client, { req: options.req, event_type: 'VERIFICATION_SUBMITTED', actor_user_id: actorId(actor), actor_role: actor.role, actor_tenant_id: actor.tenantId, targetType: 'verification_session', targetId: session.id }).catch(() => {});

  let evidenceHashes = null;

  try {
    if (!ocr) throw new Error('Identity OCR is not configured.');
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
    let classificationResult = await DocumentClassifier.classify(
      { front: frontDocument.buffer, back: backBuffer, selfie: selfieBuffer },
      session.document_type,
      { classifyDocument: ocr.classifyDocument }
    );

    evidenceHashes = classificationResult.hashes;


    const completedAt = now();

    // -------------------------------------------------------
    // STAGE 2: Route based on classification
    // -------------------------------------------------------
    if (!classificationResult.extractionAllowed) {
      // Non-document or unreadable: route to manual review with NO identity fields
      const reasonCode = classificationResult.reasonCode || 'DOCUMENT_NOT_VISIBLE';
      const reasonConfig = getReasonConfig(reasonCode);
      const reasonText = classificationResult.reasons.join(' ') || reasonConfig.internalDescription;
      const providerFailed = reasonCode === 'OCR_PROVIDER_FAILED';

      const { data: invalidSession, error: invalidError } = await client
        .from('verification_sessions')
        .update({
          status: providerFailed ? 'ocr_failed' : 'pending_manual_review',
          workflow_phase: WORKFLOW_PHASE.REVIEWER_ACTION_REQUIRED,
          primary_reason_code: reasonCode,
          failure_reason: reasonText,
          review_notes: `Evidence classified as "${classificationResult.classification}". ${reasonText}. Manual review required.`,
          ocr_result: null,
          confidence_score: null,
          ocr_completed_at: completedAt,
          updated_at: completedAt,
          version: pendingSession.version + 1,
        })
        .eq('id', session.id)
        .eq('user_id', session.user_id)
        .eq('status', 'ocr_pending')
        .eq('version', pendingSession.version)
        .select()
        .maybeSingle();

      if (invalidError) throw new Error('Verification service operation failed.');
      if (!invalidSession) throw new ConflictError('Verification changed during processing.');
      await DocumentClassifier.persistClassification(client, session.id, classificationResult);

      await writeAudit(client, {
        req: options.req,
        event_type: providerFailed ? 'VERIFICATION_OCR_FAILED' : 'VERIFICATION_EVIDENCE_INVALID',
        actor_user_id: actorId(actor),
        actor_role: actor.role,
        actor_tenant_id: actor.tenantId,
        source_route: `/api/identity/verification-sessions/${session.id}/submit`,
        targetType: 'verification_session',
        targetId: session.id,
        new_value: {
          status: providerFailed ? 'ocr_failed' : 'pending_manual_review',
          workflow_phase: WORKFLOW_PHASE.REVIEWER_ACTION_REQUIRED,
          reason_code: reasonCode,
          evidence_classification: classificationResult.classification,
        },
        reason: reasonText,
      });

      if (providerFailed) await recordOcrProvenance(client, {
        session, result: { provider: classificationResult.provider, model: classificationResult.model },
        succeeded: false, evidenceHashes, failureReason: 'OCR_PROVIDER_FAILED',
        metadata: { stage: 'classification' },
      });

      return sanitizeSession(invalidSession);
    }

    // -------------------------------------------------------
    // STAGE 3: OCR extraction (only after classification passes)
    // -------------------------------------------------------
    const frontDataUri = `data:${session.front_mime_type || frontDocument.mimeType || 'image/jpeg'};base64,${frontDocument.buffer.toString('base64')}`;
    const result = await ocr.extractDocumentData(session.document_type, frontDataUri, session.user_id);
    const confidence = result.provider === 'cloudflare' ? null : result.extractedData?.confidenceScore ?? null;
    const sanitizedResult = sanitizeOcrResult(result.extractedData || {}, session.document_type);

    // Determine extraction trust status
    // Provider succeeded does NOT imply trusted extraction
    const documentIssue = ['DOCUMENT_UNREADABLE', 'UNSUPPORTED_DOCUMENT'].includes(result.error);
    const ocrExecStatus = result.success || documentIssue ? 'provider_succeeded' : 'provider_failed';
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
      extractionReasonCode = result.error === 'DOCUMENT_UNREADABLE' ? 'UNREADABLE_DOCUMENT'
        : result.error === 'UNSUPPORTED_DOCUMENT' ? 'UNSUPPORTED_DOCUMENT_TYPE' : 'OCR_PROVIDER_FAILED';
    }

    // CONSISTENCY INVARIANT (fail-closed): a stored record may never claim a
    // valid identity document while extraction produced ZERO identity fields.
    // The owner's device Gate 2 surfaced a rejected case displaying BOTH
    // "Valid identity document" (classifier/mock verdict) and "Not an identity
    // document" (decision reason). When nothing extractable supports validity,
    // the authoritative classification downgrades to UNCERTAIN.
    if (
      classificationResult.classification === EVIDENCE_CLASSIFICATION.VALID_IDENTITY_DOCUMENT &&
      extractionTrust === EXTRACTION_TRUST_STATUS.NO_FIELDS
    ) {
      classificationResult = {
        ...classificationResult,
        classification: EVIDENCE_CLASSIFICATION.UNCERTAIN,
        reasons: [
          ...(classificationResult.reasons || []),
          'Classification downgraded to uncertain: no identity fields were extractable from the evidence.',
        ],
      };
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
    const finalStatus = !result.success && !documentIssue ? 'ocr_failed' : 'pending_manual_review';

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
      ocr_confirmation_required: Boolean(result.success && Object.keys(sanitizedResult).length),
      confidence_score: confidence,
      failure_reason: failureReason,
      review_notes: reviewNote,
      ocr_completed_at: completedAt,
      updated_at: completedAt,
      version: pendingSession.version + 1,
    };

    const { data: completedSession, error: completedError } = await client
      .from('verification_sessions')
      .update(updateData)
      .eq('id', session.id)
      .eq('user_id', session.user_id)
      .eq('status', 'ocr_pending')
      .eq('version', pendingSession.version)
      .select()
      .maybeSingle();

    if (completedError) throw new Error('Verification service operation failed.');
    if (!completedSession) throw new ConflictError('Verification changed during processing.');
    await DocumentClassifier.persistClassification(client, session.id, classificationResult);

    if (result.ocrDocumentId) {
      await client
        .from('ocr_documents')
        .update({ file_path: session.front_storage_path })
        .eq('id', result.ocrDocumentId);
    }

    await writeAudit(client, {
      req: options.req,
      event_type: finalStatus === 'ocr_failed' ? 'VERIFICATION_OCR_FAILED' : 'VERIFICATION_OCR_COMPLETED',
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
      failureReason: result.success ? null : (result.error || 'OCR_PROVIDER_FAILED'),
      metadata: {
        schema_version: result.schemaVersion || null,
        document_class: result.documentClass || null,
        identity_binding: binding.status,
        final_status: finalStatus,
        evidence_classification: classificationResult.classification,
        extraction_trust_status: extractionTrust,
      },
    });

    return sanitizeSession(completedSession);
  } catch (error) {
    if (error instanceof ConflictError) throw error;
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
        version: pendingSession.version + 1,
      })
      .eq('id', session.id)
      .eq('user_id', session.user_id)
      .eq('status', 'ocr_pending')
      .eq('version', pendingSession.version)
      .select()
      .maybeSingle();

    if (failedError) throw new Error('Verification service operation failed.');
    if (!failedSession) throw new ConflictError('Verification changed during processing.');

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

/**
 * The authenticated applicant's most recent verification session (sanitized),
 * or null when they have none. Powers the mobile ENTRY PREFLIGHT so a
 * terminally-rejected applicant is stopped BEFORE document selection or any
 * camera capture — the create-session guard alone fired only after all
 * captures (device Gate 2 round 3).
 */
export async function getLatestVerificationSessionForUser(client = supabase, actor = {}) {
  const userId = actorId(actor);
  if (!userId) throw new ValidationError('Authenticated user context is required.');

  const { data, error } = await client
    .from('verification_sessions')
    .select('*')
    .eq('user_id', userId);
  if (error) throw new Error('Verification service operation failed.');

  const latest = (data || [])
    .slice()
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
  return latest ? sanitizeSession(latest) : null;
}

export async function getVerificationSession(client = supabase, actor = {}, sessionId) {
  const session = await fetchSession(client, sessionId, actor);
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
    review_notes: session.review_notes || null,
    reviewer_identity: session.reviewer_identity || null,
    failure_reason: session.failure_reason || null,
    ocr_document_id: session.ocr_document_id || null,
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
    // Applicant identity for admin cards (explicit user_id-FK embed; null on
    // mocks). NEVER sourced from the reviewed_by relationship.
    applicant_name: session.applicant?.name ?? null,
    applicant_email: session.applicant?.email ?? null,
    // Applicant-notification bookkeeping (case-management columns).
    notification_status: session.notification_status || null,
    notification_attempted_at: session.notification_attempted_at || null,
  };
}

async function fetchSessionForReview(client, sessionId) {
  const { data, error } = await client
    .from('verification_sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw new Error('Verification service operation failed.');
  if (!data) throw new NotFoundError('Verification session not found.');
  return data;
}

export async function listVerificationSessionsForReview(client = supabase, actor = {}, filters = {}) {
  assertAdminReviewer(actor);

  let query = client.from('verification_sessions').select([
    'id', 'document_type', 'status', 'workflow_phase', 'created_at', 'updated_at',
    'submitted_at', 'primary_reason_code', 'evidence_classification',
    'ocr_execution_status', 'extraction_trust_status', 'identity_binding_status',
    'final_disposition', 'front_storage_path', 'back_storage_path', 'selfie_storage_path',
  ].join(','));

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
  if (error) throw new Error('Verification service operation failed.');
  return (data || []).map(row => {
    const { id, document_type, status, workflow_phase, created_at, updated_at, submitted_at,
      primary_reason_code, evidence_classification, ocr_execution_status, extraction_trust_status,
      identity_binding_status, final_disposition, uploaded_sides } = sanitizeReviewSession(row);
    return { id, document_type, status, workflow_phase, created_at, updated_at, submitted_at,
      primary_reason_code, evidence_classification, ocr_execution_status, extraction_trust_status,
      identity_binding_status, final_disposition, uploaded_sides };
  });
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

  const { data: confirmations, error: confirmationError } = await client
    .from('verification_applicant_confirmations')
    .select('id, applicant_user_id, original_observations, applicant_fields, created_at, source_ocr_started_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });
  if (confirmationError) throw new Error('Verification confirmation history is unavailable.');
  reviewSession.applicant_confirmations = confirmations || [];

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
  if (String(session.user_id) === String(reviewerId)) {
    throw new ForbiddenError('A reviewer cannot decide their own verification case.');
  }
  if (action === DECISION_ACTION.APPROVE && session.ocr_confirmation_required && !session.ocr_confirmed_at) {
    throw new ConflictError('Applicant confirmation is required before approval.');
  }
  const currentWorkflowPhase = session.workflow_phase || legacyStatusToPhase(session.status);

  const result = await VerificationDecisionRecorder.recordDecision(client, {
    session,
    action,
    reasonCode,
    internalNote,
    applicantMessage,
    reviewerId,
    reviewerRole: actor.role,
    currentWorkflowPhase,
    expectedRevision: payload.expectedRevision,
    req: options.req,
  });
  return { ...result, session: sanitizeReviewSession(result.session) };
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
