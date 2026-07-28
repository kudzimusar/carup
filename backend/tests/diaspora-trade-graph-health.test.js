/**
 * UI-10 — Trade Graph health/summary service tests (Issue #127).
 *
 * The dashboard's central promise is that it never presents stale figures as current. That promise
 * lives in this service, so these tests concentrate on the boundaries where it could break:
 *   - lag measured from the last event PROCESSED, not the last heartbeat;
 *   - "the projection has never run" distinguished from "it ran and there is nothing";
 *   - dead letters and pending replays downgrading health even when lag looks fine;
 *   - every query tenant-scoped in SQL, with the tenant taken from the caller, never a client field;
 *   - dead-letter reads that cannot return a raw event payload.
 *
 * The pg client is a recording fake: it captures the exact SQL and parameters, so tenant scoping is
 * asserted against the statement that would actually run rather than against a mock's convenience.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

const {
  nodeAndEdgeCounts, projectionStatus, tenantSummary, listDeadLetters, classifyHealth,
  GRAPH_HEALTH, PROJECTION_LAG_WARN_SECONDS, PROJECTION_LAG_CRITICAL_SECONDS,
} = await import('../services/diaspora/tradegraph/diasporaTradeGraphHealthService.js');

/** Recording fake: `responses` is matched in order by a substring of the SQL. */
function createPgFake(responses = []) {
  const calls = [];
  return {
    calls,
    async query(text, params) {
      calls.push({ text, params });
      for (const r of responses) {
        if (text.includes(r.match)) return { rows: r.rows };
      }
      return { rows: [] };
    },
  };
}

const TENANT = '11111111-1111-1111-1111-111111111111';

// ── Tenant scoping ───────────────────────────────────────────────────────────

test('every health query is tenant-scoped in SQL with the tenant as a bound parameter', async () => {
  const pg = createPgFake([
    { match: 'FROM trade_graph_nodes', rows: [{ node_type: 'BUYER_ORDER', count: 2 }] },
    { match: 'FROM trade_graph_edges', rows: [{ edge_type: 'INITIATED_ORDER', count: 2 }] },
  ]);
  await nodeAndEdgeCounts(pg, TENANT);
  assert.equal(pg.calls.length, 2);
  for (const call of pg.calls) {
    assert.match(call.text, /tenant_id = \$1/, 'the tenant filter must be in the SQL itself');
    assert.equal(call.params[0], TENANT, 'the tenant must be a bound parameter, never interpolated');
  }
});

test('a missing tenant is refused rather than defaulting to "all tenants"', async () => {
  const pg = createPgFake();
  await assert.rejects(() => nodeAndEdgeCounts(pg, null), /require a server-derived tenantId/);
  await assert.rejects(() => projectionStatus(pg, ''), /require a server-derived tenantId/);
  await assert.rejects(() => listDeadLetters(pg, undefined), /require a server-derived tenantId/);
  assert.equal(pg.calls.length, 0, 'nothing may be queried without a tenant');
});

// ── Counts ───────────────────────────────────────────────────────────────────

test('counts are aggregated by type with correct totals', async () => {
  const pg = createPgFake([
    { match: 'FROM trade_graph_nodes', rows: [{ node_type: 'BUYER_ORDER', count: 12 }, { node_type: 'SHIPMENT', count: 3 }] },
    { match: 'FROM trade_graph_edges', rows: [{ edge_type: 'INITIATED_ORDER', count: 12 }] },
  ]);
  const result = await nodeAndEdgeCounts(pg, TENANT);
  assert.equal(result.totalNodes, 15);
  assert.equal(result.totalEdges, 12);
  assert.deepEqual(result.nodes[0], { type: 'BUYER_ORDER', count: 12 });
});

test('counts exclude soft-deleted, superseded and invalid rows', async () => {
  const pg = createPgFake();
  await nodeAndEdgeCounts(pg, TENANT);
  const nodeSql = pg.calls[0].text;
  assert.match(nodeSql, /deleted_at IS NULL/);
  assert.match(nodeSql, /is_current/);
  assert.match(nodeSql, /is_valid/);
  const edgeSql = pg.calls[1].text;
  assert.match(edgeSql, /deleted_at IS NULL/);
  assert.match(edgeSql, /valid_until IS NULL OR valid_until > now\(\)/,
    'a revoked edge must not be counted as a live relationship');
});

// ── Projection status ────────────────────────────────────────────────────────

test('a tenant with no checkpoint reports UNKNOWN, not HEALTHY', async () => {
  const pg = createPgFake([{ match: 'trade_graph_projection_checkpoints', rows: [] }]);
  const status = await projectionStatus(pg, TENANT);
  assert.equal(status.hasCheckpoint, false);
  assert.equal(status.health, GRAPH_HEALTH.UNKNOWN);
  assert.equal(status.lagSeconds, null);
});

test('lag is measured from the last event PROCESSED, not from the checkpoint heartbeat', async () => {
  const pg = createPgFake();
  await projectionStatus(pg, TENANT);
  const sql = pg.calls[0].text;
  assert.match(sql, /now\(\) - last_event_created_at/,
    'a worker that heartbeats while failing to project must not look healthy');
  assert.doesNotMatch(sql.replace(/updated_at,/, ''), /now\(\) - updated_at/);
});

test('a healthy projection reports HEALTHY', async () => {
  const pg = createPgFake([{
    match: 'trade_graph_projection_checkpoints',
    rows: [{ last_event_id: 'e1', last_event_created_at: '2026-07-27T10:00:00Z', dead_letter_count: 0, replay_count: 0, next_replay_required: false, lag_seconds: 5, projection_version: 'v1', updated_at: '2026-07-27T10:00:01Z' }],
  }]);
  const status = await projectionStatus(pg, TENANT);
  assert.equal(status.health, GRAPH_HEALTH.HEALTHY);
});

// ── Health classification ────────────────────────────────────────────────────

test('classifyHealth: lag thresholds', () => {
  assert.equal(classifyHealth({ lagSeconds: 10 }), GRAPH_HEALTH.HEALTHY);
  assert.equal(classifyHealth({ lagSeconds: PROJECTION_LAG_WARN_SECONDS }), GRAPH_HEALTH.DEGRADED);
  assert.equal(classifyHealth({ lagSeconds: PROJECTION_LAG_CRITICAL_SECONDS }), GRAPH_HEALTH.STALLED);
  assert.equal(classifyHealth({ lagSeconds: PROJECTION_LAG_CRITICAL_SECONDS - 1 }), GRAPH_HEALTH.DEGRADED);
});

test('classifyHealth: a dead letter degrades health even when lag looks fine', () => {
  // Otherwise a projection that is silently dropping events reads as perfectly healthy.
  assert.equal(classifyHealth({ lagSeconds: 1, deadLetterCount: 1 }), GRAPH_HEALTH.DEGRADED);
});

test('classifyHealth: a required replay is STALLED regardless of lag', () => {
  assert.equal(classifyHealth({ lagSeconds: 0, replayRequired: true }), GRAPH_HEALTH.STALLED);
});

test('classifyHealth: unknown lag is UNKNOWN, never HEALTHY', () => {
  assert.equal(classifyHealth({ lagSeconds: null }), GRAPH_HEALTH.UNKNOWN);
  assert.equal(classifyHealth({}), GRAPH_HEALTH.UNKNOWN);
});

test('classifyHealth: an up-to-date but empty graph is EMPTY, not HEALTHY', () => {
  assert.equal(classifyHealth({ lagSeconds: 1, totalNodes: 0 }), GRAPH_HEALTH.EMPTY);
});

// ── Summary ──────────────────────────────────────────────────────────────────

test('the summary marks itself stale so the UI never re-derives the thresholds', async () => {
  const pg = createPgFake([
    { match: 'FROM trade_graph_nodes', rows: [{ node_type: 'BUYER_ORDER', count: 1 }] },
    { match: 'FROM trade_graph_edges', rows: [] },
    { match: 'trade_graph_projection_checkpoints', rows: [{ last_event_id: 'e', last_event_created_at: '2026-07-27T00:00:00Z', dead_letter_count: 0, replay_count: 0, next_replay_required: false, lag_seconds: 7200, projection_version: 'v1', updated_at: '2026-07-27T00:00:00Z' }] },
    { match: 'trade_graph_rebuilds', rows: [] },
  ]);
  const summary = await tenantSummary(pg, TENANT);
  assert.equal(summary.health, GRAPH_HEALTH.STALLED);
  assert.equal(summary.stale, true);
});

test('a stale summary still returns the counts so an operator can see what the graph believes', async () => {
  const pg = createPgFake([
    { match: 'FROM trade_graph_nodes', rows: [{ node_type: 'BUYER_ORDER', count: 9 }] },
    { match: 'FROM trade_graph_edges', rows: [] },
    { match: 'trade_graph_projection_checkpoints', rows: [{ last_event_id: 'e', last_event_created_at: '2026-07-27T00:00:00Z', dead_letter_count: 4, replay_count: 0, next_replay_required: false, lag_seconds: 60, projection_version: 'v1', updated_at: '2026-07-27T00:00:00Z' }] },
    { match: 'trade_graph_rebuilds', rows: [] },
  ]);
  const summary = await tenantSummary(pg, TENANT);
  assert.equal(summary.stale, true);
  assert.equal(summary.counts.totalNodes, 9, 'hiding the numbers would leave an operator blind');
});

test('a healthy, populated summary is not marked stale', async () => {
  const pg = createPgFake([
    { match: 'FROM trade_graph_nodes', rows: [{ node_type: 'BUYER_ORDER', count: 1 }] },
    { match: 'FROM trade_graph_edges', rows: [{ edge_type: 'INITIATED_ORDER', count: 1 }] },
    { match: 'trade_graph_projection_checkpoints', rows: [{ last_event_id: 'e', last_event_created_at: '2026-07-27T10:00:00Z', dead_letter_count: 0, replay_count: 0, next_replay_required: false, lag_seconds: 3, projection_version: 'v1', updated_at: '2026-07-27T10:00:00Z' }] },
    { match: 'trade_graph_rebuilds', rows: [] },
  ]);
  const summary = await tenantSummary(pg, TENANT);
  assert.equal(summary.health, GRAPH_HEALTH.HEALTHY);
  assert.equal(summary.stale, false);
});

// ── Dead letters ─────────────────────────────────────────────────────────────

test('dead-letter reads never SELECT the raw event payload', async () => {
  const pg = createPgFake();
  await listDeadLetters(pg, TENANT);
  const sql = pg.calls[0].text;
  assert.doesNotMatch(sql, /\bpayload\b/,
    'the payload is a raw domain-event body and may contain participant data');
  assert.match(sql, /error_stack/.source ? /left\(coalesce\(error_message/ : /error_message/,
    'the error is truncated rather than returned whole');
  assert.doesNotMatch(sql, /error_stack/, 'stack traces are not operator-console content');
});

test('a dead-letter row states that the payload was withheld and why', async () => {
  const pg = createPgFake([{
    match: 'trade_graph_dead_letters',
    rows: [{ id: 'dl1', event_id: 'e9', event_type: 'ORDER_CREATED', retry_count: 2, created_at: 'x', last_retry_at: null, error_message: 'boom' }],
  }]);
  const rows = await listDeadLetters(pg, TENANT);
  assert.equal(rows[0].payloadWithheld, true);
  assert.match(rows[0].payloadWithheldReason, /never returned/);
  assert.equal(rows[0].payload, undefined);
});

test('the dead-letter limit is clamped so a caller cannot request an unbounded export', async () => {
  const pg = createPgFake();
  await listDeadLetters(pg, TENANT, { limit: 100000 });
  assert.equal(pg.calls[0].params[1], 200);
  await listDeadLetters(pg, TENANT, { limit: -5 });
  assert.equal(pg.calls[1].params[1], 1);
  await listDeadLetters(pg, TENANT, { limit: 'not-a-number' });
  assert.equal(pg.calls[2].params[1], 50, 'a non-numeric limit falls back to the default');
});
