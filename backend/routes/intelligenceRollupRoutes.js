/**
 * CarUp Intelligence 1.0 — rollup execution endpoint (I4 wiring).
 *
 * Without this, `rollupDay` had no caller anywhere in the repository: the rollup
 * tables would have stayed empty forever and every projection would have reported
 * `unavailable` in perpetuity. A correct implementation nothing can invoke is the
 * dead-path failure this codebase has been bitten by before.
 *
 * Two ways in, both privileged:
 *   - the scheduler/worker secret, for an unattended nightly run;
 *   - a platform admin, for a manual backfill or a re-run after a fix.
 *
 * Recomputing a day is idempotent by construction (the rollup rebuilds the day and
 * upserts on its natural key), so re-running is always safe.
 */
import express from 'express';
import crypto from 'crypto';
import { authorizeRole, optionalAuth } from '../middleware/authMiddleware.js';
import { supabase } from '../db/supabase.js';
import { rollupDay, rollupFreshness } from '../services/intelligence/rollupService.js';

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** A backfill is bounded so one call cannot rebuild years of history synchronously. */
const MAX_BACKFILL_DAYS = 31;

function workerAuthorized(req) {
  const secret = process.env.INTELLIGENCE_WORKER_SECRET;
  const provided = req?.headers?.['x-carup-worker-secret'];
  if (!secret || typeof provided !== 'string' || provided.length === 0) return false;
  try {
    const a = Buffer.from(provided);
    const b = Buffer.from(secret);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

const PLATFORM_ADMIN_ROLES = new Set(['admin', 'platform_admin', 'super_admin']);

/**
 * An administrator may run the rollup, but only on a PROVEN identity.
 *
 * `optionalAuth` will populate `userContext` from the spoofable `x-user-id`
 * fallback wherever that fallback is enabled, marking it `identityAsserted`. A
 * merely asserted identity must not be able to trigger a platform-wide recompute,
 * so this gate requires the identity to have been proven by a real session — which
 * is exactly what that marker exists to let a consumer check.
 */
function adminAuthorized(req) {
  const ctx = req?.userContext;
  if (!ctx || ctx.identityAsserted === true) return false;
  const role = ctx.platformRole || ctx.role || null;
  return PLATFORM_ADMIN_ROLES.has(String(role));
}

/** Yesterday in UTC — the most recent day that is actually complete. */
function defaultMetricDate() {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * POST /api/internal/intelligence/rollup
 *
 * Body: { date?: 'YYYY-MM-DD', days?: n } — defaults to yesterday, one day.
 * Runs the rollup for each requested day and reports per-day outcomes. A day that
 * fails is reported as failed rather than skipped silently, so a partial backfill
 * is visible.
 */
router.post(
  '/api/internal/intelligence/rollup',
  // Without this the admin path below is dead by construction: nothing else on
  // this route populates `req.userContext`, so `adminAuthorized` could never be
  // true and the endpoint was reachable ONLY with the worker secret — which is
  // unset in every deployed environment, making the route a guaranteed 403.
  // `optionalAuth` never blocks; the two authorization checks still decide.
  optionalAuth(),
  asyncHandler(async (req, res) => {
    if (!workerAuthorized(req) && !adminAuthorized(req)) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }

    const requestedDate = typeof req.body?.date === 'string' ? req.body.date.trim() : null;
    if (requestedDate && !DATE_RE.test(requestedDate)) {
      return res.status(400).json({ ok: false, error: 'invalid_date', message: 'date must be YYYY-MM-DD' });
    }
    const days = Math.min(Math.max(Number(req.body?.days) || 1, 1), MAX_BACKFILL_DAYS);
    const anchor = requestedDate || defaultMetricDate();

    const results = [];
    for (let offset = 0; offset < days; offset += 1) {
      const date = new Date(new Date(`${anchor}T00:00:00.000Z`).getTime() - offset * 24 * 60 * 60 * 1000)
        .toISOString().slice(0, 10);
      // Sequential rather than parallel: each day scans the ledger, and a backfill
      // must not be able to saturate the database that live traffic depends on.
      results.push(await rollupDay(date, { client: supabase }));
    }

    const failed = results.filter((result) => !result.ok);
    return res.status(failed.length ? 207 : 200).json({
      ok: failed.length === 0,
      days_requested: days,
      days_succeeded: results.length - failed.length,
      days_failed: failed.length,
      results,
    });
  }),
);

/** GET /api/admin/intelligence/rollup-status — is a day's rollup fresh? */
router.get(
  '/api/admin/intelligence/rollup-status',
  authorizeRole(['admin']),
  asyncHandler(async (req, res) => {
    const date = typeof req.query.date === 'string' && DATE_RE.test(req.query.date)
      ? req.query.date
      : defaultMetricDate();
    const freshness = await rollupFreshness(date, { client: supabase });
    return res.json({ ok: true, metric_date: date, ...freshness });
  }),
);

export default router;
