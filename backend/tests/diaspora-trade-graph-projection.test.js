/**
 * Phase 10 Stage 2 — Trade Graph PROJECTION service tests (pure, no DB, no network).
 *
 * Drives the real projection service (diasporaTradeGraphProjectionService.js) against an in-memory
 * raw-pg mock (helpers/diasporaTradeGraphRpcReference.js) that mirrors the Phase 10 SQL surface
 * (20260621140000_diaspora_phase10_trade_graph.sql) statement-for-statement, including the two
 * SECURITY DEFINER RPCs (trade_graph_record_checkpoint / trade_graph_request_rebuild).
 *
 * Proves the Stage 6 test-matrix items that belong to projection (directive §62):
 *   - Projection idempotency (replaying one event is a no-op via the processed-events ledger).
 *   - Replay yields the SAME graph (deterministic mapping + dedup indexes).
 *   - Edges derive ONLY from domain events (every edge carries source_event_ref = the event id).
 *   - Tenant isolation (tenant_id taken from the envelope; cross-tenant events never mix).
 *   - Out-of-order delivery converges (edge endpoint placeholder is later enriched in-place).
 *   - Dead-letter on failure + surfaced to the outbox (projectEvent rethrows so eventWorker retries).
 *   - Rebuild correctness + idempotence (rebuild == incremental projection) and rate-limiting.
 *   - Phase 9 SafeTrade events produce the expected nodes/edges.
 *   - Fail-closed when DIASPORA_TRADE_GRAPH is OFF (no writes; "no write bypasses event source").
 *
 * Time is fixed (FIXED_TS passed via context.now); no test depends on Date.now() for stored values.
 */
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
// db/supabase.js (transitively imported via diasporaServiceUtils) throws at import without these.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.DIASPORA_TRADE_GRAPH = 'true'; // enable for behavioral tests; one test flips it OFF.

const FIXED_TS = '2026-06-21T14:00:00.000Z';

const { createGraphPgMock, resetGraphIds, makeGraphPool } = await import('./helpers/diasporaTradeGraphRpcReference.js');
const {
  DiasporaTradeGraphProjectionService,
  PROJECTION_OUTCOMES,
  REBUILD_STATUS,
  makeProjectionSubscriber,
  // FIX E: self-contained poll driver + the fail-loud subscriber error identifier.
  TRADE_GRAPH_SUBSCRIBER_MISSING_EVENT_ID,
  TradeGraphSubscriberMissingEventIdError,
  // FIX H: the per-event SAVEPOINT name used to isolate each event in a poll/rebuild batch.
  TRADE_GRAPH_EVENT_SAVEPOINT,
} = await import('../services/diaspora/tradegraph/diasporaTradeGraphProjectionService.js');

// uuid-shaped fixtures (the projector requires event.id + tenant_id to be uuids).
const T_A = '00000000-0000-4000-9000-00000000000a';
const T_B = '00000000-0000-4000-9000-00000000000b';
const U1 = '00000000-0000-4000-9000-0000000000u1'.replace(/u1$/, 'a1');
const evId = (n) => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;

// Build a projection service with metrics disabled (we pass no hub).
function svc() {
  return new DiasporaTradeGraphProjectionService();
}

// A null audit client so rebuild's CRITICAL audit never touches a real DB.
const auditClient = {
  from() {
    return {
      insert() { return this; },
      select() { return this; },
      single() { return Promise.resolve({ data: { id: 'aud-1' }, error: null }); },
    };
  },
};

const ctx = (pgClient, extra = {}) => ({ pgClient, now: FIXED_TS, ...extra });

beforeEach(() => resetGraphIds());
afterEach(() => { process.env.DIASPORA_TRADE_GRAPH = 'true'; });

// ── helpers ──
function tradeProfileEvent(id, tenant, payload) {
  return { id, event_type: 'TRADE_PROFILE_CREATED', tenant_id: tenant, payload, created_at: FIXED_TS };
}
function orderEvent(id, tenant, payload) {
  return { id, event_type: 'IMPORT_ORDER_CREATED', tenant_id: tenant, payload, created_at: FIXED_TS };
}

test('disabled gate: projectEvent writes nothing when DIASPORA_TRADE_GRAPH is OFF', async () => {
  process.env.DIASPORA_TRADE_GRAPH = 'false';
  const { client, store } = createGraphPgMock();
  const res = await svc().projectEvent(
    tradeProfileEvent(evId(1), T_A, { trade_profile_id: 'tp-1', user_id: U1 }),
    ctx(client),
  );
  assert.equal(res.outcome, PROJECTION_OUTCOMES.SKIPPED_DISABLED);
  assert.equal(store.trade_graph_nodes.length, 0);
  assert.equal(store.trade_graph_edges.length, 0);
  assert.equal(store.trade_graph_processed_events.length, 0);
});

test('projects a node + edges; every edge carries source_event_ref = the event id', async () => {
  const { client, store } = createGraphPgMock();
  const id = evId(2);
  const res = await svc().projectEvent(
    tradeProfileEvent(id, T_A, { trade_profile_id: 'tp-1', user_id: U1, created_by: U1, role_type: 'BUYER', country: 'NG' }),
    ctx(client),
  );
  assert.equal(res.outcome, PROJECTION_OUTCOMES.PROJECTED);

  // One real TRADE_PROFILE node + placeholder USER (+ TENANT) created via edge endpoints.
  const profile = store.trade_graph_nodes.find((n) => n.node_type === 'TRADE_PROFILE' && n.entity_id === 'tp-1');
  assert.ok(profile, 'TRADE_PROFILE node exists');
  assert.equal(profile.data.role_type, 'BUYER');
  assert.equal(profile.data.country, 'NG');
  assert.equal(profile.source_event_ref, id);

  // Edges: HAS_TRADE_PROFILE (USER->TP), BELONGS_TO_TENANT (TP->TENANT), CREATED_BY (USER->TP).
  assert.equal(store.trade_graph_edges.length, 3);
  for (const e of store.trade_graph_edges) {
    assert.equal(e.source_event_ref, id, 'edge derives from the domain event');
    assert.notEqual(e.source_node_id, e.target_node_id, 'no self loops');
  }
  const types = store.trade_graph_edges.map((e) => e.edge_type).sort();
  assert.deepEqual(types, ['BELONGS_TO_TENANT', 'CREATED_BY', 'HAS_TRADE_PROFILE']);

  // processed-events ledger + checkpoint advanced.
  assert.equal(store.trade_graph_processed_events.length, 1);
  assert.equal(store.trade_graph_projection_checkpoints[0].last_event_id, id);
});

test('idempotency: replaying the SAME event is a no-op (ledger short-circuits)', async () => {
  const { client, store } = createGraphPgMock();
  const ev = tradeProfileEvent(evId(3), T_A, { trade_profile_id: 'tp-1', user_id: U1, created_by: U1 });
  const first = await svc().projectEvent(ev, ctx(client));
  assert.equal(first.outcome, PROJECTION_OUTCOMES.PROJECTED);

  const nodesAfterFirst = store.trade_graph_nodes.length;
  const edgesAfterFirst = store.trade_graph_edges.length;

  const second = await svc().projectEvent(ev, ctx(client));
  assert.equal(second.outcome, PROJECTION_OUTCOMES.IDEMPOTENT_REPLAY);
  assert.equal(store.trade_graph_nodes.length, nodesAfterFirst, 'no duplicate nodes');
  assert.equal(store.trade_graph_edges.length, edgesAfterFirst, 'no duplicate edges');
  assert.equal(store.trade_graph_processed_events.length, 1);
});

test('replay of a DISTINCT-id event for the same entity does not duplicate the node (dedup index)', async () => {
  const { client, store } = createGraphPgMock();
  await svc().projectEvent(
    tradeProfileEvent(evId(4), T_A, { trade_profile_id: 'tp-1', user_id: U1, country: 'NG' }),
    ctx(client),
  );
  // A second, distinct event (e.g. an UPDATE redelivered) referencing the same entity merges, not dupes.
  await svc().projectEvent(
    { id: evId(5), event_type: 'TRADE_PROFILE_UPDATED', tenant_id: T_A, created_at: FIXED_TS,
      payload: { trade_profile_id: 'tp-1', verification_status: 'VERIFIED' } },
    ctx(client),
  );
  const profiles = store.trade_graph_nodes.filter((n) => n.node_type === 'TRADE_PROFILE' && n.entity_id === 'tp-1');
  assert.equal(profiles.length, 1, 'single current node for the entity');
  assert.equal(profiles[0].data.country, 'NG', 'prior attribute preserved (data merge)');
  assert.equal(profiles[0].data.verification_status, 'VERIFIED', 'new attribute applied');
});

test('tenant isolation: same entity id in two tenants yields two distinct, non-mixed nodes', async () => {
  const { client, store } = createGraphPgMock();
  await svc().projectEvent(orderEvent(evId(6), T_A, { order_id: 'ord-1', buyer_id: 'b-1', status: 'REQUESTED' }), ctx(client));
  await svc().projectEvent(orderEvent(evId(7), T_B, { order_id: 'ord-1', buyer_id: 'b-9', status: 'REQUESTED' }), ctx(client));

  const orders = store.trade_graph_nodes.filter((n) => n.node_type === 'BUYER_ORDER' && n.entity_id === 'ord-1');
  assert.equal(orders.length, 2);
  assert.deepEqual(orders.map((o) => o.tenant_id).sort(), [T_A, T_B].sort());
  // Edges never cross tenants.
  for (const e of store.trade_graph_edges) {
    const src = store.trade_graph_nodes.find((n) => n.id === e.source_node_id);
    const tgt = store.trade_graph_nodes.find((n) => n.id === e.target_node_id);
    assert.equal(src.tenant_id, e.tenant_id);
    assert.equal(tgt.tenant_id, e.tenant_id);
  }
});

test('out-of-order delivery converges: edge endpoint placeholder is enriched in place', async () => {
  const { client, store } = createGraphPgMock();
  // STOCK_RESERVED references a BUYER_ORDER (order_id) that has not been projected yet → placeholder.
  await svc().projectEvent(
    { id: evId(8), event_type: 'STOCK_RESERVED', tenant_id: T_A, created_at: FIXED_TS,
      payload: { stock_item_id: 'st-1', order_id: 'ord-77' } },
    ctx(client),
  );
  let order = store.trade_graph_nodes.find((n) => n.node_type === 'BUYER_ORDER' && n.entity_id === 'ord-77');
  assert.ok(order, 'placeholder BUYER_ORDER created for the SUPPLIES edge');
  assert.deepEqual(order.data, {}, 'placeholder has empty data');

  // Now the real IMPORT_ORDER_CREATED arrives later and enriches the SAME node (no duplicate).
  await svc().projectEvent(
    orderEvent(evId(9), T_A, { order_id: 'ord-77', buyer_id: 'b-1', status: 'REQUESTED', destination_country: 'ZW' }),
    ctx(client),
  );
  const orders = store.trade_graph_nodes.filter((n) => n.node_type === 'BUYER_ORDER' && n.entity_id === 'ord-77');
  assert.equal(orders.length, 1, 'placeholder enriched, not duplicated');
  assert.equal(orders[0].data.status, 'REQUESTED');
  assert.equal(orders[0].data.destination_country, 'ZW');
});

test('skips ops with null endpoints (no dangling edge / no self loop)', async () => {
  const { client, store } = createGraphPgMock();
  // TRADE_PROFILE_CREATED with no created_by → CREATED_BY edge selector returns null and is skipped.
  await svc().projectEvent(
    tradeProfileEvent(evId(10), T_A, { trade_profile_id: 'tp-1', user_id: U1 /* no created_by */ }),
    ctx(client),
  );
  const types = store.trade_graph_edges.map((e) => e.edge_type).sort();
  assert.deepEqual(types, ['BELONGS_TO_TENANT', 'HAS_TRADE_PROFILE'], 'CREATED_BY skipped (null actor)');
});

test('unknown / unmapped event types are skipped, not dead-lettered', async () => {
  const { client, store } = createGraphPgMock();
  const res = await svc().projectEvent(
    { id: evId(11), event_type: 'SOMETHING_ELSE', tenant_id: T_A, payload: {}, created_at: FIXED_TS },
    ctx(client),
  );
  assert.equal(res.outcome, PROJECTION_OUTCOMES.SKIPPED_UNKNOWN_EVENT);
  assert.equal(store.trade_graph_dead_letters.length, 0);
  assert.equal(store.trade_graph_nodes.length, 0);
});

test('no tenant on the envelope → skipped (graph is tenant-partitioned)', async () => {
  const { client, store } = createGraphPgMock();
  const res = await svc().projectEvent(
    tradeProfileEvent(evId(12), null, { trade_profile_id: 'tp-1', user_id: U1 }),
    ctx(client),
  );
  assert.equal(res.outcome, PROJECTION_OUTCOMES.SKIPPED_NO_TENANT);
  assert.equal(store.trade_graph_nodes.length, 0);
});

test('dead-letter on failure + rethrow so the outbox worker retries', async () => {
  const { client, store, faults } = createGraphPgMock({ faults: { failNodeInsert: true } });
  await assert.rejects(
    () => svc().projectEvent(
      tradeProfileEvent(evId(13), T_A, { trade_profile_id: 'tp-1', user_id: U1, created_by: U1 }),
      ctx(client),
    ),
    /FAULT\/NODE_INSERT/,
  );
  assert.equal(store.trade_graph_dead_letters.length, 1, 'dead letter recorded for operator visibility');
  assert.equal(store.trade_graph_dead_letters[0].event_id, evId(13));
  assert.equal(store.trade_graph_processed_events.length, 0, 'not marked processed → will retry');

  // A subsequent retry after the fault clears succeeds and the dead-letter retry_count tracks history.
  faults.failNodeInsert = false;
  const ok = await svc().projectEvent(
    tradeProfileEvent(evId(13), T_A, { trade_profile_id: 'tp-1', user_id: U1, created_by: U1 }),
    ctx(client),
  );
  assert.equal(ok.outcome, PROJECTION_OUTCOMES.PROJECTED);
  assert.equal(store.trade_graph_processed_events.length, 1);
});

test('SafeTrade (Phase 9) events produce expected nodes/edges', async () => {
  const { client, store } = createGraphPgMock();
  await svc().projectEvent(
    { id: evId(14), event_type: 'SAFETRADE_TRANSACTION_CREATED', tenant_id: T_A, created_at: FIXED_TS,
      payload: { safetrade_transaction_id: 'stx-1', order_id: 'ord-1', status: 'DRAFT' } },
    ctx(client),
  );
  await svc().projectEvent(
    { id: evId(15), event_type: 'SAFETRADE_MILESTONE_CREATED', tenant_id: T_A, created_at: FIXED_TS,
      payload: { safetrade_milestone_id: 'stm-1', safetrade_transaction_id: 'stx-1', milestone_type: 'DEPOSIT', status: 'PENDING' } },
    ctx(client),
  );
  await svc().projectEvent(
    { id: evId(16), event_type: 'SAFETRADE_DISPUTE_CREATED', tenant_id: T_A, created_at: FIXED_TS,
      payload: { safetrade_dispute_id: 'std-1', safetrade_transaction_id: 'stx-1', status: 'OPEN' } },
    ctx(client),
  );

  assert.ok(store.trade_graph_nodes.find((n) => n.node_type === 'SAFETRADE_TRANSACTION' && n.entity_id === 'stx-1'));
  assert.ok(store.trade_graph_nodes.find((n) => n.node_type === 'SAFETRADE_MILESTONE' && n.entity_id === 'stm-1'));
  assert.ok(store.trade_graph_nodes.find((n) => n.node_type === 'SAFETRADE_DISPUTE' && n.entity_id === 'std-1'));
  const edgeTypes = store.trade_graph_edges.map((e) => e.edge_type);
  assert.ok(edgeTypes.includes('CONDUCTS_TRANSACTION'));
  assert.ok(edgeTypes.includes('HAS_MILESTONE'));
  assert.ok(edgeTypes.includes('RAISED_DISPUTE'));
});

test('rebuild is admin-only', async () => {
  const { client } = createGraphPgMock();
  await assert.rejects(
    () => svc().rebuildTenantGraph(T_A, ctx(client, { actor: { id: U1, isPlatformAdmin: false }, auditClient })),
    /admin-only/,
  );
});

test('rebuild re-derives the graph from the outbox and equals incremental projection', async () => {
  // 1. Build the graph incrementally from a fixed ordered event log.
  const events = [
    orderEvent(evId(20), T_A, { order_id: 'ord-1', buyer_id: 'b-1', status: 'REQUESTED' }),
    { id: evId(21), event_type: 'QUOTE_ISSUED', tenant_id: T_A, created_at: FIXED_TS,
      payload: { quote_id: 'q-1', order_id: 'ord-1', seller_id: 's-1', status: 'ISSUED' } },
    { id: evId(22), event_type: 'QUOTE_ACCEPTED', tenant_id: T_A, created_at: FIXED_TS,
      payload: { quote_id: 'q-1', order_id: 'ord-1', seller_id: 's-1' } },
  ];
  const incremental = createGraphPgMock();
  for (const ev of events) await svc().projectEvent(ev, ctx(incremental.client));
  resetGraphIds();

  // 2. Rebuild from the SAME outbox into a fresh store.
  const rebuilt = createGraphPgMock({
    store: {
      trade_graph_nodes: [], trade_graph_edges: [], trade_graph_processed_events: [],
      trade_graph_dead_letters: [], trade_graph_rebuilds: [], trade_graph_projection_checkpoints: [],
      domain_events: events.map((e) => ({ ...e, status: 'processed' })),
    },
  });
  const result = await svc().rebuildTenantGraph(
    T_A, ctx(rebuilt.client, { actor: { id: U1, isPlatformAdmin: true }, auditClient }),
  );
  assert.equal(result.status, REBUILD_STATUS.COMPLETED);
  assert.equal(result.eventsProcessed, 3);
  assert.equal(result.eventsFailed, 0);

  // 3. The rebuilt graph has the SAME node/edge shape (count + type set) as incremental projection.
  const norm = (store) => ({
    nodes: store.trade_graph_nodes.map((n) => `${n.node_type}:${n.entity_id}`).sort(),
    edges: store.trade_graph_edges
      .map((e) => {
        const s = store.trade_graph_nodes.find((n) => n.id === e.source_node_id);
        const t = store.trade_graph_nodes.find((n) => n.id === e.target_node_id);
        return `${s.node_type}:${s.entity_id}-[${e.edge_type}]->${t.node_type}:${t.entity_id}`;
      })
      .sort(),
  });
  assert.deepEqual(norm(rebuilt.store), norm(incremental.store), 'rebuild == incremental projection');
});

test('rebuild is rate-limited (RATE_LIMITED status when a recent COMPLETED rebuild exists)', async () => {
  const recentCompletedAt = new Date(Date.now() - 60 * 1000).toISOString(); // 1 min ago
  const rebuilt = createGraphPgMock({
    store: {
      trade_graph_nodes: [], trade_graph_edges: [], trade_graph_processed_events: [],
      trade_graph_dead_letters: [],
      trade_graph_rebuilds: [{ id: 'rb-old', tenant_id: T_A, status: 'COMPLETED', completed_at: recentCompletedAt }],
      trade_graph_projection_checkpoints: [], domain_events: [],
    },
  });
  const res = await svc().rebuildTenantGraph(
    T_A, ctx(rebuilt.client, { actor: { id: U1, isPlatformAdmin: true }, auditClient, minIntervalSeconds: 3600 }),
  );
  assert.equal(res.status, REBUILD_STATUS.RATE_LIMITED);
  // No clearing happened (graph untouched) on a rate-limited request.
  assert.equal(rebuilt.store.trade_graph_nodes.length, 0);
});

// ═════════════════════════════════════════════════════════════════════════════
// FIX 3 — revoke events soft-delete the edge (and are idempotent)
// ═════════════════════════════════════════════════════════════════════════════

const liveSupplies = (store) => store.trade_graph_edges.filter((e) => e.edge_type === 'SUPPLIES' && e.deleted_at == null);

test('FIX 3: STOCK_RELEASED soft-deletes the SUPPLIES edge a prior STOCK_RESERVED created', async () => {
  const { client, store } = createGraphPgMock();
  // 1. Reserve stock → creates the SUPPLIES edge (SELLER_STOCK_ITEM → BUYER_ORDER).
  await svc().projectEvent(
    { id: evId(30), event_type: 'STOCK_RESERVED', tenant_id: T_A, created_at: FIXED_TS,
      payload: { stock_item_id: 'st-1', order_id: 'ord-1' } },
    ctx(client),
  );
  assert.equal(liveSupplies(store).length, 1, 'SUPPLIES edge created by STOCK_RESERVED');
  const edgeId = liveSupplies(store)[0].id;

  // 2. Release the stock → revokes (soft-deletes) the SUPPLIES edge.
  const res = await svc().projectEvent(
    { id: evId(31), event_type: 'STOCK_RELEASED', tenant_id: T_A, created_at: FIXED_TS,
      payload: { stock_item_id: 'st-1', order_id: 'ord-1' } },
    ctx(client),
  );
  assert.equal(res.outcome, PROJECTION_OUTCOMES.PROJECTED);
  assert.equal(res.revokedEdges.length, 1, 'one edge revoked');
  assert.deepEqual(res.revokedEdges[0].revokedEdgeIds, [edgeId]);

  // The edge row is RETAINED (audit/replay) but soft-deleted: deleted_at set, is_valid=false, revoked ref.
  const edge = store.trade_graph_edges.find((e) => e.id === edgeId);
  assert.ok(edge.deleted_at, 'edge soft-deleted (deleted_at set), not hard-deleted');
  assert.equal(edge.is_valid, false);
  assert.equal(edge.revoked_event_ref, evId(31), 'records WHICH event revoked the edge');
  assert.equal(liveSupplies(store).length, 0, 'no live SUPPLIES edge remains');
});

test('FIX 3: re-applying STOCK_RELEASED is idempotent (revokes zero further rows)', async () => {
  const { client, store } = createGraphPgMock();
  await svc().projectEvent(
    { id: evId(32), event_type: 'STOCK_RESERVED', tenant_id: T_A, created_at: FIXED_TS,
      payload: { stock_item_id: 'st-1', order_id: 'ord-1' } },
    ctx(client),
  );
  await svc().projectEvent(
    { id: evId(33), event_type: 'STOCK_RELEASED', tenant_id: T_A, created_at: FIXED_TS,
      payload: { stock_item_id: 'st-1', order_id: 'ord-1' } },
    ctx(client),
  );
  const deletedAtFirst = store.trade_graph_edges.find((e) => e.edge_type === 'SUPPLIES').deleted_at;

  // A DISTINCT-id redelivery of the SAME release event re-runs the revocation: already soft-deleted →
  // matches `deleted_at IS NULL` → zero rows updated → no-op. (The same-id replay short-circuits earlier.)
  const again = await svc().projectEvent(
    { id: evId(34), event_type: 'STOCK_RELEASED', tenant_id: T_A, created_at: FIXED_TS,
      payload: { stock_item_id: 'st-1', order_id: 'ord-1' } },
    ctx(client),
  );
  assert.equal(again.outcome, PROJECTION_OUTCOMES.PROJECTED);
  assert.equal(again.revokedEdges.length, 0, 're-revoking an already-revoked edge is a no-op');
  // The edge is unchanged (still soft-deleted, original revoked_event_ref preserved).
  const edge = store.trade_graph_edges.find((e) => e.edge_type === 'SUPPLIES');
  assert.equal(edge.deleted_at, deletedAtFirst, 'soft-delete state unchanged on idempotent re-revoke');
  assert.equal(edge.revoked_event_ref, evId(33), 'original revoking event preserved');
});

test('FIX 3: QUOTE_REJECTED soft-deletes the accepted-quote edge for that quote', async () => {
  const { client, store } = createGraphPgMock();
  await svc().projectEvent(
    { id: evId(35), event_type: 'IMPORT_ORDER_CREATED', tenant_id: T_A, created_at: FIXED_TS,
      payload: { order_id: 'ord-1', buyer_id: 'b-1', status: 'REQUESTED' } },
    ctx(client),
  );
  await svc().projectEvent(
    { id: evId(36), event_type: 'QUOTE_ACCEPTED', tenant_id: T_A, created_at: FIXED_TS,
      payload: { quote_id: 'q-1', order_id: 'ord-1', seller_id: 's-1' } },
    ctx(client),
  );
  const liveAccepted = () => store.trade_graph_edges.filter((e) => e.edge_type === 'ACCEPTED_QUOTE' && e.deleted_at == null);
  assert.equal(liveAccepted().length, 1, 'ACCEPTED_QUOTE edge created');

  await svc().projectEvent(
    { id: evId(37), event_type: 'QUOTE_REJECTED', tenant_id: T_A, created_at: FIXED_TS,
      payload: { quote_id: 'q-1', order_id: 'ord-1', seller_id: 's-1' } },
    ctx(client),
  );
  assert.equal(liveAccepted().length, 0, 'rejected quote revokes the ACCEPTED_QUOTE edge');
});

// GATE-T10 FIX 1 (regression) — the SOFT_DELETE_EDGE UPDATE must bind the TIMESTAMP to the temporal
// columns ($5 → deleted_at/valid_until/updated_at) and the revoking EVENT id to revoked_event_ref ($6).
// The earlier SQL referenced $6/$7 against a 6-param array, so on real Postgres deleted_at/valid_until
// received the eventId UUID (an invalid timestamptz) and $7 did not exist → the statement THREW and the
// edge was NEVER revoked (stale edge stayed live + traversable). This test pins the exact stored values so
// it would FAIL under the old $6/$7 binding (deleted_at would equal the eventId, not the fixed timestamp).
test('GATE-T10 FIX 1: revocation binds the timestamp ($5) and revoked_event_ref ($6) to the correct columns', async () => {
  const { client, store } = createGraphPgMock();
  // 1. Reserve stock → SUPPLIES edge with a NULL deleted_at/valid_until and is_valid=true.
  await svc().projectEvent(
    { id: evId(40), event_type: 'STOCK_RESERVED', tenant_id: T_A, created_at: FIXED_TS,
      payload: { stock_item_id: 'st-9', order_id: 'ord-9' } },
    ctx(client),
  );
  const edgeId = liveSupplies(store)[0].id;

  // 2. Release the stock → revoke the SUPPLIES edge. The revoking event id is DISTINCT from the timestamp,
  //    so a column that received the eventId instead of the timestamp is detectable.
  const revokeEventId = evId(41);
  const res = await svc().projectEvent(
    { id: revokeEventId, event_type: 'STOCK_RELEASED', tenant_id: T_A, created_at: FIXED_TS,
      payload: { stock_item_id: 'st-9', order_id: 'ord-9' } },
    ctx(client),
  );
  assert.equal(res.outcome, PROJECTION_OUTCOMES.PROJECTED);
  assert.deepEqual(res.revokedEdges[0].revokedEdgeIds, [edgeId], 'the live SUPPLIES edge was revoked');

  const edge = store.trade_graph_edges.find((e) => e.id === edgeId);
  // The TEMPORAL columns must equal the fixed TIMESTAMP (context.now) — NOT the eventId. Under the old
  // $6/$7 binding the mock/Postgres would have written the eventId here, so these equalities would break.
  assert.equal(edge.deleted_at, FIXED_TS, 'deleted_at = the timestamp ($5), not the eventId');
  assert.equal(edge.valid_until, FIXED_TS, 'valid_until = the timestamp ($5), not the eventId');
  assert.equal(edge.updated_at, FIXED_TS, 'updated_at = the timestamp ($5)');
  assert.notEqual(edge.deleted_at, revokeEventId, 'deleted_at is the timestamp, never the event UUID');
  // revoked_event_ref must equal the DOMAIN EVENT id ($6) — the audit trail of WHICH event tore it down.
  assert.equal(edge.revoked_event_ref, revokeEventId, 'revoked_event_ref = the revoking domain event id ($6)');
  assert.equal(edge.is_valid, false, 'edge marked invalid by the revocation');
});

// ═════════════════════════════════════════════════════════════════════════════
// FIX 4 + FIX 8 — durable dead-letter on a SEPARATE connection; first-event counter durable
// ═════════════════════════════════════════════════════════════════════════════

test('FIX 4: a failed event records a dead-letter on a SEPARATE connection (survives batch rollback)', async () => {
  // The batch client is fault-injected so the node insert throws (poisoning the shared batch txn). The
  // dead-letter pool is a DISTINCT store, mirroring a separate service-role connection whose own
  // transaction commits independently of the poisoned batch.
  const batch = createGraphPgMock({ faults: { failNodeInsert: true } });
  const dlSink = createGraphPgMock();
  await assert.rejects(
    () => svc().projectEvent(
      tradeProfileEvent(evId(40), T_A, { trade_profile_id: 'tp-1', user_id: U1, created_by: U1 }),
      ctx(batch.client, { deadLetterPool: makeGraphPool(dlSink) }),
    ),
    /FAULT\/NODE_INSERT/,
  );
  // The DL landed on the SEPARATE sink, NOT the (poisoned) batch store.
  assert.equal(dlSink.store.trade_graph_dead_letters.length, 1, 'dead-letter persisted on the separate connection');
  assert.equal(dlSink.store.trade_graph_dead_letters[0].event_id, evId(40));
  assert.equal(batch.store.trade_graph_dead_letters.length, 0, 'DL not written to the poisoned batch store');
  assert.equal(batch.store.trade_graph_processed_events.length, 0, 'not marked processed → worker retries');
});

test('FIX 4: one event failing does not roll back OTHER events already projected in the batch', async () => {
  // Project a good event, then a failing one through the SAME batch client. The good event's nodes/edges
  // remain (per-event failure is isolated; the rethrow drives the worker retry of ONLY the failing event).
  const batch = createGraphPgMock();
  const dlSink = createGraphPgMock();
  await svc().projectEvent(
    orderEvent(evId(41), T_A, { order_id: 'ord-good', buyer_id: 'b-1', status: 'REQUESTED' }),
    ctx(batch.client, { deadLetterPool: makeGraphPool(dlSink) }),
  );
  const goodNodes = batch.store.trade_graph_nodes.length;
  assert.ok(goodNodes >= 1, 'good event projected nodes');

  batch.faults.failNodeInsert = true;
  await assert.rejects(
    () => svc().projectEvent(
      tradeProfileEvent(evId(42), T_A, { trade_profile_id: 'tp-x', user_id: U1, created_by: U1 }),
      ctx(batch.client, { deadLetterPool: makeGraphPool(dlSink) }),
    ),
    /FAULT\/NODE_INSERT/,
  );
  // The earlier good event's progress is intact (no whole-batch rollback at the projection layer).
  assert.equal(batch.store.trade_graph_nodes.length, goodNodes, 'prior good projection retained');
  assert.equal(dlSink.store.trade_graph_dead_letters.length, 1, 'only the failing event is dead-lettered');
  assert.equal(dlSink.store.trade_graph_dead_letters[0].event_id, evId(42));
});

test('FIX 8: dead-letter counter is durable even on the FIRST event for a tenant (no checkpoint yet)', async () => {
  // No checkpoint row exists for T_A when the very first event fails. The DL writer UPSERTS the
  // checkpoint so dead_letter_count is not lost to a blind UPDATE matching zero rows.
  const batch = createGraphPgMock({ faults: { failNodeInsert: true } });
  const dlSink = createGraphPgMock();
  assert.equal(dlSink.store.trade_graph_projection_checkpoints.length, 0, 'no checkpoint before the first event');
  await assert.rejects(
    () => svc().projectEvent(
      tradeProfileEvent(evId(43), T_A, { trade_profile_id: 'tp-1', user_id: U1, created_by: U1 }),
      ctx(batch.client, { deadLetterPool: makeGraphPool(dlSink) }),
    ),
    /FAULT\/NODE_INSERT/,
  );
  const cp = dlSink.store.trade_graph_projection_checkpoints.find((c) => String(c.tenant_id) === T_A);
  assert.ok(cp, 'a checkpoint row was created (upserted) by the dead-letter writer');
  assert.equal(cp.dead_letter_count, 1, 'first-event dead-letter counter persisted (FIX 8)');
});

// ═════════════════════════════════════════════════════════════════════════════
// FIX 5 — projection works through makeProjectionSubscriber with the worker call signature
// ═════════════════════════════════════════════════════════════════════════════

test('FIX 5: makeProjectionSubscriber maps the eventWorker (payload, client, tenantId, record) call', async () => {
  const { client, store } = createGraphPgMock();
  const subscriber = makeProjectionSubscriber(svc(), { getNow: () => FIXED_TS });

  // Drive the subscriber EXACTLY as the eventWorker does: handler(event.payload, client, event.tenant_id,
  // event) — the worker passes the raw record as the 4th arg (its one-line record-forward change).
  const record = { id: evId(50), event_type: 'IMPORT_ORDER_CREATED', tenant_id: T_A, created_at: FIXED_TS };
  const res = await subscriber(
    { order_id: 'ord-1', buyer_id: 'b-1', status: 'REQUESTED' }, // payload
    client,                                                       // pgClient
    T_A,                                                          // tenantId
    record,                                                       // raw domain_events record
  );
  assert.equal(res.outcome, PROJECTION_OUTCOMES.PROJECTED);
  assert.equal(res.eventId, evId(50), 'id taken from the record, not the payload');
  const order = store.trade_graph_nodes.find((n) => n.node_type === 'BUYER_ORDER' && n.entity_id === 'ord-1');
  assert.ok(order, 'projection ran through the worker-signature wrapper');
  assert.equal(order.source_event_ref, evId(50), 'source_event_ref = the record id (idempotency key)');
  assert.equal(store.trade_graph_processed_events.length, 1, 'idempotency ledger written via the wrapper');
});

test('FIX 5: the subscriber is idempotent under the worker at-least-once redelivery', async () => {
  const { client, store } = createGraphPgMock();
  const subscriber = makeProjectionSubscriber(svc(), { getNow: () => FIXED_TS });
  const record = { id: evId(51), event_type: 'IMPORT_ORDER_CREATED', tenant_id: T_A, created_at: FIXED_TS };
  const payload = { order_id: 'ord-1', buyer_id: 'b-1', status: 'REQUESTED' };
  await subscriber(payload, client, T_A, record);
  const after1 = store.trade_graph_nodes.length;
  const second = await subscriber(payload, client, T_A, record);
  assert.equal(second.outcome, PROJECTION_OUTCOMES.IDEMPOTENT_REPLAY, 'redelivery short-circuits via the ledger');
  assert.equal(store.trade_graph_nodes.length, after1, 'no duplicate nodes on redelivery');
});

// ═════════════════════════════════════════════════════════════════════════════
// FIX E — self-contained poll driver (projectPendingEvents) + fail-loud subscriber + rebuild DL sink
// ═════════════════════════════════════════════════════════════════════════════

// A small ordered outbox for the poll driver: an order + a quote on it, all in tenant A.
function pollOutbox(tenant = T_A) {
  return [
    { id: evId(60), event_type: 'IMPORT_ORDER_CREATED', tenant_id: tenant, status: 'pending', created_at: '2026-06-21T14:00:00.000Z',
      payload: { order_id: 'ord-1', buyer_id: 'b-1', status: 'REQUESTED' } },
    { id: evId(61), event_type: 'QUOTE_ISSUED', tenant_id: tenant, status: 'pending', created_at: '2026-06-21T14:00:01.000Z',
      payload: { quote_id: 'q-1', order_id: 'ord-1', seller_id: 's-1', status: 'ISSUED' } },
    { id: evId(62), event_type: 'QUOTE_ACCEPTED', tenant_id: tenant, status: 'processed', created_at: '2026-06-21T14:00:02.000Z',
      payload: { quote_id: 'q-1', order_id: 'ord-1', seller_id: 's-1' } },
  ];
}

function mockWithOutbox(events) {
  return createGraphPgMock({
    store: {
      trade_graph_nodes: [], trade_graph_edges: [], trade_graph_processed_events: [],
      trade_graph_dead_letters: [], trade_graph_rebuilds: [], trade_graph_projection_checkpoints: [],
      trade_graph_materialized_summaries: [], domain_events: events.map((e) => ({ ...e })),
    },
  });
}

test('FIX E: projectPendingEvents reads ids from domain_events and projects them (event.id owned by this path)', async () => {
  const { client, store } = mockWithOutbox(pollOutbox());
  const res = await svc().projectPendingEvents(ctx(client, { tenantId: T_A }));

  assert.equal(res.outcome, 'POLLED');
  assert.equal(res.scanned, 3, 'all three unprojected outbox rows scanned');
  assert.equal(res.projected, 3, 'all three projected');
  assert.equal(res.deadLettered, 0);

  // The processed ledger keys off the domain_events.id (the id is OWNED by the poll driver, not the payload).
  const ledgerIds = store.trade_graph_processed_events.map((p) => p.event_id).sort();
  assert.deepEqual(ledgerIds, [evId(60), evId(61), evId(62)].sort(), 'processed ledger ids == domain_events ids');

  // Every edge carries source_event_ref = a real domain_events.id (provenance preserved through the poll).
  const eventIdSet = new Set([evId(60), evId(61), evId(62)]);
  assert.ok(store.trade_graph_edges.length > 0, 'edges derived');
  for (const e of store.trade_graph_edges) {
    assert.ok(eventIdSet.has(e.source_event_ref), `edge source_event_ref ${e.source_event_ref} is a domain_events id`);
  }
  // The order node was created and stamped with the originating event id.
  const order = store.trade_graph_nodes.find((n) => n.node_type === 'BUYER_ORDER' && n.entity_id === 'ord-1');
  assert.ok(order, 'order node projected via the poll driver');
  assert.equal(order.source_event_ref, evId(60), 'node source_event_ref = the domain_events id');
});

test('FIX E: projectPendingEvents is idempotent — a replay poll projects nothing new (same graph)', async () => {
  const { client, store } = mockWithOutbox(pollOutbox());

  const first = await svc().projectPendingEvents(ctx(client, { tenantId: T_A }));
  assert.equal(first.projected, 3);
  const nodesAfter1 = store.trade_graph_nodes.map((n) => `${n.node_type}:${n.entity_id}`).sort();
  const edgesAfter1 = store.trade_graph_edges.length;
  const ledgerAfter1 = store.trade_graph_processed_events.length;

  // Second poll over the SAME outbox: the anti-join to the processed ledger excludes everything already
  // projected → nothing scanned, nothing projected, graph byte-for-byte unchanged.
  const second = await svc().projectPendingEvents(ctx(client, { tenantId: T_A }));
  assert.equal(second.scanned, 0, 'replay poll scans zero unprojected rows');
  assert.equal(second.projected, 0, 'replay poll projects nothing');
  assert.deepEqual(store.trade_graph_nodes.map((n) => `${n.node_type}:${n.entity_id}`).sort(), nodesAfter1, 'nodes unchanged on replay');
  assert.equal(store.trade_graph_edges.length, edgesAfter1, 'edges unchanged on replay');
  assert.equal(store.trade_graph_processed_events.length, ledgerAfter1, 'ledger unchanged on replay');
});

test('FIX E: poll-built graph equals a rebuild from the same outbox (replay == same graph)', async () => {
  // Poll-built graph.
  const polled = mockWithOutbox(pollOutbox());
  await svc().projectPendingEvents(ctx(polled.client, { tenantId: T_A }));
  resetGraphIds();
  // Rebuild-built graph from the same outbox (processed/pending replayed in order).
  const rebuilt = mockWithOutbox(pollOutbox());
  const r = await svc().rebuildTenantGraph(T_A, ctx(rebuilt.client, { actor: { id: U1, isPlatformAdmin: true }, auditClient }));
  assert.equal(r.status, REBUILD_STATUS.COMPLETED);

  const norm = (store) => ({
    nodes: store.trade_graph_nodes.map((n) => `${n.node_type}:${n.entity_id}`).sort(),
    edges: store.trade_graph_edges
      .map((e) => {
        const s = store.trade_graph_nodes.find((n) => n.id === e.source_node_id);
        const t = store.trade_graph_nodes.find((n) => n.id === e.target_node_id);
        return `${s.node_type}:${s.entity_id}-[${e.edge_type}]->${t.node_type}:${t.entity_id}`;
      })
      .sort(),
  });
  assert.deepEqual(norm(polled.store), norm(rebuilt.store), 'poll-built graph == rebuild-built graph');
});

test('FIX E: projectPendingEvents resumes past the checkpoint across successive polls (no re-projection)', async () => {
  const events = pollOutbox();
  const { client, store } = mockWithOutbox([events[0]]); // start with just the order

  const p1 = await svc().projectPendingEvents(ctx(client, { tenantId: T_A }));
  assert.equal(p1.projected, 1, 'first poll projects the single available event');
  // Now two MORE events arrive in the outbox.
  store.domain_events.push({ ...events[1] }, { ...events[2] });
  const p2 = await svc().projectPendingEvents(ctx(client, { tenantId: T_A }));
  assert.equal(p2.projected, 2, 'second poll projects ONLY the two new events (checkpoint + anti-join resume)');
  assert.equal(store.trade_graph_processed_events.length, 3, 'three distinct events processed across two polls');
});

test('FIX E: projectPendingEvents fail-closes when DIASPORA_TRADE_GRAPH is OFF', async () => {
  process.env.DIASPORA_TRADE_GRAPH = 'false';
  const { client, store } = mockWithOutbox(pollOutbox());
  const res = await svc().projectPendingEvents(ctx(client, { tenantId: T_A }));
  assert.equal(res.outcome, PROJECTION_OUTCOMES.SKIPPED_DISABLED);
  assert.equal(store.trade_graph_nodes.length, 0, 'no writes when the gate is OFF');
});

test('FIX E (negative control): projectPendingEvents requires a uuid tenantId (proves the poll is tenant-scoped)', async () => {
  const { client } = mockWithOutbox(pollOutbox());
  await assert.rejects(
    () => svc().projectPendingEvents(ctx(client, { tenantId: 'not-a-uuid' })),
    /uuid context.tenantId/,
  );
});

test('FIX E: makeProjectionSubscriber THROWS TRADE_GRAPH_SUBSCRIBER_MISSING_EVENT_ID for the real 3-arg worker call', async () => {
  const { client, store } = createGraphPgMock();
  const subscriber = makeProjectionSubscriber(svc(), { getNow: () => FIXED_TS });
  const payload = { order_id: 'ord-1', buyer_id: 'b-1', status: 'REQUESTED' };

  // The UNMODIFIED worker calls handler(payload, client, tenantId) — NO record (4th arg). This MUST fail
  // loudly with the named error instead of silently dropping the event (which would lose every event.id).
  await assert.rejects(
    () => subscriber(payload, client, T_A), // 3-arg call: record omitted
    (err) => {
      assert.equal(err.name, TRADE_GRAPH_SUBSCRIBER_MISSING_EVENT_ID, 'named error thrown');
      assert.equal(err.code, TRADE_GRAPH_SUBSCRIBER_MISSING_EVENT_ID, 'stable error code');
      assert.ok(err instanceof TradeGraphSubscriberMissingEventIdError, 'is the dedicated error class');
      return true;
    },
  );
  // Nothing was written — the misconfiguration is caught BEFORE any projection.
  assert.equal(store.trade_graph_nodes.length, 0, 'no node written on the misconfigured 3-arg call');
  assert.equal(store.trade_graph_processed_events.length, 0, 'no ledger row written on the misconfigured call');
});

test('FIX E: makeProjectionSubscriber also throws when the record carries a non-uuid id', async () => {
  const subscriber = makeProjectionSubscriber(svc(), { getNow: () => FIXED_TS });
  const { client } = createGraphPgMock();
  await assert.rejects(
    () => subscriber({ order_id: 'ord-1' }, client, T_A, { id: 'not-a-uuid', event_type: 'IMPORT_ORDER_CREATED' }),
    (err) => { assert.equal(err.name, TRADE_GRAPH_SUBSCRIBER_MISSING_EVENT_ID); return true; },
  );
});

// NEGATIVE CONTROL for the fail-loud subscriber: WITH a valid record id the subscriber projects normally,
// proving the throw is specific to the missing-id misconfiguration (not a blanket failure). Reverting the
// guard (so a missing id silently projects) would make the 3-arg test above project with id=null — caught.
test('FIX E (negative control): WITH a uuid record id the subscriber projects (guard is id-specific)', async () => {
  const { client, store } = createGraphPgMock();
  const subscriber = makeProjectionSubscriber(svc(), { getNow: () => FIXED_TS });
  const record = { id: evId(70), event_type: 'IMPORT_ORDER_CREATED', tenant_id: T_A, created_at: FIXED_TS };
  const res = await subscriber({ order_id: 'ord-1', buyer_id: 'b-1', status: 'REQUESTED' }, client, T_A, record);
  assert.equal(res.outcome, PROJECTION_OUTCOMES.PROJECTED, 'valid record id projects normally');
  assert.equal(res.eventId, evId(70));
  assert.equal(store.trade_graph_processed_events.length, 1);
});

// ── Rebuild dead-letter sink (FIX E): never corrupt the rebuild's own transaction ──

test('FIX E: a failing event during rebuild is counted + skipped WITHOUT writing a DL into the rebuild txn', async () => {
  // Outbox with one GOOD event and one event that fails node insert. The rebuild has NO separate DL sink,
  // so the DL write must be SKIPPED (not written on the rebuild client, which the rebuild rollback would
  // erase / a failed statement would poison) — the rebuild still completes and counts the failed event.
  const events = [
    orderEvent(evId(80), T_A, { order_id: 'ord-good', buyer_id: 'b-1', status: 'REQUESTED' }),
    tradeProfileEvent(evId(81), T_A, { trade_profile_id: 'tp-bad', user_id: U1, created_by: U1 }),
  ].map((e) => ({ ...e, status: 'processed' }));
  const rebuilt = createGraphPgMock({
    faults: { failNodeInsertFor: 'tp-bad' }, // fault only the bad event's node insert
    store: {
      trade_graph_nodes: [], trade_graph_edges: [], trade_graph_processed_events: [],
      trade_graph_dead_letters: [], trade_graph_rebuilds: [], trade_graph_projection_checkpoints: [],
      trade_graph_materialized_summaries: [], domain_events: events,
    },
  });

  const res = await svc().rebuildTenantGraph(
    T_A, ctx(rebuilt.client, { actor: { id: U1, isPlatformAdmin: true }, auditClient }),
  );
  assert.equal(res.status, REBUILD_STATUS.COMPLETED, 'rebuild completes despite a failing event');
  assert.equal(res.eventsFailed, 1, 'the bad event is counted as failed');
  assert.equal(res.eventsProcessed, 1, 'the good event still projects');
  // The good event survived; NO dead-letter was written into the rebuild store (rollback-safe skip).
  assert.ok(rebuilt.store.trade_graph_nodes.find((n) => n.entity_id === 'ord-good'), 'good event projected');
  assert.equal(rebuilt.store.trade_graph_dead_letters.length, 0, 'no DL written into the rebuild txn (skipped gracefully)');
});

test('FIX E: a rebuild WITH an injected durable DL sink captures the failing event on the separate connection', async () => {
  const events = [
    tradeProfileEvent(evId(82), T_A, { trade_profile_id: 'tp-bad', user_id: U1, created_by: U1 }),
  ].map((e) => ({ ...e, status: 'processed' }));
  const rebuilt = createGraphPgMock({
    faults: { failNodeInsertFor: 'tp-bad' },
    store: {
      trade_graph_nodes: [], trade_graph_edges: [], trade_graph_processed_events: [],
      trade_graph_dead_letters: [], trade_graph_rebuilds: [], trade_graph_projection_checkpoints: [],
      trade_graph_materialized_summaries: [], domain_events: events,
    },
  });
  const dlSink = createGraphPgMock();

  const res = await svc().rebuildTenantGraph(
    T_A, ctx(rebuilt.client, { actor: { id: U1, isPlatformAdmin: true }, auditClient, deadLetterPool: makeGraphPool(dlSink) }),
  );
  assert.equal(res.status, REBUILD_STATUS.COMPLETED);
  assert.equal(res.eventsFailed, 1);
  // The DL landed on the SEPARATE sink, NOT the rebuild store.
  assert.equal(dlSink.store.trade_graph_dead_letters.length, 1, 'DL captured on the durable separate sink');
  assert.equal(dlSink.store.trade_graph_dead_letters[0].event_id, evId(82));
  assert.equal(rebuilt.store.trade_graph_dead_letters.length, 0, 'no DL written into the rebuild txn');
});

// ═════════════════════════════════════════════════════════════════════════════
// FIX H — per-event SAVEPOINT isolation defeats Postgres transaction-abort POISONING
//
// CONTEXT: projectPendingEvents and rebuildTenantGraph project a BATCH of events inside ONE enclosing
// Postgres transaction (the poll/rebuild BEGIN…COMMIT — its FOR UPDATE SKIP LOCKED select REQUIRES it).
// On real Postgres, the first statement that errors ABORTS the whole transaction: every following
// statement then fails with "current transaction is aborted …" until a ROLLBACK / ROLLBACK TO SAVEPOINT.
// A bare per-event try/catch is therefore broken — one bad event poisons all following events. The fix
// wraps each event in a SAVEPOINT and ROLLs BACK TO it on failure (clearing the abort state) so the loop
// continues. The mock now MODELS this poisoning (txn.aborted + the SAVEPOINT/RELEASE/ROLLBACK-TO lifecycle),
// which is what makes these tests GENUINE rather than false assurance.
// ═════════════════════════════════════════════════════════════════════════════

// A mid-batch outbox: a GOOD order, then a BAD trade-profile (its node insert faults), then ANOTHER GOOD
// order AFTER the failure. The "after" event is the load-bearing one: it only projects if the abort state
// the bad event caused was cleared by ROLLBACK TO SAVEPOINT.
function poisonOutbox(tenant = T_A) {
  return [
    { id: evId(90), event_type: 'IMPORT_ORDER_CREATED', tenant_id: tenant, status: 'pending', created_at: '2026-06-21T14:00:00.000Z',
      payload: { order_id: 'ord-before', buyer_id: 'b-1', status: 'REQUESTED' } },
    { id: evId(91), event_type: 'TRADE_PROFILE_CREATED', tenant_id: tenant, status: 'pending', created_at: '2026-06-21T14:00:01.000Z',
      payload: { trade_profile_id: 'tp-bad', user_id: U1, created_by: U1 } },
    { id: evId(92), event_type: 'IMPORT_ORDER_CREATED', tenant_id: tenant, status: 'pending', created_at: '2026-06-21T14:00:02.000Z',
      payload: { order_id: 'ord-after', buyer_id: 'b-2', status: 'REQUESTED' } },
  ];
}

function poisonMock(events, faults) {
  return createGraphPgMock({
    faults,
    store: {
      trade_graph_nodes: [], trade_graph_edges: [], trade_graph_processed_events: [],
      trade_graph_dead_letters: [], trade_graph_rebuilds: [], trade_graph_projection_checkpoints: [],
      trade_graph_materialized_summaries: [], domain_events: events.map((e) => ({ ...e })),
    },
  });
}

/**
 * NEGATIVE-CONTROL wrapper: a client that NEUTERS the SAVEPOINT lifecycle (SAVEPOINT / RELEASE SAVEPOINT /
 * ROLLBACK TO SAVEPOINT become no-ops) while passing every other statement — including BEGIN and the
 * fault — straight through to the real abort-modeling mock. This is EXACTLY the pre-FIX-H behavior (events
 * looped inside one txn with no savepoint), so it proves the savepoint calls are load-bearing: with them
 * neutered, the bad event's abort is NEVER cleared and the following event hits "current transaction is
 * aborted". `savepointCalls` records that the service really did issue the savepoint verbs (so the control
 * is neutralizing real calls, not a no-op).
 */
function withSavepointsDisabled(mock) {
  const savepointCalls = [];
  const realQuery = mock.client.query;
  const client = {
    query(text, params) {
      const sql = String(text).replace(/\s+/g, ' ').trim().toUpperCase();
      if (/^(SAVEPOINT|RELEASE\s+SAVEPOINT|ROLLBACK\s+TO\s+SAVEPOINT)\b/.test(sql)) {
        savepointCalls.push(sql);
        return Promise.resolve({ rows: [] }); // swallow → abort state is never cleared (pre-fix behavior)
      }
      return realQuery(text, params);
    },
  };
  return { client, store: mock.store, faults: mock.faults, savepointCalls };
}

// ── Mock self-test: the abort-poisoning model itself is correct (so the tests below are trustworthy). ──
test('FIX H (mock model): a fault inside BEGIN poisons the txn until ROLLBACK TO SAVEPOINT clears it', async () => {
  const { client } = poisonMock([], { failEdgeInsert: true });
  await client.query('BEGIN');
  await client.query('SAVEPOINT trade_graph_evt');
  // A faulting statement inside the txn aborts it.
  await assert.rejects(() => client.query('INSERT INTO trade_graph_edges VALUES', ['t', 's', 'g', 'E', 'e', 1, 'p', '2026', '{}']), /FAULT\/EDGE_INSERT/);
  // While aborted, ANY further statement fails with the Postgres abort message …
  await assert.rejects(
    () => client.query('SELECT event_id FROM trade_graph_processed_events WHERE event_id = $1', ['x']),
    /current transaction is aborted/,
  );
  // … UNTIL ROLLBACK TO SAVEPOINT clears it, after which statements run again.
  await client.query('ROLLBACK TO SAVEPOINT trade_graph_evt');
  const ok = await client.query('SELECT event_id FROM trade_graph_processed_events WHERE event_id = $1', ['x']);
  assert.deepEqual(ok.rows, [], 'transaction usable again after ROLLBACK TO SAVEPOINT');
});

test('FIX H (mock model): a plain ROLLBACK also clears the abort state', async () => {
  const { client } = poisonMock([], { failEdgeInsert: true });
  await client.query('BEGIN');
  await assert.rejects(() => client.query('INSERT INTO trade_graph_edges VALUES', ['t', 's', 'g', 'E', 'e', 1, 'p', '2026', '{}']), /FAULT\/EDGE_INSERT/);
  await assert.rejects(() => client.query('SELECT last_event_created_at FROM trade_graph_projection_checkpoints WHERE tenant_id = $1', [T_A]), /current transaction is aborted/);
  await client.query('ROLLBACK');
  // After ROLLBACK a NEW txn is healthy.
  await client.query('BEGIN');
  const ok = await client.query('SELECT last_event_created_at FROM trade_graph_projection_checkpoints WHERE tenant_id = $1', [T_A]);
  assert.deepEqual(ok.rows, [], 'usable after full ROLLBACK');
});

// ── POLL DRIVER: per-event SAVEPOINT isolates a mid-batch failure (the real fix, proven) ──
test('FIX H (poll, POSITIVE): a mid-batch failure is isolated; events AFTER it still project', async () => {
  // The poll driver assumes an enclosing transaction (FOR UPDATE SKIP LOCKED). We open it here exactly like
  // the route's withTransaction so the abort-poisoning model is in force for the whole tick.
  const mock = poisonMock(poisonOutbox(), { failNodeInsertFor: 'tp-bad' });
  await mock.client.query('BEGIN');
  const res = await svc().projectPendingEvents(ctx(mock.client, { tenantId: T_A, deadLetterPool: makeGraphPool(poisonMock([], {})) }));
  await mock.client.query('COMMIT');

  assert.equal(res.scanned, 3, 'all three rows scanned in the batch');
  assert.equal(res.projected, 2, 'the two GOOD events projected (the failure did not poison them)');
  assert.equal(res.deadLettered, 1, 'only the bad event is dead-lettered');

  // The crucial proof: the event AFTER the failure projected its node. WITHOUT the savepoint fix the
  // ord-after node insert would have thrown "current transaction is aborted" and been dead-lettered too.
  assert.ok(mock.store.trade_graph_nodes.find((n) => n.entity_id === 'ord-before'), 'event BEFORE the failure projected');
  assert.ok(mock.store.trade_graph_nodes.find((n) => n.entity_id === 'ord-after'), 'event AFTER the failure projected (abort state was cleared)');
  assert.ok(!mock.store.trade_graph_nodes.find((n) => n.entity_id === 'tp-bad'), 'the bad event wrote no node (rolled back to its savepoint)');
  // Both good events are in the processed ledger; the bad one is NOT (so a later poll retries it).
  const ledger = mock.store.trade_graph_processed_events.map((p) => p.event_id).sort();
  assert.deepEqual(ledger, [evId(90), evId(92)].sort(), 'only the two good events are marked processed');
});

test('FIX H (poll, NEGATIVE CONTROL): with the SAVEPOINT verbs neutered, the failure POISONS following events', async () => {
  // Same scenario, but the savepoint lifecycle is disabled (modeling the pre-fix code with no SAVEPOINT).
  // Now the bad event's abort is never cleared, so the FOLLOWING event hits "current transaction is aborted"
  // and is dead-lettered too. This proves the savepoint calls are LOAD-BEARING — remove them and the test
  // for the positive case above would fail.
  const raw = poisonMock(poisonOutbox(), { failNodeInsertFor: 'tp-bad' });
  const mock = withSavepointsDisabled(raw);
  await mock.client.query('BEGIN');
  const res = await svc().projectPendingEvents(ctx(mock.client, { tenantId: T_A, deadLetterPool: makeGraphPool(poisonMock([], {})) }));

  // The service DID issue the savepoint verbs (we neutralized real calls, not nothing).
  assert.ok(mock.savepointCalls.some((c) => c.startsWith('SAVEPOINT')), 'service issued SAVEPOINT (control neutered it)');
  assert.ok(mock.savepointCalls.some((c) => c.startsWith('ROLLBACK TO SAVEPOINT')), 'service issued ROLLBACK TO SAVEPOINT (control neutered it)');

  // ord-before projected (it ran before the abort). The bad event poisoned the txn, and because the rollback
  // was neutered, ord-after ALSO fails → 1 projected, 2 dead-lettered.
  assert.equal(res.projected, 1, 'only the event BEFORE the failure survived');
  assert.equal(res.deadLettered, 2, 'the failure POISONED the following event too (no savepoint recovery)');
  assert.ok(mock.store.trade_graph_nodes.find((n) => n.entity_id === 'ord-before'), 'pre-failure event projected');
  assert.ok(!mock.store.trade_graph_nodes.find((n) => n.entity_id === 'ord-after'), 'post-failure event POISONED (no node) without savepoint recovery');
});

// ── REBUILD: per-event SAVEPOINT isolates a mid-replay failure ──
test('FIX H (rebuild, POSITIVE): a mid-replay failure is isolated; later replay events still project', async () => {
  const events = poisonOutbox().map((e) => ({ ...e, status: 'processed' }));
  const mock = poisonMock(events, { failNodeInsertFor: 'tp-bad' });
  // The rebuild assumes its own dedicated BEGIN…COMMIT (route withTransaction). Open it so the abort model
  // is in force across the whole replay.
  await mock.client.query('BEGIN');
  const res = await svc().rebuildTenantGraph(T_A, ctx(mock.client, { actor: { id: U1, isPlatformAdmin: true }, auditClient }));
  await mock.client.query('COMMIT');

  assert.equal(res.status, REBUILD_STATUS.COMPLETED, 'rebuild completes despite a mid-replay failure');
  assert.equal(res.eventsFailed, 1, 'the bad event counted as failed');
  assert.equal(res.eventsProcessed, 2, 'BOTH good events projected (failure isolated by the savepoint)');
  assert.ok(mock.store.trade_graph_nodes.find((n) => n.entity_id === 'ord-before'), 'pre-failure replay event projected');
  assert.ok(mock.store.trade_graph_nodes.find((n) => n.entity_id === 'ord-after'), 'post-failure replay event projected (abort cleared)');
});

test('FIX H (rebuild, NEGATIVE CONTROL): with SAVEPOINT verbs neutered, the failure poisons the WHOLE rebuild', async () => {
  const events = poisonOutbox().map((e) => ({ ...e, status: 'processed' }));
  const raw = poisonMock(events, { failNodeInsertFor: 'tp-bad' });
  const mock = withSavepointsDisabled(raw);
  await mock.client.query('BEGIN');
  // Pre-fix behavior: the bad event poisons the rebuild's single transaction and the neutered ROLLBACK TO
  // SAVEPOINT never clears it. The following replay event AND the post-loop bookkeeping UPDATEs then all hit
  // "current transaction is aborted", so the rebuild itself REJECTS (the abort poisoning escaped). This is
  // precisely the failure mode the savepoint fix eliminates — proving the savepoint calls are load-bearing.
  await assert.rejects(
    () => svc().rebuildTenantGraph(T_A, ctx(mock.client, { actor: { id: U1, isPlatformAdmin: true }, auditClient })),
    /current transaction is aborted/,
  );
  assert.ok(mock.savepointCalls.some((c) => c.startsWith('ROLLBACK TO SAVEPOINT')), 'service issued ROLLBACK TO SAVEPOINT (control neutered it)');
  assert.ok(!mock.store.trade_graph_nodes.find((n) => n.entity_id === 'ord-after'), 'post-failure replay event POISONED without savepoint recovery');
});

// ── The savepoint name is the stable, documented identifier (kept in lockstep with the service). ──
test('FIX H: the projection service uses the documented SAVEPOINT name', () => {
  assert.equal(TRADE_GRAPH_EVENT_SAVEPOINT, 'trade_graph_evt');
});

// ═════════════════════════════════════════════════════════════════════════════
// GATE T10 — CRASH BETWEEN RECEIPT AND PROJECTION COMPLETION + REPLAY CONVERGENCE
//
// Simulates a process crash AFTER an event's nodes/edges are written but BEFORE the processed-ledger row /
// COMMIT (the mock's `failProcessedInsert` faults exactly at the `INSERT INTO trade_graph_processed_events`
// — i.e. after #applyNodeOperation/#applyEdgeOperation succeed, before the idempotency row is written).
// On real Postgres that statement's failure ABORTS the transaction, so the node/edge writes from the SAME
// transaction roll back too; the event is NOT in the processed ledger and is therefore RETRYABLE — never
// silently lost. We prove:
//   (1) a crash at that point leaves the event UNPROCESSED (retryable), and
//   (2) replaying the outbox converges to the SAME graph as a clean run — idempotent by domain_events.id,
//       with NO duplicate nodes / edges — and that out-of-order and duplicate delivery converge identically.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Canonical, content-addressable normalization of a graph store: node/edge identities by their DOMAIN keys
 * (node_type:entity_id and the resolved type:entity endpoints + edge_type), NOT by the mock's synthetic row
 * ids. Two stores that converge to the same graph compare deepEqual under this normalization regardless of
 * the order events were applied or how many times.
 */
function normGraph(store) {
  const nodeById = new Map(store.trade_graph_nodes.map((n) => [String(n.id), n]));
  return {
    nodes: store.trade_graph_nodes
      .filter((n) => n.is_current && n.deleted_at == null)
      .map((n) => `${n.node_type}:${n.entity_id}`)
      .sort(),
    edges: store.trade_graph_edges
      .filter((e) => e.deleted_at == null)
      .map((e) => {
        const s = nodeById.get(String(e.source_node_id));
        const t = nodeById.get(String(e.target_node_id));
        return `${s.node_type}:${s.entity_id}-[${e.edge_type}]->${t.node_type}:${t.entity_id}`;
      })
      .sort(),
  };
}

/** A small ordered outbox: order → quote-accepted → stock-reserved → document. All tenant A, fixed times. */
function crashOutbox(tenant = T_A) {
  return [
    { id: evId(120), event_type: 'IMPORT_ORDER_CREATED', tenant_id: tenant, status: 'pending', created_at: '2026-06-21T14:00:00.000Z',
      payload: { order_id: 'ord-1', buyer_id: 'b-1', status: 'IMPORT_REQUESTED', origin_country: 'NG' } },
    { id: evId(121), event_type: 'QUOTE_ACCEPTED', tenant_id: tenant, status: 'pending', created_at: '2026-06-21T14:00:01.000Z',
      payload: { quote_id: 'q-1', order_id: 'ord-1', seller_id: 's-1' } },
    { id: evId(122), event_type: 'STOCK_RESERVED', tenant_id: tenant, status: 'pending', created_at: '2026-06-21T14:00:02.000Z',
      payload: { stock_item_id: 'st-1', order_id: 'ord-1', seller_trade_profile_id: 's-1' } },
    { id: evId(123), event_type: 'DOCUMENT_UPLOADED', tenant_id: tenant, status: 'pending', created_at: '2026-06-21T14:00:03.000Z',
      payload: { document_id: 'doc-1', order_id: 'ord-1', document_type: 'INVOICE', verification_status: 'VERIFIED', uploaded_by: 'b-1' } },
  ];
}

/** Project a list of envelopes through a FRESH clean run (no faults) to get the canonical converged graph. */
async function cleanRun(events) {
  const { client, store } = createGraphPgMock();
  for (const ev of events) await svc().projectEvent({ ...ev }, ctx(client));
  return store;
}

test('T3: crash AFTER node/edge writes but BEFORE the processed-ledger insert leaves the event UNPROCESSED (retryable, not lost)', async () => {
  // Fault exactly at the processed-ledger insert: nodes/edges were written, then the crash happens.
  const { client, store, faults } = createGraphPgMock({ faults: { failProcessedInsert: true } });
  const ev = crashOutbox()[0];

  await assert.rejects(
    () => svc().projectEvent({ ...ev }, ctx(client)),
    /FAULT\/PROCESSED_INSERT/,
    'the crash at the processed-ledger insert surfaces (rethrown so the worker retries)',
  );
  // The idempotency row was NOT written → the event is retryable, NOT silently marked done.
  assert.equal(store.trade_graph_processed_events.length, 0, 'event NOT in the processed ledger after the crash');
  // A dead-letter was recorded for operator visibility (durably; here best-effort on the same store).
  assert.equal(store.trade_graph_dead_letters.length, 1, 'crash recorded a dead-letter for visibility');
  assert.equal(store.trade_graph_dead_letters[0].event_id, ev.id);

  // RETRY after the crash clears: the SAME event id reprocesses and now completes (idempotent by id).
  faults.failProcessedInsert = false;
  const retry = await svc().projectEvent({ ...ev }, ctx(client));
  assert.equal(retry.outcome, PROJECTION_OUTCOMES.PROJECTED, 'retry of the same event id completes');
  assert.equal(store.trade_graph_processed_events.length, 1, 'now marked processed exactly once');
  // No duplicate order node despite the failed-then-retried attempt (dedup on tenant/type/entity).
  assert.equal(store.trade_graph_nodes.filter((n) => n.node_type === 'BUYER_ORDER' && n.entity_id === 'ord-1').length, 1);
});

test('T3: replay after a mid-stream crash CONVERGES to the same graph as a clean run (idempotent by domain_events.id, no dupes)', async () => {
  const events = crashOutbox();
  const expected = normGraph(await cleanRun(events));
  resetGraphIds();

  // Crash partway: events 0 and 1 succeed; event 2's processed-ledger insert faults (crash). The worker
  // rethrows → event 2 stays UNPROCESSED. Then the fault clears and the outbox is REPLAYED end-to-end.
  const { client, store, faults } = createGraphPgMock();
  await svc().projectEvent({ ...events[0] }, ctx(client));
  await svc().projectEvent({ ...events[1] }, ctx(client));

  faults.failProcessedInsert = true; // crash right before event 2 is marked processed
  await assert.rejects(() => svc().projectEvent({ ...events[2] }, ctx(client)), /FAULT\/PROCESSED_INSERT/);
  assert.ok(!store.trade_graph_processed_events.some((p) => p.event_id === events[2].id), 'crashed event unprocessed');

  // Recovery: clear the fault and REPLAY the WHOLE outbox (at-least-once redelivery). Already-processed
  // events (0,1) short-circuit on the ledger; the crashed event (2) and the never-seen event (3) project.
  faults.failProcessedInsert = false;
  let projected = 0; let replayed = 0;
  for (const ev of events) {
    const r = await svc().projectEvent({ ...ev }, ctx(client));
    if (r.outcome === PROJECTION_OUTCOMES.PROJECTED) projected += 1;
    if (r.outcome === PROJECTION_OUTCOMES.IDEMPOTENT_REPLAY) replayed += 1;
  }
  assert.equal(replayed, 2, 'events already processed before the crash are idempotent replays');
  assert.equal(projected, 2, 'the crashed event + the unseen event project on replay');

  // CONVERGENCE: the recovered graph is byte-for-byte (content-addressable) identical to a clean run.
  assert.deepEqual(normGraph(store), expected, 'post-crash replay converges to the clean-run graph');
  // Exactly one processed-ledger row per distinct event id (no double-processing).
  assert.equal(store.trade_graph_processed_events.length, events.length, 'each event processed exactly once');
});

test('T3: OUT-OF-ORDER delivery converges deterministically to the same graph as in-order delivery', async () => {
  const ordered = crashOutbox();
  const expected = normGraph(await cleanRun(ordered));
  resetGraphIds();

  // Deliver in a scrambled order: document (refs order) → stock (refs order) → quote → order LAST. The
  // edge-endpoint placeholders are created for the not-yet-seen order and later enriched in place.
  const scrambled = [ordered[3], ordered[2], ordered[1], ordered[0]];
  const { client, store } = createGraphPgMock();
  for (const ev of scrambled) await svc().projectEvent({ ...ev }, ctx(client));

  assert.deepEqual(normGraph(store), expected, 'out-of-order delivery converges to the in-order graph');
  // No duplicate order node from the placeholder-then-real path.
  assert.equal(store.trade_graph_nodes.filter((n) => n.node_type === 'BUYER_ORDER' && n.entity_id === 'ord-1').length, 1,
    'placeholder order enriched in place, not duplicated');
});

test('T3: DUPLICATE delivery (same event id redelivered repeatedly) converges deterministically — exactly-once effect', async () => {
  const events = crashOutbox();
  const expected = normGraph(await cleanRun(events));
  resetGraphIds();

  const { client, store } = createGraphPgMock();
  // At-least-once delivery: each event is delivered TWICE (and the first one a third time), interleaved.
  const delivery = [events[0], events[0], events[1], events[2], events[1], events[3], events[3], events[0], events[2]];
  let projected = 0; let replays = 0;
  for (const ev of delivery) {
    const r = await svc().projectEvent({ ...ev }, ctx(client));
    if (r.outcome === PROJECTION_OUTCOMES.PROJECTED) projected += 1;
    if (r.outcome === PROJECTION_OUTCOMES.IDEMPOTENT_REPLAY) replays += 1;
  }
  assert.equal(projected, events.length, 'each distinct event projects exactly once across duplicate deliveries');
  assert.equal(replays, delivery.length - events.length, 'every redelivery short-circuits as an idempotent replay');

  // CONVERGENCE: duplicate deliveries leave the SAME graph as a single clean pass (no duplicate nodes/edges).
  assert.deepEqual(normGraph(store), expected, 'duplicate delivery converges to the clean-run graph');
  assert.equal(store.trade_graph_processed_events.length, events.length, 'one processed-ledger row per distinct id');
  // Spot-check: a single ord-1 node and a single FULFILLS/ACCEPTED_QUOTE edge instance per relationship.
  assert.equal(store.trade_graph_nodes.filter((n) => n.node_type === 'BUYER_ORDER' && n.entity_id === 'ord-1').length, 1);
  const acceptedEdges = store.trade_graph_edges.filter((e) => e.edge_type === 'ACCEPTED_QUOTE' && e.deleted_at == null);
  assert.equal(acceptedEdges.length, 1, 'no duplicate ACCEPTED_QUOTE edge from duplicate delivery');
});

test('T3: crash + replay convergence via the POLL DRIVER (anti-join + checkpoint reprocesses the crashed event)', async () => {
  // Same crash semantics, but exercised through the supported self-contained poll driver. The crashed event
  // stays out of the processed ledger, so a SUBSEQUENT poll re-selects it (anti-join) and projects it.
  const events = crashOutbox();
  const expected = normGraph(await cleanRun(events));
  resetGraphIds();

  const mock = createGraphPgMock({
    store: {
      trade_graph_nodes: [], trade_graph_edges: [], trade_graph_processed_events: [],
      trade_graph_dead_letters: [], trade_graph_rebuilds: [], trade_graph_projection_checkpoints: [],
      trade_graph_materialized_summaries: [], domain_events: events.map((e) => ({ ...e })),
    },
  });
  const dlSink = makeGraphPool(createGraphPgMock());

  // First poll: fault the processed-ledger insert so EVERY event in the tick crashes at the ledger step and
  // is dead-lettered (none marked processed) — the worst case "received but not completed".
  mock.faults.failProcessedInsert = true;
  await mock.client.query('BEGIN');
  const p1 = await svc().projectPendingEvents(ctx(mock.client, { tenantId: T_A, deadLetterPool: dlSink }));
  await mock.client.query('COMMIT');
  assert.equal(p1.projected, 0, 'no event completed when the ledger insert crashes');
  assert.equal(p1.deadLettered, events.length, 'all received events dead-lettered (retryable)');
  assert.equal(mock.store.trade_graph_processed_events.length, 0, 'nothing marked processed after the crash');

  // Recovery poll: the fault clears; the anti-join re-selects the un-ledgered events and projects them.
  mock.faults.failProcessedInsert = false;
  await mock.client.query('BEGIN');
  const p2 = await svc().projectPendingEvents(ctx(mock.client, { tenantId: T_A, deadLetterPool: dlSink }));
  await mock.client.query('COMMIT');
  assert.equal(p2.projected, events.length, 'recovery poll projects every previously-crashed event');

  assert.deepEqual(normGraph(mock.store), expected, 'poll-driver crash recovery converges to the clean-run graph');
  assert.equal(mock.store.trade_graph_processed_events.length, events.length, 'each event processed exactly once after recovery');
});
