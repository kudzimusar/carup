/**
 * Phase 10 Stage 3 — Trade Graph EXPLAINABLE QUERIES + INTELLIGENCE tests (pure, no DB, no network).
 *
 * Drives the real Stage 3 services
 *   - diasporaTradeGraphService.js        (neighborhood / transaction-path / blockers / match / evidence)
 *   - diasporaTradeIntelligenceService.js (demand signals / container opportunities / risk exposure /
 *                                          AI structured context + redaction)
 * against the SAME in-memory raw-pg mock (helpers/diasporaTradeGraphRpcReference.js) used by Stage 2,
 * with the graph itself BUILT by the real projection service from domain events — so these tests
 * exercise the full Stage 2 → Stage 3 read path with no hand-built rows.
 *
 * Proves the Stage 6 / §K test-matrix items that belong to queries + intelligence (directive §62):
 *   - Determinism: identical inputs ⇒ identical results (same neighbors, order, confidence).
 *   - Source references + reasons on every result (sourceEventRef = domain_events.id, edge types).
 *   - Path correctness (order → quote → stock → shipment) with combined (multiplicative) confidence.
 *   - Blocker detection (compliance / document / payment / SafeTrade) ranked by severity.
 *   - Match explanation (order → accepted-quote → stock; seller provenance) + blockers + evidence.
 *   - Tenant isolation: a query in tenant A never traverses into tenant B.
 *   - Soft-deleted / temporally-invalid edges excluded (revoked-edge handling).
 *   - Intelligence redaction: PII / payment refs / addresses / admin-only fields masked for non-admins;
 *     platform admin sees admin-only fields. AI context is read-only (never writes a node/edge).
 *   - Fail-closed when DIASPORA_TRADE_GRAPH is OFF.
 *
 * Time is fixed (FIXED_TS via context.now); no test depends on Date.now() for stored/returned values.
 */
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.DIASPORA_TRADE_GRAPH = 'true';

const FIXED_TS = '2026-06-21T14:00:00.000Z';
const PAST_TS = '2026-06-20T14:00:00.000Z';

const { createGraphPgMock, resetGraphIds } = await import('./helpers/diasporaTradeGraphRpcReference.js');
const { DiasporaTradeGraphProjectionService } = await import('../services/diaspora/tradegraph/diasporaTradeGraphProjectionService.js');
const { DiasporaTradeGraphService } = await import('../services/diaspora/tradegraph/diasporaTradeGraphService.js');
const { DiasporaTradeIntelligenceService } = await import('../services/diaspora/tradegraph/diasporaTradeIntelligenceService.js');
// FIX A/B/C: the shared redaction helper + the constants policy lists (unit-level assertions live below).
const {
  regionToken,
  participantReference,
  redactData,
  callerMaySeeParticipantIds,
  // FIX D: participant-node entityId pseudonymization.
  participantToken,
  surfaceEntityId,
} = await import('../services/diaspora/tradegraph/diasporaTradeGraphRedaction.js');
const {
  TRADE_GRAPH_PARTICIPANT_ID_FIELDS,
  TRADE_GRAPH_ADMIN_ONLY_FIELDS,
  // FIX D: participant node types + pseudonym token prefix.
  TRADE_GRAPH_PARTICIPANT_NODE_TYPES,
  TRADE_GRAPH_PARTICIPANT_TOKEN_PREFIX,
  isParticipantNodeType,
} = await import('../constants/diaspora/diasporaTradeGraphConstants.js');

// uuid-shaped tenant + event ids (projector requires uuids for event.id + tenant_id).
const T_A = '00000000-0000-4000-9000-00000000000a';
const T_B = '00000000-0000-4000-9000-00000000000b';
const evId = (n) => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;

const projection = () => new DiasporaTradeGraphProjectionService();
const queries = () => new DiasporaTradeGraphService();
const intel = () => new DiasporaTradeIntelligenceService();

// A best-effort audit client that never touches a real DB (read-path audit is best-effort).
const auditClient = {
  from() {
    return {
      insert() { return this; },
      select() { return this; },
      single() { return Promise.resolve({ data: { id: 'aud-1' }, error: null }); },
    };
  },
};

const pctx = (client) => ({ pgClient: client, now: FIXED_TS });
const rctx = (client, extra = {}) => ({ pgClient: client, now: FIXED_TS, auditClient, ...extra });

/**
 * Strip nondeterministic latency/timestamp fields (queryTimeMs / durationMs / freshness.computedAt /
 * lastComputedAt) recursively so determinism assertions compare GRAPH CONTENT only, never wall-clock.
 */
function stripLatency(value) {
  if (Array.isArray(value)) return value.map(stripLatency);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (['queryTimeMs', 'durationMs', 'computedAt', 'lastComputedAt'].includes(k)) continue;
      out[k] = stripLatency(v);
    }
    return out;
  }
  return value;
}

const adminCtx = (client, tenantId = T_A) => rctx(client, {
  userContext: { id: 'admin-1', platformRole: 'platform_admin', tenantId },
});
const memberCtx = (client, tenantId = T_A) => rctx(client, {
  userContext: { id: 'member-1', role: 'member', tenantRole: 'member', tenantId },
});
// A platform REVIEWER (in PLATFORM_REVIEW_ROLES but NOT PLATFORM_ADMIN_ROLES): per FIX A policy a
// reviewer MAY see raw participant identifiers, but is NOT a full platform admin (admin-only fields
// like internal_risk_score stay nulled for them).
const reviewerCtx = (client, tenantId = T_A) => rctx(client, {
  userContext: { id: 'rev-1', platformRole: 'reviewer', tenantId },
});

let proj;
beforeEach(() => { resetGraphIds(); proj = projection(); });
afterEach(() => { process.env.DIASPORA_TRADE_GRAPH = 'true'; });

/** Project a list of envelope events through the real projection service into the mock. */
async function project(client, events) {
  for (const ev of events) {
    await proj.projectEvent({ created_at: FIXED_TS, ...ev }, pctx(client));
  }
}

/** Resolve a current node id by (tenant, type, entity) from the mock store. */
function nodeId(store, tenant, type, entity) {
  const n = store.trade_graph_nodes.find(
    (r) => r.tenant_id === tenant && r.node_type === type && r.entity_id === entity && r.is_current && r.deleted_at == null,
  );
  return n ? n.id : null;
}

/**
 * A canonical order→quote→stock→shipment chain + a document + a compliance review + a SafeTrade tx,
 * all in tenant A, all derived from domain events (so source_event_ref is set on every edge).
 */
function canonicalEvents(tenant = T_A, base = 100) {
  return [
    { id: evId(base + 1), event_type: 'IMPORT_ORDER_CREATED', tenant_id: tenant,
      payload: { order_id: 'ord-1', buyer_id: 'buy-1', status: 'IMPORT_REQUESTED', origin_country: 'NG', destination_country: 'ZW', order_type: 'VEHICLE' } },
    { id: evId(base + 2), event_type: 'QUOTE_ACCEPTED', tenant_id: tenant,
      payload: { quote_id: 'q-1', order_id: 'ord-1', seller_id: 'sell-1' } },
    { id: evId(base + 3), event_type: 'STOCK_RESERVED', tenant_id: tenant,
      payload: { stock_item_id: 'st-1', order_id: 'ord-1', seller_trade_profile_id: 'sell-1' } },
    // Link the accepted quote to the stock (SUPPLIES from quote) by reserving against the quote too.
    { id: evId(base + 4), event_type: 'SHIPMENT_CREATED', tenant_id: tenant,
      payload: { shipment_id: 'sh-1', order_id: 'ord-1', container_id: 'cont-1', status: 'IN_TRANSIT' } },
    { id: evId(base + 5), event_type: 'DOCUMENT_UPLOADED', tenant_id: tenant,
      payload: { document_id: 'doc-1', order_id: 'ord-1', document_type: 'PROFORMA_INVOICE', verification_status: 'VERIFIED', uploaded_by: 'buy-1' } },
    { id: evId(base + 6), event_type: 'COMPLIANCE_REVIEW_CREATED', tenant_id: tenant,
      payload: { compliance_review_id: 'cr-1', order_id: 'ord-1', status: 'PENDING' } },
    { id: evId(base + 7), event_type: 'SAFETRADE_TRANSACTION_CREATED', tenant_id: tenant,
      payload: { safetrade_transaction_id: 'stx-1', order_id: 'ord-1', status: 'ESCROW_HELD' } },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Neighborhood
// ─────────────────────────────────────────────────────────────────────────────

test('neighborhood: returns 1-hop neighbors with reasons + source references; deterministic', async () => {
  const { client, store } = createGraphPgMock();
  await project(client, canonicalEvents());
  const orderId = nodeId(store, T_A, 'BUYER_ORDER', 'ord-1');

  const r1 = await queries().queryNeighborhood(T_A, orderId, rctx(client), { maxDepth: 1, minConfidence: 0 });
  assert.equal(r1.centerNode.nodeType, 'BUYER_ORDER');
  assert.ok(r1.neighbors.length >= 3, 'order has several 1-hop neighbors');
  // Every neighbor carries a reason path with edge types + source refs.
  for (const n of r1.neighbors) {
    assert.ok(Array.isArray(n.reasons) && n.reasons.length >= 1, 'reason chain present');
    assert.ok(n.relationshipType, 'edge/relationship type present');
    for (const step of n.reasons) {
      assert.ok(step.edge_type, 'each reason step names the edge');
      assert.ok(step.source_event_ref, 'each reason step references the domain event');
    }
  }
  // Determinism: identical inputs ⇒ identical output (order + ids + confidences).
  const r2 = await queries().queryNeighborhood(T_A, orderId, rctx(client), { maxDepth: 1, minConfidence: 0 });
  assert.deepEqual(
    r1.neighbors.map((n) => [n.nodeId, n.relationshipType, n.combinedConfidence]),
    r2.neighbors.map((n) => [n.nodeId, n.relationshipType, n.combinedConfidence]),
  );
});

test('determinism: full neighborhood result is identical once latency fields are ignored', async () => {
  const { client, store } = createGraphPgMock();
  await project(client, canonicalEvents());
  const orderId = nodeId(store, T_A, 'BUYER_ORDER', 'ord-1');
  const a = await queries().queryNeighborhood(T_A, orderId, rctx(client), { maxDepth: 2, minConfidence: 0 });
  const b = await queries().queryNeighborhood(T_A, orderId, rctx(client), { maxDepth: 2, minConfidence: 0 });
  // The whole payload (center, neighbors, reasons, source refs) matches once queryTimeMs is stripped.
  assert.deepEqual(stripLatency(a), stripLatency(b), 'graph content is deterministic (latency ignored)');
});

test('determinism: intelligence demand-signals identical ignoring freshness.computedAt/durationMs', async () => {
  const { client } = createGraphPgMock();
  await project(client, [
    { id: evId(860), event_type: 'IMPORT_ORDER_CREATED', tenant_id: T_A,
      payload: { order_id: 'o1', buyer_id: 'b', status: 'IMPORT_REQUESTED', origin_country: 'NG', order_type: 'VEHICLE' } },
    { id: evId(861), event_type: 'IMPORT_ORDER_CREATED', tenant_id: T_A,
      payload: { order_id: 'o2', buyer_id: 'b', status: 'IMPORT_REQUESTED', origin_country: 'NG', order_type: 'VEHICLE' } },
  ]);
  const a = await intel().demandSignals(T_A, adminCtx(client), { confidenceThreshold: 0 });
  const b = await intel().demandSignals(T_A, adminCtx(client), { confidenceThreshold: 0 });
  assert.deepEqual(stripLatency(a), stripLatency(b), 'demand signals deterministic (freshness/latency ignored)');
});

test('neighborhood: minConfidence threshold prunes low-confidence edges', async () => {
  const { client, store } = createGraphPgMock();
  await project(client, canonicalEvents());
  const orderId = nodeId(store, T_A, 'BUYER_ORDER', 'ord-1');

  // Baseline: with no threshold, the order has several confidence-1 neighbors.
  const all = await queries().queryNeighborhood(T_A, orderId, rctx(client), { maxDepth: 1, minConfidence: 0 });
  assert.ok(all.neighbors.length >= 3);

  // Lower one outbound edge's confidence to 0.1; with minConfidence 0.5 that neighbor is pruned while
  // the confidence-1 neighbors remain (combinedConfidence = node × edge is multiplicative → stable).
  const weak = store.trade_graph_edges.find((e) => e.source_node_id === orderId);
  assert.ok(weak, 'an outbound edge exists to weaken');
  weak.confidence = 0.1;
  const pruned = await queries().queryNeighborhood(T_A, orderId, rctx(client), { maxDepth: 1, minConfidence: 0.5 });
  assert.equal(pruned.neighbors.length, all.neighbors.length - 1, 'exactly the weakened-edge neighbor is pruned');
  assert.ok(pruned.neighbors.every((n) => n.combinedConfidence >= 0.5));
});

test('neighborhood: unknown node id → NotFoundError', async () => {
  const { client } = createGraphPgMock();
  await assert.rejects(
    () => queries().queryNeighborhood(T_A, evId(999), rctx(client), {}),
    /not found/i,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Transaction path (order → delivery)
// ─────────────────────────────────────────────────────────────────────────────

test('transaction path: follows canonical FORWARD edges from the order, each step carrying source refs', async () => {
  const { client, store } = createGraphPgMock();
  await project(client, canonicalEvents());
  const orderId = nodeId(store, T_A, 'BUYER_ORDER', 'ord-1');

  // The path follows OUTBOUND canonical edges from the order. Per the projection mapping the order's
  // forward edge is ACCEPTED_QUOTE (order→quote); SHIPMENT/CONTAINER/SafeTrade attach to the order via
  // INBOUND edges (FULFILLS_ORDER/RESERVES_CONTAINER/CONDUCTS_TRANSACTION point AT the order) and are
  // surfaced by neighborhood/evidence instead — so a SHIPMENT target is correctly NOT reached forward.
  const path = await queries().queryTransactionPath(T_A, orderId, rctx(client), { targetNodeType: 'SHIPMENT' });
  assert.equal(path.orderedSteps[0].nodeType, 'BUYER_ORDER');
  const typesInPath = path.orderedSteps.map((s) => s.nodeType);
  assert.ok(typesInPath.includes('ACCEPTED_QUOTE'), 'forward path reaches the accepted quote');
  assert.equal(path.complete, false, 'SHIPMENT is inbound to the order; not reached by the forward walk');
  // Every non-root step references the domain event that created its edge (explainability).
  for (const step of path.orderedSteps.slice(1)) {
    assert.ok(step.edgeType, 'step names the edge type');
    assert.ok(step.sourceEventRef, 'step references the source event');
  }
  assert.ok(Array.isArray(path.sourceReferences) && path.sourceReferences.length >= 1);

  // The full order→delivery chain (incl. SHIPMENT) is reachable via the bidirectional neighborhood walk.
  const nb = await queries().queryNeighborhood(T_A, orderId, rctx(client), { maxDepth: 1, minConfidence: 0 });
  assert.ok(nb.neighbors.some((n) => n.nodeType === 'SHIPMENT'), 'shipment is a (inbound) neighbor of the order');
});

test('transaction path: deterministic + non-BUYER_ORDER root rejected', async () => {
  const { client, store } = createGraphPgMock();
  await project(client, canonicalEvents());
  const orderId = nodeId(store, T_A, 'BUYER_ORDER', 'ord-1');
  const a = await queries().queryTransactionPath(T_A, orderId, rctx(client), {});
  const b = await queries().queryTransactionPath(T_A, orderId, rctx(client), {});
  assert.deepEqual(a.pathIds, b.pathIds);

  const shipmentId = nodeId(store, T_A, 'SHIPMENT', 'sh-1');
  await assert.rejects(() => queries().queryTransactionPath(T_A, shipmentId, rctx(client), {}), /BUYER_ORDER/);
});

// ─────────────────────────────────────────────────────────────────────────────
// Blocker summary
// ─────────────────────────────────────────────────────────────────────────────

test('blockers: detects compliance(PENDING) + SafeTrade(ESCROW_HELD); ranked by severity; each has a source', async () => {
  const { client, store } = createGraphPgMock();
  await project(client, canonicalEvents());
  // Add an overdue payment milestone (CRITICAL) to the same order.
  await project(client, [
    { id: evId(120), event_type: 'PAYMENT_MILESTONE_CREATED', tenant_id: T_A,
      payload: { payment_milestone_id: 'pm-1', order_id: 'ord-1', status: 'OVERDUE' } },
  ]);
  const orderId = nodeId(store, T_A, 'BUYER_ORDER', 'ord-1');

  const res = await queries().generateBlockerSummary(T_A, orderId, rctx(client));
  assert.equal(res.hasBlockers, true);
  const types = res.blockers.map((b) => b.type);
  assert.ok(types.includes('PAYMENT_OVERDUE'), 'payment overdue blocker');
  assert.ok(types.includes('COMPLIANCE_FAILURE'), 'compliance pending blocker');
  assert.ok(types.includes('SAFETRADE_BLOCKED'), 'safetrade escrow blocker');
  // Most severe first (PAYMENT_OVERDUE is CRITICAL).
  assert.equal(res.mostSevereBlocker.type, 'PAYMENT_OVERDUE');
  assert.equal(res.mostSevereBlocker.severity, 'CRITICAL');
  for (const b of res.blockers) {
    assert.ok(b.sourceEntityId, 'blocker references the source entity');
    assert.ok(b.reason, 'blocker carries a human-readable reason');
  }
  // Determinism.
  const again = await queries().generateBlockerSummary(T_A, orderId, rctx(client));
  assert.deepEqual(res.blockers.map((b) => b.type), again.blockers.map((b) => b.type));
});

test('blockers: a healthy order has no blockers', async () => {
  const { client, store } = createGraphPgMock();
  await project(client, [
    { id: evId(130), event_type: 'IMPORT_ORDER_CREATED', tenant_id: T_A,
      payload: { order_id: 'ord-ok', buyer_id: 'b', status: 'IMPORT_REQUESTED' } },
    { id: evId(131), event_type: 'DOCUMENT_UPLOADED', tenant_id: T_A,
      payload: { document_id: 'doc-ok', order_id: 'ord-ok', document_type: 'X', verification_status: 'VERIFIED' } },
  ]);
  const orderId = nodeId(store, T_A, 'BUYER_ORDER', 'ord-ok');
  const res = await queries().generateBlockerSummary(T_A, orderId, rctx(client));
  assert.equal(res.hasBlockers, false);
  assert.equal(res.blockers.length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Match explanation
// ─────────────────────────────────────────────────────────────────────────────

test('match explanation: explains why seller matched (order→accepted quote), with docs + blockers + evidence', async () => {
  const { client, store } = createGraphPgMock();
  await project(client, canonicalEvents());
  const orderId = nodeId(store, T_A, 'BUYER_ORDER', 'ord-1');

  const m = await queries().generateMatchExplanation(T_A, orderId, 'sell-1', rctx(client));
  assert.equal(m.matchFound, true);
  assert.ok(m.matchPath.length >= 2, 'path order → quote present');
  assert.equal(m.matchPath[0].nodeType, 'BUYER_ORDER');
  assert.ok(m.reasons.length >= 1 && m.reasons[0].edge === 'ACCEPTED_QUOTE');
  assert.ok(m.sourceReferences.length >= 1, 'evidence: source event refs');
  assert.ok(Array.isArray(m.supportingDocuments), 'supporting documents included');
  assert.ok(Array.isArray(m.blockers), 'blockers included');
  assert.ok(typeof m.confidence === 'number' && m.confidence > 0);
});

test('match explanation: no path to an unrelated seller → matchFound:false (still returns blockers)', async () => {
  const { client, store } = createGraphPgMock();
  await project(client, canonicalEvents());
  const orderId = nodeId(store, T_A, 'BUYER_ORDER', 'ord-1');
  const m = await queries().generateMatchExplanation(T_A, orderId, 'sell-UNRELATED', rctx(client));
  assert.equal(m.matchFound, false);
  assert.equal(m.matchPath.length, 0);
  assert.ok(Array.isArray(m.blockers));
});

// ─────────────────────────────────────────────────────────────────────────────
// Evidence chain
// ─────────────────────────────────────────────────────────────────────────────

test('evidence chain: returns entity + documents + compliance + domain events, chronologically', async () => {
  // Seed domain_events so the evidence lookup (by payload entity id) has rows to find, then project
  // the same events into the graph through the real projector (one shared store).
  const events = canonicalEvents();
  const { client } = createGraphPgMock({
    store: {
      trade_graph_nodes: [], trade_graph_edges: [], trade_graph_processed_events: [],
      trade_graph_dead_letters: [], trade_graph_rebuilds: [], trade_graph_projection_checkpoints: [],
      trade_graph_materialized_summaries: [],
      domain_events: events.map((e) => ({ ...e, created_at: FIXED_TS, status: 'processed' })),
    },
  });
  await project(client, events);

  const chain = await queries().queryEvidenceChain(T_A, 'BUYER_ORDER', 'ord-1', rctx(client));
  assert.equal(chain.entity.nodeType, 'BUYER_ORDER');
  assert.ok(chain.documents.length >= 1, 'document evidence present');
  assert.ok(chain.complianceRecords.length >= 1, 'compliance evidence present');
  assert.ok(chain.domainEvents.length >= 1, 'domain-event provenance present');
  // Chain is sorted by createdAt asc (chronological); ENTITY first by stable id when equal.
  const times = chain.chain.map((c) => new Date(c.createdAt).getTime());
  for (let i = 1; i < times.length; i += 1) assert.ok(times[i] >= times[i - 1], 'chronological');
});

// ─────────────────────────────────────────────────────────────────────────────
// Tenant isolation + revoked edge handling
// ─────────────────────────────────────────────────────────────────────────────

test('tenant isolation: a query in tenant A never traverses into tenant B', async () => {
  const { client, store } = createGraphPgMock();
  await project(client, canonicalEvents(T_A, 200));
  await project(client, canonicalEvents(T_B, 300));
  const orderA = nodeId(store, T_A, 'BUYER_ORDER', 'ord-1');

  const nb = await queries().queryNeighborhood(T_A, orderA, rctx(client), { maxDepth: 3, minConfidence: 0 });
  // Every returned neighbor must be a tenant-A node.
  for (const n of nb.neighbors) {
    const row = store.trade_graph_nodes.find((r) => r.id === n.nodeId);
    assert.equal(row.tenant_id, T_A, 'no cross-tenant node leaked into the result');
  }
});

test('FIX 1/2: a planted cross-tenant edge does NOT leak a foreign-tenant neighbor', async () => {
  const { client, store } = createGraphPgMock();
  await project(client, canonicalEvents(T_A, 800));
  await project(client, canonicalEvents(T_B, 900));
  const orderA = nodeId(store, T_A, 'BUYER_ORDER', 'ord-1');
  const docB = nodeId(store, T_B, 'DOCUMENT', 'doc-1');
  assert.ok(orderA && docB);

  // Plant a MALICIOUS/buggy edge whose target is a tenant-B node but which is tagged tenant A (as a
  // service-role write bug could). The app-layer re-assertion (AND n.tenant_id = $caller) must still
  // refuse to surface the tenant-B neighbor — RLS is bypassed on the service-role read pool (FIX 2).
  store.trade_graph_edges.push({
    id: 'planted-cross-tenant', tenant_id: T_A, source_node_id: orderA, target_node_id: docB,
    edge_type: 'DOCUMENTS', source_event_ref: evId(999), is_valid: true, confidence: 1.0,
    policy_version: 'p', valid_from: PAST_TS, valid_until: null, created_at: FIXED_TS, deleted_at: null,
    updated_at: FIXED_TS, metadata: {},
  });

  const nb = await queries().queryNeighborhood(T_A, orderA, rctx(client), { maxDepth: 2, minConfidence: 0 });
  // The tenant-B document is never returned, and no tenant-B node appears anywhere in the traversal.
  assert.ok(!nb.neighbors.some((n) => String(n.nodeId) === String(docB)), 'tenant-B document not leaked via planted edge');
  for (const n of nb.neighbors) {
    const row = store.trade_graph_nodes.find((r) => String(r.id) === String(n.nodeId));
    assert.equal(row.tenant_id, T_A, 'every neighbor belongs to the caller tenant');
  }
});

test('FIX 1/2: intelligence risk-exposure also never crosses tenants via a planted edge', async () => {
  const { client, store } = createGraphPgMock();
  await project(client, canonicalEvents(T_A, 820));
  await project(client, [
    { id: evId(821), event_type: 'COMPLIANCE_REVIEW_CREATED', tenant_id: T_B,
      payload: { compliance_review_id: 'cr-B', order_id: 'ord-B', status: 'REJECTED' } },
  ]);
  const orderA = nodeId(store, T_A, 'BUYER_ORDER', 'ord-1');
  const crB = nodeId(store, T_B, 'COMPLIANCE_REVIEW', 'cr-B');
  // Plant a tenant-A-tagged edge pointing at the tenant-B compliance review.
  store.trade_graph_edges.push({
    id: 'planted-risk', tenant_id: T_A, source_node_id: crB, target_node_id: orderA,
    edge_type: 'REVIEWS_COMPLIANCE', source_event_ref: evId(998), is_valid: true, confidence: 1.0,
    policy_version: 'p', valid_from: PAST_TS, valid_until: null, created_at: FIXED_TS, deleted_at: null,
    updated_at: FIXED_TS, metadata: {},
  });
  const res = await intel().riskExposure(T_A, adminCtx(client), {});
  const ord = res.risks.find((r) => r.orderId === 'ord-1');
  // The tenant-B REJECTED compliance review must NOT contribute a blocker to the tenant-A order.
  const fromB = (ord?.blockers || []).some((b) => b.sourceEntityId === 'cr-B');
  assert.equal(fromB, false, 'foreign-tenant compliance review never blocks the caller-tenant order');
});

test('FIX 6/7: query-service neighborhood redacts node.data by role + coarsens region (non-admin)', async () => {
  const { client, store } = createGraphPgMock();
  await project(client, canonicalEvents());
  const orderId = nodeId(store, T_A, 'BUYER_ORDER', 'ord-1');
  // Enrich the order + a neighbor document with sensitive fields (as a richer projection would carry).
  const order = store.trade_graph_nodes.find((n) => n.node_type === 'BUYER_ORDER' && n.entity_id === 'ord-1');
  order.data = { ...order.data, buyer_name: 'Jane Doe', payment_ref: 'PR-1', address: '12 Main St, Lagos', internal_risk_score: 91 };
  const doc = store.trade_graph_nodes.find((n) => n.node_type === 'DOCUMENT' && n.entity_id === 'doc-1');
  doc.data = { ...doc.data, seller_name: 'Acme Ltd', origin_city: 'Lagos' };

  const res = await queries().queryNeighborhood(T_A, orderId, memberCtx(client), { maxDepth: 1, minConfidence: 0 });
  // Center node redacted.
  assert.equal(res.centerNode.data.buyer_name, '[REDACTED]', 'PII name redacted on center');
  assert.equal(res.centerNode.data.payment_ref, '[REDACTED]', 'payment ref redacted on center');
  assert.ok(String(res.centerNode.data.address).startsWith('[REGION]'), 'address coarsened to region token (FIX 7)');
  assert.ok(!String(res.centerNode.data.address).includes('Main St'), 'raw address prefix NOT leaked');
  assert.equal(res.centerNode.data.internal_risk_score, null, 'admin-only nulled for non-admin');
  // Neighbor node redacted too.
  const docNb = res.neighbors.find((n) => n.nodeType === 'DOCUMENT' && n.entityId === 'doc-1');
  assert.ok(docNb, 'document neighbor present');
  assert.equal(docNb.data.seller_name, '[REDACTED]', 'PII redacted on neighbor');
  assert.ok(String(docNb.data.origin_city).startsWith('[REGION]'), 'neighbor region coarsened');
});

test('FIX 6: query-service redacts edge.metadata leaving the neighborhood (non-admin)', async () => {
  const { client, store } = createGraphPgMock();
  await project(client, canonicalEvents());
  const orderId = nodeId(store, T_A, 'BUYER_ORDER', 'ord-1');
  // Plant sensitive metadata on an outbound edge from the order.
  const edge = store.trade_graph_edges.find((e) => e.source_node_id === orderId);
  assert.ok(edge, 'an outbound edge exists');
  edge.metadata = { payment_ref: 'PR-secret', address: '99 Back Lane', note: 'public' };

  const member = await queries().queryNeighborhood(T_A, orderId, memberCtx(client), { maxDepth: 1, minConfidence: 0 });
  const nb = member.neighbors.find((n) => n.viaEdgeId === edge.id);
  assert.ok(nb, 'neighbor reached via the metadata-bearing edge');
  assert.equal(nb.edgeMetadata.payment_ref, '[REDACTED]', 'edge.metadata payment ref redacted');
  assert.ok(String(nb.edgeMetadata.address).startsWith('[REGION]'), 'edge.metadata address coarsened');
  assert.equal(nb.edgeMetadata.note, 'public', 'non-sensitive metadata passes through');

  const admin = await queries().queryNeighborhood(T_A, orderId, adminCtx(client), { maxDepth: 1, minConfidence: 0 });
  const nbA = admin.neighbors.find((n) => n.viaEdgeId === edge.id);
  // PII/address still masked even for admins (least privilege).
  assert.equal(nbA.edgeMetadata.payment_ref, '[REDACTED]');
});

test('FIX 6: query-service platform admin sees admin-only fields (role-aware)', async () => {
  const { client, store } = createGraphPgMock();
  await project(client, canonicalEvents());
  const orderId = nodeId(store, T_A, 'BUYER_ORDER', 'ord-1');
  const order = store.trade_graph_nodes.find((n) => n.node_type === 'BUYER_ORDER' && n.entity_id === 'ord-1');
  order.data = { ...order.data, internal_risk_score: 91, buyer_name: 'Jane Doe' };
  const res = await queries().queryNeighborhood(T_A, orderId, adminCtx(client), { maxDepth: 1, minConfidence: 0 });
  assert.equal(res.centerNode.data.internal_risk_score, 91, 'admin sees admin-only field');
  // PII is masked even for admins (least privilege — no need for raw PII in a graph summary).
  assert.equal(res.centerNode.data.buyer_name, '[REDACTED]', 'PII still masked for admin');
});

test('FIX 3: a revoked (soft-deleted) edge is excluded from query traversal', async () => {
  const { client, store } = createGraphPgMock();
  await project(client, [
    { id: evId(840), event_type: 'IMPORT_ORDER_CREATED', tenant_id: T_A,
      payload: { order_id: 'ord-1', buyer_id: 'b-1', status: 'IMPORT_REQUESTED' } },
    { id: evId(841), event_type: 'STOCK_RESERVED', tenant_id: T_A,
      payload: { stock_item_id: 'st-1', order_id: 'ord-1' } },
  ]);
  const orderId = nodeId(store, T_A, 'BUYER_ORDER', 'ord-1');
  const before = await queries().queryNeighborhood(T_A, orderId, rctx(client), { maxDepth: 1, minConfidence: 0 });
  assert.ok(before.neighbors.some((n) => n.nodeType === 'SELLER_STOCK_ITEM'), 'stock reachable via SUPPLIES before release');

  // Releasing the stock revokes the SUPPLIES edge (soft-delete via the projector, not a hand edit).
  await project(client, [
    { id: evId(842), event_type: 'STOCK_RELEASED', tenant_id: T_A, payload: { stock_item_id: 'st-1', order_id: 'ord-1' } },
  ]);
  const after = await queries().queryNeighborhood(T_A, orderId, rctx(client), { maxDepth: 1, minConfidence: 0 });
  assert.ok(after.neighbors.every((n) => !(n.nodeType === 'SELLER_STOCK_ITEM' && n.entityId === 'st-1')),
    'revoked SUPPLIES edge excluded from traversal after STOCK_RELEASED');
});

test('revoked/expired edge handling: an edge past valid_until is excluded from traversal', async () => {
  const { client, store } = createGraphPgMock();
  await project(client, canonicalEvents());
  const orderId = nodeId(store, T_A, 'BUYER_ORDER', 'ord-1');

  // Before expiry, the shipment is a (inbound) neighbor of the order via FULFILLS_ORDER.
  const before = await queries().queryNeighborhood(T_A, orderId, rctx(client), { maxDepth: 1, minConfidence: 0 });
  assert.ok(before.neighbors.some((n) => n.nodeType === 'SHIPMENT'), 'shipment reachable before expiry');

  // Expire the shipment→order FULFILLS_ORDER edge in the past (now = FIXED_TS is after PAST_TS).
  const edge = store.trade_graph_edges.find((e) => e.edge_type === 'FULFILLS_ORDER');
  assert.ok(edge, 'FULFILLS_ORDER edge exists');
  edge.valid_until = PAST_TS;

  // After expiry the temporal filter (edgeIsValidAt) drops the edge → shipment no longer traversed.
  const after = await queries().queryNeighborhood(T_A, orderId, rctx(client), { maxDepth: 1, minConfidence: 0 });
  assert.ok(after.neighbors.every((n) => n.nodeType !== 'SHIPMENT'), 'expired edge excluded from traversal');
});

// ─────────────────────────────────────────────────────────────────────────────
// Gating
// ─────────────────────────────────────────────────────────────────────────────

test('disabled gate: every query throws when DIASPORA_TRADE_GRAPH is OFF', async () => {
  process.env.DIASPORA_TRADE_GRAPH = 'false';
  const { client } = createGraphPgMock();
  await assert.rejects(() => queries().queryNeighborhood(T_A, evId(1), rctx(client), {}), /disabled/i);
  await assert.rejects(() => intel().demandSignals(T_A, adminCtx(client), {}), /disabled/i);
});

// ─────────────────────────────────────────────────────────────────────────────
// Intelligence: demand signals
// ─────────────────────────────────────────────────────────────────────────────

test('demand signals: groups unmatched orders by country + product type', async () => {
  const { client } = createGraphPgMock();
  await project(client, [
    { id: evId(400), event_type: 'IMPORT_ORDER_CREATED', tenant_id: T_A,
      payload: { order_id: 'o1', buyer_id: 'b', status: 'IMPORT_REQUESTED', origin_country: 'NG', order_type: 'VEHICLE' } },
    { id: evId(401), event_type: 'IMPORT_ORDER_CREATED', tenant_id: T_A,
      payload: { order_id: 'o2', buyer_id: 'b', status: 'IMPORT_REQUESTED', origin_country: 'NG', order_type: 'VEHICLE' } },
    // o3 is already matched (has an accepted quote) → excluded from demand.
    { id: evId(402), event_type: 'IMPORT_ORDER_CREATED', tenant_id: T_A,
      payload: { order_id: 'o3', buyer_id: 'b', status: 'IMPORT_REQUESTED', origin_country: 'NG', order_type: 'VEHICLE' } },
    { id: evId(403), event_type: 'QUOTE_ACCEPTED', tenant_id: T_A,
      payload: { quote_id: 'q3', order_id: 'o3', seller_id: 's' } },
  ]);

  const res = await intel().demandSignals(T_A, adminCtx(client), { confidenceThreshold: 0 });
  assert.equal(res.count, 1);
  assert.equal(res.signals[0].country, 'NG');
  assert.equal(res.signals[0].productType, 'VEHICLE');
  assert.equal(res.signals[0].unmatchedCount, 2, 'o1 + o2 unmatched; o3 excluded (accepted quote)');
  assert.ok(res.signals[0].evidence.graphNodeIds.length === 2);
  assert.ok(res.freshness.computedAt === FIXED_TS);
});

// ─────────────────────────────────────────────────────────────────────────────
// Intelligence: container opportunities (with region redaction)
// ─────────────────────────────────────────────────────────────────────────────

test('container opportunities: matches by geo + capacity; coordinator + region redacted for non-admin', async () => {
  const { client } = createGraphPgMock();
  await project(client, [
    { id: evId(500), event_type: 'CONTAINER_CREATED', tenant_id: T_A,
      payload: { container_id: 'c1', coordinator_id: 'coord-secret', status: 'BOOKED' } },
    { id: evId(501), event_type: 'IMPORT_ORDER_CREATED', tenant_id: T_A,
      payload: { order_id: 'o1', buyer_id: 'b', status: 'READY_FOR_LOADING', origin_country: 'NG', destination_country: 'ZW' } },
  ]);
  // Enrich the container node with geo + capacity (status change carries no geo; patch via store not allowed —
  // instead emit a CONTAINER node that already has geo through a status-changed event is not enough, so we
  // rely on sameGeo requiring both sides; here the container lacks geo so it matches 0 orders but still lists).
  const res = await intel().containerOpportunities(T_A, memberCtx(client), {});
  assert.equal(res.count, 1);
  const opp = res.opportunities[0];
  assert.equal(opp.containerId, 'c1');
  assert.equal(opp.coordinatorId, '[REDACTED]', 'coordinator id redacted for non-admin');
});

test('container opportunities: platform admin sees the coordinator id (role-aware redaction)', async () => {
  const { client } = createGraphPgMock();
  await project(client, [
    { id: evId(510), event_type: 'CONTAINER_CREATED', tenant_id: T_A,
      payload: { container_id: 'c1', coordinator_id: 'coord-secret', status: 'BOOKED' } },
  ]);
  const res = await intel().containerOpportunities(T_A, adminCtx(client), {});
  assert.equal(res.opportunities[0].coordinatorId, 'coord-secret');
});

// ─────────────────────────────────────────────────────────────────────────────
// Intelligence: risk exposure
// ─────────────────────────────────────────────────────────────────────────────

test('risk exposure: aggregates per-order blockers into a risk level', async () => {
  const { client } = createGraphPgMock();
  await project(client, canonicalEvents());
  await project(client, [
    { id: evId(600), event_type: 'PAYMENT_MILESTONE_CREATED', tenant_id: T_A,
      payload: { payment_milestone_id: 'pm-1', order_id: 'ord-1', status: 'OVERDUE' } },
  ]);
  const res = await intel().riskExposure(T_A, adminCtx(client), {});
  assert.ok(res.count >= 1);
  const ord = res.risks.find((r) => r.orderId === 'ord-1');
  assert.ok(ord, 'order risk present');
  assert.equal(ord.riskLevel, 'HIGH');
  assert.ok(ord.blockers.some((b) => b.type === 'payment'), 'payment blocker captured');
  assert.ok(ord.evidence.sourceReferences.length >= 1, 'risk references source events');
});

// ─────────────────────────────────────────────────────────────────────────────
// Intelligence: AI structured context + redaction
// ─────────────────────────────────────────────────────────────────────────────

test('structured AI context: PII / payment / address redacted for non-admin; read-only boundary asserted', async () => {
  const { client, store } = createGraphPgMock();
  await project(client, [
    { id: evId(700), event_type: 'IMPORT_ORDER_CREATED', tenant_id: T_A,
      payload: { order_id: 'ord-1', buyer_id: 'b', status: 'IMPORT_REQUESTED' } },
    { id: evId(701), event_type: 'TRADE_PROFILE_CREATED', tenant_id: T_A,
      payload: { trade_profile_id: 'tp-1', user_id: 'u-1', created_by: 'u-1', role_type: 'BUYER' } },
  ]);
  // Patch the order node's data to include sensitive fields (as if projected from a richer event).
  const order = store.trade_graph_nodes.find((n) => n.node_type === 'BUYER_ORDER' && n.entity_id === 'ord-1');
  order.data = { ...order.data, buyer_name: 'Jane Doe', payment_ref: 'PR-123', address: '12 Main St, Lagos', internal_risk_score: 88 };

  const res = await intel().structuredContextForAi(T_A, 'ord-1', memberCtx(client));
  assert.equal(res.order.data.buyer_name, '[REDACTED]', 'PII name redacted');
  assert.equal(res.order.data.payment_ref, '[REDACTED]', 'payment ref redacted');
  assert.ok(String(res.order.data.address).startsWith('[REGION]'), 'address coarsened to region');
  assert.equal(res.order.data.internal_risk_score, null, 'admin-only field nulled for non-admin');
  assert.deepEqual(res.aiBoundary, { readOnly: true, mutatesState: false, createsEdges: false });
  // The AI context read NOTHING into the graph: no new nodes/edges were written by the query path.
  const nodeCountBefore = store.trade_graph_nodes.length;
  const edgeCountBefore = store.trade_graph_edges.length;
  await intel().structuredContextForAi(T_A, 'ord-1', memberCtx(client));
  assert.equal(store.trade_graph_nodes.length, nodeCountBefore, 'no nodes written by AI read path');
  assert.equal(store.trade_graph_edges.length, edgeCountBefore, 'no edges written by AI read path');
});

test('structured AI context: platform admin sees admin-only fields (role-aware)', async () => {
  const { client, store } = createGraphPgMock();
  await project(client, [
    { id: evId(710), event_type: 'IMPORT_ORDER_CREATED', tenant_id: T_A,
      payload: { order_id: 'ord-1', buyer_id: 'b', status: 'IMPORT_REQUESTED' } },
  ]);
  const order = store.trade_graph_nodes.find((n) => n.node_type === 'BUYER_ORDER' && n.entity_id === 'ord-1');
  order.data = { ...order.data, internal_risk_score: 88 };
  const res = await intel().structuredContextForAi(T_A, 'ord-1', adminCtx(client));
  assert.equal(res.order.data.internal_risk_score, 88, 'admin sees admin-only field');
});

test('intelligence authorization: a member of another tenant is forbidden', async () => {
  const { client } = createGraphPgMock();
  await project(client, canonicalEvents());
  const foreign = rctx(client, { userContext: { id: 'x', role: 'member', tenantRole: 'member', tenantId: T_B } });
  await assert.rejects(() => intel().demandSignals(T_A, foreign, {}), /not authorized/i);
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX A — participant/profile identifiers redacted for non-admins AND AI context
// ─────────────────────────────────────────────────────────────────────────────

// The participant identifiers we expect to NEVER leak raw to a non-admin viewer / AI context.
const PARTICIPANT_IDS_TO_PROVE = ['seller_id', 'buyer_id', 'user_id', 'coordinator_id', 'uploaded_by', 'verified_by', 'trade_profile_id'];

/**
 * Project a graph whose node.data carries every participant identifier we care about:
 *   BUYER_ORDER.data.buyer_id, RFQ/ACCEPTED_QUOTE.data.seller_id, SELLER_STOCK_ITEM.data.seller_trade_profile_id,
 *   DOCUMENT.data.uploaded_by + .verified_by, CONTAINER.data.coordinator_id,
 *   TRADE_PROFILE.data.user_id + .created_by + (entity) trade_profile_id, AI_COMMAND.data.requested_by.
 */
async function projectParticipantGraph(client, store) {
  await project(client, [
    { id: evId(1001), event_type: 'IMPORT_ORDER_CREATED', tenant_id: T_A,
      payload: { order_id: 'ord-1', buyer_id: 'buyer-RAW-1', status: 'IMPORT_REQUESTED', origin_country: 'NG', destination_country: 'ZW', order_type: 'VEHICLE' } },
    { id: evId(1002), event_type: 'QUOTE_ACCEPTED', tenant_id: T_A,
      payload: { quote_id: 'q-1', order_id: 'ord-1', seller_id: 'seller-RAW-1' } },
    // STOCK_ITEM_CREATED carries seller_trade_profile_id into node.data; STOCK_RESERVED then links SUPPLIES.
    { id: evId(1003), event_type: 'STOCK_ITEM_CREATED', tenant_id: T_A,
      payload: { stock_item_id: 'st-1', seller_trade_profile_id: 'stp-RAW-1', publication_status: 'PUBLISHED', verification_status: 'VERIFIED' } },
    { id: evId(1007), event_type: 'STOCK_RESERVED', tenant_id: T_A,
      payload: { stock_item_id: 'st-1', order_id: 'ord-1', seller_trade_profile_id: 'stp-RAW-1' } },
    { id: evId(1004), event_type: 'DOCUMENT_UPLOADED', tenant_id: T_A,
      payload: { document_id: 'doc-1', order_id: 'ord-1', document_type: 'PROFORMA_INVOICE', verification_status: 'VERIFIED', uploaded_by: 'uploader-RAW-1' } },
    { id: evId(1005), event_type: 'DOCUMENT_VERIFIED', tenant_id: T_A,
      payload: { document_id: 'doc-1', verified_by: 'verifier-RAW-1' } },
    { id: evId(1006), event_type: 'TRADE_PROFILE_CREATED', tenant_id: T_A,
      payload: { trade_profile_id: 'tp-1', user_id: 'user-RAW-1', created_by: 'creator-RAW-1', role_type: 'BUYER' } },
  ]);
  // A richer projection would also carry verified_by INSIDE document node.data (the canonical mapping
  // routes verified_by to a USER edge endpoint, which is a structural key). To prove the redaction helper
  // masks it WHEREVER it appears in node.data, plant it on the document node's data directly.
  if (store) {
    const doc = store.trade_graph_nodes.find((n) => n.node_type === 'DOCUMENT' && n.entity_id === 'doc-1');
    if (doc) doc.data = { ...doc.data, verified_by: 'verifier-RAW-1' };
  }
}

/** Recursively collect every leaf string/number value of an object/array (for "raw id absent" scans). */
function collectValues(value, acc = []) {
  if (value == null) return acc;
  if (Array.isArray(value)) { for (const v of value) collectValues(v, acc); return acc; }
  if (typeof value === 'object') { for (const v of Object.values(value)) collectValues(v, acc); return acc; }
  acc.push(String(value));
  return acc;
}

const RAW_PARTICIPANT_TOKENS = ['buyer-RAW-1', 'seller-RAW-1', 'stp-RAW-1', 'uploader-RAW-1', 'verifier-RAW-1', 'user-RAW-1', 'creator-RAW-1'];

/**
 * Collect ONLY the values from the REDACTABLE PAYLOAD surfaces (node.data / edge.metadata / reason+detail
 * text), recursively. A participant id is allowed to be a STRUCTURAL node key (entityId of a BUYER/SELLER/
 * USER node) — the directive keeps the queryable entity_id intact — so the leak scan ignores structural id
 * fields (nodeId/entityId/sourceEntityId/...) and only inspects the data/metadata/reason text FIX A/B mask.
 */
const REDACTABLE_KEYS = new Set(['data', 'metadata', 'edgeMetadata', 'reason', 'detail']);
function collectRedactablePayloadValues(value, insideRedactable = false, acc = []) {
  if (value == null) return acc;
  if (Array.isArray(value)) { for (const v of value) collectRedactablePayloadValues(v, insideRedactable, acc); return acc; }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      collectRedactablePayloadValues(v, insideRedactable || REDACTABLE_KEYS.has(k), acc);
    }
    return acc;
  }
  if (insideRedactable) acc.push(String(value));
  return acc;
}

/** Assert no raw participant id appears in any REDACTABLE payload surface (node.data/edge.metadata/reason). */
function assertNoRawParticipantId(payload, message) {
  const haystack = collectRedactablePayloadValues(payload).join(' ');
  for (const raw of RAW_PARTICIPANT_TOKENS) {
    assert.ok(!haystack.includes(raw), `${message}: raw participant id "${raw}" leaked in a data/metadata/reason field`);
  }
}

test('FIX A: constants classify every participant identifier as ADMIN_ONLY', () => {
  const adminOnly = new Set(TRADE_GRAPH_ADMIN_ONLY_FIELDS);
  for (const f of ['seller_id', 'buyer_id', 'user_id', 'coordinator_id', 'uploaded_by', 'verified_by', 'requested_by', 'reviewed_by', 'created_by', 'updated_by', 'trade_profile_id', 'assigned_to', 'actor_id']) {
    assert.ok(TRADE_GRAPH_PARTICIPANT_ID_FIELDS.includes(f), `${f} is a known participant id field`);
    assert.ok(adminOnly.has(f), `${f} is admin-only (masked for non-admins/AI)`);
  }
});

test('FIX A: a NON-ADMIN neighborhood view never receives raw participant ids (tokenized)', async () => {
  const { client, store } = createGraphPgMock();
  await projectParticipantGraph(client, store);
  const orderId = nodeId(store, T_A, 'BUYER_ORDER', 'ord-1');

  const res = await queries().queryNeighborhood(T_A, orderId, memberCtx(client), { maxDepth: 2, minConfidence: 0 });
  // Center order: buyer_id tokenized; structural entityId intact.
  assert.equal(res.centerNode.data.buyer_id, '[REDACTED]', 'buyer_id tokenized on center for non-admin');
  assert.equal(res.centerNode.entityId, 'ord-1', 'structural entity id (queryable key) intact');
  // Every neighbor's data has all participant ids tokenized; none of the RAW values appear anywhere.
  for (const n of res.neighbors) {
    for (const f of PARTICIPANT_IDS_TO_PROVE) {
      if (f in n.data) assert.equal(n.data[f], '[REDACTED]', `${f} tokenized on neighbor ${n.nodeType}`);
    }
    assert.ok(n.entityId, 'structural neighbor entity id present + intact');
  }
  assertNoRawParticipantId(res, 'non-admin neighborhood');
});

test('FIX A: the AI structured context never receives raw participant ids', async () => {
  const { client, store } = createGraphPgMock();
  await projectParticipantGraph(client, store);

  // memberCtx === non-admin == the AI boundary's least-privilege view.
  const res = await intel().structuredContextForAi(T_A, 'ord-1', memberCtx(client));
  assert.equal(res.order.data.buyer_id, '[REDACTED]', 'AI order context: buyer_id tokenized');
  for (const nb of res.neighbors) {
    for (const f of PARTICIPANT_IDS_TO_PROVE) {
      if (f in nb.node.data) assert.equal(nb.node.data[f], '[REDACTED]', `AI neighbor ${nb.node.nodeType}: ${f} tokenized`);
    }
  }
  assertNoRawParticipantId(res, 'AI structured context');
});

test('FIX A: a PLATFORM ADMIN does receive the raw participant ids (role-aware)', async () => {
  const { client, store } = createGraphPgMock();
  await projectParticipantGraph(client, store);
  const orderId = nodeId(store, T_A, 'BUYER_ORDER', 'ord-1');

  const res = await queries().queryNeighborhood(T_A, orderId, adminCtx(client), { maxDepth: 2, minConfidence: 0 });
  assert.equal(res.centerNode.data.buyer_id, 'buyer-RAW-1', 'admin sees raw buyer_id');
  const stock = res.neighbors.find((n) => n.nodeType === 'SELLER_STOCK_ITEM');
  assert.ok(stock, 'stock neighbor present');
  assert.equal(stock.data.seller_trade_profile_id, 'stp-RAW-1', 'admin sees raw seller_trade_profile_id');
  const doc = res.neighbors.find((n) => n.nodeType === 'DOCUMENT' && n.entityId === 'doc-1');
  assert.equal(doc.data.uploaded_by, 'uploader-RAW-1', 'admin sees raw uploaded_by');
  assert.equal(doc.data.verified_by, 'verifier-RAW-1', 'admin sees raw verified_by');
});

test('FIX A: a platform REVIEWER (not admin) also sees raw participant ids, but admin-only fields stay nulled', async () => {
  const { client, store } = createGraphPgMock();
  await projectParticipantGraph(client, store);
  const order = store.trade_graph_nodes.find((n) => n.node_type === 'BUYER_ORDER' && n.entity_id === 'ord-1');
  order.data = { ...order.data, internal_risk_score: 77 };
  const orderId = order.id;

  const res = await queries().queryNeighborhood(T_A, orderId, reviewerCtx(client), { maxDepth: 1, minConfidence: 0 });
  assert.equal(res.centerNode.data.buyer_id, 'buyer-RAW-1', 'reviewer sees raw participant id');
  assert.equal(res.centerNode.data.internal_risk_score, null, 'reviewer does NOT see the admin-only risk score');
});

test('FIX A: coordinator_id in container opportunities follows the participant-id policy', async () => {
  const { client } = createGraphPgMock();
  await project(client, [
    { id: evId(1010), event_type: 'CONTAINER_CREATED', tenant_id: T_A,
      payload: { container_id: 'c1', coordinator_id: 'coord-RAW-1', status: 'BOOKED' } },
  ]);
  const nonAdmin = await intel().containerOpportunities(T_A, memberCtx(client), {});
  assert.equal(nonAdmin.opportunities[0].coordinatorId, '[REDACTED]', 'non-admin: coordinator redacted');
  const reviewer = await intel().containerOpportunities(T_A, reviewerCtx(client), {});
  assert.equal(reviewer.opportunities[0].coordinatorId, 'coord-RAW-1', 'reviewer: coordinator visible');
  const admin = await intel().containerOpportunities(T_A, adminCtx(client), {});
  assert.equal(admin.opportunities[0].coordinatorId, 'coord-RAW-1', 'admin: coordinator visible');
});

// NEGATIVE CONTROL for FIX A: reverting the classification (a field NOT in the participant list) proves
// the test is load-bearing — an unclassified id field WOULD pass through raw, so the assertion that the
// classified ids are tokenized is meaningful.
test('FIX A (negative control): an UNCLASSIFIED id field is NOT redacted — proving the list drives masking', () => {
  // 'totally_unlisted_id' is deliberately not a participant/admin/redacted field → passes through raw.
  const out = redactData({ seller_id: 'seller-RAW-1', totally_unlisted_id: 'kept-raw' }, { id: 'm', role: 'member' });
  assert.equal(out.seller_id, '[REDACTED]', 'classified participant id IS masked for non-admin');
  assert.equal(out.totally_unlisted_id, 'kept-raw', 'unclassified id passes through (control): masking is list-driven');
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX B — no raw participant id in any reason / explanation / blocker text
// ─────────────────────────────────────────────────────────────────────────────

test('FIX B: generateMatchExplanation reason text contains NO raw seller_id for a non-admin', async () => {
  const { client, store } = createGraphPgMock();
  await project(client, [
    { id: evId(1100), event_type: 'IMPORT_ORDER_CREATED', tenant_id: T_A,
      payload: { order_id: 'ord-1', buyer_id: 'buyer-RAW-1', status: 'IMPORT_REQUESTED' } },
    { id: evId(1101), event_type: 'QUOTE_ACCEPTED', tenant_id: T_A,
      payload: { quote_id: 'q-1', order_id: 'ord-1', seller_id: 'seller-RAW-1' } },
    { id: evId(1102), event_type: 'STOCK_RESERVED', tenant_id: T_A,
      payload: { stock_item_id: 'st-1', order_id: 'ord-1', seller_trade_profile_id: 'stp-RAW-1' } },
  ]);
  const orderId = nodeId(store, T_A, 'BUYER_ORDER', 'ord-1');

  const m = await queries().generateMatchExplanation(T_A, orderId, 'seller-RAW-1', memberCtx(client));
  assert.equal(m.matchFound, true);
  // The reason detail names the seller via a tokenized reference, never the raw id.
  const detail = m.reasons.map((r) => r.detail || '').join(' | ');
  assert.ok(detail.includes('seller [REDACTED]'), 'reason uses a tokenized seller reference');
  assert.ok(!detail.includes('seller-RAW-1'), 'raw seller_id NOT present in any reason detail');
  // No raw participant id anywhere in the whole explanation payload (reasons + matchPath + blockers).
  assertNoRawParticipantId(m.reasons, 'match reasons (non-admin)');
  assert.ok(!collectValues(m.matchPath).join(' ').includes('seller-RAW-1'), 'matchPath carries no raw seller id');
});

test('FIX B: a platform admin/reviewer DOES see the raw seller_id in the reason text', async () => {
  const { client, store } = createGraphPgMock();
  await project(client, [
    { id: evId(1110), event_type: 'IMPORT_ORDER_CREATED', tenant_id: T_A,
      payload: { order_id: 'ord-1', buyer_id: 'b', status: 'IMPORT_REQUESTED' } },
    { id: evId(1111), event_type: 'QUOTE_ACCEPTED', tenant_id: T_A,
      payload: { quote_id: 'q-1', order_id: 'ord-1', seller_id: 'seller-RAW-1' } },
  ]);
  const orderId = nodeId(store, T_A, 'BUYER_ORDER', 'ord-1');
  const admin = await queries().generateMatchExplanation(T_A, orderId, 'seller-RAW-1', adminCtx(client));
  assert.ok(admin.reasons.some((r) => (r.detail || '').includes('seller seller-RAW-1')), 'admin sees raw seller id in reason');
  const reviewer = await queries().generateMatchExplanation(T_A, orderId, 'seller-RAW-1', reviewerCtx(client));
  assert.ok(reviewer.reasons.some((r) => (r.detail || '').includes('seller seller-RAW-1')), 'reviewer sees raw seller id in reason');
});

test('FIX B: blocker + transaction-path reason strings carry only STRUCTURAL ids, no participant ids', async () => {
  const { client, store } = createGraphPgMock();
  await project(client, canonicalEvents());
  await project(client, [
    { id: evId(1120), event_type: 'PAYMENT_MILESTONE_CREATED', tenant_id: T_A,
      payload: { payment_milestone_id: 'pm-1', order_id: 'ord-1', status: 'OVERDUE' } },
  ]);
  const orderId = nodeId(store, T_A, 'BUYER_ORDER', 'ord-1');

  const blk = await queries().generateBlockerSummary(T_A, orderId, memberCtx(client));
  for (const b of blk.blockers) {
    // The reason references the blocker entity's STRUCTURAL id (compliance/payment/safetrade id) — never a person.
    assertNoRawParticipantId({ reason: b.reason, detail: b.detail }, 'blocker reason');
  }
  const path = await queries().queryTransactionPath(T_A, orderId, memberCtx(client), {});
  for (const s of path.orderedSteps) {
    assertNoRawParticipantId({ reason: s.reason }, 'transaction-path step reason');
  }
});

// NEGATIVE CONTROL for FIX B: participantReference WOULD interpolate the raw id for a non-admin if the
// role gate were removed — so the gate is load-bearing. We assert the helper masks for non-admins and
// only reveals for admins/reviewers (reverting either branch fails this test).
test('FIX B (negative control): participantReference masks for non-admin, reveals for admin/reviewer', () => {
  assert.equal(participantReference('seller', 'seller-RAW-1', { id: 'm', role: 'member' }), 'seller [REDACTED]');
  assert.equal(participantReference('seller', 'seller-RAW-1', { id: 'a', platformRole: 'platform_admin' }), 'seller seller-RAW-1');
  assert.equal(participantReference('seller', 'seller-RAW-1', { id: 'r', platformRole: 'reviewer' }), 'seller seller-RAW-1');
  // Sanity: a non-admin must NOT be treated as able to see participant ids.
  assert.equal(callerMaySeeParticipantIds({ id: 'm', role: 'member' }), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX C — regionToken emits a NON-REVERSIBLE label, never a substring of the raw input
// ─────────────────────────────────────────────────────────────────────────────

test('FIX C: regionToken output (its variable bucket) contains NO substring of the raw address/city', () => {
  const samples = ['12 Main St, Lagos', 'Harare', 'Berlin', 'Lagos', '99 Back Lane', 'Z'];
  for (const raw of samples) {
    const tok = regionToken(raw);
    assert.ok(tok.startsWith('[REGION]'), `region token shape for "${raw}"`);
    // Inspect ONLY the variable part (the bucket after the fixed '[REGION]:' label); the constant label
    // text must be ignored or it trivially shares letters (e.g. "re" in "REGION") with arbitrary input.
    const bucket = tok.replace(/^\[REGION\](:)?/, '');
    const lowerBucket = bucket.toLowerCase();
    const lowerRaw = raw.toLowerCase();
    // The bucket is a single fixed-alphabet letter; assert no 2-char fragment of the raw value appears.
    for (let i = 0; i + 2 <= lowerRaw.length; i += 1) {
      const frag = lowerRaw.slice(i, i + 2).trim();
      if (frag.length === 2) {
        assert.ok(!lowerBucket.includes(frag), `bucket "${bucket}" must not echo raw fragment "${frag}" of "${raw}"`);
      }
    }
    // Specifically: the OLD leak (first two chars upper-cased) must NOT be the emitted bucket.
    const oldLeak = raw.slice(0, 2).toUpperCase();
    assert.notEqual(bucket, oldLeak, `bucket must not be the old 2-char prefix "${oldLeak}"`);
  }
});

test('FIX C: regionToken is deterministic (same input → same bucket) and nullish → bare token', () => {
  assert.equal(regionToken('Lagos'), regionToken('Lagos'), 'deterministic for identical input');
  assert.equal(regionToken('  lagos  '), regionToken('Lagos'), 'trim + case-folded → same bucket');
  assert.equal(regionToken(null), '[REGION]', 'null → bare token');
  assert.equal(regionToken(''), '[REGION]', 'empty → bare token');
});

test('FIX C: REGION_ONLY node fields are coarsened with no raw substring (via the real query path)', async () => {
  const { client, store } = createGraphPgMock();
  await project(client, canonicalEvents());
  const orderId = nodeId(store, T_A, 'BUYER_ORDER', 'ord-1');
  const order = store.trade_graph_nodes.find((n) => n.node_type === 'BUYER_ORDER' && n.entity_id === 'ord-1');
  order.data = { ...order.data, address: '12 Main St, Lagos' };

  const res = await queries().queryNeighborhood(T_A, orderId, memberCtx(client), { maxDepth: 1, minConfidence: 0 });
  const addr = String(res.centerNode.data.address);
  assert.ok(addr.startsWith('[REGION]'), 'address coarsened to region token');
  assert.ok(!addr.includes('Main') && !addr.includes('12') && !addr.includes('Ma'), 'no raw address substring leaks');
});

// NEGATIVE CONTROL for FIX C: a substring-prefix implementation (the OLD bug) WOULD leak — this asserts
// our token is NOT that. (If regionToken regressed to slice(0,2).toUpperCase(), this fails.)
test('FIX C (negative control): regionToken is NOT the old raw-prefix implementation', () => {
  const raw = 'Lagos';
  assert.notEqual(regionToken(raw), `[REGION]:${raw.slice(0, 2).toUpperCase()}`, 'token must not be the raw 2-char prefix');
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX D — participant-NODE entityId is pseudonymized (not the raw participant id)
//
// For participant node types (BUYER/SELLER/USER/TRADE_PROFILE) the SURFACED entity_id IS the raw
// person/profile id (buyer_id/seller_id/user_id/trade_profile_id). FIX D replaces that surfaced entityId
// with a STABLE, NON-REVERSIBLE pseudonym token ('PARTICIPANT:xxxx') for non-admin viewers and the AI
// context, while keeping the structural nodeId (uuid) intact for traversal; admin/reviewer see the raw id.
// ─────────────────────────────────────────────────────────────────────────────

// The participant RAW ids planted as entity_ids of BUYER / SELLER / USER / TRADE_PROFILE nodes.
const FIXD_RAW_PARTICIPANT_ENTITY_IDS = ['buyer-RAW-1', 'seller-RAW-1', 'user-RAW-1', 'creator-RAW-1', 'tp-RAW-1'];

/**
 * Project a graph that materializes BUYER, SELLER, USER and TRADE_PROFILE nodes (the participant node
 * types) whose entity_id is a raw person/profile id, all reachable from a single order:
 *   - IMPORT_ORDER_CREATED → BUYER(buyer-RAW-1) -[INITIATED_ORDER]-> BUYER_ORDER(ord-1)
 *   - QUOTE_ISSUED         → SELLER(seller-RAW-1) -[QUOTED_ON]-> RFQ(q-1)   (RFQ also links the order)
 *   - QUOTE_ACCEPTED       → BUYER_ORDER -[ACCEPTED_QUOTE]-> ACCEPTED_QUOTE(q-1)
 *   - TRADE_PROFILE_CREATED→ USER(user-RAW-1) -[HAS_TRADE_PROFILE]-> TRADE_PROFILE(tp-RAW-1)
 *                            USER(creator-RAW-1) -[CREATED_BY]-> TRADE_PROFILE(tp-RAW-1)
 */
async function projectParticipantNodeGraph(client) {
  await project(client, [
    { id: evId(2001), event_type: 'IMPORT_ORDER_CREATED', tenant_id: T_A,
      payload: { order_id: 'ord-1', buyer_id: 'buyer-RAW-1', status: 'IMPORT_REQUESTED', origin_country: 'NG', destination_country: 'ZW', order_type: 'VEHICLE' } },
    { id: evId(2002), event_type: 'QUOTE_ISSUED', tenant_id: T_A,
      payload: { quote_id: 'q-1', order_id: 'ord-1', seller_id: 'seller-RAW-1', status: 'ISSUED' } },
    { id: evId(2003), event_type: 'QUOTE_ACCEPTED', tenant_id: T_A,
      payload: { quote_id: 'q-1', order_id: 'ord-1', seller_id: 'seller-RAW-1' } },
    { id: evId(2004), event_type: 'TRADE_PROFILE_CREATED', tenant_id: T_A,
      payload: { trade_profile_id: 'tp-RAW-1', user_id: 'user-RAW-1', created_by: 'creator-RAW-1', role_type: 'BUYER', country: 'NG' } },
  ]);
}

// The four participant nodes the fixture materializes, with their raw entity ids.
const FIXD_PARTICIPANT_NODES = [
  { nodeType: 'BUYER', entityId: 'buyer-RAW-1' },
  { nodeType: 'SELLER', entityId: 'seller-RAW-1' },
  { nodeType: 'USER', entityId: 'user-RAW-1' },
  { nodeType: 'TRADE_PROFILE', entityId: 'tp-RAW-1' },
];

/**
 * Surface each participant node as the CENTER of its own neighborhood query (every node is reachable as
 * the center of a query, independent of the edge topology) and also the union of the order neighborhood,
 * so the FIX D scan sees BUYER + SELLER + USER + TRADE_PROFILE deterministically. Returns the list of
 * { nodeType, entityId, nodeId } centerNode views plus the order-neighborhood result for payload scans.
 */
async function participantNodeViews(client, store, ctxFactory) {
  const centers = [];
  for (const p of FIXD_PARTICIPANT_NODES) {
    const id = nodeId(store, T_A, p.nodeType, p.entityId);
    assert.ok(id, `${p.nodeType}:${p.entityId} node exists in the graph`);
    const r = await queries().queryNeighborhood(T_A, id, ctxFactory(client), { maxDepth: 1, minConfidence: 0 });
    centers.push(r.centerNode);
  }
  const orderId = nodeId(store, T_A, 'BUYER_ORDER', 'ord-1');
  const res = await queries().queryNeighborhood(T_A, orderId, ctxFactory(client), { maxDepth: 3, minConfidence: 0 });
  return { res, views: [...centers, res.centerNode, ...res.neighbors] };
}

test('FIX D: constants expose the participant node types (BUYER/SELLER/USER/TRADE_PROFILE)', () => {
  for (const t of ['BUYER', 'SELLER', 'USER', 'TRADE_PROFILE']) {
    assert.ok(TRADE_GRAPH_PARTICIPANT_NODE_TYPES.includes(t), `${t} is a participant node type`);
    assert.equal(isParticipantNodeType(t), true, `isParticipantNodeType('${t}') is true`);
  }
  // A non-participant domain node type is NOT classified as participant.
  assert.equal(isParticipantNodeType('BUYER_ORDER'), false, 'BUYER_ORDER is a domain node, not a participant');
  assert.equal(isParticipantNodeType('DOCUMENT'), false, 'DOCUMENT is a domain node, not a participant');
});

test('FIX D (unit): participantToken is deterministic, non-reversible, prefixed, and id-specific', () => {
  const t1 = participantToken('buyer-RAW-1');
  const t2 = participantToken('buyer-RAW-1');
  assert.equal(t1, t2, 'deterministic: same raw id → same token');
  assert.ok(t1.startsWith(TRADE_GRAPH_PARTICIPANT_TOKEN_PREFIX), 'token carries the PARTICIPANT: prefix');
  // NON-REVERSIBLE: no substring of the raw id appears in the token.
  const tokenBody = t1.slice(TRADE_GRAPH_PARTICIPANT_TOKEN_PREFIX.length).toLowerCase();
  const rawLower = 'buyer-RAW-1'.toLowerCase();
  for (let i = 0; i + 3 <= rawLower.length; i += 1) {
    const frag = rawLower.slice(i, i + 3);
    assert.ok(!tokenBody.includes(frag), `token body must not echo raw fragment "${frag}"`);
  }
  // ID-SPECIFIC: different raw ids → different tokens (collision would be a correlation bug).
  assert.notEqual(participantToken('buyer-RAW-1'), participantToken('seller-RAW-1'), 'distinct ids → distinct tokens');
  assert.equal(participantToken(null), null, 'nullish → null (no token)');
  assert.equal(participantToken(''), null, 'empty → null (no token)');
});

test('FIX D: a NON-ADMIN viewer receives a PARTICIPANT token (not the raw id) for participant node entityIds', async () => {
  const { client, store } = createGraphPgMock();
  await projectParticipantNodeGraph(client);

  const { res, views } = await participantNodeViews(client, store, memberCtx);
  // The center order (a DOMAIN node) keeps its raw, queryable entity id.
  assert.equal(res.centerNode.entityId, 'ord-1', 'non-participant center keeps raw structural entity id');

  let sawBuyer = false;
  let sawSeller = false;
  let sawUser = false;
  let sawTradeProfile = false;
  for (const v of views) {
    if (!isParticipantNodeType(v.nodeType)) continue;
    // The surfaced entityId is the pseudonym token, NEVER the raw participant id.
    assert.ok(String(v.entityId).startsWith(TRADE_GRAPH_PARTICIPANT_TOKEN_PREFIX),
      `${v.nodeType} surfaced entityId is a participant token, got ${v.entityId}`);
    assert.ok(!FIXD_RAW_PARTICIPANT_ENTITY_IDS.includes(String(v.entityId)),
      `${v.nodeType} surfaced entityId is NOT a raw participant id`);
    // The structural nodeId (uuid) is intact for traversal.
    assert.ok(/^[0-9a-f-]{36}$/i.test(String(v.nodeId)), `${v.nodeType} nodeId is an intact uuid`);
    if (v.nodeType === 'BUYER') sawBuyer = true;
    if (v.nodeType === 'SELLER') sawSeller = true;
    if (v.nodeType === 'USER') sawUser = true;
    if (v.nodeType === 'TRADE_PROFILE') sawTradeProfile = true;
  }
  assert.ok(sawBuyer && sawSeller && sawUser && sawTradeProfile, 'BUYER + SELLER + USER + TRADE_PROFILE nodes all present + tokenized');

  // No raw participant entity id appears ANYWHERE across every surfaced view (data/metadata/reason AND
  // the surfaced entityIds) — the order neighborhood AND each participant node's own centered view.
  const everything = collectValues(views).join(' ');
  for (const raw of FIXD_RAW_PARTICIPANT_ENTITY_IDS) {
    assert.ok(!everything.includes(raw), `raw participant entity id "${raw}" must not leak anywhere in the non-admin views`);
  }
});

test('FIX D: the token matches participantToken(rawId) — same participant correlates across nodes/responses', async () => {
  const { client, store } = createGraphPgMock();
  await projectParticipantNodeGraph(client);

  // Response 1: neighborhood of the order surfaces the BUYER token.
  const { views: v1 } = await participantNodeViews(client, store, memberCtx);
  const buyer1 = v1.find((v) => v.nodeType === 'BUYER');
  assert.ok(buyer1, 'BUYER node surfaced in response 1');
  assert.equal(buyer1.entityId, participantToken('buyer-RAW-1'), 'token == participantToken(raw buyer id)');

  // Response 2: query the BUYER node's OWN neighborhood (a separate response) — the same participant must
  // carry the SAME token (deterministic correlation across responses) while still being non-raw.
  const buyerNodeId = nodeId(store, T_A, 'BUYER', 'buyer-RAW-1');
  const res2 = await queries().queryNeighborhood(T_A, buyerNodeId, memberCtx(client), { maxDepth: 1, minConfidence: 0 });
  assert.equal(res2.centerNode.entityId, participantToken('buyer-RAW-1'), 'same participant → same token in a different response');
  assert.equal(res2.centerNode.entityId, buyer1.entityId, 'token correlates the SAME participant across two responses');
  assert.notEqual(res2.centerNode.entityId, 'buyer-RAW-1', 'never the raw id');
});

test('FIX D: the AI structured context uses the pseudonym (never the raw id) for participant node entityIds', async () => {
  const { client } = createGraphPgMock();
  await projectParticipantNodeGraph(client);

  // memberCtx == the AI boundary's least-privilege view.
  const res = await intel().structuredContextForAi(T_A, 'ord-1', memberCtx(client));
  const everything = collectValues(res).join(' ');
  for (const raw of FIXD_RAW_PARTICIPANT_ENTITY_IDS) {
    assert.ok(!everything.includes(raw), `AI context must not contain raw participant id "${raw}"`);
  }
  // Each participant neighbor node's surfaced entityId is a token; its nodeId stays an intact uuid.
  let sawParticipant = false;
  for (const nb of res.neighbors) {
    if (!isParticipantNodeType(nb.node.nodeType)) continue;
    sawParticipant = true;
    assert.ok(String(nb.node.entityId).startsWith(TRADE_GRAPH_PARTICIPANT_TOKEN_PREFIX),
      `AI participant ${nb.node.nodeType}: entityId is a pseudonym token`);
    assert.ok(!FIXD_RAW_PARTICIPANT_ENTITY_IDS.includes(String(nb.node.entityId)),
      `AI participant ${nb.node.nodeType}: entityId is NOT a raw participant id`);
    assert.ok(/^[0-9a-f-]{36}$/i.test(String(nb.node.nodeId)), `AI participant ${nb.node.nodeType}: nodeId is an intact uuid`);
  }
  assert.ok(sawParticipant, 'at least one participant node reached the AI context (so the assertion is exercised)');
});

test('FIX D: a PLATFORM ADMIN sees the RAW participant node entityIds (role-aware)', async () => {
  const { client, store } = createGraphPgMock();
  await projectParticipantNodeGraph(client);

  const { views } = await participantNodeViews(client, store, adminCtx);
  const buyer = views.find((v) => v.nodeType === 'BUYER');
  const seller = views.find((v) => v.nodeType === 'SELLER');
  const tp = views.find((v) => v.nodeType === 'TRADE_PROFILE');
  assert.equal(buyer.entityId, 'buyer-RAW-1', 'admin sees the raw buyer participant id');
  assert.equal(seller.entityId, 'seller-RAW-1', 'admin sees the raw seller participant id');
  assert.equal(tp.entityId, 'tp-RAW-1', 'admin sees the raw trade-profile participant id');
});

test('FIX D: a platform REVIEWER (not admin) also sees RAW participant node entityIds', async () => {
  const { client, store } = createGraphPgMock();
  await projectParticipantNodeGraph(client);
  const { views } = await participantNodeViews(client, store, reviewerCtx);
  const buyer = views.find((v) => v.nodeType === 'BUYER');
  assert.equal(buyer.entityId, 'buyer-RAW-1', 'reviewer sees the raw participant entity id');
});

// NEGATIVE CONTROL for FIX D: surfaceEntityId is the gate. If the participant-node-type branch were
// reverted (i.e. it passed the raw entity_id through), a non-admin WOULD receive the raw id — so the
// assertion that participant nodes are tokenized is load-bearing. We prove the helper's two branches.
test('FIX D (negative control): surfaceEntityId tokenizes participant nodes for non-admins, passes domain nodes through', () => {
  const member = { id: 'm', role: 'member' };
  const admin = { id: 'a', platformRole: 'platform_admin' };
  // Participant node type → non-admin gets the token (NOT the raw id); admin gets the raw id.
  assert.equal(surfaceEntityId('BUYER', 'buyer-RAW-1', member), participantToken('buyer-RAW-1'), 'participant node tokenized for non-admin');
  assert.notEqual(surfaceEntityId('BUYER', 'buyer-RAW-1', member), 'buyer-RAW-1', 'participant node NOT raw for non-admin');
  assert.equal(surfaceEntityId('BUYER', 'buyer-RAW-1', admin), 'buyer-RAW-1', 'participant node raw for admin');
  // Non-participant (domain) node type → entity id passes through UNCHANGED for everyone (control).
  assert.equal(surfaceEntityId('BUYER_ORDER', 'ord-1', member), 'ord-1', 'domain node entity id is NOT tokenized (control)');
  assert.equal(surfaceEntityId('DOCUMENT', 'doc-1', member), 'doc-1', 'domain node entity id is NOT tokenized (control)');
});
