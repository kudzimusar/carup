import crypto from 'crypto';
import { supabase } from '../../db/supabase.js';
import { analyzeEvidenceImage } from '../ai/aiVisionProvider.js';

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
  'ownership_transfer_document'
];

export const documentEvidenceTypes = [
  'registration_document',
  'insurance_document',
  'police_clearance_document',
  'ownership_transfer_document'
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

export function validateEvidenceUploadPayload(payload, { requireVehicleId = false } = {}) {
  const vehicleId = payload.vehicle_id || payload.vehicleId || payload.vin;
  const evidenceType = normalizeEvidenceType(payload.evidence_type || payload.evidenceType);
  const eventType = payload.event_type || payload.eventType || null;
  const hasFilePayload = Boolean(payload.file);
  const hasRemoteFile = Boolean(payload.file_url || payload.fileUrl);

  if (requireVehicleId && !vehicleId) {
    throw new Error('vehicle_id is required');
  }

  if (!evidenceType) {
    throw new Error('evidence_type is required');
  }

  if (!evidenceTypes.includes(evidenceType)) {
    throw new Error(`Unsupported evidence type: ${evidenceType}`);
  }

  if (!hasFilePayload && !hasRemoteFile) {
    throw new Error('Evidence upload requires either file or file_url');
  }

  return {
    vehicleId,
    eventType,
    evidenceType,
    linkedRegistryEventId: payload.linked_registry_event_id || payload.linkedRegistryEventId || payload.timelineEventId || null,
    metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {}
  };
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
    timestamp,
    label: evidenceTypeLabel(item.evidence_type),
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
