import {
  classForLegacyType,
  isValidClass,
} from '../evidence/evidenceTaxonomy.js';
import {
  toPublicProvenanceSummary,
} from '../evidence/provenanceService.js';
import {
  PASSPORT_AUDIENCES,
  assertPassportAudience,
} from './passportContract.js';

const EVIDENCE_STATUSES = new Set([
  'pending',
  'verified',
  'rejected',
  'disputed',
  'superseded',
]);

const EVIDENCE_VISIBILITIES = new Set([
  'public_safe',
  'restricted',
  'private',
  'government_only',
]);

function normalizeStatus(value) {
  return EVIDENCE_STATUSES.has(value) ? value : 'pending';
}

function normalizeVisibility(value) {
  return EVIDENCE_VISIBILITIES.has(value) ? value : 'private';
}

function evidenceClassFor(record) {
  if (record?.evidence_class && isValidClass(record.evidence_class)) {
    return record.evidence_class;
  }
  return classForLegacyType(record?.evidence_type) || null;
}

export function canAudienceSeeEvidence(record, audience) {
  assertPassportAudience(audience);
  const visibility = normalizeVisibility(record?.visibility_level);
  const status = normalizeStatus(record?.verification_status);

  if (audience === PASSPORT_AUDIENCES.GOVERNANCE) return true;

  if (audience === PASSPORT_AUDIENCES.PUBLIC || audience === PASSPORT_AUDIENCES.BUYER) {
    return visibility === 'public_safe' && status === 'verified';
  }

  if (audience === PASSPORT_AUDIENCES.OWNER || audience === PASSPORT_AUDIENCES.SELLER) {
    return visibility !== 'government_only';
  }

  return visibility === 'public_safe' && status === 'verified';
}

function baseProjection(record) {
  return {
    evidence_id: record.id ?? null,
    evidence_class: evidenceClassFor(record),
    evidence_subtype: record.evidence_subtype ?? null,
    evidence_type: record.evidence_type ?? null,
    event_type: record.event_type ?? null,
    event_date: record.event_date ?? null,
    event_date_precision: record.event_date_precision ?? null,
    captured_at: record.captured_at ?? null,
    uploaded_at: record.uploaded_at ?? null,
    verification_status: normalizeStatus(record.verification_status),
    visibility_level: normalizeVisibility(record.visibility_level),
    source_name: record.source_name ?? null,
    source_reference: record.source_reference ?? null,
    source_code: record.source_code ?? null,
    source_record_id: record.source_record_id ?? null,
    file_url: record.file_url ?? null,
    mime_type: record.mime_type ?? null,
    odometer_value: record.odometer_value ?? null,
    odometer_unit: record.odometer_unit ?? null,
    component_tags: Array.isArray(record.component_tags) ? [...record.component_tags] : [],
    checksum: record.checksum ?? record.image_hash ?? null,
    verified_at: record.verified_at ?? null,
  };
}

export function projectPassportEvidence(record, {
  audience = PASSPORT_AUDIENCES.PUBLIC,
  provenanceEvents = [],
} = {}) {
  assertPassportAudience(audience);
  if (!record?.id) throw new Error('Passport evidence projection requires evidence id');

  if (!canAudienceSeeEvidence(record, audience)) return null;

  const projected = {
    ...baseProjection(record),
    provenance: toPublicProvenanceSummary(provenanceEvents),
  };

  if (
    audience === PASSPORT_AUDIENCES.OWNER
    || audience === PASSPORT_AUDIENCES.SELLER
    || audience === PASSPORT_AUDIENCES.GOVERNANCE
  ) {
    projected.verification_notes = record.verification_notes ?? null;
    projected.retention_class = record.retention_class ?? null;
  }

  if (audience === PASSPORT_AUDIENCES.GOVERNANCE) {
    projected.evidence_set_id = record.evidence_set_id ?? null;
    projected.linked_registry_event_id =
      record.linked_registry_event_id ?? record.timeline_event_id ?? null;
  }

  return projected;
}

export function buildPassportEvidenceSection(records = [], {
  audience = PASSPORT_AUDIENCES.PUBLIC,
  provenanceByEvidenceId = {},
  collectionState = null,
} = {}) {
  assertPassportAudience(audience);

  const sourceRecords = Array.isArray(records) ? records : [];
  const items = sourceRecords
    .map((record) => projectPassportEvidence(record, {
      audience,
      provenanceEvents: provenanceByEvidenceId?.[record?.id] || [],
    }))
    .filter(Boolean)
    .sort((a, b) => {
      const aTime = Date.parse(a.captured_at || a.uploaded_at || 0) || 0;
      const bTime = Date.parse(b.captured_at || b.uploaded_at || 0) || 0;
      return bTime - aTime;
    });

  const state = collectionState || (items.length > 0 ? 'known' : 'unknown');

  return {
    state,
    count: items.length,
    items,
  };
}

export default {
  canAudienceSeeEvidence,
  projectPassportEvidence,
  buildPassportEvidenceSection,
};
