import {
  PASSPORT_AUDIENCES,
  PASSPORT_VISIBILITY,
  assertPassportAudience,
  canAudienceSee,
} from './passportContract.js';
import {
  normalizePassportTimelineEvent,
} from './passportTimelineService.js';

export const PASSPORT_LIFECYCLE_CATEGORIES = Object.freeze([
  'manufacture_import',
  'registration_licensing',
  'ownership',
  'inspection',
  'mileage',
  'evidence',
  'verification',
  'damage_incident',
  'insurance',
  'service',
  'parts',
  'listing',
  'reservation_transaction',
  'sale_transfer',
]);

const CATEGORY_SET = new Set(PASSPORT_LIFECYCLE_CATEGORIES);

function sourceKey(event) {
  return `${event.source_type}::${event.source_ref}`;
}

function visibilityFor(raw) {
  return Object.values(PASSPORT_VISIBILITY).includes(raw?.visibility)
    ? raw.visibility
    : PASSPORT_VISIBILITY.INTERNAL;
}

export function normalizeLifecycleEvent(raw) {
  const base = normalizePassportTimelineEvent(raw);
  if (!CATEGORY_SET.has(raw?.category)) {
    throw new Error(`Unsupported Passport lifecycle category: ${raw?.category}`);
  }

  const supersedes = Array.isArray(raw?.supersedes)
    ? [...new Set(raw.supersedes.filter((value) => typeof value === 'string' && value.trim()))]
    : [];

  return {
    ...base,
    category: raw.category,
    visibility: visibilityFor(raw),
    status: raw.status ?? 'recorded',
    correction_reason: raw.correction_reason ?? null,
    supersedes,
  };
}

function applySupersession(events) {
  const superseded = new Set();
  for (const event of events) {
    for (const key of event.supersedes) superseded.add(key);
  }

  return events.map((event) => ({
    ...event,
    superseded: superseded.has(sourceKey(event)),
  }));
}

function projectLifecycleEvent(event, audience) {
  if (!canAudienceSee(event.visibility, audience)) return null;

  const publicLike = audience === PASSPORT_AUDIENCES.PUBLIC
    || audience === PASSPORT_AUDIENCES.BUYER;

  return {
    id: event.id,
    category: event.category,
    kind: event.kind,
    occurred_at: event.occurred_at,
    source_type: event.source_type,
    source_ref: event.source_ref,
    authority: event.authority,
    verification_state: event.verification_state,
    status: event.status,
    visibility: event.visibility,
    summary: publicLike ? event.public_summary : (event.summary ?? event.public_summary),
    details: publicLike ? event.public_details : (event.details ?? event.public_details),
    mileage: event.mileage,
    mileage_unit: event.mileage_unit,
    evidence_ids: event.evidence_ids,
    superseded: Boolean(event.superseded),
    correction_reason: publicLike ? null : event.correction_reason,
  };
}

function dedupeLatest(events) {
  const bySource = new Map();
  for (const event of events) {
    const key = `${event.kind}::${sourceKey(event)}`;
    const existing = bySource.get(key);
    if (!existing || Date.parse(event.occurred_at) > Date.parse(existing.occurred_at)) {
      bySource.set(key, event);
    }
  }
  return [...bySource.values()];
}

export function buildUnifiedLifecycleTimeline(events = [], {
  audience = PASSPORT_AUDIENCES.PUBLIC,
  categories = null,
  includeSuperseded = false,
  coverageState = 'unknown',
  coverageLimitations = [],
} = {}) {
  assertPassportAudience(audience);

  const requestedCategories = categories == null
    ? null
    : [...new Set(categories)];

  if (requestedCategories) {
    for (const category of requestedCategories) {
      if (!CATEGORY_SET.has(category)) {
        throw new Error(`Unsupported Passport lifecycle category filter: ${category}`);
      }
    }
  }

  const normalized = applySupersession(dedupeLatest((events || []).map(normalizeLifecycleEvent)));

  const items = normalized
    .filter((event) => !requestedCategories || requestedCategories.includes(event.category))
    .filter((event) => includeSuperseded || !event.superseded)
    .map((event) => projectLifecycleEvent(event, audience))
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));

  return {
    state: items.length > 0 ? 'known' : coverageState,
    coverage_state: coverageState,
    coverage_limitations: Array.isArray(coverageLimitations) ? [...coverageLimitations] : [],
    categories: requestedCategories ?? [...PASSPORT_LIFECYCLE_CATEGORIES],
    events: items,
  };
}

export default {
  PASSPORT_LIFECYCLE_CATEGORIES,
  normalizeLifecycleEvent,
  buildUnifiedLifecycleTimeline,
};
