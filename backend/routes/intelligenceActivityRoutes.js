/**
 * CarUp Intelligence 1.0 — activity ledger ingestion API (I2).
 *
 *  - POST /api/intelligence/activity  (public but bounded): the client half of the
 *    canonical activity ledger. Rate-limited per IP, body-size capped, batch-size
 *    capped, schema-version gated. Responds 202 with COUNTS ONLY and never throws:
 *    analytics must never block a shopper.
 *
 *  - GET /api/admin/intelligence/ingestion-health (admin): ingestion counters, so
 *    a ledger that silently stops counting is visible rather than mistaken for a
 *    quiet market.
 *
 * A client may submit only the client-emittable subset of the taxonomy. Saves,
 * inquiries, reservations, price changes and lifecycle transitions are written by
 * the server beside their authoritative domain write — a caller cannot post them
 * here, because an observation of a business fact that never happened is exactly
 * the failure this programme exists to prevent.
 */
import express from 'express';
import { rateLimiter } from '../middleware/securityMiddleware.js';
import { authorizeRole, optionalAuth } from '../middleware/authMiddleware.js';
import { supabase } from '../db/supabase.js';
import {
  ingestClientBatch,
  MAX_BODY_BYTES,
} from '../services/intelligence/activityLedgerService.js';

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// High-frequency telemetry: generous but bounded, per IP.
const activityRateLimiter = rateLimiter({ max: 240, windowMs: 60 * 1000, isSensitive: false });
const activityBodyParser = express.json({ limit: MAX_BODY_BYTES });

function safeJsonBytes(value) {
  try { return Buffer.byteLength(JSON.stringify(value ?? '')); } catch { return 0; }
}

/**
 * POST /api/intelligence/activity
 *
 * `optionalAuth` is deliberate: an anonymous shopper is a first-class actor in the
 * intelligence model. When a session IS present the service derives identity from
 * it; the request body can never supply identity or tenant scope.
 */
router.post(
  '/api/intelligence/activity',
  activityRateLimiter,
  activityBodyParser,
  // optionalAuth is a FACTORY. Passed uncalled, Express invokes it as the
  // middleware itself; it ignores (req,res,next), returns a function, and next()
  // is never called — every ingestion POST hangs until socket timeout.
  optionalAuth(),
  asyncHandler(async (req, res) => {
    const declaredBytes = req.headers['content-length']
      ? Number(req.headers['content-length'])
      : safeJsonBytes(req.body);
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_BODY_BYTES) {
      return res.status(413).json({ ok: false, error: 'payload_too_large' });
    }

    let summary;
    try {
      summary = await ingestClientBatch(req.body, { req, client: supabase });
    } catch {
      // Ingestion is best-effort by contract. A thrown error here would turn a
      // telemetry problem into a user-visible failure.
      summary = { received: 0, accepted: 0, rejected: 0, duplicates: 0, flagged: 0, storage_failures: 1 };
    }

    return res.status(202).json({
      ok: true,
      received: summary.received,
      accepted: summary.accepted,
      rejected: summary.rejected,
      duplicates: summary.duplicates,
    });
  }),
);

/**
 * GET /api/admin/intelligence/ingestion-health — admin-only ingestion counters.
 *
 * Returns `available: false` rather than zeros when the counters cannot be read:
 * "no data" and "we could not look" are different statements, and only one of them
 * means the market is quiet.
 */
router.get(
  '/api/admin/intelligence/ingestion-health',
  authorizeRole(['admin']),
  asyncHandler(async (req, res) => {
    const hours = Math.min(Math.max(Number(req.query.hours) || 24, 1), 168);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    try {
      const { data, error } = await supabase
        .from('intelligence_ingestion_stats')
        .select('*')
        .gte('window_start', since)
        .order('window_start', { ascending: false });
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      const totals = rows.reduce((acc, row) => ({
        events_received: acc.events_received + (row.events_received || 0),
        events_accepted: acc.events_accepted + (row.events_accepted || 0),
        events_rejected: acc.events_rejected + (row.events_rejected || 0),
        events_duplicate: acc.events_duplicate + (row.events_duplicate || 0),
        events_flagged: acc.events_flagged + (row.events_flagged || 0),
        opened_without_context: acc.opened_without_context + (row.opened_without_context || 0),
        storage_failures: acc.storage_failures + (row.storage_failures || 0),
      }), {
        events_received: 0, events_accepted: 0, events_rejected: 0, events_duplicate: 0,
        events_flagged: 0, opened_without_context: 0, storage_failures: 0,
      });
      return res.json({
        ok: true, available: true, window_hours: hours, totals, windows: rows,
      });
    } catch (error) {
      return res.status(200).json({
        ok: true,
        available: false,
        reason: 'ingestion_counters_unavailable',
        message: 'Ingestion counters could not be read. These are NOT zero.',
        detail: error?.message,
      });
    }
  }),
);

export default router;
