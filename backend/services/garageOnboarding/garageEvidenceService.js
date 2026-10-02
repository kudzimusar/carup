import crypto from 'crypto';
import { supabase as defaultClient } from '../../db/supabase.js';
import { logAuditEvent } from '../auditLogger.js';
import { uploadToStorage, downloadFromStorage, generateSecureReadUrl } from '../storage/storageService.js';
import { DocumentIntelligenceService } from '../document-intelligence/documentIntelligenceService.js';
import { normalizeText } from '../document-intelligence/documentSchemas.js';
import { resolveVisionProvider } from '../ai/ocrVisionProvider.js';
import { NotFoundError, ValidationError, DatabaseError } from '../../utils/errors.js';
import { assertGarageOnboardingContext, APPLICANT_EDITABLE } from './garageApplicationService.js';

/**
 * GMO-2 — business-presence evidence, and OCR as ASSISTANCE ONLY.
 *
 * Two rules govern this whole file, and every function below is shaped by them.
 *
 * 1. **Extraction never decides anything.** It proposes values into a form a person then confirms.
 *    Nothing here writes to `garage_applications.status`, and nothing here can make an application
 *    approvable. A garage whose paperwork OCR cannot read is not a worse garage — in Zimbabwe it is
 *    the ordinary case, and PO-2 was explicit that the manual path stays viable.
 *
 * 2. **The states stay apart.** "We have not tried", "we cannot try", "we tried and it broke",
 *    "we tried and we are unsure", "here are candidates, please check them" and "you checked them"
 *    are six different facts. An applicant told the wrong one loses either time or trust.
 */

export const GARAGE_EVIDENCE_BUCKET = 'ocr-documents';
const GARAGE_EVIDENCE_PREFIX = 'garage-onboarding';
const EVIDENCE_PREVIEW_TTL_SECONDS = 180;
const MAX_EVIDENCE_BYTES = 15 * 1024 * 1024;
const ALLOWED_EVIDENCE_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']);

/** Injectable seam with real defaults — never a behavior fork. */
export const garageEvidenceStorage = { uploadToStorage, downloadFromStorage, generateSecureReadUrl };

/**
 * What a garage may offer as proof it exists and trades.
 *
 * PO-2 forbids requiring formal incorporation, so `company_registration` sits in this list as one
 * option among many rather than at the top of a hierarchy. A photograph of the workshop's own
 * signage is a real signal about a real business.
 */
export const GARAGE_EVIDENCE_TYPES = Object.freeze([
  'premises_photo', 'signage_photo', 'utility_bill', 'lease_or_title',
  'council_or_trade_licence', 'company_registration', 'tax_document',
  'bank_or_mobile_money_statement', 'other',
]);

export const EXTRACTION_STATE = Object.freeze({
  NOT_ATTEMPTED: 'not_attempted',
  UNAVAILABLE: 'unavailable',
  FAILED: 'failed',
  LOW_CONFIDENCE: 'low_confidence',
  AWAITING_CONFIRMATION: 'awaiting_confirmation',
  CONFIRMED: 'confirmed',
});

/** Below this, candidates are shown but explicitly flagged as uncertain rather than offered as fact. */
const LOW_CONFIDENCE_BELOW = 0.6;

/**
 * Extraction is OFF unless the deployment turns it on.
 *
 * This lane is not authorized to activate a live OCR provider, and defaulting to on would spend
 * against a provider the moment the branch reached an environment with a key configured. Off means
 * the honest state `unavailable` and the manual path — which must work anyway.
 */
export const GARAGE_OCR_PROVIDER = 'cloudflare';
export const GARAGE_OCR_MODEL = '@cf/qwen/qwen3.8-27b';

export function garageOcrAvailability(env = process.env) {
  if (env.GARAGE_OCR_ENABLED !== 'true') {
    return { available: false, reason: 'feature_disabled', provider: null, model: null };
  }
  try {
    const provider = resolveVisionProvider(env);
    const model = (() => { try { return provider.model; } catch { return null; } })();
    // At runtime, ask the canonical provider and Document Intelligence predicates directly so
    // Garage cannot drift into a second answer to "is OCR ready?". The injected-env branch exists
    // only to make this pure enough for credential-free unit tests.
    const ambientRuntime = env === process.env;
    const configured = ambientRuntime
      ? provider.isConfigured() === true
      : provider.requiredEnv.every((name) => Boolean(env[name]));
    const mockAllowed = ambientRuntime
      ? DocumentIntelligenceService.isOcrMockAllowed() === true
      : env.NODE_ENV === 'test' && env.ALLOW_OCR_MOCK === 'true';
    const available = provider.id === GARAGE_OCR_PROVIDER
      && model === GARAGE_OCR_MODEL
      && configured
      && mockAllowed === false;
    return {
      available,
      reason: available ? null : 'canonical_provider_not_ready',
      provider: provider.id,
      model,
    };
  } catch {
    return { available: false, reason: 'canonical_provider_unavailable', provider: null, model: null };
  }
}

export function isExtractionEnabled(env = process.env) {
  return garageOcrAvailability(env).available;
}

const FIELD_STATE = Object.freeze({
  MACHINE_CANDIDATE: 'machine_candidate',
  MISSING: 'missing',
});

function sanitizeGarageCandidate(value) {
  const normalized = normalizeText(value);
  return normalized === undefined
    ? { present: false }
    : { present: true, value: normalized };
}
/** Only document-shaped evidence can be read. A photo of a building has nothing to extract. */
const EXTRACTABLE_TYPES = new Set([
  'utility_bill', 'lease_or_title', 'council_or_trade_licence',
  'company_registration', 'tax_document', 'bank_or_mobile_money_statement',
]);

/** The application fields an extraction may PROPOSE. Deliberately narrow. */
export const EVIDENCE_CANDIDATE_FIELDS = Object.freeze(['trading_name', 'address_line', 'location_city']);

/** The storage path never leaves the server. */
export function sanitizeEvidence(row) {
  if (!row) return null;
  const { file_ref: _fileRef, ...safe } = row;
  return { ...safe, has_file: Boolean(_fileRef) };
}

async function writeAudit(client, event) {
  const result = await logAuditEvent(client, event);
  if (!result.success) {
    throw new Error(`Garage onboarding audit failed: ${result.error || result.fallbackError || 'unknown error'}`);
  }
}

/**
 * The caller's own application, and it must still be theirs to change.
 *
 * Evidence follows the application's editability exactly: while CarUp owns a submitted application
 * the applicant cannot quietly swap the documents underneath a reviewer's decision.
 */
async function requireEditableOwnApplication(client, userId, applicationId) {
  const { data, error } = await client
    .from('garage_applications')
    .select('id, applicant_user_id, status')
    .eq('id', applicationId)
    .maybeSingle();
  if (error) throw new DatabaseError(`Could not load your application: ${error.message}`);
  // Someone else's application is reported as absent, not as forbidden — a 403 would confirm it exists.
  if (!data || String(data.applicant_user_id) !== String(userId)) {
    throw new NotFoundError('Application not found.');
  }
  if (!APPLICANT_EDITABLE.includes(data.status)) {
    throw new ValidationError('This application is with CarUp for review, so its evidence cannot be changed right now.');
  }
  return data;
}

function parseEvidencePayload(payload = {}) {
  const raw = payload.file_base64 || payload.fileBase64;
  if (!raw) throw new ValidationError('Attach the file you want to upload.');
  const mimeType = String(payload.mime_type || payload.mimeType || '').trim().toLowerCase();
  if (!ALLOWED_EVIDENCE_MIME.has(mimeType)) {
    throw new ValidationError('Upload a photo (JPG, PNG or WEBP) or a PDF.');
  }
  const base64 = String(raw).includes(',') ? String(raw).split(',').pop() : String(raw);
  let buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch {
    throw new ValidationError('That file could not be read. Try uploading it again.');
  }
  if (!buffer.length) throw new ValidationError('That file appears to be empty.');
  if (buffer.length > MAX_EVIDENCE_BYTES) throw new ValidationError('That file is larger than 15MB. Try a smaller photo.');
  const extension = mimeType === 'application/pdf' ? 'pdf'
    : mimeType === 'image/png' ? 'png'
    : mimeType === 'image/webp' ? 'webp' : 'jpg';
  return { buffer, mimeType, extension };
}

/** Live evidence on an application — what the submission gate and the reviewer both count. */
export async function listEvidence(client = defaultClient, applicationId, options = {}) {
  let query = client
    .from('garage_application_documents')
    .select('*')
    .eq('application_id', applicationId)
    .order('created_at', { ascending: false });
  if (!options.includeRemoved) query = query.is('removed_at', null);
  const { data, error } = await query;
  if (error) throw new DatabaseError(`Could not load the evidence on this application: ${error.message}`);
  return (data || []).map(sanitizeEvidence);
}

/** The applicant's own evidence list. */
export async function listOwnEvidence(client = defaultClient, actor = {}, applicationId) {
  const { userId } = await assertGarageOnboardingContext(client, actor);
  const { data, error } = await client
    .from('garage_applications')
    .select('id, applicant_user_id')
    .eq('id', applicationId)
    .maybeSingle();
  if (error) throw new DatabaseError(`Could not load your application: ${error.message}`);
  if (!data || String(data.applicant_user_id) !== String(userId)) throw new NotFoundError('Application not found.');
  return { documents: await listEvidence(client, applicationId) };
}

/** Upload one piece of business-presence evidence to the caller's own application. */
export async function uploadEvidence(client = defaultClient, actor = {}, applicationId, payload = {}, options = {}) {
  const { userId } = await assertGarageOnboardingContext(client, actor);
  await requireEditableOwnApplication(client, userId, applicationId);

  const evidenceType = String(payload.evidence_type || '').trim().toLowerCase();
  if (!GARAGE_EVIDENCE_TYPES.includes(evidenceType)) {
    throw new ValidationError(`Choose what this document is. One of: ${GARAGE_EVIDENCE_TYPES.join(', ')}.`);
  }
  const parsed = parseEvidencePayload(payload);

  const storagePath = `${GARAGE_EVIDENCE_PREFIX}/${applicationId}/${evidenceType}-${crypto.randomUUID()}.${parsed.extension}`;
  const storage = options.storage || garageEvidenceStorage;
  await storage.uploadToStorage(GARAGE_EVIDENCE_BUCKET, storagePath, parsed.buffer, parsed.mimeType);

  const { data, error } = await client
    .from('garage_application_documents')
    .insert({
      application_id: applicationId,
      uploaded_by_user_id: userId,
      evidence_type: evidenceType,
      description: payload.description ? String(payload.description).trim().slice(0, 400) : null,
      file_ref: storagePath,
      mime_type: parsed.mimeType,
      size_bytes: parsed.buffer.length,
      extraction_state: EXTRACTION_STATE.NOT_ATTEMPTED,
    })
    .select()
    .single();
  if (error) throw new DatabaseError(`Your file was uploaded but could not be recorded: ${error.message}`);

  await writeAudit(client, {
    req: options.req,
    event_type: 'GARAGE_EVIDENCE_UPLOADED',
    actor_user_id: userId,
    actor_role: actor.role,
    source_route: '/api/garage-onboarding/application/:id/evidence',
    targetType: 'garage_application_document',
    targetId: data.id,
    new_value: { application_id: applicationId, evidence_type: evidenceType, size_bytes: parsed.buffer.length, mime_type: parsed.mimeType },
  });

  return { document: sanitizeEvidence(data) };
}

/** Withdraw a document. Soft — a reviewer must still be able to see that it was there. */
export async function removeEvidence(client = defaultClient, actor = {}, applicationId, documentId, options = {}) {
  const { userId } = await assertGarageOnboardingContext(client, actor);
  await requireEditableOwnApplication(client, userId, applicationId);

  const { data, error } = await client
    .from('garage_application_documents')
    .update({ removed_at: new Date().toISOString(), removed_by_user_id: userId })
    .eq('id', documentId)
    .eq('application_id', applicationId)
    .is('removed_at', null)
    .select()
    .maybeSingle();
  if (error) throw new DatabaseError(`Could not remove that document: ${error.message}`);
  if (!data) throw new NotFoundError('Document not found on this application.');

  await writeAudit(client, {
    req: options.req,
    event_type: 'GARAGE_EVIDENCE_WITHDRAWN',
    actor_user_id: userId,
    actor_role: actor.role,
    source_route: '/api/garage-onboarding/application/:id/evidence/:docId',
    targetType: 'garage_application_document',
    targetId: documentId,
    new_value: { application_id: applicationId },
  });
  return { document: sanitizeEvidence(data) };
}

async function requireOwnDocument(client, userId, applicationId, documentId) {
  const { data, error } = await client
    .from('garage_applications')
    .select('id, applicant_user_id')
    .eq('id', applicationId)
    .maybeSingle();
  if (error) throw new DatabaseError(`Could not load your application: ${error.message}`);
  if (!data || String(data.applicant_user_id) !== String(userId)) throw new NotFoundError('Application not found.');

  const { data: doc, error: docError } = await client
    .from('garage_application_documents')
    .select('*')
    .eq('id', documentId)
    .eq('application_id', applicationId)
    .maybeSingle();
  if (docError) throw new DatabaseError(`Could not load that document: ${docError.message}`);
  if (!doc) throw new NotFoundError('Document not found on this application.');
  return doc;
}

/** A short-lived signed URL for the applicant's OWN document. The path stays server-side. */
export async function getOwnEvidencePreview(client = defaultClient, actor = {}, applicationId, documentId, options = {}) {
  const { userId } = await assertGarageOnboardingContext(client, actor);
  const doc = await requireOwnDocument(client, userId, applicationId, documentId);
  if (!doc.file_ref) throw new NotFoundError('No file is stored for this document.');
  const storage = options.storage || garageEvidenceStorage;
  const url = await storage.generateSecureReadUrl(GARAGE_EVIDENCE_BUCKET, doc.file_ref, EVIDENCE_PREVIEW_TTL_SECONDS);
  if (!url) throw new Error('Could not generate a preview link.');
  return { url, expiresInSeconds: EVIDENCE_PREVIEW_TTL_SECONDS };
}

/**
 * Try to read a document so the applicant has less to type.
 *
 * Every exit from this function is a truthful state, and NONE of them changes the application. The
 * failure paths matter more than the success path: a person whose lease photo cannot be parsed must
 * be told "type it yourself", never "there is a problem with your application".
 */
export async function runEvidenceExtraction(client = defaultClient, actor = {}, applicationId, documentId, options = {}) {
  const { userId } = await assertGarageOnboardingContext(client, actor);
  await requireEditableOwnApplication(client, userId, applicationId);
  const doc = await requireOwnDocument(client, userId, applicationId, documentId);
  if (doc.removed_at) throw new ValidationError('That document has been removed from this application.');

  const persist = async (patch) => {
    const { data, error } = await client
      .from('garage_application_documents')
      .update(patch)
      .eq('id', documentId)
      .select()
      .single();
    if (error) throw new DatabaseError(`Could not record the extraction result: ${error.message}`);
    return sanitizeEvidence(data);
  };

  // Two honest ways to be unavailable: the deployment has no extraction, or this kind of evidence
  // has nothing to read. Both leave the applicant with a working manual path and say so.
  const availability = garageOcrAvailability(options.env || process.env);
  if (!availability.available) {
    return {
      document: await persist({
        extraction_state: EXTRACTION_STATE.UNAVAILABLE,
        extraction_provider: null,
        extraction_model: null,
        extraction_confidence: null,
        extracted_at: null,
        extraction_candidates: null,
        extraction_note: 'Automatic reading is not available right now. Type the details in yourself — that works exactly as well.',
      }),
      candidates: null,
      extraction_state: EXTRACTION_STATE.UNAVAILABLE,
      availability,
    };
  }
  if (!EXTRACTABLE_TYPES.has(doc.evidence_type)) {
    return {
      document: await persist({
        extraction_state: EXTRACTION_STATE.UNAVAILABLE,
        extraction_provider: null,
        extraction_model: null,
        extraction_confidence: null,
        extracted_at: null,
        extraction_candidates: null,
        extraction_note: 'There is no text to read on this kind of evidence. Type the details in yourself.',
      }),
      candidates: null,
      extraction_state: EXTRACTION_STATE.UNAVAILABLE,
    };
  }

  // The accepted C2 vision transport consumes images. A PDF is valid private Garage evidence, but
  // it is not silently pushed into an image-only provider and called OCR success.
  if (doc.mime_type === 'application/pdf') {
    return {
      document: await persist({
        extraction_state: EXTRACTION_STATE.UNAVAILABLE,
        extraction_provider: null,
        extraction_model: null,
        extraction_confidence: null,
        extracted_at: null,
        extraction_candidates: null,
        extraction_note: 'Automatic reading of PDFs is not available yet. Type the details in yourself.',
      }),
      candidates: null,
      extraction_state: EXTRACTION_STATE.UNAVAILABLE,
    };
  }

  const storage = options.storage || garageEvidenceStorage;
  const ocr = options.ocr || DocumentIntelligenceService;

  let result;
  try {
    const file = await storage.downloadFromStorage(GARAGE_EVIDENCE_BUCKET, doc.file_ref);
    const dataUri = `data:${file.mimeType || doc.mime_type};base64,${file.buffer.toString('base64')}`;
    result = await ocr.extractDocumentData('business_document', dataUri, userId);
  } catch (err) {
    // A provider outage is an extraction failure, never an application failure.
    return {
      document: await persist({
        extraction_state: EXTRACTION_STATE.FAILED,
        extraction_provider: availability.provider,
        extraction_model: availability.model,
        extracted_at: new Date().toISOString(),
        extraction_note: 'We could not read this document automatically. Your upload is safe — type the details in yourself.',
      }),
      candidates: null,
      extraction_state: EXTRACTION_STATE.FAILED,
      error: err.message,
    };
  }

  if (!result || result.success !== true) {
    return {
      document: await persist({
        extraction_state: EXTRACTION_STATE.FAILED,
        extraction_provider: result?.provider || availability.provider || null,
        extraction_model: result?.model || availability.model || null,
        extracted_at: new Date().toISOString(),
        extraction_note: 'We could not read this document automatically. Your upload is safe — type the details in yourself.',
      }),
      candidates: null,
      extraction_state: EXTRACTION_STATE.FAILED,
    };
  }

  // Success is usable only with exact canonical provider/model provenance. Missing or foreign
  // provenance becomes a failed convenience, never a Garage/application failure.
  if (result.provider !== GARAGE_OCR_PROVIDER || result.model !== GARAGE_OCR_MODEL) {
    return {
      document: await persist({
        extraction_state: EXTRACTION_STATE.FAILED,
        extraction_provider: result.provider || null,
        extraction_model: result.model || null,
        extracted_at: new Date().toISOString(),
        extraction_note: 'We could not verify how this automatic reading was produced. Type the details in yourself.',
      }),
      candidates: null,
      extraction_state: EXTRACTION_STATE.FAILED,
    };
  }

  const extracted = result.extractedData || {};
  const flat = { ...extracted, ...(extracted.additional_fields || {}) };
  const sources = {
    trading_name: flat.trading_name ?? flat.company_name ?? flat.business_name ?? flat.legal_name ?? null,
    address_line: flat.physical_address ?? flat.address ?? null,
    // business_document v1 does not formally request city/town yet. If the canonical projection
    // does not contain it, this remains MISSING; C3 does not invent a Garage-specific schema.
    location_city: flat.city ?? flat.town ?? null,
  };
  const candidates = {};
  let anyPresent = false;
  for (const field of EVIDENCE_CANDIDATE_FIELDS) {
    // Canonical document-schema normalization stops "N/A"/"Unknown"/null-like text being offered as applicant data.
    const value = sanitizeGarageCandidate(sources[field]);
    if (value.present) anyPresent = true;
    candidates[field] = value.present
      ? { state: FIELD_STATE.MACHINE_CANDIDATE, value: value.value }
      : { state: FIELD_STATE.MISSING };
  }

  const rawConfidence = Number(extracted.confidenceScore);
  const confidence = Number.isFinite(rawConfidence) ? Math.min(1, Math.max(0, rawConfidence)) : null;

  // A run that succeeded technically but found nothing usable is not a success to show a person.
  if (!anyPresent) {
    return {
      document: await persist({
        extraction_state: EXTRACTION_STATE.FAILED,
        extraction_provider: result.provider || null,
        extraction_model: result.model || null,
        extraction_confidence: confidence,
        extracted_at: new Date().toISOString(),
        extraction_note: 'We read the document but could not find the garage details on it. Type them in yourself.',
      }),
      candidates: null,
      extraction_state: EXTRACTION_STATE.FAILED,
    };
  }

  const state = (confidence !== null && confidence < LOW_CONFIDENCE_BELOW)
    ? EXTRACTION_STATE.LOW_CONFIDENCE
    : EXTRACTION_STATE.AWAITING_CONFIRMATION;

  const document = await persist({
    extraction_state: state,
    extraction_candidates: candidates,
    extraction_provider: result.provider || null,
    extraction_model: result.model || null,
    extraction_confidence: confidence,
    extracted_at: new Date().toISOString(),
    extraction_note: state === EXTRACTION_STATE.LOW_CONFIDENCE
      ? 'We are not confident we read this correctly. Please check each value before you use it.'
      : 'Check these against your document before you use them.',
  });

  await writeAudit(client, {
    req: options.req,
    event_type: 'GARAGE_EVIDENCE_EXTRACTED',
    actor_user_id: userId,
    actor_role: actor.role,
    source_route: '/api/garage-onboarding/application/:id/evidence/:docId/extract',
    targetType: 'garage_application_document',
    targetId: documentId,
    new_value: { extraction_state: state, provider: result.provider || null, model: result.model || null, extraction_confidence: confidence },
  });

  return { document, candidates, extraction_state: state };
}

/**
 * The applicant has looked at the candidates and decided.
 *
 * This function records that they decided. It does NOT write their application — the values reach
 * the application only through the ordinary autosave the person drives, so what lands in the form
 * is always what they saw and accepted on screen.
 */
export async function acknowledgeExtraction(client = defaultClient, actor = {}, applicationId, documentId, options = {}) {
  const { userId } = await assertGarageOnboardingContext(client, actor);
  await requireEditableOwnApplication(client, userId, applicationId);
  const doc = await requireOwnDocument(client, userId, applicationId, documentId);

  const ACKNOWLEDGEABLE = [EXTRACTION_STATE.AWAITING_CONFIRMATION, EXTRACTION_STATE.LOW_CONFIDENCE];
  if (!ACKNOWLEDGEABLE.includes(doc.extraction_state)) {
    throw new ValidationError('There are no suggested values on this document to confirm.');
  }

  const { data, error } = await client
    .from('garage_application_documents')
    .update({ extraction_state: EXTRACTION_STATE.CONFIRMED })
    .eq('id', documentId)
    .eq('extraction_state', doc.extraction_state)
    .select()
    .maybeSingle();
  if (error) throw new DatabaseError(`Could not record your confirmation: ${error.message}`);
  if (!data) throw new ValidationError('This document changed while you were looking at it. Open it again.');

  await writeAudit(client, {
    req: options.req,
    event_type: 'GARAGE_EVIDENCE_EXTRACTION_ACKNOWLEDGED',
    actor_user_id: userId,
    actor_role: actor.role,
    source_route: '/api/garage-onboarding/application/:id/evidence/:docId/acknowledge',
    targetType: 'garage_application_document',
    targetId: documentId,
    new_value: { from_state: doc.extraction_state },
  });
  return { document: sanitizeEvidence(data) };
}
