/**
 * Phase 10 — Trade Graph EXPLAINABLE QUERY SERVICE (Stage 3).
 *
 * Read-only traversals over the DERIVED graph (trade_graph_nodes / trade_graph_edges) that answer
 * the directive §57 explainability questions:
 *
 *   1. queryNeighborhood(tenantId, nodeId)            — "what is the trade context around X?"
 *   2. queryTransactionPath(tenantId, buyerOrderId)   — "what is the complete order→delivery path?"
 *   3. generateMatchExplanation(tenantId, orderId, sellerId) — "why was seller X matched to order Y?"
 *   4. generateBlockerSummary(tenantId, buyerOrderId) — "what blocks this order / SafeTrade release?"
 *   5. queryEvidenceChain(tenantId, nodeType, entityId) — "what documents/records support this?"
 *
 * NON-NEGOTIABLE properties (proven by the Stage 3 tests):
 *   - DERIVED + READ-ONLY — this service NEVER writes nodes/edges/state. The graph is authored only by
 *     the projection service from domain events; queries here only SELECT. (No AI/frontend write path.)
 *   - TENANT-SCOPED — every SELECT filters by tenant_id taken from the caller's server-derived context;
 *     no cross-tenant traversal is possible (an edge endpoint in another tenant is simply not returned).
 *     SERVICE-ROLE CONNECTION + APP-LAYER-PRIMARY ISOLATION (FIX 2): these reads run on a service-role pg
 *     pool (DATABASE_URL/SUPABASE_DB_URL) that BYPASSES RLS — exactly like the eventWorker — so RLS is only
 *     defense-in-depth. The PRIMARY isolation boundary is THIS APP LAYER: every node/edge SELECT filters by
 *     the caller tenant_id and re-asserts n.tenant_id on edge-endpoint JOINs (#oneHop), so a planted
 *     cross-tenant edge can never surface a foreign-tenant node.
 *   - REDACTED — node.data (and any edge.metadata) leaving this service is passed through the SAME role-aware
 *     redaction policy the intelligence service uses (FIX 6), keyed by the caller's server-derived role.
 *   - BOUNDED + RECURSION-SAFE — traversals are breadth-first with a hard maxDepth/maxSteps cap and a
 *     visited-set so a cyclic graph can never loop forever; result sets are LIMIT-capped.
 *   - EXPLAINABLE — EVERY result carries `sourceReferences` (the domain_events.id(s) that produced each
 *     edge, plus node entity ids) and `reasons` (the edge types + confidences that justify the answer).
 *   - DETERMINISTIC — identical inputs yield identical output: ordering is total (confidence DESC then a
 *     stable id tiebreaker), only current/non-deleted rows are read, confidence weighting is multiplicative.
 *   - GATED — fail-closed behind isTradeGraphEnabled() (env DIASPORA_TRADE_GRAPH, default OFF).
 *
 * Storage abstraction: like the projection service, queries run through a thin raw pg-like client
 * (`pgClient.query(sql, params) => { rows }`), so the service is unit-testable with the same in-memory
 * mock (helpers/diasporaTradeGraphRpcReference.js) — no DB, no network. The recursion is expressed in
 * JS over single-hop SQL rather than one giant recursive CTE, which keeps it framework-neutral, exactly
 * mirrorable in the mock, and identical in behavior to the bounded recursive CTE in the design doc.
 *
 * Performance: heavy dashboard reads are served from precomputed materialized summaries
 * (trade_graph_materialized_summaries) when present — see getNodeSummary() — so depth-N fan-outs on
 * large tenants don't re-traverse the whole neighborhood on every request. The traversals themselves
 * are confidence-thresholded + LIMIT-bounded to stay within the §57 latency budget.
 */

import {
  TRADE_GRAPH_NODE_TYPES,
  isTradeGraphEnabled,
} from '../../../constants/diaspora/diasporaTradeGraphConstants.js';
// FIX 6: the SAME role-aware redaction the intelligence service uses, applied to ALL node.data and
// edge.metadata leaving this query service (center + neighbors + path + blocker + match + evidence).
// FIX B: participantReference() / callerMaySeeParticipantIds() keep raw participant ids (seller_id, …)
// out of every human-readable reason/explanation/blocker string for non-admin callers.
import {
  redactData,
  redactMetadata,
  participantReference,
  callerMaySeeParticipantIds,
  surfaceEntityId,
} from './diasporaTradeGraphRedaction.js';
import { appendBestEffortAudit, resolveClient } from '../diasporaServiceUtils.js';
import { ValidationError, NotFoundError } from '../../../utils/errors.js';
import { logger } from '../../../utils/logger.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

// Canonical "forward" edges that make up an order → delivery transaction path.
const TRANSACTION_PATH_EDGE_TYPES = Object.freeze([
  'ACCEPTED_QUOTE', 'SUPPLIES', 'FULFILLS_ORDER', 'RESERVES_CONTAINER', 'DOCUMENTS', 'CONDUCTS_TRANSACTION',
]);

// Statuses (per node type) that constitute an active blocker on an order. Mirrors design §1.4.
const BLOCKER_RULES = Object.freeze({
  COMPLIANCE_REVIEW: {
    type: 'COMPLIANCE_FAILURE',
    statuses: { FAILED: 'HIGH', REJECTED: 'HIGH', PENDING: 'MEDIUM', REQUIRES_REVIEW: 'MEDIUM' },
  },
  DOCUMENT: {
    type: 'DOCUMENT_FAILURE',
    statusField: 'verification_status',
    statuses: { FAILED: 'HIGH', REJECTED: 'HIGH', REQUIRES_REVIEW: 'MEDIUM', PENDING: 'MEDIUM' },
  },
  PAYMENT_MILESTONE: {
    type: 'PAYMENT_OVERDUE',
    statuses: { OVERDUE: 'CRITICAL', DUE: 'HIGH', FAILED: 'CRITICAL' },
  },
  SAFETRADE_TRANSACTION: {
    type: 'SAFETRADE_BLOCKED',
    statuses: { BLOCKED: 'HIGH', RELEASE_PENDING: 'HIGH', DISPUTED: 'CRITICAL', ESCROW_HELD: 'MEDIUM' },
  },
  SAFETRADE_DISPUTE: {
    type: 'SAFETRADE_DISPUTE',
    statuses: { OPEN: 'CRITICAL', PENDING: 'HIGH', UNDER_REVIEW: 'HIGH' },
  },
});

const SEVERITY_RANK = Object.freeze({ CRITICAL: 3, HIGH: 2, MEDIUM: 1, LOW: 0 });

export class DiasporaTradeGraphService {
  /**
   * @param {object} [deps]
   *   @param {object} [deps.metricsHub] - shared metrics hub (reused only if present; never edited)
   *   @param {number} [deps.maxDepth=3]  - default neighborhood traversal depth
   *   @param {number} [deps.maxSteps=12] - hard cap for transaction-path / match recursion
   *   @param {number} [deps.resultLimit=1000] - hard cap on returned rows
   */
  constructor(deps = {}) {
    this.metricsHub = deps.metricsHub || null;
    this.maxDepth = Number.isFinite(deps.maxDepth) ? deps.maxDepth : 3;
    this.maxSteps = Number.isFinite(deps.maxSteps) ? deps.maxSteps : 12;
    this.resultLimit = Number.isFinite(deps.resultLimit) ? deps.resultLimit : 1000;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Neighborhood — direct + N-hop neighbors with explanations
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * @param {string} tenantId
   * @param {string} nodeId - trade_graph_nodes.id (uuid)
   * @param {object} context - { pgClient, userContext?, now?, auditClient?, req? }
   * @param {object} [options] - { maxDepth, minConfidence=0.5, includeIncoming=true, limit }
   * @returns {Promise<object>} { centerNode, neighbors[], totalCount, deterministic:true }
   */
  async queryNeighborhood(tenantId, nodeId, context = {}, options = {}) {
    const { pgClient, now, userContext } = this.#requireReadContext(tenantId, context);
    if (!nodeId || !isUuid(String(nodeId))) {
      throw new ValidationError('queryNeighborhood requires a uuid nodeId (trade_graph_nodes.id)');
    }
    const maxDepth = clampInt(options.maxDepth, 1, this.maxDepth, this.maxDepth);
    const minConfidence = clampNum(options.minConfidence, 0, 1, 0.5);
    const includeIncoming = options.includeIncoming !== false;
    const limit = clampInt(options.limit, 1, this.resultLimit, this.resultLimit);
    const start = Date.now();

    const center = await this.#getNodeById(pgClient, tenantId, nodeId);
    if (!center) throw new NotFoundError(`Graph node not found in tenant: ${nodeId}`);

    // Breadth-first, bounded, visited-guarded traversal. combinedConfidence = product of edge
    // confidences along the path (multiplicative => stable + monotonically non-increasing => the
    // minConfidence threshold also bounds depth in practice).
    const visited = new Set([String(center.id)]);
    const neighbors = [];
    let frontier = [{ id: center.id, confidence: 1, path: [] }];

    for (let depth = 1; depth <= maxDepth && frontier.length && neighbors.length < limit; depth += 1) {
      const next = [];
      for (const node of frontier) {
        const hops = await this.#oneHop(pgClient, tenantId, node.id, includeIncoming, now);
        for (const hop of hops) {
          const combined = round4(node.confidence * hop.edge_confidence);
          if (combined < minConfidence) continue;
          const reasonStep = {
            from_node_id: node.id,
            edge_id: hop.edge_id,
            edge_type: hop.edge_type,
            direction: hop.direction,
            edge_confidence: hop.edge_confidence,
            source_event_ref: hop.source_event_ref,
          };
          const path = node.path.concat([reasonStep]);
          if (!visited.has(String(hop.neighbor_id))) {
            visited.add(String(hop.neighbor_id));
            neighbors.push({
              nodeId: hop.neighbor_id,
              nodeType: hop.neighbor_type,
              // FIX D: tokenize a participant neighbor's surfaced entityId (raw person/profile id) for
              // non-admins/AI; the structural neighbor nodeId (uuid) stays intact for traversal.
              entityId: surfaceEntityId(hop.neighbor_type, hop.neighbor_entity_id, userContext),
              data: redactData(hop.neighbor_data, userContext), // FIX 6: role-aware node.data redaction
              edgeMetadata: redactMetadata(hop.edge_metadata, userContext), // FIX 6: role-aware edge.metadata redaction
              depth,
              relationshipType: hop.edge_type,
              direction: hop.direction,
              combinedConfidence: combined,
              viaEdgeId: hop.edge_id,
              reasons: path,
              sourceReferences: collectSourceRefs(path),
            });
            next.push({ id: hop.neighbor_id, confidence: combined, path });
            if (neighbors.length >= limit) break;
          }
        }
        if (neighbors.length >= limit) break;
      }
      frontier = next;
    }

    // Total order: depth ASC, then combinedConfidence DESC, then a stable id tiebreaker.
    neighbors.sort((a, b) =>
      a.depth - b.depth
      || b.combinedConfidence - a.combinedConfidence
      || (String(a.nodeId) < String(b.nodeId) ? -1 : 1));

    await this.#audit(context, tenantId, 'TRADE_GRAPH_NEIGHBORHOOD_QUERIED', nodeId, { maxDepth, minConfidence });
    this.#metric('neighborhood', neighbors.length, start);

    return {
      centerNode: shapeNode(center, userContext),
      neighbors,
      totalCount: neighbors.length,
      maxDepth,
      minConfidence,
      deterministic: true,
      queryTimeMs: Date.now() - start,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Transaction path — order → quote → stock → shipment/container/transaction
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Deterministic longest forward path from a BUYER_ORDER following canonical transaction edges.
   * @param {string} tenantId
   * @param {string} buyerOrderId - BUYER_ORDER node id (uuid)
   * @param {object} context - { pgClient, ... }
   * @param {object} [options] - { targetNodeType='SHIPMENT', maxSteps }
   * @returns {Promise<object>} { buyerOrderId, orderedSteps[], finalNodeType, totalSteps, complete, sourceReferences[] }
   */
  async queryTransactionPath(tenantId, buyerOrderId, context = {}, options = {}) {
    const { pgClient, now, userContext } = this.#requireReadContext(tenantId, context);
    if (!buyerOrderId || !isUuid(String(buyerOrderId))) {
      throw new ValidationError('queryTransactionPath requires a uuid buyerOrderId (node id)');
    }
    const targetNodeType = options.targetNodeType || TRADE_GRAPH_NODE_TYPES.SHIPMENT;
    const maxSteps = clampInt(options.maxSteps, 1, this.maxSteps, this.maxSteps);
    const start = Date.now();

    const order = await this.#getNodeById(pgClient, tenantId, buyerOrderId);
    if (!order || order.node_type !== TRADE_GRAPH_NODE_TYPES.BUYER_ORDER) {
      throw new NotFoundError(`BUYER_ORDER node not found in tenant: ${buyerOrderId}`);
    }

    // Greedy-but-deterministic forward walk: at each node take the highest-confidence canonical
    // forward edge to an unvisited node. The one-hop SELECT is ordered (confidence DESC, id) so the
    // chosen edge is deterministic. The visited-set guarantees termination.
    const visited = new Set([String(order.id)]);
    const steps = [{
      step: 0,
      nodeId: order.id,
      nodeType: order.node_type,
      entityId: surfaceEntityId(order.node_type, order.entity_id, userContext), // FIX D
      status: order.data?.status ?? null,
      confidence: numOr(order.confidence, 1),
      createdAt: order.created_at,
      edgeType: null,
      sourceEventRef: null,
    }];
    const sourceReferences = [];

    let current = order;
    let targetReached = order.node_type === targetNodeType;
    for (let step = 1; step <= maxSteps; step += 1) {
      const hops = (await this.#oneHop(pgClient, tenantId, current.id, /* includeIncoming */ false, now))
        .filter((h) => TRANSACTION_PATH_EDGE_TYPES.includes(h.edge_type) && !visited.has(String(h.neighbor_id)));
      if (!hops.length) break;
      const hop = hops[0]; // already ordered confidence DESC, id ASC → deterministic
      visited.add(String(hop.neighbor_id));
      if (hop.source_event_ref) sourceReferences.push(hop.source_event_ref);
      steps.push({
        step,
        nodeId: hop.neighbor_id,
        nodeType: hop.neighbor_type,
        entityId: surfaceEntityId(hop.neighbor_type, hop.neighbor_entity_id, userContext), // FIX D
        status: hop.neighbor_data?.status ?? null,
        confidence: hop.neighbor_confidence,
        createdAt: hop.neighbor_created_at,
        edgeType: hop.edge_type,
        edgeConfidence: hop.edge_confidence,
        sourceEventRef: hop.source_event_ref,
        reason: `${current.node_type} —[${hop.edge_type}]→ ${hop.neighbor_type}`,
      });
      current = {
        id: hop.neighbor_id, node_type: hop.neighbor_type, entity_id: hop.neighbor_entity_id,
        data: hop.neighbor_data, confidence: hop.neighbor_confidence, created_at: hop.neighbor_created_at,
      };
      if (hop.neighbor_type === targetNodeType) { targetReached = true; break; }
    }

    await this.#audit(context, tenantId, 'TRADE_GRAPH_PATH_QUERIED', buyerOrderId, { targetNodeType, steps: steps.length - 1 });
    this.#metric('transaction_path', steps.length, start);

    return {
      buyerOrderId,
      orderedSteps: steps,
      pathIds: steps.map((s) => s.nodeId),
      finalNodeType: current.node_type,
      finalEntityId: surfaceEntityId(current.node_type, current.entity_id, userContext), // FIX D
      totalSteps: steps.length - 1,
      complete: targetReached,
      targetNodeType,
      sourceReferences: dedupe(sourceReferences),
      deterministic: true,
      queryTimeMs: Date.now() - start,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Match explanation — why seller matched order (order→accepted quote→stock→seller)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * @param {string} tenantId
   * @param {string} buyerOrderId - BUYER_ORDER node id (uuid)
   * @param {string} sellerId - seller user/profile id (matched against quote/stock attributes)
   * @param {object} context - { pgClient, ... }
   * @returns {Promise<object>} { matchFound, confidence, matchPath[], supportingDocuments[], blockers[], reasons[], sourceReferences[] }
   */
  async generateMatchExplanation(tenantId, buyerOrderId, sellerId, context = {}) {
    const { pgClient, now, userContext } = this.#requireReadContext(tenantId, context);
    if (!buyerOrderId || !isUuid(String(buyerOrderId))) {
      throw new ValidationError('generateMatchExplanation requires a uuid buyerOrderId (node id)');
    }
    if (sellerId == null || String(sellerId) === '') {
      throw new ValidationError('generateMatchExplanation requires a sellerId');
    }
    const sellerKey = String(sellerId);
    const start = Date.now();

    const order = await this.#getNodeById(pgClient, tenantId, buyerOrderId);
    if (!order || order.node_type !== TRADE_GRAPH_NODE_TYPES.BUYER_ORDER) {
      throw new NotFoundError(`BUYER_ORDER node not found in tenant: ${buyerOrderId}`);
    }

    // Order → accepted quotes → stock items, keeping only paths whose quote/stock references the seller.
    const matchPath = [nodeSummary(order, 1, userContext)];
    const reasons = [];
    const sourceReferences = [];
    let confidenceProduct = numOr(order.confidence, 1);
    let matchFound = false;

    const quoteHops = (await this.#oneHop(pgClient, tenantId, order.id, false, now))
      .filter((h) => h.edge_type === 'ACCEPTED_QUOTE'
        && [TRADE_GRAPH_NODE_TYPES.ACCEPTED_QUOTE, TRADE_GRAPH_NODE_TYPES.RFQ].includes(h.neighbor_type));

    for (const qh of quoteHops) {
      const quoteSeller = String(qh.neighbor_data?.seller_id ?? '');
      if (quoteSeller && quoteSeller !== sellerKey) continue;
      matchFound = true;
      confidenceProduct = round4(confidenceProduct * qh.edge_confidence);
      if (qh.source_event_ref) sourceReferences.push(qh.source_event_ref);
      matchPath.push(nodeSummaryFromHop(qh, userContext));
      reasons.push({
        from: order.node_type, edge: qh.edge_type, to: qh.neighbor_type,
        edgeConfidence: qh.edge_confidence, sourceEventRef: qh.source_event_ref,
        // FIX B: NEVER interpolate a raw participant id (seller_id) into the human-readable detail.
        // The quote's structural entity id is a queryable node key (safe); the seller is referenced
        // through participantReference() so non-admins/AI get "seller [REDACTED]" while admin/reviewer
        // gets the raw id.
        detail: `order accepted quote ${qh.neighbor_entity_id} (${participantReference('seller', quoteSeller || null, userContext)})`,
      });
      // quote → supplies → stock items
      const stockHops = (await this.#oneHop(pgClient, tenantId, qh.neighbor_id, false, now))
        .filter((h) => h.edge_type === 'SUPPLIES' && h.neighbor_type === TRADE_GRAPH_NODE_TYPES.SELLER_STOCK_ITEM);
      for (const sh of stockHops) {
        if (sh.source_event_ref) sourceReferences.push(sh.source_event_ref);
        matchPath.push(nodeSummaryFromHop(sh, userContext));
        reasons.push({
          from: qh.neighbor_type, edge: sh.edge_type, to: sh.neighbor_type,
          edgeConfidence: sh.edge_confidence, sourceEventRef: sh.source_event_ref,
          detail: `quote supplied by stock item ${sh.neighbor_entity_id}`,
        });
      }
      break; // top deterministic quote path is sufficient for the explanation
    }

    const supportingDocuments = await this.#orderDocuments(pgClient, tenantId, order.id, now);
    const blockers = await this.generateBlockerSummary(tenantId, buyerOrderId, context, { _internal: true });

    await this.#audit(context, tenantId, 'TRADE_GRAPH_MATCH_EXPLAINED', buyerOrderId, { sellerId: sellerKey, matchFound });
    this.#metric('match_explanation', matchFound ? 1 : 0, start);

    if (!matchFound) {
      return {
        buyerOrderId,
        sellerId: sellerKey,
        matchFound: false,
        reason: 'No accepted-quote path connects this order to the seller',
        confidence: 0,
        matchPath: [],
        supportingDocuments,
        blockers: blockers.blockers,
        reasons: [],
        sourceReferences: [],
        deterministic: true,
        queryTimeMs: Date.now() - start,
      };
    }

    return {
      buyerOrderId,
      sellerId: sellerKey,
      matchFound: true,
      confidence: confidenceProduct,
      matchPath,
      explanation: matchPath.map((p) => `${p.nodeType}(${shortId(p.entityId)})`).join(' → '),
      supportingDocuments,
      blockers: blockers.blockers,
      reasons,
      sourceReferences: dedupe(sourceReferences),
      deterministic: true,
      queryTimeMs: Date.now() - start,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Blocker summary — what blocks this order / SafeTrade release
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * @param {string} tenantId
   * @param {string} buyerOrderId - BUYER_ORDER node id (uuid)
   * @param {object} context - { pgClient, ... }
   * @returns {Promise<object>} { orderId, blockers[], hasBlockers, criticalCount, highCount, mediumCount, mostSevereBlocker }
   */
  async generateBlockerSummary(tenantId, buyerOrderId, context = {}, options = {}) {
    const { pgClient, now, userContext } = this.#requireReadContext(tenantId, context);
    if (!buyerOrderId || !isUuid(String(buyerOrderId))) {
      throw new ValidationError('generateBlockerSummary requires a uuid buyerOrderId (node id)');
    }
    const start = Date.now();

    const order = await this.#getNodeById(pgClient, tenantId, buyerOrderId);
    if (!order || order.node_type !== TRADE_GRAPH_NODE_TYPES.BUYER_ORDER) {
      throw new NotFoundError(`BUYER_ORDER node not found in tenant: ${buyerOrderId}`);
    }

    // Examine the order's neighborhood (both directions) for nodes whose status is an active blocker.
    const hops = await this.#oneHop(pgClient, tenantId, order.id, /* includeIncoming */ true, now);
    const blockers = [];
    for (const hop of hops) {
      const rule = BLOCKER_RULES[hop.neighbor_type];
      if (!rule) continue;
      const statusField = rule.statusField || 'status';
      const status = String(hop.neighbor_data?.[statusField] ?? '').toUpperCase();
      const severity = rule.statuses[status];
      if (!severity) continue;
      // FIX D: surface the blocker entity's id through the participant-aware tokenizer. Blocker node
      // types are non-participant (compliance/document/payment/safetrade), so this is raw in practice,
      // but routing it through surfaceEntityId guarantees no participant id is ever echoed into a reason.
      const surfacedBlockerId = surfaceEntityId(hop.neighbor_type, hop.neighbor_entity_id, userContext);
      blockers.push({
        type: rule.type,
        severity,
        detail: status,
        sourceEntityType: hop.neighbor_type,
        sourceEntityId: surfacedBlockerId,
        viaEdgeId: hop.edge_id,
        edgeType: hop.edge_type,
        sourceEventRef: hop.source_event_ref,
        reason: `${hop.neighbor_type} ${surfacedBlockerId} is ${status}`,
        resolvedAt: null,
      });
    }

    // Deterministic ordering: severity DESC, then stable id tiebreaker.
    blockers.sort((a, b) =>
      (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0)
      || (String(a.sourceEntityId) < String(b.sourceEntityId) ? -1 : 1));

    const counts = blockers.reduce((acc, b) => { acc[b.severity] = (acc[b.severity] || 0) + 1; return acc; }, {});

    if (!options._internal) {
      await this.#audit(context, tenantId, 'TRADE_GRAPH_BLOCKERS_QUERIED', buyerOrderId, { count: blockers.length });
      this.#metric('blocker_summary', blockers.length, start);
    }

    return {
      orderId: buyerOrderId,
      orderEntityId: surfaceEntityId(order.node_type, order.entity_id, userContext), // FIX D
      blockers,
      hasBlockers: blockers.length > 0,
      criticalCount: counts.CRITICAL || 0,
      highCount: counts.HIGH || 0,
      mediumCount: counts.MEDIUM || 0,
      mostSevereBlocker: blockers[0] || null,
      sourceReferences: dedupe(blockers.map((b) => b.sourceEventRef).filter(Boolean)),
      deterministic: true,
      queryTimeMs: Date.now() - start,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Evidence chain — documents + compliance + domain events supporting an entity
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * @param {string} tenantId
   * @param {string} nodeType - e.g. 'BUYER_ORDER'
   * @param {string} entityId - the authoritative entity id (text; trade_graph_nodes.entity_id)
   * @param {object} context - { pgClient, ... }
   * @returns {Promise<object>} { entity, documents[], complianceRecords[], domainEvents[], chain[], totalEvidence }
   */
  async queryEvidenceChain(tenantId, nodeType, entityId, context = {}) {
    const { pgClient, now, userContext } = this.#requireReadContext(tenantId, context);
    if (!nodeType || !Object.values(TRADE_GRAPH_NODE_TYPES).includes(nodeType)) {
      throw new ValidationError(`queryEvidenceChain requires a known nodeType, got: ${nodeType}`);
    }
    if (entityId == null || String(entityId) === '') {
      throw new ValidationError('queryEvidenceChain requires an entityId');
    }
    const start = Date.now();

    const entity = await this.#getNodeByEntity(pgClient, tenantId, nodeType, String(entityId));
    if (!entity) throw new NotFoundError(`Graph entity not found: ${nodeType}/${entityId}`);

    const hops = await this.#oneHop(pgClient, tenantId, entity.id, /* includeIncoming */ true, now);
    const documents = [];
    const complianceRecords = [];
    for (const hop of hops) {
      if (hop.neighbor_type === TRADE_GRAPH_NODE_TYPES.DOCUMENT && hop.edge_type === 'DOCUMENTS') {
        documents.push(evidenceItem('DOCUMENT', hop, userContext));
      } else if (hop.neighbor_type === TRADE_GRAPH_NODE_TYPES.COMPLIANCE_REVIEW && hop.edge_type === 'REVIEWS_COMPLIANCE') {
        complianceRecords.push(evidenceItem('COMPLIANCE', hop, userContext));
      }
    }

    // Domain events are the source of truth: events whose payload references this entity id.
    const eventRows = await this.#evidenceEvents(pgClient, tenantId, String(entityId));
    const domainEvents = eventRows.map((e) => ({
      evidenceType: 'EVENT',
      id: e.id,
      eventType: e.event_type,
      createdAt: e.created_at,
      summary: `Domain event: ${e.event_type}`,
    }));

    const surfacedEntityId = surfaceEntityId(entity.node_type, entity.entity_id, userContext); // FIX D
    const chain = [
      { evidenceType: 'ENTITY', id: entity.id, entityId: surfacedEntityId, nodeType: entity.node_type, createdAt: entity.created_at, summary: `${entity.node_type} ${surfacedEntityId}` },
      ...documents,
      ...complianceRecords,
      ...domainEvents,
    ].sort((a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      || (String(a.id) < String(b.id) ? -1 : 1));

    await this.#audit(context, tenantId, 'TRADE_GRAPH_EVIDENCE_QUERIED', String(entityId), { nodeType, total: chain.length });
    this.#metric('evidence_chain', chain.length, start);

    return {
      entity: shapeNode(entity, userContext),
      documents,
      complianceRecords,
      domainEvents,
      chain,
      totalEvidence: chain.length,
      sourceReferences: dedupe(domainEvents.map((e) => e.id)),
      deterministic: true,
      queryTimeMs: Date.now() - start,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Performance: precomputed summary read for heavy dashboards
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Read a precomputed materialized summary for a node if a fresh one exists (avoids re-traversing
   * a large neighborhood on every dashboard request). Returns null when no fresh summary is present;
   * callers fall back to the live traversal above.
   */
  async getNodeSummary(tenantId, nodeId, context = {}, summaryType = 'neighborhood') {
    const { pgClient } = this.#requireReadContext(tenantId, context);
    if (!nodeId || !isUuid(String(nodeId))) {
      throw new ValidationError('getNodeSummary requires a uuid nodeId');
    }
    const now = context.now || new Date().toISOString();
    const res = await pgClient.query(
      `SELECT in_degree, out_degree, highest_confidence_neighbors, path_metrics, aggregated_reputation, last_computed_at, valid_until
         FROM trade_graph_materialized_summaries
        WHERE tenant_id = $1 AND node_id = $2 AND summary_type = $3
          AND (valid_until IS NULL OR valid_until > $4)
        ORDER BY last_computed_at DESC
        LIMIT 1`,
      [tenantId, nodeId, summaryType, now],
    );
    const row = res.rows && res.rows[0];
    if (!row) return null;
    return {
      nodeId,
      summaryType,
      inDegree: row.in_degree,
      outDegree: row.out_degree,
      highestConfidenceNeighbors: row.highest_confidence_neighbors || [],
      pathMetrics: row.path_metrics || {},
      aggregatedReputation: row.aggregated_reputation ?? null,
      lastComputedAt: row.last_computed_at,
      validUntil: row.valid_until ?? null,
      fromCache: true,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internal read helpers (parameterized SQL; tenant-scoped; current/non-deleted only)
  // ───────────────────────────────────────────────────────────────────────────

  #requireReadContext(tenantId, context) {
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
    // `now` is injected (fixed ISO) for deterministic temporal-edge filtering + freshness stamps;
    // only fall back to wall-clock when a caller omits it (never used for stored values).
    const now = context.now || new Date().toISOString();
    // userContext is server-derived; it keys the role-aware redaction (FIX 6) of every node.data /
    // edge.metadata leaving this service. Absent (e.g. internal callers) → treated as a non-admin.
    const userContext = context.userContext || {};
    return { pgClient, now, userContext };
  }

  async #getNodeById(pgClient, tenantId, nodeId) {
    const res = await pgClient.query(
      `SELECT * FROM trade_graph_nodes
        WHERE tenant_id = $1 AND id = $2 AND is_current IS TRUE AND deleted_at IS NULL
        LIMIT 1`,
      [tenantId, nodeId],
    );
    return (res.rows && res.rows[0]) || null;
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

  /**
   * One-hop fan-out (outbound always; inbound when includeIncoming). Each row is edge+neighbor.
   * Temporal validity (design §C): edges whose [valid_from, valid_until) window does not contain `now`
   * are excluded, so revoked / time-bounded edges never appear in a traversal. The SQL stays stable
   * (filterable in the shim) and the temporal predicate is applied in JS over the returned valid_from/
   * valid_until — deterministic because `now` is the injected fixed timestamp.
   */
  async #oneHop(pgClient, tenantId, nodeId, includeIncoming, now = null) {
    // FIX 1/2: re-assert the neighbor's tenant (AND n.tenant_id = $1) on BOTH the outbound and inbound
    // edge-endpoint JOIN. Reads use a service-role pool that BYPASSES RLS (see the class-level note), so
    // this app-layer filter is the PRIMARY isolation boundary: a cross-tenant edge can never surface a
    // foreign-tenant neighbor here.
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

  async #orderDocuments(pgClient, tenantId, orderNodeId, now) {
    const hops = await this.#oneHop(pgClient, tenantId, orderNodeId, /* includeIncoming */ true, now);
    return hops
      .filter((h) => h.neighbor_type === TRADE_GRAPH_NODE_TYPES.DOCUMENT && h.edge_type === 'DOCUMENTS')
      .map((h) => ({
        docId: h.neighbor_entity_id,
        type: h.neighbor_data?.document_type ?? null,
        status: h.neighbor_data?.verification_status ?? null,
        sourceEventRef: h.source_event_ref,
      }));
  }

  async #evidenceEvents(pgClient, tenantId, entityId) {
    const res = await pgClient.query(
      `SELECT id, event_type, payload, created_at FROM domain_events
        WHERE tenant_id = $1 AND status IN ('processed','pending')
          AND ( payload->>'entity_id' = $2 OR payload->>'order_id' = $2 OR payload->>'stock_id' = $2 )
        ORDER BY created_at ASC, id ASC`,
      [tenantId, entityId],
    );
    return res.rows || [];
  }

  async #audit(context, tenantId, action, resourceId, metadata) {
    try {
      const auditClient = context.auditClient || (await resolveClient(context));
      await appendBestEffortAudit(auditClient, {
        actorId: context.userContext?.id ?? null,
        tenantId,
        action,
        resourceType: 'trade_graph_query',
        resourceId: resourceId != null ? String(resourceId) : tenantId,
        metadata: metadata || {},
        req: context.req || null,
      });
    } catch (err) {
      logger.warn('GRAPH', `Query audit failed (non-fatal): ${err.message}`, { action, tenantId });
    }
  }

  #metric(name, count, start) {
    if (this.metricsHub && typeof this.metricsHub.recordGraphQuery === 'function') {
      try { this.metricsHub.recordGraphQuery(name, count, Date.now() - start); } catch { /* best-effort */ }
    }
  }
}

// ── pure shaping/util helpers ────────────────────────────────────────────────

/**
 * Temporal-validity predicate for an edge row: the edge is live at `now` when valid_from <= now and
 * (valid_until is null or valid_until > now). When `now` is not supplied, no temporal filtering is
 * applied (callers always inject `now`). Deterministic — `now` is the fixed injected timestamp.
 */
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
    valid_from: r.valid_from || null,
    valid_until: r.valid_until || null,
    direction: r.direction || 'out',
    neighbor_id: r.neighbor_id,
    neighbor_type: r.neighbor_type,
    neighbor_entity_id: r.neighbor_entity_id,
    neighbor_data: r.neighbor_data || {},
    neighbor_confidence: numOr(r.neighbor_confidence, 1),
    neighbor_created_at: r.neighbor_created_at,
  };
}

function shapeNode(n, userContext) {
  return {
    nodeId: n.id,
    nodeType: n.node_type,
    // FIX D: for participant node types (BUYER/SELLER/USER/TRADE_PROFILE) the surfaced entity_id is a raw
    // person/profile id — tokenize it to a stable pseudonym for non-admins/AI; the nodeId UUID is intact.
    entityId: surfaceEntityId(n.node_type, n.entity_id, userContext),
    data: redactData(n.data || {}, userContext), // FIX 6: role-aware redaction of node.data
    confidence: numOr(n.confidence, 1),
    sourceEventRef: n.source_event_ref || null,
    createdAt: n.created_at,
  };
}

function nodeSummary(n, confidence, userContext) {
  return {
    nodeType: n.node_type,
    nodeId: n.id,
    entityId: surfaceEntityId(n.node_type, n.entity_id, userContext), // FIX D
    confidence: confidence ?? numOr(n.confidence, 1),
  };
}

function nodeSummaryFromHop(h, userContext) {
  return {
    nodeType: h.neighbor_type,
    nodeId: h.neighbor_id,
    entityId: surfaceEntityId(h.neighbor_type, h.neighbor_entity_id, userContext), // FIX D
    confidence: h.neighbor_confidence,
  };
}

function evidenceItem(evidenceType, hop, userContext) {
  return {
    evidenceType,
    id: hop.neighbor_id,
    entityId: surfaceEntityId(hop.neighbor_type, hop.neighbor_entity_id, userContext), // FIX D
    nodeType: hop.neighbor_type,
    status: hop.neighbor_data?.verification_status ?? hop.neighbor_data?.status ?? null,
    documentType: hop.neighbor_data?.document_type ?? null,
    sourceEventRef: hop.source_event_ref,
    createdAt: hop.neighbor_created_at,
    summary: evidenceType === 'DOCUMENT'
      ? `Document: ${hop.neighbor_data?.document_type ?? 'unknown'} (${hop.neighbor_data?.verification_status ?? 'unverified'})`
      : `Compliance review: ${hop.neighbor_data?.status ?? 'unknown'}`,
  };
}

function collectSourceRefs(path) {
  return dedupe(path.map((p) => p.source_event_ref).filter(Boolean));
}

function dedupe(arr) {
  return Array.from(new Set(arr.map((v) => String(v))));
}

function shortId(v) {
  return v == null ? '?' : String(v).slice(0, 8);
}

function numOr(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
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
export const diasporaTradeGraphService = new DiasporaTradeGraphService();
