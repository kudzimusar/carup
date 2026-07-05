/**
 * Trust-gated Escrow routes — Workstream F.
 *
 *   POST /api/vehicles/:vin/escrow                 request escrow (buyer); runs gates
 *   GET  /api/vehicles/:vin/escrow                 list sessions for a vehicle
 *   GET  /api/escrow/:id                            session + append-only history
 *   PATCH /api/escrow/:id/transition               advance the state machine
 *   POST /api/escrow/webhook                        sandbox payment webhook (signed)
 */
import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { requestEscrow, transitionEscrow, getSession, listSessionsForVin, ingestEscrowWebhook } from '../services/escrow/escrowTrustService.js';
import { getTrustDecision } from '../services/trustDecision/trustDecisionService.js';

const router = express.Router();

async function gateContextFor(vin, extra = {}) {
  try {
    const d = await getTrustDecision(vin);
    return {
      identity_status: d.dimensions.identity.status,
      fraud_block: d.dimensions.fraud_risk.status === 'high',
      publication_status: d.dimensions.publication_eligibility.value,
      ...extra,
    };
  } catch { return { identity_status: 'incomplete', ...extra }; }
}

router.post('/api/vehicles/:vin/escrow', authorizeRole(['buyer', 'owner', 'dealer', 'admin']), async (req, res, next) => {
  try {
    const ctx = await gateContextFor(req.params.vin, {
      participant_authorized: req.body?.participant_authorized !== false,
      required_documents_present: req.body?.required_documents_present !== false,
      listing_snapshot_changed: req.body?.listing_snapshot_changed === true,
      seller_suspended: req.body?.seller_suspended === true,
    });
    const session = await requestEscrow(req.params.vin, {
      buyerId: req.body?.buyer_id || req.userContext?.userId,
      sellerId: req.body?.seller_id,
      gateContext: ctx,
      idempotencyKey: req.headers['idempotency-key'] || req.body?.idempotency_key,
      listingSnapshotHash: req.body?.listing_snapshot_hash,
    }, { id: req.userContext?.userId, role: req.userContext?.role });
    res.status(201).json({ session });
  } catch (err) {
    if (/Vehicle not found/.test(err.message)) return res.status(404).json({ error: err.message });
    next(err);
  }
});

router.get('/api/vehicles/:vin/escrow', authorizeRole(['buyer', 'owner', 'dealer', 'admin', 'reviewer']), async (req, res, next) => {
  try { res.json({ sessions: await listSessionsForVin(req.params.vin) }); } catch (err) { next(err); }
});

router.get('/api/escrow/:id', authorizeRole(['buyer', 'owner', 'dealer', 'admin', 'reviewer']), async (req, res, next) => {
  try {
    const session = await getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'escrow session not found' });
    res.json({ session });
  } catch (err) { next(err); }
});

router.patch('/api/escrow/:id/transition', authorizeRole(['buyer', 'owner', 'dealer', 'admin', 'reviewer']), async (req, res, next) => {
  try {
    const session = await transitionEscrow(req.params.id, req.body?.to_status, {
      actor: { id: req.userContext?.userId, role: req.userContext?.role },
      reason: req.body?.reason,
      gateContext: req.body?.gate_context,
    });
    res.json({ session });
  } catch (err) {
    if (/not found/.test(err.message)) return res.status(404).json({ error: err.message });
    if (/invalid escrow transition|gate failed/.test(err.message)) return res.status(409).json({ error: err.message });
    next(err);
  }
});

router.post('/api/escrow/webhook', express.json({ verify: (req, _res, buf) => { req.rawBody = buf.toString(); } }), async (req, res, next) => {
  try {
    const result = await ingestEscrowWebhook({
      payloadString: req.rawBody || JSON.stringify(req.body || {}),
      signature: req.headers['x-signature'], timestamp: req.headers['x-timestamp'],
      idempotencyKey: req.headers['idempotency-key'], body: req.body,
    });
    res.status(result.applied ? 200 : (result.signature_valid ? 202 : 401)).json(result);
  } catch (err) { next(err); }
});

export default router;
