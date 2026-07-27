// Mounted by the diaspora router at /api/diaspora/scheduler
/**
 * Diaspora GTM — the scheduler's dispatch and operator surface (Issue #127, Phase 2E).
 *
 * TWO DOORS, DELIBERATELY DIFFERENT
 * ---------------------------------
 *   POST /internal/run   — the DISPATCHED door. Authenticated by a shared secret in a header,
 *                          compared in constant time, exactly as `communicationRoutes.js` already
 *                          does for its worker endpoint. It carries no user session because a cron
 *                          has none. It is the only route in this file that a machine calls.
 *
 *   POST /jobs/:jobKey/run,
 *   GET  /health, /runs  — the OPERATOR door. Platform-admin session auth. The manual run bypasses
 *                          the schedule, the environment flag and the database kill switch — because
 *                          the single most likely reason a human needs to run a job is that the
 *                          automatic path is the thing that is broken — but it still takes the lease,
 *                          so it can never collide with a scheduled run.
 *
 * WHY THE SECRET DOOR IS NOT ALSO A SESSION DOOR
 * ----------------------------------------------
 * Accepting either credential on one route means the weaker one defines the security of both. The
 * dispatch route therefore refuses a session, and the operator routes refuse the secret.
 *
 * FAIL CLOSED
 * -----------
 * With no secret configured, the dispatch route answers 503 and runs nothing. An unauthenticated
 * endpoint that runs billing jobs is a denial-of-service primitive at best; defaulting to "open
 * because unconfigured" is how that happens by accident.
 */
import express from 'express';
import crypto from 'crypto';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { ValidationError } from '../utils/errors.js';
import { isPlatformAdmin } from '../services/diaspora/diasporaAuthorization.js';
import {
  SCHEDULER_TRIGGERS,
  isSchedulerDispatchEnabled,
  schedulerDispatchSecret,
  assertSchedulerDispatchSafety,
} from '../constants/diaspora/diasporaSchedulerConstants.js';
import {
  runScheduledJob,
  runDueScheduledJobs,
  schedulerHealth,
  listSchedulerRuns,
  listSchedulerJobKeys,
} from '../services/diaspora/scheduler/diasporaSchedulerService.js';

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const operatorAuth = authorizeRole(['admin', 'platform_admin', 'super_admin']);

/** Length-checked before the comparison: timingSafeEqual throws on a length mismatch. */
function safeEqual(a = '', b = '') {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function requireDispatchSecret(req, res) {
  const expected = schedulerDispatchSecret();
  if (!expected) {
    // Not 401: the caller's credential is not the problem, the deployment is. Saying so is what lets
    // an operator diagnose it, and it still runs nothing.
    res.status(503).json({ error: 'Scheduler dispatch is not configured on this deployment.' });
    return false;
  }
  const supplied = req.headers['x-diaspora-scheduler-secret']
    || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!supplied || !safeEqual(supplied, expected)) {
    res.status(401).json({ error: 'Unauthorized scheduler dispatch request.' });
    return false;
  }
  return true;
}

/**
 * POST /internal/run — one dispatched tick.
 *
 * Body: `{ jobKeys?: string[] }`. Absent means "every registered job", and each one decides for itself
 * whether it is due. Answers 200 even when every job was skipped: a cron that gets a non-2xx starts
 * alerting, and "nothing was due" is the normal case, not an incident.
 */
router.post('/internal/run', asyncHandler(async (req, res) => {
  // ORDER MATTERS, and it is deliberate: the DISABLED answer comes BEFORE authentication.
  //
  // A cron should be wirable on a deployment before anyone decides to switch the jobs on, and it must
  // not go red in the meantime — a schedule that alerts every fifteen minutes is a schedule people
  // learn to ignore, which is worse than not having it. Answering 200/SCHEDULER_DISABLED without a
  // credential performs no work, opens no database connection and reads no state; the only thing it
  // discloses is that a feature flag is off, which is not worth a permanently failing cron.
  if (!isSchedulerDispatchEnabled()) {
    return res.status(200).json({
      dispatched: false,
      reason: 'SCHEDULER_DISABLED',
      hint: 'Set DIASPORA_SCHEDULER_ENABLED=true to allow scheduled execution on this deployment.',
    });
  }

  // Enabled but unsecured in production is a configuration bug, not a bad request. Raising here makes
  // it loud rather than leaving an operator wondering why a 503 keeps coming back from a cron they
  // believe is configured.
  assertSchedulerDispatchSafety();
  if (!requireDispatchSecret(req, res)) return;

  const requested = Array.isArray(req.body?.jobKeys) ? req.body.jobKeys.map(String) : null;
  const known = new Set(listSchedulerJobKeys());
  const unknown = (requested || []).filter((key) => !known.has(key));
  if (unknown.length) throw new ValidationError(`Unknown scheduler job(s): ${unknown.join(', ')}`);

  const summary = await runDueScheduledJobs({
    jobKeys: requested,
    trigger: SCHEDULER_TRIGGERS.SCHEDULED,
    correlationId: req.correlationId || req.headers['x-correlation-id'] || null,
  });
  return res.status(200).json({ dispatched: true, ...summary });
}));

// GET is accepted too: several cron providers (and uptime pingers used as a stopgap) can only issue
// GET. Same secret, same behaviour — the method is not a security boundary here.
router.get('/internal/run', asyncHandler(async (req, res) => {
  // Same ordering as POST, for the same reason.
  if (!isSchedulerDispatchEnabled()) {
    return res.status(200).json({ dispatched: false, reason: 'SCHEDULER_DISABLED' });
  }
  assertSchedulerDispatchSafety();
  if (!requireDispatchSecret(req, res)) return;
  const summary = await runDueScheduledJobs({
    trigger: SCHEDULER_TRIGGERS.SCHEDULED,
    correlationId: req.correlationId || req.headers['x-correlation-id'] || null,
  });
  return res.status(200).json({ dispatched: true, ...summary });
}));

/**
 * POST /jobs/:jobKey/run — operator-triggered execution.
 *
 * Bypasses the schedule and both kill switches; still takes the lease. `tenantId` scopes a spot check
 * to one tenant, which is what an operator investigating a single account actually wants.
 */
router.post('/jobs/:jobKey/run', operatorAuth, asyncHandler(async (req, res) => {
  if (!isPlatformAdmin(req.userContext)) {
    // Belt and braces behind authorizeRole: running billing jobs is a platform operation, and a role
    // list is easier to widen by accident than an explicit predicate.
    throw new ValidationError('Only a platform administrator may run a scheduled job manually');
  }
  const { jobKey } = req.params;
  if (!listSchedulerJobKeys().includes(jobKey)) throw new ValidationError(`Unknown scheduler job: ${jobKey}`);

  const result = await runScheduledJob({
    jobKey,
    trigger: SCHEDULER_TRIGGERS.OPERATOR,
    tenantId: req.body?.tenantId ? String(req.body.tenantId) : null,
    initiatedBy: req.userContext?.id || null,
    correlationId: req.correlationId || req.headers['x-correlation-id'] || null,
    limit: req.body?.limit ? Math.min(Number(req.body.limit) || 100, 500) : null,
  });
  return res.status(200).json({ data: result });
}));

/**
 * GET /health — per-job freshness.
 *
 * `stale` is the field an alert should watch. The most dangerous scheduler failure is not an error,
 * it is silence: a job that quietly stopped looks exactly like a job with nothing to do.
 */
router.get('/health', operatorAuth, asyncHandler(async (req, res) => {
  if (!isPlatformAdmin(req.userContext)) {
    throw new ValidationError('Only a platform administrator may read scheduler health');
  }
  return res.json({ data: await schedulerHealth() });
}));

/** GET /runs — recent run history. Counts and states only; the table holds no payloads by design. */
router.get('/runs', operatorAuth, asyncHandler(async (req, res) => {
  if (!isPlatformAdmin(req.userContext)) {
    throw new ValidationError('Only a platform administrator may read scheduler runs');
  }
  const runs = await listSchedulerRuns({
    jobKey: req.query.jobKey ? String(req.query.jobKey) : null,
    tenantId: req.query.tenantId ? String(req.query.tenantId) : null,
    limit: Math.min(Number(req.query.limit || 20), 100),
  });
  return res.json({ data: runs });
}));

export default router;
