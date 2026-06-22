/**
 * Phase 10 — JS reference for the Trade Graph SQL surface, used ONLY by the in-memory pg mock in
 * tests. Unlike the SafeTrade/H1-H3 references (which mirror Supabase `.rpc()` atomic functions), the
 * Phase 10 PROJECTION service writes the graph with raw parameterized SQL through the eventWorker's
 * raw `pg` client (`pgClient.query(text, params)`), so this helper is a tiny in-memory PostgreSQL
 * shim: it understands exactly the statements the projection service issues and the two SECURITY
 * DEFINER RPCs it calls, mirroring:
 *
 *   database/migrations/20260621140000_diaspora_phase10_trade_graph.sql
 *     - tables: trade_graph_nodes / _edges / _processed_events / _dead_letters / _rebuilds /
 *               _projection_checkpoints  (column names + dedup semantics)
 *     - RPCs:   trade_graph_record_checkpoint(...)   (idempotent per-tenant checkpoint upsert)
 *               trade_graph_request_rebuild(...)     (rate limit → RUNNING / RATE_LIMITED)
 *
 * It enforces the invariants that make the projection correct WITHOUT a real DB:
 *   - nodes dedup on (tenant_id, node_type, entity_id) over current/non-deleted rows (ON CONFLICT
 *     merges data: existing || new).
 *   - edges dedup on (tenant_id, source_node_id, target_node_id, edge_type, source_event_ref) over
 *     non-deleted rows (ON CONFLICT DO NOTHING).
 *   - processed_events / dead_letters dedup on event_id.
 *   - no_self_loops is honored by the projection service (it never calls us with src===tgt).
 *
 * This is a behavioral mirror (not a SQL parser): it pattern-matches the specific statements the
 * service emits. If the service's SQL changes, update this shim in lockstep. A fixed timestamp is
 * injected by the test; this shim never calls Date.now() for stored values.
 */

let __idCounter = 0;
function nextUuid(prefix) {
  // Deterministic, UNIQUE uuid-shaped id for tests (8-4-4-4-12). The monotonic counter fills the final
  // 12-hex node so every id is distinct; a 2-char tag in the 3rd block lets assertions recognize the
  // kind (node/edge/...) without depending on insertion order.
  __idCounter += 1;
  // Map the kind to a stable hex nibble for the 3rd-block suffix so ids stay valid uuids
  // (version=4, variant=8) while the monotonic counter guarantees uniqueness in the 12-hex node.
  const kind = { node: '1', edge: '2', proc: '3', dead: '4', ckpt: '5', rbld: '6' }[prefix] || '0';
  const n = __idCounter.toString(16).padStart(12, '0'); // exactly 12 hex, unique per call
  return `00000000-0000-400${kind}-8000-${n}`;
}

/** Reset the deterministic id counter between tests for stable, isolated ids. */
export function resetGraphIds() {
  __idCounter = 0;
}

/**
 * Create an in-memory raw-pg client whose `query(text, params)` mirrors the Phase 10 SQL the
 * projection service issues. Tables live in the returned `store` so tests can assert directly.
 *
 * @param {object} [opts]
 *   @param {object} [opts.store] - seed/share a store across rebuild transactions (e.g. domain_events).
 *   @param {object} [opts.faults] - { failNodeInsert, failEdgeInsert, failProcessedInsert } to force a
 *     projection error and prove dead-lettering + outbox surfacing.
 * @returns {{ client: { query }, store: object, faults: object }}
 */
export function createGraphPgMock(opts = {}) {
  const store = opts.store || {
    trade_graph_nodes: [],
    trade_graph_edges: [],
    trade_graph_processed_events: [],
    trade_graph_dead_letters: [],
    trade_graph_rebuilds: [],
    trade_graph_projection_checkpoints: [],
    trade_graph_materialized_summaries: [],
    domain_events: [],
  };
  // Ensure all tables exist even when a partial store is passed in.
  for (const t of [
    'trade_graph_nodes', 'trade_graph_edges', 'trade_graph_processed_events',
    'trade_graph_dead_letters', 'trade_graph_rebuilds', 'trade_graph_projection_checkpoints',
    'trade_graph_materialized_summaries', 'domain_events',
  ]) {
    if (!store[t]) store[t] = [];
  }
  const faults = opts.faults || {};

  // ── FIX H: model Postgres transaction-abort POISONING + SAVEPOINT lifecycle ──────────────────────────
  // On real Postgres, the FIRST statement that errors INSIDE a transaction ABORTS the whole transaction:
  // every later statement then fails with "current transaction is aborted, commands ignored until end of
  // transaction block" UNTIL a ROLLBACK or a ROLLBACK TO SAVEPOINT clears it. The original in-memory shim
  // did not model this, so a broken catch-and-continue (no per-event SAVEPOINT) looked fine in tests. This
  // state machine makes the poisoning REAL so the savepoint isolation is genuinely load-bearing.
  //
  //   txn.depth        — BEGIN increments, COMMIT/ROLLBACK reset to 0 (>0 means "inside a transaction").
  //   txn.aborted      — set true when a statement faults inside a transaction; blocks all statements
  //                      except the savepoint/txn-control verbs below until cleared.
  //   txn.savepoints   — ordered stack of live SAVEPOINT names within the current transaction.
  const txn = { depth: 0, aborted: false, savepoints: [] };
  const ABORT_MESSAGE = 'current transaction is aborted, commands ignored until end of transaction block';

  /** Mark the transaction aborted (only meaningful while inside one) and produce the fault rejection. */
  function faultInTxn(error) {
    if (txn.depth > 0) txn.aborted = true;
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }

  const currentNode = (tenantId, nodeType, entityId) =>
    store.trade_graph_nodes.find(
      (r) => String(r.tenant_id) === String(tenantId)
        && r.node_type === nodeType
        && String(r.entity_id) === String(entityId)
        && r.is_current === true
        && r.deleted_at == null,
    );

  function query(text, params = []) {
    const sql = String(text).replace(/\s+/g, ' ').trim();
    const upper = sql.toUpperCase().replace(/;$/, '');

    // ── transaction + SAVEPOINT control (FIX H: now stateful, to model abort poisoning) ──
    // BEGIN/COMMIT/ROLLBACK manage the abort state machine; the durable dead-letter writer (FIX 4) opens
    // its own BEGIN/COMMIT on a SEPARATE connection (its own mock), and the poll/rebuild paths BEGIN/COMMIT
    // here. SAVEPOINT / RELEASE SAVEPOINT / ROLLBACK TO SAVEPOINT implement the per-event isolation the
    // projection service (FIX H) relies on. The store still mutates in place; transactional rollback of the
    // STORE is not modeled (the projection service never relies on outer-rollback to undo prior writes — it
    // relies on ROLLBACK TO SAVEPOINT to CLEAR THE ABORT STATE so the loop can continue), but the abort
    // gating below is modeled exactly, which is what makes the savepoint fix load-bearing.

    if (upper === 'BEGIN') {
      txn.depth += 1;
      // Entering/representing the enclosing transaction; abort + savepoints are scoped to it.
      txn.aborted = false;
      txn.savepoints = [];
      return Promise.resolve({ rows: [] });
    }
    if (upper === 'COMMIT') {
      // A COMMIT on a poisoned txn would itself error on real Postgres; the projection service never commits
      // a poisoned txn (it rolls back to a savepoint first), so we just close the txn here.
      txn.depth = 0;
      txn.aborted = false;
      txn.savepoints = [];
      return Promise.resolve({ rows: [] });
    }
    if (upper === 'ROLLBACK') {
      // Full rollback ALWAYS clears the abort state and ends the transaction.
      txn.depth = 0;
      txn.aborted = false;
      txn.savepoints = [];
      return Promise.resolve({ rows: [] });
    }

    // SAVEPOINT <name> — establish a nested rollback point. Re-using a name shadows the prior one (Postgres
    // keeps the latest definition), so we push the name (duplicates allowed; ROLLBACK TO targets the latest).
    const spMatch = upper.match(/^SAVEPOINT\s+([A-Z0-9_]+)$/);
    if (spMatch) {
      // A SAVEPOINT issued while aborted is itself rejected on real Postgres; the service only issues one on
      // a healthy txn, but guard anyway so a misuse surfaces rather than silently "fixing" the abort.
      if (txn.aborted) return Promise.reject(new Error(ABORT_MESSAGE));
      txn.savepoints.push(spMatch[1].toLowerCase());
      return Promise.resolve({ rows: [] });
    }
    // RELEASE SAVEPOINT <name> — merge/drop the most recent savepoint of that name (only on a healthy txn).
    const relMatch = upper.match(/^RELEASE\s+SAVEPOINT\s+([A-Z0-9_]+)$/);
    if (relMatch) {
      if (txn.aborted) return Promise.reject(new Error(ABORT_MESSAGE));
      const name = relMatch[1].toLowerCase();
      const idx = txn.savepoints.lastIndexOf(name);
      if (idx === -1) return Promise.reject(new Error(`savepoint "${name}" does not exist`));
      txn.savepoints.splice(idx); // drop this savepoint and any established after it
      return Promise.resolve({ rows: [] });
    }
    // ROLLBACK TO SAVEPOINT <name> — discard work since <name> AND CLEAR the abort flag (the key behavior:
    // this is the ONLY way, short of full ROLLBACK, to make a poisoned transaction usable again).
    const rtsMatch = upper.match(/^ROLLBACK\s+TO\s+SAVEPOINT\s+([A-Z0-9_]+)$/);
    if (rtsMatch) {
      const name = rtsMatch[1].toLowerCase();
      const idx = txn.savepoints.lastIndexOf(name);
      if (idx === -1) {
        // Rolling back to a non-existent savepoint fails even on an aborted txn (and leaves it aborted).
        return Promise.reject(new Error(`savepoint "${name}" does not exist`));
      }
      txn.savepoints.splice(idx + 1); // keep <name>; drop savepoints established after it
      txn.aborted = false;            // ← clears the abort poisoning so following statements run again
      return Promise.resolve({ rows: [] });
    }

    // ── ABORT GATE: once aborted, every non-control statement fails until ROLLBACK / ROLLBACK TO SAVEPOINT.
    if (txn.aborted) {
      return Promise.reject(new Error(ABORT_MESSAGE));
    }

    // ── processed_events: dedup SELECT ──
    if (sql.startsWith('SELECT event_id FROM trade_graph_processed_events WHERE event_id =')) {
      const [eventId] = params;
      const rows = store.trade_graph_processed_events
        .filter((r) => String(r.event_id) === String(eventId))
        .map((r) => ({ event_id: r.event_id }));
      return Promise.resolve({ rows });
    }

    // ── FIX E poll driver: read the per-tenant checkpoint lower bound (last_event_created_at) ──
    if (sql.startsWith('SELECT last_event_created_at FROM trade_graph_projection_checkpoints WHERE tenant_id =')) {
      const [tenantId] = params;
      const cp = store.trade_graph_projection_checkpoints.find((c) => String(c.tenant_id) === String(tenantId));
      return Promise.resolve({ rows: cp ? [{ last_event_created_at: cp.last_event_created_at ?? null }] : [] });
    }

    // ── FIX E poll driver: SELECT unprojected outbox rows directly (beyond checkpoint, anti-joined to the
    //    processed-events ledger, ordered by created_at then id, bounded). Mirrors the FOR UPDATE SKIP
    //    LOCKED batch SELECT in projectPendingEvents. tenant_id is TEXT in domain_events.
    if (sql.startsWith('SELECT d.id, d.event_type, d.payload, d.tenant_id, d.created_at FROM domain_events d')) {
      const [tenantId, sinceCreatedAt, limit] = params;
      const sinceMs = sinceCreatedAt == null ? null : new Date(sinceCreatedAt).getTime();
      const processed = new Set(store.trade_graph_processed_events.map((p) => String(p.event_id)));
      const rows = store.domain_events
        .filter((e) => String(e.tenant_id) === String(tenantId)
          && ['processed', 'pending'].includes(e.status)
          && (sinceMs == null || new Date(e.created_at).getTime() >= sinceMs)
          && !processed.has(String(e.id)))
        .slice()
        .sort(byCreatedThenId)
        .slice(0, Number(limit) || store.domain_events.length)
        .map((e) => ({ id: e.id, event_type: e.event_type, payload: e.payload, tenant_id: e.tenant_id, created_at: e.created_at }));
      return Promise.resolve({ rows });
    }

    // ── nodes: resolve existing current node id ──
    if (sql.startsWith('SELECT id FROM trade_graph_nodes WHERE tenant_id =')) {
      const [tenantId, nodeType, entityId] = params;
      const row = currentNode(tenantId, nodeType, entityId);
      return Promise.resolve({ rows: row ? [{ id: row.id }] : [] });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Stage 3 READ surface (explainable queries + intelligence). These mirror the
    // parameterized SELECTs the diasporaTradeGraphService / diasporaTradeIntelligenceService
    // issue against the same raw pgClient. Behavioral mirror, not a SQL parser.
    // ═══════════════════════════════════════════════════════════════════════════

    const isCurrent = (r) => r.is_current === true && r.deleted_at == null;
    const liveEdge = (e) => e.deleted_at == null;

    // ── read a single current node by id (tenant-scoped) ──
    if (sql.startsWith('SELECT * FROM trade_graph_nodes WHERE tenant_id = $1 AND id = $2')) {
      const [tenantId, id] = params;
      const row = store.trade_graph_nodes.find(
        (r) => String(r.tenant_id) === String(tenantId) && String(r.id) === String(id) && isCurrent(r),
      );
      return Promise.resolve({ rows: row ? [clone(row)] : [] });
    }

    // ── read a single current node by (tenant, node_type, entity_id) ──
    if (sql.startsWith('SELECT * FROM trade_graph_nodes WHERE tenant_id = $1 AND node_type = $2 AND entity_id = $3')) {
      const [tenantId, nodeType, entityId] = params;
      const row = currentNode(tenantId, nodeType, entityId);
      return Promise.resolve({ rows: row ? [clone(row)] : [] });
    }

    // ── list current nodes for a tenant, optionally filtered by node_type ──
    if (sql.startsWith('SELECT * FROM trade_graph_nodes WHERE tenant_id = $1 AND node_type = $2 AND is_current')) {
      const [tenantId, nodeType] = params;
      const rows = store.trade_graph_nodes
        .filter((r) => String(r.tenant_id) === String(tenantId) && r.node_type === nodeType && isCurrent(r))
        .sort(byCreatedThenId)
        .map(clone);
      return Promise.resolve({ rows });
    }

    // ── outbound edges + target node (one hop) for a source node ──
    // FIX 1/2: the JOIN re-asserts the neighbor's tenant (n.tenant_id = $1), so a planted cross-tenant
    // edge never surfaces a foreign-tenant neighbor (mirrors `JOIN ... ON n.id = e.target_node_id AND
    // n.tenant_id = $1`).
    if (sql.startsWith('SELECT e.id AS edge_id') && sql.includes('e.source_node_id = $2')) {
      const [tenantId, sourceNodeId] = params;
      const rows = store.trade_graph_edges
        .filter((e) => String(e.tenant_id) === String(tenantId) && String(e.source_node_id) === String(sourceNodeId) && liveEdge(e))
        .map((e) => {
          const target = store.trade_graph_nodes.find(
            (n) => String(n.id) === String(e.target_node_id) && String(n.tenant_id) === String(tenantId) && isCurrent(n),
          );
          if (!target) return null;
          return edgeJoinRow(e, target, 'out');
        })
        .filter(Boolean)
        .sort(byEdgeConfidenceThenId);
      return Promise.resolve({ rows });
    }

    // ── inbound edges + source node (one hop) for a target node ──
    // FIX 1/2: the JOIN re-asserts the neighbor's tenant (n.tenant_id = $1).
    if (sql.startsWith('SELECT e.id AS edge_id') && sql.includes('e.target_node_id = $2')) {
      const [tenantId, targetNodeId] = params;
      const rows = store.trade_graph_edges
        .filter((e) => String(e.tenant_id) === String(tenantId) && String(e.target_node_id) === String(targetNodeId) && liveEdge(e))
        .map((e) => {
          const source = store.trade_graph_nodes.find(
            (n) => String(n.id) === String(e.source_node_id) && String(n.tenant_id) === String(tenantId) && isCurrent(n),
          );
          if (!source) return null;
          return edgeJoinRow(e, source, 'in');
        })
        .filter(Boolean)
        .sort(byEdgeConfidenceThenId);
      return Promise.resolve({ rows });
    }

    // ── materialized summary read (fresh-only) for heavy dashboards ──
    if (sql.startsWith('SELECT in_degree, out_degree, highest_confidence_neighbors')) {
      const [tenantId, nodeId, summaryType, now] = params;
      const rows = (store.trade_graph_materialized_summaries || [])
        .filter((s) => String(s.tenant_id) === String(tenantId)
          && String(s.node_id) === String(nodeId)
          && s.summary_type === summaryType
          && (s.valid_until == null || new Date(s.valid_until).getTime() > new Date(now).getTime()))
        .sort((a, b) => new Date(b.last_computed_at).getTime() - new Date(a.last_computed_at).getTime())
        .slice(0, 1)
        .map((s) => ({
          in_degree: s.in_degree, out_degree: s.out_degree,
          highest_confidence_neighbors: s.highest_confidence_neighbors || [],
          path_metrics: s.path_metrics || {}, aggregated_reputation: s.aggregated_reputation ?? null,
          last_computed_at: s.last_computed_at, valid_until: s.valid_until ?? null,
        }));
      return Promise.resolve({ rows });
    }

    // ── domain_events evidence lookup for an entity (id/order_id/stock_id in payload) ──
    if (sql.startsWith('SELECT id, event_type, payload, created_at FROM domain_events WHERE tenant_id = $1 AND')) {
      const [tenantId, entityId] = params;
      const rows = store.domain_events
        .filter((e) => String(e.tenant_id) === String(tenantId)
          && ['processed', 'pending'].includes(e.status)
          && evidenceMatches(e.payload, entityId))
        .slice()
        .sort(byCreatedThenId)
        .map((e) => ({ id: e.id, event_type: e.event_type, payload: e.payload, created_at: e.created_at }));
      return Promise.resolve({ rows });
    }

    // ── nodes: CREATE_OR_UPDATE_NODE (real, attribute-bearing) upsert ──
    if (sql.startsWith('INSERT INTO trade_graph_nodes') && sql.includes("$5::jsonb")) {
      // FIX H: a fault INSIDE a transaction poisons it (sets aborted) — exactly like a real failed statement.
      if (faults.failNodeInsert) return faultInTxn(new Error('FAULT/NODE_INSERT'));
      // Targeted fault (FIX E rebuild tests): fail ONLY the node insert for a specific entity_id, so a
      // rebuild/poll with a mix of good + bad events can be exercised. entity_id is params[3] here.
      if (faults.failNodeInsertFor != null && String(params[3]) === String(faults.failNodeInsertFor)) {
        return faultInTxn(new Error('FAULT/NODE_INSERT'));
      }
      const [tenantId, nodeType, entityType, entityId, dataJson, projectionVersion, eventId, now] = params;
      const incoming = safeParse(dataJson);
      const existing = currentNode(tenantId, nodeType, entityId);
      if (existing) {
        existing.data = { ...(existing.data || {}), ...incoming }; // data || EXCLUDED.data
        existing.is_valid = true;
        existing.source_event_ref = eventId;
        existing.projection_version = projectionVersion;
        existing.entity_type = existing.entity_type || entityType;
        existing.updated_at = now;
        return Promise.resolve({ rows: [{ id: existing.id }] });
      }
      const row = {
        id: nextUuid('node'),
        tenant_id: tenantId,
        node_type: nodeType,
        entity_type: entityType,
        entity_id: String(entityId),
        is_current: true,
        is_valid: true,
        confidence: 1.0,
        data: incoming,
        projection_version: projectionVersion,
        source_event_ref: eventId,
        created_at: now,
        deleted_at: null,
        updated_at: now,
      };
      store.trade_graph_nodes.push(row);
      return Promise.resolve({ rows: [{ id: row.id }] });
    }

    // ── nodes: placeholder upsert from edge endpoint resolution (empty data) ──
    if (sql.startsWith('INSERT INTO trade_graph_nodes') && sql.includes("'{}'::jsonb")) {
      if (faults.failNodeInsert) return faultInTxn(new Error('FAULT/NODE_INSERT'));
      // Targeted fault (FIX E): placeholder insert's entity_id is params[2].
      if (faults.failNodeInsertFor != null && String(params[2]) === String(faults.failNodeInsertFor)) {
        return faultInTxn(new Error('FAULT/NODE_INSERT'));
      }
      const [tenantId, nodeType, entityId, projectionVersion, eventId, now] = params;
      const existing = currentNode(tenantId, nodeType, entityId);
      if (existing) return Promise.resolve({ rows: [] }); // ON CONFLICT DO NOTHING
      const row = {
        id: nextUuid('node'),
        tenant_id: tenantId,
        node_type: nodeType,
        entity_type: nodeType,
        entity_id: String(entityId),
        is_current: true,
        is_valid: true,
        confidence: 1.0,
        data: {},
        projection_version: projectionVersion,
        source_event_ref: eventId,
        created_at: now,
        deleted_at: null,
        updated_at: now,
      };
      store.trade_graph_nodes.push(row);
      return Promise.resolve({ rows: [{ id: row.id }] });
    }

    // ── edges: CREATE_EDGE insert (dedup on tenant/src/tgt/type/event_ref) ──
    if (sql.startsWith('INSERT INTO trade_graph_edges')) {
      if (faults.failEdgeInsert) return faultInTxn(new Error('FAULT/EDGE_INSERT'));
      const [tenantId, sourceNodeId, targetNodeId, edgeType, eventId, confidence, policyVersion, now, metadata] = params;
      const dup = store.trade_graph_edges.find(
        (e) => String(e.tenant_id) === String(tenantId)
          && String(e.source_node_id) === String(sourceNodeId)
          && String(e.target_node_id) === String(targetNodeId)
          && e.edge_type === edgeType
          && String(e.source_event_ref) === String(eventId)
          && e.deleted_at == null,
      );
      if (dup) return Promise.resolve({ rows: [] }); // ON CONFLICT DO NOTHING
      const row = {
        id: nextUuid('edge'),
        tenant_id: tenantId,
        source_node_id: sourceNodeId,
        target_node_id: targetNodeId,
        edge_type: edgeType,
        source_event_ref: eventId,
        is_valid: true,
        confidence: Number(confidence),
        policy_version: policyVersion,
        valid_from: now,
        valid_until: null,
        created_at: now,
        deleted_at: null,
        updated_at: now,
        metadata: safeParse(metadata),
      };
      store.trade_graph_edges.push(row);
      return Promise.resolve({ rows: [{ id: row.id }] });
    }

    // ── edges: SOFT_DELETE_EDGE (revoke) — mark deleted_at/is_valid=false on the matching live edge ──
    // Idempotent: only edges with deleted_at IS NULL match, so re-revoking updates zero rows.
    //
    // GATE-T10 FIX 1: this handler binds each SET column to the ACTUAL `$N` placeholder PARSED from the SQL
    // (1-indexed into params), exactly like real Postgres — it does NOT read params by hardcoded position.
    // The earlier mock matched the buggy `SET deleted_at = $6` string and then read params POSITIONALLY
    // (now=params[4]), which silently produced the CORRECT stored values and MASKED the binding bug. By
    // honoring `$N` literally, the corrected SQL (deleted_at/valid_until/updated_at ← $5, revoked_event_ref ←
    // $6, params length 6) stores the timestamp + event id correctly, while the OLD buggy SQL ($6/$7 over a
    // 6-param array) would bind deleted_at/valid_until ← params[5] (the eventId UUID) and revoked_event_ref ←
    // params[6] (undefined) — making the regression test's `deleted_at === FIXED_TS` assertion FAIL, just as
    // the real Postgres statement would (an invalid timestamptz + a missing $7).
    if (sql.startsWith('UPDATE trade_graph_edges SET deleted_at =')) {
      // WHERE clause is fixed at $1..$4 (tenant, src, tgt, type); SET columns reference parsed $N.
      const [tenantId, sourceNodeId, targetNodeId, edgeType] = params;
      const bind = (token) => {
        const m = /^\$(\d+)$/.exec(token);
        return m ? params[Number(m[1]) - 1] : undefined; // 1-indexed → 0-indexed, like Postgres
      };
      const setClause = sql.slice(0, sql.toUpperCase().indexOf(' WHERE '));
      const tokenFor = (col) => {
        const m = new RegExp(`${col}\\s*=\\s*(\\$\\d+)`, 'i').exec(setClause);
        return m ? m[1] : null;
      };
      const deletedAt = bind(tokenFor('deleted_at'));
      const validUntil = bind(tokenFor('valid_until'));
      const updatedAt = bind(tokenFor('updated_at'));
      const revokedEventRef = bind(tokenFor('revoked_event_ref'));
      const matched = store.trade_graph_edges.filter(
        (e) => String(e.tenant_id) === String(tenantId)
          && String(e.source_node_id) === String(sourceNodeId)
          && String(e.target_node_id) === String(targetNodeId)
          && e.edge_type === edgeType
          && e.deleted_at == null,
      );
      for (const e of matched) {
        e.deleted_at = deletedAt;
        e.is_valid = false;
        e.valid_until = validUntil;
        e.updated_at = updatedAt;
        e.revoked_event_ref = revokedEventRef;
      }
      return Promise.resolve({ rows: matched.map((e) => ({ id: e.id })) });
    }

    // ── processed_events: mark processed (dedup on event_id) ──
    if (sql.startsWith('INSERT INTO trade_graph_processed_events')) {
      if (faults.failProcessedInsert) return faultInTxn(new Error('FAULT/PROCESSED_INSERT'));
      const [eventId, eventType, tenantId, projectionVersion, now] = params;
      if (!store.trade_graph_processed_events.some((r) => String(r.event_id) === String(eventId))) {
        store.trade_graph_processed_events.push({
          id: nextUuid('proc'), event_id: eventId, event_type: eventType, tenant_id: tenantId,
          projection_version: projectionVersion, projected_at: now,
        });
      }
      return Promise.resolve({ rows: [] });
    }

    // ── checkpoint RPC: trade_graph_record_checkpoint(...) ──
    if (sql.includes('trade_graph_record_checkpoint(')) {
      const [tenantId, lastEventId, lastEventCreatedAt, projectionVersion] = params;
      let cp = store.trade_graph_projection_checkpoints.find((c) => String(c.tenant_id) === String(tenantId));
      if (!cp) {
        cp = {
          id: nextUuid('ckpt'), tenant_id: tenantId, last_event_id: lastEventId,
          last_event_created_at: lastEventCreatedAt, projection_version: projectionVersion,
          dead_letter_count: 0, replay_count: 0, next_replay_required: false, notes: null,
        };
        store.trade_graph_projection_checkpoints.push(cp);
      } else {
        cp.last_event_id = lastEventId;
        cp.last_event_created_at = lastEventCreatedAt;
        cp.projection_version = projectionVersion;
      }
      return Promise.resolve({ rows: [{ ...cp }] });
    }

    // ── rebuild RPC: trade_graph_request_rebuild(...) → RUNNING or RATE_LIMITED ──
    if (sql.includes('trade_graph_request_rebuild(')) {
      const [tenantId, initiatedBy, reason, minIntervalSeconds] = params;
      const lastCompleted = store.trade_graph_rebuilds
        .filter((r) => String(r.tenant_id) === String(tenantId) && r.status === 'COMPLETED' && r.completed_at)
        .map((r) => new Date(r.completed_at).getTime())
        .sort((a, b) => b - a)[0];
      const nowMs = Date.now();
      const rateLimited = lastCompleted != null && lastCompleted > nowMs - Number(minIntervalSeconds) * 1000;
      const row = {
        id: nextUuid('rbld'), tenant_id: tenantId, initiated_by: initiatedBy, reason,
        status: rateLimited ? 'RATE_LIMITED' : 'RUNNING',
        started_at: new Date(nowMs).toISOString(),
        completed_at: rateLimited ? new Date(nowMs).toISOString() : null,
        nodes_rebuilt: null, edges_rebuilt: null, events_processed: null, events_failed: null,
      };
      store.trade_graph_rebuilds.push(row);
      if (!rateLimited) {
        const cp = store.trade_graph_projection_checkpoints.find((c) => String(c.tenant_id) === String(tenantId));
        if (cp) { cp.next_replay_required = true; cp.replay_count = (cp.replay_count || 0) + 1; }
      }
      return Promise.resolve({ rows: [{ ...row }] });
    }

    // ── dead letters: insert/refresh (dedup on event_id) ──
    if (sql.startsWith('INSERT INTO trade_graph_dead_letters')) {
      const [eventId, eventType, tenantId, payloadJson, errorMessage, errorStack, now] = params;
      const existing = store.trade_graph_dead_letters.find((r) => String(r.event_id) === String(eventId));
      if (existing) {
        existing.error_message = errorMessage;
        existing.error_stack = errorStack;
        existing.retry_count = (existing.retry_count || 0) + 1;
        existing.last_retry_at = now;
        existing.updated_at = now;
      } else {
        store.trade_graph_dead_letters.push({
          id: nextUuid('dead'), event_id: eventId, event_type: eventType, tenant_id: tenantId,
          payload: safeParse(payloadJson), error_message: errorMessage, error_stack: errorStack,
          retry_count: 0, created_at: now, last_retry_at: now, updated_at: now,
        });
      }
      return Promise.resolve({ rows: [] });
    }

    // ── checkpoint: UPSERT bumping dead_letter_count (FIX 8 — durable even on first-event failure) ──
    // Mirrors `INSERT ... (tenant_id, dead_letter_count, projection_version, updated_at) VALUES ($1,1,$3,$2)
    // ON CONFLICT (tenant_id) DO UPDATE SET dead_letter_count = dead_letter_count + 1`.
    if (sql.startsWith('INSERT INTO trade_graph_projection_checkpoints (tenant_id, dead_letter_count')) {
      const [tenantId, now, projectionVersion] = params;
      let cp = store.trade_graph_projection_checkpoints.find((c) => String(c.tenant_id) === String(tenantId));
      if (!cp) {
        cp = {
          id: nextUuid('ckpt'), tenant_id: tenantId, last_event_id: null, last_event_created_at: null,
          projection_version: projectionVersion, dead_letter_count: 1, replay_count: 0,
          next_replay_required: false, notes: null, updated_at: now,
        };
        store.trade_graph_projection_checkpoints.push(cp);
      } else {
        cp.dead_letter_count = (cp.dead_letter_count || 0) + 1;
        cp.updated_at = now;
      }
      return Promise.resolve({ rows: [] });
    }

    // ── checkpoint: clear next_replay_required after a rebuild ──
    if (sql.startsWith('UPDATE trade_graph_projection_checkpoints SET next_replay_required')) {
      const [tenantId, now] = params;
      const cp = store.trade_graph_projection_checkpoints.find((c) => String(c.tenant_id) === String(tenantId));
      if (cp) { cp.next_replay_required = false; cp.updated_at = now; }
      return Promise.resolve({ rows: [] });
    }

    // ── rebuild rows: mark COMPLETED / FAILED ──
    if (sql.startsWith('UPDATE trade_graph_rebuilds SET status = $1, completed_at = $2, nodes_rebuilt')) {
      const [status, completedAt, nodesRebuilt, edgesRebuilt, eventsProcessed, eventsFailed, rebuildId] = params;
      const row = store.trade_graph_rebuilds.find((r) => String(r.id) === String(rebuildId));
      if (row) {
        Object.assign(row, {
          status, completed_at: completedAt, nodes_rebuilt: nodesRebuilt, edges_rebuilt: edgesRebuilt,
          events_processed: eventsProcessed, events_failed: eventsFailed,
        });
      }
      return Promise.resolve({ rows: [] });
    }
    if (sql.startsWith('UPDATE trade_graph_rebuilds SET status = $1, completed_at = $2 WHERE id')) {
      const [status, completedAt, rebuildId] = params;
      const row = store.trade_graph_rebuilds.find((r) => String(r.id) === String(rebuildId));
      if (row) Object.assign(row, { status, completed_at: completedAt });
      return Promise.resolve({ rows: [] });
    }

    // ── rebuild clears ──
    if (sql.startsWith('DELETE FROM trade_graph_edges WHERE tenant_id =')) {
      const [tenantId] = params;
      store.trade_graph_edges = store.trade_graph_edges.filter((r) => String(r.tenant_id) !== String(tenantId));
      return Promise.resolve({ rows: [] });
    }
    if (sql.startsWith('DELETE FROM trade_graph_nodes WHERE tenant_id =')) {
      const [tenantId] = params;
      store.trade_graph_nodes = store.trade_graph_nodes.filter((r) => String(r.tenant_id) !== String(tenantId));
      return Promise.resolve({ rows: [] });
    }
    if (sql.startsWith('DELETE FROM trade_graph_processed_events WHERE tenant_id =')) {
      const [tenantId] = params;
      store.trade_graph_processed_events = store.trade_graph_processed_events
        .filter((r) => String(r.tenant_id) !== String(tenantId));
      return Promise.resolve({ rows: [] });
    }

    // ── rebuild replay: read authoritative outbox in order ──
    if (sql.startsWith('SELECT id, event_type, payload, tenant_id, created_at FROM domain_events')) {
      const [tenantId] = params;
      const rows = store.domain_events
        .filter((e) => String(e.tenant_id) === String(tenantId) && ['processed', 'pending'].includes(e.status))
        .slice()
        .sort((a, b) => {
          const ta = new Date(a.created_at).getTime();
          const tb = new Date(b.created_at).getTime();
          if (ta !== tb) return ta - tb;
          return String(a.id) < String(b.id) ? -1 : 1;
        })
        .map((e) => ({ id: e.id, event_type: e.event_type, payload: e.payload, tenant_id: e.tenant_id, created_at: e.created_at }));
      return Promise.resolve({ rows });
    }

    throw new Error(`graphPgMock: unhandled SQL: ${sql}`);
  }

  return { client: { query }, store, faults };
}

/**
 * Wrap a graph mock's client as a pg-Pool-shaped object ({ connect(): Promise<{ query, release }> }) so
 * it can be injected as the SEPARATE dead-letter pool (FIX 4). Every connect() hands back the SAME client
 * (a single in-memory store), with a no-op release(). Used to prove a dead-letter persists on its own
 * connection independently of the (poisoned) batch transaction.
 */
export function makeGraphPool(mock) {
  const client = { query: mock.client.query, release() { /* pooled mock: nothing to release */ } };
  return { connect: async () => client };
}

function safeParse(value) {
  if (value == null) return {};
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

// ── Stage 3 read-side helpers (deterministic ordering + shaping) ──────────────
function clone(row) {
  return JSON.parse(JSON.stringify(row));
}

function byCreatedThenId(a, b) {
  const ta = new Date(a.created_at).getTime();
  const tb = new Date(b.created_at).getTime();
  if (ta !== tb) return ta - tb;
  return String(a.id) < String(b.id) ? -1 : 1;
}

// Edges/neighbors are ordered by confidence DESC, then by a stable id tiebreaker, so identical
// inputs always yield identical result order (determinism non-negotiable).
function byEdgeConfidenceThenId(a, b) {
  const ca = Number(a.edge_confidence);
  const cb = Number(b.edge_confidence);
  if (ca !== cb) return cb - ca;
  return String(a.edge_id) < String(b.edge_id) ? -1 : 1;
}

// Shape one edge+neighbor join row the way the Stage 3 SELECTs project it.
function edgeJoinRow(edge, neighbor, direction) {
  return {
    edge_id: edge.id,
    edge_type: edge.edge_type,
    edge_confidence: Number(edge.confidence),
    edge_metadata: edge.metadata || {},
    source_event_ref: edge.source_event_ref || null,
    valid_from: edge.valid_from || null,
    valid_until: edge.valid_until || null,
    direction,
    neighbor_id: neighbor.id,
    neighbor_type: neighbor.node_type,
    neighbor_entity_id: neighbor.entity_id,
    neighbor_data: neighbor.data || {},
    neighbor_confidence: Number(neighbor.confidence),
    neighbor_created_at: neighbor.created_at,
  };
}

function evidenceMatches(payload, entityId) {
  if (!payload || typeof payload !== 'object') return false;
  const target = String(entityId);
  for (const key of ['entity_id', 'order_id', 'stock_id', 'stock_item_id', 'document_id', 'quote_id']) {
    if (payload[key] != null && String(payload[key]) === target) return true;
  }
  return false;
}
