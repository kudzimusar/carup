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
  // T2 commercial terms (additive columns, migration 20260904180000). Editable on a DRAFT only —
  // the caller-side status guard in updateQuote is unchanged, so a SUBMITTED quote stays immutable.
  'offered_quantity',
  'unit_price',
  'lead_time_days',
  'shipping_included',
  'offered_condition',
  'offered_description',
  'stock_item_id',
]);

/**
 * Buyer-facing sourcing request lifecycle (T2 §9.3), expressed over EXISTING authoritative state —
 * no new status CHECK, no migration. `diaspora_import_orders.status` plus `metadata.rfq.published`
 * already carry every step:
 *
 *   DRAFT            → status IMPORT_REQUESTED, metadata.rfq.published falsy
 *   OPEN_FOR_QUOTES  → status QUOTE_ISSUED,     metadata.rfq.published = true  (publishRfq)
 *   QUOTES_RECEIVED  → as above, with ≥1 submitted quote
 *   AWARDED          → status SELLER_ASSIGNED,  metadata.rfq.acceptedQuoteId set (atomic RPC)
 *
 * This is the vocabulary the UI shows humans; the database keeps its own authoritative words.
 */
export const RFQ_LIFECYCLE = Object.freeze({
  DRAFT: 'DRAFT',
  OPEN_FOR_QUOTES: 'OPEN_FOR_QUOTES',
  QUOTES_RECEIVED: 'QUOTES_RECEIVED',
  AWARDED: 'AWARDED',
  CLOSED: 'CLOSED',
});

/** Derive the buyer-facing lifecycle step from authoritative order state + quote facts. */
export function deriveRfqLifecycle(order = {}, submittedQuoteCount = 0) {
  const rfq = order.metadata?.rfq || {};
  if (rfq.acceptedQuoteId) return RFQ_LIFECYCLE.AWARDED;
  if (['CANCELLED', 'COMPLETED'].includes(order.status)) return RFQ_LIFECYCLE.CLOSED;
  if (!rfq.published) return RFQ_LIFECYCLE.DRAFT;
  return submittedQuoteCount > 0 ? RFQ_LIFECYCLE.QUOTES_RECEIVED : RFQ_LIFECYCLE.OPEN_FOR_QUOTES;
}

// Weighting for the deterministic, explainable matcher (no opaque AI score).
export const MATCH_WEIGHTS = Object.freeze({
  MAKE: 40,
  MODEL: 25,
  YEAR: 15,
  PART_NUMBER: 30,
  AVAILABILITY: 10,
  EXPORT_READY: 10,
});
