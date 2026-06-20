/**
 * Phase 4 — Buyer Orders & Reverse RFQ constants.
 *
 * Reuses the existing diaspora_import_orders + diaspora_import_quotes tables. RFQ lifecycle state is
 * tracked in the order's metadata.rfq object (additive, no migration). Quote status maps onto the
 * existing CHECK enum (DRAFT/ISSUED/ACCEPTED/REJECTED/EXPIRED): ISSUED == "submitted".
 */

export const QUOTE_DB_STATUSES = Object.freeze({
  DRAFT: 'DRAFT',
  SUBMITTED: 'ISSUED', // persisted as ISSUED to satisfy the existing CHECK constraint
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
});

export const RFQ_URGENCY = Object.freeze(['LOW', 'NORMAL', 'HIGH', 'URGENT']);

// Quote state machine (logical → DB):
//   DRAFT -> SUBMITTED(ISSUED) -> ACCEPTED | REJECTED
//   DRAFT may be withdrawn (soft-deleted).
export const QUOTE_TRANSITIONS = Object.freeze({
  DRAFT: ['ISSUED'],
  ISSUED: ['ACCEPTED', 'REJECTED'],
  ACCEPTED: [],
  REJECTED: [],
  EXPIRED: [],
});

export const QUOTE_EDITABLE_FIELDS = Object.freeze([
  'quote_amount',
  'quote_currency',
  'valid_until',
  'inclusions',
  'exclusions',
  'metadata',
]);

// Weighting for the deterministic, explainable matcher (no opaque AI score).
export const MATCH_WEIGHTS = Object.freeze({
  MAKE: 40,
  MODEL: 25,
  YEAR: 15,
  PART_NUMBER: 30,
  AVAILABILITY: 10,
  EXPORT_READY: 10,
});
