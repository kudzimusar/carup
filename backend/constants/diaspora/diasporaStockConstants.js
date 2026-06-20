/**
 * Phase 3 — Online Stock & Supply Documents constants.
 *
 * Centralizes ledger action semantics, stock lifecycle statuses, and the supply-document state
 * machine so route, service and UI layers agree (directive §39.1).
 */

// Immutable stock ledger action types (directive §7.3). Every quantity change is one of these.
export const STOCK_LEDGER_ACTIONS = Object.freeze({
  ADD: 'ADD',
  REMOVE: 'REMOVE',
  RESERVE: 'RESERVE',
  RELEASE_RESERVATION: 'RELEASE_RESERVATION',
  DAMAGE: 'DAMAGE',
  RETURN: 'RETURN',
  TRANSFER: 'TRANSFER',
  ADJUST_WITH_APPROVAL: 'ADJUST_WITH_APPROVAL',
});

export const STOCK_LEDGER_ACTION_LIST = Object.freeze(Object.values(STOCK_LEDGER_ACTIONS));

// Actions that require explicit approval metadata before they may be appended.
export const STOCK_LEDGER_APPROVAL_REQUIRED = Object.freeze([
  STOCK_LEDGER_ACTIONS.ADJUST_WITH_APPROVAL,
]);

export const STOCK_CONDITIONS = Object.freeze(['NEW', 'USED', 'REFURBISHED', 'FOR_PARTS']);

export const STOCK_EXPORT_READINESS = Object.freeze([
  'DRAFT',
  'PREPARING',
  'EXPORT_READY',
  'ON_HOLD',
]);

export const STOCK_PUBLICATION_STATUSES = Object.freeze(['PRIVATE', 'PUBLISHED', 'ARCHIVED']);

export const STOCK_VERIFICATION_STATUSES = Object.freeze([
  'UNVERIFIED',
  'PENDING_REVIEW',
  'VERIFIED',
  'REJECTED',
  'FLAGGED',
]);

export const SUPPLY_DOCUMENT_STATUSES = Object.freeze({
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  UNPUBLISHED: 'UNPUBLISHED',
  EXPIRED: 'EXPIRED',
});

export const SUPPLY_DOCUMENT_PUBLICATION = Object.freeze(['PRIVATE', 'PUBLISHED']);

// Supply-document state machine: source -> allowed targets.
export const SUPPLY_DOCUMENT_TRANSITIONS = Object.freeze({
  DRAFT: [SUPPLY_DOCUMENT_STATUSES.PUBLISHED],
  PUBLISHED: [SUPPLY_DOCUMENT_STATUSES.UNPUBLISHED, SUPPLY_DOCUMENT_STATUSES.EXPIRED],
  UNPUBLISHED: [SUPPLY_DOCUMENT_STATUSES.PUBLISHED, SUPPLY_DOCUMENT_STATUSES.EXPIRED],
  EXPIRED: [],
});

// Fields a supply document must have populated before it can be published.
export const SUPPLY_DOCUMENT_REQUIRED_FOR_PUBLISH = Object.freeze([
  'document_number',
  'title',
  'origin_country',
]);

// Stock-item fields editable through descriptive PATCH. Quantity columns are intentionally excluded;
// they change only through ledger movements.
export const STOCK_ITEM_EDITABLE_FIELDS = Object.freeze([
  'sku',
  'part_name',
  'part_number',
  'oem_number',
  'aftermarket_number',
  'vehicle_make',
  'vehicle_model',
  'vehicle_year_min',
  'vehicle_year_max',
  'condition',
  'origin_country',
  'origin_city',
  'warehouse_location',
  'unit_cost',
  'unit_price',
  'currency',
  'export_readiness_status',
  'metadata',
]);

// Columns a client may NEVER set directly (server/ledger owned).
export const STOCK_ITEM_PROTECTED_FIELDS = Object.freeze([
  'quantity_on_hand',
  'quantity_reserved',
  'verification_status',
  'publication_status',
  'tenant_id',
  'created_by',
]);
