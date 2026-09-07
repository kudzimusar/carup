import { supabase } from '../db/supabase.js';
import {
  ACTION_CLASSES,
  deriveSessionAssurance,
  satisfiesActionClass,
} from '../services/auth/authenticationAssuranceService.js';

/**
 * O2-X3 — the ONE step-up guard. Compose AFTER authorizeRole/authorizeSessionRole (which
 * establish req.userContext) and after any capability gate: this layer answers a different
 * question — not "may this role do this" but "is the person at the keyboard proven strongly
 * and recently enough for this CLASS of action". Both checks are required; satisfying this one
 * grants nothing by itself.
 *
 * Assurance derives ONLY from the user_sessions row the presented token resolves to. An
 * identity asserted via the x-user-id fallback has no session row and is refused outright —
 * asserted identities cannot exercise step-up-gated actions in any environment.
 */
export function requireAuthenticationAssurance(actionClass) {
  if (!Object.values(ACTION_CLASSES).includes(actionClass)) {
    throw new Error(`Unknown action class for step-up guard: ${actionClass}`);
  }

  return async (req, res, next) => {
    try {
      if (actionClass === ACTION_CLASSES.ORDINARY) return next();

      const userContext = req.userContext;
      if (!userContext?.id) {
        return res.status(401).json({ error: 'Authentication required.', code: 'STEP_UP_UNAUTHENTICATED' });
      }
      if (userContext.authenticationMethod !== 'session') {
        return res.status(403).json({
          error: 'This action requires a real authenticated session, not an asserted identity.',
          code: 'STEP_UP_PROVEN_SESSION_REQUIRED',
          action_class: actionClass,
        });
      }

      const token = req.headers['x-session-token'] || req.headers['authorization']?.replace('Bearer ', '');
      const { data: sessionRow, error } = await supabase
        .from('user_sessions')
        .select('id, user_id, created_at, expires_at, is_valid, auth_method, step_up_at, step_up_method')
        .eq('token', token)
        .eq('user_id', userContext.id)
        .eq('is_valid', true)
        .single();
      if (error || !sessionRow) {
        return res.status(401).json({ error: 'Unauthorized. Session is invalid or expired.', code: 'STEP_UP_SESSION_NOT_FOUND' });
      }

      const assurance = deriveSessionAssurance(sessionRow);
      const verdict = satisfiesActionClass(assurance, actionClass);
      if (!verdict.ok) {
        return res.status(403).json({
          error: 'Recent re-authentication is required for this action.',
          code: 'STEP_UP_REQUIRED',
          action_class: actionClass,
          required_strength: verdict.required_strength,
          current_strength: verdict.current_strength,
          step_up_ttl_seconds: verdict.step_up_ttl_seconds,
        });
      }

      req.authenticationAssurance = { ...assurance, action_class: actionClass, satisfied: true };
      return next();
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  };
}

export { ACTION_CLASSES } from '../services/auth/authenticationAssuranceService.js';
export default requireAuthenticationAssurance;
