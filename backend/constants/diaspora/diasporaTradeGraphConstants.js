/**
 * Phase 10 — Trade Graph canonical constants (framework-neutral, pure, no side effects).
 *
 * Single source of truth for the event-sourced Trade Graph projection layer:
 *   - DIASPORA_EVENT_TYPES / DIASPORA_EVENT_TYPE_SET — canonical domain-event vocabulary the
 *     projector subscribes to (mirrors domain_events.event_type values; Stage 2 emits these).
 *   - TRADE_GRAPH_NODE_TYPES / TRADE_GRAPH_EDGE_TYPES — node/edge allowlists that MUST stay in
 *     lockstep with the migration CHECK constraints (20260621140000_diaspora_phase10_trade_graph.sql).
 *   - EVENT_PROJECTION_MAP — the declarative event/audit-action -> nodes+edges mapping table. The
 *     projector (Stage 2) is a generic interpreter over this table; there are NO hardcoded if/else
 *     chains in the projector. Selectors are pure functions over the event/audit payload.
 *   - isTradeGraphEnabled() — env gate DIASPORA_TRADE_GRAPH, default OFF (fail-closed; mirrors
 *     diasporaDriveConstants.isDriveEnabled / diasporaSafeTradeConstants.isSafeTradeEnabled).
 *   - TRADE_GRAPH_POLICY_VERSION / TRADE_GRAPH_PROJECTION_VERSION — versions recorded on edges /
 *     checkpoints / processed-events, kept in sync with the migration defaults.
 *   - TRADE_GRAPH_REDACTION_* — the PII / payment-ref / address / private-path redaction policy the
 *     AI/intelligence layer (Stage 4) applies. AI reads only authorized REDACTED summaries and NEVER
 *     creates edges; this module is data-only and asserts that invariant by construction.
 *
 * NON-NEGOTIABLE invariants encoded here as data (enforced by later stages + the migration):
 *   - The graph is DERIVED and REBUILDABLE: every edge carries a source_event_ref to an authoritative
 *     domain_events row; AI/frontend never create edges — only domain events / audit actions do.
 *   - Idempotent projection: mapping is deterministic; replaying the same events yields the same graph.
 *   - Tenant-partitioned: tenant_id is always taken from the event envelope, never inferred.
 *
 * This module is PURE (no DB/network imports) so it is unit-testable exactly like
 * diasporaStatuses.js / diasporaSafeTradeStatuses.js.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 0. Versions + env flag (kept in sync with the migration defaults)
// ─────────────────────────────────────────────────────────────────────────────

/** Edge inference-rule policy version (DEFAULT on trade_graph_edges.policy_version). */
export const TRADE_GRAPH_POLICY_VERSION = 'trade-graph-policy-v1';

/** Projection logic version (DEFAULT on checkpoints/processed-events; bump to force selective replay). */
export const TRADE_GRAPH_PROJECTION_VERSION = 'trade-graph-projection-v1';

/**
 * Master feature gate. Default OFF (fail-closed): when false the projector subscription, the graph
 * routes, and the intelligence service are all inert. The migration is additive and may be applied
 * independently of this flag, but no graph WRITE or READ path activates until the flag is set.
 */
export function isTradeGraphEnabled() {
  return String(process.env.DIASPORA_TRADE_GRAPH || '').toLowerCase() === 'true';
}

export function isProduction() {
  return process.env.NODE_ENV === 'production';
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Canonical domain-event vocabulary (mirrors domain_events.event_type)
//    Grouped by aggregate root. Stage 2 domain services emit exactly these.
// ─────────────────────────────────────────────────────────────────────────────

export const DIASPORA_EVENT_TYPES = Object.freeze({
  // Trade profiles
  TRADE_PROFILE_CREATED: 'TRADE_PROFILE_CREATED',
  TRADE_PROFILE_UPDATED: 'TRADE_PROFILE_UPDATED',
  TRADE_PROFILE_VERIFIED: 'TRADE_PROFILE_VERIFIED',
  TRADE_PROFILE_FLAGGED: 'TRADE_PROFILE_FLAGGED',

  // Buyer / import orders (diaspora_import_orders)
  IMPORT_ORDER_CREATED: 'IMPORT_ORDER_CREATED',
  IMPORT_ORDER_STATUS_CHANGED: 'IMPORT_ORDER_STATUS_CHANGED',
  IMPORT_ORDER_PARTICIPANTS_ADDED: 'IMPORT_ORDER_PARTICIPANTS_ADDED',
  IMPORT_ORDER_FLAGGED: 'IMPORT_ORDER_FLAGGED',

  // Quotes (diaspora_import_quotes)
  QUOTE_ISSUED: 'QUOTE_ISSUED',
  QUOTE_ACCEPTED: 'QUOTE_ACCEPTED',
  QUOTE_REJECTED: 'QUOTE_REJECTED',
  QUOTE_EXPIRED: 'QUOTE_EXPIRED',

  // Stock (diaspora_stock_items / diaspora_stock_ledger)
  STOCK_ITEM_CREATED: 'STOCK_ITEM_CREATED',
  STOCK_ITEM_UPDATED: 'STOCK_ITEM_UPDATED',
  STOCK_RESERVED: 'STOCK_RESERVED',
  STOCK_RELEASED: 'STOCK_RELEASED',
  STOCK_VERIFICATION_CHANGED: 'STOCK_VERIFICATION_CHANGED',

  // Supply documents (diaspora_supply_documents)
  SUPPLY_DOCUMENT_CREATED: 'SUPPLY_DOCUMENT_CREATED',
  SUPPLY_DOCUMENT_VERIFIED: 'SUPPLY_DOCUMENT_VERIFIED',

  // Trade documents (diaspora_trade_documents)
  DOCUMENT_UPLOADED: 'DOCUMENT_UPLOADED',
  DOCUMENT_VERIFIED: 'DOCUMENT_VERIFIED',
  DOCUMENT_REJECTED: 'DOCUMENT_REJECTED',

  // Containers + cargo reservations
  CONTAINER_CREATED: 'CONTAINER_CREATED',
  CONTAINER_STATUS_CHANGED: 'CONTAINER_STATUS_CHANGED',
  CARGO_RESERVATION_REQUESTED: 'CARGO_RESERVATION_REQUESTED',
  CARGO_RESERVATION_APPROVED: 'CARGO_RESERVATION_APPROVED',
  CARGO_RESERVATION_REJECTED: 'CARGO_RESERVATION_REJECTED',

  // Shipments
  SHIPMENT_CREATED: 'SHIPMENT_CREATED',
  SHIPMENT_STATUS_CHANGED: 'SHIPMENT_STATUS_CHANGED',
  SHIPMENT_STAGE_EVENT: 'SHIPMENT_STAGE_EVENT',

  // Compliance + reputation
  COMPLIANCE_REVIEW_CREATED: 'COMPLIANCE_REVIEW_CREATED',
  COMPLIANCE_REVIEW_UPDATED: 'COMPLIANCE_REVIEW_UPDATED',
  REPUTATION_RECORD_CREATED: 'REPUTATION_RECORD_CREATED',
  REPUTATION_RECORD_FLAGGED: 'REPUTATION_RECORD_FLAGGED',

  // Payment milestones (logistics ledger; SafeTrade milestones are separate, below)
  PAYMENT_MILESTONE_CREATED: 'PAYMENT_MILESTONE_CREATED',
  PAYMENT_MILESTONE_STATUS_CHANGED: 'PAYMENT_MILESTONE_STATUS_CHANGED',

  // SafeTrade (Phase 9): transactions / milestones / disputes
  SAFETRADE_TRANSACTION_CREATED: 'SAFETRADE_TRANSACTION_CREATED',
  SAFETRADE_TRANSACTION_STATUS_CHANGED: 'SAFETRADE_TRANSACTION_STATUS_CHANGED',
  SAFETRADE_MILESTONE_CREATED: 'SAFETRADE_MILESTONE_CREATED',
  SAFETRADE_DISPUTE_CREATED: 'SAFETRADE_DISPUTE_CREATED',

  // Drive sync
  DRIVE_FILE_SYNCED: 'DRIVE_FILE_SYNCED',
  DRIVE_CONNECTION_CREATED: 'DRIVE_CONNECTION_CREATED',

  // AI commands (events only — AI never mutates authoritative state or the graph)
  AI_COMMAND_CREATED: 'AI_COMMAND_CREATED',
  AI_COMMAND_EXECUTED: 'AI_COMMAND_EXECUTED',

  // Workbook imports
  WORKBOOK_BATCH_IMPORTED: 'WORKBOOK_BATCH_IMPORTED',
});

/** Fast membership set for eventWorker subscription + projector "is this event mine?" check. */
export const DIASPORA_EVENT_TYPE_SET = new Set(Object.values(DIASPORA_EVENT_TYPES));

// ─────────────────────────────────────────────────────────────────────────────
// 2. Node + edge type allowlists (MUST match the migration CHECK constraints)
// ─────────────────────────────────────────────────────────────────────────────

export const TRADE_GRAPH_NODE_TYPES = Object.freeze({
  USER: 'USER',
  TENANT: 'TENANT',
  TRADE_PROFILE: 'TRADE_PROFILE',
  BUYER: 'BUYER',
  SELLER: 'SELLER',
  BUYER_ORDER: 'BUYER_ORDER',
  SELLER_STOCK_ITEM: 'SELLER_STOCK_ITEM',
  RFQ: 'RFQ',
  ACCEPTED_QUOTE: 'ACCEPTED_QUOTE',
  SUPPLY_DOCUMENT: 'SUPPLY_DOCUMENT',
  CONTAINER: 'CONTAINER',
  CARGO_RESERVATION: 'CARGO_RESERVATION',
  SHIPMENT: 'SHIPMENT',
  DOCUMENT: 'DOCUMENT',
  COMPLIANCE_REVIEW: 'COMPLIANCE_REVIEW',
  PAYMENT_MILESTONE: 'PAYMENT_MILESTONE',
  REPUTATION_RECORD: 'REPUTATION_RECORD',
  SAFETRADE_TRANSACTION: 'SAFETRADE_TRANSACTION',
  SAFETRADE_MILESTONE: 'SAFETRADE_MILESTONE',
  SAFETRADE_DISPUTE: 'SAFETRADE_DISPUTE',
  DRIVE_FILE: 'DRIVE_FILE',
  AI_COMMAND: 'AI_COMMAND',
  WORKBOOK_BATCH: 'WORKBOOK_BATCH',
});

export const TRADE_GRAPH_NODE_TYPE_SET = new Set(Object.values(TRADE_GRAPH_NODE_TYPES));

/**
 * FIX D (HIGH) — PARTICIPANT NODE TYPES whose `entity_id` (the structural, queryable
 * trade_graph_nodes.entity_id column surfaced as `entityId` / `neighbor_entity_id`) IS a raw
 * person/profile identifier, NOT an opaque domain-object id:
 *   - BUYER          → entity_id = buyer_id (a user/profile id)
 *   - SELLER         → entity_id = seller_id (a user/profile id)
 *   - USER           → entity_id = user_id / created_by / verified_by (a user id)
 *   - TRADE_PROFILE  → entity_id = trade_profile_id (a profile id that re-identifies the party)
 *
 * For these node types the surfaced entityId must NOT expose the raw id to a non-admin viewer or to AI
 * context — unlike FIX A (which masks participant ids nested in node.data), the leak here is the
 * STRUCTURAL entity_id itself. The shared redaction layer replaces the surfaced entityId of these node
 * types with a STABLE, NON-REVERSIBLE pseudonym token (TRADE_GRAPH_PARTICIPANT_TOKEN_PREFIX + hash) for
 * non-admin/non-reviewer callers, while the structural nodeId (the trade_graph_nodes.id UUID) stays
 * intact so traversal/correlation still works. Platform admin/reviewer still see the raw entityId.
 *
 * Server-side internal joins still use the raw entity_id; only the OUTBOUND surfaced value is tokenized.
 */
export const TRADE_GRAPH_PARTICIPANT_NODE_TYPES = Object.freeze([
  TRADE_GRAPH_NODE_TYPES.BUYER,
  TRADE_GRAPH_NODE_TYPES.SELLER,
  TRADE_GRAPH_NODE_TYPES.USER,
  TRADE_GRAPH_NODE_TYPES.TRADE_PROFILE,
]);

export const TRADE_GRAPH_PARTICIPANT_NODE_TYPE_SET = new Set(TRADE_GRAPH_PARTICIPANT_NODE_TYPES);

/** Prefix of the stable, non-reversible participant pseudonym token (FIX D). e.g. 'PARTICIPANT:1a2b3c4d'. */
export const TRADE_GRAPH_PARTICIPANT_TOKEN_PREFIX = 'PARTICIPANT:';

/** True when a node type's surfaced entity_id is a raw person/profile id (FIX D participant node type). */
export function isParticipantNodeType(nodeType) {
  return TRADE_GRAPH_PARTICIPANT_NODE_TYPE_SET.has(nodeType);
}

export const TRADE_GRAPH_EDGE_TYPES = Object.freeze({
  CREATED_BY: 'CREATED_BY',
  BELONGS_TO_TENANT: 'BELONGS_TO_TENANT',
  HAS_TRADE_PROFILE: 'HAS_TRADE_PROFILE',
  INITIATED_ORDER: 'INITIATED_ORDER',
  QUOTED_ON: 'QUOTED_ON',
  ACCEPTED_QUOTE: 'ACCEPTED_QUOTE',
  SUPPLIES: 'SUPPLIES',
  DOCUMENTS: 'DOCUMENTS',
  RESERVES_CONTAINER: 'RESERVES_CONTAINER',
  FULFILLS_ORDER: 'FULFILLS_ORDER',
  REVIEWS_COMPLIANCE: 'REVIEWS_COMPLIANCE',
  REFERENCES_PROFILE: 'REFERENCES_PROFILE',
  VERIFIES_DOCUMENT: 'VERIFIES_DOCUMENT',
  CONDUCTS_TRANSACTION: 'CONDUCTS_TRANSACTION',
  HAS_MILESTONE: 'HAS_MILESTONE',
  RAISED_DISPUTE: 'RAISED_DISPUTE',
  SYNCED_TO_DRIVE: 'SYNCED_TO_DRIVE',
  AI_COMMAND_FOR: 'AI_COMMAND_FOR',
  PAYS_MILESTONE: 'PAYS_MILESTONE',
});

export const TRADE_GRAPH_EDGE_TYPE_SET = new Set(Object.values(TRADE_GRAPH_EDGE_TYPES));

// Mapping operation discriminators (interpreted by the Stage 2 projector).
export const NODE_OPERATIONS = Object.freeze({ CREATE_OR_UPDATE_NODE: 'CREATE_OR_UPDATE_NODE' });
// CREATE_EDGE derives a new (or replayed) edge from a domain event.
// SOFT_DELETE_EDGE marks a previously-derived edge as revoked (deleted_at set, is_valid=false) when a
// domain event REVOKES the underlying relationship (e.g. a reserved stock item is released, a quote is
// rejected/expired, a cargo reservation is rejected). The graph row is NEVER hard-deleted — it is
// soft-deleted so audit/replay keep the history; traversals exclude soft-deleted edges. The projector
// applies SOFT_DELETE_EDGE idempotently (re-revoking an already-revoked edge is a no-op). Like every
// other graph write, a revocation is authored ONLY by a domain event — AI/frontend never revoke edges.
export const EDGE_OPERATIONS = Object.freeze({
  CREATE_EDGE: 'CREATE_EDGE',
  SOFT_DELETE_EDGE: 'SOFT_DELETE_EDGE',
});

const N = TRADE_GRAPH_NODE_TYPES;
const E = TRADE_GRAPH_EDGE_TYPES;
const EV = DIASPORA_EVENT_TYPES;

// ─────────────────────────────────────────────────────────────────────────────
// 3. Pure selector helpers (read-only over the event/audit envelope)
//    The projector resolves an event into { tenantId, payload }; selectors read payload.
//    Returning null/undefined from a selector means "skip this node/edge" (the projector
//    must drop operations whose required ids are missing — keeps projection idempotent and
//    avoids violating the no-self-loop / not-null constraints).
// ─────────────────────────────────────────────────────────────────────────────

const get = (key) => (e) => (e && e.payload ? e.payload[key] : undefined) ?? null;
const constant = (value) => () => value;
const tenant = (e) => (e ? e.tenantId : null);

// ─────────────────────────────────────────────────────────────────────────────
// 4. EVENT_PROJECTION_MAP — declarative event -> { nodeOperations, edgeOperations, edgeRevocations? }
//    Each node op:       { operation, nodeType, idSelector, attributes? }
//    Each edge op:       { operation, edgeType, fromNodeType, fromId, toNodeType, toId, confidence?, metadata? }
//    Each edge revoke:   { operation:SOFT_DELETE_EDGE, edgeType, fromNodeType, fromId, toNodeType, toId }
//    `idSelector`/`fromId`/`toId` are pure functions of the event envelope.
//    Every edge is created from a domain event (source_event_ref is set by the projector from
//    domain_events.id) — there is NO entry that lets AI/frontend author an edge. Likewise, an edge is
//    only ever revoked (SOFT_DELETE_EDGE) by a domain event that logically tears down the relationship.
// ─────────────────────────────────────────────────────────────────────────────

export const EVENT_PROJECTION_MAP = Object.freeze({
  // ── Trade profiles ─────────────────────────────────────────────────────────
  [EV.TRADE_PROFILE_CREATED]: {
    nodeOperations: [
      {
        operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE,
        nodeType: N.TRADE_PROFILE,
        idSelector: get('trade_profile_id'),
        attributes: {
          user_id: get('user_id'),
          role_type: get('role_type'),
          country: get('country'),
          city: get('city'),
          verification_status: get('verification_status'),
          trust_score: get('trust_score'),
        },
      },
    ],
    edgeOperations: [
      { operation: EDGE_OPERATIONS.CREATE_EDGE, edgeType: E.HAS_TRADE_PROFILE, fromNodeType: N.USER, fromId: get('user_id'), toNodeType: N.TRADE_PROFILE, toId: get('trade_profile_id') },
      { operation: EDGE_OPERATIONS.CREATE_EDGE, edgeType: E.BELONGS_TO_TENANT, fromNodeType: N.TRADE_PROFILE, fromId: get('trade_profile_id'), toNodeType: N.TENANT, toId: tenant },
      { operation: EDGE_OPERATIONS.CREATE_EDGE, edgeType: E.CREATED_BY, fromNodeType: N.USER, fromId: get('created_by'), toNodeType: N.TRADE_PROFILE, toId: get('trade_profile_id') },
    ],
  },
  [EV.TRADE_PROFILE_UPDATED]: {
    nodeOperations: [
      { operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE, nodeType: N.TRADE_PROFILE, idSelector: get('trade_profile_id'), attributes: { verification_status: get('verification_status'), trust_score: get('trust_score') } },
    ],
    edgeOperations: [],
  },
  [EV.TRADE_PROFILE_VERIFIED]: {
    nodeOperations: [
      { operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE, nodeType: N.TRADE_PROFILE, idSelector: get('trade_profile_id'), attributes: { verification_status: constant('VERIFIED') } },
    ],
    edgeOperations: [],
  },
  [EV.TRADE_PROFILE_FLAGGED]: {
    nodeOperations: [
      { operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE, nodeType: N.TRADE_PROFILE, idSelector: get('trade_profile_id'), attributes: { verification_status: get('verification_status') } },
    ],
    edgeOperations: [],
  },

  // ── Buyer / import orders ──────────────────────────────────────────────────
  [EV.IMPORT_ORDER_CREATED]: {
    nodeOperations: [
      {
        operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE,
        nodeType: N.BUYER_ORDER,
        idSelector: get('order_id'),
        attributes: {
          buyer_id: get('buyer_id'),
          status: get('status'),
          order_type: get('order_type'),
          origin_country: get('origin_country'),
          destination_country: get('destination_country'),
        },
      },
    ],
    edgeOperations: [
      { operation: EDGE_OPERATIONS.CREATE_EDGE, edgeType: E.INITIATED_ORDER, fromNodeType: N.BUYER, fromId: get('buyer_id'), toNodeType: N.BUYER_ORDER, toId: get('order_id') },
      { operation: EDGE_OPERATIONS.CREATE_EDGE, edgeType: E.BELONGS_TO_TENANT, fromNodeType: N.BUYER_ORDER, fromId: get('order_id'), toNodeType: N.TENANT, toId: tenant },
    ],
  },
  [EV.IMPORT_ORDER_STATUS_CHANGED]: {
    nodeOperations: [
      { operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE, nodeType: N.BUYER_ORDER, idSelector: get('order_id'), attributes: { status: get('status'), previous_status: get('previous_status') } },
    ],
    edgeOperations: [],
  },
  [EV.IMPORT_ORDER_PARTICIPANTS_ADDED]: {
    nodeOperations: [],
    edgeOperations: [
      { operation: EDGE_OPERATIONS.CREATE_EDGE, edgeType: E.INITIATED_ORDER, fromNodeType: N.BUYER, fromId: get('buyer_id'), toNodeType: N.BUYER_ORDER, toId: get('order_id') },
    ],
  },
  [EV.IMPORT_ORDER_FLAGGED]: {
    nodeOperations: [
      { operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE, nodeType: N.BUYER_ORDER, idSelector: get('order_id'), attributes: { status: get('status') } },
    ],
    edgeOperations: [],
  },

  // ── Quotes ─────────────────────────────────────────────────────────────────
  [EV.QUOTE_ISSUED]: {
    nodeOperations: [
      {
        operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE,
        nodeType: N.RFQ,
        idSelector: get('quote_id'),
        attributes: { import_order_id: get('order_id'), seller_id: get('seller_id'), status: get('status'), amount: get('quote_amount'), currency: get('quote_currency') },
      },
    ],
    edgeOperations: [
      { operation: EDGE_OPERATIONS.CREATE_EDGE, edgeType: E.QUOTED_ON, fromNodeType: N.SELLER, fromId: get('seller_id'), toNodeType: N.RFQ, toId: get('quote_id') },
    ],
  },
  [EV.QUOTE_ACCEPTED]: {
    nodeOperations: [
      {
        operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE,
        nodeType: N.ACCEPTED_QUOTE,
        idSelector: get('quote_id'),
        attributes: { import_order_id: get('order_id'), seller_id: get('seller_id'), status: constant('ACCEPTED') },
      },
    ],
    edgeOperations: [
      { operation: EDGE_OPERATIONS.CREATE_EDGE, edgeType: E.ACCEPTED_QUOTE, fromNodeType: N.BUYER_ORDER, fromId: get('order_id'), toNodeType: N.ACCEPTED_QUOTE, toId: get('quote_id') },
    ],
  },
  [EV.QUOTE_REJECTED]: {
    nodeOperations: [
      { operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE, nodeType: N.RFQ, idSelector: get('quote_id'), attributes: { status: constant('REJECTED') } },
    ],
    edgeOperations: [],
    // A rejected quote revokes the seller's QUOTED_ON pointer and any accepted-quote linkage.
    edgeRevocations: [
      { operation: EDGE_OPERATIONS.SOFT_DELETE_EDGE, edgeType: E.QUOTED_ON, fromNodeType: N.SELLER, fromId: get('seller_id'), toNodeType: N.RFQ, toId: get('quote_id') },
      { operation: EDGE_OPERATIONS.SOFT_DELETE_EDGE, edgeType: E.ACCEPTED_QUOTE, fromNodeType: N.BUYER_ORDER, fromId: get('order_id'), toNodeType: N.ACCEPTED_QUOTE, toId: get('quote_id') },
    ],
  },
  [EV.QUOTE_EXPIRED]: {
    nodeOperations: [
      { operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE, nodeType: N.RFQ, idSelector: get('quote_id'), attributes: { status: constant('EXPIRED') } },
    ],
    edgeOperations: [],
    // An expired quote revokes the seller's QUOTED_ON pointer and any accepted-quote linkage.
    edgeRevocations: [
      { operation: EDGE_OPERATIONS.SOFT_DELETE_EDGE, edgeType: E.QUOTED_ON, fromNodeType: N.SELLER, fromId: get('seller_id'), toNodeType: N.RFQ, toId: get('quote_id') },
      { operation: EDGE_OPERATIONS.SOFT_DELETE_EDGE, edgeType: E.ACCEPTED_QUOTE, fromNodeType: N.BUYER_ORDER, fromId: get('order_id'), toNodeType: N.ACCEPTED_QUOTE, toId: get('quote_id') },
    ],
  },

  // ── Stock ──────────────────────────────────────────────────────────────────
  [EV.STOCK_ITEM_CREATED]: {
    nodeOperations: [
      {
        operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE,
        nodeType: N.SELLER_STOCK_ITEM,
        idSelector: get('stock_item_id'),
        attributes: { seller_trade_profile_id: get('seller_trade_profile_id'), publication_status: get('publication_status'), verification_status: get('verification_status') },
      },
    ],
    edgeOperations: [
      { operation: EDGE_OPERATIONS.CREATE_EDGE, edgeType: E.BELONGS_TO_TENANT, fromNodeType: N.SELLER_STOCK_ITEM, fromId: get('stock_item_id'), toNodeType: N.TENANT, toId: tenant },
    ],
  },
  [EV.STOCK_ITEM_UPDATED]: {
    nodeOperations: [
      { operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE, nodeType: N.SELLER_STOCK_ITEM, idSelector: get('stock_item_id'), attributes: { publication_status: get('publication_status'), verification_status: get('verification_status') } },
    ],
    edgeOperations: [],
  },
  [EV.STOCK_RESERVED]: {
    nodeOperations: [
      { operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE, nodeType: N.SELLER_STOCK_ITEM, idSelector: get('stock_item_id'), attributes: { status: constant('RESERVED') } },
    ],
    edgeOperations: [
      { operation: EDGE_OPERATIONS.CREATE_EDGE, edgeType: E.SUPPLIES, fromNodeType: N.SELLER_STOCK_ITEM, fromId: get('stock_item_id'), toNodeType: N.BUYER_ORDER, toId: get('order_id') },
    ],
  },
  [EV.STOCK_RELEASED]: {
    nodeOperations: [
      { operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE, nodeType: N.SELLER_STOCK_ITEM, idSelector: get('stock_item_id'), attributes: { status: constant('AVAILABLE') } },
    ],
    edgeOperations: [],
    // Releasing reserved stock REVOKES the SUPPLIES relationship the prior STOCK_RESERVED created.
    edgeRevocations: [
      { operation: EDGE_OPERATIONS.SOFT_DELETE_EDGE, edgeType: E.SUPPLIES, fromNodeType: N.SELLER_STOCK_ITEM, fromId: get('stock_item_id'), toNodeType: N.BUYER_ORDER, toId: get('order_id') },
    ],
  },
  [EV.STOCK_VERIFICATION_CHANGED]: {
    nodeOperations: [
      { operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE, nodeType: N.SELLER_STOCK_ITEM, idSelector: get('stock_item_id'), attributes: { verification_status: get('verification_status') } },
    ],
    edgeOperations: [],
  },

  // ── Supply documents ───────────────────────────────────────────────────────
  [EV.SUPPLY_DOCUMENT_CREATED]: {
    nodeOperations: [
      {
        operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE,
        nodeType: N.SUPPLY_DOCUMENT,
        idSelector: get('supply_document_id'),
        attributes: { seller_trade_profile_id: get('seller_trade_profile_id'), verification_status: get('verification_status'), publication_status: get('publication_status') },
      },
    ],
    edgeOperations: [
      { operation: EDGE_OPERATIONS.CREATE_EDGE, edgeType: E.BELONGS_TO_TENANT, fromNodeType: N.SUPPLY_DOCUMENT, fromId: get('supply_document_id'), toNodeType: N.TENANT, toId: tenant },
    ],
  },
  [EV.SUPPLY_DOCUMENT_VERIFIED]: {
    nodeOperations: [
      { operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE, nodeType: N.SUPPLY_DOCUMENT, idSelector: get('supply_document_id'), attributes: { verification_status: constant('VERIFIED') } },
    ],
    edgeOperations: [],
  },

  // ── Trade documents ────────────────────────────────────────────────────────
  [EV.DOCUMENT_UPLOADED]: {
    nodeOperations: [
      {
        operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE,
        nodeType: N.DOCUMENT,
        idSelector: get('document_id'),
        attributes: { import_order_id: get('order_id'), document_type: get('document_type'), uploaded_by: get('uploaded_by'), verification_status: get('verification_status') },
      },
    ],
    edgeOperations: [
      { operation: EDGE_OPERATIONS.CREATE_EDGE, edgeType: E.DOCUMENTS, fromNodeType: N.DOCUMENT, fromId: get('document_id'), toNodeType: N.BUYER_ORDER, toId: get('order_id') },
    ],
  },
  [EV.DOCUMENT_VERIFIED]: {
    nodeOperations: [
      { operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE, nodeType: N.DOCUMENT, idSelector: get('document_id'), attributes: { verification_status: constant('VERIFIED') } },
    ],
    edgeOperations: [
      { operation: EDGE_OPERATIONS.CREATE_EDGE, edgeType: E.VERIFIES_DOCUMENT, fromNodeType: N.USER, fromId: get('verified_by'), toNodeType: N.DOCUMENT, toId: get('document_id') },
    ],
  },
  [EV.DOCUMENT_REJECTED]: {
    nodeOperations: [
      { operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE, nodeType: N.DOCUMENT, idSelector: get('document_id'), attributes: { verification_status: constant('REJECTED') } },
    ],
    edgeOperations: [],
    // A rejected document revokes its DOCUMENTS link to the order (it no longer supports the order).
    edgeRevocations: [
      { operation: EDGE_OPERATIONS.SOFT_DELETE_EDGE, edgeType: E.DOCUMENTS, fromNodeType: N.DOCUMENT, fromId: get('document_id'), toNodeType: N.BUYER_ORDER, toId: get('order_id') },
    ],
  },

  // ── Containers + cargo reservations ────────────────────────────────────────
  [EV.CONTAINER_CREATED]: {
    nodeOperations: [
      { operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE, nodeType: N.CONTAINER, idSelector: get('container_id'), attributes: { coordinator_id: get('coordinator_id'), status: get('status') } },
    ],
    edgeOperations: [
      { operation: EDGE_OPERATIONS.CREATE_EDGE, edgeType: E.BELONGS_TO_TENANT, fromNodeType: N.CONTAINER, fromId: get('container_id'), toNodeType: N.TENANT, toId: tenant },
    ],
  },
  [EV.CONTAINER_STATUS_CHANGED]: {
    nodeOperations: [
      { operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE, nodeType: N.CONTAINER, idSelector: get('container_id'), attributes: { status: get('status') } },
    ],
    edgeOperations: [],
  },
  [EV.CARGO_RESERVATION_REQUESTED]: {
    nodeOperations: [
      { operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE, nodeType: N.CARGO_RESERVATION, idSelector: get('reservation_id'), attributes: { import_order_id: get('order_id'), container_id: get('container_id'), reservation_status: get('reservation_status') } },
    ],
    edgeOperations: [
      { operation: EDGE_OPERATIONS.CREATE_EDGE, edgeType: E.RESERVES_CONTAINER, fromNodeType: N.CARGO_RESERVATION, fromId: get('reservation_id'), toNodeType: N.CONTAINER, toId: get('container_id') },
    ],
  },
  [EV.CARGO_RESERVATION_APPROVED]: {
    nodeOperations: [
      { operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE, nodeType: N.CARGO_RESERVATION, idSelector: get('reservation_id'), attributes: { reservation_status: constant('APPROVED') } },
    ],
    edgeOperations: [],
  },
  [EV.CARGO_RESERVATION_REJECTED]: {
    nodeOperations: [
      { operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE, nodeType: N.CARGO_RESERVATION, idSelector: get('reservation_id'), attributes: { reservation_status: constant('REJECTED') } },
    ],
    edgeOperations: [],
    // A rejected cargo reservation revokes the RESERVES_CONTAINER relationship it had requested.
    edgeRevocations: [
      { operation: EDGE_OPERATIONS.SOFT_DELETE_EDGE, edgeType: E.RESERVES_CONTAINER, fromNodeType: N.CARGO_RESERVATION, fromId: get('reservation_id'), toNodeType: N.CONTAINER, toId: get('container_id') },
    ],
  },

  // ── Shipments ──────────────────────────────────────────────────────────────
  [EV.SHIPMENT_CREATED]: {
    nodeOperations: [
      { operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE, nodeType: N.SHIPMENT, idSelector: get('shipment_id'), attributes: { import_order_id: get('order_id'), container_id: get('container_id'), status: get('status') } },
    ],
    edgeOperations: [
      { operation: EDGE_OPERATIONS.CREATE_EDGE, edgeType: E.FULFILLS_ORDER, fromNodeType: N.SHIPMENT, fromId: get('shipment_id'), toNodeType: N.BUYER_ORDER, toId: get('order_id') },
    ],
  },
  [EV.SHIPMENT_STATUS_CHANGED]: {
    nodeOperations: [
      { operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE, nodeType: N.SHIPMENT, idSelector: get('shipment_id'), attributes: { status: get('status') } },
    ],
    edgeOperations: [],
  },
  [EV.SHIPMENT_STAGE_EVENT]: {
    nodeOperations: [
      { operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE, nodeType: N.SHIPMENT, idSelector: get('shipment_id'), attributes: { stage: get('stage'), status: get('status') } },
    ],
    edgeOperations: [],
  },

  // ── Compliance + reputation ────────────────────────────────────────────────
  [EV.COMPLIANCE_REVIEW_CREATED]: {
    nodeOperations: [
      { operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE, nodeType: N.COMPLIANCE_REVIEW, idSelector: get('compliance_review_id'), attributes: { import_order_id: get('order_id'), status: get('status') } },
    ],
    edgeOperations: [
      { operation: EDGE_OPERATIONS.CREATE_EDGE, edgeType: E.REVIEWS_COMPLIANCE, fromNodeType: N.COMPLIANCE_REVIEW, fromId: get('compliance_review_id'), toNodeType: N.BUYER_ORDER, toId: get('order_id') },
    ],
  },
  [EV.COMPLIANCE_REVIEW_UPDATED]: {
    nodeOperations: [
      { operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE, nodeType: N.COMPLIANCE_REVIEW, idSelector: get('compliance_review_id'), attributes: { status: get('status') } },
    ],
    edgeOperations: [],
  },
  [EV.REPUTATION_RECORD_CREATED]: {
    nodeOperations: [
      { operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE, nodeType: N.REPUTATION_RECORD, idSelector: get('reputation_record_id'), attributes: { trade_profile_id: get('trade_profile_id'), verification_status: get('verification_status') } },
    ],
    edgeOperations: [
      { operation: EDGE_OPERATIONS.CREATE_EDGE, edgeType: E.REFERENCES_PROFILE, fromNodeType: N.REPUTATION_RECORD, fromId: get('reputation_record_id'), toNodeType: N.TRADE_PROFILE, toId: get('trade_profile_id') },
    ],
  },
  [EV.REPUTATION_RECORD_FLAGGED]: {
    nodeOperations: [
      { operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE, nodeType: N.REPUTATION_RECORD, idSelector: get('reputation_record_id'), attributes: { verification_status: get('verification_status') } },
    ],
    edgeOperations: [],
  },

  // ── Payment milestones (logistics ledger) ──────────────────────────────────
  [EV.PAYMENT_MILESTONE_CREATED]: {
    nodeOperations: [
      { operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE, nodeType: N.PAYMENT_MILESTONE, idSelector: get('payment_milestone_id'), attributes: { import_order_id: get('order_id'), status: get('status') } },
    ],
    edgeOperations: [
      { operation: EDGE_OPERATIONS.CREATE_EDGE, edgeType: E.PAYS_MILESTONE, fromNodeType: N.PAYMENT_MILESTONE, fromId: get('payment_milestone_id'), toNodeType: N.BUYER_ORDER, toId: get('order_id') },
    ],
  },
  [EV.PAYMENT_MILESTONE_STATUS_CHANGED]: {
    nodeOperations: [
      { operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE, nodeType: N.PAYMENT_MILESTONE, idSelector: get('payment_milestone_id'), attributes: { status: get('status') } },
    ],
    edgeOperations: [],
  },

  // ── SafeTrade (Phase 9) ────────────────────────────────────────────────────
  [EV.SAFETRADE_TRANSACTION_CREATED]: {
    nodeOperations: [
      { operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE, nodeType: N.SAFETRADE_TRANSACTION, idSelector: get('safetrade_transaction_id'), attributes: { import_order_id: get('order_id'), status: get('status') } },
    ],
    edgeOperations: [
      { operation: EDGE_OPERATIONS.CREATE_EDGE, edgeType: E.CONDUCTS_TRANSACTION, fromNodeType: N.SAFETRADE_TRANSACTION, fromId: get('safetrade_transaction_id'), toNodeType: N.BUYER_ORDER, toId: get('order_id') },
      { operation: EDGE_OPERATIONS.CREATE_EDGE, edgeType: E.BELONGS_TO_TENANT, fromNodeType: N.SAFETRADE_TRANSACTION, fromId: get('safetrade_transaction_id'), toNodeType: N.TENANT, toId: tenant },
    ],
  },
  [EV.SAFETRADE_TRANSACTION_STATUS_CHANGED]: {
    nodeOperations: [
      { operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE, nodeType: N.SAFETRADE_TRANSACTION, idSelector: get('safetrade_transaction_id'), attributes: { status: get('status'), previous_status: get('previous_status') } },
    ],
    edgeOperations: [],
  },
  [EV.SAFETRADE_MILESTONE_CREATED]: {
    nodeOperations: [
      { operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE, nodeType: N.SAFETRADE_MILESTONE, idSelector: get('safetrade_milestone_id'), attributes: { safetrade_transaction_id: get('safetrade_transaction_id'), milestone_type: get('milestone_type'), status: get('status') } },
    ],
    edgeOperations: [
      { operation: EDGE_OPERATIONS.CREATE_EDGE, edgeType: E.HAS_MILESTONE, fromNodeType: N.SAFETRADE_TRANSACTION, fromId: get('safetrade_transaction_id'), toNodeType: N.SAFETRADE_MILESTONE, toId: get('safetrade_milestone_id') },
    ],
  },
  [EV.SAFETRADE_DISPUTE_CREATED]: {
    nodeOperations: [
      { operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE, nodeType: N.SAFETRADE_DISPUTE, idSelector: get('safetrade_dispute_id'), attributes: { safetrade_transaction_id: get('safetrade_transaction_id'), status: get('status') } },
    ],
    edgeOperations: [
      { operation: EDGE_OPERATIONS.CREATE_EDGE, edgeType: E.RAISED_DISPUTE, fromNodeType: N.SAFETRADE_DISPUTE, fromId: get('safetrade_dispute_id'), toNodeType: N.SAFETRADE_TRANSACTION, toId: get('safetrade_transaction_id') },
    ],
  },

  // ── Drive ──────────────────────────────────────────────────────────────────
  [EV.DRIVE_FILE_SYNCED]: {
    nodeOperations: [
      { operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE, nodeType: N.DRIVE_FILE, idSelector: get('drive_file_id'), attributes: { linked_entity_type: get('linked_entity_type'), linked_entity_id: get('linked_entity_id'), sync_status: get('sync_status') } },
    ],
    edgeOperations: [
      { operation: EDGE_OPERATIONS.CREATE_EDGE, edgeType: E.SYNCED_TO_DRIVE, fromNodeType: N.DRIVE_FILE, fromId: get('drive_file_id'), toNodeType: N.DOCUMENT, toId: get('document_id') },
    ],
  },
  [EV.DRIVE_CONNECTION_CREATED]: {
    nodeOperations: [],
    edgeOperations: [],
  },

  // ── AI commands (events only; AI never mutates state or authors edges) ──────
  [EV.AI_COMMAND_CREATED]: {
    nodeOperations: [
      { operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE, nodeType: N.AI_COMMAND, idSelector: get('ai_command_id'), attributes: { requested_by: get('requested_by'), intent: get('intent'), execution_status: get('execution_status'), target_entity_type: get('target_entity_type'), target_entity_id: get('target_entity_id') } },
    ],
    edgeOperations: [
      { operation: EDGE_OPERATIONS.CREATE_EDGE, edgeType: E.AI_COMMAND_FOR, fromNodeType: N.AI_COMMAND, fromId: get('ai_command_id'), toNodeType: N.BUYER_ORDER, toId: get('target_entity_id') },
    ],
  },
  [EV.AI_COMMAND_EXECUTED]: {
    nodeOperations: [
      { operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE, nodeType: N.AI_COMMAND, idSelector: get('ai_command_id'), attributes: { execution_status: get('execution_status') } },
    ],
    edgeOperations: [],
  },

  // ── Workbook imports ───────────────────────────────────────────────────────
  [EV.WORKBOOK_BATCH_IMPORTED]: {
    nodeOperations: [
      { operation: NODE_OPERATIONS.CREATE_OR_UPDATE_NODE, nodeType: N.WORKBOOK_BATCH, idSelector: get('workbook_batch_id'), attributes: { uploaded_by: get('uploaded_by'), status: get('import_status') } },
    ],
    edgeOperations: [
      { operation: EDGE_OPERATIONS.CREATE_EDGE, edgeType: E.BELONGS_TO_TENANT, fromNodeType: N.WORKBOOK_BATCH, fromId: get('workbook_batch_id'), toNodeType: N.TENANT, toId: tenant },
    ],
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Redaction policy (applied by the Stage 4 intelligence/AI-context layer)
//    AI reads only authorized REDACTED summaries: no PII, payment refs, addresses, or private paths.
// ─────────────────────────────────────────────────────────────────────────────

export const TRADE_GRAPH_REDACTION_TOKEN = '[REDACTED]';
export const TRADE_GRAPH_REGION_TOKEN = '[REGION]';

/** node.data / edge.metadata keys fully masked for non-admin AI/intelligence consumers. */
export const TRADE_GRAPH_REDACTED_FIELDS = Object.freeze([
  'user_email', 'email', 'buyer_name', 'seller_name', 'full_name', 'phone',
  'payment_ref', 'payment_reference', 'escrow_reference', 'account_number',
  'credential_reference', 'private_path', 'storage_path', 'drive_file_url',
  'internal_notes',
]);

/**
 * FIX A (HIGH) — PARTICIPANT / PROFILE IDENTIFIER fields that appear INSIDE node.data / edge.metadata
 * payloads (e.g. RFQ.data.seller_id, BUYER_ORDER.data.buyer_id, TRADE_PROFILE.data.user_id,
 * DOCUMENT.data.uploaded_by/verified_by, CONTAINER.data.coordinator_id, AI_COMMAND.data.requested_by).
 * These are person/profile references that re-identify the parties to a trade, so they MUST NOT pass
 * through raw to a non-admin viewer NOR into AI-ready context. They are classified ADMIN_ONLY but
 * TOKENIZED (not nulled): a platform admin/reviewer sees the raw id; everyone else (and AI) gets the
 * redaction token, so the structural shape is preserved while the identity is masked.
 *
 * IMPORTANT: this list is ONLY consulted for keys inside node.data / edge.metadata. The STRUCTURAL graph
 * keys — trade_graph_nodes.id and trade_graph_nodes.entity_id (the queryable node identity surfaced as
 * nodeId/entityId) — are top-level columns, never members of node.data, so they are unaffected and stay
 * intact for traversal/joining.
 */
export const TRADE_GRAPH_PARTICIPANT_ID_FIELDS = Object.freeze([
  'seller_id', 'buyer_id', 'user_id', 'coordinator_id',
  'uploaded_by', 'verified_by', 'requested_by', 'reviewed_by', 'created_by', 'updated_by',
  'trade_profile_id', 'seller_trade_profile_id', 'buyer_trade_profile_id',
  'assigned_to', 'actor_id', 'initiated_by', 'flagged_by', 'rejected_by', 'approved_by',
  'owner_id', 'seller_user_id', 'buyer_user_id', 'participant_id',
]);

/**
 * GATE-T10 FIX — DOCUMENT / RECORD IDENTIFIER fields that appear INSIDE node.data / edge.metadata payloads
 * (e.g. DOCUMENT.data.document_id, SUPPLY_DOCUMENT.data.supply_document_id, a compliance_review_id,
 * safetrade_dispute_id, ai_command_id surfaced in a neighbor's data bag). These are NOT person references
 * (so they are not participant ids), but they ARE sensitive RECORD references that re-identify a specific
 * trade document / dispute / review and were the precise value a Gate-T10 adversarial test caught leaking
 * RAW through node.data / edge.metadata to a non-admin viewer and into AI-ready context (the directive lists
 * "document identifiers" among the PII that must not survive redaction). Like the participant ids they are
 * ROLE-AWARE + TOKENIZED: a platform admin/reviewer may see the raw record id; everyone else (and the AI
 * boundary) gets the redaction token, while the STRUCTURAL surfaced nodeId/entityId (a top-level column,
 * never a member of node.data) is unaffected and stays intact for traversal.
 */
export const TRADE_GRAPH_DOCUMENT_ID_FIELDS = Object.freeze([
  'document_id', 'supply_document_id', 'compliance_review_id', 'reputation_record_id',
  'safetrade_dispute_id', 'drive_file_id',
]);

/**
 * GATE-T10 FIX (naming clarity) — the COMPLETE set of node.data / edge.metadata id fields that are
 * ROLE-AWARE + TOKENIZED inside redaction: participant/person ids AND document/record refs together.
 *
 * Both classes are tokenized by the SAME policy (raw for a platform admin/reviewer; the redaction token
 * for everyone else and the AI boundary), so they belong in ONE set. The redaction layer previously
 * composed these into a set named `PARTICIPANT_ID`, which was behaviorally correct but misleadingly named
 * (document ids are RECORD refs, not person refs). Exporting them as `TRADE_GRAPH_TOKENIZED_ID_FIELDS`
 * makes the intent explicit and gives the redaction layer an accurately-named set to key off. Runtime
 * behavior is UNCHANGED — this is the union of the two existing field lists.
 */
export const TRADE_GRAPH_TOKENIZED_ID_FIELDS = Object.freeze([
  ...TRADE_GRAPH_PARTICIPANT_ID_FIELDS,
  ...TRADE_GRAPH_DOCUMENT_ID_FIELDS,
]);

/** Keys coarsened to region/prefix only (never full value) for non-admin consumers. */
export const TRADE_GRAPH_REGION_ONLY_FIELDS = Object.freeze(['address', 'origin_city', 'destination_city']);

/**
 * Keys visible only to platform admins; masked for everyone else (and AI).
 * Includes the participant/profile identifiers (FIX A): a non-admin / AI never receives a raw
 * person reference, but a platform admin/reviewer may. (internal_risk_score/amount are nulled for
 * non-admins; the participant ids are TOKENIZED — see TRADE_GRAPH_PARTICIPANT_ID_FIELDS.)
 */
export const TRADE_GRAPH_ADMIN_ONLY_FIELDS = Object.freeze([
  'internal_risk_score', 'amount',
  ...TRADE_GRAPH_PARTICIPANT_ID_FIELDS,
]);

export const TRADE_GRAPH_REDACTION_POLICIES = Object.freeze([
  'PII_REDACTION', 'PAYMENT_REF_REDACTION', 'ADDRESS_REDACTION', 'PRIVATE_FILE_PATH_REDACTION',
  'PARTICIPANT_ID_REDACTION',
]);

// ─────────────────────────────────────────────────────────────────────────────
// 6. Pure validation helpers (used by the projector + tests; no DB access)
// ─────────────────────────────────────────────────────────────────────────────

export function isKnownEventType(eventType) {
  return DIASPORA_EVENT_TYPE_SET.has(eventType);
}

export function isKnownNodeType(nodeType) {
  return TRADE_GRAPH_NODE_TYPE_SET.has(nodeType);
}

export function isKnownEdgeType(edgeType) {
  return TRADE_GRAPH_EDGE_TYPE_SET.has(edgeType);
}

/** Returns the projection mapping for an event type, or null if the event is unmapped (skip). */
export function getProjectionMapping(eventType) {
  return Object.prototype.hasOwnProperty.call(EVENT_PROJECTION_MAP, eventType)
    ? EVENT_PROJECTION_MAP[eventType]
    : null;
}
