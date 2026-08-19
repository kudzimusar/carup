/**
 * Issue #164 Phase 6 — Marketplace transaction / escrow routes.
 *
 * Clients request actions. They never submit buyer/seller/economics/gate facts and they never choose
 * a canonical status string. Mutable eligibility is recomputed from the current listing, inquiry,
 * authenticated participant and canonical Trust before a forward action is accepted.
 */
import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import {
  getSession,
  listSessionsForVin,
  transitionEscrow,
  ingestEscrowWebhook,
} from '../services/escrow/escrowTrustService.js';
import {
  recomputeMarketplaceEscrowGateContext,
  requestMarketplaceEscrow,
  toPublicMarketplaceEscrowSession,
} from '../services/transaction/marketplaceTransactionAuthority.js';

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

router.post('/api/vehicles/:vin/escrow', authorizeRole(['buyer', 'owner', 'dealer', 'admin']), async (req, res, next) => {
  try {
    const session = await requestMarketplaceEscrow(req.params.vin, { actor: actorFrom(req) });
    res.status(201).json({ session });
  } catch (err) {
    next(err);
  }
});

router.get('/api/vehicles/:vin/escrow', authorizeRole(['buyer', 'owner', 'dealer', 'admin', 'reviewer']), async (req, res, next) => {
  try {
    const sessions = await listSessionsForVin(req.params.vin, actorFrom(req));
    res.json({ sessions: sessions.map(toPublicMarketplaceEscrowSession) });
  } catch (err) {
    next(err);
  }
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
  } catch (err) {
    return next(err);
  }
});

async function performParticipantAction(req, res, next, toStatus, { recheck = false } = {}) {
  try {
    const { actor, current } = await loadAuthorizedSession(req);
    if (!current) return res.status(404).json({ error: 'escrow session not found' });
    let gateContext;
    if (recheck) {
      const recomputed = await recomputeMarketplaceEscrowGateContext(current, { actor });
      gateContext = recomputed.gateContext;
    }
    const session = await transitionEscrow(req.params.id, toStatus, {
      actor,
      reason: typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 500) : null,
      gateContext,
    });
    return res.json({ session: toPublicMarketplaceEscrowSession(session) });
  } catch (err) {
    return next(err);
  }
}

// Browser action -> server-selected transition. No body field chooses a transaction state.
router.post('/api/escrow/:id/initiate', authorizeRole(['buyer', 'owner', 'dealer', 'admin']), (req, res, next) =>
  performParticipantAction(req, res, next, 'initiated', { recheck: true }));
router.post('/api/escrow/:id/cancel', authorizeRole(['buyer', 'owner', 'dealer', 'admin', 'reviewer']), (req, res, next) =>
  performParticipantAction(req, res, next, 'cancelled'));
router.post('/api/escrow/:id/dispute', authorizeRole(['buyer', 'owner', 'dealer', 'admin', 'reviewer']), (req, res, next) =>
  performParticipantAction(req, res, next, 'disputed'));

// Compatibility containment: the old generic endpoint let a browser assert `to_status` directly.
// Keep the URL reachable so stale clients get an explicit truth-preserving failure rather than
// falling through to another handler or interpreting a 404 as a transient network problem.
router.patch('/api/escrow/:id/transition', authorizeRole(['buyer', 'owner', 'dealer', 'admin', 'reviewer']), (_req, res) => {
  res.status(409).json({
    error: 'Direct escrow status transitions are disabled. Request a governed transaction action instead.',
    code: 'DIRECT_TRANSACTION_STATE_WRITE_DISABLED',
  });
});

router.post('/api/escrow/webhook', express.json({ verify: (req, _res, buf) => { req.rawBody = buf.toString(); } }), async (req, res, next) => {
  try {
    const result = await ingestEscrowWebhook({
      payloadString: req.rawBody || JSON.stringify(req.body || {}),
      signature: req.headers['x-signature'],
      timestamp: req.headers['x-timestamp'],
      idempotencyKey: req.headers['idempotency-key'],
      body: req.body,
    });
    return res.status(result.applied ? 200 : (result.signature_valid ? 202 : 401)).json(result);
  } catch (err) {
    return next(err);
  }
});

// Phase 6 containment of the pre-canonical SafePay write API. These handlers are mounted before the
// legacy inline server.js routes and terminate the request, so a stale web/mobile client cannot send
// seller, amount, currency or a status string into the old `safepay_escrows` authority.
router.post('/api/safepay/create', authorizeRole(), (_req, res) => {
  res.status(409).json({
    error: 'Direct SafePay creation is disabled. Start from the governed Marketplace transaction flow.',
    code: 'LEGACY_SAFEPAY_DIRECT_CREATE_DISABLED',
  });
});
router.post('/api/safepay/:id/update', authorizeRole(), (_req, res) => {
  res.status(409).json({
    error: 'Direct SafePay status updates are disabled. Request a governed transaction action instead.',
    code: 'LEGACY_SAFEPAY_STATE_WRITE_DISABLED',
  });
});

export default router;
