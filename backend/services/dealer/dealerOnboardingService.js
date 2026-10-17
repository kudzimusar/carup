import crypto from 'crypto';
import { supabase } from '../../db/supabase.js';
import { logAuditEvent } from '../auditLogger.js';
import { uploadToStorage, generateSecureReadUrl } from '../storage/storageService.js';
import { getIdentityAssurance, toSubjectIdentityAssurance } from '../identity/identityAssuranceService.js';
import { isFallbackMarker } from '../registration/registrationJourneyService.js';
import {
  createOrUpdateProfile,
  getProfile,
  addBranch,
  listBranches,
  listRequirements,
  listDocuments,
  uploadDocument,
  evaluateCompliance,
  buildDealerActionSummary,
  toResponsibilityProjection,
} from './dealerComplianceService.js';
import { CarUpError, DatabaseError, ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

/**
 * O2-X5 — Dealer ONBOARDING access, distinct from Dealer AUTHORITY (ported by OC-5C from PR #208).
 *
 * The bounded access policy: a proven authenticated user whose OWN registration profile says
 * account_kind=business AND business_type=dealer may work on THEIR OWN dealer application —
 * create/edit it, upload their own evidence, propose branches, view their requirements. That context
 * grants NOTHING else: no Dealer Compliance outcome (recordDecision stays the sole writer), no
 * publication eligibility, no Dealer workspace or listing authority (those stay behind the governed
 * dealer role / tenant relationship — reported as an explicit dependency in the overview), no other
 * dealer's records, no tenant administration, no reviewer authority. Business registration is not
 * Dealer approval. The registration fields this rests on are fixed once registered (X2, OC-5C).
 *
 * OC-5C — what changed from #208, and why:
 *   - the responsible person's identity is the identity_assurance.v1 SUBJECT view (never the internal
 *     'compromised' state or a reason code);
 *   - evidence previews sign ONLY a path under this dealer's own evidence prefix. The dealer-role
 *     metadata route accepted any client file_ref, so a document could point at someone else's
 *     private object and the own-preview would have signed it;
 *   - company-document OCR is DEFERRED: #208 called extractDocumentData directly and trusted its
 *     confidence ("DI observes, domains decide" requires the governed pattern — owner/OCR programme);
 *   - a failed profile lookup propagates (#208 swallowed it, then audited a re-submission as new and
 *     announced onboarding twice); audits follow the durable write and are reported (audit_recorded),
 *     never a 500 for a write that happened; observability events log through the structured logger;
 *   - the action summary is the domain's own (buildDealerActionSummary) — no narration layer.
 */

export const DEALER_EVIDENCE_BUCKET = 'ocr-documents';
const DEALER_EVIDENCE_PREFIX = 'dealer-compliance';
const EVIDENCE_PREVIEW_TTL_SECONDS = 180;
const MAX_EVIDENCE_BYTES = 15 * 1024 * 1024;
const ALLOWED_EVIDENCE_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']);

/**
 * Storage boundary with real defaults — an injectable-collaborator seam (options.storage per call, or
 * this object for route-level tests), never a behavior fork.
 */
export const dealerEvidenceStorage = { uploadToStorage, generateSecureReadUrl };

/**
 * Document classes X5 technically supports. TECHNICAL SUPPORT ONLY: whether any of these is mandatory
 * for a given dealer stays a governed requirement-catalogue decision (Dealer Compliance requirements).
 */
export const DEALER_DOCUMENT_TYPES = Object.freeze([
  'company_registration', 'tax_document', 'business_licence',
  'address_evidence', 'banking_evidence', 'other',
]);

const PROFILE_TEXT_FIELDS = Object.freeze(['legal_name', 'trading_name', 'registration_number', 'tax_id', 'physical_address', 'responsible_person', 'operating_country']);

function requireUserId(actor = {}) {
  const userId = actor.id || actor.userId;
  if (!userId) throw new ValidationError('Authenticated user context is required.');
  return userId;
}

/** The audit follows the durable write: reported, and logged when lost — never a 500 for a saved write. */
async function auditAfterWrite(client, event) {
  const result = await logAuditEvent(client, event);
  if (result?.success === true) return true;
  logger.error('DEALER_ONBOARDING', `${event.event_type} written but its audit was not recorded`, { error: result?.error || result?.fallbackError || 'unknown error' });
  return false;
}

/**
 * Observability only: these are not business work for the transactional outbox.
 * The durable authority is the dealer row plus trust_audit_events written by auditAfterWrite();
 * the structured logger keeps operational visibility without creating an unconsumable event.
 */
function announce(eventType, payload) {
  logger.info('DEALER_ONBOARDING', eventType, payload);
}

/**
 * The access decision, server-confirmed from the caller's OWN registration profile. Fails closed by
 * name; grants onboarding-route access only. A read failure is a failure — never "you are not a dealer".
 */
export async function assertDealerOnboardingContext(client = supabase, actor = {}) {
  const userId = requireUserId(actor);
  const { data, error } = await client
    .from('user_registration_profiles')
    .select('user_id, account_kind, business_type, organization_name, onboarding_status')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new DatabaseError(`Could not read your registration profile: ${error.message}`);
  if (!data || data.account_kind !== 'business' || data.business_type !== 'dealer') {
    throw new ForbiddenError(
      'DEALER_ONBOARDING_CONTEXT_REQUIRED: dealer onboarding is available once your registration records a dealer business.',
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
      return next(err);
    }
  };
}

/** Applicant/list-safe document view: the private storage path NEVER leaves the server. */
export function sanitizeDealerDocument(row) {
  if (!row) return null;
  const { file_ref: fileRef, ...rest } = row;
  return { ...rest, has_file: Boolean(fileRef) };
}

/** Only a path this service wrote for THIS dealer is ever signed. */
function ownEvidencePrefix(dealerId) {
  return `${DEALER_EVIDENCE_PREFIX}/${dealerId}/`;
}
function assertSignableEvidencePath(dealerId, fileRef) {
  const path = String(fileRef || '');
  if (!path.startsWith(ownEvidencePrefix(dealerId)) || path.includes('..')) {
    throw new NotFoundError('No previewable file is stored for this document.');
  }
  return path;
}

async function ownDealerProfile(userId) {
  const profile = await getProfile(userId);
  return profile && String(profile.user_id) === String(userId) ? profile : null;
}

async function requireOwnDealerProfile(userId) {
  const profile = await ownDealerProfile(userId);
  if (!profile) throw new NotFoundError('No dealer application exists for this account yet.');
  return profile;
}

/** The person's identity standing for this surface — the subject view, or an honest "unavailable". */
async function responsiblePersonIdentity(client, userId) {
  try {
    const subject = toSubjectIdentityAssurance(await getIdentityAssurance(client, userId));
    return {
      available: true,
      status: subject.status,
      status_label: subject.status_label,
      assurance_level: subject.assurance_level,
      capability_bearing: subject.usable_for_identity_gated_actions === true,
      applicant_guidance: subject.applicant_guidance,
      who_must_act: subject.who_must_act,
      historically_verified: subject.historically_verified,
      policy_version: subject.policy_version,
    };
  } catch (cause) {
    const err = new CarUpError('Your identity status could not be read right now. Please try again shortly.', 503, 'IDENTITY_STATUS_UNAVAILABLE');
    err.cause = cause;
    throw err;
  }
}

/**
 * The applicant's full onboarding overview — every fact read from its owning authority, none copied.
 * Zero writes.
 */
export async function getDealerOnboardingOverview(client = supabase, actor = {}) {
  const { userId, registrationProfile } = await assertDealerOnboardingContext(client, actor);
  const owned = await ownDealerProfile(userId);

  const [requirements, documents, branches, compliance, actionSummary] = owned
    ? await Promise.all([
      listRequirements(owned.id),
      listDocuments(owned.id),
      listBranches(owned.id),
      evaluateCompliance(owned.id),
      buildDealerActionSummary(owned.id, { profile: owned }),
    ])
    : [[], [], [], null, null];
  const identity = await responsiblePersonIdentity(client, userId);

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
    // O2-X6 — the ONE identity projection, through its subject view. Dealer Compliance stays a separate
    // authority: assurance marks nothing approved.
    responsible_person_identity: identity,
    who_must_act: owned ? toResponsibilityProjection({ profile: owned, blockingRequirements: requirements }) : 'subject_action',
    // O2-X6 §15 — ONE batched summary of what is still needed, from domain facts.
    action_summary: actionSummary,
    // The explicit, honest dependency: onboarding access ≠ Dealer workspace. The workspace unlocks only
    // through the governed dealer role/tenant relationship, which X5 deliberately does not fabricate.
    workspace_access: {
      available: false,
      dependency: 'governed_dealer_role_or_tenant_relationship',
      note: 'Dealer tools unlock after Dealer Compliance approval establishes the governed dealer relationship — a business application alone never does.',
    },
    // Company-document OCR is not offered on this lineage (deferred to the governed OCR pattern).
    document_extraction: { available: false, reason: 'Automatic reading of company documents is not available yet — enter your business details yourself.' },
    measurements: {
      application_created_at: owned?.created_at || null,
      first_evidence_at: documents.length ? documents.map((d) => d.created_at).filter(Boolean).sort()[0] || null : null,
    },
  };
}

/**
 * Create/update the caller's OWN dealer application with USER-SUBMITTED values. Fallback markers are
 * refused by name; tenant_id and every lifecycle status are not representable here (the compliance
 * service strips to its editable fields, which exclude tenant_id).
 */
export async function updateOwnDealerProfile(client = supabase, actor = {}, payload = {}, options = {}) {
  const { userId } = await assertDealerOnboardingContext(client, actor);
  const fields = payload.profile;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    throw new ValidationError('profile is required: submit your business details as an object.');
  }
  if (payload.candidates_seen !== undefined) {
    // Nothing is read from company documents on this lineage, so there is nothing that could have been shown.
    throw new ValidationError('No document candidates exist to confirm — enter your business details yourself.');
  }
  for (const field of PROFILE_TEXT_FIELDS) {
    if (fields[field] !== undefined && fields[field] !== null && isFallbackMarker(fields[field])) {
      throw new ValidationError(`"${fields[field]}" is a placeholder, not a real ${field.replace(/_/g, ' ')} — leave the field blank or enter the actual value.`);
    }
  }

  // A failed lookup propagates: guessing "new" would audit a re-submission as a first one and announce it twice.
  const existing = await ownDealerProfile(userId);
  const profile = await createOrUpdateProfile(userId, fields);
  const changedFields = PROFILE_TEXT_FIELDS.filter((field) => fields[field] !== undefined
    && (existing?.[field] ?? null) !== (profile[field] ?? null));

  const auditRecorded = await auditAfterWrite(client, {
    req: options.req,
    event_type: existing ? 'DEALER_ONBOARDING_PROFILE_UPDATED' : 'DEALER_ONBOARDING_PROFILE_SUBMITTED',
    actor_user_id: userId,
    actor_role: actor.role,
    source_route: '/api/dealer-onboarding/profile',
    targetType: 'dealer_profile',
    targetId: profile.id,
    new_value: { changed_fields: changedFields },
  });

  if (!existing) {
    await announce('dealer.onboarding.started', { dealerId: profile.id, userId, recipientUserId: userId });
  }
  return { profile, changed_fields: changedFields, audit_recorded: auditRecorded };
}

/** Image/PDF signatures — the declared type must be what the bytes are. */
function sniffEvidenceMime(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  return null;
}

function parseEvidencePayload(payload = {}) {
  const raw = payload.file || payload.image || payload.dataUri;
  if (!raw || typeof raw !== 'string') throw new ValidationError('Attach the file you want to upload.');
  const match = raw.match(/^data:([^;]+);base64,(.+)$/);
  const declared = String(payload.mimeType || match?.[1] || '').toLowerCase().replace('image/jpg', 'image/jpeg');
  if (!ALLOWED_EVIDENCE_MIME.has(declared)) throw new ValidationError('Upload a photo (JPG, PNG or WEBP) or a PDF.');
  const buffer = Buffer.from(match ? match[2] : raw, 'base64');
  if (!buffer.length) throw new ValidationError('That file appears to be empty.');
  if (buffer.length > MAX_EVIDENCE_BYTES) throw new ValidationError('That file is larger than 15MB. Try a smaller file.');
  const actual = sniffEvidenceMime(buffer);
  if (actual !== declared) {
    throw new ValidationError('That file is not the type it claims to be. Upload a real JPG, PNG, WEBP photo or a PDF.');
  }
  const extension = actual === 'application/pdf' ? 'pdf' : actual === 'image/png' ? 'png' : actual === 'image/webp' ? 'webp' : 'jpg';
  return { buffer, mimeType: actual, extension };
}

/** Upload REAL private evidence for the caller's own application. Returns no storage path. */
export async function uploadOwnDealerEvidence(client = supabase, actor = {}, payload = {}, options = {}) {
  const { userId } = await assertDealerOnboardingContext(client, actor);
  const profile = await requireOwnDealerProfile(userId);

  const docType = String(payload.doc_type || '').trim().toLowerCase();
  if (!DEALER_DOCUMENT_TYPES.includes(docType)) {
    throw new ValidationError(`doc_type must be one of: ${DEALER_DOCUMENT_TYPES.join(', ')}.`);
  }
  const parsed = parseEvidencePayload(payload);
  const storagePath = `${ownEvidencePrefix(profile.id)}${docType}-${crypto.randomUUID()}.${parsed.extension}`;
  const storage = options.storage || dealerEvidenceStorage;
  await storage.uploadToStorage(DEALER_EVIDENCE_BUCKET, storagePath, parsed.buffer, parsed.mimeType);

  let document;
  try {
    document = await uploadDocument(profile.id, { doc_type: docType, file_ref: storagePath, expiry_date: payload.expiry_date || null });
  } catch (err) {
    throw new DatabaseError(`Your file was uploaded but could not be recorded: ${err.message}`);
  }

  const auditRecorded = await auditAfterWrite(client, {
    req: options.req,
    event_type: 'DEALER_EVIDENCE_UPLOADED',
    actor_user_id: userId,
    actor_role: actor.role,
    source_route: '/api/dealer-onboarding/documents',
    targetType: 'dealer_compliance_document',
    targetId: document.id,
    new_value: { doc_type: docType, size_bytes: parsed.buffer.length, mime_type: parsed.mimeType },
  });
  await announce('dealer.compliance.document.received', { dealerId: profile.id, userId, recipientUserId: userId, docType });

  return { document: sanitizeDealerDocument(document), audit_recorded: auditRecorded };
}

/** Short-lived signed URL for the caller's OWN evidence. The raw path stays server-side. */
export async function getOwnDealerEvidencePreview(client = supabase, actor = {}, docId, options = {}) {
  const { userId } = await assertDealerOnboardingContext(client, actor);
  const profile = await requireOwnDealerProfile(userId);
  const doc = (await listDocuments(profile.id)).find((d) => String(d.id) === String(docId));
  if (!doc) throw new NotFoundError('Document not found on your dealer application.');
  const path = assertSignableEvidencePath(profile.id, doc.file_ref);
  const storage = options.storage || dealerEvidenceStorage;
  const url = await storage.generateSecureReadUrl(DEALER_EVIDENCE_BUCKET, path, EVIDENCE_PREVIEW_TTL_SECONDS);
  if (!url) throw new Error('Could not generate a preview link.');
  return { url, expiresInSeconds: EVIDENCE_PREVIEW_TTL_SECONDS };
}

/** Reviewer listing: sanitized metadata only — even a reviewer's list carries no storage path. */
export async function listDealerDocumentsForReview(dealerId) {
  return (await listDocuments(dealerId)).map(sanitizeDealerDocument);
}

/**
 * Reviewer raw-evidence preview (the route composes admin role + the Dealer Compliance review capability
 * + a fresh X3 step-up). Audited BEFORE the link is handed over: no unaudited access to private evidence.
 */
export async function getDealerEvidencePreviewForReview(client = supabase, actor = {}, dealerId, docId, options = {}) {
  const doc = (await listDocuments(dealerId)).find((d) => String(d.id) === String(docId));
  if (!doc) throw new NotFoundError('Document not found for this dealer.');
  const path = assertSignableEvidencePath(dealerId, doc.file_ref);
  const storage = options.storage || dealerEvidenceStorage;
  const url = await storage.generateSecureReadUrl(DEALER_EVIDENCE_BUCKET, path, EVIDENCE_PREVIEW_TTL_SECONDS);
  if (!url) throw new Error('Could not generate a preview link.');
  const audit = await logAuditEvent(client, {
    req: options.req,
    event_type: 'DEALER_EVIDENCE_PREVIEWED',
    actor_user_id: actor.id || actor.userId,
    actor_role: actor.role,
    source_route: '/api/admin/dealers/:id/documents/:docId/preview',
    targetType: 'dealer_compliance_document',
    targetId: doc.id,
    new_value: { dealer_id: dealerId, ttl_seconds: EVIDENCE_PREVIEW_TTL_SECONDS },
  });
  if (audit?.success !== true) {
    throw new CarUpError('The evidence preview could not be audited, so it was not opened. Try again shortly.', 503, 'EVIDENCE_PREVIEW_AUDIT_UNAVAILABLE');
  }
  return { url, expiresInSeconds: EVIDENCE_PREVIEW_TTL_SECONDS };
}

/** Propose a branch on the caller's own application (existing branch authority). */
export async function addOwnDealerBranch(client = supabase, actor = {}, payload = {}, options = {}) {
  const { userId } = await assertDealerOnboardingContext(client, actor);
  const profile = await requireOwnDealerProfile(userId);
  const name = String(payload.name ?? '').trim().slice(0, 160);
  if (!name || isFallbackMarker(name)) throw new ValidationError('Give the branch a real name.');
  const address = String(payload.address ?? '').trim().slice(0, 240) || null;
  if (address && isFallbackMarker(address)) throw new ValidationError(`"${address}" is a placeholder, not a real address.`);
  const branch = await addBranch(profile.id, { name, address });
  const auditRecorded = await auditAfterWrite(client, {
    req: options.req,
    event_type: 'DEALER_BRANCH_PROPOSED',
    actor_user_id: userId,
    actor_role: actor.role,
    source_route: '/api/dealer-onboarding/branches',
    targetType: 'dealer_branch',
    targetId: branch.id,
    new_value: { name: branch.name || null },
  });
  return { branch, audit_recorded: auditRecorded };
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
  listDealerDocumentsForReview,
  getDealerEvidencePreviewForReview,
  addOwnDealerBranch,
};
