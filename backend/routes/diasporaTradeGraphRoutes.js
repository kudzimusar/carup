// Mounted by integrator inside /api/diaspora
//
// Phase 10 — Trade Graph API routes (directive §60). This router is intentionally NOT mounted by this
// program: the integrator mounts it inside diasporaRoutes.js / server.js (e.g.
// `router.use('/graph', diasporaTradeGraphRoutes)`), exactly like the Phase 9 SafeTrade router.
//
// NON-NEGOTIABLES honored here (the graph itself is built only by the projection service from domain
// events — there is NO node/edge write path in this router; AI/frontend can never author edges):
//   - GATED: every route is inert (404) unless isTradeGraphEnabled() (DIASPORA_TRADE_GRAPH, default
//     OFF). Wiring this router has zero effect until the flag is set.
//   - SERVER-DERIVED AUTH: authorization uses the SAME authorizeRole middleware as diasporaRoutes.js
//     (req.userContext is built server-side from the session/user/tenant; the client x-stakeholder-role
//     can never escalate). tenant_id ALWAYS comes from req.userContext.tenantId for reads — never from
//     the client body/query — so a caller can only traverse their own tenant's graph (RLS is the second
//     line of defense in the DB; this is the first).
//   - READ-ONLY: the query/intelligence endpoints only SELECT (through the read-only query/intelligence
//     services). The ONLY mutating endpoint is POST /rebuild, which is admin-only, rate-limited and
//     auditable, and which itself only RE-DERIVES the graph from the authoritative outbox.
//   - REDACTION AT THE BOUNDARY: anything AI-facing (structuredContextForAi) and the intelligence
//     aggregates pass node data / edge metadata through the role-aware redaction policy before leaving
//     the service, so PII / payment refs / addresses / admin-only fields never reach a non-admin caller.
//
// Storage seam: the query/intelligence/projection services are written against a raw `pg`
// client (`pgClient.query(text, params)`) — exactly the client the eventWorker hands its subscribers
// — so the graph dedup/idempotency invariants are enforced by the same SQL in prod and in tests. This
// router lazily owns a small pg.Pool (mirroring eventWorker.js) and checks out a client per request;
// __setGraphPgPool() lets tests inject an in-memory pg mock with no real DB. Reads use a pooled client
// (released in finally); the rebuild runs inside a single BEGIN/COMMIT transaction.

import express from 'express';
import pg from 'pg';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { ValidationError, ForbiddenError, NotFoundError } from '../utils/errors.js';
import {
  isTradeGraphEnabled,
  TRADE_GRAPH_NODE_TYPE_SET,
} from '../constants/diaspora/diasporaTradeGraphConstants.js';
import { isPlatformAdmin } from '../services/diaspora/diasporaAuthorization.js';
import { diasporaTradeGraphService } from '../services/diaspora/tradegraph/diasporaTradeGraphService.js';
import { diasporaTradeIntelligence } from '../services/diaspora/tradegraph/diasporaTradeIntelligenceService.js';
import { diasporaTradeGraphProjection } from '../services/diaspora/tradegraph/diasporaTradeGraphProjectionService.js';

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Same role tokens diasporaRoutes.js uses. `auth` = any authenticated member (tenant-scoped reads);
// `adminAuth` = trusted PLATFORM admins only (rebuild). Server-derived; spoofed headers can never escalate
// (authMiddleware resolves the effective role from the DB session/user/tenant).
// GATE-T10 FIX 3: the rebuild middleware allowlist is platform-only — 'admin' (a tenant-admin role) is
// intentionally EXCLUDED so the PRIMARY authorization boundary is platform-admin/super-admin. The
// route-level isPlatformAdmin() check below is KEPT as defense-in-depth (a second, independent gate).
const auth = authorizeRole();
const adminAuth = authorizeRole(['platform_admin', 'super_admin']);

// ── pg pool seam (lazy; injectable for tests) ────────────────────────────────
// We never create a pool at import time (importing this router must have no side effects, and tests
// inject a mock pool). The pool is created on first real request and reused. Mirrors eventWorker.js.
let __pool = null;

/** Test seam: inject an in-memory pool ({ connect: () => ({ query, release }) }). */
export function __setGraphPgPool(pool) {
  __pool = pool;
}

function getPool() {
  if (__pool) return __pool;
  const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    // No DB configured → fail closed with a clear server error rather than silently mis-reading.
    throw new ValidationError('Trade Graph database connection is not configured (DATABASE_URL/SUPABASE_DB_URL)');
  }
  __pool = new pg.Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  return __pool;
}

/**
 * Run `fn(pgClient)` with a pooled raw-pg client for a READ-ONLY query, releasing it in finally.
 * No transaction is opened (the read services issue only SELECTs).
 */
async function withReadClient(fn) {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    if (typeof client.release === 'function') client.release();
  }
}

/**
 * Run `fn(pgClient)` inside a single BEGIN/COMMIT transaction (used by the rebuild path so the clear +
 * replay are atomic and either fully apply or fully roll back). ROLLBACK on any error.
 */
async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection may be dead; ignore */ }
    throw err;
  } finally {
    if (typeof client.release === 'function') client.release();
  }
}

/** A fixed request timestamp so query freshness/temporal filtering is deterministic per request. */
function requestNow(req) {
  return req.fixedTimestamp || new Date().toISOString();
}

/** The read-context the query/intelligence services expect (tenant_id is ALWAYS server-derived). */
function readContext(req, pgClient) {
  return {
    pgClient,
    now: requestNow(req),
    userContext: req.userContext,
    req,
  };
}

/** Server-derived tenant for reads. A member can only ever read their own tenant's graph. */
function tenantOf(req) {
  const tenantId = req.userContext?.tenantId || null;
  if (!tenantId) {
    throw new ForbiddenError('A tenant context is required (set x-tenant-id for a tenant you belong to)');
  }
  return tenantId;
}

/** Resolve a current node id by (tenant, node_type, entity_id) — the API addresses nodes by entity id. */
async function resolveNodeId(pgClient, tenantId, nodeType, entityId) {
  const res = await pgClient.query(
    `SELECT id FROM trade_graph_nodes
      WHERE tenant_id = $1 AND node_type = $2 AND entity_id = $3
        AND is_current IS TRUE AND deleted_at IS NULL
      LIMIT 1`,
    [tenantId, nodeType, String(entityId)],
  );
  return (res.rows && res.rows[0] && res.rows[0].id) || null;
}

function normalizeNodeType(type) {
  const upper = String(type || '').toUpperCase();
  if (!TRADE_GRAPH_NODE_TYPE_SET.has(upper)) {
    throw new ValidationError(`Unknown node type: ${type}`);
  }
  return upper;
}

// Master gate: when DIASPORA_TRADE_GRAPH is off, the entire surface is inert. 404 (not 403) keeps the
// feature undiscoverable while disabled, matching the SafeTrade gate. Scoped so that, mounted at the
// diaspora root, sibling routes fall through instead of being 404'd by this router.
router.use((req, res, next) => {
  if (!isTradeGraphEnabled()) {
    return res.status(404).json({ error: 'Trade Graph is not enabled' });
  }
  return next();
});

// ─────────────────────────────────────────────────────────────────────────────
// ENTITY & NEIGHBORHOOD TRAVERSAL
// ─────────────────────────────────────────────────────────────────────────────

// GET /entities/:type/:id — a single graph node (addressed by entity id) + its 1-hop neighborhood.
router.get('/entities/:type/:id', auth, asyncHandler(async (req, res) => {
  const tenantId = tenantOf(req);
  const nodeType = normalizeNodeType(req.params.type);
  const result = await withReadClient(async (pgClient) => {
    const nodeId = await resolveNodeId(pgClient, tenantId, nodeType, req.params.id);
    if (!nodeId) throw new NotFoundError(`Entity not found: ${nodeType}/${req.params.id}`);
    // depth 1 / no extra confidence threshold → the node + its immediate, explainable neighborhood.
    return diasporaTradeGraphService.queryNeighborhood(tenantId, nodeId, readContext(req, pgClient), {
      maxDepth: 1,
      minConfidence: 0,
    });
  });
  res.json(result);
}));

// GET /entities/:type/:id/neighbors — N-hop neighbors with reasons + source references.
router.get('/entities/:type/:id/neighbors', auth, asyncHandler(async (req, res) => {
  const tenantId = tenantOf(req);
  const nodeType = normalizeNodeType(req.params.type);
  const result = await withReadClient(async (pgClient) => {
    const nodeId = await resolveNodeId(pgClient, tenantId, nodeType, req.params.id);
    if (!nodeId) throw new NotFoundError(`Entity not found: ${nodeType}/${req.params.id}`);
    return diasporaTradeGraphService.queryNeighborhood(tenantId, nodeId, readContext(req, pgClient), {
      maxDepth: req.query.maxDepth,
      minConfidence: req.query.minConfidence,
      includeIncoming: req.query.direction !== 'out',
      limit: req.query.limit,
    });
  });
  res.json(result);
}));

// ─────────────────────────────────────────────────────────────────────────────
// ORDER PATH / BLOCKERS / MATCH EXPLANATION
// ─────────────────────────────────────────────────────────────────────────────

// GET /orders/:id/path — deterministic forward transaction path (order → quote → … → target).
router.get('/orders/:id/path', auth, asyncHandler(async (req, res) => {
  const tenantId = tenantOf(req);
  const result = await withReadClient(async (pgClient) => {
    const orderNodeId = await resolveNodeId(pgClient, tenantId, 'BUYER_ORDER', req.params.id);
    if (!orderNodeId) throw new NotFoundError(`Order not found: ${req.params.id}`);
    return diasporaTradeGraphService.queryTransactionPath(tenantId, orderNodeId, readContext(req, pgClient), {
      targetNodeType: req.query.target ? normalizeNodeType(req.query.target) : undefined,
      maxSteps: req.query.maxSteps,
    });
  });
  res.json(result);
}));

// GET /orders/:id/blockers — what blocks this order / SafeTrade release, ranked by severity.
router.get('/orders/:id/blockers', auth, asyncHandler(async (req, res) => {
  const tenantId = tenantOf(req);
  const result = await withReadClient(async (pgClient) => {
    const orderNodeId = await resolveNodeId(pgClient, tenantId, 'BUYER_ORDER', req.params.id);
    if (!orderNodeId) throw new NotFoundError(`Order not found: ${req.params.id}`);
    return diasporaTradeGraphService.generateBlockerSummary(tenantId, orderNodeId, readContext(req, pgClient));
  });
  res.json(result);
}));

// GET /orders/:id/match-explanation?sellerId=… — why a seller was matched to this order (explainable).
router.get('/orders/:id/match-explanation', auth, asyncHandler(async (req, res) => {
  const tenantId = tenantOf(req);
  const sellerId = req.query.sellerId;
  if (sellerId == null || String(sellerId) === '') {
    throw new ValidationError('match-explanation requires a sellerId query parameter');
  }
  const result = await withReadClient(async (pgClient) => {
    const orderNodeId = await resolveNodeId(pgClient, tenantId, 'BUYER_ORDER', req.params.id);
    if (!orderNodeId) throw new NotFoundError(`Order not found: ${req.params.id}`);
    return diasporaTradeGraphService.generateMatchExplanation(tenantId, orderNodeId, sellerId, readContext(req, pgClient));
  });
  res.json(result);
}));

// ─────────────────────────────────────────────────────────────────────────────
// INTELLIGENCE (redaction applied inside the service before anything leaves)
// ─────────────────────────────────────────────────────────────────────────────

// GET /containers/opportunities — available containers ↔ orders needing shipment (geo + capacity).
router.get('/containers/opportunities', auth, asyncHandler(async (req, res) => {
  const tenantId = tenantOf(req);
  const result = await withReadClient((pgClient) =>
    diasporaTradeIntelligence.containerOpportunities(tenantId, readContext(req, pgClient), {
      originCountry: req.query.originCountry,
      destinationCountry: req.query.destinationCountry,
      containerType: req.query.containerType,
      capacityMin: req.query.capacityMin,
    }));
  res.json(result);
}));

// GET /stock/demand-signals — unmatched buyer orders aggregated by country + product type.
router.get('/stock/demand-signals', auth, asyncHandler(async (req, res) => {
  const tenantId = tenantOf(req);
  const result = await withReadClient((pgClient) =>
    diasporaTradeIntelligence.demandSignals(tenantId, readContext(req, pgClient), {
      country: req.query.country,
      productType: req.query.productType,
      minUnmatchedCount: req.query.minUnmatchedCount,
      confidenceThreshold: req.query.confidenceThreshold,
    }));
  res.json(result);
}));

// GET /risk/exposure — per-order blocker aggregates + risk level.
router.get('/risk/exposure', auth, asyncHandler(async (req, res) => {
  const tenantId = tenantOf(req);
  const result = await withReadClient((pgClient) =>
    diasporaTradeIntelligence.riskExposure(tenantId, readContext(req, pgClient), {
      minRiskLevel: req.query.minRiskLevel,
      confidenceThreshold: req.query.confidenceThreshold,
    }));
  res.json(result);
}));

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN: rebuild (admin-only, rate-limited, auditable)
// ─────────────────────────────────────────────────────────────────────────────

// POST /rebuild — re-derive a tenant's graph from the authoritative outbox. Admin-only; the service
// enforces rate-limiting (RUNNING / RATE_LIMITED via a service-role RPC) and writes a CRITICAL audit.
// The target tenant defaults to the admin's own tenant; a platform admin may target another tenant.
router.post('/rebuild', adminAuth, asyncHandler(async (req, res) => {
  const userContext = req.userContext;
  // Defense in depth: the service is admin-only too, but reject here with a clear 403 before touching pg.
  if (!isPlatformAdmin(userContext)) {
    throw new ForbiddenError('Trade Graph rebuild is restricted to platform administrators');
  }
  const tenantId = req.body?.tenantId || userContext.tenantId || null;
  if (!tenantId) {
    throw new ValidationError('rebuild requires a tenantId (body) or an x-tenant-id context');
  }

  const result = await withTransaction((pgClient) =>
    diasporaTradeGraphProjection.rebuildTenantGraph(tenantId, {
      pgClient,
      now: requestNow(req),
      actor: { id: userContext.id, isPlatformAdmin: true },
      reason: req.body?.reason || 'admin_manual_rebuild',
      minIntervalSeconds: req.body?.minIntervalSeconds,
      req,
    }));

  res.status(result.status === 'RATE_LIMITED' ? 429 : 200).json(result);
}));

export default router;
