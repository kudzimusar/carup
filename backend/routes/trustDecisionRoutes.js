/**
 * Unified Trust Decision routes — Workstream 10.
 *
 *   GET /api/vehicles/:vin/trust-decision          buyer-safe decision (any auth; private dims stripped)
 *   GET /api/vehicles/:vin/trust-decision/full     privileged full decision (admin/government/reviewer)
 *
 * The decision preserves separate dimensions and a transparent overall score. The public
 * route strips private dimensions (e.g. finance) and score-reason internals.
 */
import express from 'express';
import { authorizeRole } from '../middleware/authMiddleware.js';
import { getTrustDecision, toPublicDecision } from '../services/trustDecision/trustDecisionService.js';

const router = express.Router();

router.get('/api/vehicles/:vin/trust-decision', authorizeRole(), async (req, res, next) => {
  try {
    const decision = await getTrustDecision(req.params.vin);
    const role = req.userContext?.role;
    const privileged = ['admin', 'government', 'reviewer', 'owner', 'dealer'].includes(role);
    res.json({ decision: privileged ? decision : toPublicDecision(decision) });
  } catch (err) {
    next(err);
  }
});

router.get('/api/vehicles/:vin/trust-decision/full', authorizeRole(['admin', 'government', 'reviewer']), async (req, res, next) => {
  try {
    const decision = await getTrustDecision(req.params.vin);
    res.json({ decision });
  } catch (err) {
    next(err);
  }
});

export default router;
