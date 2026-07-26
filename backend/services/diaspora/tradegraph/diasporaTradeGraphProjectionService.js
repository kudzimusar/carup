/**
 * Phase 10 — Trade Graph PROJECTION SERVICE (Stage 2).
 *
 * Generic, table-driven interpreter that DERIVES the graph (trade_graph_nodes / trade_graph_edges)
 * from the authoritative `domain_events` outbox (011_phase6_schema.sql) and, on rebuild, optionally
 * from the diaspora_import_audit_log (013) secondary projection source. It is the ONLY supported
 * writer of the graph tables; the migration grants writes to service_role only, and authenticated
 * (frontend / AI) get SELECT-only RLS — so this service mirrors the AI boundary
 * (diasporaAiCommandService.js): AI proposes, domain events mutate, and ONLY domain events create
 * edges. There is no code path here that lets the frontend or AI author a node/edge.
 *
 * NON-NEGOTIABLE invariants enforced by construction:
 *   1. DERIVED + REBUILDABLE — every node/edge carries a `source_event_ref` to a domain_events.id;
 *      `rebuildTenantGraph()` re-derives the whole tenant graph from the outbox (+ audit log) and
 *      yields the SAME graph (deterministic mapping + dedup + soft-delete supersede).
 *   2. IDEMPOTENT — per-event ledger (`trade_graph_processed_events`, UNIQUE event_id) + the unique
 *      dedup indexes on nodes/edges mean replaying the same event is a no-op. `projectEvent` is safe
 *      under the eventWorker's at-least-once retry (FOR UPDATE SKIP LOCKED, attempts/retry).
 *   3. TENANT-PARTITIONED — tenant_id is ALWAYS taken from the event envelope (domain_events.tenant_id,
 *      a TEXT column) and cast to uuid for the graph tables; it is never inferred from the payload.
 *   4. NO FRONTEND/AI WRITES — see above; writes only happen here, only from domain events/audit.
 *   5. REBUILD is admin-only, rate-limited, auditable — gated through the service-role-only
 *      `trade_graph_request_rebuild` RPC (rate limit + RUNNING/RATE_LIMITED bookkeeping) and recorded
 *      via appendCriticalAudit (fail-loud) on the diaspora_import_audit_log.
 *   6. GATED — every public entry point fail-closes when `isTradeGraphEnabled()` (env DIASPORA_TRADE_GRAPH)
 *      is false. The migration is additive and may exist independently of the flag.
 *
 * Storage abstraction
 * -------------------
 * The graph tables are written with raw parameterized SQL through a thin `pgClient.query(sql, params)`
 * interface — exactly the raw `pg` client the eventWorker hands its subscribers inside the outbox
 * transaction (`handler(event.payload, client, event.tenant_id)`), so projection dedup is written in
 * the SAME ACID transaction as the projection itself. The interface is intentionally minimal
 * (`{ query(text, params) => { rows } }`) so service-level tests drive it with an in-memory pg mock
 * (no DB, no network) the same way diasporaSafeTradeRpcReference.js mirrors the SafeTrade SQL.
 *
 * Time is injected (`context.now`) — never Date.now() in the projection path — so tests are
 * deterministic and replay/rebuild are reproducible.
 */

import {
  DIASPORA_EVENT_TYPE_SET,
  EVENT_PROJECTION_MAP,
  NODE_OPERATIONS,
  EDGE_OPERATIONS,
  TRADE_GRAPH_NODE_TYPE_SET,
  TRADE_GRAPH_EDGE_TYPE_SET,
  TRADE_GRAPH_PROJECTION_VERSION,
  TRADE_GRAPH_POLICY_VERSION,
  getProjectionMapping,
  isTradeGraphEnabled,
} from '../../../constants/diaspora/diasporaTradeGraphConstants.js';
import { appendCriticalAudit, resolveClient } from '../diasporaServiceUtils.js';
import { ValidationError, CarUpError } from '../../../utils/errors.js';
import { logger } from '../../../utils/logger.js';

/**
 * FIX E — stable error identifier thrown by makeProjectionSubscriber when the worker invokes it WITHOUT a
 * record carrying a uuid event id (the real 3-arg worker case). Surfacing this LOUDLY turns a misconfigured
 * wiring (which would otherwise silently drop every event with no id) into an immediate, named failure.
 */
export const TRADE_GRAPH_SUBSCRIBER_MISSING_EVENT_ID = 'TRADE_GRAPH_SUBSCRIBER_MISSING_EVENT_ID';

/**
 * FIX H — the per-event SAVEPOINT name used to isolate each event's projection inside the enclosing
 * poll/rebuild transaction. A fixed identifier (re-established per event; the latest definition wins) keeps
 * the SQL constant and inspectable. It must be a bare, lower-case SQL identifier (no quoting/params, since
 * SAVEPOINT names are identifiers, not bind parameters).
 */
export const TRADE_GRAPH_EVENT_SAVEPOINT = 'trade_graph_evt';

export class TradeGraphSubscriberMissingEventIdError extends CarUpError {
  constructor(message = 'Trade Graph projection subscriber was invoked without a domain_events record id', details = null) {
    super(message, 500, TRADE_GRAPH_SUBSCRIBER_MISSING_EVENT_ID, details);
    // Pin the name to the stable identifier so callers/tests can match on err.name regardless of minification.
    this.name = TRADE_GRAPH_SUBSCRIBER_MISSING_EVENT_ID;
  }
}

/*
 * ── How this service is DRIVEN (FIX E) ───────────────────────────────────────
 *
 * SUPPORTED, SELF-CONTAINED PRIMARY DRIVER:  projectPendingEvents(context)  (POLL-BASED)
 *   This is the contract this track OWNS end-to-end. It SELECTs unprojected domain_events rows directly
 *   (id, event_type, payload, tenant_id, created_at), ordered by created_at, beyond the per-tenant
 *   checkpoint, with FOR UPDATE SKIP LOCKED + a bounded batch, and calls projectEvent with the FULL row —
 *   so event.id (the idempotency key + source_event_ref) is ALWAYS present. It does NOT depend on the
 *   eventWorker's handler signature, so it can never silently lose event.id. A scheduled/looped caller
 *   invokes projectPendingEvents per tenant on its own service-role connection.
 *
 * OPTIONAL worker-subscriber path:  makeProjectionSubscriber(projection)
 *   The unmodified eventWorker (backend/services/eventBus/eventWorker.js) invokes each subscriber as
 *     handler(event.payload, client, event.tenant_id)            // current worker — NO record/id
 *   inside its shared outbox BEGIN/COMMIT batch transaction. projectEvent REQUIRES the full envelope
 *   (the `id` is the idempotency key + source_event_ref; `created_at` stamps the checkpoint). This track
 *   CANNOT modify eventWorker, so the worker-subscriber path is only usable if the INTEGRATOR forwards the
 *   raw record as a 4th argument:
 *     handler(event.payload, client, event.tenant_id, event)     // after a 1-line, integration-owned change
 *   To make a MISCONFIGURED wiring fail LOUDLY instead of silently dropping every event, makeProjectionSubscriber
 *   THROWS TRADE_GRAPH_SUBSCRIBER_MISSING_EVENT_ID when it is invoked without a record carrying a uuid id
 *   (the real 3-arg worker case). One-line registration the integrator would add (we do NOT edit eventWorker.js):
 *
 *     for (const t of DIASPORA_EVENT_TYPE_SET)
 *       eventWorker.subscribe(t, makeProjectionSubscriber(diasporaTradeGraphProjection));
 */

// ── Result/skip reason discriminators (stable strings consumed by Stage 5 routes + tests) ──
export const PROJECTION_OUTCOMES = Object.freeze({
  PROJECTED: 'PROJECTED',
  IDEMPOTENT_REPLAY: 'IDEMPOTENT_REPLAY',
  SKIPPED_DISABLED: 'SKIPPED_DISABLED',
  SKIPPED_UNKNOWN_EVENT: 'SKIPPED_UNKNOWN_EVENT',
  SKIPPED_NO_MAPPING: 'SKIPPED_NO_MAPPING',
  SKIPPED_NO_TENANT: 'SKIPPED_NO_TENANT',
  DEAD_LETTERED: 'DEAD_LETTERED',
});

export const REBUILD_STATUS = Object.freeze({
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
});

/** UUID v1-5 shape guard; entity ids are stored as text but tenant/event refs must be uuid. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Optionally call a metricsHub method only if it exists (the hub is shared infra we don't edit). */
function safeMetric(metricsHub, method, ...args) {
  if (metricsHub && typeof metricsHub[method] === 'function') {
    try {
      metricsHub[method](...args);
    } catch {
      /* metrics are best-effort; never let telemetry break projection */
    }
  }
}

/**
 * Resolve a selector to a concrete id/value against the projection envelope.
 * Selectors are pure `(envelope) => value|null`; a non-function is treated as a constant.
 */
function resolveSelector(selector, envelope) {
  if (typeof selector === 'function') return selector(envelope);
  return selector ?? null;
}

/** Clamp a requested poll batch size to [1, fallback*... ] keeping it a sane positive integer (FIX E). */
function clampBatch(value, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, 1000);
}

/** Build the `data`/`metadata` attribute bag from a mapping op's attribute selector map. */
function resolveAttributes(attributeMap, envelope) {
  const out = {};
  if (!attributeMap) return out;
  for (const [key, selector] of Object.entries(attributeMap)) {
    const value = resolveSelector(selector, envelope);
    // Skip null/undefined so an UPDATE event that only carries a status doesn't clobber prior data.
    if (value !== null && value !== undefined) out[key] = value;
  }
  return out;
}

export class DiasporaTradeGraphProjectionService {
  /**
   * @param {object} deps
   *   @param {object} [deps.metricsHub] - optional shared metrics hub (reused if present, never edited)
   *   @param {string} [deps.projectionVersion]
   *   @param {string} [deps.policyVersion]
   */
  constructor(deps = {}) {
    this.metricsHub = deps.metricsHub || null;
    this.projectionVersion = deps.projectionVersion || TRADE_GRAPH_PROJECTION_VERSION;
    this.policyVersion = deps.policyVersion || TRADE_GRAPH_POLICY_VERSION;
    // FIX 4: A SEPARATE pg pool used ONLY to persist dead-letters on their own short transaction, so a
    // dead-letter survives the failure of (and is not rolled back by) the eventWorker's shared batch
    // transaction. `deps.deadLetterPool` is `{ connect(): Promise<{ query, release }> }` — the same shape
    // as a pg.Pool. The integrator injects the service-role pool (DATABASE_URL/SUPABASE_DB_URL) here. When
    // absent we fall back to the in-transaction client (best-effort) and log that DL durability is degraded.
    this.deadLetterPool = deps.deadLetterPool || null;
    // FIX E: bounded batch size for the self-contained poll driver projectPendingEvents (keeps each poll
    // tick's FOR UPDATE SKIP LOCKED scan + projection work bounded, mirroring the eventWorker's LIMIT 10).
    this.pollBatchSize = Number.isFinite(deps.pollBatchSize) ? deps.pollBatchSize : 100;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public: single-event projection (the eventWorker subscriber entry point)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Idempotently project a single domain event into nodes/edges.
   *
   * @param {object} event - normalized envelope: { id, event_type, payload, tenant_id, created_at }
   *   `id` is domain_events.id (uuid, dedup + source_event_ref). `tenant_id` is domain_events.tenant_id
   *   (TEXT; cast to uuid for the graph). `payload` is domain_events.payload (jsonb).
   * @param {object} context
   *   @param {object} context.pgClient - raw pg-like client: `{ query(text, params) => { rows } }`
   *     (the eventWorker's transaction client). REQUIRED — projection writes share the outbox txn.
   *   @param {string} context.now - fixed ISO timestamp (NEVER Date.now()).
   *   @param {object} [context.deadLetterPool] - SEPARATE pg pool (`{ connect() }`) for dead-letters so a
   *     DL survives the rollback of the shared batch transaction (FIX 4). Overrides the instance pool.
   *   @param {object} [context.deadLetterClient] - a pre-checked-out separate client for the DL (tests).
   * @returns {Promise<object>} { outcome, eventId, eventType, nodes, edges, revokedEdges } or skip/replay
   */
  async projectEvent(event, context = {}) {
    if (!isTradeGraphEnabled()) {
      return { outcome: PROJECTION_OUTCOMES.SKIPPED_DISABLED };
    }

    const pgClient = context.pgClient;
    if (!pgClient || typeof pgClient.query !== 'function') {
      throw new ValidationError('projectEvent requires context.pgClient with a query() method');
    }
    const now = context.now;
    if (!now) {
      throw new ValidationError('projectEvent requires context.now (a fixed ISO timestamp)');
    }
    // Separate dead-letter sink (FIX 4): prefer an explicit per-call client/pool, else the instance pool.
    const deadLetterPool = context.deadLetterPool || this.deadLetterPool || null;
    const deadLetterClient = context.deadLetterClient || null;
    // FIX E: when the caller is the REBUILD (its own dedicated transaction), a DL written on the rebuild's
    // pgClient would be ERASED by the rebuild's own rollback (and a failed statement poisons that txn). So
    // the rebuild sets skipDeadLetterFallback=true: with no SEPARATE sink we skip the DL write gracefully
    // instead of falling into the rebuild client. The processed-ledger/idempotency guarantees are unchanged.
    const skipDeadLetterFallback = context.skipDeadLetterFallback === true;

    const eventId = event?.id ?? null;
    const eventType = event?.event_type ?? null;
    const payload = event?.payload ?? {};
    const rawTenant = event?.tenant_id ?? null;

    if (!eventId || !isUuid(String(eventId))) {
      throw new ValidationError('projectEvent requires event.id to be a uuid (domain_events.id)');
    }

    // Tenant is always taken from the envelope, cast to uuid; never inferred from payload.
    const tenantId = rawTenant != null ? String(rawTenant) : null;
    if (!tenantId || !isUuid(tenantId)) {
      // No tenant => not a tenant-scoped graph event; record nothing (and don't fail the outbox).
      return { outcome: PROJECTION_OUTCOMES.SKIPPED_NO_TENANT, eventId, eventType };
    }

    // 1. Idempotency: if already in the processed ledger, this is a replay → no-op.
    const processed = await pgClient.query(
      'SELECT event_id FROM trade_graph_processed_events WHERE event_id = $1',
      [eventId],
    );
    if (processed.rows && processed.rows.length > 0) {
      return { outcome: PROJECTION_OUTCOMES.IDEMPOTENT_REPLAY, eventId, eventType };
    }

    // 2. Only project known, mapped event types.
    if (!DIASPORA_EVENT_TYPE_SET.has(eventType)) {
      return { outcome: PROJECTION_OUTCOMES.SKIPPED_UNKNOWN_EVENT, eventId, eventType };
    }
    const mapping = getProjectionMapping(eventType);
    if (!mapping) {
      return { outcome: PROJECTION_OUTCOMES.SKIPPED_NO_MAPPING, eventId, eventType };
    }

    const envelope = { tenantId, payload, eventId, eventType, now };
    const start = Date.now();

    try {
      const nodeResults = [];
      const edgeResults = [];

      // 3. Node ops first (edges reference node ids; we resolve node ids by (tenant,type,entity)).
      for (const op of mapping.nodeOperations || []) {
        const result = await this.#applyNodeOperation(op, envelope, pgClient);
        if (result) nodeResults.push(result);
      }

      // 4. Edge ops. Each edge derives from THIS event (source_event_ref = eventId).
      for (const op of mapping.edgeOperations || []) {
        const result = await this.#applyEdgeOperation(op, envelope, pgClient);
        if (result) edgeResults.push(result);
      }

      // 4b. Edge revocations (FIX 3). A revoke event (e.g. STOCK_RELEASED, QUOTE_REJECTED/EXPIRED,
      //     CARGO_RESERVATION_REJECTED, DOCUMENT_REJECTED) soft-deletes the edge a prior event created.
      //     Idempotent: re-revoking an already-revoked edge updates zero rows (no-op).
      const revokedResults = [];
      for (const op of mapping.edgeRevocations || []) {
        const result = await this.#applyEdgeRevocation(op, envelope, pgClient);
        if (result) revokedResults.push(result);
      }

      // 5. Mark processed (idempotency guard) in the SAME transaction as the writes above.
      await pgClient.query(
        `INSERT INTO trade_graph_processed_events (event_id, event_type, tenant_id, projection_version, projected_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (event_id) DO NOTHING`,
        [eventId, eventType, tenantId, this.projectionVersion, now],
      );

      // 6. Advance the per-tenant checkpoint (uses the service-role-only RPC if available; the rebuild
      //    path stamps it via the same RPC). Best-effort within the txn — a checkpoint write must not
      //    break a successful projection, but it is recorded for resumability + staleness reporting.
      await this.#advanceCheckpoint(pgClient, tenantId, eventId, event?.created_at ?? now);

      const elapsedMs = Date.now() - start;
      safeMetric(this.metricsHub, 'recordGraphProjection', eventType, elapsedMs, 'success');
      logger.info('GRAPH', `Projected ${eventType}`, {
        eventId, eventType, tenantId, nodes: nodeResults.length, edges: edgeResults.length,
        revoked: revokedResults.length, durationMs: elapsedMs,
      });

      return {
        outcome: PROJECTION_OUTCOMES.PROJECTED,
        eventId,
        eventType,
        nodes: nodeResults,
        edges: edgeResults,
        revokedEdges: revokedResults,
        durationMs: elapsedMs,
      };
    } catch (err) {
      const elapsedMs = Date.now() - start;
      safeMetric(this.metricsHub, 'recordGraphProjection', eventType, elapsedMs, 'failure');
      logger.error('GRAPH', `Projection failed for ${eventType}: ${err.message}`, { eventId, eventType, tenantId, error: err });
      // FIX 4: Record the dead letter on a SEPARATE connection/transaction. The failing projection
      // statement poisons the eventWorker's shared batch transaction (a failed statement aborts the whole
      // pg txn), so a DL written on `pgClient` would itself fail / be rolled back and never persist. Writing
      // it on its own pool connection makes operator visibility survive the batch rollback. We then rethrow
      // so the eventWorker's retry/attempts machinery (and permanent-failure handling) still applies.
      await this.#writeDeadLetterDurable(
        { deadLetterPool, deadLetterClient, fallbackClient: pgClient, skipDeadLetterFallback },
        { eventId, eventType, tenantId, payload, error: err, now },
      );
      throw err;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internal: per-event SAVEPOINT isolation (FIX H — abort-poisoning containment)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * FIX H — Project ONE event inside a per-event SAVEPOINT so a failing event cannot poison the rest of
   * the enclosing transaction.
   *
   * THE BUG THIS CLOSES: projectPendingEvents and rebuildTenantGraph both loop over a batch of events and
   * project each one inside the caller's SINGLE enclosing Postgres transaction (the poll driver's
   * BEGIN…COMMIT / the rebuild's BEGIN…COMMIT). On REAL Postgres, the FIRST statement that errors ABORTS
   * the whole transaction: every subsequent statement then fails with
   *   "current transaction is aborted, commands ignored until end of transaction block"
   * until a ROLLBACK (or ROLLBACK TO SAVEPOINT). A bare per-event try/catch ("catch-and-continue") is
   * therefore BROKEN on real Postgres — one bad event poisons every following event in the batch/rebuild,
   * even though the in-memory test mock (which did not model abort state) made it look fine.
   *
   * THE FIX: wrap each event in a SAVEPOINT. A SAVEPOINT is a nested, named, rollback-able point inside the
   * outer transaction:
   *   - SAVEPOINT trade_graph_evt          — establish the per-event boundary (re-using one name is legal;
   *                                           Postgres keeps the most recent definition for that name).
   *   - …project the event…
   *   - on SUCCESS: RELEASE SAVEPOINT      — merge the event's writes into the outer txn and drop the SP.
   *   - on FAILURE: ROLLBACK TO SAVEPOINT  — discard ONLY this event's partial writes AND, crucially,
   *                                           CLEAR the aborted state so the NEXT event's statements run.
   * After ROLLBACK TO SAVEPOINT the outer transaction is healthy again, so the caller's loop can continue
   * to the next event and the previously-committed (savepoint-released) events remain intact. The
   * dead-letter is still written on the SEPARATE durable connection (see #writeDeadLetterDurable) so it
   * survives even an eventual rollback of the whole enclosing batch.
   *
   * This method NEVER swallows the error — it rethrows after rolling back to the savepoint, so the caller's
   * own catch records the dead-letter/skip bookkeeping exactly as before; the only added behavior is the
   * savepoint lifecycle that makes catch-and-continue actually correct on Postgres.
   *
   * @param {object} event       - the normalized envelope passed to projectEvent.
   * @param {object} pgClient     - the enclosing-transaction client (poll/rebuild owns its BEGIN/COMMIT).
   * @param {object} projectOpts  - the options forwarded to projectEvent (now, deadLetter sink, etc.).
   * @returns {Promise<object>} the projectEvent result on success.
   * @throws rethrows the projection error AFTER `ROLLBACK TO SAVEPOINT` clears the abort state.
   */
  async #projectEventWithSavepoint(event, pgClient, projectOpts) {
    // Establish the per-event savepoint inside the enclosing transaction. We reuse a single stable name;
    // each new SAVEPOINT with that name shadows the previous (already-released) one, so there is no leak.
    await pgClient.query(`SAVEPOINT ${TRADE_GRAPH_EVENT_SAVEPOINT}`);
    try {
      const res = await this.projectEvent(event, projectOpts);
      // Success → fold this event's writes into the outer transaction and discard the savepoint marker.
      await pgClient.query(`RELEASE SAVEPOINT ${TRADE_GRAPH_EVENT_SAVEPOINT}`);
      return res;
    } catch (err) {
      // Failure → roll back ONLY this event's partial writes and, critically, CLEAR the transaction-abort
      // state so the loop can keep projecting the following events. Without this the next pgClient.query
      // would throw "current transaction is aborted …" and the whole batch/rebuild would stall.
      //
      // IMPORTANT ORDERING: the dead-letter (written inside projectEvent's own catch, BEFORE this rethrow
      // reaches us) already went to the SEPARATE durable connection — it does NOT touch `pgClient`, so it is
      // unaffected by this rollback. We roll back the savepoint here, on the (now-aborted) enclosing client,
      // to make it usable again, then rethrow so the caller's per-event catch does its skip/count bookkeeping.
      try {
        await pgClient.query(`ROLLBACK TO SAVEPOINT ${TRADE_GRAPH_EVENT_SAVEPOINT}`);
      } catch (rollbackErr) {
        // If even the rollback-to-savepoint fails the enclosing transaction is unrecoverable; surface that
        // loudly (it means the whole batch must abort) rather than masking the original projection error.
        logger.error('GRAPH', `ROLLBACK TO SAVEPOINT failed after projection error: ${rollbackErr.message}`, {
          eventId: event?.id ?? null, originalError: err?.message ?? null,
        });
        throw rollbackErr;
      }
      throw err;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public: SELF-CONTAINED poll driver (FIX E) — the SUPPORTED primary projection path
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Drive the projection from the authoritative outbox WITHOUT depending on the eventWorker's handler
   * signature. SELECTs unprojected domain_events rows DIRECTLY (id, event_type, payload, tenant_id,
   * created_at) for a tenant, ordered by created_at (then id), beyond the per-tenant checkpoint
   * (last_event_created_at), with FOR UPDATE SKIP LOCKED + a bounded batch, and projects each FULL row
   * through projectEvent — so event.id is ALWAYS present (this path OWNS event.id). projectEvent advances
   * the checkpoint and records processed/dead-letter durably, so successive polls resume cleanly and a
   * replay of the same outbox yields the same graph (idempotent via the processed-events ledger).
   *
   * Anti-join on trade_graph_processed_events makes "unprojected" exact (safe across same-created_at ties),
   * while the checkpoint lower bound keeps the scan bounded. Each event is projected on its OWN attempt; a
   * failing event is dead-lettered (durably, on the separate sink) and SKIPPED so one bad event cannot stall
   * the batch — its id stays out of the processed ledger so a later poll can retry it.
   *
   * TRANSACTION CONTRACT (FIX H): the `FOR UPDATE SKIP LOCKED` row-lock SELECT REQUIRES an open
   * transaction, so the CALLER must wrap a poll tick in BEGIN…COMMIT (the route/scheduler driver opens it,
   * exactly like the rebuild's withTransaction). All events in a tick share that ONE enclosing transaction.
   * Because of that sharing, catch-and-continue would be broken on real Postgres (the first failed
   * statement aborts the whole txn). So each event is projected inside a per-event SAVEPOINT
   * (#projectEventWithSavepoint): a failing event ROLLs BACK TO its savepoint (clearing the abort state and
   * discarding only its partial writes) while every previously-released event remains intact and the
   * following events still project. The COMMIT at the end of the tick persists exactly the released events.
   *
   * @param {object} context
   *   @param {object} context.pgClient   - raw pg-like client INSIDE the caller's BEGIN…COMMIT (its own txn)
   *   @param {string} context.tenantId   - uuid; poll is per-tenant (the checkpoint is per-tenant)
   *   @param {string} context.now        - fixed ISO timestamp (NEVER Date.now())
   *   @param {number} [context.batchSize]- override the bounded batch size for this tick
   *   @param {object} [context.deadLetterPool] / [context.deadLetterClient] - durable DL sink (FIX 4)
   * @returns {Promise<object>} { outcome:'POLLED', tenantId, scanned, projected, replayed, skipped, deadLettered, lastEventId, results[] }
   */
  async projectPendingEvents(context = {}) {
    if (!isTradeGraphEnabled()) {
      return { outcome: PROJECTION_OUTCOMES.SKIPPED_DISABLED };
    }
    const pgClient = context.pgClient;
    if (!pgClient || typeof pgClient.query !== 'function') {
      throw new ValidationError('projectPendingEvents requires context.pgClient with a query() method');
    }
    const tenantId = context.tenantId != null ? String(context.tenantId) : null;
    if (!tenantId || !isUuid(tenantId)) {
      throw new ValidationError('projectPendingEvents requires a uuid context.tenantId');
    }
    const now = context.now;
    if (!now) {
      throw new ValidationError('projectPendingEvents requires context.now (a fixed ISO timestamp)');
    }
    const batchSize = clampBatch(context.batchSize, this.pollBatchSize);

    // Read the per-tenant checkpoint lower bound (last_event_created_at). Absent → from the beginning.
    const cp = await pgClient.query(
      'SELECT last_event_created_at FROM trade_graph_projection_checkpoints WHERE tenant_id = $1',
      [tenantId],
    );
    const sinceCreatedAt = (cp.rows && cp.rows[0] && cp.rows[0].last_event_created_at) || null;

    // SELECT unprojected rows DIRECTLY from the outbox: beyond the checkpoint, not already in the processed
    // ledger, ordered by created_at then id, FOR UPDATE SKIP LOCKED, bounded. tenant_id is TEXT in
    // domain_events; we filter by the caller tenant only.
    const pending = await pgClient.query(
      `SELECT d.id, d.event_type, d.payload, d.tenant_id, d.created_at
         FROM domain_events d
        WHERE d.tenant_id = $1
          AND d.status IN ('processed', 'pending')
          AND ($2::timestamptz IS NULL OR d.created_at >= $2::timestamptz)
          AND NOT EXISTS (
            SELECT 1 FROM trade_graph_processed_events p WHERE p.event_id = d.id
          )
        ORDER BY d.created_at ASC, d.id ASC
        LIMIT $3
        FOR UPDATE SKIP LOCKED`,
      [tenantId, sinceCreatedAt, batchSize],
    );
    const rows = pending.rows || [];

    const deadLetterPool = context.deadLetterPool || this.deadLetterPool || null;
    const deadLetterClient = context.deadLetterClient || null;

    let projected = 0;
    let replayed = 0;
    let skipped = 0;
    let deadLettered = 0;
    let lastEventId = null;
    const results = [];

    for (const row of rows) {
      const envelopeEvent = {
        id: row.id,
        event_type: row.event_type,
        payload: this.#asObject(row.payload),
        tenant_id: row.tenant_id,
        created_at: row.created_at,
      };
      try {
        // FIX H: project inside a per-event SAVEPOINT so a mid-batch failure rolls back ONLY this event
        // (and clears the Postgres abort state) instead of poisoning every following event in this tick's
        // shared transaction.
        const res = await this.#projectEventWithSavepoint(
          envelopeEvent, pgClient, { pgClient, now, deadLetterPool, deadLetterClient },
        );
        results.push({ eventId: row.id, outcome: res.outcome });
        if (res.outcome === PROJECTION_OUTCOMES.PROJECTED) { projected += 1; lastEventId = row.id; }
        else if (res.outcome === PROJECTION_OUTCOMES.IDEMPOTENT_REPLAY) { replayed += 1; lastEventId = row.id; }
        else { skipped += 1; }
      } catch (err) {
        // The savepoint was already rolled back inside #projectEventWithSavepoint, so `pgClient` is healthy
        // again for the NEXT event. The dead-letter was written durably (on the separate sink) inside
        // projectEvent; the event id stays OUT of the processed ledger so a later poll retries it. We swallow
        // here so one poisoned event can't stall the rest of the batch.
        deadLettered += 1;
        results.push({ eventId: row.id, outcome: PROJECTION_OUTCOMES.DEAD_LETTERED });
        logger.error('GRAPH', `Poll: event ${row.id} failed: ${err.message}`, { eventId: row.id, tenantId });
      }
    }

    safeMetric(this.metricsHub, 'recordGraphPoll', tenantId, rows.length, projected, deadLettered);
    return {
      outcome: 'POLLED',
      tenantId,
      scanned: rows.length,
      projected,
      replayed,
      skipped,
      deadLettered,
      lastEventId,
      batchSize,
      results,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public: admin rebuild (rate-limited, auditable, derives from authoritative source)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Re-derive the ENTIRE graph for one tenant from the authoritative outbox (domain_events),
   * in chronological order. Admin-only, rate-limited and auditable.
   *
   * Determinism/replay: clearing the tenant's nodes/edges/processed-ledger and replaying the same
   * ordered events through the same deterministic mapping yields an identical graph (dedup indexes
   * + soft-delete supersede make this exact).
   *
   * TRANSACTION CONTRACT (FIX H): the rebuild runs inside ONE dedicated BEGIN…COMMIT transaction opened by
   * the caller (diasporaTradeGraphRoutes.js withTransaction) so the clear + full replay either fully apply
   * or fully roll back. Because every replayed event shares that single transaction, a per-event try/catch
   * would be broken on real Postgres (one failed statement aborts the whole txn). Each replayed event is
   * therefore projected inside a per-event SAVEPOINT (#projectEventWithSavepoint): a failing event ROLLs
   * BACK TO its savepoint (clearing the abort state + discarding only its writes) and is counted as failed,
   * while the rest of the replay continues and the final COMMIT persists the rebuilt graph.
   *
   * @param {string} tenantId - uuid
   * @param {object} context
   *   @param {object} context.pgClient - raw pg-like client INSIDE the dedicated rebuild BEGIN…COMMIT
   *   @param {string} context.now - fixed ISO timestamp
   *   @param {object} context.actor - server-derived actor: { id, isPlatformAdmin }
   *   @param {object} [context.auditClient] - supabase-like client for the CRITICAL rebuild audit
   *     (defaults to the service-role client via resolveClient)
   *   @param {string} [context.reason]
   *   @param {number} [context.minIntervalSeconds=3600]
   * @returns {Promise<object>} { status, tenantId, rebuildId, eventsProcessed, eventsFailed, nodesRebuilt, edgesRebuilt }
   */
  async rebuildTenantGraph(tenantId, context = {}) {
    if (!isTradeGraphEnabled()) {
      return { status: PROJECTION_OUTCOMES.SKIPPED_DISABLED };
    }
    const pgClient = context.pgClient;
    if (!pgClient || typeof pgClient.query !== 'function') {
      throw new ValidationError('rebuildTenantGraph requires context.pgClient with a query() method');
    }
    if (!tenantId || !isUuid(String(tenantId))) {
      throw new ValidationError('rebuildTenantGraph requires a uuid tenantId');
    }
    const now = context.now;
    if (!now) throw new ValidationError('rebuildTenantGraph requires context.now');

    const actor = context.actor || {};
    if (!actor.isPlatformAdmin) {
      // Admin-only. Server-derived role (diasporaAuthorization) — never trust a client-supplied role.
      throw new ValidationError('rebuildTenantGraph is admin-only');
    }
    const initiatedBy = actor.id != null ? String(actor.id) : 'system';
    const reason = context.reason || 'admin_manual_rebuild';
    const minIntervalSeconds = Number.isFinite(context.minIntervalSeconds) ? context.minIntervalSeconds : 3600;

    // 1. Rate-limit + bookkeeping via the service-role-only RPC (RUNNING / RATE_LIMITED row).
    const requested = await pgClient.query(
      'SELECT * FROM trade_graph_request_rebuild($1, $2, $3, $4)',
      [tenantId, initiatedBy, reason, minIntervalSeconds],
    );
    const rebuildRow = requested.rows && requested.rows[0];
    if (!rebuildRow) {
      throw new ValidationError('trade_graph_request_rebuild returned no row');
    }

    // CRITICAL audit of the rebuild REQUEST (fail-loud), regardless of rate-limit outcome.
    await this.#auditRebuild(context, {
      tenantId, actorId: initiatedBy, reason, rebuildId: rebuildRow.id, status: rebuildRow.status,
    });

    if (rebuildRow.status === REBUILD_STATUS.RATE_LIMITED) {
      safeMetric(this.metricsHub, 'recordGraphRebuild', tenantId, 0, 0, 0);
      return {
        status: REBUILD_STATUS.RATE_LIMITED,
        tenantId,
        rebuildId: rebuildRow.id,
        eventsProcessed: 0,
        eventsFailed: 0,
      };
    }

    const rebuildId = rebuildRow.id;
    const start = Date.now();

    try {
      // 2. Clear the tenant's derived state. Edges first (FK ON DELETE RESTRICT references nodes).
      await pgClient.query('DELETE FROM trade_graph_edges WHERE tenant_id = $1', [tenantId]);
      await pgClient.query('DELETE FROM trade_graph_nodes WHERE tenant_id = $1', [tenantId]);
      await pgClient.query('DELETE FROM trade_graph_processed_events WHERE tenant_id = $1', [tenantId]);

      // 3. Replay the authoritative outbox in chronological order (processed + pending; failed events
      //    are excluded — they never produced authoritative state). tenant_id is TEXT in domain_events.
      const events = await pgClient.query(
        `SELECT id, event_type, payload, tenant_id, created_at
           FROM domain_events
          WHERE tenant_id = $1
            AND status IN ('processed', 'pending')
          ORDER BY created_at ASC, id ASC`,
        [tenantId],
      );

      let eventsProcessed = 0;
      let eventsFailed = 0;
      let nodesRebuilt = 0;
      let edgesRebuilt = 0;

      for (const row of events.rows || []) {
        const envelopeEvent = {
          id: row.id,
          event_type: row.event_type,
          payload: this.#asObject(row.payload),
          tenant_id: row.tenant_id,
          created_at: row.created_at,
        };
        try {
          // FIX E: a rebuild runs in ONE dedicated transaction. Dead-letters must NOT be written on
          // `pgClient` (the rebuild's own rollback would erase them and a failed statement poisons the txn).
          // Forward any operator-injected SEPARATE sink; with none, skipDeadLetterFallback makes projectEvent
          // skip the DL write gracefully rather than corrupting the rebuild.
          // FIX H: project inside a per-event SAVEPOINT so a failing replay event rolls back ONLY itself and
          // clears the Postgres abort state — without it, the first bad event would poison the entire replay.
          const res = await this.#projectEventWithSavepoint(envelopeEvent, pgClient, {
            pgClient,
            now,
            deadLetterPool: context.deadLetterPool || this.deadLetterPool || null,
            deadLetterClient: context.deadLetterClient || null,
            skipDeadLetterFallback: true,
          });
          if (res.outcome === PROJECTION_OUTCOMES.PROJECTED) {
            eventsProcessed += 1;
            nodesRebuilt += res.nodes.length;
            edgesRebuilt += res.edges.length;
          }
        } catch (err) {
          // The savepoint was rolled back inside #projectEventWithSavepoint, so `pgClient` is healthy for the
          // next event. Dead-letter handling happened inside projectEvent; the rebuild continues so one bad
          // event can't abort the rest.
          eventsFailed += 1;
          logger.error('GRAPH', `Rebuild: event ${row.id} failed: ${err.message}`, { eventId: row.id, tenantId });
        }
      }

      // 4. Mark the rebuild row COMPLETED with counts; clear the replay flag on the checkpoint.
      await pgClient.query(
        `UPDATE trade_graph_rebuilds
            SET status = $1, completed_at = $2, nodes_rebuilt = $3, edges_rebuilt = $4,
                events_processed = $5, events_failed = $6
          WHERE id = $7`,
        [REBUILD_STATUS.COMPLETED, now, nodesRebuilt, edgesRebuilt, eventsProcessed, eventsFailed, rebuildId],
      );
      await pgClient.query(
        `UPDATE trade_graph_projection_checkpoints
            SET next_replay_required = false, updated_at = $2
          WHERE tenant_id = $1`,
        [tenantId, now],
      );

      const elapsedMs = Date.now() - start;
      safeMetric(this.metricsHub, 'recordGraphRebuild', tenantId, eventsProcessed, eventsFailed, elapsedMs);
      logger.info('GRAPH', `Rebuild completed for tenant ${tenantId}`, {
        tenantId, rebuildId, eventsProcessed, eventsFailed, nodesRebuilt, edgesRebuilt, durationMs: elapsedMs,
      });

      return {
        status: REBUILD_STATUS.COMPLETED,
        tenantId,
        rebuildId,
        eventsProcessed,
        eventsFailed,
        nodesRebuilt,
        edgesRebuilt,
        durationMs: elapsedMs,
      };
    } catch (err) {
      await pgClient.query(
        `UPDATE trade_graph_rebuilds SET status = $1, completed_at = $2 WHERE id = $3`,
        [REBUILD_STATUS.FAILED, now, rebuildId],
      );
      logger.error('GRAPH', `Rebuild failed for tenant ${tenantId}: ${err.message}`, { tenantId, rebuildId, error: err });
      throw err;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internal node/edge writers (parameterized SQL; soft-delete supersede)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * CREATE_OR_UPDATE_NODE: upsert the current node row for (tenant, node_type, entity_id), merging
   * attributes into `data`. Idempotent via the partial-unique dedup index; the trigger keeps
   * updated_at fresh. Returns null (skip) if the entity id resolves to null/empty.
   */
  async #applyNodeOperation(op, envelope, pgClient) {
    if (op.operation !== NODE_OPERATIONS.CREATE_OR_UPDATE_NODE) {
      throw new ValidationError(`Unknown node operation: ${op.operation}`);
    }
    const nodeType = op.nodeType;
    if (!TRADE_GRAPH_NODE_TYPE_SET.has(nodeType)) {
      throw new ValidationError(`Unknown node type in mapping: ${nodeType}`);
    }
    const entityId = resolveSelector(op.idSelector, envelope);
    if (entityId === null || entityId === undefined || entityId === '') return null; // skip — keeps projection idempotent

    const entityType = op.entityType || nodeType;
    const attributes = resolveAttributes(op.attributes, envelope);
    const dataJson = JSON.stringify(attributes);

    const { tenantId, eventId, now } = envelope;

    // Upsert against the (tenant, node_type, entity_id) dedup index over current, non-deleted rows.
    // ON CONFLICT merges new attributes onto existing data (existing wins only where new is absent),
    // refreshes validity/confidence to current, and re-stamps the source event + projection version.
    const res = await pgClient.query(
      `INSERT INTO trade_graph_nodes
         (tenant_id, node_type, entity_type, entity_id, is_current, is_valid, confidence, data,
          projection_version, source_event_ref, created_at, updated_at)
       VALUES ($1, $2, $3, $4, true, true, 1.0000, $5::jsonb, $6, $7, $8, $8)
       ON CONFLICT (tenant_id, node_type, entity_id) WHERE is_current IS TRUE AND deleted_at IS NULL
       DO UPDATE SET
         data = trade_graph_nodes.data || EXCLUDED.data,
         is_valid = true,
         source_event_ref = EXCLUDED.source_event_ref,
         projection_version = EXCLUDED.projection_version,
         updated_at = EXCLUDED.updated_at
       RETURNING id`,
      [tenantId, nodeType, entityType, String(entityId), dataJson, this.projectionVersion, eventId, now],
    );
    const nodeId = res.rows && res.rows[0] && res.rows[0].id;
    return { nodeType, entityId: String(entityId), nodeId };
  }

  /**
   * CREATE_EDGE: resolve the source/target node ids by (tenant, type, entity_id) and insert the edge
   * carrying source_event_ref = this event. Idempotent via the edge dedup index. Skips (returns null)
   * if either endpoint cannot be resolved or the edge would be a self-loop (guards the CHECK).
   */
  async #applyEdgeOperation(op, envelope, pgClient) {
    if (op.operation !== EDGE_OPERATIONS.CREATE_EDGE) {
      throw new ValidationError(`Unknown edge operation: ${op.operation}`);
    }
    const edgeType = op.edgeType;
    if (!TRADE_GRAPH_EDGE_TYPE_SET.has(edgeType)) {
      throw new ValidationError(`Unknown edge type in mapping: ${edgeType}`);
    }

    const fromEntityId = resolveSelector(op.fromId, envelope);
    const toEntityId = resolveSelector(op.toId, envelope);
    if (fromEntityId == null || fromEntityId === '' || toEntityId == null || toEntityId === '') {
      return null; // missing endpoint → skip (do not create a partial/dangling edge)
    }

    const { tenantId, eventId, now } = envelope;

    const sourceNodeId = await this.#resolveOrCreateNodeId(
      pgClient, tenantId, op.fromNodeType, String(fromEntityId), eventId, now,
    );
    const targetNodeId = await this.#resolveOrCreateNodeId(
      pgClient, tenantId, op.toNodeType, String(toEntityId), eventId, now,
    );
    if (!sourceNodeId || !targetNodeId) return null;
    if (sourceNodeId === targetNodeId) return null; // honor no_self_loops CHECK

    const confidence = Number.isFinite(op.confidence) ? op.confidence : 1.0;
    const metadata = JSON.stringify(resolveAttributes(op.metadata, envelope));

    const res = await pgClient.query(
      `INSERT INTO trade_graph_edges
         (tenant_id, source_node_id, target_node_id, edge_type, source_event_ref, is_valid, confidence,
          policy_version, valid_from, created_at, updated_at, metadata)
       VALUES ($1, $2, $3, $4, $5, true, $6, $7, $8, $8, $8, $9::jsonb)
       ON CONFLICT (tenant_id, source_node_id, target_node_id, edge_type, source_event_ref)
         WHERE deleted_at IS NULL
       DO NOTHING
       RETURNING id`,
      [tenantId, sourceNodeId, targetNodeId, edgeType, eventId, confidence, this.policyVersion, now, metadata],
    );
    const edgeId = res.rows && res.rows[0] && res.rows[0].id;
    return { edgeType, sourceNodeId, targetNodeId, edgeId: edgeId || null, created: Boolean(edgeId) };
  }

  /**
   * SOFT_DELETE_EDGE (FIX 3): revoke a previously-derived edge by marking it deleted_at + is_valid=false.
   * Resolves the endpoints by (tenant, type, entity_id) WITHOUT creating placeholders — if either endpoint
   * or the edge does not exist there is simply nothing to revoke (returns null). Tenant-scoped: only the
   * caller-tenant's edges between the caller-tenant's nodes are touched. Idempotent: re-revoking an
   * already-soft-deleted edge matches `deleted_at IS NULL` → zero rows updated (no-op). The revocation is
   * stamped with this event's id so the audit trail records WHICH event tore the relationship down.
   */
  async #applyEdgeRevocation(op, envelope, pgClient) {
    if (op.operation !== EDGE_OPERATIONS.SOFT_DELETE_EDGE) {
      throw new ValidationError(`Unknown edge revocation operation: ${op.operation}`);
    }
    const edgeType = op.edgeType;
    if (!TRADE_GRAPH_EDGE_TYPE_SET.has(edgeType)) {
      throw new ValidationError(`Unknown edge type in revocation mapping: ${edgeType}`);
    }

    const fromEntityId = resolveSelector(op.fromId, envelope);
    const toEntityId = resolveSelector(op.toId, envelope);
    if (fromEntityId == null || fromEntityId === '' || toEntityId == null || toEntityId === '') {
      return null; // missing endpoint → nothing to revoke
    }

    const { tenantId, eventId, now } = envelope;

    const sourceNodeId = await this.#resolveExistingNodeId(pgClient, tenantId, op.fromNodeType, String(fromEntityId));
    const targetNodeId = await this.#resolveExistingNodeId(pgClient, tenantId, op.toNodeType, String(toEntityId));
    if (!sourceNodeId || !targetNodeId) return null; // endpoints not in the graph → nothing to revoke

    const res = await pgClient.query(
      `UPDATE trade_graph_edges
          SET deleted_at = $5, is_valid = false, valid_until = $5, updated_at = $5, revoked_event_ref = $6
        WHERE tenant_id = $1 AND source_node_id = $2 AND target_node_id = $3 AND edge_type = $4
          AND deleted_at IS NULL
        RETURNING id`,
      [tenantId, sourceNodeId, targetNodeId, edgeType, now, eventId],
    );
    const revokedIds = (res.rows || []).map((r) => r.id);
    if (revokedIds.length === 0) return null; // already revoked or never existed → idempotent no-op
    return { edgeType, sourceNodeId, targetNodeId, revokedEdgeIds: revokedIds, revoked: true };
  }

  /**
   * Resolve the CURRENT node id for (tenant, type, entity) WITHOUT creating a placeholder. Used by
   * revocations (we never fabricate a node just to revoke a non-existent edge). Tenant-scoped.
   */
  async #resolveExistingNodeId(pgClient, tenantId, nodeType, entityId) {
    if (!TRADE_GRAPH_NODE_TYPE_SET.has(nodeType)) {
      throw new ValidationError(`Unknown node type referenced by edge revocation: ${nodeType}`);
    }
    const found = await pgClient.query(
      `SELECT id FROM trade_graph_nodes
        WHERE tenant_id = $1 AND node_type = $2 AND entity_id = $3
          AND is_current IS TRUE AND deleted_at IS NULL
        LIMIT 1`,
      [tenantId, nodeType, entityId],
    );
    return (found.rows && found.rows[0] && found.rows[0].id) || null;
  }

  /**
   * Resolve the current node id for (tenant, type, entity); create a thin placeholder node if the
   * referenced entity has not been projected yet (out-of-order delivery). The placeholder carries the
   * same source_event_ref and is later enriched in-place by its own CREATE_OR_UPDATE_NODE op (data is
   * merged, not replaced), so the graph converges to the same state regardless of event order.
   */
  async #resolveOrCreateNodeId(pgClient, tenantId, nodeType, entityId, eventId, now) {
    if (!TRADE_GRAPH_NODE_TYPE_SET.has(nodeType)) {
      throw new ValidationError(`Unknown node type referenced by edge: ${nodeType}`);
    }
    const found = await pgClient.query(
      `SELECT id FROM trade_graph_nodes
        WHERE tenant_id = $1 AND node_type = $2 AND entity_id = $3
          AND is_current IS TRUE AND deleted_at IS NULL
        LIMIT 1`,
      [tenantId, nodeType, entityId],
    );
    if (found.rows && found.rows.length > 0) return found.rows[0].id;

    const created = await pgClient.query(
      `INSERT INTO trade_graph_nodes
         (tenant_id, node_type, entity_type, entity_id, is_current, is_valid, confidence, data,
          projection_version, source_event_ref, created_at, updated_at)
       VALUES ($1, $2, $2, $3, true, true, 1.0000, '{}'::jsonb, $4, $5, $6, $6)
       ON CONFLICT (tenant_id, node_type, entity_id) WHERE is_current IS TRUE AND deleted_at IS NULL
       DO NOTHING
       RETURNING id`,
      [tenantId, nodeType, entityId, this.projectionVersion, eventId, now],
    );
    if (created.rows && created.rows.length > 0) return created.rows[0].id;

    // Lost an insert race / conflict resolved to an existing row — read it back.
    const reRead = await pgClient.query(
      `SELECT id FROM trade_graph_nodes
        WHERE tenant_id = $1 AND node_type = $2 AND entity_id = $3
          AND is_current IS TRUE AND deleted_at IS NULL
        LIMIT 1`,
      [tenantId, nodeType, entityId],
    );
    return (reRead.rows && reRead.rows[0] && reRead.rows[0].id) || null;
  }

  /** Advance the per-tenant checkpoint via the service-role-only RPC (idempotent upsert). */
  async #advanceCheckpoint(pgClient, tenantId, lastEventId, lastEventCreatedAt) {
    try {
      await pgClient.query(
        'SELECT trade_graph_record_checkpoint($1, $2, $3, $4)',
        [tenantId, lastEventId, lastEventCreatedAt, this.projectionVersion],
      );
    } catch (err) {
      // Checkpoint is for resumability/staleness reporting — its failure must not roll back a good
      // projection. The processed-events ledger remains the hard idempotency guarantee.
      logger.warn('GRAPH', `Checkpoint advance failed (non-fatal): ${err.message}`, { tenantId, lastEventId });
    }
  }

  /**
   * Persist a dead-letter DURABLY (FIX 4). The projection failure poisons the eventWorker's shared batch
   * transaction (a failed statement aborts the whole pg txn → any subsequent write on that client fails and
   * is rolled back with the batch). So we open a SEPARATE pool connection and write the DL on its OWN short
   * transaction, which commits independently of the batch and therefore SURVIVES the batch rollback.
   *
   * Resolution order for the DL sink:
   *   1. an explicit `deadLetterClient` (tests inject one), used as-is (no connect/release);
   *   2. a `deadLetterPool` (or the instance pool) → check out a client, run inside BEGIN/COMMIT, release;
   *   3. NO separate sink available → fall back to the in-transaction `fallbackClient` (best-effort; the DL
   *      may not survive the rollback) and log that DL durability is degraded so operators wire the pool.
   * In every case DL writing never throws (operator visibility is best-effort relative to the rethrow that
   * drives the worker's retry/attempts machinery).
   */
  async #writeDeadLetterDurable({ deadLetterPool, deadLetterClient, fallbackClient, skipDeadLetterFallback }, dl) {
    // 1. Explicit separate client (already checked out by the caller/tests).
    if (deadLetterClient && typeof deadLetterClient.query === 'function') {
      try {
        await this.#writeDeadLetterRows(deadLetterClient, dl);
      } catch (e) {
        logger.error('GRAPH', `Dead-letter (injected client) failed for ${dl.eventId}: ${e.message}`, { eventId: dl.eventId });
      }
      return;
    }

    // 2. Separate pool → own connection + own BEGIN/COMMIT so the DL commits independently of the batch.
    if (deadLetterPool && typeof deadLetterPool.connect === 'function') {
      let client = null;
      try {
        client = await deadLetterPool.connect();
        try {
          await client.query('BEGIN');
          await this.#writeDeadLetterRows(client, dl);
          await client.query('COMMIT');
        } catch (e) {
          try { await client.query('ROLLBACK'); } catch { /* connection may be dead */ }
          throw e;
        }
      } catch (e) {
        logger.error('GRAPH', `Durable dead-letter failed for ${dl.eventId}: ${e.message}`, { eventId: dl.eventId });
      } finally {
        if (client && typeof client.release === 'function') client.release();
      }
      return;
    }

    // 3a. FIX E: REBUILD path with no separate sink → SKIP the DL write gracefully. The rebuild owns a
    //     single dedicated transaction that ROLLS BACK on failure; writing the DL on that client would be
    //     erased by the rollback (and a failed statement would poison the rebuild txn). We never corrupt the
    //     rebuild for the sake of a best-effort DL — the rebuild already counts/logs the failed event and
    //     continues. Operators should inject a deadLetterPool to capture rebuild DLs durably.
    if (skipDeadLetterFallback) {
      logger.warn('GRAPH', `No separate dead-letter pool wired during rebuild; skipping DL write for ${dl.eventId} (rebuild rollback-safe)`, { eventId: dl.eventId });
      return;
    }

    // 3b. No separate sink (non-rebuild) → best-effort on the (likely poisoned) batch client. Document it.
    logger.warn('GRAPH', `No separate dead-letter pool wired; DL durability degraded for ${dl.eventId}`, { eventId: dl.eventId });
    try {
      await this.#writeDeadLetterRows(fallbackClient, dl);
    } catch (e) {
      logger.error('GRAPH', `Fallback dead-letter failed for ${dl.eventId}: ${e.message}`, { eventId: dl.eventId });
    }
  }

  /**
   * The dead-letter write itself (UNIQUE event_id; retry_count bumps on conflict). FIX 8: the per-tenant
   * dead_letter_count is kept durable even when this is the FIRST event for the tenant (no checkpoint row
   * exists yet) by UPSERTING the checkpoint with the incremented counter instead of a blind UPDATE that
   * would match zero rows and silently lose the increment.
   */
  async #writeDeadLetterRows(client, { eventId, eventType, tenantId, payload, error, now }) {
    await client.query(
      `INSERT INTO trade_graph_dead_letters
         (event_id, event_type, tenant_id, payload, error_message, error_stack, retry_count, created_at, last_retry_at, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, 0, $7, $7, $7)
       ON CONFLICT (event_id) DO UPDATE SET
         error_message = EXCLUDED.error_message,
         error_stack = EXCLUDED.error_stack,
         retry_count = trade_graph_dead_letters.retry_count + 1,
         last_retry_at = EXCLUDED.last_retry_at,
         updated_at = EXCLUDED.updated_at`,
      [
        eventId,
        eventType,
        tenantId,
        JSON.stringify(this.#asObject(payload)),
        error?.message ?? 'unknown error',
        error?.stack ?? null,
        now,
      ],
    );
    if (tenantId) {
      // FIX 8: UPSERT (not blind UPDATE) so the dead-letter counter is durable on the very first failure
      // for a tenant (before any successful projection created a checkpoint row).
      await client.query(
        `INSERT INTO trade_graph_projection_checkpoints (tenant_id, dead_letter_count, projection_version, updated_at)
         VALUES ($1, 1, $3, $2)
         ON CONFLICT (tenant_id) DO UPDATE SET
           dead_letter_count = trade_graph_projection_checkpoints.dead_letter_count + 1,
           updated_at = EXCLUDED.updated_at`,
        [tenantId, now, this.projectionVersion],
      );
    }
  }

  /** CRITICAL audit (fail-loud) of a rebuild request on the diaspora_import_audit_log. */
  async #auditRebuild(context, { tenantId, actorId, reason, rebuildId, status }) {
    const auditClient = context.auditClient || (await resolveClient(context));
    await appendCriticalAudit(auditClient, {
      actorId,
      tenantId,
      action: 'TRADE_GRAPH_REBUILD_REQUESTED',
      resourceType: 'trade_graph_projection',
      resourceId: rebuildId != null ? String(rebuildId) : tenantId,
      metadata: { reason, status, projectionVersion: this.projectionVersion },
      req: context.req || null,
    });
  }

  /** Coerce a jsonb column (object or JSON string) into a plain object. */
  #asObject(value) {
    if (value == null) return {};
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return {};
      }
    }
    return value;
  }
}

/**
 * FIX 5 — EXACT eventWorker subscriber wrapper.
 *
 * The unmodified eventWorker (backend/services/eventBus/eventWorker.js, processEvent) invokes every
 * subscriber as:
 *
 *     handler(event.payload, client, event.tenant_id)            // current worker
 *     handler(event.payload, client, event.tenant_id, event)     // after a 1-line record-forward change
 *
 * projectEvent REQUIRES the full envelope { id, event_type, payload, tenant_id, created_at } — the `id`
 * (domain_events.id) is the idempotency key + source_event_ref, and `created_at` stamps the checkpoint.
 * The worker's positional args carry the payload, the in-transaction client and the tenant, plus the raw
 * `record` as a 4th argument; this wrapper maps EXACTLY those positional args to the envelope, so wiring
 * it needs no change to projectEvent and only one integration-owned line at the worker (forward `event`).
 *
 * One-line registration the integrator adds (we do NOT edit eventWorker.js here):
 *
 *     for (const t of DIASPORA_EVENT_TYPE_SET)
 *       eventWorker.subscribe(t, makeProjectionSubscriber(diasporaTradeGraphProjection));
 *
 * @param {DiasporaTradeGraphProjectionService} projection
 * @param {object} [opts]
 *   @param {function} [opts.getNow] - returns the fixed ISO timestamp (defaults to wall clock at call).
 *   @param {object}   [opts.deadLetterPool] - separate pool for durable dead-letters (FIX 4).
 * @returns {function} handler(payload, pgClient, tenantId, record) compatible with eventWorker.subscribe.
 */
export function makeProjectionSubscriber(projection, opts = {}) {
  const getNow = typeof opts.getNow === 'function' ? opts.getNow : () => new Date().toISOString();
  const deadLetterPool = opts.deadLetterPool || null;
  return async function projectionSubscriber(payload, pgClient, tenantId, record = {}) {
    // FIX E(2): FAIL LOUD. The unmodified 3-arg worker calls handler(payload, client, tenantId) with NO
    // record, so `record.id` is absent — projecting that would silently lose event.id (no idempotency key,
    // no source_event_ref) for EVERY event. Throw a clear, named error so a misconfigured wiring (worker not
    // forwarding the record) is caught immediately instead of corrupting the graph. The SUPPORTED, self-
    // contained path is projectPendingEvents (poll-based), which always owns event.id.
    const eventId = record?.id ?? null;
    if (!eventId || !isUuid(String(eventId))) {
      throw new TradeGraphSubscriberMissingEventIdError(
        'makeProjectionSubscriber requires the domain_events record (4th arg) carrying a uuid id; the 3-arg '
        + 'eventWorker does not forward it. Either forward the record (handler(payload, client, tenant, event)) '
        + 'or drive projection with the self-contained projectPendingEvents poll driver.',
        { eventType: record?.event_type ?? null, tenantId: tenantId ?? record?.tenant_id ?? null },
      );
    }
    // Reconstruct the envelope projectEvent needs from the worker's positional args + the raw record.
    const envelope = {
      id: eventId,
      event_type: record?.event_type ?? null,
      payload,
      tenant_id: tenantId ?? record?.tenant_id ?? null,
      created_at: record?.created_at ?? null,
    };
    return projection.projectEvent(envelope, {
      pgClient,
      now: getNow(),
      deadLetterPool,
    });
  };
}

// Singleton (reused by the integrator at wire-up; pure constructor, no side effects at import).
export const diasporaTradeGraphProjection = new DiasporaTradeGraphProjectionService();
