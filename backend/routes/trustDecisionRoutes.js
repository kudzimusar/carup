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
import { RECOMPUTE, getCanonicalTrust, toPublicTrust } from '../services/trustDecision/canonicalTrustService.js';

const router = express.Router();

/**
 * The buyer-safe decision. Vehicle Detail reads this route, so its published trust figure must be
 * the SAME materialized position the passport and the marketplace publish — not a live recompute.
 * Recomputing here is what made one VIN yield two public answers: this route reported an evaluated
 * score while the cache-only surfaces reported none, at the same instant.
 *
 * `trust` is therefore the canonical projection (cache-only, versioned) and is the ONLY figure a
 * surface may render. The `decision` object stays for its dimensions and reason codes — the
 * explanation of a position, not a second statement of it.
 */
router.get('/api/vehicles/:vin/trust-decision', authorizeRole(), async (req, res, next) => {
  try {
    const { vin } = req.params;
    const [decision, canonical] = await Promise.all([
      getTrustDecision(vin),
      getCanonicalTrust(vin, { recompute: RECOMPUTE.NEVER }),
    ]);
    const role = req.userContext?.role;
    const privileged = ['admin', 'government', 'reviewer', 'owner', 'dealer'].includes(role);
    res.json({
      trust: toPublicTrust(canonical),
      decision: privileged ? decision : toPublicDecision(decision),
    });
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
