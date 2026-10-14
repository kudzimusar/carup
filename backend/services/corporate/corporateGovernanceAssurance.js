/**
 * CA-K3-AUTH-03 (Phase B core) — server-side proof of A1 for a Corporate governance actor.
 *
 *   A1_RECENT_REAUTH = a real session whose row records a password re-authentication inside the SENSITIVE step-up window
 *   (authenticationAssuranceService: STEP_UP_TTL_MS.sensitive_action, 15 min).
 *
 * It is proven ONLY from the `user_sessions` row the actor's own session token resolves to — exactly what stepUpMiddleware does for
 * every other step-up-gated action. Nothing a client sends (header, body, a pre-computed "assurance" object, an asserted identity)
 * can raise it: this module has no parameter that accepts one, and the mutation service refuses any input that tries to carry one.
 *
 * A2 does not exist (no strong authenticator is implemented) and is never emulated or inferred here: the only class this module can
 * return is A1_RECENT_REAUTH, and an unreadable, expired, foreign or un-stepped-up session is a refusal — never a downgrade to "ordinary".
 *
 * The database re-proves the same fact from the same row inside every governed procedure (corporate_governance_assert_a1), so a caller
 * that bypassed this module still cannot mutate; this module exists to refuse BEFORE any side effect (notably session revocation).
 */
import {
  ACTION_CLASSES,
  deriveSessionAssurance,
  satisfiesActionClass,
} from '../auth/authenticationAssuranceService.js';
import { CorporateGovernanceError } from './corporateGovernanceDecision.js';

export const CORPORATE_ASSURANCE_CLASS = 'A1_RECENT_REAUTH';
const TOKEN_MAX = 4096;

/**
 * @param client the service-role client
 * @param actor { userId, sessionToken } — the token is looked up, never trusted: the row must belong to `userId`
 * @returns { assurance_class, session_id, step_up_at, proven_at_ms, step_up_age_ms, server_proven: true }
 */
export async function proveActorAssuranceA1(client, actor, { now = Date.now() } = {}) {
  const userId = actor?.userId;
  const token = actor?.sessionToken;
  if (typeof userId !== 'string' || userId.trim() === '') throw new CorporateGovernanceError('ACTOR_REQUIRED');
  // An identity without a session token is an ASSERTED identity (x-user-id fallback); it can never exercise a step-up-gated action.
  if (typeof token !== 'string' || token.trim() === '' || token.length > TOKEN_MAX) throw new CorporateGovernanceError('ASSURANCE_SESSION_REQUIRED');

  let row;
  try {
    const { data, error } = await client
      .from('user_sessions')
      .select('id, user_id, created_at, expires_at, is_valid, auth_method, step_up_at, step_up_method')
      .eq('token', token)
      .eq('user_id', userId)
      .eq('is_valid', true)
      .single();
    // PGRST116 is "no row". Anything else is a read that FAILED, which is not the same as "no session" and is never an allow.
    if (error && error.code !== 'PGRST116') throw new CorporateGovernanceError('ASSURANCE_UNREADABLE');
    row = data ?? null;
  } catch (error) {
    if (error instanceof CorporateGovernanceError) throw error;
    throw new CorporateGovernanceError('ASSURANCE_UNREADABLE');
  }
  if (!row || row.user_id !== userId || row.is_valid !== true) throw new CorporateGovernanceError('ASSURANCE_SESSION_INVALID');

  const expiresAt = Date.parse(String(row.expires_at));
  if (!Number.isFinite(expiresAt)) throw new CorporateGovernanceError('ASSURANCE_UNREADABLE');
  if (expiresAt <= now) throw new CorporateGovernanceError('ASSURANCE_SESSION_INVALID');

  const assurance = deriveSessionAssurance(row, now);
  const verdict = satisfiesActionClass(assurance, ACTION_CLASSES.SENSITIVE, now);
  if (!verdict.ok) throw new CorporateGovernanceError('ASSURANCE_A1_REQUIRED');

  return Object.freeze({
    assurance_class: CORPORATE_ASSURANCE_CLASS,
    server_proven: true,
    session_id: row.id,
    step_up_at: assurance.step_up_at,
    step_up_age_ms: assurance.stepUpAgeMs,
  });
}

/** Names that would mean a caller is trying to hand this layer an assurance instead of earning one. Refused, not ignored. */
export const CLIENT_ASSURANCE_KEY = /assur|step_?up|^a[12]$|a[12]_|header|authenticat|^x-|^req$|^role$|^claims?$|^mfa/i;
export function assertNoClientAssertedAssurance(object, where = 'input') {
  if (object === null || typeof object !== 'object') return;
  for (const key of Object.keys(object)) {
    if (CLIENT_ASSURANCE_KEY.test(key)) throw new CorporateGovernanceError('ASSURANCE_CLIENT_ASSERTED', `${where}.${key} may not carry an assurance; A1 is proven server-side only.`);
  }
}
