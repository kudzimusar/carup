/**
 * Issue #164 Phase 6 — Marketplace transaction / escrow routes.
 * Clients request actions; they never submit canonical transaction/payment states.
 */
import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import {
  getSession,
  listSessionsForVin,
  listSessionsForActor,
  transitionEscrow,
  ingestEscrowWebhook,
} from '../services/escrow/escrowTrustService.js';
import { reserveVehicle } from '../services/reservation/reservationService.js';
import {
  recomputeMarketplaceEscrowGateContext,
  requestMarketplaceEscrow,
  toPublicMarketplaceEscrowSession,
} from '../services/transaction/marketplaceTransactionAuthority.js';
import {
  evaluateMarketplaceDepositEligibility,
  createMarketplacePaymentIntent,
  reconcileMarketplacePayment,
  releaseMarketplacePayment,
  refundMarketplacePayment,
} from '../services/transaction/marketplacePaymentService.js';
import { cancelMarketplacePayment } from '../services/transaction/marketplacePaymentCancellationService.js';

const router = express.Router();

function actorFrom(req) {
  return {
    id: req.userContext?.id || req.userContext?.userId || null,
    role: req.userContext?.effectiveRole || req.userContext?.role || null,
  };
}

async function loadAuthorizedSession(req) {
  const actor = actorFrom(req);
  const current = await getSession(req.params.id, actor);
  return { actor, current };
}

/**
 * Compatibility URL, canonical authority.
 *
 * Older web builds send `{ duration: 7 }`; this handler deliberately never reads req.body. The
 * reservation duration, seller, inquiry, Trust eligibility and transaction economics are all
 * resolved by reservationService + the atomic PostgreSQL RPC. Because escrowTrustRouter is mounted
 * before server.js's historical inline handler, this route terminates the request first and the
 * authority-shaped legacy payload cannot reach a writer.
 */
router.post('/api/vehicles/:vin/reserve', authorizeRole(['buyer', 'owner', 'dealer', 'admin']), async (req, res, next) => {
  try {
    const result = await reserveVehicle(req.params.vin, actorFrom(req).id);
    return res.status(result.idempotentReplay ? 200 : 201).json(result);
  } catch (err) { return next(err); }
});

router.post('/api/vehicles/:vin/escrow', authorizeRole(['buyer', 'owner', 'dealer', 'admin']), async (req, res, next) => {
  try {
    const session = await requestMarketplaceEscrow(req.params.vin, { actor: actorFrom(req) });
    res.status(201).json({ session });
  } catch (err) { next(err); }
});

router.get('/api/vehicles/:vin/escrow', authorizeRole(['buyer', 'owner', 'dealer', 'admin', 'reviewer']), async (req, res, next) => {
  try {
    const sessions = await listSessionsForVin(req.params.vin, actorFrom(req));
    res.json({ sessions: sessions.map(toPublicMarketplaceEscrowSession) });
  } catch (err) { next(err); }
});

router.get('/api/escrow', authorizeRole(), async (req, res, next) => {
  try {
    const sessions = await listSessionsForActor(actorFrom(req));
    return res.json({ sessions: sessions.map(toPublicMarketplaceEscrowSession) });
  } catch (err) { return next(err); }
});

router.get('/api/escrow/:id', authorizeRole(['buyer', 'owner', 'dealer', 'admin', 'reviewer']), async (req, res, next) => {
  try {
    const session = await getSession(req.params.id, actorFrom(req));
    if (!session) return res.status(404).json({ error: 'escrow session not found' });
    const publicSession = toPublicMarketplaceEscrowSession(session);
    publicSession.events = (session.events || []).map((event) => ({
      from_status: event.from_status || null,
      to_status: event.to_status || null,
      reason: event.reason || null,
      created_at: event.created_at || null,
    }));
    return res.json({ session: publicSession });
  } catch (err) { return next(err); }
});

async function performParticipantAction(req, res, next, toStatus, {
  recheck = false,
  requireActorParticipant = true,
} = {}) {
  try {
    const { actor, current } = await loadAuthorizedSession(req);
    if (!current) return res.status(404).json({ error: 'escrow session not found' });
    let gateContext;
    if (recheck) {
      const recomputed = await recomputeMarketplaceEscrowGateContext(current, {
        actor,
        requireActorParticipant,
      });
      gateContext = recomputed.gateContext;
    }
    const session = await transitionEscrow(req.params.id, toStatus, {
      actor,
      reason: typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 500) : null,
      gateContext,
    });
    return res.json({ session: toPublicMarketplaceEscrowSession(session) });
  } catch (err) { return next(err); }
}

router.post('/api/escrow/:id/initiate', authorizeRole(['buyer', 'owner', 'dealer', 'admin']), (req, res, next) =>
  performParticipantAction(req, res, next, 'initiated', { recheck: true }));

/**
 * Cancellation has two authorities depending on whether provider state exists:
 * - pre-payment: CarUp can atomically cancel the transaction/reservation itself;
 * - provider-linked: CarUp asks the already-bound PaymentProvider to cancel, then reconciles the
 *   provider-confirmed `cancelled` result. A browser never submits `to_status`, provider, or intent.
 */
router.post('/api/escrow/:id/cancel', authorizeRole(['buyer', 'owner', 'dealer', 'admin', 'reviewer']), async (req, res, next) => {
  try {
    const { actor, current } = await loadAuthorizedSession(req);
    if (!current) return res.status(404).json({ error: 'escrow session not found' });
    if (current.payment_intent_id) {
      const result = await cancelMarketplacePayment(req.params.id, { actor });
      const refreshed = await getSession(req.params.id, actor);
      return res.json({
        session: refreshed ? toPublicMarketplaceEscrowSession(refreshed) : null,
        payment: result,
      });
    }
    return performParticipantAction(req, res, next, 'cancelled');
  } catch (err) { return next(err); }
});

router.post('/api/escrow/:id/dispute', authorizeRole(['buyer', 'owner', 'dealer', 'admin', 'reviewer']), (req, res, next) =>
  performParticipantAction(req, res, next, 'disputed'));
router.post('/api/escrow/:id/inspection/start', authorizeRole(['admin', 'reviewer']), (req, res, next) =>
  performParticipantAction(req, res, next, 'inspection_pending'));
router.post('/api/escrow/:id/release/approve', authorizeRole(['admin', 'reviewer']), (req, res, next) =>
  performParticipantAction(req, res, next, 'release_approved', {
    recheck: true,
    requireActorParticipant: false,
  }));

router.post('/api/escrow/:id/deposit/eligibility', authorizeRole(['buyer', 'owner', 'dealer', 'admin']), async (req, res, next) => {
  try { return res.json(await evaluateMarketplaceDepositEligibility(req.params.id, { actor: actorFrom(req) })); }
  catch (err) { return next(err); }
});
router.post('/api/escrow/:id/payment-intent', authorizeRole(['buyer', 'owner', 'dealer', 'admin']), async (req, res, next) => {
  try {
    const result = await createMarketplacePaymentIntent(req.params.id, { actor: actorFrom(req) });
    return res.status(result.idempotentReplay ? 200 : 201).json(result);
  } catch (err) { return next(err); }
});
router.post('/api/escrow/:id/payment/reconcile', authorizeRole(['buyer', 'owner', 'dealer', 'admin', 'reviewer']), async (req, res, next) => {
  try { return res.json(await reconcileMarketplacePayment(req.params.id, { actor: actorFrom(req) })); }
  catch (err) { return next(err); }
});
router.post('/api/escrow/:id/release', authorizeRole(['admin', 'reviewer']), async (req, res, next) => {
  try { return res.json(await releaseMarketplacePayment(req.params.id, { actor: actorFrom(req) })); }
  catch (err) { return next(err); }
});
router.post('/api/escrow/:id/refund', authorizeRole(['admin', 'reviewer']), async (req, res, next) => {
  try { return res.json(await refundMarketplacePayment(req.params.id, { actor: actorFrom(req) })); }
  catch (err) { return next(err); }
});

router.patch('/api/escrow/:id/transition', authorizeRole(['buyer', 'owner', 'dealer', 'admin', 'reviewer']), (_req, res) => {
  res.status(409).json({ error: 'Direct escrow status transitions are disabled. Request a governed transaction action instead.', code: 'DIRECT_TRANSACTION_STATE_WRITE_DISABLED' });
});
router.post('/api/escrow/webhook', express.json({ verify: (req, _res, buf) => { req.rawBody = buf.toString(); } }), async (_req, res) => {
  const result = await ingestEscrowWebhook();
  return res.status(410).json(result);
});

// Compatibility adapter: stale web clients may still POST seller/amount/currency here. Ignore every
// one of those fields and resolve the transaction/payment entirely from VIN + authenticated actor.
// This preserves the old URL without preserving its authority.
router.post('/api/safepay/create', authorizeRole(), async (req, res, next) => {
  try {
    const transaction = await requestMarketplaceEscrow(req.body?.vin, { actor: actorFrom(req) });
    const payment = await createMarketplacePaymentIntent(transaction.transaction_intent_id, { actor: actorFrom(req) });
    return res.status(payment.idempotentReplay ? 200 : 201).json(payment);
  } catch (err) { return next(err); }
});
router.post('/api/safepay/:id/update', authorizeRole(), (_req, res) => {
  res.status(409).json({ error: 'Direct SafePay status updates are disabled. Request a governed transaction action instead.', code: 'LEGACY_SAFEPAY_STATE_WRITE_DISABLED' });
});

export default router;
