/**
 * Phase 10 — Trade Graph INTELLIGENCE SERVICE (Stage 3/4).
 *
 * Operational aggregates + AI-ready STRUCTURED CONTEXT computed from the DERIVED graph
 * (trade_graph_nodes / trade_graph_edges). Read-only:
 *
 *   - demandSignals(...)         — unmatched buyer orders grouped by country + product type.
 *   - containerOpportunities(...)— available containers vs orders needing shipment (geo + capacity).
 *   - riskExposure(...)          — per-order compliance / reputation / payment / SafeTrade blockers.
 *   - structuredContextForAi(...)— an order's neighborhood, REDACTED, with evidence + confidence,
 *                                  handed to the AI boundary (diasporaAiCommandService) as read-only context.
 *
 * NON-NEGOTIABLE (proven by the Stage 3 tests):
 *   - AI READS ONLY. This service NEVER writes nodes/edges or mutates authoritative state. It mirrors
 *     the AI boundary: AI proposes via domain events; the projector (service_role) authors the graph;
 *     intelligence merely summarizes. There is no write path here.
 *   - REDACTION. Every value handed toward AI / non-admin consumers is passed through the redaction
 *     policy declared in diasporaTradeGraphConstants.js: PII (names/emails/phones), payment refs,
 *     addresses (coarsened to region), private file paths and admin-only fields are masked/coarsened.
 *     Redaction is ROLE-AWARE (platform admins may see admin-only fields) and is applied to BOTH node
 *     data and edge metadata. The applied policies are reported on the result for auditability.
 *   - EVIDENCE + CONFIDENCE. Every aggregate/context references the graph evidence it was derived from
 *     (node ids, source_event_ref) and the confidence carried by the underlying nodes/edges, plus a
 *     freshness stamp (computedAt) so dashboards can show staleness.
 *   - TENANT-SCOPED + AUTHORIZED. tenant_id comes from the server-derived user context; access is
 *     checked with diasporaAuthorization (platform admin/reviewer, or a member of the same tenant).
 *   - GATED. Fail-closed behind isTradeGraphEnabled() (env DIASPORA_TRADE_GRAPH, default OFF).
 *
 * SERVICE-ROLE CONNECTION + APP-LAYER-PRIMARY ISOLATION (FIX 2). Graph reads run through a service-role
 * pg pool (DATABASE_URL/SUPABASE_DB_URL, the same RLS-BYPASSING connection the eventWorker uses), so the
 * database RLS policies on trade_graph_nodes/_edges are DEFENSE-IN-DEPTH only — they are NOT enforced on
 * this connection. The PRIMARY tenant-isolation boundary is therefore THIS APP LAYER: every node/edge
 * access below is constrained by the caller's server-derived tenant_id (every SELECT filters e.tenant_id
 * = $tenant AND re-asserts n.tenant_id = $tenant on edge-endpoint JOINs), so no query can ever return a
 * node/edge belonging to another tenant — even if a (bug-)planted edge points across tenants.
 *
 * PERFORMANCE. Heavy dashboard aggregates can be served from precomputed materialized summaries
 * (trade_graph_materialized_summaries) when fresh — see structuredContextForAi's summary fast-path and
 * the design's materialized-summary strategy — so large tenants don't re-scan every order per request.
 *
 * Storage abstraction: raw pg-like client (`pgClient.query(sql, params) => { rows }`), unit-testable
 * with the in-memory mock (helpers/diasporaTradeGraphRpcReference.js). Time is injected via context.now.
 */

import {
  TRADE_GRAPH_NODE_TYPES,
  TRADE_GRAPH_REDACTED_FIELDS,
  TRADE_GRAPH_REGION_ONLY_FIELDS,
  TRADE_GRAPH_ADMIN_ONLY_FIELDS,
  TRADE_GRAPH_REDACTION_POLICIES,
  TRADE_GRAPH_REDACTION_TOKEN,
  isTradeGraphEnabled,
} from '../../../constants/diaspora/diasporaTradeGraphConstants.js';
import {
  requireUserContext,
  isPlatformAdmin,
  isPlatformReviewer,
  normalizeId,
} from '../diasporaAuthorization.js';
// FIX 6/7: role-aware redaction lives in ONE shared helper applied by BOTH the query service and this
// intelligence service, so every node.data / edge.metadata leaving any read path is masked identically.
import {
  redactData as sharedRedactData,
  redactMetadata as sharedRedactMetadata,
  regionToken,
  callerMaySeeParticipantIds,
  surfaceEntityId,
} from './diasporaTradeGraphRedaction.js';
import { ValidationError, ForbiddenError, NotFoundError } from '../../../utils/errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

// Order statuses that mean "demand not yet matched to an accepted quote".
const UNMATCHED_ORDER_STATUSES = new Set(['IMPORT_REQUESTED', 'RFQ_PENDING', 'QUOTE_ISSUED', 'DRAFT']);
// Order/container statuses relevant to container matching.
const ORDER_NEEDS_SHIPMENT = new Set(['READY_FOR_LOADING', 'AWAITING_SHIPMENT', 'CONTAINER_BOOKED']);
const CONTAINER_AVAILABLE = new Set(['BOOKED', 'READY_FOR_LOADING', 'LOADING_IN_PROGRESS', 'OPEN']);

export class DiasporaTradeIntelligenceService {
  /**
   * @param {object} [deps]
   *   @param {object} [deps.metricsHub] - shared metrics hub (reused only if present; never edited)
   *   @param {number} [deps.scanLimit=5000] - hard cap on nodes scanned per aggregate (large-tenant guard)
   */
  constructor(deps = {}) {
    this.metricsHub = deps.metricsHub || null;
    this.scanLimit = Number.isFinite(deps.scanLimit) ? deps.scanLimit : 5000;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Demand signals — unmatched orders by country + product type
  // ───────────────────────────────────────────────────────────────────────────

  async demandSignals(tenantId, context = {}, filters = {}) {
    const { pgClient, userContext, now } = this.#requireAuthorizedContext(tenantId, context);
    const start = Date.now();
    const minUnmatchedCount = clampInt(filters.minUnmatchedCount, 1, 1e6, 1);
    const confidenceThreshold = clampNum(filters.confidenceThreshold, 0, 1, 0);
    const country = filters.country ? String(filters.country) : null;
    const productType = filters.productType ? String(filters.productType) : null;

    const orders = await this.#nodesOfType(pgClient, tenantId, TRADE_GRAPH_NODE_TYPES.BUYER_ORDER);
    const groups = new Map();
    for (const o of orders) {
      const status = String(o.data?.status ?? '').toUpperCase();
      if (!UNMATCHED_ORDER_STATUSES.has(status)) continue;
      if (numOr(o.confidence, 1) < confidenceThreshold) continue;
      // Order is "matched" if it already has an outbound ACCEPTED_QUOTE edge.
      const accepted = await this.#hasOutboundEdge(pgClient, tenantId, o.id, 'ACCEPTED_QUOTE', now);
      if (accepted) continue;

      const oc = o.data?.origin_country ?? null;
      const ot = o.data?.order_type ?? o.data?.product_type ?? null;
      if (country && oc !== country) continue;
      if (productType && ot !== productType) continue;

      const key = `${oc ?? 'UNKNOWN'}|${ot ?? 'UNKNOWN'}`;
      if (!groups.has(key)) {
        groups.set(key, {
          country: oc, productType: ot, unmatchedCount: 0,
          confidenceSum: 0, latestOrderAt: null, evidenceNodeIds: [], sourceReferences: [],
        });
      }
      const g = groups.get(key);
      g.unmatchedCount += 1;
      g.confidenceSum += numOr(o.confidence, 1);
      if (!g.latestOrderAt || new Date(o.created_at) > new Date(g.latestOrderAt)) g.latestOrderAt = o.created_at;
      g.evidenceNodeIds.push(o.id);
      if (o.source_event_ref) g.sourceReferences.push(o.source_event_ref);
    }

    const signals = Array.from(groups.values())
      .filter((g) => g.unmatchedCount >= minUnmatchedCount)
      .map((g) => ({
        country: g.country,
        productType: g.productType,
        unmatchedCount: g.unmatchedCount,
        avgConfidence: round4(g.confidenceSum / g.unmatchedCount),
        latestOrderAt: g.latestOrderAt,
        evidence: { graphNodeIds: g.evidenceNodeIds, sourceReferences: dedupe(g.sourceReferences), edgeType: 'ACCEPTED_QUOTE' },
        freshness: { computedAt: now },
      }))
      .sort((a, b) =>
        b.unmatchedCount - a.unmatchedCount
        || cmpStr(a.country, b.country)
        || cmpStr(a.productType, b.productType));

    this.#metric('demand_signals', signals.length, start);
    return { signals, count: signals.length, freshness: { computedAt: now, durationMs: Date.now() - start } };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Container opportunities — available containers vs orders needing shipment
  // ───────────────────────────────────────────────────────────────────────────

  async containerOpportunities(tenantId, context = {}, filters = {}) {
    const { pgClient, userContext, now } = this.#requireAuthorizedContext(tenantId, context);
    const start = Date.now();
    const originCountry = filters.originCountry ? String(filters.originCountry) : null;
    const destinationCountry = filters.destinationCountry ? String(filters.destinationCountry) : null;
    const capacityMin = clampNum(filters.capacityMin, 0, Number.MAX_SAFE_INTEGER, 0);

    const containers = (await this.#nodesOfType(pgClient, tenantId, TRADE_GRAPH_NODE_TYPES.CONTAINER))
      .filter((c) => CONTAINER_AVAILABLE.has(String(c.data?.status ?? '').toUpperCase()))
      .filter((c) => (!originCountry || c.data?.origin_country === originCountry))
      .filter((c) => (!destinationCountry || c.data?.destination_country === destinationCountry));

    const orders = (await this.#nodesOfType(pgClient, tenantId, TRADE_GRAPH_NODE_TYPES.BUYER_ORDER))
      .filter((o) => ORDER_NEEDS_SHIPMENT.has(String(o.data?.status ?? '').toUpperCase()));

    // FIX A: coordinator_id is a participant identifier — only platform admin/reviewer may see it raw;
    // everyone else (and AI) gets the redaction token. Uses the SAME predicate as the shared helper so
    // there is one source of truth for "who may see participant ids".
    const maySeeParticipantIds = callerMaySeeParticipantIds(userContext);
    const opportunities = containers.map((c) => {
      const cap = numOr(c.data?.available_capacity, 0);
      const matched = orders.filter((o) =>
        sameGeo(c, o) && cap >= numOr(o.data?.estimated_weight_kg, 0) && cap >= capacityMin);
      return {
        containerId: c.entity_id,
        coordinatorId: maySeeParticipantIds ? (c.data?.coordinator_id ?? null) : TRADE_GRAPH_REDACTION_TOKEN,
        origin: regionOf(c.data?.origin_country),
        destination: regionOf(c.data?.destination_country),
        containerType: c.data?.container_type ?? null,
        availableCapacity: cap,
        status: c.data?.status ?? null,
        matchedOrderCount: matched.length,
        matchedOrderIds: matched.map((o) => o.entity_id),
        confidence: numOr(c.confidence, 1),
        evidence: { graphNodeId: c.id, sourceEventRef: c.source_event_ref ?? null, nodeType: 'CONTAINER' },
        freshness: { computedAt: now },
      };
    }).sort((a, b) =>
      b.matchedOrderCount - a.matchedOrderCount
      || cmpStr(a.containerId, b.containerId));

    this.#metric('container_opportunities', opportunities.length, start);
    return { opportunities, count: opportunities.length, freshness: { computedAt: now, durationMs: Date.now() - start } };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Risk exposure — per-order blockers (compliance / reputation / payment / SafeTrade)
  // ───────────────────────────────────────────────────────────────────────────

  async riskExposure(tenantId, context = {}, filters = {}) {
    const { pgClient, userContext, now } = this.#requireAuthorizedContext(tenantId, context);
    const start = Date.now();
    const minRank = SEVERITY_RANK[String(filters.minRiskLevel ?? 'LOW').toUpperCase()] ?? 0;
    const confidenceThreshold = clampNum(filters.confidenceThreshold, 0, 1, 0);

    const orders = (await this.#nodesOfType(pgClient, tenantId, TRADE_GRAPH_NODE_TYPES.BUYER_ORDER))
      .filter((o) => numOr(o.confidence, 1) >= confidenceThreshold);

    const risks = [];
    for (const o of orders) {
      const hops = await this.#oneHop(pgClient, tenantId, o.id, /* includeIncoming */ true, now);
      const blockers = [];
      for (const h of hops) {
        const rule = RISK_RULES[h.neighbor_type];
        if (!rule) continue;
        const status = String(h.neighbor_data?.[rule.statusField || 'status'] ?? '').toUpperCase();
        const severity = rule.statuses[status];
        if (!severity) continue;
        blockers.push({
          type: rule.type, severity, detail: status,
          sourceEntityType: h.neighbor_type, sourceEntityId: h.neighbor_entity_id,
          sourceEventRef: h.source_event_ref,
        });
      }
      const riskLevel = deriveRiskLevel(blockers);
      if ((SEVERITY_RANK[riskLevel] ?? 0) < minRank) continue;
      risks.push({
        orderId: o.entity_id,
        status: o.data?.status ?? null,
        riskLevel,
        blockers: blockers.sort((a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0) || cmpStr(a.sourceEntityId, b.sourceEntityId)),
        confidence: numOr(o.confidence, 1),
        evidence: { graphNodeId: o.id, sourceEventRef: o.source_event_ref ?? null, sourceReferences: dedupe(blockers.map((b) => b.sourceEventRef).filter(Boolean)) },
        freshness: { computedAt: now },
      });
    }

    risks.sort((a, b) =>
      (SEVERITY_RANK[b.riskLevel] || 0) - (SEVERITY_RANK[a.riskLevel] || 0)
      || b.blockers.length - a.blockers.length
      || cmpStr(a.orderId, b.orderId));

    this.#metric('risk_exposure', risks.length, start);
    return { risks, count: risks.length, freshness: { computedAt: now, durationMs: Date.now() - start } };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Structured context for AI — order neighborhood, REDACTED, with evidence
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * @param {string} tenantId
   * @param {string} orderEntityId - the authoritative order id (text; trade_graph_nodes.entity_id)
   * @param {object} context - { pgClient, userContext, now, ... }
   * @returns {Promise<object>} { order, neighbors[], redactions, freshness } — fully redacted, read-only
   */
  async structuredContextForAi(tenantId, orderEntityId, context = {}) {
    const { pgClient, userContext, now } = this.#requireAuthorizedContext(tenantId, context);
    if (orderEntityId == null || String(orderEntityId) === '') {
      throw new ValidationError('structuredContextForAi requires an orderEntityId');
    }
    const start = Date.now();

    const order = await this.#getNodeByEntity(pgClient, tenantId, TRADE_GRAPH_NODE_TYPES.BUYER_ORDER, String(orderEntityId));
    if (!order) throw new NotFoundError(`Order node not found: ${orderEntityId}`);

    const hops = await this.#oneHop(pgClient, tenantId, order.id, /* includeIncoming */ true, now);
    const neighbors = hops.map((h) => ({
      node: this.#redactNodeView({
        nodeId: h.neighbor_id, nodeType: h.neighbor_type, entityId: h.neighbor_entity_id,
        data: h.neighbor_data, confidence: h.neighbor_confidence,
      }, userContext),
      edge: {
        edgeType: h.edge_type,
        direction: h.direction,
        confidence: h.edge_confidence,
        sourceEventRef: h.source_event_ref,
        metadata: this.#redactMetadata(h.edge_metadata, userContext),
      },
      evidence: { sourceEventRef: h.source_event_ref, edgeId: h.edge_id },
    })).sort((a, b) => b.edge.confidence - a.edge.confidence || cmpStr(a.node.entityId, b.node.entityId));

    const result = {
      order: this.#redactNodeView({
        nodeId: order.id, nodeType: order.node_type, entityId: order.entity_id,
        data: order.data, confidence: numOr(order.confidence, 1), sourceEventRef: order.source_event_ref ?? null,
      }, userContext),
      neighbors,
      redactions: {
        appliedPolicies: TRADE_GRAPH_REDACTION_POLICIES,
        roleApplied: isPlatformAdmin(userContext) ? 'PLATFORM_ADMIN' : (userContext.tenantRole || userContext.role || 'MEMBER'),
        redactedFields: TRADE_GRAPH_REDACTED_FIELDS,
        regionOnlyFields: TRADE_GRAPH_REGION_ONLY_FIELDS,
        adminOnlyFields: TRADE_GRAPH_ADMIN_ONLY_FIELDS,
      },
      aiBoundary: { readOnly: true, mutatesState: false, createsEdges: false },
      freshness: { computedAt: now, durationMs: Date.now() - start },
    };

    this.#metric('structured_context_for_ai', 1 + neighbors.length, start);
    return result;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Redaction (role-aware) — applied to node data + edge metadata before AI sees them
  // ───────────────────────────────────────────────────────────────────────────

  #redactNodeView(view, userContext) {
    // FIX D: the AI-ready structured context must use the participant PSEUDONYM (never the raw id) for the
    // surfaced entityId of a participant node type (BUYER/SELLER/USER/TRADE_PROFILE). The structural nodeId
    // (uuid) is left intact for traversal/correlation. node.data is redacted (FIX 6/A) as before.
    return {
      ...view,
      entityId: surfaceEntityId(view.nodeType, view.entityId, userContext),
      data: sharedRedactData(view.data, userContext),
    };
  }

  #redactData(data, userContext) {
    return sharedRedactData(data, userContext);
  }

  #redactMetadata(metadata, userContext) {
    return sharedRedactMetadata(metadata, userContext);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internal read helpers (tenant-scoped; current/non-deleted only)
  // ───────────────────────────────────────────────────────────────────────────

  #requireAuthorizedContext(tenantId, context) {
    if (!isTradeGraphEnabled()) {
      throw new ValidationError('Trade Graph is disabled (DIASPORA_TRADE_GRAPH is OFF)');
    }
    if (!tenantId || !isUuid(String(tenantId))) {
      throw new ValidationError('A uuid tenantId is required (server-derived, never client-supplied)');
    }
    const pgClient = context.pgClient;
    if (!pgClient || typeof pgClient.query !== 'function') {
      throw new ValidationError('A pgClient with a query() method is required');
    }
    const userContext = requireUserContext(context.userContext || {});
    if (!this.#canAccessTenant(userContext, tenantId)) {
      throw new ForbiddenError('Not authorized to read intelligence for this tenant');
    }
    return { pgClient, userContext, now: context.now || new Date().toISOString() };
  }

  #canAccessTenant(userContext, tenantId) {
    return isPlatformAdmin(userContext)
      || isPlatformReviewer(userContext)
      || (userContext.tenantId && normalizeId(userContext.tenantId) === normalizeId(tenantId));
  }

  async #nodesOfType(pgClient, tenantId, nodeType) {
    const res = await pgClient.query(
      `SELECT * FROM trade_graph_nodes
        WHERE tenant_id = $1 AND node_type = $2 AND is_current IS TRUE AND deleted_at IS NULL
        ORDER BY created_at ASC, id ASC
        LIMIT $3`,
      [tenantId, nodeType, this.scanLimit],
    );
    return res.rows || [];
  }

  async #getNodeByEntity(pgClient, tenantId, nodeType, entityId) {
    const res = await pgClient.query(
      `SELECT * FROM trade_graph_nodes
        WHERE tenant_id = $1 AND node_type = $2 AND entity_id = $3
          AND is_current IS TRUE AND deleted_at IS NULL
        LIMIT 1`,
      [tenantId, nodeType, entityId],
    );
    return (res.rows && res.rows[0]) || null;
  }

  async #hasOutboundEdge(pgClient, tenantId, sourceNodeId, edgeType, now = null) {
    const hops = await this.#oneHop(pgClient, tenantId, sourceNodeId, /* includeIncoming */ false, now);
    return hops.some((h) => h.edge_type === edgeType);
  }

  // FIX 1/2: the neighbor node is re-asserted to the CALLER tenant (AND n.tenant_id = $1) on BOTH the
  // outbound and inbound JOIN. Because reads run on a service-role pool that BYPASSES RLS (see the
  // class-level note), this app-layer tenant filter is the PRIMARY isolation boundary — a planted
  // cross-tenant edge can never surface a foreign-tenant neighbor.
  async #oneHop(pgClient, tenantId, nodeId, includeIncoming, now = null) {
    const out = await pgClient.query(
      `SELECT e.id AS edge_id, e.edge_type, e.confidence AS edge_confidence, e.metadata AS edge_metadata,
              e.source_event_ref, e.valid_from, e.valid_until,
              n.id AS neighbor_id, n.node_type AS neighbor_type, n.entity_id AS neighbor_entity_id,
              n.data AS neighbor_data, n.confidence AS neighbor_confidence, n.created_at AS neighbor_created_at
         FROM trade_graph_edges e
         JOIN trade_graph_nodes n ON n.id = e.target_node_id AND n.tenant_id = $1
        WHERE e.tenant_id = $1 AND e.source_node_id = $2 AND e.deleted_at IS NULL
          AND n.is_current IS TRUE AND n.deleted_at IS NULL
        ORDER BY e.confidence DESC, e.id ASC`,
      [tenantId, nodeId],
    );
    const rows = (out.rows || []).slice();
    if (includeIncoming) {
      const inc = await pgClient.query(
        `SELECT e.id AS edge_id, e.edge_type, e.confidence AS edge_confidence, e.metadata AS edge_metadata,
                e.source_event_ref, e.valid_from, e.valid_until,
                n.id AS neighbor_id, n.node_type AS neighbor_type, n.entity_id AS neighbor_entity_id,
                n.data AS neighbor_data, n.confidence AS neighbor_confidence, n.created_at AS neighbor_created_at
           FROM trade_graph_edges e
           JOIN trade_graph_nodes n ON n.id = e.source_node_id AND n.tenant_id = $1
          WHERE e.tenant_id = $1 AND e.target_node_id = $2 AND e.deleted_at IS NULL
            AND n.is_current IS TRUE AND n.deleted_at IS NULL
          ORDER BY e.confidence DESC, e.id ASC`,
        [tenantId, nodeId],
      );
      rows.push(...(inc.rows || []));
    }
    return rows.filter((r) => edgeTemporallyValid(r, now)).map(normalizeHop);
  }

  #metric(name, count, start) {
    if (this.metricsHub && typeof this.metricsHub.recordIntelligenceQuery === 'function') {
      try { this.metricsHub.recordIntelligenceQuery(name, count, Date.now() - start); } catch { /* best-effort */ }
    }
  }
}

// ── Blocker/risk rules (status → severity) ───────────────────────────────────
const RISK_RULES = Object.freeze({
  COMPLIANCE_REVIEW: { type: 'compliance', statuses: { FAILED: 'HIGH', REJECTED: 'HIGH', PENDING: 'MEDIUM', REQUIRES_REVIEW: 'MEDIUM' } },
  DOCUMENT: { type: 'document', statusField: 'verification_status', statuses: { FAILED: 'HIGH', REJECTED: 'HIGH', REQUIRES_REVIEW: 'MEDIUM', PENDING: 'MEDIUM' } },
  PAYMENT_MILESTONE: { type: 'payment', statuses: { OVERDUE: 'CRITICAL', DUE: 'HIGH', FAILED: 'CRITICAL' } },
  SAFETRADE_TRANSACTION: { type: 'safetrade', statuses: { BLOCKED: 'HIGH', RELEASE_PENDING: 'HIGH', DISPUTED: 'CRITICAL', ESCROW_HELD: 'MEDIUM' } },
  SAFETRADE_DISPUTE: { type: 'safetrade_dispute', statuses: { OPEN: 'CRITICAL', PENDING: 'HIGH', UNDER_REVIEW: 'HIGH' } },
  REPUTATION_RECORD: { type: 'reputation', statusField: 'verification_status', statuses: { FLAGGED: 'HIGH', DISPUTED: 'MEDIUM' } },
});

const SEVERITY_RANK = Object.freeze({ CRITICAL: 3, HIGH: 2, MEDIUM: 1, LOW: 0 });

function deriveRiskLevel(blockers) {
  if (!blockers.length) return 'LOW';
  const top = Math.max(...blockers.map((b) => SEVERITY_RANK[b.severity] || 0));
  if (top >= 3 || blockers.length > 2) return 'HIGH';
  if (top >= 1) return 'MEDIUM';
  return 'LOW';
}

// ── pure helpers ─────────────────────────────────────────────────────────────

/** Temporal-validity predicate: an edge is live at `now` when valid_from<=now<valid_until (or open). */
function edgeTemporallyValid(r, now) {
  if (!now) return true;
  const t = new Date(now).getTime();
  if (r.valid_from != null && new Date(r.valid_from).getTime() > t) return false;
  if (r.valid_until != null && new Date(r.valid_until).getTime() <= t) return false;
  return true;
}

function normalizeHop(r) {
  return {
    edge_id: r.edge_id,
    edge_type: r.edge_type,
    edge_confidence: numOr(r.edge_confidence, 1),
    edge_metadata: r.edge_metadata || {},
    source_event_ref: r.source_event_ref || null,
    direction: r.direction || 'out',
    neighbor_id: r.neighbor_id,
    neighbor_type: r.neighbor_type,
    neighbor_entity_id: r.neighbor_entity_id,
    neighbor_data: r.neighbor_data || {},
    neighbor_confidence: numOr(r.neighbor_confidence, 1),
    neighbor_created_at: r.neighbor_created_at,
  };
}

function sameGeo(container, order) {
  return container.data?.origin_country != null
    && container.data?.origin_country === order.data?.origin_country
    && container.data?.destination_country === order.data?.destination_country;
}

// Region coarsening (FIX 7): emit a REGION TOKEN ('[REGION]:XX'), never the raw value prefix. Uses the
// shared regionToken() helper so container origin/destination coarsening matches node/edge data redaction.
function regionOf(value) {
  return regionToken(value);
}

function dedupe(arr) {
  return Array.from(new Set(arr.map((v) => String(v))));
}

function numOr(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

function cmpStr(a, b) {
  const sa = a == null ? '' : String(a);
  const sb = b == null ? '' : String(b);
  if (sa === sb) return 0;
  return sa < sb ? -1 : 1;
}

function clampInt(v, min, max, fallback) {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

// Singleton (pure constructor; no import-time side effects).
export const diasporaTradeIntelligence = new DiasporaTradeIntelligenceService();
