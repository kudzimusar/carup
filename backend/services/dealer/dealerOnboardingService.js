import crypto from 'crypto';
import { supabase } from '../../db/supabase.js';
import { logAuditEvent } from '../auditLogger.js';
import { emitDomainEvent } from '../eventBus/eventBusService.js';
import { uploadToStorage, downloadFromStorage, generateSecureReadUrl } from '../storage/storageService.js';
import { DocumentIntelligenceService } from '../document-intelligence/documentIntelligenceService.js';
import { getIdentityAssurance } from '../identity/identityAssuranceService.js';
import { buildDealerActionSummary } from './dealerComplianceService.js';
import { narrateActionSummary } from '../operations/safeNarrationService.js';
import { FIELD_STATE, isFallbackMarker, sanitizeCandidateValue } from '../registration/registrationJourneyService.js';
import {
  createOrUpdateProfile,
  getProfile,
  addBranch,
  listBranches,
  listRequirements,
  listDocuments,
  uploadDocument,
  evaluateCompliance,
  isRequirementBlocking,
  toResponsibilityProjection,
} from './dealerComplianceService.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';

/**
 * O2-X5 — Dealer ONBOARDING access, distinct from Dealer AUTHORITY.
 *
 * The bounded access policy: a proven authenticated user whose OWN registration profile says
 * account_kind=business AND business_type=dealer may work on THEIR OWN dealer application —
 * create/edit it, upload their own evidence, propose branches, view their requirements, prepare
 * workbook migration. That context grants NOTHING else: no Dealer Compliance outcome, no
 * publication eligibility, no Dealer workspace/privileged tools (those stay behind the governed
 * dealer role/tenant relationship — recorded as an explicit dependency in the overview), no
 * other dealer's records, no tenant administration, and no reviewer authority. Business
 * registration is not Dealer approval.
 */

export const DEALER_EVIDENCE_BUCKET = 'ocr-documents';

/**
 * Storage boundary with real defaults — an injectable-collaborator seam (options.storage per
 * call, or this object for route-level tests), never a behavior fork.
 */
export const dealerEvidenceStorage = { uploadToStorage, downloadFromStorage, generateSecureReadUrl };
const DEALER_EVIDENCE_PREFIX = 'dealer-compliance';
const EVIDENCE_PREVIEW_TTL_SECONDS = 180;
const MAX_EVIDENCE_BYTES = 15 * 1024 * 1024;
const ALLOWED_EVIDENCE_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']);

/**
 * Document classes X5 technically supports. TECHNICAL SUPPORT ONLY: whether any of these is
 * mandatory for a given dealer stays a governed requirement-catalogue decision (Dealer
 * Compliance requirements), never something this list asserts.
 */
export const DEALER_DOCUMENT_TYPES = Object.freeze([
  'company_registration', 'tax_document', 'business_licence',
  'address_evidence', 'banking_evidence', 'other',
]);

/** Profile fields a company-document extraction may PROPOSE values for. */
const PROFILE_CANDIDATE_FIELDS = Object.freeze(['legal_name', 'trading_name', 'registration_number', 'tax_id', 'physical_address', 'operating_country']);
const PROFILE_TEXT_FIELDS = Object.freeze(['legal_name', 'trading_name', 'registration_number', 'tax_id', 'physical_address', 'responsible_person', 'operating_country']);

async function writeAudit(client, event) {
  const result = await logAuditEvent(client, event);
  if (!result.success) {
    throw new Error(`Dealer onboarding audit failed: ${result.error || result.fallbackError || 'unknown error'}`);
  }
}

function requireUserId(actor = {}) {
  const userId = actor.id || actor.userId;
  if (!userId) throw new ValidationError('Authenticated user context is required.');
  return userId;
}

/**
 * The access decision, server-confirmed from the caller's OWN registration profile.
 * Fails closed by name; grants onboarding-route access only.
 */
export async function assertDealerOnboardingContext(client = supabase, actor = {}) {
  const userId = requireUserId(actor);
  const { data, error } = await client
    .from('user_registration_profiles')
    .select('user_id, account_kind, business_type, organization_name, onboarding_status')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.account_kind !== 'business' || data.business_type !== 'dealer') {
    throw new ForbiddenError(
      'DEALER_ONBOARDING_CONTEXT_REQUIRED: dealer onboarding is available once your registration profile records a dealer business.',
    );
  }
  return { userId, registrationProfile: data };
}

/** Express middleware: compose AFTER authorizeRole(); attaches req.dealerOnboarding. */
export function requireDealerOnboardingContext() {
  return async (req, res, next) => {
    try {
      req.dealerOnboarding = await assertDealerOnboardingContext(undefined, req.userContext);
      return next();
    } catch (err) {
      const status = err.statusCode || (err.name === 'ForbiddenError' ? 403 : 500);
      return res.status(status === 500 && /CONTEXT_REQUIRED/.test(err.message) ? 403 : status).json({ error: err.message });
    }
  };
}

/** Applicant/list-safe document view: the private storage path NEVER leaves the server. */
export function sanitizeDealerDocument(row) {
  if (!row) return null;
  const { file_ref, ...rest } = row;
  return { ...rest, has_file: Boolean(file_ref) };
}

async function requireOwnDealerProfile(client, userId) {
  const profile = await getProfile(userId);
  if (!profile || profile.user_id !== userId) {
    throw new NotFoundError('No dealer application exists for this account yet.');
  }
  return profile;
}

/**
 * The applicant's full onboarding overview — every fact read from its owning authority, none
 * copied. Zero writes.
 */
export async function getDealerOnboardingOverview(client = supabase, actor = {}) {
  const { userId, registrationProfile } = await assertDealerOnboardingContext(client, actor);
  const profile = await getProfile(userId);
  const owned = profile && profile.user_id === userId ? profile : null;

  const [requirements, documents, branches, compliance] = owned
    ? await Promise.all([
      listRequirements(owned.id),
      listDocuments(owned.id),
      listBranches(owned.id),
      evaluateCompliance(owned.id),
    ])
    : [[], [], [], null];

  const identityAssurance = await getIdentityAssurance(client, userId);
  const blocking = requirements.filter(isRequirementBlocking);

  const whoMustAct = owned
    ? toResponsibilityProjection({ profile: owned, blockingRequirements: requirements })
    : 'subject_action';

  return {
    registration: {
      organization_name: registrationProfile.organization_name,
      onboarding_status: registrationProfile.onboarding_status,
    },
    profile: owned,
    requirements,
    documents: documents.map(sanitizeDealerDocument),
    branches,
    compliance,
    // O2-X6 — sourced from the ONE canonical projection (identity_assurance.v1); the four
    // X5 keys keep their names, and the assurance facts ride alongside. Dealer Compliance
    // stays a separate authority — assurance marks nothing approved.
    responsible_person_identity: {
      effective_state: identityAssurance.identity_state,
      capability_bearing: identityAssurance.usable_for_identity_gated_actions,
      applicant_guidance: identityAssurance.applicant_guidance,
      who_must_act: identityAssurance.who_must_act,
      assurance_level: identityAssurance.assurance_level,
      historically_verified: identityAssurance.historically_verified,
      policy_version: identityAssurance.policy_version,
    },
    who_must_act: whoMustAct,
    blocking_requirement_keys: blocking.map((r) => r.requirement_key),
    // §12 — the explicit, honest dependency: onboarding access ≠ Dealer workspace. The
    // workspace unlocks only through the governed dealer role/tenant relationship, which X5
    // deliberately does not fabricate.
    workspace_access: {
      available: false,
      dependency: 'governed_dealer_role_or_tenant_relationship',
      note: 'Dealer tools unlock after Dealer Compliance approval establishes the governed dealer relationship — a business application alone never does.',
    },
    // O2-X6 §15 — ONE batched "what we still need" summary (domain facts; narration is
    // presentation only and deterministic on this read path).
    action_summary: owned
      ? await narrateActionSummary(await buildDealerActionSummary(owned.id), { ai: null })
      : null,
    measurements: {
      application_created_at: owned?.created_at || null,
      first_evidence_at: documents.length
        ? documents.map((d) => d.created_at).sort()[0]
        : null,
    },
  };
}

/**
 * Create/update the caller's OWN dealer application. USER-SUBMITTED values only: fallback
 * markers are refused by name; candidates the user was SHOWN are compared server-side to
 * derive confirmed-vs-corrected provenance (the X2 discipline); tenant_id and every lifecycle
 * status are not even representable here (the compliance service strips to its editable
 * fields, which since X5 exclude tenant_id).
 */
export async function updateOwnDealerProfile(client = supabase, actor = {}, payload = {}, options = {}) {
  const { userId } = await assertDealerOnboardingContext(client, actor);
  const fields = payload.profile;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    throw new ValidationError('profile is required: submit your business details as an object.');
  }

  for (const field of PROFILE_TEXT_FIELDS) {
    if (fields[field] !== undefined && fields[field] !== null && isFallbackMarker(fields[field])) {
      throw new ValidationError(`"${fields[field]}" is a placeholder, not a real ${field.replace(/_/g, ' ')} — leave the field blank or enter the actual value.`);
    }
  }

  const candidatesSeen = payload.candidates_seen && typeof payload.candidates_seen === 'object' && !Array.isArray(payload.candidates_seen)
    ? payload.candidates_seen
    : {};
  for (const key of Object.keys(candidatesSeen)) {
    if (!PROFILE_CANDIDATE_FIELDS.includes(key)) {
      throw new ValidationError(`Unknown company-document candidate field: ${key}.`);
    }
  }

  const fieldProvenance = {};
  for (const [field, submitted] of Object.entries(fields)) {
    if (!PROFILE_TEXT_FIELDS.includes(field) || submitted === null || submitted === undefined || submitted === '') continue;
    const seen = candidatesSeen[field];
    if (seen === undefined) fieldProvenance[field] = FIELD_STATE.USER_PROVIDED;
    else if (String(seen) === String(submitted)) fieldProvenance[field] = FIELD_STATE.USER_CONFIRMED;
    else fieldProvenance[field] = FIELD_STATE.USER_CORRECTED;
  }

  const existed = Boolean(await getProfile(userId).then((p) => (p && p.user_id === userId ? p : null)).catch(() => null));
  const profile = await createOrUpdateProfile(userId, fields);

  await writeAudit(client, {
    req: options.req,
    event_type: existed ? 'DEALER_ONBOARDING_PROFILE_UPDATED' : 'DEALER_ONBOARDING_PROFILE_SUBMITTED',
    actor_user_id: userId,
    actor_role: actor.role,
    source_route: '/api/dealer-onboarding/profile',
    targetType: 'dealer_profile',
    targetId: profile.id,
    new_value: { field_provenance: fieldProvenance, candidate_fields_shown: Object.keys(candidatesSeen) },
  });

  if (!existed) {
    await emitDomainEvent(null, 'dealer.onboarding.started', {
      dealerId: profile.id, userId, recipientUserId: userId,
    }, null).catch((err) => console.warn('dealer.onboarding.started emit failed:', err.message));
  }

  return { profile, field_provenance: fieldProvenance };
}

function parseEvidencePayload(payload = {}) {
  const image = payload.file || payload.image || payload.dataUri;
  if (!image || typeof image !== 'string') throw new ValidationError('A base64 file payload is required.');
  const match = image.match(/^data:([^;]+);base64,(.+)$/);
  const mimeType = String(payload.mimeType || match?.[1] || 'application/pdf').toLowerCase();
  if (!ALLOWED_EVIDENCE_MIME.has(mimeType)) throw new ValidationError('Unsupported evidence file type.');
  const buffer = Buffer.from(match ? match[2] : image, 'base64');
  if (!buffer.length) throw new ValidationError('Evidence file is empty.');
  if (buffer.length > MAX_EVIDENCE_BYTES) throw new ValidationError('Evidence file exceeds the 15MB limit.');
  const extension = mimeType === 'application/pdf' ? 'pdf' : mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  return { buffer, mimeType, extension };
}

/** Upload REAL private evidence for the caller's own application. Returns no storage path. */
export async function uploadOwnDealerEvidence(client = supabase, actor = {}, payload = {}, options = {}) {
  const { userId } = await assertDealerOnboardingContext(client, actor);
  const profile = await requireOwnDealerProfile(client, userId);

  const docType = String(payload.doc_type || '').trim().toLowerCase();
  if (!DEALER_DOCUMENT_TYPES.includes(docType)) {
    throw new ValidationError(`doc_type must be one of: ${DEALER_DOCUMENT_TYPES.join(', ')}.`);
  }
  const parsed = parseEvidencePayload(payload);
  const storagePath = `${DEALER_EVIDENCE_PREFIX}/${profile.id}/${docType}-${crypto.randomUUID()}.${parsed.extension}`;
  const storage = options.storage || dealerEvidenceStorage;
  await storage.uploadToStorage(DEALER_EVIDENCE_BUCKET, storagePath, parsed.buffer, parsed.mimeType);

  const document = await uploadDocument(profile.id, {
    doc_type: docType,
    file_ref: storagePath,
    expiry_date: payload.expiry_date || null,
  });

  await writeAudit(client, {
    req: options.req,
    event_type: 'DEALER_EVIDENCE_UPLOADED',
    actor_user_id: userId,
    actor_role: actor.role,
    source_route: '/api/dealer-onboarding/documents',
    targetType: 'dealer_compliance_document',
    targetId: document.id,
    new_value: { doc_type: docType, size_bytes: parsed.buffer.length, mime_type: parsed.mimeType },
  });

  await emitDomainEvent(null, 'dealer.compliance.document.received', {
    dealerId: profile.id, userId, recipientUserId: userId, docType,
  }, null).catch((err) => console.warn('dealer document event emit failed:', err.message));

  return sanitizeDealerDocument(document);
}

async function requireOwnDealerDocument(client, userId, docId) {
  const profile = await requireOwnDealerProfile(client, userId);
  const documents = await listDocuments(profile.id);
  const doc = documents.find((d) => String(d.id) === String(docId));
  if (!doc) throw new NotFoundError('Document not found on your dealer application.');
  return { profile, doc };
}

/** Short-lived signed URL for the caller's OWN evidence. The raw path stays server-side. */
export async function getOwnDealerEvidencePreview(client = supabase, actor = {}, docId, options = {}) {
  const { userId } = await assertDealerOnboardingContext(client, actor);
  const { doc } = await requireOwnDealerDocument(client, userId, docId);
  if (!doc.file_ref) throw new NotFoundError('No file is stored for this document.');
  const storage = options.storage || dealerEvidenceStorage;
  const url = await storage.generateSecureReadUrl(DEALER_EVIDENCE_BUCKET, doc.file_ref, EVIDENCE_PREVIEW_TTL_SECONDS);
  if (!url) throw new Error('Could not generate a preview URL.');
  return { url, expiresInSeconds: EVIDENCE_PREVIEW_TTL_SECONDS };
}

/** Reviewer preview (route composes admin role + capability + X3 step-up). Audited. */
export async function getDealerEvidencePreviewForReview(client = supabase, actor = {}, dealerId, docId, options = {}) {
  const documents = await listDocuments(dealerId);
  const doc = documents.find((d) => String(d.id) === String(docId));
  if (!doc || !doc.file_ref) throw new NotFoundError('Document not found for this dealer.');
  const storage = options.storage || dealerEvidenceStorage;
  const url = await storage.generateSecureReadUrl(DEALER_EVIDENCE_BUCKET, doc.file_ref, EVIDENCE_PREVIEW_TTL_SECONDS);
  if (!url) throw new Error('Could not generate a preview URL.');
  await writeAudit(client, {
    req: options.req,
    event_type: 'DEALER_EVIDENCE_PREVIEWED',
    actor_user_id: actor.id || actor.userId,
    actor_role: actor.role,
    source_route: '/api/admin/dealers/:id/documents/:docId/preview',
    targetType: 'dealer_compliance_document',
    targetId: doc.id,
    new_value: { dealer_id: dealerId, ttl_seconds: EVIDENCE_PREVIEW_TTL_SECONDS },
  });
  return { url, expiresInSeconds: EVIDENCE_PREVIEW_TTL_SECONDS };
}

/**
 * Run company-document OCR on the caller's OWN evidence. Output is CANDIDATES persisted on the
 * document row — the document's compliance status and the dealer profile are untouched; a
 * candidate reaches profile truth only through the user's explicit confirm/correct submit.
 */
export async function runOwnDealerDocumentOcr(client = supabase, actor = {}, docId, options = {}) {
  const { userId } = await assertDealerOnboardingContext(client, actor);
  const { doc } = await requireOwnDealerDocument(client, userId, docId);
  if (!doc.file_ref) throw new ValidationError('Upload the document file before running extraction.');

  const storage = options.storage || dealerEvidenceStorage;
  const file = await storage.downloadFromStorage(DEALER_EVIDENCE_BUCKET, doc.file_ref);
  const dataUri = `data:${file.mimeType || 'application/pdf'};base64,${file.buffer.toString('base64')}`;

  const ocr = options.ocr || DocumentIntelligenceService;
  const result = await ocr.extractDocumentData(`dealer_${doc.doc_type}`, dataUri, userId);

  const extracted = result.extractedData || {};
  const flat = { ...extracted, ...(extracted.additional_fields || {}) };
  const candidateSources = {
    legal_name: flat.legal_name ?? flat.company_name ?? flat.owner ?? null,
    trading_name: flat.trading_name ?? null,
    registration_number: flat.registration_number ?? flat.company_registration_number ?? null,
    tax_id: flat.tax_id ?? flat.tax_number ?? flat.tin ?? null,
    physical_address: flat.physical_address ?? flat.address ?? null,
    operating_country: flat.country ?? null,
  };
  const candidates = {};
  for (const [field, raw] of Object.entries(candidateSources)) {
    const value = sanitizeCandidateValue(raw);
    candidates[field] = value.present
      ? { state: FIELD_STATE.MACHINE_CANDIDATE, value: value.value }
      : { state: FIELD_STATE.MISSING };
  }

  const confidence = Number(extracted.confidenceScore);
  const patch = {
    extraction_candidates: candidates,
    extraction_provider: result.provider || null,
    extraction_confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : null,
    extracted_at: new Date().toISOString(),
  };
  const { data: updated, error } = await client
    .from('dealer_compliance_documents')
    .update(patch)
    .eq('id', doc.id)
    .select()
    .single();
  if (error) throw new Error(error.message);

  await writeAudit(client, {
    req: options.req,
    event_type: 'DEALER_DOCUMENT_EXTRACTED',
    actor_user_id: userId,
    actor_role: actor.role,
    source_route: '/api/dealer-onboarding/documents/:id/ocr',
    targetType: 'dealer_compliance_document',
    targetId: doc.id,
    new_value: { provider: patch.extraction_provider, extraction_confidence: patch.extraction_confidence, ocr_success: Boolean(result.success) },
  });

  return { document: sanitizeDealerDocument(updated), candidates, ocr_success: Boolean(result.success) };
}

/** Propose a branch on the caller's own application (existing branch authority). */
export async function addOwnDealerBranch(client = supabase, actor = {}, payload = {}, options = {}) {
  const { userId } = await assertDealerOnboardingContext(client, actor);
  const profile = await requireOwnDealerProfile(client, userId);
  const branch = await addBranch(profile.id, { name: payload.name, address: payload.address });
  await writeAudit(client, {
    req: options.req,
    event_type: 'DEALER_BRANCH_PROPOSED',
    actor_user_id: userId,
    actor_role: actor.role,
    source_route: '/api/dealer-onboarding/branches',
    targetType: 'dealer_branch',
    targetId: branch.id,
    new_value: { name: branch.name || null },
  });
  return branch;
}

export default {
  DEALER_DOCUMENT_TYPES,
  DEALER_EVIDENCE_BUCKET,
  assertDealerOnboardingContext,
  requireDealerOnboardingContext,
  sanitizeDealerDocument,
  getDealerOnboardingOverview,
  updateOwnDealerProfile,
  uploadOwnDealerEvidence,
  getOwnDealerEvidencePreview,
  getDealerEvidencePreviewForReview,
  runOwnDealerDocumentOcr,
  addOwnDealerBranch,
};
