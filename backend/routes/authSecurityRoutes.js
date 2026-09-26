import express from 'express';
import { supabase } from '../db/supabase.js';
import { authorizeSessionRole } from '../middleware/authMiddleware.js';
import { requireAuthenticationAssurance } from '../middleware/stepUpMiddleware.js';
import { rateLimiter } from '../middleware/securityMiddleware.js';
import { ACTION_CLASSES, recordStepUp, STEP_UP_TTL_MS } from '../services/auth/authenticationAssuranceService.js';
import { listOwnSessions, revokeSessionsForUser } from '../services/auth/sessionSecurityService.js';
import { evaluateLoginCredentials } from '../utils/passwordAuth.js';

/**
 * O2-X3 — self-service account security. Every route requires a PROVEN session
 * (authorizeSessionRole: the x-user-id fallback is refused even where other routes accept it)
 * and acts only on the caller's own account.
 */
const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

function presentingToken(req) {
  return req.headers['x-session-token'] || req.headers['authorization']?.replace('Bearer ', '');
}

// Re-prove the account credential on THIS session. The only writer of step-up state: the
// credential is verified server-side against the stored hash before anything is stamped.
router.post(
  '/api/auth/step-up',
  rateLimiter({ max: 10, windowMs: 15 * 60 * 1000, isSensitive: true }),
  authorizeSessionRole([]),
  asyncHandler(async (req, res) => {
    const password = req.body?.password;
    if (typeof password !== 'string' || !password) {
      return res.status(400).json({ error: 'Your current password is required to step up.' });
    }

    const { data: user } = await supabase
      .from('users')
      .select('id, password_hash')
      .eq('id', req.userContext.id)
      .single();
    const evaluation = await evaluateLoginCredentials({ user, password });
    if (!evaluation.ok) {
      return res.status(401).json({ error: 'Password verification failed.', code: 'STEP_UP_CREDENTIAL_INVALID' });
    }

    const result = await recordStepUp(supabase, {
      token: presentingToken(req),
      userId: req.userContext.id,
      method: 'password_reauth',
    }, { req, actorRole: req.userContext.platformRole });

    res.json({
      success: true,
      step_up_at: result.step_up_at,
      method: result.method,
      ttl_seconds: {
        sensitive_action: Math.floor(STEP_UP_TTL_MS[ACTION_CLASSES.SENSITIVE] / 1000),
        critical_authority_action: Math.floor(STEP_UP_TTL_MS[ACTION_CLASSES.CRITICAL] / 1000),
      },
    });
  }),
);

// The caller's own live sessions — ids and display metadata only, never token material.
router.get(
  '/api/auth/sessions',
  authorizeSessionRole([]),
  asyncHandler(async (req, res) => {
    const sessions = await listOwnSessions(supabase, req.userContext, { presentingToken: presentingToken(req) });
    res.json({ success: true, sessions });
  }),
);

// Sign out everywhere else. Sensitive: requires a fresh step-up so a hijacked idle session
// cannot silently evict the real owner.
router.post(
  '/api/auth/sessions/revoke-others',
  authorizeSessionRole([]),
  requireAuthenticationAssurance(ACTION_CLASSES.SENSITIVE),
  asyncHandler(async (req, res) => {
    const result = await revokeSessionsForUser(supabase, req.userContext, {
      userId: req.userContext.id,
      scope: 'others',
      presentingToken: presentingToken(req),
      reason: 'self_service_revoke_others',
    }, { req, sourceRoute: '/api/auth/sessions/revoke-others' });
    res.json({ success: true, revoked_count: result.revoked_count });
  }),
);

export default router;
