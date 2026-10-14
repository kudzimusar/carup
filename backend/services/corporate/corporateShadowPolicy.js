/**
 * CA-K3-AUTH-02 (Phase A) — SHADOW evaluation of the target Corporate membership policy.
 *
 * The effective admission to the read-only Corporate shell is, and stays, the
 * `legacy_admin_compatibility_bridge` decision in corporateAccessService.js. This module computes, beside
 * it, what the TARGET policy would say about the same session-proven account — "is this an ACTIVE Corporate
 * member now?" — and keeps the two as SEPARATE facts:
 *
 *   legacy_bridge_decision        what the effective bridge decided (granted / denied)
 *   corporate_membership_state    what the membership source says (state, active nodes, zero capability)
 *
 * They are never merged into a synthetic grant, never compared to decide anything, and never returned to
 * the caller of /api/corporate/access: `carup.corporate_access.v1` is untouched. `alignment` is a
 * descriptive label for operators reading logs, and nothing in the access path reads it.
 *
 * Runtime: OFF unless CORPORATE_MEMBERSHIP_SHADOW === 'true' (so an environment where the Phase-A tables do
 * not exist yet is not even queried). When on, the observation is fire-and-forget AFTER the decision is
 * made: it cannot delay, change or fail the response, it writes nothing to the database, and its log line
 * carries no email, name, token or raw account id — only a pseudonymous digest of the subject.
 */
import { createHash } from 'node:crypto';
import { supabase as defaultSupabase } from '../../db/supabase.js';
import { MEMBERSHIP_STATE, resolveCorporateMembership, CORPORATE_MEMBERSHIP_STATE_CONTRACT } from './corporateMembershipService.js';

export const SHADOW_POLICY_CONTRACT = 'carup.corporate_membership_shadow.v1';
export const SHADOW_OBSERVATION_FLAG = 'CORPORATE_MEMBERSHIP_SHADOW';

export function isShadowObservationEnabled(env = process.env) {
  return env?.[SHADOW_OBSERVATION_FLAG] === 'true';
}

/** The bridge's own outcome, reduced to a fact. No capability list is copied. */
function summariseLegacyDecision(legacyDecision) {
  const granted = legacyDecision?.allowed === true;
  return {
    decision: granted ? 'granted' : 'denied',
    source: granted ? (legacyDecision?.body?.grant?.source ?? null) : null,
  };
}

function notEvaluated(reason, subject) {
  return {
    contract: CORPORATE_MEMBERSHIP_STATE_CONTRACT,
    state: MEMBERSHIP_STATE.NOT_EVALUATED,
    is_active_member: false,
    active_memberships: [],
    considered: [],
    capabilities: Object.freeze([]),
    grants_capability: false,
    evaluated_at: null,
    subject_user_id: subject ?? null,
    reason,
  };
}

/**
 * Only a SESSION-proven identity is ever looked up: an identity asserted by a header (x-user-id) is not
 * evaluated at all, so no request header can mint, name or probe a membership.
 */
export async function evaluateShadowPolicy({ userContext, legacyDecision, supabaseClient = defaultSupabase, now = new Date() }) {
  const proven = userContext?.authenticationMethod === 'session' && typeof userContext?.id === 'string' && userContext.id.trim() !== '';
  const corporate_membership_state = proven
    ? await resolveCorporateMembership(supabaseClient, userContext.id, { now })
    : notEvaluated('identity_not_session_proven', null);
  const legacy_bridge_decision = summariseLegacyDecision(legacyDecision);
  return {
    contract: SHADOW_POLICY_CONTRACT,
    mode: 'SHADOW',
    affects_admission: false,
    legacy_bridge_decision,
    corporate_membership_state,
    alignment: `legacy_${legacy_bridge_decision.decision}__membership_${corporate_membership_state.is_active_member ? 'active' : 'not_active'}`,
  };
}

const digest = (value) => (typeof value === 'string' && value ? createHash('sha256').update(value).digest('hex').slice(0, 12) : null);

function defaultLog(line) {
  console.info(JSON.stringify(line));
}

/**
 * Fire-and-forget observation for the access route. Returns nothing, throws nothing, awaits nothing: a
 * missing table, a database outage or a logging failure leaves the response exactly as it was.
 */
export function observeShadowPolicy({ userContext, legacyDecision, env = process.env, supabaseClient, now, log = defaultLog } = {}) {
  if (!isShadowObservationEnabled(env)) return;
  try {
    evaluateShadowPolicy({ userContext, legacyDecision, supabaseClient, now })
      .then((evaluation) => log({
        level: 'info',
        msg: 'corporate_membership_shadow',
        contract: evaluation.contract,
        mode: evaluation.mode,
        affects_admission: evaluation.affects_admission,
        subject_digest: digest(userContext?.id),
        legacy_bridge_decision: evaluation.legacy_bridge_decision.decision,
        corporate_membership_state: evaluation.corporate_membership_state.state,
        active_membership_count: evaluation.corporate_membership_state.active_memberships.length,
        alignment: evaluation.alignment,
      }))
      .catch(() => { /* observation only */ });
  } catch {
    /* observation only */
  }
}
