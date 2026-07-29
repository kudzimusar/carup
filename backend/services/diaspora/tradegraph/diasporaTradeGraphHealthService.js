/**
 * Trade Graph health / summary reads for UI-10 (Issue #127).
 *
 * The Phase 10 query and intelligence services answer questions ABOUT a tenant's graph. UI-10 also
 * needs to answer a question about the graph ITSELF: is what I am looking at current, and if not, how
 * stale is it? A dashboard that renders a confidently-empty graph because the projection stalled six
 * hours ago is worse than one that renders nothing, so staleness is a first-class part of every
 * response rather than something the UI has to infer.
 *
 * Every query here is tenant-scoped in SQL. The tenant id is supplied by the router from the
 * server-derived user context and is never read from the client — the UI filter is a convenience, not
 * the security boundary.
 *
 * Written against a raw `pg` client (`pgClient.query(text, params)`), the same seam the rest of the
 * Phase 10 services use, so the SQL under test is the SQL that runs in production.
 */

/** A projection lagging by more than this is presented as degraded rather than healthy. */
export const PROJECTION_LAG_WARN_SECONDS = 300;   // 5 minutes
export const PROJECTION_LAG_CRITICAL_SECONDS = 1800; // 30 minutes

export const GRAPH_HEALTH = Object.freeze({
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  STALLED: 'STALLED',
  UNKNOWN: 'UNKNOWN',
  EMPTY: 'EMPTY',
});

function requireTenant(tenantId) {
  if (!tenantId) throw new Error('Trade Graph health reads require a server-derived tenantId');
  return tenantId;
}

/**
 * Node and edge counts by type for one tenant.
 *
 * Counts only — never entity ids, never node `data`. A count cannot leak a participant id, an email
 * or a document reference, so this endpoint needs no redaction pass and cannot regress into one.
 */
export async function nodeAndEdgeCounts(pgClient, tenantId) {
  requireTenant(tenantId);
  const nodes = await pgClient.query(
    `SELECT node_type, count(*)::int AS count
       FROM trade_graph_nodes
      WHERE tenant_id = $1 AND deleted_at IS NULL AND is_current AND is_valid
      GROUP BY node_type
      ORDER BY count DESC, node_type ASC`,
    [tenantId],
  );
  const edges = await pgClient.query(
    `SELECT edge_type, count(*)::int AS count
       FROM trade_graph_edges
      WHERE tenant_id = $1 AND deleted_at IS NULL AND is_valid
        AND (valid_until IS NULL OR valid_until > now())
      GROUP BY edge_type
      ORDER BY count DESC, edge_type ASC`,
    [tenantId],
  );
  const nodeRows = nodes.rows || [];
  const edgeRows = edges.rows || [];
  return {
    nodes: nodeRows.map((r) => ({ type: r.node_type, count: Number(r.count) })),
    edges: edgeRows.map((r) => ({ type: r.edge_type, count: Number(r.count) })),
    totalNodes: nodeRows.reduce((sum, r) => sum + Number(r.count), 0),
    totalEdges: edgeRows.reduce((sum, r) => sum + Number(r.count), 0),
  };
}

/**
 * Projection status: last processed event, lag, dead-letter count, replay state.
 *
 * `lagSeconds` is measured from the last event the projection actually PROCESSED, not from the last
 * time the checkpoint row was touched — a worker that keeps heartbeating while failing to project
 * would otherwise look perfectly healthy.
 */
export async function projectionStatus(pgClient, tenantId) {
  requireTenant(tenantId);
  const { rows } = await pgClient.query(
    `SELECT last_event_id,
            last_event_created_at,
            projection_version,
            dead_letter_count,
            replay_count,
            next_replay_required,
            updated_at,
            EXTRACT(EPOCH FROM (now() - last_event_created_at))::bigint AS lag_seconds
       FROM trade_graph_projection_checkpoints
      WHERE tenant_id = $1
      LIMIT 1`,
    [tenantId],
  );
  const row = rows?.[0] || null;
  if (!row) {
    // No checkpoint at all: the projection has never run for this tenant. That is a real, displayable
    // state — not an error, and emphatically not "healthy".
    return {
      hasCheckpoint: false,
      health: GRAPH_HEALTH.UNKNOWN,
      lastEventId: null,
      lastEventAt: null,
      lagSeconds: null,
      deadLetterCount: 0,
      replayCount: 0,
      replayRequired: false,
      projectionVersion: null,
      updatedAt: null,
    };
  }
  const lagSeconds = row.lag_seconds == null ? null : Number(row.lag_seconds);
  const deadLetterCount = Number(row.dead_letter_count || 0);
  return {
    hasCheckpoint: true,
    health: classifyHealth({ lagSeconds, deadLetterCount, replayRequired: Boolean(row.next_replay_required) }),
    lastEventId: row.last_event_id,
    lastEventAt: row.last_event_created_at,
    lagSeconds,
    deadLetterCount,
    replayCount: Number(row.replay_count || 0),
    replayRequired: Boolean(row.next_replay_required),
    projectionVersion: row.projection_version,
    updatedAt: row.updated_at,
  };
}

/** Pure classifier — exported so the UI's badge logic and the API agree by construction. */
export function classifyHealth({ lagSeconds, deadLetterCount = 0, replayRequired = false, totalNodes = null } = {}) {
  if (replayRequired) return GRAPH_HEALTH.STALLED;
  if (deadLetterCount > 0) return GRAPH_HEALTH.DEGRADED;
  if (lagSeconds == null) return GRAPH_HEALTH.UNKNOWN;
  if (lagSeconds >= PROJECTION_LAG_CRITICAL_SECONDS) return GRAPH_HEALTH.STALLED;
  if (lagSeconds >= PROJECTION_LAG_WARN_SECONDS) return GRAPH_HEALTH.DEGRADED;
  if (totalNodes === 0) return GRAPH_HEALTH.EMPTY;
  return GRAPH_HEALTH.HEALTHY;
}

/**
 * The tenant dashboard summary: counts + projection status + the most recent rebuild.
 *
 * When the projection is stale the counts are still returned — but flagged — because hiding them
 * would leave an operator with no way to see what the graph currently believes.
 */
export async function tenantSummary(pgClient, tenantId) {
  requireTenant(tenantId);
  const [counts, status, rebuild] = await Promise.all([
    nodeAndEdgeCounts(pgClient, tenantId),
    projectionStatus(pgClient, tenantId),
    lastRebuild(pgClient, tenantId),
  ]);
  const health = status.hasCheckpoint
    ? classifyHealth({ ...status, replayRequired: status.replayRequired, totalNodes: counts.totalNodes })
    : (counts.totalNodes === 0 ? GRAPH_HEALTH.EMPTY : GRAPH_HEALTH.UNKNOWN);
  return {
    counts,
    projection: { ...status, health },
    lastRebuild: rebuild,
    health,
    // Explicit rather than inferred: the UI must be able to say "these numbers may be out of date"
    // without duplicating the threshold logic.
    stale: health === GRAPH_HEALTH.DEGRADED || health === GRAPH_HEALTH.STALLED,
  };
}

/**
 * The most recent rebuild for a tenant.
 *
 * `trade_graph_rebuilds` HAS NO `requested_at` COLUMN, and never has had one. Ledger #15
 * (20260621140000) creates it with `started_at`, `completed_at`, `created_at` and `updated_at`, and
 * no later migration adds `requested_at`. This function selected and ordered by that name anyway, so
 * every tenant-scoped call raised `column "requested_at" does not exist` and the whole
 * /diaspora/trade-graph/summary endpoint answered 500.
 *
 * WHY IT SURVIVED CI
 * ------------------
 * The endpoint is unreachable in every environment the suite runs against. The capability gate
 * `DIASPORA_TRADE_GRAPH` 404s the entire router when off, and tenant scoping 403s a caller with no
 * tenant. BOTH return before this query executes, so surfacing the defect required a real tenant on a
 * flag-enabled deployment — which nothing had until the staging UAT tenancy fixture existed. A
 * recording fake cannot catch it either: a fake answers whatever it is told to, and the only thing
 * that disagrees with this SQL is a real Postgres schema.
 *
 * `started_at AS requested_at` is deliberate. The public TypeScript contract exposes `requested_at`,
 * so aliasing repairs the query without pushing the break outward into the API surface.
 *
 * Ordering is `created_at DESC, id DESC`: `created_at` is the insert instant and is NOT NULL, and the
 * `id` tiebreak keeps the result deterministic when two rebuilds share a timestamp.
 */
export async function lastRebuild(pgClient, tenantId) {
  requireTenant(tenantId);
  const { rows } = await pgClient.query(
    `SELECT id,
            status,
            started_at AS requested_at,
            completed_at,
            events_processed,
            events_failed,
            nodes_rebuilt,
            edges_rebuilt,
            reason
       FROM trade_graph_rebuilds
      WHERE tenant_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [tenantId],
  );
  return rows?.[0] || null;
}

/**
 * Dead letters for authorized operators.
 *
 * The stored `payload` is a raw domain-event body and can contain anything the emitting service put
 * there, including participant identifiers. It is therefore NEVER returned. Operators get the event
 * id, type, timing, retry count and a sanitized error — enough to triage and replay, and nothing that
 * turns an operator console into a PII export.
 */
export async function listDeadLetters(pgClient, tenantId, { limit = 50 } = {}) {
  requireTenant(tenantId);
  const capped = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const { rows } = await pgClient.query(
    `SELECT id, event_id, event_type, retry_count, created_at, last_retry_at,
            left(coalesce(error_message, ''), 300) AS error_message
       FROM trade_graph_dead_letters
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [tenantId, capped],
  );
  return (rows || []).map((r) => ({
    id: r.id,
    eventId: r.event_id,
    eventType: r.event_type,
    retryCount: Number(r.retry_count || 0),
    createdAt: r.created_at,
    lastRetryAt: r.last_retry_at,
    errorMessage: r.error_message || null,
    // Stated explicitly in the payload so the UI can show the user WHY there is no detail to expand,
    // rather than rendering an empty panel that looks like a bug.
    payloadWithheld: true,
    payloadWithheldReason: 'Raw event payloads may contain participant data and are never returned to the console.',
  }));
}

export const diasporaTradeGraphHealth = {
  nodeAndEdgeCounts,
  projectionStatus,
  tenantSummary,
  lastRebuild,
  listDeadLetters,
  classifyHealth,
};
