import crypto from 'crypto';
import { supabase } from '../../db/supabase.js';
import { analyzeEvidenceImage } from '../ai/aiVisionProvider.js';
import {
  resolveClassification,
  deriveLegacyCompatibilityType,
  isDocumentArtifactRow,
  semanticClassificationLabel,
  GENERIC_COMPAT_TYPES,
  GENERIC_COMPAT_DOCUMENT_TYPE,
} from './evidenceTaxonomy.js';
import { computePerceptualHash } from './perceptualHash.js';
import { recordProvenanceEvent } from './provenanceService.js';

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
 */
export function resolveEvidenceVisibility({ requested = null, isDocument = false, mayPublish = false } = {}) {
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
    console.warn('[Provenance] failed to record upload event:', err.message);
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

export async function runAiAnalysis(evidenceId, fileBuffer, mimeType, evidenceType, initialMetadata = {}) {
  // 1. Initial status update: set to ai_pending
  const initialAiAnalysis = {
    ai_status: 'ai_pending',
    risk_score: 0.0,
    confidence: 1.0,
    reviewer_summary: 'AI analysis queued...'
  };

  const { data: currentRecord } = await supabase
    .from('vehicle_evidence')
    .select('metadata, checksum, id, vin')
    .eq('id', evidenceId)
    .single();

  if (!currentRecord) return;

  const currentMetadata = currentRecord.metadata || {};
  let updatedMetadata = {
    ...currentMetadata,
    ai_analysis: initialAiAnalysis
  };

  await supabase
    .from('vehicle_evidence')
    .update({ metadata: updatedMetadata })
    .eq('id', evidenceId);

  try {
    // 2. Perform duplicate check
    let duplicateMatch = null;
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

    // 3. Call AI Vision Provider
    const aiResult = await analyzeEvidenceImage(fileBuffer, mimeType, evidenceType, initialMetadata);

    // If duplicate check flagged it, override status and risk_score
    if (duplicateMatch) {
      aiResult.ai_status = 'ai_flagged';
      aiResult.risk_score = Math.max(aiResult.risk_score, 0.95);
      aiResult.recommended_action = 'reject';
      aiResult.reviewer_summary = `Duplicate photo detected! Matches existing evidence ID: ${duplicateMatch.original_evidence_id} (Vehicle VIN: ${duplicateMatch.original_vin}).`;
      aiResult.duplicate_match = duplicateMatch;
    }

    // 4. Save results back to metadata
    updatedMetadata = {
      ...currentRecord.metadata,
      ai_analysis: aiResult
    };

    await supabase
      .from('vehicle_evidence')
      .update({ metadata: updatedMetadata })
      .eq('id', evidenceId);

  } catch (err) {
    console.error(`[AI Analysis Error] Failed for evidence ${evidenceId}:`, err.message);

    // Save provider_unavailable status
    const failureResult = {
      ai_status: 'ai_provider_unavailable',
      risk_score: 0.1,
      confidence: 0.0,
      reviewer_summary: `AI provider analysis failed: ${err.message}`,
      recommended_action: 'inspect'
    };

    updatedMetadata = {
      ...currentRecord.metadata,
      ai_analysis: failureResult
    };

    await supabase
      .from('vehicle_evidence')
      .update({ metadata: updatedMetadata })
      .eq('id', evidenceId);
  }
}
