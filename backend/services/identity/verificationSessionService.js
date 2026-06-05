import crypto from 'crypto';
import { supabase } from '../../db/supabase.js';
import { logAuditEvent } from '../auditLogger.js';
import { DocumentIntelligenceService } from '../document-intelligence/documentIntelligenceService.js';
import { downloadFromStorage, uploadToStorage } from '../storage/storageService.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';

const BUCKET = 'ocr-documents';
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const DOUBLE_SIDED_DOCUMENTS = new Set(['national_id', 'driver_license', 'drivers_license', 'registration_book']);
const PUBLIC_OCR_FIELDS = ['first_name', 'last_name', 'national_id_number', 'date_of_birth', 'country'];
const VALID_SIDES = new Set(['front', 'back', 'selfie']);

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
    const finalStatus = result.success ? 'verified' : 'pending_manual_review';
    const failureReason = result.success ? null : (result.error || result.ocrFailureReason || 'OCR requires manual review.');
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

export {
  parseImagePayload,
  sanitizeOcrResult,
  sanitizeSession,
};
