/**
 * CarUp Intelligence 1.0 — canonical activity event taxonomy (schema_version 1).
 *
 * This module is the code-side mirror of
 * docs/intelligence/receipts/I1_CANONICAL_METRIC_AND_EVENT_CONTRACT.md §4.
 * The database CHECK constraint in
 * database/migrations/20260827120000_intelligence_activity_ledger.sql mirrors the
 * same list; `intelligence-activity-ledger.test.js` asserts the three stay equal,
 * so a type can never exist in one layer and be silently absent from another.
 *
 * EMITTER is part of the contract, not an implementation detail: a client-emitted
 * event is best-effort telemetry, while a server-emitted one is written in the
 * same request as an authoritative domain write. Confusing the two is how an
 * observation starts being trusted as a business fact.
 */

export const SUPPORTED_SCHEMA_VERSION = 1;

/** Events a browser/native client may submit through the public ingestion route. */
export const CLIENT_EMITTED = Object.freeze({
  marketplace_listing_impression: 1,
  marketplace_listing_engaged: 1,
  marketplace_inquiry_started: 1,
  marketplace_compare_added: 1,
  marketplace_compare_removed: 1,
  marketplace_compare_viewed: 1,
  marketplace_contact_clicked: 1,
  marketplace_listing_shared: 1,
  process_step_recorded: 1,
});

/**
 * Events only the server may write. A client submission naming one of these is
 * REJECTED — otherwise a caller could manufacture saves, sales or reservations
 * that never happened in the authoritative tables.
 */
export const SERVER_EMITTED = Object.freeze({
  marketplace_search_performed: 1,
  marketplace_search_zero_results: 1,
  marketplace_listing_opened: 1,
  marketplace_listing_saved: 1,
  marketplace_listing_unsaved: 1,
  marketplace_inquiry_created: 1,
  marketplace_inspection_requested: 1,
  marketplace_reservation_started: 1,
  marketplace_reservation_completed: 1,
  marketplace_price_changed: 1,
  marketplace_listing_created: 1,
  marketplace_listing_submitted: 1,
  marketplace_listing_published: 1,
  marketplace_listing_sold: 1,
});

export const EVENT_VERSIONS = Object.freeze({ ...CLIENT_EMITTED, ...SERVER_EMITTED });
export const EVENT_TYPES = Object.freeze(Object.keys(EVENT_VERSIONS).sort());

/**
 * Reserved names (contract §4.4). Declared so no later phase redefines them, and
 * so the ingestion layer can reject them with an explicit reason rather than a
 * generic "unknown type" — the two mean different things to a caller.
 *
 * `_paused`/`_archived` are gated on gap G10: vehicles.publication_status has no
 * such states (draft, identity_complete, documents_submitted, review_pending,
 * publishable, published) and Intelligence does not invent domain states.
 */
export const RESERVED_EVENT_TYPES = Object.freeze([
  'marketplace_listing_paused',
  'marketplace_listing_archived',
  'marketplace_reservation_closed',
  'marketplace_listing_paid',
  'marketplace_purchase_confirmed',
  'marketplace_recommendation_served',
  'marketplace_recommendation_clicked',
]);

/** Privacy class per event type (contract §6). Stamped server-side. */
export const PRIVACY_CLASS = Object.freeze({
  marketplace_search_performed: 'P1',
  marketplace_search_zero_results: 'P1',
  marketplace_listing_impression: 'P1',
  marketplace_listing_opened: 'P1',
  marketplace_listing_engaged: 'P1',
  marketplace_inquiry_started: 'P1',
  marketplace_compare_added: 'P2',
  marketplace_compare_removed: 'P2',
  marketplace_compare_viewed: 'P1',
  marketplace_contact_clicked: 'P1',
  marketplace_listing_shared: 'P1',
  marketplace_listing_saved: 'P2',
  marketplace_listing_unsaved: 'P2',
  marketplace_inquiry_created: 'P3',
  marketplace_inspection_requested: 'P3',
  marketplace_reservation_started: 'P3',
  marketplace_reservation_completed: 'P3',
  marketplace_price_changed: 'P3',
  marketplace_listing_created: 'P3',
  marketplace_listing_submitted: 'P3',
  marketplace_listing_published: 'P3',
  marketplace_listing_sold: 'P3',
  process_step_recorded: 'P1',
});

export const SOURCE_SURFACES = Object.freeze([
  'marketplace_list', 'marketplace_detail', 'marketplace_compare', 'dashboard',
  'saved', 'search', 'external_link', 'communications', 'other',
]);

export const SOURCE_PLATFORMS = Object.freeze(['web', 'ios', 'android', 'server']);
export const ACTOR_SCOPES = Object.freeze(['anonymous', 'authenticated', 'system']);

/**
 * Per-type metadata allowlist (contract §3: "per-type allowlisted keys only;
 * everything else dropped"). A key absent from this map is DROPPED, not stored —
 * the nav-analytics discipline, applied to commercial telemetry. Free text is
 * never allowlisted; bounded codes and numbers only.
 */
export const METADATA_ALLOWLIST = Object.freeze({
  // `filters` holds the BOUNDED CATALOGUE values (make, condition, price band, tags,
  // sort) — not the free-text query, which is hashed into normalized_query_hash and
  // never stored. Values rather than keys alone, because Lost Opportunity (I6) must
  // later answer "which searches could this listing have matched if a field were
  // filled in", and a hash cannot answer that.
  marketplace_search_performed: ['normalized_query_hash', 'filter_keys', 'filters', 'result_count', 'country', 'region', 'currency'],
  marketplace_search_zero_results: ['normalized_query_hash', 'filter_keys', 'filters', 'country', 'region', 'currency'],
  marketplace_listing_impression: ['position', 'result_page', 'country', 'region'],
  marketplace_listing_opened: ['attributed', 'country', 'region', 'currency'],
  marketplace_listing_engaged: ['engagement_reason', 'dwell_ms'],
  marketplace_inquiry_started: ['inquiry_type'],
  marketplace_compare_added: ['compare_set_size'],
  marketplace_compare_removed: ['compare_set_size'],
  marketplace_compare_viewed: ['compare_set_size'],
  marketplace_contact_clicked: ['affordance'],
  marketplace_listing_shared: ['share_resolution', 'share_channel'],
  marketplace_listing_saved: [],
  marketplace_listing_unsaved: [],
  marketplace_inquiry_created: ['inquiry_type', 'inquiry_status'],
  marketplace_inspection_requested: ['inquiry_type'],
  marketplace_reservation_started: ['session_status'],
  marketplace_reservation_completed: ['reservation_status'],
  marketplace_price_changed: ['old_price', 'new_price', 'old_currency', 'new_currency'],
  marketplace_listing_created: ['publication_status'],
  marketplace_listing_submitted: ['from_status', 'to_status'],
  marketplace_listing_published: ['from_status', 'to_status'],
  marketplace_listing_sold: ['from_status', 'to_status', 'sold_source'],
  process_step_recorded: ['process', 'step', 'outcome', 'elapsed_ms', 'validation_error_code'],
});

/** Bounded enums inside metadata — an unknown value is dropped, never stored. */
export const METADATA_ENUMS = Object.freeze({
  share_resolution: ['confirmed', 'initiated'],
  engagement_reason: ['dwell', 'gallery', 'spec_expand', 'action'],
  outcome: ['started', 'completed', 'abandoned', 'failed', 'resumed'],
  process: ['listing_creation', 'inquiry_form', 'reservation_flow'],
  sold_source: ['vehicles_status', 'listing_status'],
  share_channel: ['whatsapp', 'email', 'sms', 'copy_link', 'native', 'telegram', 'facebook', 'x', 'other'],
  affordance: ['contact_seller', 'call', 'whatsapp', 'message', 'inquiry_form', 'other'],
});

/**
 * Shape constraints for the remaining string keys.
 *
 * Every allowlisted string must be either an enum member above or match a format
 * here. Without this, keys like `country`, `step` or `validation_error_code`
 * accepted ANY 128-character string — a free-text channel into an internal store
 * the privacy contract says holds bounded codes only. A shopper's email pasted
 * into such a field would be retained for 24 months.
 */
export const METADATA_FORMATS = Object.freeze({
  // ISO-3166 alpha-2/alpha-3 style codes only.
  country: /^[A-Za-z]{2,3}$/,
  // A coarse region/province slug: letters, digits, hyphen and underscore.
  region: /^[A-Za-z0-9_-]{1,48}$/,
  currency: /^[A-Za-z]{3}$/,
  normalized_query_hash: /^[a-f0-9]{8,64}$/,
  inquiry_type: /^[a-z][a-z0-9_]{2,48}$/,
  inquiry_status: /^[a-z][a-z0-9_]{2,32}$/,
  session_status: /^[a-z][a-z0-9_]{2,32}$/,
  reservation_status: /^[a-z][a-z0-9_]{2,32}$/,
  publication_status: /^[a-z][a-z0-9_]{2,32}$/,
  from_status: /^[A-Za-z][A-Za-z0-9_]{2,32}$/,
  to_status: /^[A-Za-z][A-Za-z0-9_]{2,32}$/,
  old_currency: /^[A-Za-z]{3}$/,
  new_currency: /^[A-Za-z]{3}$/,
  step: /^[a-z][a-z0-9_]{1,48}$/,
  validation_error_code: /^[a-z][a-z0-9_]{1,48}$/,
});

/** Exclusion flags (contract §5.3/§5.4). */
export const EXCLUSION_FLAGS = Object.freeze([
  'self_traffic', 'staff', 'fixture', 'bot_suspect', 'synthetic',
  'clock_skew_adjusted', 'late_beyond_window',
]);

/**
 * The flags business rollups exclude. `clock_skew_adjusted` deliberately excludes
 * nothing (a phone with a wrong clock is still a real shopper), and self_traffic
 * is excluded only from seller-facing counts and benchmarks — I4 applies that
 * narrower rule; it stays in internal diagnostics.
 */
export const ROLLUP_EXCLUDED_FLAGS = Object.freeze([
  'staff', 'fixture', 'bot_suspect', 'late_beyond_window',
  // Certification traffic must never be counted as real business activity. I19
  // counts it deliberately by reading the ledger directly; a seller's dashboard
  // never does.
  'synthetic',
]);
export const SELLER_FACING_EXCLUDED_FLAGS = Object.freeze([...ROLLUP_EXCLUDED_FLAGS, 'self_traffic']);

export function isClientEmittable(eventType) {
  return Object.prototype.hasOwnProperty.call(CLIENT_EMITTED, eventType);
}

export function isServerEmitted(eventType) {
  return Object.prototype.hasOwnProperty.call(SERVER_EMITTED, eventType);
}

export function isReserved(eventType) {
  return RESERVED_EVENT_TYPES.includes(eventType);
}

export function eventVersionOf(eventType) {
  return EVENT_VERSIONS[eventType] ?? null;
}

export function privacyClassOf(eventType) {
  return PRIVACY_CLASS[eventType] ?? 'P1';
}
