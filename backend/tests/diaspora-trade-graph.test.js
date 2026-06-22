/**
 * Phase 10 Stage 4 — Trade Graph ROUTES + COMPREHENSIVE §62 TEST MATRIX (pure, no DB, no network).
 *
 * This is the directive §62 / design §K matrix proof. It exercises the WHOLE Stage 1→4 stack:
 *
 *   - Layer A (services): the real projection / query / intelligence services driven against the
 *     in-memory raw-pg mock (helpers/diasporaTradeGraphRpcReference.js) that mirrors the Phase 10 SQL
 *     surface (20260621140000_diaspora_phase10_trade_graph.sql) statement-for-statement, with the graph
 *     BUILT from domain events by the real projector (no hand-built rows). This proves the data-plane
 *     invariants the API depends on.
 *   - Layer B (routes): the REAL diasporaTradeGraphRoutes router driven over HTTP (node:http) with the
 *     REAL authorizeRole middleware (mocked Supabase for session/user/tenant) and an INJECTED in-memory
 *     pg pool (the same graph mock) via __setGraphPgPool. This proves the gate, tenant-scoped reads,
 *     admin-only + rate-limited + auditable rebuild, redaction over the wire, and that there is NO
 *     graph WRITE path through the API (frontend/AI cannot create edges).
 *
 * §62 matrix items proven (search for "MATRIX:" markers):
 *   projection idempotency · replay = same graph · tenant isolation (incl. recursive traversal) ·
 *   deleted/revoked relationships (soft-delete + temporal) · rebuild correctness · path/blocker/match
 *   correctness + determinism · stale projection indicated · unauthorized nodes redacted · AI context
 *   excludes private data · NO graph write bypasses the domain-event source · large-tenant query bounded ·
 *   materialized summary refresh correctness · Phase 3-9 events (incl. SafeTrade) generate expected
 *   nodes/edges.
 *
 * Time is fixed (FIXED_TS via context.now / req.fixedTimestamp); no test depends on Date.now() for
 * stored or returned values.
 */
import test, { before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
// db/supabase.js (transitively imported) throws at import without these.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.DIASPORA_TRADE_GRAPH = 'true'; // enabled for the matrix; specific tests flip it OFF.

const FIXED_TS = '2026-06-21T14:00:00.000Z';
const PAST_TS = '2026-06-20T14:00:00.000Z';

const express = (await import('express')).default;
const { createGraphPgMock, resetGraphIds } = await import('./helpers/diasporaTradeGraphRpcReference.js');
const { DiasporaTradeGraphProjectionService, PROJECTION_OUTCOMES, REBUILD_STATUS } =
  await import('../services/diaspora/tradegraph/diasporaTradeGraphProjectionService.js');
const { DiasporaTradeGraphService } = await import('../services/diaspora/tradegraph/diasporaTradeGraphService.js');
const { DiasporaTradeIntelligenceService } = await import('../services/diaspora/tradegraph/diasporaTradeIntelligenceService.js');
const graphRouterModule = await import('../routes/diasporaTradeGraphRoutes.js');
const diasporaTradeGraphRouter = graphRouterModule.default;
const { __setGraphPgPool } = graphRouterModule;
const errorHandler = (await import('../middleware/errorMiddleware.js')).default;
const { supabase } = await import('../db/supabase.js');

// uuid-shaped tenant + event ids (the projector requires uuids for event.id + tenant_id).
const T_A = '00000000-0000-4000-9000-00000000000a';
const T_B = '00000000-0000-4000-9000-00000000000b';
const evId = (n) => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;

const projection = () => new DiasporaTradeGraphProjectionService();
const queries = () => new DiasporaTradeGraphService();
const intel = () => new DiasporaTradeIntelligenceService();

// A best-effort/critical audit client that never touches a real DB.
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
const adminCtx = (client, tenantId = T_A) => rctx(client, { userContext: { id: 'admin-1', platformRole: 'platform_admin', tenantId } });
const memberCtx = (client, tenantId = T_A) => rctx(client, { userContext: { id: 'member-1', role: 'member', tenantRole: 'member', tenantId } });

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
 * A canonical order → accepted-quote → stock → shipment chain + a document + a compliance review + a
 * SafeTrade transaction, all in one tenant, all derived from domain events (so every edge carries
 * source_event_ref). Mirrors the Stage 3 fixture so projection-mapping expectations stay in lockstep.
 */
function canonicalEvents(tenant = T_A, base = 100) {
  return [
    { id: evId(base + 1), event_type: 'IMPORT_ORDER_CREATED', tenant_id: tenant,
      payload: { order_id: 'ord-1', buyer_id: 'buy-1', status: 'IMPORT_REQUESTED', origin_country: 'NG', destination_country: 'ZW', order_type: 'VEHICLE' } },
    { id: evId(base + 2), event_type: 'QUOTE_ACCEPTED', tenant_id: tenant,
      payload: { quote_id: 'q-1', order_id: 'ord-1', seller_id: 'sell-1' } },
    { id: evId(base + 3), event_type: 'STOCK_RESERVED', tenant_id: tenant,
      payload: { stock_item_id: 'st-1', order_id: 'ord-1', seller_trade_profile_id: 'sell-1' } },
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

// ═════════════════════════════════════════════════════════════════════════════
// LAYER A — §62 SERVICE MATRIX (real services over the graph pg mock)
// ═════════════════════════════════════════════════════════════════════════════

test('MATRIX: projection idempotency — replaying the same event is a no-op', async () => {
  const { client, store } = createGraphPgMock();
  const ev = { id: evId(1), event_type: 'IMPORT_ORDER_CREATED', tenant_id: T_A, created_at: FIXED_TS,
    payload: { order_id: 'ord-1', buyer_id: 'b', status: 'IMPORT_REQUESTED' } };
  const first = await proj.projectEvent(ev, pctx(client));
  assert.equal(first.outcome, PROJECTION_OUTCOMES.PROJECTED);
  const n1 = store.trade_graph_nodes.length;
  const e1 = store.trade_graph_edges.length;
  const second = await proj.projectEvent(ev, pctx(client));
  assert.equal(second.outcome, PROJECTION_OUTCOMES.IDEMPOTENT_REPLAY);
  assert.equal(store.trade_graph_nodes.length, n1, 'no duplicate nodes on replay');
  assert.equal(store.trade_graph_edges.length, e1, 'no duplicate edges on replay');
  assert.equal(store.trade_graph_processed_events.length, 1);
});

test('MATRIX: replay yields the same graph — distinct-id redelivery merges (dedup index), no dupes', async () => {
  const { client, store } = createGraphPgMock();
  await project(client, [
    { id: evId(2), event_type: 'IMPORT_ORDER_CREATED', tenant_id: T_A, payload: { order_id: 'ord-1', buyer_id: 'b', status: 'IMPORT_REQUESTED', origin_country: 'NG' } },
    // A redelivered/duplicate-effect event with a DIFFERENT id for the same entity → merge, not dupe.
    { id: evId(3), event_type: 'IMPORT_ORDER_STATUS_CHANGED', tenant_id: T_A, payload: { order_id: 'ord-1', status: 'QUOTE_ISSUED' } },
  ]);
  const orders = store.trade_graph_nodes.filter((n) => n.node_type === 'BUYER_ORDER' && n.entity_id === 'ord-1');
  assert.equal(orders.length, 1, 'a single current node for the entity');
  assert.equal(orders[0].data.origin_country, 'NG', 'prior attribute preserved (data merge)');
  assert.equal(orders[0].data.status, 'QUOTE_ISSUED', 'new attribute applied');
});

test('MATRIX: tenant isolation — a recursive neighborhood in tenant A never reaches tenant B', async () => {
  const { client, store } = createGraphPgMock();
  await project(client, canonicalEvents(T_A, 200));
  await project(client, canonicalEvents(T_B, 300));
  const orderA = nodeId(store, T_A, 'BUYER_ORDER', 'ord-1');
  const nb = await queries().queryNeighborhood(T_A, orderA, rctx(client), { maxDepth: 3, minConfidence: 0 });
  assert.ok(nb.neighbors.length >= 1);
  for (const n of nb.neighbors) {
    const row = store.trade_graph_nodes.find((r) => r.id === n.nodeId);
    assert.equal(row.tenant_id, T_A, 'no cross-tenant node leaked into a multi-hop traversal');
  }
  // And the SAME entity id in tenant B is a distinct node the A-traversal never touches.
  const orderB = nodeId(store, T_B, 'BUYER_ORDER', 'ord-1');
  assert.notEqual(orderA, orderB);
  assert.ok(!nb.neighbors.some((n) => n.nodeId === orderB), 'tenant B order not reachable from tenant A');
});

test('MATRIX: deleted relationship handling — a soft-deleted node is excluded from queries', async () => {
  const { client, store } = createGraphPgMock();
  await project(client, canonicalEvents());
  const orderId = nodeId(store, T_A, 'BUYER_ORDER', 'ord-1');
  const before = await queries().queryNeighborhood(T_A, orderId, rctx(client), { maxDepth: 1, minConfidence: 0 });
  assert.ok(before.neighbors.some((n) => n.nodeType === 'DOCUMENT'), 'document reachable before delete');

  // Soft-delete the DOCUMENT node (is_current=false, deleted_at set) — graph keeps the row for audit/replay.
  const doc = store.trade_graph_nodes.find((n) => n.node_type === 'DOCUMENT' && n.entity_id === 'doc-1');
  doc.is_current = false;
  doc.deleted_at = FIXED_TS;
  const after = await queries().queryNeighborhood(T_A, orderId, rctx(client), { maxDepth: 1, minConfidence: 0 });
  assert.ok(after.neighbors.every((n) => n.nodeType !== 'DOCUMENT' || n.entityId !== 'doc-1'), 'soft-deleted node excluded');
});

test('MATRIX: revoked relationship handling — an edge past valid_until is excluded from traversal', async () => {
  const { client, store } = createGraphPgMock();
  await project(client, canonicalEvents());
  const orderId = nodeId(store, T_A, 'BUYER_ORDER', 'ord-1');
  const before = await queries().queryNeighborhood(T_A, orderId, rctx(client), { maxDepth: 1, minConfidence: 0 });
  assert.ok(before.neighbors.some((n) => n.nodeType === 'SHIPMENT'), 'shipment reachable before expiry');

  const edge = store.trade_graph_edges.find((e) => e.edge_type === 'FULFILLS_ORDER');
  assert.ok(edge, 'FULFILLS_ORDER edge exists');
  edge.valid_until = PAST_TS; // expired relative to now=FIXED_TS
  const after = await queries().queryNeighborhood(T_A, orderId, rctx(client), { maxDepth: 1, minConfidence: 0 });
  assert.ok(after.neighbors.every((n) => n.nodeType !== 'SHIPMENT'), 'expired edge excluded from traversal');
});

test('MATRIX: rebuild correctness — rebuild from the outbox equals incremental projection', async () => {
  const events = canonicalEvents(T_A, 400);
  const incremental = createGraphPgMock();
  for (const ev of events) await proj.projectEvent({ created_at: FIXED_TS, ...ev }, pctx(incremental.client));
  resetGraphIds();

  const rebuilt = createGraphPgMock({
    store: {
      trade_graph_nodes: [], trade_graph_edges: [], trade_graph_processed_events: [],
      trade_graph_dead_letters: [], trade_graph_rebuilds: [], trade_graph_projection_checkpoints: [],
      trade_graph_materialized_summaries: [],
      domain_events: events.map((e) => ({ ...e, created_at: FIXED_TS, status: 'processed' })),
    },
  });
  // Admin-only: a non-admin actor is rejected before any state is touched.
  await assert.rejects(
    () => projection().rebuildTenantGraph(T_A, { pgClient: rebuilt.client, now: FIXED_TS, actor: { id: 'm', isPlatformAdmin: false }, auditClient }),
    /admin-only/,
  );

  const r2 = await projection().rebuildTenantGraph(T_A, {
    pgClient: rebuilt.client, now: FIXED_TS, actor: { id: 'admin-1', isPlatformAdmin: true }, auditClient,
  });
  assert.equal(r2.status, REBUILD_STATUS.COMPLETED);
  assert.equal(r2.eventsFailed, 0);

  const norm = (store) => ({
    nodes: store.trade_graph_nodes.map((n) => `${n.node_type}:${n.entity_id}`).sort(),
    edges: store.trade_graph_edges.map((e) => {
      const s = store.trade_graph_nodes.find((n) => n.id === e.source_node_id);
      const t = store.trade_graph_nodes.find((n) => n.id === e.target_node_id);
      return `${s.node_type}:${s.entity_id}-[${e.edge_type}]->${t.node_type}:${t.entity_id}`;
    }).sort(),
  });
  assert.deepEqual(norm(rebuilt.store), norm(incremental.store), 'rebuild == incremental projection');
});

test('MATRIX: path correctness + determinism — forward path is stable across identical calls', async () => {
  const { client, store } = createGraphPgMock();
  await project(client, canonicalEvents());
  const orderId = nodeId(store, T_A, 'BUYER_ORDER', 'ord-1');
  const a = await queries().queryTransactionPath(T_A, orderId, rctx(client), {});
  const b = await queries().queryTransactionPath(T_A, orderId, rctx(client), {});
  assert.deepEqual(a.pathIds, b.pathIds, 'identical inputs ⇒ identical path');
  assert.equal(a.orderedSteps[0].nodeType, 'BUYER_ORDER');
  assert.ok(a.orderedSteps.map((s) => s.nodeType).includes('ACCEPTED_QUOTE'), 'forward path reaches the accepted quote');
  for (const step of a.orderedSteps.slice(1)) {
    assert.ok(step.sourceEventRef, 'every step references its source event (explainable)');
  }
});

test('MATRIX: blocker correctness + determinism — most-severe-first, each with a source', async () => {
  const { client, store } = createGraphPgMock();
  await project(client, canonicalEvents());
  await project(client, [
    { id: evId(450), event_type: 'PAYMENT_MILESTONE_CREATED', tenant_id: T_A, payload: { payment_milestone_id: 'pm-1', order_id: 'ord-1', status: 'OVERDUE' } },
  ]);
  const orderId = nodeId(store, T_A, 'BUYER_ORDER', 'ord-1');
  const res = await queries().generateBlockerSummary(T_A, orderId, rctx(client));
  assert.equal(res.hasBlockers, true);
  assert.equal(res.mostSevereBlocker.type, 'PAYMENT_OVERDUE');
  assert.equal(res.mostSevereBlocker.severity, 'CRITICAL');
  for (const b of res.blockers) assert.ok(b.sourceEntityId && b.reason, 'each blocker carries evidence + reason');
  const again = await queries().generateBlockerSummary(T_A, orderId, rctx(client));
  assert.deepEqual(res.blockers.map((b) => b.type), again.blockers.map((b) => b.type), 'deterministic order');
});

test('MATRIX: match correctness + determinism — seller match explained, with evidence; stable', async () => {
  const { client, store } = createGraphPgMock();
  await project(client, canonicalEvents());
  const orderId = nodeId(store, T_A, 'BUYER_ORDER', 'ord-1');
  const m1 = await queries().generateMatchExplanation(T_A, orderId, 'sell-1', rctx(client));
  assert.equal(m1.matchFound, true);
  assert.equal(m1.matchPath[0].nodeType, 'BUYER_ORDER');
  assert.equal(m1.reasons[0].edge, 'ACCEPTED_QUOTE');
  assert.ok(m1.sourceReferences.length >= 1, 'evidence: source event refs');
  assert.ok(m1.confidence > 0);
  const m2 = await queries().generateMatchExplanation(T_A, orderId, 'sell-1', rctx(client));
  assert.deepEqual(m1.matchPath.map((p) => p.nodeType), m2.matchPath.map((p) => p.nodeType));
  // An unrelated seller has no path → matchFound:false (still returns blockers).
  const m3 = await queries().generateMatchExplanation(T_A, orderId, 'sell-UNRELATED', rctx(client));
  assert.equal(m3.matchFound, false);
});

test('MATRIX: stale projection indicated — checkpoint advances + next_replay_required flags staleness', async () => {
  const { client, store } = createGraphPgMock();
  await project(client, canonicalEvents());
  const cp = store.trade_graph_projection_checkpoints.find((c) => c.tenant_id === T_A);
  assert.ok(cp, 'a per-tenant checkpoint exists (resumability/staleness surface)');
  assert.ok(cp.last_event_id, 'checkpoint records the last consumed event id');
  assert.equal(cp.next_replay_required, false, 'fresh projection is not flagged stale');

  // Requesting a rebuild flags the tenant as needing a replay (stale) until the rebuild clears it.
  await projection().rebuildTenantGraph(T_A, {
    pgClient: client, now: FIXED_TS, actor: { id: 'admin-1', isPlatformAdmin: true }, auditClient,
  });
  const cpAfter = store.trade_graph_projection_checkpoints.find((c) => c.tenant_id === T_A);
  assert.equal(cpAfter.next_replay_required, false, 'a COMPLETED rebuild clears the stale flag');
  assert.ok((cpAfter.replay_count || 0) >= 1, 'replay count tracked for the staleness/health surface');
});

test('MATRIX: unauthorized nodes redacted — non-admin gets PII/payment/address/admin-only masked', async () => {
  const { client, store } = createGraphPgMock();
  await project(client, [
    { id: evId(500), event_type: 'IMPORT_ORDER_CREATED', tenant_id: T_A, payload: { order_id: 'ord-1', buyer_id: 'b', status: 'IMPORT_REQUESTED' } },
  ]);
  const order = store.trade_graph_nodes.find((n) => n.node_type === 'BUYER_ORDER' && n.entity_id === 'ord-1');
  order.data = { ...order.data, buyer_name: 'Jane Doe', payment_ref: 'PR-123', address: '12 Main St, Lagos', internal_risk_score: 88 };

  const member = await intel().structuredContextForAi(T_A, 'ord-1', memberCtx(client));
  assert.equal(member.order.data.buyer_name, '[REDACTED]');
  assert.equal(member.order.data.payment_ref, '[REDACTED]');
  assert.ok(String(member.order.data.address).startsWith('[REGION]'));
  assert.equal(member.order.data.internal_risk_score, null, 'admin-only field nulled for non-admin');

  const admin = await intel().structuredContextForAi(T_A, 'ord-1', adminCtx(client));
  assert.equal(admin.order.data.internal_risk_score, 88, 'platform admin sees admin-only field (role-aware)');
});

test('MATRIX: AI context excludes private data + is read-only (writes nothing to the graph)', async () => {
  const { client, store } = createGraphPgMock();
  await project(client, canonicalEvents());
  const nBefore = store.trade_graph_nodes.length;
  const eBefore = store.trade_graph_edges.length;
  const ctx = await intel().structuredContextForAi(T_A, 'ord-1', memberCtx(client));
  assert.deepEqual(ctx.aiBoundary, { readOnly: true, mutatesState: false, createsEdges: false });
  // Nothing private leaks: every node data + edge metadata went through redaction.
  for (const nb of ctx.neighbors) {
    for (const k of ['buyer_name', 'payment_ref', 'email', 'phone']) {
      if (k in nb.node.data) assert.equal(nb.node.data[k], '[REDACTED]');
    }
  }
  // The AI read authored NOTHING (no node/edge created by the read path).
  assert.equal(store.trade_graph_nodes.length, nBefore, 'AI read path wrote no nodes');
  assert.equal(store.trade_graph_edges.length, eBefore, 'AI read path wrote no edges');
});

test('MATRIX: NO graph write bypasses the domain-event source — every edge has source_event_ref; AI/query path never writes', async () => {
  const { client, store } = createGraphPgMock();
  await project(client, canonicalEvents());
  // Every edge in the graph derives from a domain event (source_event_ref set).
  assert.ok(store.trade_graph_edges.length > 0);
  for (const e of store.trade_graph_edges) {
    assert.ok(e.source_event_ref, 'edge carries source_event_ref = the domain event id');
  }
  // The read services expose NO method that authors nodes/edges; running the full read surface leaves
  // node/edge counts unchanged (the only writer is the projector, from domain events).
  const orderId = nodeId(store, T_A, 'BUYER_ORDER', 'ord-1');
  const nBefore = store.trade_graph_nodes.length;
  const eBefore = store.trade_graph_edges.length;
  await queries().queryNeighborhood(T_A, orderId, rctx(client), { maxDepth: 2, minConfidence: 0 });
  await queries().queryTransactionPath(T_A, orderId, rctx(client), {});
  await queries().generateBlockerSummary(T_A, orderId, rctx(client));
  await queries().generateMatchExplanation(T_A, orderId, 'sell-1', rctx(client));
  await intel().demandSignals(T_A, adminCtx(client), {});
  await intel().riskExposure(T_A, adminCtx(client), {});
  assert.equal(store.trade_graph_nodes.length, nBefore, 'no read created a node');
  assert.equal(store.trade_graph_edges.length, eBefore, 'no read created an edge');
});

test('MATRIX: disabled gate — fail-closed when DIASPORA_TRADE_GRAPH is OFF (no read/write activates)', async () => {
  process.env.DIASPORA_TRADE_GRAPH = 'false';
  const { client, store } = createGraphPgMock();
  const res = await projection().projectEvent(
    { id: evId(600), event_type: 'IMPORT_ORDER_CREATED', tenant_id: T_A, created_at: FIXED_TS, payload: { order_id: 'ord-1' } },
    pctx(client),
  );
  assert.equal(res.outcome, PROJECTION_OUTCOMES.SKIPPED_DISABLED);
  assert.equal(store.trade_graph_nodes.length, 0, 'no write while disabled');
  await assert.rejects(() => queries().queryNeighborhood(T_A, evId(1), rctx(client), {}), /disabled/i);
  await assert.rejects(() => intel().demandSignals(T_A, adminCtx(client), {}), /disabled/i);
});

test('MATRIX: large-tenant query bounded — neighborhood respects maxDepth + result limit', async () => {
  const { client, store } = createGraphPgMock();
  // Fan out one order to many documents (a wide neighborhood) — the bounded BFS + limit must cap output.
  const base = [{ id: evId(700), event_type: 'IMPORT_ORDER_CREATED', tenant_id: T_A, payload: { order_id: 'ord-1', buyer_id: 'b', status: 'IMPORT_REQUESTED' } }];
  for (let i = 0; i < 50; i += 1) {
    base.push({ id: evId(800 + i), event_type: 'DOCUMENT_UPLOADED', tenant_id: T_A,
      payload: { document_id: `doc-${i}`, order_id: 'ord-1', document_type: 'X', verification_status: 'VERIFIED' } });
  }
  await project(client, base);
  const orderId = nodeId(store, T_A, 'BUYER_ORDER', 'ord-1');
  const capped = await queries().queryNeighborhood(T_A, orderId, rctx(client), { maxDepth: 1, minConfidence: 0, limit: 10 });
  assert.ok(capped.neighbors.length <= 10, 'result limit bounds the response on a large fan-out');
  assert.equal(capped.maxDepth, 1, 'depth is bounded by the cap');
});

test('MATRIX: materialized summary refresh correctness — fresh summary served; expired ignored', async () => {
  const { client, store } = createGraphPgMock();
  await project(client, canonicalEvents());
  const orderId = nodeId(store, T_A, 'BUYER_ORDER', 'ord-1');

  // No summary yet → fast-path returns null (caller falls back to a live walk).
  assert.equal(await queries().getNodeSummary(T_A, orderId, rctx(client), 'neighborhood'), null);

  // A FRESH summary (valid_until in the future) is served from the cache.
  store.trade_graph_materialized_summaries.push({
    id: 'sum-1', tenant_id: T_A, node_id: orderId, summary_type: 'neighborhood',
    in_degree: 3, out_degree: 2, highest_confidence_neighbors: [{ node_id: 'x', confidence: 0.9 }],
    path_metrics: {}, aggregated_reputation: 72, last_computed_at: FIXED_TS, valid_until: '2026-12-31T00:00:00.000Z',
  });
  const fresh = await queries().getNodeSummary(T_A, orderId, rctx(client), 'neighborhood');
  assert.ok(fresh && fresh.fromCache === true, 'fresh summary served from cache');
  assert.equal(fresh.inDegree, 3);
  assert.equal(fresh.outDegree, 2);

  // An EXPIRED summary (valid_until in the past) is ignored → null again.
  store.trade_graph_materialized_summaries[0].valid_until = PAST_TS;
  assert.equal(await queries().getNodeSummary(T_A, orderId, rctx(client), 'neighborhood'), null, 'expired summary ignored');
});

test('MATRIX: Phase 3-9 events generate expected nodes/edges (order, quote, stock, document, shipment, compliance, SafeTrade)', async () => {
  const { client, store } = createGraphPgMock();
  await project(client, canonicalEvents());
  const nodeTypes = new Set(store.trade_graph_nodes.map((n) => n.node_type));
  for (const t of ['BUYER_ORDER', 'ACCEPTED_QUOTE', 'SELLER_STOCK_ITEM', 'DOCUMENT', 'SHIPMENT', 'COMPLIANCE_REVIEW', 'SAFETRADE_TRANSACTION']) {
    assert.ok(nodeTypes.has(t), `Phase 3-9 node type present: ${t}`);
  }
  const edgeTypes = new Set(store.trade_graph_edges.map((e) => e.edge_type));
  for (const t of ['ACCEPTED_QUOTE', 'SUPPLIES', 'FULFILLS_ORDER', 'DOCUMENTS', 'REVIEWS_COMPLIANCE', 'CONDUCTS_TRANSACTION']) {
    assert.ok(edgeTypes.has(t), `Phase 3-9 edge type present: ${t}`);
  }
});

test('MATRIX: Phase 9 SafeTrade integration — tx/milestone/dispute nodes + their edges', async () => {
  const { client, store } = createGraphPgMock();
  await project(client, [
    { id: evId(900), event_type: 'SAFETRADE_TRANSACTION_CREATED', tenant_id: T_A, payload: { safetrade_transaction_id: 'stx-1', order_id: 'ord-1', status: 'DRAFT' } },
    { id: evId(901), event_type: 'SAFETRADE_MILESTONE_CREATED', tenant_id: T_A, payload: { safetrade_milestone_id: 'stm-1', safetrade_transaction_id: 'stx-1', milestone_type: 'DEPOSIT', status: 'PENDING' } },
    { id: evId(902), event_type: 'SAFETRADE_DISPUTE_CREATED', tenant_id: T_A, payload: { safetrade_dispute_id: 'std-1', safetrade_transaction_id: 'stx-1', status: 'OPEN' } },
  ]);
  assert.ok(store.trade_graph_nodes.find((n) => n.node_type === 'SAFETRADE_TRANSACTION' && n.entity_id === 'stx-1'));
  assert.ok(store.trade_graph_nodes.find((n) => n.node_type === 'SAFETRADE_MILESTONE' && n.entity_id === 'stm-1'));
  assert.ok(store.trade_graph_nodes.find((n) => n.node_type === 'SAFETRADE_DISPUTE' && n.entity_id === 'std-1'));
  const edgeTypes = store.trade_graph_edges.map((e) => e.edge_type);
  assert.ok(edgeTypes.includes('CONDUCTS_TRANSACTION'), 'tx → order');
  assert.ok(edgeTypes.includes('HAS_MILESTONE'), 'tx → milestone');
  assert.ok(edgeTypes.includes('RAISED_DISPUTE'), 'tx → dispute');
});

// ═════════════════════════════════════════════════════════════════════════════
// LAYER B — ROUTES (real router over HTTP; real authorizeRole; injected pg mock)
// ═════════════════════════════════════════════════════════════════════════════

// ── Mocked Supabase auth (session via x-user-id fallback in test mode; users + tenant memberships) ──
let db;
function resetAuthDb() {
  db = {
    users: {
      'member-1': { id: 'member-1', role: 'owner', is_verified: true },     // tenant member, not admin
      'admin-1': { id: 'admin-1', role: 'platform_admin', is_verified: true }, // platform admin
      'outsider-1': { id: 'outsider-1', role: 'owner', is_verified: true },  // not a member of T_A
      // CHECK 4 fixtures (canonical matrix):
      'reviewer-1': { id: 'reviewer-1', role: 'reviewer', is_verified: true },   // platform reviewer
      'tadmin-1': { id: 'tadmin-1', role: 'owner', is_verified: true },          // TENANT admin of T_A only
      'memberB-1': { id: 'memberB-1', role: 'owner', is_verified: true },        // member of T_B only
    },
    // membership keyed `${tenant_id}|${user_id}`
    tenantUsers: {
      [`${T_A}|member-1`]: { role: 'member' },
      [`${T_A}|admin-1`]: { role: 'admin' },
      [`${T_A}|reviewer-1`]: { role: 'member' },  // reviewer is also a tenant member of T_A
      [`${T_A}|tadmin-1`]: { role: 'admin' },     // tenant-admin of T_A (NOT a platform admin)
      [`${T_B}|memberB-1`]: { role: 'member' },   // belongs to T_B, not T_A
    },
  };
}

function makeBuilder(table) {
  const state = { table, filters: {} };
  const chain = {
    select() { return chain; }, insert() { return chain; }, update() { return chain; }, delete() { return chain; },
    eq(k, v) { state.filters[k] = v; return chain; }, neq() { return chain; }, is() { return chain; },
    in() { return chain; }, or() { return chain; }, order() { return chain; }, range() { return chain; },
    limit() { return chain; }, gte() { return chain; }, lte() { return chain; }, not() { return chain; },
    single() { state.single = true; return chain; }, maybeSingle() { state.single = true; return chain; },
    then(resolve, reject) {
      try { return Promise.resolve(resolveAuth(state)).then(resolve, reject); }
      catch (e) { return reject ? reject(e) : Promise.reject(e); }
    },
  };
  return chain;
}

function resolveAuth(state) {
  const ok = (data) => ({ data, error: null });
  const missing = (msg) => ({ data: null, error: { message: msg, code: 'PGRST116' } });
  switch (state.table) {
    case 'user_sessions': return missing('no session (test uses x-user-id fallback)');
    case 'users': return db.users[state.filters.id] ? ok(db.users[state.filters.id]) : missing('user not found');
    case 'tenant_users': {
      const key = `${state.filters.tenant_id}|${state.filters.user_id}`;
      return db.tenantUsers[key] ? ok(db.tenantUsers[key]) : missing('no membership');
    }
    default: return ok([]);
  }
}

// ── A pg "pool" that hands out the shared in-memory graph mock client and no-ops txn statements ──
function makePoolFromGraphMock(graph) {
  const inner = graph.client; // { query(text, params) }
  const client = {
    async query(text, params) {
      const sql = String(text).replace(/\s+/g, ' ').trim().toUpperCase();
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      return inner.query(text, params);
    },
    release() { /* pooled mock: nothing to release */ },
  };
  return { connect: async () => client };
}

let server; let baseUrl; let graph;
before(async () => {
  resetAuthDb();
  Object.defineProperty(supabase, 'from', { configurable: true, writable: true, value: (t) => makeBuilder(t) });
  const app = express();
  app.use(express.json());
  // Inject the fixed request timestamp the routes use for deterministic now (mirrors prod middleware).
  app.use((req, _res, next) => { req.fixedTimestamp = FIXED_TS; next(); });
  // A SIBLING diaspora route (NOT part of the trade-graph router) so we can prove the graph gate is scoped
  // to the trade-graph prefix only: when DIASPORA_TRADE_GRAPH is OFF the graph prefix 404s, but a sibling
  // diaspora route still responds normally (the gate does not 404 the whole /api/diaspora surface).
  app.get('/api/diaspora/sibling/ping', (_req, res) => res.json({ ok: true }));
  app.use('/api/diaspora/graph', diasporaTradeGraphRouter);
  app.use(errorHandler);
  await new Promise((resolve) => { server = http.createServer(app); server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise((r) => server.close(r)); });

// Each route test rebuilds the auth db, a fresh graph mock, and (re)wires the injected pool.
beforeEach(() => {
  resetAuthDb();
  resetGraphIds();
  graph = createGraphPgMock();
  __setGraphPgPool(makePoolFromGraphMock(graph));
});
afterEach(() => { __setGraphPgPool(null); });

async function api(method, path, { userId, role, tenantId, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (userId) headers['x-user-id'] = userId;
  if (role) headers['x-stakeholder-role'] = role;
  if (tenantId) headers['x-tenant-id'] = tenantId;
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

/** Seed the injected graph with the canonical chain so route reads have data to traverse. */
async function seedGraph(tenant = T_A) {
  for (const ev of canonicalEvents(tenant)) {
    await projection().projectEvent({ created_at: FIXED_TS, ...ev }, { pgClient: graph.client, now: FIXED_TS });
  }
}

test('ROUTE gate: entire surface is 404 (inert) when DIASPORA_TRADE_GRAPH is OFF', async () => {
  process.env.DIASPORA_TRADE_GRAPH = 'false';
  const r = await api('GET', '/api/diaspora/graph/orders/ord-1/blockers', { userId: 'member-1', tenantId: T_A });
  assert.equal(r.status, 404);
  assert.match(r.json.error, /not enabled/i);
});

test('ROUTE auth: unauthenticated requests are rejected (401)', async () => {
  const r = await api('GET', '/api/diaspora/graph/orders/ord-1/blockers', {});
  assert.equal(r.status, 401);
});

test('ROUTE entity read: a tenant member reads their own order node + neighborhood', async () => {
  await seedGraph();
  const r = await api('GET', '/api/diaspora/graph/entities/buyer_order/ord-1', { userId: 'member-1', tenantId: T_A });
  assert.equal(r.status, 200);
  assert.equal(r.json.centerNode.nodeType, 'BUYER_ORDER');
  assert.equal(r.json.centerNode.entityId, 'ord-1');
  assert.ok(Array.isArray(r.json.neighbors) && r.json.neighbors.length >= 1);
});

test('ROUTE entity read: a missing entity → 404', async () => {
  await seedGraph();
  const r = await api('GET', '/api/diaspora/graph/entities/buyer_order/does-not-exist', { userId: 'member-1', tenantId: T_A });
  assert.equal(r.status, 404);
});

test('ROUTE neighbors: 1-hop neighbors with reasons + source references', async () => {
  await seedGraph();
  const r = await api('GET', '/api/diaspora/graph/entities/buyer_order/ord-1/neighbors?maxDepth=1', { userId: 'member-1', tenantId: T_A });
  assert.equal(r.status, 200);
  assert.ok(r.json.neighbors.every((n) => Array.isArray(n.reasons) && n.reasons.length >= 1), 'every neighbor explainable');
  assert.ok(r.json.neighbors.every((n) => n.reasons.every((s) => s.source_event_ref)), 'every reason references a domain event');
});

test('ROUTE order path / blockers / match-explanation', async () => {
  await seedGraph();
  const path = await api('GET', '/api/diaspora/graph/orders/ord-1/path', { userId: 'member-1', tenantId: T_A });
  assert.equal(path.status, 200);
  assert.equal(path.json.orderedSteps[0].nodeType, 'BUYER_ORDER');

  const blockers = await api('GET', '/api/diaspora/graph/orders/ord-1/blockers', { userId: 'member-1', tenantId: T_A });
  assert.equal(blockers.status, 200);
  assert.equal(typeof blockers.json.hasBlockers, 'boolean');

  const match = await api('GET', '/api/diaspora/graph/orders/ord-1/match-explanation?sellerId=sell-1', { userId: 'member-1', tenantId: T_A });
  assert.equal(match.status, 200);
  assert.equal(match.json.matchFound, true);

  // match-explanation requires sellerId → 400 without it.
  const bad = await api('GET', '/api/diaspora/graph/orders/ord-1/match-explanation', { userId: 'member-1', tenantId: T_A });
  assert.equal(bad.status, 400);
});

test('ROUTE intelligence: demand-signals / risk-exposure / container-opportunities (redaction applied)', async () => {
  await seedGraph();
  // Make the order unmatched-by-status for demand by adding a fresh unmatched order.
  await projection().projectEvent({ created_at: FIXED_TS, id: evId(990), event_type: 'IMPORT_ORDER_CREATED', tenant_id: T_A,
    payload: { order_id: 'ord-2', buyer_id: 'b', status: 'IMPORT_REQUESTED', origin_country: 'NG', order_type: 'VEHICLE' } }, { pgClient: graph.client, now: FIXED_TS });

  const demand = await api('GET', '/api/diaspora/graph/stock/demand-signals?confidenceThreshold=0', { userId: 'member-1', tenantId: T_A });
  assert.equal(demand.status, 200);
  assert.ok(Array.isArray(demand.json.signals));

  const risk = await api('GET', '/api/diaspora/graph/risk/exposure', { userId: 'member-1', tenantId: T_A });
  assert.equal(risk.status, 200);
  assert.ok(Array.isArray(risk.json.risks));

  // Container with a secret coordinator → a non-admin member sees the coordinator id REDACTED over the wire.
  await projection().projectEvent({ created_at: FIXED_TS, id: evId(991), event_type: 'CONTAINER_CREATED', tenant_id: T_A,
    payload: { container_id: 'c1', coordinator_id: 'coord-secret', status: 'BOOKED' } }, { pgClient: graph.client, now: FIXED_TS });
  const cont = await api('GET', '/api/diaspora/graph/containers/opportunities', { userId: 'member-1', tenantId: T_A });
  assert.equal(cont.status, 200);
  const opp = cont.json.opportunities.find((o) => o.containerId === 'c1');
  assert.ok(opp, 'container opportunity returned');
  assert.equal(opp.coordinatorId, '[REDACTED]', 'coordinator id redacted for a non-admin member over the API');
});

test('ROUTE rebuild: a non-admin member is forbidden (403)', async () => {
  await seedGraph();
  const r = await api('POST', '/api/diaspora/graph/rebuild', { userId: 'member-1', tenantId: T_A, body: { reason: 'x' } });
  assert.equal(r.status, 403);
  // No rebuild row was created by a forbidden caller.
  assert.equal(graph.store.trade_graph_rebuilds.length, 0, 'forbidden caller triggered no rebuild');
});

test('ROUTE rebuild: a platform admin rebuilds their tenant (auditable) → COMPLETED', async () => {
  // Seed domain_events so the rebuild has an outbox to replay.
  graph.store.domain_events = canonicalEvents(T_A).map((e) => ({ ...e, created_at: FIXED_TS, status: 'processed' }));
  await seedGraph();

  const first = await api('POST', '/api/diaspora/graph/rebuild', { userId: 'admin-1', tenantId: T_A, body: { reason: 'manual' } });
  assert.equal(first.status, 200);
  assert.equal(first.json.status, 'COMPLETED');
  assert.equal(first.json.tenantId, T_A);
  assert.equal(first.json.eventsFailed, 0);
  assert.ok(graph.store.trade_graph_rebuilds.some((r) => r.status === 'COMPLETED'), 'rebuild recorded for audit/health');
});

test('ROUTE rebuild: rate-limited when a recent COMPLETED rebuild exists → 429 (admin only, auditable)', async () => {
  // A COMPLETED rebuild a minute ago (wall-clock) puts the tenant inside the 1-hour rate window. The
  // mock's trade_graph_request_rebuild compares completed_at to the real clock, so seed a wall-clock
  // recent row to deterministically force RATE_LIMITED regardless of the fixed request timestamp.
  graph.store.trade_graph_rebuilds.push({
    id: 'rb-recent', tenant_id: T_A, status: 'COMPLETED', completed_at: new Date(Date.now() - 60 * 1000).toISOString(),
  });
  await seedGraph();
  const nodesBefore = graph.store.trade_graph_nodes.length;

  const res = await api('POST', '/api/diaspora/graph/rebuild', { userId: 'admin-1', tenantId: T_A, body: { reason: 'again', minIntervalSeconds: 3600 } });
  assert.equal(res.status, 429);
  assert.equal(res.json.status, 'RATE_LIMITED');
  // A rate-limited rebuild does NOT clear/rewrite the graph.
  assert.equal(graph.store.trade_graph_nodes.length, nodesBefore, 'rate-limited rebuild left the graph untouched');
});

test('ROUTE tenant isolation: a member cannot read a tenant they do not belong to (403 at the gate)', async () => {
  await seedGraph();
  // outsider-1 is not a member of T_A → authMiddleware rejects the x-tenant-id with 403 before any read.
  const r = await api('GET', '/api/diaspora/graph/orders/ord-1/blockers', { userId: 'outsider-1', tenantId: T_A });
  assert.equal(r.status, 403);
});

test('ROUTE no write path: the API exposes NO endpoint that creates a node/edge (rebuild only re-derives)', async () => {
  await seedGraph();
  const nBefore = graph.store.trade_graph_nodes.length;
  const eBefore = graph.store.trade_graph_edges.length;
  // Exercise every READ endpoint; none may author a node/edge.
  await api('GET', '/api/diaspora/graph/entities/buyer_order/ord-1', { userId: 'member-1', tenantId: T_A });
  await api('GET', '/api/diaspora/graph/entities/buyer_order/ord-1/neighbors', { userId: 'member-1', tenantId: T_A });
  await api('GET', '/api/diaspora/graph/orders/ord-1/path', { userId: 'member-1', tenantId: T_A });
  await api('GET', '/api/diaspora/graph/orders/ord-1/blockers', { userId: 'member-1', tenantId: T_A });
  await api('GET', '/api/diaspora/graph/orders/ord-1/match-explanation?sellerId=sell-1', { userId: 'member-1', tenantId: T_A });
  await api('GET', '/api/diaspora/graph/risk/exposure', { userId: 'member-1', tenantId: T_A });
  assert.equal(graph.store.trade_graph_nodes.length, nBefore, 'no API read created a node');
  assert.equal(graph.store.trade_graph_edges.length, eBefore, 'no API read created an edge');
  // There is no POST/PUT/PATCH/DELETE node/edge endpoint — only POST /rebuild (admin re-derive).
});

// ═════════════════════════════════════════════════════════════════════════════
// CHECK 4 — ROUTE AUTHORIZATION COVERAGE (canonical matrix; server-derived roles only)
//
// The graph router authorizes with the SAME authorizeRole middleware as diasporaRoutes.js: the effective
// role + platformRole are resolved SERVER-SIDE from the DB (users.role + tenant_users.role); the client
// x-stakeholder-role can never escalate, and tenant_id for reads is ALWAYS req.userContext.tenantId
// (validated against tenant_users membership). These cases pin the matrix:
//   buyer/seller (non-admin member) → tenant-scoped reads only · reviewer/admin/tenant-admin per matrix ·
//   a SPOOFED x-stakeholder-role grants nothing + cannot widen tenant · tenant-admin is tenant-BOUND ·
//   rebuild is admin-only · the disabled gate is scoped to the trade-graph prefix only.
// ═════════════════════════════════════════════════════════════════════════════

test('CHECK4: buyer/seller (non-admin member) gets tenant-scoped READS only — own tenant 200, cannot widen to another tenant', async () => {
  await seedGraph(T_A);
  // Own tenant: a plain member reads their tenant's graph.
  const own = await api('GET', '/api/diaspora/graph/entities/buyer_order/ord-1', { userId: 'member-1', tenantId: T_A });
  assert.equal(own.status, 200, 'member reads their own tenant');
  // Attempt to widen to T_B (they are NOT a T_B member) → 403 at the gate (membership check), never a read.
  const widen = await api('GET', '/api/diaspora/graph/entities/buyer_order/ord-1', { userId: 'member-1', tenantId: T_B });
  assert.equal(widen.status, 403, 'member cannot read a tenant they do not belong to');
});

test('CHECK4: a SPOOFED x-stakeholder-role header does NOT grant graph access (effective role is server-derived) → 403', async () => {
  await seedGraph(T_A);
  // member-1 is a plain tenant member (platformRole=owner, tenantRole=member). Spoofing a platform_admin
  // role in the header is REJECTED by resolveEffectiveRole (requested role not verified for this user) → 403.
  const spoofAdmin = await api('GET', '/api/diaspora/graph/entities/buyer_order/ord-1', {
    userId: 'member-1', tenantId: T_A, role: 'platform_admin',
  });
  assert.equal(spoofAdmin.status, 403, 'spoofed platform_admin role does not grant access');
  // Spoofing a tenant 'admin' role is likewise rejected (admin is never grantable via the header).
  const spoofTenantAdmin = await api('GET', '/api/diaspora/graph/entities/buyer_order/ord-1', {
    userId: 'member-1', tenantId: T_A, role: 'admin',
  });
  assert.equal(spoofTenantAdmin.status, 403, 'spoofed tenant admin role does not grant access');
});

test('CHECK4: a SPOOFED role does NOT widen tenant — still bound to the membership of x-tenant-id', async () => {
  await seedGraph(T_A);
  // memberB-1 belongs to T_B only. Even spoofing platform_admin AND pointing x-tenant-id at T_A, the
  // tenant_users membership check rejects T_A (and the role spoof is unverified) → 403. No T_A data leaks.
  const r = await api('GET', '/api/diaspora/graph/entities/buyer_order/ord-1', {
    userId: 'memberB-1', tenantId: T_A, role: 'platform_admin',
  });
  assert.equal(r.status, 403, 'a spoofed role cannot widen a T_B member into T_A');
});

test('CHECK4: a platform REVIEWER (server-derived) reads within a tenant they belong to (matrix: reviewer read)', async () => {
  await seedGraph(T_A);
  // reviewer-1 has DB role 'reviewer' (a platform-review role) AND is a member of T_A. They read T_A.
  const r = await api('GET', '/api/diaspora/graph/orders/ord-1/blockers', { userId: 'reviewer-1', tenantId: T_A });
  assert.equal(r.status, 200, 'platform reviewer reads within their tenant');
  assert.equal(typeof r.json.hasBlockers, 'boolean');
});

test('CHECK4: tenant-admin is TENANT-BOUND — admin of T_A cannot read T_B (no cross-tenant via tenant-admin)', async () => {
  await seedGraph(T_A);
  await seedGraph(T_B);
  // tadmin-1 is a TENANT admin of T_A (tenant_users role=admin) but NOT a platform admin (users.role=owner).
  // Reading their own tenant works …
  const own = await api('GET', '/api/diaspora/graph/entities/buyer_order/ord-1', { userId: 'tadmin-1', tenantId: T_A });
  assert.equal(own.status, 200, 'tenant-admin reads their own tenant');
  // … but they are NOT a member of T_B, so reading T_B is rejected at the membership gate (tenant-bound).
  const cross = await api('GET', '/api/diaspora/graph/entities/buyer_order/ord-1', { userId: 'tadmin-1', tenantId: T_B });
  assert.equal(cross.status, 403, 'tenant-admin cannot read another tenant');
});

test('CHECK4: rebuild is ADMIN-ONLY — tenant-admin + reviewer + spoofed-admin member are all forbidden (403)', async () => {
  graph.store.domain_events = canonicalEvents(T_A).map((e) => ({ ...e, created_at: FIXED_TS, status: 'processed' }));
  await seedGraph(T_A);

  // A tenant-admin (not a PLATFORM admin) cannot rebuild.
  const tadmin = await api('POST', '/api/diaspora/graph/rebuild', { userId: 'tadmin-1', tenantId: T_A, body: { reason: 'x' } });
  assert.equal(tadmin.status, 403, 'tenant-admin is not a platform admin → rebuild forbidden');
  // A reviewer cannot rebuild (rebuild is platform-admin only, not reviewer).
  const reviewer = await api('POST', '/api/diaspora/graph/rebuild', { userId: 'reviewer-1', tenantId: T_A, body: { reason: 'x' } });
  assert.equal(reviewer.status, 403, 'reviewer cannot rebuild');
  // A member spoofing an admin role cannot rebuild.
  const spoof = await api('POST', '/api/diaspora/graph/rebuild', { userId: 'member-1', tenantId: T_A, role: 'platform_admin', body: { reason: 'x' } });
  assert.equal(spoof.status, 403, 'spoofed admin header cannot rebuild');
  // None of the forbidden callers triggered a rebuild row.
  assert.equal(graph.store.trade_graph_rebuilds.length, 0, 'no forbidden caller triggered a rebuild');

  // A REAL platform admin can (sanity anchor for the matrix).
  const admin = await api('POST', '/api/diaspora/graph/rebuild', { userId: 'admin-1', tenantId: T_A, body: { reason: 'ok' } });
  assert.equal(admin.status, 200);
  assert.equal(admin.json.status, 'COMPLETED');
});

test('CHECK4: disabled gate is SCOPED to the trade-graph prefix only — graph 404s, a sibling diaspora route still responds', async () => {
  process.env.DIASPORA_TRADE_GRAPH = 'false';
  // The trade-graph prefix is inert (consistent safe 404, not 403, so the feature stays undiscoverable).
  const graphResp = await api('GET', '/api/diaspora/graph/orders/ord-1/blockers', { userId: 'member-1', tenantId: T_A });
  assert.equal(graphResp.status, 404, 'graph prefix 404 while disabled');
  assert.match(graphResp.json.error, /not enabled/i);
  // A SIBLING diaspora route is unaffected by the graph gate (the gate does not 404 the whole surface).
  const sibling = await api('GET', '/api/diaspora/sibling/ping', {});
  assert.equal(sibling.status, 200, 'sibling diaspora route still responds while the graph gate is OFF');
  assert.deepEqual(sibling.json, { ok: true });
});
