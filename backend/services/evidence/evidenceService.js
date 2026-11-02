import crypto from 'crypto';
import { supabase } from '../../db/supabase.js';
import { resolveEvidenceVision, analysisNotRunRecord } from '../ai/evidenceVisionProvider.js';
import {
  resolveClassification,
  deriveLegacyCompatibilityType,
  isDocumentArtifactRow,
  isPrivateByTypeRow,
  semanticClassificationLabel,
  GENERIC_COMPAT_TYPES,
  GENERIC_COMPAT_DOCUMENT_TYPE,
} from './evidenceTaxonomy.js';
import { computePerceptualHash } from './perceptualHash.js';
import { computeContentHash, recordProvenanceEvent } from './provenanceService.js';
import {
  OPERATIONS_CAPABILITIES,
  hasOperationsCapability,
  isProvenSession,
} from '../operations/operationsAuthorizationService.js';
import { logger } from '../../utils/logger.js';

export const evidenceTypes = [
  'import_photo',
  'auction_photo',
  'customs_photo',
  'inspection_photo',
  'odometer_photo',
  'damage_photo',
  'repair_photo',
  'dealer_listing_photo',
  'owner_handover_photo',
  'registration_document',
  'insurance_document',
  'police_clearance_document',
  'ownership_transfer_document',
  // Generic compatibility artifact-form values (Operations M1): valid ONLY
  // together with a canonical evidence_class + evidence_subtype. They exist so
  // canonical-first uploads never have to borrow a false legacy meaning
  // (an import invoice must never be stored as 'registration_document').
  ...GENERIC_COMPAT_TYPES
];

export const documentEvidenceTypes = [
  'registration_document',
  'insurance_document',
  'police_clearance_document',
  'ownership_transfer_document',
  GENERIC_COMPAT_DOCUMENT_TYPE
];

export const imageEvidenceTypes = evidenceTypes.filter((type) => !documentEvidenceTypes.includes(type));

export const verificationStatuses = ['pending', 'verified', 'rejected', 'disputed', 'superseded'];

export const uploadRoleMatrix = {
  import_photo: ['government', 'admin', 'dealer'],
  auction_photo: ['dealer', 'admin'],
  customs_photo: ['government', 'admin', 'dealer'],
  inspection_photo: ['government', 'admin', 'dealer'],
  odometer_photo: ['owner', 'dealer', 'admin', 'mechanic'],
  damage_photo: ['owner', 'dealer', 'admin', 'mechanic', 'insurance'],
  repair_photo: ['mechanic', 'owner', 'dealer', 'admin'],
  dealer_listing_photo: ['dealer', 'admin'],
  owner_handover_photo: ['owner', 'dealer', 'admin'],
  registration_document: ['owner', 'dealer', 'admin', 'government'],
  insurance_document: ['owner', 'dealer', 'admin', 'government', 'insurance'],
  police_clearance_document: ['government', 'admin'],
  ownership_transfer_document: ['owner', 'dealer', 'admin', 'government']
};

export const reviewRoles = ['admin', 'government', 'dealer', 'mechanic'];

/**
 * Canonical-class upload authorization (Operations M1). When an upload is
 * canonical-first (class + subtype supplied), authorization is decided by the
 * life-stage class — not by whichever compatibility evidence_type was derived.
 * Owners may file their own purchase/import/registration/inspection documents
 * (Zimbabwe Seller reality plan §5: the seller files the import evidence set).
 */
export const classUploadRoleMatrix = {
  import: ['owner', 'dealer', 'admin', 'government'],
  auction: ['dealer', 'admin'],
  accident: ['owner', 'dealer', 'admin', 'mechanic', 'insurance'],
  repair: ['mechanic', 'owner', 'dealer', 'admin'],
  inspection: ['owner', 'dealer', 'admin', 'government', 'mechanic'],
  ownership_transfer: ['owner', 'dealer', 'admin', 'government'],
  registration: ['owner', 'dealer', 'admin', 'government'],
  dealer_listing: ['dealer', 'admin'],
  current_condition: ['owner', 'dealer', 'admin', 'mechanic'],
};

/** Subtype-level authorization overrides (tighter than their class). */
export const subtypeUploadRoleOverrides = {
  'registration:police_clearance_first_registration': ['government', 'admin'],
};

export const allowedMimeTypes = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/pdf'
];

export function normalizeEvidenceType(input) {
  return String(input || '').trim();
}

export function isDocumentEvidence(evidenceType) {
  return documentEvidenceTypes.includes(evidenceType);
}

export function isSupportedMimeType(mimeType) {
  return allowedMimeTypes.includes(String(mimeType || '').toLowerCase());
}

export function canUploadEvidence(evidenceType, role) {
  const allowedRoles = uploadRoleMatrix[evidenceType] || [];
  return allowedRoles.includes(role) || role === 'admin';
}

/**
 * Canonical-aware upload authorization (Operations M1).
 * Canonical-first uploads (explicit class + subtype) are authorized by the
 * life-stage class matrix (with subtype overrides). Legacy-typed uploads keep
 * the historical per-type matrix so existing clients are unaffected.
 */
export function canUploadEvidenceRecord({ evidenceType, evidenceClass, evidenceSubtype, explicitCanonical }, role) {
  if (role === 'admin') return true;
  if (explicitCanonical && evidenceClass) {
    const override = evidenceSubtype ? subtypeUploadRoleOverrides[`${evidenceClass}:${evidenceSubtype}`] : null;
    const allowed = override || classUploadRoleMatrix[evidenceClass] || [];
    return allowed.includes(role);
  }
  return canUploadEvidence(evidenceType, role);
}

/**
 * Canonical-aware artifact-form check for a NORMALIZED upload (pre-insert).
 * Prefers the canonical subtype's document flag; falls back to the legacy type.
 */
export function isDocumentUpload(normalized) {
  return isDocumentArtifactRow({
    evidence_class: normalized.evidenceClass,
    evidence_subtype: normalized.evidenceSubtype,
    evidence_type: normalized.evidenceType,
  });
}

/**
 * OC-5R-REL-01: is this NORMALIZED upload private by type (an odometer photo)? The server derives
 * private storage for it whatever the caller asks for — see `isPrivateByTypeRow`.
 */
export function isPrivateByTypeUpload(normalized) {
  return isPrivateByTypeRow({
    evidence_class: normalized.evidenceClass,
    evidence_subtype: normalized.evidenceSubtype,
    evidence_type: normalized.evidenceType,
  });
}

/** The private bucket. Read-side privacy is decided by bucket (publicVehicleProjection). */
export const PRIVATE_EVIDENCE_BUCKET = 'ocr-documents';

const NON_PUBLIC_VISIBILITIES = Object.freeze(['private', 'restricted', 'government_only']);

/**
 * OC-5R-REL-01: the ONE bucket decision for an evidence artifact — private when it is a document, is
 * private by type (an odometer photo), or carries a non-public visibility. The upload route uses it
 * for the bytes it stores and for the bucket a remote create must name, so the type keeps an
 * odometer photo private even if a visibility decision ever regressed.
 */
export function evidenceStorageBucket({ isDocument = false, privateByType = false, visibility = null } = {}) {
  return (isDocument || privateByType || NON_PUBLIC_VISIBILITIES.includes(visibility)) ? PRIVATE_EVIDENCE_BUCKET : 'vehicle-images';
}

/**
 * Exposure ordering for the evidence visibility vocabulary, least to most public. `government_only`
 * is narrower than `private`: it is readable by one authority rather than by the vehicle's own
 * people.
 */
export const EVIDENCE_VISIBILITY_EXPOSURE = Object.freeze({
  government_only: 0,
  private: 1,
  restricted: 2,
  public_safe: 3,
});

/**
 * Decide an evidence row's visibility. Publishing a source document is a governed decision, so an
 * uploader may narrow the server's default freely but may only widen it while holding the evidence
 * review capability.
 *
 * Returns the level to apply and, when a widening request was refused, what was asked for — the
 * caller records that on the row so a clamp is visible to review instead of silent.
 *
 * OC-5R-REL-01: evidence that is PRIVATE BY TYPE (an odometer photo) defaults to 'private' and is
 * never public — a public request is clamped and recorded even for an actor holding the review
 * capability. A narrower or equally private level (restricted, government_only) is still honoured.
 */
export function resolveEvidenceVisibility({ requested = null, isDocument = false, mayPublish = false, privateByType = false } = {}) {
  if (privateByType) {
    const exposure = EVIDENCE_VISIBILITY_EXPOSURE[requested];
    if (!requested || exposure === undefined) return { visibility: 'private', refused: false, requested };
    if (exposure >= EVIDENCE_VISIBILITY_EXPOSURE.public_safe) return { visibility: 'private', refused: true, requested };
    return { visibility: requested, refused: false, requested };
  }
  const applied = isDocument ? 'restricted' : 'public_safe';
  if (!requested || requested === applied) return { visibility: applied, refused: false, requested };

  const requestedExposure = EVIDENCE_VISIBILITY_EXPOSURE[requested];
  if (requestedExposure === undefined) return { visibility: applied, refused: false, requested };

  const widens = requestedExposure > EVIDENCE_VISIBILITY_EXPOSURE[applied];
  if (widens && !mayPublish) return { visibility: applied, refused: true, requested };
  return { visibility: requested, refused: false, requested };
}

export function parseBase64Payload(base64Str) {
  const matches = String(base64Str || '').match(/^data:([A-Za-z0-9.+/-]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) {
    throw new Error('Invalid Base64 payload format. Must include data URI scheme prefix.');
  }

  const mimeType = matches[1].toLowerCase();
  if (!isSupportedMimeType(mimeType)) {
    throw new Error(`Unsupported file type: ${mimeType}`);
  }

  const fileBuffer = Buffer.from(matches[2], 'base64');
  if (fileBuffer.length === 0) {
    throw new Error('Uploaded evidence file is empty.');
  }

  return { mimeType, fileBuffer };
}

export function checksumForBuffer(fileBuffer) {
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

function normalizeComponentTags(input) {
  if (Array.isArray(input)) return input.map((t) => String(t).trim()).filter(Boolean);
  if (typeof input === 'string' && input.trim()) {
    return input.split(',').map((t) => t.trim()).filter(Boolean);
  }
  return null;
}

const EVENT_DATE_PRECISIONS = ['day', 'month', 'year', 'unknown'];

export function validateEvidenceUploadPayload(payload, { requireVehicleId = false } = {}) {
  const vehicleId = payload.vehicle_id || payload.vehicleId || payload.vin;
  const evidenceType = normalizeEvidenceType(payload.evidence_type || payload.evidenceType);
  const eventType = payload.event_type || payload.eventType || null;
  const hasFilePayload = Boolean(payload.file);
  const hasRemoteFile = Boolean(payload.file_url || payload.fileUrl);

  if (requireVehicleId && !vehicleId) {
    throw new Error('vehicle_id is required');
  }

  const requestedClass = payload.evidence_class || payload.evidenceClass || null;
  const requestedSubtype = payload.evidence_subtype || payload.evidenceSubtype || null;
  const explicitCanonical = Boolean(requestedClass && requestedSubtype);

  // Operations M1: canonical-first uploads need no legacy evidence_type at all —
  // the compatibility value is DERIVED from the canonical classification, so a
  // new record can never be born with a contradictory legacy meaning. Legacy
  // clients that still send only evidence_type keep working unchanged.
  if (!evidenceType && !explicitCanonical) {
    throw new Error('evidence_type is required (or provide evidence_class + evidence_subtype)');
  }

  if (evidenceType && !evidenceTypes.includes(evidenceType)) {
    throw new Error(`Unsupported evidence type: ${evidenceType}`);
  }

  // The generic compatibility values carry no semantics of their own and are
  // invalid without a canonical classification.
  if (evidenceType && GENERIC_COMPAT_TYPES.includes(evidenceType) && !explicitCanonical) {
    throw new Error(`evidence_type '${evidenceType}' requires evidence_class and evidence_subtype`);
  }

  if (!hasFilePayload && !hasRemoteFile) {
    throw new Error('Evidence upload requires either file or file_url');
  }

  const classification = resolveClassification({
    evidence_class: requestedClass,
    evidence_subtype: requestedSubtype,
    evidence_type: evidenceType || null,
  });
  if (!classification.ok) {
    throw new Error(classification.errors.join('; '));
  }

  const effectiveEvidenceType = evidenceType
    || deriveLegacyCompatibilityType(classification.evidence_class, classification.evidence_subtype);
  if (!effectiveEvidenceType) {
    throw new Error('Could not derive a compatibility evidence_type for this classification');
  }

  const eventDatePrecision = payload.event_date_precision || payload.eventDatePrecision || 'day';
  if (!EVENT_DATE_PRECISIONS.includes(eventDatePrecision)) {
    throw new Error(`Invalid event_date_precision: ${eventDatePrecision}`);
  }

  const rawOdometer = payload.odometer_value ?? payload.odometerValue;
  const odometerValue = rawOdometer === undefined || rawOdometer === null || rawOdometer === ''
    ? null
    : Number(rawOdometer);
  if (odometerValue !== null && Number.isNaN(odometerValue)) {
    throw new Error('odometer_value must be numeric');
  }

  return {
    vehicleId,
    eventType,
    evidenceType: effectiveEvidenceType,
    explicitCanonical,
    evidenceClass: classification.evidence_class,
    evidenceSubtype: classification.evidence_subtype,
    eventDate: payload.event_date || payload.eventDate || null,
    eventDatePrecision,
    captureCountry: payload.capture_country || payload.captureCountry || null,
    odometerValue,
    odometerUnit: payload.odometer_unit || payload.odometerUnit || null,
    componentTags: normalizeComponentTags(payload.component_tags || payload.componentTags),
    declaredCondition: payload.declared_condition || payload.declaredCondition || null,
    sourceCode: payload.source_code || payload.sourceCode || null,
    sourceId: payload.source_id || payload.sourceId || null,
    sourceRecordId: payload.source_record_id || payload.sourceRecordId || null,
    evidenceSetId: payload.evidence_set_id || payload.evidenceSetId || null,
    retentionClass: payload.retention_class || payload.retentionClass || 'standard',
    linkedRegistryEventId: payload.linked_registry_event_id || payload.linkedRegistryEventId || payload.timelineEventId || null,
    metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {}
  };
}

/**
 * Build the Milestone 1 taxonomy + provenance columns for an evidence insert.
 * Computes the perceptual hash from the file buffer when available (master plan §5.3).
 */
export function buildEvidenceProvenanceColumns(normalized, { fileBuffer, mimeType, checksum, resolvedSourceId } = {}) {
  let perceptualHash = null;
  if (fileBuffer) {
    const ph = computePerceptualHash(fileBuffer, mimeType);
    perceptualHash = ph.supported ? ph.hash : null;
  }
  return {
    evidence_class: normalized.evidenceClass,
    evidence_subtype: normalized.evidenceSubtype,
    event_date: normalized.eventDate,
    event_date_precision: normalized.eventDatePrecision,
    capture_country: normalized.captureCountry,
    odometer_value: normalized.odometerValue,
    odometer_unit: normalized.odometerUnit,
    component_tags: normalized.componentTags,
    declared_condition: normalized.declaredCondition,
    source_id: resolvedSourceId || normalized.sourceId || null,
    source_record_id: normalized.sourceRecordId,
    received_at: new Date().toISOString(),
    perceptual_hash: perceptualHash,
    checksum_algorithm: checksum ? 'sha256' : null,
    evidence_set_id: normalized.evidenceSetId,
    retention_class: normalized.retentionClass || 'standard',
  };
}

/**
 * Best-effort chain-of-custody write for an upload. Never throws — provenance failures
 * must not block evidence capture (it is recorded, not gating).
 */
export async function recordEvidenceUploadProvenance(client, { evidence, req, eventType = 'uploaded' }) {
  try {
    await recordProvenanceEvent(client, {
      evidenceId: evidence.id,
      vin: evidence.vin,
      eventType,
      actorUserId: req?.userContext?.id || null,
      actorRole: req?.userContext?.role || null,
      actorType: 'user',
      sourceRoute: req?.originalUrl || req?.path || null,
      requestId: req?.requestId || req?.headers?.['x-request-id'] || null,
      ipAddress: req?.ip || null,
      details: {
        evidence_class: evidence.evidence_class || null,
        evidence_subtype: evidence.evidence_subtype || null,
        source_id: evidence.source_id || null,
        checksum: evidence.checksum || null,
      },
    });
  } catch (err) {
    // OC-4A classification: BUSINESS HISTORY (chain of custody), non-blocking by this domain's decision
    // (provenance never gates capture) — but a missing custody event is a gap no verifier can see later
    // (the next event simply links to whatever is last), so it is an ERROR, not a warning.
    logger.error('PROVENANCE', 'chain-of-custody event NOT recorded for an evidence upload', {
      evidence_id: evidence?.id ?? null, event_type: eventType, error_message: err.message,
    });
  }
}

export function buildAiReadyMetadata({
  metadata = {},
  evidenceType,
  eventType,
  mimeType,
  fileSize,
  checksum,
  vehicle
}) {
  return {
    ...metadata,
    ai_ready: {
      schema_version: 'vehicle_evidence.v1',
      evidence_type: evidenceType,
      event_type: eventType,
      mime_type: mimeType,
      file_size_bytes: fileSize,
      checksum_sha256: checksum,
      vehicle_identity: {
        vin: vehicle?.vin || vehicle?.vehicle_id || null,
        plate_number: vehicle?.plate_number || null,
        normalized_plate_number: vehicle?.normalized_plate_number || null,
        chassis_number: vehicle?.chassis_number || null,
        engine_number: vehicle?.engine_number || null
      },
      extraction_targets: isDocumentEvidence(evidenceType)
        ? ['document_number', 'issuer', 'issued_at', 'owner_name', 'vin', 'plate_number']
        : ['vehicle_damage', 'odometer_reading', 'plate_number', 'vin_marking', 'condition_notes']
    }
  };
}

export function normalizeEvidenceRecord(record) {
  if (!record) return record;

  const linkedRegistryEventId = record.linked_registry_event_id || record.timeline_event_id || null;
  const trustScoreImpact = Number(record.trust_score_impact ?? record.trust_impact ?? 0);
  const checksum = record.checksum || record.image_hash || null;

  return {
    ...record,
    linked_registry_event_id: linkedRegistryEventId,
    timeline_event_id: record.timeline_event_id || linkedRegistryEventId,
    trust_score_impact: trustScoreImpact,
    trust_impact: trustScoreImpact,
    checksum,
    image_hash: record.image_hash || checksum
  };
}

export function evidenceStatusTrustImpact(status, requestedImpact = 0) {
  if (status === 'verified') return Math.max(0, Number(requestedImpact) || 0);
  if (status === 'rejected') return Math.min(0, Number(requestedImpact) || -5);
  return 0;
}

export function evidenceToTimelineItem(evidence) {
  const item = normalizeEvidenceRecord(evidence);
  const timestamp = item.captured_at || item.uploaded_at || item.created_at;

  return {
    id: `evidence:${item.id}`,
    event_source: 'evidence',
    event_type: item.event_type || item.evidence_type,
    evidence_type: item.evidence_type,
    evidence_class: item.evidence_class || null,
    evidence_subtype: item.evidence_subtype || null,
    timestamp,
    // Canonical classification is the semantic authority (Operations M1): a row
    // canonically classed Import/Commercial invoice must never surface as a
    // "Registration Document" card because of its legacy compatibility field.
    // Legacy-only historical rows keep their historical label.
    label: (item.evidence_class && semanticClassificationLabel(item)) || evidenceTypeLabel(item.evidence_type),
    desc: item.verification_notes || `${item.uploader_role || 'user'} uploaded visual evidence`,
    file_url: item.file_url,
    verification_status: item.verification_status,
    trust_score_impact: Number(item.trust_score_impact || 0),
    linked_registry_event_id: item.linked_registry_event_id,
    metadata: item.metadata || {},
    details: {
      uploadedBy: item.uploaded_by,
      uploaderRole: item.uploader_role,
      capturedAt: item.captured_at,
      uploadedAt: item.uploaded_at,
      checksum: item.checksum || item.image_hash,
      linkedRegistryEventId: item.linked_registry_event_id
    }
  };
}

export function evidenceTypeLabel(evidenceType) {
  return String(evidenceType || '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function mergeEventsWithEvidence(events, evidence) {
  const visualItems = (evidence || [])
    .filter((item) => item.verification_status === 'verified')
    .map(evidenceToTimelineItem);

  return [...(events || []), ...visualItems]
    .filter((event) => event.timestamp)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

/**
 * Advisory analysis of one uploaded evidence image, recorded on the row's metadata.ai_analysis.
 *
 * OC-5B: an executor is asked for through the ONE selector (evidenceVisionProvider). Outside the
 * test-fixture runtime no certified adapter exists, so the row records an explicit "not run — no
 * provider configured" block: no score, no confidence, a human inspection. It used to run the
 * evidence-vision SIMULATOR on every production upload. The checksum duplicate check is a
 * deterministic comparison, not AI, and runs either way.
 */
export async function runAiAnalysis(evidenceId, fileBuffer, mimeType, evidenceType, initialMetadata = {}, { vision = resolveEvidenceVision() } = {}) {
  const { data: currentRecord } = await supabase
    .from('vehicle_evidence')
    .select('metadata, checksum, id, vin')
    .eq('id', evidenceId)
    .single();

  if (!currentRecord) return;
  const currentMetadata = currentRecord.metadata || {};
  const save = (analysis) => supabase
    .from('vehicle_evidence')
    .update({ metadata: { ...currentMetadata, ai_analysis: analysis } })
    .eq('id', evidenceId);

  let duplicateMatch = null;
  try {
    // Duplicate check — the same bytes already filed as other evidence (checksum equality, not AI).
    const checksum = currentRecord.checksum;
    if (checksum) {
      const { data: duplicateRecord } = await supabase
        .from('vehicle_evidence')
        .select('id, vin, verification_status')
        .eq('checksum', checksum)
        .neq('id', evidenceId)
        .limit(1);

      if (duplicateRecord && duplicateRecord.length > 0) {
        duplicateMatch = {
          is_duplicate: true,
          original_evidence_id: duplicateRecord[0].id,
          original_vin: duplicateRecord[0].vin,
          original_status: duplicateRecord[0].verification_status
        };
      }
    }
  } catch (err) {
    console.error(`[Evidence duplicate check] Failed for evidence ${evidenceId}:`, err.message);
  }

  if (!vision.available) {
    const notRun = analysisNotRunRecord(vision);
    if (duplicateMatch) {
      notRun.duplicate_match = duplicateMatch;
      notRun.recommended_action = 'reject';
      notRun.reviewer_summary = `Duplicate of existing evidence ${duplicateMatch.original_evidence_id} (vehicle ${duplicateMatch.original_vin}) — the same file checksum; a deterministic check, not AI. ${notRun.reviewer_summary}`;
    }
    await save(notRun);
    return;
  }

  // 1. A provider will examine it: say so — with no score and no confidence, because nothing has been measured yet.
  await save({
    ai_status: 'ai_pending',
    risk_score: null,
    confidence: null,
    reviewer_summary: 'AI analysis queued.'
  });

  try {
    // 2. Call the selected executor (today: the labelled simulator, in the test-fixture runtime only).
    const aiResult = await vision.analyze(fileBuffer, mimeType, evidenceType, initialMetadata);

    // If the duplicate check flagged it, override status and risk_score
    if (duplicateMatch) {
      aiResult.ai_status = 'ai_flagged';
      aiResult.risk_score = Math.max(aiResult.risk_score ?? 0, 0.95);
      aiResult.recommended_action = 'reject';
      aiResult.reviewer_summary = `Duplicate photo detected! Matches existing evidence ID: ${duplicateMatch.original_evidence_id} (Vehicle VIN: ${duplicateMatch.original_vin}).`;
      aiResult.duplicate_match = duplicateMatch;
    }

    // 3. Save results back to metadata
    await save(aiResult);
  } catch (err) {
    console.error(`[AI Analysis Error] Failed for evidence ${evidenceId}:`, err.message);

    // Save provider_unavailable status. OC-3B: no risk figure — a failed analysis measured nothing,
    // and the 0.1 it used to store read as "low risk". Inspection is the only recommendation.
    await save({
      ai_status: 'ai_provider_unavailable',
      execution: 'failed',
      advisory: true,
      verifying: false,
      risk_score: null,
      confidence: 0.0,
      reviewer_summary: `AI provider analysis failed: ${err.message}`,
      recommended_action: 'inspect'
    });
  }
}

export class EvidenceReviewGovernanceError extends Error {
  constructor(message, code = 'EVIDENCE_REVIEW_GOVERNANCE_ERROR', status = 400) {
    super(message);
    this.name = 'EvidenceReviewGovernanceError';
    this.code = code;
    this.status = status;
  }
}

const SENSITIVE_AUDIT_KEYS = ['password', 'token', 'api_key', 'secret', 'key', 'credential', 'auth', 'signature'];

function redactAuditPayload(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(redactAuditPayload);
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    const isSensitive = SENSITIVE_AUDIT_KEYS.some((sk) => k.toLowerCase().includes(sk));
    if (isSensitive && v !== null && v !== undefined) {
      result[k] = '[REDACTED]';
    } else if (typeof v === 'object') {
      result[k] = redactAuditPayload(v);
    } else {
      result[k] = v;
    }
  }
  return result;
}

function mapAtomicReviewRpcError(err) {
  const msg = String(err?.message || err || '');
  if (msg.includes('EVIDENCE_REVIEW_NOT_FOUND')) {
    return new EvidenceReviewGovernanceError(
      'Evidence record not found matching this VIN',
      'EVIDENCE_REVIEW_NOT_FOUND',
      404,
    );
  }
  if (msg.includes('EVIDENCE_REVIEW_SELF_FORBIDDEN')) {
    return new EvidenceReviewGovernanceError(
      'The uploader cannot verify or reject their own evidence submission.',
      'EVIDENCE_REVIEW_SELF_FORBIDDEN',
      403,
    );
  }
  if (
    msg.includes('EVIDENCE_REVIEW_CONFLICT')
    || msg.includes('EVIDENCE_REVIEW_PROVENANCE_SEQUENCE_CONFLICT')
    || msg.includes('duplicate key value violates unique constraint')
  ) {
    return new EvidenceReviewGovernanceError(
      'Concurrent or conflicting evidence review state detected; refresh and retry.',
      'EVIDENCE_REVIEW_CONFLICT',
      409,
    );
  }
  if (msg.includes('EVIDENCE_REVIEW_PROVENANCE_FAILED') || msg.includes('evidence_provenance_events')) {
    return new EvidenceReviewGovernanceError(
      `Evidence provenance append failed: ${msg}`,
      'EVIDENCE_REVIEW_PROVENANCE_FAILED',
      500,
    );
  }
  if (msg.includes('EVIDENCE_REVIEW_WRITE_FAILED') || msg.includes('vehicle_evidence')) {
    return new EvidenceReviewGovernanceError(
      `Evidence review update failed: ${msg}`,
      'EVIDENCE_REVIEW_WRITE_FAILED',
      500,
    );
  }
  if (msg.includes('EVIDENCE_REVIEW_AUDIT_FAILED') || msg.includes('trust_audit_events')) {
    return new EvidenceReviewGovernanceError(
      `Evidence review audit could not be recorded: ${msg}`,
      'EVIDENCE_REVIEW_AUDIT_FAILED',
      500,
    );
  }
  return new EvidenceReviewGovernanceError(
    `Atomic evidence review transaction failed: ${msg}`,
    'EVIDENCE_REVIEW_TRANSACTION_FAILED',
    500,
  );
}

/**
 * Bounded, transactional, race-safe evidence verification/rejection governance
 * (CARUP-PAY-03A-STG01-R3-R1).
 *
 * Guarantees via canonical PostgreSQL RPC `public.carup_review_vehicle_evidence`:
 * 1. Genuine authenticated session (`isProvenSession(actor)` — `x-user-id` fallback identities are refused).
 * 2. Server-derived Operations capability (`OPERATIONS_CAPABILITIES.VEHICLE_EVIDENCE_REVIEW`).
 * 3. Independent reviewer (`G5 — no self-certification`: `evidence.uploaded_by !== actor.id`).
 * 4. Row-level `FOR UPDATE` locking on `public.vehicle_evidence` so concurrent reviewers cannot
 *    overwrite each other's decisions using stale state, with explicit idempotency/conflict rules.
 * 5. Authoritative audit (`trust_audit_events`), evidence status (`vehicle_evidence`), and
 *    hash-chained provenance event (`evidence_provenance_events`) commit together or roll back
 *    together in a single PostgreSQL transaction.
 */
export async function reviewEvidenceRecord(client = supabase, {
  vin,
  evidenceId,
  decision,
  notes = null,
  confidenceImpact = 0,
  requestedTrustImpact = null,
  actor,
  req = null,
} = {}) {
  const cleanVin = String(vin || '').trim();
  const cleanEvidenceId = String(evidenceId || '').trim();
  if (!cleanVin || !cleanEvidenceId) {
    throw new EvidenceReviewGovernanceError('vin and evidenceId are required', 'EVIDENCE_REVIEW_INVALID_INPUT', 400);
  }
  if (decision !== 'verified' && decision !== 'rejected') {
    throw new EvidenceReviewGovernanceError("decision must be 'verified' or 'rejected'", 'EVIDENCE_REVIEW_INVALID_DECISION', 400);
  }
  if (!actor?.id) {
    throw new EvidenceReviewGovernanceError('Authentication required.', 'OPERATIONS_UNAUTHENTICATED', 401);
  }
  const authMethod = String(actor.authenticationMethod || '').trim().toLowerCase();
  if (
    !authMethod
    || authMethod === 'none'
    || authMethod === 'expired'
    || authMethod === 'expired-jwt'
    || authMethod === 'invalid'
  ) {
    throw new EvidenceReviewGovernanceError('Authentication required.', 'OPERATIONS_UNAUTHENTICATED', 401);
  }
  if (!isProvenSession(actor) || (authMethod !== 'session' && authMethod !== 'jwt')) {
    throw new EvidenceReviewGovernanceError(
      'This Operations action requires a proven session.',
      'OPERATIONS_PROVEN_SESSION_REQUIRED',
      403,
    );
  }
  if (!hasOperationsCapability(actor, OPERATIONS_CAPABILITIES.VEHICLE_EVIDENCE_REVIEW)) {
    throw new EvidenceReviewGovernanceError(
      `Forbidden. This action requires the '${OPERATIONS_CAPABILITIES.VEHICLE_EVIDENCE_REVIEW}' capability.`,
      'OPERATIONS_CAPABILITY_REQUIRED',
      403,
    );
  }
  if (!client || typeof client.rpc !== 'function') {
    throw new EvidenceReviewGovernanceError(
      'Atomic PostgreSQL evidence review RPC authority is required.',
      'EVIDENCE_REVIEW_ATOMIC_RPC_REQUIRED',
      503,
    );
  }

  const { data: evidence, error: evError } = await client
    .from('vehicle_evidence')
    .select('*')
    .eq('id', cleanEvidenceId)
    .eq('vin', cleanVin)
    .maybeSingle();

  if (evError) {
    throw new EvidenceReviewGovernanceError(
      `Evidence read failed: ${evError.message}`,
      'EVIDENCE_REVIEW_READ_FAILED',
      500,
    );
  }
  if (!evidence) {
    throw new EvidenceReviewGovernanceError(
      'Evidence record not found matching this VIN',
      'EVIDENCE_REVIEW_NOT_FOUND',
      404,
    );
  }

  // G5 — no self-certification: the uploader may never verify or reject their own evidence submission.
  if (evidence.uploaded_by && String(evidence.uploaded_by).trim() === String(actor.id).trim()) {
    throw new EvidenceReviewGovernanceError(
      'The uploader cannot verify or reject their own evidence submission.',
      'EVIDENCE_REVIEW_SELF_FORBIDDEN',
      403,
    );
  }

  const defaultImpact = decision === 'verified' ? 3 : -5;
  const trustScoreImpact = evidenceStatusTrustImpact(
    decision,
    requestedTrustImpact ?? defaultImpact,
  );
  const reviewedAt = new Date().toISOString();
  const provEventType = decision === 'verified' ? 'approved' : 'rejected';
  const actorRole = actor.role || actor.baseRole || actor.platformRole || null;
  const sourceRoute =
    req?.originalUrl
    || req?.path
    || `/api/vehicles/:vin/evidence/:evidenceId/${decision === 'verified' ? 'verify' : 'reject'}`;
  const requestId = req?.requestId || req?.correlationId || req?.headers?.['x-request-id'] || null;
  const ipAddress = req?.ip || req?.headers?.['x-forwarded-for'] || null;
  const userAgent = req?.headers?.['user-agent'] || null;

  // Read current provenance chain head to compute deterministic SHA-256 content_hash
  // (verified inside the PostgreSQL RPC under the FOR UPDATE lock on vehicle_evidence).
  const { data: provRows, error: provReadErr } = await client
    .from('evidence_provenance_events')
    .select('*')
    .eq('evidence_id', cleanEvidenceId)
    .order('sequence', { ascending: false })
    .limit(1);
  if (provReadErr) {
    throw new EvidenceReviewGovernanceError(
      `Evidence provenance read failed: ${provReadErr.message}`,
      'EVIDENCE_REVIEW_PROVENANCE_FAILED',
      500,
    );
  }
  const lastProv = Array.isArray(provRows) ? provRows[0] || null : provRows || null;
  const expectedSequence = lastProv ? Number(lastProv.sequence) + 1 : 1;
  const expectedPrevHash = lastProv ? lastProv.content_hash : null;

  // Keys ordered by PostgreSQL JSONB canonical order (length ascending, then ASCII)
  // so `verifyProvenanceChain()` recomputes the exact same SHA-256 `content_hash`
  // after round-tripping through `evidence_provenance_events.details` (JSONB).
  const provenanceDetails = {
    verified_at: reviewedAt,
    verified_by: actor.id,
    trust_score_impact: trustScoreImpact,
    verification_status: decision,
    previous_verification_status: evidence.verification_status,
  };
  const contentHash = computeContentHash({
    evidence_id: cleanEvidenceId,
    sequence: expectedSequence,
    event_type: provEventType,
    actor_user_id: actor.id,
    actor_role: actorRole,
    actor_type: 'user',
    details: provenanceDetails,
    prev_hash: expectedPrevHash,
  });

  const previousValue = redactAuditPayload({
    verification_status: evidence.verification_status,
    verification_notes: evidence.verification_notes || null,
    trust_score_impact: evidence.trust_score_impact ?? null,
  });
  const newValue = redactAuditPayload({
    verification_status: decision,
    verification_notes: notes || null,
    trust_score_impact: trustScoreImpact,
    ...(decision === 'verified' ? { confidence_impact: confidenceImpact || 0 } : {}),
  });

  const { data: rpcData, error: rpcErr } = await client.rpc('carup_review_vehicle_evidence', {
    p_vin: cleanVin,
    p_evidence_id: cleanEvidenceId,
    p_decision: decision,
    p_notes: notes || null,
    p_trust_score_impact: trustScoreImpact,
    p_confidence_impact: confidenceImpact || 0,
    p_actor_user_id: actor.id,
    p_actor_role: actorRole,
    p_actor_tenant_id: actor.tenantId ?? null,
    p_source_route: sourceRoute,
    p_request_id: requestId,
    p_ip_address: ipAddress,
    p_user_agent: userAgent,
    p_previous_value: previousValue,
    p_new_value: newValue,
    p_provenance_details: provenanceDetails,
    p_expected_sequence: expectedSequence,
    p_expected_prev_hash: expectedPrevHash,
    p_content_hash: contentHash,
    p_reviewed_at: reviewedAt,
  });

  if (rpcErr) {
    throw mapAtomicReviewRpcError(rpcErr);
  }
  if (
    !rpcData
    || !rpcData.evidence
    || !rpcData.audit_event_id
    || !rpcData.provenance_event_id
  ) {
    throw new EvidenceReviewGovernanceError(
      'Atomic evidence review RPC did not return committed audit, evidence, and provenance identifiers.',
      'EVIDENCE_REVIEW_TRANSACTION_FAILED',
      500,
    );
  }

  return {
    evidence: normalizeEvidenceRecord(rpcData.evidence),
    previousEvidence: rpcData.previous_evidence || evidence,
    trustScoreImpact,
    auditEventId: rpcData.audit_event_id,
    provenanceEventId: rpcData.provenance_event_id,
    idempotentReplay: Boolean(rpcData.idempotent_replay),
  };
}
