import express from 'express';
import { authorizeSessionRole } from '../middleware/authMiddleware.js';
import { requireAuthenticationAssurance } from '../middleware/stepUpMiddleware.js';
import { ACTION_CLASSES } from '../services/auth/authenticationAssuranceService.js';
import {
  OPERATIONS_CAPABILITIES,
  requireOperationsCapability,
} from '../services/operations/operationsAuthorizationService.js';
import {
  getCurrentIdentityLifecycle,
  listIdentityLifecycleEvents,
  transitionIdentityLifecycle,
} from '../services/identity/identityLifecycleService.js';
import { revokeSessionsForUser } from '../services/auth/sessionSecurityService.js';
import { ValidationError } from '../utils/errors.js';

/**
 * O2-X3 — governed identity-lifecycle and account-security administration.
 *
 * Layered exactly as the O2 authority model requires: proven session (authorizeSessionRole) →
 * named capability (M5 static map) → authentication assurance (fresh step-up). The service
 * enforces the transition policy, self-action refusal and audit on top — no layer here is the
 * only line.
 */
const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

router.get(
  '/api/admin/identity/lifecycle/:userId',
  authorizeSessionRole(['admin', 'government']),
  requireOperationsCapability(OPERATIONS_CAPABILITIES.PERSON_READ_PRIVATE),
  asyncHandler(async (req, res) => {
    const userId = String(req.params.userId || '').trim();
    const [current, events] = await Promise.all([
      getCurrentIdentityLifecycle(undefined, userId),
      listIdentityLifecycleEvents(undefined, userId),
    ]);
    res.json({ success: true, lifecycle: current, events });
  }),
);

router.post(
  '/api/admin/identity/lifecycle/:userId/transition',
  authorizeSessionRole(['admin', 'government']),
  requireOperationsCapability(OPERATIONS_CAPABILITIES.IDENTITY_LIFECYCLE),
  requireAuthenticationAssurance(ACTION_CLASSES.SENSITIVE),
  asyncHandler(async (req, res) => {
    const userId = String(req.params.userId || '').trim();
    const nextState = String(req.body?.next_state || '').trim().toLowerCase();
    const reasonCode = String(req.body?.reason_code || '').trim().toUpperCase();
    const note = req.body?.note || '';
    if (!nextState) throw new ValidationError('next_state is required.');
    if (!reasonCode) throw new ValidationError('reason_code is required.');

    const result = await transitionIdentityLifecycle(undefined, req.userContext, {
      userId,
      nextState,
      reasonCode,
      note,
      evidenceReference: req.body?.evidence_reference || null,
    }, { req, sourceRoute: '/api/admin/identity/lifecycle/:userId/transition' });

    const current = await getCurrentIdentityLifecycle(undefined, userId);
    res.json({ success: true, lifecycle: current, event_id: result.event.id, revoked_sessions: result.revoked_sessions });
  }),
);

// Governed account-security revocation outside a lifecycle transition (e.g. lost device).
router.post(
  '/api/admin/account-security/:userId/revoke-sessions',
  authorizeSessionRole(['admin', 'government']),
  requireOperationsCapability(OPERATIONS_CAPABILITIES.ACCOUNT_SECURITY),
  requireAuthenticationAssurance(ACTION_CLASSES.SENSITIVE),
  asyncHandler(async (req, res) => {
    const userId = String(req.params.userId || '').trim();
    const reason = String(req.body?.reason || '').trim();
    if (!reason) throw new ValidationError('A revocation reason is required.');

    const result = await revokeSessionsForUser(undefined, req.userContext, {
      userId,
      scope: 'all',
      reason: `operations:${reason}`,
    }, { req, sourceRoute: '/api/admin/account-security/:userId/revoke-sessions' });
    res.json({ success: true, revoked_count: result.revoked_count });
  }),
);

export default router;
