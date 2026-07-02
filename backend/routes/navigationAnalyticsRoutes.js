/**
 * Navigation Analytics API (Milestone F).
 *
 *  - POST /api/analytics/navigation  (PUBLIC but bounded): privacy-minimized
 *    ingestion. Rate-limited per IP, body-size capped, batch-size capped,
 *    schema-version gated. Responds FAST (202) and NEVER throws to the client —
 *    analytics must never block navigation. No PII is ever persisted; the
 *    service allowlist-projects every event and derives the role bucket from the
 *    TRUSTED session (client-sent role is ignored).
 *  - GET  /api/admin/analytics/navigation  (admin only): grouped discovery /
 *    funnel aggregates behind authorizeRole(['admin']). Never dumps raw events.
 */
import express from 'express';
import { rateLimiter } from '../middleware/securityMiddleware.js';
import { logAuditEvent } from '../services/auditLogger.js';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { supabase } from '../db/supabase.js';
import {
  ingestBatch,
  getNavigationAggregates,
  MAX_BODY_BYTES,
} from '../services/navigationAnalytics/navigationAnalyticsService.js';

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Dedicated, generous-but-bounded per-IP limiter for high-frequency telemetry.
const analyticsRateLimiter = rateLimiter({ max: 120, windowMs: 60 * 1000, isSensitive: false });

// Small dedicated JSON parser so a giant analytics body is rejected BEFORE it
// reaches the global 15mb parser / the handler. The global parser already ran
// in server.js, so we additionally guard on the parsed size below.
const analyticsBodyParser = express.json({ limit: MAX_BODY_BYTES });

/**
 * POST /api/analytics/navigation — public, bounded ingestion.
 * Always resolves to a fast 202 with a counts-only summary; storage failure does
 * NOT surface as an error (nav is never blocked).
 */
router.post(
  '/api/analytics/navigation',
  analyticsRateLimiter,
  analyticsBodyParser,
  asyncHandler(async (req, res) => {
    // Manual body-size guard (defence in depth — the parser limit may be bypassed
    // when an upstream parser already populated req.body).
    const approxBytes = req.headers['content-length']
      ? Number(req.headers['content-length'])
      : safeJsonBytes(req.body);
    if (Number.isFinite(approxBytes) && approxBytes > MAX_BODY_BYTES) {
      return res.status(413).json({ ok: false, error: 'payload_too_large' });
    }

    let summary;
    try {
      summary = await ingestBatch(req.body, { req });
    } catch {
      // Absolute backstop: never let analytics throw to the client.
      return res.status(202).json({ ok: true, accepted: 0 });
    }

    if (summary.schemaVersionRejected) {
      return res.status(400).json({ ok: false, error: 'unsupported_schema_version' });
    }

    // Counts-only audit summary (no payloads, no identity). Best-effort.
    if (summary.accepted > 0) {
      logAuditEvent(supabase, {
        req,
        event_type: 'NAVIGATION_ANALYTICS_BATCH_INGESTED',
        metadata: {
          accepted: summary.accepted,
          dropped: summary.dropped,
          duplicates: summary.duplicates,
          stored: summary.stored,
          truncated: summary.tooLarge || false,
        },
      }).catch(() => {});
    }

    return res.status(202).json({
      ok: true,
      accepted: summary.accepted,
      dropped: summary.dropped,
      duplicates: summary.duplicates,
      truncated: summary.tooLarge || false,
    });
  }),
);

/**
 * GET /api/admin/analytics/navigation — admin-only grouped aggregates.
 * Query: from, to (ISO), feature (optional feature id filter).
 */
router.get(
  '/api/admin/analytics/navigation',
  authorizeRole(['admin']),
  asyncHandler(async (req, res) => {
    const result = await getNavigationAggregates({
      from: typeof req.query.from === 'string' ? req.query.from : undefined,
      to: typeof req.query.to === 'string' ? req.query.to : undefined,
      featureId: typeof req.query.feature === 'string' && req.query.feature ? req.query.feature : undefined,
    });
    if (!result.ok) {
      return res.status(503).json({ ok: false, error: result.error, range: result.range, featureId: result.featureId });
    }
    return res.json(result);
  }),
);

function safeJsonBytes(body) {
  try {
    return Buffer.byteLength(JSON.stringify(body || {}), 'utf8');
  } catch {
    return 0;
  }
}

export default router;
