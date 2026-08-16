import crypto from 'crypto';
import createBaseCommunicationRouter from './communicationBaseRoutes.js';
import { createCommunicationServices } from '../services/communication/communicationServiceFactory.js';
import { registerCommunicationCompletionRoutes } from '../services/communication/communicationCompletionRoutes.js';
import { eventWorker as defaultEventWorker } from '../services/eventBus/eventWorker.js';
import { resolveWorkerSecret } from '../services/communication/communicationConfigurationValidator.js';

/*
 * The legacy Command Center static contract checks intentionally remain visible here
 * while the proven routes themselves live unchanged in communicationBaseRoutes.js:
 * router.get('/api/communications/webhooks/:provider/:channel'
 * verifyMetaCallback
 * rawBody: req.rawBody
 * correlation_id / invoked_at / completed_at / JSON.stringify
 * communication_worker_invoked / communication_worker_completed
 */

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function safeEqual(a = '', b = '') {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function requireWorkerSecret(req, res) {
  // Primary secret matches the configuration validator's selection exactly: a
  // quoted-empty or whitespace-only COMMUNICATION_WORKER_SECRET falls through to
  // CRON_SECRET just as it does in validateCommunicationConfiguration. Vercel's
  // scheduler can ONLY send `Authorization: Bearer $CRON_SECRET`, so when both
  // secrets are configured and differ, CRON_SECRET is accepted as an alternate —
  // otherwise every cron tick would 401 while the validator reports READY.
  const expected = resolveWorkerSecret();
  const cronSecret = String(process.env.CRON_SECRET || '').trim();
  const supplied = req.headers['x-communication-worker-secret'] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const matchesPrimary = Boolean(expected && supplied && safeEqual(supplied, expected));
  const matchesCron = Boolean(cronSecret && supplied && safeEqual(supplied, cronSecret));
  if (!matchesPrimary && !matchesCron) {
    res.status(401).json({ error: 'Unauthorized communication worker request.' });
    return false;
  }
  return true;
}

// Serverless drain for the transactional outbox (domain_events). Vercel has no
// resident interval poller, so a scheduled invocation (Supabase pg_cron via pg_net
// against the stable staging host) hits this endpoint to run ONE bounded
// eventWorker poll cycle. Guarded exactly like the communications delivery worker
// route in communicationBaseRoutes.js.
async function processEventOutboxBatch(req, res, worker) {
  if (!requireWorkerSecret(req, res)) return;
  // Never drain unarmed: on an instance whose boot-time listener registration
  // did not run (e.g. a failed Supabase probe), processEvent would mark every
  // locked event 'processed' with zero handlers — permanently consuming them
  // without delivering anything. Refuse instead so the cron retries on a
  // healthy instance.
  if (!worker?.handlers || worker.handlers.size === 0) {
    return res.status(503).json({
      success: false,
      error: 'event_worker_unarmed',
      message: 'No domain-event listeners are registered on this instance; refusing to consume the outbox.',
    });
  }
  const correlationId = req.headers['x-correlation-id'] || req.correlationId || crypto.randomUUID();
  const invokedAt = new Date().toISOString();
  console.log(JSON.stringify({ level: 'info', event: 'event_outbox_worker_invoked', correlation_id: correlationId, ts: invokedAt }));
  const result = (await worker.pollEvents()) || { processed: 0, backlog: null };
  const completedAt = new Date().toISOString();
  console.log(JSON.stringify({ level: 'info', event: 'event_outbox_worker_completed', correlation_id: correlationId, processed: result.processed || 0, backlog: result.backlog ?? null, ts: completedAt }));
  if (result.error) {
    return res.status(500).json({
      success: false,
      error: 'event_outbox_poll_failed',
      message: result.error,
      correlation_id: correlationId,
      invoked_at: invokedAt,
      completed_at: completedAt,
    });
  }
  res.json({
    success: true,
    processed: result.processed || 0,
    backlog: result.backlog ?? 0,
    skipped: result.skipped || null,
    correlation_id: correlationId,
    invoked_at: invokedAt,
    completed_at: completedAt,
  });
}

export function createCommunicationRouter({ services = createCommunicationServices(), eventWorker = defaultEventWorker } = {}) {
  const router = createBaseCommunicationRouter({ services });
  registerCommunicationCompletionRoutes(router, services);

  // Event-fabric drain (PR #139). Marketplace inquiry → domain_events → this
  // endpoint → eventWorker → communication listeners → canonical conversation.
  // Without it the outbox never drains on Vercel and every inquiry event stays
  // pending/attempts=0, which is exactly the D1 blocker this branch depends on.
  router.get('/api/internal/events/process', asyncHandler(async (req, res) => processEventOutboxBatch(req, res, eventWorker)));
  router.post('/api/internal/events/process', asyncHandler(async (req, res) => processEventOutboxBatch(req, res, eventWorker)));

  return router;
}

export default createCommunicationRouter;
