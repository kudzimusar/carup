/**
 * CA-K3-AUTH-01 → CA-CLOSE-01 — the server's Corporate Admin access decision and the People & Access projection.
 *
 *   GET /api/corporate/access         the admission decision (persistent Corporate authority — corporateAccessService.js)
 *   GET /api/corporate/people-access  the read-only People & Access projection, for an admitted actor whose persistent
 *                                     membership-management authority covers the rows (corporatePeopleAccessService.js)
 *
 * Session-only: authorizeSessionRole refuses the x-user-id fallback outright, so an asserted identity is a 401 whatever
 * NODE_ENV says. The empty role list means the middleware only AUTHENTICATES here (validated session, user row,
 * tenant-context verification and mismatch refusal all unchanged); admission is decided by evaluateCorporateAccess and
 * nowhere else.
 *
 * Read-only: no write, no session token, no tenant data in either response; both are decisions about THIS session and are
 * never cached by a browser or an intermediary.
 */
import express from 'express';
import { authorizeSessionRole } from '../middleware/authMiddleware.js';
import { supabase } from '../db/supabase.js';
import { CORPORATE_COMPATIBILITY_SOURCE, evaluateCorporateAccess, evaluateLegacyCompatibilityBridge } from '../services/corporate/corporateAccessService.js';
import { projectCorporatePeopleAccess } from '../services/corporate/corporatePeopleAccessService.js';
import { observeShadowPolicy } from '../services/corporate/corporateShadowPolicy.js';

const router = express.Router();

const UNAVAILABLE = Object.freeze({ decision: 'unavailable', code: 'CORPORATE_AUTHORITY_UNAVAILABLE', error: 'Corporate authority could not be confirmed right now. Nothing was granted.' });

router.get('/api/corporate/access', authorizeSessionRole([]), async (req, res) => {
  let decision;
  try {
    decision = await evaluateCorporateAccess(req.userContext);
  } catch {
    decision = { status: 503, body: UNAVAILABLE };
  }
  // CA-K3-AUTH-02 shadow observation, kept as a migration diagnostic: default OFF, fire-and-forget AFTER the decision, logs only.
  // It records what the RETIRED role-only rule would have said beside the membership state; nothing reads it, and it cannot
  // change, delay or fail this response — admission is persistent Corporate authority alone.
  const legacyRuleWouldAdmit = evaluateLegacyCompatibilityBridge(req.userContext);
  observeShadowPolicy({
    userContext: req.userContext,
    legacyDecision: { allowed: legacyRuleWouldAdmit, body: legacyRuleWouldAdmit ? { grant: { source: CORPORATE_COMPATIBILITY_SOURCE } } : {} },
  });
  res.set('Cache-Control', 'no-store');
  return res.status(decision.status).json(decision.body);
});

router.get('/api/corporate/people-access', authorizeSessionRole([]), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const admission = await evaluateCorporateAccess(req.userContext);
    if (!admission.allowed) return res.status(admission.status).json(admission.body);
    const projection = await projectCorporatePeopleAccess(supabase, { actorUserId: req.userContext.id });
    return res.status(projection.status).json(projection.body);
  } catch {
    return res.status(503).json(UNAVAILABLE);
  }
});

export default router;
