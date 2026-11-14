import { Router } from 'express';

import { supabase } from '../db/supabase.js';
import { authorizeSessionRole } from '../middleware/authMiddleware.js';
import { logAuditEvent } from '../services/auditLogger.js';

/**
 * TI-10 — server-side revocation of the PRESENTING session on sign-out.
 *
 * Reconciled onto current main from the audited PR #226 (frozen backend lineage).
 * Current main's `user_sessions` contract (token + is_valid + expires_at, proven by
 * authorizeSessionRole) is used unchanged — no new session model.
 *
 * Security properties:
 *  - The target session is selected SERVER-SIDE from the presenting credential that
 *    authorizeSessionRole has already proven; body/header-supplied identity or session
 *    ids never participate in target selection.
 *  - Only the presenting session is revoked; a user's other sessions and every other
 *    account's sessions remain valid.
 *  - The response carries no token material; the audit row records session ids only
 *    (logAuditEvent redacts sensitive keys and we never put the token in the event).
 *  - Revocation or audit failure is reported honestly (500) and never as success; on
 *    revocation failure the session remains valid server-side, which the message says.
 *  - The route sits behind the global CSRF middleware mounted in server.js before all
 *    routers (asserted by the test suite).
 */
export function authSessionRouter() {
  const router = Router();

  router.post(
    '/api/auth/logout',
    authorizeSessionRole([]),
    async (req, res) => {
      try {
        // Same extraction the session middleware proves; the client cannot inject a target.
        const presentingToken =
          req.headers['x-session-token'] ||
          req.headers['authorization']?.replace('Bearer ', '') ||
          null;

        const { data: session, error: sessionError } = await supabase
          .from('user_sessions')
          .select('id, user_id, is_valid')
          .eq('token', presentingToken)
          .single();

        // authorizeSessionRole already 401'd an invalid session; this is defence in depth.
        if (sessionError || !session || !session.is_valid) {
          return res.status(401).json({ error: 'Unauthorized. Presenting session is invalid or expired.' });
        }
        if (session.user_id !== req.userContext.id) {
          return res.status(403).json({ error: 'Forbidden. Session ownership mismatch.' });
        }

        const { error: revokeError } = await supabase
          .from('user_sessions')
          .update({ is_valid: false })
          .eq('id', session.id);

        if (revokeError) {
          // Honest failure: the session is still valid server-side and the client is told.
          return res.status(500).json({
            error: 'Sign-out could not revoke the server session. It remains valid until expiry.',
          });
        }

        const audit = await logAuditEvent(supabase, {
          req,
          event_type: 'USER_SESSION_REVOKED',
          actor_user_id: req.userContext.id,
          new_value: { revoked_session_ids: [session.id], scope: 'one' },
          reason: 'self_service_current_session_logout',
        });

        if (!audit.success) {
          // Revocation occurred but is unaudited: do NOT report success (PR #226 semantics).
          return res.status(500).json({
            error: 'Sign-out revoked the session but the audit write failed; the operation is treated as failed.',
          });
        }

        return res.json({ success: true });
      } catch (error) {
        return res.status(500).json({
          error: `Sign-out failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        });
      }
    },
  );

  return router;
}

export default authSessionRouter;
