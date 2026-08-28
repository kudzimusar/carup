import {
  PASSPORT_AUDIENCES,
  PASSPORT_VISIBILITY,
  assertPassportAudience,
  canAudienceSee,
} from './passportContract.js';

const KNOWN_VISIBILITY = new Set(Object.values(PASSPORT_VISIBILITY));

function asNullable(value) {
  return value === undefined ? null : value;
}

function normalizeEvidenceIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id) => typeof id === 'string' && id.trim()))];
}

export function normalizePassportTimelineEvent(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Passport timeline event must be an object');
  if (!raw.kind || typeof raw.kind !== 'string') throw new Error('Passport timeline event requires kind');
  if (!raw.source_type || typeof raw.source_type !== 'string') {
    throw new Error('Passport timeline event requires source_type');
  }
  if (!raw.source_ref || typeof raw.source_ref !== 'string') {
    throw new Error('Passport timeline event requires source_ref');
  }
  if (!raw.occurred_at || Number.isNaN(Date.parse(raw.occurred_at))) {
    throw new Error('Passport timeline event requires a valid occurred_at');
  }

  const visibility = KNOWN_VISIBILITY.has(raw.visibility)
    ? raw.visibility
    : PASSPORT_VISIBILITY.INTERNAL;

  return {
    id: asNullable(raw.id),
    kind: raw.kind,
    occurred_at: new Date(raw.occurred_at).toISOString(),
    source_type: raw.source_type,
    source_ref: raw.source_ref,
    authority: asNullable(raw.authority),
    verification_state: asNullable(raw.verification_state) ?? 'unknown',
    visibility,
    public_summary: asNullable(raw.public_summary),
    summary: asNullable(raw.summary),
    public_details: asNullable(raw.public_details),
    details: asNullable(raw.details),
    mileage: asNullable(raw.mileage),
    mileage_unit: asNullable(raw.mileage_unit),
    evidence_ids: normalizeEvidenceIds(raw.evidence_ids),
  };
}

function dedupeKey(event) {
  return `${event.kind}::${event.source_type}::${event.source_ref}`;
}

export function projectPassportTimelineEvent(event, audience) {
  assertPassportAudience(audience);
  const normalized = normalizePassportTimelineEvent(event);
  if (!canAudienceSee(normalized.visibility, audience)) return null;

  const isPublicLike = audience === PASSPORT_AUDIENCES.PUBLIC
    || audience === PASSPORT_AUDIENCES.BUYER;

  return {
    id: normalized.id,
    kind: normalized.kind,
    occurred_at: normalized.occurred_at,
    source_type: normalized.source_type,
    source_ref: normalized.source_ref,
    authority: normalized.authority,
    verification_state: normalized.verification_state,
    visibility: normalized.visibility,
    summary: isPublicLike ? normalized.public_summary : (normalized.summary ?? normalized.public_summary),
    details: isPublicLike ? normalized.public_details : (normalized.details ?? normalized.public_details),
    mileage: normalized.mileage,
    mileage_unit: normalized.mileage_unit,
    evidence_ids: normalized.evidence_ids,
  };
}

/**
 * Builds one presentation timeline without becoming a new event authority.
 * Duplicate projections of the same authoritative source record collapse to one
 * event by kind/source_type/source_ref.
 */
export function buildPassportTimeline(events = [], { audience = PASSPORT_AUDIENCES.PUBLIC } = {}) {
  assertPassportAudience(audience);
  const bySource = new Map();

  for (const raw of events || []) {
    const normalized = normalizePassportTimelineEvent(raw);
    const key = dedupeKey(normalized);
    const existing = bySource.get(key);
    if (!existing || Date.parse(normalized.occurred_at) > Date.parse(existing.occurred_at)) {
      bySource.set(key, normalized);
    }
  }

  return [...bySource.values()]
    .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))
    .map((event) => projectPassportTimelineEvent(event, audience))
    .filter(Boolean);
}
