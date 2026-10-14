/**
 * CA-K3-AUTH-01 — GET /api/corporate/access: the server's Corporate Admin access decision.
 *
 * Session-only: authorizeSessionRole refuses the x-user-id fallback outright, so an asserted identity
 * is a 401 whatever NODE_ENV says. The empty role list means the middleware only AUTHENTICATES here
 * (validated session, user row, tenant-context verification and mismatch refusal all unchanged); the
 * admission decision is made by evaluateCorporateAccess and nowhere else.
 *
 * Read-only: no write, no business data, no session token, no tenant data in the response.
 */
import express from 'express';
import { authorizeSessionRole } from '../middleware/authMiddleware.js';
import { evaluateCorporateAccess } from '../services/corporate/corporateAccessService.js';
import { observeShadowPolicy } from '../services/corporate/corporateShadowPolicy.js';

const router = express.Router();

router.get('/api/corporate/access', authorizeSessionRole([]), (req, res) => {
  const decision = evaluateCorporateAccess(req.userContext);
  // CA-K3-AUTH-02: shadow observation of the target membership policy. Default OFF, fire-and-forget, logs only;
  // it cannot change, delay or fail this response, and the legacy bridge decision above stays the only admission.
  observeShadowPolicy({ userContext: req.userContext, legacyDecision: decision });
  // A decision about THIS session: never cached by a browser or an intermediary.
  res.set('Cache-Control', 'no-store');
  return res.status(decision.status).json(decision.body);
});

export default router;
